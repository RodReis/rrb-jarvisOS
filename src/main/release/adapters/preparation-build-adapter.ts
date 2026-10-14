import type { ReleaseScope } from '@shared/domain/release'
import type { PromotionBuildOutcome, PromotionBuildPort } from '../promotion-ports'
import type { PreparationOutcome, PreparationProject } from '../release-preparation-service'

/**
 * Build único do backend para a promoção (SPEC-Release-04): reaproveita a preparação local da F02
 * — configuração local, origem do build, migration em PostgreSQL de verdade, publicação no GHCR por
 * digest e verificação do publicado rodando no Compose. A F02 já grava o artefato (um por release)
 * e reconhece o que existe, então repetir não reconstrói; Staging e Produção recebem a mesma imagem.
 */

export interface PreparationRunner {
  prepare(
    scope: ReleaseScope,
    releaseId: string,
    lease: { readonly leaseId: string },
    projeto: PreparationProject
  ): Promise<PreparationOutcome>
}

export class PreparationBuildAdapter implements PromotionBuildPort {
  constructor(
    private readonly preparation: PreparationRunner,
    /** O perfil do projeto é lido **para o SHA da release**: o contexto de build é aquele commit. */
    private readonly projectFor: (sourceSha: string) => PreparationProject
  ) {}

  async build(input: {
    scope: ReleaseScope
    releaseId: string
    sourceSha: string
    leaseId: string
  }): Promise<PromotionBuildOutcome> {
    let projeto: PreparationProject
    try {
      projeto = this.projectFor(input.sourceSha)
    } catch {
      // Texto do erro do perfil não sobe: pode citar caminho; só o código.
      return { state: 'blocked', reason: 'profile-invalid' }
    }
    const resultado = await this.preparation.prepare(
      input.scope,
      input.releaseId,
      { leaseId: input.leaseId },
      projeto
    )
    if (resultado.state === 'blocked') return { state: 'blocked', reason: resultado.reason }
    // `cleanup: 'pending'` é pendência de Docker local, não da imagem já publicada.
    const { artifact } = resultado
    if (!artifact.uri) return { state: 'blocked', reason: 'partial' }
    return { state: 'built', imageUri: artifact.uri, digest: artifact.digest }
  }
}
