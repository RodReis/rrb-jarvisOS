/**
 * O conector Tavily pelo ponto único, contra um servidor que **conta requisições**
 * (SPEC-Conectores-05 e 06).
 *
 * A diferença para `tavily-adapter.spec.ts` é o que está sob teste: lá, o adapter sozinho, com
 * `fetch` dublado; aqui, o adapter **de produção** atravessando o `ConnectorService` real —
 * gate de créditos, retry, ledger, auditoria encadeada e banco em disco.
 *
 * O servidor que conta é a decisão do PI que a F02 registrou, e ela vale exatamente para o que
 * esta fatia acrescenta: um mock que "não foi chamado" prova que eu não o chamei; um servidor
 * que **conta** prova que a requisição não saiu. É a única forma de afirmar que o teto de
 * créditos barrou a pesquisa em vez de deixá-la sair e descartar o resultado.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database as Db } from 'better-sqlite3'
import {
  CONNECTOR_CONTRACT_VERSION,
  type ConnectorError,
  type ConnectorRequest,
  type ConnectorResult
} from '@shared/domain/connectors'
import {
  TAVILY_OPERATIONS,
  type TavilyExtractData,
  type TavilySearchData
} from '@shared/domain/tavily'
import { openDatabase } from '../../storage/database'
import { AuditRepository } from '../../storage/audit-repository'
import { PolicyService } from '../../policy/policy-service'
import { ConnectorRegistry } from '../registry'
import { ConnectorService } from '../connector-service'
import { CreditService } from '../credit-service'
import { CreditRepository } from '../credit-repository'
import { TavilyAdapter } from './tavily-adapter'

const USUARIO = 'user-teste'
const CTX = { userId: USUARIO, workspace: 'jarvis' as const }

let servidor: Server | undefined
/** Quantas requisições o servidor **recebeu**. É a asserção central desta suíte. */
let recebidas: number
/** O que cada requisição trouxe — caminho, corpo e cabeçalho de autorização. */
let requisicoes: { caminho: string; corpo: unknown; autorizacao?: string }[]

async function subir(
  responder: (req: IncomingMessage, res: ServerResponse) => void
): Promise<string> {
  recebidas = 0
  requisicoes = []

  servidor = createServer((req, res) => {
    recebidas += 1
    const pedacos: Buffer[] = []

    req.on('data', (p: Buffer) => pedacos.push(p))
    req.on('end', () => {
      const cru = Buffer.concat(pedacos).toString('utf8')
      requisicoes.push({
        caminho: req.url ?? '',
        corpo: cru === '' ? undefined : JSON.parse(cru),
        ...(req.headers.authorization === undefined
          ? {}
          : { autorizacao: req.headers.authorization })
      })
      responder(req, res)
    })
  })

  await new Promise<void>((resolve) => servidor?.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
}

/** Responde JSON com o status dado. */
function responder(res: ServerResponse, status: number, corpo: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(corpo))
}

let dir: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let credits: CreditService
let esperas: number[]

/**
 * Monta o serviço com o adapter de produção.
 *
 * `secret` é objeto e não string com default: `montar(url, undefined)` ativaria o valor padrão
 * do TypeScript em vez de significar "o cofre está vazio" — e a chamada sairia autenticada num
 * teste que existe para provar o contrário. Um wrapper explícito não tem esse buraco.
 */
function montar(
  base: string,
  cofre: { secret?: string } = { secret: 'tvly-do-teste' }
): ConnectorService {
  const secret = cofre.secret
  const registry = new ConnectorRegistry()
  registry.register(new TavilyAdapter(undefined, undefined, base))
  esperas = []

  return new ConnectorService(
    registry,
    { resolve: () => secret },
    new PolicyService(audit, () => USUARIO),
    audit,
    credits,
    async (ms) => {
      esperas.push(ms)
    }
  )
}

function busca(over: Partial<ConnectorRequest> = {}): ConnectorRequest {
  return {
    contractVersion: CONNECTOR_CONTRACT_VERSION,
    connector: 'tavily',
    operation: TAVILY_OPERATIONS.search,
    correlationId: 'corr-1',
    timeoutMs: 2_000,
    // A credencial é **referência**, e é ela que faz o serviço consultar o cofre: sem este
    // campo, `resolverCredencial` devolve cedo e a chamada sairia sem segredo. Foi o que a
    // primeira execução desta suíte mostrou — `Bearer` vazio chegando ao servidor.
    credential: { key: 'tavily', user_id: USUARIO, workspace_id: 'jarvis' },
    input: { query: 'mercado de agentes' },
    ...over
  }
}

