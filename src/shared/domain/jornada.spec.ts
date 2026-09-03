/**
 * A máquina de etapas da jornada (SPEC-Jornada-01, § Testes).
 *
 * A spec pede *"unitários da máquina de etapas (transições, recálculo, invalidação)"*. Os
 * critérios que estes testes protegem são todos sobre o que **não** acontece:
 *
 *  - **Critério 1:** não existe transição sem evento nomeado — evento desconhecido ou fora de
 *    ordem não move a etapa.
 *  - **Critério 2:** etapa persistida incoerente perde para o cálculo; um evento solto lá na
 *    frente não declara concluído o que veio antes dele.
 *  - **Critério 4:** etapa futura diz o que falta e não oferece ação.
 *  - **Critério 6:** projeto sem nenhum fato abre em `prompt` — é o que faz a migração de
 *    `projeto1` funcionar sem caso especial.
 *  - **Critério 7:** invalidação regride para a **primeira** etapa inválida, não para a última.
 */

import { describe, expect, it } from 'vitest'
import type { Etapa } from './jornada'
import {
  CTA_DA_ETAPA,
  ETAPAS,
  ETAPAS_DE_ACEITE,
  EVENTOS,
  TRANSICOES,
  avancar,
  etapaDerivada,
  exigeAceiteDoPi,
  isEtapa,
  isEventoDeJornada,
  oQueFaltaPara,
  ordemDaEtapa,
  posicaoNaTrilha,
  regredir
} from './jornada'

describe('contrato das etapas', () => {
  it('reconhece etapa do enum e recusa qualquer outra string', () => {
    expect(isEtapa('prompt')).toBe(true)
    expect(isEtapa('construcao')).toBe(true)
    expect(isEtapa('planejamento')).toBe(false)
    expect(isEtapa(undefined)).toBe(false)
  })

  it('ordena a trilha pela posição no enum, sem um segundo mapa que possa divergir', () => {
    expect(ordemDaEtapa('prompt')).toBe(0)
    expect(ordemDaEtapa('construcao')).toBe(ETAPAS.length - 1)
    expect(ordemDaEtapa('prd')).toBeGreaterThan(ordemDaEtapa('refinamento'))
  })

  it('dá um CTA a cada etapa — a tela nunca fica sem próximo passo (critério 3)', () => {
    for (const etapa of ETAPAS) {
      expect(CTA_DA_ETAPA[etapa]).toBeTruthy()
    }
  })

  it('encadeia as transições sem buraco: a trilha é percorrível do início ao fim', () => {
    let etapa: Etapa = 'prompt'
    const visitadas: Etapa[] = [etapa]

    for (;;) {
      const evento = EVENTOS.find((e) => TRANSICOES[e].de === etapa)
      if (!evento) break
      etapa = TRANSICOES[evento].para
      visitadas.push(etapa)
    }

    // Toda etapa declarada é alcançável: uma etapa órfã seria um estado em que o projeto
    // entraria e do qual nunca sairia.
    expect(visitadas).toEqual([...ETAPAS])
    expect(etapa).toBe('construcao')
  })
})

describe('transição por evento nomeado (critério 1)', () => {
  it('avança quando o evento sai da etapa atual', () => {
    const outcome = avancar('prompt', 'prompt-salvo')

    expect(outcome.resultado).toBe('avancou')
    expect(outcome.etapa).toBe('refinamento')
  })

  it('recusa evento desconhecido sem mover a etapa', () => {
    const outcome = avancar('prompt', 'etapa-setada-na-mao')

    expect(outcome.resultado).toBe('evento-desconhecido')
    expect(outcome.etapa).toBe('prompt')
  })

  it('recusa evento fora de ordem: pular etapa não é transição', () => {
    const outcome = avancar('prompt', 'roadmap-gerado')

    expect(outcome.resultado).toBe('evento-fora-de-ordem')
    expect(outcome.etapa).toBe('prompt')
  })

  it('recusa, e não estoura, para que a UI mostre o desfecho', () => {
    expect(() => avancar('prompt', 'inexistente')).not.toThrow()
    expect(avancar('prompt', 'inexistente').mensagem).toContain('não existe')
  })
})

