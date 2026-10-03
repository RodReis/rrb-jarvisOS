/**
 * O gerente de slots dos escritores (SPEC-Squads-03, regra 5 e critério 6), contra o pool real:
 * `FilaService`, `PoolService` e SQLite de verdade, ligados pelo `aoAdquirir` como em produção.
 */

import { getEventListeners } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Approval, RevisaoAprovada } from '@shared/domain/aprovacoes'
import type { Mvp, Slice } from '@shared/domain/roadmap'
import { CONFIG_PADRAO } from '@shared/domain/pool'
import { idDoEscritor } from '@shared/domain/squad-execucao'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { PipelineRepository } = await import('../pipeline/pipeline-repository')
const { LeaseRepository } = await import('../pipeline/lease-repository')
const { FilaService } = await import('../pipeline/fila-service')
const { PoolRepository } = await import('../pipeline/pool-repository')
const { PoolService } = await import('../pipeline/pool-service')
const { GerenteDeSlots } = await import('./squad-slots')

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
let pool: InstanceType<typeof PoolService>
let fila: InstanceType<typeof FilaService>
let gerente: InstanceType<typeof GerenteDeSlots>
/** O relógio avança a cada pedido: a idade na fila desempata, e o FIFO só vale com idades distintas. */
let relogio: number

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
  dir = mkdtempSync(join(tmpdir(), 'jarvis-squad-slots-'))
  relogio = AGORA
  db = openDatabase(join(dir, 'teste.db'))
  const leases = new LeaseRepository(db)
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
    agora: () => relogio
  })
  fila = new FilaService({
    runs: new PipelineRepository(db),
    pool,
    workspaceId: () => WS,
    audit,
    roadmap: () => ({ mvps: MVPS, slices: SLICES }),
    aprovacoes: (escopo) => [aprovacao(escopo.projectId)],
    revisoesDoGate: () => REVISOES,
    userId: () => USER,
    mergeAutonomoLigado: () => true,
    // A ligação de produção: o pool anuncia, o gerente acorda quem esperava.
    aoAdquirir: (a) => gerente.anunciar(a),
    agora: () => relogio
  })
  gerente = new GerenteDeSlots(fila)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function pronto(projectId = 'p-a'): string {
  const run = fila.criarRun(projectId, WS, 'f1')
  fila.transicionar(projectId, WS, run.id, 'AWAITING_PI')
  fila.transicionar(projectId, WS, run.id, 'READY')
  return run.id
}

const pedir = (runId: string, escritor: string, signal?: AbortSignal) => {
  relogio += 1000
  return gerente.adquirir({
    projectId: 'p-a',
    workspaceId: WS,
    runId,
    escritor,
    ...(signal === undefined ? {} : { signal })
  })
}

/** Dá uma volta no laço de eventos: o que é pendente fica pendente, o que resolve já resolveu. */
const volta = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

async function estado<T>(p: Promise<T>): Promise<'pendente' | 'resolvida'> {
  const marcador = Symbol('pendente')
  const r = await Promise.race([p, volta().then(() => marcador)])
  return r === marcador ? 'pendente' : 'resolvida'
}

describe('adquirir', () => {
  it('com vaga, a promessa resolve na hora com o token do lease do escritor', async () => {
    const run = pronto()

    const r = await pedir(run, 'api')

    const unidade = idDoEscritor(run, 'api')
    expect(r).toEqual({
      ok: true,
      unidade,
      fencingToken: pool.slotDoRun(unidade)?.fencingToken
    })
    expect(typeof (r.ok && r.fencingToken)).toBe('number')
  })

  it('run inexistente e escritor com nome inválido são indisponíveis, sem esperar', async () => {
    const run = pronto()

    expect(await pedir('nao-existe', 'api')).toEqual({ ok: false, motivo: 'indisponivel' })
    expect(await pedir(run, 'a b')).toEqual({ ok: false, motivo: 'indisponivel' })
    expect(await pedir(run, 'a:b')).toEqual({ ok: false, motivo: 'indisponivel' })
    expect(pool.vista().fila).toEqual([])
  })

  it('o sinal já abortado cancela sem nem entrar na fila', async () => {
    const run = pronto()
    const controle = new AbortController()
    controle.abort()

    const r = await pedir(run, 'api', controle.signal)

    expect(r).toEqual({ ok: false, motivo: 'cancelada' })
    expect(pool.adquiriu(idDoEscritor(run, 'api'))).toBe(false)
    expect(pool.vista().fila).toEqual([])
    expect(pool.slotDoRun(idDoEscritor(run, 'api'))).toBeUndefined()
  })
})

