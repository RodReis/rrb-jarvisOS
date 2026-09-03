/**
 * O contrato de saída do modelo (SPEC-Jornada-02, § Geração).
 *
 * O que estes testes protegem é uma recusa: **o parser não conserta**. Um parser tolerante —
 * que completasse origem ausente com um default, ou descartasse a entrada malformada e
 * seguisse com o resto — inventaria a procedência que o critério 4 existe para exigir, e o
 * brief passaria a ser "o que sobrou da saída" em vez do que o modelo produziu.
 */

import { describe, expect, it } from 'vitest'
import { BLOCOS_DO_BRIEF, TERMOS_QUE_EXIGEM_ORIGEM_HUMANA, normalizar } from './brief'
import {
  SISTEMA_DAS_PERGUNTAS,
  SISTEMA_DO_BRIEF,
  lerPerguntasDoModelo,
  lerSaidaDoModelo,
  promptDaGeracao,
  promptDasPerguntas
} from './brief-schema'

const VALIDO = JSON.stringify({
  afirmacoes: [
    { id: 'a-1', bloco: 'jornadas', texto: 'O leitor retoma de onde parou.', origem: 'prompt' }
  ],
  pendencias: [{ bloco: 'dominio-e-dados', pergunta: 'Qual base?', material: true }]
})

const PERGUNTA_VALIDA = JSON.stringify({
  perguntas: [
    {
      bloco: 'escopo-e-metricas',
      porQue: 'O prompt não diz onde a primeira versão para.',
      titulo: 'Alcance',
      enunciado: 'Até onde vai o primeiro corte?',
      opcoes: [
        { id: 'a', rotulo: 'Fatia vertical', impacto: 'Entrega ponta a ponta, cobertura menor.' },
        { id: 'b', rotulo: 'Fundação ampla', impacto: 'Base sólida, valor visível mais tarde.' }
      ],
      recomendada: 'a',
      justificativa: 'Uma fatia vertical valida a hipótese antes de investir na base.',
      aceitaTextoLivre: true,
      delegavel: true
    }
  ]
})

/** A cerca de código, montada em runtime — três crases literais num `.ts` são ruído de leitura. */
const CERCA = '`'.repeat(3)

describe('a instrução de sistema', () => {
  it('enumera os blocos a partir da constante, não de uma lista à mão', () => {
    // Uma segunda lista aqui divergiria no dia em que alguém mexesse só numa delas.
    for (const bloco of BLOCOS_DO_BRIEF) {
      expect(SISTEMA_DO_BRIEF).toContain(bloco)
    }
  })

  it('proíbe a invariante 9 **antes** de o modelo escrever', () => {
    // Pedir e depois barrar gasta uma chamada. O validador continua sendo a garantia; o prompt
    // é a economia.
    const texto = normalizar(SISTEMA_DO_BRIEF)
    const citados = TERMOS_QUE_EXIGEM_ORIGEM_HUMANA.filter((t) => texto.includes(t))

    expect(citados.length).toBeGreaterThanOrEqual(5)
  })

  it('pede as três origens e exige referência na decisão', () => {
    expect(SISTEMA_DO_BRIEF).toContain('prompt|decisao|proposto')
    expect(SISTEMA_DO_BRIEF).toContain('referencia')
  })
})

