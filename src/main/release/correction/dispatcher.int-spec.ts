import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import type { ReleaseScope } from '@shared/domain/release'
import { AuditRepository } from '../../storage/audit-repository'
import { openDatabase } from '../../storage/database'
import { ReleaseRecoveryRepository } from '../release-recovery-repository'
import { ReleaseRepository } from '../release-repository'
import {
  ReleaseCorrectionDispatcher,
  V2CorrectionUnavailable,
  type CorrectionRequest,
  type V2CorrectionPort
} from './dispatcher'

const NOW = '2026-10-16T12:00:00.000Z'
const SCOPE: ReleaseScope = { userId: 'user-1', workspaceId: 'jarvis', projectId: 'project-1' }
const SHA_1 = '1'.repeat(40)
const SHA_2 = '2'.repeat(40)
const SHA_3 = '3'.repeat(40)
const PASSOS = [
  'prepared',
  'database_migrated',
  'backend_healthy',
  'frontend_promoted',
  'smoke_passed'
]

let directory: string
let db: Database
let releases: ReleaseRepository
let recovery: ReleaseRecoveryRepository
let chamadas: CorrectionRequest[]
let v2Falha: Error | null
let agora: string
let dispatcher: ReleaseCorrectionDispatcher

const v2: V2CorrectionPort = {
  open: async (pedido) => {
    chamadas.push(pedido)
    if (v2Falha) throw v2Falha
    return { runId: `run-${chamadas.length}` }
  }
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'release-correction-'))
  db = openDatabase(join(directory, 'release.db'))
  const audit = new AuditRepository(db, 'release-correction-audit-key')
  releases = new ReleaseRepository(db, audit)
  recovery = new ReleaseRecoveryRepository(db, audit)
  chamadas = []
  v2Falha = null
  agora = NOW
  dispatcher = new ReleaseCorrectionDispatcher({
    repository: releases,
    recovery,
    v2,
    now: () => agora
  })
})

