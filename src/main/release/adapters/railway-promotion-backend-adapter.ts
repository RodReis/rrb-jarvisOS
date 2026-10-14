import type { ReleaseEnvironment } from '@shared/domain/release'
import { PromotionProviderError, type PromotionBackendPort } from '../promotion-ports'
import type { CommandRunner } from './command-runner'
import { exigirSucesso, lerJson } from './preview-cli-errors'

/**
 * Backend dos ambientes persistentes Staging e Produção no Railway (SPEC-Release-04). Transporte
 * declarado: CLI `railway`, JSON. Os dois ambientes já existem (criados pelo operador), cada um
 * com o serviço de backend e um PostgreSQL próprio; este adapter só troca a imagem do serviço.
 *
 * Comandos usados (CLI 5.27, confirmados por `--help`):
 *  - `railway deployment list --service S --environment E --json --limit N` — leitura.
 *  - `railway environment edit --environment E --service-config S source.image <repo@digest>
 *    --service-config S variables.<NOME>.value <valor> ... --json` — implanta.
 *
 * Por que `environment edit` e não `variable set` + `redeploy`: imagem e identidade da release
 * (`RELEASE_ID`, `RELEASE_SOURCE_SHA`) entram no MESMO commit de configuração, então nasce um
 * único deployment que já carrega as duas coisas; `variable set` dispararia um deploy próprio e
 * `redeploy` só repete o deployment mais recente. O mesmo comando já é o do Preview (F03).
 *
 * Rollback: a CLI 5.27 não tem "voltar para o deployment X" (`railway redeploy` repete apenas o
 * mais recente, `railway up` sobe a árvore local). Como o backend é sempre imagem por digest, o
 * deployment alvo é identificado pela imagem que sua `meta` registra e o ambiente é reapontado
 * para ela; o resultado é o mesmo artefato imutável que a pipeline já provou saudável.
 *
 * O token (`RAILWAY_API_TOKEN`) vai só no ambiente do processo filho, nunca em argumento, e é
 * redigido da saída. O diretório de trabalho precisa estar vinculado ao projeto (`railway link`).
 */

export interface RailwayPromotionBackendConfig {
  /** Pasta já vinculada ao projeto Railway dos ambientes persistentes. */
  readonly workdir: string
  readonly token: string
  /** Nomes exatos dos ambientes no Railway; qualquer outro nome é recusado. */
  readonly environments: { readonly staging: string; readonly production: string }
  readonly backendService: string
  /** Prazo para o deployment chegar a SUCCESS. Padrão: 10 minutos. */
  readonly deployTimeoutMs?: number
  /** Intervalo entre listagens enquanto espera. Padrão: 5 segundos. */
  readonly pollIntervalMs?: number
  /** Relógio injetável: os testes não esperam de verdade. */
  readonly sleep?: (ms: number) => Promise<void>
  readonly now?: () => number
}

const BINARIO = 'railway'
const TIMEOUT_DA_CLI_MS = 2 * 60_000
const PRAZO_PADRAO_MS = 10 * 60_000
const INTERVALO_PADRAO_MS = 5_000
const LIMITE_DA_LISTAGEM = 50
const PROFUNDIDADE_DA_META = 6
/** Imagem só por digest: tag é mutável e quebraria "o mesmo artefato nos dois ambientes". */
const IMAGEM_POR_DIGEST = /^[a-z0-9][a-z0-9._/:-]*@(sha256:[a-f0-9]{64})$/
const ID_DE_RELEASE = /^[A-Za-z0-9._:-]{1,128}$/
const SHA_VALIDO = /^[a-f0-9]{7,64}$/i
const FALHAS_DE_DEPLOY = new Set(['FAILED', 'CRASHED', 'REMOVED'])
/** Deployment que nunca subiu bem não é destino de rollback. */
const STATUS_SEM_ROLLBACK = new Set(['FAILED', 'CRASHED'])

interface Implantacao {
  readonly id: string
  readonly status: string
  readonly createdAt: number
  readonly meta: unknown
}

interface Imagem {
  readonly uri: string
  readonly digest: string
}

