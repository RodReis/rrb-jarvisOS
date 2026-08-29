/**
 * A governança contra um servidor que **conta requisições** (SPEC-Conectores-02).
 *
 * **Servidor HTTP local e não adapter dublê**, por decisão do PI (2026-08-29) — e a diferença é
 * a que a M5-F03 já tinha aprendido ao provar o gate de orçamento: um mock que "não foi
 * chamado" prova que eu não o chamei; um servidor que **conta** prova que a requisição não
 * saiu. É o mesmo par de perguntas — "o retry repetiu?" e "o bloqueio impediu?" — e só a
 * segunda forma responde às duas.
 *
 * O adapter aqui é um HTTP de verdade, escrito para o teste: `fetch` real, `AbortSignal` real,
 * códigos de status reais (401/403/429/500/timeout). O que ele **não** é é um conector de
 * produção — GitHub é a F03 e Tavily a F05. O limite fica registrado; o que se prova é a
 * governança, que é o que esta fatia entrega.
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
  type ConnectorCapability,
  type ConnectorError,
  type ConnectorRequest,
  type ConnectorResult
} from '@shared/domain/connectors'
import { ESTADO_DO_ERRO, FALHAS_PARA_ABRIR } from '@shared/domain/connector-governance'
import { openDatabase } from '../storage/database'
import { AuditRepository } from '../storage/audit-repository'
import { PolicyService } from '../policy/policy-service'
import { ConnectorRegistry } from './registry'
import { ConnectorService } from './connector-service'
import { CreditService } from './credit-service'
import { CreditRepository } from './credit-repository'
import type { ConnectorAdapter, ConnectorExecution } from './adapter'

const USUARIO = 'user-teste'

let servidor: Server | undefined
/** Quantas requisições o servidor **recebeu**. É a asserção central de toda esta suíte. */
let recebidas: number

