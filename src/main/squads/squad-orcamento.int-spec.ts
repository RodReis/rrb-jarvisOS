import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PERFIL_PADRAO } from '@shared/domain/squad-perfil'
import { limitesAgregadosDoPlano } from '@shared/domain/squad-resolucao'
import type { SquadPlan } from '@shared/domain/squad-plano'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { PipelineRepository } = await import('../pipeline/pipeline-repository')
const { criarSnapshotDoSquad } = await import('./squad-snapshot')
const { SquadOrcamentoService } = await import('./squad-orcamento')

const USER = 'budget-user'
const ESCOPO = { userId: USER, workspaceId: 'jarvis', projectId: 'budget-project' } as const
const AGORA = new Date('2026-10-07T12:00:00.000Z')
const AMBIENTE = {
  skills: ['code-review'],
  ferramentas: [],
  ollama: { disponivel: false, modelos: [] },
  optInApiPaga: false
}
const SNAPSHOT = criarSnapshotDoSquad(PERFIL_PADRAO, AMBIENTE, {
  provider: 'claude-code',
  modelo: 'claude-fable-5-1'
})
const tarefa = (id: string, escritor?: string) => ({
  id,
  papel: escritor === undefined ? 'revisor' : 'desenvolvedor',
  capacidade: 'revisao-de-codigo',
  camada: 'executor',
  ...(escritor === undefined ? {} : { escritor }),
  entradas: ['src/a.ts'],
  dependencias: [],
  paths: escritor === undefined ? [] : ['src/a.ts'],
  schemaDeResultado: escritor === undefined ? 'achados@1' : 'parecer@1',
  limites: { maxTurnos: 2, maxMinutos: 1, maxTokensEntrada: 100, maxTokensSaida: 50 },
  fundamento: { criterio: 1 },
  regraDeConclusao: 'concluir'
})

