/**
 * O executor do worker somente-leitura (SPEC-Squads-03, critérios 1 e 4).
 *
 * A IA é falsa — o ponto único tem suíte própria —, mas a **auditoria é a real** (SQLite e cadeia
 * HMAC): o critério pede estado terminal *auditável*, e só o banco confirma o que foi gravado.
 */

import { createHash } from 'node:crypto'
import { getEventListeners } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiRequest, AiStreamEvent, CostEvent } from '@shared/domain/ai'
import type { ContextPack } from '@shared/domain/context-pack'
import { textoDaAssinatura } from '@shared/domain/squad-execucao'
import { esquemaDoResultado } from '@shared/domain/squad-resultado-esquema'
import type { AiCallContext } from '../ai/call-provider'
import type { FonteDaTarefa } from '../context/context-service'
import type { PedidoDoWorker } from './squad-worker'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { ExecutorDeWorker } = await import('./squad-worker')

const USER = 'u-1'

let dir: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let executor: InstanceType<typeof ExecutorDeWorker>
let chamadas: { request: AiRequest; ctx: AiCallContext }[]
/** O roteiro da próxima chamada: recebe o pedido e o contexto e devolve os eventos. */
let roteiro: (request: AiRequest, ctx: AiCallContext) => AsyncIterable<AiStreamEvent>

const sha = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex')

const FONTES: readonly FonteDaTarefa[] = [
  { caminho: 'src/a.ts', texto: 'export const a = 1\n', origem: 'explicito', motivo: 'entrada' },
  { caminho: 'src/b.ts', texto: 'export const b = 2\n', origem: 'explicito', motivo: 'entrada' }
]

const PACK = {
  id: 'pack-1',
  hash: 'h'.repeat(64),
  itens: FONTES.map((f) => ({
    caminho: f.caminho,
    hash: sha(f.texto),
    origem: f.origem,
    bytes: f.texto.length,
    motivo: f.motivo
  }))
} as unknown as ContextPack

const resultadoValido = (parcial: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema: 'achados@1',
  conclusao: 'O parser perde o último item.',
  evidencia: [{ tipo: 'arquivo', referencia: 'src/a.ts', detalhe: 'linhas 1-3' }],
  confianca: 'alta',
  lacunas: [],
  ...parcial
})

function pedido(parcial: Partial<PedidoDoWorker> = {}): PedidoDoWorker {
  return {
    runId: 'run-1',
    projectId: 'project-1',
    tarefa: {
      id: 't1',
      papel: 'revisor',
      capacidade: 'revisao-de-codigo',
      camada: 'especialista',
      schemaDeResultado: 'achados@1',
      regraDeConclusao: 'todo achado cita arquivo e trecho',
      limites: { maxTurnos: 1, maxMinutos: 5, maxTokensEntrada: 20_000, maxTokensSaida: 2_000 }
    },
    objetivo: 'revisar o parser',
    contexto: { pack: PACK, fontes: FONTES },
    modelo: { provider: 'claude-code', modelo: 'claude-sonnet-5-5' },
    tentativa: 1,
    ...parcial
  }
}

/** Uma IA que responde com este texto, em dois pedaços, e termina bem. */
const respondendo = (texto: string, custo?: CostEvent) =>
  async function* (): AsyncIterable<AiStreamEvent> {
    const meio = Math.ceil(texto.length / 2)
    yield { tipo: 'chunk', id: 'c1', texto: texto.slice(0, meio) }
    yield { tipo: 'chunk', id: 'c1', texto: texto.slice(meio) }
    yield { tipo: 'fim', id: 'c1', estado: 'concluido', ...(custo === undefined ? {} : { custo }) }
  }

