/**
 * A composição do roadmap e do STATUS (SPEC-Planejamento-06).
 *
 * O que estes testes protegem: **a estratégia do roadmap sai da decisão do PI, não de uma
 * heurística nossa**. As duas opções de `escopo` descrevem roadmaps diferentes — fatia vertical
 * dá um MVP por jornada; fundação ampla põe um MVP de fundação antes, e o DAG reflete isso.
 *
 * E o que a composição **recusa** fazer: sem decisão de escopo, ou sem jornada prototipada, o
 * roadmap sai vazio. Assumir uma estratégia seria escolher pelo PI; inventar uma jornada seria
 * prometer o que ninguém desenhou.
 */

import { describe, expect, it } from 'vitest'
import type { Decision, DecisoesPorPergunta, Pergunta } from './wizard'
import {
  ARQUIVO_DO_STATUS,
  comporRoadmap,
  renderizarArquivoHistorico,
  renderizarSpec,
  renderizarStatus,
  slugificar
} from './roadmap-compositor'
import { proximaFatia, validarDag } from './roadmap'

const CATALOGO: readonly Pergunta[] = [
  {
    id: 'escopo',
    etapa: 'contexto',
    titulo: 'Escopo do projeto',
    enunciado: 'Como começar?',
    opcoes: [
      { id: 'fatia-vertical', rotulo: 'Uma fatia vertical ponta a ponta', impacto: 'impacto A' },
      { id: 'fundacao-ampla', rotulo: 'Fundação ampla antes dos fluxos', impacto: 'impacto B' }
    ],
    recomendada: 'fatia-vertical',
    justificativa: 'porque sim',
    aceitaTextoLivre: true,
    delegavel: true
  }
]

function decisao(escolha: string): Decision {
  return {
    id: 'd-escopo',
    user_id: 'u-1',
    workspace_id: 'jarvis',
    projectId: 'p-1',
    perguntaId: 'escopo',
    etapa: 'contexto',
    escolha,
    texto: null,
    recomendacao: 'fatia-vertical',
    justificativa: 'porque sim',
    autor: 'pi',
    motivo: 'escolhida',
    substituiu: null,
    created_at: '2026-08-30T10:00:00.000Z'
  }
}

function decisoes(escolha: string): DecisoesPorPergunta {
  return { escopo: decisao(escolha) }
}

const JORNADAS = ['Cadastro de cliente', 'Relatórios']

describe('comporRoadmap — a estratégia vem da decisão', () => {
  it('fatia vertical: um MVP por jornada, sem dependência entre eles', () => {
    const roadmap = comporRoadmap(CATALOGO, decisoes('fatia-vertical'), JORNADAS)

    expect(roadmap.mvps).toHaveLength(2)
    expect(roadmap.mvps.map((m) => m.titulo)).toEqual(JORNADAS)
    // Fatia vertical = valor completo, escopo estreito: nada depende de nada.
    expect(roadmap.mvps.every((m) => m.dependeDe.length === 0)).toBe(true)
  })

  it('fundação ampla: um MVP de fundação, e as jornadas dependendo dele', () => {
    const roadmap = comporRoadmap(CATALOGO, decisoes('fundacao-ampla'), JORNADAS)

    expect(roadmap.mvps).toHaveLength(3)
    expect(roadmap.mvps[0]?.titulo).toBe('Fundação')
    expect(roadmap.mvps[0]?.dependeDe).toEqual([])
    // O DAG reflete a decisão literalmente: tudo depende da fundação.
    expect(roadmap.mvps.slice(1).every((m) => m.dependeDe.includes('mvp-fundacao'))).toBe(true)
  })

  it('as duas estratégias produzem DAG válido', () => {
    for (const escolha of ['fatia-vertical', 'fundacao-ampla']) {
      const roadmap = comporRoadmap(CATALOGO, decisoes(escolha), JORNADAS)
      expect(validarDag(roadmap.mvps)).toEqual([])
    }
  })

  it('toda fatia e todo MVP carregam a origem da decisão', () => {
    const roadmap = comporRoadmap(CATALOGO, decisoes('fundacao-ampla'), JORNADAS)

    for (const item of [...roadmap.mvps, ...roadmap.slices]) {
      expect(item.origem.tipo).toBe('decisao')
      if (item.origem.tipo === 'decisao') {
        expect(item.origem.decisaoId).toBe('d-escopo')
      }
    }
  })

  /** Escolher a estratégia pelo PI seria o oposto do que a M8-F03 construiu. */
  it('sem decisão de escopo, o roadmap sai vazio', () => {
    expect(comporRoadmap(CATALOGO, {}, JORNADAS)).toEqual({ mvps: [], slices: [] })
  })

  /** Mesma recusa do critério 4 da M8-F05: não se promete fluxo que ninguém desenhou. */
  it('sem jornada prototipada, o roadmap sai vazio', () => {
    expect(comporRoadmap(CATALOGO, decisoes('fatia-vertical'), [])).toEqual({
      mvps: [],
      slices: []
    })
  })

  it('cada MVP tem ao menos uma fatia, com spec própria', () => {
    const roadmap = comporRoadmap(CATALOGO, decisoes('fatia-vertical'), JORNADAS)

    for (const mvp of roadmap.mvps) {
      const suas = roadmap.slices.filter((s) => s.mvpId === mvp.id)
      expect(suas.length).toBeGreaterThan(0)
      expect(suas.every((s) => s.specSlug.endsWith('.md'))).toBe(true)
    }
  })

  it('nenhuma fatia nasce detalhada — a SPEC é da próxima, só dela', () => {
    const roadmap = comporRoadmap(CATALOGO, decisoes('fatia-vertical'), JORNADAS)
    expect(roadmap.slices.every((s) => !s.detalhada)).toBe(true)
  })
})

