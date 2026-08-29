/**
 * Os três adapters da F04 contra protocolo real (SPEC-Providers-04, critérios 1, 2 e 6).
 *
 * **Servidor HTTP local e subprocess real, não `vi.mock`** — a mesma escolha da F02, e pela
 * mesma razão: mock provaria que o meu mock funciona, e o que precisa de prova é o parser (SSE
 * do Gemini, NDJSON do Ollama) e as garantias do subprocess, que são justamente o que eu
 * escrevi e posso ter escrito errado.
 *
 * O adapter do Claude Code usa `node` como binário dublê: exercita `spawn` de verdade — com
 * `shell: false`, stdin, timeout e kill — sem depender de o `claude` estar instalado no CI.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { spawn } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import type { AdapterChunk } from './adapter'
import { AdapterError } from './anthropic-adapter'
import { GeminiAdapter, extrairEventos } from './gemini-adapter'
import { OllamaAdapter, extrairLinhas } from './ollama-adapter'
import { ClaudeCodeAdapter } from './claude-code-adapter'

let servidor: Server | undefined

afterEach(async () => {
  if (servidor !== undefined) {
    await new Promise<void>((resolve) => servidor?.close(() => resolve()))
    servidor = undefined
  }
})

/** Sobe um servidor local que responde o corpo dado, e devolve a URL. */
async function subir(
  responder: (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse
  ) => void
): Promise<string> {
  servidor = createServer(responder)
  await new Promise<void>((resolve) => servidor?.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
}

async function coletar(stream: AsyncIterable<AdapterChunk>): Promise<AdapterChunk[]> {
  const chunks: AdapterChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('Gemini — parser de SSE (critério 1)', () => {
  const sse = (...objetos: unknown[]): string =>
    objetos.map((o) => `data: ${JSON.stringify(o)}\n\n`).join('') + 'data: [DONE]\n\n'

  const parte = (texto: string): unknown => ({
    candidates: [{ content: { parts: [{ text: texto }] } }]
  })

  it('monta o texto a partir dos deltas e lê o usage do fim', async () => {
    const url = await subir((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end(
        sse(parte('Paris'), parte(' é a capital.'), {
          candidates: [{ content: { parts: [{ text: '' }] } }],
          usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7 }
        })
      )
    })

    const chunks = await coletar(
      new GeminiAdapter(url).generateStream({
        model: 'gemini-2.5-pro',
        prompt: 'qual a capital da França',
        maxTokens: 100,
        apiKey: 'chave-de-teste',
        timeoutMs: 5_000
      })
    )

    const texto = chunks
      .filter((c) => c.tipo === 'texto')
      .map((c) => (c.tipo === 'texto' ? c.texto : ''))
      .join('')

    expect(texto).toBe('Paris é a capital.')
    expect(chunks.at(-1)).toEqual({
      tipo: 'fim',
      usage: { tokensEntrada: 11, tokensSaida: 7 }
    })
  })

  it('manda a chave no header, nunca na query string', async () => {
    // Query string vaza para log de proxy e histórico — é o modo clássico de a chave escapar
    // sem ninguém ter escrito `console.log(apiKey)`.
    let urlRecebida = ''
    let headerRecebido: string | undefined

    const url = await subir((req, res) => {
      urlRecebida = req.url ?? ''
      headerRecebido = req.headers['x-goog-api-key'] as string | undefined
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end(sse(parte('ok')))
    })

    await coletar(
      new GeminiAdapter(url).generateStream({
        model: 'gemini-2.5-pro',
        prompt: 'oi',
        maxTokens: 10,
        apiKey: 'sk-segredo-do-teste',
        timeoutMs: 5_000
      })
    )

    expect(headerRecebido).toBe('sk-segredo-do-teste')
    expect(urlRecebida).not.toContain('sk-segredo-do-teste')
  })

  it('erro HTTP vira mensagem segura, sem o corpo cru da resposta', async () => {
    const url = await subir((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      // O corpo de um 401 pode ecoar o header enviado — com a chave junto.
      res.end(JSON.stringify({ error: { message: 'invalid key: sk-segredo-do-teste' } }))
    })

    const stream = new GeminiAdapter(url).generateStream({
      model: 'gemini-2.5-pro',
      prompt: 'oi',
      maxTokens: 10,
      apiKey: 'sk-segredo-do-teste',
      timeoutMs: 5_000
    })

    await expect(coletar(stream)).rejects.toThrow(AdapterError)
    await expect(
      coletar(
        new GeminiAdapter(url).generateStream({
          model: 'gemini-2.5-pro',
          prompt: 'oi',
          maxTokens: 10,
          apiKey: 'sk-segredo-do-teste',
          timeoutMs: 5_000
        })
      )
    ).rejects.toThrow(/credencial do Google Gemini foi recusada/i)
  })

  it('sem credencial, recusa antes de tocar a rede', async () => {
    let bateu = false
    const url = await subir((_req, res) => {
      bateu = true
      res.end()
    })

    await expect(
      coletar(
        new GeminiAdapter(url).generateStream({
          model: 'gemini-2.5-pro',
          prompt: 'oi',
          maxTokens: 10,
          timeoutMs: 5_000
        })
      )
    ).rejects.toThrow(/Nenhuma credencial configurada/i)

    expect(bateu).toBe(false)
  })
})

describe('Gemini — `extrairEventos` corta no lugar certo', () => {
  it('devolve o resto quando a linha vem cortada pela rede', () => {
    // O bug clássico de parser de SSE escrito à mão: tratar cada leitura como mensagem
    // inteira. Só aparece com resposta longa, quando o chunk corta no meio de uma linha.
    const { eventos, resto } = extrairEventos('data: {"a":1}\n\ndata: {"b":')

    expect(eventos).toEqual([{ a: 1 }])
    expect(resto).toBe('data: {"b":')
  })

  it('ignora `[DONE]` e linhas vazias sem quebrar', () => {
    const { eventos } = extrairEventos('data: [DONE]\n\n\n')
    expect(eventos).toEqual([])
  })

  it('JSON malformado numa linha não derruba as outras', () => {
    const { eventos } = extrairEventos('data: {quebrado\ndata: {"ok":true}\n')
    expect(eventos).toEqual([{ ok: true }])
  })
})

describe('Ollama — NDJSON, sem credencial (critério 1)', () => {
  const ndjson = (...objetos: unknown[]): string =>
    objetos.map((o) => `${JSON.stringify(o)}\n`).join('')

  it('monta o texto e lê o usage da linha final', async () => {
    const url = await subir((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      res.end(
        ndjson(
          { response: 'Paris', done: false },
          { response: ' é a capital.', done: false },
          { response: '', done: true, prompt_eval_count: 9, eval_count: 5 }
        )
      )
    })

    const chunks = await coletar(
      new OllamaAdapter(url).generateStream({
        model: 'llama3.1',
        prompt: 'qual a capital da França',
        maxTokens: 100,
        timeoutMs: 5_000
      })
    )

    const texto = chunks
      .filter((c) => c.tipo === 'texto')
      .map((c) => (c.tipo === 'texto' ? c.texto : ''))
      .join('')

    expect(texto).toBe('Paris é a capital.')
    expect(chunks.at(-1)).toEqual({ tipo: 'fim', usage: { tokensEntrada: 9, tokensSaida: 5 } })
  })

  it('não manda header de credencial: o provider é local e não tem chave', async () => {
    let autorizacao: string | undefined
    const url = await subir((req, res) => {
      autorizacao = req.headers.authorization
      res.writeHead(200)
      res.end(ndjson({ response: 'ok', done: true, prompt_eval_count: 1, eval_count: 1 }))
    })

    await coletar(
      new OllamaAdapter(url).generateStream({
        model: 'llama3.1',
        prompt: 'oi',
        maxTokens: 10,
        timeoutMs: 5_000
      })
    )

    expect(autorizacao).toBeUndefined()
  })

  it('erro dentro do corpo com status 200 vira falha, não sucesso vazio', async () => {
    // O Ollama reporta "modelo não baixado" assim. Sem ramo próprio, a chamada terminaria
    // "com sucesso" e texto vazio — e o usuário não saberia o que aconteceu.
    const url = await subir((_req, res) => {
      res.writeHead(200)
      res.end(ndjson({ error: 'model "llama3.1" not found, try pulling it first' }))
    })

    await expect(
      coletar(
        new OllamaAdapter(url).generateStream({
          model: 'llama3.1',
          prompt: 'oi',
          maxTokens: 10,
          timeoutMs: 5_000
        })
      )
    ).rejects.toThrow(/not found/i)
  })

  it('servidor fora vira mensagem que diz o que fazer', async () => {
    // "Falha de rede" mandaria o usuário procurar problema de internet para um serviço que
    // mora na máquina dele.
    await expect(
      coletar(
        new OllamaAdapter('http://127.0.0.1:1').generateStream({
          model: 'llama3.1',
          prompt: 'oi',
          maxTokens: 10,
          timeoutMs: 5_000
        })
      )
    ).rejects.toThrow(/servidor local está rodando/i)
  })

  it('healthcheck responde true quando `/api/tags` responde, e false quando não', async () => {
    const url = await subir((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ models: [] }))
    })

    expect(await new OllamaAdapter(url).disponivel()).toBe(true)
    expect(await new OllamaAdapter('http://127.0.0.1:1').disponivel()).toBe(false)
  })

  it('healthcheck nunca lança — é chamado em laço pela tela', async () => {
    await expect(
      new OllamaAdapter('http://destino-que-nao-existe.invalid').disponivel()
    ).resolves.toBe(false)
  })
})

