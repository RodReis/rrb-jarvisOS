/**
 * O registro de adapters (SPEC-Conectores-01, critérios 1 e 6).
 *
 * **Registro explícito; nenhuma resolução arbitrária por URL** — é o que a spec exige, e é o
 * que impede o proxy HTTP genérico do critério 6. A diferença prática entre as duas coisas: um
 * proxy recebe um endereço e o alcança; este registro recebe um `ConnectorId` de uma lista
 * fechada e devolve o adapter que alguém registrou no main. Um valor que a UI escolhe nunca
 * vira destino de rede.
 *
 * O mapa é montado no bootstrap e lido depois: adicionar conector é registrar no lugar onde os
 * outros são registrados, não descobrir em runtime.
 */

import type { ConnectorCapability, ConnectorId } from '@shared/domain/connectors'
import type { ConnectorAdapter } from './adapter'

export class ConnectorRegistry {
  private readonly adapters = new Map<ConnectorId, ConnectorAdapter>()

  /**
   * Registra um adapter.
   *
   * Recusa a segunda inscrição do mesmo `ConnectorId` em vez de sobrescrever: dois adapters
   * para o mesmo conector é erro de bootstrap, e sobrescrever em silêncio faria a ordem de
   * carregamento decidir qual deles atende — o tipo de bug que só aparece quando a ordem muda.
   */
  register(adapter: ConnectorAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Conector "${adapter.id}" já registrado.`)
    }
    this.adapters.set(adapter.id, adapter)
  }

  /** O adapter, ou `undefined` quando ninguém registrou aquele conector. */
  resolve(id: ConnectorId): ConnectorAdapter | undefined {
    return this.adapters.get(id)
  }

  /**
   * A capacidade pedida, ou `undefined` quando o adapter não a declara.
   *
   * Consulta em memória, sobre a lista **declarada** pelo adapter: é isto que permite recusar
   * antes de qualquer I/O (critério 1). Conector não registrado também devolve `undefined` —
   * quem distingue os dois casos é o serviço, que tem o erro certo para cada um.
   */
  capability(id: ConnectorId, operation: string): ConnectorCapability | undefined {
    return this.adapters
      .get(id)
      ?.capacidades()
      .find((c) => c.operation === operation)
  }

  /**
   * Todas as capacidades registradas — o que a ponte expõe ao renderer (critério 5).
   *
   * A UI precisa saber o que **pode** pedir, e a alternativa a listar seria deixá-la tentar e
   * ver o que acontece: cada recusa viraria uma ida ao main para descobrir algo que já se sabe
   * de antemão. Devolve `ConnectorCapability`, que é metadado — nome, efeito e descrição —, sem
   * nada do adapter concreto atrás dele.
   */
  capabilities(): readonly ConnectorCapability[] {
    return [...this.adapters.values()].flatMap((a) => [...a.capacidades()])
  }

  /** Os conectores que têm adapter registrado. */
  registered(): readonly ConnectorId[] {
    return [...this.adapters.keys()]
  }
}