let dir: string
let db: Db
let runs: InstanceType<typeof PipelineRepository>
let audit: InstanceType<typeof AuditRepository>
let snapshot: typeof SNAPSHOT
let plano: SquadPlan
let limites: ReturnType<typeof limitesAgregadosDoPlano>
let runId: string
let service: InstanceType<typeof SquadOrcamentoService>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-squad-budget-'))
  db = openDatabase(join(dir, 'teste.db'))
  runs = new PipelineRepository(db)
  audit = new AuditRepository(db, 'chave-de-teste')
  snapshot = SNAPSHOT
  plano = { tarefas: [tarefa('worker-a'), tarefa('worker-b')] as SquadPlan['tarefas'] }
  limites = limitesAgregadosDoPlano(plano, snapshot.resolucao, snapshot.perfil)
  const run = runs.criar(ESCOPO, { sliceId: 'slice-budget', estado: 'PLANNED' }, AGORA)
  runId = run.id
  expect(runs.registrarSnapshotDoSquad(ESCOPO, runId, snapshot, AGORA)).toBe(true)
  expect(runs.transicionar(runId, 'PLANNED', 'AWAITING_PI', AGORA)).toBe(true)
  expect(runs.transicionar(runId, 'AWAITING_PI', 'READY', AGORA)).toBe(true)
  expect(
    runs.registrarPlanoDoSquad(ESCOPO, runId, plano, AGORA, {
      limiteUsd: limites.usd,
      medido: limites.camadasMedidas.length > 0,
      limites
    })
  ).toBe(true)
  expect(runs.transicionar(runId, 'READY', 'RUNNING', AGORA)).toBe(true)
  service = new SquadOrcamentoService(db, runs, audit, () => AGORA)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('ledger agregado do Squad', () => {
  it('reserva cada tarefa uma vez e mantém reserva após reinício do serviço', () => {
    expect(limites).toMatchObject({ chamadas: 52, turnos: 54 })
    expect(service.reservar(ESCOPO, runId, 'worker-a', 1)).toEqual({ permitido: true })
    service = new SquadOrcamentoService(db, runs, audit, () => AGORA)
    expect(service.reservar(ESCOPO, runId, 'worker-a', 1)).toMatchObject({ permitido: false })
    expect(service.reservar(ESCOPO, runId, 'worker-b', 1)).toEqual({ permitido: true })
    expect(service.consumoDoRun(ESCOPO, runId)).toMatchObject({
      tarefas: 2,
      pendentes: 2,
      tokensEntrada: 200
    })
  })

  it('consumo medido substitui reserva; decimal USD aceito e valores ficam agregados por projeto', () => {
    expect(service.reservar(ESCOPO, runId, 'worker-a', 1).permitido).toBe(true)
    expect(
      service.registrarConsumo(ESCOPO, runId, 'worker-a', 1, {
        chamadas: 1,
        tokensEntrada: 80,
        tokensSaida: 30,
        turnos: 1,
        duracaoMs: 1200,
        usd: 0
      })
    ).toBe(true)
    expect(service.consumoDoRun(ESCOPO, runId)).toMatchObject({
      tarefas: 1,
      pendentes: 0,
      chamadas: 1,
      tokensEntrada: 80,
      tokensSaida: 30,
      usd: 0
    })
    expect(service.consumoDoProjeto(ESCOPO)).toMatchObject({ chamadas: 1, usd: 0 })
    expect(audit.list(USER).filter((item) => item.type === 'budget-decision')).toHaveLength(2)
  })

  it('reserva cada bloco do integrador no teto agregado sem contar nova tarefa ou writer', () => {
    expect(
      service.reservarIntegracao(ESCOPO, runId, '__integrador__-1', 1, {
        tokensEntrada: 20,
        tokensSaida: 10,
        duracaoMs: 1000
      }).permitido
    ).toBe(true)
    expect(
      service.registrarConsumo(ESCOPO, runId, '__integrador__-1', 1, {
        chamadas: 1,
        tokensEntrada: 20,
        tokensSaida: 10,
        turnos: 1,
        duracaoMs: 500,
        usd: 0
      })
    ).toBe(true)
    expect(service.consumoDoRun(ESCOPO, runId)).toMatchObject({
      tarefas: 0,
      escritores: 0,
      workers: 0,
      chamadas: 1
    })
  })

  it('sobreconsumo vira overrun e impede outro dispatch dentro da mesma soma', () => {
    expect(service.reservar(ESCOPO, runId, 'worker-a', 1).permitido).toBe(true)
    expect(
      service.registrarConsumo(ESCOPO, runId, 'worker-a', 1, {
        chamadas: 1,
        tokensEntrada: 101,
        tokensSaida: 1,
        turnos: 1,
        duracaoMs: 1,
        usd: 0
      })
    ).toBe(false)
    expect(service.consumoDoRun(ESCOPO, runId).falhasDeTeto).toBe(1)
    expect(service.reservar(ESCOPO, runId, 'worker-b', 1)).toMatchObject({
      permitido: false,
      motivo: 'teto-agregado-excedido'
    })
  })

  it('escopo divergente, tarefa ausente e tentativa inválida falham fechados', () => {
    expect(
      service.reservar({ ...ESCOPO, projectId: 'outro' }, runId, 'worker-a', 1).permitido
    ).toBe(false)
    expect(service.reservar(ESCOPO, runId, 'inventada', 1).permitido).toBe(false)
    expect(service.reservar(ESCOPO, runId, 'worker-a', 0).permitido).toBe(false)
  })

  it('reserva liberada antes do dispatch deixa de contar como camada ativa', () => {
    plano = {
      tarefas: [
        tarefa('writer-a', 'escritor-a'),
        tarefa('writer-b', 'escritor-b')
      ] as SquadPlan['tarefas']
    }
    limites = {
      ...limitesAgregadosDoPlano(plano, snapshot.resolucao, snapshot.perfil),
      escritores: 1
    }
    db.prepare('UPDATE pipeline_run SET squad_plan = ?, squad_budget_limits = ? WHERE id = ?').run(
      JSON.stringify(plano),
      JSON.stringify(limites),
      runId
    )

    expect(service.reservar(ESCOPO, runId, 'writer-a', 1).permitido).toBe(true)
    service.liberarAntesDoDispatch(ESCOPO, runId, 'writer-a', 1)
    expect(service.reservar(ESCOPO, runId, 'writer-b', 1)).toEqual({ permitido: true })
  })
})
