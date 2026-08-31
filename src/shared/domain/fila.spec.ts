/**
 * Testes da fila (SPEC-Entrega-02, critério 1 e invariante 5 da CONVENTION §4).
 *
 * A dependência de fatia é implícita (decisão do PI, 2026-08-30): fatias anteriores do mesmo
 * MVP, por `numero`, mais os MVPs de que o MVP dela depende. Estes testes fixam as duas partes.
 */

import { describe, expect, it } from 'vitest'

import { dependenciasAbertas, fatiaDesbloqueada } from './fila'
import type { Mvp, Slice } from './roadmap'

const origem: Mvp['origem'] = { tipo: 'decisao', decisaoId: 'd-1', perguntaId: 'p-1' }

function mvp(id: string, numero: number, sobrescreve: Partial<Mvp> = {}): Mvp {
  return {
    id,
    numero,
    titulo: `MVP ${numero}`,
    tese: 'tese',
    estado: 'na-fila',
    dependeDe: [],
    origem,
    ...sobrescreve
  }
}

function slice(id: string, mvpId: string, numero: number): Slice {
  return {
    id,
    mvpId,
    numero,
    titulo: `Fatia ${numero}`,
    specSlug: `spec-${id}`,
    detalhada: true,
    origem
  }
}

describe('dependência entre fatias do mesmo MVP', () => {
  const mvps = [mvp('m1', 1)]
  const slices = [slice('f1', 'm1', 1), slice('f2', 'm1', 2), slice('f3', 'm1', 3)]

  it('libera a primeira fatia: não há anterior a esperar', () => {
    expect(fatiaDesbloqueada(slices[0], mvps, slices, [])).toBe(true)
  })

  it('bloqueia a segunda enquanto a primeira não concluiu', () => {
    const abertas = dependenciasAbertas(slices[1], mvps, slices, [])

    expect(abertas).toHaveLength(1)
    expect(abertas[0]).toMatchObject({ tipo: 'fatia-anterior', id: 'f1' })
  })

  it('libera a segunda quando a primeira concluiu', () => {
    expect(fatiaDesbloqueada(slices[1], mvps, slices, [{ sliceId: 'f1' }])).toBe(true)
  })

  it('nomeia TODAS as anteriores em aberto, não só a primeira', () => {
    // Destravar uma de cada vez faria o PI descobrir a segunda só na tentativa seguinte.
    const abertas = dependenciasAbertas(slices[2], mvps, slices, [])

    expect(abertas.map((a) => a.id)).toEqual(['f1', 'f2'])
  })

  it('ignora fatias de numero maior: a fila anda para frente', () => {
    expect(fatiaDesbloqueada(slices[0], mvps, slices, [])).toBe(true)
  })
})

describe('dependência entre MVPs', () => {
  it('bloqueia a fatia quando o MVP de que ela depende não concluiu', () => {
    const mvps = [mvp('m1', 1), mvp('m2', 2, { dependeDe: ['m1'] })]
    const slices = [slice('f1', 'm2', 1)]

    const abertas = dependenciasAbertas(slices[0], mvps, slices, [])

    expect(abertas).toHaveLength(1)
    expect(abertas[0]).toMatchObject({ tipo: 'mvp-dependente', id: 'm1' })
  })

  it('libera quando o MVP dependente está concluido', () => {
    const mvps = [mvp('m1', 1, { estado: 'concluido' }), mvp('m2', 2, { dependeDe: ['m1'] })]
    const slices = [slice('f1', 'm2', 1)]

    expect(fatiaDesbloqueada(slices[0], mvps, slices, [])).toBe(true)
  })

  it('acumula as duas origens de bloqueio na mesma resposta', () => {
    const mvps = [mvp('m1', 1), mvp('m2', 2, { dependeDe: ['m1'] })]
    const slices = [slice('f1', 'm2', 1), slice('f2', 'm2', 2)]

    const abertas = dependenciasAbertas(slices[1], mvps, slices, [])

    expect(abertas.map((a) => a.tipo)).toEqual(['fatia-anterior', 'mvp-dependente'])
  })
})

describe('DAG inválido', () => {
  it('bloqueia toda fatia quando há ciclo entre MVPs (critério 1)', () => {
    // Sem ordem de execução válida, responder "desbloqueada" autorizaria trabalho sobre um
    // roadmap quebrado.
    const mvps = [mvp('m1', 1, { dependeDe: ['m2'] }), mvp('m2', 2, { dependeDe: ['m1'] })]
    const slices = [slice('f1', 'm1', 1)]

    const abertas = dependenciasAbertas(slices[0], mvps, slices, [])

    expect(abertas.length).toBeGreaterThan(0)
    expect(abertas[0].mensagem).toContain('não tem ordem válida')
  })

  it('bloqueia quando o MVP depende de outro que não existe no roadmap', () => {
    const mvps = [mvp('m1', 1, { dependeDe: ['fantasma'] })]
    const slices = [slice('f1', 'm1', 1)]

    expect(fatiaDesbloqueada(slices[0], mvps, slices, [])).toBe(false)
  })
})
