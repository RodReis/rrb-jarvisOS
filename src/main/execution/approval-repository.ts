/**
 * Fila de aprovação humana (SPEC-ExecucaoReal-01).
 *
 * O repositório só persiste e consulta. Auditar a criação/resolução fica no motor real,
 * que conhece o contexto da execução e mantém o par evento → efeito no mesmo fluxo.
 */

import type { Database } from 'better-sqlite3'
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalRequestStatus
} from '@shared/domain/execution'
import type { WorkspaceId } from '@shared/domain/entities'
import { log } from '../logging/logger'

interface ApprovalRow {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: string
  readonly run_id: string
  readonly step_id: string
  readonly action: string
  readonly status: string
  readonly risk: string
  readonly reason: string
  readonly operation: string
  readonly created_at: string
  readonly resolved_at: string | null
  readonly resolved_by: string | null
}

function parseOperation(raw: string): Readonly<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function toApproval(row: ApprovalRow): ApprovalRequest {
  return {
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id,
    runId: row.run_id,
    stepId: row.step_id,
    action: row.action,
    status: row.status as ApprovalRequestStatus,
    risk: row.risk,
    reason: row.reason,
    operation: parseOperation(row.operation),
    created_at: row.created_at,
    ...(row.resolved_at ? { resolved_at: row.resolved_at } : {}),
    ...(row.resolved_by ? { resolved_by: row.resolved_by } : {})
  }
}

export class ApprovalRepository {
  constructor(private readonly db: Database) {}

  create(input: ApprovalRequest): ApprovalRequest {
    this.db
      .prepare(
        `INSERT INTO approval_request
           (id, user_id, workspace_id, run_id, step_id, action, status, risk, reason,
            operation, created_at, resolved_at, resolved_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.user_id,
        input.workspace_id,
        input.runId,
        input.stepId,
        input.action,
        input.status,
        input.risk,
        input.reason,
        JSON.stringify(input.operation),
        input.created_at,
        input.resolved_at ?? null,
        input.resolved_by ?? null
      )

    log.db.info('Pedido de aprovação registrado', {
      op: 'insert',
      table: 'approval_request',
      status: input.status
    })
    return input
  }

  listPending(userId: string, workspaceId: WorkspaceId): readonly ApprovalRequest[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM approval_request
          WHERE user_id = ? AND workspace_id = ? AND status = 'pendente'
          ORDER BY created_at`
      )
      .all(userId, workspaceId) as ApprovalRow[]
    return rows.map(toApproval)
  }

  findById(userId: string, id: string): ApprovalRequest | undefined {
    const row = this.db
      .prepare('SELECT * FROM approval_request WHERE user_id = ? AND id = ?')
      .get(userId, id) as ApprovalRow | undefined
    return row ? toApproval(row) : undefined
  }

  resolve(userId: string, id: string, decision: ApprovalDecision): ApprovalRequest | undefined {
    const resolvedAt = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE approval_request
            SET status = ?,
                resolved_at = ?,
                resolved_by = ?
          WHERE user_id = ? AND id = ? AND status = 'pendente'`
      )
      .run(decision, resolvedAt, userId, userId, id)

    log.db.info('Pedido de aprovação resolvido', {
      op: 'update',
      table: 'approval_request',
      status: decision
    })
    return this.findById(userId, id)
  }
}
