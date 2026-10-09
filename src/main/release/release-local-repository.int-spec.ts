import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import type { ReleaseScope } from '@shared/domain/release'
import { AuditRepository } from '../storage/audit-repository'
import { openDatabase } from '../storage/database'
import { ReleaseRepository } from './release-repository'
import { ReleaseLocalConflictError, ReleaseLocalRepository } from './release-local-repository'

const KEY = 'release-local-audit-key'
const NOW = '2026-10-09T12:00:00.000Z'
const SCOPE: ReleaseScope = { userId: 'user-1', workspaceId: 'jarvis', projectId: 'project-1' }
const DIGEST = `sha256:${'a'.repeat(64)}`
const PROVENANCE = {
  transport: 'docker-cli',
  buildType: 'https://github.com/moby/buildkit/slsa',
  builderId: 'builder-1',
  provenanceDigest: `sha256:${'b'.repeat(64)}`
} as const

let directory: string
let db: Database
let repo: ReleaseLocalRepository
let releaseId: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'release-local-'))
  db = openDatabase(join(directory, 'release.db'))
  const audit = new AuditRepository(db, KEY)
  repo = new ReleaseLocalRepository(db, audit)
  releaseId = new ReleaseRepository(db, audit).enqueue(SCOPE, 'c'.repeat(40), NOW).release.id
})

