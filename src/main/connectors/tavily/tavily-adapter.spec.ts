/**
 * O adapter da Tavily (SPEC-Conectores-05 e 06, categoria Regras).
 *
 * O que estes testes cobram: que o adapter **normaliza** — traduz o status no vocabulário comum
 * da F01 e devolve dado escolhido campo a campo, não o corpo da Tavily inteiro — e que o custo
 * que ele declara ao gate é o **pior caso**, enquanto o que ele reporta ao ledger é o **real**.
 *
 * O caso que só este adapter tem: a diferença entre 429 e 432/433. Os três são limite, mas o
 * primeiro passa com o tempo e os outros dois só passam com outro plano — e é por isso que a
 * decisão de retentar mora no erro, não numa tabela por faixa de status.
 */

import { describe, expect, it, vi } from 'vitest'
import type { ConnectorError, ConnectorRequest, ConnectorResult } from '@shared/domain/connectors'
import { CODIGOS_SEM_RETRY } from '@shared/domain/connector-governance'
import {
  TAVILY_OPERATIONS,
  type TavilyExtractData,
  type TavilySearchData
} from '@shared/domain/tavily'
import { hashDoConteudo } from './evidencia'
import { TavilyAdapter } from './tavily-adapter'

const AGORA = Date.parse('2026-08-29T12:00:00.000Z')
const ORIGEM = 'http://127.0.0.1:9999'

function request(operation: string, input: unknown): ConnectorRequest {
  return {
    contractVersion: 1,
    connector: 'tavily',
    operation,
    correlationId: 'c-1',
    timeoutMs: 10_000,
    credential: { key: 'tavily', user_id: 'u-1', workspace_id: 'jarvis' },
    input
  }
}

function execution(
  operation: string,
  input: unknown,
  secret = 'tvly-teste'
): Parameters<TavilyAdapter['executar']>[0] {
  return {
    request: request(operation, input),
    capability: { connector: 'tavily', operation, effect: 'leitura', descricao: 'x' },
    secret
  }
}

function resposta(
  corpo: unknown,
  init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}
): Response {
  return {
    ok: init.ok ?? (init.status ?? 200) < 400,
    status: init.status ?? 200,
    json: async () => corpo,
    headers: new Headers(init.headers ?? {})
  } as Response
}

function adapter(devolver: () => Response): {
  instancia: TavilyAdapter
  chamadas: { url: string; init: RequestInit }[]
} {
  const chamadas: { url: string; init: RequestInit }[] = []
  const buscar = vi.fn(async (url: string, init: RequestInit) => {
    chamadas.push({ url, init })
    return devolver()
  })

  return { instancia: new TavilyAdapter(buscar, () => AGORA, ORIGEM), chamadas }
}

/** Uma resposta de busca com uma fonte, para os casos que não a variam. */
const UMA_FONTE = {
  results: [
    {
      title: 'Título',
      url: 'https://exemplo.com/a',
      content: 'trecho do buscador',
      score: 0.9,
      published_date: '2026-01-15',
      domain: 'exemplo.com'
    }
  ],
  usage: { credits: 1 },
  request_id: 'req-1'
}

describe('capacidades e identidade', () => {
  it('declara as duas operações sob o id do conector', () => {
    const { instancia } = adapter(() => resposta({}))

    expect(instancia.id).toBe('tavily')
    expect(instancia.capacidades().map((c) => c.operation)).toEqual([
      TAVILY_OPERATIONS.search,
      TAVILY_OPERATIONS.extract
    ])
  })
})

