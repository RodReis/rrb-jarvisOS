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
import type { ConfiguracaoDaVoz } from './configuracao'
import type { ModoDeCompute, ProntidaoDaVoz } from '@shared/domain/voz'

export interface DepsDaVoz {
  readonly engine: SttEngine
  /**
   * Os ids dos artefatos que ainda faltam no disco. Vazio = tudo pronto.
   *
   * Assíncrona porque a resposta vem do **disco**, e não de uma anotação em memória: anotação e
   * realidade divergem — o usuário apaga a pasta, um download morre pela metade — e quando
   * divergem é a anotação que ganha, prometendo um runtime que não está lá.
   */
  readonly artefatosFaltando: () => Promise<readonly string[]>
  readonly computeAtual: () => ModoDeCompute
  /** A configuração em vigor, lida do disco. */
  readonly configuracaoAtual: () => Promise<ConfiguracaoDaVoz>
  /** Grava a configuração escolhida em Settings (critério 6). */
  readonly gravarConfiguracao: (pedida: Partial<ConfiguracaoDaVoz>) => Promise<ConfiguracaoDaVoz>
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
    const faltando = await this.deps.artefatosFaltando()

    return { pronta: faltando.length === 0, faltando, compute: this.deps.computeAtual() }
  }

  /** O modelo e o idioma em vigor, para Settings desenhar o estado atual. */
  async configuracao(): Promise<ConfiguracaoDaVoz> {
    return this.deps.configuracaoAtual()
  }

  /**
   * Troca modelo ou idioma, e devolve o que ficou valendo (critério 6).
   *
   * Devolve a configuração inteira e não `void` porque o pedido é **normalizado** ao gravar: a
   * tela precisa saber o que de fato valeu, e não repetir a normalização do seu lado para
   * adivinhar.
   */
  async configurar(pedida: Partial<ConfiguracaoDaVoz>): Promise<ConfiguracaoDaVoz> {
    return this.deps.gravarConfiguracao(pedida)
  }
}
