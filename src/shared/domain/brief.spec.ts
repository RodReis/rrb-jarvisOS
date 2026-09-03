/**
 * O brief e o validador de saída (SPEC-Jornada-02, § Testes).
 *
 * A spec pede *"unitários do validador de saída (origem, invariante 9, schema)"*. O que estes
 * testes protegem é o que **não** pode acontecer quando o texto vem de um modelo:
 *
 *  - **Critério 4:** nenhuma afirmação existe sem origem, e origem desconhecida é recusa — nunca
 *    um default para o lado permissivo.
 *  - **Critério 5:** cortar um `proposto` não toca afirmação de outra origem.
 *  - **Invariante 9:** requisito legal, de consentimento ou de classificação de domínio não
 *    entra por inferência do modelo. Aqui isso é verificado em runtime, não num teste sobre
 *    catálogo revisado.
 */

import { describe, expect, it } from 'vitest'
import type { Afirmacao, Brief } from './brief'
import {
  BLOCOS_DO_BRIEF,
  BLOCOS_PRE_PREENCHIDOS,
  TERMOS_QUE_EXIGEM_ORIGEM_HUMANA,
  blocosEmAberto,
  cortarProposto,
  isBlocoDoBrief,
  isOrigemDaAfirmacao,
  isPrePreenchido,
  podeAceitar,
  propostos,
  refinamentoCompleto,
  validarBrief
} from './brief'

function afirmacao(over: Partial<Afirmacao> = {}): Afirmacao {
  return {
    id: 'a-1',
    bloco: 'problema-usuarios-resultado',
    texto: 'O produto atende operadores de plataforma.',
    origem: 'prompt',
    ...over
  }
}

function brief(over: Partial<Brief> = {}): Brief {
  return {
    projectId: 'p-1',
    afirmacoes: [afirmacao()],
    pendencias: [],
    ...over
  }
}

describe('contrato do schema', () => {
  it('tem os dez blocos do design §9.2', () => {
    expect(BLOCOS_DO_BRIEF).toHaveLength(10)
  })

  it('reconhece bloco do enum e recusa qualquer outra string', () => {
    expect(isBlocoDoBrief('jornadas')).toBe(true)
    expect(isBlocoDoBrief('bloco-inventado')).toBe(false)
    expect(isBlocoDoBrief(undefined)).toBe(false)
  })

  it('marca como pré-preenchidos só os blocos que o app já sabe', () => {
    // Decisão do PI: identidade sai da criação do projeto, política sai dos defaults. Perguntar
    // o que o app já sabe seria fricção sem informação nova.
    for (const bloco of BLOCOS_DO_BRIEF) {
      expect(isPrePreenchido(bloco)).toBe(BLOCOS_PRE_PREENCHIDOS.includes(bloco))
    }
  })

  it('reconhece as três origens e recusa qualquer outra', () => {
    expect(isOrigemDaAfirmacao('prompt')).toBe(true)
    expect(isOrigemDaAfirmacao('decisao')).toBe(true)
    expect(isOrigemDaAfirmacao('proposto')).toBe(true)
    // Não existe origem "modelo": é a mesma ausência deliberada da M8-F04.
    expect(isOrigemDaAfirmacao('modelo')).toBe(false)
  })
})

describe('origem obrigatória (critério 4)', () => {
  it('aceita um brief em que toda afirmação declara origem', () => {
    expect(validarBrief(brief()).valido).toBe(true)
  })

  it('recusa afirmação sem origem', () => {
    const sem = { ...afirmacao(), origem: undefined } as unknown as Afirmacao
    const r = validarBrief(brief({ afirmacoes: [sem] }))

    expect(r.valido).toBe(false)
    expect(r.problemas[0]?.recusa).toBe('origem-ausente')
  })

  it('recusa origem desconhecida em vez de cair no lado permissivo', () => {
    // Fail closed: um valor que o validador não reconhece pode ser exatamente o que alguém
    // inventou para escapar da regra.
    const estranha = { ...afirmacao(), origem: 'modelo' } as unknown as Afirmacao
    const r = validarBrief(brief({ afirmacoes: [estranha] }))

    expect(r.valido).toBe(false)
    expect(r.problemas[0]?.recusa).toBe('origem-desconhecida')
  })

  it('recusa `decisao` sem referência — afirmação órfã não é rastreável', () => {
    const orfa = afirmacao({ origem: 'decisao' })
    const r = validarBrief(brief({ afirmacoes: [orfa] }))

    expect(r.valido).toBe(false)
    expect(r.problemas.map((p) => p.recusa)).toContain('referencia-ausente')
  })

  it('aceita `decisao` quando a referência aponta para a decisão', () => {
    const ok = afirmacao({ origem: 'decisao', referencia: 'd-42' })
    expect(validarBrief(brief({ afirmacoes: [ok] })).valido).toBe(true)
  })

  it('recusa bloco fora do schema e texto vazio', () => {
    const ruim = afirmacao({ bloco: 'inventado' as never, texto: '   ' })
    const r = validarBrief(brief({ afirmacoes: [ruim] }))

    expect(r.problemas.map((p) => p.recusa)).toContain('bloco-desconhecido')
    expect(r.problemas.map((p) => p.recusa)).toContain('texto-vazio')
  })

  it('reporta todos os problemas, não só o primeiro', () => {
    // Corrigir a saída inteira numa rodada em vez de uma chamada de modelo por defeito.
    const r = validarBrief({
      projectId: 'p-1',
      afirmacoes: [
        afirmacao({ id: 'a-1', origem: 'decisao' }),
        afirmacao({ id: 'a-2', texto: '' })
      ],
      pendencias: []
    })

    expect(r.problemas.length).toBeGreaterThanOrEqual(2)
  })
})

