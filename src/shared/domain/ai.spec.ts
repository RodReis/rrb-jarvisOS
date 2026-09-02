import { describe, expect, it } from 'vitest'
import {
  AI_PROVIDERS,
  CREDENCIAL_DO_PROVIDER,
  MODELO_PADRAO,
  ROTAS_UNMETERED,
  TABELA_DE_PRECO,
  calcularCustoUsd,
  estimarCustoUsd,
  isAiProvider,
  isRotaUnmetered,
  isRotaSubscriptionLimited,
  ROTAS_SUBSCRIPTION_LIMITED,
  type AiProvider
} from './ai'
import { CREDENTIAL_KEYS } from './credentials'

/**
 * Contrato de providers (SPEC-Providers-02, critério 4).
 *
 * O que se prova aqui é o **número**: estimativa e custo real saem da mesma tabela semeada, e é
 * essa igualdade de fonte que impede a F03 de gatear com um preço e a auditoria de registrar
 * outro. Sem rede — a conta é pura de propósito.
 */

describe('tabela de preço (critério 4)', () => {
  it('todo provider tem preço e modelo padrão — nenhum provider sem tabela', () => {
    // A varredura é sobre `AI_PROVIDERS`, não sobre as chaves da tabela: acrescentar provider
    // na F04 sem semear o preço dele deixaria a estimativa em zero **em silêncio**, e uma
    // chamada estimada em zero é a que passa por qualquer gate de orçamento.
    for (const provider of AI_PROVIDERS) {
      expect(TABELA_DE_PRECO[provider], `preço de ${provider}`).toBeDefined()
      expect(Object.keys(TABELA_DE_PRECO[provider]).length).toBeGreaterThan(0)

      const padrao = MODELO_PADRAO[provider]
      expect(TABELA_DE_PRECO[provider][padrao], `preço do padrão ${padrao}`).toBeDefined()
    }
  })

  it('todo provider que consome credencial aponta para uma que existe no vault', () => {
    // O elo com a F01: `CREDENCIAL_DO_PROVIDER` é explícito para não derivar nome de string,
    // e este teste é o que impede a explicitude de apontar para uma chave inexistente — caso
    // em que a chamada falharia por "credencial ausente" com a chave gravada e presente.
    //
    // `undefined` é resposta válida desde a F04, e **só** para quem de fato não consome
    // credencial: o Ollama fala com o `localhost` e o `claude-code` usa a sessão do CLI. A
    // guarda não afrouxou — ela passou a distinguir "não precisa" de "aponta para o nada".
    for (const provider of AI_PROVIDERS) {
      const chave = CREDENCIAL_DO_PROVIDER[provider]
      if (chave === undefined) {
        expect(ROTAS_UNMETERED).toContain(provider)
        continue
      }
      expect(CREDENTIAL_KEYS).toContain(chave)
    }
  })

  it('só rota unmetered pode dispensar credencial — nenhum provider pago escapa', () => {
    // O contrafactual da guarda acima: sem esta, marcar um provider pago como `undefined`
    // passaria em silêncio e a chamada sairia sem chave.
    for (const provider of AI_PROVIDERS) {
      if (isRotaUnmetered(provider)) continue
      expect(CREDENCIAL_DO_PROVIDER[provider]).toBeDefined()
    }
  })

  it('saída custa mais que entrada em todo modelo pago — a assimetria dos providers', () => {
    for (const [provider, modelos] of Object.entries(TABELA_DE_PRECO)) {
      // Rota `unmetered` custa zero nos dois lados, e zero > zero é falso. Pular aqui não é
      // exceção conveniente: a assimetria é um fato sobre **preço cobrado**, e não existe
      // preço a comparar onde não há cobrança por chamada.
      if (isRotaUnmetered(provider as AiProvider)) continue

      for (const [modelo, preco] of Object.entries(modelos)) {
        expect(preco.saida, `${provider}/${modelo}`).toBeGreaterThan(preco.entrada)
      }
    }
  })

  it('toda rota unmetered custa exatamente zero — não "quase zero"', () => {
    // O par da guarda acima: o que a isenta da assimetria é ser zero, e este teste é o que
    // impede um preço pequeno de se esconder atrás da isenção.
    for (const provider of AI_PROVIDERS) {
      if (!isRotaUnmetered(provider)) continue

      for (const [modelo, preco] of Object.entries(TABELA_DE_PRECO[provider])) {
        expect(preco.entrada, `${provider}/${modelo}`).toBe(0)
        expect(preco.saida, `${provider}/${modelo}`).toBe(0)
      }
    }
  })
})

