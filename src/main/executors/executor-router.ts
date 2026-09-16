import { createHash } from 'node:crypto'
import { RECURSO_WIP_GLOBAL, estadoDoLease, type Lease } from '@shared/domain/lease'
import type { EntradaDoDiario } from '@shared/domain/effect-journal'
import type { WorkspaceId } from '@shared/domain/entities'
import { CodingExecutorRuntime } from './coding-executor-runtime'
import type {
  CodingExecutorAdapter,
  ExecutorRequest,
  ExecutorResult,
  ModoDeCobranca
} from './executor'

export type ExecutorDeCodigo = 'claude-code' | 'codex-exec'

export interface PreferenciaDeExecutor {
  readonly taskType: string
  readonly executores: readonly ExecutorDeCodigo[]
}

export interface EstadoDoExecutor {
  readonly executor: ExecutorDeCodigo
  readonly disponivel: boolean
  readonly modoDeCobranca: ModoDeCobranca
  readonly modelo: string
  readonly autenticacao: ExecutorRequest['autenticacao']
  readonly motivoIndisponivel?: string
  /** `false` barra `metered`; assinatura indisponivel nao autoriza custo pago por inferencia. */
  readonly cobrancaAutorizada: boolean
  /** `false` barra executor por policy/contexto/capacidade antes do spawn. */
  readonly elegivel: boolean
  readonly motivoInelegivel?: string
}

export interface SelecaoDeExecutor {
  readonly decisao: 'escolhido' | 'espera' | 'bloqueado'
  readonly executor?: ExecutorDeCodigo
  readonly motivo: string
  readonly excluidos: readonly { readonly executor: ExecutorDeCodigo; readonly motivo: string }[]
}

export interface AchadoDeExecutor {
  readonly severidade: 'P0' | 'P1' | 'P2' | 'P3'
  readonly titulo: string
  readonly evidencia: string
  readonly assinatura: string
  readonly headSha: string
  readonly revisao: string
  readonly estado: 'aberto' | 'resolvido'
}

export interface RevisaoDoExecutor {
  readonly revisor: ExecutorDeCodigo
  readonly modo: 'cruzada' | 'independente'
  readonly headSha: string
  readonly revisao: string
  readonly achados: readonly AchadoDeExecutor[]
}

export interface PedidoRoteado {
  readonly runId: string
  readonly attemptId: string
  readonly chaveIdempotente: string
  readonly taskType: string
  readonly userId: string
  readonly workspaceId: WorkspaceId
  readonly contextPackId: string
  readonly worktree: string
  readonly container?: string
  readonly pathsPermitidos: readonly string[]
  readonly validacoes: readonly (readonly string[])[]
  readonly limiteDeTempoMs: number
  readonly revisoesAprovadas: readonly string[]
  readonly schemaDeSaida?: string
  readonly headSha: string
  readonly revisao: string
}

export interface ResultadoRoteado {
  readonly status: 'concluido' | 'falhou' | 'bloqueado' | 'espera'
  readonly writer?: ExecutorDeCodigo
  readonly resultado?: ExecutorResult
  readonly selecao: SelecaoDeExecutor
  readonly fallback?: {
    readonly de: ExecutorDeCodigo
    readonly para: ExecutorDeCodigo
    readonly motivo: string
  }
  readonly revisao?: RevisaoDoExecutor
  readonly auditoria: readonly string[]
}

export interface ExecutorRouterDeps {
  readonly runtime: CodingExecutorRuntime
  readonly adapters: Readonly<Record<ExecutorDeCodigo, CodingExecutorAdapter>>
  readonly lease: {
    buscar(userId: string, recurso: string): Lease | undefined
    adquirir(
      userId: string,
      dados: {
        readonly proprietario: string
        readonly recurso: string
        readonly projectId?: string
      },
      agora: number
    ): Lease | undefined
  }
  readonly effectJournal: {
    buscarPorChave(userId: string, chaveIdempotente: string): EntradaDoDiario | undefined
  }
  readonly revisar: (pedido: {
    readonly request: ExecutorRequest
    readonly writer: ExecutorDeCodigo
    readonly revisor: ExecutorDeCodigo
    readonly headSha: string
    readonly revisao: string
    readonly falhasAbertas: readonly AchadoDeExecutor[]
  }) => Promise<readonly AchadoDeExecutor[]>
  readonly agora?: () => number
}

