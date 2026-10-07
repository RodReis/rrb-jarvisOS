/**
 * O encadeador de produção de um run (SPEC-Scheduler-05, PR-B).
 *
 * A pergunta que este serviço responde: **dado um run pronto, como ele atravessa slot, preflight,
 * construção, CI e merge — sem dono órfão e sem tocar no run do vizinho?**
 *
 * É a costura que as F01–F04 deixaram para a F05: o pool decide quem tem a vez, o preflight monta
 * o sandbox, o `EntregaService` entrega. Aqui ficam só as três coisas que nenhum deles faz sozinho:
 *
 *  - **o heartbeat do slot, do início ao fim** — da aquisição até o desfecho, inclusive esperando o
 *    CI, quando o run nem container tem. É o que permite à varredura periódica tratar lease vencido
 *    como run perdido (`renovacaoGarantida`). Perder o lease aborta o run: sem dono, ninguém escreve;
 *  - **o contexto por run no proxy** — cada run chama o modelo pela própria unidade
 *    (`/u/<chave>`), com o próprio run, tentativa e ContextPack; o contexto global serve a um run só;
 *  - **o registro de quem está em voo**, para `interromper(runId)` abortar a entrega daquele run e
 *    só dele (cancelamento seletivo).
 *
 * **O paralelismo continua desligado por padrão** (`pool.configurar`): com a capacidade em 1, o
 * segundo run espera o slot e roda depois. Este serviço não decide capacidade.
 *
 * **Não tem chamador de produção ainda**: o gatilho "iniciar run" é do quadro do MVP-028. Hoje é
 * acionado por teste e pelo E2E da F05.
 */

import type { ComandosDeValidacao } from '@shared/domain/ci-workflow'
import type { PerfilDeCi } from '@shared/domain/ci-profile'
import type { WorkspaceId } from '@shared/domain/entities'
import { VALIDADE_DO_LEASE_MS } from '@shared/domain/lease'
import { ehTerminal } from '@shared/domain/pipeline'
import type { PathsPermitidos, PreflightOutcome } from '@shared/domain/preflight'
import { log } from '../logging/logger'
import type { AlvoDaEntrega, EntregaService, ResultadoDaEntrega } from './entrega-service'
import type { ExecutorProxy } from './executor-proxy'
import type { FilaService } from './fila-service'
import type { PipelineRepository } from './pipeline-repository'
import type { PosseDoPerfilCodex } from './posse-do-perfil-codex'
import type { PreflightService } from './preflight-service'
import type { GerenteDeSlots } from '../squads/squad-slots'

/**
 * O intervalo entre batidas: um terço da validade do lease. Duas batidas podem falhar seguidas
 * (GC, disco lento) e o lease ainda vive — a mesma folga que o escritor do Squad usa.
 */
export const INTERVALO_DO_HEARTBEAT_MS = VALIDADE_DO_LEASE_MS / 3

/** Quantos elos de `continuaDe` contam como tentativas: um teto contra uma cadeia corrompida. */
const MAXIMO_DE_ELOS = 50

export interface PedidoDeExecucao {
  readonly runId: string
  /** O espaço do run: o run não o guarda, e ele é a credencial e o escopo de auditoria. */
  readonly workspaceId: WorkspaceId
  /** A raiz operacional validada: onde o worktree pode nascer. Nunca o checkout ativo. */
  readonly raizOperacional: string
  /** O repositório do projeto-alvo, no host. */
  readonly repositorio: string
  /** A branch base de onde o run parte. */
  readonly base: string
  readonly pathsDaSpec?: PathsPermitidos
  readonly portasDeServico?: readonly number[]
  /** A branch da fatia **não** entra: é a que o preflight cria, e a entrega publica essa. */
  readonly alvo: Omit<AlvoDaEntrega, 'branchDaFatia'>
  readonly issue: number
  readonly titulo: string
  readonly promptInicial: string
  /**
   * O manifesto que autoriza o executor a chamar o modelo. **Obrigatório**: a chamada do run vai
   * pela unidade do proxy, que não existe sem ContextPack — um run sem ele nunca poderia construir.
   */
  readonly contextPackId: string
  readonly comandosDeValidacao: ComandosDeValidacao
  readonly perfilDeCi?: PerfilDeCi
  readonly docsDoProjeto?: readonly string[]
  readonly imagemDoSandbox?: import('../squads/squad-imagem').ImagemDoSquad
}

export type ResultadoDaExecucao =
  /** O run não chegou a ter slot: cancelado na espera, ou a fila não o conhece. Nada foi montado. */
  | { readonly tipo: 'sem-slot'; readonly motivo: 'cancelada' | 'indisponivel' }
  /** O preflight recusou; o run foi a `BLOCKED` com a ação de retomada. */
  | { readonly tipo: 'preflight-recusado'; readonly outcome: PreflightOutcome }
  | { readonly tipo: 'entrega'; readonly resultado: ResultadoDaEntrega }

