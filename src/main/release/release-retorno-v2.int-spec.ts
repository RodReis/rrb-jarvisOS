import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Approval, RevisaoAprovada } from '@shared/domain/aprovacoes'
import type { Mvp, Slice } from '@shared/domain/roadmap'
import type { Harness } from './promotion-test-harness'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { FilaService } = await import('../pipeline/fila-service')
const { LeaseRepository } = await import('../pipeline/lease-repository')
const { MergeRepository } = await import('../pipeline/merge-repository')
const { PipelineRepository } = await import('../pipeline/pipeline-repository')
const { PoolRepository } = await import('../pipeline/pool-repository')
const { PoolService } = await import('../pipeline/pool-service')
const { V2PipelineCorrectionAdapter } = await import('./adapters/v2-pipeline-correction-adapter')
const { SCOPE, SHA_A, montarHarness, projeto, semearReleaseConcluida } =
  await import('./promotion-test-harness')

/**
 * A correção devolvida à V2 atravessa a fila REAL da V2 (SPEC-Release-05, critério 6): o run
 * aberto pela release segue o gate `SLICE_ENTRY` e reaproveita a aprovação vigente da mesma
 * revisão da SPEC — sem novo aceite de produto — e volta a exigir aceite se a SPEC mudou.
 */

let h: Harness

afterEach(() => h.fechar())

const WS = SCOPE.workspaceId
const ESCOPO_V2 = { userId: SCOPE.userId, workspaceId: WS, projectId: SCOPE.projectId }
const REVISAO_1: readonly RevisaoAprovada[] = [{ artefato: 'spec-release-05', hash: 'h-1' }]
const REVISAO_2: readonly RevisaoAprovada[] = [{ artefato: 'spec-release-05', hash: 'h-2' }]
const origem: Mvp['origem'] = { tipo: 'decisao', decisaoId: 'd-1', perguntaId: 'p-1' }
const MVPS: readonly Mvp[] = [
  { id: 'm14', numero: 14, titulo: 'MVP 14', tese: 't', estado: 'na-fila', dependeDe: [], origem }
]
const SLICES: readonly Slice[] = [
  {
    id: 'slice-9',
    mvpId: 'm14',
    numero: 9,
    titulo: 'F05',
    specSlug: 'spec-release-05',
    detalhada: true,
    origem
  }
]

const aprovacaoDoPi = (): Approval => ({
  id: 'a-1',
  user_id: SCOPE.userId,
  workspace_id: WS,
  projectId: SCOPE.projectId,
  gate: 'SLICE_ENTRY',
  revisoes: REVISAO_1,
  identidade: 'sessao-1',
  autor: 'pi',
  created_at: '2026-08-29T12:00:00.000Z'
})

/** O mundo da release com a porta REAL da V2: o adaptador escreve no mesmo banco da fila. */
function mundo(): void {
  h = montarHarness({
    v2: {
      open: (pedido) =>
        new V2PipelineCorrectionAdapter(
          new PipelineRepository(h.db),
          h.audit,
          () => new Date(h.clock.now())
        ).open(pedido)
    }
  })
}

function filaDaV2(revisoes: () => readonly RevisaoAprovada[], aprovacoes: () => Approval[]) {
  const runs = new PipelineRepository(h.db)
  const merges = new MergeRepository(h.db)
  const agora = (): number => Date.parse(h.clock.now())
  // eslint-disable-next-line prefer-const -- a fila e o pool se referenciam; o pool só chama depois.
  let fila: InstanceType<typeof FilaService>
  const pool = new PoolService({
    db: h.db,
    pool: new PoolRepository(h.db),
    leases: new LeaseRepository(h.db),
    audit: h.audit,
    userId: () => SCOPE.userId,
    workspaceId: () => WS,
    gates: (item) => fila.gatesDoItem(item),
    ativar: (item) => fila.ativarRun(item),
    agora
  })
  fila = new FilaService({
    runs,
    pool,
    workspaceId: () => WS,
    audit: h.audit,
    roadmap: () => ({ mvps: MVPS, slices: SLICES }),
    aprovacoes,
    revisoesDoGate: revisoes,
    userId: () => SCOPE.userId,
    mergeAutonomoLigado: () => true,
    mergeEmCurso: (runId) => merges.emCursoDoRun(SCOPE.userId, runId),
    agora
  })
  return { fila, runs }
}

async function falhaEmProducao(): Promise<string> {
  semearReleaseConcluida(h)
  h.cloud.smokeFails.add('production')
  const r = await h.service.handleMerge(SCOPE, SHA_A, projeto(), {
    pullRequest: 432,
    specId: 'spec-release-05',
    sliceId: 'slice-9',
    issue: 154
  })
  expect(r.state).toBe('failed')
  return r.releaseId
}

describe('correção na fila real da V2', () => {
  it('o run da correção chega a READY com a aprovação que já existia: nenhum aceite novo', async () => {
    mundo()
    const aprovacoes = [aprovacaoDoPi()]
    const { fila, runs } = filaDaV2(
      () => REVISAO_1,
      () => aprovacoes
    )
    const original = fila.criarRun(SCOPE.projectId, WS, 'slice-9')

    const releaseId = await falhaEmProducao()

    const correcao = h.recovery.correction(SCOPE, releaseId)!
    expect(correcao.state).toBe('opened')
    const run = runs.buscarPorChaveDispatch(ESCOPO_V2, `release-correction:${releaseId}`)!
    expect(run).toMatchObject({ id: correcao.runId, sliceId: 'slice-9', estado: 'PLANNED' })
    expect(run.id).not.toBe(original.id)

    expect(fila.transicionar(SCOPE.projectId, WS, run.id, 'AWAITING_PI').reason).toBe(
      'transicionado'
    )
    expect(fila.transicionar(SCOPE.projectId, WS, run.id, 'READY').reason).toBe('transicionado')
    // Nenhuma aprovação foi criada nem pedida: a que o PI já deu para esta revisão bastou.
    expect(aprovacoes).toHaveLength(1)
  })

  it('SPEC que mudou depois da aprovação volta a exigir aceite: a correção não o contorna', async () => {
    mundo()
    let revisoes = REVISAO_1
    const aprovacoes = [aprovacaoDoPi()]
    const { fila, runs } = filaDaV2(
      () => revisoes,
      () => aprovacoes
    )
    fila.criarRun(SCOPE.projectId, WS, 'slice-9')
    const releaseId = await falhaEmProducao()
    const run = runs.buscarPorChaveDispatch(ESCOPO_V2, `release-correction:${releaseId}`)!

    revisoes = REVISAO_2 // a SPEC foi editada: a aprovação deixou de valer
    fila.transicionar(SCOPE.projectId, WS, run.id, 'AWAITING_PI')
    expect(fila.transicionar(SCOPE.projectId, WS, run.id, 'READY').reason).toBe(
      'sem-aprovacao-vigente'
    )
    expect(runs.buscar(run.id)?.estado).toBe('AWAITING_PI')
  })

  it('fatia que a V2 nunca executou não ganha run: fica indisponível, com a ação mínima', async () => {
    mundo()
    const releaseId = await falhaEmProducao()
    expect(h.recovery.correction(SCOPE, releaseId)).toMatchObject({
      state: 'unavailable',
      stateReason: 'slice-unknown'
    })
    expect(h.recovery.evidence(SCOPE, releaseId)).toContainEqual(
      expect.objectContaining({ kind: 'correction', action: 'open-v2-run-manually' })
    )
  })
})
