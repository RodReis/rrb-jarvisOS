import { PADRAO_DE_AMBIENTE_DE_PREVIEW } from '@shared/domain/release-preview'
import {
  PreviewProviderError,
  type PreviewBackendEnvironment,
  type PreviewBackendPort
} from '../preview-ports'
import type { CommandRunner } from './command-runner'
import { exigirSucesso, lerJson } from './preview-cli-errors'

/**
 * Backend + PostgreSQL temporários do Preview no Railway (SPEC-Release-03). Transporte declarado:
 * CLI `railway`, JSON. Cada Preview é um **ambiente** próprio, duplicado de um ambiente-modelo
 * dedicado (`templateEnvironment`) que o operador mantém com o backend e um PostgreSQL vazios:
 * criar o ambiente cria os dois recursos juntos e apagá-lo apaga os dois, então isolamento e
 * limpeza por posse são o mesmo nome. O modelo nunca é Staging nem Produção.
 *
 * O token (conta/workspace, `RAILWAY_API_TOKEN`) vai só no ambiente do processo filho, nunca em
 * argumento, e é redigido da saída. O diretório de trabalho precisa estar vinculado ao projeto
 * (`railway link`, uma vez pelo operador).
 */

export interface RailwayPreviewConfig {
  /** Pasta já vinculada ao projeto Railway de Preview. */
  readonly workdir: string
  readonly token: string
  readonly templateEnvironment: string
  readonly backendService: string
  readonly databaseService: string
  readonly backendPort: number
}

const BINARIO = 'railway'
/**
 * Lista de **permissão**, não de bloqueio: o modelo é copiado inteiro (variáveis incluídas) para
 * um ambiente que roda imagem escolhida pelo PR, então só um ambiente com este nome — mantido
 * pelo operador, sem segredo real — é aceito. `production`, `prd`, `main`, `homolog` e qualquer
 * outro nome ficam de fora por construção.
 */
const MODELO_PERMITIDO = /^preview-template(?:-[a-z0-9]+)*$/
const DOMINIO_DO_BACKEND = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.up\.railway\.app$/i
const ID_DE_RUN = /^[A-Za-z0-9-]{8,64}$/
const SHA_VALIDO = /^[a-f0-9]{7,64}$/i
const TIMEOUT_MS = 10 * 60_000

interface AmbienteBruto {
  readonly id?: unknown
  readonly name?: unknown
}

export function assertModeloPermitido(modelo: string): void {
  if (!MODELO_PERMITIDO.test(modelo))
    throw new TypeError(
      'O ambiente-modelo do Preview deve se chamar preview-template (opcionalmente com sufixo) e não pode ter segredo real.'
    )
}

export class RailwayBackendAdapter implements PreviewBackendPort {
  constructor(
    private readonly runner: CommandRunner,
    private readonly config: RailwayPreviewConfig
  ) {
    assertModeloPermitido(config.templateEnvironment)
  }

  private cli(args: readonly string[], etapa: string) {
    return this.runner
      .run(BINARIO, args, {
        cwd: this.config.workdir,
        env: { RAILWAY_API_TOKEN: this.config.token },
        redact: [this.config.token],
        timeoutMs: TIMEOUT_MS
      })
      .then((resultado) => exigirSucesso(resultado, etapa))
  }

  private assertNomeDePreview(name: string): void {
    if (!PADRAO_DE_AMBIENTE_DE_PREVIEW.test(name))
      throw new PreviewProviderError('incompatible-state', 'O ambiente não pertence a um Preview.')
  }

  /** Procura pelo nome **exato**: prefixo ou semelhança nunca conta como posse. */
  private async find(name: string): Promise<{ id: string; name: string } | null> {
    const bruto = lerJson(
      await this.cli(['environment', 'list', '--json'], 'listar ambientes'),
      'listar ambientes'
    )
    const lista = Array.isArray(bruto)
      ? bruto
      : ((bruto as { environments?: unknown } | null)?.environments ?? [])
    if (!Array.isArray(lista))
      throw new PreviewProviderError('failed', 'A lista de ambientes veio em formato inesperado.')
    const achado = (lista as AmbienteBruto[]).find((a) => a.name === name)
    if (!achado) return null
    return { id: typeof achado.id === 'string' ? achado.id : name, name }
  }

