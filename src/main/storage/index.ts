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
import { ReleaseRepository } from '../release/release-repository'

export interface Storage {
  readonly db: Database
  readonly audit: AuditRepository
  readonly profiles: UserProfileRepository
  readonly sessions: SessionRepository
  readonly releases: ReleaseRepository
}

let storage: Storage | undefined

/** Idempotente: chamar de novo devolve a instância existente. */
export function initStorage(userDataDir: string): Storage {
  if (storage) return storage

  const db = openDatabase(join(userDataDir, 'jarvis.db'))
  const chave = loadOrCreateAuditKey(join(userDataDir, 'audit.key'))
  const audit = new AuditRepository(db, chave)

  storage = {
    db,
    audit,
    profiles: new UserProfileRepository(db),
    sessions: new SessionRepository(db),
    releases: new ReleaseRepository(db, audit)
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

export type { AuditRepository, SessionRepository, UserProfileRepository, ReleaseRepository }