const dormir = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Procura o campo `image` na meta; a profundidade limitada evita seguir estrutura inesperada. */
function imagemDaMeta(meta: unknown, profundidade = PROFUNDIDADE_DA_META): Imagem | null {
  if (profundidade === 0 || typeof meta !== 'object' || meta === null) return null
  const registro = meta as Record<string, unknown>
  const direta = registro.image
  if (typeof direta === 'string') {
    const digest = IMAGEM_POR_DIGEST.exec(direta)?.[1]
    if (digest) return { uri: direta, digest }
  }
  for (const valor of Object.values(registro)) {
    const achada = imagemDaMeta(valor, profundidade - 1)
    if (achada) return achada
  }
  return null
}

function lerImplantacoes(stdout: string): Implantacao[] {
  const bruto = lerJson({ code: 0, stdout, stderr: '', timedOut: false }, 'listar deployments')
  const lista = Array.isArray(bruto)
    ? bruto
    : ((bruto as { deployments?: unknown } | null)?.deployments ?? null)
  if (!Array.isArray(lista))
    throw new PromotionProviderError('failed', 'A lista de deployments veio em formato inesperado.')
  const itens = (lista as unknown[]).map((item): Implantacao => {
    const { id, status, createdAt, meta } = (item ?? {}) as Record<string, unknown>
    if (typeof id !== 'string' || !id || typeof status !== 'string' || !status)
      throw new PromotionProviderError('failed', 'Um deployment veio sem id ou status.')
    const quando = typeof createdAt === 'string' ? Date.parse(createdAt) : NaN
    return { id, status, createdAt: Number.isNaN(quando) ? 0 : quando, meta }
  })
  // Ordem da CLI não é contrato: o mais recente vem primeiro. Sort estável preserva a ordem
  // original quando a listagem não traz datas.
  return itens.sort((a, b) => b.createdAt - a.createdAt)
}

export class RailwayPromotionBackendAdapter implements PromotionBackendPort {
  private readonly prazoMs: number
  private readonly intervaloMs: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number

  constructor(
    private readonly runner: CommandRunner,
    private readonly config: RailwayPromotionBackendConfig
  ) {
    const { staging, production } = config.environments
    if (!staging || !production || staging === production)
      throw new TypeError(
        'Staging e Produção precisam de nomes de ambiente distintos e não vazios.'
      )
    this.prazoMs = config.deployTimeoutMs ?? PRAZO_PADRAO_MS
    this.intervaloMs = config.pollIntervalMs ?? INTERVALO_PADRAO_MS
    this.sleep = config.sleep ?? dormir
    this.now = config.now ?? Date.now
  }

  async deploy(input: {
    environment: ReleaseEnvironment
    imageUri: string
    releaseId: string
    sourceSha: string
  }): Promise<{ deploymentId: string }> {
    const ambiente = this.nomeDoAmbiente(input.environment)
    const imagem = IMAGEM_POR_DIGEST.exec(input.imageUri)
    if (!imagem)
      throw new PromotionProviderError(
        'incompatible-state',
        'O backend só implanta imagem por digest.'
      )
    if (!ID_DE_RELEASE.test(input.releaseId) || !SHA_VALIDO.test(input.sourceSha))
      throw new PromotionProviderError('incompatible-state', 'Identidade de release inválida.')

    const existentes = await this.listar(ambiente)
    const corrente = existentes.find((d) => d.status === 'SUCCESS')
    // Reconcilia antes de mutar: o ambiente que já serve este digest não ganha outro deployment.
    if (corrente && imagemDaMeta(corrente.meta)?.digest === imagem[1])
      return { deploymentId: corrente.id }

    await this.aplicarImagem(ambiente, input.imageUri, {
      RELEASE_ID: input.releaseId,
      RELEASE_SOURCE_SHA: input.sourceSha
    })
    return { deploymentId: await this.esperarNovo(ambiente, existentes) }
  }

