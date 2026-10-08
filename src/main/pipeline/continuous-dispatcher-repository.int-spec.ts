import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@shared/domain/entities'
import { comporInventario, type NoInventario } from './inventario-global'

const logDb = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({ log: new Proxy({}, { get: () => logDb }) }))

const { openDatabase } = await import('../storage/database')
const { ContinuousDispatcherRepositorySqlite } = await import('./continuous-dispatcher-repository')

let dir: string
let db: Db
let repo: InstanceType<typeof ContinuousDispatcherRepositorySqlite>
const scope = { userId: 'u1', workspaceId: 'jarvis' as WorkspaceId, projectId: 'p1' }
const node: NoInventario = {
  id: 'MVP13-F02',
  tipo: 'fatia',
  mvpId: 'MVP13',
  numero: 2,
  titulo: 'Dispatcher',
  dependeDe: [],
  estadoTecnico: 'pendente',
  spec: { estado: 'aprovada', revisaoAtual: 'a'.repeat(64), revisaoAprovada: 'a'.repeat(64) },
  gateAprovado: true,
  bloqueado: false
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-dispatch-'))
  db = openDatabase(join(dir, 'teste.db'))
  repo = new ContinuousDispatcherRepositorySqlite(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('ContinuousDispatcherRepositorySqlite', () => {
  it('preserva cursor, run e espera depois de reabrir o SQLite', () => {
    const inventario = comporInventario([node])
    const decisao = {
      idempotencyKey: 'dispatch-key-1',
      dagFingerprint: inventario.fingerprint,
      nodeId: node.id,
      runId: 'run-1',
      estado: 'waiting' as const,
      causa: 'quota',
      retomarEm: '2026-10-08T13:00:00.000Z'
    }
    repo.cursor(scope, inventario.fingerprint, '2026-10-08T12:00:00.000Z')
    repo.gravar(scope, decisao, '2026-10-08T12:00:00.000Z')
    db.close()
    db = openDatabase(join(dir, 'teste.db'))
    repo = new ContinuousDispatcherRepositorySqlite(db)

    expect(repo.buscar(scope, decisao.idempotencyKey)).toEqual(decisao)
    expect(
      db
        .prepare('SELECT dag_fingerprint FROM continuous_dispatch_cursor WHERE project_id = ?')
        .get(scope.projectId)
    ).toEqual({ dag_fingerprint: inventario.fingerprint })
  })

  it('separa decisões por usuário, workspace e projeto', () => {
    const decisao = {
      idempotencyKey: 'key',
      dagFingerprint: 'a'.repeat(64),
      estado: 'drained' as const
    }
    repo.gravar(scope, decisao, '2026-10-08T12:00:00.000Z')
    expect(repo.buscar({ ...scope, userId: 'u2' }, 'key')).toBeUndefined()
    expect(repo.buscar({ ...scope, workspaceId: 'noa' as const }, 'key')).toBeUndefined()
    expect(repo.buscar({ ...scope, projectId: 'p2' }, 'key')).toBeUndefined()
  })
})
