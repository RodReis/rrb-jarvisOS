/**
 * O executor do plano do Squad (SPEC-Squads-03): o grafo, o paralelismo e o que acontece com quem
 * não pode rodar. Os executores de worker e de escritor têm suíte própria; aqui eles são falsos e
 * **controláveis** — cada tarefa só termina quando o teste deixa —, porque o que se mede é a ordem,
 * a concorrência e os estados.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContextPack } from '@shared/domain/context-pack'
import type { SquadPlan, TarefaDoPlano } from '@shared/domain/squad-plano'
import type { FonteDaTarefa } from '../context/context-service'
import type { PedidoDoSquad } from './squad-executor'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { ExecutorDoSquad, MAX_WORKERS_EM_PARALELO } = await import('./squad-executor')

const USER = 'u-1'

let dir: string
let db: Db
let audit: InstanceType<typeof AuditRepository>

/** A tarefa que o teste controla: roda até `liberar()` ser chamado, e termina no estado dado. */
interface Controlada {
  readonly liberar: (estado?: string, motivo?: string, commitSha?: string) => void
  readonly iniciada: Promise<void>
}
let controladas: Map<string, Controlada>
let ordemDeInicio: string[]
let emParalelo: number
let picoDeWorkers: number
let pedidosAoWorker: Record<string, unknown>[]
let pedidosAoEscritor: Record<string, unknown>[]
let pedidosAoContexto: Record<string, unknown>[]
let contextoFalha: Map<string, string>
let resposta: (id: string) => { estado: string; motivo?: string; commitSha?: string }
/** Quando `true`, a tarefa só termina com `liberar()`; senão termina na hora. */
let manual: boolean

const PACK = { id: 'pack-1', hash: 'h', itens: [{ caminho: 'x' }] } as unknown as ContextPack
const FONTES: readonly FonteDaTarefa[] = [
  { caminho: 'src/a.ts', texto: 'a', origem: 'explicito', motivo: 'm' }
]

const tarefa = (id: string, parcial: Partial<TarefaDoPlano> = {}): TarefaDoPlano => ({
  id,
  papel: 'revisor',
  capacidade: 'revisao-de-codigo',
  camada: 'executor',
  entradas: ['src/a.ts'],
  dependencias: [],
  paths: [],
  schemaDeResultado: 'achados@1',
  limites: { maxTurnos: 1, maxMinutos: 5, maxTokensEntrada: 10_000, maxTokensSaida: 1_000 },
  fundamento: { criterio: 1 },
  regraDeConclusao: 'regra',
  ...parcial
})

const escritora = (
  id: string,
  escritor: string,
  parcial: Partial<TarefaDoPlano> = {}
): TarefaDoPlano =>
  tarefa(id, {
    papel: 'desenvolvedor',
    capacidade: 'arquitetura',
    camada: 'especialista',
    escritor,
    paths: [`src/${escritor}`],
    schemaDeResultado: 'parecer@1',
    ...parcial
  })

function pedido(tarefas: TarefaDoPlano[], extra: Partial<PedidoDoSquad> = {}): PedidoDoSquad {
  const plano: SquadPlan = { tarefas }
  return {
    runId: 'run-1',
    projectId: 'p-1',
    workspaceId: 'jarvis',
    sliceId: 'f03',
    repositorio: '/repo',
    baseSha: 'a'.repeat(40),
    rota: 'claude-code',
    plano,
    objetivoDe: (t) => `objetivo de ${t.id}`,
    modeloDe: () => ({ modelo: { provider: 'claude-code', modelo: 'm' } }),
    ...extra
  }
}

