/**
 * O validador do roadmap gerado por IA (SPEC-Jornada-05).
 *
 * O que estes testes protegem, e cada um é um critério:
 *
 *  - **O DAG é conferido pelo validador da M8-F06, não por uma segunda checagem escrita aqui**
 *    (critério 1, decisão cravada da spec). Ciclo, dependência ausente e auto-dependência
 *    reprovam, e a mensagem nomeia os MVPs envolvidos — "há um ciclo" não é acionável.
 *  - **Toda origem é ancorada ou é `proposto`** (critério 2). `prd` e `arquitetura` exigem uma
 *    referência que **existe** na revisão aceita; `proposto` exige a ausência dela.
 *  - **A SPEC nasce com pergunta aberta, e sem ela reprova** (critério 4). É a assimetria que a
 *    spec crava: uma SPEC sem pergunta afirma que não há nada a decidir.
 *  - **O MVP elegível é o sem dependência pendente** (critério 3) — é essa lista que o PI vê.
 */

import { describe, expect, it } from 'vitest'
import type { ConteudoDoRoadmap, MvpGerado, SpecGerada } from './roadmap-gerado'
import {
  comoRoadmap,
  comoMvps,
  mvpsElegiveis,
  perguntasSemResposta,
  propostosDoRoadmap,
  responderPerguntaDaSpec,
  specPodeSerAceita,
  validarRoadmapGerado
} from './roadmap-gerado'
import { validarDag } from './roadmap'

const CONTEXTO = {
  afirmacoesDoPrd: ['a-1', 'a-2'],
  afirmacoesDaArquitetura: ['arq-1']
}

function mvp(over: Partial<MvpGerado> = {}): MvpGerado {
  return {
    id: 'mvp-1',
    numero: 1,
    titulo: 'Cadastro',
    tese: 'Cadastrar clientes.',
    resultado: 'Um cliente cadastrado aparece na lista.',
    dependeDe: [],
    origem: 'prd',
    referencia: 'a-1',
    fatias: [{ id: 'f-1', numero: 1, titulo: 'Formulário', origem: 'prd', referencia: 'a-1' }],
    ...over
  }
}

