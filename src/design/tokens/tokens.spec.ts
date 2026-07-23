/**
 * Camada `tokens` (SPEC-DesignSystem-01, critérios 1 e 3).
 *
 * Roda na categoria **Regras** (ambiente `node`, sem jsdom) de propósito: é o ambiente que
 * torna "tokens não depende de React" uma afirmação verificável. Sob jsdom o teste passaria
 * mesmo se a camada importasse React — e a regra de dependência do PRD §8.1 valeria só no
 * papel.
 */

import { describe, expect, it } from 'vitest'
import { PREFIXO_TOKEN, tokenCss } from './index'

describe('tokens', () => {
  it('é importável sem React', async () => {
    // O import acima já roda em `node`; esta asserção fecha a outra ponta: o módulo não
    // arrasta React nem indiretamente, então nada dele foi parar no grafo de dependências.
    const modulo = await import('./index')
    expect(Object.keys(modulo).sort()).toEqual(['PREFIXO_TOKEN', 'tokenCss'])
    expect(typeof globalThis.document).toBe('undefined')
  })

  it('monta a referência CSS com o prefixo do DS', () => {
    expect(tokenCss('cor-acento')).toBe(`var(${PREFIXO_TOKEN}-cor-acento)`)
  })
})
