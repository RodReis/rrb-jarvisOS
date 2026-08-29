/**
 * Adapter do Google Gemini (SPEC-Providers-04, critério 1).
 *
 * **O único arquivo do projeto que conhece a API do Gemini**, pela mesma regra que isola a
 * Anthropic: o ponto único importa `AiAdapter`, e trocar de provider é escrever um irmão deste
 * arquivo.
 *
 * Diferente do adapter da Anthropic, aqui é **`fetch` cru e não SDK** — e a razão é escopo, não
 * preferência: não há dependência do Google no projeto, e acrescentar um SDK inteiro para falar
 * um endpoint SSE seria trazer uma superfície grande para um uso pequeno. O que o SDK da
 * Anthropic dava de graça (parser de SSE, erros tipados) aqui cabe em poucas linhas, porque o
 * formato é `data: {json}` por linha, sem os múltiplos tipos de evento da Messages API.
 *
 * Endpoint: `POST /v1beta/models/{modelo}:streamGenerateContent?alt=sse`, com a chave no header
 * `x-goog-api-key` — **nunca na query string**, que é onde credencial vaza para log de proxy.
 */

import type { AdapterChunk, AdapterRequest, AiAdapter } from './adapter'
import { AdapterError } from './anthropic-adapter'

/** A base da API. Constante para que o teste aponte para um servidor local. */
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com'

/**
 * A forma do que interessa na resposta. Declarada, e não `any`: o parser lê JSON de terceiro,
 * e um campo que mude de forma tem de virar `undefined` tratado, não exceção no meio do stream.
 */
interface GeminiChunk {
  readonly candidates?: ReadonlyArray<{
    readonly content?: { readonly parts?: ReadonlyArray<{ readonly text?: string }> }
  }>
  readonly usageMetadata?: {
    readonly promptTokenCount?: number
    readonly candidatesTokenCount?: number
  }
}

/**
 * Traduz o status HTTP numa frase curta em pt-BR — **sem** corpo cru da resposta.
 *
 * Mesma regra do adapter da Anthropic, e pela mesma razão: o corpo de um 401 pode ecoar o
 * header enviado, e repassá-lo à tela levaria a chave junto. O status é seguro (é um número);
 * o corpo, não.
 */
function descreverStatus(status: number): string {
  if (status === 401 || status === 403) {
    return 'A credencial do Google Gemini foi recusada. Verifique a chave em Configurações.'
  }
  if (status === 429) {
    return 'O Google Gemini recusou por limite de requisições. Tente de novo em instantes.'
  }
  if (status === 400) {
    return 'O Google Gemini recusou a requisição. Verifique o modelo e o tamanho do prompt.'
  }
  return `O Google Gemini respondeu com erro ${status}.`
}

/**
 * Extrai os objetos JSON de um pedaço de corpo SSE.
 *
 * O formato é `data: {json}` separado por linha em branco. A função devolve os JSON completos e
 * o **resto** não consumido, porque um chunk da rede corta no meio de uma linha com frequência
 * — tratar cada leitura como se fosse mensagem inteira é o bug clássico de parser de SSE
 * escrito à mão, e ele só aparece com resposta longa.
 */
export function extrairEventos(buffer: string): {
  readonly eventos: readonly GeminiChunk[]
  readonly resto: string
} {
  const eventos: GeminiChunk[] = []
  const linhas = buffer.split('\n')
  // A última entrada pode ser uma linha incompleta; volta ao buffer em vez de ser parseada.
  const resto = linhas.pop() ?? ''

  for (const linha of linhas) {
    const limpa = linha.trim()
    if (!limpa.startsWith('data:')) continue

    const carga = limpa.slice('data:'.length).trim()
    if (carga === '' || carga === '[DONE]') continue

    try {
      eventos.push(JSON.parse(carga) as GeminiChunk)
    } catch {
      // JSON malformado numa linha não derruba o stream: o provider às vezes emite keep-alive
      // e comentários, e uma exceção aqui perderia toda a resposta por causa de uma linha.
      continue
    }
  }

  return { eventos, resto }
}

export class GeminiAdapter implements AiAdapter {
  readonly nome = 'gemini'

  /**
   * `fetch` e `baseURL` entram por injeção pela mesma razão que o cliente da Anthropic: o teste
   * aponta para um servidor HTTP local e exercita o **parser de verdade**. Mock de módulo
   * provaria que o meu mock funciona; o que precisa de prova é a leitura do SSE.
   */
  constructor(
    private readonly baseURL: string = GEMINI_BASE_URL,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async *generateStream(request: AdapterRequest): AsyncIterable<AdapterChunk> {
    if (request.apiKey === undefined) {
      throw new AdapterError(
        'Nenhuma credencial configurada para o Google Gemini. Adicione a chave em Configurações.',
        undefined
      )
    }

    const url = `${this.baseURL}/v1beta/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`

    let resposta: Response
    try {
      resposta = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // No header, **nunca** na query string: query vaza para log de proxy e histórico.
          'x-goog-api-key': request.apiKey
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
          ...(request.system === undefined
            ? {}
            : { systemInstruction: { parts: [{ text: request.system }] } }),
          generationConfig: { maxOutputTokens: request.maxTokens }
        }),
        ...(request.signal === undefined ? {} : { signal: request.signal })
      })
    } catch (erro) {
      if (erro instanceof Error && erro.name === 'AbortError') {
        throw new AdapterError('A chamada foi interrompida.', erro)
      }
      throw new AdapterError('Falha ao falar com o Google Gemini.', erro)
    }

    if (!resposta.ok) {
      throw new AdapterError(descreverStatus(resposta.status), undefined)
    }

    if (resposta.body === null) {
      throw new AdapterError('O Google Gemini respondeu sem corpo.', undefined)
    }

    const leitor = resposta.body.getReader()
    const decodificador = new TextDecoder()
    let buffer = ''
    // O `usage` do Gemini chega **repetido**, acumulado a cada chunk, e o último é o total. Por
    // isso é sobrescrito em vez de somado: somar contaria o mesmo token várias vezes.
    let usage = { tokensEntrada: 0, tokensSaida: 0 }

    try {
      for (;;) {
        const { done, value } = await leitor.read()
        if (done) break

        buffer += decodificador.decode(value, { stream: true })
        const { eventos, resto } = extrairEventos(buffer)
        buffer = resto

        for (const evento of eventos) {
          const texto = evento.candidates?.[0]?.content?.parts?.[0]?.text
          if (texto !== undefined && texto !== '') {
            yield { tipo: 'texto', texto }
          }

          if (evento.usageMetadata !== undefined) {
            usage = {
              tokensEntrada: evento.usageMetadata.promptTokenCount ?? usage.tokensEntrada,
              tokensSaida: evento.usageMetadata.candidatesTokenCount ?? usage.tokensSaida
            }
          }
        }
      }
    } catch (erro) {
      if (erro instanceof Error && erro.name === 'AbortError') {
        throw new AdapterError('A chamada foi interrompida.', erro)
      }
      throw new AdapterError('Falha ao ler a resposta do Google Gemini.', erro)
    } finally {
      // Solta a conexão mesmo quando o consumidor abandona o iterador no meio (o `return` de um
      // `for await` que faz `break`). Sem isto, o socket ficaria pendurado.
      leitor.releaseLock()
    }

    yield { tipo: 'fim', usage }
  }
}
