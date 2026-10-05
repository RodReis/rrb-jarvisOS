import { describe, expect, it } from 'vitest'
import { iniciarReferenciaDaFala, suprimirPropriaFala } from './referencia-da-fala'

const sinal = Int16Array.from({ length: 16_000 }, (_, i) =>
  Math.round(Math.sin(i * 0.07) * 8_000 + Math.sin(i * 0.123) * 3_000)
)

describe('supressão por referência do PCM reproduzido', () => {
  it('descarta a própria fala com atraso acústico, sem tocar no PCM original', () => {
    const encerrar = iniciarReferenciaDaFala(sinal, 16_000, () => 500)
    const eco = sinal.slice(5_120, 6_400)
    expect(suprimirPropriaFala(eco)).toEqual(new Int16Array(1_280))
    expect(eco.some((a) => a !== 0)).toBe(true)
    encerrar()
  })

  it('preserva voz independente e libera a referência ao fim', () => {
    const encerrar = iniciarReferenciaDaFala(sinal, 16_000, () => 500)
    const pessoa = Int16Array.from({ length: 1_280 }, (_, i) =>
      Math.round(Math.sin(i * 0.033) * 8_000)
    )
    expect(suprimirPropriaFala(pessoa)).toBe(pessoa)
    encerrar()
    expect(suprimirPropriaFala(sinal.slice(5_120, 6_400))).not.toEqual(new Int16Array(1_280))
  })
})
