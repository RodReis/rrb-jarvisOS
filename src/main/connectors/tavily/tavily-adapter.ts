/**
 * O adapter da Tavily (SPEC-Conectores-05 e 06).
 *
 * Duas operações num adapter só — `search.query` e `extract.content` — porque o registro é
 * indexado por `ConnectorId` e registrar dois `id: 'tavily'` faria `ConnectorRegistry.register`
 * lançar. Search e Extract são o mesmo serviço, com a mesma credencial e o mesmo ledger; o que a
 * spec separa em duas fatias são dois escopos de aceite, não dois conectores.
 *
 * Ao contrário do GitHub, este adapter **implementa `custoEstimado`**: a Tavily cobra créditos, e
 * é essa estimativa que ativa o gate da F02 antes de a chamada sair. O consumo **real** volta no
 * `ConnectorUsage` do resultado, e é ele que entra no ledger — a diferença entre os dois importa
 * na extração, onde a Tavily não cobra por URL que falhou (critério 5 da F06: Search e Extract
 * com custos atribuídos separadamente, cada um no ledger com o que de fato consumiu).
 */

import type {
  ConnectorCapability,
  ConnectorError,
  ConnectorId,
  ConnectorResult
} from '@shared/domain/connectors'
import {
  MAX_RESULTADOS_PADRAO,
  PROFUNDIDADE_PADRAO,
  TAVILY_CAPABILITIES,
  TAVILY_OPERATIONS,
  creditosDaBusca,
  creditosDaExtracao,
  dominioDe,
  erroDeBuscaSemFontes,
  normalizarUrl,
  origemDaTavily,
  validarEntrada,
  type EvidenceFailure,
  type TavilyDepth,
  type TavilyExtractData,
  type TavilyExtractInput,
  type TavilySearchData,
  type TavilySearchInput,
  type TavilySource
} from '@shared/domain/tavily'
import type { ConnectorAdapter, ConnectorExecution } from '../adapter'
import { deduplicar, montarEvidencia, type ExtracaoCrua } from './evidencia'
import {
  FalhaTavily,
  TavilyRest,
  lista,
  numero,
  texto,
  type BuscadorHttp,
  type Registro
} from './tavily-rest'

export class TavilyAdapter implements ConnectorAdapter {
  readonly id: ConnectorId = 'tavily'

  constructor(
    /** Injetável para o teste não tocar a rede, como no adapter do GitHub. */
    private readonly buscar: BuscadorHttp = (url, init) => fetch(url, init),
    private readonly agora: () => number = () => Date.now(),
    /**
     * A origem da API. Lida do **ambiente do main**, como a do GitHub: existe para o teste de
     * integração e o E2E apontarem a um servidor local que conta requisições, e nenhum canal IPC
     * a alcança.
     */
    private readonly origem: string = origemDaTavily(process.env.TAVILY_API_ORIGIN)
  ) {}

  capacidades(): readonly ConnectorCapability[] {
    return TAVILY_CAPABILITIES
  }

  /**
   * Valida o **input** da operação, antes de qualquer I/O (critério 2 da F01).
   *
   * **Credencial não se confere aqui.** O `ConnectorService` chama `validar` no passo 3 e só
   * resolve o cofre no passo 6, de propósito — então `execution.secret` está sempre ausente neste
   * ponto, e uma guarda de credencial recusaria toda chamada. Foi o defeito que o E2E da F04
   * encontrou no adapter do GitHub, e a lição está registrada lá.
   */
  validar(execution: ConnectorExecution): ConnectorError | undefined {
    const problema = validarEntrada(execution.request.operation, execution.request.input)
    if (problema === undefined) return undefined

    return {
      ok: false,
      code: 'validacao-invalida',
      mensagem: problema,
      retryable: false,
      acao: 'corrigir-entrada',
      provenance: this.provenance(execution)
    }
  }

  /**
   * Quantos créditos a operação consome, **antes** de ela sair (SPEC-Conectores-02, crit. 8).
   *
   * Na extração, estima pelo **número de URLs pedidas** — o pior caso, já que a Tavily só cobra
   * pelas que deram certo. Um gate que estimasse pelo melhor caso deixaria passar a chamada que
   * estoura a cota, que é precisamente o que ele existe para impedir.
   *
   * Entrada malformada devolve 0: quando isto roda, a validação já recusou o pedido, e inventar
   * um custo para algo que não vai sair poluiria a decisão do gate.
   */
  custoEstimado(execution: ConnectorExecution): number {
    const input = execution.request.input as Record<string, unknown> | undefined
    const depth = this.profundidade(input?.depth)

    if (execution.request.operation === TAVILY_OPERATIONS.search) {
      return creditosDaBusca(depth)
    }

    if (execution.request.operation === TAVILY_OPERATIONS.extract) {
      const urls = input?.urls
      return Array.isArray(urls) ? creditosDaExtracao(urls.length, depth) : 0
    }

    return 0
  }