describe('cálculo de custo (critério 4)', () => {
  it('converte tokens em dólares pela tabela — a conta, não uma aproximação', () => {
    // 1M de entrada a $5 + 1M de saída a $25 = $30. Números redondos de propósito: um erro de
    // fator (1000 em vez de 1M) apareceria como ordem de grandeza, não como arredondamento.
    const custo = calcularCustoUsd('anthropic', 'claude-opus-5', {
      tokensEntrada: 1_000_000,
      tokensSaida: 1_000_000
    })

    expect(custo).toBeCloseTo(30, 10)
  })

  it('cobra por fração de milhão — 1.000 tokens não custam um milhão', () => {
    const custo = calcularCustoUsd('anthropic', 'claude-opus-5', {
      tokensEntrada: 1_000,
      tokensSaida: 500
    })

    // 1.000/1M × $5 + 500/1M × $25 = $0,005 + $0,0125
    expect(custo).toBeCloseTo(0.0175, 10)
  })

  it('modelo desconhecido custa zero em vez de lançar', () => {
    // A escolha registrada no contrato: um preço faltando não pode derrubar uma chamada que o
    // usuário já pagou. Zero é visível na auditoria; uma exceção perderia a resposta inteira.
    expect(
      calcularCustoUsd('anthropic', 'modelo-que-nao-existe', {
        tokensEntrada: 1_000_000,
        tokensSaida: 1_000_000
      })
    ).toBe(0)
  })

  it('o modelo mais barato custa menos que o mais caro no mesmo uso', () => {
    const uso = { tokensEntrada: 100_000, tokensSaida: 50_000 }

    expect(calcularCustoUsd('anthropic', 'claude-haiku-4-5', uso)).toBeLessThan(
      calcularCustoUsd('anthropic', 'claude-opus-5', uso)
    )
  })
})

describe('estimativa pré-chamada (critério 4)', () => {
  it('assume o teto inteiro de saída — a estimativa é cota superior, não palpite médio', () => {
    // O que a F03 vai gatear. Uma estimativa otimista deixaria passar exatamente a chamada que
    // estoura o orçamento, então o erro que este teste trava é o de subestimar.
    const maxTokens = 4_000
    const estimado = estimarCustoUsd('anthropic', 'claude-opus-5', 'oi', maxTokens)

    const custoDoTetoDeSaida = calcularCustoUsd('anthropic', 'claude-opus-5', {
      tokensEntrada: 0,
      tokensSaida: maxTokens
    })

    expect(estimado).toBeGreaterThanOrEqual(custoDoTetoDeSaida)
  })

  it('prompt maior estima mais caro', () => {
    const curto = estimarCustoUsd('anthropic', 'claude-opus-5', 'oi', 1_000)
    const longo = estimarCustoUsd('anthropic', 'claude-opus-5', 'x'.repeat(100_000), 1_000)

    expect(longo).toBeGreaterThan(curto)
  })

  it('a estimativa cobre o custo real quando a resposta usa o teto', () => {
    // A propriedade que sustenta o gate da F03: estimar antes e medir depois só é útil se o
    // antes for uma cota do depois. Aqui a resposta gasta o teto e a estimativa ainda cobre.
    const prompt = 'x'.repeat(4_000) // ≈1.000 tokens pela aproximação de 4 chars/token
    const maxTokens = 2_000

    const estimado = estimarCustoUsd('anthropic', 'claude-opus-5', prompt, maxTokens)
    const real = calcularCustoUsd('anthropic', 'claude-opus-5', {
      tokensEntrada: 1_000,
      tokensSaida: maxTokens
    })

    expect(estimado).toBeGreaterThanOrEqual(real)
  })
})

describe('guarda de tipo', () => {
  it('aceita provider conhecido e recusa o resto', () => {
    expect(isAiProvider('anthropic')).toBe(true)
    expect(isAiProvider('openai')).toBe(false)
    expect(isAiProvider(undefined)).toBe(false)
    expect(isAiProvider(42)).toBe(false)
  })
})

describe('isRotaSubscriptionLimited', () => {
  it('claude-code é subscription_limited, não unmetered puro', () => {
    expect(isRotaSubscriptionLimited('claude-code')).toBe(true)
    expect(ROTAS_SUBSCRIPTION_LIMITED).toContain('claude-code')
  })

  it('anthropic e gemini não são subscription_limited', () => {
    expect(isRotaSubscriptionLimited('anthropic')).toBe(false)
    expect(isRotaSubscriptionLimited('gemini')).toBe(false)
  })

  it('ollama não é subscription_limited (é unmetered por rodar local, não por assinatura)', () => {
    expect(isRotaSubscriptionLimited('ollama')).toBe(false)
  })
})