async function subir(
  responder: (req: IncomingMessage, res: ServerResponse) => void
): Promise<string> {
  recebidas = 0
  servidor = createServer((req, res) => {
    recebidas += 1
    responder(req, res)
  })
  await new Promise<void>((resolve) => servidor?.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
}

/**
 * Um adapter HTTP de teste — real no que importa: `fetch`, `AbortSignal` e tradução de status.
 *
 * A tradução de status para `ConnectorErrorCode` é o que todo adapter concreto vai escrever
 * (F03/F05), e tê-la aqui é o que faz o teste do critério 4 ser sobre o contrato e não sobre
 * um dublê complacente.
 */
class AdapterHttp implements ConnectorAdapter {
  readonly id = 'tavily' as const

  constructor(
    private readonly base: string,
    private readonly creditos = 1
  ) {}

  capacidades(): readonly ConnectorCapability[] {
    return [
      { connector: 'tavily', operation: 'search.query', effect: 'leitura', descricao: 'Busca' },
      { connector: 'tavily', operation: 'doc.save', effect: 'mutacao', descricao: 'Grava' }
    ]
  }

  validar(): undefined {
    return undefined
  }

  custoEstimado(): number {
    return this.creditos
  }

  async executar(e: ConnectorExecution): Promise<ConnectorResult | ConnectorError> {
    const resposta = await fetch(`${this.base}/${e.request.operation}`, {
      ...(e.signal === undefined ? {} : { signal: e.signal })
    })

    const provenance = {
      connector: 'tavily' as const,
      operation: e.request.operation,
      obtidoEm: new Date().toISOString()
    }

    if (resposta.ok) {
      return {
        ok: true,
        data: await resposta.json(),
        provenance,
        usage: { creditos: this.creditos, latenciaMs: 1 }
      }
    }

    const retryAfter = resposta.headers.get('retry-after')
    const codigos = {
      401: 'credencial-recusada',
      403: 'permissao-negada',
      429: 'indisponivel',
      500: 'indisponivel'
    } as const

    return {
      ok: false,
      code: codigos[resposta.status as keyof typeof codigos] ?? 'indisponivel',
      mensagem: `O serviço respondeu ${resposta.status}.`,
      retryable: resposta.status === 429 || resposta.status >= 500,
      acao: resposta.status === 401 || resposta.status === 403 ? 'reautenticar' : 'retentar',
      provenance,
      // O adapter traduz o cabeçalho do **seu** serviço para milissegundos: aqui, segundos.
      ...(retryAfter === null
        ? {}
        : { evidencia: `retry-after=${retryAfter}`, retryAfterMs: Number(retryAfter) * 1_000 })
    }
  }
}

function pedido(over: Partial<ConnectorRequest> = {}): ConnectorRequest {
  return {
    contractVersion: CONNECTOR_CONTRACT_VERSION,
    connector: 'tavily',
    operation: 'search.query',
    correlationId: 'corr-1',
    timeoutMs: 2_000,
    input: {},
    ...over
  }
}

let dir: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let registry: ConnectorRegistry
let credits: CreditService
let esperas: number[]

function montar(base: string, creditos = 1): ConnectorService {
  registry = new ConnectorRegistry()
  registry.register(new AdapterHttp(base, creditos))
  esperas = []

  return new ConnectorService(
    registry,
    { resolve: () => 'segredo-do-teste' },
    new PolicyService(audit, () => USUARIO),
    audit,
    credits,
    async (ms) => {
      esperas.push(ms)
    }
  )
}

const CTX = { userId: USUARIO, workspace: 'jarvis' as const }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-gov-'))
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

describe('retry — o que repete e o que não repete (critérios 2 e 3)', () => {
  it('429 numa leitura retenta e a segunda tentativa sai de verdade', async () => {
    const url = await subir((_req, res) => {
      if (recebidas === 1) {
        res.writeHead(429, { 'retry-after': '1' })
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ itens: [] }))
    })

    const desfecho = await montar(url).call(pedido(), CTX)

    expect(desfecho.ok).toBe(true)
    // A asserção que só o servidor dá: a requisição **saiu duas vezes**. Um mock diria que o
    // adapter foi chamado duas vezes, que é outra coisa.
    expect(recebidas).toBe(2)
    // E respeitou a orientação do serviço (`Retry-After: 1`), não a nossa curva de 500ms.
    expect(esperas).toEqual([1_000])
  })

  it('401 não entra em loop — uma requisição, e só', async () => {
    const url = await subir((_req, res) => {
      res.writeHead(401)
      res.end()
    })

    const desfecho = await montar(url).call(pedido(), CTX)

    expect((desfecho as ConnectorError).code).toBe('credencial-recusada')
    expect(recebidas).toBe(1)
    expect(esperas).toEqual([])
  })

  it('403 idem — permissão do usuário não se resolve repetindo', async () => {
    const url = await subir((_req, res) => {
      res.writeHead(403)
      res.end()
    })

    await montar(url).call(pedido(), CTX)

    expect(recebidas).toBe(1)
  })

  it('mutação sem chave de idempotência NUNCA é repetida, nem com 429 (critério 3)', async () => {
    const url = await subir((_req, res) => {
      res.writeHead(429)
      res.end()
    })

    // A mesma resposta que retentaria numa leitura. O pedido é recusado antes de sair, pela
    // validação da F01 — e é essa a garantia: a mutação sem chave nem chega ao servidor.
    const desfecho = await montar(url).call(pedido({ operation: 'doc.save' }), CTX)

    expect((desfecho as ConnectorError).code).toBe('validacao-invalida')
    expect(recebidas).toBe(0)
  })

  it('mutação COM chave repete, porque repetir passou a ser seguro', async () => {
    const url = await subir((_req, res) => {
      if (recebidas === 1) {
        res.writeHead(500)
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })

    const desfecho = await montar(url).call(
      pedido({ operation: 'doc.save', idempotencyKey: 'idem-1' }),
      CTX
    )

    expect(desfecho.ok).toBe(true)
    expect(recebidas).toBe(2)
  })

  it('esgotadas as tentativas, devolve a falha em vez de insistir', async () => {
    const url = await subir((_req, res) => {
      res.writeHead(500)
      res.end()
    })

    const desfecho = await montar(url).call(pedido(), CTX)

    expect(desfecho.ok).toBe(false)
    // Primeira + 1 repetição (`MAX_TENTATIVAS_PADRAO` = 2). O número exato importa menos que o
    // fato de ele ser **finito** e observado no servidor.
    expect(recebidas).toBe(2)
  })
})

