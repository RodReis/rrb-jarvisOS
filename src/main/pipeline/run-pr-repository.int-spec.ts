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
const PR = {
  runId: 'r-1',
  workspaceId: 'jarvis',
  owner: 'o',
  repo: 'r',
  pullRequest: 7,
  branch: 'feat/x'
} as const

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
    expect(repo.pendentes(USER, AGORA, 0).map((p) => p.runId)).toEqual(['r-1'])

    expect(repo.concluirRascunho(USER, 'r-1', 'convertido', AGORA)).toBe(true)
    expect(repo.doRun(USER, 'r-1')?.rascunho).toBe('convertido')
    expect(repo.pendentes(USER, AGORA, 0)).toEqual([])
  })

  it('só conclui o que estava pendente: o resultado não é sobrescrito por outro', () => {
    repo.registrar(USER, PR, AGORA)
    repo.pedirRascunho(USER, 'r-1', AGORA)
    repo.concluirRascunho(USER, 'r-1', 'convertido', AGORA)

    expect(repo.concluirRascunho(USER, 'r-1', 'indisponivel', AGORA)).toBe(false)
    expect(repo.doRun(USER, 'r-1')?.rascunho).toBe('convertido')
  })

  it('o PR carrega o workspace do run: o escopo é dado, não derivado', () => {
    repo.registrar(USER, PR, AGORA)

    expect(repo.doRun(USER, 'r-1')?.workspaceId).toBe('jarvis')
  })

  describe('tentativas e espaçamento — a origem fora do ar não é martelada', () => {
    const ESPACO = 300_000

    it('a tentativa conta e o pedido só volta a ser listado depois do espaçamento', () => {
      repo.registrar(USER, PR, AGORA)
      repo.pedirRascunho(USER, 'r-1', AGORA)
      expect(repo.pendentes(USER, AGORA, ESPACO)).toHaveLength(1)

      expect(repo.registrarTentativa(USER, 'r-1', AGORA)).toBe(1)

      expect(repo.pendentes(USER, AGORA + ESPACO - 1, ESPACO)).toEqual([])
      expect(repo.pendentes(USER, AGORA + ESPACO, ESPACO)).toHaveLength(1)
    })

    it('o contador cresce a cada tentativa e é por run', () => {
      repo.registrar(USER, PR, AGORA)
      repo.registrar(USER, { ...PR, runId: 'r-2', pullRequest: 8 }, AGORA)
      repo.pedirRascunho(USER, 'r-1', AGORA)

      repo.registrarTentativa(USER, 'r-1', AGORA)
      expect(repo.registrarTentativa(USER, 'r-1', AGORA + 1)).toBe(2)
      expect(repo.registrarTentativa(USER, 'r-2', AGORA)).toBe(1)
    })

    it('registrar o PR de novo não zera o contador', () => {
      repo.registrar(USER, PR, AGORA)
      repo.pedirRascunho(USER, 'r-1', AGORA)
      repo.registrarTentativa(USER, 'r-1', AGORA)

      repo.registrar(USER, PR, AGORA + 5)

      expect(repo.registrarTentativa(USER, 'r-1', AGORA + 6)).toBe(2)
    })
  })

  describe('PR reaproveitado por outro run (retomada vinculada)', () => {
    const noRun = (runId: string, estado: string): void =>
      void db
        .prepare(
          `INSERT INTO pipeline_run (id, user_id, workspace_id, project_id, slice_id, estado, created_at, updated_at)
           VALUES (?, ?, 'jarvis', 'p', 's', ?, 'x', 'x')`
        )
        .run(runId, USER, estado)

    it('outro run ativo apontando para o mesmo PR é detectado', () => {
      noRun('r-1', 'CANCELLED')
      noRun('r-2', 'RUNNING')
      repo.registrar(USER, PR, AGORA)
      repo.registrar(USER, { ...PR, runId: 'r-2' }, AGORA)

      expect(repo.outroRunAtivoUsa(USER, 'r-1')).toBe(true)
    })

    it('outro run já terminado não conta, nem o PR de outro número', () => {
      noRun('r-1', 'CANCELLED')
      noRun('r-2', 'BLOCKED')
      noRun('r-3', 'RUNNING')
      repo.registrar(USER, PR, AGORA)
      repo.registrar(USER, { ...PR, runId: 'r-2' }, AGORA)
      repo.registrar(USER, { ...PR, runId: 'r-3', pullRequest: 99 }, AGORA)

      expect(repo.outroRunAtivoUsa(USER, 'r-1')).toBe(false)
    })

    it('o próprio run não conta como "outro"', () => {
      noRun('r-1', 'RUNNING')
      repo.registrar(USER, PR, AGORA)

      expect(repo.outroRunAtivoUsa(USER, 'r-1')).toBe(false)
    })
  })

  it('desfazer o pedido volta ao estado sem rascunho (cancelamento recusado)', () => {
    repo.registrar(USER, PR, AGORA)
    repo.pedirRascunho(USER, 'r-1', AGORA)

    expect(repo.desfazerPedido(USER, 'r-1', AGORA)).toBe(true)

    expect(repo.doRun(USER, 'r-1')?.rascunho).toBeUndefined()
    expect(repo.pendentes(USER, AGORA, 0)).toEqual([])
  })

  it('pedir o rascunho de PR que já tem resultado não reabre o pedido', () => {
    repo.registrar(USER, PR, AGORA)
    repo.pedirRascunho(USER, 'r-1', AGORA)
    repo.concluirRascunho(USER, 'r-1', 'convertido', AGORA)

    expect(repo.pedirRascunho(USER, 'r-1', AGORA)).toBe(false)
  })
})
