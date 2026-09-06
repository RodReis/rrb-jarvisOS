/**
 * O serviço de voz que o IPC chama (SPEC-Voz-01).
 *
 * Fica entre a ponte e o engine. Não conhece Whisper, Python nem processo — recebe o `SttEngine`
 * injetado (critério 1) e traduz cada chamada num desfecho que a tela sabe desenhar.
 *
 * **O áudio não fica.** O PCM entra como argumento e sai de escopo com a chamada: não há campo,
 * cache nem "último buffer para debug" (critério 8, e a spec cravou que retenção para debug fica
 * de fora). O serviço é vivo entre chamadas, então guardar aqui seria exatamente o modo de o
 * áudio sobreviver à transcrição.
 */

import { transcrever, type SttEngine, type DesfechoDaTranscricao } from './stt-engine'
import type { ModoDeCompute, ProntidaoDaVoz } from '@shared/domain/voz'

export interface DepsDaVoz {
  readonly engine: SttEngine
  /** Os ids dos artefatos que ainda faltam no disco. Vazio = tudo pronto. */
  readonly artefatosFaltando: () => readonly string[]
  readonly computeAtual: () => ModoDeCompute
}

export class VozService {
  constructor(private readonly deps: DepsDaVoz) {}

  /** Transcreve um enunciado. O PCM é do chamador e some com a chamada. */
  async transcrever(pcm: Int16Array): Promise<DesfechoDaTranscricao> {
    return transcrever(this.deps.engine, pcm)
  }

  /**
   * O que falta para a voz funcionar, e como ela vai calcular.
   *
   * A lista de faltantes vem junto de propósito: um booleano `pronta: false` obrigaria a tela a
   * adivinhar **o que** baixar, e a primeira execução do app é exatamente quando ela precisa
   * dizer isso ao usuário (critério 4).
   */
  async prontidao(): Promise<ProntidaoDaVoz> {
    const faltando = this.deps.artefatosFaltando()

    return { pronta: faltando.length === 0, faltando, compute: this.deps.computeAtual() }
  }
}