describe('timeout e cancelamento liberam recursos (critério 1)', () => {
  it('o servidor que não responde vira timeout, e a conexão é abortada', async () => {
    let abortada = false
    const url = await subir((req) => {
      // Nunca responde. O `close` do request é a evidência de que o cliente soltou a conexão —
      // sem o `AbortSignal` chegando ao adapter, o socket ficaria aberto e o recurso vazaria.
      req.on('close', () => {
        abortada = true
      })
    })

    const desfecho = await montar(url).call(pedido({ timeoutMs: 150 }), CTX)

    expect((desfecho as ConnectorError).code).toBe('timeout')
    expect(abortada).toBe(true)
  })

  it('cancelamento do usuário é `cancelado`, não `timeout` — a causa importa', async () => {
    const url = await subir(() => {
      /* pendura */
    })

    const controle = new AbortController()
    const service = montar(url)
    const promessa = service.call(
      { ...pedido({ timeoutMs: 5_000 }), input: {} },
      CTX,
      controle.signal
    )
    setTimeout(() => controle.abort(), 50)

    const desfecho = await promessa

    // Sob um código só, "o usuário desistiu" e "o serviço não respondeu" seriam a mesma linha
    // na auditoria — e só a segunda é sinal sobre o serviço.
    expect((desfecho as ConnectorError).code).toBe('cancelado')
  })

  it('o timeout não é repetido indefinidamente', async () => {
    const url = await subir(() => {
      /* pendura */
    })

    await montar(url).call(pedido({ timeoutMs: 100 }), CTX)

    expect(recebidas).toBe(2)
  })
})

describe('circuit breaker — impede tempestade sem converter falha em sucesso', () => {
  it('abre após falhas seguidas e a chamada seguinte NÃO alcança o servidor', async () => {
    const url = await subir((_req, res) => {
      res.writeHead(500)
      res.end()
    })
    const service = montar(url)

    // Cada `call` gasta 2 tentativas; três chamadas fecham as `FALHAS_PARA_ABRIR`.
    for (let i = 0; i < FALHAS_PARA_ABRIR; i += 1) await service.call(pedido(), CTX)

    const recebidasAntes = recebidas
    const barrada = await service.call(pedido(), CTX)

    expect(barrada.ok).toBe(false)
    // A prova do breaker: o contador **não se moveu**. Um mock não diria isso.
    expect(recebidas).toBe(recebidasAntes)
    // E não converteu falha em sucesso: o desfecho é erro, não um resultado vazio que a tela
    // leria como "não há nada".
    expect((barrada as ConnectorError).code).toBe('indisponivel')
  })

  it('credencial recusada não abre o circuito — problema nosso não é apagão do serviço', async () => {
    const url = await subir((_req, res) => {
      res.writeHead(401)
      res.end()
    })
    const service = montar(url)

    for (let i = 0; i < FALHAS_PARA_ABRIR + 1; i += 1) await service.call(pedido(), CTX)

    const recebidasAntes = recebidas
    await service.call(pedido(), CTX)

    // O contador **anda**: o circuito seguiu fechado. Contar 401 transformaria uma credencial
    // errada num apagão do conector inteiro.
    expect(recebidas).toBe(recebidasAntes + 1)
  })
})

