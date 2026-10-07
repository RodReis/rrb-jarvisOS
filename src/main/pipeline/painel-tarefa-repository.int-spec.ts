import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SnapshotCapturado } from './painel-tarefa-repository'

const logDb = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({ log: new Proxy({}, { get: () => logDb }) }))

const { openDatabase } = await import('../storage/database')
const { PipelineRepository } = await import('./pipeline-repository')
const { PainelDaTarefaRepository } = await import('./painel-tarefa-repository')

const scope = { userId: 'u-1', workspaceId: 'jarvis' as const, projectId: 'p-1' }
const snapshotScope = {
  userId: scope.userId,
  workspace: scope.workspaceId,
  projectId: scope.projectId
}
const now = new Date('2026-10-07T12:00:00.000Z')
let dir: string
let db: Db
let runs: InstanceType<typeof PipelineRepository>
let repo: InstanceType<typeof PainelDaTarefaRepository>
let runId: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-task-panel-'))
  db = openDatabase(join(dir, 'app.db'))
  runs = new PipelineRepository(db)
  repo = new PainelDaTarefaRepository(db, () => now)
  runId = runs.criar(scope, { sliceId: 's-1', estado: 'PLANNED' }, now).id
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const item = (
  caminho: string,
  conteudo: string,
  extra: Partial<SnapshotCapturado> = {}
): SnapshotCapturado => ({
  caminho,
  tipo: 'texto',
  bytes: Buffer.byteLength(conteudo),
  sha256: 'a'.repeat(64),
  conteudo,
  ...extra
})

describe('painel tarefa: snapshots duráveis', () => {
  it('persiste conteúdo e diff com hash e respeita escopo de run', () => {
    expect(
      repo.salvarSnapshots(snapshotScope, runId, 'task-1', [
        item('src/a.ts', 'hello', { diff: '+hello' })
      ])
    ).toBe(true)
    const vista = repo.snapshots(snapshotScope, runId, 'task-1')
    expect(vista.arquivos).toHaveLength(1)
    expect(vista.diffs).toHaveLength(1)
    expect(repo.conteudo(snapshotScope, runId, vista.arquivos[0]!.id)).toBe('hello')
    expect(
      repo.conteudo({ ...snapshotScope, userId: 'other' }, runId, vista.arquivos[0]!.id)
    ).toBeUndefined()
  })

  it('mantém metadado e sinaliza item que excede cota do run', () => {
    const muitos = Array.from({ length: 6 }, (_, i) =>
      item(`src/${i}.txt`, 'x'.repeat(9 * 1024 * 1024))
    )
    repo.salvarSnapshots(snapshotScope, runId, 'task-1', muitos)
    const vista = repo.snapshots(snapshotScope, runId, 'task-1')
    expect(vista.arquivos.filter((arquivo) => arquivo.estado === 'disponivel')).toHaveLength(5)
    expect(vista.arquivos.filter((arquivo) => arquivo.estado === 'incompleto')).toHaveLength(1)
  })

  it('não expira evidência de run bloqueado, mas expira conteúdo antigo de run concluído', () => {
    repo.salvarSnapshots(snapshotScope, runId, 'task-1', [item('src/a.ts', 'hello')])
    runs.transicionar(runId, 'PLANNED', 'BLOCKED', now, {
      causa: 'teste',
      evidencia: 'evidencia',
      tentativas: 0,
      porQueNaoSeguir: 'bloqueado',
      retomada: 'retomar'
    })
    const painel = repo.snapshots(snapshotScope, runId, 'task-1').arquivos[0]!
    db.prepare(
      "UPDATE squad_task_snapshot SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?"
    ).run(painel.id)
    const segundoRunId = runs.criar(scope, { sliceId: 's-2', estado: 'PLANNED' }, now).id
    repo.salvarSnapshots(snapshotScope, segundoRunId, 'task-1', [item('src/b.ts', 'new')])
    const preservado = repo.snapshots(snapshotScope, runId, 'task-1').arquivos[0]
    expect(preservado?.estado).toBe('disponivel')
    expect(repo.conteudo(snapshotScope, runId, painel.id)).toBe('hello')
  })
})
