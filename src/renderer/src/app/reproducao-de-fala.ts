/**
 * A reprodução da fala no renderer (SPEC-Voz-02, critérios 6 e 7).
 *
 * Web Audio é **Web API**, não Node: a fronteira renderer/Node continua intacta, que é o mesmo
 * motivo pelo qual a captura do microfone mora no renderer. O PCM chega pela ponte, vira um buffer
 * em memória e toca — nunca toca o disco (critério 8).
 *
 * ## Por que a reprodução não é um canal de IPC
 *
 * Pôr o main no caminho do som faria `cancel()` atravessar a ponte para parar uma fonte que já
 * está deste lado. Aqui, cancelar é `stop()` na fonte que o próprio módulo segura — imediato, e
 * sem uma ida e volta que o usuário ouviria como atraso.
 *
 * ## Uma fala por vez
 *
 * O critério 7 pede que nova fala cancele a anterior, nunca duas simultâneas. A garantia é a
 * fonte única: começar a tocar para a que estiver tocando, por construção. Uma fila resolveria
 * outro problema — o de não perder falas —, mas a spec cravou que fila e prioridade são da F03.
 */

import type { SpeechHandle } from '@shared/domain/visemes'

export interface FalaEmCurso {
  /** Para a fala imediatamente. Idempotente: chamar duas vezes não estoura. */
  readonly cancelar: () => void
  /** Resolve quando o áudio termina, ou imediatamente se foi cancelado. */
  readonly terminou: Promise<void>
}

/** O que este módulo precisa do ambiente. Injetado para o teste rodar sem Web Audio real. */
export interface DepsDaReproducao {
  readonly criarContexto: () => AudioContext
}

export function criarReprodutor(deps?: DepsDaReproducao): {
  tocar: (fala: SpeechHandle) => FalaEmCurso
  cancelar: () => void
} {
  const criarContexto = deps?.criarContexto ?? ((): AudioContext => new AudioContext())

  let emCurso:
    { fonte: AudioBufferSourceNode; contexto: AudioContext; parar: () => void } | undefined

  function cancelar(): void {
    const atual = emCurso
    emCurso = undefined
    atual?.parar()
  }

  return {
    cancelar,

    tocar(fala: SpeechHandle): FalaEmCurso {
      // **Antes** de criar a nova: se a anterior continuasse, as duas sairiam pelo mesmo
      // destino e o usuário ouviria as vozes sobrepostas (critério 7).
      cancelar()

      const contexto = criarContexto()
      const buffer = contexto.createBuffer(1, fala.pcm.length, fala.sampleRate)
      const canal = buffer.getChannelData(0)

      // Int16 de volta para float [-1, 1]. A divisão é por 32768 e não por 32767 pela mesma razão
      // do lado da captura: é o valor absoluto do mínimo do Int16.
      for (let i = 0; i < fala.pcm.length; i++) canal[i] = fala.pcm[i] / 32_768

      const fonte = contexto.createBufferSource()
      fonte.buffer = buffer
      fonte.connect(contexto.destination)

      let encerrado = false
      let resolver: () => void = () => {}
      const terminou = new Promise<void>((r) => {
        resolver = r
      })

      const parar = (): void => {
        if (encerrado) return
        encerrado = true
        try {
          fonte.stop()
        } catch {
          // `stop()` numa fonte que já terminou lança. Não é erro: o objetivo — não estar
          // tocando — já está cumprido.
        }
        fonte.disconnect()
        // O contexto é fechado **sempre**, inclusive no cancelamento: cada fala abre um, e
        // deixá-los abertos acumularia contextos de áudio a cada frase até o navegador recusar
        // criar o próximo.
        void contexto.close()
        resolver()
      }

      fonte.onended = () => {
        if (emCurso?.fonte === fonte) emCurso = undefined
        parar()
      }

      emCurso = { fonte, contexto, parar }
      fonte.start()

      return { cancelar: parar, terminou }
    }
  }
}
