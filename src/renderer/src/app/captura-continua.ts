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
const AMOSTRAS_PRE_ROLL = 24_000
const AMOSTRAS_MAXIMAS_DO_TURNO = TAXA * 120 + AMOSTRAS_PRE_ROLL

export interface CapturaDoTurno {
  /** Usa o stream já aberto; devolve o PCM acumulado ao encerrar. */
  readonly capturar: (
    deviceId?: string,
    onNivelRms?: (nivel: number) => void
  ) => Promise<() => Promise<Int16Array>>
  /** Descarta o áudio se não houve quem conduzisse o turno. */
  readonly cancelar: () => void
}

export interface CapturaContinua {
  /** Fecha as trilhas do stream, o contexto de áudio e para de entregar blocos. Idempotente. */
  readonly parar: () => Promise<void>
  /** Reserva o pré-roll imediatamente ao disparar, antes da navegação para o Command Center. */
  readonly iniciarTurno: () => CapturaDoTurno
}

export interface DepsDaCapturaContinua {
  readonly abrirStream: (deviceId: string | undefined) => Promise<MediaStream>
  readonly criarContexto: () => AudioContext
}

/** IDs do Chromium podem mudar entre sessões; só recupera a escolha quando o nome é único. */
export async function resolverEntradaSelecionada(
  deviceId: string | undefined,
  rotulo: string | undefined,
  listar = () => navigator.mediaDevices.enumerateDevices()
): Promise<string | undefined> {
  if (!deviceId) return undefined
  const entradas = (await listar()).filter((dispositivo) => dispositivo.kind === 'audioinput')
  if (entradas.some((dispositivo) => dispositivo.deviceId === deviceId)) return deviceId
  const mesmoNome = rotulo ? entradas.filter((dispositivo) => dispositivo.label === rotulo) : []
  if (mesmoNome.length === 1) return mesmoNome[0].deviceId
  throw new DOMException('O microfone escolhido não está disponível.', 'NotFoundError')
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
        echoCancellation: true,
        // A placa decide a taxa e os canais da captura. O AudioContext abaixo converte para
        // 16 kHz mono; exigir isso também do dispositivo pode impedir sua abertura no Windows.
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
  const historico = new Int16Array(AMOSTRAS_PRE_ROLL)
  let posicao = 0
  let preenchimento = 0
  let turno:
    | {
        pedacos: Int16Array[]
        tamanho: number
        onNivelRms?: (nivel: number) => void
      }
    | undefined

  const empacotar = criarEmpacotador((bloco) => {
    for (const amostra of bloco) {
      historico[posicao] = amostra
      posicao = (posicao + 1) % AMOSTRAS_PRE_ROLL
      preenchimento = Math.min(AMOSTRAS_PRE_ROLL, preenchimento + 1)
    }
    if (turno !== undefined) {
      if (turno.tamanho + bloco.length <= AMOSTRAS_MAXIMAS_DO_TURNO) {
        turno.pedacos.push(bloco)
        turno.tamanho += bloco.length
      }
      if (turno.onNivelRms) {
        let soma = 0
        for (const amostra of bloco) soma += amostra * amostra
        turno.onNivelRms(Math.round(Math.sqrt(soma / bloco.length)))
      }
    }
    aoBloco(bloco)
  })

  processador.onaudioprocess = (evento) => {
    // Depois de parar, o que ainda estiver em voo não pode sair: o kill switch vale na hora.
    if (parado) return
    empacotar(evento.inputBuffer.getChannelData(0))
  }

  fonte.connect(processador)
  processador.connect(contexto.destination)

  return {
    iniciarTurno: () => {
      const anterior = new Int16Array(preenchimento)
      const inicio = (posicao - preenchimento + AMOSTRAS_PRE_ROLL) % AMOSTRAS_PRE_ROLL
      for (let i = 0; i < preenchimento; i++) {
        anterior[i] = historico[(inicio + i) % AMOSTRAS_PRE_ROLL]
      }
      const atual = {
        pedacos: [anterior],
        tamanho: anterior.length,
        onNivelRms: undefined as ((nivel: number) => void) | undefined
      }
      turno = atual
      return {
        capturar: async (_deviceId, onNivelRms) => {
          atual.onNivelRms = onNivelRms
          return async () => {
            if (turno === atual) turno = undefined
            const resultado = new Int16Array(atual.tamanho)
            let indice = 0
            for (const pedaco of atual.pedacos) {
              resultado.set(pedaco, indice)
              indice += pedaco.length
            }
            atual.pedacos = []
            atual.tamanho = 0
            return resultado
          }
        },
        cancelar: () => {
          if (turno === atual) turno = undefined
          atual.pedacos = []
          atual.tamanho = 0
        }
      }
    },
    parar: async () => {
      if (parado) return
      parado = true
      historico.fill(0)
      preenchimento = 0
      if (turno) {
        turno.pedacos = []
        turno.tamanho = 0
        turno = undefined
      }
      processador.disconnect()
      fonte.disconnect()
      for (const trilha of stream.getTracks()) trilha.stop()
      await contexto.close()
    }
  }
}