export interface EncadeadorDeps {
  readonly slots: Pick<GerenteDeSlots, 'adquirirRun'>
  readonly fila: Pick<FilaService, 'renovarSlot' | 'transicionar'>
  readonly runs: Pick<PipelineRepository, 'buscar' | 'workspaceDoRun'>
  readonly preflight: Pick<PreflightService, 'preparar' | 'bloqueioDe'>
  readonly entrega: Pick<EntregaService, 'entregar'>
  readonly proxy: Pick<ExecutorProxy, 'registrarUnidade' | 'liberarUnidade' | 'url'>
  /**
   * A posse do perfil do Codex (decisão do PI, 2026-10-05). Quem roda o Codex a pede por conta
   * própria; aqui o encadeador só a **mantém viva** (a mesma batida do slot) e a **devolve** ao
   * fim do run, em qualquer desfecho — cancelar, falhar ou terminar não prende o perfil.
   */
  readonly perfilCodex?: Pick<PosseDoPerfilCodex, 'renovar' | 'liberar'>
  /** Ausente = `INTERVALO_DO_HEARTBEAT_MS`. Existe para o teste não esperar segundos. */
  readonly intervaloDoHeartbeatMs?: number
}

interface EmVoo {
  readonly controle: AbortController
  motivo?: 'interrompido' | 'lease-perdido'
}

export class EncadeadorDeRuns {
  private readonly emVoo = new Map<string, EmVoo>()
  /** O write set que cada run em voo declarou (os paths da SPEC): a fonte da prova de independência. */
  private readonly writeSets = new Map<string, readonly string[]>()

  constructor(private readonly deps: EncadeadorDeps) {}

  /**
   * O write set previsto de um run em voo, ou `undefined` se ele não declarou paths. É a **fonte**
   * que a `IndependenciaService` consulta: sem resposta a prova é incompleta e o run segue em
   * sequência (regra 1) — por isso declarar paths é o que permite o paralelismo, nunca o contrário.
   */
  writeSetPrevisto(runId: string): readonly string[] | undefined {
    return this.writeSets.get(runId)
  }

  /** Há entrega deste run em andamento neste processo? */
  estaEmVoo(runId: string): boolean {
    return this.emVoo.has(runId)
  }

  /**
   * Aborta a entrega **deste** run: a espera pelo slot, a construção e a espera do CI. Idempotente,
   * e `false` quando o run não está em voo aqui. Não muda o estado do run — quem o cancela é a fila.
   */
  interromper(runId: string): boolean {
    const voo = this.emVoo.get(runId)
    if (voo === undefined) return false
    voo.motivo ??= 'interrompido'
    voo.controle.abort()
    return true
  }

