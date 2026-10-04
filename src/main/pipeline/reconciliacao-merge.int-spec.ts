/**
 * A reconciliação do boot resolve as tentativas de merge (SPEC-Scheduler-04, critério 4).
 *
 * O `MergeService` já tem a prova da reconciliação em si (`merge-service.int-spec.ts`). Aqui a
 * pergunta é outra: **o gancho está no lugar certo da ordem?** O MergeLease de um run em `PR_CI`
 * que o boot encontra expirado seria, pela regra geral dos leases, "lentidão, não morte" — e
 * seguraria a base para sempre. A reconciliação do merge roda antes e resolve o que dá para
 * resolver; o que sobra para a regra geral é só o que o merge não conhece.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { ConnectorOutcome, ConnectorRequest } from '@shared/domain/connectors'
import type { WorkspaceId } from '@shared/domain/entities'
import type { TentativaDeMerge } from './merge-repository'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { recursoDoMerge } = await import('@shared/domain/merge-serializado')
const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { LeaseRepository } = await import('./lease-repository')
const { MergeRepository } = await import('./merge-repository')
const { MergeService } = await import('./merge-service')
const { PipelineRepository } = await import('./pipeline-repository')
const { PoolRepository } = await import('./pool-repository')
const { ReconciliacaoService } = await import('./reconciliacao-service')

const USER = 'u-1'
const WS: WorkspaceId = 'jarvis'
const AGORA = 1_700_000_000_000
const RECURSO = recursoDoMerge('o', 'r', 'main')
const HEAD = 'a'.repeat(40)

let dir: string
let db: Db
let prMergeado: boolean
let aoReconciliarMergeado: Mock<(tentativa: TentativaDeMerge) => void>

function conector(): { call: (r: ConnectorRequest) => Promise<ConnectorOutcome> } {
  return {
    call: async (request): Promise<ConnectorOutcome> =>
      ({
        ok: true,
        data: {
          numero: 7,
          estado: prMergeado ? 'closed' : 'open',
          merged: prMergeado,
          ...(prMergeado ? { mergeSha: 'm'.repeat(40) } : {}),
          headSha: HEAD
        },
        provenance: { connector: 'github', operation: request.operation, obtidoEm: 'agora' },
        usage: { creditos: 0, latenciaMs: 1 }
      }) as unknown as ConnectorOutcome
  }
}

function montar(): InstanceType<typeof ReconciliacaoService> {
  const merges = new MergeRepository(db)
  const leases = new LeaseRepository(db)
  const audit = new AuditRepository(db, 'chave-de-teste')
  const pool = new PoolRepository(db)
  const merge = new MergeService({
    connectors: conector() as never,
    leases,
    merges,
    audit,
    userId: () => USER,
    proximoToken: () => pool.proximoToken(USER),
    aoReconciliarMergeado,
    agora: () => AGORA
  })

  return new ReconciliacaoService({
    runs: new PipelineRepository(db),
    leases,
    audit,
    userId: () => USER,
    workspaceId: () => WS,
    merge,
    agora: () => AGORA + 3_600_000
  })
}

/** Um run em PR_CI que caiu no meio do merge: tentativa iniciada e MergeLease expirado. */
function crashNoMeioDoMerge(): string {
  const runs = new PipelineRepository(db)
  const run = runs.criar(
    { userId: USER, workspaceId: WS, projectId: 'p' },
    { sliceId: 's', estado: 'PR_CI' },
    new Date(AGORA)
  )
  const leases = new LeaseRepository(db)
  leases.adquirir(USER, { proprietario: run.id, recurso: RECURSO, fencingToken: 3 }, AGORA)
  new MergeRepository(db).iniciar(
    USER,
    {
      runId: run.id,
      workspaceId: WS,
      projectId: 'p',
      recurso: RECURSO,
      pullRequest: 7,
      headSha: HEAD,
      fencingToken: 3
    },
    AGORA
  )
  return run.id
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-rec-merge-'))
  db = openDatabase(join(dir, 'app.db'))
  prMergeado = false
  aoReconciliarMergeado = vi.fn()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('reconcileAll com o merge serializado', () => {
  it('PR já mergeado: confirma a tentativa, conclui o run e solta o MergeLease', async () => {
    const runId = crashNoMeioDoMerge()
    prMergeado = true

    const achados = await montar().reconcileAll()

    expect(achados).toContainEqual(
      expect.objectContaining({ recurso: RECURSO, decisao: 'completado' })
    )
    expect(aoReconciliarMergeado).toHaveBeenCalledWith(expect.objectContaining({ runId }))
    expect(new MergeRepository(db).iniciadas(USER)).toHaveLength(0)
    // Sem o gancho antes dos leases, a regra geral diria "o run ainda está em PR_CI" e seguraria a
    // base para sempre.
    expect(new LeaseRepository(db).buscar(USER, RECURSO)).toBeUndefined()
  })

  it('PR ainda aberto: abandona a tentativa e solta o lease — a base fica livre para repetir', async () => {
    crashNoMeioDoMerge()

    const achados = await montar().reconcileAll()

    expect(achados).toContainEqual(
      expect.objectContaining({ recurso: RECURSO, decisao: 'liberado' })
    )
    expect(aoReconciliarMergeado).not.toHaveBeenCalled()
    expect(new LeaseRepository(db).buscar(USER, RECURSO)).toBeUndefined()
  })

  it('merge que falha vira achado bloqueado: falha de detecção não é "nada a reconciliar"', async () => {
    crashNoMeioDoMerge()
    const servico = new ReconciliacaoService({
      runs: new PipelineRepository(db),
      leases: new LeaseRepository(db),
      audit: new AuditRepository(db, 'chave-de-teste'),
      userId: () => USER,
      workspaceId: () => WS,
      merge: {
        reconciliar: async () => {
          throw new Error('github caiu')
        }
      }
    })

    const achados = await servico.reconcileAll()

    expect(achados).toContainEqual(
      expect.objectContaining({ recurso: 'merge', decisao: 'bloqueado' })
    )
    expect(achados.find((a) => a.recurso === 'merge')?.motivo).toContain('github caiu')
  })

  it('sem o merge a reconciliação é a de antes', async () => {
    const servico = new ReconciliacaoService({
      runs: new PipelineRepository(db),
      leases: new LeaseRepository(db),
      audit: new AuditRepository(db, 'chave-de-teste'),
      userId: () => USER,
      workspaceId: () => WS
    })

    expect(await servico.reconcileAll()).toEqual([])
  })

  it('a ordem importa: o merge resolve antes de a regra geral olhar o lease', async () => {
    const runId = crashNoMeioDoMerge()
    prMergeado = true
    const leasesAntes = new LeaseRepository(db).buscar(USER, RECURSO)
    expect(leasesAntes?.proprietario).toBe(runId)

    const achados = await montar().reconcileAll()

    // Nenhum achado de lease: a regra geral não teve o que bloquear.
    expect(achados.filter((a) => a.recurso === RECURSO && a.decisao === 'bloqueado')).toEqual([])
  })
})
