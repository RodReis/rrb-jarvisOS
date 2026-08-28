/**
 * Contratos do motor de execução simulada (SPEC-Execucao-05, RF-006).
 *
 * Um `ExecutionRun` é o **rastro** de percorrer as etapas de um workflow (Fatia 04) em modo
 * simulado: classificando cada etapa (Fatia 02), checando paths na allowlist (Fatia 03) e
 * **sem tocar recurso real**. É a evidência de que o caminho seguro de execução funciona
 * ponta a ponta — auditável (ADR-004) e logado (ADR-005).
 *
 * Mora em `src/shared/domain` porque a UI consome o run/trace, e o contrato precisa ser
 * verificável sem carregar o Electron.
 */

import type { PolicyDecision } from '../policies/contracts'

/**
 * Estados do run (RF-006). Máquina: `planejado → em-execucao → concluido | falhou | cancelado`.
 * `aguardando-aprovacao` é **marco**, não estado terminal: na simulação o run auto-continua
 * (o fluxo de aprovação é MVP-003). Kebab-case para casar com o padrão dos outros enums.
 */
export const EXECUTION_STATES = [
  'planejado',
  'em-execucao',
  'aguardando-aprovacao',
  'concluido',
  'falhou',
  'cancelado'
] as const
export type ExecutionState = (typeof EXECUTION_STATES)[number]

/** Resultado simulado de uma etapa. Sem efeito real — só o veredito e uma nota. */
export type StepOutcome = 'simulado-ok' | 'simulado-falha' | 'marco-aprovacao'

/**
 * O rastro de **uma** etapa percorrida. Reúne o que as três fatias produziram para ela:
 * a `Decision` de política (F02), a checagem de allowlist (F03, quando há path) e o resultado
 * simulado — mais o timing. É o "trace por etapa" do critério 1.
 */
export interface StepTrace {
  readonly stepId: string
  readonly action: string
  /** A decisão do Policy Engine para esta etapa (modo report — não barrou nada). */
  readonly decision: PolicyDecision
  /**
   * A etapa referenciava um path? Então: estava na allowlist? `undefined` = sem path (a
   * checagem de allowlist não se aplica). É o resultado da F03 registrado, nunca aplicado.
   */
  readonly pathAllowed?: boolean
  readonly outcome: StepOutcome
  /** Nota humana do que foi simulado (pt-BR). Nunca um efeito real, só a descrição. */
  readonly nota: string
  readonly durationMs: number
}

/**
 * Um run completo. Persistido (SQLite), escopado por `user_id`/`workspace_id`. O `trace` é
 * serializado como JSON — como no workflow, o run não é consultado por etapa isolada.
 */
export interface ExecutionRun {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: string
  /** O workflow percorrido, ou `null` se foi um descritor de ação avulso (gatilho manual). */
  readonly workflowId: string | null
  readonly state: ExecutionState
  readonly trace: readonly StepTrace[]
  /** Casa as entradas de log deste run (ADR-005). */
  readonly correlationId: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly created_at: string
}

export function isExecutionState(value: unknown): value is ExecutionState {
  return typeof value === 'string' && (EXECUTION_STATES as readonly string[]).includes(value)
}
