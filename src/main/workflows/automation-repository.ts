/**
 * Persistência de Automações (SPEC-Execucao-04, RF-007).
 *
 * CRUD de definições — nada executa. `trigger` e `target` são JSON na coluna (mesma decisão
 * do workflow). Escopo por `user_id`. A auditoria mora no serviço, não aqui.
 */

import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { Automation, AutomationInput, Trigger } from '@shared/domain/workflows'
import type { WorkspaceId } from '@shared/domain/entities'
import { log } from '../logging/logger'

interface AutomationRow {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: string
  readonly name: string
  readonly trigger: string
  readonly target: string
  readonly squad_id: string | null
  readonly skill_id: string | null
  readonly enabled: number
  readonly last_run: string | null
  readonly next_run: string | null
  readonly retry_count: number
  readonly created_at: string
  readonly updated_at: string
}

function toAutomation(row: AutomationRow): Automation {
  return {
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id as WorkspaceId,
    name: row.name,
    trigger: parseJson<Trigger>(row.trigger, { id: '', type: 'manual' }),
    target: parseJson<Automation['target']>(row.target, { workflowId: '' }),
    ...(row.squad_id ? { squadId: row.squad_id } : {}),
    ...(row.skill_id ? { skillId: row.skill_id } : {}),
    // SQLite não tem boolean: a coluna é 0/1, o contrato é boolean.
    enabled: row.enabled === 1,
    ...(row.last_run ? { lastRun: row.last_run } : {}),
    ...(row.next_run ? { nextRun: row.next_run } : {}),
    retryCount: row.retry_count,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export class AutomationRepository {
  constructor(private readonly db: Database) {}

  /** Cria uma automação. Nasce **desabilitada** (`enabled = false`) — nada dispara sozinho. */
  create(input: AutomationInput): Automation {
    const agora = new Date().toISOString()
    const automation: Automation = {
      id: randomUUID(),
      user_id: input.user_id,
      workspace_id: input.workspace_id,
      name: input.name,
      trigger: input.trigger,
      target: input.target,
      ...(input.squadId ? { squadId: input.squadId } : {}),
      ...(input.skillId ? { skillId: input.skillId } : {}),
      enabled: false,
      retryCount: 0,
      created_at: agora,
      updated_at: agora
    }

    this.db
      .prepare(
        `INSERT INTO automation
           (id, user_id, workspace_id, name, trigger, target, squad_id, skill_id,
            enabled, last_run, next_run, retry_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 0, ?, ?)`
      )
      .run(
        automation.id,
        automation.user_id,
        automation.workspace_id,
        automation.name,
        JSON.stringify(automation.trigger),
        JSON.stringify(automation.target),
        automation.squadId ?? null,
        automation.skillId ?? null,
        automation.created_at,
        automation.updated_at
      )

    log.db.info('Automação criada', { op: 'insert', table: 'automation' })
    return automation
  }

  list(userId: string, workspaceId: WorkspaceId): readonly Automation[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM automation WHERE user_id = ? AND workspace_id = ? ORDER BY created_at'
      )
      .all(userId, workspaceId) as AutomationRow[]
    return rows.map(toAutomation)
  }

  findById(userId: string, id: string): Automation | undefined {
    const row = this.db
      .prepare('SELECT * FROM automation WHERE user_id = ? AND id = ?')
      .get(userId, id) as AutomationRow | undefined
    return row ? toAutomation(row) : undefined
  }

  /** Ativa/desativa a automação. Devolve o novo estado ou `undefined` se não é do usuário. */
  setEnabled(userId: string, id: string, enabled: boolean): Automation | undefined {
    const atual = this.findById(userId, id)
    if (!atual) return undefined

    const updated_at = new Date().toISOString()
    this.db
      .prepare('UPDATE automation SET enabled = ?, updated_at = ? WHERE user_id = ? AND id = ?')
      .run(enabled ? 1 : 0, updated_at, userId, id)

    log.db.info('Automação ativada/desativada', { op: 'update', table: 'automation', enabled })
    return { ...atual, enabled, updated_at }
  }

  remove(userId: string, id: string): boolean {
    const info = this.db
      .prepare('DELETE FROM automation WHERE user_id = ? AND id = ?')
      .run(userId, id)
    log.db.info('Automação removida', { op: 'delete', table: 'automation' })
    return info.changes > 0
  }
}
