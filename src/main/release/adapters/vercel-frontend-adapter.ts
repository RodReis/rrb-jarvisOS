import { createHash } from 'node:crypto'
import { PreviewProviderError, type PreviewFrontendPort } from '../preview-ports'
import type { CommandRunner } from './command-runner'
import { exigirSucesso, falhaDeCli, lerJson } from './preview-cli-errors'

/**
 * Frontend do Preview na Vercel (SPEC-Release-03). Transporte declarado: CLI `vercel`, JSON. Cada
 * deployment carrega a marca de posse do run (`jarvisPreviewRun`), o SHA e a identidade do
 * backend ligado a ele; a marca é o que torna reconciliação e limpeza seguras — o adapter só
 * lista e apaga o que a leva. A URL do backend entra no build e no runtime a partir **apenas** do
 * valor recebido do coordenador (o backend do próprio run).
 *
 * O token (`VERCEL_TOKEN`) vai só no ambiente do processo filho e é redigido da saída. O
 * diretório de trabalho é o projeto Vercel já vinculado (`vercel link`, uma vez pelo operador).
 */

export interface VercelPreviewConfig {
  readonly workdir: string
  readonly token: string
  /** Nome da variável que o frontend lê para falar com o backend (ex.: `VITE_API_URL`). */
  readonly apiUrlVariable: string
  readonly scope?: string
}

const BINARIO = 'vercel'
const TIMEOUT_MS = 15 * 60_000
const VARIAVEL_VALIDA = /^[A-Z][A-Z0-9_]{1,63}$/
const ID_DE_DEPLOYMENT = /^dpl_[A-Za-z0-9]{6,64}$/
const ID_DE_RUN = /^[A-Za-z0-9-]{8,64}$/
const SHA_VALIDO = /^[a-f0-9]{7,64}$/i
const HOST_DO_FRONTEND = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app$/i

interface DeploymentBruto {
  readonly meta?: unknown
  readonly target?: unknown
  readonly uid?: unknown
  readonly id?: unknown
  readonly url?: unknown
  readonly state?: unknown
  readonly readyState?: unknown
}

const hashDaUrl = (url: string): string =>
  createHash('sha256').update(url).digest('hex').slice(0, 16)

function comEsquema(url: string): string {
  return /^https?:\/\//.test(url) ? url : `https://${url}`
}

export class VercelFrontendAdapter implements PreviewFrontendPort {
  constructor(
    private readonly runner: CommandRunner,
    private readonly config: VercelPreviewConfig
  ) {
    if (!VARIAVEL_VALIDA.test(config.apiUrlVariable))
      throw new TypeError('O nome da variável de URL do backend é inválido.')
  }

  private cli(args: readonly string[], etapa: string) {
    const escopo = this.config.scope ? ['--scope', this.config.scope] : []
    return this.runner
      .run(BINARIO, [...args, ...escopo, '--non-interactive'], {
        cwd: this.config.workdir,
        env: { VERCEL_TOKEN: this.config.token },
        redact: [this.config.token],
        timeoutMs: TIMEOUT_MS
      })
      .then((resultado) => ({ resultado, etapa }))
  }

  private async listar(marcas: readonly string[], etapa: string): Promise<DeploymentBruto[]> {
    const args = ['list', ...marcas.flatMap((m) => ['--meta', m]), '--format', 'json', '--yes']
    const { resultado } = await this.cli(args, etapa)
    const bruto = lerJson(exigirSucesso(resultado, etapa), etapa)
    const lista = Array.isArray(bruto)
      ? bruto
      : ((bruto as { deployments?: unknown } | null)?.deployments ?? [])
    if (!Array.isArray(lista))
      throw new PreviewProviderError('failed', 'A lista de deployments veio em formato inesperado.')
    // O filtro `--meta` é do servidor/CLI; a posse é conferida aqui, item a item. Resposta sem
    // `meta` não prova nada — falha, em vez de tratar o projeto inteiro como "do Preview".
    const donos: DeploymentBruto[] = []
    for (const item of lista as DeploymentBruto[]) {
      if (typeof item.meta !== 'object' || item.meta === null)
        throw new PreviewProviderError(
          'incompatible-state',
          'A Vercel não devolveu a marca de posse dos deployments.'
        )
      if (String(item.target ?? '').toLowerCase() === 'production') continue
      const meta = item.meta as Record<string, unknown>
      const todas = marcas.every((m) => {
        const corte = m.indexOf('=')
        return meta[m.slice(0, corte)] === m.slice(corte + 1)
      })
      if (todas) donos.push(item)
    }
    return donos
  }

