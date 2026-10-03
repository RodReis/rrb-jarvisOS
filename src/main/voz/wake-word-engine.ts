/**
 * O contrato do engine de wake word (SPEC-Escuta-01, critério 1).
 *
 * O app fala com `WakeWordEngine`, nunca diretamente com openWakeWord. Trocar de engine
 * é escrever outra implementação e injetá-la — não é refatoração de quem consome (invariante do épico #194).
 * Nenhum import de openWakeWord fora da implementação (guarda de lint).
 *
 * ## Pré-roll e fluxo de áudio
 *
 * O engine processa blocos PCM 16 kHz mono. Ao detectar a palavra de ativação ("Ei, amigo"),
 * ele emite o evento `EventoWakeWordDetectado` com a confiança medida e o timestamp em ms.
 *
 * ## Sensibilidade em tempo de execução
 *
 * O limiar é configurável em Settings e vale na detecção seguinte, sem restart (critério 12).
 */

export interface EventoWakeWordDetectado {
  /** Confiança da detecção em [0, 1]. */
  readonly confianca: number
  /** Momento do fim da frase da wake word (timestamp em ms). */
  readonly fimDaFraseMs: number
}

/**
 * Interface abstrata do detector de wake word.
 */
export interface WakeWordEngine {
  /**
   * Processa um bloco de áudio PCM 16 kHz mono.
   * Devolve o evento de detecção se o limiar foi atingido, ou null caso contrário.
   */
  readonly alimentar: (pcm: Int16Array) => Promise<EventoWakeWordDetectado | null>

  /** Se o interpretador Python e o modelo .onnx estão no disco prontos para uso. */
  readonly disponivel: () => Promise<boolean>

  /** Define o limiar de sensibilidade [0, 1]. Vale na chamada seguinte sem restart. */
  readonly definirLimiar: (limiar: number) => void

  /** Devolve o limiar atual configurado. */
  readonly obterLimiar: () => number

  /** Encerra o processo ou recursos mantidos vivos pelo engine. Idempotente. */
  readonly encerrar: () => Promise<void>
}

/** Limiares e constantes da escuta (SPEC-Escuta-01). */
export const LIMIAR_PADRAO_WAKE_WORD = 0.5
export const LIMIAR_MINIMO_WAKE_WORD = 0.1
export const LIMIAR_MAXIMO_WAKE_WORD = 0.95

/** Taxa de amostragem padrão (16 kHz mono). */
export const TAXA_AMOSTRAGEM_WAKE_WORD = 16_000

/** Janela de pré-roll em ms (SPEC-Escuta-01, decisões do Cowork). */
export const DURACAO_PRE_ROLL_MS = 1_500
export const AMOSTRAS_PRE_ROLL = (TAXA_AMOSTRAGEM_WAKE_WORD * DURACAO_PRE_ROLL_MS) / 1_000 // 24.000 amostras

/** Cancelamento por silêncio após disparo sem fala (SPEC-Escuta-01, critério 13). */
export const TIMEOUT_SILENCIO_POS_DISPARO_MS = 3_000

export function validarLimiar(limiar: unknown): number {
  if (typeof limiar !== 'number' || !Number.isFinite(limiar)) {
    return LIMIAR_PADRAO_WAKE_WORD
  }
  return Math.min(LIMIAR_MAXIMO_WAKE_WORD, Math.max(LIMIAR_MINIMO_WAKE_WORD, limiar))
}
