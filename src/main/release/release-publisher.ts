import { createHash } from 'node:crypto'
import type { GateResult, ReleaseScope } from '@shared/domain/release'
import {
  construirManifesto,
  gerarChangelog,
  type DadosDoManifesto
} from '@shared/domain/release-manifest'
import { jsonCanonico, nomeDaTag } from '@shared/domain/release-recovery'
import { ReleaseEvidenceWriter } from './correction/evidence-writer'
import { PromotionProviderError } from './promotion-ports'
import type { ReleaseLocalRepository } from './release-local-repository'
import type { ReleasePromotionRepository } from './release-promotion-repository'
import type { ReleaseManifest, ReleaseRecoveryRepository } from './release-recovery-repository'
import type { ReleaseRepository } from './release-repository'

/**
 * Identidade da release estabilizada (SPEC-Release-05, critérios 7 e 8): manifesto imutável, tag e
 * GitHub Release com o changelog. **Só** nasce para Produção estabilizada — release que falhou,
 * degradou, foi cancelada ou ainda estabiliza é recusada antes de qualquer chamada ao GitHub.
 * Documento que falha nunca reverte uma aplicação saudável (regra 8): vira pendência de evidência,
 * com a ação mínima, e a retomada publica depois. O GitHub nunca é sobrescrito: tag que já existe
 * em outro commit é conflito, não atualização.
 */

export interface ReleaseGitPort {
  /** A tag e a release no GitHub, se existirem. `notesSha256: null` = tag sem GitHub Release. */
  find(tag: string): Promise<{ commitSha: string; notesSha256: string | null } | null>
  /** Cria a GitHub Release (e a tag no `sha`, se não existir). Nunca altera uma tag existente. */
  publish(input: { tag: string; sha: string; title: string; notes: string }): Promise<void>
}

export type PublishOutcome =
  | { readonly state: 'published'; readonly tag: string; readonly manifestSha256: string }
  | { readonly state: 'pending'; readonly tag: string; readonly reason: string }
  | { readonly state: 'failed'; readonly tag: string; readonly reason: string }
  | { readonly state: 'rejected'; readonly reason: 'release-not-stable' | 'release-not-found' }

export interface PublisherDeps {
  readonly repository: ReleaseRepository
  readonly promotion: ReleasePromotionRepository
  readonly local: ReleaseLocalRepository
  readonly recovery: ReleaseRecoveryRepository
  /** Ausente = GitHub não configurado: a identidade existe e a publicação fica pendente. */
  readonly git?: ReleaseGitPort
  readonly now?: () => string
}

const sha256 = (texto: string): string => createHash('sha256').update(texto).digest('hex')

/** O último resultado de cada gate por ambiente. */
function gatesVigentes(gates: readonly GateResult[]): GateResult[] {
  const ultimo = new Map<string, GateResult>()
  for (const g of gates) {
    const chave = `${g.environment}:${g.gate}`
    const anterior = ultimo.get(chave)
    if (!anterior || anterior.createdAt <= g.createdAt) ultimo.set(chave, g)
  }
  return [...ultimo.values()]
}

export class ReleasePublisher {
  private readonly evidence: ReleaseEvidenceWriter

  constructor(private readonly deps: PublisherDeps) {
    this.evidence = new ReleaseEvidenceWriter(deps.recovery, () => this.now())
  }

  private now(): string {
    return (this.deps.now ?? (() => new Date().toISOString()))()
  }