describe('validação — delega ao domínio e embrulha com proveniência', () => {
  it('aceita entrada válida', () => {
    const { instancia } = adapter(() => resposta({}))

    expect(instancia.validar(execution(TAVILY_OPERATIONS.search, { query: 'x' }))).toBeUndefined()
  })

  it('recusa entrada inválida como validacao-invalida', () => {
    const { instancia } = adapter(() => resposta({}))
    const erro = instancia.validar(execution(TAVILY_OPERATIONS.search, {}))

    expect(erro?.code).toBe('validacao-invalida')
    expect(erro?.acao).toBe('corrigir-entrada')
    expect(erro?.provenance.connector).toBe('tavily')
  })

  it('NÃO exige o segredo — o serviço só resolve o cofre depois desta etapa', () => {
    // A armadilha que o E2E da F04 encontrou no adapter do GitHub: `validar` roda no passo 3 e
    // o cofre é resolvido no passo 6, então `secret` está **sempre** ausente aqui. Uma guarda
    // sobre o material recusaria toda chamada.
    const { instancia } = adapter(() => resposta({}))
    const semSecret = {
      request: request(TAVILY_OPERATIONS.search, { query: 'x' }),
      capability: {
        connector: 'tavily' as const,
        operation: TAVILY_OPERATIONS.search,
        effect: 'leitura' as const,
        descricao: 'x'
      }
    }

    expect(instancia.validar(semSecret)).toBeUndefined()
  })

  it('exige a REFERÊNCIA de credencial — sem ela a chamada sairia com Bearer vazio', () => {
    // A distinção que o int-spec revelou: o serviço só consulta o cofre quando o pedido traz
    // `credential`. Sem o campo, `resolverCredencial` devolve cedo, e a requisição sai sem
    // segredo para voltar 401 — uma chamada gasta para descobrir o que dava para saber antes.
    // Conferir a referência é diferente de conferir o material, e só a primeira é possível aqui.
    const { instancia } = adapter(() => resposta({}))
    const semCredencial = {
      request: {
        ...request(TAVILY_OPERATIONS.search, { query: 'x' }),
        credential: undefined
      },
      capability: {
        connector: 'tavily' as const,
        operation: TAVILY_OPERATIONS.search,
        effect: 'leitura' as const,
        descricao: 'x'
      }
    }

    const erro = instancia.validar(semCredencial)

    expect(erro?.code).toBe('credencial-ausente')
    expect(erro?.acao).toBe('reautenticar')
  })
})

describe('custo estimado — o pior caso, porque é o gate que decide antes de gastar', () => {
  const { instancia } = adapter(() => resposta({}))
  const custo = (operation: string, input: unknown): number =>
    instancia.custoEstimado(execution(operation, input))

  it('busca custa por profundidade', () => {
    expect(custo(TAVILY_OPERATIONS.search, { query: 'x' })).toBe(1)
    expect(custo(TAVILY_OPERATIONS.search, { query: 'x', depth: 'advanced' })).toBe(2)
  })

  it('extração estima pelo número de URLs pedidas, não pelas que darão certo', () => {
    // A Tavily só cobra pelas bem-sucedidas, mas o gate roda **antes** de saber quais serão.
    // Estimar pelo melhor caso deixaria passar justamente a chamada que estoura a cota.
    expect(custo(TAVILY_OPERATIONS.extract, { urls: ['https://a.com'] })).toBe(1)
    expect(
      custo(TAVILY_OPERATIONS.extract, {
        urls: Array.from({ length: 6 }, (_, i) => `https://a.com/${i}`)
      })
    ).toBe(2)
  })

  it('entrada malformada custa zero — a validação já a recusou', () => {
    expect(custo(TAVILY_OPERATIONS.extract, { urls: 'nem-lista' })).toBe(0)
    expect(custo(TAVILY_OPERATIONS.search, null)).toBe(1)
  })
})

