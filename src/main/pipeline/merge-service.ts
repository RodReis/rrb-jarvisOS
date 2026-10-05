/**
 * O merge serializado (SPEC-Scheduler-04): a seção crítica de integração numa base.
 *
 * Dois PRs podem passar no CI ao mesmo tempo e ainda assim não poder entrar juntos — o segundo foi
 * verificado contra uma base que o primeiro acaba de mudar. Este serviço faz três coisas:
 *
 *  1. **Serializa.** Só quem detém o `MergeLease` do repositório e da branch-base chega perto do
 *     `squashMerge`. Os outros recebem `aguardar` e voltam à fila do lease;
 *  2. **Reconcilia antes de agir.** Sob o lease, relê da origem o PR, o head, a base e a regra, e
 *     compara com o que a pipeline avaliou (`decidirMerge`). PR verde não garante merge se a
 *     base, o head ou a regra mudaram;
 *  3. **Não repete o que já aconteceu.** A tentativa é gravada antes da chamada; um crash entre a
 *     chamada e a confirmação deixa `iniciada`, e a próxima passagem consulta o GitHub **antes**
 *     de qualquer repetição.
 *
 * **Quando a base avançou**, o serviço atualiza a branch da fatia pelo `update-branch` do GitHub —
 * sem Git local, sem force-push, sem hook, filter ou driver (regra 3 da SPEC vale por construção)
 * — e devolve `revalidar` com o head novo. Os checks do head anterior não valem para o novo: o
 * gate os busca por SHA, então a revalidação é integral, e o chamador volta a esperar o CI.
 * **Conflito não é corrigido às cegas**: vira `bloqueado` com a ação de retomada.
 *
 * **Quem decide o terminal do run não é este serviço.** Ele diz o que a origem confirmou; o
 * `EntregaService` conclui o run.
 */

import { randomUUID } from 'node:crypto'
import {
  CONNECTOR_CONTRACT_VERSION,
  type ConnectorOutcome,
  type ConnectorRequest
} from '@shared/domain/connectors'
import type { WorkspaceId } from '@shared/domain/entities'
import {
  GITHUB_OPERATIONS,
  MENSAGEM_DE_CONFLITO_NA_ATUALIZACAO
} from '@shared/domain/github-automation'
import {
  chaveDoMerge,
  decidirMerge,
  recursoDoMerge,
  type AvaliacaoDoMerge,
  type ObservacaoDoMerge
} from '@shared/domain/merge-serializado'
import type { ConnectorService } from '../connectors/connector-service'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { LeaseRepository } from './lease-repository'
import type { MergeRepository, TentativaDeMerge } from './merge-repository'
import { lerRegraDaBase } from './regra-da-base'

export interface AlvoDoMerge {
  readonly owner: string
  readonly repo: string
  readonly branchBase: string
}

export interface PedidoDeMerge {
  readonly runId: string
  readonly projectId: string
  readonly workspaceId: WorkspaceId
  readonly alvo: AlvoDoMerge
  readonly pullRequest: number
  /** O que a pipeline avaliou ao decidir integrar. */
  readonly avaliacao: AvaliacaoDoMerge
}

/** Por que o run precisa voltar a esperar o CI em vez de mergear. */
export type MotivoDeRevalidacao = 'head-mudou' | 'regra-mudou' | 'base-atualizada'

export type ResultadoDoMerge =
  | { readonly tipo: 'mergeado'; readonly mergeSha: string }
  /** Ninguém mergeou: outro run está na seção crítica, ou a origem não respondeu. Tentar de novo. */
  | {
      readonly tipo: 'aguardar'
      readonly motivo: 'lease-ocupado' | 'tentativa-em-aberto' | 'origem-indisponivel'
    }
  /** O head ou a regra mudou — ou a base foi atualizada. Os checks anteriores já não valem. */
  | {
      readonly tipo: 'revalidar'
      readonly motivo: MotivoDeRevalidacao
      /** O head que o PR tem agora. Ausente quando só a regra mudou. */
      readonly headSha?: string
    }
  /** O merge saiu mas a origem não o confirmou. O run aguarda, com a causa registrada. */
  | { readonly tipo: 'sem-confirmacao' }
  | {
      readonly tipo: 'bloqueado'
      readonly causa: string
      readonly acao: string
      readonly mensagem: string
    }

