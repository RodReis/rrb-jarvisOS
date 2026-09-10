export interface MedidorDeEntrada {
  readonly nivelRms: () => number
  readonly parar: () => Promise<void>
}

export interface DepsDoMedidor {
  readonly abrirStream: (deviceId: string) => Promise<MediaStream>
  readonly criarContexto: () => AudioContext
}

export async function criarMedidorDeEntrada(
  deviceId: string,
  deps?: DepsDoMedidor
): Promise<MedidorDeEntrada> {
  const abrirStream =
    deps?.abrirStream ??
    ((id: string) => navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: id } } }))
  const criarContexto = deps?.criarContexto ?? (() => new AudioContext())
  const stream = await abrirStream(deviceId)
  const contexto = criarContexto()
  const analisador = contexto.createAnalyser()
  analisador.fftSize = 1024
  contexto.createMediaStreamSource(stream).connect(analisador)
  const amostras = new Float32Array(analisador.fftSize)
  let parado = false

  return {
    nivelRms: () => {
      if (parado) return 0
      analisador.getFloatTimeDomainData(amostras)
      let soma = 0
      for (const amostra of amostras) soma += amostra * amostra
      return Math.round(Math.sqrt(soma / amostras.length) * 32_767)
    },
    parar: async () => {
      if (parado) return
      parado = true
      stream.getTracks().forEach((trilha) => trilha.stop())
      await contexto.close()
    }
  }
}