describe('o pedido enviado ao modelo', () => {
  it('leva o prompt do PI sem alterá-lo', () => {
    expect(promptDaGeracao('Um app de leituras.')).toContain('Um app de leituras.')
  })

  it('na primeira volta não fala em correção', () => {
    expect(promptDaGeracao('Um app.')).not.toContain('recusada')
  })

  it('na correção, diz **o quê** o validador recusou', () => {
    const pedido = promptDaGeracao('Um app.', [], ['A afirmação "a-1" não declara origem.'])

    // "Tente de novo" sem o motivo é jogar dado, e gasta a única rodada extra que há.
    expect(pedido).toContain('não declara origem')
  })

  it('leva as decisões do refinamento **com o id**', () => {
    // É o que torna a origem `decisao` verificável: o validador exige `referencia`, e o modelo
    // só consegue preenchê-la se souber qual id citar. Sem os ids, toda resposta do PI viraria
    // `proposto` — e a distinção entre "o PI decidiu" e "a IA inferiu" sumiria.
    const pedido = promptDaGeracao('Um app.', [
      { id: 'd-7', pergunta: 'Até onde vai a primeira versão?', resposta: 'Fatia vertical' }
    ])

    expect(pedido).toContain('d-7')
    expect(pedido).toContain('Fatia vertical')
  })

  it('sem decisões, não inventa a seção', () => {
    expect(promptDaGeracao('Um app.')).not.toContain('DECISÕES DO REFINAMENTO')
  })
})

describe('leitura da saída — o parser não conserta', () => {
  it('lê a saída bem formada', () => {
    const saida = lerSaidaDoModelo(VALIDO)

    expect(saida?.afirmacoes).toHaveLength(1)
    expect(saida?.pendencias[0]?.material).toBe(true)
  })

  it('tolera cerca de código, e só isso', () => {
    // Modelos produzem crases por hábito mesmo instruídos a não fazê-lo, e recusar por causa
    // delas gastaria a rodada de correção com um problema que não é de conteúdo.
    expect(lerSaidaDoModelo(CERCA + 'json\n' + VALIDO + '\n' + CERCA)?.afirmacoes).toHaveLength(1)
    expect(lerSaidaDoModelo(CERCA + '\n' + VALIDO + '\n' + CERCA)?.afirmacoes).toHaveLength(1)
  })

  it('recusa JSON malformado em vez de tentar recuperar', () => {
    expect(lerSaidaDoModelo('{afirmacoes: [')).toBeUndefined()
    expect(lerSaidaDoModelo('não sou json')).toBeUndefined()
  })

  it('recusa afirmação sem origem — não completa com um default', () => {
    // O ponto do arquivo: completar aqui inventaria a procedência que o critério 4 exige.
    const semOrigem = JSON.stringify({
      afirmacoes: [{ id: 'a-1', bloco: 'jornadas', texto: 'x' }],
      pendencias: []
    })

    expect(lerSaidaDoModelo(semOrigem)).toBeUndefined()
  })

  it('recusa origem que não existe no contrato', () => {
    const inventada = JSON.stringify({
      afirmacoes: [{ id: 'a-1', bloco: 'jornadas', texto: 'x', origem: 'modelo' }],
      pendencias: []
    })

    expect(lerSaidaDoModelo(inventada)).toBeUndefined()
  })

  it('recusa bloco fora do schema', () => {
    const bloco = JSON.stringify({
      afirmacoes: [{ id: 'a-1', bloco: 'inventado', texto: 'x', origem: 'prompt' }],
      pendencias: []
    })

    expect(lerSaidaDoModelo(bloco)).toBeUndefined()
  })

  it('uma entrada ruim invalida a saída inteira, não é descartada em silêncio', () => {
    // O brief precisa ser o que o modelo produziu, não o que sobrou depois de um filtro.
    const misto = JSON.stringify({
      afirmacoes: [
        { id: 'a-1', bloco: 'jornadas', texto: 'boa', origem: 'prompt' },
        { id: 'a-2', bloco: 'jornadas', texto: 'ruim' }
      ],
      pendencias: []
    })

    expect(lerSaidaDoModelo(misto)).toBeUndefined()
  })

  it('recusa pendência com "material" que não é booleano', () => {
    const ruim = JSON.stringify({
      afirmacoes: [],
      pendencias: [{ bloco: 'jornadas', pergunta: 'x', material: 'sim' }]
    })

    expect(lerSaidaDoModelo(ruim)).toBeUndefined()
  })

  it('pendências ausentes viram lista vazia — o campo é opcional na saída', () => {
    const semPendencias = JSON.stringify({
      afirmacoes: [{ id: 'a-1', bloco: 'jornadas', texto: 'x', origem: 'prompt' }]
    })

    expect(lerSaidaDoModelo(semPendencias)?.pendencias).toEqual([])
  })

  it('recusa quando afirmações não é lista', () => {
    expect(lerSaidaDoModelo('{"afirmacoes":"nenhuma"}')).toBeUndefined()
  })
})

