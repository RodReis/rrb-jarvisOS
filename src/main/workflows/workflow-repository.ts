/**
 * Persistência de Workflows (SPEC-Execucao-04, RF-006).
 *
 * CRUD de **definições** — nenhuma etapa roda aqui (executar é a Fatia 05+). `steps` e
 * `triggers` são serializados como JSON na coluna; a forma é validada no contrato TS, e a
 * leitura re-hidrata o objeto. Toda consulta é **escopada por `user_id`** (CONVENTION §2) —
 * não existe "listar tudo".
 *
 * A auditoria de criar/alterar/toggle **não** mora aqui: é responsabilidade do serviço
 * (`WorkflowService`), que classifica pelo Policy Engine antes de gravar. O repositório é só
 * persistência — separar mantém o CRUD testável sem arrastar o engine.
 */

import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type {
  Trigger,
  Workflow,
  WorkflowInput,
  WorkflowStatus,
  WorkflowStep
} from '@shared/domain/workflows'
import type { WorkspaceId } from '@shared/domain/entities'
import { log } from '../logging/logger'

interface WorkflowRow {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: string
  readonly name: string
  readonly status: string
  readonly steps: string
  readonly triggers: string
  readonly schedule: string | null
  readonly last_run: string | null
  readonly next_run: string | null
  readonly created_at: string
  readonly updated_at: string
}

function toWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id as WorkspaceId,
    name: row.name,
    status: row.status as WorkflowStatus,
    // JSON gravado por nós; parse defensivo mesmo assim — um banco corrompido não deve
    // derrubar a listagem inteira, e um array vazio é um workflow sem etapas, não um erro.
    steps: parseJsonArray<WorkflowStep>(row.steps),
    triggers: parseJsonArray<Trigger>(row.triggers),
    ...(row.schedule ? { schedule: row.schedule } : {}),
    ...(row.last_run ? { lastRun: row.last_run } : {}),
    ...(row.next_run ? { nextRun: row.next_run } : {}),
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

function parseJsonArray<T>(raw: string): readonly T[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

export class WorkflowRepository {
  constructor(private readonly db: Database) {}

  /**
   * Cria um workflow. **Nasce sempre `disabled`** (critério 1) — o criador não escolhe o
   * status inicial; uma definição recém-registrada não está no ar até o usuário ativá-la.
   */
  create(input: WorkflowInput): Workflow {
    const agora = new Date().toISOString()
    const workflow: Workflow = {
      id: randomUUID(),
      user_id: input.user_id,
      workspace_id: input.workspace_id,
      name: input.name,
      status: 'disabled',
      steps: input.steps,
      triggers: input.triggers ?? [],
      ...(input.schedule ? { schedule: input.schedule } : {}),
      created_at: agora,
      updated_at: agora
    }

    this.db
      .prepare(
        `INSERT INTO workflow
           (id, user_id, workspace_id, name, status, steps, triggers, schedule,
            last_run, next_run, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
      )
      .run(
        workflow.id,
        workflow.user_id,
        workflow.workspace_id,
        workflow.name,
        workflow.status,
        JSON.stringify(workflow.steps),
        JSON.stringify(workflow.triggers),
        workflow.schedule ?? null,
        workflow.created_at,
        workflow.updated_at
      )

    log.db.info('Workflow criado', { op: 'insert', table: 'workflow' })
    return workflow
  }

  /** Workflows do usuário no espaço. Escopado — nunca lista de outro usuário. */
  list(userId: string, workspaceId: WorkspaceId): readonly Workflow[] {
    const rows = this.db
      .prepare('SELECT * FROM workflow WHERE user_id = ? AND workspace_id = ? ORDER BY created_at')
      .all(userId, workspaceId) as WorkflowRow[]
    return rows.map(toWorkflow)
  }

  findById(userId: string, id: string): Workflow | undefined {
    const row = this.db
      .prepare('SELECT * FROM workflow WHERE user_id = ? AND id = ?')
      .get(userId, id) as WorkflowRow | undefined
    return row ? toWorkflow(row) : undefined
  }

  /**
   * Atualiza nome/etapas/triggers/schedule de um workflow do usuário. O `WHERE user_id`
   * garante que um usuário nunca edite o workflow de outro. Devolve o estado resultante, ou
   * `undefined` se o id não é dele.
   */
  update(
    userId: string,
    id: string,
    patch: Partial<Pick<Workflow, 'name' | 'steps' | 'triggers' | 'schedule'>>
  ): Workflow | undefined {
    const atual = this.findById(userId, id)
    if (!atual) return undefined

    const merged: Workflow = {
      ...atual,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.steps !== undefined ? { steps: patch.steps } : {}),
      ...(patch.triggers !== undefined ? { triggers: patch.triggers } : {}),
      ...(patch.schedule !== undefined ? { schedule: patch.schedule } : {}),
      updated_at: new Date().toISOString()
    }

    this.db
      .prepare(
        `UPDATE workflow
            SET name = ?, steps = ?, triggers = ?, schedule = ?, updated_at = ?
          WHERE user_id = ? AND id = ?`
      )
      .run(
        merged.name,
        JSON.stringify(merged.steps),
        JSON.stringify(merged.triggers),
        merged.schedule ?? null,
        merged.updated_at,
        userId,
        id
      )

    log.db.info('Workflow atualizado', { op: 'update', table: 'workflow' })
    return merged
  }

  /** Troca o status (ativar/desativar). Devolve o novo estado ou `undefined` se não é dele. */
  setStatus(userId: string, id: string, status: WorkflowStatus): Workflow | undefined {
    const atual = this.findById(userId, id)
    if (!atual) return undefined

    const updated_at = new Date().toISOString()
    this.db
      .prepare('UPDATE workflow SET status = ?, updated_at = ? WHERE user_id = ? AND id = ?')
      .run(status, updated_at, userId, id)

    log.db.info('Status do workflow alterado', { op: 'update', table: 'workflow', status })
    return { ...atual, status, updated_at }
  }

  /** Remove um workflow do usuário. Devolve `true` se removeu. */
  remove(userId: string, id: string): boolean {
    const info = this.db
      .prepare('DELETE FROM workflow WHERE user_id = ? AND id = ?')
      .run(userId, id)
    log.db.info('Workflow removido', { op: 'delete', table: 'workflow' })
    return info.changes > 0
  }
}
