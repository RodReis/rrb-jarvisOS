import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type {
  Artifact,
  ArtifactProvenance,
  ConfigurationEnvironment,
  ConfigurationReference,
  ConfigurationState,
  LocalEffect,
  LocalEffectKind,
  LocalEffectPhase,
  ReleaseScope
} from '@shared/domain/release'
import { assertReferenciaImutavel, digestDaReferencia } from '@shared/domain/release-artifact'
import type { AuditRepository } from '../storage/audit-repository'

/**
 * Persistência da preparação local (SPEC-Release-02): artefato por digest, referências de
 * configuração e o diário de efeitos. Arquivo à parte do `ReleaseRepository` da F01, que já passa
 * do limite de tamanho. Nada aqui recebe valor de chave nem saída de comando: só ids, digests,
 * fingerprints e códigos.
 */

export class ReleaseLocalConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReleaseLocalConflictError'
  }
}

export interface ArtifactInput {
  readonly kind: Artifact['kind']
  readonly uri: string
  readonly digest: string
  readonly provenance: ArtifactProvenance
}

export interface ReferenceInput {
  readonly name: string
  readonly environment: ConfigurationEnvironment
  readonly fingerprint?: string
  readonly state: ConfigurationState
}

export interface EffectInput {
  readonly kind: LocalEffectKind
  readonly phase: LocalEffectPhase
  readonly transport: string
  readonly externalRef?: string
  readonly digest?: string
  readonly evidenceHash?: string
  /** Código curto (`docker-unavailable`, `checksum-divergent`…), nunca texto livre. */
  readonly reason?: string
}

const CODIGO_DE_RAZAO = /^[a-z0-9][a-z0-9._:-]{0,63}$/

interface ArtifactRow {
  id: string
  user_id: string
  workspace_id: string
  project_id: string
  release_id: string
  kind: Artifact['kind']
  digest: string
  uri: string | null
  provenance: string | null
  created_at: string
}

interface ReferenceRow {
  user_id: string
  workspace_id: string
  project_id: string
  release_id: string
  environment: ConfigurationEnvironment
  name: string
  fingerprint: string | null
  state: ConfigurationState
}

interface EffectRow {
  id: string
  user_id: string
  workspace_id: string
  project_id: string
  release_id: string
  kind: LocalEffectKind
  phase: LocalEffectPhase
  external_ref: string | null
  digest: string | null
  transport: string
  evidence_hash: string | null
  reason: string | null
  created_at: string
}

function paramsDe(scope: ReleaseScope): readonly string[] {
  return [scope.userId, scope.workspaceId, scope.projectId]
}

function toArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id as ReleaseScope['workspaceId'],
    projectId: row.project_id,
    releaseId: row.release_id,
    kind: row.kind,
    digest: row.digest,
    uri: row.uri,
    provenance: row.provenance ? (JSON.parse(row.provenance) as ArtifactProvenance) : null,
    createdAt: row.created_at
  }
}

