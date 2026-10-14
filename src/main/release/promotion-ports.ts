import type { ReleaseEnvironment, ReleaseScope } from '@shared/domain/release'
import type { MigrationFile, MigrationOutcome } from './database-migration-runner'

/**
 * Portas da promoção para Staging e Produção (SPEC-Release-04). O serviço só conhece estes
 * contratos; Railway, Vercel, GHCR e HTTP moram em adapters. Toda porta é idempotente: repetir a
 * chamada com a mesma entrada reconcilia o efeito que já existe em vez de duplicá-lo. Erro de
 * provedor usa o mesmo `PreviewProviderError` (código fechado) dos adapters da F03: a mensagem do
 * provedor nunca vira motivo nem evidência.
 */

export { PreviewProviderError as PromotionProviderError } from './preview-ports'
export type { PreviewProviderErrorCode as PromotionProviderErrorCode } from './preview-ports'

export type PromotionBuildOutcome =
  | { readonly state: 'built'; readonly imageUri: string; readonly digest: string }
  | { readonly state: 'blocked'; readonly reason: string }

export interface PromotionBuildPort {
  /**
   * Build único do backend: publica (ou localiza) a imagem do SHA da release e a devolve por
   * digest. O adapter real é a preparação local da F02, que também grava o artefato.
   */
  build(input: {
    scope: ReleaseScope
    releaseId: string
    sourceSha: string
    /** Lease do writer: a preparação usa para marcar e limpar o que abriu no Docker. */
    leaseId: string
  }): Promise<PromotionBuildOutcome>
}

export interface PromotionBackendPort {
  /** Implanta a imagem por digest no ambiente persistente; digest já corrente devolve o corrente. */
  deploy(input: {
    environment: ReleaseEnvironment
    imageUri: string
    releaseId: string
    sourceSha: string
  }): Promise<{ deploymentId: string }>
  /** Volta o ambiente a um deployment que a pipeline já provou saudável. */
  rollback(input: { environment: ReleaseEnvironment; toDeploymentId: string }): Promise<void>
  /** O que o ambiente serve agora; é o que reconcilia um deploy de resultado incerto. */
  current(environment: ReleaseEnvironment): Promise<{ deploymentId: string; digest: string } | null>
}

export interface PromotionDatabasePort {
  /** Backup do PostgreSQL do ambiente; devolve a referência para o restore operacional. */
  backup(input: { environment: ReleaseEnvironment }): Promise<{ backupRef: string }>
  /** Migrations forward-only no PostgreSQL do próprio ambiente. */
  migrate(input: {
    environment: ReleaseEnvironment
    migrations: readonly MigrationFile[]
  }): Promise<MigrationOutcome>
}

export interface PromotionFrontendPort {
  /** Deployment imutável do frontend para o SHA, sem atribuí-lo a ambiente. Idempotente por release. */
  build(input: { releaseId: string; sourceSha: string }): Promise<{ deploymentId: string }>
  /** Atribui (Staging) ou promove (Produção) o MESMO deployment, sem rebuild. */
  assign(input: { environment: ReleaseEnvironment; deploymentId: string }): Promise<void>
  /** Deployment que serve o ambiente agora. */
  current(environment: ReleaseEnvironment): Promise<string | null>
}

export type PromotionCheck = 'backend_health' | 'frontend_wiring' | 'smoke' | 'e2e_essential'

export interface PromotionGateOutcome {
  readonly gate: PromotionCheck
  readonly result: 'passed' | 'blocked' | 'unknown'
  /** Código curto (`[a-z0-9._-]{1,64}`), nunca a mensagem do provedor. */
  readonly reason?: string
}

export interface PromotionVerifierPort {
  /**
   * Roda as verificações pedidas contra o ambiente. `frontend_wiring` confere que o frontend
   * servido fala só com o backend DESTE ambiente (configuração de runtime por hostname).
   */
  verify(input: {
    environment: ReleaseEnvironment
    checks: readonly PromotionCheck[]
    backendDigest: string
    frontendDeploymentId: string
  }): Promise<readonly PromotionGateOutcome[]>
}
