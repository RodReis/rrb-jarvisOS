import { describe, expect, it, vi } from 'vitest'
import {
  TAMANHO_DO_BLOCO,
  abrirCapturaContinua,
  criarEmpacotador,
  resolverEntradaSelecionada
} from './captura-continua'

describe('dispositivo da escuta após mudança de ID', () => {
  const entrada = (deviceId: string, label: string) =>
    ({ kind: 'audioinput', deviceId, label }) as MediaDeviceInfo

  it('mantém o ID salvo quando ainda existe', async () => {
    expect(
      await resolverEntradaSelecionada('antigo', 'Headset', async () => [
        entrada('antigo', 'Headset')
      ])
    ).toBe('antigo')
  })

  it('encontra o mesmo microfone pelo nome quando o ID mudou', async () => {
    expect(
      await resolverEntradaSelecionada('antigo', 'Headset', async () => [
        entrada('novo', 'Headset')
      ])
    ).toBe('novo')
  })

  it('não escolhe outro microfone silenciosamente', async () => {
    await expect(
      resolverEntradaSelecionada('antigo', 'Headset', async () => [entrada('outro', 'Placa-mãe')])
    ).rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('pede nova escolha quando o ID mudou e a preferência antiga não tem nome', async () => {
    await expect(
      resolverEntradaSelecionada('antigo', undefined, async () => [entrada('novo', 'Headset')])
    ).rejects.toMatchObject({ name: 'NotFoundError' })
  })
})

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
  it('passa o pré-roll e a fala imediata ao mesmo turno sem reabrir o microfone', async () => {
    const w = webAudioFalso()
    const captura = await abrirCapturaContinua('headset-2', vi.fn(), w.deps)
    for (let i = 0; i < 8; i++) w.falarComOMicrofone(0.1)

    const turno = captura.iniciarTurno()
    const pararTurno = await turno.capturar()
    w.falarComOMicrofone(0.8)
    const pcm = await pararTurno()

    expect(pcm.length).toBe(24_000 + 3 * TAMANHO_DO_BLOCO)
    expect(pcm[0]).toBe(3277)
    expect(pcm.at(-1)).toBe(26214)
    expect(w.abrirStream).toHaveBeenCalledTimes(1)
    await captura.parar()
  })

  it('descarta o turno sem guardar PCM quando a navegação falha', async () => {
    const w = webAudioFalso()
    const captura = await abrirCapturaContinua(undefined, vi.fn(), w.deps)
    w.falarComOMicrofone(0.1)
    const turno = captura.iniciarTurno()
    turno.cancelar()
    expect((await (await turno.capturar())()).length).toBe(0)
    await captura.parar()
  })

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

  it('kill switch descarta também o áudio do turno que já estava em memória', async () => {
    const w = webAudioFalso()
    const captura = await abrirCapturaContinua(undefined, vi.fn(), w.deps)
    w.falarComOMicrofone(0.5)
    const encerrarTurno = await captura.iniciarTurno().capturar()

    await captura.parar()

    expect((await encerrarTurno()).length).toBe(0)
  })

  it('parar duas vezes não fecha o contexto duas vezes', async () => {
    const w = webAudioFalso()
    const captura = await abrirCapturaContinua(undefined, vi.fn(), w.deps)

    await captura.parar()
    await captura.parar()

    expect(w.contexto.close).toHaveBeenCalledTimes(1)
  })
})
