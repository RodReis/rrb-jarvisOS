/**
 * O cliente REST da Tavily (SPEC-Conectores-05 e 06).
 *
 * Camada fina, mesmo desenho de `github-rest.ts`: monta a requisição, faz a chamada, devolve
 * status + corpo. Não decide nada — quem traduz erro é o adapter, e quem decide se uma busca
 * satisfaz o pedido é o domínio.
 *
 * A autenticação é `Authorization: Bearer` (spec § Contrato). O token entra por parâmetro e não é
 * guardado: o cliente nasce por chamada, com o segredo que o `ConnectorService` acabou de
 * resolver.
 */

/** O que uma chamada à API devolve, reduzido ao que este código lê. */
export interface RespostaTavily {
  readonly status: number
  readonly ok: boolean
  /** JSON já parseado, ou `undefined` quando o corpo não é JSON (HTML de erro de proxy, 5xx). */
  readonly corpo: unknown
  readonly headers: Headers
}

export type BuscadorHttp = (url: string, init: RequestInit) => Promise<Response>

export class TavilyRest {
  constructor(
    private readonly origem: string,
    private readonly token: string,
    private readonly buscar: BuscadorHttp,
    private readonly signal?: AbortSignal
  ) {}

  async post(caminho: string, corpo: unknown): Promise<RespostaTavily> {
    const resposta = await this.buscar(`${this.origem}${caminho}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(corpo),
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
   * `undefined` cobre HTML de erro de proxy e 5xx sem corpo. Sem o `try`, um `JSON.parse` sobre
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

/**
 * A falha esperada: a Tavily respondeu com status de erro.
 *
 * Classe própria, como a `FalhaRest` do GitHub, para que o `catch` do adapter a distinga de uma
 * exceção genuinamente inesperada — que deve subir para o serviço traduzir num lugar só.
 */
export class FalhaTavily extends Error {
  constructor(readonly resposta: RespostaTavily) {
    super(`Tavily respondeu HTTP ${resposta.status}`)
    this.name = 'FalhaTavily'
  }
}

/** Um objeto qualquer da resposta, para leitura defensiva campo a campo. */
export type Registro = Record<string, unknown>

/** Lê um campo de texto. `undefined` quando ausente, vazio ou de outro tipo. */
export function texto(v: unknown, campo: string): string | undefined {
  const valor = (v as Registro | undefined)?.[campo]
  return typeof valor === 'string' && valor !== '' ? valor : undefined
}

/** Lê um campo numérico finito. */
export function numero(v: unknown, campo: string): number | undefined {
  const valor = (v as Registro | undefined)?.[campo]
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : undefined
}

/**
 * Lê um array de objetos. Lista vazia quando o campo não é array.
 *
 * **Resposta de serviço externo é entrada não confiável** (regra da F06: "HTML/texto externo é
 * dado não confiável"), e a leitura defensiva é o que faz isso valer: um campo que mudou de forma
 * vira lista vazia em vez de derrubar a chamada com `undefined.map`.
 */
export function lista(v: unknown, campo: string): readonly Registro[] {
  const valor = (v as Registro | undefined)?.[campo]
  return Array.isArray(valor) ? (valor as Registro[]) : []
}
