/**
 * A decisão do gate de orçamento (SPEC-Providers-03, critérios 2, 3 e 5).
 *
 * Testa a **função pura**, sem banco, relógio ou auditoria: o que os critérios 2 e 5 afirmam é
 * sobre o número — dado o acumulado e a estimativa, qual caminho. A integração do gate com o
 * ponto único tem teste próprio (`call-provider.int-spec.ts`).
 */

import { describe, expect, it } from 'vitest'
import {
  LIMIAR_DE_ALERTA_PADRAO,
  LIMITE_DIARIO_PADRAO,
  LIMITE_MENSAL_PADRAO,
  avaliarOrcamento,
  isBudgetLimitsInput,
  mensagemDeBloqueio,
  orcamentoPadrao,
  type BudgetPolicy
} from './budget'

const policy = (override: Partial<BudgetPolicy> = {}): BudgetPolicy => ({
  ...orcamentoPadrao('user-1', 'noa'),
  ...override
})

describe('orcamentoPadrao', () => {
  it('nasce com USD 1/dia e USD 1/mês, limiar 0,8 e escopo do chamador (critério 1)', () => {
    const padrao = orcamentoPadrao('user-1', 'jarvis')

    expect(padrao).toEqual({
      user_id: 'user-1',
      workspace_id: 'jarvis',
      dailyLimit: LIMITE_DIARIO_PADRAO,
      monthlyLimit: LIMITE_MENSAL_PADRAO,
      alertThreshold: LIMIAR_DE_ALERTA_PADRAO,
      currency: 'USD'
    })
    expect(LIMITE_DIARIO_PADRAO).toBe(1)
    expect(LIMITE_MENSAL_PADRAO).toBe(1)
  })
})

describe('avaliarOrcamento — os três caminhos (critério 2)', () => {
  it('abaixo do limiar de alerta: permite sem alerta', () => {
    const veredito = avaliarOrcamento(policy(), { diaUsd: 0.1, mesUsd: 0.1 }, 0.1)

    expect(veredito).toEqual({ decisao: 'permitido' })
  })

  it('cruza o limiar de alerta: segue, mas alerta com a fração atingida', () => {
    // 0,75 + 0,10 = 0,85 de 1,00 → 85% ≥ 80%, e ainda abaixo do teto.
    const veredito = avaliarOrcamento(policy(), { diaUsd: 0.75, mesUsd: 0.75 }, 0.1)

    expect(veredito.decisao).toBe('alerta')
    if (veredito.decisao !== 'alerta') throw new Error('esperado alerta')
    expect(veredito.periodo).toBe('dia')
    expect(veredito.fracao).toBeCloseTo(0.85)
    expect(veredito.projetadoUsd).toBeCloseTo(0.85)
  })

  it('excederia o limite: bloqueia e nomeia o período e os números', () => {
    const veredito = avaliarOrcamento(policy(), { diaUsd: 0.95, mesUsd: 0.95 }, 0.1)

    expect(veredito).toEqual({
      decisao: 'bloqueado',
      periodo: 'dia',
      limiteUsd: 1,
      projetadoUsd: 1.05
    })
  })

  it('gastar exatamente o limite é respeitá-lo, não excedê-lo', () => {
    // A fronteira: `>` e não `>=`. Com `>=`, a chamada que fecha o orçamento no ponto seria
    // barrada — e o limite anunciado deixaria de ser gastável.
    const veredito = avaliarOrcamento(policy(), { diaUsd: 0.9, mesUsd: 0.9 }, 0.1)

    expect(veredito.decisao).not.toBe('bloqueado')
  })

  it('bloqueio vence alerta: o projetado que estoura não sai só com aviso', () => {
    // Se o alerta respondesse primeiro, este caso (que cruza 80% *e* estoura) sairia como
    // 'alerta' — e a chamada que estoura o orçamento teria saído.
    const veredito = avaliarOrcamento(policy(), { diaUsd: 0.99, mesUsd: 0.99 }, 0.5)

    expect(veredito.decisao).toBe('bloqueado')
  })
})

describe('avaliarOrcamento — dia e mês contam separado (critério 3)', () => {
  it('estoura o mensal com o diário folgado: bloqueia nomeando o mês', () => {
    const veredito = avaliarOrcamento(
      policy({ dailyLimit: 5, monthlyLimit: 10 }),
      { diaUsd: 0.5, mesUsd: 9.95 },
      0.1
    )

    expect(veredito.decisao).toBe('bloqueado')
    if (veredito.decisao !== 'bloqueado') throw new Error('esperado bloqueio')
    expect(veredito.periodo).toBe('mes')
    expect(veredito.limiteUsd).toBe(10)
    expect(veredito.projetadoUsd).toBeCloseTo(10.05)
  })

  it('estoura o diário com o mensal folgado: bloqueia nomeando o dia', () => {
    const veredito = avaliarOrcamento(
      policy({ dailyLimit: 1, monthlyLimit: 100 }),
      { diaUsd: 0.95, mesUsd: 3 },
      0.1
    )

    expect(veredito).toEqual({
      decisao: 'bloqueado',
      periodo: 'dia',
      limiteUsd: 1,
      projetadoUsd: 1.05
    })
  })

  it('alerta no mensal quando só ele cruzou o limiar', () => {
    const veredito = avaliarOrcamento(
      policy({ dailyLimit: 100, monthlyLimit: 10 }),
      { diaUsd: 0.5, mesUsd: 8.5 },
      0.1
    )

    expect(veredito.decisao).toBe('alerta')
    if (veredito.decisao !== 'alerta') throw new Error('esperado alerta')
    expect(veredito.periodo).toBe('mes')
  })

  it('os dois estourados: nomeia o diário, que é o que o usuário destrava antes', () => {
    const veredito = avaliarOrcamento(policy(), { diaUsd: 2, mesUsd: 30 }, 0.1)

    expect(veredito.decisao).toBe('bloqueado')
    if (veredito.decisao !== 'bloqueado') throw new Error('esperado bloqueio')
    expect(veredito.periodo).toBe('dia')
  })
})

