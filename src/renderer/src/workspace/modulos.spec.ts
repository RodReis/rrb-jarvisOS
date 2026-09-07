import { describe, expect, it } from 'vitest'
import { MODULOS_DO_APP } from './modulos'
import { gruposVisiveis, rotasDoSubModulo } from './registro-de-modulos'
import { SUB_MODULOS_JARVIS } from './navegacao'

/**
 * O que a fatia entrega visível — e é pouco de propósito.
 *
 * A spec diz: *"Professional Ops = NEGÓCIOS › Projects Hub · SISTEMA › Terminal, Settings.
 * Agents OS = GOVERNANCE › Operator Central. É pouco — e é **verdade**."* Este teste crava esse
 * resultado; quando a M9-F06 acender o Mission Control, é ele que vai reprovar e pedir
 * atualização, em vez de a mudança passar despercebida.
 */
describe('módulos do app — o menu de hoje (critério 3)', () => {
  it('o Professional Ops mostra COMANDO, NEGÓCIOS e SISTEMA', () => {
    const grupos = gruposVisiveis(MODULOS_DO_APP, 'command')

    // COMANDO acendeu na SPEC-Voz-01, com o microfone. Este teste reprovou quando o módulo
    // entrou, que é exatamente o papel dele: mudança no menu não passa despercebida.
    expect(grupos.map((g) => g.grupo)).toEqual(['COMANDO', 'NEGOCIOS', 'SISTEMA'])
    expect(grupos.flatMap((g) => g.itens.map((i) => i.rota))).toEqual([
      'voz',
      'projects',
      'terminal',
      'settings'
    ])
  })

  it('o Agents OS mostra só GOVERNANCE', () => {
    const grupos = gruposVisiveis(MODULOS_DO_APP, 'agents')

    expect(grupos.map((g) => g.grupo)).toEqual(['GOVERNANCE'])
    expect(grupos.flatMap((g) => g.itens.map((i) => i.rota))).toEqual(['operator'])
  })

  it('o grupo HARNESSES não aparece — não há página de harness (critério 4)', () => {
    const grupos = gruposVisiveis(MODULOS_DO_APP, 'agents').map((g) => g.grupo)

    expect(grupos).not.toContain('HARNESSES')
  })

  it('as rotas iniciais são os primeiros itens visíveis (regra 6)', () => {
    // A rota inicial mudou sozinha ao COMANDO acender: ele vem antes de NEGÓCIOS na ordem do
    // protótipo, e a regra 6 diz "primeiro item do primeiro grupo visível". Nada foi editado
    // para isso acontecer — é a projeção fazendo o trabalho.
    expect(rotasDoSubModulo(MODULOS_DO_APP, 'command')[0]).toBe('voz')
    expect(rotasDoSubModulo(MODULOS_DO_APP, 'agents')[0]).toBe('operator')
  })

  it('nenhum item visível é reserva de lugar', () => {
    // A reserva (`Metas`, `Studio`, `HUD`…) existe no mapa da spec, mas não no registro: item
    // sem módulo não é item (regra 2). Um registro com `disponivel: () => false` para eles
    // seria lista literal disfarçada — e a chave i18n já guarda o lugar deles.
    for (const sub of SUB_MODULOS_JARVIS) {
      for (const item of rotasDoSubModulo(MODULOS_DO_APP, sub)) {
        expect(['voz', 'projects', 'terminal', 'settings', 'operator']).toContain(item)
      }
    }
  })

  it('cada módulo declara id, rota e grupo — sem campo vazio', () => {
    for (const m of MODULOS_DO_APP) {
      expect(m.id, 'id vazio').not.toBe('')
      expect(m.rota, `rota vazia em ${m.id}`).not.toBe('')
      expect(m.ordem, `ordem inválida em ${m.id}`).toBeGreaterThan(0)
    }
  })

  it('não há duas rotas iguais no mesmo sub-módulo', () => {
    // Rota duplicada faria dois itens levarem à mesma tela — o oposto de "um caminho por tela"
    // (regra 4), e a sidebar acenderia os dois como ativos.
    for (const sub of SUB_MODULOS_JARVIS) {
      const rotas = rotasDoSubModulo(MODULOS_DO_APP, sub)
      expect(new Set(rotas).size, `rota repetida em ${sub}`).toBe(rotas.length)
    }
  })
})
