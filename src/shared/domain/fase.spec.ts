/**
 * A fase do projeto, derivada da etapa (SPEC-Fases-01, critério 1).
 *
 * O que estes testes protegem é a **completude do mapa**: `FASE_DA_ETAPA` é `Record` completo
 * justamente para que acrescentar uma etapa obrigue a decidir a fase dela. Um mapa parcial
 * deixaria a etapa nova cair em `undefined` e a tela mostraria um card sem fase — o defeito
 * apareceria na UI, longe da decisão que faltou tomar.
 */

import { describe, expect, it } from 'vitest'
import { ETAPAS, ordemDaEtapa } from './jornada'
import type { Fase } from './fase'
import {
  FASES,
  FASE_DA_ETAPA,
  ROTULO_DA_FASE,
  etapasDaFase,
  faseDaEtapa,
  isFase,
  progressoNaFase
} from './fase'

describe('mapa de fase por etapa (critério 1)', () => {
  it('cobre todas as ETAPAS — etapa nova sem fase quebra aqui', () => {
    for (const etapa of ETAPAS) {
      expect(FASE_DA_ETAPA[etapa], `etapa "${etapa}" sem fase`).toBeDefined()
      expect(FASES).toContain(FASE_DA_ETAPA[etapa])
    }

    expect(Object.keys(FASE_DA_ETAPA)).toHaveLength(ETAPAS.length)
  })

  it('corta as três fases onde o PI decidiu (2026-09-04)', () => {
    expect(faseDaEtapa('prompt')).toBe('planejamento')
    expect(faseDaEtapa('arquitetura')).toBe('planejamento')
    expect(faseDaEtapa('pacote-aceito')).toBe('planejamento')
    expect(faseDaEtapa('roadmap')).toBe('especificacao')
    expect(faseDaEtapa('spec-aceita')).toBe('especificacao')
    expect(faseDaEtapa('construcao')).toBe('construcao')
  })

  it('mantém as fases contíguas na ordem da trilha: a fase nunca volta', () => {
    const ordemDaFase = (f: Fase): number => FASES.indexOf(f)
    const porOrdem = [...ETAPAS].sort((a, b) => ordemDaEtapa(a) - ordemDaEtapa(b))

    for (let i = 1; i < porOrdem.length; i++) {
      const anterior = ordemDaFase(faseDaEtapa(porOrdem[i - 1]))
      const atual = ordemDaFase(faseDaEtapa(porOrdem[i]))
      expect(atual, `fase regride em "${porOrdem[i]}"`).toBeGreaterThanOrEqual(anterior)
    }
  })

  it('dá rótulo pt-BR a cada fase', () => {
    for (const fase of FASES) {
      expect(ROTULO_DA_FASE[fase]).toBeTruthy()
    }

    expect(ROTULO_DA_FASE.planejamento).toBe('Planejamento')
    expect(ROTULO_DA_FASE.especificacao).toBe('Especificação')
    expect(ROTULO_DA_FASE.construcao).toBe('Construção')
  })
})

describe('etapas de cada fase', () => {
  it('particiona as ETAPAS sem sobra e sem repetição', () => {
    const todas = FASES.flatMap((fase) => [...etapasDaFase(fase)])

    expect(todas).toHaveLength(ETAPAS.length)
    expect(new Set(todas).size).toBe(ETAPAS.length)
  })

  it('preserva a ordem da trilha dentro da fase', () => {
    const etapas = etapasDaFase('planejamento')
    const ordens = etapas.map(ordemDaEtapa)

    expect([...ordens].sort((a, b) => a - b)).toEqual(ordens)
  })
})

describe('progresso dentro da fase', () => {
  it('conta a posição da etapa entre as da própria fase, não da trilha inteira', () => {
    expect(progressoNaFase('prompt')).toEqual({ posicao: 1, total: 8 })
    expect(progressoNaFase('pacote-aceito')).toEqual({ posicao: 8, total: 8 })
    expect(progressoNaFase('roadmap')).toEqual({ posicao: 1, total: 3 })
    expect(progressoNaFase('construcao')).toEqual({ posicao: 1, total: 1 })
  })
})

describe('contrato da fase', () => {
  it('reconhece fase do enum e recusa qualquer outra string', () => {
    expect(isFase('planejamento')).toBe(true)
    expect(isFase('Planejamento')).toBe(false)
    expect(isFase(null)).toBe(false)
  })
})