export class ExecutorRouter {
  private readonly agora: () => number

  constructor(private readonly deps: ExecutorRouterDeps) {
    this.agora = deps.agora ?? (() => Date.now())
  }

  async executar(
    pedido: PedidoRoteado,
    politica: PreferenciaDeExecutor,
    estados: readonly EstadoDoExecutor[],
    falhasAbertas: readonly AchadoDeExecutor[] = []
  ): Promise<ResultadoRoteado> {
    const selecao = selecionarExecutor(politica, estados)
    const auditoria = [`selecao:${selecao.decisao}:${selecao.motivo}`]

    if (selecao.decisao !== 'escolhido' || selecao.executor === undefined) {
      return {
        status: selecao.decisao === 'bloqueado' ? 'bloqueado' : 'espera',
        selecao,
        auditoria
      }
    }

    const lease = this.garantirWriterLease(pedido)
    if (lease !== undefined) {
      return {
        status: lease.status,
        selecao,
        auditoria: [...auditoria, lease.auditoria]
      }
    }

    const primeiro = await this.executarCom(selecao.executor, pedido, estados, 0)
    auditoria.push(`writer:${selecao.executor}:${primeiro.status}`)

    if (primeiro.status === 'concluido') {
      return await this.comRevisao(pedido, selecao, primeiro, estados, falhasAbertas, auditoria)
    }

    const fallback = selecionarFallback(politica, estados, selecao.executor)
    if (fallback.decisao !== 'escolhido' || fallback.executor === undefined) {
      return {
        status: 'falhou',
        writer: selecao.executor,
        resultado: primeiro,
        selecao,
        auditoria: [...auditoria, `fallback:${fallback.decisao}:${fallback.motivo}`]
      }
    }

    const efeito = this.deps.effectJournal.buscarPorChave(pedido.userId, pedido.chaveIdempotente)
    if (efeito?.estado === 'confirmed') {
      return {
        status: 'bloqueado',
        writer: selecao.executor,
        resultado: primeiro,
        selecao,
        auditoria: [
          ...auditoria,
          `fallback-bloqueado:efeito-confirmado:${efeito.externalRefId ?? efeito.id}`
        ]
      }
    }

    const segundo = await this.executarCom(fallback.executor, pedido, estados, 1, primeiro)
    auditoria.push(`fallback:${selecao.executor}->${fallback.executor}:${segundo.status}`)

    if (segundo.status !== 'concluido') {
      return {
        status: 'falhou',
        writer: fallback.executor,
        resultado: segundo,
        selecao,
        fallback: { de: selecao.executor, para: fallback.executor, motivo: fallback.motivo },
        auditoria
      }
    }

    return await this.comRevisao(pedido, selecao, segundo, estados, falhasAbertas, auditoria, {
      de: selecao.executor,
      para: fallback.executor,
      motivo: fallback.motivo
    })
  }

  private garantirWriterLease(
    pedido: PedidoRoteado
  ): { readonly status: 'bloqueado' | 'espera'; readonly auditoria: string } | undefined {
    const recurso = recursoWriter(pedido.runId)
    const existente = this.deps.lease.buscar(pedido.userId, recurso)
    const estado = estadoDoLease(existente, this.agora())

    if (estado === 'vigente' && existente?.proprietario !== pedido.runId) {
      return { status: 'espera', auditoria: `writer-lease:ocupado:${existente?.proprietario}` }
    }
    if (estado === 'expirado') {
      return { status: 'bloqueado', auditoria: 'writer-lease:expirado-requer-reconciliacao' }
    }
    if (estado === 'vigente') return undefined

    const adquirido = this.deps.lease.adquirir(
      pedido.userId,
      { proprietario: pedido.runId, recurso },
      this.agora()
    )
    return adquirido === undefined
      ? { status: 'espera', auditoria: 'writer-lease:ocupado' }
      : undefined
  }

