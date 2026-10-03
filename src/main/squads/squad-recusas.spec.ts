import { describe, expect, it } from 'vitest'
import { recusaDaTentativa, recusaDoContexto, recusaDosLimites } from './squad-recusas'

const LIMITES = { maxMinutos: 5, maxTokensEntrada: 1000, maxTokensSaida: 500 }

describe('tentativa (limite da M9-F04)', () => {
  it('as três primeiras são permitidas; a quarta, não', () => {
    expect([1, 2, 3].map(recusaDaTentativa)).toEqual([undefined, undefined, undefined])
    expect(recusaDaTentativa(4)).toBe('tentativas-esgotadas')
    expect(recusaDaTentativa(99)).toBe('tentativas-esgotadas')
  })

  it('o que não é inteiro a partir de 1 é inválido', () => {
    for (const t of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(recusaDaTentativa(t)).toBe('tentativa-invalida')
    }
  })
})

describe('limites', () => {
  it('aceita números positivos e finitos', () => {
    expect(recusaDosLimites(LIMITES)).toBeUndefined()
    expect(recusaDosLimites({ ...LIMITES, maxMinutos: 0.001 })).toBeUndefined()
  })

  it('zero, negativo, NaN e infinito em qualquer um dos três são recusa', () => {
    for (const campo of ['maxMinutos', 'maxTokensEntrada', 'maxTokensSaida'] as const) {
      for (const valor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(recusaDosLimites({ ...LIMITES, [campo]: valor })).toBe('limite-invalido')
      }
    }
  })
})

describe('contexto', () => {
  it('precisa de fonte e de item no pack', () => {
    expect(recusaDoContexto(1, 1)).toBeUndefined()
    expect(recusaDoContexto(0, 1)).toBe('sem-contexto')
    expect(recusaDoContexto(1, 0)).toBe('sem-contexto')
    expect(recusaDoContexto(0, 0)).toBe('sem-contexto')
  })
})
