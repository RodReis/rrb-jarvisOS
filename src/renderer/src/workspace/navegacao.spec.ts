import { describe, expect, it } from 'vitest'
import {
  NAVEGACAO_INICIAL,
  ROTA_INICIAL,
  navegar,
  rotaDoWorkspace,
  rotaPertenceAoWorkspace
} from './navegacao'

describe('navegar', () => {
  it('registra a rota apenas no espaço navegado', () => {
    const depois = navegar(NAVEGACAO_INICIAL, 'noa', 'notas')

    expect(depois.noa).toBe('notas')
    expect(depois.jarvis).toBe(ROTA_INICIAL)
  })

  it('ignora rota que não pertence ao espaço', () => {
    // Aceitar `operacoes` como rota do NOA criaria o vazamento que o critério 1 proíbe.
    const depois = navegar(NAVEGACAO_INICIAL, 'noa', 'operacoes')

    expect(depois).toBe(NAVEGACAO_INICIAL)
  })

  it('não altera o objeto de origem', () => {
    const antes = NAVEGACAO_INICIAL
    navegar(antes, 'jarvis', 'agentes')

    expect(antes.jarvis).toBe(ROTA_INICIAL)
  })

  it('devolve o mesmo objeto quando a rota não muda', () => {
    const depois = navegar(NAVEGACAO_INICIAL, 'noa', ROTA_INICIAL)

    expect(depois).toBe(NAVEGACAO_INICIAL)
  })
})

describe('rotaDoWorkspace — critério de aceite 1', () => {
  it('A→B→A restaura a rota de A, e a de B nunca aparece em A', () => {
    // O cenário exato do critério: navega no JARVIS, vai pro NOA, navega lá, volta.
    let nav = navegar(NAVEGACAO_INICIAL, 'jarvis', 'operacoes')
    nav = navegar(nav, 'noa', 'agenda')

    expect(rotaDoWorkspace(nav, 'jarvis')).toBe('operacoes')
    expect(rotaDoWorkspace(nav, 'noa')).toBe('agenda')
    // A prova do não-vazamento: a rota de um nunca é a do outro.
    expect(rotaDoWorkspace(nav, 'jarvis')).not.toBe(rotaDoWorkspace(nav, 'noa'))
  })

  it('usa a rota inicial no primeiro acesso ao espaço', () => {
    expect(rotaDoWorkspace(NAVEGACAO_INICIAL, 'noa')).toBe(ROTA_INICIAL)
  })

  it('cai na rota inicial se o estado guardado não pertence ao espaço', () => {
    // Defesa contra estado corrompido: melhor a tela inicial que a rota de outro espaço.
    const corrompido = { noa: 'operacoes', jarvis: 'inicio' } as const

    expect(rotaDoWorkspace(corrompido, 'noa')).toBe(ROTA_INICIAL)
  })
})

describe('rotaPertenceAoWorkspace', () => {
  it('separa as rotas de cada espaço', () => {
    expect(rotaPertenceAoWorkspace('noa', 'notas')).toBe(true)
    expect(rotaPertenceAoWorkspace('noa', 'agentes')).toBe(false)
    expect(rotaPertenceAoWorkspace('jarvis', 'agentes')).toBe(true)
    expect(rotaPertenceAoWorkspace('jarvis', 'notas')).toBe(false)
  })

  it('não reconhece Desenvolvimento como rota de nenhum espaço', () => {
    expect(rotaPertenceAoWorkspace('noa', 'desenvolvimento')).toBe(false)
    expect(rotaPertenceAoWorkspace('jarvis', 'desenvolvimento')).toBe(false)
  })
})
