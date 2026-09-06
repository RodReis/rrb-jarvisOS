/**
 * O validador do PRD, do Landscape e da Convention (SPEC-Jornada-03).
 *
 * O que estes testes protegem é a diferença entre "o modelo disse" e "algo sustenta": cada
 * critério da spec vira aqui uma saída que o validador **recusa**, e é a recusa que é o
 * comportamento — um validador que só aprova o caminho feliz não protege nada.
 */

import { describe, expect, it } from 'vitest'
import type { AfirmacaoDoPrd, ConteudoDoPrd, ContextoDaValidacao } from './prd'
import {
  cortarPropostoDoPrd,
  landscapePendente,
  podeAceitarPrd,
  contradicaoGravada,
  propostosDoDocumento,
  renderizarDocumentoDoPrd,
  validarPrd
} from './prd'

const CONTEXTO: ContextoDaValidacao = {
  afirmacoesDoBrief: ['b-1', 'b-2'],
  urlsComEvidencia: ['https://exemplo.dev/a', 'https://exemplo.dev/b']
}

function conteudo(afirmacoes: readonly AfirmacaoDoPrd[]): ConteudoDoPrd {
  return { projectId: 'p1', afirmacoes, contradicoes: [] }
}

const DO_BRIEF: AfirmacaoDoPrd = {
  id: 'a-1',
  documento: 'PRD',
  secao: 'Escopo',
  texto: 'O produto organiza tarefas por projeto.',
  origem: 'brief',
  referencia: 'b-1'
}

describe('validarPrd — origem obrigatória (critério 1)', () => {
  it('aceita afirmação do PRD ancorada numa afirmação existente do brief', () => {
    const r = validarPrd(conteudo([DO_BRIEF]), CONTEXTO)

    expect(r.valido).toBe(true)
    expect(r.problemas).toHaveLength(0)
  })

  it('recusa afirmação sem origem', () => {
    // A origem ausente chega do modelo como campo faltando; o cast reproduz exatamente o que o
    // parser deixaria passar se ele fosse tolerante — e é por isso que o validador existe.
    const semOrigem = { ...DO_BRIEF, origem: undefined } as unknown as AfirmacaoDoPrd
    const r = validarPrd(conteudo([semOrigem]), CONTEXTO)

    expect(r.valido).toBe(false)
    expect(r.problemas[0]?.recusa).toBe('origem-ausente')
  })

  it('recusa origem desconhecida em vez de tratá-la como proposto', () => {
    const inventada = { ...DO_BRIEF, origem: 'inventada' } as unknown as AfirmacaoDoPrd
    const r = validarPrd(conteudo([inventada]), CONTEXTO)

    expect(r.valido).toBe(false)
    expect(r.problemas[0]?.recusa).toBe('origem-desconhecida')
  })

  it('recusa origem brief sem referência: a âncora é o que torna a origem checável', () => {
    const semAncora = { ...DO_BRIEF, referencia: undefined }
    const r = validarPrd(conteudo([semAncora]), CONTEXTO)

    expect(r.valido).toBe(false)
    expect(r.problemas[0]?.recusa).toBe('referencia-ausente')
  })

  it('recusa âncora que não existe na revisão aceita do brief', () => {
    const r = validarPrd(conteudo([{ ...DO_BRIEF, referencia: 'b-99' }]), CONTEXTO)

    expect(r.valido).toBe(false)
    expect(r.problemas[0]?.recusa).toBe('ancora-inexistente')
  })

  it('devolve todos os problemas, não o primeiro', () => {
    const r = validarPrd(
      conteudo([
        { ...DO_BRIEF, id: 'a-1', referencia: 'b-99' },
        { ...DO_BRIEF, id: 'a-2', referencia: undefined }
      ]),
      CONTEXTO
    )

    expect(r.problemas).toHaveLength(2)
  })
})