afterEach(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

function nova(sha: string, quando: string, inclusao: object = {}): string {
  const id = releases.enqueue(SCOPE, sha, quando).release.id
  recovery.recordInclusion(SCOPE, id, { sha, pullRequest: 432, ...inclusao }, quando)
  return id
}

/** Leva a release a `completed` pela cadeia legítima (o gatilho do diário exige os passos confirmados). */
function concluir(id: string, quando: string): void {
  const inserir = db.prepare(
    `INSERT INTO release_step
       (user_id,workspace_id,project_id,release_id,environment,step,idempotency_key,payload_hash,state,attempt,updated_at)
     VALUES (?,?,?,?,?,?,?,?, 'confirmed', 1, ?)`
  )
  for (const environment of ['staging', 'production'])
    for (const passo of PASSOS)
      inserir.run(SCOPE.userId, SCOPE.workspaceId, SCOPE.projectId, id, environment, passo, `${id}:${environment}:${passo}`, 'e'.repeat(64), quando) // prettier-ignore
  for (const status of ['preparing', 'staging', 'production', 'stabilizing', 'completed'])
    db.prepare(`UPDATE release_run SET status=?, updated_at=? WHERE id=?`).run(status, quando, id)
}

const falha = { environment: 'production' as const, step: 'smoke_passed', reason: 'smoke-failed' }

describe('ReleaseCorrectionDispatcher (critério 6)', () => {
  it('falha de saúde abre uma correção na V2, na mesma fatia, com o contexto da release', async () => {
    const id = nova(SHA_1, NOW, { specId: 'spec-x', sliceId: 'slice-9', issue: 154 })
    recovery.appendEvidence(
      SCOPE,
      id,
      { kind: 'step', state: 'failed', environment: 'production', reason: 'smoke-failed' },
      NOW
    )

    const correcao = await dispatcher.dispatch(SCOPE, id, falha)

    expect(chamadas).toHaveLength(1)
    expect(chamadas[0]).toMatchObject({
      releaseId: id,
      sliceId: 'slice-9',
      specId: 'spec-x',
      dispatchKey: `release-correction:${id}`
    })
    expect(correcao).toMatchObject({
      state: 'opened',
      runId: 'run-1',
      failureClass: 'health_or_test'
    })
    const contexto = JSON.parse(chamadas[0]!.contextJson) as Record<string, unknown>
    expect(contexto).toMatchObject({
      releaseId: id,
      sha: SHA_1,
      failure: { environment: 'production', step: 'smoke_passed', reason: 'smoke-failed' },
      specs: ['spec-x'],
      findings: [{ code: 'smoke-failed', status: 'new', releases: [] }]
    })
    expect(chamadas[0]!.contextSha256).toBe(
      createHash('sha256').update(chamadas[0]!.contextJson).digest('hex')
    )
  })

  it('repetir é idempotente: a V2 é acionada uma vez só', async () => {
    const id = nova(SHA_1, NOW, { sliceId: 'slice-9' })
    const a = await dispatcher.dispatch(SCOPE, id, falha)
    const b = await dispatcher.dispatch(SCOPE, id, falha)
    expect(chamadas).toHaveLength(1)
    expect(b?.id).toBe(a?.id)
    expect(b?.runId).toBe('run-1')
  })

  it.each([
    ['configuração', 'config-missing'],
    ['transitória', 'database_migrated-timeout'],
    ['desconhecida', 'ninguem-previu']
  ])('falha %s não volta à V2: é decisão do operador', async (_nome, reason) => {
    const id = nova(SHA_1, NOW, { sliceId: 'slice-9' })
    const correcao = await dispatcher.dispatch(SCOPE, id, { environment: 'staging', reason })
    expect(correcao).toBeNull()
    expect(chamadas).toEqual([])
    expect(recovery.correction(SCOPE, id)).toBeNull()
  })

  it('sem fatia da V2 na inclusão não há onde abrir: fica indisponível, com ação mínima', async () => {
    const id = nova(SHA_1, NOW, { specId: 'spec-x' })
    const correcao = await dispatcher.dispatch(SCOPE, id, falha)
    expect(correcao).toMatchObject({ state: 'unavailable', stateReason: 'no-slice' })
    expect(chamadas).toEqual([])
    expect(recovery.evidence(SCOPE, id)).toContainEqual(
      expect.objectContaining({ kind: 'correction', action: 'open-v2-run-manually' })
    )
  })

  it('falha ao acionar a V2 deixa a correção pendente e a retomada a abre depois', async () => {
    const id = nova(SHA_1, NOW, { sliceId: 'slice-9' })
    v2Falha = new Error('V2 fora do ar')
    const primeira = await dispatcher.dispatch(SCOPE, id, falha)
    expect(primeira).toMatchObject({ state: 'pending', runId: null })

    v2Falha = null
    const retomadas = await dispatcher.retryPending(SCOPE)
    expect(retomadas).toEqual([expect.objectContaining({ releaseId: id, state: 'opened' })])
    expect(chamadas).toHaveLength(2)
    expect(await dispatcher.retryPending(SCOPE)).toEqual([])
  })

  it('a V2 que recusa de forma definitiva marca indisponível e não é insistida', async () => {
    const id = nova(SHA_1, NOW, { sliceId: 'slice-9' })
    v2Falha = new V2CorrectionUnavailable('slice-unknown')
    const correcao = await dispatcher.dispatch(SCOPE, id, falha)
    expect(correcao).toMatchObject({ state: 'unavailable', stateReason: 'slice-unknown' })
    expect(await dispatcher.retryPending(SCOPE)).toEqual([])
  })

  it('o histórico da SPEC entra no contexto e o achado resolvido não volta como novo', async () => {
    const antiga = nova(SHA_1, '2026-10-10T12:00:00.000Z', { specId: 'spec-x', sliceId: 'slice-9' })
    agora = '2026-10-10T12:00:00.000Z'
    await dispatcher.dispatch(SCOPE, antiga, {
      environment: 'staging',
      step: 'smoke_passed',
      reason: 'health-down'
    })
    // A SPEC depois concluiu uma release: o achado anterior está resolvido.
    const saudavel = nova(SHA_2, '2026-10-12T12:00:00.000Z', {
      specId: 'spec-x',
      sliceId: 'slice-9'
    })
    concluir(saudavel, '2026-10-12T12:00:00.000Z')

    const atual = nova(SHA_3, '2026-10-14T12:00:00.000Z', { specId: 'spec-x', sliceId: 'slice-9' })
    agora = '2026-10-14T12:00:00.000Z'
    await dispatcher.dispatch(SCOPE, atual, falha)

    const pedido = chamadas.at(-1)!
    const contexto = JSON.parse(pedido.contextJson) as {
      findings: { code: string; status: string }[]
    }
    expect(contexto.findings).toEqual([
      expect.objectContaining({ code: 'smoke-failed', status: 'new' }),
      expect.objectContaining({ code: 'health-down', status: 'resolved' })
    ])
  })

  it('o mesmo achado de novo é recorrente, nunca novo', async () => {
    const antiga = nova(SHA_1, '2026-10-10T12:00:00.000Z', { specId: 'spec-x', sliceId: 'slice-9' })
    agora = '2026-10-10T12:00:00.000Z'
    await dispatcher.dispatch(SCOPE, antiga, falha)
    const atual = nova(SHA_2, '2026-10-14T12:00:00.000Z', { specId: 'spec-x', sliceId: 'slice-9' })
    await dispatcher.dispatch(SCOPE, atual, falha)
    const contexto = JSON.parse(chamadas.at(-1)!.contextJson) as {
      findings: { code: string; status: string; releases: string[] }[]
    }
    expect(contexto.findings).toEqual([
      { code: 'smoke-failed', status: 'recurring', releases: [antiga] }
    ])
  })

  it('motivo que não é código é recusado antes de qualquer acionamento', async () => {
    const id = nova(SHA_1, NOW, { sliceId: 'slice-9' })
    await expect(
      dispatcher.dispatch(SCOPE, id, {
        environment: 'production',
        reason: 'Error: smoke falhou na linha 3'
      })
    ).rejects.toThrow(TypeError)
    expect(chamadas).toEqual([])
  })

  it('o contexto entregue à V2 não carrega texto externo nem segredo', async () => {
    const id = nova(SHA_1, NOW, { sliceId: 'slice-9', specId: 'spec-x' })
    await dispatcher.dispatch(SCOPE, id, falha)
    const texto = chamadas[0]!.contextJson
    // Só ids, hashes e códigos: nada de URL, token, espaço de frase ou quebra de linha.
    expect(texto).not.toMatch(/https?:|token|secret|senha|\\n/i)
  })
})
