import { PreviewProviderError, type PreviewImagePort } from '../preview-ports'
import { ArtifactRegistryError, type GhcrArtifactAdapter } from './ghcr-artifact-adapter'

/**
 * Imagem do backend do Preview no GHCR (SPEC-Release-03), por digest. Reconcilia antes de
 * construir: se o SHA já tem imagem publicada, reaproveita; do contrário publica uma vez. A tag
 * usa o SHA completo — localiza, nunca identifica.
 */

export interface PreviewImageSource {
  readonly repository: string
  readonly contextDir: string
  readonly dockerfile?: string
}

const CODIGO: Readonly<Record<string, PreviewProviderError['code']>> = {
  auth: 'auth',
  timeout: 'timeout',
  'not-found': 'not-found'
}

export class GhcrPreviewImageAdapter implements PreviewImagePort {
  constructor(
    private readonly ghcr: GhcrArtifactAdapter,
    private readonly source: PreviewImageSource
  ) {}

  async ensure(input: { sourceSha: string }): Promise<{ uri: string; digest: string }> {
    if (!/^[a-f0-9]{40}$/i.test(input.sourceSha))
      throw new PreviewProviderError(
        'incompatible-state',
        'A imagem do Preview exige o SHA completo do commit.'
      )
    const tag = `pv-${input.sourceSha.toLowerCase()}`
    try {
      const existente = await this.ghcr.lookup(this.source.repository, tag)
      if (existente) return { uri: existente.uri, digest: existente.digest }
      const publicada = await this.ghcr.publish({
        repository: this.source.repository,
        contextDir: this.source.contextDir,
        ...(this.source.dockerfile ? { dockerfile: this.source.dockerfile } : {}),
        sourceSha: input.sourceSha,
        readableTag: tag
      })
      return { uri: publicada.uri, digest: publicada.digest }
    } catch (erro) {
      if (erro instanceof ArtifactRegistryError)
        throw new PreviewProviderError(
          CODIGO[erro.code] ?? 'failed',
          `A imagem do Preview falhou (${erro.code}).`
        )
      throw erro
    }
  }
}
