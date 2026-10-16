import type { ReleaseEnvironment, ReleaseScope } from '@shared/domain/release'
import { ReleaseEvidenceWriter } from './correction/evidence-writer'
import {
  PromotionProviderError,
  type PromotionBackendPort,
  type PromotionFrontendPort,
  type PromotionVerifierPort
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
  /** `waiting` = outra escrita segura a lane de Produção; repetir depois. */
  readonly state: 'none' | 'paused' | 'resumed' | 'waiting'
  readonly reason: string | null
}

/** Código fechado de um erro de provedor (`auth`, `not-found`, ...); `unknown` para o resto. */
export function codigoDoErro(erro: unknown): string {
  return erro instanceof PromotionProviderError ? erro.code : 'unknown'
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
   * regra 5). Tomar a lane de Produção serializa o rollback com qualquer promoção em curso, e o
   * que Produção serve é relido **depois** de tomá-la.
   */
  async rollback(scope: ReleaseScope, input: { readonly to: string }): Promise<RollbackOutcome> {
    const { promotion } = this.deps
    const servindo = promotion.lastKnownDeployment(scope, 'production', 'frontend', '')
    if (!servindo) return { state: 'rejected', reason: 'nothing-to-roll-back' }
    const from = servindo.releaseId
    const to = input.to
    if (to === from) return { state: 'rejected', reason: 'already-serving', from, to }
    const alvo = this.validarAlvo(scope, to)
    if (typeof alvo === 'string') return { state: 'rejected', reason: alvo, from, to }

    const posse = this.tomarLane(scope, from)
    if ('waiting' in posse) return { state: 'waiting', reason: posse.waiting, from, to }
    const { query, lease } = posse
    try {
      // Uma promoção pode ter concluído entre a primeira leitura e a lane: a origem mudou.
      const agora = promotion.lastKnownDeployment(scope, 'production', 'frontend', '')
      if (agora?.releaseId !== from)
        return { state: 'waiting', reason: 'serving-changed', from, to }
      const provado = await this.reverter(scope, from, to, alvo, { query, lease })
      if (provado) return { state: 'rolled-back', reason: null, from, to }
      this.deps.recovery.pauseProject(scope, from, 'rollback-not-verified', this.now())
      return { state: 'failed', reason: 'rollback-not-verified', from, to }
    } finally {
      try {
        this.deps.repository.releaseLane(query, lease, this.now())
      } catch {
        // lease já expirado: `acquireLease` reaproveita uma lane abandonada por release terminal
      }
    }
  }

  /** O destino precisa ser release concluída com backend, frontend e artefato gravados. */
  private validarAlvo(
    scope: ReleaseScope,
    to: string
  ):
    | { backend: string; frontend: string; digest: string }
    | 'target-not-found'
    | 'target-not-completed'
    | 'target-incomplete' {
    const { promotion, repository, local } = this.deps
    const alvo = repository.get({ ...scope, releaseId: to })
    if (!alvo) return 'target-not-found'
    if (alvo.status !== 'completed') return 'target-not-completed'
    const backend = promotion.getDeployment(scope, to, 'production', 'backend')
    const frontend = promotion.getDeployment(scope, to, 'production', 'frontend')
    const artefato = local.getArtifact(scope, to, 'backend-image')
    if (!backend || !frontend || !artefato) return 'target-incomplete'
    return { backend: backend.externalId, frontend: frontend.externalId, digest: artefato.digest }
  }

  /** Toma a lane de Produção com a release de origem; ocupada vira espera, nunca exceção. */
  private tomarLane(
    scope: ReleaseScope,
    releaseId: string
  ):
    | {
        query: { releaseId: string; environment: 'production' } & ReleaseScope
        lease: ReleaseLease
      }
    | { waiting: string } {
    const query = { ...scope, releaseId, environment: 'production' as const }
    try {
      const lease = this.deps.repository.acquireLease(
        query,
        this.deps.ownerId ?? `recovery-${process.pid}`,
        this.deps.leaseMs ?? LEASE_PADRAO_MS,
        this.now()
      )
      return { query, lease }
    } catch (erro) {
      if (erro instanceof ReleaseConflictError && CONFLITOS_DE_POSSE.includes(erro.code))
        return { waiting: erro.code }
      throw erro
    }
  }

  /** Restaura frontend e backend do alvo, prova a identidade dele e registra o desfecho. */
  private async reverter(
    scope: ReleaseScope,
    from: string,
    to: string,
    alvo: { backend: string; frontend: string; digest: string },
    posse: {
      query: { releaseId: string; environment: 'production' } & ReleaseScope
      lease: ReleaseLease
    }
  ): Promise<boolean> {
    const { promotion, recovery, repository } = this.deps
    const rollbackId = recovery.beginRollback(scope, from, to, this.now())
    const alvos = [
      { kind: 'frontend' as const, id: alvo.frontend },
      { kind: 'backend' as const, id: alvo.backend }
    ]
    for (const item of alvos) {
      // Restaurar e provar podem levar minutos: o lease é renovado entre as etapas.
      repository.renewLease(
        posse.query,
        posse.lease,
        this.deps.leaseMs ?? LEASE_PADRAO_MS,
        this.now()
      )
      const compensacaoId = promotion.beginCompensation(
        scope,
        from,
        { environment: 'production', action: `${item.kind}:rollback:${item.id}` },
        this.now()
      )
      try {
        await restaurarAplicacao(this.deps, 'production', item.kind, item.id)
        promotion.finishCompensation(scope, from, compensacaoId, 'confirmed')
      } catch (erro) {
        promotion.finishCompensation(scope, from, compensacaoId, 'failed')
        this.evidence.record(scope, from, {
          kind: 'rollback',
          state: 'failed',
          environment: 'production',
          reason: `${item.kind}-restore-${codigoDoErro(erro)}`
        })
      }
    }
    repository.renewLease(
      posse.query,
      posse.lease,
      this.deps.leaseMs ?? LEASE_PADRAO_MS,
      this.now()
    )
    const provado = await this.provarRollback(alvo.digest, alvo.frontend)
    recovery.finishRollback(scope, rollbackId, provado ? 'confirmed' : 'failed', this.now())
    this.evidence.record(scope, from, {
      kind: 'rollback',
      state: provado ? 'confirmed' : 'failed',
      environment: 'production',
      reason: provado ? 'rolled-back' : 'rollback-not-verified',
      ...(provado ? {} : { action: 'check-provider-status' }),
      details: { to }
    })
    return provado
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
   * projeto. Toma a lane de Produção como o rollback — dois escritores não reapontam Produção ao
   * mesmo tempo. Sem estado conhecido para provar (não havia release anterior), só `acknowledge`
   * — a declaração explícita do operador, marcada na cadeia de auditoria — libera. O banco nunca
   * é restaurado.
   */
  async recover(
    scope: ReleaseScope,
    opcoes: { readonly acknowledge?: boolean } = {}
  ): Promise<RecoveryOutcome> {
    const { recovery, repository } = this.deps
    const pausa = recovery.activePause(scope)
    if (!pausa) return { state: 'none', reason: null }
    if (opcoes.acknowledge) return this.liberar(scope, pausa.releaseId, 'acknowledged')

    const posse = this.tomarLane(scope, pausa.releaseId)
    if ('waiting' in posse) return { state: 'waiting', reason: posse.waiting }
    try {
      const verificado = await this.refazerEProvar(scope, pausa.releaseId)
      if (verificado) return this.liberar(scope, pausa.releaseId, 'proved')
      this.evidence.record(scope, pausa.releaseId, {
        kind: 'recovery',
        state: 'failed',
        reason: 'recovery-not-verified',
        action: 'check-provider-status'
      })
      return { state: 'paused', reason: 'recovery-not-verified' }
    } finally {
      try {
        repository.releaseLane(posse.query, posse.lease, this.now())
      } catch {
        // lease já expirado: a lane abandonada por release terminal é reaproveitada
      }
    }
  }

  /** Resolve a pausa e só então grava a evidência; a auditoria distingue a prova do reconhecimento. */
  private liberar(
    scope: ReleaseScope,
    releaseId: string,
    como: 'proved' | 'acknowledged'
  ): RecoveryOutcome {
    const { recovery } = this.deps
    if (!recovery.resolvePause(scope, this.now(), { acknowledged: como === 'acknowledged' }))
      return { state: 'none', reason: null }
    this.evidence.record(
      scope,
      releaseId,
      como === 'acknowledged'
        ? { kind: 'recovery', state: 'recorded', action: 'operator-acknowledged' }
        : { kind: 'recovery', state: 'confirmed' }
    )
    return { state: 'resumed', reason: null }
  }

  /** Refaz a restauração que falhou e confere, na nuvem, cada alvo conhecido. */
  private async refazerEProvar(scope: ReleaseScope, releaseId: string): Promise<boolean> {
    const alvos = new Map<string, AlvoDeRestauracao>()
    let semDestino = false
    for (const c of this.deps.promotion.listCompensations(scope, releaseId)) {
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
    return verificado
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