/** O que a reconciliação do boot decidiu sobre uma tentativa. */
export interface AchadoDeMerge {
  readonly recurso: string
  readonly decisao: 'completado' | 'liberado' | 'bloqueado'
  readonly motivo: string
}

export interface MergeServiceDeps {
  readonly connectors: Pick<ConnectorService, 'call'>
  readonly leases: LeaseRepository
  readonly merges: MergeRepository
  readonly audit: AuditRepository
  readonly userId: () => string
  /** O próximo fencing token, monotônico e nunca reutilizado (o mesmo contador do pool). */
  readonly proximoToken: () => number
  /**
   * Avisa que o merge foi confirmado: as provas de independência que contavam com este run deixam
   * de valer (a base mudou) e o run sai das travas.
   */
  readonly aoMergear?: (runId: string) => void
  /**
   * O run tem merge confirmado na origem e ainda não o registrou: quem sabe concluí-lo o faz.
   * Chamado pela reconciliação do boot.
   */
  readonly aoReconciliarMergeado?: (tentativa: TentativaDeMerge) => void
  readonly agora?: () => number
}

const TIMEOUT_DA_CHAMADA_MS = 30_000

interface OpcoesDeChamada {
  readonly idempotencyKey?: string
  readonly efeito?: { readonly recurso: string; readonly fencingToken: number }
}

export class MergeService {
  private readonly agora: () => number

  constructor(private readonly deps: MergeServiceDeps) {
    this.agora = deps.agora ?? ((): number => Date.now())
  }

  /**
   * Tenta integrar o PR **dentro da seção crítica**. Nunca lança por causa da origem: o que a
   * origem não soube responder volta como `aguardar`, e o chamador decide quanto esperar.
   */
  async tentar(pedido: PedidoDeMerge): Promise<ResultadoDoMerge> {
    const userId = this.deps.userId()
    const recurso = recursoDoMerge(pedido.alvo.owner, pedido.alvo.repo, pedido.alvo.branchBase)

    const token = this.adquirirLease(userId, pedido, recurso)
    if (token === undefined) return { tipo: 'aguardar', motivo: 'lease-ocupado' }

    try {
      return await this.sobOLease(userId, pedido, recurso, token)
    } finally {
      // Sempre devolve: o lease que sobrasse bloquearia a base inteira até a reconciliação. Só o
      // dono do token solta — se o lease já foi reatribuído, este `false` é a resposta certa.
      this.deps.leases.liberarSlot(userId, recurso, pedido.runId, token)
    }
  }

  /**
   * Adquire o MergeLease, ou reassume o do próprio run (retry depois de um crash dentro da
   * validade). O lease de **outro** run — vigente ou expirado — nunca é tomado: expirado é decisão
   * da reconciliação, não de quem chegou depois.
   */
  private adquirirLease(
    userId: string,
    pedido: PedidoDeMerge,
    recurso: string
  ): number | undefined {
    const agora = this.agora()
    const atual = this.deps.leases.buscar(userId, recurso)

    if (atual !== undefined) {
      if (atual.proprietario !== pedido.runId || atual.fencingToken === undefined) return undefined
      this.deps.leases.renovar(userId, recurso, pedido.runId, agora)
      return atual.fencingToken
    }

    const token = this.deps.proximoToken()
    const lease = this.deps.leases.adquirir(
      userId,
      { proprietario: pedido.runId, recurso, projectId: pedido.projectId, fencingToken: token },
      agora
    )

    return lease === undefined ? undefined : token
  }