  private configuracaoDoBackend(input: {
    imageUri: string
    sourceSha: string
    previewRunId: string
  }): string[] {
    const svc = this.config.backendService
    return [
      '--service-config', svc, 'source.image', input.imageUri,
      '--service-config', svc, 'variables.PREVIEW_RUN_ID.value', input.previewRunId,
      '--service-config', svc, 'variables.PREVIEW_SOURCE_SHA.value', input.sourceSha
    ] // prettier-ignore
  }

  async provision(input: {
    name: string
    imageUri: string
    sourceSha: string
    previewRunId: string
  }): Promise<PreviewBackendEnvironment> {
    this.assertNomeDePreview(input.name)
    if (!ID_DE_RUN.test(input.previewRunId) || !SHA_VALIDO.test(input.sourceSha))
      throw new PreviewProviderError('incompatible-state', 'Identidade de Preview inválida.')
    if (!/@sha256:[a-f0-9]{64}$/.test(input.imageUri))
      throw new PreviewProviderError(
        'incompatible-state',
        'O backend só implanta imagem por digest.'
      )
    const existente = await this.find(input.name)
    const configuracao = this.configuracaoDoBackend(input)
    // Reconcilia antes de mutar: ambiente que já existe é atualizado no lugar, nunca recriado.
    if (existente)
      await this.cli(
        ['environment', 'edit', '--environment', input.name, ...configuracao, '--json'],
        'atualizar ambiente'
      )
    else
      await this.cli(
        [
          'environment', 'new', input.name,
          '--duplicate', this.config.templateEnvironment,
          ...configuracao, '--json'
        ], // prettier-ignore
        'criar ambiente'
      )
    const ambiente = existente ?? (await this.find(input.name))
    if (!ambiente)
      throw new PreviewProviderError('failed', 'O ambiente criado não apareceu na listagem.')
    const dominio = await this.dominioDoBackend(input.name)
    return {
      externalId: ambiente.id,
      backendUrl: `https://${dominio}`,
      databaseExternalId: `${ambiente.id}:${this.config.databaseService}`
    }
  }

  private async dominioDoBackend(ambiente: string): Promise<string> {
    const base = ['--service', this.config.backendService, '--environment', ambiente]
    const lido = await this.dominios(['domain', 'list', ...base, '--json'])
    if (lido) return lido
    await this.cli(
      ['domain', ...base, '--port', String(this.config.backendPort), '--json'],
      'gerar domínio'
    )
    const criado = await this.dominios(['domain', 'list', ...base, '--json'])
    if (!criado) throw new PreviewProviderError('failed', 'O backend ficou sem domínio público.')
    return criado
  }

  private async dominios(args: readonly string[]): Promise<string | null> {
    const bruto = lerJson(await this.cli(args, 'listar domínios'), 'listar domínios')
    const lista = Array.isArray(bruto)
      ? bruto
      : ((bruto as { domains?: unknown } | null)?.domains ?? [])
    if (!Array.isArray(lista)) return null
    for (const item of lista as unknown[]) {
      const dominio =
        typeof item === 'string' ? item : (item as { domain?: unknown } | null)?.domain
      if (typeof dominio === 'string' && DOMINIO_DO_BACKEND.test(dominio)) return dominio
    }
    return null
  }

  async destroy(name: string): Promise<'destroyed' | 'absent'> {
    this.assertNomeDePreview(name)
    if (!(await this.find(name))) return 'absent'
    await this.cli(['environment', 'delete', name, '--yes', '--json'], 'apagar ambiente')
    // Código de saída zero não basta: a limpeza só vale se o ambiente sumiu de fato.
    if (await this.find(name))
      throw new PreviewProviderError('failed', 'O ambiente continua existindo depois de apagado.')
    return 'destroyed'
  }
}
