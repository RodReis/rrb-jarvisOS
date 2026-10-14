import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import type { ReleaseScope } from '@shared/domain/release'
import { AuditRepository } from '../storage/audit-repository'
import { openDatabase } from '../storage/database'
import { ReleaseRepository } from './release-repository'
import {
  ReleasePromotionConflictError,
  ReleasePromotionRepository
} from './release-promotion-repository'

const KEY = 'release-promotion-audit-key'
const NOW = '2026-10-14T12:00:00.000Z'
const SCOPE: ReleaseScope = { userId: 'user-1', workspaceId: 'jarvis', projectId: 'project-1' }
const OUTRO: ReleaseScope = { userId: 'user-2', workspaceId: 'jarvis', projectId: 'project-1' }
const DIGEST = `sha256:${'a'.repeat(64)}`
const SUM_A = 'a'.repeat(64)
const SUM_B = 'b'.repeat(64)

let directory: string
let db: Database
let audit: AuditRepository
let repo: ReleasePromotionRepository
let releaseId: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'release-promotion-'))
  db = openDatabase(join(directory, 'release.db'))
  audit = new AuditRepository(db, KEY)
  repo = new ReleasePromotionRepository(db, audit)
  releaseId = new ReleaseRepository(db, audit).enqueue(SCOPE, 'c'.repeat(40), NOW).release.id
})

