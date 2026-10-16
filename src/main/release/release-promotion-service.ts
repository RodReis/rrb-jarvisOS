import { createHash } from 'node:crypto'
import type { ReleaseEnvironment, ReleaseScope, ReleaseStatus } from '@shared/domain/release'
import { ESTABILIZACAO_PADRAO } from '@shared/domain/release-promotion'
import {
  classificarFalha,
  esperaAntesDaTentativa,
  podeTentarDeNovo
} from '@shared/domain/release-recovery'
import type { ReleaseCorrectionDispatcher } from './correction/dispatcher'
import { ReleaseEvidenceWriter } from './correction/evidence-writer'
import { ReleaseGateEngine, gateStoreFrom } from './release-gate-engine'
import { ReleaseOrchestrator } from './release-orchestrator'
import {
  PromotionEffects,
  type PromotionEffectsDeps,
  type PromotionProject
} from './release-promotion-effects'
import type { ReleasePromotionRepository } from './release-promotion-repository'
import type {
  CancellationPhase,
  InclusionInput,
  ReleaseRecoveryRepository
} from './release-recovery-repository'
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
  /** Evidência, pausa, cancelamento e identidade da release (SPEC-Release-05). */
  readonly recovery: ReleaseRecoveryRepository
  /** Devolve à V2 a falha de código; ausente = a correção fica a cargo do operador. */
  readonly correction?: ReleaseCorrectionDispatcher
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
const STATUS_TERMINAIS: readonly ReleaseStatus[] = ['completed', 'superseded', 'failed', 'degraded']
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

interface Compensacao {
  readonly completo: boolean
  /** Por que o projeto para quando a compensação ficou incompleta. */
  readonly motivo: 'compensation-incomplete' | 'no-previous-release' | null
}

interface AlvoDeRestauracao {
  readonly environment: ReleaseEnvironment
  readonly kind: 'frontend' | 'backend'
  readonly id: string
}

export interface CancelOutcome {
  readonly releaseId: string
  readonly status: ReleaseStatus
  /**
   * `cancelled` = terminou `failed`; `degraded` = a compensação não fechou; `requested` = outro
   * executor segura a release e cumprirá o pedido; `blocked` = efeito incerto sem resposta do
   * provedor; `rejected` = nada a cancelar.
   */
  readonly state: 'cancelled' | 'degraded' | 'requested' | 'blocked' | 'rejected'
  readonly reason: string | null
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

/** Sinal interno: há pedido de cancelamento e o executor chegou a um ponto seguro. */
class Cancelar extends Error {}

const CONFLITOS_DE_POSSE: readonly ReleaseConflictError['code'][] = [
  'lease-mismatch',
  'lease-expired',
  'lease-busy',
  'lane-busy'
]

class Parar extends Error {
  constructor(readonly outcome: Omit<PromotionOutcome, 'releaseId' | 'status'>) {
    super(outcome.reason ?? outcome.state)
  }
}

export class PromotionService {
  private readonly gates: ReleaseGateEngine
  private readonly evidence: ReleaseEvidenceWriter

  constructor(private readonly deps: PromotionServiceDeps) {
    this.gates = new ReleaseGateEngine(gateStoreFrom(deps.repository), () => this.now())
    this.evidence = new ReleaseEvidenceWriter(deps.recovery, () => this.now())
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
    project: PromotionProject,
    inclusion: Omit<InclusionInput, 'sha'> = {}
  ): Promise<PromotionOutcome> {
    let release: { id: string }
    const anterior = this.deps.repository.queue(scope).candidate
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
    this.registrarInclusao(scope, release.id, anterior, { ...inclusion, sha })
    return this.promote(scope, release.id, project)
  }

  /**
   * A release carrega o que o merge trouxe (SHA, PR, SPEC, fatia, issue) e, se consolidou um
   * candidato anterior, o que ele carregava — é isso que o manifesto, o changelog e a correção
   * da V2 usam depois. Repetir o mesmo merge não duplica.
   */
  private registrarInclusao(
    scope: ReleaseScope,
    releaseId: string,
    anterior: { id: string } | null,
    inclusao: InclusionInput
  ): void {
    const { recovery } = this.deps
    recovery.recordInclusion(scope, releaseId, inclusao, this.now())
    if (anterior && anterior.id !== releaseId)
      recovery.inheritInclusions(scope, anterior.id, releaseId)
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
    // Projeto pausado (release degradada): nenhuma release aberta anda; só o relato das terminais.
    if (!STATUS_TERMINAIS.includes(release.status) && this.deps.recovery.activePause(scope))
      return {
        releaseId: release.id,
        state: 'blocked',
        status: release.status,
        reason: 'project-paused'
      }
    const run = this.abrirRun(scope, release, project)
    try {
      return await this.drive(run)
    } catch (erro) {
      return await this.desfecho(run, erro)
    } finally {
      this.releaseLeases(run)
    }
  }

