/**
 * O console da geração visto **de dentro do ponto único** (SPEC-Fases-03, critérios 2 e 8).
 *
 * O que se prova aqui não dá para provar no repositório nem no adapter: que o trace nasce com o
 * mesmo `call_id` que vai ao ledger, que ele **não** nasce quando a chamada é barrada antes de
 * sair, e que o desfecho gravado é o desfecho real — inclusive quando o consumidor abandona o
 * stream no meio, que é o caminho do cancelamento.
 *
 * Arquivo próprio, e não mais um `describe` em `call-provider.int-spec.ts`: aquela suíte é sobre
 * o contrato do ponto único (auditoria, orçamento, roteamento) e já passa de 900 linhas. O
 * console é uma preocupação nova, com dublês próprios.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BudgetService } from '../budget/budget-service'
import { BudgetRepository } from '../budget/budget-repository'
import { RoutingService } from './routing-service'
import { RoutingRepository } from './routing-repository'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn(),
  writeLog: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { PolicyService } = await import('../policy/policy-service')
const { CredentialRepository } = await import('../credentials/credential-repository')
const { CredentialService } = await import('../credentials/credential-service')
const { AiCallService } = await import('./call-provider')
const { AdapterError } = await import('./anthropic-adapter')
const { GenerationTraceRepository } = await import('./generation-trace-repository')
const { GenerationTraceService } = await import('./generation-trace-service')

type AdapterChunk = import('./adapter').AdapterChunk
type AiAdapter = import('./adapter').AiAdapter
type AdapterRequest = import('./adapter').AdapterRequest
type AiStreamEvent = import('@shared/domain/ai').AiStreamEvent
type AberturaDoConsole = import('./call-provider').AberturaDoConsole
type GenerationEvent = import('@shared/domain/geracao').GenerationEvent
type StatusDoTrace = import('@shared/domain/geracao').StatusDoTrace

const MASCARA = 0x5a
const cipherFalso = {
  encrypt: (t: string): Buffer => Buffer.from(Buffer.from(t, 'utf8').map((b) => b ^ MASCARA)),
  decrypt: (c: Buffer): string => Buffer.from(c.map((b) => b ^ MASCARA)).toString('utf8')
}

const USUARIO = 'usuario-de-teste'
const PROMPT = 'qual a capital da Franca'
const PACK = 'pack-de-teste'
const USAGE = { tokensEntrada: 1_000, tokensSaida: 500 }

const ROTEIRO_OK: readonly AdapterChunk[] = [
  { tipo: 'texto', texto: 'Paris' },
  { tipo: 'fim', usage: USAGE }
]

const PEDIDO_COM_CONSOLE = {
  provider: 'claude-code' as const,
  prompt: PROMPT,
  contextPackId: PACK,
  console: { projectId: 'p1', etapa: 'refinamento' as const }
}

let dir: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let credentials: InstanceType<typeof CredentialService>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-console-'))
  db = openDatabase(join(dir, 'teste.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  credentials = new CredentialService(new CredentialRepository(db, cipherFalso), audit)
  logCat.warn.mockClear()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function adapterFalso(
  roteiro: readonly AdapterChunk[] | (() => AsyncIterable<AdapterChunk>)
): AiAdapter & { recebido?: AdapterRequest } {
  const falso: AiAdapter & { recebido?: AdapterRequest } = {
    nome: 'claude-code',
    generateStream(request: AdapterRequest): AsyncIterable<AdapterChunk> {
      falso.recebido = request
      if (typeof roteiro === 'function') return roteiro()
      return (async function* () {
        for (const chunk of roteiro) yield chunk
      })()
    }
  }
  return falso
}

/**
 * Um adapter que **emite eventos de console**, como o `ClaudeCodeAdapter` faz ao parsear cada
 * linha do `stream-json`. Emite pela referência que o ponto único lhe entregou no
 * `AdapterRequest`, que é exatamente o caminho do adapter real.
 */
function adapterEmissor(eventos: readonly GenerationEvent[]): AiAdapter {
  return {
    nome: 'claude-code',
    generateStream(request: AdapterRequest): AsyncIterable<AdapterChunk> {
      return (async function* (): AsyncIterable<AdapterChunk> {
        for (const evento of eventos) {
          request.onEvento?.(evento)
          if (evento.tipo === 'texto') yield { tipo: 'texto', texto: evento.delta }
        }
        yield { tipo: 'fim', usage: USAGE }
      })()
    }
  }
}