describe('aceite do PI nas etapas de gate (critério de SPEC-Planejamento-06)', () => {
  it('marca como aceite exatamente as cinco etapas de aceite', () => {
    for (const etapa of ETAPAS) {
      expect(exigeAceiteDoPi(etapa)).toBe(ETAPAS_DE_ACEITE.includes(etapa))
    }
  })

  it('barra a saída de etapa de aceite sem Approval', () => {
    const outcome = avancar('pacote-aceito', 'pacote-aceito')

    expect(outcome.resultado).toBe('aceite-ausente')
    expect(outcome.etapa).toBe('pacote-aceito')
  })

  it('libera a saída quando o aceite do PI existe', () => {
    const outcome = avancar('pacote-aceito', 'pacote-aceito', true)

    expect(outcome.resultado).toBe('avancou')
    expect(outcome.etapa).toBe('roadmap')
  })

  it('não exige aceite em etapa que não é de aceite', () => {
    expect(avancar('prd', 'prd-gerado').resultado).toBe('avancou')
  })
})

describe('etapa derivada dos fatos (critério 2)', () => {
  it('projeto sem nenhum evento abre em prompt (critério 6)', () => {
    expect(etapaDerivada([])).toBe('prompt')
  })

  it('segue a cadeia enquanto os eventos existem', () => {
    expect(etapaDerivada(['prompt-salvo'])).toBe('refinamento')
    expect(etapaDerivada(['prompt-salvo', 'refinamento-respondido'])).toBe('brief-aceito')
  })

  it('para no primeiro buraco: evento solto adiante não conclui o que veio antes', () => {
    // `roadmap-gerado` existe, mas nada antes dele. O projeto continua em `prompt` — é o caso
    // do projeto do fluxo antigo, que tem artefatos compostos sem brief nem origem de modelo.
    expect(etapaDerivada(['roadmap-gerado'])).toBe('prompt')
    expect(etapaDerivada(['prompt-salvo', 'prd-gerado'])).toBe('refinamento')
  })

  it('ignora string que não é evento da jornada em vez de estourar', () => {
    expect(etapaDerivada(['prompt-salvo', 'lixo-gravado-por-versao-futura'])).toBe('refinamento')
  })

  it('percorre a jornada inteira quando todos os eventos constam', () => {
    expect(etapaDerivada([...EVENTOS])).toBe('construcao')
  })
})

describe('regressão por invalidação de gate (critério 7)', () => {
  it('regride para a primeira etapa invalidada, não para a última', () => {
    const outcome = regredir('roadmap', ['pacote-aceito', 'prd'], 'PRD mudou semanticamente')

    // Parar em `pacote-aceito` deixaria `prd` — que também foi invalidada — atrás da atual e
    // marcada como concluída. A menor ordem é a única regressão honesta.
    expect(outcome.etapa).toBe('prd')
    expect(outcome.regrediu).toBe(true)
    expect(outcome.motivo).toBe('PRD mudou semanticamente')
  })

  it('não regride para frente: invalidação de etapa futura não move nada', () => {
    const outcome = regredir('prd', ['roadmap'], 'roadmap mudou')

    expect(outcome.etapa).toBe('prd')
    expect(outcome.regrediu).toBe(false)
  })

  it('sem invalidação, a etapa fica onde está', () => {
    expect(regredir('prd', [], 'nada mudou').regrediu).toBe(false)
  })

  it('preserva o motivo mesmo quando não regride, para a tela poder dizê-lo', () => {
    expect(regredir('prd', [], 'mudança cosmética').motivo).toBe('mudança cosmética')
  })
})

describe('trilha na tela (critérios 3 e 4)', () => {
  it('classifica concluída, atual e futura pela ordem', () => {
    expect(posicaoNaTrilha('prompt', 'prd')).toBe('concluida')
    expect(posicaoNaTrilha('prd', 'prd')).toBe('atual')
    expect(posicaoNaTrilha('roadmap', 'prd')).toBe('futura')
  })

  it('diz o que falta só para etapa futura', () => {
    expect(oQueFaltaPara('roadmap', 'prd')).toContain(CTA_DA_ETAPA.prd)
    expect(oQueFaltaPara('prd', 'prd')).toBeNull()
    expect(oQueFaltaPara('prompt', 'prd')).toBeNull()
  })
})

describe('contrato dos eventos', () => {
  it('reconhece evento do enum e recusa qualquer outra string', () => {
    expect(isEventoDeJornada('prompt-salvo')).toBe(true)
    expect(isEventoDeJornada('prompt salvo')).toBe(false)
    expect(isEventoDeJornada(null)).toBe(false)
  })
})