describe('a instrução de sistema das perguntas', () => {
  it('é separada da do brief — as duas tarefas produzem formatos diferentes', () => {
    // Fundi-las faria uma instrução só tentar ensinar dois formatos de saída, e o modelo
    // escolheria um deles por conta própria.
    expect(SISTEMA_DAS_PERGUNTAS).not.toBe(SISTEMA_DO_BRIEF)
    expect(SISTEMA_DAS_PERGUNTAS).toContain('perguntas')
  })

  it('repete a proibição da invariante 9', () => {
    // Precisa repetir: uma pergunta inventada sobre consentimento é tão danosa quanto uma
    // afirmação inventada, porque a resposta do PI a ela viraria origem `decisao` e passaria
    // pelo validador do brief limpa.
    const texto = normalizar(SISTEMA_DAS_PERGUNTAS)
    const citados = TERMOS_QUE_EXIGEM_ORIGEM_HUMANA.filter((t) => texto.includes(t))

    expect(citados.length).toBeGreaterThanOrEqual(5)
  })

  it('declara o contrato das opções, não só o formato', () => {
    expect(SISTEMA_DAS_PERGUNTAS).toContain('impacto')
    expect(SISTEMA_DAS_PERGUNTAS).toContain('recomendada')
  })

  it('o pedido nomeia os blocos que faltam', () => {
    const pedido = promptDasPerguntas('Um app.', ['jornadas', 'integracoes'])

    expect(pedido).toContain('jornadas')
    expect(pedido).toContain('integracoes')
  })
})

describe('leitura das perguntas — o parser não conserta', () => {
  it('lê a saída bem formada', () => {
    const perguntas = lerPerguntasDoModelo(PERGUNTA_VALIDA)

    expect(perguntas).toHaveLength(1)
    expect(perguntas?.[0]?.opcoes).toHaveLength(2)
  })

  it('tolera cerca de código', () => {
    expect(lerPerguntasDoModelo(CERCA + 'json\n' + PERGUNTA_VALIDA + '\n' + CERCA)).toHaveLength(1)
  })

  it('recusa JSON malformado', () => {
    expect(lerPerguntasDoModelo('{perguntas: [')).toBeUndefined()
  })

  it('recusa bloco fora do schema', () => {
    const ruim = PERGUNTA_VALIDA.replace('escopo-e-metricas', 'inventado')

    expect(lerPerguntasDoModelo(ruim)).toBeUndefined()
  })

  it('recusa opção sem impacto — o campo é do contrato, não decoração', () => {
    const semImpacto = PERGUNTA_VALIDA.replace(
      '"impacto":"Entrega ponta a ponta, cobertura menor."',
      '"impacto":123'
    )

    expect(lerPerguntasDoModelo(semImpacto)).toBeUndefined()
  })

  it('uma pergunta ruim invalida a saída inteira', () => {
    const misto = JSON.stringify({
      perguntas: [
        ...(JSON.parse(PERGUNTA_VALIDA) as { perguntas: unknown[] }).perguntas,
        { bloco: 'jornadas' }
      ]
    })

    expect(lerPerguntasDoModelo(misto)).toBeUndefined()
  })

  it('recusa quando perguntas não é lista', () => {
    expect(lerPerguntasDoModelo('{"perguntas":"nenhuma"}')).toBeUndefined()
  })
})
