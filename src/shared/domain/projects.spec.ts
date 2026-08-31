/**
 * Regras puras de projeto (SPEC-Planejamento-01, categoria Regras).
 *
 * O que se prova aqui é o que não precisa de disco: a derivação do slug e a validação do nome.
 * Elas merecem teste próprio porque o slug **vira diretório** — um bug aqui não produz um nome
 * feio, produz uma pasta no lugar errado ou com nome vazio.
 */

import { describe, expect, it } from 'vitest'
import {
  MARCOS_DOCUMENTAIS,
  MENSAGEM_DO_MARCO,
  TAMANHO_MAXIMO_DO_SLUG,
  isMarcoDocumental,
  isNomeDeProjetoValido,
  slugificar
} from './projects'

describe('slugificar', () => {
  it('preserva as letras de um nome acentuado em vez de virar hífens', () => {
    // O caso que motivou a normalização NFD: sem ela, cada acento cairia fora da classe
    // permitida e viraria separador — "Análise Rápida" produziria `an-lise-r-pida`.
    expect(slugificar('Análise Rápida')).toBe('analise-rapida')
    expect(slugificar('Ação Coração')).toBe('acao-coracao')
  })

  it('colapsa símbolos e espaços num único hífen', () => {
    expect(slugificar('meu   projeto!!! novo')).toBe('meu-projeto-novo')
  })

  it('não deixa hífen sobrando nas pontas', () => {
    // Hífen na ponta viraria um nome de pasta como `-projeto-`, que é válido no FS e confuso
    // em toda listagem que o mostrar.
    expect(slugificar('  ...projeto...  ')).toBe('projeto')
  })

  it('devolve string vazia quando não há nada aproveitável', () => {
    expect(slugificar('!!!')).toBe('')
    expect(slugificar('   ')).toBe('')
  })
})

describe('isNomeDeProjetoValido', () => {
  it('aceita nome comum, com acento e com número', () => {
    expect(isNomeDeProjetoValido('Projeto Alfa')).toBe(true)
    expect(isNomeDeProjetoValido('Análise 2026')).toBe(true)
  })

  it('recusa nome que slugifica para vazio', () => {
    // A validação é sobre o **slug**, não sobre o nome: "!!!" parece um nome digitado, mas
    // criaria uma pasta sem nome.
    expect(isNomeDeProjetoValido('!!!')).toBe(false)
    expect(isNomeDeProjetoValido('')).toBe(false)
  })

  it('recusa nome cujo slug estoura o teto de path', () => {
    const gigante = 'a'.repeat(TAMANHO_MAXIMO_DO_SLUG + 1)
    expect(isNomeDeProjetoValido(gigante)).toBe(false)
    expect(isNomeDeProjetoValido('a'.repeat(TAMANHO_MAXIMO_DO_SLUG))).toBe(true)
  })
})

describe('marcos documentais', () => {
  it('tem mensagem determinística para todo marco declarado', () => {
    // O mapa é a fonte da mensagem de commit. Um marco sem entrada produziria um commit com
    // mensagem `undefined` num repositório do usuário — e o critério 4 pede determinismo.
    for (const marco of MARCOS_DOCUMENTAIS) {
      expect(MENSAGEM_DO_MARCO[marco]).toBeTruthy()
    }
  })

  it('recusa marco fora do enum', () => {
    expect(isMarcoDocumental('estrutura-inicial')).toBe(true)
    expect(isMarcoDocumental('marco-inventado')).toBe(false)
    expect(isMarcoDocumental(null)).toBe(false)
  })
})