afterEach(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('artefato', () => {
  const entrada = (): Parameters<ReleaseLocalRepository['recordArtifact']>[2] => ({
    kind: 'backend-image',
    uri: `ghcr.io/dono/projeto@${DIGEST}`,
    digest: DIGEST,
    provenance: PROVENANCE
  })

  it('grava e a consulta posterior devolve o mesmo digest e a mesma provenance', () => {
    const gravado = repo.recordArtifact(SCOPE, releaseId, entrada(), NOW)
    const lido = repo.getArtifact(SCOPE, releaseId, 'backend-image')
    expect(lido).toMatchObject({ digest: DIGEST, uri: gravado.uri, provenance: PROVENANCE })
  })

  it('gravar de novo o mesmo artefato é idempotente: build único', () => {
    const a = repo.recordArtifact(SCOPE, releaseId, entrada(), NOW)
    const b = repo.recordArtifact(SCOPE, releaseId, entrada(), NOW)
    expect(b.id).toBe(a.id)
  })

  it('outro digest para a mesma release e tipo é recusado', () => {
    repo.recordArtifact(SCOPE, releaseId, entrada(), NOW)
    expect(() =>
      repo.recordArtifact(
        SCOPE,
        releaseId,
        {
          ...entrada(),
          digest: `sha256:${'d'.repeat(64)}`,
          uri: `ghcr.io/dono/projeto@sha256:${'d'.repeat(64)}`
        },
        NOW
      )
    ).toThrow(ReleaseLocalConflictError)
  })

  it('recusa uri por tag: só repositório@digest chega ao banco', () => {
    expect(() =>
      repo.recordArtifact(
        SCOPE,
        releaseId,
        { ...entrada(), uri: 'ghcr.io/dono/projeto:latest' },
        NOW
      )
    ).toThrow()
  })

  it('o banco também garante um artefato por release e tipo (índice único)', () => {
    repo.recordArtifact(SCOPE, releaseId, entrada(), NOW)
    expect(() =>
      db
        .prepare(
          `INSERT INTO release_artifact (id,user_id,workspace_id,project_id,release_id,kind,digest,created_at)
           VALUES ('x',?,?,?,?,?,?,?)`
        )
        .run(
          SCOPE.userId,
          SCOPE.workspaceId,
          SCOPE.projectId,
          releaseId,
          'backend-image',
          `sha256:${'d'.repeat(64)}`,
          NOW
        )
    ).toThrow(/UNIQUE/)
  })

  it('duas conexões disputando: a segunda recebe conflito, não um segundo digest', () => {
    const outra = openDatabase(join(directory, 'release.db'))
    try {
      const repoB = new ReleaseLocalRepository(outra, new AuditRepository(outra, KEY))
      repo.recordArtifact(SCOPE, releaseId, entrada(), NOW)
      expect(() =>
        repoB.recordArtifact(
          SCOPE,
          releaseId,
          {
            ...entrada(),
            digest: `sha256:${'d'.repeat(64)}`,
            uri: `ghcr.io/dono/projeto@sha256:${'d'.repeat(64)}`
          },
          NOW
        )
      ).toThrowError(expect.objectContaining({ code: 'artifact-conflict' }))
    } finally {
      outra.close()
    }
  })

  it('release de outro escopo é recusada, mesmo existindo (FK não basta)', () => {
    const outro = { ...SCOPE, userId: 'user-2' }
    expect(() => repo.recordArtifact(outro, releaseId, entrada(), NOW)).toThrowError(
      expect.objectContaining({ code: 'release-not-found' })
    )
    expect(() =>
      repo.saveConfigurationReferences(outro, releaseId, [
        { name: 'X', environment: 'local', state: 'missing' }
      ])
    ).toThrow(ReleaseLocalConflictError)
    expect(() =>
      repo.appendEffect(
        outro,
        releaseId,
        { kind: 'compose', phase: 'intended', transport: 'docker-cli' },
        NOW
      )
    ).toThrow(ReleaseLocalConflictError)
  })

  it('recusa uri cujo digest não é o informado', () => {
    expect(() =>
      repo.recordArtifact(
        SCOPE,
        releaseId,
        { ...entrada(), uri: `ghcr.io/dono/projeto@sha256:${'e'.repeat(64)}` },
        NOW
      )
    ).toThrow(TypeError)
  })

  it('outro escopo não enxerga o artefato', () => {
    repo.recordArtifact(SCOPE, releaseId, entrada(), NOW)
    expect(repo.getArtifact({ ...SCOPE, userId: 'user-2' }, releaseId, 'backend-image')).toBeNull()
  })

  it('o artefato é imutável no banco', () => {
    repo.recordArtifact(SCOPE, releaseId, entrada(), NOW)
    expect(() => db.prepare(`UPDATE release_artifact SET digest='x'`).run()).toThrow(/imutável/)
  })
})

describe('referências de configuração', () => {
  it('o banco recusa fingerprint que não é hexadecimal de 64 e estado incoerente', () => {
    const inserir = (fp: string | null, estado: string) =>
      db
        .prepare(
          `INSERT INTO release_configuration_reference
             (user_id,workspace_id,project_id,release_id,environment,name,fingerprint,state)
           VALUES (?,?,?,?,?,?,?,?)`
        )
        .run(
          SCOPE.userId,
          SCOPE.workspaceId,
          SCOPE.projectId,
          releaseId,
          'local',
          `N_${Math.random()}`,
          fp,
          estado
        )
    expect(() => inserir('valor-em-claro-com-cara-de-segredo', 'configured')).toThrow(/CHECK/)
    expect(() => inserir(null, 'configured')).toThrow(/CHECK/)
    expect(() => inserir('f'.repeat(64), 'missing')).toThrow(/CHECK/)
  })

  it('persiste nome, ambiente, fingerprint e estado, e regravar atualiza o estado', () => {
    repo.saveConfigurationReferences(SCOPE, releaseId, [
      { name: 'API_TOKEN', environment: 'local', fingerprint: 'f'.repeat(64), state: 'configured' },
      { name: 'API_TOKEN', environment: 'staging', state: 'missing' }
    ])
    repo.saveConfigurationReferences(SCOPE, releaseId, [
      { name: 'API_TOKEN', environment: 'staging', fingerprint: '1'.repeat(64), state: 'divergent' }
    ])
    const lidas = repo.listConfigurationReferences(SCOPE, releaseId)
    expect(lidas.map((r) => `${r.environment}:${r.state}`).sort()).toEqual([
      'local:configured',
      'staging:divergent'
    ])
  })
})

describe('diário local append-only', () => {
  it('registra intenção e resultado com referência, digest, transporte e evidência', () => {
    repo.appendEffect(
      SCOPE,
      releaseId,
      {
        kind: 'artifact',
        phase: 'intended',
        transport: 'docker-cli',
        externalRef: 'ghcr.io/dono/projeto'
      },
      NOW
    )
    repo.appendEffect(
      SCOPE,
      releaseId,
      {
        kind: 'artifact',
        phase: 'confirmed',
        transport: 'docker-cli',
        externalRef: `ghcr.io/dono/projeto@${DIGEST}`,
        digest: DIGEST,
        evidenceHash: `sha256:${'f'.repeat(64)}`
      },
      '2026-10-09T12:00:01.000Z'
    )
    const efeitos = repo.listEffects(SCOPE, releaseId)
    expect(efeitos.map((e) => e.phase)).toEqual(['intended', 'confirmed'])
    expect(efeitos[1]).toMatchObject({ digest: DIGEST, transport: 'docker-cli' })
  })

  it('não é possível alterar nem apagar uma linha do diário', () => {
    repo.appendEffect(
      SCOPE,
      releaseId,
      { kind: 'compose', phase: 'intended', transport: 'docker-cli' },
      NOW
    )
    expect(() => db.prepare(`UPDATE release_local_effect SET phase='confirmed'`).run()).toThrow(
      /append-only/
    )
    expect(() => db.prepare(`DELETE FROM release_local_effect`).run()).toThrow(/append-only/)
  })

  it('a razão é um código curto: texto com cara de segredo é recusado', () => {
    expect(() =>
      repo.appendEffect(
        SCOPE,
        releaseId,
        {
          kind: 'compose',
          phase: 'failed',
          transport: 'docker-cli',
          reason: 'falhou: token=abc 123 com espaço'
        },
        NOW
      )
    ).toThrow(TypeError)
  })

  it('cada efeito gera um evento de auditoria sem valor de chave', () => {
    repo.appendEffect(
      SCOPE,
      releaseId,
      { kind: 'configuration', phase: 'confirmed', transport: 'env-file' },
      NOW
    )
    const eventos = new AuditRepository(db, KEY).list(SCOPE.userId)
    expect(eventos.some((e) => e.type === 'release-local-effect')).toBe(true)
  })
})
