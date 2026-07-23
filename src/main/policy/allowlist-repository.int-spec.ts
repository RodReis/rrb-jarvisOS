/**
 * Allowlist persistida contra o SQLite real (SPEC-Execucao-03, categoria Banco).
 *
 * Prova o default de fábrica (critério 1), o escopo por usuário (critério 1), e que
 * adicionar/remover gera `AuditEvent` encadeado com a cadeia íntegra (critério 3).
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { AllowlistRepository } = await import('./allowlist-repository')

let dir: string
let appDir: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let allow: InstanceType<typeof AllowlistRepository>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-allowrepo-'))
  // O appDir precisa ser um caminho absoluto plausível; usamos um sob o tmp.
  appDir = join(dir, 'userData')
  db = openDatabase(join(dir, 'teste.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  allow = new AllowlistRepository(db, audit, appDir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('default de fábrica e escopo (critério 1)', () => {
  it('usuário sem entradas explícitas tem exatamente o appDir permitido', () => {
    expect(allow.list('u-1')).toEqual([appDir])
  })

  it('a allowlist é escopada por usuário', () => {
    allow.add('u-1', join(dir, 'projeto-a'))
    // u-2 não enxerga a entrada de u-1 — só o próprio default.
    expect(allow.list('u-2')).toEqual([appDir])
    expect(allow.list('u-1')).toContain(join(dir, 'projeto-a'))
    expect(allow.list('u-1')).toContain(appDir)
  })
})

describe('add/remove auditado e encadeado (critério 3)', () => {
  it('adicionar gera um AuditEvent e a cadeia fica íntegra', () => {
    allow.add('u-1', join(dir, 'projeto-a'))

    const eventos = audit.list('u-1')
    expect(eventos).toHaveLength(1)
    expect(eventos[0]?.type).toBe('allowlist-change')
    expect(eventos[0]?.payload).toMatchObject({ op: 'add' })
    expect(audit.verify('u-1').ok).toBe(true)
  })

  it('remover gera outro AuditEvent; N edições ⇒ N eventos, cadeia íntegra', () => {
    const alvo = join(dir, 'projeto-a')
    allow.add('u-1', alvo)
    allow.remove('u-1', alvo)

    expect(audit.list('u-1')).toHaveLength(2)
    expect(audit.verify('u-1').ok).toBe(true)
    expect(allow.list('u-1')).toEqual([appDir]) // voltou ao default
  })
})

describe('idempotência — no-op não audita', () => {
  it('re-adicionar o mesmo diretório não cria linha nem evento', () => {
    const alvo = join(dir, 'projeto-a')
    const primeiro = allow.add('u-1', alvo)
    const segundo = allow.add('u-1', alvo)

    expect(primeiro.added).toBe(true)
    expect(segundo.added).toBe(false)
    expect(audit.list('u-1')).toHaveLength(1) // só a primeira auditou
  })

  it('adicionar o próprio appDir é no-op (já é permitido por construção)', () => {
    const r = allow.add('u-1', appDir)
    expect(r.added).toBe(false)
    expect(audit.list('u-1')).toHaveLength(0)
    expect(allow.list('u-1')).toEqual([appDir])
  })

  it('remover um diretório ausente é no-op e não audita', () => {
    const r = allow.remove('u-1', join(dir, 'nunca-adicionado'))
    expect(r.removed).toBe(false)
    expect(audit.list('u-1')).toHaveLength(0)
  })

  it('remover o appDir é no-op — o default não é removível', () => {
    const r = allow.remove('u-1', appDir)
    expect(r.removed).toBe(false)
    expect(allow.list('u-1')).toEqual([appDir])
  })
})
