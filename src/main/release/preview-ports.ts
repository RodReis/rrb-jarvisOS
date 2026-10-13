import type { PreviewRun } from '@shared/domain/release'
import type {
  PreviewGate,
  PreviewGateResult,
  PreviewResource
} from '@shared/domain/release-preview'
import type { MigrationFile, MigrationOutcome } from './database-migration-runner'

/**
 * Portas do Preview (SPEC-Release-03). O coordenador só conhece estes contratos; Vercel, Railway,
 * GHCR e GitHub moram em adapters. Toda porta é idempotente: chamar duas vezes com a mesma
 * entrada reconcilia o efeito que já existe em vez de duplicá-lo.
 */

export type PreviewProviderErrorCode =
  'auth' | 'timeout' | 'quota' | 'incompatible-state' | 'not-found' | 'failed'

/** Erro de provedor com código fechado: a mensagem do provedor nunca vira motivo nem evidência. */
export class PreviewProviderError extends Error {
  constructor(
    readonly code: PreviewProviderErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'PreviewProviderError'
  }
}

export interface PreviewImagePort {
  /** Publica (ou localiza) a imagem do backend para o SHA; identidade é sempre o digest. */
  ensure(input: { sourceSha: string }): Promise<{ uri: string; digest: string }>
}

export interface PreviewBackendEnvironment {
  readonly externalId: string
  readonly backendUrl: string
  readonly databaseExternalId: string
}

export interface PreviewBackendPort {
  /**
   * Cria ou atualiza o ambiente temporário `name` (backend + PostgreSQL próprios) com a imagem por
   * digest. Reconcilia antes de criar: ambiente existente é reaproveitado.
   */
  provision(input: {
    name: string
    imageUri: string
    sourceSha: string
    previewRunId: string
  }): Promise<PreviewBackendEnvironment>
  /** Apaga o ambiente `name` e tudo que há nele; só aceita nomes de Preview. */
  destroy(name: string): Promise<'destroyed' | 'absent'>
}

export interface PreviewDatabasePort {
  migrateAndSeed(input: {
    name: string
    migrations: readonly MigrationFile[]
    seed: string
  }): Promise<MigrationOutcome>
}

export interface PreviewFrontendPort {
  /** Implanta o frontend ligado somente a `backendUrl`; reaproveita deployment idêntico já pronto. */
  deploy(input: {
    previewRunId: string
    sourceSha: string
    backendUrl: string
  }): Promise<{ externalId: string; url: string }>
  /** Deployments que carregam a marca de posse deste run. */
  list(previewRunId: string): Promise<readonly string[]>
  destroy(externalId: string): Promise<'destroyed' | 'absent'>
}

export interface PreviewGateOutcome {
  readonly gate: string
  readonly result: PreviewGateResult
  readonly reason?: string
}

export interface PreviewVerifierPort {
  /** health e identidade do backend; frontend responde e fala só com este backend. */
  verify(input: {
    previewRunId: string
    sourceSha: string
    backendUrl: string
    frontendUrl: string
  }): Promise<readonly PreviewGateOutcome[]>
}

export interface PreviewProjection {
  readonly run: PreviewRun
  readonly resources: readonly PreviewResource[]
  readonly gates: readonly PreviewGate[]
}

export interface PreviewPublicationPort {
  publish(projection: PreviewProjection): Promise<void>
}
