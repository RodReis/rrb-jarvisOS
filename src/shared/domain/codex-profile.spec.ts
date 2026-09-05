/**
 * As regras do perfil Codex (SPEC-Multi-Executor-02, critérios 4, 5 e 6).
 *
 * O que este arquivo prova é a parte da fatia que **não** depende do CLI: quem pode trocar de
 * modo de cobrança, e quando um run pode gastar dinheiro. São as duas decisões onde um erro
 * custa dinheiro do PI sem ninguém autorizar, e por isso são função pura — testá-las exigindo
 * subprocess faria os casos de borda ficarem sem cobertura.
 */

import { describe, expect, it } from 'vitest'
import {
  ACAO_DA_SAUDE,
  CODEX_BILLING_MODES,
  CODEX_HEALTH_STATES,
  MODO_DE_COBRANCA_PADRAO,
  execucaoPermitida,
  isCodexBillingMode,
  isCodexHealthState,
  modoGastaDinheiro,
  trocaDeModoPermitida,
  type CodexBillingMode
} from './codex-profile'

describe('estados de saúde', () => {
  it('reconhece os cinco estados da spec e recusa o que não é um deles', () => {
    for (const estado of CODEX_HEALTH_STATES) {
      expect(isCodexHealthState(estado)).toBe(true)
    }
    expect(isCodexHealthState('pronto')).toBe(false)
    expect(isCodexHealthState('')).toBe(false)
    expect(isCodexHealthState(undefined)).toBe(false)
  })

  /**
   * `quota_limited` e `quota_unknown` são estados distintos — não sinônimos.
   *
   * O primeiro afirma que existe um teto atingido; o segundo, que não se sabe. A regra 2 da spec
   * existe justamente para impedir que "não sei" seja lido como "ilimitado", e colapsá-los aqui
   * apagaria a distinção que ela protege.
   */
  it('distingue limite atingido de ausência de telemetria', () => {
    expect(CODEX_HEALTH_STATES).toContain('quota_limited')
    expect(CODEX_HEALTH_STATES).toContain('quota_unknown')
  })

  /**
   * Todo estado que exige ação do PI traz a ação; os que não exigem, não inventam uma.
   *
   * `quota_unknown` é o estado **normal** deste CLI (não há telemetria a ler), então uma ação ali
   * ensinaria a tratar um aviso permanente como problema a resolver.
   */
  it('dá ação concreta a quem precisa destravar, e só a esses', () => {
    expect(ACAO_DA_SAUDE.auth_required).toMatch(/entrar|autenticar/i)
    expect(ACAO_DA_SAUDE.offline).toMatch(/instalad|PATH/i)
    expect(ACAO_DA_SAUDE.quota_limited).toBeDefined()

    expect(ACAO_DA_SAUDE.ready).toBeUndefined()
    expect(ACAO_DA_SAUDE.quota_unknown).toBeUndefined()
  })
})

describe('modos de cobrança', () => {
  it('nasce no modo que não gasta dinheiro', () => {
    expect(MODO_DE_COBRANCA_PADRAO).toBe('subscription_limited')
    expect(modoGastaDinheiro(MODO_DE_COBRANCA_PADRAO)).toBe(false)
  })

  it('reconhece os três modos e recusa o que não é um deles', () => {
    for (const modo of CODEX_BILLING_MODES) {
      expect(isCodexBillingMode(modo)).toBe(true)
    }
    expect(isCodexBillingMode('subscription')).toBe(false)
    expect(isCodexBillingMode('free')).toBe(false)
  })

  it('marca como monetários exatamente créditos e API', () => {
    expect(modoGastaDinheiro('subscription_credits')).toBe(true)
    expect(modoGastaDinheiro('api')).toBe(true)
    expect(modoGastaDinheiro('subscription_limited')).toBe(false)
  })
})

