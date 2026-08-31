/**
 * A composição dos três documentos (SPEC-Planejamento-04, critérios 1, 2, 4, 5 e 6).
 *
 * O que estes testes provam é que os documentos são **derivados** e não redigidos: a mesma
 * decisão produz sempre o mesmo texto, o não-objetivo sai da opção que o PI não escolheu, e
 * nenhuma linha do Landscape existe sem fonte.
 */

import { describe, expect, it } from 'vitest'

import {
  PREAMBULO_DO_DOCUMENTO,
  SECOES_DO_DOCUMENTO,
  afirmacoesDaConvention,
  afirmacoesDoLandscape,
  afirmacoesDoPrd,
  gatilhosDeRevisao,
  opcoesPreteridas,
  renderizarDocumento,
  textoDaDecisao,
  type FonteDoLandscape
} from './pacote-compositor'
import { PERGUNTAS_DO_PRD } from './pacote-estrutural'
import type { Decision, DecisoesPorPergunta, Pergunta } from './wizard'

const PROJETO = { nome: 'Projeto Alfa', slug: 'projeto-alfa' }

function pergunta(over: Partial<Pergunta> & Pick<Pergunta, 'id'>): Pergunta {
  return {
    etapa: 'contexto',
    titulo: `Título ${over.id}`,
    enunciado: 'Enunciado',
    opcoes: [
      { id: 'a', rotulo: 'Opção A', impacto: 'impacto de A' },
      { id: 'b', rotulo: 'Opção B', impacto: 'impacto de B' }
    ],
    recomendada: 'a',
    justificativa: 'porque sim',
    aceitaTextoLivre: true,
    delegavel: true,
    ...over
  }
}

function decisao(over: Partial<Decision> & Pick<Decision, 'perguntaId'>): Decision {
  return {
    id: `d-${over.perguntaId}`,
    user_id: 'u-1',
    workspace_id: 'jarvis',
    projectId: 'p-1',
    etapa: 'contexto',
    escolha: 'a',
    texto: null,
    recomendacao: 'a',
    justificativa: 'porque sim',
    autor: 'pi',
    motivo: 'escolhida',
    substituiu: null,
    created_at: '2026-08-30T10:00:00.000Z',
    ...over
  }
}

function fonte(over: Partial<FonteDoLandscape> = {}): FonteDoLandscape {
  return {
    url: 'https://exemplo.test/alternativa',
    titulo: 'Alternativa X',
    trecho: 'A alternativa X cobre o caso Y parcialmente.',
    hashConteudo: 'a'.repeat(64),
    coletadoEm: '2026-08-30T10:00:00.000Z',
    ...over
  }
}

describe('textoDaDecisao — a decisão do PI, com as palavras dele', () => {
  it('usa o rótulo da opção escolhida', () => {
    const p = pergunta({ id: 'escopo' })

    expect(textoDaDecisao(p, decisao({ perguntaId: 'escopo', escolha: 'b' }))).toBe('Opção B')
  })

  it('texto livre vence a opção — trocá-lo seria trocar a decisão', () => {
    const p = pergunta({ id: 'escopo' })
    const d = decisao({ perguntaId: 'escopo', escolha: null, texto: 'um recorte próprio' })

    expect(textoDaDecisao(p, d)).toBe('um recorte próprio')
  })

  it('texto em branco não vence a opção', () => {
    const p = pergunta({ id: 'escopo' })
    const d = decisao({ perguntaId: 'escopo', escolha: 'a', texto: '   ' })

    expect(textoDaDecisao(p, d)).toBe('Opção A')
  })
})