  async executar(pedido: PedidoDeExecucao): Promise<ResultadoDaExecucao> {
    if (this.emVoo.has(pedido.runId)) return { tipo: 'sem-slot', motivo: 'indisponivel' }

    const voo: EmVoo = { controle: new AbortController() }
    this.emVoo.set(pedido.runId, voo)

    let batida: ReturnType<typeof setInterval> | undefined
    let chave: string | undefined
    let fencingToken: number | undefined

    try {
      const run = this.deps.runs.buscar(pedido.runId)
      // O espaço é do **run**, e o chamador só o confirma: ele vira credencial do GitHub, custo e
      // auditoria. Run de outro espaço responde como inexistente, sem dizer que existe. Só `READY`
      // entra: qualquer outro estado não passa pelo gate da fila e esperaria para sempre.
      if (
        run === undefined ||
        run.estado !== 'READY' ||
        this.deps.runs.workspaceDoRun(pedido.runId) !== pedido.workspaceId
      ) {
        return { tipo: 'sem-slot', motivo: 'indisponivel' }
      }

      // Declarado **antes** de pedir o slot: é no ciclo do pool, dentro do pedido, que a prova de
      // independência pergunta o que este run vai escrever.
      if (pedido.pathsDaSpec !== undefined)
        this.writeSets.set(pedido.runId, pedido.pathsDaSpec.paths)

      const slot = await this.deps.slots.adquirirRun({
        projectId: run.projectId,
        workspaceId: pedido.workspaceId,
        runId: pedido.runId,
        signal: voo.controle.signal
      })
      if (!slot.ok) return { tipo: 'sem-slot', motivo: slot.motivo }
      fencingToken = slot.fencingToken
      // Interrompido entre a aquisição e o sandbox: nada é montado. O run (se ainda ativo) vai a
      // `BLOCKED` com o token, e a recuperação devolve o slot.
      if (voo.controle.signal.aborted) {
        this.bloquearPorFalha(pedido, fencingToken, 'interrompido')
        return { tipo: 'sem-slot', motivo: 'cancelada' }
      }

      // Da aquisição ao desfecho: o preflight também é run vivo, e o CI de meia hora também.
      batida = this.iniciarBatida(pedido.runId, slot.fencingToken, voo)

      const tentativa = this.tentativaDe(pedido.runId)
      const unidade = this.deps.proxy.registrarUnidade({
        workspaceId: pedido.workspaceId,
        runId: pedido.runId,
        tentativa,
        contextPackId: pedido.contextPackId
      })
      chave = unidade.chave

      const outcome = this.deps.preflight.preparar({
        runId: pedido.runId,
        projectId: run.projectId,
        sliceId: run.sliceId,
        raizOperacional: pedido.raizOperacional,
        repositorio: pedido.repositorio,
        base: pedido.base,
        ...(pedido.pathsDaSpec === undefined ? {} : { pathsDaSpec: pedido.pathsDaSpec }),
        ...(pedido.imagemDoSandbox === undefined ? {} : { imagemDoSandbox: pedido.imagemDoSandbox }),
        ...(pedido.portasDeServico === undefined
          ? {}
          : { portasDeServico: pedido.portasDeServico }),
        proxyUrl: this.deps.proxy.url(),
        tentativa,
        caminhoDoProxy: unidade.caminho
      })

      if (outcome.reason !== 'liberado' || outcome.sandbox === undefined) {
        this.deps.fila.transicionar(
          run.projectId,
          pedido.workspaceId,
          pedido.runId,
          'BLOCKED',
          this.deps.preflight.bloqueioDe(outcome, 0),
          slot.fencingToken
        )
        return { tipo: 'preflight-recusado', outcome }
      }

      const resultado = await this.deps.entrega.entregar({
        runId: pedido.runId,
        projectId: run.projectId,
        workspaceId: pedido.workspaceId,
        sandbox: outcome.sandbox,
        alvo: { ...pedido.alvo, branchDaFatia: outcome.sandbox.branch },
        issue: pedido.issue,
        titulo: pedido.titulo,
        promptInicial: pedido.promptInicial,
        contextPackId: pedido.contextPackId,
        comandosDeValidacao: pedido.comandosDeValidacao,
        ...(pedido.perfilDeCi === undefined ? {} : { perfilDeCi: pedido.perfilDeCi }),
        ...(pedido.docsDoProjeto === undefined ? {} : { docsDoProjeto: pedido.docsDoProjeto }),
        signal: voo.controle.signal,
        fencingToken: slot.fencingToken
      })
      this.garantirQueONaoFiqueAtivo(pedido, run.projectId, slot.fencingToken, resultado)
      return { tipo: 'entrega', resultado }
    } catch (erro) {
      // Falha inesperada no meio: o run não pode ficar `RUNNING` sem dono. Bloqueia com o token e
      // deixa a causa à vista; a recuperação devolve o slot depois de provar o executor morto.
      this.bloquearPorFalha(pedido, fencingToken, erro)
      throw erro
    } finally {
      if (batida !== undefined) clearInterval(batida)
      this.liberarPerfilCodex(pedido.runId)
      if (chave !== undefined) this.deps.proxy.liberarUnidade(chave)
      this.emVoo.delete(pedido.runId)
      this.writeSets.delete(pedido.runId)
    }
  }

  /**
   * A entrega devolve `BLOCKED` em alguns caminhos sem mexer no run (perfil de CI inválido, push ou
   * PR que falham, sinal abortado): o run ficaria ativo, sem dono e segurando o slot até a
   * supervisão o bloquear como "executor perdido" — com a causa real sobrescrita. Aqui o run vai a
   * `BLOCKED` com a causa que a entrega deu. Run já terminal (cancelado, ou bloqueado pela
   * construção) não é tocado: a fila recusaria, e o terminal que ele tem já é o estado seguro.
   */
  private garantirQueONaoFiqueAtivo(
    pedido: PedidoDeExecucao,
    projectId: string,
    fencingToken: number,
    resultado: ResultadoDaEntrega
  ): void {
    if (resultado.estadoFinal !== 'BLOCKED') return
    const atual = this.deps.runs.buscar(pedido.runId)
    if (atual === undefined || ehTerminal(atual.estado)) return
    const bloqueio = resultado.bloqueio
    this.deps.fila.transicionar(
      projectId,
      pedido.workspaceId,
      pedido.runId,
      'BLOCKED',
      {
        causa: bloqueio?.causa ?? 'externo',
        evidencia: bloqueio?.mensagem ?? 'A entrega terminou bloqueada sem informar a causa.',
        tentativas: 0,
        porQueNaoSeguir:
          bloqueio?.mensagem ?? 'A entrega não chegou ao merge; seguir exigiria refazê-la.',
        retomada: bloqueio?.acao ?? 'Ver o log do app e retomar a fatia.'
      },
      fencingToken
    )
  }

