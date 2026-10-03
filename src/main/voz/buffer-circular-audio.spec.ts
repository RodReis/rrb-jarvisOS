import { describe, expect, it } from 'vitest'
import { BufferCircularAudio } from './buffer-circular-audio'

describe('BufferCircularAudio (SPEC-Escuta-01, critérios 3 e 4)', () => {
  it('não cresce além da capacidade configurada', () => {
    const capacidade = 24_000 // 1500 ms @ 16 kHz
    const buffer = new BufferCircularAudio(capacidade)

    // Adiciona o equivalente a 10 segundos de áudio (160.000 amostras)
    const pedaco = new Int16Array(16_000)
    for (let i = 0; i < 10; i += 1) {
      buffer.adicionar(pedaco)
    }

    expect(buffer.tamanho()).toBe(capacidade)
    const saida = buffer.obter()
    expect(saida.length).toBe(capacidade)
  })

  it('preserva a ordem cronológica exata após dar a volta no buffer', () => {
    const buffer = new BufferCircularAudio(5)

    // Adiciona [1, 2, 3]
    buffer.adicionar(new Int16Array([1, 2, 3]))
    expect(Array.from(buffer.obter())).toEqual([1, 2, 3])

    // Adiciona [4, 5, 6, 7] -> total 7 itens, buffer de 5 deve reter os últimos 5: [3, 4, 5, 6, 7]
    buffer.adicionar(new Int16Array([4, 5, 6, 7]))
    expect(buffer.tamanho()).toBe(5)
    expect(Array.from(buffer.obter())).toEqual([3, 4, 5, 6, 7])
  })

  it('limpar esvazia o buffer e zera o tamanho', () => {
    const buffer = new BufferCircularAudio(10)
    buffer.adicionar(new Int16Array([10, 20, 30]))
    expect(buffer.tamanho()).toBe(3)

    buffer.limpar()
    expect(buffer.tamanho()).toBe(0)
    expect(buffer.obter().length).toBe(0)
  })

  it('recusa capacidade inválida menor ou igual a zero', () => {
    expect(() => new BufferCircularAudio(0)).toThrow(/maior que zero/)
    expect(() => new BufferCircularAudio(-10)).toThrow(/maior que zero/)
    expect(() => new BufferCircularAudio(1.5)).toThrow(/inteiro/)
    expect(() => new BufferCircularAudio(Infinity)).toThrow(/inteiro/)
  })
})
