/**
 * Adapter da Claude API — o primeiro provider real (SPEC-Providers-02, critério 2).
 *
 * **O único arquivo do projeto que conhece a Anthropic.** É o que dá sentido ao critério 1: o
 * ponto de chamada importa `AiAdapter`, e trocar de provider é escrever um irmão deste arquivo.
 * Se `@anthropic-ai/sdk` aparecer importado em qualquer outro lugar do main, o isolamento
 * quebrou — e o teste de fronteira falha.
 *
 * Usa o SDK oficial (decisão do PI 2026-08-29) em vez de `fetch` cru: o parser de SSE, o
 * backoff e as classes de erro tipadas vêm prontos. Escrever isso à mão seria mais código meu
 * num caminho que manipula credencial.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { AdapterChunk, AdapterRequest, AiAdapter } from './adapter'

/**
 * Traduz a exceção do SDK numa frase curta em pt-BR — **sem** corpo cru do provider.
 *
 * A mensagem de erro é caminho clássico de vazamento: o corpo de uma resposta 401 pode ecoar o
 * header enviado, e um `error.message` repassado inteiro para a tela levaria a chave junto.
 * Aqui o erro vira categoria, não transcrição.
 */
function descreverErro(erro: unknown): string {
  if (erro instanceof Anthropic.AuthenticationError) {
    return 'A credencial da Anthropic foi recusada. Verifique a chave em Configurações.'
  }
  if (erro instanceof Anthropic.RateLimitError) {
    return 'A Anthropic recusou por limite de requisições. Tente de novo em instantes.'
  }
  if (erro instanceof Anthropic.BadRequestError) {
    return 'A Anthropic recusou a requisição. Verifique o modelo e o tamanho do prompt.'
  }
  if (erro instanceof Anthropic.APIConnectionTimeoutError) {
    return 'A chamada à Anthropic excedeu o tempo limite.'
  }
  if (erro instanceof Anthropic.APIError) {
    // O status é seguro (é um número); a mensagem do corpo, não.
    return `A Anthropic respondeu com erro ${erro.status ?? 'desconhecido'}.`
  }
  if (erro instanceof Error && erro.name === 'AbortError') {
    return 'A chamada foi interrompida.'
  }
  return 'Falha ao falar com a Anthropic.'
}

/** Erro do adapter já com mensagem segura — o ponto de chamada a repassa ao renderer. */
export class AdapterError extends Error {
  constructor(
    mensagem: string,
    readonly causa: unknown
  ) {
    super(mensagem)
    this.name = 'AdapterError'
  }
}

export class AnthropicAdapter implements AiAdapter {
  readonly nome = 'anthropic'

  /**
   * O construtor do cliente entra por injeção para que o teste substitua o transporte sem
   * mockar o módulo: os testes apontam o `baseURL` para um servidor HTTP local e exercitam o
   * **parser de SSE de verdade**. Mock de módulo provaria que o meu mock funciona; um servidor
   * local prova que o adapter fala o protocolo.
   */
  constructor(
    private readonly criarCliente: (apiKey: string, timeoutMs: number) => Anthropic = (
      apiKey,
      timeout
    ) => new Anthropic({ apiKey, timeout, maxRetries: 1 })
  ) {}

  async *generateStream(request: AdapterRequest): AsyncIterable<AdapterChunk> {
    // A credencial virou opcional no contrato na F04, porque Ollama e Claude Code CLI não têm
    // nenhuma. Este provider **tem** — e a checagem é aqui, não no ponto de chamada: quem sabe
    // se a chave é obrigatória é o adapter, e o ponto único não deve manter uma segunda lista
    // de quem exige o quê.
    if (request.apiKey === undefined) {
      throw new AdapterError(
        'Nenhuma credencial configurada para a Anthropic. Adicione a chave em Configurações.',
        undefined
      )
    }

    const cliente = this.criarCliente(request.apiKey, request.timeoutMs)

    const stream = cliente.messages.stream(
      {
        model: request.model,
        max_tokens: request.maxTokens,
        ...(request.system === undefined ? {} : { system: request.system }),
        messages: [{ role: 'user', content: request.prompt }]
      },
      // O `signal` do ponto de chamada governa o aborto: timeout e fechamento de tela são a
      // mesma coisa para o SDK, e ambos precisam soltar a conexão em vez de deixá-la pendurada.
      request.signal === undefined ? undefined : { signal: request.signal }
    )

    try {
      for await (const evento of stream) {
        // Só o delta de texto interessa aqui. Os outros eventos (`message_start`,
        // `content_block_start`, …) descrevem a estrutura da resposta; esta fatia entrega
        // texto, e ignorá-los explicitamente é mais honesto que um `default` que os trataria
        // como conteúdo.
        if (evento.type === 'content_block_delta' && evento.delta.type === 'text_delta') {
          yield { tipo: 'texto', texto: evento.delta.text }
        }
      }

      // `finalMessage()` depois do laço: o `usage` só existe quando o stream fecha (decisão do
      // PI 2026-07-24 — "custo contabilizado no fim do stream a partir do `usage`").
      const final = await stream.finalMessage()

      yield {
        tipo: 'fim',
        usage: {
          tokensEntrada: final.usage.input_tokens,
          tokensSaida: final.usage.output_tokens
        }
      }
    } catch (erro) {
      throw new AdapterError(descreverErro(erro), erro)
    }
  }
}
