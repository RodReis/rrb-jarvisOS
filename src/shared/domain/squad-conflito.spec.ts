import { describe, expect, it } from 'vitest'
import {
  contextoDoBloco,
  lerBlocos,
  lerResolucao,
  montarArquivo,
  totalDeBlocos
} from './squad-conflito'

const COM_UM_BLOCO = [
  'linha antes',
  '<<<<<<< HEAD',
  'const a = 10',
  '||||||| base',
  'const a = 1',
  '=======',
  'const a = 20',
  '>>>>>>> outro',
  'linha depois',
  ''
].join('\n')

describe('lerBlocos', () => {
  it('separa o texto fixo do bloco em conflito, com os três lados', () => {
    const partes = lerBlocos(COM_UM_BLOCO)

    expect(partes).toEqual([
      { tipo: 'fixo', linhas: ['linha antes'] },
      { tipo: 'bloco', bloco: { a: ['const a = 10'], base: ['const a = 1'], b: ['const a = 20'] } },
      { tipo: 'fixo', linhas: ['linha depois', ''] }
    ])
  })

  it('arquivo sem conflito é uma parte fixa só', () => {
    expect(lerBlocos('a\nb\n')).toEqual([{ tipo: 'fixo', linhas: ['a', 'b', ''] }])
    expect(totalDeBlocos(lerBlocos('a\nb\n'))).toBe(0)
  })

  it('vários blocos, na ordem', () => {
    const texto = [COM_UM_BLOCO.trimEnd(), COM_UM_BLOCO].join('\n')

    expect(totalDeBlocos(lerBlocos(texto))).toBe(2)
  })

  it('sem seção de base (add/add), a base é vazia', () => {
    const texto = ['<<<<<<< HEAD', 'x', '=======', 'y', '>>>>>>> outro'].join('\n')

    expect(lerBlocos(texto)[1]).toEqual({ tipo: 'bloco', bloco: { a: ['x'], base: [], b: ['y'] } })
  })

  it('"=======" fora de um bloco é texto, não marcador', () => {
    expect(lerBlocos('Título\n=======\n')).toEqual([
      { tipo: 'fixo', linhas: ['Título', '=======', ''] }
    ])
  })

  it('bloco que nunca fecha não é aceito como bloco: o arquivo fica inteiro como fixo', () => {
    const texto = ['<<<<<<< HEAD', 'x', '=======', 'y'].join('\n')

    expect(totalDeBlocos(lerBlocos(texto))).toBe(0)
  })
})

describe('contextoDoBloco', () => {
  it('traz as linhas fixas de cada lado, no máximo o pedido', () => {
    const partes = lerBlocos(
      ['1', '2', '3', '4', '<<<<<<<', 'a', '=======', 'b', '>>>>>>>', '5', '6', '7'].join('\n')
    )

    expect(contextoDoBloco(partes, 1, 2)).toEqual({ antes: ['3', '4'], depois: ['5', '6'] })
  })
})

describe('montarArquivo', () => {
  it('troca cada bloco pela resolução, sem marcador, e preserva o fixo', () => {
    const partes = lerBlocos(COM_UM_BLOCO)

    const texto = montarArquivo(partes, [{ resolucao: 'const a = 10 + 20', descartes: [] }])

    expect(texto).toBe('linha antes\nconst a = 10 + 20\nlinha depois\n')
  })

  it('faltou resolução para um bloco: o arquivo não é montado', () => {
    expect(montarArquivo(lerBlocos(COM_UM_BLOCO), [])).toBeUndefined()
  })
})

describe('lerResolucao', () => {
  const ok = { resolucao: 'x = 1', descartes: [] }

  it('aceita a resolução bem formada, com descarte justificado', () => {
    const lida = lerResolucao({
      resolucao: 'x = 1',
      descartes: [{ trecho: 'x = 2', motivo: 'incompatível com o outro lado' }]
    })

    expect(lida.ok).toBe(true)
  })

  it('aceita resolução vazia: o bloco pode ser removido por inteiro', () => {
    expect(lerResolucao({ resolucao: '', descartes: [] }).ok).toBe(true)
  })

  it.each([
    ['não é objeto', 'texto'],
    ['chave extra', { ...ok, assinatura: 'x' }],
    ['sem descartes', { resolucao: 'x' }],
    ['resolução não é texto', { ...ok, resolucao: 1 }],
    ['descarte sem motivo', { ...ok, descartes: [{ trecho: 'x', motivo: '' }] }],
    ['descarte sem trecho', { ...ok, descartes: [{ trecho: '', motivo: 'm' }] }],
    ['descarte com chave extra', { ...ok, descartes: [{ trecho: 'x', motivo: 'm', e: 1 }] }],
    ['marcador "<<<<<<<" na resolução', { ...ok, resolucao: 'a\n<<<<<<< x\nb' }],
    ['marcador "=======" na resolução', { ...ok, resolucao: 'a\n=======\nb' }],
    ['marcador ">>>>>>>" na resolução', { ...ok, resolucao: '>>>>>>> x' }],
    ['marcador "|||||||" na resolução', { ...ok, resolucao: '||||||| base' }],
    ['controle de direção', { ...ok, resolucao: 'a‮b' }]
  ])('recusa: %s', (_nome, bruto) => {
    expect(lerResolucao(bruto).ok).toBe(false)
  })

  it('recusa resolução e descartes grandes demais', () => {
    expect(lerResolucao({ ...ok, resolucao: 'x'.repeat(200_000) }).ok).toBe(false)
    expect(
      lerResolucao({
        ...ok,
        descartes: Array.from({ length: 200 }, () => ({ trecho: 'x', motivo: 'm' }))
      }).ok
    ).toBe(false)
  })
})
