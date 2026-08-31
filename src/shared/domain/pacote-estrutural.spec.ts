/**
 * O contrato do pacote estrutural (SPEC-Planejamento-04, critérios 1, 3 e 5).
 *
 * O que estes testes protegem é a afirmação central da fatia: **não existe conteúdo material
 * sem origem**. O tipo já impede construir sem ela; o que se prova aqui é a fronteira — o que
 * volta do banco ainda cumpre o contrato — e que a marca de origem chega ao arquivo.
 */

import { describe, expect, it } from 'vitest'

import {
  ARQUIVO_DO_DOCUMENTO,
  DOCUMENTOS_DO_PACOTE,
  PERGUNTAS_DO_PRD,
  afirmacoesComEvidencia,
  isDocumentoDoPacote,
  marcaDeOrigem,
  origensCompletas,
  pendenciasDoPrd,
  type AfirmacaoDoPacote
} from './pacote-estrutural'

function afirmacao(over: Partial<AfirmacaoDoPacote> = {}): AfirmacaoDoPacote {
  return {
    id: 'a-1',
    secao: 'Escopo',
    texto: 'Uma fatia vertical ponta a ponta.',
    origem: { tipo: 'decisao', decisaoId: 'd-1', perguntaId: 'escopo' },
    ...over
  }
}

describe('origem é obrigatória (critério 1)', () => {
  it('afirmação de decisão com id preenchido está completa', () => {
    expect(origensCompletas([afirmacao()])).toBe(true)
  })

  it('decisão sem id não passa na fronteira', () => {
    const quebrada = afirmacao({
      origem: { tipo: 'decisao', decisaoId: '', perguntaId: 'escopo' }
    })

    expect(origensCompletas([quebrada])).toBe(false)
  })

  it('evidência sem hash não passa na fronteira', () => {
    const quebrada = afirmacao({
      origem: { tipo: 'evidencia', url: 'https://exemplo.test/a', hashConteudo: '' }
    })

    expect(origensCompletas([quebrada])).toBe(false)
  })

  it('evidência sem url não passa na fronteira', () => {
    const quebrada = afirmacao({
      origem: { tipo: 'evidencia', url: '', hashConteudo: 'abc' }
    })

    expect(origensCompletas([quebrada])).toBe(false)
  })

  it('texto vazio não é afirmação material', () => {
    expect(origensCompletas([afirmacao({ texto: '   ' })])).toBe(false)
  })

  it('um conjunto vazio é trivialmente completo', () => {
    expect(origensCompletas([])).toBe(true)
  })
})

describe('marcaDeOrigem — o rastro chega ao arquivo', () => {
  it('decisão cita a pergunta e o id da decisão', () => {
    const marca = marcaDeOrigem({ tipo: 'decisao', decisaoId: 'd-42', perguntaId: 'escopo' })

    expect(marca).toContain('decisao/escopo')
    expect(marca).toContain('d-42')
  })

  it('evidência cita a URL e o hash', () => {
    const marca = marcaDeOrigem({
      tipo: 'evidencia',
      url: 'https://exemplo.test/a',
      hashConteudo: 'a'.repeat(64)
    })

    expect(marca).toContain('https://exemplo.test/a')
    expect(marca).toContain('sha256:' + 'a'.repeat(16))
  })

  it('sai como comentário HTML — invisível no render, presente no arquivo', () => {
    const marca = marcaDeOrigem({ tipo: 'decisao', decisaoId: 'd-1', perguntaId: 'escopo' })

    expect(marca.startsWith('<!--')).toBe(true)
    expect(marca.endsWith('-->')).toBe(true)
  })
})

describe('pendências do PRD (critério 1)', () => {
  it('sem nenhuma resposta, todas as obrigatórias faltam', () => {
    expect(pendenciasDoPrd([])).toEqual([...PERGUNTAS_DO_PRD])
  })

  it('nomeia o que falta, em vez de devolver um booleano', () => {
    expect(pendenciasDoPrd(['escopo', 'publico'])).toEqual(['superficie'])
  })

  it('com as três respondidas, não há pendência', () => {
    expect(pendenciasDoPrd(['escopo', 'publico', 'superficie'])).toEqual([])
  })

  it('perguntas fora do PRD não contam como pendência', () => {
    // `pesquisa` e `design-de-origem` são de outras fatias: exigi-las aqui bloquearia o PRD
    // por decisões que ele não usa.
    expect(pendenciasDoPrd(['escopo', 'publico', 'superficie', 'pesquisa'])).toEqual([])
  })
})

describe('afirmacoesComEvidencia — só o externo é verificado', () => {
  it('separa as de evidência das de decisão', () => {
    const daDecisao = afirmacao({ id: 'a-1' })
    const daEvidencia = afirmacao({
      id: 'a-2',
      origem: { tipo: 'evidencia', url: 'https://exemplo.test/a', hashConteudo: 'h' }
    })

    expect(afirmacoesComEvidencia([daDecisao, daEvidencia]).map((a) => a.id)).toEqual(['a-2'])
  })

  it('decisão do PI não vira lacuna de pesquisa', () => {
    expect(afirmacoesComEvidencia([afirmacao()])).toEqual([])
  })
})

describe('o contrato dos documentos', () => {
  it('são exatamente três', () => {
    expect(DOCUMENTOS_DO_PACOTE).toEqual(['PRD', 'LANDSCAPE', 'CONVENTION'])
  })

  it('cada documento tem caminho sob docs/', () => {
    for (const doc of DOCUMENTOS_DO_PACOTE) {
      expect(ARQUIVO_DO_DOCUMENTO[doc].startsWith('docs/')).toBe(true)
      expect(ARQUIVO_DO_DOCUMENTO[doc].endsWith('.md')).toBe(true)
    }
  })

  it('os caminhos são relativos — quem resolve a raiz é o main', () => {
    for (const doc of DOCUMENTOS_DO_PACOTE) {
      expect(ARQUIVO_DO_DOCUMENTO[doc]).not.toMatch(/^([A-Za-z]:|\/)/)
    }
  })

  it('reconhece e recusa documento fora do contrato', () => {
    expect(isDocumentoDoPacote('PRD')).toBe(true)
    expect(isDocumentoDoPacote('ARCHITECTURE')).toBe(false)
    expect(isDocumentoDoPacote(null)).toBe(false)
  })
})
