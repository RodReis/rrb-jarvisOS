/**
 * As decisões puras do conector Tavily (SPEC-Conectores-05 e 06).
 *
 * O que estes testes provam é **contrato e regra**: que a validação recusa antes de qualquer
 * I/O, que a conta de créditos segue a tabela da Tavily, e que a normalização de URL remove o
 * que não muda o documento e preserva o que muda. Nenhum deles precisa de rede — e é por isso
 * que valem: um teste que precisasse de servidor para dizer "`?id=42` não é rastreamento"
 * estaria medindo o servidor.
 *
 * O efeito — chamar, traduzir status, registrar no ledger — é do adapter e do serviço, e está
 * em `tavily-adapter.spec.ts` e `tavily.int-spec.ts`, este último contra um servidor que
 * **conta** requisições.
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_RESULTADOS_TETO,
  MAX_URLS_EXTRACT,
  PROFUNDIDADE_PADRAO,
  TAVILY_API_ORIGIN,
  TAVILY_CAPABILITIES,
  TAVILY_OPERATIONS,
  creditosDaBusca,
  creditosDaExtracao,
  dominioDe,
  ehUrlHttp,
  erroDeBuscaSemFontes,
  normalizarUrl,
  origemDaTavily,
  validarEntrada
} from './tavily'

describe('capacidades — declaradas, não descobertas', () => {
  it('as duas operações pertencem ao conector e são leitura', () => {
    expect(TAVILY_CAPABILITIES).toHaveLength(2)

    for (const capacidade of TAVILY_CAPABILITIES) {
      expect(capacidade.connector).toBe('tavily')
      // Leitura, e é o que as torna retentáveis sem chave de idempotência: pesquisar e extrair
      // não mudam nada no mundo, então repetir é seguro por natureza (regra da F02).
      expect(capacidade.effect).toBe('leitura')
      expect(capacidade.descricao).not.toBe('')
    }
  })

  it('cada operação declarada tem nome namespaced e é única', () => {
    const nomes = TAVILY_CAPABILITIES.map((c) => c.operation)

    expect(nomes).toEqual([TAVILY_OPERATIONS.search, TAVILY_OPERATIONS.extract])
    expect(new Set(nomes).size).toBe(nomes.length)
    for (const nome of nomes) expect(nome).toContain('.')
  })
})

describe('origem da API — override de ambiente, nunca de rota', () => {
  it('sem override, é a origem oficial', () => {
    expect(origemDaTavily()).toBe(TAVILY_API_ORIGIN)
    expect(origemDaTavily('')).toBe(TAVILY_API_ORIGIN)
    expect(origemDaTavily('   ')).toBe(TAVILY_API_ORIGIN)
  })

  it('o override troca o servidor e descarta caminho, query e fragmento', () => {
    // A garantia que importa: mesmo com caminho no override, o que sobra é a **origem**. Sem
    // isso, um override poderia redirecionar `/search` para outra rota do mesmo host.
    expect(origemDaTavily('http://127.0.0.1:8123/qualquer/coisa?x=1#f')).toBe(
      'http://127.0.0.1:8123'
    )
  })

  it('recusa esquema que não seja http(s) e texto que não é URL', () => {
    expect(origemDaTavily('file:///etc/passwd')).toBe(TAVILY_API_ORIGIN)
    expect(origemDaTavily('javascript:alert(1)')).toBe(TAVILY_API_ORIGIN)
    expect(origemDaTavily('nem-url')).toBe(TAVILY_API_ORIGIN)
  })
})

describe('créditos — a tabela da Tavily, não uma estimativa nossa', () => {
  it('busca custa 1 em basic e 2 em advanced, por requisição', () => {
    expect(creditosDaBusca('basic')).toBe(1)
    expect(creditosDaBusca('advanced')).toBe(2)
  })

  it('extração cobra por grupo de 5, arredondando para cima', () => {
    // O grupo é indivisível: 6 URLs custam dois grupos, não 1,2. Arredondar para baixo
    // subestimaria o gate justamente na chamada que estoura a cota.
    expect(creditosDaExtracao(1, 'basic')).toBe(1)
    expect(creditosDaExtracao(5, 'basic')).toBe(1)
    expect(creditosDaExtracao(6, 'basic')).toBe(2)
    expect(creditosDaExtracao(10, 'basic')).toBe(2)
    expect(creditosDaExtracao(11, 'basic')).toBe(3)
  })

  it('advanced custa o dobro do mesmo número de grupos', () => {
    expect(creditosDaExtracao(5, 'advanced')).toBe(2)
    expect(creditosDaExtracao(6, 'advanced')).toBe(4)
  })

  it('extração de zero URLs não custa nada', () => {
    // Importa porque é o caso da falha total: nenhuma URL extraída com sucesso, e a Tavily não
    // cobra por extração que falhou. Cobrar aqui gastaria cota que ninguém consumiu.
    expect(creditosDaExtracao(0, 'basic')).toBe(0)
    expect(creditosDaExtracao(0, 'advanced')).toBe(0)
    expect(creditosDaExtracao(-1, 'basic')).toBe(0)
  })

  it('o padrão de profundidade é o mais barato', () => {
    // Decisão cravada da spec: `advanced` custa o dobro, e um padrão caro gastaria a cota de
    // quem não pediu.
    expect(PROFUNDIDADE_PADRAO).toBe('basic')
    expect(creditosDaBusca(PROFUNDIDADE_PADRAO)).toBe(1)
  })
})

describe('normalização de URL — remove o que não muda o documento', () => {
  it('unifica host, esquema, www, barra final e fragmento', () => {
    const canonica = 'https://exemplo.com/docs'

    expect(normalizarUrl('https://WWW.Exemplo.com/docs')).toBe(canonica)
    expect(normalizarUrl('https://exemplo.com/docs/')).toBe(canonica)
    expect(normalizarUrl('https://exemplo.com/docs#secao')).toBe(canonica)
    expect(normalizarUrl('https://exemplo.com/docs/#secao')).toBe(canonica)
  })

  it('remove parâmetros de campanha e preserva os demais', () => {
    // A metade que importa é a segunda: `?id=42` costuma **escolher** o documento, e removê-lo
    // fundiria duas páginas distintas — o erro que o critério 4 da F06 proíbe.
    expect(normalizarUrl('https://exemplo.com/p?utm_source=x&utm_campaign=y')).toBe(
      'https://exemplo.com/p'
    )
    expect(normalizarUrl('https://exemplo.com/p?id=42&utm_source=x')).toBe(
      'https://exemplo.com/p?id=42'
    )
    expect(normalizarUrl('https://exemplo.com/p?id=42')).toBe('https://exemplo.com/p?id=42')
  })

  it('não funde documentos que só diferem no caminho ou na query', () => {
    const distintas = [
      'https://exemplo.com/a',
      'https://exemplo.com/b',
      'https://exemplo.com/a?v=1',
      'https://exemplo.com/a?v=2',
      'https://outro.com/a'
    ].map(normalizarUrl)

    expect(new Set(distintas).size).toBe(distintas.length)
  })

  it('http e https são documentos distintos', () => {
    // Não é o mesmo endereço, e tratá-los como um agruparia a versão insegura com a segura.
    expect(normalizarUrl('http://exemplo.com/a')).not.toBe(normalizarUrl('https://exemplo.com/a'))
  })

  it('devolve a entrada crua quando ela não é URL absoluta', () => {
    // Normalizar o que não se entende seria inventar uma canônica.
    expect(normalizarUrl('nem-url')).toBe('nem-url')
    expect(normalizarUrl('')).toBe('')
    expect(normalizarUrl('file:///etc/passwd')).toBe('file:///etc/passwd')
  })

  it('é idempotente — normalizar a canônica devolve ela mesma', () => {
    const uma = normalizarUrl('https://WWW.Exemplo.com/docs/?utm_source=x#f')
    expect(normalizarUrl(uma)).toBe(uma)
  })
})

describe('domínio', () => {
  it('extrai o host sem www e em minúscula', () => {
    expect(dominioDe('https://WWW.Exemplo.com/a/b')).toBe('exemplo.com')
    expect(dominioDe('https://sub.exemplo.com/a')).toBe('sub.exemplo.com')
  })

  it('devolve vazio para o que não é URL', () => {
    expect(dominioDe('nem-url')).toBe('')
  })
})

describe('ehUrlHttp — a guarda que recusa o que não é web', () => {
  it('aceita http e https', () => {
    expect(ehUrlHttp('http://exemplo.com')).toBe(true)
    expect(ehUrlHttp('https://exemplo.com')).toBe(true)
  })

  it('recusa esquema local e relativo', () => {
    // `file:///etc/passwd` é URL válida para o construtor, e repassá-la a um extrator seria
    // pedir a leitura de um caminho local por uma entrada que veio de fora.
    expect(ehUrlHttp('file:///etc/passwd')).toBe(false)
    expect(ehUrlHttp('ftp://exemplo.com')).toBe(false)
    expect(ehUrlHttp('javascript:alert(1)')).toBe(false)
    expect(ehUrlHttp('/caminho/relativo')).toBe(false)
  })
})

describe('validação da busca — recusa antes de qualquer I/O', () => {
  const valida = (input: unknown): string | undefined =>
    validarEntrada(TAVILY_OPERATIONS.search, input)

  it('aceita o mínimo e o completo', () => {
    expect(valida({ query: 'mercado de agentes' })).toBeUndefined()
    expect(
      valida({
        query: 'x',
        depth: 'advanced',
        maxResults: 10,
        includeDomains: ['a.com'],
        excludeDomains: ['b.com']
      })
    ).toBeUndefined()
  })

  it('exige query não vazia', () => {
    expect(valida({})).toContain('query')
    expect(valida({ query: '' })).toContain('query')
    expect(valida({ query: '   ' })).toContain('query')
    expect(valida({ query: 42 })).toContain('query')
  })

  it('recusa entrada que não é objeto', () => {
    expect(valida(null)).toBeDefined()
    expect(valida('texto')).toBeDefined()
    expect(valida(undefined)).toBeDefined()
  })

  it('recusa profundidade desconhecida', () => {
    expect(valida({ query: 'x', depth: 'ultra' })).toContain('depth')
    expect(valida({ query: 'x', depth: 3 })).toContain('depth')
  })

  it('recusa maxResults fora da faixa ou não inteiro', () => {
    expect(valida({ query: 'x', maxResults: 0 })).toContain('maxResults')
    expect(valida({ query: 'x', maxResults: MAX_RESULTADOS_TETO + 1 })).toContain('maxResults')
    expect(valida({ query: 'x', maxResults: 1.5 })).toContain('maxResults')
    expect(valida({ query: 'x', maxResults: MAX_RESULTADOS_TETO })).toBeUndefined()
  })

  it('recusa lista de domínios malformada', () => {
    expect(valida({ query: 'x', includeDomains: 'a.com' })).toContain('includeDomains')
    expect(valida({ query: 'x', includeDomains: [''] })).toContain('includeDomains')
    expect(valida({ query: 'x', excludeDomains: [42] })).toContain('excludeDomains')
  })
})

describe('validação da extração', () => {
  const valida = (input: unknown): string | undefined =>
    validarEntrada(TAVILY_OPERATIONS.extract, input)

  it('aceita uma ou várias URLs http(s)', () => {
    expect(valida({ urls: ['https://a.com'] })).toBeUndefined()
    expect(valida({ urls: ['https://a.com', 'http://b.com'], depth: 'advanced' })).toBeUndefined()
  })

  it('exige ao menos uma URL', () => {
    expect(valida({ urls: [] })).toContain('urls')
    expect(valida({})).toContain('urls')
    expect(valida({ urls: 'https://a.com' })).toContain('urls')
  })

  it('recusa URL que não é http(s)', () => {
    // A guarda que impede uma entrada externa pedir a leitura de um caminho local.
    expect(valida({ urls: ['file:///etc/passwd'] })).toContain('http(s)')
    expect(valida({ urls: ['https://a.com', 'nem-url'] })).toContain('http(s)')
  })

  it('recusa acima do teto de URLs por chamada', () => {
    const muitas = Array.from({ length: MAX_URLS_EXTRACT + 1 }, (_, i) => `https://a.com/${i}`)
    expect(valida({ urls: muitas })).toContain(String(MAX_URLS_EXTRACT))
  })

  it('recusa query de reordenação vazia quando informada', () => {
    expect(valida({ urls: ['https://a.com'], query: '' })).toContain('query')
    expect(valida({ urls: ['https://a.com'], query: 'intenção' })).toBeUndefined()
  })
})

describe('operação desconhecida', () => {
  it('não pertence ao conector', () => {
    // O registro já filtra antes, mas a validação continua total: uma operação nova declarada e
    // não roteada falha aqui, alto e claro.
    expect(validarEntrada('search.outra', { query: 'x' })).toContain('não pertence')
  })
})

describe('busca sem fontes — resposta legítima que não vira sucesso vazio', () => {
  it('produz erro com ação de corrigir e proveniência da busca', () => {
    const erro = erroDeBuscaSemFontes('termo raro', '2026-08-29T12:00:00.000Z')

    expect(erro.ok).toBe(false)
    expect(erro.code).toBe('resposta-invalida')
    expect(erro.retryable).toBe(false)
    expect(erro.acao).toBe('corrigir-entrada')
    expect(erro.provenance.connector).toBe('tavily')
    expect(erro.provenance.operation).toBe(TAVILY_OPERATIONS.search)
    // A mensagem precisa dizer o que **não** fazer: o critério 5 da F05 é que memória do modelo
    // nunca preenche resultado.
    expect(erro.mensagem).toContain('memória')
    expect(erro.mensagem).toContain('termo raro')
  })
})