describe('avaliarOrcamento — limites ajustados (critério 1)', () => {
  it('limite elevado deixa passar o que o padrão barraria', () => {
    const gasto = { diaUsd: 0.95, mesUsd: 0.95 }

    expect(avaliarOrcamento(policy(), gasto, 0.1).decisao).toBe('bloqueado')
    expect(avaliarOrcamento(policy({ dailyLimit: 50, monthlyLimit: 50 }), gasto, 0.1).decisao).toBe(
      'permitido'
    )
  })

  it('limiar ajustado move o ponto do alerta sem mover o do bloqueio', () => {
    const gasto = { diaUsd: 0.5, mesUsd: 0.5 }

    expect(avaliarOrcamento(policy(), gasto, 0.1).decisao).toBe('permitido')
    expect(avaliarOrcamento(policy({ alertThreshold: 0.5 }), gasto, 0.1).decisao).toBe('alerta')
  })

  it('limite zero barra qualquer chamada com custo, sem dividir por zero', () => {
    const veredito = avaliarOrcamento(
      policy({ dailyLimit: 0, monthlyLimit: 0 }),
      { diaUsd: 0, mesUsd: 0 },
      0.01
    )

    expect(veredito.decisao).toBe('bloqueado')
  })

  it('limite zero com estimativa zero permite — e não produz fração NaN', () => {
    const veredito = avaliarOrcamento(
      policy({ dailyLimit: 0, monthlyLimit: 0 }),
      { diaUsd: 0, mesUsd: 0 },
      0
    )

    expect(veredito).toEqual({ decisao: 'permitido' })
  })
})

describe('avaliarOrcamento — melhor esforço com BYOK (critério 5)', () => {
  it('decide sobre a estimativa: o mesmo acumulado passa ou barra conforme ela', () => {
    // O que prova o "melhor esforço": o veredito é função da **estimativa**, não do real —
    // que ainda não existe no momento da decisão. Estimativa baixa deixa passar a chamada
    // que, medida depois, pode ter custado mais.
    const gasto = { diaUsd: 0.9, mesUsd: 0.9 }

    expect(avaliarOrcamento(policy(), gasto, 0.05).decisao).not.toBe('bloqueado')
    expect(avaliarOrcamento(policy(), gasto, 0.2).decisao).toBe('bloqueado')
  })
})

describe('mensagemDeBloqueio', () => {
  it('nomeia o período e os dois números, em pt-BR', () => {
    const texto = mensagemDeBloqueio({
      decisao: 'bloqueado',
      periodo: 'dia',
      limiteUsd: 1,
      projetadoUsd: 1.05
    })

    expect(texto).toContain('diário')
    expect(texto).toContain('US$ 1.00')
    expect(texto).toContain('US$ 1.05')
  })

  it('distingue o mensal do diário', () => {
    const texto = mensagemDeBloqueio({
      decisao: 'bloqueado',
      periodo: 'mes',
      limiteUsd: 10,
      projetadoUsd: 10.5
    })

    expect(texto).toContain('mensal')
  })
})

describe('isBudgetLimitsInput — guard da fronteira do IPC', () => {
  const valido = { dailyLimit: 1, monthlyLimit: 10, alertThreshold: 0.8 }

  it('aceita o payload com os três campos numéricos', () => {
    expect(isBudgetLimitsInput(valido)).toBe(true)
  })

  it('aceita valor fora da faixa: forma é forma, faixa é regra de negócio', () => {
    // O guard checa **forma**. Limite negativo e limiar acima de 1 passam aqui e são
    // recusados no serviço — os dois casos merecem tratamentos diferentes: um é chamador
    // quebrado, o outro é usuário digitando.
    expect(isBudgetLimitsInput({ ...valido, dailyLimit: -1 })).toBe(true)
    expect(isBudgetLimitsInput({ ...valido, alertThreshold: 9 })).toBe(true)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'orçamento'],
    ['número', 42],
    ['array', [1, 2, 3]],
    ['objeto vazio', {}],
    ['sem o limiar', { dailyLimit: 1, monthlyLimit: 10 }],
    ['limite como string', { ...valido, dailyLimit: '1' }],
    ['limite NaN', { ...valido, monthlyLimit: Number.NaN }],
    ['limite infinito', { ...valido, dailyLimit: Number.POSITIVE_INFINITY }]
  ])('recusa %s', (_caso, entrada) => {
    expect(isBudgetLimitsInput(entrada)).toBe(false)
  })
})
