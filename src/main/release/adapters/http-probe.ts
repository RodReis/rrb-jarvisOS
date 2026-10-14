/**
 * Utilidades HTTP comuns aos verificadores de release (Preview e promoção). O alvo é código ou
 * infraestrutura que o projeto controla, então toda requisição tem prazo próprio, não segue
 * redirecionamento (um 302 para a rede interna seria SSRF), fala só com a origem declarada e lê no
 * máximo um teto de bytes.
 */

export interface HttpProbeConfig {
  readonly timeoutMs?: number
  readonly intervalMs?: number
  readonly requestTimeoutMs?: number
  readonly fetch?: typeof fetch
  readonly sleep?: (ms: number) => Promise<void>
  readonly now?: () => number
}

const PRAZO_POR_REQUISICAO_MS = 15_000
/** `//host` e `/\host` resolvem para outro host; só caminho absoluto de verdade passa. */
const CAMINHO_VALIDO = /^\/(?![/\\])[^\s]*$/

export function assertCaminho(caminho: string, nome: string): string {
  if (!CAMINHO_VALIDO.test(caminho)) throw new TypeError(`O caminho de ${nome} é inválido.`)
  return caminho
}

/** Lê o corpo até o teto; passou do teto é recusa, não leitura parcial. */
export async function lerTexto(resposta: Response, teto: number): Promise<string | null> {
  if (!resposta.body) return ''
  const leitor = resposta.body.getReader()
  const partes: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await leitor.read()
    if (done) break
    total += value.byteLength
    if (total > teto) {
      await leitor.cancel().catch(() => undefined)
      return null
    }
    partes.push(value)
  }
  return Buffer.concat(partes).toString('utf8')
}

export class HttpProbe {
  private readonly http: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number
  private readonly timeoutMs: number
  private readonly intervalMs: number
  private readonly requestTimeoutMs: number

  constructor(config: HttpProbeConfig = {}) {
    this.http = config.fetch ?? fetch
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.now = config.now ?? Date.now
    this.timeoutMs = config.timeoutMs ?? 120_000
    this.intervalMs = config.intervalMs ?? 5_000
    this.requestTimeoutMs = config.requestTimeoutMs ?? PRAZO_POR_REQUISICAO_MS
  }

  /** Requisição com prazo, sem seguir redirecionamento e só dentro da origem esperada. */
  async requisitar(alvo: URL, origem: string): Promise<Response> {
    if (alvo.origin !== origem) throw new Error('origem inesperada')
    return this.http(alvo, {
      redirect: 'error',
      signal: AbortSignal.timeout(this.requestTimeoutMs)
    })
  }

  /** Reaguarda o tempo de subida: o serviço recém-criado ou atualizado ainda pode estar iniciando. */
  async esperar<T>(tentar: () => Promise<T | null>): Promise<T | null> {
    const limite = this.now() + this.timeoutMs
    for (;;) {
      const valor = await tentar().catch(() => null)
      if (valor !== null) return valor
      if (this.now() + this.intervalMs > limite) return null
      await this.sleep(this.intervalMs)
    }
  }
}
