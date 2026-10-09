import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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
import type { SourceCheck } from './adapters/git-source-verifier'
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
import { segredosNoContexto } from './release-context-guard'
import type { ReleaseLocalRepository } from './release-local-repository'

/**
 * Preparação local de uma release (SPEC-Release-02): configuração → origem do build → Docker →
 * banco → migration e seed → **publicação única** do backend → o publicado rodando no Compose →
 * verificação → limpeza do que é do lease. A ordem é a da regra 4: migration quebrada interrompe
 * antes de qualquer candidato utilizável existir. Todo efeito entra no diário (intenção, depois
 * resultado) com transporte e hash de evidência; nada daqui carrega valor de chave ou saída de
 * comando. A limpeza roda sempre que o Docker foi aberto, inclusive depois de erro inesperado.
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

/** Prova que o contexto de build é o commit da release. */
export interface SourcePort {
  verify(contextDir: string, sha: string): Promise<SourceCheck>
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
  | 'configuration-missing'
  | 'configuration-invalid'
  | 'secret-in-context'
  | 'artifact-conflict'
  | SourceCheck
  | ComposeBlockCode
  | MigrationFailure
  | ArtifactRegistryErrorCode

export type PreparationOutcome =
  | {
      readonly state: 'prepared'
      readonly artifact: Artifact
      readonly fingerprint: string
      readonly ports: ComposePorts
      /** `true` quando o candidato já existia e não houve novo build. */
      readonly reused: boolean
      readonly leaseId: string
      readonly cleanup: 'done' | 'pending'
    }
  | {
      readonly state: 'blocked'
      readonly reason: PreparationBlock
      readonly missing?: readonly { name: string; environment: 'local' }[]
      /** Presentes quando o Docker chegou a ser aberto: o `leaseId` é o que reconcilia a pendência. */
      readonly leaseId?: string
      readonly cleanup?: 'done' | 'pending'
    }

const DOCKER_CLI = 'docker-cli'
const GIT_CLI = 'git-cli'
const sha256 = (texto: string): string =>
  `sha256:${createHash('sha256').update(texto).digest('hex')}`

/**
 * Os únicos códigos que podem virar motivo. `error.code` cru não serve: o Node e o SQLite usam
 * maiúsculas (`ENOENT`, `SQLITE_BUSY`), e o diário só aceita código curto em minúsculas.
 */
const CODIGOS_CONHECIDOS: ReadonlySet<string> = new Set<PreparationBlock>([
  'docker-unavailable',
  'docker-not-started',
  'port-unavailable',
  'compose-failed',
  'verify-failed',
  'cleanup-failed',
  'migration-failed',
  'checksum-divergent',
  'migration-missing',
  'auth',
  'timeout',
  'digest-mismatch',
  'partial',
  'not-found',
  'attestation-unsupported',
  'failed',
  'artifact-conflict'
])

function codigoDe(erro: unknown, padrao: PreparationBlock): PreparationBlock {
  const codigo = (erro as { code?: unknown } | null)?.code
  return typeof codigo === 'string' && CODIGOS_CONHECIDOS.has(codigo)
    ? (codigo as PreparationBlock)
    : padrao
}

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

type Etapa = 'compose' | 'migration' | 'artifact'

export class ReleasePreparationService {
  constructor(
    private readonly repo: ReleaseLocalRepository,
    private readonly compose: ComposePort,
    private readonly registry: RegistryPort,
    private readonly source: SourcePort,
    private readonly fingerprintKey: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async prepare(
    scope: ReleaseScope,
    releaseId: string,
    lease: Pick<ReleaseLease, 'leaseId'>,
    projeto: PreparationProject
  ): Promise<PreparationOutcome> {
    const bloqueio =
      this.validarConfiguracao(scope, releaseId, projeto) ??
      (await this.validarOrigem(scope, releaseId, projeto))
    if (bloqueio) return bloqueio

    this.efeito(scope, releaseId, {
      kind: 'compose',
      phase: 'intended',
      transport: DOCKER_CLI,
      externalRef: `lease:${lease.leaseId}`
    })
    let env: ComposeEnvironmentPort
    try {
      env = await this.compose.open(projeto.profile, lease.leaseId)
    } catch (erro) {
      return this.bloquear(scope, releaseId, 'compose', codigoDe(erro, 'compose-failed'))
    }

    let resultado: PreparationOutcome | undefined
    let limpeza: 'done' | 'pending' = 'pending'
    try {
      resultado = await this.preparar(scope, releaseId, projeto, env)
    } catch (erro) {
      resultado = this.bloquear(scope, releaseId, 'compose', codigoDe(erro, 'compose-failed'))
    } finally {
      limpeza = await this.limpar(scope, releaseId, lease.leaseId)
    }
    return { ...resultado, leaseId: lease.leaseId, cleanup: limpeza } as PreparationOutcome
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
    let validacao: ReturnType<typeof validarReferencias>
    try {
      validacao = validarReferencias({
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
    } catch {
      // `.env.example` ilegível ou com valor: bloqueio com código, sem ecoar o conteúdo.
      return this.bloquear(scope, releaseId, 'configuration', 'configuration-invalid')
    }
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

  /**
   * Antes de abrir o Docker e só quando há build a fazer: o contexto é o commit da release e não
   * leva arquivo de ambiente para dentro da imagem que vai ao registry.
   */
  private async validarOrigem(
    scope: ReleaseScope,
    releaseId: string,
    projeto: PreparationProject
  ): Promise<PreparationOutcome | null> {
    if (this.repo.getArtifact(scope, releaseId, 'backend-image')) return null
    let segredos: string[]
    try {
      segredos = segredosNoContexto(projeto.contextDir, projeto.envLocalFile)
    } catch {
      // Contexto inexistente ou ilegível: não há como provar a origem do build.
      return this.bloquear(scope, releaseId, 'artifact', 'source-mismatch', GIT_CLI)
    }
    if (segredos.length > 0)
      return this.bloquear(scope, releaseId, 'artifact', 'secret-in-context', GIT_CLI)
    const origem = await this.source.verify(projeto.contextDir, projeto.sourceSha)
    return origem === 'ok' ? null : this.bloquear(scope, releaseId, 'artifact', origem, GIT_CLI)
  }

  private async preparar(
    scope: ReleaseScope,
    releaseId: string,
    projeto: PreparationProject,
    env: ComposeEnvironmentPort
  ): Promise<PreparationOutcome> {
    await env.upDatabase()

    this.efeito(scope, releaseId, { kind: 'migration', phase: 'intended', transport: DOCKER_CLI })
    let migracao: Awaited<ReturnType<DatabaseMigrationRunner['apply']>>
    try {
      migracao = await new DatabaseMigrationRunner(env.sql).apply({
        database: 'release',
        migrations: lerMigrations(projeto.migrationsDir),
        seed: projeto.seedFile ? readFileSync(projeto.seedFile, 'utf8') : undefined
      })
    } catch {
      return this.bloquear(scope, releaseId, 'migration', 'migration-failed')
    }
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
      ? await this.confirmarExistente(scope, releaseId, projeto, existente)
      : await this.publicar(scope, releaseId, projeto)
    if ('state' in publicado) return publicado

    const uri = publicado.artifact.uri
    if (!uri) return this.bloquear(scope, releaseId, 'artifact', 'partial')
    await env.upApplication(uri)
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
      leaseId: '',
      cleanup: 'pending'
    }
  }

  /** Critério 4: a consulta posterior devolve o mesmo digest **e** a mesma provenance. */
  private async confirmarExistente(
    scope: ReleaseScope,
    releaseId: string,
    projeto: PreparationProject,
    existente: Artifact
  ): Promise<{ artifact: Artifact; reused: true } | PreparationOutcome> {
    const uri = existente.uri as string
    this.efeito(scope, releaseId, {
      kind: 'artifact',
      phase: 'intended',
      transport: DOCKER_CLI,
      externalRef: uri
    })
    try {
      if (!uri.startsWith(`${projeto.repository}@`))
        return this.bloquear(scope, releaseId, 'artifact', 'digest-mismatch')
      const resolvido = await this.registry.resolve(uri)
      if (
        resolvido.digest !== existente.digest ||
        resolvido.provenance.provenanceDigest !== existente.provenance?.provenanceDigest
      )
        return this.bloquear(scope, releaseId, 'artifact', 'digest-mismatch')
      this.efeito(scope, releaseId, {
        kind: 'artifact',
        phase: 'confirmed',
        transport: DOCKER_CLI,
        externalRef: uri,
        digest: existente.digest,
        evidenceHash: resolvido.provenance.provenanceDigest
      })
      return { artifact: existente, reused: true }
    } catch (erro) {
      return this.bloquear(scope, releaseId, 'artifact', codigoDe(erro, 'failed'))
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
    const { backend } = projeto.profile
    try {
      const publicado = await this.registry.publish({
        repository: projeto.repository,
        contextDir: projeto.contextDir,
        // `-f` do buildx é relativo ao cwd, o do perfil é relativo ao contexto.
        ...(backend.dockerfile ? { dockerfile: join(backend.context, backend.dockerfile) } : {}),
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
      return this.bloquear(scope, releaseId, 'artifact', codigoDe(erro, 'failed'))
    }
  }

  /** Nunca lança: uma limpeza que falha é pendência, não uma exceção que esconde o resultado. */
  private async limpar(
    scope: ReleaseScope,
    releaseId: string,
    leaseId: string
  ): Promise<'done' | 'pending'> {
    try {
      await this.compose.cleanup(leaseId)
      return 'done'
    } catch {
      try {
        this.efeito(scope, releaseId, {
          kind: 'compose',
          phase: 'failed',
          transport: DOCKER_CLI,
          externalRef: `lease:${leaseId}`,
          reason: 'cleanup-failed'
        })
      } catch {
        // O diário indisponível não pode derrubar o relato da pendência para quem chamou.
      }
      return 'pending'
    }
  }

  private bloquear(
    scope: ReleaseScope,
    releaseId: string,
    etapa: Etapa | 'configuration',
    reason: PreparationBlock,
    transport = etapa === 'configuration' ? 'env-file' : DOCKER_CLI
  ): PreparationOutcome {
    this.efeito(scope, releaseId, { kind: etapa, phase: 'failed', transport, reason })
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
