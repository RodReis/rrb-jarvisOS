/**
 * A orquestração da fatia até o merge (SPEC-Entrega-05).
 *
 * A pergunta que este serviço responde: **construído e validado, como este trabalho entra na
 * branch-base sem novo aceite do PI — e quando ele não entra?**
 *
 * Costura peças que já existem: `ConstrutorService` (M9-F04) constrói e valida no container,
 * `GitRunner` (M9-F01) publica, o adapter GitHub (M6-F04) fala com a origem pelo
 * `ConnectorService`, `avaliarGateDeMerge` decide e `FilaService.concluir` fecha o run no terminal
 * que o kill-switch escolher.
 *
 * ## O que este serviço nunca faz
 *
 * - **Não deduz merge.** `MERGED` só sai com `merged: true` e `mergeSha` confirmados na origem
 *   (critérios 6 e 7). Código de saída zero não prova nada.
 * - **Não usa `closes #N`.** Sempre `refs #N`: merge integra código, não é aceite de fatia — o
 *   mesmo princípio que este repositório aplica a si.
 * - **Não contorna merge queue** (critério 12) nem inventa check obrigatório que a origem não
 *   exige (critério 10).
 * - **Não fala com o `GithubAdapter` direto.** Tudo passa pelo `ConnectorService`, onde vivem o
 *   gate de créditos, a policy `api.external-call` e a auditoria do par antes/depois.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  CONNECTOR_CONTRACT_VERSION,
  type ConnectorOutcome,
  type ConnectorRequest
} from '@shared/domain/connectors'
import type { WorkspaceId } from '@shared/domain/entities'
import {
  CAMINHO_DO_WORKFLOW,
  NOME_DO_JOB_DE_CI,
  gerarWorkflowDeCi,
  precisaReescreverWorkflow,
  type ComandosDeValidacao
} from '@shared/domain/ci-workflow'
import {
  avaliarGateDeMerge,
  type SeveridadeDeAchado,
  type VeredictoDoGate
} from '@shared/domain/gate-de-merge'
import {
  ledgerCompleto,
  type CheckDoLedger,
  type ExecutionLedger
} from '@shared/domain/execution-ledger'
import { GITHUB_OPERATIONS, type CheckNormalizado } from '@shared/domain/github-automation'
import type { EstadoDoRun } from '@shared/domain/pipeline'
import type { SandboxPreparado } from '@shared/domain/preflight'
import { rulesetMudou, type SnapshotDeRuleset } from '@shared/domain/ruleset'
import type { ConnectorService } from '../connectors/connector-service'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { ConstrutorService } from './construtor-service'
import type { FilaService } from './fila-service'
import type { GitRunner } from '../projects/git-runner'
import type { MergePolicyService } from './merge-policy-service'
import type { BudgetRepository } from '../budget/budget-repository'
import type { ExecutionLedgerRepository } from './execution-ledger-repository'
import type { LimpezaService } from './limpeza-service'
import type { RulesetRepository } from './ruleset-repository'

/** O teto padrão de espera por checks pendentes (decisão do PI, 2026-09-02). */
export const TETO_DE_ESPERA_PADRAO_MS = 30 * 60 * 1000

/** O intervalo entre consultas ao estado dos checks. */
const INTERVALO_DE_CONSULTA_MS = 15_000

export interface AlvoDaEntrega {
  readonly owner: string
  readonly repo: string
  readonly branchBase: string
  readonly branchDaFatia: string
}

/** Um achado de revisão devolvido pelo revisor, no vocabulário do `REVIEW.md`. */
export interface AchadoDeRevisao {
  readonly severidade: SeveridadeDeAchado
  readonly titulo: string
}

