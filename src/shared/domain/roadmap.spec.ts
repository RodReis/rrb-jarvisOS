/**
 * O DAG do roadmap (SPEC-Planejamento-06, § Testes: "unitários de DAG").
 *
 * O que estes testes protegem: **o critério 1 é uma checagem, não uma esperança**. Um ciclo não
 * é erro de digitação — é um roadmap em que nada pode começar. E a validação precisa distinguir
 * ciclo de losango: dois caminhos que reconvergem são legítimos, e um `visited` booleano os
 * acusaria como ciclo.
 */

import { describe, expect, it } from 'vitest'
import type { Mvp, Slice } from './roadmap'
import { ordemDeExecucao, proximaFatia, validarDag } from './roadmap'

const ORIGEM = { tipo: 'decisao' as const, decisaoId: 'd-1', perguntaId: 'escopo' }

function mvp(id: string, numero: number, dependeDe: readonly string[] = []): Mvp {
  return {
    id,
    numero,
    titulo: `MVP ${numero}`,
    tese: `tese de ${id}`,
    estado: 'proposto',
    dependeDe,
    origem: ORIGEM
  }
}

function slice(id: string, mvpId: string, numero: number, detalhada = false): Slice {
  return {
    id,
    mvpId,
    numero,
    titulo: `Fatia ${numero}`,
    specSlug: `spec-${id}`,
    detalhada,
    origem: ORIGEM
  }
}

describe('validarDag — critério 1', () => {
  it('aceita um roadmap linear', () => {
    expect(validarDag([mvp('a', 1), mvp('b', 2, ['a']), mvp('c', 3, ['b'])])).toEqual([])
  })

  it('aceita um losango: dois caminhos que reconvergem não são ciclo', () => {
    // a → b → d e a → c → d. Um `visited` booleano acusaria ciclo em `d`.
    const mvps = [mvp('a', 1), mvp('b', 2, ['a']), mvp('c', 3, ['a']), mvp('d', 4, ['b', 'c'])]
    expect(validarDag(mvps)).toEqual([])
  })

  it('detecta ciclo e nomeia os envolvidos, na ordem em que ele fecha', () => {
    const problemas = validarDag([mvp('a', 1, ['c']), mvp('b', 2, ['a']), mvp('c', 3, ['b'])])

    expect(problemas).toHaveLength(1)
    expect(problemas[0]?.problema).toBe('ciclo')
    // "há um ciclo" não é acionável: o PI precisa saber qual.
    expect(problemas[0]?.envolvidos).toContain('a')
    expect(problemas[0]?.envolvidos).toContain('b')
    expect(problemas[0]?.envolvidos).toContain('c')
  })

  it('reporta o mesmo ciclo uma vez só, não uma por ponto de entrada', () => {
    const problemas = validarDag([mvp('a', 1, ['b']), mvp('b', 2, ['a'])])
    expect(problemas.filter((p) => p.problema === 'ciclo')).toHaveLength(1)
  })

  it('detecta dependência ausente', () => {
    const problemas = validarDag([mvp('a', 1, ['fantasma'])])

    expect(problemas[0]?.problema).toBe('dependencia-ausente')
    expect(problemas[0]?.envolvidos).toEqual(['a', 'fantasma'])
  })

  it('detecta auto-dependência', () => {
    const problemas = validarDag([mvp('a', 1, ['a'])])
    expect(problemas[0]?.problema).toBe('auto-dependencia')
  })

  /**
   * Todos os problemas, não o primeiro: corrigir um de cada vez faria o PI descobrir o segundo
   * só na tentativa seguinte.
   */
  it('devolve todos os problemas de uma vez', () => {
    const problemas = validarDag([mvp('a', 1, ['a']), mvp('b', 2, ['fantasma'])])
    expect(problemas.map((p) => p.problema).sort()).toEqual([
      'auto-dependencia',
      'dependencia-ausente'
    ])
  })

  it('aceita roadmap vazio', () => {
    expect(validarDag([])).toEqual([])
  })
})

describe('ordemDeExecucao', () => {
  it('põe a dependência antes de quem depende', () => {
    const ordem = ordemDeExecucao([mvp('c', 3, ['b']), mvp('a', 1), mvp('b', 2, ['a'])])
    expect(ordem).toEqual(['a', 'b', 'c'])
  })

  it('desempata pelo número do PI, não pela ordem do array', () => {
    // Sem dependência entre eles: quem decide a ordem é a numeração.
    const ordem = ordemDeExecucao([mvp('z', 2), mvp('y', 1)])
    expect(ordem).toEqual(['y', 'z'])
  })

  /**
   * `undefined` e não ordem parcial: uma lista incompleta pareceria resposta, e o chamador
   * seguiria com ela.
   */
  it('devolve undefined quando o DAG é inválido', () => {
    expect(ordemDeExecucao([mvp('a', 1, ['b']), mvp('b', 2, ['a'])])).toBeUndefined()
  })
})

describe('proximaFatia — § Saídas', () => {
  it('devolve a primeira não detalhada do primeiro MVP da fila', () => {
    const roadmap = {
      mvps: [mvp('m2', 2, ['m1']), mvp('m1', 1)],
      slices: [slice('s2', 'm1', 2), slice('s1', 'm1', 1), slice('s3', 'm2', 1)]
    }

    expect(proximaFatia(roadmap)?.id).toBe('s1')
  })

  it('pula a que já foi detalhada', () => {
    const roadmap = {
      mvps: [mvp('m1', 1)],
      slices: [slice('s1', 'm1', 1, true), slice('s2', 'm1', 2)]
    }

    expect(proximaFatia(roadmap)?.id).toBe('s2')
  })

  it('passa ao MVP seguinte quando o primeiro está concluído', () => {
    const roadmap = {
      mvps: [{ ...mvp('m1', 1), estado: 'concluido' as const }, mvp('m2', 2, ['m1'])],
      slices: [slice('s1', 'm1', 1), slice('s2', 'm2', 1)]
    }

    expect(proximaFatia(roadmap)?.id).toBe('s2')
  })

  it('devolve undefined quando tudo já foi detalhado', () => {
    const roadmap = { mvps: [mvp('m1', 1)], slices: [slice('s1', 'm1', 1, true)] }
    expect(proximaFatia(roadmap)).toBeUndefined()
  })

  it('devolve undefined quando o DAG é inválido', () => {
    const roadmap = {
      mvps: [mvp('a', 1, ['b']), mvp('b', 2, ['a'])],
      slices: [slice('s1', 'a', 1)]
    }
    expect(proximaFatia(roadmap)).toBeUndefined()
  })
})
