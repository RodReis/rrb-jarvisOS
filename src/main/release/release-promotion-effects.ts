import { createHash } from 'node:crypto'
import type { ReleaseEnvironment, ReleaseScope } from '@shared/domain/release'
import type { JanelaDeEstabilizacao } from '@shared/domain/release-promotion'
import { validarReferencias, type ConfigurationProbe } from './configuration-reference-validator'
import type { MigrationFile } from './database-migration-runner'
import {
  PromotionProviderError,
  type PromotionBackendPort,
  type PromotionBuildPort,
  type PromotionCheck,
  type PromotionDatabasePort,
  type PromotionFrontendPort,
  type PromotionVerifierPort
} from './promotion-ports'
import type { ReleaseGateEngine } from './release-gate-engine'
import type { ReleaseLocalRepository } from './release-local-repository'
import type { ReleasePromotionRepository } from './release-promotion-repository'
import type {
  ReleaseEffectRequest,
  ReleasePort,
  ReleaseReconciliationRequest
} from './release-orchestrator'

/**
 * Efeitos de cada passo do diário (SPEC-Release-04). Implementa o `ReleasePort` da F01: o
 * `ReleaseOrchestrator` decide idempotência, lease e "ambíguo nunca repete"; aqui está o que cada
 * passo faz de verdade, chamando só as portas. Resultado definitivo → `failed` (e o gate leva o
 * código do motivo); resultado de efeito incerto (timeout, exceção desconhecida) → `ambiguous`.
 */

export interface PromotionProject {
  readonly migrations: readonly MigrationFile[]
  readonly configuration: {
    readonly names: readonly string[]
    /** Chaves que não podem ter o mesmo valor em Staging e Produção (decisão 4 do PI). */
    readonly isolated: readonly string[]
    /**
     * Lê a configuração dos dois ambientes **agora**. É chamada a cada `prepared`: Produção
     * revalida minutos depois de Staging, e uma rotação nesse intervalo muda o fingerprint.
     */
    readonly load: () => Promise<ConfigurationProbe>
  }
  /** Janela, intervalo e reinícios da estabilização; ausente = padrão (5 min, 30 s, 1 reinício). */
  readonly stabilization?: JanelaDeEstabilizacao
}

export interface PromotionEffectsDeps {
  readonly scope: ReleaseScope
  readonly releaseId: string
  readonly sourceSha: string
  readonly project: PromotionProject
  readonly promotion: ReleasePromotionRepository
  readonly local: ReleaseLocalRepository
  readonly gates: ReleaseGateEngine
  readonly build: PromotionBuildPort
  readonly backend: PromotionBackendPort
  readonly database: PromotionDatabasePort
  readonly frontend: PromotionFrontendPort
  readonly verifier: PromotionVerifierPort
  readonly now: () => string
  /** Lease do writer do ambiente de Staging, entregue à preparação do build. */
  readonly leaseId: () => string
}

const sha256 = (texto: string): string => createHash('sha256').update(texto).digest('hex')
/** Digest do deployment do frontend: a Vercel não tem artefato OCI, então a identidade é o hash do id. */
export const digestDoFrontend = (deploymentId: string): string => `sha256:${sha256(deploymentId)}`

function codigoDe(erro: unknown): string {
  return erro instanceof PromotionProviderError ? erro.code : 'unknown'
}

/** Só `timeout` e exceção desconhecida deixam o efeito incerto; o resto é recusa definitiva. */
function incerto(erro: unknown): boolean {
  return !(erro instanceof PromotionProviderError) || erro.code === 'timeout'
}

export class PromotionEffects implements ReleasePort {
  /** Código do último motivo de falha, para o serviço levar ao desfecho. Nunca texto de provedor. */
  reason: string | null = null

  constructor(private readonly deps: PromotionEffectsDeps) {}

  async execute(request: ReleaseEffectRequest): Promise<'confirmed' | 'ambiguous' | 'failed'> {
    this.reason = null
    try {
      return await this.dispatch(request.environment, request.step)
    } catch (erro) {
      this.reason = `${request.step}-${codigoDe(erro)}`
      return incerto(erro) ? 'ambiguous' : 'failed'
    }
  }