function servico(
  adapter: AiAdapter,
  console?: AberturaDoConsole,
  limites?: { dailyLimit: number; monthlyLimit: number }
): InstanceType<typeof AiCallService> {
  const orcamento = new BudgetService(new BudgetRepository(db), audit)
  orcamento.setLimits(
    { userId: USUARIO, workspace: 'jarvis' },
    { dailyLimit: 1000, monthlyLimit: 1000, alertThreshold: 0.8, ...limites }
  )

  return new AiCallService(
    { anthropic: adapter, gemini: adapter, ollama: adapter, 'claude-code': adapter },
    credentials,
    new PolicyService(audit, () => USUARIO),
    audit,
    orcamento,
    new RoutingService(new RoutingRepository(db), { disponivel: async () => true }, audit),
    { buscar: (packId: string) => (packId === PACK ? { id: PACK } : undefined) },
    undefined,
    console
  )
}

async function coletar(stream: AsyncIterable<AiStreamEvent>): Promise<AiStreamEvent[]> {
  const eventos: AiStreamEvent[] = []
  for await (const evento of stream) eventos.push(evento)
  return eventos
}

/** Um console dublê que guarda o que o ponto único lhe entregou. */
interface ConsoleEspiao extends AberturaDoConsole {
  readonly aberturas: { ledgerEntryId: string; etapa: string; provider: string; modelo: string }[]
  readonly eventos: GenerationEvent[]
  readonly desfechos: StatusDoTrace[]
}

function consoleFalso(): ConsoleEspiao {
  const aberturas: ConsoleEspiao['aberturas'] = []
  const eventos: GenerationEvent[] = []
  const desfechos: StatusDoTrace[] = []

  return {
    aberturas,
    eventos,
    desfechos,
    abrir(abertura) {
      aberturas.push({
        ledgerEntryId: abertura.ledgerEntryId,
        etapa: abertura.etapa,
        provider: abertura.provider,
        modelo: abertura.modelo
      })
      return {
        registrar: (evento: GenerationEvent) => eventos.push(evento),
        fechar: (status: StatusDoTrace) => desfechos.push(status)
      }
    }
  }
}