describe('validarPrd — Landscape exige evidência (critério 2)', () => {
  const SOBRE_TERCEIRO: AfirmacaoDoPrd = {
    id: 'l-1',
    documento: 'LANDSCAPE',
    secao: 'Alternativas',
    texto: 'A ferramenta X cobra por assento.',
    origem: 'evidencia',
    fontes: ['https://exemplo.dev/a']
  }

  it('aceita síntese que cita fonte extraída', () => {
    expect(validarPrd(conteudo([SOBRE_TERCEIRO]), CONTEXTO).valido).toBe(true)
  })

  it('recusa afirmação de evidência sem nenhuma fonte', () => {
    const r = validarPrd(conteudo([{ ...SOBRE_TERCEIRO, fontes: [] }]), CONTEXTO)

    expect(r.valido).toBe(false)
    expect(r.problemas[0]?.recusa).toBe('landscape-sem-evidencia')
  })

  it('recusa fonte fabricada: URL fora do conjunto extraído', () => {
    const r = validarPrd(
      conteudo([{ ...SOBRE_TERCEIRO, fontes: ['https://inventada.example/x'] }]),
      CONTEXTO
    )

    expect(r.valido).toBe(false)
    expect(r.problemas[0]?.recusa).toBe('fonte-nao-extraida')
  })

  it('recusa origem brief no Landscape: o PI não é fonte sobre o mercado', () => {
    const r = validarPrd(
      conteudo([{ ...DO_BRIEF, id: 'l-2', documento: 'LANDSCAPE', secao: 'Cenário' }]),
      CONTEXTO
    )

    expect(r.valido).toBe(false)
    expect(r.problemas[0]?.recusa).toBe('landscape-sem-evidencia')
  })

  it('admite hipótese como proposto — a spec permite, marcada como tal', () => {
    const hipotese: AfirmacaoDoPrd = {
      id: 'l-3',
      documento: 'LANDSCAPE',
      secao: 'Incertezas',
      texto: 'É possível que o público prefira uma ferramenta local.',
      origem: 'proposto'
    }

    expect(validarPrd(conteudo([hipotese]), CONTEXTO).valido).toBe(true)
  })
})

describe('validarPrd — invariante 9 e Convention (critério 5)', () => {
  it('recusa requisito legal inferido pelo modelo', () => {
    const inventado: AfirmacaoDoPrd = {
      id: 'a-9',
      documento: 'PRD',
      secao: 'Restrições',
      texto: 'O produto exige consentimento explícito para dados pessoais.',
      origem: 'proposto'
    }

    const r = validarPrd(conteudo([inventado]), CONTEXTO)

    expect(r.valido).toBe(false)
    expect(r.problemas[0]?.recusa).toBe('requisito-sem-origem-humana')
  })

  it('aceita o mesmo requisito quando ele vem do brief', () => {
    const doBrief: AfirmacaoDoPrd = {
      id: 'a-9',
      documento: 'PRD',
      secao: 'Restrições',
      texto: 'O produto exige consentimento explícito para dados pessoais.',
      origem: 'brief',
      referencia: 'b-2'
    }

    expect(validarPrd(conteudo([doBrief]), CONTEXTO).valido).toBe(true)
  })

  it('recusa regra de outro projeto na Convention, mesmo vinda do brief', () => {
    const importada: AfirmacaoDoPrd = {
      id: 'c-1',
      documento: 'CONVENTION',
      secao: 'Estados',
      texto: 'Uma issue em proplan:doing está em andamento.',
      origem: 'brief',
      referencia: 'b-1'
    }

    const r = validarPrd(conteudo([importada]), CONTEXTO)

    expect(r.valido).toBe(false)
    expect(r.problemas[0]?.recusa).toBe('regra-de-outro-projeto')
  })

  it('casa o termo sem depender de acento ou caixa', () => {
    const variante: AfirmacaoDoPrd = {
      id: 'c-2',
      documento: 'CONVENTION',
      secao: 'Vocabulário',
      texto: 'Toda spec precisa estar APROVADA-PI antes de virar código.',
      origem: 'proposto'
    }

    expect(validarPrd(conteudo([variante]), CONTEXTO).problemas[0]?.recusa).toBe(
      'regra-de-outro-projeto'
    )
  })
})

