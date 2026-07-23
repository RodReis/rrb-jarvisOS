/**
 * Persistência dos `ExecutionRun` (SPEC-Execucao-05).
 *
 * Só grava e lê o rastro — o motor (`SimulationEngine`) é quem produz o run. `trace` é JSON
 * na coluna (o run não é consultado por etapa). Escopo por `user_id` (CONVENTION §2).
 */

import type { Database } from 'better-sqlite3'
import type { ExecutionRun, ExecutionState, StepTrace } from '@shared/domain/execution'
import type { WorkspaceId } from '@shared/domain/entities'
import { log } from '../logging/logger'

interface RunRow {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: string
  readonly workflow_id: string | null
  readonly state: string
  readonly trace: string
  readonly correlation_id: string
  readonly started_at: string
  readonly finished_at: string
  readonly created_at: string
}

function toRun(row: RunRow): ExecutionRun {
  return {
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id as WorkspaceId,
    workflowId: row.workflow_id,
    state: row.state as ExecutionState,
    trace: parseTrace(row.trace),
    correlationId: row.correlation_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    created_at: row.created_at
  }
}

function parseTrace(raw: string): readonly StepTrace[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as StepTrace[]) : []
  } catch {
    return []
  }
}

export class ExecutionRepository {
  constructor(private readonly db: Database) {}

  save(run: ExecutionRun): ExecutionRun {
    this.db
      .prepare(
        `INSERT INTO execution_run
           (id, user_id, workspace_id, workflow_id, state, trace, correlation_id,
            started_at, finished_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.id,
        run.user_id,
        run.workspace_id,
        run.workflowId,
        run.state,
        JSON.stringify(run.trace),
        run.correlationId,
        run.startedAt,
        run.finishedAt,
        run.created_at
      )
    log.db.info('Execução simulada registrada', {
      op: 'insert',
      table: 'execution_run',
      state: run.state
    })
    return run
  }

  list(userId: string, workspaceId: WorkspaceId): readonly ExecutionRun[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM execution_run WHERE user_id = ? AND workspace_id = ? ORDER BY created_at DESC'
      )
      .all(userId, workspaceId) as RunRow[]
    return rows.map(toRun)
  }

  findById(userId: string, id: string): ExecutionRun | undefined {
    const row = this.db
      .prepare('SELECT * FROM execution_run WHERE user_id = ? AND id = ?')
      .get(userId, id) as RunRow | undefined
    return row ? toRun(row) : undefined
  }
}