describe('busca — normaliza campo a campo e devolve fonte verificável', () => {
  it('devolve a fonte com URL canônica, original e proveniência', async () => {
    const { instancia, chamadas } = adapter(() => resposta(UMA_FONTE))
    const desfecho = (await instancia.executar(
      execution(TAVILY_OPERATIONS.search, { query: 'agentes' })
    )) as ConnectorResult
    const data = desfecho.data as TavilySearchData

    expect(desfecho.ok).toBe(true)
    expect(data.fontes).toHaveLength(1)
    expect(data.fontes[0]?.url).toBe('https://exemplo.com/a')
    expect(data.fontes[0]?.titulo).toBe('Título')
    expect(data.fontes[0]?.dominio).toBe('exemplo.com')
    expect(data.fontes[0]?.score).toBe(0.9)
    expect(data.fontes[0]?.publicadoEm).toBe('2026-01-15')
    expect(data.fontes[0]?.coletadoEm).toBe('2026-08-29T12:00:00.000Z')
    expect(data.requestId).toBe('req-1')
    expect(chamadas[0]?.url).toBe(`${ORIGEM}/search`)
  })

  it('manda a chave por Bearer e o padrão basic', async () => {
    const { instancia, chamadas } = adapter(() => resposta(UMA_FONTE))
    await instancia.executar(execution(TAVILY_OPERATIONS.search, { query: 'x' }))

    const headers = chamadas[0]?.init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tvly-teste')
    expect(JSON.parse(String(chamadas[0]?.init.body))).toMatchObject({
      query: 'x',
      search_depth: 'basic'
    })
  })

  it('NÃO repassa o corpo da Tavily — campos que ninguém pediu ficam de fora', async () => {
    // O critério 3 da F01: espalhar `...dados` publicaria no IPC imagens, sugestões e análise
    // de query que a tela não sabe o que são.
    const { instancia } = adapter(() =>
      resposta({
        ...UMA_FONTE,
        images: ['https://img'],
        suggestions: ['outra busca'],
        query_analysis: { predicted_clp: '1.0' }
      })
    )
    const desfecho = (await instancia.executar(
      execution(TAVILY_OPERATIONS.search, { query: 'x' })
    )) as ConnectorResult

    expect(Object.keys(desfecho.data as object).sort()).toEqual([
      'duplicadasDescartadas',
      'fontes',
      'query',
      'requestId'
    ])
  })

  it('descarta resultado sem URL — sem fonte não há afirmação sustentável', async () => {
    const { instancia } = adapter(() =>
      resposta({
        results: [{ title: 'sem url', content: 'x' }, UMA_FONTE.results[0]],
        usage: { credits: 1 }
      })
    )
    const desfecho = (await instancia.executar(
      execution(TAVILY_OPERATIONS.search, { query: 'x' })
    )) as ConnectorResult

    expect((desfecho.data as TavilySearchData).fontes).toHaveLength(1)
  })

  it('deduplica fontes pela URL canônica e conta as descartadas', async () => {
    const { instancia } = adapter(() =>
      resposta({
        results: [
          { url: 'https://exemplo.com/a', title: 'A', content: 'x' },
          { url: 'https://WWW.Exemplo.com/a/?utm_source=n', title: 'A de novo', content: 'y' }
        ],
        usage: { credits: 1 }
      })
    )
    const data = (
      (await instancia.executar(
        execution(TAVILY_OPERATIONS.search, { query: 'x' })
      )) as ConnectorResult
    ).data as TavilySearchData

    expect(data.fontes).toHaveLength(1)
    expect(data.duplicadasDescartadas).toBe(1)
  })

  it('busca sem fonte nenhuma vira erro, não sucesso vazio', async () => {
    // Critério 5 da F05: o vazio não pode chegar como "não existe nada sobre isso", porque é
    // por essa porta que a memória do modelo preencheria o resultado.
    const { instancia } = adapter(() => resposta({ results: [], usage: { credits: 1 } }))
    const desfecho = (await instancia.executar(
      execution(TAVILY_OPERATIONS.search, { query: 'termo raro' })
    )) as ConnectorError

    expect(desfecho.ok).toBe(false)
    expect(desfecho.mensagem).toContain('memória')
  })

  it('reporta o crédito que a Tavily informou, não o estimado', async () => {
    // Medido vence calculado quando o serviço informa o medido: é o número dela que entra no
    // ledger, e divergir dele faria a nossa soma derivar da real com o tempo.
    const { instancia } = adapter(() => resposta({ ...UMA_FONTE, usage: { credits: 7 } }))
    const desfecho = (await instancia.executar(
      execution(TAVILY_OPERATIONS.search, { query: 'x', depth: 'basic' })
    )) as ConnectorResult

    expect(desfecho.usage.creditos).toBe(7)
  })

  it('sem usage na resposta, cai na tabela de créditos', async () => {
    const { instancia } = adapter(() => resposta({ results: UMA_FONTE.results }))
    const desfecho = (await instancia.executar(
      execution(TAVILY_OPERATIONS.search, { query: 'x', depth: 'advanced' })
    )) as ConnectorResult

    expect(desfecho.usage.creditos).toBe(2)
  })
})

