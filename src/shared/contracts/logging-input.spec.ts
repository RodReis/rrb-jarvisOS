import { describe, expect, it } from 'vitest'
import { parseLogInput } from './logging-input'

describe('parseLogInput', () => {
  const valido = { level: 'info', category: 'ui', msg: 'Tela carregada' }

  it('aceita o registro mínimo do contrato', () => {
    expect(parseLogInput(valido)).toEqual(valido)
  })

  it('aceita os campos opcionais do contrato', () => {
    const entrada = {
      ...valido,
      ctx: { ms: 12 },
      direction: 'out',
      workspace: 'noa',
      correlationId: 'abc-123'
    }

    expect(parseLogInput(entrada)).toEqual(entrada)
  })

  it.each([
    ['nível fora do contrato', { ...valido, level: 'silly' }],
    ['categoria inventada', { ...valido, category: 'financeiro' }],
    ['msg vazia', { ...valido, msg: '' }],
    ['msg não-string', { ...valido, msg: 42 }],
    ['ctx não-objeto', { ...valido, ctx: 'texto' }],
    ['direction inválida', { ...valido, direction: 'lateral' }],
    ['workspace fora do enum', { ...valido, workspace: 'desenvolvimento' }],
    ['correlationId não-string', { ...valido, correlationId: 7 }]
  ])('descarta registro com %s', (_caso, entrada) => {
    expect(parseLogInput(entrada)).toBeUndefined()
  })

  it.each([
    ['null', null],
    ['string', 'log'],
    ['array', []],
    ['undefined', undefined]
  ])('descarta payload que não é objeto (%s)', (_caso, entrada) => {
    expect(parseLogInput(entrada)).toBeUndefined()
  })

  it('trunca mensagem longa em vez de descartar o registro', () => {
    // `msg` é frase curta por contrato; o detalhe vai em `ctx`. Truncar preserva o sinal
    // sem deixar um registro gigante poluir o arquivo.
    const saida = parseLogInput({ ...valido, msg: 'a'.repeat(5000) })

    expect(saida?.msg).toHaveLength(2000)
  })

  it('ignora campos fora do contrato em vez de repassá-los', () => {
    const saida = parseLogInput({ ...valido, caminhoDoDisco: 'C:/segredo' })

    expect(saida).toEqual(valido)
  })
})
