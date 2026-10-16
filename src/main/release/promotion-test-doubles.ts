import type { ReleaseEnvironment } from '@shared/domain/release'
import type { MigrationOutcome } from './database-migration-runner'
import {
  PromotionProviderError,
  type PromotionBackendPort,
  type PromotionBuildPort,
  type PromotionDatabasePort,
  type PromotionFrontendPort,
  type PromotionGateOutcome,
  type PromotionProviderErrorCode,
  type PromotionVerifierPort
} from './promotion-ports'
import { createHash } from 'node:crypto'
import type { ReleaseGitPort } from './release-publisher'
import type { ReleaseLocalRepository } from './release-local-repository'

/**
 * Nuvem falsa com estado de verdade para a promoção: Staging e Produção são mundos separados
 * (backend, banco e frontend atribuído), então um defeito de isolamento — rebuild entre
 * ambientes, banco cruzado, frontend ligado ao backend errado — aparece como asserção quebrada,
 * não como mock que responde igual a tudo. Falha é injetada por operação (`backend.deploy`) ou
 * por operação e ambiente (`backend.deploy:production`).
 */

export class FakeClock {
  constructor(private ms = Date.parse('2026-10-14T12:00:00.000Z')) {}

  now = (): string => new Date(this.ms).toISOString()
  nowMs = (): number => this.ms
  /** O tempo só passa quando alguém dorme: o teste decide, sem timer real. */
  sleep = async (duration: number): Promise<void> => {
    this.ms += duration
  }
}

interface Fault {
  readonly code: PromotionProviderErrorCode | 'ambiguous'
  remaining: number
}

/** Quando a falha acontece em relação ao efeito: antes (não aplicou) ou depois (aplicou e perdeu a resposta). */
type FaultTiming = 'before' | 'after'

interface FakeBackend {
  readonly deploymentId: string
  readonly digest: string
}

/** Os checksums das migrations do harness: o banco falso os devolve como o banco real faria. */
const CHECKSUM_DA_MIGRATION: Readonly<Record<string, string>> = {
  '001_init': '1'.repeat(64),
  '002_users': '2'.repeat(64)
}

const BACKEND_URL: Readonly<Record<ReleaseEnvironment, string>> = {
  staging: 'https://api-staging.up.railway.app',
  production: 'https://api.up.railway.app'
}

export class FakePromotionCloud {
  readonly calls: string[] = []
  readonly backends = new Map<ReleaseEnvironment, FakeBackend>()
  /** Todo deployment de backend que já existiu, na ordem: a base da compensação. */
  readonly backendHistory: {
    environment: ReleaseEnvironment
    deploymentId: string
    digest: string
  }[] = []
  readonly frontendBuilds = new Map<string, string>()
  readonly frontendAssigned = new Map<ReleaseEnvironment, string>()
  readonly databases = new Map<ReleaseEnvironment, string[]>()
  readonly backups: { environment: ReleaseEnvironment; backupRef: string }[] = []
  /** Quantas imagens foram construídas: rebuild entre ambientes seria visto aqui. */
  builds = 0
  /** Ambientes cujo smoke e E2E essencial falham mesmo com backend e frontend saudáveis. */
  readonly smokeFails = new Set<ReleaseEnvironment>()
  /** O frontend deste ambiente resolve o backend do OUTRO: defeito de fiação a ser barrado. */
  crossWired: ReleaseEnvironment | null = null
  migrationOutcome: MigrationOutcome | null = null
  private readonly faults = new Map<string, Fault>()
  private readonly faultsAfter = new Map<string, Fault>()
  private readonly healthScript = new Map<ReleaseEnvironment, boolean[]>()
  private sequence = 0

  /** Faz a operação falhar `times` vezes seguidas; `ambiguous` simula timeout (efeito incerto). */
  failOn(operation: string, code: Fault['code'] = 'failed', times = 1): void {
    this.faults.set(operation, { code, remaining: times })
  }

  /**
   * Faz a operação **aplicar o efeito** e só então falhar: o provedor fez o trabalho e a resposta
   * se perdeu. É o caso que `failOn` não alcança e que o retry não pode duplicar.
   */
  failAfter(operation: string, code: Fault['code'] = 'timeout', times = 1): void {
    this.faultsAfter.set(operation, { code, remaining: times })
  }

  /** Respostas de `backend_health` do ambiente, consumidas na ordem; depois disso, saudável. */
  scriptHealth(environment: ReleaseEnvironment, answers: boolean[]): void {
    this.healthScript.set(environment, [...answers])
  }