  private async sobOLease(
    userId: string,
    pedido: PedidoDeMerge,
    recurso: string,
    token: number
  ): Promise<ResultadoDoMerge> {
    const efeito = { recurso, fencingToken: token }

    // Tentativa deixada por um crash: resolver contra a origem **antes** de qualquer repetição. Este
    // run tem o lease exclusivo, então nenhuma chamada de merge desta base está no ar.
    const resolvida = await this.resolverTentativasAbertas(userId, pedido, recurso)
    if (resolvida !== undefined) return resolvida

    const observacao = await this.observar(pedido)
    if (observacao === undefined) return { tipo: 'aguardar', motivo: 'origem-indisponivel' }

    const decisao = decidirMerge(pedido.avaliacao, observacao)

    switch (decisao.reason) {
      case 'ja-mergeado':
        return this.adotarMergeado(userId, pedido, decisao.mergeSha)
      case 'pr-fechado':
        return {
          tipo: 'bloqueado',
          causa: 'pr-fechado',
          acao: 'Reabrir o pull request ou iniciar uma nova entrega.',
          mensagem: `O pull request #${pedido.pullRequest} foi fechado sem merge.`
        }
      case 'observacao-incompleta':
        log.agent.warn('Origem sem dado suficiente para decidir o merge', {
          runId: pedido.runId,
          faltou: decisao.faltou
        })
        return { tipo: 'aguardar', motivo: 'origem-indisponivel' }
      case 'head-mudou':
        return { tipo: 'revalidar', motivo: 'head-mudou', headSha: decisao.headSha }
      case 'regra-mudou':
        return { tipo: 'revalidar', motivo: 'regra-mudou' }
      case 'base-avancou':
        return await this.atualizarBase(userId, pedido, recurso, token, decisao.baseSha)
      case 'pode-mergear':
        return await this.mergear(userId, pedido, recurso, token, efeito)
    }
  }

  /**
   * Lê o PR, a base e a regra **agora**. `undefined` quando o PR ou a regra não puderam ser lidos:
   * sem eles não há como afirmar nada, e o merge não sai. A base ilegível não impede — a decisão
   * trata (M9-F05 §7).
   */
  private async observar(pedido: PedidoDeMerge): Promise<ObservacaoDoMerge | undefined> {
    const [estado, base, regra] = await Promise.all([
      this.lerEstadoDoPr(pedido),
      this.lerBase(pedido),
      lerRegraDaBase(
        (operation, input) => this.chamarSeguro(operation, pedido.workspaceId, input),
        pedido.alvo
      )
    ])
    if (estado === undefined) return undefined

    return { ...estado, baseSha: base, regra }
  }

  private async lerEstadoDoPr(
    pedido: PedidoDeMerge
  ): Promise<
    Pick<ObservacaoDoMerge, 'estado' | 'headSha' | 'mergeSha' | 'atrasadoPor'> | undefined
  > {
    const r = await this.chamarSeguro(GITHUB_OPERATIONS.getMergeState, pedido.workspaceId, {
      owner: pedido.alvo.owner,
      repo: pedido.alvo.repo,
      pullRequest: pedido.pullRequest
    })
    if (!r.ok) return undefined

    const d = (r.data ?? {}) as {
      readonly estado?: string
      readonly merged?: boolean
      readonly mergeSha?: string
      readonly headSha?: string
      readonly atrasadoPor?: unknown
    }
    const estado = d.merged === true ? 'mergeado' : d.estado === 'closed' ? 'fechado' : 'aberto'

    return {
      estado,
      ...(d.headSha === undefined || d.headSha === '' ? {} : { headSha: d.headSha }),
      ...(d.mergeSha === undefined ? {} : { mergeSha: d.mergeSha }),
      // Entrada da origem: só número inteiro não negativo vale; qualquer outra coisa é "não sei".
      ...(Number.isInteger(d.atrasadoPor) && (d.atrasadoPor as number) >= 0
        ? { atrasadoPor: d.atrasadoPor as number }
        : {})
    }
  }

  private async lerBase(pedido: PedidoDeMerge): Promise<string | undefined> {
    const r = await this.chamarSeguro(GITHUB_OPERATIONS.getCommitSha, pedido.workspaceId, {
      owner: pedido.alvo.owner,
      repo: pedido.alvo.repo,
      ref: pedido.alvo.branchBase
    })
    if (!r.ok) return undefined

    const sha = (r.data as { readonly sha?: string } | undefined)?.sha
    return sha === undefined || sha === '' ? undefined : sha
  }