  async rollback(input: {
    environment: ReleaseEnvironment
    toDeploymentId: string
  }): Promise<void> {
    const ambiente = this.nomeDoAmbiente(input.environment)
    const existentes = await this.listar(ambiente)
    const alvo = existentes.find((d) => d.id === input.toDeploymentId)
    if (!alvo) throw new PromotionProviderError('not-found', 'O deployment de rollback não existe.')
    if (STATUS_SEM_ROLLBACK.has(alvo.status))
      throw new PromotionProviderError(
        'incompatible-state',
        'O deployment de rollback nunca esteve saudável.'
      )
    const imagem = imagemDaMeta(alvo.meta)
    if (!imagem)
      throw new PromotionProviderError(
        'incompatible-state',
        'O deployment de rollback não registra imagem por digest.'
      )
    const corrente = existentes.find((d) => d.status === 'SUCCESS')
    if (corrente && imagemDaMeta(corrente.meta)?.digest === imagem.digest) return
    // Só a imagem muda: a identidade da release anterior não é conhecida por este adapter.
    await this.aplicarImagem(ambiente, imagem.uri, {})
    await this.esperarNovo(ambiente, existentes)
  }

  async current(
    environment: ReleaseEnvironment
  ): Promise<{ deploymentId: string; digest: string } | null> {
    const ambiente = this.nomeDoAmbiente(environment)
    // O mais recente em SUCCESS é o que serve: o Railway aposenta (REMOVED) o anterior.
    const corrente = (await this.listar(ambiente)).find((d) => d.status === 'SUCCESS')
    if (!corrente) return null
    const imagem = imagemDaMeta(corrente.meta)
    // Digest ilegível não é "ambiente vazio": devolver null faria o reconciliador reimplantar às cegas.
    if (!imagem)
      throw new PromotionProviderError('failed', 'O deployment corrente não registra o digest.')
    return { deploymentId: corrente.id, digest: imagem.digest }
  }

  /** Lista de permissão: só os dois nomes configurados chegam à CLI. */
  private nomeDoAmbiente(environment: ReleaseEnvironment): string {
    if (environment !== 'staging' && environment !== 'production')
      throw new PromotionProviderError('incompatible-state', 'Ambiente fora de Staging e Produção.')
    return this.config.environments[environment]
  }

  private cli(args: readonly string[], etapa: string) {
    return this.runner
      .run(BINARIO, args, {
        cwd: this.config.workdir,
        env: { RAILWAY_API_TOKEN: this.config.token },
        redact: [this.config.token],
        timeoutMs: TIMEOUT_DA_CLI_MS
      })
      .then((resultado) => exigirSucesso(resultado, etapa))
  }

  private async listar(ambiente: string): Promise<Implantacao[]> {
    const r = await this.cli(
      [
        'deployment', 'list',
        '--service', this.config.backendService,
        '--environment', ambiente,
        '--limit', String(LIMITE_DA_LISTAGEM), '--json'
      ], // prettier-ignore
      'listar deployments'
    )
    return lerImplantacoes(r.stdout)
  }

  private async aplicarImagem(
    ambiente: string,
    imageUri: string,
    variaveis: Readonly<Record<string, string>>
  ): Promise<void> {
    const svc = this.config.backendService
    const configuracao = [
      ['source.image', imageUri],
      ...Object.entries(variaveis).map(([nome, valor]) => [`variables.${nome}.value`, valor])
    ].flatMap(([caminho, valor]) => ['--service-config', svc, caminho, valor])
    await this.cli(
      ['environment', 'edit', '--environment', ambiente, ...configuracao, '--json'],
      'implantar backend'
    )
  }

  /**
   * Espera o deployment criado pela edição (o mais recente que não existia antes) chegar a
   * SUCCESS. Deployments antigos nunca entram no veredito; estouro de prazo é `timeout`.
   */
  private async esperarNovo(ambiente: string, anteriores: readonly Implantacao[]): Promise<string> {
    const conhecidos = new Set(anteriores.map((d) => d.id))
    const limite = this.now() + this.prazoMs
    for (;;) {
      const novo = (await this.listar(ambiente)).find((d) => !conhecidos.has(d.id))
      if (novo?.status === 'SUCCESS') return novo.id
      if (novo && FALHAS_DE_DEPLOY.has(novo.status))
        throw new PromotionProviderError('failed', 'O deployment do backend não ficou saudável.')
      if (this.now() >= limite)
        throw new PromotionProviderError('timeout', 'O deployment do backend excedeu o prazo.')
      await this.sleep(this.intervaloMs)
    }
  }
}