  private enter(operation: string, environment?: ReleaseEnvironment): void {
    this.calls.push(environment ? `${operation}:${environment}` : operation)
    this.dispararFalha('before', operation, environment)
  }

  /** Chamada depois do efeito: lança se `failAfter` foi armado para a operação. */
  private leave(operation: string, environment?: ReleaseEnvironment): void {
    this.dispararFalha('after', operation, environment)
  }

  private dispararFalha(
    quando: FaultTiming,
    operation: string,
    environment?: ReleaseEnvironment
  ): void {
    const mapa = quando === 'before' ? this.faults : this.faultsAfter
    for (const chave of [environment ? `${operation}:${environment}` : null, operation]) {
      const fault = chave ? mapa.get(chave) : undefined
      if (fault && fault.remaining > 0) {
        fault.remaining -= 1
        if (fault.code === 'ambiguous') throw new Error('timeout sem resposta')
        throw new PromotionProviderError(fault.code, `falha injetada em ${chave}`)
      }
    }
  }

  readonly backend: PromotionBackendPort = {
    deploy: async ({ environment, imageUri }) => {
      this.enter('backend.deploy', environment)
      const digest = imageUri.slice(imageUri.indexOf('@') + 1)
      const atual = this.backends.get(environment)
      if (atual?.digest === digest) {
        this.leave('backend.deploy', environment)
        return { deploymentId: atual.deploymentId }
      }
      this.sequence += 1
      const deploymentId = `rw-${environment}-${this.sequence}`
      this.backends.set(environment, { deploymentId, digest })
      this.backendHistory.push({ environment, deploymentId, digest })
      this.leave('backend.deploy', environment)
      return { deploymentId }
    },
    rollback: async ({ environment, toDeploymentId }) => {
      this.enter('backend.rollback', environment)
      const anterior = this.backendHistory.find(
        (b) => b.environment === environment && b.deploymentId === toDeploymentId
      )
      if (!anterior) throw new PromotionProviderError('not-found', 'deployment desconhecido')
      this.backends.set(environment, {
        deploymentId: anterior.deploymentId,
        digest: anterior.digest
      })
      this.leave('backend.rollback', environment)
    },
    current: async (environment) => {
      this.enter('backend.current', environment)
      return this.backends.get(environment) ?? null
    }
  }

  readonly database: PromotionDatabasePort = {
    backup: async ({ environment }) => {
      this.enter('database.backup', environment)
      const backupRef = `bkp-${environment}-${this.backups.length + 1}`
      this.backups.push({ environment, backupRef })
      this.leave('database.backup', environment)
      return { backupRef }
    },
    applied: async ({ environment }) => {
      this.enter('database.applied', environment)
      return (this.databases.get(environment) ?? []).map((id) => ({
        id,
        checksum: CHECKSUM_DA_MIGRATION[id] ?? 'f'.repeat(64)
      }))
    },
    migrate: async ({ environment, migrations }) => {
      this.enter('database.migrate', environment)
      if (this.migrationOutcome) return this.migrationOutcome
      const aplicadas = this.databases.get(environment) ?? []
      const novas = migrations.filter((m) => !aplicadas.includes(m.id)).map((m) => m.id)
      this.databases.set(environment, [...aplicadas, ...novas])
      this.leave('database.migrate', environment)
      return {
        state: 'confirmed',
        applied: novas,
        skipped: aplicadas,
        seedApplied: false,
        fingerprint: 'f'.repeat(64)
      }
    }
  }

  readonly frontend: PromotionFrontendPort = {
    build: async ({ releaseId, sourceSha }) => {
      this.enter('frontend.build')
      const chave = `${releaseId}:${sourceSha}`
      const existente = this.frontendBuilds.get(chave)
      if (existente) {
        this.leave('frontend.build')
        return { deploymentId: existente }
      }
      this.sequence += 1
      const deploymentId = `dpl_fe${this.sequence}`
      this.frontendBuilds.set(chave, deploymentId)
      this.leave('frontend.build')
      return { deploymentId }
    },
    assign: async ({ environment, deploymentId }) => {
      this.enter('frontend.assign', environment)
      this.frontendAssigned.set(environment, deploymentId)
      this.leave('frontend.assign', environment)
    },
    current: async (environment) => {
      this.enter('frontend.current', environment)
      return this.frontendAssigned.get(environment) ?? null
    }
  }

