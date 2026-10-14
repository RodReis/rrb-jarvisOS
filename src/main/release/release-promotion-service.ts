import { createHash } from 'node:crypto'
import type { ReleaseEnvironment, ReleaseScope, ReleaseStatus } from '@shared/domain/release'
import { ESTABILIZACAO_PADRAO } from '@shared/domain/release-promotion'
import { ReleaseGateEngine, gateStoreFrom } from './release-gate-engine'
import { ReleaseOrchestrator } from './release-orchestrator'
import {
  PromotionEffects,
  type PromotionEffectsDeps,
  type PromotionProject
} from './release-promotion-effects'
import type { ReleasePromotionRepository } from './release-promotion-repository'
import {
  ReleaseConflictError,
  type ReleaseLease,
  type ReleaseRepository
} from './release-repository'
import type { ReleaseLocalRepository } from './release-local-repository'
import type {
  PromotionBackendPort,
  PromotionBuildPort,
  PromotionDatabasePort,
  PromotionFrontendPort,
  PromotionVerifierPort
} from './promotion-ports'
import { StabilizationMonitor } from './stabilization-monitor'

/**
 * Promoção de uma release mergeada para Staging e Produção (SPEC-Release-04). Dirige o
 * `ReleaseOrchestrator` da F01: o diário, o lease e a lane por projeto/ambiente já existem; aqui
 * está a sequência — preparar, Staging, Produção, estabilizar — a compensação de aplicação e a
 * regra de que o banco nunca é restaurado sozinho. Nenhuma etapa pede aceite do PI.
 */

export type PromotionState =
  | 'completed'
  | 'failed'
  | 'degraded'
  | 'superseded'
  /** Outra release (ou outro writer) ocupa a lane; repetir depois retoma de onde parou. */
  | 'waiting'
  /** Passo de efeito incerto: precisa de reconciliação antes de qualquer repetição. */
  | 'blocked'

export interface PromotionOutcome {
  readonly releaseId: string
  readonly state: PromotionState
  readonly status: ReleaseStatus
  /** Código curto do motivo; nunca texto de provedor. */
  readonly reason: string | null
  readonly environment?: ReleaseEnvironment
  readonly step?: string
}

export interface PromotionServiceDeps {
  readonly repository: ReleaseRepository
  readonly promotion: ReleasePromotionRepository
  readonly local: ReleaseLocalRepository
  readonly build: PromotionBuildPort
  readonly backend: PromotionBackendPort
  readonly database: PromotionDatabasePort
  readonly frontend: PromotionFrontendPort
  readonly verifier: PromotionVerifierPort
  readonly now?: () => string
  readonly nowMs?: () => number
  readonly sleep?: (ms: number) => Promise<void>
  readonly ownerId?: string
  /** Validade do lease; é renovado a cada passo e a cada observação da estabilização. */
  readonly leaseMs?: number
}

const LEASE_PADRAO_MS = 15 * 60_000
const PASSOS_STAGING = [
  'database_migrated',
  'backend_healthy',
  'frontend_promoted',
  'smoke_passed'
] as const
const PASSOS_PRODUCAO = ['prepared', ...PASSOS_STAGING] as const

const sha256 = (texto: string): string => createHash('sha256').update(texto).digest('hex')

/** Execução em andamento de uma release: o que as etapas compartilham. */
interface Run {
  readonly scope: ReleaseScope
  readonly releaseId: string
  readonly project: PromotionProject
  readonly effects: PromotionEffects
  readonly orchestrator: ReleaseOrchestrator
  readonly leases: Map<ReleaseEnvironment, ReleaseLease>
}

class Parar extends Error {
  constructor(readonly outcome: Omit<PromotionOutcome, 'releaseId' | 'status'>) {
    super(outcome.reason ?? outcome.state)
  }
}

export class PromotionService {
  private readonly gates: ReleaseGateEngine

  constructor(private readonly deps: PromotionServiceDeps) {
    this.gates = new ReleaseGateEngine(gateStoreFrom(deps.repository), () => this.now())
  }

  private now(): string {
    return (this.deps.now ?? (() => new Date().toISOString()))()
  }

  private nowMs(): number {
    return (this.deps.nowMs ?? (() => Date.now()))()
  }

