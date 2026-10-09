import { mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import type { ReleaseEnvironmentQuery, ReleaseQuery } from '@shared/contracts/release'
import type { ReleaseScope } from '@shared/domain/release'
import { AuditRepository } from '../storage/audit-repository'
import { openDatabase } from '../storage/database'
import { ReleaseRepository } from './release-repository'
import { ReleaseOrchestrator, type ReleasePort } from './release-orchestrator'

const KEY = 'release-test-audit-key'
const BASE = '2026-10-09T12:00:00.000Z'
const SCOPE: ReleaseScope = { userId: 'user-1', workspaceId: 'jarvis', projectId: 'project-1' }

let directory: string
let db: Database
let repo: ReleaseRepository
let audit: AuditRepository

function envQuery(
  releaseId: string,
  environment: 'staging' | 'production' = 'staging'
): ReleaseEnvironmentQuery {
  return { ...SCOPE, releaseId, environment }
}

function releaseQuery(releaseId: string): ReleaseQuery {
  return { ...SCOPE, releaseId }
}

function newRepo(): void {
  audit = new AuditRepository(db, KEY)
  repo = new ReleaseRepository(db, audit)
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'jarvis-release-'))
  db = openDatabase(join(directory, 'release.db'))
  newRepo()
})

afterEach(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('ReleaseRepository (SPEC-Release-01)', () => {
  it('consolida SHA anterior antes de Staging e não duplica o mesmo SHA', () => {
    const first = repo.enqueue(SCOPE, 'a'.repeat(40), BASE)
    const duplicate = repo.enqueue(SCOPE, 'a'.repeat(40), BASE)
    const next = repo.enqueue(SCOPE, 'b'.repeat(40), BASE)

    expect(first.created).toBe(true)
    expect(duplicate).toMatchObject({ created: false, release: { id: first.release.id } })
    expect(repo.get(releaseQuery(first.release.id))?.status).toBe('superseded')
    expect(next.release.status).toBe('queued')
  })

  it('mantém o candidato antigo depois que Staging começou e enfileira o SHA seguinte', () => {
    const first = repo.enqueue(SCOPE, 'c'.repeat(40), BASE).release
    const lease = repo.acquireLease(envQuery(first.id), 'writer-1', 60_000, BASE)
    repo.transition(envQuery(first.id), 'preparing', lease, BASE)
    repo.transition(envQuery(first.id), 'staging', lease, BASE)

    const next = repo.enqueue(SCOPE, 'd'.repeat(40), '2026-10-09T12:01:00.000Z')

    expect(repo.get(releaseQuery(first.id))?.status).toBe('staging')
    expect(repo.queue(SCOPE).candidate?.id).toBe(next.release.id)
  })

  it('não descarta candidato pre-Staging com efeito ainda incerto', () => {
    const current = repo.enqueue(SCOPE, '8'.repeat(40), BASE).release
    const query = envQuery(current.id)
    const lease = repo.acquireLease(query, 'writer-1', 60_000, BASE)
    repo.transition(query, 'preparing', lease, BASE)
    repo.beginStep(query, 'build', { sourceSha: current.sha }, lease, BASE)

    expect(() => repo.enqueue(SCOPE, '9'.repeat(40), '2026-10-09T12:00:01.000Z')).toThrow(
      expect.objectContaining({ code: 'reconciliation-required' })
    )
    expect(repo.queue(SCOPE).candidate?.id).toBe(current.id)
  })

  it('concede um único lease por projeto/ambiente e rejeita fencing antigo após expiração', () => {
    const release = repo.enqueue(SCOPE, 'e'.repeat(40), BASE).release
    const first = repo.acquireLease(envQuery(release.id), 'writer-1', 1_000, BASE)
    expect(() => repo.acquireLease(envQuery(release.id), 'writer-2', 1_000, BASE)).toThrow(
      expect.objectContaining({ code: 'lease-busy' })
    )
    const second = repo.acquireLease(
      envQuery(release.id),
      'writer-2',
      1_000,
      '2026-10-09T12:00:02.000Z'
    )
    expect(second.fencingToken).toBe(first.fencingToken + 1)
    expect(() =>
      repo.transition(envQuery(release.id), 'preparing', first, '2026-10-09T12:00:02.000Z')
    ).toThrow(expect.objectContaining({ code: 'lease-mismatch' }))
  })

  it('permite trabalho paralelo em projetos diferentes e ambientes diferentes', () => {
    const one = repo.enqueue(SCOPE, 'f'.repeat(40), BASE).release
    const otherScope = { ...SCOPE, projectId: 'project-2' }
    const two = repo.enqueue(otherScope, '1'.repeat(40), BASE).release
    expect(() => repo.acquireLease(envQuery(one.id), 'writer-1', 60_000, BASE)).not.toThrow()
    expect(() =>
      repo.acquireLease(
        { ...envQuery(one.id), environment: 'production' },
        'writer-2',
        60_000,
        BASE
      )
    ).not.toThrow()
    expect(() =>
      repo.acquireLease({ ...envQuery(two.id), ...otherScope }, 'writer-3', 60_000, BASE)
    ).not.toThrow()
  })

  it('exige reconciliação após crash e não repete passo confirmado', () => {
    const release = repo.enqueue(SCOPE, '2'.repeat(40), BASE).release
    const query = envQuery(release.id)
    const lease = repo.acquireLease(query, 'writer-1', 60_000, BASE)
    repo.transition(query, 'preparing', lease, BASE)
    const intended = repo.beginStep(query, 'build', { commit: release.sha }, lease, BASE)
    repo.finishStep(query, 'build', intended.record.payloadHash, 'confirmed', lease, BASE)

    expect(repo.beginStep(query, 'build', { commit: release.sha }, lease, BASE).state).toBe(
      'already-confirmed'
    )
    const uncertain = repo.beginStep(query, 'publish', { digest: 'sha256:123' }, lease, BASE)
    db.close()
    db = openDatabase(join(directory, 'release.db'))
    newRepo()
    const renewed = repo.acquireLease(query, 'writer-2', 60_000, '2026-10-09T12:01:01.000Z')
    expect(renewed.fencingToken).toBe(lease.fencingToken + 1)
    expect(repo.recoverIntended(query, '2026-10-09T12:01:02.000Z')).toBe(1)
    expect(repo.getStep(query, 'publish')?.state).toBe('ambiguous')
    expect(() =>
      repo.beginStep(
        query,
        'publish',
        { digest: 'sha256:123' },
        renewed,
        '2026-10-09T12:01:03.000Z'
      )
    ).toThrow(expect.objectContaining({ code: 'reconciliation-required' }))
    expect(uncertain.record.state).toBe('intended')
  })

  it('rejeita payload diferente para a mesma chave e não aceita campos com segredo', () => {
    const release = repo.enqueue(SCOPE, '3'.repeat(40), BASE).release
    const query = envQuery(release.id)
    const lease = repo.acquireLease(query, 'writer-1', 60_000, BASE)
    repo.transition(query, 'preparing', lease, BASE)
    repo.beginStep(query, 'build', { source: 'sha-a' }, lease, BASE)
    expect(() => repo.beginStep(query, 'build', { source: 'sha-b' }, lease, BASE)).toThrow(
      expect.objectContaining({ code: 'idempotency-payload-conflict' })
    )
    expect(() =>
      repo.beginStep(query, 'upload', { options: { apiKey: 'must-not-persist' } }, lease, BASE)
    ).toThrow(expect.objectContaining({ code: 'invalid-safe-payload' }))
    expect(
      db.prepare("SELECT COUNT(*) AS total FROM release_step WHERE state='intended'").get()
    ).toEqual({ total: 1 })
  })

  it('registra as transições na timeline e na cadeia de auditoria, sem salvar o payload', () => {
    const release = repo.enqueue(SCOPE, '4'.repeat(40), BASE).release
    const query = envQuery(release.id)
    const lease = repo.acquireLease(query, 'writer-1', 60_000, BASE)
    repo.transition(query, 'preparing', lease, BASE)
    repo.beginStep(query, 'build', { publicRef: 'only-reference' }, lease, BASE)
    const serialized = JSON.stringify({
      timeline: repo.timeline(releaseQuery(release.id)),
      audit: audit.list(SCOPE.userId)
    })
    expect(serialized).toContain('step-intended')
    expect(serialized).not.toContain('only-reference')
    expect(audit.verify(SCOPE.userId).ok).toBe(true)
  })

  it('atualiza o Preview de forma idempotente e registra cada mudança de estado', () => {
    const input = {
      ...SCOPE,
      id: 'preview-1',
      pullRequest: 12,
      headSha: '5'.repeat(40),
      status: 'queued' as const
    }
    repo.upsertPreview(input, BASE)
    repo.upsertPreview(
      { ...input, id: 'ignored-id', status: 'preparing' },
      '2026-10-09T12:01:00.000Z'
    )
    expect(repo.previews({ ...SCOPE, pullRequest: 12 })).toMatchObject([
      { id: 'preview-1', status: 'preparing' }
    ])
    expect(db.prepare('SELECT COUNT(*) AS total FROM preview_event').get()).toEqual({ total: 2 })
    expect(audit.verify(SCOPE.userId).ok).toBe(true)
  })

  it('reconcilia efeito incerto antes de repetir e nunca repete passo confirmado', async () => {
    const release = repo.enqueue(SCOPE, '6'.repeat(40), BASE).release
    const query = envQuery(release.id)
    const lease = repo.acquireLease(query, 'writer-1', 60_000, BASE)
    repo.transition(query, 'preparing', lease, BASE)
    let executions = 0
    let reconciliations = 0
    const port: ReleasePort = {
      execute: async () => (++executions === 1 ? 'ambiguous' : 'confirmed'),
      reconcile: async () => {
        reconciliations += 1
        return 'not-applied'
      }
    }
    const orchestrator = new ReleaseOrchestrator(repo, port, () => BASE)

    expect(await orchestrator.runStep(query, 'build', { sourceSha: release.sha }, lease)).toEqual({
      state: 'ambiguous',
      repeated: false
    })
    expect(await orchestrator.runStep(query, 'build', { sourceSha: release.sha }, lease)).toEqual({
      state: 'confirmed',
      repeated: false
    })
    expect(await orchestrator.runStep(query, 'build', { sourceSha: release.sha }, lease)).toEqual({
      state: 'confirmed',
      repeated: false
    })
    expect(executions).toBe(2)
    expect(reconciliations).toBe(1)
    expect(repo.getStep(query, 'build')?.attempt).toBe(2)
  })

  it('CLI read-only reconstrói fila e ação mínima a partir do SQLite', () => {
    const candidate = repo.enqueue(SCOPE, '7'.repeat(40), BASE).release
    const script = join(import.meta.dirname, '../../../scripts/release-cli.mjs')
    const result = spawnSync(
      process.execPath,
      [
        script,
        'queue',
        '--db',
        join(directory, 'release.db'),
        '--user',
        SCOPE.userId,
        '--workspace',
        SCOPE.workspaceId,
        '--project',
        SCOPE.projectId
      ],
      { encoding: 'utf8' }
    )

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      candidate: { id: candidate.id, status: 'queued' },
      activeEnvironments: { staging: null, production: null },
      minimalAction: 'resume'
    })
  })
})
