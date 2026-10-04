import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { LockRepository } = await import('./lock-repository')
const { LeaseRepository } = await import('./lease-repository')

const USER = 'u-1'
const AGORA = 1_700_000_000_000

let dir: string
let db: Db
let locks: InstanceType<typeof LockRepository>
let leases: InstanceType<typeof LeaseRepository>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-lock-'))
  db = openDatabase(join(dir, 'teste.db'))
  locks = new LockRepository(db)
  leases = new LeaseRepository(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const travas = (caminhos: string[], recursos: string[] = []) => ({ caminhos, recursos })
const slot = (runId: string, recurso = 'wip:slot:1') =>
  leases.adquirir(USER, { proprietario: runId, recurso, projectId: 'p', fencingToken: 1 }, AGORA)

describe('escopo e travas de um run', () => {
  it('registra o escopo e as travas, e devolve as travas do projeto', () => {
    locks.registrarEscopo(
      USER,
      { runId: 'a', projectId: 'p', conhecido: true, catalogoVersao: 1 },
      AGORA
    )
    const r = locks.adquirir(USER, 'a', 'p', travas(['src/api'], ['lockfile']), 'inicial', AGORA)

    expect(r).toEqual({ ok: true })
    expect(locks.travasDoProjeto(USER, 'p')).toEqual([
      { runId: 'a', tipo: 'caminho', chave: 'src/api' },
      { runId: 'a', tipo: 'recurso', chave: 'lockfile' }
    ])
    expect(locks.escopo('a')).toEqual({ projectId: 'p', conhecido: true, catalogoVersao: 1 })
  })

  it('o escopo desconhecido é registrado como tal', () => {
    locks.registrarEscopo(
      USER,
      { runId: 'a', projectId: 'p', conhecido: false, catalogoVersao: 1 },
      AGORA
    )
    expect(locks.escopo('a')?.conhecido).toBe(false)
    expect(locks.travasDoRun('a')).toEqual({ caminhos: [], recursos: [] })
  })

  it('outro run do mesmo projeto em conflito: recusa e NÃO grava nada, nem o que não conflitava', () => {
    locks.adquirir(USER, 'a', 'p', travas(['src/api'], ['lockfile']), 'inicial', AGORA)

    const r = locks.adquirir(
      USER,
      'b',
      'p',
      travas(['docs/x', 'src/api/y'], ['lockfile']),
      'inicial',
      AGORA
    )

    expect(r.ok).toBe(false)
    expect(r.ok === false && r.conflitos.map((c) => c.tipo)).toEqual(['caminho', 'recurso'])
    expect(locks.travasDoRun('b')).toEqual({ caminhos: [], recursos: [] })
  })

  it('projetos diferentes não conflitam: são repositórios diferentes', () => {
    locks.adquirir(USER, 'a', 'p1', travas(['src'], ['lockfile']), 'inicial', AGORA)
    const r = locks.adquirir(USER, 'b', 'p2', travas(['src'], ['lockfile']), 'inicial', AGORA)
    expect(r).toEqual({ ok: true })
  })

  it('usuários diferentes não se enxergam', () => {
    locks.adquirir(USER, 'a', 'p', travas(['src']), 'inicial', AGORA)
    expect(locks.travasDoProjeto('u-2', 'p')).toEqual([])
  })

  it('o dono repete a aquisição (retry depois de crash) sem conflitar consigo nem duplicar', () => {
    locks.adquirir(USER, 'a', 'p', travas(['src/api'], ['lockfile']), 'inicial', AGORA)
    const r = locks.adquirir(
      USER,
      'a',
      'p',
      travas(['src/api', 'src/web'], ['lockfile']),
      'expansao',
      AGORA + 1
    )

    expect(r).toEqual({ ok: true })
    expect(locks.travasDoRun('a')).toEqual({
      caminhos: ['src/api', 'src/web'],
      recursos: ['lockfile']
    })
  })

  it('o UNIQUE do banco é a segunda barreira do recurso exclusivo', () => {
    locks.adquirir(USER, 'a', 'p', travas([], ['lockfile']), 'inicial', AGORA)
    expect(() =>
      db
        .prepare(
          `INSERT INTO pool_lock (user_id, run_id, project_id, tipo, chave, adquirido_em, origem)
           VALUES (?, 'b', 'p', 'recurso', 'lockfile', ?, 'inicial')`
        )
        .run(USER, AGORA)
    ).toThrow(/UNIQUE/i)
  })
})

describe('liberação — locks vivem enquanto o slot do dono existe (critério 5)', () => {
  it('soltar remove travas e escopo do run, e só os dele', () => {
    locks.registrarEscopo(
      USER,
      { runId: 'a', projectId: 'p', conhecido: true, catalogoVersao: 1 },
      AGORA
    )
    locks.adquirir(USER, 'a', 'p', travas(['src/a']), 'inicial', AGORA)
    locks.adquirir(USER, 'b', 'p', travas(['src/b']), 'inicial', AGORA)

    expect(locks.soltar('a')).toBe(1)

    expect(locks.travasDoProjeto(USER, 'p').map((t) => t.runId)).toEqual(['b'])
    expect(locks.escopo('a')).toBeUndefined()
  })

  it('varrer órfãos remove só travas cujo dono não tem mais slot; lease expirado ainda segura', () => {
    slot('vivo', 'wip:slot:1')
    slot('expirado', 'wip:slot:2')
    db.prepare("UPDATE lease SET expira_em = 1 WHERE proprietario = 'expirado'").run()
    locks.adquirir(USER, 'vivo', 'p', travas(['src/v']), 'inicial', AGORA)
    locks.adquirir(USER, 'expirado', 'p', travas(['src/e']), 'inicial', AGORA)
    locks.adquirir(USER, 'orfao', 'p', travas(['src/o']), 'inicial', AGORA)

    const liberados = locks.varrerOrfaos(USER)

    expect(liberados).toEqual(['orfao'])
    expect(
      locks
        .travasDoProjeto(USER, 'p')
        .map((t) => t.runId)
        .sort()
    ).toEqual(['expirado', 'vivo'])
  })

  it('o escopo órfão também sai', () => {
    locks.registrarEscopo(
      USER,
      { runId: 'orfao', projectId: 'p', conhecido: false, catalogoVersao: 1 },
      AGORA
    )
    expect(locks.varrerOrfaos(USER)).toEqual(['orfao'])
    expect(locks.escopo('orfao')).toBeUndefined()
  })
})

describe('provas e expansões — o registro', () => {
  const prova = {
    runId: 'b',
    projectId: 'p',
    independente: true,
    fingerprint: 'f1',
    catalogoVersao: 1,
    razoes: [],
    contra: ['a']
  }

  it('registra a prova usada e a devolve por run', () => {
    locks.registrarProva(USER, prova, AGORA)
    expect(locks.provasDoRun('b')).toEqual([{ ...prova, em: AGORA, invalidadaEm: undefined }])
  })

  it('invalidar marca as provas que contavam com o run, sem apagar', () => {
    locks.registrarProva(USER, prova, AGORA)
    locks.registrarProva(USER, { ...prova, runId: 'c', fingerprint: 'f2', contra: ['x'] }, AGORA)

    const n = locks.invalidarProvas(USER, 'a', AGORA + 10)

    expect(n).toBe(1)
    expect(locks.provasDoRun('b')[0].invalidadaEm).toBe(AGORA + 10)
    expect(locks.provasDoRun('c')[0].invalidadaEm).toBeUndefined()
  })

  it('invalidar é idempotente: não reescreve o carimbo', () => {
    locks.registrarProva(USER, prova, AGORA)
    locks.invalidarProvas(USER, 'a', AGORA + 10)
    expect(locks.invalidarProvas(USER, 'a', AGORA + 99)).toBe(0)
    expect(locks.provasDoRun('b')[0].invalidadaEm).toBe(AGORA + 10)
  })

  it('registra cada expansão, com o resultado e os conflitos', () => {
    locks.registrarExpansao(
      USER,
      {
        runId: 'b',
        projectId: 'p',
        caminhos: ['src/x'],
        resultado: 'conflito',
        conflitos: [{ tipo: 'caminho', chave: 'src/x', comRunId: 'a', comChave: 'src' }]
      },
      AGORA
    )
    const e = locks.expansoesDoRun('b')
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ resultado: 'conflito', caminhos: ['src/x'], em: AGORA })
    expect(e[0].conflitos[0].comRunId).toBe('a')
  })
})
