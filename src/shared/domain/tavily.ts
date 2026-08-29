/**
 * As capacidades da Tavily — contratos e decisões puras (SPEC-Conectores-05 e 06).
 *
 * Duas operações num adapter só, e não dois adapters: o registro é indexado por `ConnectorId`
 * (`registry.register` lança em duplicata), e `search` e `extract` são o mesmo conector, com a
 * mesma credencial e o mesmo ledger. A spec as separa em duas fatias porque são dois escopos de
 * aceite; o serviço externo é um.
 *
 * O que mora aqui: a forma de cada entrada, a validação delas, o modelo de créditos e as regras
 * de evidência — normalização de URL, dedup, hash. O que **não** mora: a chamada HTTP, que é do
 * adapter, e a decisão de retentar, que é da governança da F02.
 *
 * A divisão Search/Extract é a regra central da F06, e ela não é arbitrária: **Search descobre,
 * Extract confirma**. O snippet que a busca devolve é recorte escolhido pelo buscador para
 * ranquear, não o conteúdo da fonte — sustentar afirmação nele seria citar o índice em vez do
 * documento. É por isso que `EvidenceItem` só nasce de extração.
 */

import type { ConnectorCapability, ConnectorError } from './connectors'

/** A origem da API da Tavily. */
export const TAVILY_API_ORIGIN = 'https://api.tavily.com'

/**
 * A origem efetiva, com override de **ambiente do main**.
 *
 * Mesmo desenho e mesmas garantias de `origemDaApi` (SPEC-Conectores-04): existe para o teste de
 * integração e o E2E apontarem a um servidor local que conta requisições, é lida do processo main
 * (nenhum canal IPC a alcança), e `new URL(…).origin` descarta caminho, query e fragmento — o
 * override troca o **servidor**, nunca a rota.
 */
export function origemDaTavily(override?: string): string {
  const limpo = override?.trim()
  if (limpo === undefined || limpo === '') return TAVILY_API_ORIGIN

  try {
    const url = new URL(limpo)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : TAVILY_API_ORIGIN
  } catch {
    return TAVILY_API_ORIGIN
  }
}

/**
 * As operações declaradas ao núcleo.
 *
 * Namespaced por ponto, como o resto do projeto. As duas são `leitura`: pesquisar e extrair não
 * mudam nada no mundo, e repetir é seguro — o que também as torna retentáveis sem chave de
 * idempotência (regra da F02).
 */
export const TAVILY_OPERATIONS = {
  search: 'search.query',
  extract: 'extract.content'
} as const

export type TavilyOperation = (typeof TAVILY_OPERATIONS)[keyof typeof TAVILY_OPERATIONS]

export const TAVILY_CAPABILITIES: readonly ConnectorCapability[] = [
  {
    connector: 'tavily',
    operation: TAVILY_OPERATIONS.search,
    effect: 'leitura',
    descricao: 'Pesquisa web e mercado, devolvendo fontes com URL, domínio e data de coleta.'
  },
  {
    connector: 'tavily',
    operation: TAVILY_OPERATIONS.extract,
    effect: 'leitura',
    descricao: 'Extrai o conteúdo das fontes selecionadas e produz evidência com hash.'
  }
]

/**
 * A profundidade da busca — e o que ela custa.
 *
 * `basic` é o padrão por decisão cravada da spec: `advanced` custa o dobro de créditos, e um
 * padrão caro gasta a cota de quem não pediu. Escolher `advanced` é ato explícito.
 */
export const TAVILY_DEPTHS = ['basic', 'advanced'] as const

export type TavilyDepth = (typeof TAVILY_DEPTHS)[number]

export const PROFUNDIDADE_PADRAO: TavilyDepth = 'basic'

/** Máximo de resultados quando o chamador não escolhe. O padrão da própria API. */
export const MAX_RESULTADOS_PADRAO = 5

/**
 * Teto de resultados por pesquisa.
 *
 * Existe porque `max_results` alto não custa créditos a mais, mas engorda o payload que atravessa
 * o IPC — e o custo real aparece depois, quando alguém extrai tudo que a busca devolveu.
 */
export const MAX_RESULTADOS_TETO = 20

/** Teto de URLs por extração. A API cobra por grupo de 5; acima disso, o chamador que pagine. */
export const MAX_URLS_EXTRACT = 20