describe('troca de modo (regras 3 e 4, critério 4)', () => {
  /**
   * **O teste central da fatia.** A regra 3 é literal: *"rate limit de assinatura não autoriza
   * créditos nem API"*.
   *
   * A função nem recebe a saúde do perfil — e é essa ausência que o teste trava. Se um dia
   * alguém acrescentar `saude` à assinatura para "facilitar" a subida quando a quota acabar,
   * este teste continua passando, mas o de baixo (`sem habilitação, nada sobe`) quebra. Os dois
   * juntos é que fecham a regra.
   */
  it('sem habilitação explícita do PI, nada sobe para modo monetário', () => {
    for (const para of ['subscription_credits', 'api'] as const) {
      expect(trocaDeModoPermitida('subscription_limited', para, false)).toBe(false)
    }
  })

  it('com habilitação explícita, a subida é permitida', () => {
    expect(trocaDeModoPermitida('subscription_limited', 'subscription_credits', true)).toBe(true)
    expect(trocaDeModoPermitida('subscription_limited', 'api', true)).toBe(true)
  })

  /**
   * Descer nunca precisa de autorização: parar de gastar não é decisão que exija aval.
   *
   * O contrafactual importa — uma implementação que exigisse `habilitadoPeloPi` para toda troca
   * passaria no teste acima e prenderia o PI no modo caro.
   */
  it('voltar para a assinatura é livre, mesmo sem habilitação', () => {
    expect(trocaDeModoPermitida('subscription_credits', 'subscription_limited', false)).toBe(true)
    expect(trocaDeModoPermitida('api', 'subscription_limited', false)).toBe(true)
  })

  it('ficar no mesmo modo não é uma troca a autorizar', () => {
    for (const modo of CODEX_BILLING_MODES) {
      expect(trocaDeModoPermitida(modo, modo, false)).toBe(true)
    }
  })

  /**
   * Entre dois modos monetários também exige habilitação: sair de créditos para API é uma
   * decisão de cobrança nova, não a continuação da anterior (regra 4 — "alterar modo de cobrança
   * cria nova decisão auditada").
   */
  it('trocar entre dois modos monetários ainda exige habilitação', () => {
    expect(trocaDeModoPermitida('subscription_credits', 'api', false)).toBe(false)
    expect(trocaDeModoPermitida('api', 'subscription_credits', false)).toBe(false)
  })
})

describe('gate de execução (critério 5)', () => {
  it('modo de assinatura passa sem teto: não há dinheiro a gatear', () => {
    expect(execucaoPermitida({ modo: 'subscription_limited', gastoUsd: 999 }).permitida).toBe(true)
  })

  /**
   * **Fail closed na ignorância.** Teto ausente num modo monetário bloqueia.
   *
   * "Não configurou teto" não é "pode gastar à vontade" — é a mesma inversão que
   * `listaDePathsValida` recusa com lista vazia. Sem este caso, o modo caro rodaria sem limite
   * nenhum para quem simplesmente não configurou nada.
   */
  it('modo monetário sem teto configurado bloqueia, com motivo', () => {
    for (const modo of ['subscription_credits', 'api'] as CodexBillingMode[]) {
      const veredicto = execucaoPermitida({ modo, gastoUsd: 0 })
      expect(veredicto.permitida).toBe(false)
      expect(veredicto.motivo).toMatch(/teto/i)
    }
  })

  it('abaixo do teto, executa', () => {
    expect(
      execucaoPermitida({ modo: 'subscription_credits', tetoUsd: 10, gastoUsd: 9.99 }).permitida
    ).toBe(true)
  })

  /**
   * Gasto **igual** ao teto já bloqueia: executar no limite é a chamada que o ultrapassa.
   *
   * O contrafactual de um `>` no lugar do `>=` passa em todos os outros casos deste bloco.
   */
  it('gasto igual ao teto bloqueia antes da execução monetária', () => {
    const veredicto = execucaoPermitida({
      modo: 'subscription_credits',
      tetoUsd: 10,
      gastoUsd: 10
    })
    expect(veredicto.permitida).toBe(false)
    expect(veredicto.motivo).toMatch(/teto/i)
  })

  it('gasto acima do teto bloqueia', () => {
    expect(execucaoPermitida({ modo: 'api', tetoUsd: 10, gastoUsd: 10.01 }).permitida).toBe(false)
  })

  /**
   * Teto zero é uma decisão do PI ("não quero gastar nada"), não ausência de configuração.
   *
   * Sem este caso, um `tetoUsd ?? undefined` mal escrito trataria `0` como falsy e cairia no ramo
   * de "não configurou" — mesma mensagem, motivo errado.
   */
  it('teto zero bloqueia por teto atingido, não por falta de configuração', () => {
    const veredicto = execucaoPermitida({ modo: 'api', tetoUsd: 0, gastoUsd: 0 })
    expect(veredicto.permitida).toBe(false)
    expect(veredicto.motivo).toMatch(/atingido/i)
  })
})