  async publish(scope: ReleaseScope, releaseId: string): Promise<PublishOutcome> {
    const { repository, recovery } = this.deps
    const release = repository.get({ ...scope, releaseId })
    if (!release) return { state: 'rejected', reason: 'release-not-found' }
    const detalhe = repository.detail({ ...scope, releaseId })
    const estabilizou = gatesVigentes(detalhe?.gates ?? []).some(
      (g) => g.environment === 'production' && g.gate === 'stabilization' && g.result === 'passed'
    )
    // A guarda vem antes de tudo: nem o manifesto nem o GitHub existem para o que não estabilizou.
    if (release.status !== 'completed' || !estabilizou)
      return { state: 'rejected', reason: 'release-not-stable' }

    const manifesto = this.garantirManifesto(scope, releaseId)
    const tag = manifesto.tag
    // Já confirmada: repetir não chama o GitHub nem reabre a publicação (ela não volta atrás).
    if (recovery.publication(scope, releaseId, 'github-release')?.state === 'published')
      return { state: 'published', tag, manifestSha256: manifesto.manifestSha256 }
    recovery.setPublication(scope, releaseId, 'github-release', { state: 'pending' }, this.now())
    const git = this.deps.git
    if (!git)
      return this.pendente(scope, releaseId, tag, 'github-not-configured', 'configure-github')

    try {
      const existente = await git.find(tag)
      if (existente && existente.commitSha !== release.sha)
        return this.falhou(scope, releaseId, tag, 'tag-conflict', 'resolve-tag-conflict')
      if (!existente || existente.notesSha256 === null)
        await git.publish({
          tag,
          sha: release.sha,
          title: tag,
          notes: manifesto.changelog
        })
      const confirmada = await git.find(tag)
      if (!confirmada || confirmada.commitSha !== release.sha)
        return this.pendente(scope, releaseId, tag, 'github-unconfirmed', 'retry-publication')
    } catch (erro) {
      const codigo = erro instanceof PromotionProviderError ? erro.code : 'unknown'
      // Credencial recusada não se resolve repetindo; o resto pode ser queda passageira.
      if (codigo === 'auth')
        return this.falhou(scope, releaseId, tag, 'github-auth', 'fix-github-access')
      return this.pendente(scope, releaseId, tag, `github-${codigo}`, 'retry-publication')
    }
    recovery.setPublication(
      scope,
      releaseId,
      'github-release',
      { state: 'published', externalRef: tag },
      this.now()
    )
    this.evidence.record(scope, releaseId, {
      kind: 'publication',
      state: 'confirmed',
      reason: 'published',
      details: { tag }
    })
    return { state: 'published', tag, manifestSha256: manifesto.manifestSha256 }
  }

  /** Publica de novo o que ficou pendente ou falho — documento nunca bloqueia nem reverte a release. */
  async retryPending(scope: ReleaseScope): Promise<PublishOutcome[]> {
    const resultados: PublishOutcome[] = []
    for (const pendente of this.deps.recovery.pendingPublications(scope))
      resultados.push(await this.publish(scope, pendente.releaseId))
    return resultados
  }

  /**
   * Prova que a identidade confere: o manifesto refeito dos registros imutáveis tem o hash
   * guardado, e o GitHub tem a tag no commit da release com as notas que a pipeline escreveu.
   */
  async verify(
    scope: ReleaseScope,
    releaseId: string
  ): Promise<{ ok: boolean; problems: string[] }> {
    const { repository, recovery } = this.deps
    const release = repository.get({ ...scope, releaseId })
    const guardado = recovery.manifest(scope, releaseId)
    if (!release || !guardado) return { ok: false, problems: ['manifest-missing'] }
    const problemas: string[] = []
    const guardadoJson = JSON.parse(guardado.manifestJson) as {
      previousRelease: { releaseId: string; tag: string | null } | null
    }
    const refeito = jsonCanonico(
      construirManifesto(this.coletar(scope, releaseId, guardado.tag, guardadoJson.previousRelease))
    )
    if (sha256(refeito) !== guardado.manifestSha256 || refeito !== guardado.manifestJson)
      problemas.push('manifest-diverged')
    if (!this.deps.git) problemas.push('git-unavailable')
    else {
      const achada = await this.deps.git.find(guardado.tag).catch(() => 'erro' as const)
      if (achada === 'erro') problemas.push('git-unavailable')
      else if (!achada) problemas.push('tag-missing')
      else {
        if (achada.commitSha !== release.sha) problemas.push('tag-wrong-commit')
        else if (achada.notesSha256 !== sha256(guardado.changelog)) problemas.push('notes-diverged')
      }
    }
    return { ok: problemas.length === 0, problems: problemas }
  }