  async executar(execution: ConnectorExecution): Promise<ConnectorResult | ConnectorError> {
    const inicio = this.agora()
    const rest = new TavilyRest(this.origem, execution.secret ?? '', this.buscar, execution.signal)

    try {
      const desfecho =
        execution.request.operation === TAVILY_OPERATIONS.search
          ? await this.pesquisar(rest, execution)
          : await this.extrair(rest, execution)

      // A busca sem fonte nenhuma já vem como erro do próprio `pesquisar` — devolvê-la como
      // sucesso vazio faria o chamador ler "não existe nada sobre isso", que é a porta pela qual
      // a memória do modelo preencheria o vazio (critério 5 da F05).
      if ('ok' in desfecho) return desfecho

      return {
        ok: true,
        data: desfecho.data,
        provenance: this.provenance(execution),
        usage: { creditos: desfecho.creditos, latenciaMs: this.agora() - inicio }
      }
    } catch (erro) {
      // `FalhaTavily` é a falha esperada — status da Tavily, traduzido no vocabulário comum.
      // Outra exceção sobe: quem a converte em `ConnectorError` é o serviço, num lugar só.
      if (erro instanceof FalhaTavily) return this.traduzirFalha(erro, execution)
      throw erro
    }
  }

  /**
   * `search.query` — descobre fontes (SPEC-Conectores-05).
   *
   * O que volta é **fonte normalizada**, nunca o corpo cru: o critério 1 da F05 pede resultado
   * com fonte verificável, e o critério 3 da F01 proíbe repassar o objeto do serviço. Campo a
   * campo, e não `...dados` — a Tavily devolve imagens, sugestões e análise da query que ninguém
   * pediu, e espalhá-las publicaria no IPC coisas que a tela não sabe o que são.
   */
  private async pesquisar(
    rest: TavilyRest,
    execution: ConnectorExecution
  ): Promise<{ data: TavilySearchData; creditos: number } | ConnectorError> {
    const input = execution.request.input as TavilySearchInput
    const depth = this.profundidade(input.depth)
    const coletadoEm = new Date(this.agora()).toISOString()

    const resposta = await rest.post('/search', {
      query: input.query,
      search_depth: depth,
      max_results: input.maxResults ?? MAX_RESULTADOS_PADRAO,
      ...(input.includeDomains === undefined || input.includeDomains.length === 0
        ? {}
        : { include_domains: input.includeDomains }),
      ...(input.excludeDomains === undefined || input.excludeDomains.length === 0
        ? {}
        : { exclude_domains: input.excludeDomains }),
      // Pedimos o uso explicitamente para o ledger receber o número da própria Tavily em vez da
      // nossa estimativa. Medido vence calculado quando o serviço informa o medido.
      include_usage: true
    })

    if (!resposta.ok) throw new FalhaTavily(resposta)

    const brutas = lista(resposta.corpo, 'results')
    const fontes = this.normalizarFontes(brutas, coletadoEm)
    const { unicas, descartadas } = this.deduplicarFontes(fontes)

    if (unicas.length === 0) {
      return erroDeBuscaSemFontes(input.query, coletadoEm)
    }

    const requestId = texto(resposta.corpo, 'request_id')

    return {
      data: {
        query: input.query,
        fontes: unicas,
        duplicadasDescartadas: descartadas,
        ...(requestId === undefined ? {} : { requestId })
      },
      creditos: this.creditosCobrados(resposta.corpo) ?? creditosDaBusca(depth)
    }
  }

