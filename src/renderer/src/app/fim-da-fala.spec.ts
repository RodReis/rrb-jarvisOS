import { describe, expect, it } from 'vitest'
import { criarDetectorDeFimDaFala } from './fim-da-fala'

const FALA = 4_000
const SILENCIO = 100

/** Alimenta níveis a cada 250 ms (o passo da captura) e devolve o primeiro veredito não-continua. */
function rodar(
  niveis: readonly number[],
  config?: Parameters<typeof criarDetectorDeFimDaFala>[0]
): { veredito: string; aosMs: number } | undefined {
  const detector = criarDetectorDeFimDaFala(config)
  for (let i = 0; i < niveis.length; i++) {
    const aosMs = (i + 1) * 250
    const veredito = detector.alimentar(niveis[i] ?? 0, aosMs)
    if (veredito !== 'continua') return { veredito, aosMs }
  }
  return undefined
}

describe('fim da fala após o disparo (SPEC-Escuta-01, critério 13)', () => {
  it('sem fala nenhuma, cancela aos 3 s — e é esse o veredito que não chama a IA', () => {
    const resultado = rodar(Array(40).fill(SILENCIO))

    expect(resultado).toEqual({ veredito: 'cancelar', aosMs: 3_000 })
  })

  it('fala seguida de silêncio encerra o turno para transcrever', () => {
    const niveis = [SILENCIO, FALA, FALA, FALA, ...Array(10).fill(SILENCIO)]

    const resultado = rodar(niveis)

    expect(resultado?.veredito).toBe('fim')
    // Último trecho falado em 1000 ms; 1500 ms de silêncio depois.
    expect(resultado?.aosMs).toBe(2_500)
  })

  it('pausa curta no meio da frase não corta o enunciado', () => {
    const niveis = [FALA, SILENCIO, SILENCIO, FALA, FALA, ...Array(10).fill(SILENCIO)]

    const resultado = rodar(niveis)

    expect(resultado?.aosMs).toBeGreaterThan(1_500)
  })

  it('uma vez que houve fala, o silêncio não vira cancelamento: o enunciado vai ser transcrito', () => {
    const resultado = rodar([FALA, ...Array(40).fill(SILENCIO)])

    expect(resultado?.veredito).toBe('fim')
  })

  it('fala contínua sem fim encerra no teto, para o microfone não ficar aberto indefinidamente', () => {
    const resultado = rodar(Array(200).fill(FALA), { tetoMs: 10_000 })

    expect(resultado).toEqual({ veredito: 'fim', aosMs: 10_000 })
  })

  it('o limiar separa fala de ruído de fundo', () => {
    expect(rodar(Array(40).fill(600))?.veredito).toBe('cancelar')
    expect(rodar([2_000, ...Array(10).fill(600)])?.veredito).toBe('fim')
  })
})
