import type { ReleaseEnvironment } from '@shared/domain/release'
import { PromotionProviderError, type PromotionDatabasePort } from '../promotion-ports'

/**
 * Backup do PostgreSQL de Staging/Produção por backup nativo do volume, via API GraphQL pública do
 * Railway (SPEC-Release-04, decisão 1). A CLI do Railway não tem comando de backup, e o dado de
 * Produção não pode sair do provedor (nada de `pg_dump` para o disco local).
 *
 * Fluxo: resolve o ambiente pelo nome e o `volumeInstanceId` do banco → lista os backups que já
 * existem → cria o backup → espera um id que não estava na lista aparecer. O id novo é a
 * `backupRef`; comparar o conjunto de ids antes/depois impede confundir um backup antigo (ou o de
 * uma agenda do Railway) com o que esta chamada pediu.
 *
 * O token vai só no header da requisição. Cada requisição tem prazo próprio, não segue
 * redirecionamento e lê no máximo um teto de bytes. Erro é sempre `PromotionProviderError` com
 * código fechado: a mensagem do provedor (que pode ecoar token ou ids) nunca vira motivo.
 *
 * Esquema da API NÃO validado contra uma conta real: toda consulta fica nas constantes abaixo,
 * para a correção, se o smoke com o projeto de prova achar divergência, ser num só lugar.
 */

const ENDPOINT = 'https://backboard.railway.com/graphql/v2'

// Documentado em docs.railway.com/integrations/api/manage-environments.
const QUERY_AMBIENTES = `query environments($projectId: String!) {
  environments(projectId: $projectId) { edges { node { id name } } }
}`

// `project.volumes` é documentado; `volumeInstances`/`environmentId` dentro dele NÃO estão na
// documentação (o esquema vem da introspecção do dashboard) e são premissa a validar.
const QUERY_VOLUMES = `query projectVolumes($projectId: String!) {
  project(id: $projectId) {
    volumes { edges { node {
      id
      name
      volumeInstances { edges { node { id environmentId serviceInstance { serviceName } } } }
    } } }
  }
}`

// Documentado em manage-volumes#volume-backups. A listagem não documenta campo de status.
const QUERY_LISTAR_BACKUPS = `query volumeInstanceBackupList($volumeInstanceId: String!) {
  volumeInstanceBackupList(volumeInstanceId: $volumeInstanceId) { id name createdAt }
}`

// Documentado: devolve só um booleano, sem o id do backup criado.
const MUTATION_CRIAR_BACKUP = `mutation volumeInstanceBackupCreate($volumeInstanceId: String!) {
  volumeInstanceBackupCreate(volumeInstanceId: $volumeInstanceId)
}`

const REF_VALIDA = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const TETO_DA_RESPOSTA = 1024 * 1024
const PRAZO_POR_REQUISICAO_MS = 30_000
const PRAZO_DO_BACKUP_MS = 10 * 60_000
const INTERVALO_MS = 5_000

const AUTENTICACAO = /not authorized|unauthori[sz]ed|unauthenticated|invalid.*token|forbidden/i
const COTA = /rate.?limit|too many|quota/i
const NAO_ENCONTRADO = /not found|does not exist/i

export interface RailwayBackupConfig {
  readonly token: string
  readonly projectId: string
  /** Nome do serviço PostgreSQL no projeto (o mesmo em todos os ambientes). */
  readonly databaseService: string
  /** Nome do ambiente no Railway para cada ambiente de release; ausente = não configurado. */
  readonly environments: Readonly<Partial<Record<ReleaseEnvironment, string>>>
  readonly timeoutMs?: number
  readonly intervalMs?: number
  readonly requestTimeoutMs?: number
  readonly fetch?: typeof fetch
  readonly sleep?: (ms: number) => Promise<void>
  readonly now?: () => number
}

type Json = Record<string, unknown>

const isJson = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

function inesperado(): PromotionProviderError {
  return new PromotionProviderError('failed', 'A API do Railway devolveu uma resposta inesperada.')
}

/** Nós de uma conexão GraphQL (`edges[].node`); forma diferente é resposta inesperada. */
function nodes(conexao: unknown): Json[] {
  if (!isJson(conexao) || !Array.isArray(conexao.edges)) throw inesperado()
  return conexao.edges.map((edge: unknown) => {
    if (!isJson(edge) || !isJson(edge.node)) throw inesperado()
    return edge.node
  })
}

