/**
 * Composição do storage: abre o banco, destrava a chave e monta os repositórios.
 *
 * Existe para o `main/index.ts` não virar uma sequência de construtores, e para que o
 * resto do main dependa de `getStorage()` em vez de saber montar as peças.
 */

import { join } from 'node:path'
import type { Database } from 'better-sqlite3'
import { AuditRepository } from './audit-repository'
import { loadOrCreateAuditKey } from './audit-key'
import { openDatabase } from './database'
import { SessionRepository, UserProfileRepository } from './repositories'

export interface Storage {
  readonly db: Database
  readonly audit: AuditRepository
  readonly profiles: UserProfileRepository
  readonly sessions: SessionRepository
}

let storage: Storage | undefined

/** Idempotente: chamar de novo devolve a instância existente. */
export function initStorage(userDataDir: string): Storage {
  if (storage) return storage

  const db = openDatabase(join(userDataDir, 'jarvis.db'))
  const chave = loadOrCreateAuditKey(join(userDataDir, 'audit.key'))

  storage = {
    db,
    audit: new AuditRepository(db, chave),
    profiles: new UserProfileRepository(db),
    sessions: new SessionRepository(db)
  }

  return storage
}

/** Lança se chamado antes do `initStorage` — falhar alto é melhor que gravar no vazio. */
export function getStorage(): Storage {
  if (!storage) throw new Error('Storage não inicializado: chame initStorage() antes.')
  return storage
}

export function closeStorage(): void {
  storage?.db.close()
  storage = undefined
}

export type { AuditRepository, SessionRepository, UserProfileRepository }
