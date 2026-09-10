import { describe, expect, it, vi } from 'vitest'
import { criarMedidorDeEntrada } from './medidor-de-audio'

describe('medidor de entrada (SPEC-Voz-05, critérios 6 e 8)', () => {
  it('abre o dispositivo exato e calcula RMS pelo AnalyserNode', async () => {
    const stop = vi.fn()
    const close = vi.fn().mockResolvedValue(undefined)
    const abrirStream = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] })
    const analisador = {
      fftSize: 0,
      getFloatTimeDomainData: (amostras: Float32Array) => amostras.fill(0.5)
    }
    const medidor = await criarMedidorDeEntrada('headset-2', {
      abrirStream,
      criarContexto: () =>
        ({
          createAnalyser: () => analisador,
          createMediaStreamSource: () => ({ connect: vi.fn() }),
          close
        }) as unknown as AudioContext
    })

    expect(abrirStream).toHaveBeenCalledWith('headset-2')
    expect(medidor.nivelRms()).toBe(16_384)
    await medidor.parar()
    expect(stop).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })
})
