/**
 * O kill-switch do merge autônomo, por projeto (SPEC-Entrega-05; decisão do PI, 2026-08-30).
 *
 * **Ausência de linha significa ligado.** O merge autônomo é o padrão do projeto — é a tese do
 * MVP-009 —, e gravar uma linha `autonomo = 1` em toda criação de projeto obrigaria a migrar
 * linhas no dia em que o default mudasse. A ausência não precisa migrar, e diz a mesma coisa.
 *
 * A linha só nasce quando alguém **decide**: desligar grava `0`, religar grava `1`. Guardar a
 * religação (em vez de apagar a linha) é o que preserva `identidade` e `updated_at` — quem
 * religou e quando é parte da mesma pergunta que o desligamento levanta.
 */

import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import type { PoliticaDeMerge } from '@shared/domain/pipeline'

interface PolicyRow {
  readonly autonomo: number
  readonly identidade: string
  readonly updated_at: string
}

export class MergePolicyRepository {
  constructor(private readonly db: Database) {}

  /**
   * A política do projeto. Sem linha, `autonomo: true` — o default ligado.
   */
  buscar(userId: string, projectId: string): PoliticaDeMerge {
    const row = this.db
      .prepare(
        'SELECT autonomo, identidade, updated_at FROM project_merge_policy WHERE user_id = ? AND project_id = ?'
      )
      .get(userId, projectId) as PolicyRow | undefined

    if (row === undefined) return { autonomo: true }

    return {
      autonomo: row.autonomo === 1,
      identidade: row.identidade,
      updated_at: row.updated_at
    }
  }

  /** Grava a decisão. `upsert` porque a política é um estado corrente, não um histórico. */
  definir(
    escopo: {
      readonly userId: string
      readonly workspaceId: WorkspaceId
      readonly projectId: string
    },
    autonomo: boolean,
    identidade: string,
    agora: Date
  ): void {
    this.db
      .prepare(
        `INSERT INTO project_merge_policy
           (project_id, user_id, workspace_id, autonomo, identidade, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, project_id) DO UPDATE SET
           autonomo   = excluded.autonomo,
           identidade = excluded.identidade,
           updated_at = excluded.updated_at`
      )
      .run(
        escopo.projectId,
        escopo.userId,
        escopo.workspaceId,
        autonomo ? 1 : 0,
        identidade,
        agora.toISOString()
      )
  }
}
