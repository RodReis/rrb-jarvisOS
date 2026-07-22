/**
 * Repositório de auditoria (ADR-004).
 *
 * A superfície é deliberadamente pobre: `append`, `list` e `verify`. **Não existe** update
 * nem delete — é a camada 1 do ADR-004 do lado da API, complementando o trigger do lado do
 * storage. Um método de alteração aqui tornaria o trigger a única defesa, e defesa em
 * profundidade é o ponto.
 */

import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import { GENESIS_HASH, computeHash, verifyChain, type ChainVerification } from './audit-chain'
import type { AuditEvent, AuditEventInput, WorkspaceId } from '@shared/domain/entities'
import { log } from '../logging/logger'

/** Linha crua do SQLite: `payload` é TEXT e `workspace_id` pode ser NULL. */
interface AuditRow {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: string | null
  readonly type: string
  readonly payload: string
  readonly created_at: string
  readonly seq: number
  readonly prev_hash: string
  readonly hash: string
}

function toEvent(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    user_id: row.user_id,
    ...(row.workspace_id ? { workspace_id: row.workspace_id as WorkspaceId } : {}),
    type: row.type as AuditEvent['type'],
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    created_at: row.created_at,
    seq: row.seq,
    prev_hash: row.prev_hash,
    hash: row.hash
  }
}

export class AuditRepository {
  /**
   * A chave HMAC entra pelo construtor — em produção vem do `safeStorage`/DPAPI (SPEC-03),
   * em teste é fixa. Ler `safeStorage` aqui prenderia o repositório ao Electron e tornaria
   * o critério 3 (forja ao vivo → `verifyChain` acusa) impossível de exercitar em teste.
   */
  constructor(
    private readonly db: Database,
    private readonly hmacKey: Buffer | string
  ) {}

  /**
   * Acrescenta um evento à cadeia do usuário. Transacional de propósito: ler o último
   * `seq`/`hash` e inserir o próximo precisa ser atômico, senão duas gravações concorrentes
   * leriam o mesmo antecessor e criariam dois ramos da cadeia — que o `UNIQUE(user_id, seq)`
   * então rejeitaria, mas só depois de já ter computado o hash errado.
   */
  append(input: AuditEventInput): AuditEvent {
    const inserir = this.db.transaction((entrada: AuditEventInput): AuditEvent => {
      const anterior = this.db
        .prepare('SELECT seq, hash FROM audit_event WHERE user_id = ? ORDER BY seq DESC LIMIT 1')
        .get(entrada.user_id) as { seq: number; hash: string } | undefined

      const semHash = {
        id: randomUUID(),
        user_id: entrada.user_id,
        ...(entrada.workspace_id ? { workspace_id: entrada.workspace_id } : {}),
        type: entrada.type,
        payload: entrada.payload ?? {},
        created_at: new Date().toISOString(),
        seq: (anterior?.seq ?? 0) + 1,
        prev_hash: anterior?.hash ?? GENESIS_HASH
      }

      const evento: AuditEvent = { ...semHash, hash: computeHash(semHash, this.hmacKey) }

      this.db
        .prepare(
          `INSERT INTO audit_event
             (id, user_id, workspace_id, type, payload, created_at, seq, prev_hash, hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          evento.id,
          evento.user_id,
          evento.workspace_id ?? null,
          evento.type,
          JSON.stringify(evento.payload),
          evento.created_at,
          evento.seq,
          evento.prev_hash,
          evento.hash
        )

      return evento
    })

    try {
      const evento = inserir(input)
      log.db.info('Evento de auditoria registrado', {
        op: 'insert',
        table: 'audit_event',
        tipo: evento.type,
        seq: evento.seq
      })
      return evento
    } catch (error) {
      log.db.error('Falha ao registrar evento de auditoria', {
        op: 'insert',
        table: 'audit_event',
        tipo: input.type,
        error
      })
      throw error
    }
  }

  /** Eventos do usuário em ordem de cadeia. Escopado por `user_id` — nunca lista tudo. */
  list(userId: string, workspaceId?: WorkspaceId): readonly AuditEvent[] {
    const rows = workspaceId
      ? (this.db
          .prepare('SELECT * FROM audit_event WHERE user_id = ? AND workspace_id = ? ORDER BY seq')
          .all(userId, workspaceId) as AuditRow[])
      : (this.db
          .prepare('SELECT * FROM audit_event WHERE user_id = ? ORDER BY seq')
          .all(userId) as AuditRow[])

    return rows.map(toEvent)
  }

  /**
   * Recomputa a cadeia do usuário (ADR-004, camada 3).
   *
   * Lê sempre a cadeia **completa** do usuário, ignorando filtro de workspace: a cadeia é
   * por `user_id`, e verificar um recorte dela acusaria quebra falsa no primeiro evento de
   * outro espaço.
   */
  verify(userId: string): ChainVerification {
    const eventos = this.list(userId)
    const resultado = verifyChain(eventos, this.hmacKey)

    if (!resultado.ok) {
      log.db.error('Cadeia de auditoria quebrada', {
        op: 'verify',
        table: 'audit_event',
        seq: resultado.brokenAt,
        motivo: resultado.reason
      })
    }

    return resultado
  }
}