describe('invariante 9 em runtime — requisito não é inferido', () => {
  it.each(TERMOS_QUE_EXIGEM_ORIGEM_HUMANA)('recusa "%s" com origem proposto', (termo) => {
    const inventada = afirmacao({
      origem: 'proposto',
      texto: `O sistema precisa tratar ${termo} desde o início.`
    })
    const r = validarBrief(brief({ afirmacoes: [inventada] }))

    expect(r.valido).toBe(false)
    expect(r.problemas.map((p) => p.recusa)).toContain('requisito-sem-origem-humana')
  })

  it('aceita o mesmo texto quando veio do prompt do PI', () => {
    // A regra não é sobre a palavra: é sobre **quem** a disse. O PI pode exigir LGPD; o modelo
    // não pode inferi-la.
    const doPi = afirmacao({ origem: 'prompt', texto: 'O sistema precisa atender à LGPD.' })
    expect(validarBrief(brief({ afirmacoes: [doPi] })).valido).toBe(true)
  })

  it('aceita o mesmo texto quando veio de uma decisão do PI', () => {
    const decidido = afirmacao({
      origem: 'decisao',
      referencia: 'd-7',
      texto: 'Consentimento explícito por usuário.'
    })
    expect(validarBrief(brief({ afirmacoes: [decidido] })).valido).toBe(true)
  })

  it('pega o termo com acento e em maiúsculas', () => {
    const disfarcada = afirmacao({
      origem: 'proposto',
      texto: 'Política de Privacidade obrigatória.'
    })
    expect(validarBrief(brief({ afirmacoes: [disfarcada] })).valido).toBe(false)
  })
})

describe('corte de proposto no gate (critério 5)', () => {
  const comTres = brief({
    afirmacoes: [
      afirmacao({ id: 'a-1', origem: 'prompt' }),
      afirmacao({ id: 'a-2', origem: 'proposto' }),
      afirmacao({ id: 'a-3', origem: 'decisao', referencia: 'd-1' })
    ]
  })

  it('lista só os propostos para o PI cortar item a item', () => {
    expect(propostos(comTres).map((a) => a.id)).toEqual(['a-2'])
  })

  it('cortar um proposto não altera afirmação de outra origem', () => {
    const depois = cortarProposto(comTres, 'a-2')

    expect(depois.afirmacoes.map((a) => a.id)).toEqual(['a-1', 'a-3'])
  })

  it('id de outra origem não corta nada — o brief volta igual', () => {
    // Sem esta guarda, um id errado apagaria em silêncio uma afirmação do PI.
    const depois = cortarProposto(comTres, 'a-1')

    expect(depois.afirmacoes.map((a) => a.id)).toEqual(['a-1', 'a-2', 'a-3'])
  })

  it('id inexistente é inócuo', () => {
    expect(cortarProposto(comTres, 'a-99').afirmacoes).toHaveLength(3)
  })
})

describe('pendências e fim do refinamento', () => {
  it('pendência material bloqueia o aceite', () => {
    const b = brief({
      pendencias: [{ bloco: 'dominio-e-dados', pergunta: 'Qual base?', material: true }]
    })
    expect(podeAceitar(b)).toBe(false)
  })

  it('pendência não material entra como aberta e não bloqueia', () => {
    const b = brief({
      pendencias: [{ bloco: 'riscos-e-decisoes-abertas', pergunta: 'Qual SLA?', material: false }]
    })
    expect(podeAceitar(b)).toBe(true)
  })

  it('lista os blocos que ainda não têm afirmação nem pendência', () => {
    const abertos = blocosEmAberto(brief())

    expect(abertos).not.toContain('problema-usuarios-resultado')
    expect(abertos).toHaveLength(BLOCOS_DO_BRIEF.length - 1)
  })

  it('o refinamento termina por cobertura, não por contagem de perguntas', () => {
    const completo = brief({
      afirmacoes: BLOCOS_DO_BRIEF.map((bloco, i) => afirmacao({ id: `a-${i}`, bloco }))
    })

    expect(refinamentoCompleto(completo)).toBe(true)
    expect(refinamentoCompleto(brief())).toBe(false)
  })

  it('pendência declarada cobre o bloco tanto quanto uma afirmação', () => {
    const b = brief({
      afirmacoes: BLOCOS_DO_BRIEF.slice(1).map((bloco, i) => afirmacao({ id: `a-${i}`, bloco })),
      pendencias: [{ bloco: BLOCOS_DO_BRIEF[0]!, pergunta: 'Qual nome?', material: false }]
    })

    expect(refinamentoCompleto(b)).toBe(true)
  })
})
