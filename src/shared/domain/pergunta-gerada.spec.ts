/**
 * O validador da pergunta gerada (SPEC-Jornada-02, critério 3).
 *
 * **Por que este arquivo existe separado de `wizard-catalogo.spec.ts`.** Aquele varre um
 * catálogo estático: se alguém escrevesse uma pergunta sobre consentimento, o CI ficaria
 * vermelho antes de o código sair da máquina. Com perguntas geradas por modelo, aquele teste
 * deixa de proteger — o texto que chega ao PI é produzido **depois** de todo CI ter passado.
 *
 * Aqui a mesma varredura é exercitada como validador de runtime. O que os testes provam é que
 * ela **recusa**, e não que ela corrige ou avisa: uma pergunta que fere o contrato não chega à
 * tela nem com ressalva.
 */

import { describe, expect, it } from 'vitest'
import type { PerguntaGerada } from './pergunta-gerada'
import {
  MAXIMO_DE_OPCOES,
  MINIMO_DE_OPCOES,
  validarContratoDaPergunta,
  separarPerguntasValidas,
  validarPerguntaGerada
} from './pergunta-gerada'
import { TERMOS_QUE_EXIGEM_ORIGEM_HUMANA } from './brief'

function pergunta(over: Partial<PerguntaGerada> = {}): PerguntaGerada {
  return {
    id: 'q-1',
    etapa: 'refinamento',
    bloco: 'escopo-e-metricas',
    porQue: 'O prompt não diz onde a primeira versão para.',
    titulo: 'Alcance da primeira versão',
    enunciado: 'Até onde vai o primeiro corte?',
    opcoes: [
      { id: 'fatia', rotulo: 'Fatia vertical', impacto: 'Entrega ponta a ponta, cobertura menor.' },
      {
        id: 'fundacao',
        rotulo: 'Fundação ampla',
        impacto: 'Base sólida, valor visível mais tarde.'
      }
    ],
    recomendada: 'fatia',
    justificativa: 'Uma fatia vertical valida a hipótese antes de investir na base.',
    aceitaTextoLivre: true,
    delegavel: true,
    ...over
  }
}

describe('contrato da pergunta (SPEC-Planejamento-03)', () => {
  it('aceita uma pergunta que cumpre o contrato inteiro', () => {
    expect(validarPerguntaGerada(pergunta()).valida).toBe(true)
  })

  it('recusa título, enunciado ou justificativa vazios', () => {
    const r = validarPerguntaGerada(pergunta({ titulo: '  ', enunciado: '', justificativa: '' }))

    const recusas = r.problemas.map((p) => p.recusa)
    expect(recusas).toContain('titulo-vazio')
    expect(recusas).toContain('enunciado-vazio')
    expect(recusas).toContain('justificativa-vazia')
  })

  it(`recusa menos de ${MINIMO_DE_OPCOES} opções — uma opção não é escolha`, () => {
    const r = validarPerguntaGerada(
      pergunta({
        opcoes: [{ id: 'a', rotulo: 'Única', impacto: 'nenhum trade-off' }],
        recomendada: 'a'
      })
    )

    expect(r.problemas.map((p) => p.recusa)).toContain('opcoes-fora-do-contrato')
  })

  it(`recusa mais de ${MAXIMO_DE_OPCOES} opções — vira formulário, não decisão`, () => {
    const r = validarPerguntaGerada(
      pergunta({
        opcoes: [
          { id: 'a', rotulo: 'A', impacto: 'i' },
          { id: 'b', rotulo: 'B', impacto: 'i' },
          { id: 'c', rotulo: 'C', impacto: 'i' },
          { id: 'd', rotulo: 'D', impacto: 'i' }
        ],
        recomendada: 'a'
      })
    )

    expect(r.problemas.map((p) => p.recusa)).toContain('opcoes-fora-do-contrato')
  })

  it('recusa opção sem impacto — sem trade-off o PI escolhe no escuro', () => {
    const r = validarPerguntaGerada(
      pergunta({
        opcoes: [
          { id: 'a', rotulo: 'A', impacto: '' },
          { id: 'b', rotulo: 'B', impacto: 'tem' }
        ],
        recomendada: 'a'
      })
    )

    expect(r.problemas.map((p) => p.recusa)).toContain('opcao-sem-impacto')
  })

  it('recusa duas opções com o mesmo rótulo — elas precisam ser excludentes', () => {
    const r = validarPerguntaGerada(
      pergunta({
        opcoes: [
          { id: 'a', rotulo: 'Fatia vertical', impacto: 'x' },
          { id: 'b', rotulo: 'fatia  vertical', impacto: 'y' }
        ],
        recomendada: 'a'
      })
    )

    // Normalizado: acento e caixa não deveriam disfarçar a repetição.
    expect(r.problemas.map((p) => p.recusa)).toContain('opcoes-repetidas')
  })

  it('recusa recomendada que não está entre as opções', () => {
    // Um id solto faria "Decide por mim" gravar como escolha algo fora da lista.
    const r = validarPerguntaGerada(pergunta({ recomendada: 'inexistente' }))

    expect(r.problemas.map((p) => p.recusa)).toContain('recomendada-inexistente')
  })

  it('recusa bloco fora do schema', () => {
    const r = validarPerguntaGerada(pergunta({ bloco: 'inventado' as never }))

    expect(r.problemas.map((p) => p.recusa)).toContain('bloco-desconhecido')
  })
})