/** Uma IA que só termina quando o sinal do contexto é abortado. */
const pendurada = (ctx: AiCallContext): AsyncIterable<AiStreamEvent> =>
  (async function* (): AsyncIterable<AiStreamEvent> {
    await new Promise<void>((resolve) => {
      if (ctx.signal?.aborted === true) resolve()
      else ctx.signal?.addEventListener('abort', () => resolve(), { once: true })
    })
    yield { tipo: 'fim', id: 'c1', estado: 'falhou', erro: 'A chamada foi interrompida.' }
  })()

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-squad-worker-'))
  db = openDatabase(join(dir, 'app.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  chamadas = []
  roteiro = respondendo(JSON.stringify(resultadoValido()))
  executor = new ExecutorDeWorker({
    ia: {
      call: (request, ctx) => {
        chamadas.push({ request, ctx })
        return roteiro(request, ctx)
      }
    },
    audit,
    userId: () => USER,
    workspaceId: () => 'jarvis'
  })
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const eventos = (): { marco: string; estado: string; [k: string]: unknown }[] =>
  audit
    .list(USER)
    .filter((e) => e.type === 'squad-tarefa')
    .map((e) => e.payload as { marco: string; estado: string })

describe('o worker conclui', () => {
  it('lê o resultado, calcula a assinatura e audita início e fim', async () => {
    const r = await executor.executar(pedido())

    expect(r.estado).toBe('concluida')
    expect(r.resultado?.conclusao).toBe('O parser perde o último item.')
    expect(r.descartadas).toEqual([])
    expect(r.packId).toBe('pack-1')
    expect(r.tentativa).toBe(1)
    expect(r.assinatura).toBe(sha(textoDaAssinatura(r.resultado as never)))
    expect(eventos().map((e) => [e.marco, e.estado])).toEqual([
      ['inicio', 'em-execucao'],
      ['fim', 'concluida']
    ])
    expect(eventos()[1]).toMatchObject({
      runId: 'run-1',
      tarefaId: 't1',
      papel: 'revisor',
      camada: 'especialista',
      packId: 'pack-1',
      packHash: 'h'.repeat(64),
      assinatura: r.assinatura,
      descartadas: 0
    })
  })

  it('a auditoria leva ids, hashes e estado — nunca o texto do agente', async () => {
    roteiro = respondendo(
      JSON.stringify(resultadoValido({ conclusao: 'texto-unico-do-agente-xyz' }))
    )

    await executor.executar(pedido())

    expect(JSON.stringify(audit.list(USER))).not.toContain('texto-unico-do-agente-xyz')
    expect(JSON.stringify(audit.list(USER))).not.toContain('export const a')
  })

  it('pede ao ponto único sem ferramentas: fase isolada, esquema, pack, run, tentativa e teto', async () => {
    await executor.executar(pedido({ tentativa: 2 }))

    const { request, ctx } = chamadas[0]
    expect(request).toMatchObject({
      provider: 'claude-code',
      model: 'claude-sonnet-5-5',
      fase: 'planejamento',
      contextPackId: 'pack-1',
      runId: 'run-1',
      tentativa: 2,
      maxTokens: 2_000
    })
    expect(request.jsonSchema).toBe(JSON.stringify(esquemaDoResultado('achados@1')))
    expect(request.opcoesLocais).toBeUndefined()
    expect(request.console).toBeUndefined()
    expect(ctx).toMatchObject({ userId: USER, workspace: 'jarvis' })
  })

  it('o prompt leva as fontes, o objetivo e a regra de conclusão', async () => {
    await executor.executar(pedido())

    const { request } = chamadas[0]
    expect(request.prompt).toContain('export const a = 1')
    expect(request.prompt).toContain('export const b = 2')
    expect(request.prompt).toContain('revisar o parser')
    expect(request.prompt).toContain('todo achado cita arquivo e trecho')
    expect(request.system).toContain('somente leitura')
  })

  it('o modelo local recebe a janela e o formato, e não o esquema do CLI', async () => {
    await executor.executar(
      pedido({ modelo: { provider: 'ollama', modelo: 'qwen3:8b' }, numCtx: 8192 })
    )

    const { request } = chamadas[0]
    expect(request.opcoesLocais).toEqual({
      numCtx: 8192,
      formato: JSON.stringify(esquemaDoResultado('achados@1'))
    })
    expect(request.jsonSchema).toBeUndefined()
  })

  it('aceita o JSON dentro de cerca e com prosa em volta', async () => {
    roteiro = respondendo(
      `Segue o resultado:\n\`\`\`json\n${JSON.stringify(resultadoValido())}\n\`\`\`\nFim.`
    )

    const r = await executor.executar(pedido())

    expect(r.estado).toBe('concluida')
  })

  it('devolve o custo medido pelo ponto único', async () => {
    const custo = {
      provider: 'claude-code',
      model: 'm',
      workspace: 'jarvis',
      estimadoUsd: 0,
      latenciaTotalMs: 5
    } as CostEvent
    roteiro = respondendo(JSON.stringify(resultadoValido()), custo)

    const r = await executor.executar(pedido())

    expect(r.custo).toEqual(custo)
  })
})

describe('o resultado é dado não confiável', () => {
  it('sem evidência válida é incompleto, com o motivo e a evidência descartada', async () => {
    roteiro = respondendo(
      JSON.stringify(
        resultadoValido({ evidencia: [{ tipo: 'arquivo', referencia: 'src/inventado.ts' }] })
      )
    )

    const r = await executor.executar(pedido())

    expect(r.estado).toBe('incompleta')
    expect(r.motivo).toMatch(/evid/i)
    expect(r.descartadas).toEqual(['src/inventado.ts'])
    expect(r.assinatura).toBeDefined()
    expect(eventos().at(-1)).toMatchObject({ estado: 'incompleta', descartadas: 1 })
  })

  it('saída que não é JSON é inválida', async () => {
    roteiro = respondendo('não consigo ajudar com isso')

    const r = await executor.executar(pedido())

    expect(r).toMatchObject({ estado: 'invalida', motivo: 'saida-sem-json' })
    expect(r.resultado).toBeUndefined()
    expect(r.assinatura).toBeUndefined()
  })

  it('o schema errado, a chave a mais e a assinatura forjada são inválidos', async () => {
    for (const ruim of [
      resultadoValido({ schema: 'parecer@1' }),
      resultadoValido({ extra: 1 }),
      resultadoValido({ assinatura: 'forjada' })
    ]) {
      roteiro = respondendo(JSON.stringify(ruim))

      const r = await executor.executar(pedido())

      expect(r.estado).toBe('invalida')
      expect(r.assinatura).toBeUndefined()
    }
  })

  it('com mais de um objeto na saída, lê o que tem a forma do resultado', async () => {
    roteiro = respondendo(
      `exemplo: ${JSON.stringify({ outra: 'coisa' })}\nresultado: ${JSON.stringify(resultadoValido())}`
    )

    const r = await executor.executar(pedido())

    expect(r.estado).toBe('concluida')
    expect(r.resultado?.conclusao).toBe('O parser perde o último item.')
  })

  it('saída grande demais é inválida e aborta a chamada', async () => {
    let abortado = false
    roteiro = (_r, ctx) =>
      (async function* (): AsyncIterable<AiStreamEvent> {
        ctx.signal?.addEventListener('abort', () => (abortado = true))
        yield { tipo: 'chunk', id: 'c1', texto: 'x'.repeat(300 * 1024) }
        yield { tipo: 'fim', id: 'c1', estado: 'concluido' }
      })()

    const r = await executor.executar(pedido())

    expect(r).toMatchObject({ estado: 'invalida', motivo: 'saida-grande-demais' })
    expect(abortado).toBe(true)
  })
})

describe('falha, prazo e cancelamento têm estado terminal próprio (critério 4)', () => {
  it('falha da chamada: estado falhou com o motivo cortado, sem repetir o corpo cru', async () => {
    roteiro = async function* () {
      yield { tipo: 'fim', id: 'c1', estado: 'falhou', erro: 'x'.repeat(500) }
    }

    const r = await executor.executar(pedido())

    expect(r.estado).toBe('falhou')
    expect(r.motivo).toHaveLength(160)
    expect(eventos().at(-1)).toMatchObject({ estado: 'falhou' })
  })

  it('falha sem mensagem ganha uma genérica', async () => {
    roteiro = async function* () {
      yield { tipo: 'fim', id: 'c1', estado: 'falhou' }
    }

    expect((await executor.executar(pedido())).motivo).toBe('a chamada falhou')
  })

  it('stream que termina sem desfecho é falha', async () => {
    roteiro = async function* () {
      yield { tipo: 'chunk', id: 'c1', texto: 'metade' }
    }

    const r = await executor.executar(pedido())

    expect(r).toMatchObject({ estado: 'falhou', motivo: 'o stream terminou sem desfecho' })
  })

  it('exceção do ponto único vira falha com o nome do erro, não propaga', async () => {
    roteiro = () => {
      throw new TypeError('boom com detalhe interno')
    }

    const r = await executor.executar(pedido())

    expect(r).toMatchObject({ estado: 'falhou', motivo: 'erro inesperado: TypeError' })
    expect(JSON.stringify(audit.list(USER))).not.toContain('detalhe interno')
  })

  it('estourou o prazo do plano: timeout, com o prazo entregue ao ponto único', async () => {
    roteiro = (_r, ctx) => pendurada(ctx)
    const base = pedido()

    const r = await executor.executar({
      ...base,
      tarefa: { ...base.tarefa, limites: { ...base.tarefa.limites, maxMinutos: 0.001 } }
    })

    expect(r).toMatchObject({ estado: 'timeout', motivo: 'prazo-do-plano' })
    expect(chamadas[0].ctx.timeoutMs).toBe(60 + 2_000)
    expect(eventos().at(-1)).toMatchObject({ estado: 'timeout' })
  })

  it('o prazo do plano maior que o teto do ponto único é limitado por ele', async () => {
    const base = pedido()

    await executor.executar({
      ...base,
      tarefa: { ...base.tarefa, limites: { ...base.tarefa.limites, maxMinutos: 120 } }
    })

    expect(chamadas[0].ctx.timeoutMs).toBe(300_000 + 2_000)
  })

  it('cancelada de fora no meio da chamada: estado cancelada', async () => {
    roteiro = (_r, ctx) => pendurada(ctx)
    const controle = new AbortController()
    setTimeout(() => controle.abort(), 30)

    const r = await executor.executar(pedido({ signal: controle.signal }))

    expect(r).toMatchObject({ estado: 'cancelada', motivo: 'cancelada' })
    expect(eventos().map((e) => e.estado)).toEqual(['em-execucao', 'cancelada'])
  })

  it('cancelada antes de começar: nem chama a IA, e só o estado final é auditado', async () => {
    const controle = new AbortController()
    controle.abort()

    const r = await executor.executar(pedido({ signal: controle.signal }))

    expect(r).toMatchObject({ estado: 'cancelada', motivo: 'cancelada-antes-de-iniciar' })
    expect(chamadas).toHaveLength(0)
    expect(eventos().map((e) => [e.marco, e.estado])).toEqual([['fim', 'cancelada']])
  })

  it('o cancelamento que chega junto com o fim vale: cancelada não vira concluída', async () => {
    const controle = new AbortController()
    roteiro = async function* () {
      yield { tipo: 'chunk', id: 'c1', texto: JSON.stringify(resultadoValido()) }
      controle.abort()
      yield { tipo: 'fim', id: 'c1', estado: 'concluido' }
    }

    const r = await executor.executar(pedido({ signal: controle.signal }))

    expect(r.estado).toBe('cancelada')
    expect(r.resultado).toBeUndefined()
  })

  it('o ouvinte do sinal sai quando a tarefa termina', async () => {
    const controle = new AbortController()

    await executor.executar(pedido({ signal: controle.signal }))

    expect(getEventListeners(controle.signal, 'abort')).toHaveLength(0)
  })
})

describe('o que nem chega a rodar é recusado, com o motivo, sem chamar a IA', () => {
  const recusada = async (p: PedidoDoWorker, motivo: string): Promise<void> => {
    const r = await executor.executar(p)

    expect(r).toMatchObject({ estado: 'recusada', motivo })
    expect(chamadas).toHaveLength(0)
    expect(eventos().map((e) => [e.marco, e.estado])).toEqual([['fim', 'recusada']])
    expect(eventos()[0]).toMatchObject({ motivo })
  }

  it('papel de escrita: worker é somente leitura', async () => {
    const base = pedido()
    await recusada(
      { ...base, tarefa: { ...base.tarefa, papel: 'desenvolvedor' } },
      'papel-de-escrita'
    )
  })

  it('o integrador também escreve', async () => {
    const base = pedido()
    await recusada({ ...base, tarefa: { ...base.tarefa, papel: 'integrador' } }, 'papel-de-escrita')
  })

  it('schema que o kernel não conhece', async () => {
    const base = pedido()
    await recusada(
      { ...base, tarefa: { ...base.tarefa, schemaDeResultado: 'qualquer@9' } },
      'schema-desconhecido'
    )
  })

  it('tentativa inválida', async () => {
    for (const tentativa of [0, -1, 1.5, Number.NaN]) {
      chamadas = []
      await executor.executar(pedido({ tentativa })).then((r) => {
        expect(r).toMatchObject({ estado: 'recusada', motivo: 'tentativa-invalida' })
      })
    }
    expect(chamadas).toHaveLength(0)
  })

  it('a terceira tentativa é a última: a quarta é recusada, a terceira roda', async () => {
    expect((await executor.executar(pedido({ tentativa: 3 }))).estado).toBe('concluida')

    const r = await executor.executar(pedido({ tentativa: 4 }))

    expect(r).toMatchObject({ estado: 'recusada', motivo: 'tentativas-esgotadas' })
    expect(chamadas).toHaveLength(1)
  })

  it('limite inválido: zero, negativo ou NaN em qualquer um dos três', async () => {
    const base = pedido()
    for (const campo of ['maxMinutos', 'maxTokensEntrada', 'maxTokensSaida'] as const) {
      for (const valor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const r = await executor.executar({
          ...base,
          tarefa: { ...base.tarefa, limites: { ...base.tarefa.limites, [campo]: valor } }
        })
        expect(r).toMatchObject({ estado: 'recusada', motivo: 'limite-invalido' })
      }
    }
    expect(chamadas).toHaveLength(0)
  })

  it('sem contexto: nenhuma fonte ou pack vazio', async () => {
    await recusada(pedido({ contexto: { pack: PACK, fontes: [] } }), 'sem-contexto')
  })

  it('o pack vazio também é sem contexto', async () => {
    const vazio = { ...PACK, itens: [] } as unknown as ContextPack
    const r = await executor.executar(pedido({ contexto: { pack: vazio, fontes: FONTES } }))

    expect(r).toMatchObject({ estado: 'recusada', motivo: 'sem-contexto' })
  })

  it('modelo local sem a janela de contexto', async () => {
    const local = { provider: 'ollama', modelo: 'qwen3:8b' } as const
    await recusada(pedido({ modelo: local }), 'modelo-local-sem-janela')
    chamadas = []
    const r = await executor.executar(pedido({ modelo: local, numCtx: 0 }))
    expect(r).toMatchObject({ estado: 'recusada', motivo: 'modelo-local-sem-janela' })
  })

  it('contexto que passa do limite de entrada da tarefa', async () => {
    const base = pedido()
    await recusada(
      {
        ...base,
        tarefa: { ...base.tarefa, limites: { ...base.tarefa.limites, maxTokensEntrada: 10 } }
      },
      'contexto-acima-do-limite'
    )
  })

  it('a recusa carrega a duração e o pack, e não toca a IA nem o orçamento', async () => {
    const r = await executor.executar(pedido({ tentativa: 9 }))

    expect(r.packId).toBe('pack-1')
    expect(r.duracaoMs).toBeGreaterThanOrEqual(0)
    expect(r.custo).toBeUndefined()
  })
})
