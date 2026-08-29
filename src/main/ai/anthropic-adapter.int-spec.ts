/**
 * O adapter da Anthropic contra um servidor HTTP real (SPEC-Providers-02, critério 2).
 *
 * **Servidor local, não mock de módulo.** A diferença importa: um `vi.mock('@anthropic-ai/sdk')`
 * provaria que o meu mock funciona. Aqui o SDK real abre uma conexão real, o servidor devolve
 * SSE real, e o que se exercita é o **parser de streaming** — o pedaço que eu não escrevi e que
 * portanto é onde uma suposição minha sobre o protocolo apareceria.
 *
 * É a mesma régua da F01 (`credential-vault.int-spec.ts`): dublar o *algoritmo* quando ele
 * exige o SO, nunca o *caminho*.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import Anthropic from '@anthropic-ai/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AdapterError, AnthropicAdapter } from './anthropic-adapter'
import type { AdapterChunk } from './adapter'

const CHAVE = 'sk-ant-api03-chave-de-teste'

let servidor: Server
let baseURL: string
/** O que o servidor recebeu — para afirmar sobre a requisição que o adapter montou. */
let recebido: { headers: Record<string, unknown>; corpo: unknown } | undefined

/** Sobe um servidor que responde o que o teste mandar. */
function responder(handler: (corpo: unknown) => { status: number; sse?: string; json?: unknown }) {
  servidor.removeAllListeners('request')
  servidor.on('request', (req, res) => {
    let cru = ''
    req.on('data', (p) => (cru += p))
    req.on('end', () => {
      const corpo: unknown = cru === '' ? undefined : JSON.parse(cru)
      recebido = { headers: req.headers as Record<string, unknown>, corpo }
      const resposta = handler(corpo)

      if (resposta.sse !== undefined) {
        res.writeHead(resposta.status, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache'
        })
        res.end(resposta.sse)
        return
      }

      res.writeHead(resposta.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(resposta.json ?? {}))
    })
  })
}

/**
 * Monta o corpo SSE de um stream da Messages API.
 *
 * Escrito à mão, com os nomes de evento do protocolo, porque é exatamente esse formato que o
 * parser do SDK tem de entender — gerá-lo por helper do próprio SDK faria o teste concordar
 * consigo mesmo.
 */