describe('invariante 9 sobre texto gerado', () => {
  it.each(TERMOS_QUE_EXIGEM_ORIGEM_HUMANA)('recusa a pergunta que menciona "%s"', (termo) => {
    const r = validarPerguntaGerada(pergunta({ enunciado: `Como tratar ${termo} no produto?` }))

    expect(r.valida).toBe(false)
    expect(r.problemas.map((p) => p.recusa)).toContain('requisito-inventado')
  })

  it('varre a pergunta inteira, não só o enunciado', () => {
    // Um requisito inventado escondido no impacto de uma opção chegaria à tela igual.
    const noImpacto = validarPerguntaGerada(
      pergunta({
        opcoes: [
          { id: 'a', rotulo: 'A', impacto: 'Exige consentimento explícito.' },
          { id: 'b', rotulo: 'B', impacto: 'Sem exigência.' }
        ],
        recomendada: 'a'
      })
    )
    expect(noImpacto.valida).toBe(false)

    const noPorQue = validarPerguntaGerada(pergunta({ porQue: 'Necessário para LGPD.' }))
    expect(noPorQue.valida).toBe(false)
  })

  it('recusa, não corrige nem avisa — a pergunta simplesmente não passa', () => {
    const r = validarPerguntaGerada(pergunta({ titulo: 'Compliance do produto' }))

    expect(r.valida).toBe(false)
  })
})

describe('separação em lote', () => {
  it('devolve as válidas e as recusadas com o motivo', () => {
    const boa = pergunta({ id: 'q-boa' })
    const ma = pergunta({ id: 'q-ma', enunciado: 'E a LGPD?' })

    const { validas, recusadas } = separarPerguntasValidas([boa, ma])

    expect(validas.map((p) => p.id)).toEqual(['q-boa'])
    expect(recusadas.map((r) => r.pergunta.id)).toEqual(['q-ma'])
    expect(recusadas[0]?.problemas.length).toBeGreaterThan(0)
  })

  it('recusa não é silenciosa: o serviço recebe o que foi barrado', () => {
    // Sem a lista de recusadas, o refinamento pularia um bloco sem ninguém saber por quê.
    const { recusadas } = separarPerguntasValidas([pergunta({ recomendada: 'fantasma' })])

    expect(recusadas).toHaveLength(1)
    expect(recusadas[0]?.problemas[0]?.mensagem).toContain('fantasma')
  })
})

describe('validarContratoDaPergunta — o contrato sem o bloco do brief', () => {
  const base = {
    id: 'c-1',
    etapa: 'prd',
    titulo: 'Local ou nuvem',
    enunciado: 'O produto é local ou na nuvem?',
    opcoes: [
      { id: 'a', rotulo: 'Local', impacto: 'Sem sync.' },
      { id: 'b', rotulo: 'Nuvem', impacto: 'Exige rede.' }
    ],
    recomendada: 'a',
    justificativa: 'O brief diz local.',
    aceitaTextoLivre: true,
    delegavel: true
  }

  it('aceita a pergunta que cumpre o contrato', () => {
    expect(validarContratoDaPergunta(base).valida).toBe(true)
  })

  it('recusa uma opção só e recomendada inexistente', () => {
    const r = validarContratoDaPergunta({ ...base, opcoes: [base.opcoes[0]!], recomendada: 'z' })

    expect(r.problemas.map((p) => p.recusa)).toEqual(
      expect.arrayContaining(['opcoes-fora-do-contrato', 'recomendada-inexistente'])
    )
  })

  it('a invariante 9 vale também aqui', () => {
    const r = validarContratoDaPergunta({ ...base, enunciado: 'Precisa de consentimento LGPD?' })

    expect(r.problemas.map((p) => p.recusa)).toContain('requisito-inventado')
  })
})