function extracao(urls: readonly string[], over: Partial<ConnectorRequest> = {}): ConnectorRequest {
  return busca({ operation: TAVILY_OPERATIONS.extract, input: { urls }, ...over })
}

const UMA_FONTE = {
  results: [{ title: 'T', url: 'https://exemplo.com/a', content: 'trecho', domain: 'exemplo.com' }],
  usage: { credits: 1 },
  request_id: 'req-1'
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-tavily-'))
  db = openDatabase(join(dir, 'jarvis.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  credits = new CreditService(new CreditRepository(db), audit)
})

afterEach(async () => {
  if (servidor !== undefined) {
    await new Promise<void>((resolve) => servidor?.close(() => resolve()))
    servidor = undefined
  }
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('busca pelo ponto único — a requisição sai, autenticada e normalizada', () => {
  it('pesquisa e devolve fonte verificável, com a chave por Bearer', async () => {
    const url = await subir((_req, res) => responder(res, 200, UMA_FONTE))

    const desfecho = (await montar(url).call(busca(), CTX)) as ConnectorResult
    const data = desfecho.data as TavilySearchData

    expect(desfecho.ok).toBe(true)
    expect(recebidas).toBe(1)
    expect(requisicoes[0]?.caminho).toBe('/search')
    expect(requisicoes[0]?.autorizacao).toBe('Bearer tvly-do-teste')
    expect(data.fontes[0]?.url).toBe('https://exemplo.com/a')
    expect(data.requestId).toBe('req-1')
  })

  it('manda a profundidade e o máximo de resultados que o pedido escolheu', async () => {
    const url = await subir((_req, res) => responder(res, 200, UMA_FONTE))

    await montar(url).call(busca({ input: { query: 'x', depth: 'advanced', maxResults: 3 } }), CTX)

    expect(requisicoes[0]?.corpo).toMatchObject({
      query: 'x',
      search_depth: 'advanced',
      max_results: 3
    })
  })

  it('entrada inválida NÃO chega ao servidor — a recusa é gratuita', async () => {
    // O critério 2 da F01 valendo ponta a ponta: a validação roda antes de qualquer I/O, e o
    // contador prova que nenhuma requisição saiu.
    const url = await subir((_req, res) => responder(res, 200, UMA_FONTE))

    const desfecho = (await montar(url).call(
      busca({ input: { query: '' } }),
      CTX
    )) as ConnectorError

    expect(desfecho.code).toBe('validacao-invalida')
    expect(recebidas).toBe(0)
  })

  it('sem credencial no cofre, a chamada não sai', async () => {
    const url = await subir((_req, res) => responder(res, 200, UMA_FONTE))

    const desfecho = (await montar(url, {}).call(busca(), CTX)) as ConnectorError

    expect(desfecho.code).toBe('credencial-ausente')
    expect(recebidas).toBe(0)
  })
})

describe('gate de créditos — a pesquisa que estoura o teto não sai (critério 6 da F05)', () => {
  it('teto zerado barra a busca antes de qualquer requisição', async () => {
    // A asserção que só o servidor dá. Um mock diria "o adapter não foi chamado"; o contador
    // diz que **a requisição não saiu** — que é o que "barra a próxima pesquisa" significa.
    const url = await subir((_req, res) => responder(res, 200, UMA_FONTE))
    credits.setLimits(CTX, 'tavily', { dailyLimit: 0, monthlyLimit: 0 })

    const desfecho = (await montar(url).call(busca(), CTX)) as ConnectorError

    expect(desfecho.code).toBe('limite-excedido')
    expect(recebidas).toBe(0)
  })

  it('o consumo entra no ledger e a busca seguinte é barrada pelo acumulado', async () => {
    const url = await subir((_req, res) => responder(res, 200, UMA_FONTE))
    // Teto de 1 crédito: a primeira busca cabe (1), a segunda projetaria 2 e estoura.
    credits.setLimits(CTX, 'tavily', { dailyLimit: 1, monthlyLimit: 100 })
    const service = montar(url)

    const primeira = await service.call(busca(), CTX)
    const segunda = (await service.call(busca({ correlationId: 'corr-2' }), CTX)) as ConnectorError

    expect(primeira.ok).toBe(true)
    expect(segunda.code).toBe('limite-excedido')
    // Uma requisição saiu, não duas: o ledger recebeu o consumo da primeira e barrou a segunda.
    expect(recebidas).toBe(1)
    expect(credits.snapshot(CTX, 'tavily').consumido.dia).toBe(1)
  })

  it('a busca advanced consome o dobro no ledger', async () => {
    const url = await subir((_req, res) => responder(res, 200, { ...UMA_FONTE, usage: undefined }))

    await montar(url).call(busca({ input: { query: 'x', depth: 'advanced' } }), CTX)

    expect(credits.snapshot(CTX, 'tavily').consumido.dia).toBe(2)
  })

  it('Search e Extract entram no ledger com custos próprios (critério 5 da F06)', async () => {
    const url = await subir((req, res) => {
      if (req.url === '/search') return responder(res, 200, UMA_FONTE)
      return responder(res, 200, {
        results: [{ url: 'https://exemplo.com/a', raw_content: 'conteúdo' }],
        failed_results: [],
        usage: { total_credits_used: 1 }
      })
    })
    const service = montar(url)

    await service.call(busca(), CTX)
    await service.call(extracao(['https://exemplo.com/a'], { correlationId: 'corr-2' }), CTX)

    // Dois créditos somados: 1 da busca e 1 da extração. Atribuídos separadamente porque cada
    // chamada registra o seu — e é o que permite saber qual das duas gastou a cota.
    expect(credits.snapshot(CTX, 'tavily').consumido.dia).toBe(2)
    expect(recebidas).toBe(2)
  })

  it('extração cujo custo estimado estoura o teto não sai', async () => {
    // O gate estima pelo pior caso — 6 URLs são dois grupos, 2 créditos —, e com teto 1 a
    // chamada é barrada antes de gastar. Estimar pelo melhor caso a deixaria sair.
    const url = await subir((_req, res) => responder(res, 200, { results: [] }))
    credits.setLimits(CTX, 'tavily', { dailyLimit: 1, monthlyLimit: 100 })

    const urls = Array.from({ length: 6 }, (_, i) => `https://exemplo.com/${i}`)
    const desfecho = (await montar(url).call(extracao(urls), CTX)) as ConnectorError

    expect(desfecho.code).toBe('limite-excedido')
    expect(recebidas).toBe(0)
  })
})

describe('limites da Tavily — 429 retenta, 432/433 não', () => {
  it('429 numa busca retenta e a segunda tentativa sai de verdade', async () => {
    const url = await subir((_req, res) => {
      if (recebidas === 1) {
        res.writeHead(429, { 'retry-after': '1' })
        res.end('{}')
        return
      }
      responder(res, 200, UMA_FONTE)
    })

    const desfecho = await montar(url).call(busca(), CTX)

    expect(desfecho.ok).toBe(true)
    expect(recebidas).toBe(2)
    // Obedeceu à orientação do serviço (`Retry-After: 1`), não à curva de 500ms.
    expect(esperas).toEqual([1_000])
  })

  it('432 NÃO retenta — uma requisição, e só', async () => {
    // Esperar não devolve cota comprada: insistir contra um limite de plano só acrescenta carga
    // a um serviço que já disse não.
    const url = await subir((_req, res) => responder(res, 432, { detail: 'plan limit' }))

    const desfecho = (await montar(url).call(busca(), CTX)) as ConnectorError

    expect(desfecho.code).toBe('limite-excedido')
    expect(desfecho.retryable).toBe(false)
    expect(recebidas).toBe(1)
  })

  it('433 também não retenta', async () => {
    const url = await subir((_req, res) => responder(res, 433, { detail: 'paygo limit' }))

    const desfecho = (await montar(url).call(busca(), CTX)) as ConnectorError

    expect(desfecho.code).toBe('limite-excedido')
    expect(recebidas).toBe(1)
  })

  it('401 não entra em loop', async () => {
    const url = await subir((_req, res) => responder(res, 401, { detail: 'unauthorized' }))

    const desfecho = (await montar(url).call(busca(), CTX)) as ConnectorError

    expect(desfecho.code).toBe('credencial-recusada')
    expect(recebidas).toBe(1)
  })

  it('quota estourada não consome crédito — a chamada falhou', async () => {
    const url = await subir((_req, res) => responder(res, 432, {}))

    await montar(url).call(busca(), CTX)

    // Registrar consumo de uma chamada que falhou poluiria a soma com o que nunca foi entregue.
    expect(credits.snapshot(CTX, 'tavily').consumido.dia).toBe(0)
  })
})

describe('extração pelo ponto único — evidência e falha parcial', () => {
  it('extrai, hasheia e devolve o pacote com as ausentes identificadas', async () => {
    const url = await subir((_req, res) =>
      responder(res, 200, {
        results: [
          { url: 'https://exemplo.com/a', raw_content: 'conteúdo A' },
          { url: 'https://outro.com/b', raw_content: 'conteúdo B' }
        ],
        failed_results: [{ url: 'https://caiu.com/c', error: 'timeout' }],
        usage: { total_credits_used: 1 },
        request_id: 'req-2'
      })
    )

    const desfecho = (await montar(url).call(
      extracao(['https://exemplo.com/a', 'https://outro.com/b', 'https://caiu.com/c']),
      CTX
    )) as ConnectorResult
    const data = desfecho.data as TavilyExtractData

    expect(desfecho.ok).toBe(true)
    expect(data.evidencias).toHaveLength(2)
    expect(data.evidencias[0]?.hashConteudo).toHaveLength(64)
    expect(data.falhas).toEqual([{ url: 'https://caiu.com/c', motivo: 'timeout' }])
    expect(requisicoes[0]?.caminho).toBe('/extract')
  })

  it('manda markdown e a profundidade escolhida', async () => {
    const url = await subir((_req, res) => responder(res, 200, { results: [] }))

    await montar(url).call(
      extracao(['https://a.com'], { input: { urls: ['https://a.com'], depth: 'advanced' } }),
      CTX
    )

    expect(requisicoes[0]?.corpo).toMatchObject({
      urls: ['https://a.com'],
      extract_depth: 'advanced',
      format: 'markdown'
    })
  })

  it('URL não-http é recusada antes de sair', async () => {
    // A guarda que impede uma entrada externa pedir a leitura de um caminho local.
    const url = await subir((_req, res) => responder(res, 200, { results: [] }))

    const desfecho = (await montar(url).call(
      extracao(['file:///etc/passwd']),
      CTX
    )) as ConnectorError

    expect(desfecho.code).toBe('validacao-invalida')
    expect(recebidas).toBe(0)
  })
})

describe('auditoria — o rastro fecha e não carrega segredo', () => {
  it('a cadeia continua íntegra depois de busca e extração', async () => {
    const url = await subir((req, res) =>
      req.url === '/search'
        ? responder(res, 200, UMA_FONTE)
        : responder(res, 200, { results: [{ url: 'https://a.com', raw_content: 'x' }] })
    )
    const service = montar(url)

    await service.call(busca(), CTX)
    await service.call(extracao(['https://a.com'], { correlationId: 'corr-2' }), CTX)

    const verificacao = audit.verify(USUARIO)
    expect(verificacao.ok).toBe(true)
    expect(verificacao.checked).toBeGreaterThan(0)
  })

  it('nenhum evento de auditoria contém a chave da Tavily', async () => {
    // A garantia estrutural da M5-F01 valendo para o conector: o segredo existe em memória, no
    // main, pelo tempo da chamada — e não entra no rastro.
    const url = await subir((_req, res) => responder(res, 200, UMA_FONTE))

    await montar(url).call(busca(), CTX)

    const eventos = JSON.stringify(audit.list(USUARIO))
    expect(eventos).not.toContain('tvly-do-teste')
  })

  it('a busca barrada pela cota NÃO registra fase de requisição', async () => {
    // A lição da M5-F03: auditar `bloqueado` não prova enforcement — o que separa "barrei" de
    // "deixei sair e descartei" é a **ausência** da fase `requisicao`.
    const url = await subir((_req, res) => responder(res, 200, UMA_FONTE))
    credits.setLimits(CTX, 'tavily', { dailyLimit: 0, monthlyLimit: 0 })

    await montar(url).call(busca(), CTX)

    const requisicoesAuditadas = audit
      .list(USUARIO)
      .filter(
        (e) =>
          e.type === 'connector-call' &&
          (e.payload as { fase?: string } | undefined)?.fase === 'requisicao'
      )

    expect(requisicoesAuditadas).toHaveLength(0)
    expect(recebidas).toBe(0)
  })
})
