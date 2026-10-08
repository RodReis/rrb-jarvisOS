import type { Database } from 'better-sqlite3'
import type { EscopoDoInventario } from './inventario-snapshot-repository'
import type {
  ContinuousDispatcherRepository,
  DecisaoDoDispatcher,
  EstadoDoDispatcher
} from './continuous-dispatcher'
import { log } from '../logging/logger'

interface DecisaoRow {
  readonly idempotency_key: string
  readonly dag_fingerprint: string
  readonly node_id: string | null
  readonly run_id: string | null
  readonly state: string
  readonly cause: string | null
  readonly retry_at: string | null
}

function mapear(row: DecisaoRow): DecisaoDoDispatcher {
  return {
    idempotencyKey: row.idempotency_key,
    dagFingerprint: row.dag_fingerprint,
    ...(row.node_id === null ? {} : { nodeId: row.node_id }),
    ...(row.run_id === null ? {} : { runId: row.run_id }),
    estado: row.state as EstadoDoDispatcher,
    ...(row.cause === null ? {} : { causa: row.cause }),
    ...(row.retry_at === null ? {} : { retomarEm: row.retry_at })
  }
}

/** Cursor e última decisão por chave idempotente; escopo local completo em toda consulta. */
export class ContinuousDispatcherRepositorySqlite implements ContinuousDispatcherRepository {
  constructor(private readonly db: Database) {}

  buscar(escopo: EscopoDoInventario, idempotencyKey: string): DecisaoDoDispatcher | undefined {
    const row = this.db
      .prepare(
        `SELECT idempotency_key, dag_fingerprint, node_id, run_id, state, cause, retry_at
         FROM continuous_dispatch_decision
        WHERE user_id = ? AND workspace_id = ? AND project_id = ? AND idempotency_key = ?`
      )
      .get(escopo.userId, escopo.workspaceId, escopo.projectId, idempotencyKey) as
      DecisaoRow | undefined
    return row === undefined ? undefined : mapear(row)
  }

  gravar(escopo: EscopoDoInventario, decisao: DecisaoDoDispatcher, agora: string): void {
    this.db
      .prepare(
        `INSERT INTO continuous_dispatch_decision
         (user_id, workspace_id, project_id, idempotency_key, dag_fingerprint, node_id, run_id,
          state, cause, retry_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, workspace_id, project_id, idempotency_key) DO UPDATE SET
         run_id = COALESCE(excluded.run_id, continuous_dispatch_decision.run_id),
         state = excluded.state,
         cause = excluded.cause,
         retry_at = excluded.retry_at,
         updated_at = excluded.updated_at
       WHERE continuous_dispatch_decision.dag_fingerprint = excluded.dag_fingerprint
         AND (continuous_dispatch_decision.node_id IS excluded.node_id)`
      )
      .run(
        escopo.userId,
        escopo.workspaceId,
        escopo.projectId,
        decisao.idempotencyKey,
        decisao.dagFingerprint,
        decisao.nodeId ?? null,
        decisao.runId ?? null,
        decisao.estado,
        decisao.causa ?? null,
        decisao.retomarEm ?? null,
        agora,
        agora
      )
    const persistida = this.buscar(escopo, decisao.idempotencyKey)
    if (
      persistida?.dagFingerprint !== decisao.dagFingerprint ||
      persistida.nodeId !== decisao.nodeId
    )
      throw new Error('Chave idempotente do dispatcher reutilizada para outra decisão.')
    log.db.info('Decisão do dispatcher contínuo gravada', {
      op: 'upsert',
      table: 'continuous_dispatch_decision'
    })
  }

  cursor(escopo: EscopoDoInventario, dagFingerprint: string, agora: string): void {
    this.db
      .prepare(
        `INSERT INTO continuous_dispatch_cursor
         (user_id, workspace_id, project_id, dag_fingerprint, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, workspace_id, project_id) DO UPDATE SET
         dag_fingerprint = excluded.dag_fingerprint, updated_at = excluded.updated_at`
      )
      .run(escopo.userId, escopo.workspaceId, escopo.projectId, dagFingerprint, agora)
  }
}
