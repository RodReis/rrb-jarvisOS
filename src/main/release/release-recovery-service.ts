import type { ReleaseEnvironment, ReleaseScope } from '@shared/domain/release'
import { ReleaseEvidenceWriter } from './correction/evidence-writer'
import type {
  PromotionBackendPort,
  PromotionFrontendPort,
  PromotionVerifierPort
} from './promotion-ports'
import type { ReleaseLocalRepository } from './release-local-repository'
import type { ReleasePromotionRepository } from './release-promotion-repository'
import type { ReleaseRecoveryRepository } from './release-recovery-repository'
import {
  ReleaseConflictError,
  type ReleaseLease,
  type ReleaseRepository
} from './release-repository'

/**
 * Recuperação de Produção fora do caminho de uma release (SPEC-Release-05): rollback para um
 * `release_id` conhecido e liberação do projeto pausado por uma release degradada. Nenhum dos dois
 * constrói, migra ou implanta código novo — só reaponta frontend e backend para deployments que a
 * pipeline já provou saudáveis — e nenhum toca o banco.
 */

export const LEASE_PADRAO_MS = 15 * 60_000
export const CONFLITOS_DE_POSSE: readonly ReleaseConflictError['code'][] = [
  'lease-mismatch',
  'lease-expired',
  'lease-busy',
  'lane-busy'
]

export interface RecoveryServiceDeps {
  readonly repository: ReleaseRepository
  readonly promotion: ReleasePromotionRepository
  readonly local: ReleaseLocalRepository
  readonly recovery: ReleaseRecoveryRepository
  readonly backend: PromotionBackendPort
  readonly frontend: PromotionFrontendPort
  readonly verifier: PromotionVerifierPort
  readonly now?: () => string
  readonly ownerId?: string
  readonly leaseMs?: number
}

interface AlvoDeRestauracao {
  readonly environment: ReleaseEnvironment
  readonly kind: 'frontend' | 'backend'
  readonly id: string
}

export interface RollbackOutcome {
  readonly state: 'rolled-back' | 'failed' | 'rejected' | 'waiting'
  readonly reason: string | null
  /** A release que Produção servia e a que passa a servir. */
  readonly from?: string
  readonly to?: string
}

export interface RecoveryOutcome {
  readonly state: 'none' | 'paused' | 'resumed'
  readonly reason: string | null
}

/** Reaponta o ambiente a um deployment que a pipeline já provou saudável. Nunca toca o banco. */
export async function restaurarAplicacao(
  deps: Pick<RecoveryServiceDeps, 'frontend' | 'backend'>,
  environment: ReleaseEnvironment,
  kind: 'frontend' | 'backend',
  deploymentId: string
): Promise<void> {
  if (kind === 'frontend') await deps.frontend.assign({ environment, deploymentId })
  else await deps.backend.rollback({ environment, toDeploymentId: deploymentId })
}

export class ReleaseRecoveryService {
  private readonly evidence: ReleaseEvidenceWriter

  constructor(private readonly deps: RecoveryServiceDeps) {
    this.evidence = new ReleaseEvidenceWriter(deps.recovery, () => this.now())
  }

  private now(): string {
    return (this.deps.now ?? (() => new Date().toISOString()))()
  }

  // --- rollback por release_id ---------------------------------------------------------------

  /**
   * Rollback de Produção para um `release_id` conhecido (SPEC-Release-05, critério 9): reaponta
   * frontend e backend aos deployments dessa release — nunca "a versão anterior" —, prova na
   * nuvem que Produção voltou a servir exatamente a identidade dela e só então confirma. O banco
   * não é tocado: a versão alvo precisa ser compatível com o schema expandido (SPEC-Release-04,
   * regra 5). Tomar a lane de Produção serializa o rollback com qualquer promoção em curso.
   */
  async rollback(scope: ReleaseScope, input: { readonly to: string }): Promise<RollbackOutcome> {
    const { promotion, repository, recovery, local } = this.deps
    const servindo = promotion.lastKnownDeployment(scope, 'production', 'frontend', '')
    if (!servindo) return { state: 'rejected', reason: 'nothing-to-roll-back' }
    const from = servindo.releaseId
    const to = input.to
    if (to === from) return { state: 'rejected', reason: 'already-serving', from, to }
    const alvo = repository.get({ ...scope, releaseId: to })
    if (!alvo) return { state: 'rejected', reason: 'target-not-found', from }
    if (alvo.status !== 'completed')
      return { state: 'rejected', reason: 'target-not-completed', from, to }
    const backend = promotion.getDeployment(scope, to, 'production', 'backend')
    const frontend = promotion.getDeployment(scope, to, 'production', 'frontend')
    const artefato = local.getArtifact(scope, to, 'backend-image')
    if (!backend || !frontend || !artefato)
      return { state: 'rejected', reason: 'target-incomplete', from, to }

    const query = { ...scope, releaseId: from, environment: 'production' as const }
    let lease: ReleaseLease
    try {
      lease = repository.acquireLease(
        query,
        this.deps.ownerId ?? `rollback-${process.pid}`,
        this.deps.leaseMs ?? LEASE_PADRAO_MS,
        this.now()
      )
    } catch (erro) {
      if (erro instanceof ReleaseConflictError && CONFLITOS_DE_POSSE.includes(erro.code))
        return { state: 'waiting', reason: erro.code, from, to }
      throw erro
    }
    try {
      const rollbackId = recovery.beginRollback(scope, from, to, this.now())
      const alvos = [
        { kind: 'frontend' as const, id: frontend.externalId },
        { kind: 'backend' as const, id: backend.externalId }
      ]
      for (const alvoDeploy of alvos) {
        const compensacaoId = promotion.beginCompensation(
          scope,
          from,
          { environment: 'production', action: `${alvoDeploy.kind}:rollback:${alvoDeploy.id}` },
          this.now()
        )
        try {
          await restaurarAplicacao(this.deps, 'production', alvoDeploy.kind, alvoDeploy.id)
          promotion.finishCompensation(scope, from, compensacaoId, 'confirmed')
        } catch {
          promotion.finishCompensation(scope, from, compensacaoId, 'failed')
        }
      }
      const provado = await this.provarRollback(artefato.digest, frontend.externalId)
      recovery.finishRollback(scope, rollbackId, provado ? 'confirmed' : 'failed', this.now())
      this.evidence.record(scope, from, {
        kind: 'rollback',
        state: provado ? 'confirmed' : 'failed',
        environment: 'production',
        reason: provado ? 'rolled-back' : 'rollback-not-verified',
        ...(provado ? {} : { action: 'check-provider-status' }),
        details: { to }
      })
      if (provado) return { state: 'rolled-back', reason: null, from, to }
      recovery.pauseProject(scope, from, 'rollback-not-verified', this.now())
      return { state: 'failed', reason: 'rollback-not-verified', from, to }
    } finally {
      try {
        repository.releaseLane(query, lease, this.now())
      } catch {
        // lease já expirado: a lane será reaproveitada pelo próximo writer
      }
    }
  }

