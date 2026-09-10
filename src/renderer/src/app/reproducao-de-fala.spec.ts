import { describe, expect, it, vi } from 'vitest'
import { criarReprodutor } from './reproducao-de-fala'
import type { SpeechHandle } from '@shared/domain/visemes'

/**
 * A reprodução da fala (SPEC-Voz-02, critério 7).
 *
 * O critério pede que o teste **conte fontes de áudio ativas**. O dublê abaixo existe para isso:
 * ele registra cada fonte criada e se ela foi parada, e é o que permite afirmar "nunca duas
 * simultâneas" sobre um fato, e não sobre a intenção do código.
 */

interface FonteFalsa {
  tocando: boolean
  parada: boolean
  onended: (() => void) | null
}

function ambienteFalso(): {
  criarContexto: () => AudioContext
  fontes: FonteFalsa[]
  contextosAbertos: () => number
  avancarAudio: (segundos: number) => void
} {
  const fontes: FonteFalsa[] = []
  let abertos = 0
  let currentTime = 0

  const criarContexto = (): AudioContext => {
    abertos++
    return {
      get currentTime() {
        return currentTime
      },
      createBuffer: (_canais: number, tamanho: number) => ({
        getChannelData: () => new Float32Array(tamanho)
      }),
      createBufferSource: () => {
        const fonte: FonteFalsa = { tocando: false, parada: false, onended: null }
        fontes.push(fonte)
        return {
          set buffer(_b: unknown) {},
          set onended(cb: () => void) {
            fonte.onended = cb
          },
          get onended() {
            return fonte.onended as () => void
          },
          connect: () => {},
          disconnect: () => {},
          start: () => {
            fonte.tocando = true
          },
          stop: () => {
            if (!fonte.tocando) throw new Error('InvalidStateError')
            fonte.tocando = false
            fonte.parada = true
          }
        } as unknown as AudioBufferSourceNode
      },
      destination: {} as AudioDestinationNode,
      close: async () => {
        abertos--
      }
    } as unknown as AudioContext
  }

  return {
    criarContexto,
    fontes,
    contextosAbertos: () => abertos,
    avancarAudio: (segundos: number) => {
      currentTime += segundos
    }
  }
}

function fala(amostras = 100, sampleRate = 22050): SpeechHandle {
  return {
    pcm: Int16Array.from({ length: amostras }, (_, i) => (i % 2 === 0 ? 1000 : -1000)),
    sampleRate,
    visemes: [{ viseme: 'aa', startMs: 0, endMs: 10 }],
    timeline: 'exato'
  }
}