describe('esperar a vez (critério 6: um slot, dois escritores, em sequência)', () => {
  it('o segundo escritor espera e é acordado quando o primeiro libera', async () => {
    const run = pronto()
    const a = await pedir(run, 'api')
    if (!a.ok) throw new Error('o primeiro deveria ter slot')

    const espera = pedir(run, 'ui')

    expect(await estado(espera)).toBe('pendente')
    expect(pool.slotDoRun(idDoEscritor(run, 'ui'))).toBeUndefined()

    expect(gerente.liberar('p-a', WS, a.unidade, a.fencingToken)).toBe(true)
    const b = await espera

    expect(b).toMatchObject({ ok: true, unidade: idDoEscritor(run, 'ui') })
    expect(b.ok && b.fencingToken).toBe(pool.slotDoRun(idDoEscritor(run, 'ui'))?.fencingToken)
    expect(b.ok && b.fencingToken).not.toBe(a.fencingToken)
  })

  it('três escritores passam um de cada vez, na ordem da fila', async () => {
    const run = pronto()
    const a = await pedir(run, 'api')
    const b = pedir(run, 'ui')
    const c = pedir(run, 'db')
    if (!a.ok) throw new Error('sem slot')
    expect(pool.vista().ocupados).toHaveLength(1)

    gerente.liberar('p-a', WS, a.unidade, a.fencingToken)
    const rb = await b
    expect(await estado(c)).toBe('pendente')
    if (!rb.ok) throw new Error('sem slot')
    expect(pool.vista().ocupados).toHaveLength(1)

    gerente.liberar('p-a', WS, rb.unidade, rb.fencingToken)
    const rc = await c
    expect(rc).toMatchObject({ ok: true, unidade: idDoEscritor(run, 'db') })
  })

  it('com o paralelismo ligado, os dois escritores têm slot ao mesmo tempo', async () => {
    pool.configurar({ ...CONFIG_PADRAO, paralelismo: true })
    const run = pronto()

    const [a, b] = await Promise.all([pedir(run, 'api'), pedir(run, 'ui')])

    expect(a.ok && b.ok).toBe(true)
    expect(pool.vista().ocupados).toHaveLength(2)
  })

  it('duas chamadas à mesma unidade esperam a mesma vez e recebem o mesmo token', async () => {
    const run = pronto()
    const a = await pedir(run, 'api')
    if (!a.ok) throw new Error('sem slot')

    const p1 = pedir(run, 'ui')
    const p2 = pedir(run, 'ui')
    gerente.liberar('p-a', WS, a.unidade, a.fencingToken)

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toEqual(r2)
    expect(r1.ok).toBe(true)
  })
})

