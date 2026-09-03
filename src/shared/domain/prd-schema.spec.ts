/**
 * O parser da saída do modelo (SPEC-Jornada-03, § Geração).
 *
 * O que estes testes fixam é a **intolerância**: forma errada devolve `undefined`, e nunca um
 * objeto consertado. Um parser que completasse origem ausente inventaria a procedência que o
 * critério 1 existe para exigir — e o validador nunca veria o problema.
 */

import { describe, expect, it } from 'vitest'
import {
  documentosCobertos,
  lerContradicoesDoModelo,
  lerDocumentosDoModelo,
  lerTermoDoModelo,
  promptDoPrd,
  SISTEMA_DO_PRD
} from './prd-schema'

const VALIDO = JSON.stringify({
  afirmacoes: [
    {
      id: 'a-1',
      documento: 'PRD',
      secao: 'Escopo',
      texto: 'Organiza tarefas.',
      origem: 'brief',
      referencia: 'b-1'
    }
  ]
})

describe('lerDocumentosDoModelo', () => {
  it('lê a saída bem formada', () => {
    expect(lerDocumentosDoModelo(VALIDO)).toHaveLength(1)
  })

  it('tolera a cerca de código, que modelos produzem por hábito', () => {
    expect(lerDocumentosDoModelo('```json\n' + VALIDO + '\n```')).toHaveLength(1)
  })

  it('devolve undefined em JSON malformado', () => {
    expect(lerDocumentosDoModelo('{ isto não é json')).toBeUndefined()
  })

  it('devolve undefined quando falta a origem — não completa com proposto', () => {
    const semOrigem = JSON.stringify({
      afirmacoes: [{ id: 'a-1', documento: 'PRD', secao: 'Escopo', texto: 'x' }]
    })

    expect(lerDocumentosDoModelo(semOrigem)).toBeUndefined()
  })

  it('devolve undefined quando o documento não existe no pacote', () => {
    const outro = JSON.stringify({
      afirmacoes: [{ id: 'a-1', documento: 'ROADMAP', secao: 'x', texto: 'x', origem: 'proposto' }]
    })

    expect(lerDocumentosDoModelo(outro)).toBeUndefined()
  })

  it('uma entrada malformada invalida a saída inteira, não só a linha', () => {
    const misto = JSON.stringify({
      afirmacoes: [
        { id: 'a-1', documento: 'PRD', secao: 'Escopo', texto: 'ok', origem: 'proposto' },
        { id: 'a-2', documento: 'PRD', secao: 'Escopo', texto: 'ruim' }
      ]
    })

    expect(lerDocumentosDoModelo(misto)).toBeUndefined()
  })

  it('devolve undefined quando fontes não é lista de strings', () => {
    const fontesRuins = JSON.stringify({
      afirmacoes: [
        {
          id: 'l-1',
          documento: 'LANDSCAPE',
          secao: 'Cenário',
          texto: 'x',
          origem: 'evidencia',
          fontes: [{ url: 'https://x.dev' }]
        }
      ]
    })

    expect(lerDocumentosDoModelo(fontesRuins)).toBeUndefined()
  })
})

describe('lerContradicoesDoModelo', () => {
  it('lista vazia é resultado legítimo, não ausência de saída', () => {
    expect(lerContradicoesDoModelo('{"contradicoes":[]}')).toEqual([])
  })

  it('devolve undefined quando a forma não confere', () => {
    expect(lerContradicoesDoModelo('{"contradicoes":"nenhuma"}')).toBeUndefined()
  })

  it('exige pergunta e recomendação — o par é o contrato do critério 6', () => {
    const semRecomendacao = JSON.stringify({
      contradicoes: [{ id: 'c-1', afirmacoes: ['a-1', 'a-2'], pergunta: 'Qual vale?' }]
    })

    expect(lerContradicoesDoModelo(semRecomendacao)).toBeUndefined()
  })
})

describe('lerTermoDoModelo', () => {
  it('normaliza aspas e sobra de linhas — a proposta é editável, não um contrato', () => {
    expect(lerTermoDoModelo('"ferramentas de planejamento"\n\n')).toBe(
      'ferramentas de planejamento'
    )
  })

  it('devolve undefined quando não veio nada', () => {
    expect(lerTermoDoModelo('   \n  ')).toBeUndefined()
  })
})

describe('promptDoPrd', () => {
  it('leva os ids do brief, sem os quais toda afirmação viraria proposto', () => {
    const p = promptDoPrd({ afirmacoesDoBrief: [{ id: 'b-1', texto: 'Organiza tarefas.' }] })

    expect(p).toContain('[b-1]')
  })

  it('leva as URLs extraídas, para a origem evidencia poder citar fonte que existe', () => {
    const p = promptDoPrd({
      afirmacoesDoBrief: [],
      fontes: [{ url: 'https://exemplo.dev/a', titulo: 'A', trecho: 'trecho' }]
    })

    expect(p).toContain('https://exemplo.dev/a')
  })

  it('diz ao modelo quando a pesquisa não saiu, em vez de deixar o Landscape adivinhar', () => {
    const p = promptDoPrd({ afirmacoesDoBrief: [], landscapeBloqueado: true })

    expect(p).toContain('A PESQUISA DE MERCADO NÃO PÔDE SER FEITA')
  })

  it('a correção diz o que foi recusado — pedir "tente de novo" gastaria a rodada à toa', () => {
    const p = promptDoPrd({ afirmacoesDoBrief: [], correcao: ['A afirmação a-1 não tem origem.'] })

    expect(p).toContain('A afirmação a-1 não tem origem.')
  })
})

describe('SISTEMA_DO_PRD', () => {
  it('proíbe requisito legal inferido antes de o modelo escrever, não só depois', () => {
    expect(SISTEMA_DO_PRD).toContain('consentimento')
  })

  it('enumera as seções a partir da constante, sem uma segunda lista a divergir', () => {
    expect(SISTEMA_DO_PRD).toContain('PRD: Problema, Usuários')
    expect(SISTEMA_DO_PRD).toContain('LANDSCAPE: evidencia, proposto')
  })
})

describe('documentosCobertos', () => {
  it('diz quais documentos a saída cobriu', () => {
    const afirmacoes = lerDocumentosDoModelo(VALIDO)

    expect(documentosCobertos(afirmacoes ?? [])).toEqual(['PRD'])
  })
})
