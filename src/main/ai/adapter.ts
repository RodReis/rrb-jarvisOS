/**
 * A interface de adapter de IA (SPEC-Providers-02, critério 1).
 *
 * O contrato que mantém o núcleo ignorante do provider concreto: o ponto único de chamada
 * conhece `AiAdapter`, nunca `Anthropic`. Trocar de provider é escrever outra implementação
 * disto — não tocar o ponto de chamada (ARCHITECTURE: "novos providers por adaptadores
 * isolados").
 *
 * O isolamento é verificável, e não uma promessa: um adapter falso satisfaz esta interface e
 * roda pelo mesmo ponto de chamada (critério 1). Se `call-provider.ts` precisasse de qualquer
 * coisa que só a Anthropic tem, esse teste não compilaria.
 */

import type { AiUsage } from '@shared/domain/ai'

/** O que o adapter recebe. Já resolvido: modelo escolhido, teto definido, credencial em mãos. */
export interface AdapterRequest {
  readonly model: string
  readonly prompt: string
  readonly system?: string
  readonly maxTokens: number
  /**
   * A credencial, crua, vinda do Vault (F01).
   *
   * Entra por parâmetro em vez de o adapter ler o Vault sozinho: quem decide **qual** escopo
   * de credencial usar é o ponto de chamada, que conhece usuário e workspace. Um adapter que
   * lesse o cofre por conta própria precisaria conhecer o escopo — e passaria a ser mais um
   * lugar onde o segredo é buscado.
   */
  readonly apiKey: string
  readonly timeoutMs: number
  /** Aborta o stream (timeout, ou o usuário fechando a tela). */
  readonly signal?: AbortSignal
}

/**
 * O que o stream do adapter emite.
 *
 * `texto` durante, `fim` uma vez. O `usage` chega **no fim** porque é assim que a Anthropic o
 * reporta (decisão do PI 2026-07-24) — e a interface reflete a realidade do provider em vez de
 * prometer um número que só existiria depois.
 */
export type AdapterChunk =
  | { readonly tipo: 'texto'; readonly texto: string }
  | { readonly tipo: 'fim'; readonly usage: AiUsage }

/**
 * Um provider de IA, reduzido ao que o núcleo precisa.
 *
 * Um método só. A tentação seria acrescentar `listModels`, `healthcheck`, `countTokens` — tudo
 * isso é F04 e não tem consumidor hoje (YAGNI); interface de uso único que já nasce larga é
 * onde a implementação seguinte descobre que metade dos métodos não fazia sentido para ela.
 */
export interface AiAdapter {
  /** Identificador do provider — o mesmo valor de `AiProvider`. */
  readonly nome: string

  /**
   * Dispara a chamada e devolve os chunks conforme chegam.
   *
   * `AsyncIterable` e não callback: o ponto de chamada precisa medir latência **entre** chunks
   * e decidir quando parar, e um callback inverteria esse controle para dentro do adapter.
   *
   * Lança em falha de rede, credencial recusada ou timeout — quem traduz exceção em estado
   * `falhou` (e audita) é o ponto de chamada, um lugar só, para todo provider.
   */
  generateStream(request: AdapterRequest): AsyncIterable<AdapterChunk>
}
