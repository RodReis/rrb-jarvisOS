/**
 * Troca de espaço ponta a ponta, contra o SQLite real (categoria "Banco").
 *
 * Prova o critério 4 da SPEC-04 na parte que já existe: a troca de workspace gera
 * `AuditEvent` **correto e encadeado**. `login`/`logout` entram na F03, quando o auth
 * nascer; o tipo já está no contrato e a infra é a mesma exercitada aqui.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const setCurrentWorkspace = vi.fn()
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: (...args: unknown[]) => setCurrentWorkspace(...args)
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { WorkspaceService, WORKSPACE_INICIAL } = await import('./workspace-service')

let dir: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let service: InstanceType<typeof WorkspaceService>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-ws-'))
  db = openDatabase(join(dir, 'teste.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  logCat.info.mockClear()
  setCurrentWorkspace.mockClear()
  service = new WorkspaceService(audit, 'u-1')
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('WorkspaceService', () => {
  it('abre sempre no JARVIS OS (decisão do PI na SPEC-02)', () => {
    expect(service.atual()).toBe('jarvis')
    expect(WORKSPACE_INICIAL).toBe('jarvis')
  })

  it('gera AuditEvent correto e encadeado na troca (SPEC-04, critério 4)', () => {
    service.trocar('noa')
    service.trocar('jarvis')

    const eventos = audit.list('u-1')

    expect(eventos).toHaveLength(2)
    expect(eventos[0]).toMatchObject({
      type: 'workspace-switch',
      workspace_id: 'noa',
      seq: 1,
      prev_hash: 'genesis',
      payload: { de: 'jarvis', para: 'noa' }
    })
    expect(eventos[1]).toMatchObject({ seq: 2, prev_hash: eventos[0]?.hash })
    expect(audit.verify('u-1')).toEqual({ ok: true, checked: 2 })
  })

  it('etiqueta o logger com o espaço novo (ADR-005)', () => {
    service.trocar('noa')

    expect(setCurrentWorkspace).toHaveBeenLastCalledWith('noa')
  })

  it('emite info na categoria ipc com o destino em ctx (SPEC-02, critério 7)', () => {
    service.trocar('noa')

    expect(logCat.info).toHaveBeenCalledWith(
      'Espaço de trabalho alternado',
      expect.objectContaining({ de: 'jarvis', para: 'noa' })
    )
  })

  it('não troca o espaço quando a auditoria falha', () => {
    // Auditoria que pode ser pulada porque o disco falhou não é evidência (ADR-004).
    // O trigger impede DELETE, então derrubo a tabela para simular falha de gravação.
    db.exec('DROP TRIGGER audit_event_sem_delete; DROP TRIGGER audit_event_sem_update')
    db.exec('DROP TABLE audit_event')

    expect(() => service.trocar('noa')).toThrow()
    expect(service.atual()).toBe('jarvis')
  })
})
