/**
 * O ponto único de conectores contra storage real (SPEC-Conectores-01, critérios 1, 2, 3 e 4).
 *
 * Banco real (SQLite em diretório temporário), não dublê, porque metade do que estes testes
 * afirmam é sobre o **rastro**: quantos `AuditEvent` uma chamada recusada deixa, e se a cadeia
 * fecha depois. Um repositório dublado concordaria com qualquer coisa — e foi contando linhas
 * de tabela, e não lendo mensagem, que a M5-F03 pegou o `CostEvent` de uma chamada que nunca
 * saiu.
 *
 * O adapter é um **fake que satisfaz a interface real** — o "contract fixture" que a spec pede.
 * Não é mock de conveniência: é a prova do critério 4. Dois adapters diferentes, escritos aqui,
 * devolvem erros que o mesmo consumidor trata pelo `code`; se `ConnectorAdapter` exigisse
 * qualquer coisa que só o GitHub tem, este arquivo não compilaria.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database as Db } from 'better-sqlite3'
import {
  CONNECTOR_CONTRACT_VERSION,
  type ConnectorCapability,
  type ConnectorError,
  type ConnectorId,
  type ConnectorOutcome,
  type ConnectorRequest,
  type ConnectorResult
} from '@shared/domain/connectors'
import { openDatabase } from '../storage/database'
import { AuditRepository } from '../storage/audit-repository'
import { PolicyService } from '../policy/policy-service'
import { ConnectorRegistry } from './registry'
import { ConnectorService, type ConnectorSecretSource } from './connector-service'
import type { ConnectorAdapter, ConnectorExecution } from './adapter'

const USUARIO = 'user-teste'

/**
 * Um adapter de mentira que satisfaz o contrato de verdade.
 *
 * Registra o que recebeu (`chamadas`) — é assim que "não chega ao adapter" vira asserção: a
 * lista fica vazia. Uma promessa de que o adapter não foi chamado, sem contador, não é
 * verificável.
 */
class AdapterFake implements ConnectorAdapter {
  readonly chamadas: ConnectorExecution[] = []
  readonly validacoes: ConnectorExecution[] = []

  constructor(
    readonly id: ConnectorId,
    private readonly caps: readonly ConnectorCapability[],
    private readonly resposta: (e: ConnectorExecution) => ConnectorResult | ConnectorError,
    private readonly recusarInput?: (e: ConnectorExecution) => ConnectorError | undefined
  ) {}

  capacidades(): readonly ConnectorCapability[] {
    return this.caps
  }

  validar(execution: ConnectorExecution): ConnectorError | undefined {
    this.validacoes.push(execution)
    return this.recusarInput?.(execution)
  }

  async executar(execution: ConnectorExecution): Promise<ConnectorResult | ConnectorError> {
    this.chamadas.push(execution)
    return this.resposta(execution)
  }
}

function capacidade(
  connector: ConnectorId,
  operation: string,
  effect: 'leitura' | 'mutacao'
): ConnectorCapability {
  return { connector, operation, effect, descricao: `${operation} de teste` }
}

function pedido(over: Partial<ConnectorRequest> = {}): ConnectorRequest {
  return {
    contractVersion: CONNECTOR_CONTRACT_VERSION,
    connector: 'tavily',
    operation: 'search.query',
    correlationId: 'corr-1',
    timeoutMs: 5_000,
    input: { q: 'jarvis' },
    ...over
  }
}

const OK = (): ConnectorResult => ({
  ok: true,
  data: { itens: [] },
  provenance: { connector: 'tavily', operation: 'search.query', obtidoEm: '2026-08-29T00:00:00Z' },
  usage: { creditos: 1, latenciaMs: 5 }
})

let dir: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let registry: ConnectorRegistry
let segredos: ConnectorSecretSource & { readonly pedidas: string[] }
let service: ConnectorService

