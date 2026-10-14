import { HttpProbe, assertCaminho, lerTexto, type HttpProbeConfig } from './http-probe'
import {
  PreviewProviderError,
  type PreviewGateOutcome,
  type PreviewVerifierPort
} from '../preview-ports'

/**
 * Verificação do Preview pelas URLs reais (SPEC-Release-03): saúde e identidade do backend e a
 * fiação do frontend. Identidade = o backend responde o `previewRunId` e o SHA que o coordenador
 * criou — um backend de outro PR ou ambiente responde outra coisa e o gate bloqueia.
 *
 * Backend e frontend são código do PR: cada requisição tem prazo próprio, não segue redirecionamento
 * (um 302 para a rede interna seria SSRF), lê no máximo um teto de bytes e só fala com o domínio que
 * o provedor atribui (`*.up.railway.app`, `*.vercel.app`). Os caminhos de saúde e identidade
 * saem do perfil do projeto e precisam resolver para a mesma origem.
 *
 * A fiação do frontend é lida do que ele entrega: o bundle do mesmo domínio tem de conter a
 * origem do backend deste run e nenhuma outra origem de backend de Preview. Cobre o que o build
 * injetou; a navegação real com Playwright continua sendo o smoke das URLs de prova.
 */

export interface HttpVerifierConfig extends HttpProbeConfig {
  readonly healthPath?: string
  readonly identityPath?: string
}

const TETO_DO_HTML = 1024 * 1024
const TETO_DE_ASSET = 2 * 1024 * 1024
const TETO_DA_IDENTIDADE = 16 * 1024
const MAXIMO_DE_ASSETS = 12
const HOST_DO_BACKEND = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.up\.railway\.app$/i
const HOST_DO_FRONTEND = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app$/i
const ORIGEM_DE_BACKEND_DE_PREVIEW = /https:\/\/[a-z0-9-]+\.up\.railway\.app/gi
const ASSET = /(?:src|href)\s*=\s*["']([^"']+\.(?:js|mjs))["']/gi
export class HttpPreviewVerifier implements PreviewVerifierPort {
  private readonly probe: HttpProbe
  private readonly healthPath: string
  private readonly identityPath: string

  constructor(config: HttpVerifierConfig = {}) {
    this.probe = new HttpProbe(config)
    this.healthPath = assertCaminho(config.healthPath ?? '/health', 'saúde')
    this.identityPath = assertCaminho(config.identityPath ?? '/preview-identity', 'identidade')
  }

  async verify(input: {
    previewRunId: string
    sourceSha: string
    backendUrl: string
    frontendUrl: string
  }): Promise<readonly PreviewGateOutcome[]> {
    this.assertHosts(input.backendUrl, input.frontendUrl)
    const saude = await this.saude(input.backendUrl)
    const identidade = saude.result === 'passed' ? await this.identidade(input) : this.pulada()
    const frontend = await this.frontend(input.frontendUrl, input.backendUrl)
    return [saude, identidade, frontend]
  }

  private assertHosts(backendUrl: string, frontendUrl: string): void {
    const backend = new URL(backendUrl)
    const frontend = new URL(frontendUrl)
    if (
      backend.protocol !== 'https:' ||
      frontend.protocol !== 'https:' ||
      !HOST_DO_BACKEND.test(backend.hostname) ||
      !HOST_DO_FRONTEND.test(frontend.hostname)
    )
      throw new PreviewProviderError(
        'incompatible-state',
        'O Preview só é verificado em domínios do provedor.'
      )
  }

  private pulada(): PreviewGateOutcome {
    return { gate: 'identidade', result: 'unknown', reason: 'health-down' }
  }

  private async saude(backendUrl: string): Promise<PreviewGateOutcome> {
    const origem = new URL(backendUrl).origin
    const pronto = await this.probe.esperar(async () => {
      const r = await this.probe.requisitar(new URL(this.healthPath, backendUrl), origem)
      await r.body?.cancel().catch(() => undefined)
      return r.ok ? true : null
    })
    return pronto
      ? { gate: 'health', result: 'passed' }
      : { gate: 'health', result: 'blocked', reason: 'health-down' }
  }

  /**
   * Num commit novo o ambiente é atualizado no lugar: o container antigo ainda responde saúde e a
   * identidade do SHA anterior até o rollout terminar. Espera até a identidade bater; só no fim do
   * prazo o que ficou visto vira `identity-mismatch`.
   */
  private async identidade(input: {
    previewRunId: string
    sourceSha: string
    backendUrl: string
  }): Promise<PreviewGateOutcome> {
    const origem = new URL(input.backendUrl).origin
    let motivo: 'identity-unavailable' | 'identity-mismatch' = 'identity-unavailable'
    const igual = await this.probe.esperar(async () => {
      const r = await this.probe.requisitar(new URL(this.identityPath, input.backendUrl), origem)
      const texto = r.ok ? await lerTexto(r, TETO_DA_IDENTIDADE) : null
      if (texto === null) {
        motivo = 'identity-unavailable'
        return null
      }
      const corpo = JSON.parse(texto) as { previewRunId?: unknown; sourceSha?: unknown } | null
      if (corpo?.previewRunId === input.previewRunId && corpo.sourceSha === input.sourceSha)
        return true
      motivo = 'identity-mismatch'
      return null
    })
    return igual
      ? { gate: 'identidade', result: 'passed' }
      : { gate: 'identidade', result: 'blocked', reason: motivo }
  }

  private async frontend(frontendUrl: string, backendUrl: string): Promise<PreviewGateOutcome> {
    const origem = new URL(frontendUrl).origin
    const html = await this.probe.esperar(async () => {
      const r = await this.probe.requisitar(new URL(frontendUrl), origem)
      return r.ok ? await lerTexto(r, TETO_DO_HTML) : null
    })
    if (html === null) return { gate: 'frontend', result: 'blocked', reason: 'frontend-down' }

    const esperado = new URL(backendUrl).origin
    let conteudo = html
    const assets = new Set<string>()
    for (const m of html.matchAll(ASSET)) {
      const alvo = new URL(m[1]!, frontendUrl)
      if (alvo.origin === origem) assets.add(alvo.href)
    }
    for (const href of [...assets].slice(0, MAXIMO_DE_ASSETS)) {
      try {
        const r = await this.probe.requisitar(new URL(href), origem)
        const texto = r.ok ? await lerTexto(r, TETO_DE_ASSET) : null
        if (texto) conteudo += `\n${texto}`
      } catch {
        // Asset que não carrega não prova nada; a ausência da origem abaixo é o que bloqueia.
      }
    }
    const outras = (conteudo.match(ORIGEM_DE_BACKEND_DE_PREVIEW) ?? []).filter(
      (o) => o.toLowerCase() !== esperado.toLowerCase()
    )
    if (outras.length)
      return { gate: 'frontend', result: 'blocked', reason: 'frontend-foreign-backend' }
    if (!conteudo.toLowerCase().includes(esperado.toLowerCase()))
      return { gate: 'frontend', result: 'blocked', reason: 'frontend-wiring' }
    return { gate: 'frontend', result: 'passed' }
  }
}
