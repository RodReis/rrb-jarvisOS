/**
 * Repositórios de `UserProfile` e `Session` (SPEC-Fundacao-04).
 *
 * Toda consulta é **escopada por `user_id`** — não existe "listar tudo". O isolamento
 * multiusuário do `CONVENTION.md` §2 só vale se a query não tiver como esquecer o escopo,
 * e a forma de garantir isso é não expor método que o dispense.
 */

import type { Database } from 'better-sqlite3'
import type {
  Locale,
  Session,
  ThemePreference,
  UserPreferences,
  UserProfile
} from '@shared/domain/entities'
import { log } from '../logging/logger'

interface ProfileRow {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly locale: string
  readonly theme: string
}

function toProfile(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    locale: row.locale as Locale,
    theme: row.theme as ThemePreference
  }
}

export class UserProfileRepository {
  constructor(private readonly db: Database) {}

  /**
   * Insere o perfil, ou atualiza **só a identidade** de quem já existe.
   *
   * `locale` e `theme` ficam de fora do UPDATE de propósito: o main chama isto a cada
   * boot com o perfil padrão, e sobrescrever as preferências ali apagaria a escolha do
   * usuário a cada reinício — o oposto do critério 1 da SPEC-05 ("persiste entre
   * sessões"). Preferência se altera por `savePreferences`, que é a via explícita.
   */
  save(profile: UserProfile): UserProfile {
    try {
      this.db
        .prepare(
          `INSERT INTO user_profile (id, name, email, locale, theme) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email`
        )
        .run(profile.id, profile.name, profile.email, profile.locale, profile.theme)

      log.db.info('Perfil de usuário gravado', { op: 'upsert', table: 'user_profile' })
      return this.findById(profile.id) ?? profile
    } catch (error) {
      log.db.error('Falha ao gravar perfil de usuário', {
        op: 'upsert',
        table: 'user_profile',
        error
      })
      throw error
    }
  }

  /**
   * Altera as preferências de **um** usuário (SPEC-05).
   *
   * `COALESCE` mantém o valor atual quando o campo não vem: a UI muda idioma e tema
   * separadamente, e um `undefined` não pode virar `NULL` numa coluna `NOT NULL`.
   * O `WHERE id = ?` é o que garante o critério 3 — preferência de um usuário nunca
   * toca a de outro.
   */
  savePreferences(userId: string, preferences: UserPreferences): UserProfile | undefined {
    try {
      this.db
        .prepare(
          `UPDATE user_profile
              SET locale = COALESCE(?, locale),
                  theme  = COALESCE(?, theme)
            WHERE id = ?`
        )
        .run(preferences.locale ?? null, preferences.theme ?? null, userId)

      log.db.info('Preferências do usuário gravadas', {
        op: 'update',
        table: 'user_profile',
        // Qual preferência mudou é diagnóstico útil; o valor não é sensível.
        campos: Object.keys(preferences).join(',')
      })

      return this.findById(userId)
    } catch (error) {
      log.db.error('Falha ao gravar preferências do usuário', {
        op: 'update',
        table: 'user_profile',
        error
      })
      throw error
    }
  }

  findById(id: string): UserProfile | undefined {
    const row = this.db.prepare('SELECT * FROM user_profile WHERE id = ?').get(id) as
      ProfileRow | undefined

    return row ? toProfile(row) : undefined
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

  /**
   * A sessão mais recente do banco, sem escopo de usuário.
   *
   * Exceção deliberada à regra "toda consulta é escopada", e a única aqui: no boot o app
   * precisa descobrir **de quem** é a sessão guardada, e perguntar isso já sabendo o
   * `user_id` seria circular. O isolamento não é violado porque o login apaga as sessões
   * anteriores (`deleteForUser` em `concluirLogin`) — existe no máximo uma linha por vez.
   * Alternativa descartada: decodificar o JWT do cofre, que faria o app confiar no
   * conteúdo de um token que quem valida é o Supabase.
   */
  findMostRecent(): Session | undefined {
    return this.db.prepare('SELECT * FROM session ORDER BY created_at DESC LIMIT 1').get() as
      | Session
      | undefined
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
