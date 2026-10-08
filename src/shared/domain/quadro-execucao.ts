import type { DependenciaAberta } from './fila'
import type { EstadoDoRun, PipelineRun } from './pipeline'
import type { AlvoDeCancelamentoEmCascata, Mvp, Slice } from './roadmap'

export const COLUNAS_DO_QUADRO = [
  'a-fazer',
  'developer',
  'teste',
  'reviewer',
  'pr-merge',
  'done',
  'finalizado'
] as const

export type ColunaDoQuadro = (typeof COLUNAS_DO_QUADRO)[number]

export interface PedidoDePlay {
  readonly projectId: string
  readonly sliceIds: readonly string[]
  /** Chave estável opcional para que o dispatcher retome sem criar um segundo run. */
  readonly dispatchKey?: string
}

export interface ResultadoDoPlay {
  readonly sliceId: string
  readonly runId?: string
  readonly estado: 'iniciado' | 'bloqueado' | 'recusado'
  readonly mensagem: string
}

export type ResultadoDoCancelamentoNoQuadro =
  | { readonly cancelado: true; readonly fase: string; readonly rascunho: string }
  | { readonly cancelado: false; readonly motivo: string; readonly mensagem: string }

export interface PreviaDeCancelamentoEmCascata {
  readonly ok: true
  readonly fingerprint: string
  readonly alvo: AlvoDeCancelamentoEmCascata
  readonly fatias: readonly {
    readonly sliceId: string
    readonly mvpId: string
    readonly numeroDoMvp: number
    readonly numeroDaFatia: number
    readonly titulo: string
  }[]
  readonly runs: readonly {
    readonly runId: string
    readonly sliceId: string
    readonly estado: EstadoDoRun
  }[]
}

export type RespostaDaPreviaDeCancelamentoEmCascata =
  PreviaDeCancelamentoEmCascata | { readonly ok: false; readonly mensagem: string }

export type ResultadoDoCancelamentoEmCascata =
  | {
      readonly status: 'completed'
      readonly resultados: readonly {
        readonly runId: string
        readonly sliceId: string
        readonly resultado: ResultadoDoCancelamentoNoQuadro
      }[]
    }
  | { readonly status: 'stale'; readonly previa: PreviaDeCancelamentoEmCascata }
  | { readonly status: 'invalid'; readonly mensagem: string }

export const ESTADOS_DA_CONSULTA = ['nao-consultado', 'atualizado', 'desconhecido'] as const
export type EstadoDaConsulta = (typeof ESTADOS_DA_CONSULTA)[number]

export interface ConsultaDeChecks {
  readonly estado: EstadoDaConsulta
  readonly consultadoEm?: string
  readonly desconhecidoDesde?: string
  readonly checksPendentes: readonly string[]
  readonly checks: readonly {
    readonly nome: string
    readonly status: 'queued' | 'in_progress' | 'completed'
    readonly conclusao?: string
  }[]
  readonly erro?: string
}

export interface CartaoDoQuadro {
  readonly sliceId: string
  readonly mvpId: string
  readonly numeroDoMvp: number
  readonly numeroDaFatia: number
  readonly titulo: string
  readonly specExecutavel: boolean
  readonly issue?: number
  readonly issueUrl?: string
  readonly coluna: ColunaDoQuadro
  readonly run?: PipelineRun
  readonly equipe?: EquipeDoQuadro
  readonly dependenciasAbertas: readonly DependenciaAberta[]
  readonly consulta: ConsultaDeChecks
  readonly aprovacaoPendente?: {
    readonly id: string
    readonly acao: string
    readonly motivo: string
  }
}

export interface EquipeDoQuadro {
  readonly objetivo: string
  readonly escritores: number
  readonly membros: readonly {
    readonly papel: string
    readonly provider: string
    readonly modelo: string
  }[]
  readonly workflow: readonly string[]
  readonly limiteCusto: { readonly usd: number; readonly medido: boolean }
  readonly consumo?: {
    readonly chamadas: number
    readonly tokensEntrada: number
    readonly tokensSaida: number
    readonly turnos: number
    readonly duracaoMs: number
    readonly usd: number
    readonly pendentes: number
    readonly falhasDeTeto: number
  }
  readonly progresso: NonNullable<PipelineRun['squadProgress']>
}

export interface ColunaDoQuadroDeExecucao {
  readonly id: ColunaDoQuadro
  readonly titulo: string
  readonly cartoes: readonly CartaoDoQuadro[]
}

export interface QuadroDeExecucao {
  readonly projectId: string
  readonly colunas: readonly ColunaDoQuadroDeExecucao[]
  readonly geradoEm: string
}

export const TITULOS_DAS_COLUNAS: Readonly<Record<ColunaDoQuadro, string>> = {
  'a-fazer': 'A fazer',
  developer: 'DEVELOPER',
  teste: 'TESTE',
  reviewer: 'REVIEWER',
  'pr-merge': 'PR/MERGE',
  done: 'DONE',
  finalizado: 'Finalizado (PI)'
}

function objeto(valor: unknown): Record<string, unknown> | undefined {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : undefined
}

function membroDoSnapshot(
  papel: string,
  camada: unknown,
  resolucao: unknown
): { readonly papel: string; readonly provider: string; readonly modelo: string } | undefined {
  if (typeof camada !== 'string') return undefined
  const resolvida = objeto(objeto(resolucao)?.[camada])
  const modelo = objeto(resolvida?.modelo)
  if (typeof modelo?.provider !== 'string' || typeof modelo.modelo !== 'string') return undefined
  return { papel, provider: modelo.provider, modelo: modelo.modelo }
}

