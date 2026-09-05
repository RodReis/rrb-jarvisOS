/**
 * A escolha de rota e o bloqueio antes da rota paga (SPEC-Jornada-02, critério 6).
 *
 * A spec pede *"teste de rota (assinatura, paga com e sem opt-in, indisponível)"*. O que estes
 * testes protegem é uma ausência: **não existe caminho que caia na rota paga sem autorização**.
 *
 * É a decisão 4 do MVP-008 levada à consequência. O gate de orçamento em dólar só existe para a
 * rota paga; se a paga puder ser fallback, o gate deixa de ser gate — passaria a ser atravessado
 * justamente nos momentos em que ninguém decidiu atravessá-lo.
 */

import { describe, expect, it } from 'vitest'
import type { EstadoDasRotas } from './rota-de-geracao'
import {
  ACAO_DO_BLOQUEIO,
  PROVIDER_DA_ROTA,
  ehAssinatura,
  escolherRota,
  podeGerar,
  providerDaRota
} from './rota-de-geracao'

function estado(over: Partial<EstadoDasRotas> = {}): EstadoDasRotas {
  return {
    assinaturaDisponivel: true,
    assinaturaEsgotada: false,
    rotaPagaConfigurada: false,
    optInDeRotaPaga: false,
    ...over
  }
}

describe('a assinatura é a rota padrão', () => {
  it('usa a assinatura quando ela está disponível', () => {
    expect(escolherRota(estado()).decisao).toBe('assinatura')
  })

  it('prefere a assinatura mesmo com a rota paga configurada e autorizada', () => {
    // A paga é exceção autorizada, não alternativa equivalente. Inverter a ordem faria o opt-in
    // virar preferência em vez de permissão.
    const r = escolherRota(estado({ rotaPagaConfigurada: true, optInDeRotaPaga: true }))

    expect(r.decisao).toBe('assinatura')
  })
})

describe('sem assinatura e sem opt-in, bloqueia (critério 6)', () => {
  it('bloqueia quando a assinatura não está disponível e não há opt-in', () => {
    const r = escolherRota(estado({ assinaturaDisponivel: false, rotaPagaConfigurada: true }))

    expect(r.decisao).toBe('bloqueado')
    expect(r.motivo).toBe('assinatura-indisponivel-sem-opt-in')
  })

  it('bloqueia mesmo quando a rota paga é a única configurada', () => {
    // O caso perigoso: é aqui que um `else` cairia na paga "porque é o que tem". Ter credencial
    // configurada não é autorização para gastar.
    const r = escolherRota(estado({ assinaturaDisponivel: false, rotaPagaConfigurada: true }))

    expect(r.decisao).not.toBe('paga')
  })

  it('bloqueia quando a quota da assinatura acabou e não há opt-in', () => {
    const r = escolherRota(estado({ assinaturaEsgotada: true, rotaPagaConfigurada: true }))

    expect(r.decisao).toBe('bloqueado')
    expect(r.motivo).toBe('assinatura-esgotada-sem-opt-in')
  })

  it('distingue "não configurada" de "esgotada" — as ações são diferentes', () => {
    const semNada = escolherRota(estado({ assinaturaDisponivel: false }))
    const esgotada = escolherRota(estado({ assinaturaEsgotada: true }))

    expect(semNada.motivo).toBe('sem-rota-alguma')
    expect(esgotada.motivo).toBe('assinatura-esgotada-sem-opt-in')
  })

  it('todo bloqueio traz ação concreta — bloqueio sem saída é beco', () => {
    for (const motivo of Object.keys(ACAO_DO_BLOQUEIO)) {
      expect(ACAO_DO_BLOQUEIO[motivo as keyof typeof ACAO_DO_BLOQUEIO]).toBeTruthy()
    }

    const r = escolherRota(estado({ assinaturaDisponivel: false }))
    expect(r.acao).toBeTruthy()
  })
})

