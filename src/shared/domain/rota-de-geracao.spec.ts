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
import { ACAO_DO_BLOQUEIO, escolherRota, podeGerar } from './rota-de-geracao'

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
