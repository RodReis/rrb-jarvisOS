import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import type { Artifact, ReleaseScope } from '@shared/domain/release'
import type { ReleaseLease } from './release-repository'
import type {
  ComposeBlockCode,
  ComposePorts,
  ComposeProfile
} from './adapters/local-compose-adapter'
import type {
  ArtifactRegistryErrorCode,
  PublishInput,
  RegistryArtifact
} from './adapters/ghcr-artifact-adapter'
import {
  fingerprintDeConfiguracao,
  lerNomesDoExemplo,
  validarReferencias
} from './configuration-reference-validator'
import {
  DatabaseMigrationRunner,
  lerMigrations,
  type MigrationFailure,
  type SqlExecutor
} from './database-migration-runner'
import type { ReleaseLocalRepository } from './release-local-repository'

/**
 * Preparação local de uma release (SPEC-Release-02): configuração → Docker → banco → migration e
 * seed → **publicação única** do backend → o publicado rodando no Compose → verificação →
 * limpeza do que é do lease. A ordem é a da regra 4: migration quebrada interrompe antes de
 * qualquer candidato utilizável existir. Todo efeito entra no diário (intenção, depois resultado)
 * com transporte e hash de evidência; nada daqui carrega valor de chave ou saída de comando.
 */

export interface ComposeEnvironmentPort {
  readonly ports: ComposePorts
  readonly sql: SqlExecutor
  upDatabase(): Promise<void>
  upApplication(backendImage: string): Promise<void>
  verify(): Promise<void>
}

export interface ComposePort {
  open(profile: ComposeProfile, leaseId: string): Promise<ComposeEnvironmentPort>
  cleanup(leaseId: string): Promise<{ containers: number; networks: number; volumes: number }>
}

export interface RegistryPort {
  publish(input: PublishInput): Promise<RegistryArtifact>
  resolve(uri: string): Promise<RegistryArtifact>
}

export interface PreparationProject {
  readonly profile: ComposeProfile
  readonly migrationsDir: string
  readonly seedFile?: string
  readonly envExampleFile: string
  readonly envLocalFile: string
  /** `ghcr.io/<dono>/<imagem>`: onde o backend é publicado. */
  readonly repository: string
  readonly contextDir: string
  readonly sourceSha: string
  readonly readableTag?: string
}

export type PreparationBlock =
  'configuration-missing' | ComposeBlockCode | MigrationFailure | ArtifactRegistryErrorCode

export type PreparationOutcome =
  | {
      readonly state: 'prepared'
      readonly artifact: Artifact
      readonly fingerprint: string
      readonly ports: ComposePorts
      /** `true` quando o candidato já existia e não houve novo build. */
      readonly reused: boolean
      readonly cleanup: 'done' | 'pending'
    }
  | {
      readonly state: 'blocked'
      readonly reason: PreparationBlock
      readonly missing?: readonly { name: string; environment: 'local' }[]
    }

const DOCKER_CLI = 'docker-cli'
const sha256 = (texto: string): string =>
  `sha256:${createHash('sha256').update(texto).digest('hex')}`