describe('Ollama — `extrairLinhas` corta no lugar certo', () => {
  it('devolve o resto quando a linha vem cortada', () => {
    const { linhas, resto } = extrairLinhas('{"a":1}\n{"b":')

    expect(linhas).toEqual([{ a: 1 }])
    expect(resto).toBe('{"b":')
  })

  it('linha malformada não derruba as outras', () => {
    const { linhas } = extrairLinhas('{quebrado\n{"ok":true}\n')
    expect(linhas).toEqual([{ ok: true }])
  })
})

describe('Claude Code CLI — subprocess app-managed (critério 2)', () => {
  /**
   * `node` como binário dublê: exercita `spawn` de verdade — `shell: false`, stdin, timeout,
   * kill — sem depender de o `claude` estar instalado. O que se prova aqui são as garantias do
   * subprocess, que são minhas; o protocolo do CLI é dele.
   */
  function comBinarioDuble(script: string): ClaudeCodeAdapter {
    const spawnDuble = ((_binario: string, _args: readonly string[], opcoes: object) =>
      spawn(process.execPath, ['-e', script], opcoes)) as typeof spawn

    return new ClaudeCodeAdapter(process.cwd(), spawnDuble)
  }

  it('emite o texto do stdout em chunks e fecha com usage aproximado', async () => {
    const chunks = await coletar(
      comBinarioDuble(
        'process.stdin.on("data",()=>{});process.stdout.write("Paris");process.stdout.write(" é a capital.");process.exit(0)'
      ).generateStream({
        model: 'claude-opus-5',
        prompt: 'qual a capital da França',
        maxTokens: 100,
        timeoutMs: 5_000
      })
    )

    const texto = chunks
      .filter((c) => c.tipo === 'texto')
      .map((c) => (c.tipo === 'texto' ? c.texto : ''))
      .join('')

    expect(texto).toBe('Paris é a capital.')
    const fim = chunks.at(-1)
    expect(fim?.tipo).toBe('fim')
    // Aproximado (~4 caracteres por token) porque o CLI não reporta `usage`. É aceitável
    // **porque** a rota é `unmetered` e nenhuma decisão de orçamento consome este número.
    expect(fim?.tipo === 'fim' ? fim.usage.tokensSaida : 0).toBeGreaterThan(0)
  })

  it('o prompt chega por stdin, não como argumento', async () => {
    // Por stdin tira do caminho qualquer dependência de escape, e evita o limite de tamanho
    // de linha de comando do SO com prompt longo.
    const chunks = await coletar(
      comBinarioDuble(
        'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{process.stdout.write("recebi:"+d);process.exit(0)})'
      ).generateStream({
        model: 'claude-opus-5',
        prompt: 'texto-do-prompt',
        maxTokens: 100,
        timeoutMs: 5_000
      })
    )

    const texto = chunks
      .filter((c) => c.tipo === 'texto')
      .map((c) => (c.tipo === 'texto' ? c.texto : ''))
      .join('')

    expect(texto).toBe('recebi:texto-do-prompt')
  })

  it('processo pendurado é morto pelo timeout (critério 2)', async () => {
    const inicio = Date.now()

    await expect(
      coletar(
        comBinarioDuble('setInterval(()=>{},1000)').generateStream({
          model: 'claude-opus-5',
          prompt: 'oi',
          maxTokens: 10,
          timeoutMs: 300
        })
      )
    ).rejects.toThrow(/tempo limite|interrompida/i)

    // O SO mata o processo — não é uma promessa nossa de parar de escutar. Sem o kill, este
    // teste esperaria o `setInterval` para sempre.
    expect(Date.now() - inicio).toBeLessThan(5_000)
  })

  it('código de saída diferente de zero vira falha — sem o stderr na mensagem', async () => {
    // O stderr pode carregar caminho, token de sessão ou o que o CLI resolva imprimir. O
    // código de saída é seguro; o texto, não.
    await expect(
      coletar(
        comBinarioDuble(
          'process.stdin.on("data",()=>{});process.stderr.write("SEGREDO-NO-STDERR");process.exit(3)'
        ).generateStream({
          model: 'claude-opus-5',
          prompt: 'oi',
          maxTokens: 10,
          timeoutMs: 5_000
        })
      )
    ).rejects.toThrow(/código 3/i)

    const erro = await coletar(
      comBinarioDuble(
        'process.stdin.on("data",()=>{});process.stderr.write("SEGREDO-NO-STDERR");process.exit(3)'
      ).generateStream({
        model: 'claude-opus-5',
        prompt: 'oi',
        maxTokens: 10,
        timeoutMs: 5_000
      })
    ).catch((e: unknown) => (e instanceof Error ? e.message : ''))

    expect(erro).not.toContain('SEGREDO-NO-STDERR')
  })

  it('binário ausente vira mensagem que diz o que fazer', async () => {
    const adapter = new ClaudeCodeAdapter(process.cwd(), ((
      _bin: string,
      _args: readonly string[],
      o: object
    ) => spawn('binario-que-nao-existe-em-lugar-nenhum', [], o)) as typeof spawn)

    await expect(
      coletar(
        adapter.generateStream({
          model: 'claude-opus-5',
          prompt: 'oi',
          maxTokens: 10,
          timeoutMs: 5_000
        })
      )
    ).rejects.toThrow(/não foi encontrado|Falha ao executar/i)
  })

  it('healthcheck responde false quando o binário não existe, sem lançar', async () => {
    const adapter = new ClaudeCodeAdapter(process.cwd(), ((
      _b: string,
      _a: readonly string[],
      o: object
    ) => spawn('binario-que-nao-existe-em-lugar-nenhum', [], o)) as typeof spawn)

    await expect(adapter.disponivel()).resolves.toBe(false)
  })

  it('healthcheck responde true quando o processo sai com código 0', async () => {
    const adapter = new ClaudeCodeAdapter(process.cwd(), ((
      _b: string,
      _a: readonly string[],
      o: object
    ) => spawn(process.execPath, ['-e', 'process.exit(0)'], o)) as typeof spawn)

    await expect(adapter.disponivel()).resolves.toBe(true)
  })

  it('o `env` do processo filho não carrega o ambiente do main', async () => {
    // A lição da M4-F02: `process.env` do main não pode alcançar o filho. Vale igual aqui —
    // a allowlist de binários não protege contra vazamento de ambiente, porque o binário é
    // legítimo.
    process.env.SEGREDO_DO_MAIN = 'valor-que-nao-pode-vazar'

    try {
      const chunks = await coletar(
        comBinarioDuble(
          'process.stdin.on("data",()=>{});process.stdout.write(String(process.env.SEGREDO_DO_MAIN));process.exit(0)'
        ).generateStream({
          model: 'claude-opus-5',
          prompt: 'oi',
          maxTokens: 10,
          timeoutMs: 5_000
        })
      )

      const texto = chunks
        .filter((c) => c.tipo === 'texto')
        .map((c) => (c.tipo === 'texto' ? c.texto : ''))
        .join('')

      expect(texto).toBe('undefined')
    } finally {
      delete process.env.SEGREDO_DO_MAIN
    }
  })
})
