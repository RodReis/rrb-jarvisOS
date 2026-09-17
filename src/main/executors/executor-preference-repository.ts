import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import {
  DEFAULT_EXECUTOR_PREFERENCE,
  isExecutorDeCodigo,
  type ExecutorDeCodigo,
  type ExecutorPreference
} from '@shared/domain/executor-operacional'

interface Row {
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly project_id: string
  readonly executores: string
  readonly fallback_permitido: number
  readonly teto_usd: number | null
  readonly updated_at: string
}

export class ExecutorPreferenceRepository {
  constructor(private readonly db: Database) {}

  find(userId: string, workspaceId: WorkspaceId, projectId: string): ExecutorPreference {
    const row = this.db
      .prepare(
        `SELECT user_id, workspace_id, project_id, executores, fallback_permitido, teto_usd, updated_at
           FROM project_executor_policy
          WHERE user_id = ? AND workspace_id = ? AND project_id = ?`
      )
      .get(userId, workspaceId, projectId) as Row | undefined

    if (row === undefined) {
      return {
        userId,
        workspaceId,
        projectId,
        executores: DEFAULT_EXECUTOR_PREFERENCE.executores,
        fallbackPermitido: DEFAULT_EXECUTOR_PREFERENCE.fallbackPermitido,
        updatedAt: ''
      }
    }

    return {
      userId: row.user_id,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      executores: lerExecutores(row.executores),
      fallbackPermitido: row.fallback_permitido === 1,
      ...(row.teto_usd === null ? {} : { tetoUsd: row.teto_usd }),
      updatedAt: row.updated_at
    }
  }

  save(input: ExecutorPreference): ExecutorPreference {
    const updatedAt = new Date().toISOString()
    const executores = input.executores.filter(isExecutorDeCodigo)

    this.db
      .prepare(
        `INSERT INTO project_executor_policy
           (user_id, workspace_id, project_id, executores, fallback_permitido, teto_usd, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, workspace_id, project_id) DO UPDATE SET
           executores = excluded.executores,
           fallback_permitido = excluded.fallback_permitido,
           teto_usd = excluded.teto_usd,
           updated_at = excluded.updated_at`
      )
      .run(
        input.userId,
        input.workspaceId,
        input.projectId,
        JSON.stringify(
          executores.length === 0 ? DEFAULT_EXECUTOR_PREFERENCE.executores : executores
        ),
        input.fallbackPermitido ? 1 : 0,
        input.tetoUsd ?? null,
        updatedAt
      )

    return this.find(input.userId, input.workspaceId, input.projectId)
  }
}

function lerExecutores(raw: string): readonly ExecutorDeCodigo[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_EXECUTOR_PREFERENCE.executores
    const validos = parsed.filter(isExecutorDeCodigo)
    return validos.length === 0 ? DEFAULT_EXECUTOR_PREFERENCE.executores : validos
  } catch {
    return DEFAULT_EXECUTOR_PREFERENCE.executores
  }
}