  private pendente(
    scope: ReleaseScope,
    releaseId: string,
    tag: string,
    reason: string,
    action: string
  ): PublishOutcome {
    this.deps.recovery.setPublication(
      scope,
      releaseId,
      'github-release',
      { state: 'pending', reason },
      this.now()
    )
    this.evidence.record(scope, releaseId, {
      kind: 'publication',
      state: 'pending',
      reason,
      action
    })
    return { state: 'pending', tag, reason }
  }

  private falhou(
    scope: ReleaseScope,
    releaseId: string,
    tag: string,
    reason: string,
    action: string
  ): PublishOutcome {
    this.deps.recovery.setPublication(
      scope,
      releaseId,
      'github-release',
      { state: 'failed', reason },
      this.now()
    )
    this.evidence.record(scope, releaseId, { kind: 'publication', state: 'failed', reason, action })
    return { state: 'failed', tag, reason }
  }

  /** O manifesto é imutável: o primeiro gravado vale; o seguinte só o devolve. */
  private garantirManifesto(scope: ReleaseScope, releaseId: string): ReleaseManifest {
    const { repository, recovery } = this.deps
    const existente = recovery.manifest(scope, releaseId)
    if (existente) return existente
    const release = repository.get({ ...scope, releaseId })!
    const tag = nomeDaTag(release.updatedAt, release.sha)
    const anterior = recovery.previousCompleted(scope, releaseId)
    const manifesto = construirManifesto(this.coletar(scope, releaseId, tag, anterior))
    const json = jsonCanonico(manifesto)
    const hash = sha256(json)
    return recovery.saveManifest(
      scope,
      releaseId,
      {
        tag,
        manifestJson: json,
        manifestSha256: hash,
        changelog: gerarChangelog(manifesto, hash)
      },
      this.now()
    )
  }

  /** Reúne os registros imutáveis da release no formato do manifesto. */
  private coletar(
    scope: ReleaseScope,
    releaseId: string,
    tag: string,
    previous: DadosDoManifesto['previous']
  ): DadosDoManifesto {
    const { repository, promotion, local, recovery } = this.deps
    const release = repository.get({ ...scope, releaseId })!
    const artefato = local.getArtifact(scope, releaseId, 'backend-image')
    return {
      releaseId,
      projectId: scope.projectId,
      sha: release.sha,
      tag,
      createdAt: release.createdAt,
      stageStartedAt: release.stageStartedAt,
      completedAt: release.updatedAt,
      previous,
      artifacts: artefato
        ? [{ kind: artefato.kind, digest: artefato.digest, uri: artefato.uri }]
        : [],
      deployments: promotion.listDeployments(scope, releaseId).map((d) => ({
        environment: d.environment,
        kind: d.kind,
        externalId: d.externalId,
        artifactDigest: d.artifactDigest,
        replacesExternalId: d.replacesExternalId
      })),
      migrations: promotion.listMigrations(scope, releaseId).map((m) => ({
        environment: m.environment,
        migrationId: m.migrationId,
        checksum: m.checksum,
        state: m.state,
        backupRef: m.backupRef
      })),
      gates: gatesVigentes(repository.detail({ ...scope, releaseId })?.gates ?? []).map((g) => ({
        environment: g.environment,
        gate: g.gate,
        result: g.result,
        reason: g.reason
      })),
      inclusions: recovery.inclusions(scope, releaseId).map((i) => ({
        sha: i.sha,
        pullRequest: i.pullRequest ?? null,
        specId: i.specId ?? null,
        sliceId: i.sliceId ?? null,
        issue: i.issue ?? null
      }))
    }
  }
}