export interface PedidoDeEntrega {
  readonly runId: string
  readonly projectId: string
  readonly workspaceId: WorkspaceId
  readonly sandbox: SandboxPreparado
  readonly alvo: AlvoDaEntrega
  /** A issue-fatia. Entra no corpo do PR como `refs #N`, nunca `closes`. */
  readonly issue: number
  readonly titulo: string
  readonly promptInicial: string
  /**
   * O manifesto que autorizou a construção.
   *
   * Sem ele o gate de ContextPack (`call-provider.ts`) recusa **toda** chamada do executor — é o
   * que mantinha a rota inoperante enquanto o boot passava `contextPackId: () => undefined`.
   */
  readonly contextPackId?: string
  readonly comandosDeValidacao: ComandosDeValidacao
  /** Documentos do projeto-alvo que entram no mesmo PR, antes do merge (critério 13). */
  readonly docsDoProjeto?: readonly string[]
  readonly signal?: AbortSignal
}

export interface ResultadoDaEntrega {
  readonly estadoFinal: 'MERGED' | 'AWAITING_MERGE' | 'BLOCKED'
  readonly pullRequest?: number
  readonly mergeSha?: string
  /**
   * O head que a pipeline verificou na origem.
   *
   * Sai daqui para o `ExecutionLedger` (M9-F06, critério 1): sem ele, `MERGED` não teria contra o
   * que comparar o merge, e a coerência exigida pelo critério seria indemonstrável.
   */
  readonly headSha?: string
  /** Os checks observados naquele head. Também exigidos pelo critério 1 em `MERGED`. */
  readonly checks?: readonly CheckDoLedger[]
  readonly bloqueio?: {
    readonly causa: string
    readonly acao: string
    readonly mensagem: string
  }
}

/** O run corrente, para o `ExecutorProxy` correlacionar custo com trabalho (M9-F04, pendência). */
export interface RunCorrente {
  readonly runId: string
  readonly tentativa: number
  readonly contextPackId?: string
}

export interface EntregaDeps {
  readonly construtor: ConstrutorService
  readonly connectors: ConnectorService
  readonly git: GitRunner
  readonly fila: FilaService
  readonly mergePolicy: MergePolicyService
  readonly ruleset: RulesetRepository
  /** Onde a prova do run é gravada ao encerrar (M9-F06, critério 1). */
  readonly ledger: ExecutionLedgerRepository
  /** Devolve worktree, container e portas ao sistema — em todo desfecho (M9-F06, critério 5). */
  readonly limpeza: LimpezaService
  /** A soma do que o run consumiu, correlacionada por `run_id` desde a M9-F05. */
  readonly budget: BudgetRepository
  readonly audit: AuditRepository
  readonly userId: () => string
  /**
   * Revisa o delta e devolve os achados ainda abertos.
   *
   * O revisor é o próprio executor, em invocação separada no container (M9-F04 § Decisões). Entra
   * como função para que o serviço não decida *como* revisar — só o que fazer com o resultado.
   */
  readonly revisar: (pedido: PedidoDeEntrega) => Promise<readonly AchadoDeRevisao[]>
  /** Resolve o token do push. O conector resolve o dele por dentro do `ConnectorService`. */
  readonly token: (userId: string, workspace: WorkspaceId) => Promise<string | undefined>
  readonly tetoDeEsperaMs?: number
  readonly agora?: () => number
  readonly dormir?: (ms: number) => Promise<void>
}

export class EntregaService {
  private runCorrente?: RunCorrente
  private readonly agora: () => number
  private readonly dormir: (ms: number) => Promise<void>
  private readonly tetoDeEsperaMs: number