/** `.env.local` → nome → valor. O valor só é lido aqui, para virar fingerprint. */
function lerEnvLocal(arquivo: string): Map<string, string> {
  const valores = new Map<string, string>()
  if (!existsSync(arquivo)) return valores
  for (const linha of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const igual = linha.indexOf('=')
    if (igual < 1 || linha.trimStart().startsWith('#')) continue
    const valor = linha
      .slice(igual + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2')
    if (valor) valores.set(linha.slice(0, igual).trim(), valor)
  }
  return valores
}

function codigoDe(erro: unknown): PreparationBlock {
  const codigo = (erro as { code?: unknown } | null)?.code
  return typeof codigo === 'string' ? (codigo as PreparationBlock) : 'compose-failed'
}

export class ReleasePreparationService {
  constructor(
    private readonly repo: ReleaseLocalRepository,
    private readonly compose: ComposePort,
    private readonly registry: RegistryPort,
    private readonly fingerprintKey: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async prepare(
    scope: ReleaseScope,
    releaseId: string,
    lease: ReleaseLease,
    projeto: PreparationProject
  ): Promise<PreparationOutcome> {
    const bloqueio = this.validarConfiguracao(scope, releaseId, projeto)
    if (bloqueio) return bloqueio

    this.efeito(scope, releaseId, { kind: 'compose', phase: 'intended', transport: DOCKER_CLI })
    let env: ComposeEnvironmentPort
    try {
      env = await this.compose.open(projeto.profile, lease.leaseId)
    } catch (erro) {
      return this.bloquear(scope, releaseId, 'compose', codigoDe(erro))
    }

    let resultado: PreparationOutcome
    try {
      resultado = await this.preparar(scope, releaseId, projeto, env)
    } catch (erro) {
      resultado = this.bloquear(scope, releaseId, 'compose', codigoDe(erro))
    }
    return this.limpar(scope, releaseId, lease.leaseId, resultado)
  }

  private validarConfiguracao(
    scope: ReleaseScope,
    releaseId: string,
    projeto: PreparationProject
  ): PreparationOutcome | null {
    this.efeito(scope, releaseId, {
      kind: 'configuration',
      phase: 'intended',
      transport: 'env-file'
    })
    const valores = lerEnvLocal(projeto.envLocalFile)
    const validacao = validarReferencias({
      nomes: lerNomesDoExemplo(readFileSync(projeto.envExampleFile, 'utf8')),
      ambientes: ['local'],
      probe: (_ambiente, nome) => {
        const valor = valores.get(nome)
        return valor === undefined
          ? { present: false }
          : {
              present: true,
              fingerprint: fingerprintDeConfiguracao(this.fingerprintKey, nome, valor)
            }
      }
    })
    this.repo.saveConfigurationReferences(scope, releaseId, validacao.referencias)
    if (!validacao.ok) {
      this.efeito(scope, releaseId, {
        kind: 'configuration',
        phase: 'failed',
        transport: 'env-file',
        reason: 'configuration-missing'
      })
      return {
        state: 'blocked',
        reason: 'configuration-missing',
        missing: validacao.bloqueios.map((b) => ({ name: b.name, environment: 'local' as const }))
      }
    }
    this.efeito(scope, releaseId, {
      kind: 'configuration',
      phase: 'confirmed',
      transport: 'env-file',
      evidenceHash: sha256(
        validacao.referencias.map((r) => `${r.environment}:${r.name}:${r.fingerprint}`).join('\n')
      )
    })
    return null
  }

  private async preparar(
    scope: ReleaseScope,
    releaseId: string,
    projeto: PreparationProject,
    env: ComposeEnvironmentPort
  ): Promise<PreparationOutcome> {
    await env.upDatabase()

    this.efeito(scope, releaseId, { kind: 'migration', phase: 'intended', transport: DOCKER_CLI })
    const migracao = await new DatabaseMigrationRunner(env.sql).apply({
      database: 'release',
      migrations: lerMigrations(projeto.migrationsDir),
      seed: projeto.seedFile ? readFileSync(projeto.seedFile, 'utf8') : undefined
    })
    if (migracao.state === 'failed')
      return this.bloquear(scope, releaseId, 'migration', migracao.reason)
    this.efeito(scope, releaseId, {
      kind: 'migration',
      phase: 'confirmed',
      transport: DOCKER_CLI,
      evidenceHash: `sha256:${migracao.fingerprint}`
    })

    const existente = this.repo.getArtifact(scope, releaseId, 'backend-image')
    const publicado = existente?.uri
      ? await this.confirmarExistente(scope, releaseId, existente)
      : await this.publicar(scope, releaseId, projeto)
    if ('state' in publicado) return publicado

    await env.upApplication(publicado.artifact.uri as string)
    await env.verify()
    this.efeito(scope, releaseId, {
      kind: 'compose',
      phase: 'confirmed',
      transport: DOCKER_CLI,
      digest: publicado.artifact.digest,
      evidenceHash: sha256(JSON.stringify(env.ports))
    })
    return {
      state: 'prepared',
      artifact: publicado.artifact,
      fingerprint: migracao.fingerprint,
      ports: env.ports,
      reused: publicado.reused,
      cleanup: 'done'
    }
  }

  private async confirmarExistente(
    scope: ReleaseScope,
    releaseId: string,
    existente: Artifact
  ): Promise<{ artifact: Artifact; reused: true } | PreparationOutcome> {
    try {
      const resolvido = await this.registry.resolve(existente.uri as string)
      if (resolvido.digest !== existente.digest)
        return this.bloquear(scope, releaseId, 'artifact', 'digest-mismatch')
      return { artifact: existente, reused: true }
    } catch (erro) {
      return this.bloquear(scope, releaseId, 'artifact', codigoDe(erro))
    }
  }

  private async publicar(
    scope: ReleaseScope,
    releaseId: string,
    projeto: PreparationProject
  ): Promise<{ artifact: Artifact; reused: false } | PreparationOutcome> {
    this.efeito(scope, releaseId, {
      kind: 'artifact',
      phase: 'intended',
      transport: DOCKER_CLI,
      externalRef: projeto.repository
    })
    try {
      const publicado = await this.registry.publish({
        repository: projeto.repository,
        contextDir: projeto.contextDir,
        sourceSha: projeto.sourceSha,
        readableTag: projeto.readableTag
      })
      const artifact = this.repo.recordArtifact(
        scope,
        releaseId,
        {
          kind: 'backend-image',
          uri: publicado.uri,
          digest: publicado.digest,
          provenance: publicado.provenance
        },
        this.now()
      )
      this.efeito(scope, releaseId, {
        kind: 'artifact',
        phase: 'confirmed',
        transport: DOCKER_CLI,
        externalRef: publicado.uri,
        digest: publicado.digest,
        evidenceHash: publicado.provenance.provenanceDigest
      })
      return { artifact, reused: false }
    } catch (erro) {
      return this.bloquear(scope, releaseId, 'artifact', codigoDe(erro))
    }
  }

  private async limpar(
    scope: ReleaseScope,
    releaseId: string,
    leaseId: string,
    resultado: PreparationOutcome
  ): Promise<PreparationOutcome> {
    try {
      await this.compose.cleanup(leaseId)
      return resultado
    } catch {
      this.efeito(scope, releaseId, {
        kind: 'compose',
        phase: 'failed',
        transport: DOCKER_CLI,
        reason: 'cleanup-failed'
      })
      // Pendência reconciliável: a limpeza que falhou não é apresentada como feita.
      return resultado.state === 'prepared' ? { ...resultado, cleanup: 'pending' } : resultado
    }
  }

  private bloquear(
    scope: ReleaseScope,
    releaseId: string,
    kind: 'compose' | 'migration' | 'artifact',
    reason: PreparationBlock
  ): PreparationOutcome {
    this.efeito(scope, releaseId, { kind, phase: 'failed', transport: DOCKER_CLI, reason })
    return { state: 'blocked', reason }
  }

  private efeito(
    scope: ReleaseScope,
    releaseId: string,
    input: Parameters<ReleaseLocalRepository['appendEffect']>[2]
  ): void {
    this.repo.appendEffect(scope, releaseId, input, this.now())
  }
}
