/**
 * A máquina de estados da tentativa (SPEC-Multi-Executor-01, critério 2 e regras 1 e 4).
 *
 * Project `regras`: é lógica pura, sem processo, sem disco, sem timer. O que estes testes
 * provam é que a **ordem de chegada dos eventos não corrompe o estado** — e isso não precisa
 * de um CLI de verdade para ser verdade.
 */

import { describe, expect, it } from 'vitest'
import { aplicarEvento, estadoInicial, isTerminal } from './attempt-state'

describe('estadoInicial', () => {
  it('abre a tentativa em aberta, sem eventos consumidos', () => {
    const estado = estadoInicial('att-1')

    expect(estado.attemptId).toBe('att-1')
    expect(estado.fase).toBe('aberta')
    expect(estado.pathsAlterados).toEqual([])
    expect(estado.diagnosticos).toEqual([])
  })
})

describe('aplicarEvento — caminho felizes', () => {
  it('started move de aberta para executando e guarda a sessao', () => {
    const depois = aplicarEvento(estadoInicial('att-1'), { tipo: 'started', sessao: 'ses-9' })

    expect(depois.fase).toBe('executando')
    expect(depois.sessao).toBe('ses-9')
  })

  it('done move para concluida e guarda o resumo', () => {
    const executando = aplicarEvento(estadoInicial('att-1'), { tipo: 'started' })
    const depois = aplicarEvento(executando, { tipo: 'done', resumo: 'fatia pronta' })

    expect(depois.fase).toBe('concluida')
    expect(depois.resumo).toBe('fatia pronta')
    expect(isTerminal(depois.fase)).toBe(true)
  })

  it('usage acumula o uso sem encerrar a tentativa', () => {
    const executando = aplicarEvento(estadoInicial('att-1'), { tipo: 'started' })
    const depois = aplicarEvento(executando, {
      tipo: 'usage',
      tokensEntrada: 10,
      tokensSaida: 20,
      duracaoMs: 300
    })

    expect(depois.fase).toBe('executando')
    expect(depois.uso).toEqual({ tokensEntrada: 10, tokensSaida: 20, duracaoMs: 300 })
  })

  it('path_changed acumula o path relatado', () => {
    const executando = aplicarEvento(estadoInicial('att-1'), { tipo: 'started' })
    const depois = aplicarEvento(executando, { tipo: 'path_changed', path: 'src/a.ts' })

    expect(depois.pathsAlterados).toEqual(['src/a.ts'])
  })
})

describe('aplicarEvento — o estado nao corrompe (criterio 2)', () => {
  it('started duplicado nao reabre nem duplica a sessao', () => {
    const uma = aplicarEvento(estadoInicial('att-1'), { tipo: 'started', sessao: 'ses-1' })
    const outra = aplicarEvento(uma, { tipo: 'started', sessao: 'ses-2' })

    expect(outra.fase).toBe('executando')
    // A primeira sessão vence: trocá-la faria o kernel retomar a sessão errada depois.
    expect(outra.sessao).toBe('ses-1')
    expect(outra.diagnosticos).toHaveLength(1)
  })

  it('path_changed repetido nao duplica o path na lista', () => {
    const executando = aplicarEvento(estadoInicial('att-1'), { tipo: 'started' })
    const uma = aplicarEvento(executando, { tipo: 'path_changed', path: 'src/a.ts' })
    const outra = aplicarEvento(uma, { tipo: 'path_changed', path: 'src/a.ts' })

    expect(outra.pathsAlterados).toEqual(['src/a.ts'])
  })

  it('evento fora de ordem (progress antes de started) nao inventa transicao', () => {
    const depois = aplicarEvento(estadoInicial('att-1'), { tipo: 'progress', mensagem: 'oi' })

    // Continua `aberta`: só `started` abre a execução. Inferir início de um `progress`
    // faria o estado do kernel depender de qual evento o fornecedor emite primeiro.
    expect(depois.fase).toBe('aberta')
    expect(depois.diagnosticos).toHaveLength(1)
  })

  it('evento apos terminal nao reabre o estado (regra 1)', () => {
    const executando = aplicarEvento(estadoInicial('att-1'), { tipo: 'started' })
    const concluida = aplicarEvento(executando, { tipo: 'done' })
    const depois = aplicarEvento(concluida, { tipo: 'progress', mensagem: 'atrasado' })

    expect(depois.fase).toBe('concluida')
    expect(depois.diagnosticos).toHaveLength(1)
  })

  it('failed apos done nao troca o desfecho', () => {
    const executando = aplicarEvento(estadoInicial('att-1'), { tipo: 'started' })
    const concluida = aplicarEvento(executando, { tipo: 'done' })
    const depois = aplicarEvento(concluida, { tipo: 'failed', erro: 'tarde' })

    expect(depois.fase).toBe('concluida')
    expect(depois.erro).toBeUndefined()
  })

  it('evento desconhecido vira diagnostico sem alterar a fase (regra 4)', () => {
    const executando = aplicarEvento(estadoInicial('att-1'), { tipo: 'started' })
    const depois = aplicarEvento(executando, { tipo: 'desconhecido', bruto: '{"x":1}' })

    expect(depois.fase).toBe('executando')
    expect(depois.diagnosticos).toEqual(['{"x":1}'])
  })

  it('nao muta o estado recebido', () => {
    const executando = aplicarEvento(estadoInicial('att-1'), { tipo: 'started' })
    aplicarEvento(executando, { tipo: 'path_changed', path: 'src/a.ts' })

    expect(executando.pathsAlterados).toEqual([])
  })
})

describe('aplicarEvento — cancelamento', () => {
  it('canceled encerra a tentativa', () => {
    const executando = aplicarEvento(estadoInicial('att-1'), { tipo: 'started' })
    const depois = aplicarEvento(executando, { tipo: 'canceled' })

    expect(depois.fase).toBe('cancelada')
    expect(isTerminal(depois.fase)).toBe(true)
  })

  it('canceled repetido mantem um unico desfecho', () => {
    const executando = aplicarEvento(estadoInicial('att-1'), { tipo: 'started' })
    const uma = aplicarEvento(executando, { tipo: 'canceled' })
    const outra = aplicarEvento(uma, { tipo: 'canceled' })

    expect(outra.fase).toBe('cancelada')
    expect(outra.diagnosticos).toHaveLength(1)
  })
})
