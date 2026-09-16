/**
 * A recusa que acontece **antes** de o CLI iniciar (SPEC-Multi-Executor-01, critério 4).
 *
 * Por que antes importa: modo de cobrança errado descoberto no meio do stream é custo já
 * gasto; revisão desconhecida descoberta lá é trabalho já feito sob regra que ninguém
 * aprovou; schema que o executor não impõe descoberto lá é saída que já nasceu fora de
 * forma. Nos três casos a informação para decidir já existe antes do spawn — o que faltava
 * era um lugar que a olhasse.
 *
 * Pura, e separada do runtime, porque é a parte do critério 4 que se prova sem processo: a
 * decisão é comparar o que o request pede com o que o adapter declara.
 */

import type { CodingExecutorAdapter, ExecutorRequest } from './executor'

/** Por que o runtime recusou. O motivo é o que a auditoria agrupa; a mensagem, o que o PI lê. */
export interface Recusa {
  readonly motivo: 'executor' | 'modo-de-cobranca' | 'revisao' | 'schema'
  readonly mensagem: string
}

/**
 * Devolve a recusa, ou `undefined` quando o request é compatível.
 *
 * Nunca lança: recusa é desfecho previsto, não exceção — o runtime a transforma em
 * `ExecutorResult` com status `recusado`, e um throw obrigaria cada chamador a lembrar de
 * traduzi-lo.
 *
 * **A mensagem nunca cita `autenticacao`.** Nem a referência é segredo, mas mensagem de erro
 * é o caminho por onde dado sensível vaza para log e tela, e nada aqui precisa dela para
 * explicar uma incompatibilidade de modo, revisão ou schema.
 */
export function validarRequest(
  request: ExecutorRequest,
  adapter: CodingExecutorAdapter
): Recusa | undefined {
  if (request.executor !== adapter.nome) {
    return {
      motivo: 'executor',
      mensagem: `O pedido é para o executor ${request.executor}, e este adapter atende ${adapter.nome}.`
    }
  }

  if (!adapter.modosSuportados.includes(request.modoDeCobranca)) {
    return {
      motivo: 'modo-de-cobranca',
      mensagem: `O executor ${adapter.nome} não atende o modo de cobrança ${request.modoDeCobranca}. Modos aceitos: ${adapter.modosSuportados.join(', ')}.`
    }
  }

  const revisoesDesconhecidas = request.revisoesAprovadas.filter(
    (revisao) => !adapter.revisoesSuportadas.includes(revisao)
  )
  if (revisoesDesconhecidas.length > 0) {
    return {
      motivo: 'revisao',
      mensagem: `O executor ${adapter.nome} não conhece a revisão ${revisoesDesconhecidas.join(', ')}. Revisões aceitas: ${adapter.revisoesSuportadas.join(', ')}.`
    }
  }

  // Só recusa quando o schema **existe** e o executor não o impõe. Ausência de schema com
  // executor que não o suporta é o caso normal — recusá-lo barraria toda execução de saída
  // livre num executor que nunca prometeu schema.
  if (request.schemaDeSaida !== undefined && !adapter.suportaSchemaDeSaida) {
    return {
      motivo: 'schema',
      mensagem: `O executor ${adapter.nome} não impõe schema de saída, e este pedido declara um.`
    }
  }

  return undefined
}