  /** Confere o estado de verdade de cada ambiente: digest servido, frontend atribuído e fiação. */
  readonly verifier: PromotionVerifierPort = {
    verify: async ({ environment, checks, backendDigest, frontendDeploymentId }) => {
      this.enter('verifier.verify', environment)
      const backend = this.backends.get(environment)
      // O roteiro de saúde só avança quando a verificação pede `backend_health`.
      const roteiro = this.healthScript.get(environment)
      const respondeu =
        checks.includes('backend_health') && roteiro && roteiro.length > 0 ? roteiro.shift()! : true
      const saudavel = respondeu && backend?.digest === backendDigest
      const atribuido = this.frontendAssigned.get(environment) === frontendDeploymentId
      const fiado = atribuido && this.crossWired !== environment
      const resposta = (
        gate: PromotionGateOutcome['gate'],
        ok: boolean,
        reason: string
      ): PromotionGateOutcome =>
        ok ? { gate, result: 'passed' } : { gate, result: 'blocked', reason }
      return checks.map((gate) => {
        if (gate === 'backend_health') return resposta(gate, saudavel, 'health-down')
        if (gate === 'frontend_wiring') return resposta(gate, fiado, 'frontend-wiring')
        return resposta(
          gate,
          saudavel && fiado && !this.smokeFails.has(environment),
          `${gate}-failed`
        )
      })
    }
  }

  buildPort(local: ReleaseLocalRepository): PromotionBuildPort {
    return {
      cleanup: async () => {
        this.enter('build.cleanup')
      },
      build: async ({ scope, releaseId, sourceSha }) => {
        this.enter('build.backend')
        const digest = `sha256:${sourceSha.slice(0, 8).padEnd(64, '0')}`
        const existente = local.getArtifact(scope, releaseId, 'backend-image')
        if (existente?.uri) return { state: 'built', imageUri: existente.uri, digest }
        this.builds += 1
        const imageUri = `ghcr.io/dono/app@${digest}`
        local.recordArtifact(scope, releaseId, {
          kind: 'backend-image',
          uri: imageUri,
          digest,
          provenance: {
            transport: 'docker-cli',
            buildType: 'https://github.com/moby/buildkit/slsa',
            builderId: 'fake-builder',
            provenanceDigest: `sha256:${'b'.repeat(64)}`
          }
        })
        return { state: 'built', imageUri, digest }
      }
    }
  }

  /** URL pública do backend de um ambiente, para os testes que conferem a fiação. */
  static backendUrl(environment: ReleaseEnvironment): string {
    return BACKEND_URL[environment]
  }
}

/**
 * GitHub falso com estado: tags e releases existem de verdade (commit e texto), então publicar
 * duas vezes, publicar numa tag de outro commit ou editar as notas aparece como asserção quebrada.
 * `failOn` lança antes do efeito e `failAfter` depois dele (a resposta se perdeu).
 */
export class FakeGitHubReleases {
  readonly calls: string[] = []
  readonly tags = new Map<string, { commitSha: string; notes: string | null; title: string }>()
  private readonly faults = new Map<
    string,
    { code: PromotionProviderErrorCode; remaining: number }
  >()
  private readonly faultsAfter = new Map<
    string,
    { code: PromotionProviderErrorCode; remaining: number }
  >()

  failOn(operation: 'find' | 'publish', code: PromotionProviderErrorCode, times = 1): void {
    this.faults.set(operation, { code, remaining: times })
  }

  failAfter(operation: 'publish', code: PromotionProviderErrorCode = 'timeout', times = 1): void {
    this.faultsAfter.set(operation, { code, remaining: times })
  }

  private disparar(
    mapa: Map<string, { code: PromotionProviderErrorCode; remaining: number }>,
    operation: string
  ): void {
    const fault = mapa.get(operation)
    if (fault && fault.remaining > 0) {
      fault.remaining -= 1
      throw new PromotionProviderError(fault.code, `falha injetada em ${operation}`)
    }
  }

  readonly port: ReleaseGitPort = {
    find: async (tag) => {
      this.calls.push(`find:${tag}`)
      this.disparar(this.faults, 'find')
      const achada = this.tags.get(tag)
      return achada
        ? {
            commitSha: achada.commitSha,
            notesSha256:
              achada.notes === null ? null : createHash('sha256').update(achada.notes).digest('hex')
          }
        : null
    },
    publish: async ({ tag, sha, title, notes }) => {
      this.calls.push(`publish:${tag}`)
      this.disparar(this.faults, 'publish')
      this.tags.set(tag, { commitSha: this.tags.get(tag)?.commitSha ?? sha, notes, title })
      this.disparar(this.faultsAfter, 'publish')
    }
  }
}
