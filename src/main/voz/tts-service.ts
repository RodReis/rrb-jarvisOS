/**
 * O serviço de síntese que o IPC chama (SPEC-Voz-02).
 *
 * Fica entre a ponte e o engine. Não conhece Piper, Python nem processo — recebe o `TtsEngine`
 * injetado (critério 1) e traduz cada chamada num desfecho que a tela sabe desenhar.
 *
 * **O áudio não fica.** O PCM sintetizado atravessa a ponte e sai de escopo com a chamada: não há
 * campo, cache nem "última fala para repetir" (critério 8). O serviço é vivo entre chamadas, então
 * guardar aqui seria exatamente o modo de o áudio sobreviver à fala.
 */

import { falar, type DesfechoDaFala, type TtsEngine } from './tts-engine'
import type { ProntidaoDoTts } from '@shared/domain/visemes'

export interface DepsDoTts {
  readonly engine: TtsEngine
  /** Os ids dos artefatos de voz que ainda faltam no disco. Vazio = há voz para falar. */
  readonly vozesFaltando: () => readonly string[]
}

export class TtsService {
  constructor(private readonly deps: DepsDoTts) {}

  /** Sintetiza um enunciado. O áudio volta no desfecho e não fica aqui. */
  async falar(texto: string, voz: string): Promise<DesfechoDaFala> {
    return falar(this.deps.engine, texto, voz)
  }

  /**
   * O que falta para o app falar, e quais vozes já dão para escolher.
   *
   * As vozes instaladas vêm junto porque Settings precisa das duas coisas na mesma resposta: o que
   * baixar e o que já dá para ouvir no preview (critério 5). Duas chamadas separadas abririam a
   * janela em que a lista e o estado discordam.
   */
  async prontidao(): Promise<ProntidaoDoTts> {
    const faltando = this.deps.vozesFaltando()
    const instaladas = await this.deps.engine.vozes()

    return { pronta: instaladas.length > 0, faltando, vozes: instaladas }
  }
}
