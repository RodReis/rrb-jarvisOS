/**
 * O executor de mentira que percorre todos os desfechos (SPEC-Multi-Executor-01, critério 1).
 *
 * Exportado do código de produção, e não escondido num arquivo de teste, porque F02 e F03
 * vão reusá-lo: o contract test do adapter do Codex precisa comparar o comportamento real
 * com um comportamento de referência, e duas cópias do fake é onde uma delas fica para trás.
 *
 * O que ele permite controlar é exatamente o que o contrato promete tolerar: a sequência de
 * eventos (incluindo duplicado, fora de ordem e desconhecido), o atraso entre eles (para o
 * timeout ter o que interromper) e se o processo **resiste** ao cancelamento (para provar que
 * quem o encerra é o runtime, não a boa vontade do executor).
 */

import type {
  CodingExecutorAdapter,
  ExecutorEvent,
  ExecutorRequest,
  ModoDeCobranca
} from './executor'

export interface RoteiroDoFake {
  /** Os eventos a emitir, na ordem dada — inclusive uma ordem inválida de propósito. */
  readonly eventos: readonly ExecutorEvent[]
  /**
   * Espera antes de **cada** evento, em ms.
   *
   * Existe para o teste de timeout: um fake que responde instantâneo nunca dá ao relógio
   * o que interromper, e o teste passaria sem medir nada.
   */
  readonly atrasoMs?: number
  /**
   * `true` faz o fake **ignorar** o `signal` e seguir emitindo.
   *
   * É o dublê do processo que não colabora, e é o que dá sentido ao critério 3: se o fake
   * terminasse sozinho ao ver o sinal, o teste do cancelamento provaria a educação do fake
   * em vez da eficácia do runtime.
   */
  readonly ignoraCancelamento?: boolean
  /** Lança em vez de emitir, para o caminho de exceção do adapter. */
  readonly lancaAntesDeEmitir?: string
  readonly modosSuportados?: readonly ModoDeCobranca[]
  readonly revisoesSuportadas?: readonly string[]
  readonly suportaSchemaDeSaida?: boolean
  readonly estaDisponivel?: boolean
}

export class FakeCodingExecutorAdapter implements CodingExecutorAdapter {
  readonly nome = 'fake'
  readonly modosSuportados: readonly ModoDeCobranca[]
  readonly revisoesSuportadas: readonly string[]
  readonly suportaSchemaDeSaida: boolean

  /**
   * Quantas vezes `executar` foi chamado.
   *
   * O contract test o usa para provar o critério 4 pelo lado negativo: request recusado
   * deixa este contador em zero, e um contador que sobe prova que o CLI iniciou antes da
   * recusa — que é o defeito que o critério existe para fechar.
   */
  chamadasDeExecucao = 0
  /** Os requests recebidos, para o teste do critério 5 inspecionar o que **não** chegou. */
  readonly requestsRecebidos: ExecutorRequest[] = []
  /** Quantas vezes o fake observou o sinal de cancelamento disparar. */
  cancelamentosObservados = 0

  constructor(private readonly roteiro: RoteiroDoFake) {
    this.modosSuportados = roteiro.modosSuportados ?? ['unmetered']
    this.revisoesSuportadas = roteiro.revisoesSuportadas ?? ['revisao-padrao']
    this.suportaSchemaDeSaida = roteiro.suportaSchemaDeSaida ?? true
  }

  async disponivel(): Promise<boolean> {
    return this.roteiro.estaDisponivel ?? true
  }

  async *executar(request: ExecutorRequest): AsyncIterable<ExecutorEvent> {
    this.chamadasDeExecucao += 1
    this.requestsRecebidos.push(request)

    if (this.roteiro.lancaAntesDeEmitir !== undefined) {
      throw new Error(this.roteiro.lancaAntesDeEmitir)
    }

    const atraso = this.roteiro.atrasoMs ?? 0

    for (const evento of this.roteiro.eventos) {
      if (atraso > 0) {
        await new Promise((resolve) => setTimeout(resolve, atraso))
      }

      if (request.signal?.aborted === true) {
        this.cancelamentosObservados += 1
        // Sem `ignoraCancelamento`, o fake para — é o executor colaborativo. Com ele, segue
        // emitindo, e o encerramento tem de vir do runtime.
        if (this.roteiro.ignoraCancelamento !== true) return
      }

      yield evento
    }
  }
}