  /**
   * Resolve as tentativas `iniciada` desta base contra a origem. Devolve um resultado quando a
   * resolução **já responde** à pergunta do chamador (o PR foi mergeado antes do crash), e
   * `undefined` quando o caminho segue livre.
   */
  private async resolverTentativasAbertas(
    userId: string,
    pedido: PedidoDeMerge,
    recurso: string
  ): Promise<ResultadoDoMerge | undefined> {
    const abertas = this.deps.merges.iniciadas(userId).filter((t) => t.recurso === recurso)

    for (const tentativa of abertas) {
      const estado = await this.consultarPr(tentativa)
      if (estado === undefined) return { tipo: 'aguardar', motivo: 'tentativa-em-aberto' }

      if (estado.merged && estado.mergeSha !== undefined) {
        this.deps.merges.confirmarReconciliado(userId, tentativa.id, estado.mergeSha, this.agora())
        this.auditar(userId, pedido.workspaceId, 'tentativa-reconciliada', tentativa.runId, {
          pullRequest: tentativa.pullRequest,
          mergeSha: estado.mergeSha
        })
        if (tentativa.runId === pedido.runId && tentativa.pullRequest === pedido.pullRequest) {
          this.deps.aoMergear?.(pedido.runId)
          return { tipo: 'mergeado', mergeSha: estado.mergeSha }
        }
        // Era de outro run: o merge dele aconteceu, e a base mudou. A observação seguinte vê isso.
        continue
      }

      // A origem mostra o PR aberto e sem merge: o efeito não aconteceu. Seguro tentar de novo.
      this.deps.merges.abandonar(userId, tentativa.id, this.agora())
      this.auditar(userId, pedido.workspaceId, 'tentativa-abandonada', tentativa.runId, {
        pullRequest: tentativa.pullRequest
      })
    }

    return undefined
  }

  private async consultarPr(
    t: TentativaDeMerge
  ): Promise<{ readonly merged: boolean; readonly mergeSha?: string } | undefined> {
    const alvo = this.alvoDe(t.recurso)
    if (alvo === undefined) return undefined

    const r = await this.chamarSeguro(GITHUB_OPERATIONS.getMergeState, t.workspaceId, {
      owner: alvo.owner,
      repo: alvo.repo,
      pullRequest: t.pullRequest
    })
    if (!r.ok) return undefined

    const d = (r.data ?? {}) as { readonly merged?: boolean; readonly mergeSha?: string }
    return {
      merged: d.merged === true,
      ...(d.mergeSha === undefined ? {} : { mergeSha: d.mergeSha })
    }
  }

  /** O PR já estava mergeado na origem sem tentativa nossa: adota o commit, não mergeia de novo. */
  private adotarMergeado(
    userId: string,
    pedido: PedidoDeMerge,
    mergeSha: string
  ): ResultadoDoMerge {
    this.auditar(userId, pedido.workspaceId, 'ja-mergeado', pedido.runId, {
      pullRequest: pedido.pullRequest,
      mergeSha
    })
    this.deps.aoMergear?.(pedido.runId)
    return { tipo: 'mergeado', mergeSha }
  }

