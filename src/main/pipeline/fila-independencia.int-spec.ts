import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Approval, RevisaoAprovada } from '@shared/domain/aprovacoes'
import { fechoDeDependencias } from '@shared/domain/independencia'
import { CONFIG_PADRAO } from '@shared/domain/pool'
import type { Mvp, Slice } from '@shared/domain/roadmap'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { PipelineRepository } = await import('./pipeline-repository')
const { LeaseRepository } = await import('./lease-repository')
const { FilaService } = await import('./fila-service')
const { PoolRepository } = await import('./pool-repository')
const { PoolService } = await import('./pool-service')
const { LockRepository } = await import('./lock-repository')
const { IndependenciaService } = await import('./independencia-service')

const USER = 'u-1'
const WS = 'jarvis' as const
const PROJETO = 'p-a'
const AGORA = 1_700_000_000_000

// Dois MVPs sem dependência entre si: o DAG não tem aresta nenhuma entre f1 e f2. É justamente o
// caso em que "sem aresta" não basta como prova.
const origem: Mvp['origem'] = { tipo: 'decisao', decisaoId: 'd-1', perguntaId: 'p-1' }
const MVPS: readonly Mvp[] = [
  { id: 'm1', numero: 1, titulo: 'MVP 1', tese: 't', estado: 'na-fila', dependeDe: [], origem },
  { id: 'm2', numero: 2, titulo: 'MVP 2', tese: 't', estado: 'na-fila', dependeDe: [], origem }
]
const fatia = (id: string, mvpId: string): Slice => ({
  id,
  mvpId,
  numero: 1,
  titulo: id,
  specSlug: `spec-${id}`,
  detalhada: true,
  origem
})
const SLICES: readonly Slice[] = [fatia('f1', 'm1'), fatia('f2', 'm2')]
const REVISOES: readonly RevisaoAprovada[] = [
  { artefato: 'spec-f1', hash: 'h-1' },
  { artefato: 'spec-f2', hash: 'h-2' }
]

let dir: string
let db: Db
let relogio: number
let writeSets: Map<string, string[]>
let runs: InstanceType<typeof PipelineRepository>
let locks: InstanceType<typeof LockRepository>
let pool: InstanceType<typeof PoolService>
let fila: InstanceType<typeof FilaService>