describe('não-objetivo sai da opção preterida (critério 4)', () => {
  it('devolve as opções que o PI não escolheu', () => {
    const p = pergunta({ id: 'escopo' })

    const preteridas = opcoesPreteridas(p, decisao({ perguntaId: 'escopo', escolha: 'a' }))

    expect(preteridas.map((o) => o.rotulo)).toEqual(['Opção B'])
  })

  it('o PRD separa escopo de não-objetivo', () => {
    const catalogo = [pergunta({ id: 'escopo' })]
    const decisoes: DecisoesPorPergunta = { escopo: decisao({ perguntaId: 'escopo' }) }

    const afirmacoes = afirmacoesDoPrd(catalogo, decisoes, ['escopo'])

    expect(afirmacoes.filter((a) => a.secao === 'Escopo')).toHaveLength(1)
    expect(afirmacoes.filter((a) => a.secao === 'Não objetivos')).toHaveLength(1)
  })

  it('o não-objetivo carrega a mesma origem — é a mesma decisão', () => {
    const catalogo = [pergunta({ id: 'escopo' })]
    const decisoes: DecisoesPorPergunta = { escopo: decisao({ perguntaId: 'escopo' }) }

    const afirmacoes = afirmacoesDoPrd(catalogo, decisoes, ['escopo'])
    const origens = afirmacoes.map((a) =>
      a.origem.tipo === 'decisao' ? a.origem.decisaoId : 'outra'
    )

    expect(new Set(origens).size).toBe(1)
  })

  it('o não-objetivo declara o impacto da opção preterida', () => {
    const catalogo = [pergunta({ id: 'escopo' })]
    const decisoes: DecisoesPorPergunta = { escopo: decisao({ perguntaId: 'escopo' }) }

    const naoObjetivo = afirmacoesDoPrd(catalogo, decisoes, ['escopo']).find(
      (a) => a.secao === 'Não objetivos'
    )

    expect(naoObjetivo?.texto).toContain('impacto de B')
  })
})

describe('afirmacoesDoPrd — só o que o PRD usa', () => {
  it('ignora pergunta sem decisão', () => {
    const catalogo = [pergunta({ id: 'escopo' }), pergunta({ id: 'publico' })]
    const decisoes: DecisoesPorPergunta = { escopo: decisao({ perguntaId: 'escopo' }) }

    const afirmacoes = afirmacoesDoPrd(catalogo, decisoes, ['escopo', 'publico'])

    expect(afirmacoes.every((a) => a.id.includes('escopo'))).toBe(true)
  })

  it('ignora decisão de pergunta que não está no catálogo', () => {
    const decisoes: DecisoesPorPergunta = { fantasma: decisao({ perguntaId: 'fantasma' }) }

    expect(afirmacoesDoPrd([], decisoes, ['fantasma'])).toEqual([])
  })

  it('toda afirmação do PRD tem origem de decisão', () => {
    const catalogo = PERGUNTAS_DO_PRD.map((id) => pergunta({ id }))
    const decisoes: DecisoesPorPergunta = Object.fromEntries(
      PERGUNTAS_DO_PRD.map((id) => [id, decisao({ perguntaId: id })])
    )

    const afirmacoes = afirmacoesDoPrd(catalogo, decisoes, PERGUNTAS_DO_PRD)

    expect(afirmacoes.length).toBeGreaterThan(0)
    expect(afirmacoes.every((a) => a.origem.tipo === 'decisao')).toBe(true)
  })

  it('a composição é determinística — a mesma entrada dá o mesmo texto', () => {
    const catalogo = [pergunta({ id: 'escopo' })]
    const decisoes: DecisoesPorPergunta = { escopo: decisao({ perguntaId: 'escopo' }) }

    const primeira = afirmacoesDoPrd(catalogo, decisoes, ['escopo'])
    const segunda = afirmacoesDoPrd(catalogo, decisoes, ['escopo'])

    expect(JSON.stringify(primeira)).toBe(JSON.stringify(segunda))
  })
})

describe('afirmacoesDoLandscape — nenhuma linha sem fonte (critério 2)', () => {
  it('toda afirmação tem origem de evidência', () => {
    const afirmacoes = afirmacoesDoLandscape([fonte(), fonte({ url: 'https://exemplo.test/b' })])

    expect(afirmacoes).toHaveLength(2)
    expect(afirmacoes.every((a) => a.origem.tipo === 'evidencia')).toBe(true)
  })

  it('sem fonte, não há afirmação — e não se inventa síntese', () => {
    expect(afirmacoesDoLandscape([])).toEqual([])
  })

  it('a afirmação carrega o hash do conteúdo coletado', () => {
    const afirmacao = afirmacoesDoLandscape([fonte()])[0]

    expect(afirmacao?.origem.tipo === 'evidencia' && afirmacao.origem.hashConteudo).toBe(
      'a'.repeat(64)
    )
  })

  it('o texto cita a fonte como link', () => {
    const afirmacao = afirmacoesDoLandscape([fonte()])[0]

    expect(afirmacao?.texto).toContain('https://exemplo.test/alternativa')
  })
})