  /**
   * A base avançou: atualiza a branch da fatia pela API do GitHub e manda o run revalidar.
   *
   * O `expectedHeadSha` protege contra push de terceiro entre a leitura e a atualização. Conflito
   * é bloqueio com ação de retomada, e **não** há tentativa de resolvê-lo aqui: decidir o conflito
   * é decisão de produto ou de arquitetura (regra 4 da SPEC).
   */
  private async atualizarBase(
    userId: string,
    pedido: PedidoDeMerge,
    recurso: string,
    token: number,
    baseSha: string
  ): Promise<ResultadoDoMerge> {
    // Renovo antes: a atualização é uma chamada de rede de até 30 s, e o lease vale 30 s.
    this.deps.leases.renovar(userId, recurso, pedido.runId, this.agora())

    const r = await this.chamarSeguro(
      GITHUB_OPERATIONS.updateBranch,
      pedido.workspaceId,
      {
        owner: pedido.alvo.owner,
        repo: pedido.alvo.repo,
        pullRequest: pedido.pullRequest,
        expectedHeadSha: pedido.avaliacao.headSha
      },
      { efeito: { recurso, fencingToken: token } }
    )

    if (!r.ok) {
      if (ehConflitoNaAtualizacao(r)) {
        return {
          tipo: 'bloqueado',
          causa: 'conflito-na-atualizacao',
          acao: 'Resolver o conflito entre a fatia e a base nova e retomar a entrega.',
          mensagem:
            `A base ${pedido.alvo.branchBase} avançou para ${baseSha.slice(0, 12)} e a fatia ` +
            'conflita com ela. A pipeline não resolve conflito sozinha.'
        }
      }
      return { tipo: 'aguardar', motivo: 'origem-indisponivel' }
    }

    // O head novo vem da origem, não da suposição: a atualização é assíncrona no GitHub.
    const estado = await this.lerEstadoDoPr(pedido)
    this.auditar(userId, pedido.workspaceId, 'base-atualizada', pedido.runId, {
      pullRequest: pedido.pullRequest,
      baseSha,
      headAnterior: pedido.avaliacao.headSha,
      headNovo: estado?.headSha ?? null
    })

    return {
      tipo: 'revalidar',
      motivo: 'base-atualizada',
      ...(estado?.headSha === undefined ? {} : { headSha: estado.headSha })
    }
  }

  private async mergear(
    userId: string,
    pedido: PedidoDeMerge,
    recurso: string,
    token: number,
    efeito: { readonly recurso: string; readonly fencingToken: number }
  ): Promise<ResultadoDoMerge> {
    const headSha = pedido.avaliacao.headSha

    // A tentativa é gravada **antes** da chamada, e é aqui que a corrida com o cancelamento se
    // decide: run já cancelado não nasce tentativa; tentativa nascida segura o cancelamento.
    const inicio = this.deps.merges.iniciar(
      userId,
      {
        runId: pedido.runId,
        workspaceId: pedido.workspaceId,
        projectId: pedido.projectId,
        recurso,
        pullRequest: pedido.pullRequest,
        headSha,
        fencingToken: token
      },
      this.agora()
    )

    if (inicio.tipo === 'recusada') {
      switch (inicio.motivo) {
        case 'run-fora-de-pr-ci':
          return {
            tipo: 'bloqueado',
            causa: 'run-encerrado',
            acao: 'Nenhuma: o run já terminou e o merge não foi feito.',
            mensagem:
              'O run saiu de PR_CI antes do merge (cancelado ou encerrado); nada foi mergeado.'
          }
        case 'lease-perdido':
          return { tipo: 'aguardar', motivo: 'lease-ocupado' }
        case 'tentativa-em-aberto':
        case 'ja-tentada':
          return { tipo: 'aguardar', motivo: 'tentativa-em-aberto' }
      }
    }

    this.deps.leases.renovar(userId, recurso, pedido.runId, this.agora())

    // Mesmo que a chamada falhe ou estoure o tempo, a confirmação vem da origem — nunca do código
    // de saída. Por isso o desfecho do `squashMerge` só é registrado, não decide.
    const chamada = await this.chamar(
      GITHUB_OPERATIONS.squashMerge,
      pedido.workspaceId,
      {
        owner: pedido.alvo.owner,
        repo: pedido.alvo.repo,
        pullRequest: pedido.pullRequest,
        expectedHeadSha: headSha
      },
      {
        idempotencyKey: chaveDoMerge(
          pedido.alvo.owner,
          pedido.alvo.repo,
          pedido.pullRequest,
          headSha
        ),
        efeito
      }
    )

    const estado = await this.consultarPr({
      ...inicio.tentativa,
      recurso
    })

    if (estado?.merged === true && estado.mergeSha !== undefined) {
      return this.confirmar(userId, pedido, inicio.tentativa, estado.mergeSha)
    }

    if (estado === undefined) {
      // Não sei se o merge aconteceu: a tentativa fica `iniciada`, e a reconciliação consulta a
      // origem antes de qualquer repetição. Abandonar aqui seria apostar que não saiu.
      log.agent.warn('Origem não respondeu à confirmação do merge; tentativa fica em aberto', {
        runId: pedido.runId
      })
      return { tipo: 'sem-confirmacao' }
    }

    this.deps.merges.abandonar(userId, inicio.tentativa.id, this.agora())
    log.agent.warn('Merge não confirmado na origem', {
      runId: pedido.runId,
      chamadaOk: chamada.ok
    })
    return { tipo: 'sem-confirmacao' }
  }

