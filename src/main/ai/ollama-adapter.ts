/**
 * Adapter do Ollama — o provider **local** (SPEC-Providers-04, critério 1).
 *
 * **O único arquivo do projeto que conhece a API do Ollama.** Roda contra o servidor do próprio
 * usuário (`127.0.0.1:11434`), então: **sem credencial** e **sem custo** — a tabela de preço o
 * lista a zero, e a `BudgetPolicy` o trata como rota `unmetered`.
 *
 * O formato do stream é **NDJSON**, não SSE: um objeto JSON por linha, e o último traz
 * `done: true` com `prompt_eval_count`/`eval_count`. É mais simples que o SSE do Gemini, mas o
 * mesmo cuidado de buffer vale — um chunk da rede corta no meio de uma linha, e tratar cada
 * leitura como linha inteira é o bug que só aparece com resposta longa.
 *
 * **É o provider preferido pelo roteamento quando disponível** (RF-011: "preferência
 * local/offline"), e é por isso que o healthcheck importa: o Ollama pode simplesmente não estar
 * rodando, e a rota precisa cair para o próximo em vez de falhar.
 */

import type { AdapterChunk, AdapterRequest, AiAdapter } from './adapter'
import { AdapterError } from './anthropic-adapter'

/** O endereço padrão do servidor local. Constante para que o teste aponte para outro. */
export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434'

/**
 * Timeout do healthcheck, curto de propósito.
 *
 * A pergunta é "o servidor está de pé?", e a resposta útil chega em milissegundos. Um timeout
 * generoso aqui faria a **tela de providers** travar esperando por um serviço que não existe —
 * que é exatamente o cenário mais comum (Ollama não instalado).
 */
export const OLLAMA_HEALTHCHECK_TIMEOUT_MS = 2_000

/** A forma do que interessa em cada linha do NDJSON. */
interface OllamaLinha {
  readonly response?: string
  readonly done?: boolean
  readonly prompt_eval_count?: number
  readonly eval_count?: number
  readonly error?: string
}

/**
 * Separa as linhas completas de um buffer NDJSON, devolvendo o resto não consumido.
 *
 * Exportada para teste: é a parte que erra sozinha, e afirmar sobre ela diretamente é mais
 * barato do que montar um stream inteiro para exercitar o corte no meio da linha.
 */
export function extrairLinhas(buffer: string): {
  readonly linhas: readonly OllamaLinha[]
  readonly resto: string
} {
  const partes = buffer.split('\n')
  const resto = partes.pop() ?? ''
  const linhas: OllamaLinha[] = []

  for (const parte of partes) {
    const limpa = parte.trim()
    if (limpa === '') continue

    try {
      linhas.push(JSON.parse(limpa) as OllamaLinha)
    } catch {
      // Linha malformada não derruba o stream — mesma razão do adapter do Gemini.
      continue
    }
  }

  return { linhas, resto }
}

export class OllamaAdapter implements AiAdapter {
  readonly nome = 'ollama'

