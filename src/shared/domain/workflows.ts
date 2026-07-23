/**
 * Contratos de Workflow e Automação (SPEC-Execucao-04, RF-006/RF-007).
 *
 * **Definições, não execução.** Estas são as formas que o catálogo persiste; nenhuma etapa
 * roda nesta fatia (executar é a Fatia 05, simulado, e o MVP-003, real). O schema é o **pleno
 * do RF-006** desde já — por decisão do PI, para não migrar quando a execução ficar real; o
 * custo aceito é campos sem carga até lá (`schedule`, `lastRun`, `nextRun`).
 *
 * Mora em `src/shared/domain` porque renderer, main e testes falam os mesmos tipos, e o
 * contrato precisa ser verificável sem carregar o Electron (CONVENTION §2).
 */

import type { ActionId } from '../policies/contracts'
import type { WorkspaceId } from './entities'

/** Modo de execução de uma etapa ou grupo (RF-006: sequencial e paralela). */
export const EXECUTION_MODES = ['sequencial', 'paralelo'] as const
export type ExecutionMode = (typeof EXECUTION_MODES)[number]

/**
 * Status do workflow (RF-006). Nasce **`disabled`** (SPEC-Execucao-04, critério 1): uma
 * definição recém-criada não está no ar até o usuário decidir. `online/offline/paused/failed`
 * só ganham sentido quando há execução (Fatia 05+) — aqui são schema, não estado observado.
 */
export const WORKFLOW_STATUSES = ['online', 'offline', 'paused', 'failed', 'disabled'] as const
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number]

/** Tipos de gatilho do Trigger Registry (RF-006). Só `manual` é acionável nesta fatia. */
export const TRIGGER_TYPES = ['manual', 'cron', 'evento', 'webhook'] as const
export type TriggerType = (typeof TRIGGER_TYPES)[number]

/**
 * Um descritor de ação de uma etapa. **`action` é um `ActionId` da taxonomia do Policy
 * Engine** (Fatia 02) — é o que liga 04→02→05: a Fatia 05 pega cada etapa e chama
 * `evaluate(step.action, …)` para classificar e simular. Uma etapa cuja ação não existe na
 * taxonomia será classificada `bloqueado` (fail-closed) quando a execução chegar.
 */
export interface ActionDescriptor {
  readonly action: ActionId
  /** Parâmetros da ação (caminho, alvo…). Forma livre — a etapa não os interpreta aqui. */
  readonly params?: Readonly<Record<string, unknown>>
}

/** Uma etapa do workflow (RF-006: ação, agente, skill, entradas, saídas, critérios). */
export interface WorkflowStep {
  readonly id: string
  readonly descriptor: ActionDescriptor
  /** Refs nullable — agente/skill reais chegam no Corte 3; aqui sem FK (spec § Dentro). */
  readonly agenteId?: string
  readonly skillId?: string
  readonly mode: ExecutionMode
  /** Pausa para aprovação humana (RF-006). Schema agora; o fluxo é enforcement (MVP-003). */
  readonly requiresApproval: boolean
  readonly inputs?: Readonly<Record<string, unknown>>
  readonly outputs?: Readonly<Record<string, unknown>>
  /** Critérios de sucesso da etapa, em texto livre por ora. */
  readonly successCriteria?: string
}

/** Um gatilho registrado. Nesta fatia é **só dado** — nenhum dispara (spec § Dentro). */
export interface Trigger {
  readonly id: string
  readonly type: TriggerType
  /** Config do gatilho (expressão cron, nome do evento, URL do webhook). Livre por tipo. */
  readonly config?: Readonly<Record<string, unknown>>
}

/**
 * Definição de um Workflow (RF-006, schema pleno). `steps` e `triggers` são serializados como
 * JSON numa coluna (decisão do PI: catálogo não consulta etapa isoladamente, então normalizar
 * seria custo sem retorno até a execução real). Escopo por `user_id`/`workspace_id`.
 */
export interface Workflow {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly name: string
  readonly status: WorkflowStatus
  readonly steps: readonly WorkflowStep[]
  readonly triggers: readonly Trigger[]
  /** Agenda (cron). Nulo até haver scheduler (Corte 4). */
  readonly schedule?: string
  /** ISO-8601. Nulos até haver execução (Fatia 05+). */
  readonly lastRun?: string
  readonly nextRun?: string
  readonly created_at: string
  readonly updated_at: string
}

/** O que o chamador informa ao criar um workflow. O resto (id, status inicial, carimbos)
 *  é do repositório. Nasce sempre `disabled` — o criador não escolhe o status inicial. */
export interface WorkflowInput {
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly name: string
  readonly steps: readonly WorkflowStep[]
  readonly triggers?: readonly Trigger[]
  readonly schedule?: string
}

/**
 * Definição de uma Automação (RF-007). O alvo é um workflow **ou** um descritor de ação
 * solto. Estado de execução e retentativa são schema — nada roda nesta fatia.
 */
export interface Automation {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly name: string
  /** O gatilho da automação. `manual` acionável (via Fatia 05); demais são schema. */
  readonly trigger: Trigger
  /** Alvo: um workflow existente ou uma ação avulsa. Exatamente um dos dois. */
  readonly target: { readonly workflowId: string } | { readonly descriptor: ActionDescriptor }
  readonly squadId?: string
  readonly skillId?: string
  readonly enabled: boolean
  /** Estrutura de estado/retentativa (RF-007). Nula até haver execução. */
  readonly lastRun?: string
  readonly nextRun?: string
  readonly retryCount: number
  readonly created_at: string
  readonly updated_at: string
}

export interface AutomationInput {
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly name: string
  readonly trigger: Trigger
  readonly target: { readonly workflowId: string } | { readonly descriptor: ActionDescriptor }
  readonly squadId?: string
  readonly skillId?: string
}

export function isWorkflowStatus(value: unknown): value is WorkflowStatus {
  return typeof value === 'string' && (WORKFLOW_STATUSES as readonly string[]).includes(value)
}

export function isTriggerType(value: unknown): value is TriggerType {
  return typeof value === 'string' && (TRIGGER_TYPES as readonly string[]).includes(value)
}
