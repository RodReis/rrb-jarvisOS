import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DetectorDeDuasPalmas } from './detector-de-palmas'

const silencio = (ms: number): Int16Array => new Int16Array(ms * 16)
const impulso = (ms = 40): Int16Array => new Int16Array(ms * 16).fill(12_000)

describe('detector de duas palmas', () => {
  it('dispara uma vez para duas palmas separadas por 300 ms', () => {
    const detector = new DetectorDeDuasPalmas()
    expect(detector.alimentar(impulso())).toBe(false)
    expect(detector.alimentar(silencio(260))).toBe(false)
    expect(detector.alimentar(impulso())).toBe(false)
    expect(detector.alimentar(silencio(20))).toBe(true)
    expect(detector.alimentar(impulso())).toBe(false)
  })

  it('ignora uma palma isolada, par lento e ruído sustentado', () => {
    const detector = new DetectorDeDuasPalmas()
    expect(detector.alimentar(impulso())).toBe(false)
    expect(detector.alimentar(silencio(900))).toBe(false)
    expect(detector.alimentar(impulso())).toBe(false)
    expect(detector.alimentar(silencio(30))).toBe(false)
    expect(detector.alimentar(impulso(300))).toBe(false)
    expect(detector.alimentar(silencio(30))).toBe(false)
  })

  it('mantém a detecção quando o PCM chega em blocos pequenos', () => {
    const detector = new DetectorDeDuasPalmas()
    const audio = new Int16Array([...impulso(), ...silencio(260), ...impulso(), ...silencio(20)])
    const resultados: boolean[] = []
    for (let i = 0; i < audio.length; i += 128) {
      resultados.push(detector.alimentar(audio.subarray(i, i + 128)))
    }
    expect(resultados.filter(Boolean)).toHaveLength(1)
  })

  it('não interpreta as falas de referência como duas palmas', () => {
    for (const nome of ['ei_amigo_ref.wav', 'amigo_isolado_ref.wav', 'meu_amigo_ref.wav']) {
      const caminho = fileURLToPath(
        new URL(`../../../tests/fixtures/audio/${nome}`, import.meta.url)
      )
      const wav = readFileSync(caminho)
      const taxa = wav.readUInt32LE(24)
      const inicio = wav.indexOf(Buffer.from('data')) + 8
      const total = (wav.length - inicio) / 2
      const pcm = new Int16Array(Math.round((total * 16_000) / taxa))
      for (let i = 0; i < pcm.length; i += 1) {
        pcm[i] = wav.readInt16LE(inicio + Math.min(total - 1, Math.round((i * taxa) / 16_000)) * 2)
      }
      const detector = new DetectorDeDuasPalmas()
      expect(detector.alimentar(pcm), nome).toBe(false)
    }
  })
})
