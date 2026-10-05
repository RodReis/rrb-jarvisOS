import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Approval, RevisaoAprovada } from '@shared/domain/aprovacoes'
import type { ConnectorOutcome, ConnectorRequest } from '@shared/domain/connectors'
import { GITHUB_OPERATIONS } from '@shared/domain/github-automation'
import type { ExecutorObservado } from '@shared/domain/recuperacao'
import type { Mvp, Slice } from '@shared/domain/roadmap'
import { CONFIG_PADRAO } from '@shared/domain/pool'

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
const { RunPrRepository } = await import('./run-pr-repository')
const { CancelamentoService } = await import('./cancelamento-service')

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

type Resposta = 'ok' | 'ja-era' | 'nao-aberto' | 'indisponivel' | 'sem-suporte' | 'explode'

let dir: string
let db: Db
let relogio: number
let runs: InstanceType<typeof PipelineRepository>
let leases: InstanceType<typeof LeaseRepository>
let pool: InstanceType<typeof PoolService>
let fila: InstanceType<typeof FilaService>
let prs: InstanceType<typeof RunPrRepository>
let cancelamento: InstanceType<typeof CancelamentoService>
let chamadas: ConnectorRequest[]
let resposta: Resposta
let interrompidos: string[]
let mergesEmCurso: Set<string>
const executores = new Map<string, ExecutorObservado>()

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

const desfecho = (): ConnectorOutcome => {
  const base = {
    provenance: { connector: 'github', operation: 'x', obtidoEm: new Date(AGORA).toISOString() }
  }
  switch (resposta) {
    case 'ok':
      return { ok: true, data: { rascunho: true, jaEra: false }, ...base } as never
    case 'ja-era':
      return { ok: true, data: { rascunho: true, jaEra: true }, ...base } as never
    case 'nao-aberto':
      return {
        ok: true,
        data: { rascunho: false, jaEra: false, motivo: 'pr-nao-aberto' },
        ...base
      } as never
    case 'indisponivel':
      return {
        ok: false,
        code: 'indisponivel',
        mensagem: 'x',
        retryable: true,
        acao: 'retentar',
        ...base
      } as never
    default:
      return {
        ok: false,
        code: 'validacao-invalida',
        mensagem: 'x',
        retryable: false,
        acao: 'corrigir-entrada',
        ...base
      } as never
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-cancelamento-'))
  db = openDatabase(join(dir, 'teste.db'))
  relogio = AGORA
  chamadas = []
  resposta = 'ok'
  interrompidos = []
  mergesEmCurso = new Set()
  executores.clear()
  runs = new PipelineRepository(db)
  leases = new LeaseRepository(db)
  prs = new RunPrRepository(db)
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
    mergeEmCurso: (runId) => mergesEmCurso.has(runId),
    transacao: (fn) => db.transaction(fn)(),
    aoEncerrarSemConclusao: (runId) => void recuperacao.recolher(runId),
    agora: () => relogio
  })
  const recuperacao = new RecuperacaoService({
    runs,
    leases,
    pool,
    fila,
    audit,
    userId: () => USER,
    executor: (runId) => executores.get(runId) ?? 'morto',
    mergeEmCurso: (runId) => mergesEmCurso.has(runId),
    agora: () => relogio
  })
  cancelamento = new CancelamentoService({
    runs,
    fila,
    prs,
    connectors: {
      call: async (request: ConnectorRequest): Promise<ConnectorOutcome> => {
        chamadas.push(request)
        if (resposta === 'explode') throw new Error('rede caiu')
        return desfecho()
      }
    },
    audit,
    userId: () => USER,
    interromper: (runId) => void interrompidos.push(runId),
    agora: () => relogio
  })
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function executando(projectId: string): string {
  const run = fila.criarRun(projectId, WS, 'f1')
  fila.transicionar(projectId, WS, run.id, 'AWAITING_PI')
  fila.transicionar(projectId, WS, run.id, 'READY')
  fila.adquirirSlot(projectId, WS, run.id)
  return run.id
}

const comPr = (runId: string, numero = 7): void =>
  prs.registrar(
    USER,
    { runId, owner: 'o', repo: 'r', pullRequest: numero, branch: 'feat/x' },
    AGORA
  )

const estado = (runId: string): string | undefined => runs.buscar(runId)?.estado
const slotDe = (runId: string): unknown => leases.buscarSlotDoRun(USER, runId)
const operacoes = (): string[] => chamadas.map((c) => c.operation)