/** Entrada de `search.query`. */
export interface TavilySearchInput {
  readonly query: string
  readonly depth?: TavilyDepth
  readonly maxResults?: number
  /** Restringe a busca a estes domínios. Lista vazia ≡ ausente. */
  readonly includeDomains?: readonly string[]
  readonly excludeDomains?: readonly string[]
}

/** Entrada de `extract.content`. */
export interface TavilyExtractInput {
  readonly urls: readonly string[]
  readonly depth?: TavilyDepth
  /**
   * Intenção que reordena os trechos extraídos. Opcional, e **não** altera o que é extraído — só
   * a ordem dos pedaços dentro do conteúdo.
   */
  readonly query?: string
}

/**
 * Quantos créditos a busca consome (docs § API Credits).
 *
 * `basic` custa 1 por requisição, `advanced` custa 2. Número fixo e não estimativa estatística:
 * a Tavily cobra por chamada, não por resultado — `max_results` não muda a conta.
 */
export function creditosDaBusca(depth: TavilyDepth): number {
  return depth === 'advanced' ? 2 : 1
}

/**
 * Quantos créditos a extração **pode** consumir — a estimativa que o gate usa antes de gastar.
 *
 * A tabela da Tavily é por grupo de 5 URLs (1 crédito em `basic`, 2 em `advanced`), e aqui o
 * arredondamento é **para cima**: o gate decide sem saber quantas URLs darão certo, e
 * subestimar deixaria passar justamente a chamada que estoura a cota. Superestimar erra para o
 * lado barato — a chamada é barrada cedo demais, e o usuário ajusta o teto.
 *
 * **Não** use isto para lançar consumo no ledger: o que a Tavily cobra de fato vem no `usage`
 * da resposta, e o smoke real mostrou que os dois números divergem (veja
 * `creditosCobradosNaExtracao`).
 */
export function creditosEstimadosDaExtracao(urls: number, depth: TavilyDepth): number {
  if (urls <= 0) return 0
  const grupos = Math.ceil(urls / 5)
  return depth === 'advanced' ? grupos * 2 : grupos
}

/**
 * Quantos créditos supor quando a resposta da extração **não** traz o `usage`.
 *
 * Zero, e a razão vem do smoke real contra a API (2026-08-29): **a cobrança da extração não é
 * local à chamada**. A Tavily acumula URLs entre chamadas e cobra 1 crédito a cada 5 no total —
 * seis chamadas seguidas de 1 URL custaram `0,0,0,0,1,0`. A mesma chamada, repetida, custa 0 ou
 * 1 conforme o que veio antes dela.
 *
 * Isso torna **impossível** reconstruir o valor cobrado a partir do que esta chamada sabe:
 * qualquer fórmula sobre a contagem de URLs — `ceil`, `floor` ou média — erraria de forma
 * sistemática, e o erro se acumularia no ledger a cada chamada. Entre inventar um número e
 * assumir zero, zero é o honesto: o `usage` da resposta é a única fonte verdadeira, e ele
 * praticamente sempre vem (pedimos `include_usage: true`).
 *
 * O que **protege a cota** neste desenho não é este fallback, é o gate: ele usa
 * `creditosEstimadosDaExtracao`, que arredonda para cima e roda antes de a chamada sair.
 */
export function creditosCobradosNaExtracao(): number {
  return 0
}

/**
 * Uma fonte que a busca encontrou.
 *
 * `url` é a canônica (normalizada) e `urlOriginal` é o que a Tavily devolveu — as duas, sempre,
 * porque o critério 3 da F05 exige normalizar **sem perder** o original. Guardar só a canônica
 * impediria reproduzir a chamada; guardar só a original impediria deduplicar.
 *
 * `trecho` é o snippet do buscador, e o nome diz o que ele é: recorte para ranqueamento, não
 * conteúdo da fonte. Ele **não** sustenta afirmação (regra da F06) — quem sustenta é a evidência
 * extraída.
 */
export interface TavilySource {
  readonly titulo: string
  readonly url: string
  readonly urlOriginal: string
  readonly dominio: string
  readonly trecho: string
  /** Relevância declarada pela Tavily, quando ela fornece. */
  readonly score?: number
  /** Data de publicação, quando a fonte a expõe. Distinta da data de coleta. */
  readonly publicadoEm?: string
  /** Quando **nós** coletamos — sempre presente, porque é fato nosso, não da fonte. */
  readonly coletadoEm: string
}