  /**
   * Renova o slot enquanto o run existir. **Perder o lease é perder o direito de escrever**: a
   * entrega é abortada, e nenhum passo seguinte avança o run. Não conseguir nem perguntar (banco
   * indisponível) vale o mesmo — um `throw` dentro do intervalo seria exceção não tratada no
   * processo principal, com o run seguindo sem dono.
   */
  private iniciarBatida(
    runId: string,
    fencingToken: number,
    voo: EmVoo
  ): ReturnType<typeof setInterval> {
    // `false` é definitivo (o token não confere: o slot é de outro); uma exceção (banco ocupado) é
    // tolerada uma vez — duas batidas seguidas ainda cabem na validade do lease.
    let excecoesSeguidas = 0
    const batida = setInterval(() => {
      let renovou = false
      try {
        renovou = this.deps.fila.renovarSlot(runId, fencingToken)
        excecoesSeguidas = 0
      } catch {
        excecoesSeguidas += 1
        if (excecoesSeguidas < 2) return
      }
      if (renovou) {
        this.renovarPerfilCodex(runId)
        return
      }
      voo.motivo ??= 'lease-perdido'
      log.agent.warn('O slot do run não pôde ser renovado: a entrega é abortada', { runId })
      voo.controle.abort()
    }, this.deps.intervaloDoHeartbeatMs ?? INTERVALO_DO_HEARTBEAT_MS)
    // O heartbeat nunca segura o processo vivo: o app que fecha leva o intervalo junto.
    batida.unref()
    return batida
  }

  /** Mantém a posse do perfil do Codex (se este run a tem) a cada batida. Nunca derruba a batida. */
  private renovarPerfilCodex(runId: string): void {
    try {
      this.deps.perfilCodex?.renovar(runId)
    } catch {
      // A próxima batida tenta de novo; a posse só vence se várias seguidas falharem.
    }
  }

  /** Devolve a posse do perfil. Idempotente, e nunca lança: o run já terminou. */
  private liberarPerfilCodex(runId: string): void {
    // Uma segunda tentativa: banco ocupado por um instante não pode prender o perfil. Se as duas
    // falharem, o supervisor recolhe a posse órfã na volta seguinte (`recolherOrfa`).
    for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
      try {
        this.deps.perfilCodex?.liberar(runId)
        return
      } catch (erro) {
        if (tentativa === 2) {
          log.agent.warn('A posse do perfil do Codex não pôde ser devolvida', {
            runId,
            erro: erro instanceof Error ? erro.name : 'desconhecido'
          })
        }
      }
    }
  }

  /**
   * A tentativa deste run: um mais os runs de que ele é continuação. É o que dá branch própria a
   * cada retomada da mesma fatia (SPEC-Scheduler-03) — o primeiro run é a tentativa 1.
   */
  private tentativaDe(runId: string): number {
    let tentativa = 1
    let atual = this.deps.runs.buscar(runId)
    while (atual?.continuaDe !== undefined && tentativa < MAXIMO_DE_ELOS) {
      tentativa += 1
      atual = this.deps.runs.buscar(atual.continuaDe)
    }
    return tentativa
  }

  private bloquearPorFalha(
    pedido: PedidoDeExecucao,
    fencingToken: number | undefined,
    erro: unknown
  ): void {
    const evidencia =
      erro === 'interrompido'
        ? 'A execução foi interrompida antes de o sandbox subir.'
        : `A execução falhou de forma inesperada: ${erro instanceof Error ? erro.name : 'erro desconhecido'}.`
    const run = this.deps.runs.buscar(pedido.runId)
    if (run === undefined || fencingToken === undefined) return
    try {
      this.deps.fila.transicionar(
        run.projectId,
        pedido.workspaceId,
        pedido.runId,
        'BLOCKED',
        {
          causa: 'externo',
          evidencia,
          tentativas: 0,
          porQueNaoSeguir:
            'O encadeador perdeu o controle do run no meio do caminho; seguir às cegas poderia duplicar efeitos.',
          retomada: 'Ver o log do app, corrigir a causa e retomar a fatia.'
        },
        fencingToken
      )
    } catch {
      // O run já pode estar terminal (cancelado, ou bloqueado pelo construtor): nada a fazer.
    }
  }
}