describe('cancelar — a matriz aprovada por fase, sem apagar trabalho remoto', () => {
  it('run em execução sem PR: cancela, devolve o slot e não toca a origem', async () => {
    const a = executando('p-a')

    const r = await cancelamento.cancelar('p-a', WS, a)

    expect(r).toMatchObject({ cancelado: true, fase: 'durante-execucao', rascunho: 'sem-pr' })
    expect(estado(a)).toBe('CANCELLED')
    expect(slotDe(a)).toBeUndefined()
    expect(chamadas).toHaveLength(0)
  })

  it('run com PR publicado: o PR vira rascunho, e a origem só recebe essa operação', async () => {
    const a = executando('p-a')
    comPr(a)

    const r = await cancelamento.cancelar('p-a', WS, a)

    expect(r).toMatchObject({ cancelado: true, fase: 'depois-do-push', rascunho: 'convertido' })
    expect(operacoes()).toEqual([GITHUB_OPERATIONS.convertToDraft])
    expect(chamadas[0]?.input).toEqual({ owner: 'o', repo: 'r', pullRequest: 7 })
    expect(prs.doRun(USER, a)?.rascunho).toBe('convertido')
    // Nunca fecha, nunca mergeia, nunca apaga branch: nenhuma outra operação saiu.
    expect(operacoes()).not.toContain(GITHUB_OPERATIONS.squashMerge)
  })

  it('o PR de um run em CI também vira rascunho', async () => {
    const a = executando('p-a')
    const token = leases.buscarSlotDoRun(USER, a)?.fencingToken as number
    fila.transicionar('p-a', WS, a, 'VALIDATING', undefined, token)
    fila.transicionar('p-a', WS, a, 'PR_CI', undefined, token)
    comPr(a)

    const r = await cancelamento.cancelar('p-a', WS, a)

    expect(r).toMatchObject({ cancelado: true, fase: 'durante-ci', rascunho: 'convertido' })
  })

  it('antes do executor não há slot nem efeito remoto a desfazer', async () => {
    const run = fila.criarRun('p-a', WS, 'f1')

    const r = await cancelamento.cancelar('p-a', WS, run.id)

    expect(r).toMatchObject({ cancelado: true, fase: 'antes-do-executor', rascunho: 'sem-pr' })
    expect(estado(run.id)).toBe('CANCELLED')
    expect(chamadas).toHaveLength(0)
  })

  it('interrompe a entrega em curso do run cancelado', async () => {
    const a = executando('p-a')

    await cancelamento.cancelar('p-a', WS, a)

    expect(interrompidos).toEqual([a])
  })

  it('PR que já era rascunho ou já não está aberto termina sem erro e fica registrado', async () => {
    const a = executando('p-a')
    comPr(a)
    resposta = 'ja-era'
    expect(await cancelamento.cancelar('p-a', WS, a)).toMatchObject({ rascunho: 'ja-era' })
    expect(prs.doRun(USER, a)?.rascunho).toBe('convertido')

    const b = executando('p-b')
    comPr(b, 8)
    resposta = 'nao-aberto'
    expect(await cancelamento.cancelar('p-b', WS, b)).toMatchObject({ rascunho: 'nao-aberto' })
    expect(prs.doRun(USER, b)?.rascunho).toBe('nao-aberto')
  })
})

describe('cancelar uma fatia não interrompe a outra', () => {
  it('a fatia saudável mantém estado, slot e travas, e a origem não é tocada por ela', async () => {
    pool.configurar({ ...CONFIG_PADRAO, paralelismo: true })
    const a = executando('p-a')
    const b = executando('p-b')
    comPr(a, 7)
    comPr(b, 8)
    const travasDeB = (): number =>
      (db.prepare('SELECT COUNT(*) AS n FROM pool_lock WHERE run_id = ?').get(b) as { n: number }).n
    const antes = travasDeB()

    await cancelamento.cancelar('p-a', WS, a)

    expect(estado(a)).toBe('CANCELLED')
    expect(estado(b)).toBe('RUNNING')
    expect(slotDe(b)).toBeDefined()
    expect(travasDeB()).toBe(antes)
    expect(chamadas.map((c) => (c.input as { pullRequest: number }).pullRequest)).toEqual([7])
    expect(interrompidos).toEqual([a])
    expect(prs.doRun(USER, b)?.rascunho).toBeUndefined()
  })
})