  /** Produção serve a identidade da release alvo? Falha de verificação é "não provado". */
  private async provarRollback(
    backendDigest: string,
    frontendDeploymentId: string
  ): Promise<boolean> {
    const checks = ['backend_health', 'frontend_wiring', 'smoke'] as const
    try {
      const resultados = await this.deps.verifier.verify({
        environment: 'production',
        checks,
        backendDigest,
        frontendDeploymentId
      })
      return checks.every((c) => resultados.find((r) => r.gate === c)?.result === 'passed')
    } catch {
      return false
    }
  }

  // --- recuperação do projeto pausado -------------------------------------------------------

  /**
   * Comando do operador depois de uma release degradada: refaz o que a compensação não conseguiu,
   * **prova na nuvem** que cada ambiente voltou ao deployment conhecido e só então libera o
   * projeto. Sem estado conhecido para provar (não havia release anterior), só `acknowledge`
   * — a declaração explícita e auditada do operador — libera. O banco nunca é restaurado.
   */
  async recover(
    scope: ReleaseScope,
    opcoes: { readonly acknowledge?: boolean } = {}
  ): Promise<RecoveryOutcome> {
    const { recovery, promotion } = this.deps
    const pausa = recovery.activePause(scope)
    if (!pausa) return { state: 'none', reason: null }
    const releaseId = pausa.releaseId
    if (opcoes.acknowledge) {
      this.evidence.record(scope, releaseId, {
        kind: 'recovery',
        state: 'recorded',
        action: 'operator-acknowledged'
      })
      recovery.resolvePause(scope, this.now())
      return { state: 'resumed', reason: null }
    }
    const alvos = new Map<string, AlvoDeRestauracao>()
    let semDestino = false
    for (const c of promotion.listCompensations(scope, releaseId)) {
      const restauracao = /^(frontend|backend):(?:restore|rollback):(.+)$/.exec(c.action)
      if (!restauracao) {
        semDestino = true
        continue
      }
      const kind = restauracao[1] as AlvoDeRestauracao['kind']
      alvos.set(`${c.environment}:${kind}`, {
        environment: c.environment,
        kind,
        id: restauracao[2] ?? ''
      })
    }
    let verificado = alvos.size > 0 && !semDestino
    for (const alvo of alvos.values()) {
      if (await this.servindo(alvo)) continue
      try {
        await restaurarAplicacao(this.deps, alvo.environment, alvo.kind, alvo.id)
      } catch {
        // a prova abaixo decide
      }
      if (!(await this.servindo(alvo))) verificado = false
    }
    if (!verificado) {
      this.evidence.record(scope, releaseId, {
        kind: 'recovery',
        state: 'failed',
        reason: 'recovery-not-verified',
        action: 'check-provider-status'
      })
      return { state: 'paused', reason: 'recovery-not-verified' }
    }
    this.evidence.record(scope, releaseId, { kind: 'recovery', state: 'confirmed' })
    recovery.resolvePause(scope, this.now())
    return { state: 'resumed', reason: null }
  }

  /** O ambiente serve agora o deployment-alvo? Falha de leitura é "não provado", nunca "provado". */
  private async servindo(alvo: AlvoDeRestauracao): Promise<boolean> {
    try {
      if (alvo.kind === 'frontend')
        return (await this.deps.frontend.current(alvo.environment)) === alvo.id
      return (await this.deps.backend.current(alvo.environment))?.deploymentId === alvo.id
    } catch {
      return false
    }
  }
}