describe('gatilhos de revisão (critério 6)', () => {
  it('cada fonte vira um gatilho', () => {
    const gatilhos = gatilhosDeRevisao([fonte(), fonte({ url: 'https://exemplo.test/b' })])

    expect(gatilhos).toHaveLength(2)
    expect(gatilhos.every((g) => g.secao === 'Gatilhos de revisão')).toBe(true)
  })

  it('o gatilho nomeia a data da coleta', () => {
    expect(gatilhosDeRevisao([fonte()])[0]?.texto).toContain('2026-08-30T10:00:00.000Z')
  })

  it('sem fonte não há gatilho', () => {
    expect(gatilhosDeRevisao([])).toEqual([])
  })
})

describe('afirmacoesDaConvention — só regra informada (critério 5)', () => {
  it('cada decisão vigente vira uma entrada', () => {
    const catalogo = [pergunta({ id: 'escopo' }), pergunta({ id: 'publico' })]
    const decisoes: DecisoesPorPergunta = {
      escopo: decisao({ perguntaId: 'escopo' }),
      publico: decisao({ perguntaId: 'publico' })
    }

    expect(afirmacoesDaConvention(catalogo, decisoes)).toHaveLength(2)
  })

  it('sem decisão, a Convention nasce vazia — nada é importado', () => {
    expect(afirmacoesDaConvention([pergunta({ id: 'escopo' })], {})).toEqual([])
  })

  it('toda regra cita a decisão que a informou', () => {
    const catalogo = [pergunta({ id: 'escopo' })]
    const decisoes: DecisoesPorPergunta = { escopo: decisao({ perguntaId: 'escopo' }) }

    const regras = afirmacoesDaConvention(catalogo, decisoes)

    expect(regras.every((r) => r.origem.tipo === 'decisao')).toBe(true)
  })

  it('decisão omitida não vira regra', () => {
    const catalogo = [pergunta({ id: 'escopo' })]
    const decisoes: DecisoesPorPergunta = {
      escopo: decisao({ perguntaId: 'escopo', motivo: 'omitida' })
    }

    expect(afirmacoesDaConvention(catalogo, decisoes)).toEqual([])
  })
})

describe('renderizarDocumento', () => {
  it('escreve a marca de origem junto de cada afirmação', () => {
    const catalogo = [pergunta({ id: 'escopo' })]
    const decisoes: DecisoesPorPergunta = { escopo: decisao({ perguntaId: 'escopo' }) }
    const afirmacoes = afirmacoesDoPrd(catalogo, decisoes, ['escopo'])

    const md = renderizarDocumento(
      'PRD',
      PROJETO,
      afirmacoes,
      SECOES_DO_DOCUMENTO.PRD,
      PREAMBULO_DO_DOCUMENTO.PRD
    )

    expect(md).toContain('<!-- origem: decisao/escopo · d-escopo -->')
  })

  it('declara a seção vazia em vez de omiti-la', () => {
    const md = renderizarDocumento(
      'LANDSCAPE',
      PROJETO,
      [],
      SECOES_DO_DOCUMENTO.LANDSCAPE,
      PREAMBULO_DO_DOCUMENTO.LANDSCAPE
    )

    expect(md).toContain('## Cenário')
    expect(md).toContain('_Sem conteúdo registrado nesta revisão._')
  })

  it('o preâmbulo diz como o arquivo foi produzido', () => {
    const md = renderizarDocumento(
      'CONVENTION',
      PROJETO,
      [],
      SECOES_DO_DOCUMENTO.CONVENTION,
      PREAMBULO_DO_DOCUMENTO.CONVENTION
    )

    expect(md).toContain('Nenhuma política de outro projeto é importada')
  })

  it('o título nomeia o projeto', () => {
    const md = renderizarDocumento('PRD', PROJETO, [], SECOES_DO_DOCUMENTO.PRD, '')

    expect(md.startsWith('# PRD — Projeto Alfa')).toBe(true)
  })

  it('as seções saem na ordem declarada', () => {
    const md = renderizarDocumento('PRD', PROJETO, [], SECOES_DO_DOCUMENTO.PRD, '')

    expect(md.indexOf('## Escopo')).toBeLessThan(md.indexOf('## Não objetivos'))
  })

  it('é determinístico — duas renderizações iguais', () => {
    const catalogo = [pergunta({ id: 'escopo' })]
    const decisoes: DecisoesPorPergunta = { escopo: decisao({ perguntaId: 'escopo' }) }
    const afirmacoes = afirmacoesDoPrd(catalogo, decisoes, ['escopo'])
    const render = (): string =>
      renderizarDocumento('PRD', PROJETO, afirmacoes, SECOES_DO_DOCUMENTO.PRD, '')

    expect(render()).toBe(render())
  })
})
