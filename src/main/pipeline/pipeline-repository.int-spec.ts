import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PERFIL_PADRAO } from '@shared/domain/squad-perfil'
import type { AmbienteDeResolucao } from '@shared/domain/squad-resolucao'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { PipelineRepository } = await import('./pipeline-repository')
const { criarSnapshotDoSquad } = await import('../squads/squad-snapshot')

const USER = 'u-1'
const ESCOPO = { userId: USER, workspaceId: 'jarvis', projectId: 'p-1' } as const
const AGORA = new Date('2026-10-07T12:00:00.000Z')
const AMBIENTE: AmbienteDeResolucao = {
  skills: ['code-review'],
  ferramentas: [],
  ollama: { disponivel: false, modelos: [] },
  optInApiPaga: false
}
const SNAPSHOT = criarSnapshotDoSquad(PERFIL_PADRAO, AMBIENTE, {
  provider: 'claude-code',
  modelo: 'claude-fable-5-1'
})

let dir: string
let db: Db
let repo: InstanceType<typeof PipelineRepository>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-pipeline-repo-'))
  db = openDatabase(join(dir, 'teste.db'))
  repo = new PipelineRepository(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('PipelineRepository — snapshot do Squad', () => {
  it('persiste e recarrega snapshot válido com o escopo do run', () => {
    const run = repo.criar(ESCOPO, { sliceId: 'f01', estado: 'PLANNED' }, AGORA)

    expect(repo.registrarSnapshotDoSquad(ESCOPO, run.id, SNAPSHOT, AGORA)).toBe(true)
    expect(repo.buscar(run.id)).toMatchObject({
      id: run.id,
      user_id: USER,
      projectId: ESCOPO.projectId,
      squadSnapshot: SNAPSHOT
    })
    expect(
      repo.registrarSnapshotDoSquad({ ...ESCOPO, projectId: 'p-2' }, run.id, SNAPSHOT, AGORA)
    ).toBe(false)
  })

  it('recusa adulteração e não projeta snapshot adulterado lido do SQLite', () => {
    const run = repo.criar(ESCOPO, { sliceId: 'f01', estado: 'PLANNED' }, AGORA)
    const adulterado = structuredClone(SNAPSHOT)
    ;(adulterado as { revisao: string }).revisao = '0'.repeat(64)

    expect(repo.registrarSnapshotDoSquad(ESCOPO, run.id, adulterado, AGORA)).toBe(false)
    db.prepare('UPDATE pipeline_run SET squad_snapshot = ? WHERE id = ?').run(
      JSON.stringify(adulterado),
      run.id
    )
    expect(repo.buscar(run.id)?.squadSnapshot).toBeUndefined()
  })
})