/** Roda a tarefa: registra a ordem e a concorrência, e espera o teste liberá-la se for manual. */
function executarTarefa(
  id: string,
  ehWorker: boolean
): Promise<{ estado: string; motivo?: string; commitSha?: string }> {
  ordemDeInicio.push(id)
  emParalelo += 1
  if (ehWorker) picoDeWorkers = Math.max(picoDeWorkers, emParalelo)
  if (!manual) {
    emParalelo -= 1
    return Promise.resolve(resposta(id))
  }
  let liberarFn: (estado?: string, motivo?: string, commitSha?: string) => void = () => undefined
  let iniciadaFn: () => void = () => undefined
  const iniciada = new Promise<void>((r) => (iniciadaFn = r))
  const fim = new Promise<{ estado: string; motivo?: string; commitSha?: string }>((resolve) => {
    liberarFn = (estado = 'concluida', motivo, commitSha) => {
      emParalelo -= 1
      resolve({
        estado,
        ...(motivo === undefined ? {} : { motivo }),
        ...(commitSha === undefined ? {} : { commitSha })
      })
    }
  })
  controladas.set(id, { liberar: liberarFn, iniciada })
  iniciadaFn()
  return fim
}

function montar(extra: { maxWorkers?: number } = {}) {
  return new ExecutorDoSquad({
    contexto: {
      montar: (p) => {
        pedidosAoContexto.push(p as never)
        const razao = contextoFalha.get((p as { tarefa: { id: string } }).tarefa.id)
        return razao === undefined
          ? { ok: true, pack: PACK, fontes: FONTES, descartadas: [] }
          : { ok: false, razao: razao as never, mensagem: 'x' }
      }
    },
    worker: {
      executar: async (p) => {
        pedidosAoWorker.push(p as never)
        return (await executarTarefa(p.tarefa.id, true)) as never
      }
    },
    escritor: {
      executar: async (p) => {
        pedidosAoEscritor.push(p as never)
        return (await executarTarefa(p.tarefa.id, false)) as never
      }
    },
    audit,
    userId: () => USER,
    workspaceId: () => 'jarvis',
    ...extra
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-squad-exec-'))
  db = openDatabase(join(dir, 'app.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  controladas = new Map()
  ordemDeInicio = []
  emParalelo = 0
  picoDeWorkers = 0
  pedidosAoWorker = []
  pedidosAoEscritor = []
  pedidosAoContexto = []
  contextoFalha = new Map()
  resposta = () => ({ estado: 'concluida' })
  manual = false
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const eventos = (): { tarefaId: string; estado: string; motivo?: string; marco: string }[] =>
  audit
    .list(USER)
    .filter((e) => e.type === 'squad-tarefa')
    .map((e) => e.payload as never)

const espera = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('o grafo manda', () => {
  it('uma cadeia roda na ordem das dependências, e o resultado traz uma entrada por tarefa', async () => {
    const r = await montar().executar(
      pedido([
        tarefa('c', { dependencias: ['b'] }),
        tarefa('a'),
        tarefa('b', { dependencias: ['a'] })
      ])
    )

    expect(ordemDeInicio).toEqual(['a', 'b', 'c'])
    expect(r.estado).toBe('concluido')
    expect(r.tarefas.map((t) => [t.tarefaId, t.estado])).toEqual([
      ['c', 'concluida'],
      ['a', 'concluida'],
      ['b', 'concluida']
    ])
  })

  it('uma tarefa só começa depois de TODAS as dependências concluírem', async () => {
    manual = true
    const execucao = montar().executar(
      pedido([tarefa('a'), tarefa('b'), tarefa('c', { dependencias: ['a', 'b'] })])
    )
    await controladas.get('a')?.iniciada
    await controladas.get('b')?.iniciada

    controladas.get('a')?.liberar()
    await espera()
    expect(ordemDeInicio).toEqual(['a', 'b'])

    controladas.get('b')?.liberar()
    await espera(30)
    expect(ordemDeInicio).toEqual(['a', 'b', 'c'])
    controladas.get('c')?.liberar()
    expect((await execucao).estado).toBe('concluido')
  })

  it('a dependência que não concluiu cancela a dependente, transitivamente, e o ramo livre segue', async () => {
    resposta = (id) =>
      id === 'a' ? { estado: 'falhou', motivo: 'quebrou' } : { estado: 'concluida' }

    const r = await montar().executar(
      pedido([
        tarefa('a'),
        tarefa('b', { dependencias: ['a'] }),
        tarefa('c', { dependencias: ['b'] }),
        tarefa('livre')
      ])
    )

    expect(r.estado).toBe('parcial')
    expect(r.tarefas.map((t) => [t.tarefaId, t.estado, t.motivo])).toEqual([
      ['a', 'falhou', 'quebrou'],
      ['b', 'cancelada', 'dependencia-nao-concluida:a'],
      ['c', 'cancelada', 'dependencia-nao-concluida:b'],
      ['livre', 'concluida', undefined]
    ])
    expect(ordemDeInicio).toEqual(['a', 'livre'])
  })

  it('a propagação não depende da ordem do plano: a dependente listada antes também é cancelada', async () => {
    resposta = (id) => (id === 'a' ? { estado: 'falhou' } : { estado: 'concluida' })

    const r = await montar().executar(
      pedido([
        tarefa('c', { dependencias: ['b'] }),
        tarefa('b', { dependencias: ['a'] }),
        tarefa('a')
      ])
    )

    expect(r.tarefas.map((t) => [t.tarefaId, t.estado, t.motivo])).toEqual([
      ['c', 'cancelada', 'dependencia-nao-concluida:b'],
      ['b', 'cancelada', 'dependencia-nao-concluida:a'],
      ['a', 'falhou', undefined]
    ])
  })

  it('incompleta, inválida, timeout e cancelada também travam quem depende da tarefa', async () => {
    for (const estado of ['incompleta', 'invalida', 'timeout', 'cancelada', 'recusada']) {
      resposta = (id) => (id === 'a' ? { estado } : { estado: 'concluida' })

      const r = await montar().executar(pedido([tarefa('a'), tarefa('b', { dependencias: ['a'] })]))

      expect(r.tarefas[1]).toMatchObject({
        estado: 'cancelada',
        motivo: 'dependencia-nao-concluida:a'
      })
    }
  })

  it('a dependência que não existe, e o ciclo, não travam o executor: terminam canceladas', async () => {
    const r = await montar().executar(
      pedido([
        tarefa('fantasma', { dependencias: ['nao-existe'] }),
        tarefa('x', { dependencias: ['y'] }),
        tarefa('y', { dependencias: ['x'] }),
        tarefa('ok')
      ])
    )

    expect(r.estado).toBe('parcial')
    expect(r.tarefas.map((t) => [t.tarefaId, t.estado, t.motivo])).toEqual([
      ['fantasma', 'cancelada', 'dependencias-nao-resolvidas'],
      ['x', 'cancelada', 'dependencias-nao-resolvidas'],
      ['y', 'cancelada', 'dependencias-nao-resolvidas'],
      ['ok', 'concluida', undefined]
    ])
    expect(eventos().map((e) => [e.tarefaId, e.estado, e.motivo])).toEqual([
      ['fantasma', 'cancelada', 'dependencias-nao-resolvidas'],
      ['x', 'cancelada', 'dependencias-nao-resolvidas'],
      ['y', 'cancelada', 'dependencias-nao-resolvidas']
    ])
  })

  it('o que não rodou é auditado com o estado e o motivo; o que rodou é dos executores', async () => {
    resposta = (id) => (id === 'a' ? { estado: 'falhou' } : { estado: 'concluida' })

    await montar().executar(pedido([tarefa('a'), tarefa('b', { dependencias: ['a'] })]))

    expect(eventos()).toEqual([
      expect.objectContaining({
        tarefaId: 'b',
        marco: 'fim',
        estado: 'cancelada',
        motivo: 'dependencia-nao-concluida:a',
        runId: 'run-1',
        papel: 'revisor'
      })
    ])
  })
})

describe('paralelismo: workers até o teto, escritores até o pool', () => {
  it('os workers independentes rodam juntos, até o teto', async () => {
    manual = true
    const tarefas = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map((id) => tarefa(id))
    const execucao = montar({ maxWorkers: 3 }).executar(pedido(tarefas))
    await espera(30)

    expect(ordemDeInicio).toEqual(['w1', 'w2', 'w3'])
    for (const id of ['w1', 'w2', 'w3']) controladas.get(id)?.liberar()
    await espera(30)
    expect(ordemDeInicio).toEqual(['w1', 'w2', 'w3', 'w4', 'w5', 'w6'])
    for (const id of ['w4', 'w5', 'w6']) controladas.get(id)?.liberar()
    await execucao

    expect(picoDeWorkers).toBe(3)
  })

  it('o teto padrão vale quando o pedido é inválido', async () => {
    for (const maxWorkers of [0, -1, Number.NaN, 1.5]) {
      manual = true
      picoDeWorkers = 0
      controladas.clear()
      const ids = Array.from({ length: MAX_WORKERS_EM_PARALELO + 2 }, (_, i) => `w${i}`)
      const execucao = montar({ maxWorkers }).executar(pedido(ids.map((id) => tarefa(id))))
      await espera(30)

      expect(controladas.size).toBe(MAX_WORKERS_EM_PARALELO)
      for (let i = 0; i < ids.length; i++) {
        await espera(5)
        controladas.get(ids[i])?.liberar()
      }
      await espera(30)
      for (const c of controladas.values()) c.liberar()
      await execucao
    }
  })

  it('o teto padrão é quatro', () => {
    expect(MAX_WORKERS_EM_PARALELO).toBe(4)
  })

  it('os dois escritores são despachados juntos: quem os contém é o pool, não o executor', async () => {
    manual = true
    const execucao = montar().executar(
      pedido([escritora('e1', 'api'), escritora('e2', 'ui'), escritora('e3', 'db')])
    )
    await espera(30)

    expect(ordemDeInicio).toEqual(['e1', 'e2', 'e3'])
    for (const id of ['e1', 'e2', 'e3']) controladas.get(id)?.liberar()
    await execucao
  })

  it('o escritor não conta no teto de workers, e os workers não bloqueiam o escritor', async () => {
    manual = true
    const execucao = montar({ maxWorkers: 1 }).executar(
      pedido([tarefa('w1'), tarefa('w2'), escritora('e1', 'api')])
    )
    await espera(30)

    expect(ordemDeInicio.sort()).toEqual(['e1', 'w1'])
    controladas.get('w1')?.liberar()
    await espera(30)
    expect(ordemDeInicio).toContain('w2')
    for (const id of ['w2', 'e1']) controladas.get(id)?.liberar()
    await execucao
  })
})

describe('um escritor com várias tarefas', () => {
  const COMMIT = 'c'.repeat(40)

  it('as tarefas do mesmo escritor rodam em sequência; escritores diferentes seguem juntos', async () => {
    manual = true
    const execucao = montar().executar(
      pedido([escritora('a1', 'api'), escritora('a2', 'api'), escritora('u1', 'ui')])
    )
    await espera(30)

    expect(ordemDeInicio.sort()).toEqual(['a1', 'u1'])
    controladas.get('a1')?.liberar()
    await espera(30)
    expect(ordemDeInicio).toContain('a2')
    for (const id of ['a2', 'u1']) controladas.get(id)?.liberar()
    await execucao
  })

  it('a segunda tarefa parte do commit da primeira, no contexto e no escritor', async () => {
    manual = true
    const execucao = montar().executar(pedido([escritora('a1', 'api'), escritora('a2', 'api')]))
    await espera(30)
    controladas.get('a1')?.liberar('concluida', undefined, COMMIT)
    await espera(30)
    controladas.get('a2')?.liberar()
    await execucao

    expect(pedidosAoEscritor.map((p) => p.baseSha)).toEqual(['a'.repeat(40), COMMIT])
    expect(pedidosAoContexto.map((p) => p.revisao)).toEqual(['a'.repeat(40), COMMIT])
  })

  it('a base de um escritor não vaza para outro', async () => {
    resposta = (id) =>
      id === 'a1' ? { estado: 'concluida', commitSha: COMMIT } : { estado: 'concluida' }

    await montar().executar(pedido([escritora('a1', 'api'), escritora('u1', 'ui')]))

    const porTarefa = new Map(
      pedidosAoEscritor.map((p) => [(p.tarefa as { id: string }).id, p.baseSha])
    )
    expect(porTarefa.get('u1')).toBe('a'.repeat(40))
  })

  it('se a primeira não concluiu, a seguinte parte da base original: não há commit a herdar', async () => {
    resposta = (id) =>
      id === 'a1' ? { estado: 'falhou', commitSha: COMMIT } : { estado: 'concluida' }

    await montar().executar(pedido([escritora('a1', 'api'), escritora('a2', 'api')]))

    expect(pedidosAoEscritor.map((p) => p.baseSha)).toEqual(['a'.repeat(40), 'a'.repeat(40)])
  })

  it('a tarefa de escrita não herda a base de um worker: só o commit do escritor conta', async () => {
    resposta = () => ({ estado: 'concluida', commitSha: COMMIT })

    await montar().executar(pedido([tarefa('w1'), escritora('a1', 'api')]))

    expect(pedidosAoEscritor[0].baseSha).toBe('a'.repeat(40))
    expect(pedidosAoContexto.find((p) => (p.tarefa as { id: string }).id === 'w1')?.revisao).toBe(
      'a'.repeat(40)
    )
  })

  it('duas tarefas cujo escritor-tarefa vira o mesmo nome: a segunda é recusada e auditada', async () => {
    // `a_b` + `c` e `a` + `b_c` viram `a-b-c`: o mesmo container e a mesma branch.
    const r = await montar().executar(
      pedido([
        escritora('c', 'a_b'),
        escritora('b_c', 'a'),
        tarefa('depois', { dependencias: ['b_c'] })
      ])
    )

    expect(r.tarefas.map((t) => [t.tarefaId, t.estado])).toEqual([
      ['c', 'concluida'],
      ['b_c', 'recusada'],
      ['depois', 'cancelada']
    ])
    expect(pedidosAoEscritor).toHaveLength(1)
    expect(eventos()).toContainEqual(
      expect.objectContaining({ tarefaId: 'b_c', estado: 'recusada', motivo: 'nome-colide' })
    )
  })
})

describe('o despacho', () => {
  it('o worker recebe o contexto montado pelo kernel, o modelo da camada e a tentativa', async () => {
    const tentativas = new Map([['w1', 2]])

    await montar().executar(
      pedido([tarefa('w1')], {
        tentativas,
        modeloDe: () => ({ modelo: { provider: 'ollama', modelo: 'qwen3:8b' }, numCtx: 8192 })
      })
    )

    expect(pedidosAoWorker[0]).toMatchObject({
      runId: 'run-1',
      objetivo: 'objetivo de w1',
      modelo: { provider: 'ollama', modelo: 'qwen3:8b' },
      numCtx: 8192,
      tentativa: 2,
      contexto: { pack: PACK, fontes: FONTES }
    })
    expect((pedidosAoWorker[0].tarefa as { id: string }).id).toBe('w1')
    expect(pedidosAoEscritor).toHaveLength(0)
  })

  it('o escritor recebe o nome, a base, o repositório e o escopo da tarefa', async () => {
    await montar().executar(pedido([escritora('e1', 'api')]))

    expect(pedidosAoEscritor[0]).toMatchObject({
      runId: 'run-1',
      projectId: 'p-1',
      workspaceId: 'jarvis',
      sliceId: 'f03',
      escritor: 'api',
      repositorio: '/repo',
      baseSha: 'a'.repeat(40),
      tentativa: 1,
      objetivo: 'objetivo de e1'
    })
    expect((pedidosAoEscritor[0].tarefa as { paths: string[] }).paths).toEqual(['src/api'])
    expect(pedidosAoWorker).toHaveLength(0)
  })

  it('o estado e o motivo do escritor também viram os da tarefa', async () => {
    resposta = () => ({ estado: 'falhou', motivo: 'escopo-violado' })

    const r = await montar().executar(pedido([escritora('e1', 'api')]))

    expect(r.tarefas[0]).toMatchObject({
      estado: 'falhou',
      motivo: 'escopo-violado',
      execucao: { estado: 'falhou' }
    })
  })

  it('o integrador também escreve: vai ao executor de escritor, que decide o que fazer com ele', async () => {
    await montar().executar(
      pedido([escritora('i1', 'integrador', { papel: 'integrador', escritor: 'integ' })])
    )

    expect(pedidosAoEscritor).toHaveLength(1)
    expect(pedidosAoWorker).toHaveLength(0)
  })

  it('o contexto é pedido por tarefa, na revisão do plano, com as buscas e as regras do chamador', async () => {
    const busca = { termo: 'alvo', caminhos: ['src'] }

    await montar().executar(
      pedido([tarefa('w1', { entradas: ['src/a.ts', 'src/b.ts'] })], {
        buscasDe: () => [busca],
        regras: ['Policy Engine é fail closed']
      })
    )

    expect(pedidosAoContexto[0]).toMatchObject({
      projectId: 'p-1',
      workspaceId: 'jarvis',
      repositorio: '/repo',
      revisao: 'a'.repeat(40),
      runId: 'run-1',
      tarefa: { id: 'w1', entradas: ['src/a.ts', 'src/b.ts'] },
      rota: 'claude-code',
      buscas: [busca],
      regras: ['Policy Engine é fail closed']
    })
  })

  it('o estado e o motivo do executor viram os da tarefa, com a execução anexada', async () => {
    resposta = () => ({ estado: 'incompleta', motivo: 'sem-evidencia' })

    const r = await montar().executar(pedido([tarefa('w1')]))

    expect(r.tarefas[0]).toMatchObject({
      tarefaId: 'w1',
      papel: 'revisor',
      estado: 'incompleta',
      motivo: 'sem-evidencia',
      execucao: { estado: 'incompleta', motivo: 'sem-evidencia' }
    })
  })
})

describe('o que o executor recusa antes de rodar', () => {
  it('contexto que o kernel não monta: recusada, com a razão, auditada, e as dependentes canceladas', async () => {
    contextoFalha.set('a', 'segredo-no-contexto')

    const r = await montar().executar(pedido([tarefa('a'), tarefa('b', { dependencias: ['a'] })]))

    expect(r.tarefas[0]).toMatchObject({
      estado: 'recusada',
      motivo: 'contexto-segredo-no-contexto'
    })
    expect(r.tarefas[1]).toMatchObject({
      estado: 'cancelada',
      motivo: 'dependencia-nao-concluida:a'
    })
    expect(pedidosAoWorker).toHaveLength(0)
    expect(eventos().map((e) => [e.tarefaId, e.estado, e.motivo])).toEqual([
      ['a', 'recusada', 'contexto-segredo-no-contexto'],
      ['b', 'cancelada', 'dependencia-nao-concluida:a']
    ])
  })

  it('a exceção de um executor vira falha com o nome do erro, e o plano segue', async () => {
    const executor = new ExecutorDoSquad({
      contexto: { montar: () => ({ ok: true, pack: PACK, fontes: FONTES, descartadas: [] }) },
      worker: {
        executar: async (p) => {
          if (p.tarefa.id === 'a') throw new TypeError('detalhe interno')
          return { estado: 'concluida' } as never
        }
      },
      escritor: { executar: async () => ({ estado: 'concluida' }) as never },
      audit,
      userId: () => USER,
      workspaceId: () => 'jarvis'
    })

    const r = await executor.executar(pedido([tarefa('a'), tarefa('b')]))

    expect(r.tarefas[0]).toMatchObject({ estado: 'falhou', motivo: 'erro inesperado: TypeError' })
    expect(r.tarefas[1].estado).toBe('concluida')
    expect(JSON.stringify(audit.list(USER))).not.toContain('detalhe interno')
    expect(eventos().map((e) => [e.tarefaId, e.marco, e.estado, e.motivo])).toEqual([
      ['a', 'fim', 'falhou', 'erro inesperado: TypeError']
    ])
  })
})

describe('o executor nunca rejeita', () => {
  it('a auditoria que falha no meio do plano vira falha da tarefa; quem já rodava termina e o plano devolve resultado', async () => {
    manual = true
    vi.spyOn(audit, 'append').mockImplementation(() => {
      throw new Error('auditoria fora do ar')
    })
    const executor = montar()
    const execucao = executor.executar(
      pedido([
        tarefa('a'),
        tarefa('b', { dependencias: ['a'] }),
        tarefa('c', { dependencias: ['inexistente'] })
      ])
    )
    await controladas.get('a')?.iniciada
    controladas.get('a')?.liberar('falhou', 'x')

    const r = await execucao

    expect(r.estado).toBe('parcial')
    expect(r.tarefas.map((t) => t.tarefaId)).toEqual(['a', 'b', 'c'])
    expect(r.tarefas.every((t) => t.estado !== 'concluida')).toBe(true)
  })
})

describe('cancelamento', () => {
  it('o sinal chega aos executores, e o plano termina cancelado', async () => {
    manual = true
    const controle = new AbortController()
    const execucao = montar().executar(
      pedido([tarefa('a'), tarefa('b', { dependencias: ['a'] })], { signal: controle.signal })
    )
    await controladas.get('a')?.iniciada
    expect(pedidosAoWorker[0].signal).toBe(controle.signal)

    controle.abort()
    controladas.get('a')?.liberar('cancelada', 'cancelada')
    const r = await execucao

    expect(r.estado).toBe('cancelado')
    expect(r.tarefas.map((t) => [t.tarefaId, t.estado])).toEqual([
      ['a', 'cancelada'],
      ['b', 'cancelada']
    ])
  })

  it('um plano que concluiu todo não vira cancelado por um sinal abortado depois', async () => {
    const controle = new AbortController()
    const r = await montar().executar(pedido([tarefa('a')], { signal: controle.signal }))
    controle.abort()

    expect(r.estado).toBe('concluido')
  })

  it('o sinal abortado no instante em que a última tarefa conclui não apaga o que foi entregue', async () => {
    const controle = new AbortController()
    const executor = new ExecutorDoSquad({
      contexto: { montar: () => ({ ok: true, pack: PACK, fontes: FONTES, descartadas: [] }) },
      worker: {
        executar: async () => {
          controle.abort()
          return { estado: 'concluida' } as never
        }
      },
      escritor: { executar: async () => ({ estado: 'concluida' }) as never },
      audit,
      userId: () => USER,
      workspaceId: () => 'jarvis'
    })

    const r = await executor.executar(pedido([tarefa('a')], { signal: controle.signal }))

    expect(r.estado).toBe('concluido')
  })

  it('sem sinal, o pedido não leva sinal aos executores', async () => {
    await montar().executar(pedido([tarefa('a'), escritora('e', 'api')]))

    expect('signal' in pedidosAoWorker[0]).toBe(false)
    expect('signal' in pedidosAoEscritor[0]).toBe(false)
  })
})

describe('o resultado do plano', () => {
  it('concluído só quando toda tarefa concluiu; parcial se alguma não; um plano vazio é concluído', async () => {
    expect((await montar().executar(pedido([tarefa('a'), tarefa('b')]))).estado).toBe('concluido')

    resposta = (id) => (id === 'b' ? { estado: 'invalida' } : { estado: 'concluida' })
    expect((await montar().executar(pedido([tarefa('a'), tarefa('b')]))).estado).toBe('parcial')

    expect((await montar().executar(pedido([]))).estado).toBe('concluido')
  })

  it('cada tarefa aparece uma única vez, na ordem do plano, mesmo com tudo em paralelo', async () => {
    const ids = ['w1', 'w2', 'w3', 'w4', 'w5']

    const r = await montar().executar(pedido(ids.map((id) => tarefa(id))))

    expect(r.tarefas.map((t) => t.tarefaId)).toEqual(ids)
  })
})
