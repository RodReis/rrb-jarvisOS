/**
 * Quando o turno aberto pela escuta termina (SPEC-Escuta-01, critério 13).
 *
 * Depois de um disparo o app grava sem botão para soltar, então alguém tem de decidir o fim. Três
 * vereditos, a partir do nível RMS que a captura já mede:
 *
 *  - **cancelar** — ninguém falou em `semFalaMs` (3 s, da SPEC): o turno volta a `ocioso` e nada é
 *    transcrito nem perguntado. Disparo sem fala não custa uma chamada de IA.
 *  - **fim** — houve fala e depois `silencioMs` de silêncio: grava o que houver e transcreve.
 *  - **fim no teto** — a fala não parou: o teto impede o microfone aberto indefinidamente.
 *
 * Os números de nível e de silêncio **não foram calibrados com voz real**; são o ponto de partida
 * para o teste físico do PI, e por isso são parâmetros nomeados e não literais soltos.
 */

export interface ConfigDoFimDaFala {
  /** Nível RMS (escala Int16) a partir do qual há fala. Abaixo disso é ruído de fundo. */
  readonly limiarRms?: number
  /** Sem fala neste prazo, cancela (3 s, decisão da SPEC). */
  readonly semFalaMs?: number
  /** Silêncio, depois de falar, que encerra o enunciado. */
  readonly silencioMs?: number
  /** Duração máxima do turno gravado. */
  readonly tetoMs?: number
}

export const LIMIAR_DE_FALA_RMS = 1_200
export const SEM_FALA_MS = 3_000
export const SILENCIO_DE_FIM_MS = 1_500
export const TETO_DA_GRAVACAO_MS = 30_000

export type VereditoDoFim = 'continua' | 'fim' | 'cancelar'

export function criarDetectorDeFimDaFala(config: ConfigDoFimDaFala = {}): {
  /** `agoraMs` é o tempo desde o início da gravação. */
  readonly alimentar: (nivelRms: number, agoraMs: number) => VereditoDoFim
} {
  const limiar = config.limiarRms ?? LIMIAR_DE_FALA_RMS
  const semFala = config.semFalaMs ?? SEM_FALA_MS
  const silencio = config.silencioMs ?? SILENCIO_DE_FIM_MS
  const teto = config.tetoMs ?? TETO_DA_GRAVACAO_MS
  let ultimoFalado: number | undefined

  return {
    alimentar(nivelRms, agoraMs) {
      if (nivelRms >= limiar) ultimoFalado = agoraMs
      if (agoraMs >= teto) return 'fim'
      if (ultimoFalado === undefined) return agoraMs >= semFala ? 'cancelar' : 'continua'
      return agoraMs - ultimoFalado >= silencio ? 'fim' : 'continua'
    }
  }
}
