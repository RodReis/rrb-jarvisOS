import { describe, expect, it } from 'vitest'
import {
  BYTES_POR_TOKEN,
  bytesDeLeituraAmpla,
  exigeExcecao,
  falhasParaOContexto,
  isOrigemDeContexto,
  tokensDosItens,
  type ContextItem,
  type FalhaRegistrada
} from './context-pack'

function item(parcial: Partial<ContextItem> = {}): ContextItem {
  return {
    caminho: 'docs/PRD.md',
    hash: 'a'.repeat(64),
    origem: 'explicito',
    bytes: 400,
    motivo: 'anexado pelo usuário',
    ...parcial
  }
}

function falha(parcial: Partial<FalhaRegistrada> = {}): FalhaRegistrada {
  return {
    fingerprint: 'f-1',
    user_id: 'u-1',
    workspace_id: 'jarvis',
    projectId: 'p-1',
    resumo: 'o build quebrou no typecheck',
    ocorrencias: 1,
    resolvida: false,
    primeiraEm: '2026-08-30T10:00:00.000Z',
    ultimaEm: '2026-08-30T10:00:00.000Z',
    ...parcial
  }
}

describe('tokensDosItens', () => {
  it('converte bytes em tokens pela mesma razão da estimativa de custo', () => {
    const itens = [item({ bytes: 400 }), item({ bytes: 400 })]

    expect(tokensDosItens(itens)).toBe(800 / BYTES_POR_TOKEN)
  })

  it('arredonda para cima — token parcial ainda ocupa um token', () => {
    expect(tokensDosItens([item({ bytes: 5 })])).toBe(2)
  })

  it('conjunto vazio custa zero', () => {
    expect(tokensDosItens([])).toBe(0)
  })
})

describe('exigeExcecao', () => {
  it('é falso quando nada veio de leitura ampla', () => {
    expect(
      exigeExcecao([item({ origem: 'explicito' }), item({ origem: 'busca-estrutural' })])
    ).toBe(false)
  })

  it('basta um item de leitura ampla para exigir a exceção (critério 3)', () => {
    const itens = [item({ origem: 'busca-estrutural' }), item({ origem: 'leitura-ampla' })]

    expect(exigeExcecao(itens)).toBe(true)
  })
})

describe('bytesDeLeituraAmpla', () => {
  it('soma apenas o que veio por leitura ampla — o teto da exceção limita só isso', () => {
    const itens = [
      item({ origem: 'explicito', bytes: 1_000 }),
      item({ origem: 'leitura-ampla', bytes: 300 }),
      item({ origem: 'leitura-ampla', bytes: 200 })
    ]

    expect(bytesDeLeituraAmpla(itens)).toBe(500)
  })
})

describe('falhasParaOContexto', () => {
  it('carrega as falhas abertas, com o fingerprint e a contagem', () => {
    const abertas = falhasParaOContexto([falha({ fingerprint: 'f-a', ocorrencias: 3 })])

    expect(abertas).toEqual([
      { fingerprint: 'f-a', resumo: 'o build quebrou no typecheck', ocorrencias: 3 }
    ])
  })

  it('não devolve a falha resolvida — ela não volta ao prompt (critério 4)', () => {
    const registradas = [
      falha({ fingerprint: 'f-resolvida', resolvida: true }),
      falha({ fingerprint: 'f-aberta', resolvida: false })
    ]

    expect(falhasParaOContexto(registradas).map((f) => f.fingerprint)).toEqual(['f-aberta'])
  })

  it('devolve lista vazia quando todas foram resolvidas', () => {
    expect(falhasParaOContexto([falha({ resolvida: true })])).toEqual([])
  })
})

describe('isOrigemDeContexto', () => {
  it('aceita as origens do contrato e recusa o resto', () => {
    expect(isOrigemDeContexto('leitura-ampla')).toBe(true)
    expect(isOrigemDeContexto('inventada')).toBe(false)
    expect(isOrigemDeContexto(undefined)).toBe(false)
  })
})
