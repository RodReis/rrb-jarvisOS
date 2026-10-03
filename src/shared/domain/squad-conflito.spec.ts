import { describe, expect, it } from 'vitest'
import {
  contextoDoBloco,
  estruturaAmbigua,
  lerBlocos,
  lerResolucao,
  montarArquivo,
  temMarcadorDeConflito,
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
    ['marcador ">>>>>>>" na resolução', { ...ok, resolucao: '>>>>>>> x' }],
    ['marcador "|||||||" na resolução', { ...ok, resolucao: '||||||| base' }],
    ['controle de direção', { ...ok, resolucao: 'a‮b' }]
  ])('recusa: %s', (_nome, bruto) => {
    expect(lerResolucao(bruto).ok).toBe(false)
  })

  it('"=======" na resolução é texto (título em Markdown), não marcador', () => {
    expect(lerResolucao({ ...ok, resolucao: 'Título\n=======\ncorpo' }).ok).toBe(true)
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

describe('estrutura forjada pelo conteúdo (H1)', () => {
  // O escritor A escreve uma linha ">>>>>>> x" dentro do lado dele: o parser fecharia o bloco ali,
  // e o resto dos marcadores reais viraria texto fixo, que o kernel devolveria como "resolvido".
  const FORJADO = [
    '<<<<<<< HEAD',
    'a2',
    '>>>>>>> quote',
    '||||||| base',
    'b0',
    '=======',
    'b1',
    '>>>>>>> 1234abcd',
    ''
  ].join('\n')

  it('marcador solto fora de bloco torna a estrutura ambígua', () => {
    expect(estruturaAmbigua(lerBlocos(FORJADO))).toBe(true)
  })

  it('arquivo de conflito bem formado não é ambíguo', () => {
    expect(estruturaAmbigua(lerBlocos(COM_UM_BLOCO))).toBe(false)
  })

  it('texto fixo comum, inclusive "=======" de título, não é ambíguo', () => {
    expect(estruturaAmbigua(lerBlocos('Título\n=======\ncorpo\n'))).toBe(false)
  })

  it('"<<<<<<<" aninhado dentro de um bloco torna a estrutura ambígua', () => {
    const texto = ['<<<<<<< a', 'x', '<<<<<<< b', 'y', '=======', 'z', '>>>>>>> c'].join('\n')

    expect(estruturaAmbigua(lerBlocos(texto))).toBe(true)
  })

  it('o texto final com marcador de conflito é detectado, e o sem marcador não', () => {
    expect(temMarcadorDeConflito('RESOLVIDO\n||||||| base\nb0\n')).toBe(true)
    expect(temMarcadorDeConflito('a\n>>>>>>> 1234\n')).toBe(true)
    expect(temMarcadorDeConflito('a\n<<<<<<< HEAD\n')).toBe(true)
    expect(temMarcadorDeConflito('export const a = 1\n')).toBe(false)
    expect(temMarcadorDeConflito('Título\n=======\n')).toBe(false)
  })
})

describe('desempenho (M1)', () => {
  it('130 mil linhas "<<<<<<<" sem fecho não travam o processo', () => {
    const texto = '<<<<<<< x\n'.repeat(130_000)

    const inicio = Date.now()
    lerBlocos(texto)

    expect(Date.now() - inicio).toBeLessThan(1_000)
  })
})

describe('montarArquivo: fim de linha e resolução vazia', () => {
  it('resolução vazia remove o bloco: não deixa linha em branco no lugar', () => {
    const partes = lerBlocos(COM_UM_BLOCO)

    expect(montarArquivo(partes, [{ resolucao: '', descartes: [] }])).toBe(
      'linha antes\nlinha depois\n'
    )
  })

  it('arquivo CRLF: a resolução entra com CRLF, e o arquivo não fica com fim de linha misto', () => {
    const crlf = COM_UM_BLOCO.replace(/\n/g, '\r\n')

    const texto = montarArquivo(lerBlocos(crlf), [
      { resolucao: 'const a = 1\nconst b = 2', descartes: [] }
    ])

    expect(texto).toBe('linha antes\r\nconst a = 1\r\nconst b = 2\r\nlinha depois\r\n')
  })

  it('a resolução com fim de linha no fim não cria linha em branco', () => {
    const texto = montarArquivo(lerBlocos(COM_UM_BLOCO), [{ resolucao: 'x = 1\n', descartes: [] }])

    expect(texto).toBe('linha antes\nx = 1\nlinha depois\n')
  })
})

describe('o motivo da recusa não ecoa texto do agente (L3)', () => {
  it('chave desconhecida: o motivo não repete o nome da chave', () => {
    const lida = lerResolucao({ resolucao: 'x', descartes: [], chaveForjada: 1 })

    expect(lida.ok).toBe(false)
    expect(!lida.ok && lida.motivo).not.toContain('chaveForjada')
  })
})