describe('extração — evidência com hash, e falha parcial que preserva as válidas', () => {
  const DUAS_EXTRACOES = {
    results: [
      { url: 'https://exemplo.com/a', raw_content: 'conteúdo da fonte A' },
      { url: 'https://outro.com/b', raw_content: 'conteúdo da fonte B' }
    ],
    failed_results: [],
    usage: { total_credits_used: 1 },
    request_id: 'req-2'
  }

  it('devolve evidência com hash do conteúdo e URL canônica', async () => {
    const { instancia, chamadas } = adapter(() => resposta(DUAS_EXTRACOES))
    const data = (
      (await instancia.executar(
        execution(TAVILY_OPERATIONS.extract, {
          urls: ['https://exemplo.com/a', 'https://outro.com/b']
        })
      )) as ConnectorResult
    ).data as TavilyExtractData

    expect(data.evidencias).toHaveLength(2)
    expect(data.evidencias[0]?.hashConteudo).toBe(hashDoConteudo('conteúdo da fonte A'))
    expect(data.evidencias[0]?.url).toBe('https://exemplo.com/a')
    expect(data.evidencias[0]?.requestId).toBe('req-2')
    expect(chamadas[0]?.url).toBe(`${ORIGEM}/extract`)
  })

  it('falha parcial preserva as válidas e identifica as ausentes (critério 3)', async () => {
    // Derrubar a chamada porque uma fonte de três caiu descartaria duas extrações já pagas — e
    // esconderia quais faltaram, que é a outra metade do critério.
    const { instancia } = adapter(() =>
      resposta({
        results: DUAS_EXTRACOES.results,
        failed_results: [{ url: 'https://caiu.com/c', error: 'timeout ao carregar' }],
        usage: { total_credits_used: 1 }
      })
    )
    const data = (
      (await instancia.executar(
        execution(TAVILY_OPERATIONS.extract, {
          urls: ['https://exemplo.com/a', 'https://outro.com/b', 'https://caiu.com/c']
        })
      )) as ConnectorResult
    ).data as TavilyExtractData

    expect(data.evidencias).toHaveLength(2)
    expect(data.falhas).toEqual([{ url: 'https://caiu.com/c', motivo: 'timeout ao carregar' }])
  })

  it('trunca o motivo da falha — mensagem de vários KB não atravessa o IPC', async () => {
    const { instancia } = adapter(() =>
      resposta({
        results: [],
        failed_results: [{ url: 'https://a.com', error: 'x'.repeat(5_000) }],
        usage: { total_credits_used: 0 }
      })
    )
    const data = (
      (await instancia.executar(
        execution(TAVILY_OPERATIONS.extract, { urls: ['https://a.com'] })
      )) as ConnectorResult
    ).data as TavilyExtractData

    expect(data.falhas[0]?.motivo.length).toBe(300)
  })

  it('cobra do ledger só o que a Tavily cobrou — falha não custa', async () => {
    // Sem `usage` na resposta, o fallback conta as extrações **bem-sucedidas**. Contar as
    // pedidas gastaria cota que ninguém consumiu, porque a Tavily não cobra por URL que falhou.
    //
    // Os números são escolhidos para **atravessar** a fronteira do grupo de 5: 6 pedidas caem em
    // dois grupos (2 créditos) e 4 bem-sucedidas num só (1 crédito). Com 3 e 1 os dois cálculos
    // dariam 1, e o teste passaria mesmo contando as pedidas — foi o que um contrafactual
    // mostrou, e a correção é esta escolha de números, não outra asserção.
    const { instancia } = adapter(() =>
      resposta({
        results: Array.from({ length: 4 }, (_, i) => ({
          url: `https://ok.com/${i}`,
          raw_content: `conteúdo ${i}`
        })),
        failed_results: [
          { url: 'https://b.com', error: 'x' },
          { url: 'https://c.com', error: 'x' }
        ]
      })
    )
    const desfecho = (await instancia.executar(
      execution(TAVILY_OPERATIONS.extract, {
        urls: [
          ...Array.from({ length: 4 }, (_, i) => `https://ok.com/${i}`),
          'https://b.com',
          'https://c.com'
        ]
      })
    )) as ConnectorResult

    expect(desfecho.usage.creditos).toBe(1)
  })

  it('extração totalmente falha não custa nada e devolve as ausentes', async () => {
    const { instancia } = adapter(() =>
      resposta({
        results: [],
        failed_results: [{ url: 'https://a.com', error: '403' }]
      })
    )
    const desfecho = (await instancia.executar(
      execution(TAVILY_OPERATIONS.extract, { urls: ['https://a.com'] })
    )) as ConnectorResult

    expect(desfecho.usage.creditos).toBe(0)
    expect((desfecho.data as TavilyExtractData).falhas).toHaveLength(1)
  })

  it('descarta item sem conteúdo — não há o que hashear', async () => {
    const { instancia } = adapter(() =>
      resposta({ results: [{ url: 'https://a.com' }, { raw_content: 'sem url' }] })
    )
    const data = (
      (await instancia.executar(
        execution(TAVILY_OPERATIONS.extract, { urls: ['https://a.com'] })
      )) as ConnectorResult
    ).data as TavilyExtractData

    expect(data.evidencias).toEqual([])
  })

  it('deduplica evidência idêntica e preserva conteúdo divergente da mesma URL', async () => {
    const { instancia } = adapter(() =>
      resposta({
        results: [
          { url: 'https://a.com/x', raw_content: 'igual' },
          { url: 'https://WWW.a.com/x/', raw_content: 'igual' },
          { url: 'https://a.com/x', raw_content: 'divergente' }
        ]
      })
    )
    const data = (
      (await instancia.executar(
        execution(TAVILY_OPERATIONS.extract, { urls: ['https://a.com/x'] })
      )) as ConnectorResult
    ).data as TavilyExtractData

    // Duas: a idêntica sumiu, a divergente ficou — porque fundi-la apagaria o fato de a fonte
    // ter mudado (critério 4).
    expect(data.evidencias).toHaveLength(2)
    expect(data.duplicadasDescartadas).toBe(1)
  })
})