function sse(textos: readonly string[], usage: { entrada: number; saida: number }): string {
  const linhas: string[] = [
    `event: message_start\ndata: ${JSON.stringify({
      type: 'message_start',
      message: {
        id: 'msg_teste',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: usage.entrada, output_tokens: 0 }
      }
    })}`,
    `event: content_block_start\ndata: ${JSON.stringify({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' }
    })}`
  ]

  for (const texto of textos) {
    linhas.push(
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: texto }
      })}`
    )
  }

  linhas.push(
    `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}`,
    // O `usage` de saída vem aqui, no `message_delta` — é a razão de o `fim` do adapter só
    // poder ser emitido depois do laço (decisão do PI: custo no fim do stream).
    `event: message_delta\ndata: ${JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: usage.saida }
    })}`,
    `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}`
  )

  return linhas.join('\n\n') + '\n\n'
}

/** O adapter apontado para o servidor local, com o SDK real por trás. */
function adapter(): AnthropicAdapter {
  return new AnthropicAdapter(
    (apiKey, timeout) => new Anthropic({ apiKey, timeout, baseURL, maxRetries: 0 })
  )
}

async function coletar(stream: AsyncIterable<AdapterChunk>): Promise<AdapterChunk[]> {
  const chunks: AdapterChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function pedido(extra: Partial<Parameters<AnthropicAdapter['generateStream']>[0]> = {}) {
  return {
    model: 'claude-opus-5',
    prompt: 'qual a capital da Franca',
    maxTokens: 1024,
    apiKey: CHAVE,
    timeoutMs: 5_000,
    ...extra
  }
}

beforeEach(async () => {
  recebido = undefined
  servidor = createServer()
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve))
  baseURL = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
})

afterEach(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()))
})

describe('streaming pelo protocolo real (critério 2)', () => {
  it('converte os deltas SSE em chunks de texto e fecha com o `usage`', async () => {
    responder(() => ({
      status: 200,
      sse: sse(['Paris', ' e a', ' capital.'], { entrada: 12, saida: 7 })
    }))

    const chunks = await coletar(adapter().generateStream(pedido()))

    // Três textos e um fim: o adapter não junta os deltas nem inventa um quarto evento.
    expect(chunks.map((c) => c.tipo)).toEqual(['texto', 'texto', 'texto', 'fim'])
    expect(
      chunks
        .filter((c) => c.tipo === 'texto')
        .map((c) => c.texto)
        .join('')
    ).toBe('Paris e a capital.')
    expect(chunks.at(-1)).toEqual({
      tipo: 'fim',
      usage: { tokensEntrada: 12, tokensSaida: 7 }
    })
  })

  it('manda a credencial no header e o prompt no corpo — a requisição que a API espera', async () => {
    responder(() => ({ status: 200, sse: sse(['ok'], { entrada: 1, saida: 1 }) }))

    await coletar(adapter().generateStream(pedido({ system: 'seja breve' })))

    expect(recebido?.headers['x-api-key']).toBe(CHAVE)
    expect(recebido?.corpo).toMatchObject({
      model: 'claude-opus-5',
      max_tokens: 1024,
      system: 'seja breve',
      stream: true,
      messages: [{ role: 'user', content: 'qual a capital da Franca' }]
    })
  })

  it('omite `system` quando o chamador não o informa', async () => {
    responder(() => ({ status: 200, sse: sse(['ok'], { entrada: 1, saida: 1 }) }))

    await coletar(adapter().generateStream(pedido()))

    // Omitir e não mandar `undefined`: a API recusa campo nulo, e um `system: undefined`
    // serializado viraria `null` no JSON.
    expect(recebido?.corpo).not.toHaveProperty('system')
  })
})

describe('erros traduzidos, sem vazar o corpo do provider (critério 7)', () => {
  it('401 vira mensagem sobre credencial — e não repassa o corpo cru', async () => {
    // O corpo ecoa a chave, que é o cenário real perigoso: repassar `error.message` inteiro
    // levaria o segredo para a tela.
    responder(() => ({
      status: 401,
      json: { type: 'error', error: { type: 'authentication_error', message: `bad key ${CHAVE}` } }
    }))

    const erro = await coletar(adapter().generateStream(pedido())).catch((e: unknown) => e)

    expect(erro).toBeInstanceOf(AdapterError)
    expect((erro as AdapterError).message).toContain('credencial')
    expect((erro as AdapterError).message).not.toContain(CHAVE)
  })

  it('429 vira mensagem sobre limite de requisições', async () => {
    responder(() => ({
      status: 429,
      json: { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }
    }))

    const erro = await coletar(adapter().generateStream(pedido())).catch((e: unknown) => e)

    expect((erro as AdapterError).message).toContain('limite de requisições')
  })

  it('400 vira mensagem sobre a requisição', async () => {
    responder(() => ({
      status: 400,
      json: { type: 'error', error: { type: 'invalid_request_error', message: 'bad model' } }
    }))

    const erro = await coletar(adapter().generateStream(pedido())).catch((e: unknown) => e)

    expect((erro as AdapterError).message).toContain('Verifique o modelo')
  })

  it('500 vira mensagem com o status, que é seguro — o corpo não', async () => {
    responder(() => ({
      status: 500,
      json: { type: 'error', error: { type: 'api_error', message: 'interno: token=abc123' } }
    }))

    const erro = await coletar(adapter().generateStream(pedido())).catch((e: unknown) => e)

    expect((erro as AdapterError).message).toContain('500')
    expect((erro as AdapterError).message).not.toContain('abc123')
  })

  it('preserva a exceção original em `causa` — a mensagem é segura, o diagnóstico não some', async () => {
    responder(() => ({ status: 500, json: { type: 'error', error: { type: 'api_error' } } }))

    const erro = await coletar(adapter().generateStream(pedido())).catch((e: unknown) => e)

    // A mensagem é redigida para a tela; o objeto original fica para o log de diagnóstico.
    // Descartá-lo tornaria a falha impossível de investigar.
    expect((erro as AdapterError).causa).toBeInstanceOf(Anthropic.APIError)
  })
})

describe('aborto (critério 7)', () => {
  it('o `signal` interrompe o stream em andamento', async () => {
    // O servidor abre o stream e **não** fecha: é o caso do provider pendurado, que é o que o
    // timeout do ponto de chamada existe para cortar.
    servidor.removeAllListeners('request')
    servidor.on('request', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(
        `event: message_start\ndata: ${JSON.stringify({
          type: 'message_start',
          message: {
            id: 'msg_x',
            type: 'message',
            role: 'assistant',
            model: 'claude-opus-5',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 0 }
          }
        })}\n\n`
      )
      // Sem `end()`: pendura de propósito.
    })

    const controle = new AbortController()
    setTimeout(() => controle.abort(), 50)

    const erro = await coletar(adapter().generateStream(pedido({ signal: controle.signal }))).catch(
      (e: unknown) => e
    )

    // Vira `AdapterError` como qualquer outra falha — o ponto de chamada trata um tipo só.
    expect(erro).toBeInstanceOf(AdapterError)
  })
})