  /** Evento de merge: cria ou consolida o candidato e o leva adiante. */
  async handleMerge(
    scope: ReleaseScope,
    sha: string,
    project: PromotionProject
  ): Promise<PromotionOutcome> {
    let release: { id: string }
    try {
      release = this.deps.repository.enqueue(scope, sha, this.now()).release
    } catch (erro) {
      // O candidato anterior ainda tem passo incerto: consolidar agora esconderia o efeito. O SHA
      // novo não ganha release; o operador reconcilia o anterior e reentrega o merge.
      const candidato = this.deps.repository.queue(scope).candidate
      if (
        erro instanceof ReleaseConflictError &&
        erro.code === 'reconciliation-required' &&
        candidato
      )
        return {
          releaseId: candidato.id,
          state: 'blocked',
          status: candidato.status,
          reason: 'reconciliation-required'
        }
      throw erro
    }
    return this.promote(scope, release.id, project)
  }

  /** Retoma, da mais antiga à mais nova, as releases do projeto que ainda não terminaram. */
  async resume(scope: ReleaseScope, project: PromotionProject): Promise<PromotionOutcome[]> {
    const resultados: PromotionOutcome[] = []
    for (const aberta of this.deps.promotion.openReleases(scope))
      resultados.push(await this.promote(scope, aberta.id, project))
    return resultados
  }

  async promote(
    scope: ReleaseScope,
    releaseId: string,
    project: PromotionProject
  ): Promise<PromotionOutcome> {
    const release = this.deps.repository.get({ ...scope, releaseId })
    if (!release) throw new ReleaseConflictError('release-not-found', 'Release não encontrada.')
    const leases = new Map<ReleaseEnvironment, ReleaseLease>()
    const effects = new PromotionEffects(
      this.effectsDeps(
        scope,
        release.id,
        release.sha,
        project,
        () => leases.get('staging')?.leaseId ?? ''
      )
    )
    const run: Run = {
      scope,
      releaseId: release.id,
      project,
      effects,
      orchestrator: new ReleaseOrchestrator(this.deps.repository, effects, () => this.now()),
      leases
    }
    try {
      return await this.drive(run)
    } catch (erro) {
      if (erro instanceof Parar) return this.outcome(run, erro.outcome)
      // Lease que expirou ou passou a outro writer: este executor sai sem escrever mais nada.
      if (
        erro instanceof ReleaseConflictError &&
        (erro.code === 'lease-mismatch' ||
          erro.code === 'lease-expired' ||
          erro.code === 'lease-busy' ||
          erro.code === 'lane-busy')
      )
        return this.outcome(run, { state: 'waiting', reason: erro.code })
      throw erro
    } finally {
      this.releaseLeases(run)
    }
  }

  /**
   * Ao sair (sucesso, espera, bloqueio ou erro) o executor larga os leases que segurava: quem
   * retoma uma release bloqueada não espera o prazo expirar. Lease já encerrado pela transição
   * terminal (a lane foi limpa) não é erro.
   */
  private releaseLeases(run: Run): void {
    for (const [environment, lease] of run.leases) {
      try {
        this.deps.repository.releaseLease(this.query(run, environment), lease, this.now())
      } catch {
        // já expirado ou substituído: nada a liberar
      }
    }
  }

  private effectsDeps(
    scope: ReleaseScope,
    releaseId: string,
    sourceSha: string,
    project: PromotionProject,
    leaseId: () => string
  ): PromotionEffectsDeps {
    return {
      scope,
      releaseId,
      sourceSha,
      project,
      promotion: this.deps.promotion,
      local: this.deps.local,
      gates: this.gates,
      build: this.deps.build,
      backend: this.deps.backend,
      database: this.deps.database,
      frontend: this.deps.frontend,
      verifier: this.deps.verifier,
      now: () => this.now(),
      leaseId
    }
  }

  private status(run: Run): ReleaseStatus {
    const release = this.deps.repository.get({ ...run.scope, releaseId: run.releaseId })
    if (!release) throw new ReleaseConflictError('release-not-found', 'Release desapareceu.')
    return release.status
  }

  private outcome(
    run: Run,
    parcial: Omit<PromotionOutcome, 'releaseId' | 'status'>
  ): PromotionOutcome {
    return { releaseId: run.releaseId, status: this.status(run), ...parcial }
  }

  private query(run: Run, environment: ReleaseEnvironment) {
    return { ...run.scope, releaseId: run.releaseId, environment }
  }

  /** Lease do ambiente, adquirido uma vez por execução. Lane ou lease ocupados viram `waiting`. */
  private lease(run: Run, environment: ReleaseEnvironment): ReleaseLease {
    const existente = run.leases.get(environment)
    if (existente) return existente
    const lease = run.orchestrator.acquireWriter(
      this.query(run, environment),
      this.deps.ownerId ?? `promotion-${process.pid}`,
      this.deps.leaseMs ?? LEASE_PADRAO_MS
    )
    run.leases.set(environment, lease)
    return lease
  }