interface BackupBruto {
  readonly id: string
  readonly createdAt: number
}

function lerBackups(dados: unknown): BackupBruto[] {
  if (!Array.isArray(dados)) throw inesperado()
  return dados.map((b: unknown) => {
    if (!isJson(b) || typeof b.id !== 'string' || !b.id) throw inesperado()
    const criado = typeof b.createdAt === 'string' ? Date.parse(b.createdAt) : Number.NaN
    return { id: b.id, createdAt: Number.isNaN(criado) ? 0 : criado }
  })
}

export class RailwayBackupAdapter implements Pick<PromotionDatabasePort, 'backup'> {
  private readonly http: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number
  private readonly timeoutMs: number
  private readonly intervalMs: number
  private readonly requestTimeoutMs: number

  constructor(private readonly config: RailwayBackupConfig) {
    if (!config.token || !config.projectId || !config.databaseService)
      throw new TypeError('A configuração do backup do Railway está incompleta.')
    this.http = config.fetch ?? fetch
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.now = config.now ?? Date.now
    this.timeoutMs = config.timeoutMs ?? PRAZO_DO_BACKUP_MS
    this.intervalMs = config.intervalMs ?? INTERVALO_MS
    this.requestTimeoutMs = config.requestTimeoutMs ?? PRAZO_POR_REQUISICAO_MS
  }

  async backup(input: { environment: ReleaseEnvironment }): Promise<{ backupRef: string }> {
    const nomeDoAmbiente = this.config.environments[input.environment]
    if (!nomeDoAmbiente)
      throw new PromotionProviderError(
        'incompatible-state',
        'O ambiente não está configurado para backup.'
      )
    const volumeInstanceId = await this.volumeDoBanco(nomeDoAmbiente)
    const antes = new Set((await this.listar(volumeInstanceId)).map((b) => b.id))
    await this.criar(volumeInstanceId)
    return { backupRef: await this.esperarNovo(volumeInstanceId, antes) }
  }

  private async volumeDoBanco(nomeDoAmbiente: string): Promise<string> {
    const { projectId, databaseService } = this.config
    const ambientes = nodes((await this.gql(QUERY_AMBIENTES, { projectId })).environments)
    const ambiente = ambientes.find((a) => a.name === nomeDoAmbiente)
    if (!ambiente)
      throw new PromotionProviderError('not-found', 'Ambiente do Railway não encontrado.')
    if (typeof ambiente.id !== 'string' || !ambiente.id) throw inesperado()

    const projeto = (await this.gql(QUERY_VOLUMES, { projectId })).project
    if (!isJson(projeto)) throw inesperado()
    const instancias = nodes(projeto.volumes).flatMap((v) => nodes(v.volumeInstances))
    const doBanco = instancias.filter(
      (i) =>
        i.environmentId === ambiente.id &&
        isJson(i.serviceInstance) &&
        i.serviceInstance.serviceName === databaseService
    )
    // Dois volumes no mesmo serviço e ambiente: não há como saber qual é o do banco.
    if (doBanco.length > 1)
      throw new PromotionProviderError('incompatible-state', 'Mais de um volume para o banco.')
    const id = doBanco[0]?.id
    if (doBanco.length === 0)
      throw new PromotionProviderError('not-found', 'Volume do banco não encontrado.')
    if (typeof id !== 'string' || !id) throw inesperado()
    return id
  }

  private async listar(volumeInstanceId: string): Promise<BackupBruto[]> {
    const dados = await this.gql(QUERY_LISTAR_BACKUPS, { volumeInstanceId })
    return lerBackups(dados.volumeInstanceBackupList)
  }

  /** Mutation não é repetida: um 200 significa que rodou, e repetir criaria outro backup. */
  private async criar(volumeInstanceId: string): Promise<void> {
    const dados = await this.gql(MUTATION_CRIAR_BACKUP, { volumeInstanceId })
    if (dados.volumeInstanceBackupCreate !== true)
      throw new PromotionProviderError('failed', 'O Railway não confirmou a criação do backup.')
  }

