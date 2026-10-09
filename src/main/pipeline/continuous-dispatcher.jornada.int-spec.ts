import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@shared/domain/entities'
import type { EscopoDoInventario } from './inventario-snapshot-repository'
import { comporInventario, type NoInventario } from './inventario-global'
import { ContinuousDispatcher, type ContinuousDispatcherRepository } from './continuous-dispatcher'

const logDb = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({ log: new Proxy({}, { get: () => logDb }) }))

const { openDatabase } = await import('../storage/database')
const { ContinuousDispatcherRepositorySqlite } = await import('./continuous-dispatcher-repository')

const scope: EscopoDoInventario = {
  userId: 'u1',
  workspaceId: 'jarvis' as WorkspaceId,
  projectId: 'journey'
}
const revision = 'a'.repeat(64)
const mvp = (number: number): NoInventario => ({
  id: `MVP${number}`,
  tipo: 'mvp',
  numero: number,
  titulo: `MVP ${number}`,
  dependeDe: [],
  estadoTecnico: 'mergeado',
  spec: { estado: 'desconhecida' },
  gateAprovado: true,
  bloqueado: false
})
const slice = (
  mvpNumber: number,
  number: number,
  dependencies: readonly string[] = [],
  gateApproved = true
): NoInventario => ({
  id: `MVP${mvpNumber}-F${String(number).padStart(2, '0')}`,
  tipo: 'fatia',
  mvpId: `MVP${mvpNumber}`,
  numero: mvpNumber * 100 + number,
  titulo: `MVP ${mvpNumber} fatia ${number}`,
  dependeDe: dependencies,
  estadoTecnico: 'pendente',
  spec: { estado: 'aprovada', revisaoAtual: revision, revisaoAprovada: revision },
  gateAprovado: gateApproved,
  bloqueado: false,
  issue: { numero: mvpNumber * 100 + number, aberta: true, labels: ['proplan:todo'] }
})

let directory: string
let db: Db
let repository: ContinuousDispatcherRepository
let nodes: NoInventario[]
let runsByKey: Map<string, { id: string; estado: string; sliceId: string }>
let createdRunCount: number
let falharAposCriarRun: boolean

function createDispatcher(): ContinuousDispatcher {
  return new ContinuousDispatcher({
    inventario: { reconciliar: async () => comporInventario(nodes) },
    repository,
    sliceId: (_scope, node) => node.id,
    runs: {
      listarDaFatia: (_scope, sliceId) =>
        [...runsByKey.values()].filter((run) => run.sliceId === sliceId),
      buscarPorChaveDispatch: (_scope, key) => {
        const run = runsByKey.get(key)
        return run === undefined ? undefined : { id: run.id, estado: run.estado }
      }
    },
    play: async (_scope, sliceId, idempotencyKey) => {
      const dispatchKey = `${idempotencyKey}:${sliceId}`
      let run = runsByKey.get(dispatchKey)
      if (run === undefined) {
        createdRunCount += 1
        run = { id: `run-${createdRunCount}`, estado: 'RUNNING', sliceId }
        runsByKey.set(dispatchKey, run)
        if (falharAposCriarRun) {
          falharAposCriarRun = false
          throw new Error('Confirmação perdida depois da criação do run.')
        }
      }
      return { runId: run.id, estado: 'iniciado', mensagem: 'run reconciliado' }
    },
    agora: () => new Date('2026-10-08T12:00:00.000Z')
  })
}

function restartPersistence(): void {
  db.close()
  db = openDatabase(join(directory, 'journey.db'))
  repository = new ContinuousDispatcherRepositorySqlite(db)
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'jarvis-m13-f05-'))
  db = openDatabase(join(directory, 'journey.db'))
  repository = new ContinuousDispatcherRepositorySqlite(db)
  nodes = [
    mvp(12),
    mvp(13),
    { ...slice(12, 1), estadoTecnico: 'mergeado' },
    slice(12, 2, ['MVP12-F01']),
    { ...slice(12, 3, ['MVP12-F01']), estadoTecnico: 'mergeado' },
    slice(13, 1, ['MVP12-F02'])
  ]
  runsByKey = new Map()
  createdRunCount = 0
  falharAposCriarRun = true
})

afterEach(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('jornada multi-MVP do dispatcher', () => {
  it('atravessa MVPs após merge reconciliado e retoma sem duplicar run após reinício', async () => {
    let dispatcher = createDispatcher()

    await expect(dispatcher.reconciliar(scope)).rejects.toThrow('Confirmação perdida')
    expect(createdRunCount).toBe(1)

    restartPersistence()
    dispatcher = createDispatcher()
    const resumed = await dispatcher.reconciliar(scope)
    expect(resumed.estado).toBe('waiting')
    expect(createdRunCount).toBe(1)

    runsByKey.get([...runsByKey.keys()][0]!)!.estado = 'MERGED'
    nodes = nodes.map((node) =>
      node.id === 'MVP12-F02' ? { ...node, estadoTecnico: 'mergeado' } : node
    )
    const acrossBoundary = await dispatcher.reconciliar(scope)
    expect(acrossBoundary.estado).toBe('dispatched')
    expect(acrossBoundary.decisoes.map((decision) => decision.nodeId)).toContain('MVP13-F01')
    expect(createdRunCount).toBe(2)

    nodes = nodes.map((node) =>
      node.id === 'MVP13-F01' ? { ...node, estadoTecnico: 'mergeado' } : node
    )
    runsByKey.get([...runsByKey.keys()][1]!)!.estado = 'MERGED'
    const drained = await dispatcher.reconciliar(scope)
    expect(drained.estado).toBe('drained')
    expect(createdRunCount).toBe(2)
  })

  it('mantém ramo com gate pendente bloqueado e continua o ramo independente aprovado', async () => {
    falharAposCriarRun = false
    nodes = [mvp(12), { ...slice(12, 1), gateAprovado: false }, slice(12, 2)]
    const result = await createDispatcher().reconciliar(scope)

    expect(result.estado).toBe('dispatched')
    expect(result.decisoes.map((decision) => decision.nodeId)).toContain('MVP12-F02')
    expect(createdRunCount).toBe(1)
    expect(runsByKey.values().next().value?.sliceId).toBe('MVP12-F02')
  })
})
