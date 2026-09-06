import { describe, expect, it } from 'vitest'
import {
  migrarNavegacao,
  migrarRota,
  NAVEGACAO_INICIAL,
  rotaInicialDoWorkspace,
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
    expect(depois.jarvis).toBe(rotaInicialDoWorkspace('jarvis'))
  })

  it('ignora rota que não pertence ao espaço', () => {
    // Aceitar `operator` como rota do NOA criaria o vazamento que o critério 1 proíbe.
    const depois = navegar(NAVEGACAO_INICIAL, 'noa', 'operator')

    expect(depois).toBe(NAVEGACAO_INICIAL)
  })

  it('não altera o objeto de origem', () => {
    const antes = NAVEGACAO_INICIAL
    navegar(antes, 'jarvis', 'terminal')

    expect(antes.jarvis).toBe(rotaInicialDoWorkspace('jarvis'))
  })

  it('devolve o mesmo objeto quando a rota não muda', () => {
    const depois = navegar(NAVEGACAO_INICIAL, 'noa', rotaInicialDoWorkspace('noa'))

    expect(depois).toBe(NAVEGACAO_INICIAL)
  })
})

describe('rotaDoWorkspace — critério de aceite 1', () => {
  it('A→B→A restaura a rota de A, e a de B nunca aparece em A', () => {
    // O cenário exato do critério: navega no JARVIS, vai pro NOA, navega lá, volta.
    let nav = navegar(NAVEGACAO_INICIAL, 'jarvis', 'terminal')
    nav = navegar(nav, 'noa', 'agenda')

    expect(rotaDoWorkspace(nav, 'jarvis')).toBe('terminal')
    expect(rotaDoWorkspace(nav, 'noa')).toBe('agenda')
    // A prova do não-vazamento: a rota de um nunca é a do outro.
    expect(rotaDoWorkspace(nav, 'jarvis')).not.toBe(rotaDoWorkspace(nav, 'noa'))
  })

  it('usa a rota inicial no primeiro acesso ao espaço', () => {
    expect(rotaDoWorkspace(NAVEGACAO_INICIAL, 'noa')).toBe(rotaInicialDoWorkspace('noa'))
  })

  it('cai na rota inicial se o estado guardado não pertence ao espaço', () => {
    // Defesa contra estado corrompido: melhor a tela inicial que a rota de outro espaço.
    const corrompido = { noa: 'operator', jarvis: 'terminal' } as const

    expect(rotaDoWorkspace(corrompido, 'noa')).toBe(rotaInicialDoWorkspace('noa'))
  })
})

describe('rotaPertenceAoWorkspace', () => {
  it('separa as rotas de cada espaço', () => {
    expect(rotaPertenceAoWorkspace('noa', 'notas')).toBe(true)
    expect(rotaPertenceAoWorkspace('noa', 'operator')).toBe(false)
    expect(rotaPertenceAoWorkspace('jarvis', 'operator')).toBe(true)
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
    expect(subModuloDaRota('projects')).toBe('command')
    expect(subModuloDaRota('operator')).toBe('agents')
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

/**
 * A migração de rota renomeada (SPEC-Shell-01, critério 6).
 *
 * `operacoes` virou `operator` e `projetos` virou `projects`. Quem já usava o app tem a rota
 * antiga gravada por workspace (SPEC-Fundacao-02), e sem migração ela deixaria de pertencer ao
 * espaço — caindo na rota inicial e perdendo onde a pessoa estava. Pior: `inicio` e `agentes`
 * **sumiram**, então "cair na inicial" não é mais um lugar seguro por si só.
 */
describe('migração das rotas renomeadas', () => {
  it('a rota antiga é traduzida para a nova, não descartada', () => {
    expect(migrarRota('operacoes')).toBe('operator')
    expect(migrarRota('projetos')).toBe('projects')
  })

  it('rota que sumiu vira `undefined` — quem chama cai na inicial do sub-módulo', () => {
    // `inicio` e `agentes` não existem mais. Devolver uma rota plausível aqui esconderia o
    // desaparecimento; `undefined` obriga quem chama a decidir, que é o contrato da regra 7.
    expect(migrarRota('inicio')).toBeUndefined()
    expect(migrarRota('agentes')).toBeUndefined()
  })

  it('rota atual passa intacta', () => {
    expect(migrarRota('terminal')).toBe('terminal')
    expect(migrarRota('settings')).toBe('settings')
  })

  it('a rota lembrada antiga não cai em placeholder', () => {
    // O cenário do critério 6, ponta a ponta: estado gravado antes da fatia, lido depois.
    const antigo = { noa: 'notas', jarvis: 'operacoes' } as const

    const rota = rotaDoWorkspace(migrarNavegacao(antigo), 'jarvis')

    expect(rota).toBe('operator')
    expect(rotaPertenceAoWorkspace('jarvis', rota)).toBe(true)
  })

  it('estado inteiramente obsoleto cai numa rota que existe', () => {
    const antigo = { noa: 'inicio', jarvis: 'inicio' } as const
    const migrado = migrarNavegacao(antigo)

    for (const ws of ['noa', 'jarvis'] as const) {
      expect(rotaPertenceAoWorkspace(ws, rotaDoWorkspace(migrado, ws))).toBe(true)
    }
  })
})