  private abrirRun(
    scope: ReleaseScope,
    release: { readonly id: string; readonly sha: string },
    project: PromotionProject
  ): Run {
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
    return {
      scope,
      releaseId: release.id,
      project,
      effects,
      orchestrator: new ReleaseOrchestrator(this.deps.repository, effects, () => this.now()),
      leases
    }
  }

  /** Traduz o que interrompeu a execução em desfecho; só o inesperado sobe como exceção. */
  private async desfecho(run: Run, erro: unknown): Promise<PromotionOutcome> {
    if (erro instanceof Cancelar) {
      try {
        return await this.cancelNow(run)
      } catch (segundo) {
        return this.desfecho(run, segundo)
      }
    }
    if (erro instanceof Parar) return this.outcome(run, erro.outcome)
    // Lease que expirou ou passou a outro writer: este executor sai sem escrever mais nada.
    if (erro instanceof ReleaseConflictError && CONFLITOS_DE_POSSE.includes(erro.code))
      return this.outcome(run, { state: 'waiting', reason: erro.code })
    throw erro
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
      const atual = this.status(run)
      if (!STATUS_TERMINAIS.includes(atual)) this.checkpoint(run)
      switch (atual) {
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
      renew: () => {
        this.checkpoint(run)
        this.renew(run, 'production')
      },
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

  private async dormir(ms: number): Promise<void> {
    await (this.deps.sleep ?? ((espera) => new Promise<void>((r) => setTimeout(r, espera))))(ms)
  }

  /**
   * Um passo do diário, com a recuperação da SPEC-Release-05: efeito incerto é reconciliado no
   * provedor **antes** de qualquer repetição; falha transitória (e só ela) é repetida com backoff,
   * no máximo três tentativas totais por passo — o número vem do diário, então sobrevive a uma
   * retomada. Falha definitiva compensa; reconciliação sem resposta para e espera, sem compensar.
   */
  private async step(run: Run, environment: ReleaseEnvironment, step: string): Promise<void> {
    const lease = this.lease(run, environment)
    const query = this.query(run, environment)
    let reconciliacoesSemResposta = 0
    let ultimoMotivo: string | null = null
    for (;;) {
      this.checkpoint(run)
      this.renew(run, environment)
      const atual = this.deps.repository.getStep(query, step)
      if (atual && (atual.state === 'intended' || atual.state === 'ambiguous')) {
        const reconciliado = await run.orchestrator.reconcileStep(query, step, lease)
        if (reconciliado.state === 'confirmed') return
        if (reconciliado.state === 'ambiguous') {
          reconciliacoesSemResposta += 1
          if (!podeTentarDeNovo(reconciliacoesSemResposta)) {
            const motivo = ultimoMotivo ?? `${step}-unreconciled`
            this.evidence.retriesExhausted(run.scope, run.releaseId, {
              environment,
              step,
              reason: motivo,
              attempts: atual.attempt,
              state: 'ambiguous'
            })
            throw new Parar({ state: 'blocked', reason: motivo, environment, step })
          }
          await this.dormir(esperaAntesDaTentativa(reconciliacoesSemResposta + 1))
          continue
        }
        // `failed`: o provedor provou que o efeito não foi aplicado; repetir é seguro.
      }
      const feitas = this.deps.repository.getStep(query, step)?.attempt ?? 0
      if (!podeTentarDeNovo(feitas)) {
        const motivo = ultimoMotivo ?? `${step}-failed`
        this.evidence.retriesExhausted(run.scope, run.releaseId, {
          environment,
          step,
          reason: motivo,
          attempts: feitas
        })
        await this.fail(run, environment, motivo)
      }
      if (feitas > 0) {
        this.evidence.record(run.scope, run.releaseId, {
          kind: 'retry',
          state: 'pending',
          environment,
          step,
          reason: ultimoMotivo ?? `${step}-retry`,
          details: { attempt: feitas + 1 }
        })
        await this.dormir(esperaAntesDaTentativa(feitas + 1))
        this.renew(run, environment)
      }
      const resultado = await run.orchestrator.runStep(
        query,
        step,
        this.payloadHash(run, environment, step),
        lease
      )
      if (resultado.state === 'confirmed') return
      ultimoMotivo = run.effects.reason ?? ultimoMotivo
      if (resultado.state === 'ambiguous') continue
      const motivo = run.effects.reason ?? `${step}-failed`
      if (classificarFalha(motivo) === 'transient') continue
      await this.fail(run, environment, motivo)
    }
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
    const compensacao: Compensacao =
      status === 'queued' || status === 'preparing'
        ? { completo: true, motivo: null }
        : await this.compensate(run, environment)
    const terminal: ReleaseStatus = compensacao.completo ? 'failed' : 'degraded'
    run.orchestrator.transition(
      this.query(run, environment),
      terminal,
      this.lease(run, environment)
    )
    // Compensação incompleta: o projeto para (e só ele) até o operador recuperar.
    if (!compensacao.completo && compensacao.motivo)
      this.deps.recovery.pauseProject(run.scope, run.releaseId, compensacao.motivo, this.now())
    await this.devolverAV2(run, environment, reason)
    throw new Parar({ state: compensacao.completo ? 'failed' : 'degraded', reason, environment })
  }

  /**
   * Falha de código volta à V2 (regra 5). Nunca pode mascarar a falha original nem tocar a nuvem:
   * se a V2 não responde, a correção fica pendente e a retomada a reabre.
   */
  private async devolverAV2(
    run: Run,
    environment: ReleaseEnvironment,
    reason: string
  ): Promise<void> {
    if (!this.deps.correction) return
    try {
      await this.deps.correction.dispatch(run.scope, run.releaseId, { environment, reason })
    } catch {
      // A correção pendente é reaberta por `retryPending`; a falha da release já está gravada.
    }
  }

  /**
   * Volta frontend e backend do ambiente para os deployments que a pipeline provou saudáveis
   * (última release concluída). Só compensa o que o passo chegou a tentar: migration que falhou
   * antes da troca de tráfego não gera compensação (regra 6). Frontend e backend são independentes:
   * a falha de um não impede a tentativa do outro. O banco nunca é tocado.
   */
  private async compensate(run: Run, environment: ReleaseEnvironment): Promise<Compensacao> {
    const { promotion, repository } = this.deps
    const query = this.query(run, environment)
    let falhou = false
    let semBaseline = false
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
      const registrar = (state: 'compensated' | 'failed', reason: string): void =>
        this.evidence.record(run.scope, run.releaseId, {
          kind: 'compensation',
          state,
          environment,
          step: alvo.passo,
          reason
        })
      if (!anterior) {
        // Sem baseline não há como restaurar, e a versão nova segue no ar: não é "compensado".
        semBaseline = true
        promotion.finishCompensation(run.scope, run.releaseId, id, 'failed')
        registrar('failed', `${alvo.kind}-no-previous`)
        continue
      }
      try {
        await this.restaurar(environment, alvo.kind, anterior)
        promotion.finishCompensation(run.scope, run.releaseId, id, 'confirmed')
        registrar('compensated', `${alvo.kind}-restored`)
      } catch {
        falhou = true
        promotion.finishCompensation(run.scope, run.releaseId, id, 'failed')
        registrar('failed', `${alvo.kind}-restore-failed`)
      }
    }
    if (falhou) return { completo: false, motivo: 'compensation-incomplete' }
    if (semBaseline) return { completo: false, motivo: 'no-previous-release' }
    return { completo: true, motivo: null }
  }

  /** Reaponta o ambiente a um deployment que a pipeline já provou saudável. Nunca toca o banco. */
  private async restaurar(
    environment: ReleaseEnvironment,
    kind: 'frontend' | 'backend',
    deploymentId: string
  ): Promise<void> {
    if (kind === 'frontend') await this.deps.frontend.assign({ environment, deploymentId })
    else await this.deps.backend.rollback({ environment, toDeploymentId: deploymentId })
  }

  // --- cancelamento --------------------------------------------------------------------------

  /**
   * Cancelamento seguro (SPEC-Release-05, regra 3). O pedido é gravado e, se ninguém mais escreve
   * na release, cumprido já; se um executor a segura, ele o cumpre no próximo ponto seguro — depois
   * de terminar e reconciliar a operação remota corrente. Cancelar nunca mata um efeito às cegas,
   * nunca apaga evidência e nunca restaura o banco.
   */
  async cancel(
    scope: ReleaseScope,
    releaseId: string,
    project: PromotionProject
  ): Promise<CancelOutcome> {
    const release = this.deps.repository.get({ ...scope, releaseId })
    if (!release) throw new ReleaseConflictError('release-not-found', 'Release não encontrada.')
    if (STATUS_TERMINAIS.includes(release.status))
      return { releaseId, status: release.status, state: 'rejected', reason: 'already-terminal' }
    this.deps.recovery.requestCancellation(
      scope,
      releaseId,
      release.status as CancellationPhase,
      this.now()
    )
    const run = this.abrirRun(scope, release, project)
    try {
      this.lease(run, this.ambienteDaFase(release.status))
      return this.paraCancelamento(await this.cancelNow(run))
    } catch (erro) {
      if (erro instanceof ReleaseConflictError && CONFLITOS_DE_POSSE.includes(erro.code))
        return { releaseId, status: this.status(run), state: 'requested', reason: erro.code }
      throw erro
    } finally {
      this.releaseLeases(run)
    }
  }

  private paraCancelamento(resultado: PromotionOutcome): CancelOutcome {
    const { releaseId, status } = resultado
    if (resultado.state === 'blocked')
      return { releaseId, status, state: 'blocked', reason: resultado.reason }
    return {
      releaseId,
      status,
      state: resultado.state === 'failed' ? 'cancelled' : 'degraded',
      reason: null
    }
  }

  private ambienteDaFase(status: ReleaseStatus): ReleaseEnvironment {
    return status === 'production' || status === 'stabilizing' ? 'production' : 'staging'
  }

  /** Há pedido de cancelamento a cumprir? O executor olha antes de cada operação e a cada observação. */
  private checkpoint(run: Run): void {
    const pedido = this.deps.recovery.cancellation(run.scope, run.releaseId)
    if (pedido && pedido.state !== 'done') throw new Cancelar()
  }

  /**
   * Cumpre o cancelamento com os leases desta execução. A operação remota que estava em voo já
   * terminou (o executor só chega aqui entre operações); o que ficou incerto é reconciliado antes
   * de qualquer coisa, e se o provedor não responde o cancelamento fica `blocked` — reconciliável,
   * sem compensar às cegas. Depois, ambiente volta ao deployment conhecido (depois da promoção,
   * isso é o rollback para a release anterior) e a release termina `failed`, ou `degraded` se a
   * compensação não fechou. Cancelar não é falha de código: nada volta à V2.
   */
  private async cancelNow(run: Run): Promise<PromotionOutcome> {
    const { recovery, repository } = this.deps
    const inicial = this.status(run)
    const environment = this.ambienteDaFase(inicial)
    const lease = this.lease(run, environment)
    const query = this.query(run, environment)
    for (const passo of PASSOS_PRODUCAO) {
      const atual = repository.getStep(query, passo)
      if (!atual || (atual.state !== 'intended' && atual.state !== 'ambiguous')) continue
      const reconciliado = await run.orchestrator.reconcileStep(query, passo, lease)
      if (reconciliado.state === 'ambiguous') {
        recovery.finishCancellation(
          run.scope,
          run.releaseId,
          'blocked',
          'reconciliation-required',
          this.now()
        )
        this.evidence.record(run.scope, run.releaseId, {
          kind: 'cancellation',
          state: 'pending',
          environment,
          step: passo,
          reason: 'reconciliation-required',
          action: 'check-provider-status'
        })
        return this.outcome(run, {
          state: 'blocked',
          reason: 'reconciliation-required',
          environment,
          step: passo
        })
      }
    }
    if (inicial === 'queued' || inicial === 'preparing') await this.limparTemporarios(run)
    const compensacao: Compensacao =
      inicial === 'queued' || inicial === 'preparing'
        ? { completo: true, motivo: null }
        : await this.compensate(run, environment)
    const terminal: ReleaseStatus = compensacao.completo ? 'failed' : 'degraded'
    run.orchestrator.transition(query, terminal, lease)
    if (!compensacao.completo && compensacao.motivo)
      recovery.pauseProject(run.scope, run.releaseId, compensacao.motivo, this.now())
    recovery.finishCancellation(run.scope, run.releaseId, 'done', null, this.now())
    this.evidence.record(run.scope, run.releaseId, {
      kind: 'cancellation',
      state: 'confirmed',
      environment,
      reason: 'cancelled',
      details: { phase: inicial }
    })
    return this.outcome(run, {
      state: compensacao.completo ? 'failed' : 'degraded',
      reason: 'cancelled',
      environment
    })
  }

  /** Limpeza dos recursos temporários da preparação. Falhar vira pendência, não impede cancelar. */
  private async limparTemporarios(run: Run): Promise<void> {
    if (!this.deps.build.cleanup) return
    try {
      await this.deps.build.cleanup({ scope: run.scope, releaseId: run.releaseId })
    } catch {
      this.evidence.record(run.scope, run.releaseId, {
        kind: 'cancellation',
        state: 'pending',
        reason: 'cleanup-failed',
        action: 'clean-temporary-resources'
      })
    }
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
          await this.restaurar('production', alvoDeploy.kind, alvoDeploy.id)
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
        await this.restaurar(alvo.environment, alvo.kind, alvo.id)
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
