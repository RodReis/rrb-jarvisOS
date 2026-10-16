import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import type { ReleaseScope } from '@shared/domain/release'
import { AuditRepository } from '../../storage/audit-repository'
import { openDatabase } from '../../storage/database'
import { PipelineRepository } from '../../pipeline/pipeline-repository'
import { V2CorrectionUnavailable, type CorrectionRequest } from '../correction/dispatcher'
import { V2PipelineCorrectionAdapter } from './v2-pipeline-correction-adapter'

const NOW = new Date('2026-10-16T12:00:00.000Z')
const SCOPE: ReleaseScope = { userId: 'user-1', workspaceId: 'jarvis', projectId: 'project-1' }
const OUTRO_PROJETO: ReleaseScope = { ...SCOPE, projectId: 'project-2' }
const ESCOPO_V2 = { userId: 'user-1', workspaceId: 'jarvis' as const, projectId: 'project-1' }

let directory: string
let db: Database
let runs: PipelineRepository
let adapter: V2PipelineCorrectionAdapter

const pedido = (sliceId: string, extra: Partial<CorrectionRequest> = {}): CorrectionRequest => ({
  scope: SCOPE,
  releaseId: 'release-1',
  sliceId,
  specId: 'spec-x',
  dispatchKey: 'release-correction:release-1',
  contextJson: '{}',
  contextSha256: 'a'.repeat(64),
  ...extra
})

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'v2-correction-'))
  db = openDatabase(join(directory, 'v2.db'))
  runs = new PipelineRepository(db)
  adapter = new V2PipelineCorrectionAdapter(runs, new AuditRepository(db, 'chave-v2'), () => NOW)
})

afterEach(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('V2PipelineCorrectionAdapter (correção volta à V2, critério 6)', () => {
  it('abre um run PLANNED na mesma fatia, que segue o gate normal de aprovação da SPEC', async () => {
    const anterior = runs.criar(ESCOPO_V2, { sliceId: 'slice-9', estado: 'PLANNED' }, NOW)

    const { runId } = await adapter.open(pedido('slice-9'))

    const run = runs.buscar(runId)!
    expect(run).toMatchObject({
      projectId: 'project-1',
      sliceId: 'slice-9',
      estado: 'PLANNED',
      dispatchKey: 'release-correction:release-1'
    })
    expect(run.id).not.toBe(anterior.id)
    // Sem aceite novo: o run NÃO nasce aprovado nem pulando estados — o gate SLICE_ENTRY é o da V2.
    expect(run.estado).toBe('PLANNED')
  })

  it('é idempotente pela chave de dispatch: repetir devolve o mesmo run', async () => {
    runs.criar(ESCOPO_V2, { sliceId: 'slice-9', estado: 'PLANNED' }, NOW)
    const a = await adapter.open(pedido('slice-9'))
    const b = await adapter.open(pedido('slice-9'))
    expect(b.runId).toBe(a.runId)
    expect(runs.listarDaFatia(ESCOPO_V2, 'slice-9')).toHaveLength(2)
  })

  it('fatia que a V2 nunca executou neste projeto é recusa definitiva', async () => {
    await expect(adapter.open(pedido('slice-fantasma'))).rejects.toMatchObject({
      name: 'V2CorrectionUnavailable',
      code: 'slice-unknown'
    })
    await expect(adapter.open(pedido('slice-fantasma'))).rejects.toBeInstanceOf(
      V2CorrectionUnavailable
    )
  })

  it('a fatia de outro projeto não conta', async () => {
    runs.criar(
      { userId: 'user-1', workspaceId: 'jarvis', projectId: OUTRO_PROJETO.projectId },
      { sliceId: 'slice-9', estado: 'PLANNED' },
      NOW
    )
    await expect(adapter.open(pedido('slice-9'))).rejects.toMatchObject({ code: 'slice-unknown' })
  })

  it('a fatia de outro workspace do mesmo projeto não conta', async () => {
    runs.criar(
      { userId: 'user-1', workspaceId: 'noa', projectId: 'project-1' },
      { sliceId: 'slice-9', estado: 'PLANNED' },
      NOW
    )
    await expect(adapter.open(pedido('slice-9'))).rejects.toMatchObject({ code: 'slice-unknown' })
  })

  it('a criação do run é auditada como transição de pipeline, sem o contexto', async () => {
    runs.criar(ESCOPO_V2, { sliceId: 'slice-9', estado: 'PLANNED' }, NOW)
    const { runId } = await adapter.open(pedido('slice-9', { contextJson: '{"segredo":"x"}' }))
    const eventos = new AuditRepository(db, 'chave-v2').list('user-1')
    const doRun = eventos.filter(
      (e) => e.type === 'pipeline-transition' && JSON.stringify(e.payload).includes(runId)
    )
    expect(doRun).toHaveLength(1)
    expect(JSON.stringify(doRun)).not.toContain('segredo')
  })
})