describe('o trace nasce ligado ao ledger (critério 2)', () => {
  it('usa o mesmo id da chamada, que é o que vai ao cost_event', async () => {
    const espiao = consoleFalso()
    const service = servico(adapterFalso(ROTEIRO_OK), espiao)

    const eventos = await coletar(
      service.call(PEDIDO_COM_CONSOLE, { userId: USUARIO, workspace: 'jarvis' })
    )

    expect(espiao.aberturas).toHaveLength(1)
    // O `ledgerEntryId` **é** o id da chamada — o mesmo que correlaciona `cost_event`, auditoria
    // e log. Um id próprio aqui seria a segunda contabilidade que o critério proíbe.
    expect(espiao.aberturas[0]?.ledgerEntryId).toBe(eventos.at(-1)?.id)
    expect(espiao.aberturas[0]).toMatchObject({ etapa: 'refinamento', provider: 'claude-code' })

    const linhas = db
      .prepare('SELECT call_id FROM cost_event WHERE call_id = ?')
      .all(espiao.aberturas[0]?.ledgerEntryId) as unknown[]
    expect(linhas).toHaveLength(1)
  })

  it('leva o modelo que a chamada de fato usou', async () => {
    const espiao = consoleFalso()
    const service = servico(adapterFalso(ROTEIRO_OK), espiao)

    await coletar(
      service.call(
        { ...PEDIDO_COM_CONSOLE, model: 'claude-fable-5-1' },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    expect(espiao.aberturas[0]?.modelo).toBe('claude-fable-5-1')
  })
})

describe('quando o trace não nasce', () => {
  it('sem `console` no pedido — a chamada não pertence a etapa nenhuma', async () => {
    const espiao = consoleFalso()
    const service = servico(adapterFalso(ROTEIRO_OK), espiao)

    await coletar(
      service.call(
        { provider: 'claude-code', prompt: PROMPT, contextPackId: PACK },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    expect(espiao.aberturas).toHaveLength(0)
  })

  it('chamada barrada pelo orçamento — ela não saiu', async () => {
    // Um trace aqui registraria uma geração que não houve, com `ledgerEntryId` apontando para
    // uma linha de `cost_event` que o próprio gate impediu de existir (`naoSaiu`).
    const espiao = consoleFalso()
    const service = servico(adapterFalso(ROTEIRO_OK), espiao, {
      dailyLimit: 0.0000001,
      monthlyLimit: 0.0000001
    })

    const eventos = await coletar(
      service.call(
        { ...PEDIDO_COM_CONSOLE, provider: 'anthropic' },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    expect(eventos.at(-1)).toMatchObject({ estado: 'falhou' })
    expect(espiao.aberturas).toHaveLength(0)
  })

  it('geração sem ContextPack', async () => {
    const espiao = consoleFalso()
    const service = servico(adapterFalso(ROTEIRO_OK), espiao)

    await coletar(
      service.call(
        { provider: 'claude-code', prompt: PROMPT, console: PEDIDO_COM_CONSOLE.console },
        { userId: USUARIO, workspace: 'jarvis' }
      )
    )

    expect(espiao.aberturas).toHaveLength(0)
  })
})

describe('o desfecho gravado é o desfecho real', () => {
  it('concluído no caminho feliz', async () => {
    const espiao = consoleFalso()

    await coletar(
      servico(adapterFalso(ROTEIRO_OK), espiao).call(PEDIDO_COM_CONSOLE, {
        userId: USUARIO,
        workspace: 'jarvis'
      })
    )

    expect(espiao.desfechos).toEqual(['concluido'])
  })

  it('falhou quando o adapter lança', async () => {
    const espiao = consoleFalso()
    const service = servico(
      adapterFalso(() =>
        (async function* (): AsyncIterable<AdapterChunk> {
          await Promise.resolve()
          throw new AdapterError('provider fora do ar')
        })()
      ),
      espiao
    )

    const eventos = await coletar(
      service.call(PEDIDO_COM_CONSOLE, { userId: USUARIO, workspace: 'jarvis' })
    )

    expect(eventos.at(-1)).toMatchObject({ estado: 'falhou' })
    expect(espiao.desfechos).toEqual(['falhou'])
  })

  it('falhou quando o stream corta antes do fim', async () => {
    const espiao = consoleFalso()
    const service = servico(
      adapterFalso([{ tipo: 'texto', texto: 'comecei' }]),
      espiao
    )

    const eventos = await coletar(
      service.call(PEDIDO_COM_CONSOLE, { userId: USUARIO, workspace: 'jarvis' })
    )

    expect(eventos.at(-1)).toMatchObject({ estado: 'falhou' })
    expect(espiao.desfechos).toEqual(['falhou'])
  })

  it('cancelado quando o PI cancela (critério 8)', async () => {
    const espiao = consoleFalso()
    let idDaChamada = ''

    const service: InstanceType<typeof AiCallService> = servico(
      adapterFalso(() =>
        (async function* (): AsyncIterable<AdapterChunk> {
          yield { tipo: 'texto', texto: 'comecei' }
          service.cancel(idDaChamada)
          await new Promise((r) => setTimeout(r, 10))
          yield { tipo: 'fim', usage: USAGE }
        })()
      ),
      espiao
    )

    for await (const evento of service.call(PEDIDO_COM_CONSOLE, {
      userId: USUARIO,
      workspace: 'jarvis'
    })) {
      idDaChamada = evento.id
    }

    expect(espiao.desfechos).toEqual(['cancelado'])
  })

  it('fecha mesmo quando o consumidor abandona o stream no meio', async () => {
    // O `finally` do gerador roda no `.return()`. Sem ele, toda geração interrompida deixaria um
    // trace eternamente "em andamento".
    const espiao = consoleFalso()
    const service = servico(
      adapterFalso([
        { tipo: 'texto', texto: 'um' },
        { tipo: 'texto', texto: 'dois' },
        { tipo: 'fim', usage: USAGE }
      ]),
      espiao
    )

    for await (const _evento of service.call(PEDIDO_COM_CONSOLE, {
      userId: USUARIO,
      workspace: 'jarvis'
    })) {
      break
    }

    expect(espiao.desfechos).toHaveLength(1)
  })
})

describe('o console nunca derruba a geração', () => {
  it('falha ao abrir não impede o documento', async () => {
    const quebrado: AberturaDoConsole = {
      abrir: () => {
        throw new Error('banco travado')
      }
    }

    const eventos = await coletar(
      servico(adapterFalso(ROTEIRO_OK), quebrado).call(PEDIDO_COM_CONSOLE, {
        userId: USUARIO,
        workspace: 'jarvis'
      })
    )

    // O documento é o produto; o console é evidência.
    expect(eventos.at(-1)).toMatchObject({ estado: 'concluido' })
    expect(logCat.warn).toHaveBeenCalled()
  })

  it('falha ao fechar não muda o desfecho da chamada', async () => {
    const quebrado: AberturaDoConsole = {
      abrir: () => ({
        registrar: () => {},
        fechar: () => {
          throw new Error('disco cheio')
        }
      })
    }

    const eventos = await coletar(
      servico(adapterFalso(ROTEIRO_OK), quebrado).call(PEDIDO_COM_CONSOLE, {
        userId: USUARIO,
        workspace: 'jarvis'
      })
    )

    expect(eventos.at(-1)).toMatchObject({ estado: 'concluido' })
  })
})

describe('a ponte com o adapter', () => {
  it('entrega o `onEvento`, e só quando há console', async () => {
    const comConsole = adapterFalso(ROTEIRO_OK)
    await coletar(
      servico(comConsole, consoleFalso()).call(PEDIDO_COM_CONSOLE, {
        userId: USUARIO,
        workspace: 'jarvis'
      })
    )
    expect(comConsole.recebido?.onEvento).toBeTypeOf('function')

    const semConsole = adapterFalso(ROTEIRO_OK)
    await coletar(
      servico(semConsole).call(PEDIDO_COM_CONSOLE, { userId: USUARIO, workspace: 'jarvis' })
    )
    // Sem console instalado, o adapter não gasta trabalho produzindo evento que ninguém lê.
    expect(semConsole.recebido?.onEvento).toBeUndefined()
  })

  it('o evento que o adapter emite chega ao coletor', async () => {
    const espiao = consoleFalso()
    // O adapter real chama `onEvento` durante o parsing das linhas; aqui o dublê faz o mesmo
    // pela referência que o ponto único lhe entregou no `AdapterRequest`.
    const adapter = adapterEmissor([{ tipo: 'texto', delta: 'Paris' }])

    await coletar(
      servico(adapter, espiao).call(PEDIDO_COM_CONSOLE, { userId: USUARIO, workspace: 'jarvis' })
    )

    expect(espiao.eventos).toEqual([{ tipo: 'texto', delta: 'Paris' }])
  })
})

describe('ponta a ponta com o repositório real', () => {
  it('a geração deixa um trace legível no banco, ligado ao ledger', async () => {
    // Sem dublê de console: o `GenerationTraceService` real, contra o mesmo SQLite do ledger. É
    // o que prova que as duas pontas casam — o dublê provaria só que o meu dublê casa consigo.
    const repo = new GenerationTraceRepository(db)
    const trace = new GenerationTraceService(repo)
    const adapter = adapterEmissor([
      { tipo: 'texto', delta: 'Paris' },
      { tipo: 'ferramenta-inicio', chamadaId: 'c1', nome: 'Read', resumoDoArgumento: '/tmp/a.ts' }
    ])

    const eventos = await coletar(
      servico(adapter, trace).call(PEDIDO_COM_CONSOLE, { userId: USUARIO, workspace: 'jarvis' })
    )

    const escopo = { userId: USUARIO, workspace: 'jarvis' } as const
    const historico = trace.historico(escopo, 'p1', 'refinamento')

    expect(historico).toHaveLength(1)
    expect(historico[0]).toMatchObject({
      ledgerEntryId: eventos.at(-1)?.id,
      etapa: 'refinamento',
      fase: 'planejamento',
      status: 'concluido'
    })
    expect(trace.eventos(escopo, historico[0]?.id ?? '').map((e) => e.tipo)).toEqual([
      'texto',
      'ferramenta-inicio'
    ])
  })
})
