import type { ReleaseEnvironment } from '@shared/domain/release'
import type {
  PromotionCheck,
  PromotionGateOutcome,
  PromotionVerifierPort
} from '../promotion-ports'
import { HttpProbe, assertCaminho, lerTexto, type HttpProbeConfig } from './http-probe'

/**
 * Verificação da promoção para Staging e Produção pelas URLs reais (SPEC-Release-04). A identidade
 * vem do provedor (`currentBackend`/`currentFrontend`, que leem Railway e Vercel) e a saúde vem do
 * HTTP: um serviço saudável com o digest errado, ou o digest certo fora do ar, bloqueia do mesmo jeito.
 *
 * As URLs vêm da configuração do operador (trusted), não do código do projeto, e podem ser domínios
 * próprios. Mesmo assim cada requisição tem prazo, não segue redirecionamento, só fala com a origem
 * declarada e lê até um teto de bytes: o corpo que volta é do serviço em verificação.
 *
 * Staging e Produção servem o MESMO deployment de frontend (sem rebuild), então a URL do backend não
 * está no build: o frontend publica uma configuração de runtime resolvida pelo domínio, e a fiação
 * é provada lendo `apiUrl` e comparando a ORIGEM com o backend deste ambiente.
 */

export interface PromotionEnvironmentUrls {
  readonly backendUrl: string
  readonly frontendUrl: string
}

export interface HttpPromotionVerifierConfig extends HttpProbeConfig {
  readonly environments: Readonly<Record<ReleaseEnvironment, PromotionEnvironmentUrls>>
  readonly healthPath?: string
  readonly runtimeConfigPath?: string
  readonly smokePaths?: readonly string[]
  /** O que o provedor do backend serve agora (adapter Railway). */
  readonly currentBackend: (
    environment: ReleaseEnvironment
  ) => Promise<{ deploymentId: string; digest: string } | null>
  /** O deployment que o provedor do frontend serve agora (adapter Vercel). */
  readonly currentFrontend: (environment: ReleaseEnvironment) => Promise<string | null>
  /** Jornada essencial do projeto; ausente = o check falha fechado. */
  readonly e2e?: { readonly run: (environment: ReleaseEnvironment) => Promise<boolean> }
}

interface Alvo {
  readonly backend: string
  readonly frontend: string
}

const TETO_DO_RUNTIME_CONFIG = 16 * 1024

const passou = (gate: PromotionCheck): PromotionGateOutcome => ({ gate, result: 'passed' })
const bloqueou = (gate: PromotionCheck, reason: string): PromotionGateOutcome => ({
  gate,
  result: 'blocked',
  reason
})

/** Origem https sem credencial; o resto da URL é descartado, pois só a origem é confiável. */
function origemDe(url: string, nome: string): string {
  let alvo: URL
  try {
    alvo = new URL(url)
  } catch {
    throw new TypeError(`A URL de ${nome} é inválida.`)
  }
  if (alvo.protocol !== 'https:' || alvo.username || alvo.password)
    throw new TypeError(`A URL de ${nome} precisa ser https e sem credencial.`)
  return alvo.origin
}

export class HttpPromotionVerifier implements PromotionVerifierPort {
  private readonly probe: HttpProbe
  private readonly alvos: Readonly<Record<ReleaseEnvironment, Alvo>>
  private readonly healthPath: string
  private readonly runtimeConfigPath: string
  private readonly smokePaths: readonly string[]

  constructor(private readonly config: HttpPromotionVerifierConfig) {
    this.probe = new HttpProbe(config)
    this.healthPath = assertCaminho(config.healthPath ?? '/health', 'saúde')
    this.runtimeConfigPath = assertCaminho(
      config.runtimeConfigPath ?? '/runtime-config.json',
      'configuração de runtime'
    )
    this.smokePaths = (config.smokePaths ?? ['/']).map((p) => assertCaminho(p, 'smoke'))
    this.alvos = {
      staging: this.alvo('staging'),
      production: this.alvo('production')
    }
  }

  private alvo(ambiente: ReleaseEnvironment): Alvo {
    const urls = this.config.environments[ambiente]
    return {
      backend: origemDe(urls.backendUrl, `backend de ${ambiente}`),
      frontend: origemDe(urls.frontendUrl, `frontend de ${ambiente}`)
    }
  }

  async verify(input: {
    environment: ReleaseEnvironment
    checks: readonly PromotionCheck[]
    backendDigest: string
    frontendDeploymentId: string
  }): Promise<readonly PromotionGateOutcome[]> {
    const resultados: PromotionGateOutcome[] = []
    // Em sequência: os checks sondam o mesmo ambiente e a ordem pedida é a ordem do relatório.
    for (const check of input.checks) resultados.push(await this.rodar(check, input))
    return resultados
  }