describe('a rota paga só com opt-in explícito', () => {
  it('usa a paga quando o PI a habilitou e a assinatura não serve', () => {
    const r = escolherRota(
      estado({ assinaturaDisponivel: false, rotaPagaConfigurada: true, optInDeRotaPaga: true })
    )

    expect(r.decisao).toBe('paga')
  })

  it('usa a paga quando a assinatura esgotou e há opt-in', () => {
    const r = escolherRota(
      estado({ assinaturaEsgotada: true, rotaPagaConfigurada: true, optInDeRotaPaga: true })
    )

    expect(r.decisao).toBe('paga')
  })

  it('opt-in sem credencial configurada não gera — bloqueia', () => {
    // Autorizar não cria a credencial. Sem ela não há rota, e a chamada falharia depois de já
    // ter sido tentada — que é o que o critério 6 impede.
    const r = escolherRota(
      estado({ assinaturaDisponivel: false, rotaPagaConfigurada: false, optInDeRotaPaga: true })
    )

    expect(r.decisao).toBe('bloqueado')
    expect(r.motivo).toBe('sem-rota-alguma')
  })
})

describe('a guarda como expressão única', () => {
  it('podeGerar concorda com escolherRota em todas as combinações', () => {
    // Varre as 16 combinações: a guarda existe para que a checagem não seja um `if` reescrito
    // em cada call site, e um deles esqueceria o caso `bloqueado`.
    for (const assinaturaDisponivel of [true, false]) {
      for (const assinaturaEsgotada of [true, false]) {
        for (const rotaPagaConfigurada of [true, false]) {
          for (const optInDeRotaPaga of [true, false]) {
            const e = {
              assinaturaDisponivel,
              assinaturaEsgotada,
              rotaPagaConfigurada,
              optInDeRotaPaga
            }
            expect(podeGerar(e)).toBe(escolherRota(e).decisao !== 'bloqueado')
          }
        }
      }
    }
  })

  it('nenhuma combinação sem opt-in resulta em rota paga', () => {
    // A invariante da fatia, medida sobre o espaço inteiro em vez de casos escolhidos a dedo.
    for (const assinaturaDisponivel of [true, false]) {
      for (const assinaturaEsgotada of [true, false]) {
        for (const rotaPagaConfigurada of [true, false]) {
          const r = escolherRota({
            assinaturaDisponivel,
            assinaturaEsgotada,
            rotaPagaConfigurada,
            optInDeRotaPaga: false
          })
          expect(r.decisao).not.toBe('paga')
        }
      }
    }
  })
})

describe('provider concreto de cada rota', () => {
  it('mapeia assinatura e paga para os providers do produto', () => {
    expect(PROVIDER_DA_ROTA.assinatura).toBe('claude-code')
    expect(PROVIDER_DA_ROTA.paga).toBe('anthropic')
  })

  it('não tem entrada para bloqueado: rota bloqueada não gera, logo não tem provider', () => {
    expect(Object.keys(PROVIDER_DA_ROTA)).toEqual(['assinatura', 'paga'])
  })
})

/**
 * Duas assinaturas, nenhuma cai na outra (SPEC-Fases-06, critério 4).
 *
 * É a decisão 4 do MVP-025 estendida: a rota paga nunca é fallback, e **entre assinaturas vale o
 * mesmo** — trocar de fornecedor sem o PI decidir é a mesma surpresa em outra moeda.
 */