  constructor(private readonly deps: EntregaDeps) {
    this.agora = deps.agora ?? ((): number => Date.now())
    this.dormir =
      deps.dormir ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)))
    this.tetoDeEsperaMs = deps.tetoDeEsperaMs ?? TETO_DE_ESPERA_PADRAO_MS
  }

  /**
   * O run e a tentativa correntes.
   *
   * É o que o boot passa ao `ExecutorProxy` no lugar dos `() => undefined` que a M9-F04 deixou:
   * sem isto o gate de ContextPack recusa **toda** chamada do executor, e a rota não opera em
   * produção. Fecha a pendência declarada por aquela fatia.
   */
  contextoDoRun(): RunCorrente | undefined {
    return this.runCorrente
  }

  async entregar(pedido: PedidoDeEntrega): Promise<ResultadoDaEntrega> {
    this.runCorrente = {
      runId: pedido.runId,
      tentativa: 1,
      ...(pedido.contextPackId === undefined ? {} : { contextPackId: pedido.contextPackId })
    }

    const iniciadoEm = this.agora()
    let resultado: ResultadoDaEntrega | undefined

    try {
      resultado = await this.executar(pedido)
      return resultado
    } finally {
      const tentativa = this.runCorrente?.tentativa ?? 1
      this.runCorrente = undefined
      this.encerrar(pedido, resultado, iniciadoEm, tentativa)
    }
  }

  /**
   * Grava a prova e devolve os recursos — em **todo** desfecho (M9-F06, critérios 1 e 5).
   *
   * No `finally`, e não depois do `return`: `BLOCKED` vaza worktree e container igual a `MERGED`,
   * e uma exceção inesperada vazaria os dois sem deixar registro nenhum. Um run que termina sem
   * ledger é um run que não pode ser auditado.
   *
   * **Nada aqui pode derrubar a entrega.** O merge já aconteceu quando este método roda; deixar
   * uma falha de limpeza propagar transformaria uma sobra de container em erro de entrega, e o
   * chamador veria falha onde houve sucesso.
   */
  private encerrar(
    pedido: PedidoDeEntrega,
    resultado: ResultadoDaEntrega | undefined,
    iniciadoEm: number,
    tentativa: number
  ): void {
    const estadoFinal = resultado?.estadoFinal ?? 'BLOCKED'

    try {
      this.gravarLedger(pedido, resultado, iniciadoEm, tentativa, estadoFinal)
    } catch (erro) {
      log.agent.error('Ledger do run não pôde ser gravado', {
        runId: pedido.runId,
        motivo: erro instanceof Error ? erro.message : 'desconhecido'
      })
    }

    try {
      this.deps.limpeza.limpar({
        runId: pedido.runId,
        userId: this.deps.userId(),
        projectId: pedido.projectId,
        repositorio: pedido.sandbox.worktreeNoHost,
        sandbox: pedido.sandbox,
        // `MERGED` é fase pós-merge; os demais terminais pararam durante o CI, e nas duas a
        // limpeza preserva branch e PR — o que muda é só o monitoramento.
        fase: estadoFinal === 'MERGED' ? 'depois-do-merge' : 'durante-ci',
        estadoFinal
      })
    } catch (erro) {
      log.agent.error('Limpeza do run falhou; recursos ficam para a reconciliação', {
        runId: pedido.runId,
        motivo: erro instanceof Error ? erro.message : 'desconhecido'
      })
    }
  }

  /**
   * Monta e grava o `ExecutionLedger`.
   *
   * **Ledger incompleto ainda é gravado**, com um `error` no log dizendo qual campo falta. A
   * alternativa — recusar a gravação — trocaria uma prova imperfeita por prova nenhuma, e é a
   * prova nenhuma que impede auditar o que aconteceu.
   */
  private gravarLedger(
    pedido: PedidoDeEntrega,
    resultado: ResultadoDaEntrega | undefined,
    iniciadoEm: number,
    tentativa: number,
    estadoFinal: EstadoDoRun
  ): void {
    const userId = this.deps.userId()
    const consumo = this.deps.budget.consumoDoRun(userId, pedido.runId)

    const ledger: ExecutionLedger = {
      runId: pedido.runId,
      userId,
      projectId: pedido.projectId,
      estadoFinal,
      duracaoMs: Math.max(0, this.agora() - iniciadoEm),
      tentativas: Math.max(consumo.tentativas, tentativa),
      tokens: consumo.tokens,
      creditos: 0,
      custoUsd: consumo.custoUsd,
      eventos: [
        { em: new Date(iniciadoEm).toISOString(), oQue: 'entrega-iniciada' },
        { em: new Date(this.agora()).toISOString(), oQue: `entrega-${estadoFinal}` }
      ],
      ...(resultado?.headSha === undefined ? {} : { headSha: resultado.headSha }),
      ...(resultado?.mergeSha === undefined ? {} : { mergeSha: resultado.mergeSha }),
      checks: resultado?.checks ?? [],
      artefatos: [],
      encerradoEm: new Date(this.agora()).toISOString()
    }

    if (!ledgerCompleto(ledger)) {
      log.agent.error('Ledger do run está incompleto para o estado declarado', {
        runId: pedido.runId,
        estado: estadoFinal
      })
    }

    this.deps.ledger.registrar(ledger)
  }

  private async executar(pedido: PedidoDeEntrega): Promise<ResultadoDaEntrega> {
    // (1) O workflow de CI do projeto-alvo, antes de construir: ele entra no mesmo PR e é o que
    // dá à origem um check para exigir (critério 9).
    this.garantirWorkflowDeCi(pedido)

    // (2) Construção e validação no container. `BLOCKED` termina aqui, com a causa do construtor.
    const construcao = await this.deps.construtor.construir({
      runId: pedido.runId,
      sandbox: pedido.sandbox,
      promptInicial: pedido.promptInicial,
      comandosDeValidacao: pedido.comandosDeValidacao,
      signal: pedido.signal
    })

    if (construcao.estadoFinal === 'BLOCKED') {
      return this.bloqueado(
        construcao.bloqueio?.causa ?? 'externo',
        construcao.bloqueio?.retomada ?? 'Retomar a construção.',
        construcao.bloqueio?.evidencia ?? 'A construção não chegou a PR_CI.'
      )
    }

    this.runCorrente = {
      runId: pedido.runId,
      tentativa: construcao.tentativas.length === 0 ? 1 : construcao.tentativas.length,
      ...(pedido.contextPackId === undefined ? {} : { contextPackId: pedido.contextPackId })
    }

    // (3) Revisão do delta. P0/P1 abertos bloqueiam o merge mesmo com o kill-switch ligado.
    const achados = await this.deps.revisar(pedido)

    // (4) Publica e garante o PR — **sempre o mesmo**, mesmo depois de recuperação (critério 5).
    const publicacao = await this.publicar(pedido)
    if (!publicacao.ok) return publicacao.bloqueio

    // (5) Proteção da branch-base exigindo o check que acabamos de gerar. É o que fecha os
    // critérios 9 e 10 sem intervenção humana: sem context obrigatório, o gate barra por ausência
    // de regra, e a pipeline seria incapaz de destravar a si mesma.
    await this.exigirCheckObrigatorio(pedido)

    return await this.aguardarEConcluir(pedido, publicacao.pullRequest, achados)
  }

  /**
   * Escreve `.github/workflows/ci.yml` no worktree quando ele falta ou não declara os comandos.
   *
   * Não reescreve por cosmética: `precisaReescreverWorkflow` compara os comandos, não o texto, e
   * um arquivo editado à mão que ainda roda os mesmos comandos fica como está.
   */
  private garantirWorkflowDeCi(pedido: PedidoDeEntrega): void {
    const caminho = join(pedido.sandbox.worktreeNoHost, CAMINHO_DO_WORKFLOW)
    const atual = existsSync(caminho) ? readFileSync(caminho, 'utf8') : undefined

    if (!precisaReescreverWorkflow(atual, pedido.comandosDeValidacao)) return

    mkdirSync(dirname(caminho), { recursive: true })
    writeFileSync(caminho, gerarWorkflowDeCi(pedido.comandosDeValidacao), 'utf8')
    log.agent.info('Workflow de CI gerado no projeto-alvo', {
      runId: pedido.runId,
      caminho: CAMINHO_DO_WORKFLOW
    })
  }

  /**
   * Commita o que o run produziu — código, workflow e os docs do projeto — e empurra o branch.
   *
   * **Os docs entram aqui, antes do merge** (critério 13): depois do merge só caberia commit
   * direto na branch-base, que a invariante 10 da CONVENTION proíbe.
   */
  private async publicar(
    pedido: PedidoDeEntrega
  ): Promise<
    | { readonly ok: true; readonly pullRequest: number }
    | { readonly ok: false; readonly bloqueio: ResultadoDaEntrega }
  > {
    const { worktreeNoHost } = pedido.sandbox
    const ws = pedido.workspaceId

    // Os documentos do projeto-alvo entram **nomeados**, não só pelo `--all` (critério 13). O
    // `--all` os pegaria por estarem no worktree, mas nomeá-los torna a intenção verificável: um
    // doc que a fatia devia atualizar e não atualizou some do commit sem ninguém notar, e a
    // invariante 10 da CONVENTION viraria acidente de varredura.
    const docs = pedido.docsDoProjeto ?? []
    this.deps.git.run(['add', '--all', ...docs], worktreeNoHost, ws)
    // `--allow-empty` não entra: um run que não mudou nada não deve produzir commit vazio e seguir
    // como se tivesse entregue. O `commit` falha, e o push não acontece.
    this.deps.git.run(
      ['commit', '-m', `${pedido.titulo}\n\nrefs #${pedido.issue}`],
      worktreeNoHost,
      ws
    )

    const token = await this.deps.token(this.deps.userId(), ws)
    const push =
      token === undefined
        ? this.deps.git.push('origin', pedido.alvo.branchDaFatia, worktreeNoHost, ws)
        : this.deps.git.pushComToken(
            `https://github.com/${pedido.alvo.owner}/${pedido.alvo.repo}.git`,
            token,
            pedido.alvo.branchDaFatia,
            worktreeNoHost,
            ws
          )

    if (!push.ok) {
      return {
        ok: false,
        bloqueio: this.bloqueado(
          'externo',
          'Verificar credencial e conectividade, e repetir o push.',
          'O push do branch da fatia falhou.'
        )
      }
    }

    // `refs #N`, nunca `closes`: o merge integra código e não fecha a issue — o aceite é do PI.
    const pr = await this.chamar(GITHUB_OPERATIONS.ensurePullRequest, ws, {
      owner: pedido.alvo.owner,
      repo: pedido.alvo.repo,
      head: pedido.alvo.branchDaFatia,
      base: pedido.alvo.branchBase,
      title: pedido.titulo,
      body: `Entrega automática da fatia.\n\nrefs #${pedido.issue}`
    })

    if (!pr.ok) {
      return {
        ok: false,
        bloqueio: this.bloqueado(
          'externo',
          'Verificar o acesso ao repositório e repetir.',
          'Não foi possível garantir o pull request.'
        )
      }
    }

    const numero = (pr.data as { readonly numero?: number } | undefined)?.numero
    if (typeof numero !== 'number') {
      return {
        ok: false,
        bloqueio: this.bloqueado(
          'externo',
          'Conferir o pull request na origem.',
          'A origem não devolveu o número do pull request.'
        )
      }
    }

    return { ok: true, pullRequest: numero }
  }

  /**
   * Declara o check gerado como obrigatório na proteção da branch-base.
   *
   * Sem isto o gate barraria por ausência de regra (critério 10) e a pipeline não teria como
   * destravar a si mesma — o projeto do MVP-008 nasce sem CI e sem proteção. Contexts que a origem
   * já exija **somam**: a proteção é lida antes e o nome novo é acrescentado, nunca substituído.
   *
   * Falha aqui não bloqueia o run: a M9-F01 já decidiu que proteção recusada pela origem é
   * limitação explícita, não bloqueio. O gate barra depois, com a causa certa.
   */
  private async exigirCheckObrigatorio(pedido: PedidoDeEntrega): Promise<void> {
    const atual = await this.lerRuleset(pedido)
    const contexts = atual.contexts.includes(NOME_DO_JOB_DE_CI)
      ? atual.contexts
      : [...atual.contexts, NOME_DO_JOB_DE_CI]

    if (atual.protegida && atual.contexts.includes(NOME_DO_JOB_DE_CI)) return

    await this.chamar(GITHUB_OPERATIONS.ensureBranchProtection, pedido.workspaceId, {
      owner: pedido.alvo.owner,
      repo: pedido.alvo.repo,
      branch: pedido.alvo.branchBase,
      revisoesExigidas: 0,
      checksExigidos: contexts
    })
  }

  /**
   * Espera os checks e conclui o run.
   *
   * `aguardando` não é falha: o teto de espera termina em `AWAITING_MERGE`, não em `BLOCKED`
   * (decisão do PI, 2026-09-02). Estourar o teto significa CI mais lenta que o esperado, e marcar
   * bloqueio ali ensinaria a ler bloqueio como ruído — além de travar a fila, que é WIP=1 global.
   */
  private async aguardarEConcluir(
    pedido: PedidoDeEntrega,
    pullRequest: number,
    achados: readonly AchadoDeRevisao[]
  ): Promise<ResultadoDaEntrega> {
    const limite = this.agora() + this.tetoDeEsperaMs

    // O head que a pipeline **verificou**: o que estava na origem logo depois do nosso push. É
    // contra ele que o gate compara. Reler os dois lados a cada volta e compará-los entre si
    // tornaria o critério 4 letra morta — dois valores iguais por construção nunca divergem, e um
    // push de terceiro entre a verificação e o merge passaria despercebido.
    let headShaEsperado = await this.headNaOrigem(pedido)

    for (;;) {
      if (pedido.signal?.aborted === true) {
        return this.bloqueado('externo', 'Retomar a entrega.', 'Cancelado pelo usuário.')
      }

      // O snapshot é retirado a cada volta: mudança de ruleset **durante** o run força novo
      // snapshot e reconciliação — o gate nunca compara com uma regra que já não vale (critério 11).
      const snapshot = await this.snapshotDoRuleset(pedido)
      const headShaNaOrigem = await this.headNaOrigem(pedido)
      const checks = await this.checksDoHead(pedido, headShaEsperado)

      const veredicto = avaliarGateDeMerge({
        headShaEsperado,
        headShaNaOrigem,
        checks,
        snapshot,
        achadosAbertos: achados
      })

      const desfecho = await this.aplicarVeredicto(
        pedido,
        pullRequest,
        veredicto,
        headShaEsperado,
        checks.map((check) => ({ nome: check.nome, conclusao: check.conclusao ?? 'pendente' }))
      )
      if (desfecho !== undefined) return desfecho

      // Reconciliação do head: alguém publicou depois da nossa verificação. O run passa a
      // verificar o commit novo — nunca mergeia o antigo, que já não é o head.
      if (veredicto.reason === 'stale') headShaEsperado = headShaNaOrigem

      if (this.agora() >= limite) {
        this.deps.fila.concluir(pedido.projectId, pedido.workspaceId, pedido.runId)
        log.agent.warn('Teto de espera do CI estourado; run termina aguardando merge', {
          runId: pedido.runId,
          pullRequest
        })
        return { estadoFinal: 'AWAITING_MERGE', pullRequest, headSha: headShaEsperado }
      }

      await this.dormir(INTERVALO_DE_CONSULTA_MS)
    }
  }

  /** O que fazer com o veredicto. `undefined` significa "continuar esperando". */
  private async aplicarVeredicto(
    pedido: PedidoDeEntrega,
    pullRequest: number,
    veredicto: VeredictoDoGate,
    headSha: string,
    checks: readonly CheckDoLedger[]
  ): Promise<ResultadoDaEntrega | undefined> {
    if (veredicto.reason === 'aguardando') return undefined

    if (veredicto.reason === 'stale') {
      // Head divergente: os checks aprovaram outro commit. Reconciliar é reler na volta seguinte,
      // não mergear com o que se tinha.
      log.agent.warn('Head do pull request divergiu; reconciliando', { runId: pedido.runId })
      return undefined
    }

    if (veredicto.reason === 'bloqueado-externo') {
      // Merge queue é bloqueio externo que **não** é falha do run: o PR fica verde e o merge é da
      // queue (critério 12). Termina em `AWAITING_MERGE`, como o kill-switch desligado.
      if (veredicto.acao.includes('merge queue')) {
        this.deps.fila.concluir(pedido.projectId, pedido.workspaceId, pedido.runId)
        return { estadoFinal: 'AWAITING_MERGE', pullRequest, headSha, checks }
      }

      return {
        ...this.bloqueado('externo', veredicto.acao, veredicto.mensagem),
        pullRequest,
        headSha,
        checks
      }
    }

    return await this.mergear(pedido, pullRequest, headSha, checks)
  }

  /**
   * Mergeia e **confirma na origem**.
   *
   * O kill-switch desligado para aqui sem mergear: o run termina em `AWAITING_MERGE` com o PR
   * verde, aguardando o PI (critério 8). Não é bloqueio nem falha.
   */
  private async mergear(
    pedido: PedidoDeEntrega,
    pullRequest: number,
    headSha: string,
    checks: readonly CheckDoLedger[]
  ): Promise<ResultadoDaEntrega> {
    if (!this.deps.mergePolicy.autonomoLigado(pedido.projectId)) {
      this.deps.fila.concluir(pedido.projectId, pedido.workspaceId, pedido.runId)
      log.agent.info('Merge autônomo desligado; run termina no PR verde', {
        runId: pedido.runId,
        pullRequest
      })
      return { estadoFinal: 'AWAITING_MERGE', pullRequest, headSha, checks }
    }

    await this.chamar(GITHUB_OPERATIONS.squashMerge, pedido.workspaceId, {
      owner: pedido.alvo.owner,
      repo: pedido.alvo.repo,
      pullRequest,
      expectedHeadSha: headSha
    })

    // **A confirmação é o que decide**, não o código de saída do merge (critério 7). Um 200 sem
    // `merged: true` na origem não é entrega: o run termina aguardando, com a causa registrada.
    const estado = await this.chamar(GITHUB_OPERATIONS.getMergeState, pedido.workspaceId, {
      owner: pedido.alvo.owner,
      repo: pedido.alvo.repo,
      pullRequest
    })

    const confirmado = estado.ok
      ? (estado.data as { readonly merged?: boolean; readonly mergeSha?: string } | undefined)
      : undefined

    if (confirmado?.merged !== true || confirmado.mergeSha === undefined) {
      this.deps.fila.concluir(pedido.projectId, pedido.workspaceId, pedido.runId)
      log.agent.warn('Merge não confirmado na origem; run termina aguardando', {
        runId: pedido.runId,
        pullRequest
      })
      return { estadoFinal: 'AWAITING_MERGE', pullRequest, headSha, checks }
    }

    this.deps.fila.concluir(pedido.projectId, pedido.workspaceId, pedido.runId)
    this.deps.audit.append({
      user_id: this.deps.userId(),
      workspace_id: pedido.workspaceId,
      type: 'pipeline-merge',
      payload: { runId: pedido.runId, pullRequest, mergeSha: confirmado.mergeSha }
    })

    return {
      estadoFinal: 'MERGED',
      pullRequest,
      mergeSha: confirmado.mergeSha,
      headSha,
      checks
    }
  }

  /** Lê a regra da origem e registra o snapshot quando ela mudou (ou quando é o primeiro). */
  private async snapshotDoRuleset(pedido: PedidoDeEntrega): Promise<SnapshotDeRuleset> {
    const observado = await this.lerRuleset(pedido)
    const anterior = this.deps.ruleset.ultimo(this.deps.userId(), pedido.runId)

    if (anterior !== undefined && !rulesetMudou(anterior, observado)) return anterior

    const snapshot: SnapshotDeRuleset = {
      runId: pedido.runId,
      branch: pedido.alvo.branchBase,
      contexts: observado.contexts,
      strict: observado.strict,
      protegida: observado.protegida,
      mergeQueueExigida: observado.mergeQueueExigida,
      ref: `${pedido.alvo.owner}/${pedido.alvo.repo}/protection/${pedido.alvo.branchBase}`,
      observadoEm: new Date(this.agora()).toISOString()
    }

    this.deps.ruleset.registrar(
      {
        userId: this.deps.userId(),
        workspaceId: pedido.workspaceId,
        projectId: pedido.projectId
      },
      snapshot
    )

    if (anterior !== undefined) {
      log.agent.warn('Ruleset da origem mudou durante o run; reconciliando', {
        runId: pedido.runId
      })
    }

    return snapshot
  }

  private async lerRuleset(pedido: PedidoDeEntrega): Promise<{
    readonly contexts: readonly string[]
    readonly strict: boolean
    readonly protegida: boolean
    readonly mergeQueueExigida: boolean
  }> {
    const r = await this.chamar(GITHUB_OPERATIONS.getRequiredChecks, pedido.workspaceId, {
      owner: pedido.alvo.owner,
      repo: pedido.alvo.repo,
      branch: pedido.alvo.branchBase
    })

    const dados = r.ok
      ? (r.data as
          | {
              readonly contexts?: readonly string[]
              readonly strict?: boolean
              readonly protegida?: boolean
              readonly mergeQueueExigida?: boolean
            }
          | undefined)
      : undefined

    // Falha na leitura não vira "sem exigência": sem saber o que a origem exige, o gate barra por
    // ausência de regra — que é o desfecho seguro, e não um verde por omissão.
    return {
      contexts: dados?.contexts ?? [],
      strict: dados?.strict ?? false,
      protegida: dados?.protegida ?? false,
      mergeQueueExigida: dados?.mergeQueueExigida ?? false
    }
  }

  private async headNaOrigem(pedido: PedidoDeEntrega): Promise<string> {
    const r = await this.chamar(GITHUB_OPERATIONS.getCommitSha, pedido.workspaceId, {
      owner: pedido.alvo.owner,
      repo: pedido.alvo.repo,
      ref: pedido.alvo.branchDaFatia
    })

    return r.ok ? ((r.data as { readonly sha?: string } | undefined)?.sha ?? '') : ''
  }

  private async checksDoHead(
    pedido: PedidoDeEntrega,
    sha: string
  ): Promise<readonly CheckNormalizado[]> {
    if (sha === '') return []

    const r = await this.chamar(GITHUB_OPERATIONS.getChecksForHead, pedido.workspaceId, {
      owner: pedido.alvo.owner,
      repo: pedido.alvo.repo,
      sha
    })

    // `checks.for-head` devolve o **array** direto, não um envelope com campo `checks`. Um cast
    // para `{ checks }` compilaria (o `data` é `unknown`) e devolveria lista vazia para sempre —
    // e lista vazia nunca aprova, então o run bloquearia por "ausência de regra" com os checks
    // verdes bem ali. Typecheck não pega isto: quem pega é o teste contra o adapter real.
    if (!r.ok) return []
    return Array.isArray(r.data) ? (r.data as readonly CheckNormalizado[]) : []
  }

  /**
   * Monta o envelope e chama o conector — nunca o adapter direto.
   *
   * É dentro do `call()` que vivem o gate de créditos, a policy `api.external-call` e a auditoria
   * do par antes/depois. Um adapter injetado seria o segundo caminho sem gate.
   */
  private async chamar(
    operation: string,
    workspaceId: WorkspaceId,
    input: Record<string, unknown>
  ): Promise<ConnectorOutcome> {
    const userId = this.deps.userId()

    const request: ConnectorRequest = {
      contractVersion: CONNECTOR_CONTRACT_VERSION,
      connector: 'github',
      operation,
      correlationId: randomUUID(),
      idempotencyKey: randomUUID(),
      timeoutMs: 30_000,
      credential: { key: 'github', user_id: userId, workspace_id: workspaceId },
      input
    }

    return await this.deps.connectors.call(request, { userId, workspace: workspaceId })
  }

  private bloqueado(causa: string, acao: string, mensagem: string): ResultadoDaEntrega {
    return { estadoFinal: 'BLOCKED', bloqueio: { causa, acao, mensagem } }
  }
}
