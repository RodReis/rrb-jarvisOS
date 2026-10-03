import { describe, expect, it, vi } from 'vitest'
import { TAMANHO_DO_BLOCO, abrirCapturaContinua, criarEmpacotador } from './captura-continua'

describe('empacotador de blocos (SPEC-Escuta-01: 16 kHz mono, quadros de 1280)', () => {
  it('entrega blocos de 1280 amostras Int16 e guarda o resto para o próximo pedaço', () => {
    const blocos: Int16Array[] = []
    const empacotar = criarEmpacotador((b) => blocos.push(b))

    empacotar(new Float32Array(4096).fill(0.5))
    expect(blocos).toHaveLength(3)
    expect(blocos.every((b) => b.length === TAMANHO_DO_BLOCO)).toBe(true)
    expect(blocos[0]).toBeInstanceOf(Int16Array)

    // Sobraram 256 amostras; 256 + 4096 = 4352 = 3 blocos + 512.
    empacotar(new Float32Array(4096).fill(0.5))
    expect(blocos).toHaveLength(6)
  })

  it('corta picos acima de 1 em vez de dar a volta e virar silêncio alto', () => {
    const blocos: Int16Array[] = []
    const empacotar = criarEmpacotador((b) => blocos.push(b))

    empacotar(new Float32Array(TAMANHO_DO_BLOCO).fill(3))
    empacotar(new Float32Array(TAMANHO_DO_BLOCO).fill(-3))

    expect(blocos[0]?.[0]).toBe(32_767)
    expect(blocos[1]?.[0]).toBe(-32_767)
  })

  it('pedaço menor que um bloco não entrega nada ainda', () => {
    const aoBloco = vi.fn()
    criarEmpacotador(aoBloco)(new Float32Array(100))
    expect(aoBloco).not.toHaveBeenCalled()
  })
})

/** O mínimo de Web Audio que a captura toca; jsdom/Node não têm. */
function webAudioFalso() {
  const processador = {
    onaudioprocess: null as
      ((e: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null,
    connect: vi.fn(),
    disconnect: vi.fn()
  }
  const fonte = { connect: vi.fn(), disconnect: vi.fn() }
  const contexto = {
    createMediaStreamSource: vi.fn(() => fonte),
    createScriptProcessor: vi.fn(() => processador),
    destination: {},
    close: vi.fn(async () => undefined)
  }
  const trilha = { stop: vi.fn() }
  const stream = { getTracks: () => [trilha] }
  const abrirStream = vi.fn(async () => stream as unknown as MediaStream)
  const falarComOMicrofone = (valor: number): void =>
    processador.onaudioprocess?.({
      inputBuffer: { getChannelData: () => new Float32Array(4096).fill(valor) }
    })
  return {
    deps: {
      abrirStream,
      criarContexto: () => contexto as unknown as AudioContext
    },
    abrirStream,
    contexto,
    trilha,
    processador,
    falarComOMicrofone
  }
}

describe('captura contínua (SPEC-Escuta-01, critério 8)', () => {
  it('abre o dispositivo escolhido e manda os blocos de áudio', async () => {
    const w = webAudioFalso()
    const blocos: Int16Array[] = []

    await abrirCapturaContinua('headset-2', (b) => blocos.push(b), w.deps)
    w.falarComOMicrofone(0.1)

    expect(w.abrirStream).toHaveBeenCalledWith('headset-2')
    expect(blocos).toHaveLength(3)
  })

  it('parar encerra as trilhas do stream de fato, e não só o rótulo', async () => {
    const w = webAudioFalso()
    const captura = await abrirCapturaContinua(undefined, vi.fn(), w.deps)

    await captura.parar()

    // É o `track.stop()` que apaga o indicador de microfone do sistema operacional.
    expect(w.trilha.stop).toHaveBeenCalledTimes(1)
    expect(w.contexto.close).toHaveBeenCalledTimes(1)
    expect(w.processador.disconnect).toHaveBeenCalled()
  })

  it('depois de parar, o áudio que ainda chegar não sai mais', async () => {
    const w = webAudioFalso()
    const aoBloco = vi.fn()
    const captura = await abrirCapturaContinua(undefined, aoBloco, w.deps)

    await captura.parar()
    w.falarComOMicrofone(0.5)

    expect(aoBloco).not.toHaveBeenCalled()
  })

  it('parar duas vezes não fecha o contexto duas vezes', async () => {
    const w = webAudioFalso()
    const captura = await abrirCapturaContinua(undefined, vi.fn(), w.deps)

    await captura.parar()
    await captura.parar()

    expect(w.contexto.close).toHaveBeenCalledTimes(1)
  })
})
