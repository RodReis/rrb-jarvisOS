import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Approval, RevisaoAprovada } from '@shared/domain/aprovacoes'
import { VALIDADE_DO_LEASE_MS } from '@shared/domain/lease'
import type { ExecutorObservado } from '@shared/domain/recuperacao'
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
const { RecuperacaoService } = await import('./recuperacao-service')
const { ReconciliacaoService } = await import('./reconciliacao-service')

const USER = 'u-1'
const WS = 'jarvis' as const
const AGORA = 1_700_000_000_000

const origem: Mvp['origem'] = { tipo: 'decisao', decisaoId: 'd-1', perguntaId: 'p-1' }
const MVPS: readonly Mvp[] = [
  { id: 'm1', numero: 1, titulo: 'MVP 1', tese: 't', estado: 'na-fila', dependeDe: [], origem }
]
const SLICES: readonly Slice[] = [
  { id: 'f1', mvpId: 'm1', numero: 1, titulo: 'F1', specSlug: 'spec-f1', detalhada: true, origem }
]
const REVISOES: readonly RevisaoAprovada[] = [{ artefato: 'spec-f1', hash: 'h-1' }]

let dir: string
let db: Db
let relogio: number
let runs: InstanceType<typeof PipelineRepository>
let leases: InstanceType<typeof LeaseRepository>
let pool: InstanceType<typeof PoolService>
let fila: InstanceType<typeof FilaService>
let recuperacao: InstanceType<typeof RecuperacaoService>
let executores: Map<string, ExecutorObservado>
let falhaDaRecuperacao: boolean

const aprovacao = (projectId: string): Approval => ({
  id: `a-${projectId}`,
  user_id: USER,
  workspace_id: WS,
  projectId,
  gate: 'SLICE_ENTRY',
  revisoes: REVISOES,
  identidade: 'sessao-1',
  autor: 'pi',
  created_at: new Date(AGORA).toISOString()
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-reconc-recup-'))
  db = openDatabase(join(dir, 'teste.db'))
  relogio = AGORA
  executores = new Map()
  falhaDaRecuperacao = false
  runs = new PipelineRepository(db)
  leases = new LeaseRepository(db)
  const audit = new AuditRepository(db, 'chave-de-teste')
  pool = new PoolService({
    db,
    pool: new PoolRepository(db),
    leases,
    audit,
    userId: () => USER,
    workspaceId: () => WS,
    gates: (item) => fila.gatesDoItem(item),
    ativar: (item) => fila.ativarRun(item),
    prova: () => true,
    agora: () => relogio
  })
  fila = new FilaService({
    runs,
    pool,
    workspaceId: () => WS,
    audit,
    roadmap: () => ({ mvps: MVPS, slices: SLICES }),
    aprovacoes: (escopo) => [aprovacao(escopo.projectId)],
    revisoesDoGate: () => REVISOES,
    userId: () => USER,
    mergeAutonomoLigado: () => true,
    transacao: (fn) => db.transaction(fn)(),
    agora: () => relogio
  })
  recuperacao = new RecuperacaoService({
    runs,
    leases,
    pool,
    fila,
    audit,
    userId: () => USER,
    executor: (runId) => executores.get(runId) ?? 'morto',
    mergeEmCurso: () => false,
    agora: () => relogio
  })
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const reconciliacao = (): InstanceType<typeof ReconciliacaoService> =>
  new ReconciliacaoService({
    runs,
    leases,
    audit: new AuditRepository(db, 'chave-de-teste'),
    userId: () => USER,
    workspaceId: () => WS,
    aoLiberarSlot: (lease) => {
      pool.registrarReconciliado(lease)
      fila.despachar()
    },
    recuperacao: {
      supervisionar: () => {
        if (falhaDaRecuperacao) throw new Error('docker mudo')
        return recuperacao.supervisionar()
      }
    },
    agora: () => relogio
  })

function executando(projectId: string): { id: string; token: number } {
  const run = fila.criarRun(projectId, WS, 'f1')
  fila.transicionar(projectId, WS, run.id, 'AWAITING_PI')
  fila.transicionar(projectId, WS, run.id, 'READY')
  const { lease } = fila.adquirirSlot(projectId, WS, run.id)
  return { id: run.id, token: lease?.fencingToken as number }
}

const estado = (runId: string): string | undefined => runs.buscar(runId)?.estado
const slotDe = (runId: string): unknown => leases.buscarSlotDoRun(USER, runId)

describe('reconcileAll chama a recuperação — o boot dá destino ao run que perdeu o dono', () => {
  it('RUNNING com lease expirado e executor morto vira BLOCKED e o slot passa a quem esperava', async () => {
    const a = executando('p-a')
    const espera = fila.criarRun('p-b', WS, 'f1')
    fila.transicionar('p-b', WS, espera.id, 'AWAITING_PI')
    fila.transicionar('p-b', WS, espera.id, 'READY')
    expect(fila.adquirirSlot('p-b', WS, espera.id).reason).toBe('ocupado')
    relogio += VALIDADE_DO_LEASE_MS + 1 // o processo caiu e o app reabriu

    const achados = await reconciliacao().reconcileAll()

    expect(estado(a.id)).toBe('BLOCKED')
    expect(slotDe(a.id)).toBeUndefined()
    expect(achados.some((x) => x.recurso === `run:${a.id}` && x.decisao === 'liberado')).toBe(true)
    expect(estado(espera.id)).toBe('RUNNING')
  })

  it('o container sobreviveu ao reinício: o run não é tocado (lentidão, não morte)', async () => {
    const a = executando('p-a')
    executores.set(a.id, 'vivo')
    relogio += VALIDADE_DO_LEASE_MS + 1

    await reconciliacao().reconcileAll()

    expect(estado(a.id)).toBe('RUNNING')
    expect(slotDe(a.id)).toBeDefined()
  })

  it('crash entre o terminal e a liberação: o slot do run terminal volta no boot, mesmo vigente', async () => {
    const a = executando('p-a')
    runs.transicionar(a.id, 'RUNNING', 'CANCELLED', new Date(relogio))
    expect(slotDe(a.id)).toBeDefined()

    await reconciliacao().reconcileAll()

    expect(slotDe(a.id)).toBeUndefined()
  })

  it('a recuperação que falha vira achado bloqueado, e o boot segue', async () => {
    const a = executando('p-a')
    falhaDaRecuperacao = true
    relogio += VALIDADE_DO_LEASE_MS + 1

    const achados = await reconciliacao().reconcileAll()

    const falha = achados.find((x) => x.recurso === 'recuperacao')
    expect(falha?.decisao).toBe('bloqueado')
    expect(falha?.motivo).toMatch(/docker mudo/)
    expect(estado(a.id)).toBe('RUNNING')
  })
})