  /**
   * `extract.content` — confirma o conteúdo das fontes selecionadas (SPEC-Conectores-06).
   *
   * **Falha parcial preserva as válidas** (critério 3): a Tavily devolve `results` e
   * `failed_results` lado a lado, e é assim que o pacote sai daqui. Derrubar a chamada porque uma
   * fonte de cinco caiu descartaria quatro extrações já pagas — e esconderia justamente quais
   * faltaram, que é a outra metade do critério.
   */
  private async extrair(
    rest: TavilyRest,
    execution: ConnectorExecution
  ): Promise<{ data: TavilyExtractData; creditos: number }> {
    const input = execution.request.input as TavilyExtractInput
    const depth = this.profundidade(input.depth)
    const coletadoEm = new Date(this.agora()).toISOString()

    const resposta = await rest.post('/extract', {
      urls: input.urls,
      extract_depth: depth,
      format: 'markdown',
      include_usage: true,
      ...(input.query === undefined ? {} : { query: input.query })
    })

    if (!resposta.ok) throw new FalhaTavily(resposta)

    const requestId = texto(resposta.corpo, 'request_id')
    const extraidos = lista(resposta.corpo, 'results')
      .map((bruto) => this.lerExtracao(bruto))
      .filter((crua): crua is ExtracaoCrua => crua !== undefined)

    const { unicos, descartados } = deduplicar(
      extraidos.map((crua) => montarEvidencia(crua, coletadoEm, requestId))
    )

    const falhas = this.normalizarFalhas(lista(resposta.corpo, 'failed_results'))

    return {
      data: {
        evidencias: unicos,
        falhas,
        duplicadasDescartadas: descartados,
        ...(requestId === undefined ? {} : { requestId })
      },
      // O consumo **real**: a Tavily não cobra por URL que falhou, então o fallback conta as
      // extrações bem-sucedidas — nunca as pedidas. Cobrar do ledger o que o serviço não cobrou
      // gastaria cota que ninguém consumiu.
      creditos: this.creditosCobrados(resposta.corpo) ?? creditosDaExtracao(extraidos.length, depth)
    }
  }

  /**
   * O consumo que a **Tavily** informou, quando informa.
   *
   * Dois formatos porque a API usa dois: `usage.credits` no Search e `usage.total_credits_used`
   * no Extract. Ler os dois aqui evita que a diferença vire um `if` em cada chamador.
   */
  private creditosCobrados(corpo: unknown): number | undefined {
    const usage = (corpo as Registro | undefined)?.usage
    return numero(usage, 'credits') ?? numero(usage, 'total_credits_used')
  }

  /** Normaliza os resultados da busca, campo a campo. */
  private normalizarFontes(
    brutas: readonly Registro[],
    coletadoEm: string
  ): readonly TavilySource[] {
    const fontes: TavilySource[] = []

    for (const bruta of brutas) {
      const url = texto(bruta, 'url')
      // Sem URL não há fonte verificável, e resultado sem fonte não sustenta afirmação
      // (critério 4 da F05). Descartar é mais honesto que devolver um item que ninguém pode
      // conferir.
      if (url === undefined) continue

      const score = numero(bruta, 'score')
      const publicadoEm = texto(bruta, 'published_date')

      fontes.push({
        titulo: texto(bruta, 'title') ?? url,
        url: normalizarUrl(url),
        urlOriginal: url,
        dominio: texto(bruta, 'domain') ?? dominioDe(url),
        trecho: texto(bruta, 'content') ?? '',
        coletadoEm,
        ...(score === undefined ? {} : { score }),
        ...(publicadoEm === undefined ? {} : { publicadoEm })
      })
    }

    return fontes
  }

  /**
   * Descarta fontes que são a mesma URL canônica.
   *
   * Aqui basta a URL — ao contrário da evidência extraída, onde o hash do conteúdo também entra
   * (critério 4 da F06). A diferença é o que cada uma tem em mãos: a busca devolve snippet, e
   * dois snippets diferentes da mesma página continuam sendo a mesma página. Só depois da
   * extração existe conteúdo para dizer que duas coletas da mesma URL divergem.
   */
  private deduplicarFontes(fontes: readonly TavilySource[]): {
    unicas: readonly TavilySource[]
    descartadas: number
  } {
    const vistas = new Set<string>()
    const unicas: TavilySource[] = []

    for (const fonte of fontes) {
      if (vistas.has(fonte.url)) continue
      vistas.add(fonte.url)
      unicas.push(fonte)
    }

    return { unicas, descartadas: fontes.length - unicas.length }
  }

  /** Lê um item de extração. `undefined` quando falta o essencial — URL ou conteúdo. */
  private lerExtracao(bruto: Registro): ExtracaoCrua | undefined {
    const url = texto(bruto, 'url')
    // A API chama de `raw_content`; `content` cobre o formato alternativo da rota de URL única.
    const conteudo = texto(bruto, 'raw_content') ?? texto(bruto, 'content')
    if (url === undefined || conteudo === undefined) return undefined

    const titulo = texto(bruto, 'title')
    const publicadoEm = texto(bruto, 'published_date')

    return {
      url,
      conteudo,
      ...(titulo === undefined ? {} : { titulo }),
      ...(publicadoEm === undefined ? {} : { publicadoEm })
    }
  }

