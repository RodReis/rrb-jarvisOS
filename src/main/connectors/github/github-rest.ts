/**
 * O cliente REST do GitHub (SPEC-Conectores-04).
 *
 * Camada fina de propósito: monta a requisição com os headers fixos, faz a chamada e devolve
 * status + corpo. Não decide nada — quem traduz erro é o adapter, e quem decide se um check
 * satisfaz o gate é o domínio. A separação é o que permite testar as operações contra um servidor
 * local sem mockar `fetch` em nove lugares.
 *
 * **A versão da API é fixada em todo request** (spec § Regras). Não é cortesia: o formato que os
 * parsers deste diretório conhecem é o de `2022-11-28`, e uma resposta de outra versão passaria
 * pelos mesmos parsers produzindo dado silenciosamente diferente.
 */

import { GITHUB_API_VERSION } from '@shared/domain/github-automation'

/** O que uma chamada à API devolve, reduzido ao que este código lê. */
export interface RespostaRest {
  readonly status: number
  readonly ok: boolean
  /** JSON já parseado, ou `undefined` quando o corpo não é JSON (204, ou HTML de erro de proxy). */
  readonly corpo: unknown
  readonly headers: Headers
}

export type BuscadorHttp = (url: string, init: RequestInit) => Promise<Response>

/**
 * Executa uma chamada à REST API.
 *
 * `token` entra por parâmetro e não é guardado: o cliente é criado por chamada, com o segredo que
 * o `ConnectorService` acabou de resolver. Um cliente que guardasse o token viveria mais que a
 * chamada, e o valor renovado pela F03 não chegaria nele.
 */
export class GithubRest {
  constructor(
    private readonly origem: string,
    private readonly token: string,
    private readonly buscar: BuscadorHttp,
    private readonly signal?: AbortSignal
  ) {}

  async request(
    metodo: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    caminho: string,
    corpo?: unknown
  ): Promise<RespostaRest> {
    const resposta = await this.buscar(`${this.origem}${caminho}`, {
      method: metodo,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
      ...(this.signal === undefined ? {} : { signal: this.signal })
    })

    return {
      status: resposta.status,
      ok: resposta.ok,
      corpo: await this.lerJson(resposta),
      headers: resposta.headers
    }
  }

  /**
   * Lê o corpo como JSON, tolerando o que não é.
   *
   * `undefined` cobre 204 (sem corpo) e HTML de erro de proxy. Sem o `try`, um `JSON.parse` sobre
   * HTML lançaria exceção cuja mensagem cita o corpo — e o corpo pode conter o que não deve ir
   * para o log.
   */
  private async lerJson(resposta: Response): Promise<unknown> {
    try {
      return await resposta.json()
    } catch {
      return undefined
    }
  }
}

/** Um objeto qualquer da resposta, para leitura defensiva campo a campo. */
export type Registro = Record<string, unknown>

/** Lê um campo de texto. `undefined` quando ausente ou de outro tipo. */
export function texto(v: unknown, campo: string): string | undefined {
  const valor = (v as Registro | undefined)?.[campo]
  return typeof valor === 'string' && valor !== '' ? valor : undefined
}

/** Lê um campo numérico. */
export function numero(v: unknown, campo: string): number | undefined {
  const valor = (v as Registro | undefined)?.[campo]
  return typeof valor === 'number' ? valor : undefined
}

/**
 * Lê um array de objetos. Lista vazia quando o campo não é array.
 *
 * **Estado vindo do GitHub é entrada não confiável** (spec § Regras), e a leitura defensiva é o
 * que faz isso valer na prática: um campo que mudou de forma vira lista vazia em vez de derrubar
 * a chamada com `undefined.map`.
 */
export function lista(v: unknown, campo?: string): readonly Registro[] {
  const valor = campo === undefined ? v : (v as Registro | undefined)?.[campo]
  return Array.isArray(valor) ? (valor as Registro[]) : []
}
