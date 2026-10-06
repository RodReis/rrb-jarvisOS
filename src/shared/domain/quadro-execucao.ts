import type { DependenciaAberta } from './fila'
import type { EstadoDoRun, PipelineRun } from './pipeline'
import type { Mvp, Slice } from './roadmap'

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
}

export interface ResultadoDoPlay {
  readonly sliceId: string
  readonly runId?: string
  readonly estado: 'iniciado' | 'bloqueado' | 'recusado'
  readonly mensagem: string
}

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
  readonly dependenciasAbertas: readonly DependenciaAberta[]
  readonly consulta: ConsultaDeChecks
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
      dependenciasAbertas: bloqueadas.get(slice.id) ?? [],
      consulta:
        entrada.consultas?.get(run?.id ?? slice.id) ??
        ({ estado: 'nao-consultado', checksPendentes: [], checks: [] } satisfies ConsultaDeChecks)
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