describe('duas assinaturas (SPEC-Fases-06)', () => {
  /**
   * **O teste central da fatia.** Sol escolhido, Codex fora do ar, Claude MAX conectado: bloqueia.
   *
   * O estado carrega **uma** assinatura — a que a fase escolheu —, então não existe caminho aqui
   * que caia na outra. Um `||` entre as duas disponibilidades faria a geração sair pelo Claude
   * com o ledger registrando o modelo do Codex.
   */
  it('bloqueia quando a assinatura da fase está fora, mesmo com a outra conectada', () => {
    const r = escolherRota(
      estado({ assinaturaDisponivel: false, assinaturaDe: 'codex', rotaPagaConfigurada: false })
    )

    expect(r.decisao).toBe('bloqueado')
    expect(r.provider).toBeUndefined()
  })

  /** A ação nomeia **o fornecedor certo**: mandar conectar o Claude não destrava o Codex. */
  it('manda conectar o Codex quando foi o Codex que faltou', () => {
    const r = escolherRota(
      estado({ assinaturaDisponivel: false, assinaturaDe: 'codex', rotaPagaConfigurada: true })
    )

    expect(r.acao).toContain('Codex')
    expect(r.acao).not.toContain('Claude')
  })

  it('manda conectar o Claude quando foi o Claude que faltou', () => {
    const r = escolherRota(
      estado({
        assinaturaDisponivel: false,
        assinaturaDe: 'claude-code',
        rotaPagaConfigurada: true
      })
    )

    expect(r.acao).toContain('Claude')
  })

  /** A ação oferece **trocar o modelo da fase** — a saída que não gasta dinheiro. */
  it('oferece trocar o modelo da fase como alternativa ao opt-in pago', () => {
    const r = escolherRota(
      estado({ assinaturaDisponivel: false, assinaturaDe: 'codex', rotaPagaConfigurada: true })
    )

    expect(r.acao).toMatch(/troque o modelo da fase/i)
  })

  /**
   * O provider da rota é **o da assinatura que a fase escolheu**, não o do mapa.
   *
   * Sem isto, `PROVIDER_DA_ROTA['assinatura']` devolveria `claude-code` para uma geração por Sol,
   * e a chamada sairia pelo fornecedor errado — com o ledger registrando o provider errado junto.
   */
  it('devolve o provider da assinatura escolhida, não o do mapa', () => {
    const comCodex = escolherRota(estado({ assinaturaDe: 'codex' }))
    expect(comCodex.decisao).toBe('assinatura')
    expect(comCodex.provider).toBe('codex')
    expect(providerDaRota(comCodex)).toBe('codex')

    const comClaude = escolherRota(estado({ assinaturaDe: 'claude-code' }))
    expect(providerDaRota(comClaude)).toBe('claude-code')
  })

  /** Sem assinatura declarada (o painel do Settings), cai no padrão — e não quebra. */
  it('cai no provider padrão quando a assinatura não foi declarada', () => {
    expect(providerDaRota(escolherRota(estado()))).toBe('claude-code')
  })

  it('rota bloqueada não tem provider', () => {
    const r = escolherRota(estado({ assinaturaDisponivel: false, assinaturaDe: 'codex' }))
    expect(providerDaRota(r)).toBeUndefined()
  })

  /**
   * A rota paga continua sendo a paga, venha de qual assinatura vier: o opt-in é sobre **gastar
   * dinheiro**, e o fornecedor da assinatura que falhou não muda isso.
   */
  it('a rota paga usa o provider pago, seja qual for a assinatura que faltou', () => {
    for (const assinaturaDe of ['claude-code', 'codex'] as const) {
      const r = escolherRota(
        estado({
          assinaturaDisponivel: false,
          assinaturaDe,
          rotaPagaConfigurada: true,
          optInDeRotaPaga: true
        })
      )

      expect(r.decisao).toBe('paga')
      expect(providerDaRota(r)).toBe('anthropic')
    }
  })

  /** `ehAssinatura` reconhece as duas, e só elas. */
  it('reconhece as duas rotas de assinatura, e nenhuma outra', () => {
    expect(ehAssinatura('claude-code')).toBe(true)
    expect(ehAssinatura('codex')).toBe(true)
    expect(ehAssinatura('anthropic')).toBe(false)
    expect(ehAssinatura('ollama')).toBe(false)
  })
})