export class ReleaseLocalRepository {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditRepository
  ) {}

  /**
   * Grava o artefato uma vez por release e tipo (build único). Repetir o mesmo digest devolve a
   * linha existente; outro digest é conflito — o candidato é imutável.
   */
  recordArtifact(
    scope: ReleaseScope,
    releaseId: string,
    input: ArtifactInput,
    now = new Date().toISOString()
  ): Artifact {
    assertReferenciaImutavel(input.uri)
    if (digestDaReferencia(input.uri) !== input.digest)
      throw new ReleaseLocalConflictError('O digest informado não é o da referência do artefato.')
    return this.db.transaction(() => {
      const atual = this.getArtifact(scope, releaseId, input.kind)
      if (atual) {
        if (atual.digest !== input.digest)
          throw new ReleaseLocalConflictError(
            'A release já tem outro artefato deste tipo: o candidato é imutável.'
          )
        return atual
      }
      const id = randomUUID()
      this.db
        .prepare(
          `INSERT INTO release_artifact
             (id,user_id,workspace_id,project_id,release_id,kind,digest,uri,provenance,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          id,
          ...paramsDe(scope),
          releaseId,
          input.kind,
          input.digest,
          input.uri,
          JSON.stringify(input.provenance),
          now
        )
      return this.getArtifact(scope, releaseId, input.kind) as Artifact
    })()
  }

  getArtifact(scope: ReleaseScope, releaseId: string, kind: Artifact['kind']): Artifact | null {
    const row = this.db
      .prepare(
        `SELECT * FROM release_artifact
         WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=? AND kind=?`
      )
      .get(...paramsDe(scope), releaseId, kind) as ArtifactRow | undefined
    return row ? toArtifact(row) : null
  }

  saveConfigurationReferences(
    scope: ReleaseScope,
    releaseId: string,
    references: readonly ReferenceInput[]
  ): void {
    const gravar = this.db.prepare(
      `INSERT INTO release_configuration_reference
         (user_id,workspace_id,project_id,release_id,environment,name,fingerprint,state)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT (user_id,workspace_id,project_id,release_id,environment,name)
       DO UPDATE SET fingerprint=excluded.fingerprint, state=excluded.state`
    )
    this.db.transaction(() => {
      for (const r of references)
        gravar.run(
          ...paramsDe(scope),
          releaseId,
          r.environment,
          r.name,
          r.fingerprint ?? null,
          r.state
        )
    })()
  }

  listConfigurationReferences(scope: ReleaseScope, releaseId: string): ConfigurationReference[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM release_configuration_reference
         WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=?
         ORDER BY environment, name`
      )
      .all(...paramsDe(scope), releaseId) as ReferenceRow[]
    return rows.map((row) => ({
      userId: row.user_id,
      workspaceId: row.workspace_id as ReleaseScope['workspaceId'],
      projectId: row.project_id,
      releaseId: row.release_id,
      environment: row.environment,
      name: row.name,
      fingerprint: row.fingerprint,
      state: row.state
    }))
  }

  appendEffect(
    scope: ReleaseScope,
    releaseId: string,
    input: EffectInput,
    now = new Date().toISOString()
  ): LocalEffect {
    if (input.reason !== undefined && !CODIGO_DE_RAZAO.test(input.reason))
      throw new TypeError('A razão do efeito é um código curto, não texto livre.')
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO release_local_effect
           (id,user_id,workspace_id,project_id,release_id,kind,phase,external_ref,digest,
            transport,evidence_hash,reason,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        id,
        ...paramsDe(scope),
        releaseId,
        input.kind,
        input.phase,
        input.externalRef ?? null,
        input.digest ?? null,
        input.transport,
        input.evidenceHash ?? null,
        input.reason ?? null,
        now
      )
    this.audit.append({
      user_id: scope.userId,
      workspace_id: scope.workspaceId as 'noa' | 'jarvis',
      type: 'release-local-effect',
      payload: {
        projectId: scope.projectId,
        releaseId,
        kind: input.kind,
        phase: input.phase,
        transport: input.transport,
        ...(input.digest ? { digest: input.digest } : {}),
        ...(input.evidenceHash ? { evidenceHash: input.evidenceHash } : {}),
        ...(input.reason ? { reason: input.reason } : {})
      }
    })
    return {
      id,
      ...scope,
      releaseId,
      kind: input.kind,
      phase: input.phase,
      externalRef: input.externalRef ?? null,
      digest: input.digest ?? null,
      transport: input.transport,
      evidenceHash: input.evidenceHash ?? null,
      reason: input.reason ?? null,
      createdAt: now
    }
  }

  listEffects(scope: ReleaseScope, releaseId: string): LocalEffect[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM release_local_effect
         WHERE user_id=? AND workspace_id=? AND project_id=? AND release_id=?
         ORDER BY created_at, rowid`
      )
      .all(...paramsDe(scope), releaseId) as EffectRow[]
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      workspaceId: row.workspace_id as ReleaseScope['workspaceId'],
      projectId: row.project_id,
      releaseId: row.release_id,
      kind: row.kind,
      phase: row.phase,
      externalRef: row.external_ref,
      digest: row.digest,
      transport: row.transport,
      evidenceHash: row.evidence_hash,
      reason: row.reason,
      createdAt: row.created_at
    }))
  }
}