afterEach(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

/** Leva a release a `completed` pela cadeia legítima: diário confirmado e transições válidas (triggers do banco). */
function concluir(id: string): void {
  const passos = [
    'prepared',
    'database_migrated',
    'backend_healthy',
    'frontend_promoted',
    'smoke_passed'
  ]
  const inserir = db.prepare(
    `INSERT INTO release_step
       (user_id,workspace_id,project_id,release_id,environment,step,idempotency_key,payload_hash,state,attempt,updated_at)
     VALUES (?,?,?,?,?,?,?,?, 'confirmed', 1, ?)`
  )
  for (const environment of ['staging', 'production'])
    for (const passo of passos)
      inserir.run(
        SCOPE.userId, SCOPE.workspaceId, SCOPE.projectId, id, environment, passo,
        `${environment}:${passo}`, 'e'.repeat(64), NOW
      ) // prettier-ignore
  for (const status of ['preparing', 'staging', 'production', 'stabilizing', 'completed'])
    db.prepare(`UPDATE release_run SET status=? WHERE id=?`).run(status, id)
}

const backend = (environment: 'staging' | 'production', externalId: string) => ({
  environment,
  kind: 'backend' as const,
  artifactDigest: DIGEST,
  externalId,
  replacesExternalId: null
})

describe('deployment', () => {
  it('Staging e Produção registram o mesmo digest do backend e o mesmo deployment do frontend', () => {
    repo.recordDeployment(SCOPE, releaseId, backend('staging', 'rw-stg-1'), NOW)
    repo.recordDeployment(SCOPE, releaseId, backend('production', 'rw-prd-1'), NOW)
    for (const environment of ['staging', 'production'] as const)
      repo.recordDeployment(
        SCOPE,
        releaseId,
        {
          environment,
          kind: 'frontend',
          artifactDigest: `sha256:${'f'.repeat(64)}`,
          externalId: 'dpl_unico123',
          replacesExternalId: null
        },
        NOW
      )
    const lista = repo.listDeployments(SCOPE, releaseId)
    const backends = lista.filter((d) => d.kind === 'backend')
    const frontends = lista.filter((d) => d.kind === 'frontend')
    expect(new Set(backends.map((d) => d.artifactDigest))).toEqual(new Set([DIGEST]))
    expect(new Set(frontends.map((d) => d.externalId))).toEqual(new Set(['dpl_unico123']))
    expect(lista).toHaveLength(4)
  })

  it('gravar de novo o mesmo deployment é idempotente', () => {
    const a = repo.recordDeployment(SCOPE, releaseId, backend('staging', 'rw-1'), NOW)
    const b = repo.recordDeployment(SCOPE, releaseId, backend('staging', 'rw-1'), NOW)
    expect(b.id).toBe(a.id)
    expect(repo.listDeployments(SCOPE, releaseId)).toHaveLength(1)
  })

  it('outro deployment para a mesma release, ambiente e tipo é conflito: o candidato é imutável', () => {
    repo.recordDeployment(SCOPE, releaseId, backend('staging', 'rw-1'), NOW)
    expect(() => repo.recordDeployment(SCOPE, releaseId, backend('staging', 'rw-2'), NOW)).toThrow(
      ReleasePromotionConflictError
    )
  })

  it('guarda o deployment que ele substituiu, para a compensação', () => {
    repo.recordDeployment(
      SCOPE,
      releaseId,
      { ...backend('production', 'rw-novo'), replacesExternalId: 'rw-antigo' },
      NOW
    )
    expect(repo.getDeployment(SCOPE, releaseId, 'production', 'backend')).toMatchObject({
      externalId: 'rw-novo',
      replacesExternalId: 'rw-antigo'
    })
  })

  it('o banco recusa alterar ou apagar deployment gravado', () => {
    repo.recordDeployment(SCOPE, releaseId, backend('staging', 'rw-1'), NOW)
    expect(() => db.prepare(`UPDATE release_deployment SET external_id='x'`).run()).toThrow(
      /imutável/
    )
    expect(() => db.prepare(`DELETE FROM release_deployment`).run()).toThrow(/imutável/)
  })

  it('recusa digest que não é sha256 e id externo vazio', () => {
    expect(() =>
      repo.recordDeployment(
        SCOPE,
        releaseId,
        { ...backend('staging', 'rw-1'), artifactDigest: 'latest' },
        NOW
      )
    ).toThrow(TypeError)
    expect(() => repo.recordDeployment(SCOPE, releaseId, backend('staging', '  '), NOW)).toThrow(
      TypeError
    )
  })

  it('release de outro escopo não aceita deployment', () => {
    expect(() => repo.recordDeployment(OUTRO, releaseId, backend('staging', 'rw-1'), NOW)).toThrow(
      ReleasePromotionConflictError
    )
    expect(repo.listDeployments(OUTRO, releaseId)).toEqual([])
  })

  it('o deployment anterior conhecido vem da última release concluída no ambiente', () => {
    const anterior = new ReleaseRepository(db, audit).enqueue(SCOPE, 'd'.repeat(40), NOW).release.id
    repo.recordDeployment(SCOPE, anterior, backend('production', 'rw-prd-antigo'), NOW)
    expect(repo.lastCompletedDeployment(SCOPE, 'production', 'backend')).toBeNull()
    concluir(anterior)
    expect(repo.lastCompletedDeployment(SCOPE, 'production', 'backend')).toMatchObject({
      externalId: 'rw-prd-antigo'
    })
  })
})

describe('migration', () => {
  it('registra a intenção e depois o resultado de cada migration por ambiente', () => {
    repo.recordMigration(
      SCOPE,
      releaseId,
      { environment: 'staging', migrationId: '001_init', checksum: SUM_A, state: 'intended' },
      NOW
    )
    repo.recordMigration(
      SCOPE,
      releaseId,
      { environment: 'staging', migrationId: '001_init', checksum: SUM_A, state: 'confirmed' },
      NOW
    )
    expect(repo.listMigrations(SCOPE, releaseId)).toEqual([
      expect.objectContaining({
        environment: 'staging',
        migrationId: '001_init',
        state: 'confirmed'
      })
    ])
  })

  it('o mesmo id com outro checksum é divergência e nunca reescreve', () => {
    repo.recordMigration(
      SCOPE,
      releaseId,
      { environment: 'staging', migrationId: '001_init', checksum: SUM_A, state: 'confirmed' },
      NOW
    )
    expect(() =>
      repo.recordMigration(
        SCOPE,
        releaseId,
        { environment: 'staging', migrationId: '001_init', checksum: SUM_B, state: 'confirmed' },
        NOW
      )
    ).toThrow(ReleasePromotionConflictError)
  })

  it('guarda a referência do backup que precedeu a migration, para o restore operacional', () => {
    repo.recordMigration(
      SCOPE,
      releaseId,
      {
        environment: 'production',
        migrationId: '001_init',
        checksum: SUM_A,
        state: 'intended',
        backupRef: 'bkp-7f3a9c'
      },
      NOW
    )
    expect(repo.listMigrations(SCOPE, releaseId)[0]).toMatchObject({ backupRef: 'bkp-7f3a9c' })
  })

  it('migration sem backup (Staging) fica com backupRef nulo', () => {
    repo.recordMigration(
      SCOPE,
      releaseId,
      { environment: 'staging', migrationId: '001_init', checksum: SUM_A, state: 'confirmed' },
      NOW
    )
    expect(repo.listMigrations(SCOPE, releaseId)[0]?.backupRef).toBeNull()
  })

  it('recusa referência de backup que não é um identificador curto', () => {
    expect(() =>
      repo.recordMigration(
        SCOPE,
        releaseId,
        {
          environment: 'production',
          migrationId: '001_init',
          checksum: SUM_A,
          state: 'intended',
          backupRef: 'postgres://user:senha@host/db'
        },
        NOW
      )
    ).toThrow(TypeError)
  })

  it('migration confirmada não volta para intenção', () => {
    const base = { environment: 'staging', migrationId: '001_init', checksum: SUM_A } as const
    repo.recordMigration(SCOPE, releaseId, { ...base, state: 'confirmed' }, NOW)
    expect(() =>
      repo.recordMigration(SCOPE, releaseId, { ...base, state: 'intended' }, NOW)
    ).toThrow(ReleasePromotionConflictError)
  })
})

describe('compensação', () => {
  it('abre como intenção e fecha com o resultado', () => {
    const id = repo.beginCompensation(
      SCOPE,
      releaseId,
      { environment: 'production', action: 'frontend:restore:dpl_antigo' },
      NOW
    )
    repo.finishCompensation(SCOPE, releaseId, id, 'confirmed')
    expect(repo.listCompensations(SCOPE, releaseId)).toEqual([
      expect.objectContaining({
        id,
        environment: 'production',
        action: 'frontend:restore:dpl_antigo',
        state: 'confirmed'
      })
    ])
  })

  it('só uma intenção pode ser fechada, e uma única vez', () => {
    const id = repo.beginCompensation(
      SCOPE,
      releaseId,
      { environment: 'production', action: 'backend:rollback:rw-antigo' },
      NOW
    )
    repo.finishCompensation(SCOPE, releaseId, id, 'failed')
    expect(() => repo.finishCompensation(SCOPE, releaseId, id, 'confirmed')).toThrow(
      ReleasePromotionConflictError
    )
  })

  it('a ação é um código curto, nunca texto livre', () => {
    expect(() =>
      repo.beginCompensation(
        SCOPE,
        releaseId,
        { environment: 'production', action: 'a conexão caiu: senha=abc' },
        NOW
      )
    ).toThrow(TypeError)
  })
})

describe('releases abertas', () => {
  it('lista as não terminais do projeto em ordem de criação, sem as concluídas nem as de outro escopo', () => {
    const release = new ReleaseRepository(db, audit)
    const primeira = releaseId
    concluir(primeira) // fica terminal: não entra
    const segunda = release.enqueue(SCOPE, 'd'.repeat(40), '2026-10-14T12:01:00.000Z').release.id
    release.enqueue(OUTRO, 'e'.repeat(40), '2026-10-14T12:02:00.000Z')
    expect(repo.openReleases(SCOPE).map((r) => r.id)).toEqual([segunda])
    expect(repo.openReleases(OUTRO)).toHaveLength(1)
  })
})

describe('auditoria', () => {
  it('cada gravação deixa evento sem segredo nem saída de provedor', () => {
    repo.recordDeployment(SCOPE, releaseId, backend('staging', 'rw-1'), NOW)
    const id = repo.beginCompensation(
      SCOPE,
      releaseId,
      { environment: 'staging', action: 'backend:rollback:rw-0' },
      NOW
    )
    repo.finishCompensation(SCOPE, releaseId, id, 'confirmed')
    const eventos = audit
      .list(SCOPE.userId)
      .filter((e) => e.type === 'release-transition')
      .map((e) => (e.payload as { kind?: string }).kind)
    expect(eventos).toEqual(
      expect.arrayContaining([
        'deployment-recorded',
        'compensation-intended',
        'compensation-confirmed'
      ])
    )
  })
})