  private idDe(item: DeploymentBruto): string | null {
    const id = typeof item.uid === 'string' ? item.uid : item.id
    return typeof id === 'string' && ID_DE_DEPLOYMENT.test(id) ? id : null
  }

  async deploy(input: {
    previewRunId: string
    sourceSha: string
    backendUrl: string
  }): Promise<{ externalId: string; url: string }> {
    if (!ID_DE_RUN.test(input.previewRunId) || !SHA_VALIDO.test(input.sourceSha))
      throw new PreviewProviderError('incompatible-state', 'Identidade de Preview inválida.')
    const backend = new URL(input.backendUrl)
    if (backend.protocol !== 'https:')
      throw new PreviewProviderError('incompatible-state', 'O backend do Preview deve ser https.')
    const marcas = [
      `jarvisPreviewRun=${input.previewRunId}`,
      `jarvisSha=${input.sourceSha}`,
      `jarvisBackend=${hashDaUrl(backend.origin)}`
    ]
    // Reconcilia antes de criar: deployment pronto com a mesma identidade é reaproveitado.
    for (const item of await this.listar(marcas, 'listar deployments')) {
      const id = this.idDe(item)
      const estado = String(item.state ?? item.readyState ?? '').toUpperCase()
      if (id && typeof item.url === 'string' && estado === 'READY')
        return { externalId: id, url: this.urlDoFrontend(item.url) }
    }
    const { resultado } = await this.cli(
      [
        'deploy', '--yes', '--format', 'json',
        ...marcas.flatMap((m) => ['--meta', m]),
        '--build-env', `${this.config.apiUrlVariable}=${backend.origin}`,
        '--env', `${this.config.apiUrlVariable}=${backend.origin}`
      ], // prettier-ignore
      'implantar frontend'
    )
    const bruto = lerJson(exigirSucesso(resultado, 'implantar frontend'), 'implantar frontend') as {
      deployment?: DeploymentBruto
    } & DeploymentBruto
    const criado = bruto.deployment ?? bruto
    const id = this.idDe(criado)
    if (!id || typeof criado.url !== 'string')
      throw new PreviewProviderError('failed', 'A Vercel não devolveu a identidade do deployment.')
    return { externalId: id, url: this.urlDoFrontend(criado.url) }
  }

  /** O Preview só publica domínio da Vercel: domínio arbitrário nunca vai ao PR nem ao verificador. */
  private urlDoFrontend(url: string): string {
    const completa = comEsquema(url)
    if (!HOST_DO_FRONTEND.test(new URL(completa).hostname))
      throw new PreviewProviderError(
        'incompatible-state',
        'O frontend do Preview deve estar em um domínio vercel.app.'
      )
    return completa
  }

  async list(previewRunId: string): Promise<readonly string[]> {
    if (!ID_DE_RUN.test(previewRunId))
      throw new PreviewProviderError('incompatible-state', 'Identidade de Preview inválida.')
    const itens = await this.listar([`jarvisPreviewRun=${previewRunId}`], 'listar deployments')
    return itens.flatMap((item) => {
      const id = this.idDe(item)
      return id ? [id] : []
    })
  }

  async destroy(externalId: string): Promise<'destroyed' | 'absent'> {
    if (!ID_DE_DEPLOYMENT.test(externalId))
      throw new PreviewProviderError('incompatible-state', 'Identificador de deployment inválido.')
    const { resultado } = await this.cli(['remove', externalId, '--yes'], 'remover deployment')
    if (resultado.code === 0 && !resultado.timedOut) return 'destroyed'
    const erro = falhaDeCli(resultado, 'remover deployment')
    if (erro.code === 'not-found') return 'absent'
    throw erro
  }
}