/** O que `search.query` devolve. */
export interface TavilySearchData {
  readonly query: string
  readonly fontes: readonly TavilySource[]
  /** O identificador que a Tavily dá à requisição — é o que liga nosso rastro ao dela. */
  readonly requestId?: string
  /** Fontes descartadas por serem duplicata canônica de outra já presente. */
  readonly duplicadasDescartadas: number
}

/**
 * Um item de evidência: o conteúdo extraído de uma fonte, com o que o torna verificável.
 *
 * **Dois hashes** (decisão cravada da spec), e a razão é que eles respondem perguntas
 * diferentes: `hashConteudo` cobre o conteúdo inteiro e detecta que **a fonte mudou** entre
 * revisões; `hashTrecho` cobre o pedaço citado e prova que **a citação corresponde** ao que foi
 * extraído. Com um hash só, "a fonte mudou" e "a citação está errada" seriam o mesmo alarme.
 */
export interface EvidenceItem {
  readonly url: string
  readonly urlOriginal: string
  readonly dominio: string
  readonly titulo?: string
  readonly publicadoEm?: string
  readonly coletadoEm: string
  /** O conteúdo extraído. É ele que vai ao arquivo de artefato; aqui viaja para ser hasheado. */
  readonly conteudo: string
  readonly hashConteudo: string
  /** O trecho efetivamente citado, quando há um. */
  readonly trecho?: string
  readonly hashTrecho?: string
  readonly requestId?: string
}

/** Uma URL que a extração não conseguiu ler. */
export interface EvidenceFailure {
  readonly url: string
  /** O que a Tavily disse. Texto do serviço, tratado como dado — nunca como instrução. */
  readonly motivo: string
}

/**
 * O que `extract.content` devolve.
 *
 * Sucessos e falhas **lado a lado**, e não uma exceção quando alguma URL falha: é o critério 3 da
 * F06 — falha parcial preserva as válidas e identifica as ausentes. Derrubar a chamada inteira
 * porque uma fonte de cinco caiu descartaria quatro extrações já pagas.
 */
export interface TavilyExtractData {
  readonly evidencias: readonly EvidenceItem[]
  readonly falhas: readonly EvidenceFailure[]
  readonly requestId?: string
  /** Itens descartados por serem duplicata (mesma URL canônica **e** mesmo hash de conteúdo). */
  readonly duplicadasDescartadas: number
}

/**
 * Normaliza uma URL para comparação, **sem perder a original**.
 *
 * O que se remove é o que não muda o documento: esquema em minúscula, host em minúscula, `www.`
 * inicial, porta padrão, barra final, fragmento (`#secao` é posição na página, não outra página)
 * e os parâmetros de rastreamento que campanhas grudam na URL. O que **não** se remove é
 * qualquer outra query string: `?id=42` costuma escolher o documento, e limpá-la fundiria duas
 * páginas distintas — o erro que o critério 4 da F06 proíbe.
 *
 * Devolve a entrada crua quando ela não é uma URL absoluta válida. Normalizar o que não se
 * entende seria inventar uma canônica.
 */
export function normalizarUrl(bruta: string): string {
  let url: URL
  try {
    url = new URL(bruta)
  } catch {
    return bruta
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return bruta

  url.hash = ''
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')

  for (const parametro of PARAMETROS_DE_RASTREIO) url.searchParams.delete(parametro)

  // `searchParams.delete` deixa o `?` órfão quando esvazia a query; removê-lo evita que
  // `a.com?` e `a.com` sejam canônicas diferentes.
  const texto = url.toString().replace(/\?$/, '')

  // Barra final só some do caminho raiz para cima; `https://a.com/` e `https://a.com` são o
  // mesmo documento, e `/docs/` e `/docs` também o são em todo servidor que redireciona.
  return texto.endsWith('/') ? texto.slice(0, -1) : texto
}

/**
 * Parâmetros de query que são rastreamento de campanha, não identidade do documento.
 *
 * Lista fechada e curta de propósito: remover por heurística (“tudo que começa com `utm`”) já
 * seria palpite, e remover query desconhecida fundiria documentos distintos.
 */
const PARAMETROS_DE_RASTREIO = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'mc_cid',
  'mc_eid',
  'ref_src'
]