  private async executarCom(
    executor: ExecutorDeCodigo,
    pedido: PedidoRoteado,
    estados: readonly EstadoDoExecutor[],
    indice: number,
    anterior?: ExecutorResult
  ): Promise<ExecutorResult> {
    const estado = estadoObrigatorio(estados, executor)
    const request: ExecutorRequest = {
      runId: pedido.runId,
      attemptId: `${pedido.attemptId}-${indice + 1}`,
      chaveIdempotente: `${pedido.chaveIdempotente}:${executor}`,
      executor,
      modelo: estado.modelo,
      modoDeCobranca: estado.modoDeCobranca,
      revisoesAprovadas: pedido.revisoesAprovadas,
      contextPackId: pedido.contextPackId,
      worktree: pedido.worktree,
      ...(pedido.container === undefined ? {} : { container: pedido.container }),
      pathsPermitidos: pedido.pathsPermitidos,
      validacoes: pedido.validacoes,
      limiteDeTempoMs: pedido.limiteDeTempoMs,
      ...(pedido.schemaDeSaida === undefined ? {} : { schemaDeSaida: pedido.schemaDeSaida }),
      autenticacao: estado.autenticacao,
      ...(anterior?.sessaoRetomavel === undefined
        ? {}
        : { sessaoAnterior: anterior.sessaoRetomavel })
    }

    return await this.deps.runtime.executar(request, this.deps.adapters[executor])
  }

  private async comRevisao(
    pedido: PedidoRoteado,
    selecao: SelecaoDeExecutor,
    resultado: ExecutorResult,
    estados: readonly EstadoDoExecutor[],
    falhasAbertas: readonly AchadoDeExecutor[],
    auditoria: readonly string[],
    fallback?: ResultadoRoteado['fallback']
  ): Promise<ResultadoRoteado> {
    const writer = fallback?.para ?? selecao.executor
    if (writer === undefined) {
      return {
        status: 'bloqueado',
        resultado,
        selecao,
        auditoria: [...auditoria, 'writer-ausente']
      }
    }

    const revisao = await this.revisar(pedido, writer, estados, falhasAbertas)
    return {
      status: 'concluido',
      writer,
      resultado,
      selecao,
      ...(fallback === undefined ? {} : { fallback }),
      revisao,
      auditoria: [...auditoria, `revisor:${revisao.revisor}:${revisao.modo}`]
    }
  }

  private async revisar(
    pedido: PedidoRoteado,
    writer: ExecutorDeCodigo,
    estados: readonly EstadoDoExecutor[],
    falhasAbertas: readonly AchadoDeExecutor[]
  ): Promise<RevisaoDoExecutor> {
    const revisor = escolherRevisor(writer, estados)
    const estado = estadoObrigatorio(estados, revisor.executor)
    const request: ExecutorRequest = {
      runId: pedido.runId,
      attemptId: `${pedido.attemptId}-review`,
      chaveIdempotente: `${pedido.chaveIdempotente}:review:${pedido.headSha}:${pedido.revisao}`,
      executor: revisor.executor,
      modelo: estado.modelo,
      modoDeCobranca: estado.modoDeCobranca,
      revisoesAprovadas: pedido.revisoesAprovadas,
      contextPackId: pedido.contextPackId,
      worktree: pedido.worktree,
      ...(pedido.container === undefined ? {} : { container: pedido.container }),
      pathsPermitidos: pedido.pathsPermitidos,
      validacoes: pedido.validacoes,
      limiteDeTempoMs: pedido.limiteDeTempoMs,
      autenticacao: estado.autenticacao
    }

    const achados = await this.deps.revisar({
      request,
      writer,
      revisor: revisor.executor,
      headSha: pedido.headSha,
      revisao: pedido.revisao,
      falhasAbertas: falhasAbertas.filter((a) => a.estado === 'aberto')
    })

    return {
      revisor: revisor.executor,
      modo: revisor.modo,
      headSha: pedido.headSha,
      revisao: pedido.revisao,
      achados: deduplicarAchados(achados, falhasAbertas)
    }
  }
}