  async reconcile(
    request: ReleaseReconciliationRequest
  ): Promise<'applied' | 'not-applied' | 'unknown'> {
    const { environment: env } = request
    if (request.step === 'smoke_passed') return 'not-applied' // só leitura: repetir é seguro
    // "Aplicado" só vale com o gate registrado: reconciliar não pode pular a verificação do passo.
    if (request.step === 'backend_healthy') {
      const atual = await this.deps.backend.current(env)
      if (atual?.digest !== this.backendDigest()) return 'not-applied'
      this.registrarBackend(env, atual.deploymentId)
      return (await this.verificar(env, ['backend_health'])) === 'confirmed'
        ? 'applied'
        : 'not-applied'
    }
    if (request.step === 'frontend_promoted') {
      if ((await this.deps.frontend.current(env)) !== this.frontendId()) return 'not-applied'
      return (await this.verificar(env, ['frontend_wiring'])) === 'confirmed'
        ? 'applied'
        : 'not-applied'
    }
    if (request.step === 'database_migrated') return this.reconciliarMigration(env)
    if (request.step === 'prepared') return this.reconciliarPreparacao(env)
    return 'unknown'
  }

  /**
   * `prepared` só tem efeito remoto em Staging (build, imagem, deployment do frontend), e todos
   * são idempotentes por release: o que está gravado prova o que existe. Artefato e os dois
   * deployments registrados = aplicado; qualquer um faltando = repetir é seguro, porque build e
   * frontend reconhecem o que já fizeram. Em Produção o passo é só leitura de configuração.
   */
  private reconciliarPreparacao(env: ReleaseEnvironment): 'applied' | 'not-applied' {
    if (env === 'production') return 'not-applied'
    const { scope, releaseId, local, promotion } = this.deps
    const artefato = local.getArtifact(scope, releaseId, 'backend-image')
    const frontends = (['staging', 'production'] as const).every(
      (ambiente) => promotion.getDeployment(scope, releaseId, ambiente, 'frontend') !== null
    )
    return artefato?.uri && frontends ? 'applied' : 'not-applied'
  }

  /**
   * Pergunta ao PostgreSQL do ambiente, em vez de presumir: todas as migrations do projeto com o
   * checksum esperado = aplicado (e o gate que a resposta perdida deixou sem registro é gravado
   * agora); qualquer ausência ou checksum diferente = não aplicado, e a repetição completa o que
   * falta ou recusa de forma definitiva. Leitura que falha lança → sem resposta, nunca "repete".
   */
  private async reconciliarMigration(env: ReleaseEnvironment): Promise<'applied' | 'not-applied'> {
    const { scope, releaseId, promotion, database, project } = this.deps
    const aplicadas = await database.applied({ environment: env })
    const todas = project.migrations.every((m) =>
      aplicadas.some((a) => a.id === m.id && a.checksum === m.checksum)
    )
    if (!todas) return 'not-applied'
    for (const m of project.migrations)
      promotion.recordMigration(
        scope,
        releaseId,
        { environment: env, migrationId: m.id, checksum: m.checksum, state: 'confirmed' },
        this.deps.now()
      )
    this.gate(env, 'migration', true, '')
    return 'applied'
  }

  private async dispatch(env: ReleaseEnvironment, step: string): Promise<'confirmed' | 'failed'> {
    switch (step) {
      case 'prepared':
        return this.prepare(env)
      case 'database_migrated':
        return this.migrate(env)
      case 'backend_healthy':
        return this.deployBackend(env)
      case 'frontend_promoted':
        return this.promoteFrontend(env)
      case 'smoke_passed':
        return this.smoke(env)
      default:
        this.reason = `${step}-unknown-step`
        return 'failed'
    }
  }

  private gate(env: ReleaseEnvironment, gate: string, ok: boolean, reason: string): void {
    const { scope, releaseId } = this.deps
    this.deps.gates.record(scope, releaseId, env, {
      gate,
      result: ok ? 'passed' : 'blocked',
      ...(ok ? {} : { reason })
    })
  }

