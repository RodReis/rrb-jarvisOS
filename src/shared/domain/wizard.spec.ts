/**
 * O grafo de perguntas do wizard (SPEC-Planejamento-03, critérios 1 a 7).
 *
 * O que estes testes provam é o que a spec chama de "conduzir uma decisão de cada vez": que a
 * ordem vem das decisões gravadas (e não de onde a tela achava que estava), que delegação deixa
 * autoria distinta, e que contradição é **devolvida**, nunca aplicada.
 */

import { describe, expect, it } from 'vitest'

import {
  decidirPorMim,
  decisoesVigentes,
  dependenciasAfetadas,
  detectarContradicoes,
  estadoDoWizard,
  isAutorDaDecisao,
  isDecisionReason,
  opcoesOrdenadas,
  perguntasRelevantes,
  podeAprovarGate,
  proximaPergunta,
  type Decision,
  type DecisoesPorPergunta,
  type Pergunta
} from './wizard'

function pergunta(over: Partial<Pergunta> & Pick<Pergunta, 'id'>): Pergunta {
  return {
    etapa: 'contexto',
    titulo: `Título ${over.id}`,
    enunciado: 'Enunciado',
    opcoes: [
      { id: 'a', rotulo: 'A', impacto: 'impacto A' },
      { id: 'b', rotulo: 'B', impacto: 'impacto B' }
    ],
    recomendada: 'a',
    justificativa: 'porque sim',
    aceitaTextoLivre: false,
    delegavel: true,
    ...over
  }
}