describe('reprodução da fala', () => {
  it('aplica a saída escolhida no contexto', () => {
    const amb = ambienteFalso()
    const setSinkId = vi.fn().mockResolvedValue(undefined)
    const reprodutor = criarReprodutor({
      criarContexto: () => Object.assign(amb.criarContexto(), { setSinkId })
    })

    reprodutor.tocar(fala(), 'alto-falante-2')

    expect(setSinkId).toHaveBeenCalledWith('alto-falante-2')
  })

  it('degrada para saída padrão quando ambiente não suporta setSinkId', async () => {
    const reprodutor = criarReprodutor(ambienteFalso())
    const emCurso = reprodutor.tocar(fala(), 'alto-falante-2')
    await expect(emCurso.saidaAplicada).resolves.toBe(false)
  })

  it('nunca deixa duas fontes tocando ao mesmo tempo', () => {
    // O critério 7 literal: contar fontes ativas. Sem o cancelamento da anterior, as duas sairiam
    // pelo mesmo destino e o usuário ouviria as vozes sobrepostas.
    const amb = ambienteFalso()
    const reprodutor = criarReprodutor(amb)

    reprodutor.tocar(fala())
    reprodutor.tocar(fala())
    reprodutor.tocar(fala())

    expect(amb.fontes).toHaveLength(3)
    expect(amb.fontes.filter((f) => f.tocando)).toHaveLength(1)
    expect(amb.fontes.slice(0, 2).every((f) => f.parada)).toBe(true)
  })

  it('cancelar interrompe a fala em curso', () => {
    const amb = ambienteFalso()
    const reprodutor = criarReprodutor(amb)

    reprodutor.tocar(fala())
    expect(amb.fontes[0].tocando).toBe(true)

    reprodutor.cancelar()

    expect(amb.fontes[0].tocando).toBe(false)
    expect(amb.fontes[0].parada).toBe(true)
  })

  it('o handle devolvido cancela a própria fala', () => {
    const amb = ambienteFalso()
    const reprodutor = criarReprodutor(amb)

    const emCurso = reprodutor.tocar(fala())
    emCurso.cancelar()

    expect(amb.fontes[0].tocando).toBe(false)
  })

  it('cancelar duas vezes não estoura', () => {
    // `stop()` numa fonte já parada lança `InvalidStateError` — o dublê reproduz isso de
    // propósito. O objetivo (não estar tocando) já está cumprido; virar exceção seria pior.
    const amb = ambienteFalso()
    const reprodutor = criarReprodutor(amb)

    reprodutor.tocar(fala())

    expect(() => {
      reprodutor.cancelar()
      reprodutor.cancelar()
    }).not.toThrow()
  })

  it('cancelar sem nada tocando não estoura', () => {
    const reprodutor = criarReprodutor(ambienteFalso())
    expect(() => reprodutor.cancelar()).not.toThrow()
  })

  it('fecha o contexto de toda fala, inclusive das canceladas', async () => {
    // Cada fala abre um contexto. Sem fechar, eles acumulariam a cada frase até o navegador
    // recusar criar o próximo — e a fala pararia de funcionar depois de um tempo de uso.
    const amb = ambienteFalso()
    const reprodutor = criarReprodutor(amb)

    reprodutor.tocar(fala())
    reprodutor.tocar(fala())
    reprodutor.cancelar()
    await vi.waitFor(() => expect(amb.contextosAbertos()).toBe(0))
  })

  it('resolve terminou quando o áudio acaba sozinho', async () => {
    const amb = ambienteFalso()
    const reprodutor = criarReprodutor(amb)

    const emCurso = reprodutor.tocar(fala())
    amb.fontes[0].onended?.()

    await expect(emCurso.terminou).resolves.toBeUndefined()
  })

  it('resolve terminou também quando a fala é cancelada', async () => {
    // Quem espera o fim precisa ser liberado nos dois casos. Uma promessa que nunca resolve
    // deixaria a tela em "falando" para sempre — pior que erro, porque não há próxima ação.
    const amb = ambienteFalso()
    const reprodutor = criarReprodutor(amb)

    const emCurso = reprodutor.tocar(fala())
    reprodutor.cancelar()

    await expect(emCurso.terminou).resolves.toBeUndefined()
  })

  it('converte Int16 para float sem estourar a faixa', () => {
    // A divisão por 32768 e não por 32767: no mínimo do Int16 (-32768), dividir pelo máximo
    // positivo passaria de -1 e o áudio sairia com estalo.
    const amb = ambienteFalso()
    let canal: Float32Array | undefined

    const reprodutor = criarReprodutor({
      criarContexto: () =>
        ({
          ...amb.criarContexto(),
          createBuffer: (_c: number, tamanho: number) => ({
            getChannelData: () => {
              canal = new Float32Array(tamanho)
              return canal
            }
          })
        }) as unknown as AudioContext
    })

    reprodutor.tocar({ ...fala(2), pcm: Int16Array.from([-32768, 32767]) })

    expect(canal?.[0]).toBeGreaterThanOrEqual(-1)
    expect(canal?.[1]).toBeLessThanOrEqual(1)
  })

  it('expõe a posição pelo relógio do AudioContext, não pelo relógio de parede', () => {
    const amb = ambienteFalso()
    const relogioDeParede = vi.spyOn(Date, 'now').mockReturnValue(8_000)
    const reprodutor = criarReprodutor(amb)

    const emCurso = reprodutor.tocar(fala())
    relogioDeParede.mockReturnValue(12_000)
    amb.avancarAudio(0.125)

    expect(emCurso.posicaoMs()).toBe(125)
    relogioDeParede.mockRestore()
  })
})