  private falhar(reason: string): 'failed' {
    this.reason = reason
    return 'failed'
  }

  // --- prepared -----------------------------------------------------------------------------

  private async prepare(env: ReleaseEnvironment): Promise<'confirmed' | 'failed'> {
    const config = await this.validarConfiguracao(env)
    if (config) return this.falhar(config)
    // Produção reaproveita o artefato e o frontend já construídos para Staging: nada é refeito.
    if (env === 'production') return 'confirmed'

    const { scope, releaseId, sourceSha } = this.deps
    const construido = await this.deps.build.build({
      scope,
      releaseId,
      sourceSha,
      leaseId: this.deps.leaseId()
    })
    if (construido.state === 'blocked') return this.falhar(`build-${construido.reason}`)
    const frontend = await this.deps.frontend.build({ releaseId, sourceSha })
    // O deployment imutável é gravado nos dois ambientes com o mesmo id: é o que a Produção promove.
    for (const ambiente of ['staging', 'production'] as const)
      this.deps.promotion.recordDeployment(
        scope,
        releaseId,
        {
          environment: ambiente,
          kind: 'frontend',
          artifactDigest: digestDoFrontend(frontend.deploymentId),
          externalId: frontend.deploymentId,
          replacesExternalId:
            this.deps.promotion.lastKnownDeployment(scope, ambiente, 'frontend', releaseId)
              ?.externalId ?? null
        },
        this.deps.now()
      )
    return 'confirmed'
  }

  /**
   * Config ausente ou chave de isolamento compartilhada bloqueia **antes do efeito**: nenhuma
   * porta de build, banco ou deploy é chamada. A validação cobre os dois ambientes porque o
   * isolamento só se prova olhando os dois.
   */
  private async validarConfiguracao(env: ReleaseEnvironment): Promise<string | null> {
    const { names, isolated, load } = this.deps.project.configuration
    let resultado: ReturnType<typeof validarReferencias>
    try {
      resultado = validarReferencias({
        nomes: names,
        ambientes: ['staging', 'production'],
        probe: await load(),
        isoladas: isolated
      })
    } catch {
      this.gate(env, 'configuration', false, 'config-unreadable')
      return 'config-unreadable'
    }
    this.deps.local.saveConfigurationReferences(
      this.deps.scope,
      this.deps.releaseId,
      resultado.referencias
    )
    if (resultado.ok) {
      this.gate(env, 'configuration', true, '')
      return null
    }
    const motivo = resultado.bloqueios.some((b) => b.reason === 'missing')
      ? 'config-missing'
      : 'config-shared-value'
    this.gate(env, 'configuration', false, motivo)
    return motivo
  }

  // --- database_migrated -------------------------------------------------------------------

  private async migrate(env: ReleaseEnvironment): Promise<'confirmed' | 'failed'> {
    const { scope, releaseId, promotion, database, project } = this.deps
    let backupRef: string | undefined
    if (env === 'production') {
      // Backup confirmado precede a migration: sem ele, nem a intenção da migration é gravada.
      try {
        backupRef = (await database.backup({ environment: env })).backupRef
      } catch (erro) {
        this.gate(env, 'backup', false, `backup-${codigoDe(erro)}`)
        throw erro
      }
      this.gate(env, 'backup', true, '')
    }
    for (const m of project.migrations)
      promotion.recordMigration(
        scope,
        releaseId,
        { environment: env, migrationId: m.id, checksum: m.checksum, state: 'intended', backupRef },
        this.deps.now()
      )
    let resultado: Awaited<ReturnType<PromotionDatabasePort['migrate']>>
    try {
      resultado = await database.migrate({ environment: env, migrations: project.migrations })
    } catch (erro) {
      // Recusa definitiva: nada ficou "em andamento". Só o efeito incerto mantém a intenção.
      if (!incerto(erro)) {
        this.registrarMigrations(env, new Set(), 'failed')
        this.gate(env, 'migration', false, `migration-${codigoDe(erro)}`)
      }
      throw erro
    }
    if (resultado.state === 'failed') {
      this.registrarMigrations(env, new Set(resultado.applied), 'failed')
      this.gate(env, 'migration', false, resultado.reason)
      return this.falhar(resultado.reason)
    }
    for (const m of project.migrations)
      promotion.recordMigration(
        scope,
        releaseId,
        { environment: env, migrationId: m.id, checksum: m.checksum, state: 'confirmed' },
        this.deps.now()
      )
    this.gate(env, 'migration', true, '')
    return 'confirmed'
  }