  private renew(run: Run, environment: ReleaseEnvironment): void {
    this.deps.repository.renewLease(
      this.query(run, environment),
      this.lease(run, environment),
      this.deps.leaseMs ?? LEASE_PADRAO_MS,
      this.now()
    )
  }

  private async drive(run: Run): Promise<PromotionOutcome> {
    for (;;) {
      switch (this.status(run)) {
        case 'queued':
        case 'preparing':
          await this.preparing(run)
          break
        case 'staging':
          await this.staging(run)
          break
        case 'production':
          await this.production(run)
          break
        case 'stabilizing':
          return await this.stabilizing(run)
        case 'completed':
          return this.outcome(run, { state: 'completed', reason: null })
        case 'superseded':
          return this.outcome(run, { state: 'superseded', reason: null })
        case 'failed':
          return this.outcome(run, { state: 'failed', reason: null })
        case 'degraded':
          return this.outcome(run, { state: 'degraded', reason: null })
      }
    }
  }

  // --- etapas -----------------------------------------------------------------------------

  private async preparing(run: Run): Promise<void> {
    const staging = this.query(run, 'staging')
    const lease = this.lease(run, 'staging')
    if (this.status(run) === 'queued') run.orchestrator.transition(staging, 'preparing', lease)
    await this.step(run, 'staging', 'prepared')
    // Daqui em diante o SHA e os artefatos são imutáveis (stage_started_at).
    run.orchestrator.transition(staging, 'staging', lease)
  }

  private async staging(run: Run): Promise<void> {
    for (const passo of PASSOS_STAGING) await this.step(run, 'staging', passo)
    const bloqueio = this.gates.firstBlocker(run.scope, run.releaseId, 'staging')
    if (bloqueio) await this.fail(run, 'staging', `staging-${bloqueio.gate}`)
    // Regra 1: Produção só depois de Staging aprovado. A lane de Produção é tomada antes da
    // transição; se outra release a ocupa, esta espera em Staging.
    const lease = this.lease(run, 'production')
    run.orchestrator.transition(this.query(run, 'production'), 'production', lease)
  }

  private async production(run: Run): Promise<void> {
    for (const passo of PASSOS_PRODUCAO) await this.step(run, 'production', passo)
    const bloqueio = this.gates.firstBlocker(run.scope, run.releaseId, 'production')
    if (bloqueio) await this.fail(run, 'production', `production-${bloqueio.gate}`)
    run.orchestrator.transition(
      this.query(run, 'production'),
      'stabilizing',
      this.lease(run, 'production')
    )
  }

  private async stabilizing(run: Run): Promise<PromotionOutcome> {
    const production = this.query(run, 'production')
    const lease = this.lease(run, 'production')
    const identidade = this.identidade(run)
    // Um `passed` para CADA check pedido: lista vazia ou check omitido não prova saúde.
    const verificar = async (
      checks: readonly ('backend_health' | 'frontend_wiring' | 'smoke')[]
    ): Promise<boolean> => {
      const resultados = await this.deps.verifier.verify({
        environment: 'production',
        checks,
        ...identidade
      })
      return checks.every((c) => resultados.find((r) => r.gate === c)?.result === 'passed')
    }
    const monitor = new StabilizationMonitor({
      config: run.project.stabilization ?? ESTABILIZACAO_PADRAO,
      health: () => verificar(['backend_health', 'frontend_wiring']),
      smoke: () => verificar(['smoke']),
      renew: () => this.renew(run, 'production'),
      nowMs: () => this.nowMs(),
      sleep: this.deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      onRestart: () =>
        this.gates.record(run.scope, run.releaseId, 'production', {
          gate: 'stabilization',
          result: 'unknown',
          reason: 'health-restarted'
        })
    })
    const resultado = await monitor.run()
    if (resultado.state === 'compensate') await this.fail(run, 'production', 'stabilization-failed')
    this.gates.record(run.scope, run.releaseId, 'production', {
      gate: 'stabilization',
      result: 'passed'
    })
    // `completed` é técnico: tag, manifesto e GitHub Release só nascem na F05.
    run.orchestrator.transition(production, 'completed', lease)
    return this.outcome(run, { state: 'completed', reason: null })
  }