const SPEC: SpecGerada = {
  fatiaId: 'f-1',
  titulo: 'Formulário',
  objetivo: 'Cadastrar um cliente.',
  fluxo: ['Abrir', 'Salvar'],
  regras: ['Nome obrigatório'],
  criteriosDeAceite: ['Salvar sem nome mostra erro'],
  testes: ['Unitário da validação'],
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

function conteudo(mvps: readonly MvpGerado[], spec?: SpecGerada): ConteudoDoRoadmap {
  return { projectId: 'p-1', mvps, ...(spec === undefined ? {} : { spec }) }
}

function recusas(c: ConteudoDoRoadmap): readonly string[] {
  return validarRoadmapGerado(c, CONTEXTO).problemas.map((p) => p.recusa)
}

describe('validarRoadmapGerado — o grafo', () => {
  it('aceita um roadmap com dependência válida', () => {
    const dois = mvp({
      id: 'mvp-2',
      numero: 2,
      dependeDe: ['mvp-1'],
      origem: 'proposto',
      fatias: [{ id: 'f-2', numero: 1, titulo: 'Exportação', origem: 'proposto' }]
    })
    delete (dois as { referencia?: string }).referencia

    expect(validarRoadmapGerado(conteudo([mvp(), dois]), CONTEXTO).valido).toBe(true)
  })

  it('ciclo reprova, e a mensagem nomeia os MVPs envolvidos', () => {
    const a = mvp({ id: 'mvp-1', dependeDe: ['mvp-2'] })
    const b = mvp({ id: 'mvp-2', numero: 2, titulo: 'Relatórios', dependeDe: ['mvp-1'] })

    const problemas = validarRoadmapGerado(conteudo([a, b]), CONTEXTO).problemas
    const ciclo = problemas.find((p) => p.recusa === 'dag-invalido')

    expect(ciclo).toBeDefined()
    expect(ciclo?.mensagem).toContain('Cadastro')
    expect(ciclo?.mensagem).toContain('Relatórios')
  })

  it('dependência ausente reprova', () => {
    expect(recusas(conteudo([mvp({ dependeDe: ['mvp-fantasma'] })]))).toContain('dag-invalido')
  })

  it('auto-dependência reprova', () => {
    expect(recusas(conteudo([mvp({ dependeDe: ['mvp-1'] })]))).toContain('dag-invalido')
  })

  it('delega ao validador da M8-F06 em vez de repetir a detecção', () => {
    // O mesmo grafo, medido pelas duas pontas: se o validador desta fatia tivesse detecção
    // própria, ela poderia divergir da que o `STATUS.md` e a projeção usam.
    const a = mvp({ id: 'mvp-1', dependeDe: ['mvp-2'] })
    const b = mvp({ id: 'mvp-2', numero: 2, dependeDe: ['mvp-1'] })

    const doDominio = validarDag(comoMvps([a, b]))
    const daFatia = validarRoadmapGerado(conteudo([a, b]), CONTEXTO).problemas.filter(
      (p) => p.recusa === 'dag-invalido'
    )

    expect(daFatia.map((p) => p.mensagem)).toEqual(doDominio.map((p) => p.mensagem))
  })

  it('ids repetidos reprovam antes de o grafo ser lido', () => {
    const problemas = recusas(conteudo([mvp(), mvp()]))

    expect(problemas).toContain('ids-repetidos')
    // Com ids repetidos, o grafo que o validador veria não é o que o modelo escreveu.
    expect(problemas).not.toContain('dag-invalido')
  })
})

describe('validarRoadmapGerado — a origem (critério 2)', () => {
  it('origem prd sem referência reprova', () => {
    const sem = mvp()
    delete (sem as { referencia?: string }).referencia

    expect(recusas(conteudo([sem]))).toContain('origem-sem-referencia')
  })

  it('referência que não existe no PRD reprova', () => {
    expect(recusas(conteudo([mvp({ referencia: 'a-99' })]))).toContain('referencia-inexistente')
  })

  it('origem arquitetura cita a arquitetura, não o PRD', () => {
    expect(recusas(conteudo([mvp({ origem: 'arquitetura', referencia: 'a-1' })]))).toContain(
      'referencia-inexistente'
    )

    expect(
      validarRoadmapGerado(
        conteudo([mvp({ origem: 'arquitetura', referencia: 'arq-1' })]),
        CONTEXTO
      ).valido
    ).toBe(true)
  })

  it('proposto com referência reprova: inferência não tem fonte a citar', () => {
    expect(recusas(conteudo([mvp({ origem: 'proposto', referencia: 'a-1' })]))).toContain(
      'proposto-com-referencia'
    )
  })

  it('a regra vale para a fatia, não só para o MVP', () => {
    const comFatiaSolta = mvp({
      fatias: [{ id: 'f-1', numero: 1, titulo: 'Formulário', origem: 'prd', referencia: 'a-99' }]
    })

    expect(recusas(conteudo([comFatiaSolta]))).toContain('referencia-inexistente')
  })
})

describe('validarRoadmapGerado — a forma do MVP', () => {
  it('roadmap sem MVP reprova', () => {
    expect(recusas(conteudo([]))).toContain('sem-mvp')
  })

  it('MVP sem tese, sem resultado ou sem título reprova cada um por seu motivo', () => {
    const vazio = mvp({ titulo: '  ', tese: '', resultado: '   ' })
    const problemas = recusas(conteudo([vazio]))

    expect(problemas).toContain('mvp-sem-titulo')
    expect(problemas).toContain('mvp-sem-tese')
    expect(problemas).toContain('mvp-sem-resultado')
  })

  it('MVP sem fatia reprova: sem checklist o SLICE_ENTRY não teria objeto', () => {
    expect(recusas(conteudo([mvp({ fatias: [] })]))).toContain('mvp-sem-fatia')
  })

  it('fatia sem título reprova', () => {
    const comFatiaSemTitulo = mvp({
      fatias: [{ id: 'f-1', numero: 1, titulo: '   ', origem: 'proposto' }]
    })

    expect(recusas(conteudo([comFatiaSemTitulo]))).toContain('fatia-sem-titulo')
  })
})

describe('validarRoadmapGerado — as invariantes de texto', () => {
  it('requisito legal inventado reprova (invariante 9)', () => {
    const inventado = mvp({ tese: 'Coletar consentimento LGPD do cliente.' })
    expect(recusas(conteudo([inventado]))).toContain('requisito-inventado')
  })

  it('processo deste repositório no roadmap gerado reprova', () => {
    const vazado = mvp({ resultado: 'A fatia entra em proplan:backlog.' })
    expect(recusas(conteudo([vazado]))).toContain('processo-de-outro-projeto')
  })

  it('a varredura cobre a SPEC, não só o roadmap', () => {
    const spec: SpecGerada = { ...SPEC, regras: ['Exibir a política de privacidade no rodapé'] }
    expect(recusas(conteudo([mvp()], spec))).toContain('requisito-inventado')
  })
})

describe('validarRoadmapGerado — a SPEC (critério 4)', () => {
  it('SPEC completa passa', () => {
    expect(validarRoadmapGerado(conteudo([mvp()], SPEC), CONTEXTO).valido).toBe(true)
  })

  it('SPEC sem pergunta aberta reprova', () => {
    expect(recusas(conteudo([mvp()], { ...SPEC, perguntas: [] }))).toContain('spec-sem-pergunta')
  })

  it('SPEC sem critério de aceite reprova', () => {
    expect(recusas(conteudo([mvp()], { ...SPEC, criteriosDeAceite: [] }))).toContain(
      'spec-sem-criterio'
    )
  })

  it('SPEC sem objetivo reprova', () => {
    expect(recusas(conteudo([mvp()], { ...SPEC, objetivo: '  ' }))).toContain('spec-sem-objetivo')
  })

  it('pergunta com uma opção só reprova: uma opção não é escolha', () => {
    const uma: SpecGerada = {
      ...SPEC,
      perguntas: [{ ...SPEC.perguntas[0]!, opcoes: [SPEC.perguntas[0]!.opcoes[0]!] }]
    }

    expect(recusas(conteudo([mvp()], uma))).toContain('pergunta-fora-do-contrato')
  })

  it('opção sem impacto reprova: sem trade-off não há o que comparar', () => {
    const semImpacto: SpecGerada = {
      ...SPEC,
      perguntas: [
        {
          ...SPEC.perguntas[0]!,
          opcoes: [
            { id: 'a', rotulo: 'Sim', impacto: '   ' },
            { id: 'b', rotulo: 'Não', impacto: 'Rápido.' }
          ]
        }
      ]
    }

    expect(recusas(conteudo([mvp()], semImpacto))).toContain('pergunta-fora-do-contrato')
  })

  it('recomendada fora das opções reprova', () => {
    const solta: SpecGerada = {
      ...SPEC,
      perguntas: [{ ...SPEC.perguntas[0]!, recomendada: 'z' }]
    }

    expect(recusas(conteudo([mvp()], solta))).toContain('pergunta-sem-recomendada')
  })
})

describe('mvpsElegiveis — critério 3', () => {
  it('MVP sem dependência é elegível', () => {
    expect(mvpsElegiveis([mvp()]).map((m) => m.id)).toEqual(['mvp-1'])
  })

  it('MVP com dependência aberta não é elegível', () => {
    const dependente = mvp({ id: 'mvp-2', dependeDe: ['mvp-1'] })
    expect(mvpsElegiveis([mvp(), dependente]).map((m) => m.id)).toEqual(['mvp-1'])
  })

  it('a dependência concluída libera o dependente', () => {
    const dependente = mvp({ id: 'mvp-2', dependeDe: ['mvp-1'] })
    expect(mvpsElegiveis([mvp(), dependente], ['mvp-1']).map((m) => m.id)).toEqual([
      'mvp-1',
      'mvp-2'
    ])
  })
})

describe('as perguntas e o aceite da SPEC', () => {
  it('pergunta sem resposta bloqueia o aceite', () => {
    expect(perguntasSemResposta(SPEC)).toHaveLength(1)
    expect(specPodeSerAceita(SPEC)).toBe(false)
  })

  it('resposta vazia continua sendo pergunta aberta', () => {
    const branca: SpecGerada = {
      ...SPEC,
      perguntas: [{ ...SPEC.perguntas[0]!, resposta: '   ' }]
    }

    expect(specPodeSerAceita(branca)).toBe(false)
  })

  it('respondida libera o aceite', () => {
    const respondida = responderPerguntaDaSpec(conteudo([mvp()], SPEC), 'p-1', 'a')
    expect(specPodeSerAceita(respondida.spec)).toBe(true)
  })

  it('sem SPEC não há o que aceitar', () => {
    expect(specPodeSerAceita(undefined)).toBe(false)
  })

  it('responder pergunta desconhecida devolve o conteúdo intacto', () => {
    const antes = conteudo([mvp()], SPEC)
    expect(responderPerguntaDaSpec(antes, 'p-99', 'a')).toBe(antes)
  })

  it('responder sem SPEC devolve o conteúdo intacto', () => {
    const antes = conteudo([mvp()])
    expect(responderPerguntaDaSpec(antes, 'p-1', 'a')).toBe(antes)
  })

  it('responder não edita a revisão anterior', () => {
    const antes = conteudo([mvp()], SPEC)
    responderPerguntaDaSpec(antes, 'p-1', 'a')

    expect(antes.spec?.perguntas[0]?.resposta).toBeUndefined()
  })
})

describe('propostosDoRoadmap', () => {
  it('lista só o que a IA inferiu — é o que o gate separa', () => {
    const inferido = mvp({
      id: 'mvp-2',
      origem: 'proposto',
      fatias: [{ id: 'f-2', numero: 1, titulo: 'Exportação', origem: 'proposto' }]
    })
    delete (inferido as { referencia?: string }).referencia

    expect(propostosDoRoadmap(conteudo([mvp(), inferido])).map((m) => m.id)).toEqual(['mvp-2'])
  })
})

describe('comoRoadmap — a projeção que o STATUS lê', () => {
  it('deriva o caminho da SPEC do título do MVP e da fatia', () => {
    const projecao = comoRoadmap(conteudo([mvp()]), 'docs/spec')
    expect(projecao.slices[0]?.specSlug).toBe('docs/spec/spec-cadastro-01-formulario.md')
  })

  it('marca detalhada só a fatia que ganhou SPEC', () => {
    const comDuas = mvp({
      fatias: [
        { id: 'f-1', numero: 1, titulo: 'Formulário', origem: 'proposto' },
        { id: 'f-2', numero: 2, titulo: 'Lista', origem: 'proposto' }
      ]
    })

    const projecao = comoRoadmap(conteudo([comDuas], SPEC), 'docs/spec')
    expect(projecao.slices.map((s) => s.detalhada)).toEqual([true, false])
  })

  it('sem SPEC, nenhuma fatia é detalhada', () => {
    const projecao = comoRoadmap(conteudo([mvp()]), 'docs/spec')
    expect(projecao.slices.every((s) => !s.detalhada)).toBe(true)
  })

  it('todo MVP projetado nasce proposto: promover é o gate, não a geração', () => {
    const projecao = comoRoadmap(conteudo([mvp()]), 'docs/spec')
    expect(projecao.mvps.every((m) => m.estado === 'proposto')).toBe(true)
  })

  it('título longo não produz caminho ilimitado', () => {
    const longo = mvp({
      titulo: 'a'.repeat(200),
      fatias: [{ id: 'f-1', numero: 1, titulo: 'b'.repeat(200), origem: 'proposto' }]
    })
    const caminho = comoRoadmap(conteudo([longo]), 'docs/spec').slices[0]?.specSlug ?? ''

    expect(caminho.length).toBeLessThan(120)
  })
})