describe('tradução de falha — o vocabulário comum da F01', () => {
  async function falhar(
    status: number,
    headers: Record<string, string> = {}
  ): Promise<ConnectorError> {
    const { instancia } = adapter(() => resposta({ detail: 'x' }, { status, headers }))
    return (await instancia.executar(
      execution(TAVILY_OPERATIONS.search, { query: 'x' })
    )) as ConnectorError
  }

  it('401 é credencial recusada, e não retenta', async () => {
    const erro = await falhar(401)

    expect(erro.code).toBe('credencial-recusada')
    expect(erro.retryable).toBe(false)
    expect(erro.acao).toBe('reautenticar')
  })

  it('429 é indisponibilidade retomável, e obedece ao Retry-After em milissegundos', async () => {
    // O defeito que a F02 pegou: orientação do serviço guardada como texto é orientação que
    // ninguém obedece. Aqui ela é número, no campo que a governança lê.
    const erro = await falhar(429, { 'retry-after': '30' })

    expect(erro.code).toBe('indisponivel')
    expect(erro.retryable).toBe(true)
    expect(erro.retryAfterMs).toBe(30_000)
  })

  it('429 NÃO usa o código terminal de cota — senão o retry nunca aconteceria', async () => {
    // A asserção que o teste contra o servidor revelou faltar: `limite-excedido` está em
    // `CODIGOS_SEM_RETRY` (é cota esgotada, e repetir não devolve cota). Marcar o 429 com ele
    // faria a governança recusar o retry apesar do `retryable: true` — um campo dizendo uma
    // coisa e o comportamento fazendo outra.
    const erro = await falhar(429)

    expect(CODIGOS_SEM_RETRY).not.toContain(erro.code)
    expect(erro.retryable).toBe(true)
    expect(erro.retryAfterMs).toBeUndefined()
  })

  it('432/433 usam o código terminal — é cota, e cota não passa com o tempo', async () => {
    for (const status of [432, 433]) {
      expect(CODIGOS_SEM_RETRY).toContain((await falhar(status)).code)
    }
  })

  it('432 e 433 são limite NÃO retomável — esperar não devolve cota comprada', async () => {
    // A diferença que só o adapter sabe: 429 passa com o tempo, 432/433 só passam com outro
    // plano. Tratá-los como o 429 faria o retry insistir contra uma cota esgotada.
    for (const status of [432, 433]) {
      const erro = await falhar(status)

      expect(erro.code).toBe('limite-excedido')
      expect(erro.retryable).toBe(false)
      expect(erro.acao).toBe('reportar')
      expect(erro.evidencia).toBe(`HTTP ${status}`)
    }
  })

  it('432 e 433 dizem qual limite estourou', async () => {
    expect((await falhar(432)).mensagem).toContain('plano')
    expect((await falhar(433)).mensagem).toContain('pay-as-you-go')
  })

  it('400 é entrada a corrigir', async () => {
    const erro = await falhar(400)

    expect(erro.code).toBe('validacao-invalida')
    expect(erro.acao).toBe('corrigir-entrada')
  })

  it('5xx é indisponível e retomável', async () => {
    const erro = await falhar(503)

    expect(erro.code).toBe('indisponivel')
    expect(erro.retryable).toBe(true)
  })

  it('status imprevisto vira resposta-invalida com o número como evidência', async () => {
    const erro = await falhar(418)

    expect(erro.code).toBe('resposta-invalida')
    expect(erro.evidencia).toBe('HTTP 418')
  })

  it('nenhuma mensagem de erro carrega o corpo da resposta', async () => {
    // O corpo pode conter o que não deve ir para a tela nem para o log; o que sai é mensagem
    // normalizada mais o status como evidência.
    for (const status of [401, 429, 432, 400, 503, 418]) {
      const erro = await falhar(status)
      expect(erro.mensagem).not.toContain('detail')
    }
  })
})

