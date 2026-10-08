import { isWorkspaceId, type WorkspaceId } from './entities'

export const CONTROLES_OPERACIONAIS = ['execucao', 'gasto', 'push', 'criacao-pr', 'merge'] as const

export type ControleOperacional = (typeof CONTROLES_OPERACIONAIS)[number]

export interface EscopoDeControle {
  readonly userId: string
  readonly workspaceId: WorkspaceId
  readonly projectId?: string
}

export interface EstadoDeControle {
  readonly enabled: boolean
  readonly actor?: string
  readonly updatedAt?: string
}

export interface SnapshotDeControles {
  readonly escopo: 'workspace' | 'projeto'
  readonly projetoId?: string
  readonly pausa: {
    readonly pausada: boolean
    readonly drenando: boolean
    readonly noEscopoAtual: boolean
    readonly noWorkspace: boolean
  }
  readonly controles: Readonly<
    Record<ControleOperacional, EstadoDeControle & { readonly herdado: boolean }>
  >
  readonly updatedAt?: string
  readonly ativos: readonly { readonly runId: string; readonly projectId: string }[]
}

export type AcaoDeControle =
  | { readonly tipo: 'pausa'; readonly pausada: boolean | null }
  | {
      readonly tipo: 'switch'
      readonly controle: ControleOperacional
      /** null remove o override do projeto e volta a herdar o escopo do workspace. */
      readonly habilitado: boolean | null
    }

export interface ComandoDeControle {
  readonly escopo: EscopoDeControle
  readonly acao: AcaoDeControle
  readonly idempotencyKey: string
}

export type ResultadoDeControle =
  | { readonly status: 'updated'; readonly snapshot: SnapshotDeControles }
  | { readonly status: 'unchanged'; readonly snapshot: SnapshotDeControles }
  | { readonly status: 'invalid'; readonly message: string }
  | { readonly status: 'idempotency-conflict'; readonly message: string }

export function isControleOperacional(value: unknown): value is ControleOperacional {
  return typeof value === 'string' && (CONTROLES_OPERACIONAIS as readonly string[]).includes(value)
}

export function isEscopoDeControle(value: unknown): value is EscopoDeControle {
  if (value === null || typeof value !== 'object') return false
  const escopo = value as EscopoDeControle
  return (
    typeof (value as EscopoDeControle).userId === 'string' &&
    (value as EscopoDeControle).userId.trim().length > 0 &&
    isWorkspaceId((value as EscopoDeControle).workspaceId) &&
    (escopo.projectId === undefined ||
      (typeof escopo.projectId === 'string' && escopo.projectId.trim().length > 0))
  )
}

export function isComandoDeControle(value: unknown): value is ComandoDeControle {
  if (value === null || typeof value !== 'object') return false
  const command = value as ComandoDeControle
  if (!isEscopoDeControle(command.escopo) || typeof command.idempotencyKey !== 'string')
    return false
  if (command.acao === null || typeof command.acao !== 'object') return false
  if (command.acao.tipo === 'pausa')
    return command.acao.pausada === null || typeof command.acao.pausada === 'boolean'
  return (
    command.acao.tipo === 'switch' &&
    isControleOperacional(command.acao.controle) &&
    (typeof command.acao.habilitado === 'boolean' || command.acao.habilitado === null)
  )
}