  /**
   * A API não devolve o id do backup criado; o novo é o id que não estava na listagem anterior
   * (o mais recente, se uma agenda do Railway criou outro no mesmo intervalo). Aparecer na
   * listagem é a confirmação: não há campo de status documentado para checar.
   */
  private async esperarNovo(volumeInstanceId: string, antes: ReadonlySet<string>): Promise<string> {
    const limite = this.now() + this.timeoutMs
    for (;;) {
      const novos = (await this.listar(volumeInstanceId)).filter((b) => !antes.has(b.id))
      if (novos.length > 0) {
        const maisRecente = novos.reduce((a, b) => (b.createdAt > a.createdAt ? b : a))
        if (!REF_VALIDA.test(maisRecente.id)) throw inesperado()
        return maisRecente.id
      }
      if (this.now() + this.intervalMs > limite)
        throw new PromotionProviderError('timeout', 'O backup não ficou pronto a tempo.')
      await this.sleep(this.intervalMs)
    }
  }

  /** Uma consulta GraphQL; devolve `data` ou lança erro de código fechado. */
  private async gql(query: string, variables: Json): Promise<Json> {
    const resposta = await this.enviar(query, variables)
    if (resposta.status === 401 || resposta.status === 403)
      throw new PromotionProviderError('auth', 'Autenticação recusada pelo Railway.')
    if (resposta.status === 429)
      throw new PromotionProviderError('quota', 'Cota da API do Railway esgotada.')
    const texto = await this.lerTexto(resposta)
    if (!resposta.ok) throw classificar(texto, resposta.status)
    const corpo = parseJson(texto)
    if (isJson(corpo) && Array.isArray(corpo.errors) && corpo.errors.length > 0)
      throw classificar(texto, resposta.status)
    if (!isJson(corpo) || !isJson(corpo.data)) throw inesperado()
    return corpo.data
  }

  private async enviar(query: string, variables: Json): Promise<Response> {
    try {
      return await this.http(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.token}`
        },
        body: JSON.stringify({ query, variables }),
        redirect: 'error',
        signal: AbortSignal.timeout(this.requestTimeoutMs)
      })
    } catch (erro) {
      // O erro de rede pode carregar a URL/headers; só o tipo da falha sai daqui.
      const nome = erro instanceof Error ? erro.name : ''
      if (nome === 'TimeoutError' || nome === 'AbortError')
        throw new PromotionProviderError('timeout', 'A API do Railway excedeu o tempo limite.')
      throw new PromotionProviderError('failed', 'Não foi possível falar com a API do Railway.')
    }
  }

  /** Lê o corpo até o teto; passou do teto é recusa, não leitura parcial. */
  private async lerTexto(resposta: Response): Promise<string> {
    if (!resposta.body) return ''
    const leitor = resposta.body.getReader()
    const partes: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await leitor.read()
      if (done) break
      total += value.byteLength
      if (total > TETO_DA_RESPOSTA) {
        await leitor.cancel().catch(() => undefined)
        throw inesperado()
      }
      partes.push(value)
    }
    return Buffer.concat(partes).toString('utf8')
  }
}

function parseJson(texto: string): unknown {
  try {
    return JSON.parse(texto) as unknown
  } catch {
    return undefined
  }
}

/**
 * Classifica uma falha GraphQL (HTTP 200 com `errors[]`, ou 4xx/5xx) num código fechado. Só o
 * texto das mensagens decide o código; ele nunca é copiado para a mensagem do erro.
 */
function classificar(texto: string, status: number): PromotionProviderError {
  const corpo = parseJson(texto)
  const erros = isJson(corpo) && Array.isArray(corpo.errors) ? corpo.errors : []
  const mensagens = erros
    .map((e: unknown) => {
      if (!isJson(e)) return ''
      const codigo = isJson(e.extensions) ? String(e.extensions.code ?? '') : ''
      return `${String(e.message ?? '')} ${codigo}`
    })
    .join('\n')
  if (AUTENTICACAO.test(mensagens))
    return new PromotionProviderError('auth', 'Autenticação recusada pelo Railway.')
  if (COTA.test(mensagens))
    return new PromotionProviderError('quota', 'Cota da API do Railway esgotada.')
  if (NAO_ENCONTRADO.test(mensagens))
    return new PromotionProviderError('not-found', 'Recurso não encontrado no Railway.')
  return new PromotionProviderError(
    'failed',
    `A API do Railway recusou a operação (HTTP ${status}).`
  )
}