describe('cancelar a espera', () => {
  it('tira o escritor da fila, e a liberação seguinte não o adquire para ninguém', async () => {
    const run = pronto()
    const a = await pedir(run, 'api')
    if (!a.ok) throw new Error('sem slot')
    const controle = new AbortController()
    const espera = pedir(run, 'ui', controle.signal)
    expect(pool.vista().fila).toHaveLength(1)

    controle.abort()

    expect(await espera).toEqual({ ok: false, motivo: 'cancelada' })
    expect(pool.vista().fila).toEqual([])
    gerente.liberar('p-a', WS, a.unidade, a.fencingToken)
    expect(pool.slotDoRun(idDoEscritor(run, 'ui'))).toBeUndefined()
    expect(pool.vista().ocupados).toEqual([])
  })

  it('o ouvinte do sinal sai quando a promessa resolve, por qualquer caminho', async () => {
    const run = pronto()
    const imediato = new AbortController()
    await pedir(run, 'api', imediato.signal)
    expect(getEventListeners(imediato.signal, 'abort')).toHaveLength(0)

    const cancelado = new AbortController()
    const espera = pedir(run, 'ui', cancelado.signal)
    cancelado.abort()
    await espera
    expect(getEventListeners(cancelado.signal, 'abort')).toHaveLength(0)
  })

  it('cancelar uma chamada não cancela a outra da mesma unidade', async () => {
    const run = pronto()
    const a = await pedir(run, 'api')
    if (!a.ok) throw new Error('sem slot')
    const controle = new AbortController()
    const cancelavel = pedir(run, 'ui', controle.signal)
    const firme = pedir(run, 'ui')

    controle.abort()
    expect(await cancelavel).toEqual({ ok: false, motivo: 'cancelada' })
    // A outra chamada à mesma unidade segue na fila, e é atendida quando o slot libera.
    expect(await estado(firme)).toBe('pendente')
    expect(pool.vista().fila).toHaveLength(1)
    gerente.liberar('p-a', WS, a.unidade, a.fencingToken)
    expect(await firme).toMatchObject({ ok: true, unidade: idDoEscritor(run, 'ui') })
  })

  it('o sinal abortado depois de adquirir não desfaz o slot', async () => {
    const run = pronto()
    const controle = new AbortController()
    const r = await pedir(run, 'api', controle.signal)

    controle.abort()

    expect(r.ok).toBe(true)
    expect(pool.slotDoRun(idDoEscritor(run, 'api'))).toBeDefined()
  })
})

describe('o estado da espera não vaza entre usos', () => {
  it('quem foi atendido sai do registro: o pedido seguinte da mesma unidade cancela de verdade', async () => {
    const run = pronto()
    const a = await pedir(run, 'api')
    if (!a.ok) throw new Error('sem slot')
    const espera = pedir(run, 'ui')
    gerente.liberar('p-a', WS, a.unidade, a.fencingToken)
    const ui = await espera
    if (!ui.ok) throw new Error('ui deveria ter sido atendido')
    gerente.liberar('p-a', WS, ui.unidade, ui.fencingToken)

    // Outro uso da mesma unidade: o `api` segura o slot, o `ui` espera e é cancelado.
    const novoApi = await pedir(run, 'api')
    expect(novoApi.ok).toBe(true)
    const controle = new AbortController()
    const novaEspera = pedir(run, 'ui', controle.signal)
    expect(pool.vista().fila).toHaveLength(1)
    controle.abort()

    expect(await novaEspera).toEqual({ ok: false, motivo: 'cancelada' })
    expect(pool.vista().fila).toEqual([])
  })

  it('um slot sem token no lease não é entregue como sucesso', async () => {
    const stub = {
      adquirirSlotDoEscritor: () => ({
        reason: 'adquirido' as const,
        mensagem: 'ok',
        lease: {} as never
      }),
      renovarSlot: () => true,
      confirmarSlot: () => true,
      liberarSlot: () => true,
      desistirDoSlot: () => true
    }

    const r = await new GerenteDeSlots(stub).adquirir({
      projectId: 'p-a',
      workspaceId: WS,
      runId: 'run-x',
      escritor: 'api'
    })

    expect(r).toEqual({ ok: false, motivo: 'indisponivel' })
  })
})

describe('o resto do contrato com o pool', () => {
  it('renova, confirma e libera com o token do dono — e só com ele', async () => {
    const run = pronto()
    const a = await pedir(run, 'api')
    if (!a.ok) throw new Error('sem slot')

    expect(gerente.renovar(a.unidade, a.fencingToken)).toBe(true)
    expect(gerente.renovar(a.unidade, a.fencingToken + 1)).toBe(false)
    expect(gerente.confirmar(a.unidade, a.fencingToken)).toBe(true)
    expect(gerente.confirmar(a.unidade, a.fencingToken + 1)).toBe(false)
    expect(gerente.liberar('p-a', WS, a.unidade, a.fencingToken + 1)).toBe(false)
    expect(gerente.liberar('p-a', WS, a.unidade, a.fencingToken)).toBe(true)
    expect(gerente.confirmar(a.unidade, a.fencingToken)).toBe(false)
  })

  it('um anúncio de quem ninguém espera é ignorado', () => {
    expect(() =>
      gerente.anunciar({
        runId: 'ninguem:espera',
        projectId: 'p',
        recurso: 'wip:slot:1',
        fencingToken: 1,
        lease: {} as never
      })
    ).not.toThrow()
  })
})