describe('health — a sonda que não pode revelar credencial', () => {
  it('não manda Authorization', async () => {
    // A assinatura já garante (não recebe parâmetro); o teste cobra o endpoint escolhido — um
    // health que precisasse do token seria um health que o revela a quem o chama.
    const { instancia, chamadas } = adapter(() => resposta({}, { status: 401 }))
    await instancia.health()

    const headers = chamadas[0]?.init.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  it('401 é serviço no ar (responde o que deve); 5xx não é', async () => {
    const { instancia: viva } = adapter(() => resposta({}, { status: 401 }))
    const { instancia: fora } = adapter(() => resposta({}, { status: 502 }))

    expect(await viva.health()).toBe(true)
    expect(await fora.health()).toBe(false)
  })

  it('exceção de rede é serviço fora', async () => {
    const instancia = new TavilyAdapter(
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
      () => AGORA,
      ORIGEM
    )

    expect(await instancia.health()).toBe(false)
  })
})

describe('exceção inesperada sobe — quem a traduz é o serviço, num lugar só', () => {
  it('erro de rede não vira ConnectorError aqui', async () => {
    const instancia = new TavilyAdapter(
      vi.fn(async () => {
        throw new Error('ECONNRESET')
      }),
      () => AGORA,
      ORIGEM
    )

    await expect(
      instancia.executar(execution(TAVILY_OPERATIONS.search, { query: 'x' }))
    ).rejects.toThrow('ECONNRESET')
  })
})
