import { describe, expect, it } from 'vitest'
import {
  CAPACIDADES,
  PROCEDIMENTO_DIRETO,
  isCapacidade,
  resolverCapacidade,
  resolverCapacidades,
  type SkillDisponivel
} from './skills'

const GRAPHIFY: SkillDisponivel = {
  id: 'graphify',
  capacidades: ['mapa-estrutural', 'compressao-de-contexto']
}

const BRAINSTORMING: SkillDisponivel = {
  id: 'brainstorming',
  capacidades: ['perguntas-de-escopo']
}

describe('resolverCapacidade', () => {
  it('usa a skill que declara a capacidade', () => {
    const resolvida = resolverCapacidade('mapa-estrutural', [GRAPHIFY])

    expect(resolvida.meio).toBe('skill')
    expect(resolvida.skillId).toBe('graphify')
  })

  it('cai no procedimento direto quando nenhuma skill fornece a capacidade', () => {
    const resolvida = resolverCapacidade('perguntas-de-escopo', [GRAPHIFY])

    expect(resolvida.meio).toBe('direto')
    expect(resolvida.skillId).toBeUndefined()
  })

  it('o procedimento é o mesmo nos dois meios — a disciplina não depende da skill', () => {
    const comSkill = resolverCapacidade('mapa-estrutural', [GRAPHIFY])
    const semSkill = resolverCapacidade('mapa-estrutural', [])

    expect(comSkill.procedimento).toBe(semSkill.procedimento)
    expect(semSkill.procedimento).toBe(PROCEDIMENTO_DIRETO['mapa-estrutural'])
  })

  it('a primeira skill que declara a capacidade atende', () => {
    const outra: SkillDisponivel = { id: 'outra', capacidades: ['mapa-estrutural'] }

    expect(resolverCapacidade('mapa-estrutural', [GRAPHIFY, outra]).skillId).toBe('graphify')
    expect(resolverCapacidade('mapa-estrutural', [outra, GRAPHIFY]).skillId).toBe('outra')
  })
})

describe('resolverCapacidades', () => {
  it('resolve todas as capacidades do fluxo, sempre', () => {
    const resolvidas = resolverCapacidades([GRAPHIFY, BRAINSTORMING])

    expect(resolvidas.map((r) => r.capacidade)).toEqual([...CAPACIDADES])
  })

  /**
   * O teste do critério 5. Registro **vazio** — nenhuma skill instalada — e ainda assim toda
   * capacidade tem procedimento. Se um dia alguém puser um `if` em torno da skill, esta
   * asserção é a que quebra.
   */
  it('sem nenhuma skill instalada, toda capacidade continua atendida pelo caminho direto', () => {
    const resolvidas = resolverCapacidades([])

    expect(resolvidas).toHaveLength(CAPACIDADES.length)
    for (const resolvida of resolvidas) {
      expect(resolvida.meio).toBe('direto')
      expect(resolvida.procedimento.length).toBeGreaterThan(0)
    }
  })

  it('mistura os dois meios sem perder nenhuma capacidade', () => {
    const porCapacidade = new Map(
      resolverCapacidades([GRAPHIFY]).map((r) => [r.capacidade, r.meio])
    )

    expect(porCapacidade.get('mapa-estrutural')).toBe('skill')
    expect(porCapacidade.get('revisao-de-saida')).toBe('direto')
  })
})

describe('isCapacidade', () => {
  it('aceita as capacidades do contrato e recusa nome de skill', () => {
    expect(isCapacidade('compressao-de-contexto')).toBe(true)
    // Nome de skill não é capacidade — a distinção é o ponto do arquivo inteiro.
    expect(isCapacidade('graphify')).toBe(false)
  })
})