describe('renderizarStatus — invariante 1', () => {
  const roadmap = comporRoadmap(CATALOGO, decisoes('fundacao-ampla'), JORNADAS)
  const proxima = proximaFatia(roadmap)
  const texto = renderizarStatus('Projeto Alfa', roadmap, proxima, '2026-08-30')

  it('traz o índice Fatia ↔ SPEC com todas as fatias', () => {
    expect(texto).toContain('Índice Fatia ↔ SPEC')
    for (const slice of roadmap.slices) {
      expect(texto).toContain(slice.specSlug)
    }
  })

  it('declara no próprio arquivo que é a fonte única', () => {
    // Para quem lê depois não montar um segundo índice em outro lugar.
    expect(texto).toContain('Fonte única')
  })

  it('espelha o formato deste repositório: Agora, MVPs e o índice', () => {
    expect(texto).toContain('## Agora')
    expect(texto).toContain('## MVPs')
  })

  it('mostra a ordem de execução que o DAG permite', () => {
    expect(texto).toContain('Fundação')
    expect(texto).toContain('→')
  })

  it('diz quando não há ordem válida, em vez de omitir a seção', () => {
    const ciclico = {
      mvps: [
        { ...roadmap.mvps[0]!, id: 'a', dependeDe: ['b'] },
        { ...roadmap.mvps[1]!, id: 'b', dependeDe: ['a'] }
      ],
      slices: []
    }
    const comCiclo = renderizarStatus('X', ciclico, undefined, '2026-08-30')

    expect(comCiclo).toContain('ciclo')
  })

  it('sem próxima fatia, diz isso em vez de deixar a seção vazia', () => {
    const semProxima = renderizarStatus('X', roadmap, undefined, '2026-08-30')
    expect(semProxima).toContain('Nenhuma fatia pendente')
  })
})

describe('renderizarSpec — § Saídas', () => {
  const roadmap = comporRoadmap(CATALOGO, decisoes('fatia-vertical'), JORNADAS)
  const fatia = roadmap.slices[0]!
  const mvp = roadmap.mvps.find((m) => m.id === fatia.mvpId)
  const texto = renderizarSpec(fatia, mvp, '2026-08-30')

  /**
   * Uma spec que nascesse `aprovada-pi` faria a geração aprovar a si mesma — o mesmo erro que o
   * critério 3 impede no MVP.
   */
  it('nasce como rascunho, nunca aprovada-pi', () => {
    expect(texto).toContain('**rascunho**')
    expect(texto).not.toContain('aprovada-pi')
  })

  it('traz o cabeçalho que a CONVENTION exige: MVP, status e dependências', () => {
    expect(texto).toContain('- MVP:')
    expect(texto).toContain('- Status:')
    expect(texto).toContain('- Depende de:')
  })

  it('traz Objetivo, Escopo e Perguntas abertas', () => {
    expect(texto).toContain('## Objetivo')
    expect(texto).toContain('## Escopo')
    expect(texto).toContain('## Perguntas abertas ao PI')
  })

  it('nasce com pergunta em aberto — nascer sem nenhuma sugeriria nada a decidir', () => {
    expect(texto).toMatch(/- .+\?/)
  })
})

describe('renderizarArquivoHistorico', () => {
  it('aponta para o STATUS como estado corrente', () => {
    const texto = renderizarArquivoHistorico('Projeto Alfa', [], '2026-08-30')
    expect(texto).toContain(ARQUIVO_DO_STATUS)
  })

  it('diz que está vazio em vez de sair sem corpo', () => {
    expect(renderizarArquivoHistorico('X', [], '2026-08-30')).toContain('Nenhuma entrada')
  })

  it('lista as entradas quando há', () => {
    const texto = renderizarArquivoHistorico('X', ['M1 entregue'], '2026-08-30')
    expect(texto).toContain('M1 entregue')
  })
})

describe('slugificar', () => {
  it('remove acento, caixa e pontuação', () => {
    expect(slugificar('Relatórios Mensais!')).toBe('relatorios-mensais')
  })

  it('não deixa hífen nas pontas', () => {
    expect(slugificar('  — Cadastro —  ')).toBe('cadastro')
  })

  it('limita o tamanho', () => {
    expect(slugificar('a'.repeat(120)).length).toBeLessThanOrEqual(60)
  })
})
