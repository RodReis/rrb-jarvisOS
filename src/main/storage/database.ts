/**
 * Abertura do banco local (SPEC-Fundacao-04).
 *
 * SQLite é a **fonte de verdade operacional** do app (ADR-001); o Supabase é espelho de
 * sync, nunca o contrário. O arquivo vive no `userData` do Electron — fora do repo, junto
 * com os logs.
 *
 * O caminho entra por parâmetro para este módulo não depender do Electron: em teste é um
 * arquivo temporário, em produção é `userData/jarvis.db`.
 */

import Database from 'better-sqlite3'
import type { Database as Db } from 'better-sqlite3'
import { log } from '../logging/logger'
import { migrate } from './migrations'

export function openDatabase(filePath: string): Db {
  try {
    const db = new Database(filePath)

    // WAL: leitura não bloqueia escrita. Num app desktop com o main escrevendo e consultas
    // vindas do IPC, o modo padrão (rollback journal) serializaria tudo.
    db.pragma('journal_mode = WAL')
    // FKs não são ligadas por padrão no SQLite — sem isto, restrição declarada é decorativa.
    db.pragma('foreign_keys = ON')

    const applied = migrate(db)
    if (applied > 0) {
      log.db.info('Migrations aplicadas ao banco local', { quantidade: applied })
    }

    return db
  } catch (error) {
    // `ctx.op` e `ctx.table` sem valor sensível — contrato de logging (CONVENTION §3).
    log.db.error('Falha ao abrir o banco local', { op: 'open', error })
    throw error
  }
}
