import { describe, expect, it } from 'vitest'
import {
  NAVEGACAO_INICIAL,
  ROTA_INICIAL,
  ROTAS_POR_SUB_MODULO,
  ROTAS_POR_WORKSPACE,
  SUB_MODULOS_JARVIS,
  navegar,
  rotaDoWorkspace,
  rotaInicialDoSubModulo,
  rotaPertenceAoWorkspace,
  subModuloDaRota
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

/**
 * Rail dual do JARVIS (SPEC-DesignSystem-04a, critério 3).
 *
 * `Agentic OS` é área **interna** do JARVIS, nunca um quarto workspace (CLAUDE.md § Regras
 * técnicas invioláveis) — por isso o sub-módulo vive aqui, como dimensão da navegação do
 * JARVIS, e não em `WorkspaceId`.
 */
describe('sub-módulos do JARVIS', () => {
  it('toda rota do JARVIS pertence a exatamente um sub-módulo', () => {
    // O acordo entre `ROTAS_POR_WORKSPACE.jarvis` e `ROTAS_POR_SUB_MODULO` é frágil: acrescentar
    // uma rota ao JARVIS sem colocá-la num sub-módulo a deixaria órfã — visível na sidebar de
    // nenhum dos dois rails. Este teste é o que impede a divergência silenciosa.
    for (const rota of ROTAS_POR_WORKSPACE.jarvis) {
      const donos = SUB_MODULOS_JARVIS.filter((sub) => ROTAS_POR_SUB_MODULO[sub].includes(rota))
      expect(donos, `rota "${rota}" deveria ter exatamente um sub-módulo`).toHaveLength(1)
    }
  })

  it('nenhum sub-módulo declara rota que não é do JARVIS', () => {
    // A recíproca: uma rota em `ROTAS_POR_SUB_MODULO` que não exista no espaço apareceria no
    // rail e levaria a lugar nenhum.
    for (const sub of SUB_MODULOS_JARVIS) {
      for (const rota of ROTAS_POR_SUB_MODULO[sub]) {
        expect(rotaPertenceAoWorkspace('jarvis', rota), `"${rota}" não é rota do JARVIS`).toBe(true)
      }
    }
  })

  it('resolve o sub-módulo a partir da rota — é o que sincroniza rail e sidebar', () => {
    expect(subModuloDaRota('operacoes')).toBe('command')
    expect(subModuloDaRota('agentes')).toBe('agents')
  })

  it('devolve `null` para rota que não é do JARVIS, em vez de um default plausível', () => {
    // `'command'` aqui pareceria resposta legítima e acenderia o rail errado.
    expect(subModuloDaRota('notas')).toBeNull()
    expect(subModuloDaRota('inexistente')).toBeNull()
  })

  it('a rota inicial de cada sub-módulo pertence a ele', () => {
    for (const sub of SUB_MODULOS_JARVIS) {
      expect(ROTAS_POR_SUB_MODULO[sub]).toContain(rotaInicialDoSubModulo(sub))
    }
  })
})
