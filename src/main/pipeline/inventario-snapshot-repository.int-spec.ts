import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { comporInventario, type InventarioGlobal, type NoInventario } from './inventario-global'

const logDb = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({ log: new Proxy({}, { get: () => logDb }) }))

const { openDatabase } = await import('../storage/database')
const { InventarioSnapshotRepository } = await import('./inventario-snapshot-repository')
const { InventarioGlobalService } = await import('./inventario-global-service')

let dir: string
let db: Db
let repository: InstanceType<typeof InventarioSnapshotRepository>
const escopo = { userId: 'u1', workspaceId: 'jarvis' as const, projectId: 'global' }
const no: NoInventario = {
  id: 'm1',
  tipo: 'mvp',
  numero: 1,
  titulo: 'MVP 1',
  dependeDe: [],
  estadoTecnico: 'pendente',
  spec: { estado: 'aprovada', revisaoAtual: 'rev-1', revisaoAprovada: 'rev-1' },
  gateAprovado: true,
  bloqueado: false
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-inventario-'))
  db = openDatabase(join(dir, 'teste.db'))
  repository = new InventarioSnapshotRepository(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('InventarioRepository', () => {
  it('reconstrói o snapshot e fingerprint depois de reabrir o SQLite', () => {
    const esperado = comporInventario([no])
    repository.salvar(escopo, esperado, '2026-10-08T12:00:00.000Z')
    db.close()
    db = openDatabase(join(dir, 'teste.db'))
    repository = new InventarioSnapshotRepository(db)

    expect(repository.carregar(escopo)).toEqual({
      inventario: esperado,
      observadoEm: '2026-10-08T12:00:00.000Z'
    })
  })

  it('isola o snapshot por usuário, workspace e projeto', () => {
    repository.salvar(escopo, comporInventario([no]))
    expect(repository.carregar({ ...escopo, userId: 'u2' })).toBeUndefined()
    expect(repository.carregar({ ...escopo, workspaceId: 'noa' as const })).toBeUndefined()
    expect(repository.carregar({ ...escopo, projectId: 'other' })).toBeUndefined()
  })

  it('descarta payload corrompido para obrigar reconstrução pelas fontes', () => {
    repository.salvar(escopo, comporInventario([no]))
    db.prepare("UPDATE dag_inventory_snapshot SET payload = '{' WHERE project_id = ?").run(
      escopo.projectId
    )
    expect(repository.carregar(escopo)).toBeUndefined()
    expect(logDb.warn).toHaveBeenCalled()
  })

  it('recalcula o estado persistido para rejeitar ordem e diagnósticos adulterados', () => {
    repository.salvar(escopo, comporInventario([no]))
    const linha = (): { payload: string } =>
      db
        .prepare('SELECT payload FROM dag_inventory_snapshot WHERE project_id = ?')
        .get(escopo.projectId) as { payload: string }
    const salvarPayload = (payload: unknown): void => {
      db.prepare('UPDATE dag_inventory_snapshot SET payload = ? WHERE project_id = ?').run(
        JSON.stringify(payload),
        escopo.projectId
      )
    }

    const ordemAdulterada = JSON.parse(linha().payload) as InventarioGlobal
    salvarPayload({ ...ordemAdulterada, ordem: ['outro-no'] })
    expect(repository.carregar(escopo)).toBeUndefined()

    repository.salvar(escopo, comporInventario([no]))
    const diagnosticoAdulterado = JSON.parse(linha().payload) as InventarioGlobal
    salvarPayload({
      ...diagnosticoAdulterado,
      diagnosticos: [
        { codigo: 'item-orfao', envolvidos: ['M13-F99'], mensagem: 'diagnóstico adulterado' }
      ]
    })
    expect(repository.carregar(escopo)).toBeUndefined()
  })

  it('persiste apenas coleta completa e mantém snapshot anterior se GitHub falhar', async () => {
    let completa = true
    const service = new InventarioGlobalService(
      {
        lerLocal: async () => ({ nos: [no], revisao: 'a'.repeat(64) }),
        lerGithub: async () => ({
          nos: [{ id: 'm1', estadoTecnico: 'pendente' as const }],
          revisao: 'b'.repeat(64),
          completa
        })
      },
      repository,
      () => '2026-10-08T12:00:00.000Z'
    )

    const primeiro = await service.reconciliar(escopo)
    completa = false
    await expect(service.reconciliar(escopo)).rejects.toThrow('Coleta GitHub incompleta')
    expect(repository.carregar(escopo)?.inventario).toEqual(primeiro)
  })
})
