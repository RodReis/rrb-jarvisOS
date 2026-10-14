import type { ConfigurationProbe } from '../configuration-reference-validator'
import { fingerprintDeConfiguracao } from '../configuration-reference-validator'
import { PromotionProviderError } from '../promotion-ports'
import type { CommandRunner } from './command-runner'
import { exigirSucesso } from './preview-cli-errors'

/**
 * Leitura da configuração real de Staging e Produção no Railway (SPEC-Release-04). Os segredos
 * permanecem no provedor: este leitor traz os valores **só até** o HMAC e devolve à pipeline
 * apenas "existe?" e o fingerprint — o valor nasce e morre aqui dentro. Transporte declarado:
 * CLI `railway`, JSON. O token (`RAILWAY_API_TOKEN`) vai só no ambiente do processo filho.
 */

export interface RailwayConfigurationConfig {
  readonly workdir: string
  readonly token: string
  readonly backendService: string
  readonly environments: { readonly staging: string; readonly production: string }
  /** Chave do HMAC (separada da chave de auditoria): sem ela o fingerprint não se compara entre máquinas. */
  readonly fingerprintKey: string
}

const TIMEOUT_MS = 2 * 60_000

export class RailwayConfigurationReader {
  constructor(
    private readonly runner: CommandRunner,
    private readonly config: RailwayConfigurationConfig
  ) {}

  /** Lê os dois ambientes **agora** e devolve a sonda síncrona que o validador consome. */
  async load(): Promise<ConfigurationProbe> {
    const lidos = {
      staging: await this.ler(this.config.environments.staging),
      production: await this.ler(this.config.environments.production)
    }
    return (ambiente, nome) => {
      const fingerprints =
        ambiente === 'staging' || ambiente === 'production' ? lidos[ambiente] : null
      const fingerprint = fingerprints?.get(nome)
      return fingerprint === undefined ? { present: false } : { present: true, fingerprint }
    }
  }

  /** nome → fingerprint. Variável vazia ou que não é texto não prova configuração: fica de fora. */
  private async ler(ambiente: string): Promise<Map<string, string>> {
    const resultado = exigirSucesso(
      await this.runner.run(
        'railway',
        [
          'variable',
          'list',
          '--service',
          this.config.backendService,
          '--environment',
          ambiente,
          '--json'
        ],
        {
          cwd: this.config.workdir,
          env: { RAILWAY_API_TOKEN: this.config.token },
          redact: [this.config.token],
          timeoutMs: TIMEOUT_MS
        }
      ),
      'ler variáveis do backend'
    )
    let bruto: unknown
    try {
      bruto = JSON.parse(resultado.stdout)
    } catch {
      throw new PromotionProviderError('failed', 'As variáveis do backend vieram ilegíveis.')
    }
    if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto))
      throw new PromotionProviderError(
        'failed',
        'As variáveis do backend vieram em formato inesperado.'
      )
    const fingerprints = new Map<string, string>()
    for (const [nome, valor] of Object.entries(bruto))
      if (typeof valor === 'string' && valor !== '')
        fingerprints.set(nome, fingerprintDeConfiguracao(this.config.fingerprintKey, nome, valor))
    return fingerprints
  }
}
