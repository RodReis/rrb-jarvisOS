/**
 * Repositórios de `UserProfile` e `Session` (SPEC-Fundacao-04).
 *
 * Toda consulta é **escopada por `user_id`** — não existe "listar tudo". O isolamento
 * multiusuário do `CONVENTION.md` §2 só vale se a query não tiver como esquecer o escopo,
 * e a forma de garantir isso é não expor método que o dispense.
 */

import type { Database } from 'better-sqlite3'
import type { Locale, Session, UserProfile } from '@shared/domain/entities'
import { log } from '../logging/logger'

interface ProfileRow {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly locale: string
}

export class UserProfileRepository {
  constructor(private readonly db: Database) {}

  /** Insere ou atualiza o perfil. Idempotente: relogar não duplica usuário. */
  save(profile: UserProfile): UserProfile {
    try {
      this.db
        .prepare(
          `INSERT INTO user_profile (id, name, email, locale) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email,
                                         locale = excluded.locale`
        )
        .run(profile.id, profile.name, profile.email, profile.locale)

      log.db.info('Perfil de usuário gravado', { op: 'upsert', table: 'user_profile' })
      return profile
    } catch (error) {
      log.db.error('Falha ao gravar perfil de usuário', {
        op: 'upsert',
        table: 'user_profile',
        error
      })
      throw error
    }
  }

  findById(id: string): UserProfile | undefined {
    const row = this.db.prepare('SELECT * FROM user_profile WHERE id = ?').get(id) as
      ProfileRow | undefined

    return row ? { ...row, locale: row.locale as Locale } : undefined
  }
}

export class SessionRepository {
  constructor(private readonly db: Database) {}

  /**
   * Grava os metadados da sessão. **Nenhum token passa por aqui** — o segredo vive cifrado
   * no `safeStorage`/DPAPI (SPEC-03). Esta tabela responde "até quando a sessão vale", não
   * "qual é a credencial dela".
   */
  save(session: Session): Session {
    try {
      this.db
        .prepare(
          `INSERT INTO session (id, user_id, expires_at, last_online_auth_at, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET expires_at = excluded.expires_at,
                                         last_online_auth_at = excluded.last_online_auth_at`
        )
        .run(
          session.id,
          session.user_id,
          session.expires_at,
          session.last_online_auth_at,
          session.created_at
        )

      log.db.info('Sessão gravada', { op: 'upsert', table: 'session' })
      return session
    } catch (error) {
      log.db.error('Falha ao gravar sessão', { op: 'upsert', table: 'session', error })
      throw error
    }
  }

  /** Sessão mais recente do usuário, ou `undefined`. Sempre escopada. */
  findActive(userId: string): Session | undefined {
    return this.db
      .prepare('SELECT * FROM session WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(userId) as Session | undefined
  }

  /** Logout apaga os metadados da sessão. Sessão não é auditoria — pode ser removida. */
  deleteForUser(userId: string): number {
    try {
      const info = this.db.prepare('DELETE FROM session WHERE user_id = ?').run(userId)
      log.db.info('Sessões removidas', {
        op: 'delete',
        table: 'session',
        quantidade: info.changes
      })
      return info.changes
    } catch (error) {
      log.db.error('Falha ao remover sessões', { op: 'delete', table: 'session', error })
      throw error
    }
  }
}