  private rodar(
    check: PromotionCheck,
    input: { environment: ReleaseEnvironment; backendDigest: string; frontendDeploymentId: string }
  ): Promise<PromotionGateOutcome> {
    const { environment } = input
    switch (check) {
      case 'backend_health':
        return this.saude(environment, input.backendDigest)
      case 'frontend_wiring':
        return this.fiacao(environment, input.frontendDeploymentId)
      case 'smoke':
        return this.smoke(environment)
      case 'e2e_essential':
        return this.e2e(environment)
    }
  }

  /**
   * Repete até o prazo: o rollout termina depois do deploy e o container antigo ainda responde.
   * `tentar` devolve o motivo da falha ou `null` quando passou; só o último motivo visto é
   * reportado. Exceção (rede, redirecionamento, provedor) vira o motivo `padrao`, nunca o texto.
   */
  private async repetir(
    gate: PromotionCheck,
    padrao: string,
    tentar: () => Promise<string | null>
  ): Promise<PromotionGateOutcome> {
    let motivo = padrao
    const passada = await this.probe.esperar(async () => {
      const falha = await tentar().catch(() => padrao)
      if (falha === null) return true
      motivo = falha
      return null
    })
    return passada ? passou(gate) : bloqueou(gate, motivo)
  }

  /** GET 2xx dentro da origem declarada; o corpo não interessa e é descartado. */
  private async responde(caminho: string, base: string): Promise<boolean> {
    const r = await this.probe.requisitar(new URL(caminho, base), base)
    await r.body?.cancel().catch(() => undefined)
    return r.ok
  }

  private saude(ambiente: ReleaseEnvironment, digest: string): Promise<PromotionGateOutcome> {
    const { backend } = this.alvos[ambiente]
    return this.repetir('backend_health', 'health-down', async () => {
      if (!(await this.responde(this.healthPath, backend))) return 'health-down'
      const atual = await this.config.currentBackend(ambiente).catch(() => undefined)
      if (atual === undefined) return 'identity-unavailable'
      return atual?.digest === digest ? null : 'identity-mismatch'
    })
  }

  private fiacao(
    ambiente: ReleaseEnvironment,
    deploymentId: string
  ): Promise<PromotionGateOutcome> {
    const { backend, frontend } = this.alvos[ambiente]
    return this.repetir('frontend_wiring', 'frontend-wiring', async () => {
      const motivo = await this.apiUrlAponta(frontend, backend)
      if (motivo) return motivo
      const atual = await this.config.currentFrontend(ambiente).catch(() => undefined)
      if (atual === undefined) return 'identity-unavailable'
      return atual === deploymentId ? null : 'identity-mismatch'
    })
  }

  /** `null` quando o `apiUrl` publicado pelo frontend tem a origem do backend deste ambiente. */
  private async apiUrlAponta(frontend: string, backend: string): Promise<string | null> {
    const r = await this.probe.requisitar(new URL(this.runtimeConfigPath, frontend), frontend)
    const texto = r.ok ? await lerTexto(r, TETO_DO_RUNTIME_CONFIG) : null
    if (texto === null) return 'frontend-wiring'
    let apiUrl: unknown
    try {
      apiUrl = (JSON.parse(texto) as { apiUrl?: unknown } | null)?.apiUrl
    } catch {
      return 'frontend-wiring'
    }
    if (typeof apiUrl !== 'string') return 'frontend-wiring'
    let origem: string
    try {
      origem = new URL(apiUrl).origin
    } catch {
      return 'frontend-wiring'
    }
    return origem === backend ? null : 'frontend-foreign-backend'
  }

  private smoke(ambiente: ReleaseEnvironment): Promise<PromotionGateOutcome> {
    const { backend, frontend } = this.alvos[ambiente]
    return this.repetir('smoke', 'smoke-failed', async () => {
      for (const caminho of this.smokePaths)
        if (!(await this.responde(caminho, frontend))) return 'smoke-failed'
      return (await this.responde(this.healthPath, backend)) ? null : 'smoke-failed'
    })
  }

  private async e2e(ambiente: ReleaseEnvironment): Promise<PromotionGateOutcome> {
    const { e2e } = this.config
    if (!e2e) return bloqueou('e2e_essential', 'e2e-not-configured')
    try {
      return (await e2e.run(ambiente)) === true
        ? passou('e2e_essential')
        : bloqueou('e2e_essential', 'e2e-failed')
    } catch {
      return bloqueou('e2e_essential', 'e2e-failed')
    }
  }
}
