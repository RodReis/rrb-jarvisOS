/**
 * A captura contínua do microfone para a escuta (SPEC-Escuta-01).
 *
 * `getUserMedia` é Web API do renderer; o PCM sai daqui em memória e segue pela ponte, em blocos de
 * 1280 amostras (80 ms a 16 kHz), o quadro que o detector consome. Nada é guardado além do resto
 * de um bloco incompleto, e nada toca o disco.
 *
 * O que prova o kill switch é `parar()`: ele encerra as **trilhas** do stream. Só isso apaga o
 * indicador de microfone do sistema operacional; desconectar o grafo de áudio e deixar a trilha
 * aberta manteria o microfone ligado com a tela dizendo que não.
 */

/** Um quadro do detector: 1280 amostras a 16 kHz = 80 ms. */
export const TAMANHO_DO_BLOCO = 1280

const TAXA = 16_000

export interface CapturaContinua {
  /** Fecha as trilhas do stream, o contexto de áudio e para de entregar blocos. Idempotente. */
  readonly parar: () => Promise<void>
}

export interface DepsDaCapturaContinua {
  readonly abrirStream: (deviceId: string | undefined) => Promise<MediaStream>
  readonly criarContexto: () => AudioContext
}

/** Junta pedaços de Float32 em blocos Int16 de `TAMANHO_DO_BLOCO`, guardando só o resto. */
export function criarEmpacotador(
  aoBloco: (bloco: Int16Array) => void
): (pedaco: Float32Array) => void {
  let bloco = new Int16Array(TAMANHO_DO_BLOCO)
  let preenchido = 0

  return (pedaco) => {
    for (const amostra of pedaco) {
      // Corte nos extremos: sem o clamp, um pico acima de 1 daria a volta e viraria um estalo.
      bloco[preenchido++] = Math.round(Math.max(-1, Math.min(1, amostra)) * 32_767)
      if (preenchido === TAMANHO_DO_BLOCO) {
        aoBloco(bloco)
        bloco = new Int16Array(TAMANHO_DO_BLOCO)
        preenchido = 0
      }
    }
  }
}

const DEPS_REAIS: DepsDaCapturaContinua = {
  abrirStream: (deviceId) =>
    navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: TAXA,
        echoCancellation: true,
        // O dispositivo escolhido na F05 é exigido: sem o `exact`, o navegador cai no padrão do
        // Windows, que é a placa-mãe e não o headset.
        ...(deviceId ? { deviceId: { exact: deviceId } } : {})
      }
    }),
  criarContexto: () => new AudioContext({ sampleRate: TAXA })
}

export async function abrirCapturaContinua(
  deviceId: string | undefined,
  aoBloco: (bloco: Int16Array) => void,
  deps: DepsDaCapturaContinua = DEPS_REAIS
): Promise<CapturaContinua> {
  const stream = await deps.abrirStream(deviceId)
  const contexto = deps.criarContexto()
  const fonte = contexto.createMediaStreamSource(stream)
  const processador = contexto.createScriptProcessor(4096, 1, 1)
  let parado = false
  const empacotar = criarEmpacotador(aoBloco)

  processador.onaudioprocess = (evento) => {
    // Depois de parar, o que ainda estiver em voo não pode sair: o kill switch vale na hora.
    if (parado) return
    empacotar(evento.inputBuffer.getChannelData(0))
  }

  fonte.connect(processador)
  processador.connect(contexto.destination)

  return {
    parar: async () => {
      if (parado) return
      parado = true
      processador.disconnect()
      fonte.disconnect()
      for (const trilha of stream.getTracks()) trilha.stop()
      await contexto.close()
    }
  }
}
