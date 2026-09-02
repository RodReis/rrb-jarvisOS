/**
 * Persistência do estado de quota das rotas `subscription_limited` (SPEC-Entrega-04, critério
 * 12). Uma linha por `(user_id, workspace_id, provider)`, sobrescrita — o mesmo raciocínio do
 * `BudgetRepository` para `budget_policy`: isto é status atual, não histórico de eventos.
 */

import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import type { AiProvider, QuotaOrigem, QuotaState } from '@shared/domain/ai'

interface QuotaRow {
  readonly provider: string
  readonly origem: string
  readonly restante: number | null
  readonly limite: number | null
  readonly reset_em: string | null
  readonly atualizado_em: string
}

function toQuotaState(row: QuotaRow): QuotaState {
  return {
    provider: row.provider as AiProvider,
    origem: row.origem as QuotaOrigem,
    ...(row.restante === null ? {} : { restante: row.restante }),
    ...(row.limite === null ? {} : { limite: row.limite }),
    ...(row.reset_em === null ? {} : { resetEm: row.reset_em }),
    atualizadoEm: row.atualizado_em
  }
}

export class QuotaRepository {
  constructor(private readonly db: Database) {}

  ler(userId: string, workspace: WorkspaceId, provider: AiProvider): QuotaState | undefined {
    const row = this.db
      .prepare(
        `SELECT provider, origem, restante, limite, reset_em, atualizado_em
           FROM provider_quota_state
          WHERE user_id = ? AND workspace_id = ? AND provider = ?`
      )
      .get(userId, workspace, provider) as QuotaRow | undefined

    return row === undefined ? undefined : toQuotaState(row)
  }

  gravar(userId: string, workspace: WorkspaceId, estado: QuotaState, agora: Date): void {
    this.db
      .prepare(
        `INSERT INTO provider_quota_state
           (user_id, workspace_id, provider, origem, restante, limite, reset_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, workspace_id, provider) DO UPDATE SET
           origem        = excluded.origem,
           restante      = excluded.restante,
           limite        = excluded.limite,
           reset_em      = excluded.reset_em,
           atualizado_em = excluded.atualizado_em`
      )
      .run(
        userId,
        workspace,
        estado.provider,
        estado.origem,
        estado.restante ?? null,
        estado.limite ?? null,
        estado.resetEm ?? null,
        agora.toISOString()
      )
  }
}