  /**
   * Normaliza as falhas parciais.
   *
   * O motivo vem do serviço externo e é **dado, nunca instrução** (regra da F06): entra como
   * texto num campo, não é interpretado, e o pacote de evidência não vira prompt em nenhum ponto
   * do pipeline. O truncamento evita que uma mensagem de erro de vários KB atravesse o IPC.
   */
  private normalizarFalhas(brutas: readonly Registro[]): readonly EvidenceFailure[] {
    const falhas: EvidenceFailure[] = []

    for (const bruta of brutas) {
      const url = texto(bruta, 'url')
      if (url === undefined) continue
      falhas.push({ url, motivo: (texto(bruta, 'error') ?? 'motivo não informado').slice(0, 300) })
    }

    return falhas
  }

  /**
   * O status da Tavily, **sem credencial nenhuma** (critério 5 da F02).
   *
   * A assinatura garante — `health()` não recebe parâmetro. O que sondamos é o `/search` sem
   * token: a resposta esperada é 401, e recebê-la prova que o serviço está no ar e respondendo o
   * que deve. Qualquer 5xx (ou exceção de rede) é o que a sonda existe para detectar.
   */
  async health(): Promise<boolean> {
    try {
      const resposta = await this.buscar(`${this.origem}/search`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'health' })
      })
      return resposta.status < 500
    } catch {
      return false
    }
  }

  /**
   * Traduz o status HTTP no vocabulário comum (critério 4 da F01).
   *
   * A tabela de erros da Tavily (spec § Erros), e o que separa cada caso:
   *
   * - **401** é credencial: quem resolve é o usuário, e retentar entra em loop.
   * - **429** é rate limit — o único **retomável** dos três limites, porque quem espera consegue.
   * - **432** (limite do plano) e **433** (limite PayGo) são cota comprada esgotada: retentar não
   *   ajuda porque não é questão de tempo, é de plano. Os dois viram `limite-excedido`, que
   *   `ESTADO_DO_ERRO` mapeia para `BLOCKED_EXTERNAL` — o critério 5 da F05, sem código novo.
   * - **400** é pedido malformado que a nossa validação não pegou; `corrigir-entrada`.
   * - **5xx** é o serviço fora do ar; retomável com backoff.
   */
  private traduzirFalha(falha: FalhaTavily, execution: ConnectorExecution): ConnectorError {
    const provenance = this.provenance(execution)
    const { status, headers } = falha.resposta
    const retryAfter = Number(headers.get('retry-after'))
    const retryAfterMs =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined

    if (status === 401 || status === 403) {
      return {
        ok: false,
        code: 'credencial-recusada',
        mensagem: 'A Tavily recusou a chave. Cadastre a credencial de novo em Configurações.',
        retryable: false,
        acao: 'reautenticar',
        provenance
      }
    }

    if (status === 429) {
      return {
        ok: false,
        code: 'limite-excedido',
        mensagem: 'A Tavily pediu para esperar antes da próxima pesquisa.',
        retryable: true,
        acao: 'retentar',
        provenance,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs })
      }
    }

    if (status === 432 || status === 433) {
      const qual =
        status === 432
          ? 'O limite do plano da Tavily foi atingido.'
          : 'O limite pay-as-you-go da Tavily foi atingido.'
      return {
        ok: false,
        code: 'limite-excedido',
        // `retryable: false`: esperar não devolve cota comprada — quem resolve é o plano.
        mensagem: `${qual} Ajuste o plano na Tavily antes de pesquisar de novo.`,
        retryable: false,
        acao: 'reportar',
        provenance,
        evidencia: `HTTP ${status}`
      }
    }

    if (status === 400 || status === 422) {
      return {
        ok: false,
        code: 'validacao-invalida',
        mensagem: 'A Tavily recusou os parâmetros da chamada.',
        retryable: false,
        acao: 'corrigir-entrada',
        provenance,
        evidencia: `HTTP ${status}`
      }
    }

    if (status >= 500) {
      return {
        ok: false,
        code: 'indisponivel',
        mensagem: 'A Tavily está indisponível no momento.',
        retryable: true,
        acao: 'retentar',
        provenance
      }
    }

    return {
      ok: false,
      code: 'resposta-invalida',
      // O status entra como evidência (número, não corpo); a mensagem ao usuário fica normalizada.
      mensagem: 'A Tavily recusou a chamada por um motivo não previsto.',
      retryable: false,
      acao: 'reportar',
      provenance,
      evidencia: `HTTP ${status}`
    }
  }

  /** A profundidade pedida, com o padrão `basic` da spec quando ausente ou desconhecida. */
  private profundidade(valor: unknown): TavilyDepth {
    return valor === 'advanced' ? 'advanced' : PROFUNDIDADE_PADRAO
  }

  private provenance(execution: ConnectorExecution): ConnectorResult['provenance'] {
    return {
      connector: 'tavily',
      operation: execution.request.operation,
      obtidoEm: new Date(this.agora()).toISOString()
    }
  }
}
