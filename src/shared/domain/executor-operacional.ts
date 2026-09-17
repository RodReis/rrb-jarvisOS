import type { WorkspaceId } from './entities'
import { execucaoPermitida, QUOTA_DO_CODEX, type CodexProfileState } from './codex-profile'

export const EXECUTORES_DE_CODIGO = ['claude-code', 'codex-exec'] as const
export type ExecutorDeCodigo = (typeof EXECUTORES_DE_CODIGO)[number]

export function isExecutorDeCodigo(value: unknown): value is ExecutorDeCodigo {
  return typeof value === 'string' && (EXECUTORES_DE_CODIGO as readonly string[]).includes(value)
}

export interface ExecutorPreference {
  readonly userId: string
  readonly workspaceId: WorkspaceId
  readonly projectId: string
  readonly executores: readonly ExecutorDeCodigo[]
  readonly fallbackPermitido: boolean
  readonly tetoUsd?: number
  readonly updatedAt: string
}

export interface ExecutorOperationalState {
  readonly executor: ExecutorDeCodigo
  readonly rotulo: string
  readonly disponivel: boolean
  readonly elegivel: boolean
  readonly motivo: string
  readonly autenticacao: 'ok' | 'required' | 'unknown'
  readonly quota: 'available' | 'quota_unknown' | 'quota_limited'
  readonly modoDeCobranca: 'unmetered' | 'metered'
  readonly modelo: string
}

export interface ExecutorSelectionPreview {
  readonly decisao: 'escolhido' | 'espera' | 'bloqueado'
  readonly writer?: ExecutorDeCodigo
  readonly revisor?: ExecutorDeCodigo
  readonly modoDaRevisao?: 'cruzada' | 'independente'
  readonly motivo: string
  readonly estados: readonly ExecutorOperationalState[]
}

export interface OperationalProofSnapshot {
  readonly projectId: string
  readonly workspaceId: WorkspaceId
  readonly writer?: ExecutorDeCodigo
  readonly revisor?: ExecutorDeCodigo
  readonly modoDaRevisao?: 'cruzada' | 'independente'
  readonly headSha: string
  readonly checks: readonly string[]
  readonly resultado: 'not_run'
  readonly motivo: string
  readonly createdAt: string
}

export interface ExecutorOperationalView {
  readonly preference: ExecutorPreference
  readonly preview: ExecutorSelectionPreview
  readonly proof: OperationalProofSnapshot
}

export const DEFAULT_EXECUTOR_PREFERENCE = {
  executores: ['claude-code', 'codex-exec'] as const,
  fallbackPermitido: true
}

export function buildExecutorPreview(entrada: {
  readonly preference: ExecutorPreference
  readonly claudeDisponivel: boolean
  readonly codex: CodexProfileState
  readonly gastoUsd: number
}): ExecutorSelectionPreview {
  const estados: ExecutorOperationalState[] = [
    {
      executor: 'claude-code',
      rotulo: 'Claude Code',
      disponivel: entrada.claudeDisponivel,
      elegivel: entrada.claudeDisponivel,
      motivo: entrada.claudeDisponivel ? 'Disponível para escrita e revisão.' : 'CLI indisponível.',
      autenticacao: entrada.claudeDisponivel ? 'ok' : 'unknown',
      quota: 'quota_unknown',
      modoDeCobranca: 'unmetered',
      modelo: 'claude-opus-5'
    },
    estadoDoCodex(entrada.codex, entrada.preference.tetoUsd, entrada.gastoUsd)
  ]

  const excluidos: string[] = []
  for (const executor of entrada.preference.executores) {
    const estado = estados.find((e) => e.executor === executor)
    if (estado === undefined) {
      excluidos.push(`${executor}: sem estado`)
      continue
    }
    if (!estado.elegivel) {
      excluidos.push(`${estado.rotulo}: ${estado.motivo}`)
      continue
    }

    const revisor = estados.find((e) => e.executor !== executor && e.elegivel)
    return {
      decisao: 'escolhido',
      writer: executor,
      revisor: revisor?.executor ?? executor,
      modoDaRevisao: revisor === undefined ? 'independente' : 'cruzada',
      motivo: excluidos.length === 0 ? 'Preferência principal elegível.' : excluidos.join(' · '),
      estados
    }
  }

  return {
    decisao: excluidos.some((m) => m.includes('teto')) ? 'bloqueado' : 'espera',
    motivo: excluidos.length === 0 ? 'Nenhum executor configurado.' : excluidos.join(' · '),
    estados
  }
}

function estadoDoCodex(
  codex: CodexProfileState,
  tetoUsd: number | undefined,
  gastoUsd: number
): ExecutorOperationalState {
  const permitida = execucaoPermitida({
    modo: codex.modo,
    tetoUsd,
    gastoUsd
  })
  const disponivel = codex.saude === 'ready' || codex.saude === QUOTA_DO_CODEX
  const elegivel = disponivel && permitida.permitida

  return {
    executor: 'codex-exec',
    rotulo: 'Codex',
    disponivel,
    elegivel,
    motivo: !disponivel
      ? `Codex ${codex.saude}.`
      : (permitida.motivo ?? 'Disponível; quota oficial não reportada pelo CLI.'),
    autenticacao: codex.saude === 'auth_required' ? 'required' : 'ok',
    quota: codex.saude === 'quota_limited' ? 'quota_limited' : QUOTA_DO_CODEX,
    modoDeCobranca: codex.modo === 'subscription_limited' ? 'unmetered' : 'metered',
    modelo: 'gpt-5.6-sol'
  }
}
