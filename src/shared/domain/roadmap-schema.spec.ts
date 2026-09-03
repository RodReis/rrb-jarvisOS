/**
 * O contrato de saída do modelo para o roadmap e a SPEC (SPEC-Jornada-05).
 *
 * O que estes testes protegem:
 *
 *  - **O parser não conserta.** Forma errada é `undefined`, e um MVP malformado invalida a saída
 *    inteira — completar uma referência ausente inventaria a procedência que o critério 2 exige,
 *    e descartar um MVP mudaria o grafo que o validador confere.
 *  - **O prompt enumera os ids do PRD e da arquitetura.** Sem eles no pedido, todo MVP viraria
 *    `proposto` e a distinção que decide o que entra na fila desapareceria.
 *  - **A regra do DAG e a obrigatoriedade das perguntas são ditas antes**, não só verificadas
 *    depois: cada saída recusada custa uma chamada.
 *  - **`fatiaId` não vem do modelo** — aceitá-lo deixaria a SPEC apontar para outra fatia, e o
 *    `SLICE_ENTRY` gravaria o aceite sobre a fatia errada.
 */

import { describe, expect, it } from 'vitest'
import {
  SISTEMA_DA_SPEC,
  SISTEMA_DO_ROADMAP,
  lerRoadmapDoModelo,
  lerSpecDoModelo,
  promptDaSpec,
  promptDoRoadmap
} from './roadmap-schema'
import { ORIGENS_DO_ROADMAP } from './roadmap-gerado'

const MVP_JSON = {
  id: 'mvp-1',
  numero: 1,
  titulo: 'Cadastro',
  tese: 'Cadastrar clientes.',
  resultado: 'Um cliente aparece na lista.',
  dependeDe: [],
  origem: 'prd',
  referencia: 'a-1',
  fatias: [{ id: 'f-1', numero: 1, titulo: 'Formulário', origem: 'prd', referencia: 'a-1' }]
}

const SPEC_JSON = {
  titulo: 'Formulário',
  objetivo: 'Cadastrar um cliente.',
  fluxo: ['Abrir'],
  regras: ['Nome obrigatório'],
  criteriosDeAceite: ['Salvar sem nome mostra erro'],
  testes: ['Unitário'],
  perguntas: [
    {
      id: 'p-1',
      enunciado: 'E-mail é obrigatório?',
      opcoes: [
        { id: 'a', rotulo: 'Sim', impacto: 'Todo cliente tem contato.' },
        { id: 'b', rotulo: 'Não', impacto: 'Cadastro mais rápido.' }
      ],
      recomendada: 'a',
      justificativa: 'O PRD fala em contatar depois.'
    }
  ]
}

describe('SISTEMA_DO_ROADMAP', () => {
  it('enumera as origens a partir da constante, não de uma lista escrita à mão', () => {
    for (const origem of ORIGENS_DO_ROADMAP) {
      expect(SISTEMA_DO_ROADMAP).toContain(origem)
    }
  })

  it('diz que o grafo é conferido por validador determinístico', () => {
    expect(SISTEMA_DO_ROADMAP).toContain('sem ciclo')
    expect(SISTEMA_DO_ROADMAP).toContain('validador determinístico')
  })

  it('proíbe requisito legal inventado (invariante 9)', () => {
    expect(SISTEMA_DO_ROADMAP).toContain('regulatório')
    expect(SISTEMA_DO_ROADMAP).toContain('nem como "proposto"')
  })

  it('proíbe trazer processo de outro projeto', () => {
    expect(SISTEMA_DO_ROADMAP).toContain('outro projeto')
  })

  it('diz que a especificação das fatias é um passo à parte', () => {
    expect(SISTEMA_DO_ROADMAP).toContain('só a')
    expect(SISTEMA_DO_ROADMAP).toContain('primeira fatia')
  })
})

describe('promptDoRoadmap', () => {
  const requisitos = [{ id: 'a-1', secao: 'Escopo', texto: 'Cadastrar cliente' }]
  const arquitetura = [{ id: 'arq-1', secao: 'ARCHITECTURE § Dados', texto: 'Tabela cliente' }]

  it('enumera os ids que cada origem pode citar', () => {
    const prompt = promptDoRoadmap({ requisitos, arquitetura })

    expect(prompt).toContain('[a-1]')
    expect(prompt).toContain('[arq-1]')
  })

  it('apresenta o MVP congelado como já decidido (critério 6)', () => {
    const prompt = promptDoRoadmap({
      requisitos,
      arquitetura,
      congelados: [{ id: 'mvp-1', titulo: 'Cadastro' }]
    })

    expect(prompt).toContain('JÁ DECIDIDO')
    expect(prompt).toContain('[mvp-1] Cadastro')
  })

  it('sem MVP congelado, não menciona nada decidido', () => {
    expect(promptDoRoadmap({ requisitos, arquitetura })).not.toContain('JÁ DECIDIDO')
  })

  it('a correção entra literal, para o modelo saber o que desfazer', () => {
    const prompt = promptDoRoadmap({
      requisitos,
      arquitetura,
      correcao: ['Ciclo de dependência: Cadastro → Relatórios.']
    })

    expect(prompt).toContain('recusada pelo validador')
    expect(prompt).toContain('Ciclo de dependência: Cadastro → Relatórios.')
  })
})

