/**
 * A posse exclusiva do perfil do Codex (SPEC-Scheduler-05, decisão do PI de 2026-10-05), contra o
 * `LeaseRepository` e o SQLite de verdade: o que se prova é que **nunca há dois donos** e que quem
 * espera passa na ordem de chegada.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RECURSO_DO_PERFIL_CODEX } from '@shared/domain/codex-profile'
import { VALIDADE_DO_LEASE_MS } from '@shared/domain/lease'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { LeaseRepository } = await import('./lease-repository')
const { PosseDoPerfilCodex } = await import('./posse-do-perfil-codex')

const USER = 'u-1'
const HOME = '/userData/codex-pipeline'
const AGORA = 1_700_000_000_000

let dir: string
let db: Db
let leases: InstanceType<typeof LeaseRepository>
let relogio: number

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-posse-codex-'))
  db = openDatabase(join(dir, 'teste.db'))
  leases = new LeaseRepository(db)
  relogio = AGORA
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const posse = (intervaloDeEsperaMs = 5) =>
  new PosseDoPerfilCodex({
    leases,
    userId: () => USER,
    codexHome: () => HOME,
    agora: () => relogio,
    intervaloDeEsperaMs
  })

const volta = (ms = 15): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function estado<T>(p: Promise<T>): Promise<'pendente' | 'resolvida'> {
  const marcador = Symbol('pendente')
  const r = await Promise.race([p, volta().then(() => marcador)])
  return r === marcador ? 'pendente' : 'resolvida'
}

describe('adquirir', () => {
  it('livre: o run recebe o CODEX_HOME da pipeline e passa a ser o dono, com lease exclusivo', async () => {
    const p = posse()

    const r = await p.adquirir({ runId: 'run-1' })

    expect(r).toEqual({ ok: true, codexHome: HOME })
    expect(p.dono()).toBe('run-1')
    expect(leases.buscar(USER, RECURSO_DO_PERFIL_CODEX)?.proprietario).toBe('run-1')
  })

  it('o mesmo run pedindo de novo reassume a posse que já tem (retry depois de crash)', async () => {
    const p = posse()
    await p.adquirir({ runId: 'run-1' })

    const r = await p.adquirir({ runId: 'run-1' })

    expect(r).toEqual({ ok: true, codexHome: HOME })
    expect(p.dono()).toBe('run-1')
  })

  it('o sinal já abortado cancela sem tocar no lease', async () => {
    const controle = new AbortController()
    controle.abort()

    const r = await posse().adquirir({ runId: 'run-1', signal: controle.signal })

    expect(r).toEqual({ ok: false, motivo: 'cancelada' })
    expect(leases.buscar(USER, RECURSO_DO_PERFIL_CODEX)).toBeUndefined()
  })
})

describe('um dono por vez (a concorrência do Codex é 1)', () => {
  it('o segundo run espera e só adquire depois de o primeiro liberar (acordado na hora, sem esperar o polling)', async () => {
    // Intervalo de reconferência longo: só o despertar imediato do `liberar` resolve a espera.
    const p = posse(60_000)
    await p.adquirir({ runId: 'run-1' })

    const espera = p.adquirir({ runId: 'run-2' })

    expect(await estado(espera)).toBe('pendente')
    expect(p.dono()).toBe('run-1')

    expect(p.liberar('run-1')).toBe(true)
    expect(await espera).toEqual({ ok: true, codexHome: HOME })
    expect(p.dono()).toBe('run-2')
  })

  it('três runs passam um de cada vez, na ordem de chegada', async () => {
    const p = posse()
    await p.adquirir({ runId: 'run-1' })
    const donos: string[] = []
    const dois = p.adquirir({ runId: 'run-2' }).then(() => donos.push('run-2'))
    await volta(2)
    const tres = p.adquirir({ runId: 'run-3' }).then(() => donos.push('run-3'))
    await volta(20)
    expect(donos).toEqual([])

    p.liberar('run-1')
    await dois
    expect(p.dono()).toBe('run-2')
    expect(donos).toEqual(['run-2'])
    expect(await estado(tres)).toBe('pendente')

    p.liberar('run-2')
    await tres
    expect(donos).toEqual(['run-2', 'run-3'])
    expect(p.dono()).toBe('run-3')
  })

  it('a liberação feita por fora deste processo (reconciliação) também acorda quem espera', async () => {
    const p = posse(5)
    await p.adquirir({ runId: 'run-1' })
    const espera = p.adquirir({ runId: 'run-2' })
    await volta(10)

    // Não é `p.liberar`: é a reconciliação removendo o lease de um dono morto.
    leases.removerReconciliado(USER, RECURSO_DO_PERFIL_CODEX)

    expect(await espera).toEqual({ ok: true, codexHome: HOME })
    expect(p.dono()).toBe('run-2')
  })

  it('cancelar a espera tira o run da fila: a liberação seguinte não o adquire para ninguém', async () => {
    const p = posse()
    await p.adquirir({ runId: 'run-1' })
    const controle = new AbortController()
    const espera = p.adquirir({ runId: 'run-2', signal: controle.signal })
    const terceiro = p.adquirir({ runId: 'run-3' })
    await volta(5)

    controle.abort()

    expect(await espera).toEqual({ ok: false, motivo: 'cancelada' })
    p.liberar('run-1')
    // O run-3 é o próximo de verdade; o cancelado não segurou a vez.
    expect(await terceiro).toEqual({ ok: true, codexHome: HOME })
    expect(p.dono()).toBe('run-3')
  })
})

describe('a ordem de chegada e a corrida entre processos', () => {
  it('quem chega no instante em que o lease fica livre não fura quem já esperava', async () => {
    const p = posse()
    await p.adquirir({ runId: 'run-1' })
    const dois = p.adquirir({ runId: 'run-2' })
    await volta(5)

    // O lease fica livre e, **na mesma volta**, o run-3 chega: o run-2 ainda não acordou.
    p.liberar('run-1')
    const tres = p.adquirir({ runId: 'run-3' })

    expect(await dois).toEqual({ ok: true, codexHome: HOME })
    expect(p.dono()).toBe('run-2')
    expect(await estado(tres)).toBe('pendente')
    p.liberar('run-2')
    expect(await tres).toEqual({ ok: true, codexHome: HOME })
  })

  it('o INSERT que perde a corrida para outro processo não vira posse: o run espera', async () => {
    // `buscar` viu o lease livre, mas outro processo o inseriu antes: o `UNIQUE` recusa o INSERT.
    const perdeuACorrida = {
      buscar: () => undefined,
      adquirir: () => undefined,
      renovar: () => false,
      liberar: () => false
    }
    const p = new PosseDoPerfilCodex({
      leases: perdeuACorrida,
      userId: () => USER,
      codexHome: () => HOME,
      intervaloDeEsperaMs: 5
    })
    const controle = new AbortController()

    const espera = p.adquirir({ runId: 'run-1', signal: controle.signal })
    await volta(25)
    controle.abort()

    // Nunca `ok`: sem o lease, o run não possui o perfil.
    expect(await espera).toEqual({ ok: false, motivo: 'cancelada' })
  })
})

describe('o dono que pede de novo com fila não vazia (revisão de segurança)', () => {
  it('reassume na hora, sem entrar na fila atrás de quem espera o perfil que ele mesmo segura', async () => {
    const p = posse()
    await p.adquirir({ runId: 'run-1' })
    const dois = p.adquirir({ runId: 'run-2' })
    await volta(5)

    // O run-1 invoca o Codex de novo (um fix pós-CI, por exemplo) enquanto o run-2 espera.
    const denovo = await p.adquirir({ runId: 'run-1' })

    expect(denovo).toEqual({ ok: true, codexHome: HOME })
    expect(p.dono()).toBe('run-1')
    p.liberar('run-1')
    expect(await dois).toEqual({ ok: true, codexHome: HOME })
  })
})

describe('falha de gravação do lease não some em silêncio', () => {
  it('o INSERT que não grava (erro do banco) é avisado uma vez e o run segue esperando', async () => {
    logCat.warn.mockClear()
    const naoGrava = {
      buscar: () => undefined,
      adquirir: () => undefined,
      renovar: () => false,
      liberar: () => false
    }
    const p = new PosseDoPerfilCodex({
      leases: naoGrava,
      userId: () => USER,
      codexHome: () => HOME,
      intervaloDeEsperaMs: 5
    })
    const controle = new AbortController()

    const espera = p.adquirir({ runId: 'run-1', signal: controle.signal })
    await volta(40)
    controle.abort()
    await espera

    // Várias tentativas, **um** aviso: o log não vira enxurrada a cada 2 s.
    expect(logCat.warn).toHaveBeenCalledTimes(1)
  })
})

describe('recolherOrfa (a rede de proteção de um liberar que falhou)', () => {
  it('devolve a posse de um dono que terminou e não está em voo, e passa a vez a quem esperava', async () => {
    // Reconferência longa: só o despertar do `liberar` explica o `run-2` adquirir a tempo.
    const p = posse(60_000)
    await p.adquirir({ runId: 'run-1' })
    const dois = p.adquirir({ runId: 'run-2' })
    await volta(5)

    const recolhido = p.recolherOrfa({ emVoo: () => false, terminou: () => true })

    expect(recolhido).toBe('run-1')
    expect(await dois).toEqual({ ok: true, codexHome: HOME })
  })

  it('dono em voo neste processo nunca é tocado, mesmo que o run conste como terminal', async () => {
    const p = posse()
    await p.adquirir({ runId: 'run-1' })

    expect(p.recolherOrfa({ emVoo: () => true, terminou: () => true })).toBeUndefined()
    expect(p.dono()).toBe('run-1')
  })

  it('dono cujo run ainda está ativo não é tocado', async () => {
    const p = posse()
    await p.adquirir({ runId: 'run-1' })

    expect(p.recolherOrfa({ emVoo: () => false, terminou: () => false })).toBeUndefined()
    expect(p.dono()).toBe('run-1')
  })

  it('sem dono, não há o que recolher', () => {
    expect(posse().recolherOrfa({ emVoo: () => false, terminou: () => true })).toBeUndefined()
  })
})

describe('o lease de outro run nunca é tomado', () => {
  it('lease expirado de outro run: recusa explícita, sem esperar e sem roubar (decisão da reconciliação)', async () => {
    const p = posse()
    await p.adquirir({ runId: 'run-1' })
    relogio += VALIDADE_DO_LEASE_MS + 1

    const r = await p.adquirir({ runId: 'run-2' })

    expect(r).toEqual({ ok: false, motivo: 'requer-reconciliacao' })
    expect(p.dono()).toBe('run-1')
  })

  it('só o dono renova', async () => {
    const p = posse()
    await p.adquirir({ runId: 'run-1' })
    relogio += 10_000

    expect(p.renovar('run-2')).toBe(false)
    expect(p.renovar('run-1')).toBe(true)
    expect(leases.buscar(USER, RECURSO_DO_PERFIL_CODEX)?.heartbeatEm).toBe(relogio)
  })

  it('só o dono libera: liberar o de outro é roubo com outro nome', async () => {
    const p = posse()
    await p.adquirir({ runId: 'run-1' })

    expect(p.liberar('run-2')).toBe(false)
    expect(p.dono()).toBe('run-1')
    expect(p.liberar('run-1')).toBe(true)
    expect(p.liberar('run-1')).toBe(false)
    expect(p.dono()).toBeUndefined()
  })

  it('a renovação mantém a posse viva além da validade do lease', async () => {
    const p = posse()
    await p.adquirir({ runId: 'run-1' })

    relogio += VALIDADE_DO_LEASE_MS - 1_000
    p.renovar('run-1')
    relogio += VALIDADE_DO_LEASE_MS - 1_000

    // Sem a renovação o lease estaria expirado; com ela, o run-2 só espera (não pede reconciliação).
    const r = p.adquirir({ runId: 'run-2' })
    expect(await estado(r)).toBe('pendente')
    p.liberar('run-1')
    expect(await r).toEqual({ ok: true, codexHome: HOME })
  })
})