describe('cancelar não vence o que já aconteceu', () => {
  it('merge em curso recusa o cancelamento: run vivo, PR intacto e entrega não interrompida', async () => {
    const a = executando('p-a')
    comPr(a)
    mergesEmCurso.add(a)

    const r = await cancelamento.cancelar('p-a', WS, a)

    expect(r).toMatchObject({ cancelado: false, motivo: 'merge-em-curso' })
    expect(estado(a)).toBe('RUNNING')
    expect(chamadas).toHaveLength(0)
    expect(interrompidos).toHaveLength(0)
    // O pedido de rascunho não fica pendurado: ninguém vai cancelar este run.
    expect(prs.doRun(USER, a)?.rascunho).toBeUndefined()
  })

  it('run terminal não tem o que cancelar', async () => {
    const a = executando('p-a')
    await cancelamento.cancelar('p-a', WS, a)
    chamadas.length = 0

    const r = await cancelamento.cancelar('p-a', WS, a)

    expect(r).toMatchObject({ cancelado: false, motivo: 'run-terminal' })
    expect(chamadas).toHaveLength(0)
  })

  it('run inexistente', async () => {
    expect(await cancelamento.cancelar('p-a', WS, 'nao-existe')).toMatchObject({
      cancelado: false,
      motivo: 'run-inexistente'
    })
  })
})

describe('rascunho "quando possível" — a origem pode recusar e o cancelamento vale mesmo assim', () => {
  it('origem indisponível: o run é cancelado e o rascunho fica pendente para a reconciliação', async () => {
    const a = executando('p-a')
    comPr(a)
    resposta = 'indisponivel'

    const r = await cancelamento.cancelar('p-a', WS, a)

    expect(r).toMatchObject({ cancelado: true, rascunho: 'pendente' })
    expect(estado(a)).toBe('CANCELLED')
    expect(prs.doRun(USER, a)?.rascunho).toBe('pendente')

    resposta = 'ok'
    const achados = await cancelamento.reconciliarRascunhos()

    expect(prs.doRun(USER, a)?.rascunho).toBe('convertido')
    expect(achados.some((x) => x.recurso === `pr:${a}` && x.decisao === 'completado')).toBe(true)
  })

  it('exceção do conector também deixa pendente: o cancelamento nunca lança por causa da origem', async () => {
    const a = executando('p-a')
    comPr(a)
    resposta = 'explode'

    const r = await cancelamento.cancelar('p-a', WS, a)

    expect(r).toMatchObject({ cancelado: true, rascunho: 'pendente' })
    expect(estado(a)).toBe('CANCELLED')
  })

  it('origem que não suporta rascunho: indisponível de forma definitiva, PR preservado', async () => {
    const a = executando('p-a')
    comPr(a)
    resposta = 'sem-suporte'

    const r = await cancelamento.cancelar('p-a', WS, a)

    expect(r).toMatchObject({ cancelado: true, rascunho: 'indisponivel' })
    expect(prs.doRun(USER, a)?.rascunho).toBe('indisponivel')
    expect(await cancelamento.reconciliarRascunhos()).toHaveLength(0)
  })

  it('crash entre o pedido e a chamada: a reconciliação conclui o rascunho', async () => {
    const a = executando('p-a')
    comPr(a)
    // O processo caiu depois de gravar a intenção e de cancelar, antes de chamar a origem.
    prs.pedirRascunho(USER, a, AGORA)
    runs.transicionar(a, 'RUNNING', 'CANCELLED', new Date(AGORA))

    await cancelamento.reconciliarRascunhos()

    expect(chamadas).toHaveLength(1)
    expect(prs.doRun(USER, a)?.rascunho).toBe('convertido')
  })

  it('pedido de um run que NÃO foi cancelado (crash antes do cancelamento) não vira rascunho', async () => {
    const a = executando('p-a')
    comPr(a)
    prs.pedirRascunho(USER, a, AGORA)

    await cancelamento.reconciliarRascunhos()

    expect(chamadas).toHaveLength(0)
    expect(estado(a)).toBe('RUNNING')
  })

  it('reconciliar é idempotente: o que já tem resultado não é chamado de novo', async () => {
    const a = executando('p-a')
    comPr(a)
    await cancelamento.cancelar('p-a', WS, a)
    chamadas.length = 0

    await cancelamento.reconciliarRascunhos()

    expect(chamadas).toHaveLength(0)
  })
})