/** O domínio de uma URL, sem `www.`. Cadeia vazia quando a entrada não é URL absoluta. */
export function dominioDe(bruta: string): string {
  try {
    return new URL(bruta).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Valida a entrada de uma operação, sem tocar a rede (critério 2 da F01).
 *
 * Devolve a mensagem do problema, ou `undefined` — mensagem e não `ConnectorError`, porque quem
 * monta o erro completo é o adapter, que tem a proveniência.
 */
export function validarEntrada(operation: string, input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) {
    return 'A operação exige um objeto de entrada.'
  }

  const v = input as Record<string, unknown>

  const profundidadeInvalida = validarProfundidade(v.depth)
  if (profundidadeInvalida !== undefined) return profundidadeInvalida

  switch (operation) {
    case TAVILY_OPERATIONS.search:
      return validarBusca(v)

    case TAVILY_OPERATIONS.extract:
      return validarExtracao(v)

    default:
      return `Operação "${operation}" não pertence ao conector Tavily.`
  }
}

function validarProfundidade(depth: unknown): string | undefined {
  if (depth === undefined) return undefined
  return (TAVILY_DEPTHS as readonly unknown[]).includes(depth)
    ? undefined
    : '`depth` precisa ser "basic" ou "advanced".'
}

function validarBusca(v: Record<string, unknown>): string | undefined {
  if (typeof v.query !== 'string' || v.query.trim() === '') {
    return 'Informe `query` — a pesquisa precisa de um termo.'
  }

  if (v.maxResults !== undefined) {
    const max = v.maxResults
    if (typeof max !== 'number' || !Number.isInteger(max) || max < 1 || max > MAX_RESULTADOS_TETO) {
      return `\`maxResults\` precisa ser um inteiro entre 1 e ${MAX_RESULTADOS_TETO}.`
    }
  }

  for (const campo of ['includeDomains', 'excludeDomains'] as const) {
    const lista = v[campo]
    if (lista === undefined) continue
    if (!Array.isArray(lista) || lista.some((d) => typeof d !== 'string' || d.trim() === '')) {
      return `\`${campo}\` precisa ser uma lista de domínios não vazios.`
    }
  }

  return undefined
}

function validarExtracao(v: Record<string, unknown>): string | undefined {
  const urls = v.urls
  if (!Array.isArray(urls) || urls.length === 0) {
    return 'Informe `urls` — a extração precisa de ao menos uma fonte.'
  }

  if (urls.length > MAX_URLS_EXTRACT) {
    return `A extração aceita no máximo ${MAX_URLS_EXTRACT} URLs por chamada.`
  }

  for (const url of urls) {
    if (typeof url !== 'string' || !ehUrlHttp(url)) {
      return 'Cada item de `urls` precisa ser uma URL http(s) absoluta.'
    }
  }

  if (v.query !== undefined && (typeof v.query !== 'string' || v.query.trim() === '')) {
    return '`query` de extração, quando informada, precisa ser um texto não vazio.'
  }

  return undefined
}

/**
 * A cadeia é uma URL http(s) absoluta?
 *
 * Recusar o que não é http(s) não é formalidade: `file:///etc/passwd` é URL válida para o
 * construtor, e repassá-la a um extrator seria pedir a leitura de um caminho local por uma
 * entrada que veio de fora.
 */
export function ehUrlHttp(valor: string): boolean {
  try {
    const url = new URL(valor)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * O erro de "a Tavily respondeu, mas sem nada utilizável".
 *
 * Fábrica própria porque o desfecho é específico e a ação também: uma busca que volta sem fontes
 * **não** é falha do serviço — é resposta legítima a um termo sem cobertura. O que ela não pode
 * fazer é virar sucesso vazio que o chamador leia como "não existe nada sobre isso", nem ser
 * preenchida por memória do modelo (critério 5 da F05).
 */
export function erroDeBuscaSemFontes(query: string, obtidoEm: string): ConnectorError {
  return {
    ok: false,
    code: 'resposta-invalida',
    mensagem:
      `A pesquisa por "${query}" não devolveu nenhuma fonte utilizável. ` +
      'Refine o termo ou amplie os domínios — nada aqui pode ser preenchido de memória.',
    retryable: false,
    acao: 'corrigir-entrada',
    provenance: { connector: 'tavily', operation: TAVILY_OPERATIONS.search, obtidoEm }
  }
}