  /** As aplicadas ficam `confirmed`; o resto da intenção grava o estado informado (nada fica preso). */
  private registrarMigrations(
    env: ReleaseEnvironment,
    aplicadas: ReadonlySet<string>,
    restante: 'failed'
  ): void {
    const { scope, releaseId, promotion, project } = this.deps
    for (const m of project.migrations)
      promotion.recordMigration(
        scope,
        releaseId,
        {
          environment: env,
          migrationId: m.id,
          checksum: m.checksum,
          state: aplicadas.has(m.id) ? 'confirmed' : restante
        },
        this.deps.now()
      )
  }

  // --- backend_healthy ---------------------------------------------------------------------

  private backendDigest(): string {
    const artefato = this.deps.local.getArtifact(
      this.deps.scope,
      this.deps.releaseId,
      'backend-image'
    )
    if (!artefato?.uri) throw new PromotionProviderError('incompatible-state', 'sem artefato')
    return artefato.digest
  }

  private registrarBackend(env: ReleaseEnvironment, externalId: string): void {
    const { scope, releaseId, promotion } = this.deps
    promotion.recordDeployment(
      scope,
      releaseId,
      {
        environment: env,
        kind: 'backend',
        artifactDigest: this.backendDigest(),
        externalId,
        replacesExternalId:
          promotion.lastKnownDeployment(scope, env, 'backend', releaseId)?.externalId ?? null
      },
      this.deps.now()
    )
  }

  private async deployBackend(env: ReleaseEnvironment): Promise<'confirmed' | 'failed'> {
    const { scope, releaseId, sourceSha } = this.deps
    const artefato = this.deps.local.getArtifact(scope, releaseId, 'backend-image')
    if (!artefato?.uri) return this.falhar('backend_healthy-no-artifact')
    const { deploymentId } = await this.deps.backend.deploy({
      environment: env,
      imageUri: artefato.uri,
      releaseId,
      sourceSha
    })
    this.registrarBackend(env, deploymentId)
    return this.verificar(env, ['backend_health'])
  }

  // --- frontend_promoted -------------------------------------------------------------------

  private frontendId(): string {
    const linha = this.deps.promotion.getDeployment(
      this.deps.scope,
      this.deps.releaseId,
      'staging',
      'frontend'
    )
    if (!linha) throw new PromotionProviderError('incompatible-state', 'sem frontend construído')
    return linha.externalId
  }

  private async promoteFrontend(env: ReleaseEnvironment): Promise<'confirmed' | 'failed'> {
    await this.deps.frontend.assign({ environment: env, deploymentId: this.frontendId() })
    return this.verificar(env, ['frontend_wiring'])
  }

  // --- smoke_passed ------------------------------------------------------------------------

  private smoke(env: ReleaseEnvironment): Promise<'confirmed' | 'failed'> {
    return this.verificar(env, env === 'staging' ? ['smoke', 'e2e_essential'] : ['smoke'])
  }

  private async verificar(
    env: ReleaseEnvironment,
    checks: readonly PromotionCheck[]
  ): Promise<'confirmed' | 'failed'> {
    const resultados = await this.deps.verifier.verify({
      environment: env,
      checks,
      backendDigest: this.backendDigest(),
      frontendDeploymentId: this.frontendId()
    })
    let ok = true
    for (const gate of checks) {
      const r = resultados.find((x) => x.gate === gate)
      const passou = r?.result === 'passed'
      if (!passou) {
        ok = false
        this.reason ??= r?.reason ?? `${gate}-unknown`
      }
      this.gate(env, gate, passou, r?.reason ?? `${gate}-unknown`)
    }
    return ok ? 'confirmed' : 'failed'
  }
}
