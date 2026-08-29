/**
 * A interface de adapter de conector (SPEC-Conectores-01, critérios 1, 2 e 4).
 *
 * O contrato que mantém o núcleo ignorante do serviço concreto: o serviço de conectores conhece
 * `ConnectorAdapter`, nunca `Octokit` nem o cliente da Tavily. Acrescentar um conector (F03–F06)
 * é escrever outra implementação disto e registrá-la — não tocar o ponto de chamada.
 *
 * É o mesmo desenho do `AiAdapter` da M5-F02, e a semelhança é deliberada: os dois runtimes são
 * **separados** (decisão do PI de 2026-08-29), mas a lição que fez o multi-provider da M5-F04
 * caber sem mexer no ponto de chamada vale igual aqui. O que **não** se repete é a forma do
 * método — stream de chunks lá, desfecho único aqui —, e é exatamente essa incompatibilidade
 * que sustentou a decisão de não unificar os dois.
 *
 * Três métodos, e nenhum a mais (YAGNI, como o método único do `AiAdapter`): declarar o que
 * sabe fazer, validar a entrada da operação e executar. `health`, `retry` e custo são da F02 e
 * não têm consumidor aqui — interface que já nasce larga é onde a segunda implementação
 * descobre que metade dos métodos não fazia sentido para ela.
 */

import type {
  ConnectorCapability,
  ConnectorError,
  ConnectorId,
  ConnectorRequest,
  ConnectorResult
} from '@shared/domain/connectors'

/**
 * O que o adapter recebe para executar. Já resolvido: pedido validado na forma, capacidade
 * conferida, credencial (quando há) obtida.
 *
 * `secret` é o material da credencial, cru, entregue **por parâmetro** — pela mesma razão do
 * `apiKey` do `AdapterRequest` (M5-F02): quem decide qual escopo de credencial usar é o ponto
 * de chamada, que conhece usuário e espaço. Um adapter que lesse o cofre sozinho seria mais um
 * lugar onde o segredo é buscado, e a garantia estrutural da M5-F01 dependeria de disciplina em
 * vez da forma dos tipos.
 *
 * Ausente quando a operação não precisa de credencial. Opcional e não string vazia: `''`
 * obrigaria cada adapter a decidir se aquilo é "sem credencial" ou "credencial em branco".
 */
export interface ConnectorExecution {
  readonly request: ConnectorRequest
  readonly capability: ConnectorCapability
  readonly secret?: string
  /** Aborta a chamada (timeout da F02, ou o usuário fechando a tela). */
  readonly signal?: AbortSignal
}

/**
 * Um conector externo, reduzido ao que o núcleo precisa.
 */
export interface ConnectorAdapter {
  /** Identificador do conector — o mesmo valor de `ConnectorId`. */
  readonly id: ConnectorId

  /**
   * O que este adapter sabe fazer.
   *
   * **Declarado e não descoberto** (critério 1): o núcleo compara o pedido com esta lista e
   * recusa o que não está nela **antes** de qualquer I/O. Uma lista obtida do serviço externo
   * exigiria uma chamada de rede para saber se a chamada é permitida — e a recusa deixaria de
   * ser gratuita.
   */
  capacidades(): readonly ConnectorCapability[]

  /**
   * Valida o `input` daquela operação (critério 2).
   *
   * Mora no adapter porque a forma do payload pertence à operação: só quem conhece
   * `issues.create` sabe que ela precisa de repositório e título. O núcleo valida o envelope
   * (versão, conector, timeout, idempotência) e delega o miolo — e é a soma dos dois que faz
   * "request inválida não chega ao adapter" valer sem o núcleo saber de GitHub.
   *
   * Devolve o erro em vez de lançar, como `validarConnectorRequest`: recusar é caminho normal.
   */
  validar(execution: ConnectorExecution): ConnectorError | undefined

  /**
   * Executa a operação e devolve o desfecho **já normalizado**.
   *
   * Normalizar é obrigação do adapter, não cortesia: o `ConnectorResult` não pode carregar o
   * objeto nativo do SDK (critério 3) — um `Octokit.Response` traz os headers da requisição
   * junto, `authorization` incluído, e serializá-lo pelo IPC publicaria o token na tela.
   *
   * Traduzir a falha do serviço em `ConnectorError` também é dele, e é o que faz o critério 4
   * valer: um 401 do GitHub e um 401 da Tavily chegam ao orquestrador como o **mesmo**
   * `credencial-recusada`. Se cada adapter devolvesse o erro do seu SDK, a tradução seria
   * refeita em cada consumidor — e as duas versões divergiriam.
   *
   * Pode lançar; quem traduz exceção inesperada em `ConnectorError` é o serviço, um lugar só,
   * para todo adapter.
   */
  executar(execution: ConnectorExecution): Promise<ConnectorResult | ConnectorError>
}