function decisao(over: Partial<Decision> & Pick<Decision, 'id' | 'perguntaId'>): Decision {
  return {
    user_id: 'u1',
    workspace_id: 'jarvis',
    projectId: 'p1',
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

describe('proximaPergunta — uma decisão de cada vez (critério 1)', () => {
  it('devolve a primeira pergunta quando nada foi decidido', () => {
    const catalogo = [pergunta({ id: 'p1' }), pergunta({ id: 'p2' })]

    expect(proximaPergunta(catalogo, {})?.id).toBe('p1')
  })

  it('pula a pergunta que já tem decisão vigente', () => {
    const catalogo = [pergunta({ id: 'p1' }), pergunta({ id: 'p2' })]
    const decisoes: DecisoesPorPergunta = { p1: decisao({ id: 'd1', perguntaId: 'p1' }) }

    expect(proximaPergunta(catalogo, decisoes)?.id).toBe('p2')
  })

  it('devolve null quando todas as relevantes foram decididas', () => {
    const catalogo = [pergunta({ id: 'p1' })]
    const decisoes: DecisoesPorPergunta = { p1: decisao({ id: 'd1', perguntaId: 'p1' }) }

    expect(proximaPergunta(catalogo, decisoes)).toBeNull()
  })
})

describe('perguntasRelevantes — pergunta irrelevante é omitida, não respondida por default', () => {
  it('remove a pergunta cuja relevância não se sustenta', () => {
    const catalogo = [
      pergunta({ id: 'p1' }),
      pergunta({ id: 'p2', relevante: (d) => d.p1?.escolha === 'b' })
    ]
    const decisoes: DecisoesPorPergunta = {
      p1: decisao({ id: 'd1', perguntaId: 'p1', escolha: 'a' })
    }

    expect(perguntasRelevantes(catalogo, decisoes).map((p) => p.id)).toEqual(['p1'])
  })

  it('mantém a pergunta quando a condição passa a valer', () => {
    const catalogo = [
      pergunta({ id: 'p1' }),
      pergunta({ id: 'p2', relevante: (d) => d.p1?.escolha === 'b' })
    ]
    const decisoes: DecisoesPorPergunta = {
      p1: decisao({ id: 'd1', perguntaId: 'p1', escolha: 'b' })
    }

    expect(perguntasRelevantes(catalogo, decisoes).map((p) => p.id)).toEqual(['p1', 'p2'])
  })

  it('pergunta sem condição é sempre relevante', () => {
    const catalogo = [pergunta({ id: 'p1' })]

    expect(perguntasRelevantes(catalogo, {})).toHaveLength(1)
  })
})

describe('dependenciasAfetadas — recalcula somente o afetado (critério 4)', () => {
  it('devolve apenas as dependentes que já têm decisão', () => {
    const catalogo = [
      pergunta({ id: 'p1', dependentes: ['p2', 'p3'] }),
      pergunta({ id: 'p2' }),
      pergunta({ id: 'p3' })
    ]
    const decisoes: DecisoesPorPergunta = { p2: decisao({ id: 'd2', perguntaId: 'p2' }) }

    expect(dependenciasAfetadas(catalogo, decisoes, 'p1')).toEqual(['p2'])
  })

  it('não é transitivo: dependente de dependente não entra', () => {
    const catalogo = [
      pergunta({ id: 'p1', dependentes: ['p2'] }),
      pergunta({ id: 'p2', dependentes: ['p3'] }),
      pergunta({ id: 'p3' })
    ]
    const decisoes: DecisoesPorPergunta = {
      p2: decisao({ id: 'd2', perguntaId: 'p2' }),
      p3: decisao({ id: 'd3', perguntaId: 'p3' })
    }

    expect(dependenciasAfetadas(catalogo, decisoes, 'p1')).toEqual(['p2'])
  })

  it('pergunta sem dependentes não afeta ninguém', () => {
    const catalogo = [pergunta({ id: 'p1' })]

    expect(dependenciasAfetadas(catalogo, {}, 'p1')).toEqual([])
  })
})

describe('detectarContradicoes — devolve, nunca aplica (critério 5)', () => {
  it('devolve a decisão anterior junto com a contradição', () => {
    const catalogo = [pergunta({ id: 'p1', dependentes: ['p2'] }), pergunta({ id: 'p2' })]
    const anterior = decisao({ id: 'd2', perguntaId: 'p2', escolha: 'b' })

    const contradicoes = detectarContradicoes(catalogo, { p2: anterior }, 'p1')

    expect(contradicoes).toHaveLength(1)
    expect(contradicoes[0]?.anterior).toBe(anterior)
    expect(contradicoes[0]?.perguntaAfetada).toBe('p2')
  })

  it('não altera as decisões recebidas', () => {
    const catalogo = [pergunta({ id: 'p1', dependentes: ['p2'] }), pergunta({ id: 'p2' })]
    const decisoes: DecisoesPorPergunta = { p2: decisao({ id: 'd2', perguntaId: 'p2' }) }
    const antes = JSON.stringify(decisoes)

    detectarContradicoes(catalogo, decisoes, 'p1')

    expect(JSON.stringify(decisoes)).toBe(antes)
  })

  it('sem dependente decidido não há contradição', () => {
    const catalogo = [pergunta({ id: 'p1', dependentes: ['p2'] }), pergunta({ id: 'p2' })]

    expect(detectarContradicoes(catalogo, {}, 'p1')).toEqual([])
  })
})

describe('decidirPorMim — delegação com autoria (critério 3)', () => {
  it('grava o agente como autor, nunca o PI', () => {
    const delegada = decidirPorMim(pergunta({ id: 'p1' }))

    expect(delegada?.autor).toBe('agente')
    expect(delegada?.motivo).toBe('delegada')
  })

  it('escolhe a opção recomendada e preserva a justificativa', () => {
    const delegada = decidirPorMim(pergunta({ id: 'p1', recomendada: 'b', justificativa: 'razão' }))

    expect(delegada?.escolha).toBe('b')
    expect(delegada?.recomendacao).toBe('b')
    expect(delegada?.justificativa).toBe('razão')
  })

  it('recusa pergunta não delegável no domínio, não na tela', () => {
    expect(decidirPorMim(pergunta({ id: 'p1', delegavel: false }))).toBeNull()
  })
})

describe('podeAprovarGate — decisão de agente não aprova (CONVENTION §4, invariante 3)', () => {
  it('decisão do PI aprova', () => {
    expect(podeAprovarGate(decisao({ id: 'd1', perguntaId: 'p1', autor: 'pi' }))).toBe(true)
  })

  it('decisão delegada ao agente não aprova', () => {
    expect(
      podeAprovarGate(decisao({ id: 'd1', perguntaId: 'p1', autor: 'agente', motivo: 'delegada' }))
    ).toBe(false)
  })
})

describe('opcoesOrdenadas — recomendada primeiro (critério 2)', () => {
  it('põe a recomendada na frente sem descartar as demais', () => {
    const ordenadas = opcoesOrdenadas(pergunta({ id: 'p1', recomendada: 'b' }))

    expect(ordenadas.map((o) => o.id)).toEqual(['b', 'a'])
  })

  it('preserva a ordem declarada entre as não recomendadas', () => {
    const p = pergunta({
      id: 'p1',
      recomendada: 'c',
      opcoes: [
        { id: 'a', rotulo: 'A', impacto: 'ia' },
        { id: 'b', rotulo: 'B', impacto: 'ib' },
        { id: 'c', rotulo: 'C', impacto: 'ic' }
      ]
    })

    expect(opcoesOrdenadas(p).map((o) => o.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('decisoesVigentes — append-only sem perder a trilha', () => {
  it('a substituta vence a substituída', () => {
    const historico = [
      decisao({ id: 'd1', perguntaId: 'p1', escolha: 'a' }),
      decisao({ id: 'd2', perguntaId: 'p1', escolha: 'b', substituiu: 'd1', motivo: 'substituida' })
    ]

    expect(decisoesVigentes(historico).p1?.escolha).toBe('b')
  })

  it('a decisão substituída continua no histórico', () => {
    const historico = [
      decisao({ id: 'd1', perguntaId: 'p1' }),
      decisao({ id: 'd2', perguntaId: 'p1', substituiu: 'd1', motivo: 'substituida' })
    ]

    decisoesVigentes(historico)

    expect(historico).toHaveLength(2)
    expect(historico[0]?.id).toBe('d1')
  })

  it('pergunta omitida não vira decisão vigente', () => {
    const historico = [decisao({ id: 'd1', perguntaId: 'p1', motivo: 'omitida' })]

    expect(decisoesVigentes(historico).p1).toBeUndefined()
  })
})

describe('estadoDoWizard — retomada e conclusão (critérios 6 e 7)', () => {
  it('retoma na pergunta pendente a partir só do histórico', () => {
    const catalogo = [pergunta({ id: 'p1' }), pergunta({ id: 'p2' })]
    const historico = [decisao({ id: 'd1', perguntaId: 'p1' })]

    const estado = estadoDoWizard(catalogo, historico)

    expect(estado.tipo).toBe('pergunta')
    if (estado.tipo !== 'pergunta') throw new Error('esperado pergunta')
    expect(estado.pergunta.id).toBe('p2')
    expect(estado.restantes).toBe(1)
  })

  it('não repete decisão já concluída ao retomar', () => {
    const catalogo = [pergunta({ id: 'p1' }), pergunta({ id: 'p2' })]
    const historico = [
      decisao({ id: 'd1', perguntaId: 'p1' }),
      decisao({ id: 'd2', perguntaId: 'p2' })
    ]

    expect(estadoDoWizard(catalogo, historico).tipo).toBe('concluido')
  })

  it('conclui com o histórico inteiro como resumo', () => {
    const catalogo = [pergunta({ id: 'p1' })]
    const historico = [decisao({ id: 'd1', perguntaId: 'p1' })]

    const estado = estadoDoWizard(catalogo, historico)

    expect(estado.tipo).toBe('concluido')
    if (estado.tipo !== 'concluido') throw new Error('esperado concluido')
    expect(estado.decisoes).toHaveLength(1)
  })

  it('pergunta omitida não conta como lacuna', () => {
    const catalogo = [
      pergunta({ id: 'p1' }),
      pergunta({ id: 'p2', relevante: (d) => d.p1?.escolha === 'b' })
    ]
    const historico = [decisao({ id: 'd1', perguntaId: 'p1', escolha: 'a' })]

    expect(estadoDoWizard(catalogo, historico).tipo).toBe('concluido')
  })
})

describe('type guards de fronteira', () => {
  it('reconhece os autores do contrato', () => {
    expect(isAutorDaDecisao('pi')).toBe(true)
    expect(isAutorDaDecisao('agente')).toBe(true)
  })

  it('recusa autor fora do contrato', () => {
    expect(isAutorDaDecisao('admin')).toBe(false)
    expect(isAutorDaDecisao(null)).toBe(false)
  })

  it('reconhece e recusa motivos', () => {
    expect(isDecisionReason('delegada')).toBe(true)
    expect(isDecisionReason('inventada')).toBe(false)
  })
})