describe('gate do aceite (critérios 4, 6 e 7)', () => {
  it('contradição não resolvida bloqueia o aceite', () => {
    const com = {
      ...conteudo([DO_BRIEF]),
      contradicoes: [
        contradicaoGravada({
          id: 'c-1',
          afirmacoes: ['a-1', 'b-2'],
          pergunta: 'Qual vale?',
          recomendacao: 'A de b-2.'
        })
      ]
    }

    expect(podeAceitarPrd(com)).toBe(false)
  })

  it('Landscape bloqueado NÃO impede o aceite — decisão do PI de 2026-09-03', () => {
    const com: ConteudoDoPrd = {
      ...conteudo([DO_BRIEF]),
      bloqueioDoLandscape: {
        causa: 'sem-termo-de-pesquisa',
        evidencia: 'Nenhum termo confirmado.',
        tentativas: 0,
        porQueNaoSeguir: 'Não há fonte a citar.',
        retomada: 'Confirme um termo.'
      }
    }

    expect(landscapePendente(com)).toBe(true)
    expect(podeAceitarPrd(com)).toBe(true)
  })

  it('lista os propostos por documento, não num monte só', () => {
    const c = conteudo([
      DO_BRIEF,
      { id: 'p-1', documento: 'PRD', secao: 'Escopo', texto: 'Inferido.', origem: 'proposto' },
      {
        id: 'p-2',
        documento: 'CONVENTION',
        secao: 'Entidades',
        texto: 'Inferido.',
        origem: 'proposto'
      }
    ])

    expect(propostosDoDocumento(c, 'PRD').map((a) => a.id)).toEqual(['p-1'])
    expect(propostosDoDocumento(c, 'CONVENTION').map((a) => a.id)).toEqual(['p-2'])
    expect(propostosDoDocumento(c, 'LANDSCAPE')).toHaveLength(0)
  })

  it('cortar só remove proposto: um id de outra origem não apaga nada', () => {
    const c = conteudo([DO_BRIEF])

    expect(cortarPropostoDoPrd(c, 'a-1').afirmacoes).toHaveLength(1)
  })
})

describe('renderizarDocumentoDoPrd', () => {
  it('escreve a marca de origem junto de cada afirmação', () => {
    const texto = renderizarDocumentoDoPrd('PRD', 'Projeto', [DO_BRIEF])

    expect(texto).toContain('O produto organiza tarefas por projeto.')
    expect(texto).toContain('<!-- origem: brief · b-1 -->')
  })

  it('cita as URLs na marca de origem da evidência', () => {
    const texto = renderizarDocumentoDoPrd('LANDSCAPE', 'Projeto', [
      {
        id: 'l-1',
        documento: 'LANDSCAPE',
        secao: 'Cenário',
        texto: 'O mercado tem alternativas pagas.',
        origem: 'evidencia',
        fontes: ['https://exemplo.dev/a']
      }
    ])

    expect(texto).toContain('<!-- origem: evidencia · https://exemplo.dev/a -->')
  })

  it('declara o bloqueio dentro do arquivo, com a retomada', () => {
    const texto = renderizarDocumentoDoPrd('LANDSCAPE', 'Projeto', [], {
      causa: 'sem-termo-de-pesquisa',
      evidencia: 'Nenhum termo confirmado.',
      tentativas: 0,
      porQueNaoSeguir: 'Não há fonte a citar.',
      retomada: 'Confirme um termo e gere de novo.'
    })

    expect(texto).toContain('Pesquisa bloqueada')
    expect(texto).toContain('Confirme um termo e gere de novo.')
  })

  it('seção sem afirmação diz que está vazia, em vez de sumir', () => {
    const texto = renderizarDocumentoDoPrd('CONVENTION', 'Projeto', [])

    expect(texto).toContain('## Entidades')
    expect(texto).toContain('_Sem conteúdo registrado nesta revisão._')
  })
})

describe('contradicaoGravada — revisões anteriores à emenda E1 continuam respondíveis', () => {
  it('a forma nova passa intacta', () => {
    const nova = {
      id: 'c-1',
      etapa: 'prd',
      afirmacoes: ['a-1'],
      titulo: 'T',
      enunciado: 'E?',
      opcoes: [{ id: 'a', rotulo: 'A', impacto: 'i' }],
      recomendada: 'a',
      justificativa: 'j',
      aceitaTextoLivre: false,
      delegavel: true
    }

    expect(contradicaoGravada(nova)).toEqual(nova)
  })

  it('a forma antiga vira pergunta de texto livre, sem opções e sem delegação', () => {
    const antiga = {
      id: 'c-1',
      afirmacoes: ['a-1', 'b-1'],
      pergunta: 'O produto é local ou na nuvem?',
      recomendacao: 'Local, como o brief diz.'
    }

    const lida = contradicaoGravada(antiga)

    expect(lida.enunciado).toBe('O produto é local ou na nuvem?')
    expect(lida.justificativa).toBe('Local, como o brief diz.')
    expect(lida.opcoes).toEqual([])
    expect(lida.aceitaTextoLivre).toBe(true)
    expect(lida.delegavel).toBe(false)
    expect(lida.etapa).toBe('prd')
  })
})
