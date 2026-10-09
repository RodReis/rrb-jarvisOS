import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertReferenciaImutavel,
  digestDaReferencia,
  ehDigestOci,
  referenciaPorDigest
} from '@shared/domain/release-artifact'
import type { ArtifactProvenance } from '@shared/domain/release'
import type { CommandResult, CommandRunner } from './command-runner'

/**
 * `ArtifactRegistryAdapter` padrão (SPEC-Release-02): GHCR. Transporte declarado: `docker` CLI
 * (`buildx build --push` e `buildx imagetools inspect`), sem fallback silencioso. A credencial é
 * a do `docker login` da máquina, lida pelo próprio Docker — nada de token em argumento ou env.
 *
 * Toda identidade é digest. A tag é só leitura humana.
 */

export type ArtifactRegistryErrorCode =
  | 'auth'
  | 'timeout'
  | 'digest-mismatch'
  | 'partial'
  | 'not-found'
  | 'attestation-unsupported'
  | 'failed'

export class ArtifactRegistryError extends Error {
  constructor(
    readonly code: ArtifactRegistryErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ArtifactRegistryError'
  }
}

export interface RegistryArtifact {
  readonly uri: string
  readonly digest: string
  readonly provenance: ArtifactProvenance
}

export interface PublishInput {
  readonly repository: string
  readonly contextDir: string
  readonly dockerfile?: string
  readonly sourceSha: string
  readonly readableTag?: string
}

const BINARIO = 'docker'
const REGISTRY_VALIDO = /^[a-z0-9]+(?:[.-][a-z0-9]+)*(?::\d{1,5})?$/
const CAMINHO_VALIDO = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/
const PADRAO_AUTH = /unauthorized|denied|authentication required|\b40[13]\b|insufficient_scope/i
const PADRAO_NAO_ENCONTRADO = /not found|manifest unknown|no such manifest/i
const PADRAO_SEM_ATTESTATION = /attestation is not supported|provenance.*not supported/i

export class GhcrArtifactAdapter {
  constructor(
    private readonly runner: CommandRunner,
    private readonly registry = 'ghcr.io',
    /** Builder nomeado (`docker buildx create`); o padrão só gera provenance com containerd store. */
    private readonly builder?: string
  ) {}

  async publish(input: PublishInput): Promise<RegistryArtifact> {
    this.assertRepositorio(input.repository)
    const pasta = mkdtempSync(join(tmpdir(), 'jarvisos-ghcr-'))
    try {
      const metadata = join(pasta, 'metadata.json')
      const tag = input.readableTag ?? input.sourceSha.slice(0, 12)
      const args = [
        'buildx',
        'build',
        '--push',
        ...(this.builder ? ['--builder', this.builder] : []),
        '--provenance=mode=max',
        '--sbom=false',
        '--label',
        `org.opencontainers.image.revision=${input.sourceSha}`,
        '--metadata-file',
        metadata,
        '-t',
        `${input.repository}:${tag}`,
        ...(input.dockerfile ? ['-f', input.dockerfile] : []),
        input.contextDir
      ]
      this.assertOk(await this.runner.run(BINARIO, args), 'build/push')
      const digest = this.lerDigestDoMetadata(metadata)
      return await this.confirmar(referenciaPorDigest(input.repository, digest))
    } finally {
      rmSync(pasta, { recursive: true, force: true })
    }
  }

  /** Resolve uma referência por digest. Tag é recusada antes de qualquer chamada. */
  async resolve(uri: string): Promise<RegistryArtifact> {
    assertReferenciaImutavel(uri)
    return this.confirmar(uri)
  }

  private async confirmar(uri: string): Promise<RegistryArtifact> {
    const digest = digestDaReferencia(uri)
    const inspecao = this.assertOk(
      await this.runner.run(BINARIO, [
        'buildx',
        'imagetools',
        'inspect',
        uri,
        '--format',
        '{{.Manifest.Digest}}'
      ]),
      'inspect'
    )
    if (inspecao.stdout.trim() !== digest)
      throw new ArtifactRegistryError(
        'digest-mismatch',
        `O registry devolveu outro digest para ${uri}.`
      )
    const bruto = this.assertOk(
      await this.runner.run(BINARIO, [
        'buildx',
        'imagetools',
        'inspect',
        uri,
        '--format',
        '{{json .Provenance}}'
      ]),
      'provenance'
    ).stdout.trim()
    return { uri, digest, provenance: this.resumirProvenance(bruto) }
  }

  private resumirProvenance(bruto: string): ArtifactProvenance {
    let slsa:
      | { buildDefinition?: { buildType?: string }; runDetails?: { builder?: { id?: string } } }
      | undefined
    try {
      slsa = (JSON.parse(bruto) as { SLSA?: typeof slsa } | null)?.SLSA
    } catch {
      slsa = undefined
    }
    if (!slsa?.buildDefinition?.buildType)
      throw new ArtifactRegistryError('partial', 'O registry não devolveu provenance utilizável.')
    return {
      transport: 'docker-cli',
      buildType: slsa.buildDefinition.buildType,
      builderId: slsa.runDetails?.builder?.id ?? '',
      provenanceDigest: `sha256:${createHash('sha256').update(bruto).digest('hex')}`
    }
  }

  private lerDigestDoMetadata(arquivo: string): string {
    let digest: unknown
    try {
      digest = (JSON.parse(readFileSync(arquivo, 'utf8')) as Record<string, unknown>)[
        'containerimage.digest'
      ]
    } catch {
      digest = undefined
    }
    if (typeof digest !== 'string' || !ehDigestOci(digest))
      throw new ArtifactRegistryError(
        'partial',
        'O build terminou sem informar o digest da imagem.'
      )
    return digest
  }

  private assertRepositorio(repository: string): void {
    if (!REGISTRY_VALIDO.test(this.registry))
      throw new TypeError('Registry inválido: informe host[:porta].')
    // Comparação por prefixo e gramática de componentes OCI: nada vira regex nem opção do Docker.
    if (
      !repository.startsWith(`${this.registry}/`) ||
      !CAMINHO_VALIDO.test(repository.slice(this.registry.length + 1))
    )
      throw new TypeError(
        `O repositório deve estar em ${this.registry}/<dono>/<imagem> em minúsculas.`
      )
  }

  /** Saída bruta do registry nunca entra na mensagem: pode trazer token ecoado. */
  private assertOk(resultado: CommandResult, etapa: string): CommandResult {
    if (resultado.timedOut)
      throw new ArtifactRegistryError('timeout', `A etapa ${etapa} excedeu o tempo limite.`)
    if (resultado.code === 0) return resultado
    const texto = `${resultado.stderr}\n${resultado.stdout}`
    if (PADRAO_AUTH.test(texto))
      throw new ArtifactRegistryError('auth', `Autenticação recusada na etapa ${etapa}.`)
    if (PADRAO_SEM_ATTESTATION.test(texto))
      throw new ArtifactRegistryError(
        'attestation-unsupported',
        'O builder não gera provenance: ative o containerd image store ou use um builder docker-container.'
      )
    if (PADRAO_NAO_ENCONTRADO.test(texto))
      throw new ArtifactRegistryError('not-found', `Referência não encontrada na etapa ${etapa}.`)
    throw new ArtifactRegistryError('failed', `A etapa ${etapa} falhou (código ${resultado.code}).`)
  }
}