describe('ledger de créditos — separado, e barra a próxima (critério 8)', () => {
  it('a chamada bem-sucedida grava o consumo e a seguinte é barrada sem sair', async () => {
    const url = await subir((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })

    // Teto de 1 crédito: a primeira chamada cabe, a segunda projeta 2 sobre 1.
    credits.setLimits({ userId: USUARIO, workspace: 'jarvis' }, 'tavily', {
      dailyLimit: 1,
      monthlyLimit: 100
    })
    const service = montar(url, 1)

    const primeira = await service.call(pedido(), CTX)
    expect(primeira.ok).toBe(true)
    expect(recebidas).toBe(1)

    const segunda = await service.call(pedido({ correlationId: 'corr-2' }), CTX)

    expect((segunda as ConnectorError).code).toBe('limite-excedido')
    // A prova de que o gate **impediu**, e não apenas registrou: o servidor não recebeu nada.
    expect(recebidas).toBe(1)
  })

  it('conector que não cobra passa mesmo com o teto zerado', async () => {
    const url = await subir((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })

    credits.setLimits({ userId: USUARIO, workspace: 'jarvis' }, 'tavily', {
      dailyLimit: 0,
      monthlyLimit: 0
    })

    const desfecho = await montar(url, 0).call(pedido(), CTX)

    expect(desfecho.ok).toBe(true)
    expect(recebidas).toBe(1)
  })

  it('o ledger de créditos não toca o orçamento de USD do MVP-005', async () => {
    const url = await subir((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })

    await montar(url, 5).call(pedido(), CTX)

    // Os dois ledgers coexistem em tabelas distintas. Se alguém unificar as tabelas amanhã,
    // este teste é o que fica vermelho.
    const creditos = db.prepare('SELECT COUNT(*) AS n FROM credit_event').get() as { n: number }
    const custos = db.prepare('SELECT COUNT(*) AS n FROM cost_event').get() as { n: number }

    expect(creditos.n).toBe(1)
    expect(custos.n).toBe(0)
  })

  it('chamada barrada não consome crédito — não saiu, não custou', async () => {
    const url = await subir((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })

    credits.setLimits({ userId: USUARIO, workspace: 'jarvis' }, 'tavily', {
      dailyLimit: 0.5,
      monthlyLimit: 100
    })

    await montar(url, 1).call(pedido(), CTX)

    // Contar **linhas**, não ler mensagem: é assim que a M5-F03 pegou o `CostEvent` de uma
    // chamada que nunca saiu, e o defeito seria idêntico aqui.
    const linhas = db.prepare('SELECT COUNT(*) AS n FROM credit_event').get() as { n: number }
    expect(linhas.n).toBe(0)
  })
})

describe('sanitização — nada sensível no desfecho nem no rastro (critério 6)', () => {
  it('o segredo não aparece no desfecho, na auditoria nem no ledger', async () => {
    const url = await subir((_req, res) => {
      res.writeHead(401)
      res.end()
    })

    const desfecho = await montar(url).call(pedido(), CTX)

    const rastro = JSON.stringify(audit.list(USUARIO))
    expect(JSON.stringify(desfecho)).not.toContain('segredo-do-teste')
    expect(rastro).not.toContain('segredo-do-teste')
    // E a cadeia continua íntegra depois de tudo isso.
    expect(audit.verify(USUARIO).ok).toBe(true)
  })

  it('a auditoria de conclusão carrega o estado e o número de tentativas', async () => {
    const url = await subir((_req, res) => {
      if (recebidas === 1) {
        res.writeHead(500)
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })

    await montar(url).call(pedido(), CTX)

    const conclusao = audit
      .list(USUARIO)
      .map((e) => e.payload)
      .find((p) => p.fase === 'conclusao')

    // `DEGRADED` e não `READY`: funcionou, mas precisou repetir. Distinguir os dois é o que
    // permite ver degradação antes da primeira falha dura.
    expect(conclusao?.estado).toBe('DEGRADED')
    expect(conclusao?.tentativas).toBe(2)
  })

  it('o bloqueio por crédito é registrado pelo gate, não como conclusão de chamada', async () => {
    const url = await subir((_req, res) => {
      res.writeHead(200)
      res.end('{}')
    })

    credits.setLimits({ userId: USUARIO, workspace: 'jarvis' }, 'tavily', {
      dailyLimit: 0.5,
      monthlyLimit: 100
    })

    const desfecho = await montar(url, 1).call(pedido(), CTX)

    const eventos = audit.list(USUARIO)

    // O fato mora num tipo só. `connector-credit-decision` registra o veredito com os números;
    // repetir "barrado" como `connector-call/conclusao` colocaria o mesmo fato em dois tipos —
    // e "quantas chamadas concluíram" passaria a contar chamadas que nunca saíram, que é o
    // defeito que a M5-F03 pegou no `cost_event`.
    const decisao = eventos
      .filter((e) => e.type === 'connector-credit-decision')
      .map((e) => e.payload)
      .at(-1)

    expect(decisao?.decisao).toBe('bloqueado')
    expect(decisao?.periodo).toBe('dia')
    expect(eventos.filter((e) => e.type === 'connector-call')).toEqual([])

    // E o estado do desfecho é derivável do código, sem uma segunda fonte: é o que
    // `ESTADO_DO_ERRO` garante.
    expect(ESTADO_DO_ERRO[(desfecho as ConnectorError).code]).toBe('BLOCKED_EXTERNAL')
  })
})