  private identidade(run: Run): { backendDigest: string; frontendDeploymentId: string } {
    const backend = this.deps.local.getArtifact(run.scope, run.releaseId, 'backend-image')
    const frontend = this.deps.promotion.getDeployment(
      run.scope,
      run.releaseId,
      'production',
      'frontend'
    )
    if (!backend || !frontend) throw new Parar({ state: 'blocked', reason: 'identity-missing' })
    return { backendDigest: backend.digest, frontendDeploymentId: frontend.externalId }
  }

  /** Um passo do diário. Confirmado segue; falha definitiva compensa; incerto para e espera. */
  private async step(run: Run, environment: ReleaseEnvironment, step: string): Promise<void> {
    const lease = this.lease(run, environment)
    this.renew(run, environment)
    const resultado = await run.orchestrator.runStep(
      this.query(run, environment),
      step,
      this.payloadHash(run, environment, step),
      lease
    )
    if (resultado.state === 'confirmed') return
    if (resultado.state === 'ambiguous')
      throw new Parar({ state: 'blocked', reason: run.effects.reason, environment, step })
    await this.fail(run, environment, run.effects.reason ?? `${step}-failed`)
  }

  /**
   * Fingerprint estável do que o passo faz: repetir o passo com a mesma entrada reutiliza a chave
   * idempotente; entrada diferente seria conflito (regra 3 da F01).
   */
  private payloadHash(run: Run, environment: ReleaseEnvironment, step: string): string {
    const release = this.deps.repository.get({ ...run.scope, releaseId: run.releaseId })
    const artefato = this.deps.local.getArtifact(run.scope, run.releaseId, 'backend-image')
    return sha256(
      JSON.stringify({
        sha: release?.sha,
        environment,
        step,
        digest:
          step === 'prepared' && environment === 'staging' ? null : (artefato?.digest ?? null),
        migrations:
          step === 'database_migrated' ? run.project.migrations.map((m) => m.checksum) : null
      })
    )
  }

  /**
   * Falha definitiva: compensa as aplicações do ambiente e encerra a release. O banco nunca é
   * restaurado (regra 7). Sempre lança `Parar`; quem chama não continua.
   */
  private async fail(run: Run, environment: ReleaseEnvironment, reason: string): Promise<never> {
    const status = this.status(run)
    const compensado =
      status === 'queued' || status === 'preparing' ? true : await this.compensate(run, environment)
    const terminal: ReleaseStatus = compensado ? 'failed' : 'degraded'
    run.orchestrator.transition(
      this.query(run, environment),
      terminal,
      this.lease(run, environment)
    )
    throw new Parar({ state: compensado ? 'failed' : 'degraded', reason, environment })
  }

  /**
   * Volta frontend e backend do ambiente para os deployments que a pipeline provou saudáveis
   * (última release concluída). Só compensa o que o passo chegou a tentar: migration que falhou
   * antes da troca de tráfego não gera compensação (regra 6). `false` = compensação incompleta.
   */
  private async compensate(run: Run, environment: ReleaseEnvironment): Promise<boolean> {
    const { promotion, repository, frontend, backend } = this.deps
    const query = this.query(run, environment)
    let completo = true
    const alvos = [
      { kind: 'frontend' as const, passo: 'frontend_promoted' },
      { kind: 'backend' as const, passo: 'backend_healthy' }
    ]
    for (const alvo of alvos) {
      if (!repository.getStep(query, alvo.passo)) continue
      // Resolvido AGORA: uma release vizinha pode ter concluído depois que esta preparou.
      const anterior = promotion.lastKnownDeployment(
        run.scope,
        environment,
        alvo.kind,
        run.releaseId
      )?.externalId
      const acao = anterior ? `${alvo.kind}:restore:${anterior}` : `${alvo.kind}:none:no-previous`
      const id = promotion.beginCompensation(
        run.scope,
        run.releaseId,
        { environment, action: acao },
        this.now()
      )
      if (!anterior) {
        // Sem baseline não há como restaurar, e a versão nova segue no ar: não é "compensado".
        completo = false
        promotion.finishCompensation(run.scope, run.releaseId, id, 'failed')
        continue
      }
      try {
        if (alvo.kind === 'frontend') await frontend.assign({ environment, deploymentId: anterior })
        else await backend.rollback({ environment, toDeploymentId: anterior })
        promotion.finishCompensation(run.scope, run.releaseId, id, 'confirmed')
      } catch {
        completo = false
        promotion.finishCompensation(run.scope, run.releaseId, id, 'failed')
      }
    }
    return completo
  }
}
