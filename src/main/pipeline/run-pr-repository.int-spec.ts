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
const { RunPrRepository } = await import('./run-pr-repository')

const USER = 'u-1'
const AGORA = 1_700_000_000_000
const PR = { runId: 'r-1', owner: 'o', repo: 'r', pullRequest: 7, branch: 'feat/x' } as const

let dir: string
let db: Db
let repo: InstanceType<typeof RunPrRepository>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-run-pr-'))
  db = openDatabase(join(dir, 'teste.db'))
  repo = new RunPrRepository(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('RunPrRepository — o PR que o run publicou', () => {
  it('o run lembra o PR que publicou', () => {
    repo.registrar(USER, PR, AGORA)

    expect(repo.doRun(USER, 'r-1')).toEqual({ ...PR })
  })

  it('run sem PR não tem registro', () => {
    expect(repo.doRun(USER, 'r-1')).toBeUndefined()
  })

  it('registrar de novo é idempotente e não perde o estado do rascunho', () => {
    repo.registrar(USER, PR, AGORA)
    repo.pedirRascunho(USER, 'r-1', AGORA)

    repo.registrar(USER, PR, AGORA + 1)

    expect(repo.doRun(USER, 'r-1')?.rascunho).toBe('pendente')
  })

  it('é escopado pelo usuário: outro usuário não vê nem muda o PR', () => {
    repo.registrar(USER, PR, AGORA)

    expect(repo.doRun('u-2', 'r-1')).toBeUndefined()
    expect(repo.pedirRascunho('u-2', 'r-1', AGORA)).toBe(false)
  })

  it('o rascunho nasce pendente e termina convertido, indisponível ou não aberto', () => {
    repo.registrar(USER, PR, AGORA)
    expect(repo.doRun(USER, 'r-1')?.rascunho).toBeUndefined()

    expect(repo.pedirRascunho(USER, 'r-1', AGORA)).toBe(true)
    expect(repo.pendentes(USER).map((p) => p.runId)).toEqual(['r-1'])

    expect(repo.concluirRascunho(USER, 'r-1', 'convertido', AGORA)).toBe(true)
    expect(repo.doRun(USER, 'r-1')?.rascunho).toBe('convertido')
    expect(repo.pendentes(USER)).toEqual([])
  })

  it('só conclui o que estava pendente: o resultado não é sobrescrito por outro', () => {
    repo.registrar(USER, PR, AGORA)
    repo.pedirRascunho(USER, 'r-1', AGORA)
    repo.concluirRascunho(USER, 'r-1', 'convertido', AGORA)

    expect(repo.concluirRascunho(USER, 'r-1', 'indisponivel', AGORA)).toBe(false)
    expect(repo.doRun(USER, 'r-1')?.rascunho).toBe('convertido')
  })

  it('desfazer o pedido volta ao estado sem rascunho (cancelamento recusado)', () => {
    repo.registrar(USER, PR, AGORA)
    repo.pedirRascunho(USER, 'r-1', AGORA)

    expect(repo.desfazerPedido(USER, 'r-1', AGORA)).toBe(true)

    expect(repo.doRun(USER, 'r-1')?.rascunho).toBeUndefined()
    expect(repo.pendentes(USER)).toEqual([])
  })

  it('pedir o rascunho de PR que já tem resultado não reabre o pedido', () => {
    repo.registrar(USER, PR, AGORA)
    repo.pedirRascunho(USER, 'r-1', AGORA)
    repo.concluirRascunho(USER, 'r-1', 'convertido', AGORA)

    expect(repo.pedirRascunho(USER, 'r-1', AGORA)).toBe(false)
  })
})