function equipeDoRun(titulo: string, run: PipelineRun | undefined): EquipeDoQuadro | undefined {
  if (run?.squadSnapshot === undefined) return undefined
  const snapshot = objeto(run.squadSnapshot)
  const perfil = objeto(snapshot?.perfil)
  const resolucao = objeto(snapshot?.resolucao)?.camadas
  const revisor = objeto(perfil?.revisor)?.camada
  const membros = [
    membroDoSnapshot('Orquestrador', 'orquestrador', resolucao),
    membroDoSnapshot('Executor', 'executor', resolucao),
    membroDoSnapshot('Reviewer', revisor, resolucao)
  ].filter((membro): membro is NonNullable<typeof membro> => membro !== undefined)
  const escritores = perfil?.escritores
  if (typeof escritores !== 'number' || membros.length === 0) return undefined
  return {
    objetivo: titulo,
    escritores,
    membros,
    workflow: ['DEVELOPER', 'TESTE', 'REVIEWER', 'PR/MERGE', 'DONE', 'Finalizado (PI)'],
    limiteCusto: {
      usd: run.squadCostLimitUsd ?? 0,
      medido: run.squadCostMeasured ?? false
    },
    ...(run.squadBudgetUsage === undefined ? {} : { consumo: run.squadBudgetUsage }),
    progresso: run.squadProgress ?? []
  }
}

/** A coluna deriva apenas do estado persistido do run. Um run ausente permanece em A fazer. */
export function colunaDoRun(estado: EstadoDoRun | undefined): ColunaDoQuadro {
  switch (estado) {
    case 'RUNNING':
      return 'developer'
    case 'VALIDATING':
      return 'teste'
    case 'REVIEWING':
      return 'reviewer'
    case 'PR_CI':
    case 'AWAITING_MERGE':
      return 'pr-merge'
    case 'MERGED':
      return 'done'
    case 'PLANNED':
    case 'AWAITING_PI':
    case 'READY':
    case 'BLOCKED':
    case 'CANCELLED':
    case undefined:
      return 'a-fazer'
  }
}

export interface EntradaDoQuadro {
  readonly projectId: string
  readonly mvps: readonly Mvp[]
  readonly slices: readonly Slice[]
  readonly runs: readonly PipelineRun[]
  readonly concluidas: readonly string[]
  readonly bloqueadas: readonly {
    readonly sliceId: string
    readonly abertas: readonly DependenciaAberta[]
  }[]
  readonly issues?: ReadonlyMap<string, { readonly numero: number; readonly url?: string }>
  readonly consultas?: ReadonlyMap<string, ConsultaDeChecks>
  readonly finalizadas?: ReadonlySet<string>
  readonly aprovacoesPendentes?: ReadonlyMap<string, CartaoDoQuadro['aprovacaoPendente']>
  readonly agora?: string
}

/** Projeta dados persistidos numa vista ordenada, sem derivar progresso de eventos transitórios. */
export function projetarQuadro(entrada: EntradaDoQuadro): QuadroDeExecucao {
  const mvps = new Map(entrada.mvps.map((mvp) => [mvp.id, mvp]))
  const runsPorFatia = new Map<string, PipelineRun[]>()
  for (const run of entrada.runs) {
    const lista = runsPorFatia.get(run.sliceId) ?? []
    lista.push(run)
    runsPorFatia.set(run.sliceId, lista)
  }

  const concluidas = new Set(entrada.concluidas)
  const finalizadas = entrada.finalizadas ?? new Set<string>()
  const bloqueadas = new Map(entrada.bloqueadas.map((item) => [item.sliceId, item.abertas]))
  const cartoes = entrada.slices.flatMap((slice) => {
    const mvp = mvps.get(slice.mvpId)
    if (mvp === undefined || mvp.estado === 'proposto') return []

    const runs = (runsPorFatia.get(slice.id) ?? []).sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    )
    const run = runs[0]
    const coluna = finalizadas.has(slice.id)
      ? 'finalizado'
      : concluidas.has(slice.id)
        ? 'done'
        : colunaDoRun(run?.estado)
    const issue = entrada.issues?.get(slice.id)
    const equipe = equipeDoRun(slice.titulo, run)

    const cartao: CartaoDoQuadro = {
      sliceId: slice.id,
      mvpId: mvp.id,
      numeroDoMvp: mvp.numero,
      numeroDaFatia: slice.numero,
      titulo: slice.titulo,
      specExecutavel: slice.detalhada,
      ...(issue === undefined
        ? {}
        : { issue: issue.numero, ...(issue.url ? { issueUrl: issue.url } : {}) }),
      coluna,
      ...(run === undefined ? {} : { run }),
      ...(equipe === undefined ? {} : { equipe }),
      dependenciasAbertas: bloqueadas.get(slice.id) ?? [],
      consulta:
        entrada.consultas?.get(run?.id ?? slice.id) ??
        ({ estado: 'nao-consultado', checksPendentes: [], checks: [] } satisfies ConsultaDeChecks),
      ...(run === undefined || entrada.aprovacoesPendentes?.get(run.id) === undefined
        ? {}
        : { aprovacaoPendente: entrada.aprovacoesPendentes.get(run.id) })
    }
    return [cartao]
  })

  const colunas = COLUNAS_DO_QUADRO.map((id) => ({
    id,
    titulo: TITULOS_DAS_COLUNAS[id],
    cartoes: cartoes.filter((cartao) => cartao.coluna === id)
  }))

  return {
    projectId: entrada.projectId,
    colunas,
    geradoEm: entrada.agora ?? new Date().toISOString()
  }
}
