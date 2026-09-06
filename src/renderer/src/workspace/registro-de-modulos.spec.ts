import { describe, expect, it } from 'vitest'
import {
  GRUPOS_POR_SUB_MODULO,
  itensVisiveis,
  gruposVisiveis,
  rotasDoSubModulo,
  type ModuloRegistrado
} from './registro-de-modulos'

/** Um módulo de teste — o registro não sabe nada sobre quem o preenche. */
function modulo(extra: Partial<ModuloRegistrado> = {}): ModuloRegistrado {
  return {
    id: 'falso',
    subModulo: 'command',
    grupo: 'NEGOCIOS',
    ordem: 1,
    rota: 'falso',
    disponivel: () => true,
    ...extra
  }
}

describe('registro de módulos — projeção do menu (critério 1)', () => {
  it('um módulo registrado aparece no grupo e na ordem que declarou', () => {
    const registro = [
      modulo({ id: 'b', rota: 'b', ordem: 2 }),
      modulo({ id: 'a', rota: 'a', ordem: 1 })
    ]

    const itens = itensVisiveis(registro, 'command')

    // A ordem é a declarada, não a de inserção: o registro é preenchido por import, e a ordem
    // dos imports não é fato sobre o menu.
    expect(itens.map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('módulo indisponível não entra no menu (critério 2)', () => {
    const registro = [modulo({ id: 'oculto', disponivel: () => false })]

    expect(itensVisiveis(registro, 'command')).toEqual([])
  })

  it('remover o módulo tira o item — sem tocar na tela', () => {
    const registro = [modulo({ id: 'a', rota: 'a' })]

    expect(itensVisiveis(registro, 'command')).toHaveLength(1)
    expect(itensVisiveis([], 'command')).toHaveLength(0)
  })

  it('não mistura os sub-módulos', () => {
    const registro = [
      modulo({ id: 'c', subModulo: 'command' }),
      modulo({ id: 'a', subModulo: 'agents', grupo: 'GOVERNANCE' })
    ]

    expect(itensVisiveis(registro, 'command').map((i) => i.id)).toEqual(['c'])
    expect(itensVisiveis(registro, 'agents').map((i) => i.id)).toEqual(['a'])
  })
})

describe('grupos visíveis (critério 3)', () => {
  it('grupo sem item visível não é renderizado', () => {
    const registro = [
      modulo({ id: 'visivel', grupo: 'NEGOCIOS' }),
      modulo({ id: 'oculto', grupo: 'INTEL', disponivel: () => false })
    ]

    expect(gruposVisiveis(registro, 'command').map((g) => g.grupo)).toEqual(['NEGOCIOS'])
  })

  it('os grupos saem na ordem do protótipo, não na do registro', () => {
    const registro = [
      modulo({ id: 'sis', grupo: 'SISTEMA', ordem: 1 }),
      modulo({ id: 'neg', grupo: 'NEGOCIOS', ordem: 1 })
    ]

    const ordem = GRUPOS_POR_SUB_MODULO.command
    const visiveis = gruposVisiveis(registro, 'command').map((g) => g.grupo)

    expect(visiveis).toEqual([...ordem].filter((g) => visiveis.includes(g)))
    expect(visiveis).toEqual(['NEGOCIOS', 'SISTEMA'])
  })

  it('cada grupo carrega só os seus itens, ordenados', () => {
    const registro = [
      modulo({ id: 'b', grupo: 'SISTEMA', ordem: 2, rota: 'b' }),
      modulo({ id: 'a', grupo: 'SISTEMA', ordem: 1, rota: 'a' })
    ]

    const grupos = gruposVisiveis(registro, 'command')

    expect(grupos).toHaveLength(1)
    expect(grupos[0]?.itens.map((i) => i.id)).toEqual(['a', 'b'])
  })
})

describe('rotas derivadas do registro', () => {
  it('as rotas do sub-módulo são as dos módulos visíveis', () => {
    const registro = [
      modulo({ id: 'a', rota: 'a' }),
      modulo({ id: 'oculto', rota: 'oculto', disponivel: () => false })
    ]

    // Rota de módulo oculto **não** entra: navegar até ela cairia no placeholder, que é
    // exatamente o que o critério 2 proíbe.
    expect(rotasDoSubModulo(registro, 'command')).toEqual(['a'])
  })

  it('a rota inicial é o primeiro item do primeiro grupo visível (regra 6)', () => {
    const registro = [
      modulo({ id: 'sis', grupo: 'SISTEMA', ordem: 1, rota: 'sis' }),
      modulo({ id: 'neg', grupo: 'NEGOCIOS', ordem: 1, rota: 'neg' })
    ]

    // NEGOCIOS vem antes de SISTEMA na ordem do protótipo, e é ela que decide — não a ordem
    // em que os módulos se registraram.
    expect(rotasDoSubModulo(registro, 'command')[0]).toBe('neg')
  })
})