  constructor(
    private readonly baseURL: string = OLLAMA_BASE_URL,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  /**
   * O servidor está de pé? (critério 6)
   *
   * `GET /api/tags` e não um endpoint de saúde dedicado: é o que o Ollama oferece, e ele
   * responde a lista de modelos instalados — o que também prova que o serviço está **usável**,
   * não só que a porta aceita conexão.
   *
   * Nunca lança: o healthcheck é chamado em laço pela tela de providers, e um throw obrigaria
   * cada chamador a envolver em try. Servidor fora é a resposta `false`, que é informação, não
   * erro.
   */
  async disponivel(): Promise<boolean> {
    const controle = new AbortController()
    const relogio = setTimeout(() => controle.abort(), OLLAMA_HEALTHCHECK_TIMEOUT_MS)

    try {
      const resposta = await this.fetchImpl(`${this.baseURL}/api/tags`, {
        signal: controle.signal
      })
      return resposta.ok
    } catch {
      return false
    } finally {
      clearTimeout(relogio)
    }
  }

  /**
   * Quais modelos estão baixados **agora** (SPEC-Voz-03, critério 4).
   *
   * Mesmo `GET /api/tags` do healthcheck, lendo o corpo que ele descarta. Servidor de pé e
   * modelo ausente são duas indisponibilidades com próximas ações diferentes — "suba o Ollama"
   * contra `ollama pull <modelo>` —, e sem a lista as duas chegariam à tela como a mesma frase.
   *
   * Nunca lança, pela mesma razão de `disponivel`: lista vazia é a resposta para servidor fora.
   * Quem pergunta quer decidir se chama, não tratar exceção.
   */
  async modelosInstalados(): Promise<readonly string[]> {
    const controle = new AbortController()
    const relogio = setTimeout(() => controle.abort(), OLLAMA_HEALTHCHECK_TIMEOUT_MS)

    try {
      const resposta = await this.fetchImpl(`${this.baseURL}/api/tags`, {
        signal: controle.signal
      })
      if (!resposta.ok) return []

      // `?.` em cada nível: um corpo inesperado não pode derrubar o serviço — `ok` do conector
      // não garante forma, e o caminho de falha correto aqui é a recusa que já existe.
      const corpo = (await resposta.json()) as { models?: { name?: unknown }[] } | null
      return (corpo?.models ?? [])
        .map((m) => m?.name)
        .filter((n): n is string => typeof n === 'string')
    } catch {
      return []
    } finally {
      clearTimeout(relogio)
    }
  }

  async *generateStream(request: AdapterRequest): AsyncIterable<AdapterChunk> {
    let resposta: Response
    try {
      resposta = await this.fetchImpl(`${this.baseURL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
          ...(request.system === undefined ? {} : { system: request.system }),
          stream: true,
          options: { num_predict: request.maxTokens }
        }),
        ...(request.signal === undefined ? {} : { signal: request.signal })
      })
    } catch (erro) {
      if (erro instanceof Error && erro.name === 'AbortError') {
        throw new AdapterError('A chamada foi interrompida.', erro)
      }
      // A falha mais provável aqui é o servidor não estar rodando, e a mensagem diz o que
      // fazer a respeito — "falha de rede" mandaria o usuário procurar problema de internet
      // para um serviço que mora na máquina dele.
      throw new AdapterError(
        'Não foi possível falar com o Ollama. Verifique se o servidor local está rodando.',
        erro
      )
    }

    if (!resposta.ok) {
      throw new AdapterError(`O Ollama respondeu com erro ${resposta.status}.`, undefined)
    }

    if (resposta.body === null) {
      throw new AdapterError('O Ollama respondeu sem corpo.', undefined)
    }

    const leitor = resposta.body.getReader()
    const decodificador = new TextDecoder()
    let buffer = ''
    let usage = { tokensEntrada: 0, tokensSaida: 0 }

    try {
      for (;;) {
        const { done, value } = await leitor.read()
        if (done) break

        buffer += decodificador.decode(value, { stream: true })
        const { linhas, resto } = extrairLinhas(buffer)
        buffer = resto

        for (const linha of linhas) {
          // O Ollama reporta erro **dentro** do corpo com status 200 (modelo não baixado, por
          // exemplo). Sem este ramo, a chamada terminaria "com sucesso" e texto vazio.
          if (linha.error !== undefined) {
            throw new AdapterError(`O Ollama recusou a requisição: ${linha.error}`, undefined)
          }

          if (linha.response !== undefined && linha.response !== '') {
            yield { tipo: 'texto', texto: linha.response }
          }

          if (linha.done === true) {
            usage = {
              tokensEntrada: linha.prompt_eval_count ?? 0,
              tokensSaida: linha.eval_count ?? 0
            }
          }
        }
      }
    } catch (erro) {
      if (erro instanceof AdapterError) throw erro
      if (erro instanceof Error && erro.name === 'AbortError') {
        throw new AdapterError('A chamada foi interrompida.', erro)
      }
      throw new AdapterError('Falha ao ler a resposta do Ollama.', erro)
    } finally {
      leitor.releaseLock()
    }

    yield { tipo: 'fim', usage }
  }
}