  private confirmar(
    userId: string,
    pedido: PedidoDeMerge,
    tentativa: TentativaDeMerge,
    mergeSha: string
  ): ResultadoDoMerge {
    // Só o dono atual confirma. Se o lease mudou de mãos durante a chamada, a confirmação cai para
    // a constatação da origem — que é a prova, e a reconciliação sabe fazê-la.
    const agora = this.agora()
    const confirmou =
      this.deps.merges.confirmar(userId, tentativa.id, mergeSha, agora) ||
      this.deps.merges.confirmarReconciliado(userId, tentativa.id, mergeSha, agora)

    this.auditar(userId, pedido.workspaceId, 'confirmado', pedido.runId, {
      pullRequest: pedido.pullRequest,
      mergeSha,
      pelaReconciliacao: !confirmou
    })
    this.deps.aoMergear?.(pedido.runId)

    return { tipo: 'mergeado', mergeSha }
  }

  /**
   * Reconciliação do boot: resolve o que um crash deixou e solta os leases de merge sem
   * tentativa em aberto. **Bloqueante e fail closed** — tentativa que a origem não respondeu fica
   * como está, com o lease, e o achado diz isso.
   */
  async reconciliar(): Promise<readonly AchadoDeMerge[]> {
    const userId = this.deps.userId()
    const achados: AchadoDeMerge[] = []
    // As tentativas que o primeiro laço já concluiu: o segundo não as trata de novo.
    const jaConcluidas = new Set<number>()

    for (const tentativa of this.deps.merges.iniciadas(userId)) {
      const estado = await this.consultarPr(tentativa)

      if (estado === undefined) {
        achados.push({
          recurso: tentativa.recurso,
          decisao: 'bloqueado',
          motivo: `A origem não respondeu sobre o PR #${tentativa.pullRequest}; não se sabe se o merge saiu.`
        })
        continue
      }

      if (estado.merged && estado.mergeSha !== undefined) {
        this.deps.merges.confirmarReconciliado(userId, tentativa.id, estado.mergeSha, this.agora())
        jaConcluidas.add(tentativa.id)
        this.deps.aoReconciliarMergeado?.({
          ...tentativa,
          estado: 'confirmada',
          mergeSha: estado.mergeSha
        })
        achados.push({
          recurso: tentativa.recurso,
          decisao: 'completado',
          motivo: `O PR #${tentativa.pullRequest} já estava mergeado na origem (${estado.mergeSha.slice(0, 12)}).`
        })
        continue
      }

      this.deps.merges.abandonar(userId, tentativa.id, this.agora())
      achados.push({
        recurso: tentativa.recurso,
        decisao: 'liberado',
        motivo: `O PR #${tentativa.pullRequest} não foi mergeado; a tentativa foi abandonada e pode ser repetida.`
      })
    }

    // Merge confirmado na origem e run ainda em PR_CI: o crash pegou entre a confirmação e o run.
    for (const tentativa of this.deps.merges.confirmadasComRunAberto(userId)) {
      if (jaConcluidas.has(tentativa.id)) continue
      this.deps.aoReconciliarMergeado?.(tentativa)
      achados.push({
        recurso: tentativa.recurso,
        decisao: 'completado',
        motivo: `O merge do PR #${tentativa.pullRequest} estava confirmado; o run foi concluído.`
      })
    }

    // Lease de merge sem tentativa em aberto não segura nada: no boot não há dono vivo.
    const abertas = new Set(this.deps.merges.iniciadas(userId).map((t) => t.recurso))
    for (const lease of this.deps.leases.listar(userId)) {
      if (!lease.recurso.startsWith('merge:') || abertas.has(lease.recurso)) continue
      this.deps.leases.removerReconciliado(userId, lease.recurso)
      achados.push({
        recurso: lease.recurso,
        decisao: 'liberado',
        motivo: 'MergeLease sem tentativa em aberto depois de um reinício. Liberado.'
      })
    }

    return achados
  }