const aprovacao: Approval = {
  id: 'a-1',
  user_id: USER,
  workspace_id: WS,
  projectId: PROJETO,
  gate: 'SLICE_ENTRY',
  revisoes: REVISOES,
  identidade: 'sessao-1',
  autor: 'pi',
  created_at: new Date(AGORA).toISOString()
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-fila-indep-'))
  db = openDatabase(join(dir, 'teste.db'))
  relogio = AGORA
  writeSets = new Map()
  runs = new PipelineRepository(db)
  locks = new LockRepository(db)
  const leases = new LeaseRepository(db)
  const poolRepo = new PoolRepository(db)
  const audit = new AuditRepository(db, 'chave-de-teste')

  const independencia = new IndependenciaService({
    db,
    locks,
    pool: poolRepo,
    userId: () => USER,
    // O write set previsto do run é o da fatia dele.
    fonte: (item) => writeSets.get(item.sliceId),
    dependencias: (item) => {
      const slice = SLICES.find((s) => s.id === item.sliceId)
      return slice === undefined ? undefined : fechoDeDependencias(slice, MVPS, SLICES)
    },
    agora: () => relogio
  })
  pool = new PoolService({
    db,
    pool: poolRepo,
    leases,
    audit,
    userId: () => USER,
    workspaceId: () => WS,
    gates: (item) => fila.gatesDoItem(item),
    ativar: (item) => fila.ativarRun(item),
    independencia,
    bloquear: (item, token, bloqueio) =>
      fila.transicionar(item.projectId, item.workspaceId, item.runId, 'BLOCKED', bloqueio, token)
        .reason === 'transicionado',
    agora: () => relogio
  })
  fila = new FilaService({
    runs,
    pool,
    workspaceId: () => WS,
    audit,
    roadmap: () => ({ mvps: MVPS, slices: SLICES }),
    aprovacoes: () => [aprovacao],
    revisoesDoGate: () => REVISOES,
    userId: () => USER,
    mergeAutonomoLigado: () => true,
    agora: () => relogio
  })
  pool.configurar({ ...CONFIG_PADRAO, paralelismo: true })
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function pronto(sliceId: string): string {
  const run = fila.criarRun(PROJETO, WS, sliceId)
  fila.transicionar(PROJETO, WS, run.id, 'AWAITING_PI')
  fila.transicionar(PROJETO, WS, run.id, 'READY')
  return run.id
}

const estado = (runId: string): string | undefined => runs.buscar(runId)?.estado

describe('duas fatias sem aresta no DAG, no mesmo projeto', () => {
  it('lockfile comum: a segunda espera, e a mensagem diz por quê', () => {
    writeSets.set('f1', ['src/api', 'yarn.lock'])
    writeSets.set('f2', ['src/web', 'yarn.lock'])
    const a = pronto('f1')
    const b = pronto('f2')

    expect(fila.adquirirSlot(PROJETO, WS, a).reason).toBe('adquirido')
    const espera = fila.adquirirSlot(PROJETO, WS, b)

    expect(espera.reason).toBe('ocupado')
    expect(espera.mensagem).toContain('yarn.lock')
    expect(estado(b)).toBe('READY')
  })

  it('write sets disjuntos e sem recurso global: as duas rodam, cada uma no seu slot', () => {
    writeSets.set('f1', ['src/api'])
    writeSets.set('f2', ['src/web'])
    const a = pronto('f1')
    const b = pronto('f2')

    expect(fila.adquirirSlot(PROJETO, WS, a).reason).toBe('adquirido')
    expect(fila.adquirirSlot(PROJETO, WS, b).reason).toBe('adquirido')

    expect(estado(a)).toBe('RUNNING')
    expect(estado(b)).toBe('RUNNING')
    expect(pool.slotDoRun(a)?.recurso).not.toBe(pool.slotDoRun(b)?.recurso)
  })

  it('sem fonte de write set, o segundo run espera: sequencial por padrão', () => {
    const a = pronto('f1')
    const b = pronto('f2')

    expect(fila.adquirirSlot(PROJETO, WS, a).reason).toBe('adquirido')
    const espera = fila.adquirirSlot(PROJETO, WS, b)

    expect(espera.reason).toBe('ocupado')
    expect(espera.mensagem).toMatch(/não se sabe onde/)
  })

  it('quando a primeira conclui, o slot e as travas saem e a segunda entra', () => {
    writeSets.set('f1', ['src/api', 'yarn.lock'])
    writeSets.set('f2', ['src/web', 'yarn.lock'])
    const a = pronto('f1')
    const b = pronto('f2')
    const token = fila.adquirirSlot(PROJETO, WS, a).lease?.fencingToken as number
    fila.adquirirSlot(PROJETO, WS, b)
    fila.transicionar(PROJETO, WS, a, 'VALIDATING', undefined, token)
    fila.transicionar(PROJETO, WS, a, 'REVIEWING', undefined, token)
    fila.transicionar(PROJETO, WS, a, 'PR_CI', undefined, token)

    expect(fila.concluir(PROJETO, WS, a, token).reason).toBe('transicionado')

    expect(estado(b)).toBe('RUNNING')
    expect(locks.travasDoRun(a)).toEqual({ caminhos: [], recursos: [] })
    expect(locks.travasDoRun(b).recursos).toEqual(['lockfile'])
  })
})

describe('expansão conflitante — o run perdedor para antes de escrever', () => {
  it('vai a BLOCKED com o bloqueio completo; o vencedor segue; slot e travas antigas ficam', () => {
    writeSets.set('f1', ['src/api'])
    writeSets.set('f2', ['src/web'])
    const a = pronto('f1')
    const b = pronto('f2')
    fila.adquirirSlot(PROJETO, WS, a)
    const tokenB = fila.adquirirSlot(PROJETO, WS, b).lease?.fencingToken as number

    const r = pool.expandirEscopo(b, tokenB, ['src/api/novo.ts'])

    expect(r).toMatchObject({ ok: false, motivo: 'conflito', bloqueado: true })
    expect(estado(b)).toBe('BLOCKED')
    expect(estado(a)).toBe('RUNNING')
    expect(locks.travasDoRun(b).caminhos).toEqual(['src/web'])
    expect(locks.travasDoRun(a).caminhos).toEqual(['src/api'])
    expect(pool.slotDoRun(b)).toBeDefined()
    expect(runs.buscar(b)?.bloqueio?.causa).toBe('conflito-de-write-set')
  })

  it('o dono antigo, sem o token vigente, não derruba o run de ninguém', () => {
    writeSets.set('f1', ['src/api'])
    writeSets.set('f2', ['src/web'])
    const a = pronto('f1')
    const b = pronto('f2')
    fila.adquirirSlot(PROJETO, WS, a)
    const tokenB = fila.adquirirSlot(PROJETO, WS, b).lease?.fencingToken as number

    const r = pool.expandirEscopo(b, tokenB + 1, ['src/api/novo.ts'])

    expect(r).toEqual({ ok: false, motivo: 'fencing-invalido' })
    expect(estado(b)).toBe('RUNNING')
  })
})
