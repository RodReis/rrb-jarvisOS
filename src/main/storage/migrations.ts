/**
 * Migrations do SQLite local, versionadas por `PRAGMA user_version`.
 *
 * Regra que governa este arquivo (SPEC-Fundacao-04): **migration preserva dado**. O log de
 * auditoria é evidência; zerá-lo por evolução de schema destruiria exatamente aquilo que o
 * ADR-004 existe para proteger. Portanto: só se acrescenta migration ao fim do array —
 * nunca se edita nem se reordena uma já publicada, porque bancos existentes já a aplicaram
 * e não a rodariam de novo.
 */

import type { Database } from 'better-sqlite3'

/** Uma migration é SQL puro; o índice no array + 1 é o `user_version` que ela produz. */
const MIGRATIONS: readonly string[] = [
  // 1 — entidades mínimas da fundação + auditoria tamper-evident.
  `
  CREATE TABLE user_profile (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL,
    locale      TEXT NOT NULL DEFAULT 'pt-BR'
  );

  -- Metadados da sessão. O token NÃO entra aqui: mora cifrado no safeStorage (SPEC-03).
  CREATE TABLE session (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    expires_at          TEXT NOT NULL,
    last_online_auth_at TEXT NOT NULL,
    created_at          TEXT NOT NULL
  );
  CREATE INDEX idx_session_user ON session(user_id);

  CREATE TABLE audit_event (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    workspace_id TEXT,
    type         TEXT NOT NULL,
    payload      TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    seq          INTEGER NOT NULL,
    prev_hash    TEXT NOT NULL,
    hash         TEXT NOT NULL,
    -- Garante no storage que o seq é monotônico por usuário: uma segunda gravação
    -- concorrente com o mesmo seq falha aqui em vez de criar dois ramos da cadeia.
    UNIQUE (user_id, seq)
  );
  CREATE INDEX idx_audit_user_seq ON audit_event(user_id, seq);

  -- ADR-004, camada 1: PREVENIR na camada de storage. A via de escrita só faz INSERT;
  -- estes triggers fazem qualquer UPDATE/DELETE abortar, inclusive vindo de fora do app
  -- (um cliente SQLite qualquer). Sem eles, "imutável" seria só uma promessa da API.
  CREATE TRIGGER audit_event_sem_update
    BEFORE UPDATE ON audit_event
  BEGIN
    SELECT RAISE(ABORT, 'audit_event é append-only: UPDATE bloqueado (ADR-004)');
  END;

  CREATE TRIGGER audit_event_sem_delete
    BEFORE DELETE ON audit_event
  BEGIN
    SELECT RAISE(ABORT, 'audit_event é append-only: DELETE bloqueado (ADR-004)');
  END;
  `
]

/** Versão de schema que o código atual espera. */
export const SCHEMA_VERSION = MIGRATIONS.length

/**
 * Aplica as migrations pendentes e devolve quantas rodaram.
 *
 * Cada migration roda dentro de uma transação junto com o bump do `user_version`: se o SQL
 * falhar no meio, o banco volta ao estado anterior em vez de ficar meio-migrado — que é o
 * cenário em que "preserva dado" se perde na prática.
 */
export function migrate(db: Database): number {
  const current = db.pragma('user_version', { simple: true }) as number

  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Banco na versão ${current}, mais novo que a versão ${SCHEMA_VERSION} suportada por este código. ` +
        'Abrir assim arriscaria corromper dado gravado por uma versão posterior do app.'
    )
  }

  let applied = 0
  for (let version = current; version < SCHEMA_VERSION; version += 1) {
    const sql = MIGRATIONS[version]
    if (!sql) continue

    // `pragma user_version` não aceita bind parameter; o valor é um índice de array
    // controlado por nós, nunca entrada externa.
    db.transaction(() => {
      db.exec(sql)
      db.pragma(`user_version = ${version + 1}`)
    })()

    applied += 1
  }

  return applied
}