export function selecionarExecutor(
  politica: PreferenciaDeExecutor,
  estados: readonly EstadoDoExecutor[]
): SelecaoDeExecutor {
  const excluidos: { executor: ExecutorDeCodigo; motivo: string }[] = []

  for (const executor of politica.executores) {
    const estado = estados.find((e) => e.executor === executor)
    if (estado === undefined) {
      excluidos.push({ executor, motivo: 'sem-estado' })
      continue
    }
    const motivo = motivoDeExclusao(estado)
    if (motivo !== undefined) {
      excluidos.push({ executor, motivo })
      continue
    }
    return {
      decisao: 'escolhido',
      executor,
      motivo: excluidos.length === 0 ? 'preferido' : 'fallback',
      excluidos
    }
  }

  const temBloqueioPago = excluidos.some((e) => e.motivo === 'cobranca-nao-autorizada')
  return {
    decisao: temBloqueioPago ? 'bloqueado' : 'espera',
    motivo: temBloqueioPago ? 'rota-paga-nao-autorizada' : 'nenhum-executor-disponivel',
    excluidos
  }
}

function selecionarFallback(
  politica: PreferenciaDeExecutor,
  estados: readonly EstadoDoExecutor[],
  escritorFalho: ExecutorDeCodigo
): SelecaoDeExecutor {
  return selecionarExecutor(
    { ...politica, executores: politica.executores.filter((e) => e !== escritorFalho) },
    estados
  )
}

function motivoDeExclusao(estado: EstadoDoExecutor): string | undefined {
  if (!estado.elegivel) return estado.motivoInelegivel ?? 'inelegivel'
  if (!estado.disponivel) return estado.motivoIndisponivel ?? 'indisponivel'
  if (!estado.cobrancaAutorizada && estado.modoDeCobranca === 'metered') {
    return 'cobranca-nao-autorizada'
  }
  return undefined
}

function escolherRevisor(
  writer: ExecutorDeCodigo,
  estados: readonly EstadoDoExecutor[]
): { readonly executor: ExecutorDeCodigo; readonly modo: 'cruzada' | 'independente' } {
  const cruzado = estados.find((e) => e.executor !== writer && motivoDeExclusao(e) === undefined)
  if (cruzado !== undefined) return { executor: cruzado.executor, modo: 'cruzada' }
  return { executor: writer, modo: 'independente' }
}

function estadoObrigatorio(
  estados: readonly EstadoDoExecutor[],
  executor: ExecutorDeCodigo
): EstadoDoExecutor {
  const estado = estados.find((e) => e.executor === executor)
  if (estado === undefined) throw new Error(`Executor sem estado: ${executor}`)
  return estado
}

function deduplicarAchados(
  novos: readonly AchadoDeExecutor[],
  anteriores: readonly AchadoDeExecutor[]
): readonly AchadoDeExecutor[] {
  const resolvidos = new Set(
    anteriores.filter((a) => a.estado === 'resolvido').map((a) => chaveDoAchado(a))
  )
  const abertos = new Set(
    anteriores.filter((a) => a.estado === 'aberto').map((a) => chaveDoAchado(a))
  )
  const vistos = new Set<string>()
  const dedup: AchadoDeExecutor[] = []

  for (const achado of novos) {
    const chave = chaveDoAchado(achado)
    if (vistos.has(chave) || abertos.has(chave) || resolvidos.has(chave)) continue
    vistos.add(chave)
    dedup.push(achado)
  }

  return dedup
}

function chaveDoAchado(achado: AchadoDeExecutor): string {
  return createHash('sha256')
    .update(`${achado.assinatura}:${achado.headSha}:${achado.revisao}:${achado.evidencia}`)
    .digest('hex')
}

function recursoWriter(runId: string): string {
  return `${RECURSO_WIP_GLOBAL}:writer:${runId}`
}
