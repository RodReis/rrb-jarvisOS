import http from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * Ambientes de prova locais para a jornada E2E de release: um frontend e um backend por ambiente,
 * cada um numa porta efêmera, seguindo o contrato da SPEC-Release-04 — o frontend publica
 * `GET /runtime-config.json` com a URL do SEU backend e o backend responde `GET /health`. A versão
 * servida pode ser trocada em voo, o que permite simular a promoção e o rollback sem provedor.
 * Serve só à prova da própria jornada; o roteiro real usa as URLs do projeto de prova.
 */

export interface AmbienteDeProva {
  readonly nome: string
  readonly frontendUrl: string
  readonly backendUrl: string
  /** Troca a versão servida (promoção ou rollback). */
  servir(versao: string): void
  fechar(): Promise<void>
}

function escutar(servidor: http.Server): Promise<string> {
  return new Promise((resolver) => {
    servidor.listen(0, '127.0.0.1', () => {
      const { port } = servidor.address() as AddressInfo
      resolver(`http://127.0.0.1:${port}`)
    })
  })
}

function fechar(servidor: http.Server): Promise<void> {
  return new Promise((resolver) => servidor.close(() => resolver()))
}

export async function iniciarAmbiente(
  nome: string,
  versaoInicial: string
): Promise<AmbienteDeProva> {
  let versao = versaoInicial
  const backend = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    res.writeHead(404).end()
  })
  const backendUrl = await escutar(backend)
  const frontend = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><title>${nome}</title><main data-release="${versao}"><h1>${nome}</h1><p>versão ${versao}</p></main>`
      )
      return
    }
    if (req.url === '/runtime-config.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ apiUrl: backendUrl, release: versao }))
      return
    }
    res.writeHead(404).end()
  })
  const frontendUrl = await escutar(frontend)
  return {
    nome,
    frontendUrl,
    backendUrl,
    servir: (nova) => {
      versao = nova
    },
    fechar: async () => {
      await Promise.all([fechar(frontend), fechar(backend)])
    }
  }
}