describe('SISTEMA_DA_SPEC', () => {
  it('exige ao menos uma pergunta aberta', () => {
    expect(SISTEMA_DA_SPEC).toContain('obrigatórias')
    expect(SISTEMA_DA_SPEC).toContain('ao menos uma')
  })

  it('exige critério verificável, com o contraexemplo', () => {
    expect(SISTEMA_DA_SPEC).toContain('verificável')
    expect(SISTEMA_DA_SPEC).toContain('não é critério')
  })

  it('exige impacto por opção', () => {
    expect(SISTEMA_DA_SPEC).toContain('Opção sem impacto')
  })
})

describe('promptDaSpec', () => {
  const base = {
    mvp: { titulo: 'Cadastro', tese: 'Cadastrar clientes.', resultado: 'Cliente na lista.' },
    fatia: { titulo: 'Formulário' },
    requisitos: [{ id: 'a-1', secao: 'Escopo', texto: 'Cadastrar cliente' }],
    arquitetura: [{ id: 'arq-1', secao: 'Dados', texto: 'Tabela cliente' }]
  }

  it('nomeia a fatia a especificar e as que ficam de fora', () => {
    const prompt = promptDaSpec({ ...base, outrasFatias: ['Lista com busca'] })

    expect(prompt).toContain('FATIA A ESPECIFICAR: Formulário')
    expect(prompt).toContain('NÃO especifique')
    expect(prompt).toContain('Lista com busca')
  })

  it('fatia única diz que é a única, em vez de listar nada', () => {
    const prompt = promptDaSpec({ ...base, outrasFatias: [] })
    expect(prompt).toContain('única fatia prevista')
  })
})

describe('lerRoadmapDoModelo — o parser não conserta', () => {
  it('lê a saída bem formada', () => {
    const mvps = lerRoadmapDoModelo(JSON.stringify({ mvps: [MVP_JSON] }))
    expect(mvps?.[0]?.id).toBe('mvp-1')
  })

  it('tolera a cerca de código que modelos produzem por hábito', () => {
    const bruto = '```json\n' + JSON.stringify({ mvps: [MVP_JSON] }) + '\n```'
    expect(lerRoadmapDoModelo(bruto)).toHaveLength(1)
  })

  it('JSON inválido devolve undefined', () => {
    expect(lerRoadmapDoModelo('{ nada disso')).toBeUndefined()
  })

  it('sem a chave mvps devolve undefined', () => {
    expect(lerRoadmapDoModelo(JSON.stringify({ outra: [] }))).toBeUndefined()
  })

  it('origem desconhecida invalida a saída inteira', () => {
    const invalido = { ...MVP_JSON, origem: 'palpite' }
    expect(lerRoadmapDoModelo(JSON.stringify({ mvps: [invalido] }))).toBeUndefined()
  })

  it('um MVP malformado invalida a saída inteira, não é descartado', () => {
    const bruto = JSON.stringify({ mvps: [MVP_JSON, { id: 'mvp-2' }] })
    expect(lerRoadmapDoModelo(bruto)).toBeUndefined()
  })

  it('dependeDe com item não-string invalida', () => {
    const invalido = { ...MVP_JSON, dependeDe: [1] }
    expect(lerRoadmapDoModelo(JSON.stringify({ mvps: [invalido] }))).toBeUndefined()
  })

  it('fatia malformada invalida o MVP inteiro', () => {
    const invalido = { ...MVP_JSON, fatias: [{ id: 'f-1' }] }
    expect(lerRoadmapDoModelo(JSON.stringify({ mvps: [invalido] }))).toBeUndefined()
  })

  it('lista vazia é saída legítima: o validador é quem recusa "sem MVP"', () => {
    expect(lerRoadmapDoModelo(JSON.stringify({ mvps: [] }))).toEqual([])
  })
})

describe('lerSpecDoModelo', () => {
  it('lê a saída bem formada e usa o fatiaId do serviço', () => {
    const spec = lerSpecDoModelo(JSON.stringify({ spec: SPEC_JSON }), 'f-1')

    expect(spec?.titulo).toBe('Formulário')
    expect(spec?.fatiaId).toBe('f-1')
  })

  it('ignora um fatiaId vindo do modelo: quem sabe qual fatia é o serviço', () => {
    const comFatia = { ...SPEC_JSON, fatiaId: 'f-outra' }
    const spec = lerSpecDoModelo(JSON.stringify({ spec: comFatia }), 'f-1')

    expect(spec?.fatiaId).toBe('f-1')
  })

  it('sem a chave spec devolve undefined', () => {
    expect(lerSpecDoModelo(JSON.stringify({ outra: {} }), 'f-1')).toBeUndefined()
  })

  it('lista de texto com item não-string invalida', () => {
    const invalido = { ...SPEC_JSON, criteriosDeAceite: [1, 2] }
    expect(lerSpecDoModelo(JSON.stringify({ spec: invalido }), 'f-1')).toBeUndefined()
  })

  it('pergunta sem opções válidas invalida', () => {
    const invalido = { ...SPEC_JSON, perguntas: [{ id: 'p-1', enunciado: 'X' }] }
    expect(lerSpecDoModelo(JSON.stringify({ spec: invalido }), 'f-1')).toBeUndefined()
  })

  it('lista vazia de perguntas atravessa o parser: quem recusa é o validador', () => {
    const semPergunta = { ...SPEC_JSON, perguntas: [] }
    expect(lerSpecDoModelo(JSON.stringify({ spec: semPergunta }), 'f-1')?.perguntas).toEqual([])
  })

  it('JSON inválido devolve undefined', () => {
    expect(lerSpecDoModelo('nada', 'f-1')).toBeUndefined()
  })
})
