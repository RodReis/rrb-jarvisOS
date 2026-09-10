/**
 * A captura do microfone no renderer (SPEC-Voz-01).
 *
 * `getUserMedia` é **Web API**, não Node: a fronteira renderer/Node continua intacta, que é o
 * que o critério 3 exige. O PCM sai daqui em memória e vai pela ponte — nunca toca o disco
 * (critério 8).
 *
 * 16 kHz mono, o formato que o Whisper espera. Reamostrar aqui evita mandar 48 kHz pela ponte
 * para o main jogar fora três de cada quatro amostras.
 */

/** Começa a capturar e devolve a função que encerra e entrega o PCM. */
export type CapturaDeAudio = (
  deviceId?: string,
  onNivelRms?: (nivel: number) => void
) => Promise<() => Promise<Int16Array>>

const TAXA_DO_WHISPER = 16_000

export const capturarPcm: CapturaDeAudio = async (deviceId, onNivelRms) => {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: TAXA_DO_WHISPER,
      echoCancellation: true,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {})
    }
  })

  const contexto = new AudioContext({ sampleRate: TAXA_DO_WHISPER })
  const fonte = contexto.createMediaStreamSource(stream)
  const processador = contexto.createScriptProcessor(4096, 1, 1)
  const pedacos: Float32Array[] = []

  processador.onaudioprocess = (evento) => {
    const pedaco = new Float32Array(evento.inputBuffer.getChannelData(0))
    pedacos.push(pedaco)
    if (onNivelRms) {
      let soma = 0
      for (const amostra of pedaco) soma += amostra * amostra
      onNivelRms(Math.round(Math.sqrt(soma / pedaco.length) * 32_767))
    }
  }

  fonte.connect(processador)
  processador.connect(contexto.destination)

  return async () => {
    processador.disconnect()
    fonte.disconnect()
    // As trilhas param **sempre**: deixar o microfone aberto acenderia o indicador do sistema
    // depois de a gravação ter terminado, o que é pior que um bug — parece escuta.
    for (const trilha of stream.getTracks()) trilha.stop()
    await contexto.close()

    const total = pedacos.reduce((soma, p) => soma + p.length, 0)
    const pcm = new Int16Array(total)
    let i = 0

    for (const pedaco of pedacos) {
      for (const amostra of pedaco) {
        // Float [-1,1] para Int16, com corte nos extremos: sem o clamp, um pico acima de 1
        // daria a volta e viraria silêncio alto — estalo no meio da frase.
        const limitado = Math.max(-1, Math.min(1, amostra))
        pcm[i++] = Math.round(limitado * 32_767)
      }
    }

    return pcm
  }
}