/** Quantos eventos de conector a cadeia guardou. */
function eventosDeConector(): readonly Record<string, unknown>[] {
  return audit
    .list(USUARIO)
    .filter((e) => e.type === 'connector-call')
    .map((e) => e.payload)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-connectors-'))
  db = openDatabase(join(dir, 'jarvis.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  registry = new ConnectorRegistry()

  const pedidas: string[] = []
  segredos = {
    pedidas,
    resolve: (_userId, _workspace, key) => {
      pedidas.push(key)
      return key === 'github' ? 'token-do-github' : undefined
    }
  }

  service = new ConnectorService(registry, segredos, new PolicyService(audit, () => USUARIO), audit)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('registro — explícito, sem resolução arbitrária (critério 6)', () => {
  it('resolve o adapter registrado e recusa o que ninguém registrou', () => {
    const tavily = new AdapterFake('tavily', [capacidade('tavily', 'search.query', 'leitura')], OK)
    registry.register(tavily)

    expect(registry.resolve('tavily')).toBe(tavily)
    expect(registry.resolve('github')).toBeUndefined()
    expect(registry.registered()).toEqual(['tavily'])
  })

  it('recusa registrar o mesmo conector duas vezes', () => {
    const um = new AdapterFake('tavily', [], OK)
    const dois = new AdapterFake('tavily', [], OK)
    registry.register(um)

    // Sobrescrever em silêncio faria a ordem de carregamento decidir quem atende — bug que só
    // aparece quando a ordem muda.
    expect(() => registry.register(dois)).toThrow(/já registrado/i)
    expect(registry.resolve('tavily')).toBe(um)
  })

  it('lista as capacidades de todos os adapters — é o que a ponte expõe (critério 5)', () => {
    registry.register(
      new AdapterFake('tavily', [capacidade('tavily', 'search.query', 'leitura')], OK)
    )
    registry.register(
      new AdapterFake('github', [capacidade('github', 'issues.create', 'mutacao')], OK)
    )

    expect(
      service
        .capabilities()
        .map((c) => `${c.connector}:${c.operation}`)
        .sort()
    ).toEqual(['github:issues.create', 'tavily:search.query'])
  })
})

describe('recusa antes de qualquer I/O (critérios 1 e 2)', () => {
  it('conector sem adapter falha sem tocar o cofre e sem auditar requisição', async () => {
    const desfecho = await service.call(
      pedido({ credential: { key: 'tavily', user_id: USUARIO, workspace_id: 'jarvis' } }),
      { userId: USUARIO, workspace: 'jarvis' }
    )

    expect(desfecho.ok).toBe(false)
    expect((desfecho as ConnectorError).code).toBe('connector-nao-registrado')
    // A asserção que sustenta "antes de I/O": o cofre não foi consultado…
    expect(segredos.pedidas).toEqual([])
    // …e nenhuma requisição foi registrada. Auditar "requisitei" uma chamada que nunca saiu é
    // o mesmo defeito que a M5-F03 pegou contando linhas de `cost_event`.
    expect(eventosDeConector()).toEqual([])
  })

  it('capacidade desconhecida falha sem chegar ao adapter', async () => {
    const tavily = new AdapterFake('tavily', [capacidade('tavily', 'search.query', 'leitura')], OK)
    registry.register(tavily)

    // O pedido **traz** credencial de propósito: sem ela, `pedidas` ficaria vazia mesmo numa
    // implementação que resolvesse o cofre antes de validar, e a asserção de ordem não provaria
    // nada. Com ela, mover a busca de credencial para antes da validação quebra este teste.
    const desfecho = await service.call(
      pedido({
        operation: 'search.inventada',
        credential: { key: 'tavily', user_id: USUARIO, workspace_id: 'jarvis' }
      }),
      { userId: USUARIO, workspace: 'jarvis' }
    )

    expect((desfecho as ConnectorError).code).toBe('capacidade-desconhecida')
    expect(tavily.chamadas).toEqual([])
    expect(tavily.validacoes).toEqual([])
    expect(segredos.pedidas).toEqual([])
    expect(eventosDeConector()).toEqual([])
  })

  it('mutação sem chave de idempotência não chega ao adapter', async () => {
    const github = new AdapterFake('github', [capacidade('github', 'issues.create', 'mutacao')], OK)
    registry.register(github)

    const desfecho = await service.call(
      pedido({ connector: 'github', operation: 'issues.create' }),
      { userId: USUARIO, workspace: 'jarvis' }
    )

    expect((desfecho as ConnectorError).code).toBe('validacao-invalida')
    expect(github.chamadas).toEqual([])
  })

  it('o adapter recusa o input que só ele conhece — e a execução não acontece', async () => {
    const github = new AdapterFake(
      'github',
      [capacidade('github', 'issues.create', 'mutacao')],
      OK,
      (e) =>
        typeof (e.request.input as { titulo?: string }).titulo === 'string'
          ? undefined
          : {
              ok: false,
              code: 'validacao-invalida',
              mensagem: 'A issue precisa de um título.',
              retryable: false,
              acao: 'corrigir-entrada',
              provenance: {
                connector: 'github',
                operation: 'issues.create',
                obtidoEm: '2026-08-29T00:00:00Z'
              }
            }
    )
    registry.register(github)

    const desfecho = await service.call(
      pedido({
        connector: 'github',
        operation: 'issues.create',
        idempotencyKey: 'idem-1',
        input: {}
      }),
      { userId: USUARIO, workspace: 'jarvis' }
    )

    expect((desfecho as ConnectorError).code).toBe('validacao-invalida')
    expect(github.validacoes).toHaveLength(1)
    expect(github.chamadas).toEqual([])
    // A validação do adapter também vem **antes** do cofre: recusado o pedido, não há por que
    // ter aberto a credencial.
    expect(segredos.pedidas).toEqual([])
  })
})

describe('credencial — referência de ida, valor nunca de volta (critério 3)', () => {
  it('entrega o segredo ao adapter por parâmetro, e ele não sai no desfecho', async () => {
    let recebido: string | undefined
    const github = new AdapterFake(
      'github',
      [capacidade('github', 'issues.create', 'mutacao')],
      (e) => {
        recebido = e.secret
        return {
          ok: true,
          data: { numero: 7 },
          provenance: {
            connector: 'github',
            operation: 'issues.create',
            obtidoEm: '2026-08-29T00:00:00Z'
          },
          usage: { creditos: 0, latenciaMs: 12 },
          externalRef: { id: '7', url: 'https://example.test/7' }
        }
      }
    )
    registry.register(github)

    const desfecho = await service.call(
      pedido({
        connector: 'github',
        operation: 'issues.create',
        idempotencyKey: 'idem-1',
        credential: { key: 'github', user_id: USUARIO, workspace_id: 'jarvis' }
      }),
      { userId: USUARIO, workspace: 'jarvis' }
    )

    expect(recebido).toBe('token-do-github')
    expect(desfecho.ok).toBe(true)
    // O segredo não aparece em lugar nenhum do que atravessa o IPC — nem no desfecho, nem no
    // rastro. A busca é sobre o JSON inteiro, não sobre campos conhecidos: um campo novo que
    // o carregasse passaria por uma asserção que só olhasse `data`.
    expect(JSON.stringify(desfecho)).not.toContain('token-do-github')
    expect(JSON.stringify(eventosDeConector())).not.toContain('token-do-github')
  })

  it('credencial ausente é desfecho previsto, com ação de reautenticar', async () => {
    const tavily = new AdapterFake('tavily', [capacidade('tavily', 'search.query', 'leitura')], OK)
    registry.register(tavily)

    const desfecho = await service.call(
      pedido({ credential: { key: 'tavily', user_id: USUARIO, workspace_id: 'jarvis' } }),
      { userId: USUARIO, workspace: 'jarvis' }
    )

    expect((desfecho as ConnectorError).code).toBe('credencial-ausente')
    expect((desfecho as ConnectorError).acao).toBe('reautenticar')
    expect(tavily.chamadas).toEqual([])
    expect(segredos.pedidas).toEqual(['tavily'])
  })

  it('operação sem credencial declarada não consulta o cofre', async () => {
    registry.register(
      new AdapterFake('tavily', [capacidade('tavily', 'search.query', 'leitura')], OK)
    )

    const desfecho = await service.call(pedido(), { userId: USUARIO, workspace: 'jarvis' })

    expect(desfecho.ok).toBe(true)
    expect(segredos.pedidas).toEqual([])
  })
})

describe('erros equivalentes de adapters diferentes (critério 4)', () => {
  it('o mesmo consumidor trata 401 do GitHub e da Tavily pelo mesmo código', async () => {
    const recusa = (connector: ConnectorId): ConnectorError => ({
      ok: false,
      code: 'credencial-recusada',
      mensagem: `${connector} recusou a credencial.`,
      retryable: false,
      acao: 'reautenticar',
      provenance: { connector, operation: 'x', obtidoEm: '2026-08-29T00:00:00Z' }
    })

    registry.register(
      new AdapterFake('tavily', [capacidade('tavily', 'search.query', 'leitura')], () =>
        recusa('tavily')
      )
    )
    registry.register(
      new AdapterFake('github', [capacidade('github', 'issues.list', 'leitura')], () =>
        recusa('github')
      )
    )

    const desfechos: readonly ConnectorOutcome[] = [
      await service.call(pedido(), { userId: USUARIO, workspace: 'jarvis' }),
      await service.call(pedido({ connector: 'github', operation: 'issues.list' }), {
        userId: USUARIO,
        workspace: 'jarvis'
      })
    ]

    // Um `switch` sobre `code` é o que o orquestrador escreve. Se cada adapter devolvesse o
    // erro do seu SDK, esta função precisaria de dois ramos por conector.
    const acoes = desfechos.map((d) => (d.ok ? 'seguir' : d.acao))
    expect(acoes).toEqual(['reautenticar', 'reautenticar'])
  })

  it('exceção inesperada do adapter vira erro normalizado, sem vazar a mensagem do SDK', async () => {
    class AdapterQueExplode implements ConnectorAdapter {
      readonly id: ConnectorId = 'tavily'
      capacidades(): readonly ConnectorCapability[] {
        return [capacidade('tavily', 'search.query', 'leitura')]
      }
      validar(): undefined {
        return undefined
      }
      async executar(): Promise<never> {
        throw new Error('GET https://api.tavily.com?key=tvly-segredo falhou')
      }
    }
    registry.register(new AdapterQueExplode())

    const desfecho = await service.call(pedido(), { userId: USUARIO, workspace: 'jarvis' })

    expect(desfecho.ok).toBe(false)
    expect((desfecho as ConnectorError).code).toBe('indisponivel')
    // A mensagem do SDK carregava a chave na query — repassá-la publicaria o segredo na tela.
    expect(JSON.stringify(desfecho)).not.toContain('tvly-segredo')
  })
})

describe('auditoria — dois eventos por chamada que sai', () => {
  it('registra requisição e conclusão, e a cadeia continua íntegra', async () => {
    registry.register(
      new AdapterFake('tavily', [capacidade('tavily', 'search.query', 'leitura')], OK)
    )

    await service.call(pedido(), { userId: USUARIO, workspace: 'jarvis' })

    const eventos = eventosDeConector()
    // Na ordem em que aconteceram: a requisição **antes** da conclusão. A ordem é o que a
    // auditoria conta (decidi, então fiz), e um evento só no fim perderia a chamada que morre
    // no meio.
    expect(eventos.map((p) => p.fase)).toEqual(['requisicao', 'conclusao'])
    expect(eventos.every((p) => p.correlationId === 'corr-1')).toBe(true)
    expect(audit.verify(USUARIO).ok).toBe(true)
  })

  it('a conclusão de uma chamada que falhou carrega o código, não a exceção', async () => {
    registry.register(
      new AdapterFake('tavily', [capacidade('tavily', 'search.query', 'leitura')], () => ({
        ok: false,
        code: 'limite-excedido',
        mensagem: 'Cota esgotada.',
        retryable: true,
        acao: 'retentar',
        provenance: {
          connector: 'tavily',
          operation: 'search.query',
          obtidoEm: '2026-08-29T00:00:00Z'
        }
      }))
    )

    await service.call(pedido(), { userId: USUARIO, workspace: 'jarvis' })

    const conclusao = eventosDeConector().find((p) => p.fase === 'conclusao')
    expect(conclusao?.ok).toBe(false)
    expect(conclusao?.code).toBe('limite-excedido')
  })

  it('o input não entra na auditoria — conteúdo não é evidência', async () => {
    registry.register(
      new AdapterFake('tavily', [capacidade('tavily', 'search.query', 'leitura')], OK)
    )

    await service.call(pedido({ input: { q: 'busca-confidencial-do-usuario' } }), {
      userId: USUARIO,
      workspace: 'jarvis'
    })

    expect(JSON.stringify(eventosDeConector())).not.toContain('busca-confidencial-do-usuario')
  })
})