  private alvoDe(recurso: string): AlvoDoMerge | undefined {
    const corpo = recurso.slice('merge:'.length)
    const separador = corpo.indexOf(':')
    const repositorio = corpo.slice(0, separador)
    const barra = repositorio.indexOf('/')
    if (separador < 0 || barra < 0) return undefined

    return {
      owner: repositorio.slice(0, barra),
      repo: repositorio.slice(barra + 1),
      branchBase: corpo.slice(separador + 1)
    }
  }

  private async chamar(
    operation: string,
    workspaceId: WorkspaceId,
    input: Record<string, unknown>,
    opcoes: OpcoesDeChamada = {}
  ): Promise<ConnectorOutcome> {
    const userId = this.deps.userId()

    const request: ConnectorRequest = {
      contractVersion: CONNECTOR_CONTRACT_VERSION,
      connector: 'github',
      operation,
      correlationId: randomUUID(),
      idempotencyKey: opcoes.idempotencyKey ?? randomUUID(),
      timeoutMs: TIMEOUT_DA_CHAMADA_MS,
      credential: { key: 'github', user_id: userId, workspace_id: workspaceId },
      input
    }

    return await this.deps.connectors.call(request, {
      userId,
      workspace: workspaceId,
      ...(opcoes.efeito === undefined ? {} : { efeito: opcoes.efeito })
    })
  }

  /**
   * Como `chamar`, mas **exceção vira falha de leitura**, nunca propaga.
   *
   * Vale para tudo o que só pergunta à origem (e para a atualização da branch): a SPEC-Pipeline-01
   * §7 manda preservar o PR quando a base não pôde ser lida, e uma exceção do conector — permissão
   * ausente, rede — não pode derrubar a entrega inteira num ponto em que o desfecho certo é
   * "não sei, espero". O `squashMerge` **não** passa por aqui: uma exceção no meio do merge é o
   * crash que a reconciliação existe para tratar, e escondê-la apagaria o rastro.
   */
  private async chamarSeguro(
    operation: string,
    workspaceId: WorkspaceId,
    input: Record<string, unknown>,
    opcoes: OpcoesDeChamada = {}
  ): Promise<ConnectorOutcome> {
    try {
      return await this.chamar(operation, workspaceId, input, opcoes)
    } catch (erro) {
      log.agent.warn('Leitura da origem falhou; tratada como indisponível', {
        operation,
        erro: erro instanceof Error ? erro.message : String(erro)
      })
      return {
        ok: false,
        code: 'indisponivel',
        mensagem: 'A origem não respondeu.',
        retryable: true,
        acao: 'retentar',
        provenance: {
          connector: 'github',
          operation,
          obtidoEm: new Date(this.agora()).toISOString()
        }
      }
    }
  }

  private auditar(
    userId: string,
    workspaceId: WorkspaceId,
    fase: string,
    runId: string,
    detalhe: Record<string, unknown>
  ): void {
    this.deps.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'pipeline-merge',
      payload: { fase, runId, ...detalhe }
    })
  }
}

/**
 * O conflito entre a base e a branch da fatia. Detectado pela marca que o adapter coloca no começo
 * da mensagem do erro — o contrato de erro do conector não tem código próprio para isso.
 */
function ehConflitoNaAtualizacao(r: Extract<ConnectorOutcome, { ok: false }>): boolean {
  return r.mensagem.startsWith(MENSAGEM_DE_CONFLITO_NA_ATUALIZACAO)
}
