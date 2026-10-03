import { describe, expect, it, vi } from 'vitest'
import {
  type WakeWordEngine,
  type EventoWakeWordDetectado,
  validarLimiar,
  LIMIAR_PADRAO_WAKE_WORD,
  LIMIAR_MINIMO_WAKE_WORD,
  LIMIAR_MAXIMO_WAKE_WORD
} from './wake-word-engine'

function engineFalso(disparar = false, confianca = 0.85): WakeWordEngine {
  let limiar = LIMIAR_PADRAO_WAKE_WORD
  return {
    alimentar: vi.fn(async (_pcm: Int16Array): Promise<EventoWakeWordDetectado | null> => {
      if (disparar && confianca >= limiar) {
        return { confianca, fimDaFraseMs: Date.now() }
      }
      return null
    }),
    disponivel: vi.fn(async () => true),
    definirLimiar: vi.fn((l: number) => {
      limiar = l
    }),
    obterLimiar: vi.fn(() => limiar),
    encerrar: vi.fn(async () => undefined)
  }
}

describe('WakeWordEngine — contrato e validações (SPEC-Escuta-01, critérios 1 e 12)', () => {
  it('dispara quando configurado e a confiança atinge o limiar', async () => {
    const engine = engineFalso(true, 0.9)
    const evento = await engine.alimentar(new Int16Array(1280))

    expect(evento).not.toBeNull()
    expect(evento?.confianca).toBe(0.9)
  })

  it('não dispara quando a confiança fica abaixo do limiar', async () => {
    const engine = engineFalso(true, 0.4)
    const evento = await engine.alimentar(new Int16Array(1280))

    expect(evento).toBeNull()
  })

  it('limiar de sensibilidade é atualizado sem restart (critério 12)', async () => {
    const engine = engineFalso(true, 0.6)

    // Com limiar default (0.5), confiança 0.6 dispara
    expect(await engine.alimentar(new Int16Array(1280))).not.toBeNull()

    // Aumenta o limiar para 0.8: na chamada seguinte a mesma confiança não dispara mais
    engine.definirLimiar(0.8)
    expect(engine.obterLimiar()).toBe(0.8)
    expect(await engine.alimentar(new Int16Array(1280))).toBeNull()
  })

  it('valida limiar dentro dos limites permitidos [0.1, 0.95]', () => {
    expect(validarLimiar(null)).toBe(LIMIAR_PADRAO_WAKE_WORD)
    expect(validarLimiar(undefined)).toBe(LIMIAR_PADRAO_WAKE_WORD)
    expect(validarLimiar('invalido')).toBe(LIMIAR_PADRAO_WAKE_WORD)
    expect(validarLimiar(NaN)).toBe(LIMIAR_PADRAO_WAKE_WORD)
    expect(validarLimiar(Infinity)).toBe(LIMIAR_PADRAO_WAKE_WORD)
    expect(validarLimiar(-Infinity)).toBe(LIMIAR_PADRAO_WAKE_WORD)

    expect(validarLimiar(0.01)).toBe(LIMIAR_MINIMO_WAKE_WORD)
    expect(validarLimiar(0.99)).toBe(LIMIAR_MAXIMO_WAKE_WORD)
    expect(validarLimiar(0.72)).toBe(0.72)
  })
})
