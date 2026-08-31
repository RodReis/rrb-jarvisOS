/**
 * Testes da máquina de estados do run (SPEC-Entrega-02, critérios 1 e 5).
 *
 * A prova aqui é **exaustiva, não por amostra**: o critério 5 diz que o run não pula para
 * `MERGED`, e testar só `PLANNED → MERGED` deixaria passar `READY → MERGED` no dia em que
 * alguém acrescentasse a linha errada na tabela. O teste varre todos os estados de origem.
 */

import { describe, expect, it } from 'vitest'

import {
  ESTADOS_DO_RUN,
  ESTADOS_TERMINAIS,
  destinosDe,
  ehTerminal,
  isEstadoDoRun,
  transicaoPermitida,
  type EstadoDoRun
} from './pipeline'

describe('máquina de estados do run', () => {
  it('só admite MERGED a partir de PR_CI — nenhum outro estado alcança o merge', () => {
    const alcancamMerged = ESTADOS_DO_RUN.filter((de) => transicaoPermitida(de, 'MERGED'))

    expect(alcancamMerged).toEqual(['PR_CI'])
  })

  it('só admite AWAITING_MERGE a partir de PR_CI: o kill-switch age no fim, não no meio', () => {
    const alcancam = ESTADOS_DO_RUN.filter((de) => transicaoPermitida(de, 'AWAITING_MERGE'))

    expect(alcancam).toEqual(['PR_CI'])
  })

  it('rejeita o pulo direto de cada estado inicial para MERGED (critério 5)', () => {
    for (const de of ['PLANNED', 'AWAITING_PI', 'READY', 'RUNNING', 'VALIDATING'] as const) {
      expect(transicaoPermitida(de, 'MERGED')).toBe(false)
    }
  })

  it('percorre o caminho feliz inteiro, um passo de cada vez', () => {
    const caminho: readonly EstadoDoRun[] = [
      'PLANNED',
      'AWAITING_PI',
      'READY',
      'RUNNING',
      'VALIDATING',
      'PR_CI',
      'MERGED'
    ]

    for (let i = 0; i < caminho.length - 1; i += 1) {
      expect(transicaoPermitida(caminho[i], caminho[i + 1])).toBe(true)
    }
  })

  it('trata os quatro desfechos como terminais e nenhum outro estado', () => {
    expect([...ESTADOS_TERMINAIS].sort()).toEqual(
      ['AWAITING_MERGE', 'BLOCKED', 'CANCELLED', 'MERGED'].sort()
    )
  })

  it('não deixa nenhum estado terminal transicionar para lugar nenhum', () => {
    for (const terminal of ESTADOS_TERMINAIS) {
      expect(ehTerminal(terminal)).toBe(true)
      expect(destinosDe(terminal)).toEqual([])

      for (const destino of ESTADOS_DO_RUN) {
        expect(transicaoPermitida(terminal, destino)).toBe(false)
      }
    }
  })

  it('rejeita transição para o próprio estado: avanço que não avança não é fato', () => {
    for (const estado of ESTADOS_DO_RUN) {
      expect(transicaoPermitida(estado, estado)).toBe(false)
    }
  })

  it('deixa todo estado não-terminal ser cancelado', () => {
    const naoTerminais = ESTADOS_DO_RUN.filter((e) => !ehTerminal(e))

    for (const estado of naoTerminais) {
      expect(transicaoPermitida(estado, 'CANCELLED')).toBe(true)
    }
  })

  it('deixa VALIDATING e PR_CI voltarem para a correção no mesmo run', () => {
    // A M9-F05 corrige falha elegível no mesmo PR; sem o retorno, cada correção abriria um run.
    expect(transicaoPermitida('VALIDATING', 'RUNNING')).toBe(true)
    expect(transicaoPermitida('PR_CI', 'VALIDATING')).toBe(true)
  })

  it('reconhece só os estados declarados na fronteira do IPC', () => {
    expect(isEstadoDoRun('READY')).toBe(true)
    expect(isEstadoDoRun('ready')).toBe(false)
    expect(isEstadoDoRun('DONE')).toBe(false)
    expect(isEstadoDoRun(undefined)).toBe(false)
    expect(isEstadoDoRun(7)).toBe(false)
  })
})
