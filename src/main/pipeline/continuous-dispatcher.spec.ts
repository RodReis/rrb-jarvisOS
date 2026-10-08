import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@shared/domain/entities'
import { comporInventario, type InventarioGlobal, type NoInventario } from './inventario-global'
import {
  ContinuousDispatcher,
  type ContinuousDispatcherRepository,
  type DecisaoDoDispatcher
} from './continuous-dispatcher'

const scope = { userId: 'u1', workspaceId: 'jarvis' as WorkspaceId, projectId: 'p1' }
const rev = 'a'.repeat(64)
const mvp: NoInventario = {
  id: 'MVP13',
  tipo: 'mvp',
  numero: 13,
  titulo: 'Execução contínua',
  dependeDe: [],
  estadoTecnico: 'mergeado',
  spec: { estado: 'desconhecida' },
  gateAprovado: true,
  bloqueado: false
}
const fatia = (id: string, numero: number, deps: string[] = []): NoInventario => ({
  id,
  tipo: 'fatia',
  mvpId: 'MVP13',
  numero,
  titulo: id,
  dependeDe: deps,
  estadoTecnico: 'pendente',
  spec: { estado: 'aprovada', revisaoAtual: rev, revisaoAprovada: rev },
  gateAprovado: true,
  bloqueado: false,
  issue: { numero: 100 + numero, aberta: true, labels: ['proplan:todo'] }
})

class RepoEmMemoria implements ContinuousDispatcherRepository {
  readonly decisoes = new Map<string, DecisaoDoDispatcher>()
  ultimoCursor = ''
  buscar(_scope: typeof scope, key: string): DecisaoDoDispatcher | undefined {
    return this.decisoes.get(key)
  }
  gravar(_scope: typeof scope, decisao: DecisaoDoDispatcher): void {
    this.decisoes.set(decisao.idempotencyKey, decisao)
  }
  cursor(_scope: typeof scope, fingerprint: string): void {
    this.ultimoCursor = fingerprint
  }
}

function criarDispatcher(options: {
  readonly nos: readonly NoInventario[]
  readonly runs?: Readonly<Record<string, readonly { id: string; estado: string }[]>>
  readonly quotaReset?: (no: NoInventario) => string | undefined
}): {
  readonly dispatcher: ContinuousDispatcher
  readonly repo: RepoEmMemoria
  readonly play: ReturnType<typeof vi.fn>
} {
  const inventario = comporInventario(options.nos)
  const repo = new RepoEmMemoria()
  const play = vi.fn(async (_scope: typeof scope, sliceId: string, _key: string) => ({
    runId: `run-${sliceId}`,
    estado: 'iniciado' as const,
    mensagem: 'iniciado'
  }))
  const dispatcher = new ContinuousDispatcher({
    inventario: { reconciliar: async () => inventario },
    repository: repo,
    sliceId: (_scope, no) => no.id,
    runs: {
      listarDaFatia: (
        _scope: { userId: string; workspaceId: WorkspaceId; projectId: string },
        sliceId: string
      ) => options.runs?.[sliceId] ?? [],
      buscarPorChaveDispatch: () => undefined
    },
    play,
    quotaReset:
      options.quotaReset === undefined ? undefined : (_scope, no) => options.quotaReset?.(no),
    agora: () => new Date('2026-10-08T12:00:00.000Z')
  })
  return { dispatcher, repo, play }
}

describe('ContinuousDispatcher', () => {
  it('despacha uma fatia elegível depois que a dependência está mergeada', async () => {
    const { dispatcher, repo, play } = criarDispatcher({
      nos: [mvp, fatia('MVP13-F01', 1), fatia('MVP13-F02', 2, ['MVP13-F01'])]
    })
    const result = await dispatcher.reconciliar(scope)
    expect(result.estado).toBe('dispatched')
    expect(play).toHaveBeenCalledTimes(1)
    expect(play.mock.calls[0]?.[1]).toBe('MVP13-F01')
    expect(play.mock.calls[0]?.[2]).toMatch(/^[a-f0-9]{64}$/)
    expect([...repo.decisoes.values()].map((decision) => decision.estado)).toContain('dispatched')
  })

  it('não despacha quando o DAG tem diagnóstico ou gate da fatia está pendente', async () => {
    const semGate = { ...fatia('MVP13-F01', 1), gateAprovado: false }
    const { dispatcher, play } = criarDispatcher({ nos: [mvp, semGate] })
    const result = await dispatcher.reconciliar(scope)
    expect(result.estado).toBe('blocked')
    expect(play).not.toHaveBeenCalled()
  })

  it('aguarda quando a fatia ainda está no backlog sem proplan:todo', async () => {
    const pendente = {
      ...fatia('MVP13-F01', 1),
      issue: { numero: 101, aberta: true, labels: ['proplan:backlog', 'proplan:next'] }
    }
    const { dispatcher, play } = criarDispatcher({ nos: [mvp, pendente] })
    const result = await dispatcher.reconciliar(scope)
    expect(result.estado).toBe('waiting')
    expect(result.decisoes[0]?.causa).toContain('proplan:todo')
    expect(play).not.toHaveBeenCalled()
  })

  it('não transforma uma projeção em andamento sem run local em fila drenada', async () => {
    const emAndamento = {
      ...fatia('MVP13-F01', 1),
      estadoTecnico: 'em-andamento' as const,
      issue: { numero: 101, aberta: true, labels: ['proplan:doing'] }
    }
    const { dispatcher, play } = criarDispatcher({ nos: [mvp, emAndamento] })
    const result = await dispatcher.reconciliar(scope)
    expect(result.estado).toBe('waiting')
    expect(result.decisoes[0]?.causa).toContain('em andamento')
    expect(play).not.toHaveBeenCalled()
  })

  it('aguarda quota conhecida e ainda despacha outro ramo elegível', async () => {
    const reset = '2026-10-08T13:00:00.000Z'
    const { dispatcher, play, repo } = criarDispatcher({
      nos: [mvp, fatia('MVP13-F01', 1), fatia('MVP13-F02', 2)],
      quotaReset: (no) => (no.id === 'MVP13-F01' ? reset : undefined)
    })
    const result = await dispatcher.reconciliar(scope)
    expect(result.estado).toBe('dispatched')
    expect(play.mock.calls.map((call) => call[1])).toEqual(['MVP13-F02'])
    expect(
      [...repo.decisoes.values()].some(
        (decision) => decision.estado === 'waiting' && decision.retomarEm === reset
      )
    ).toBe(true)
  })

  it('retoma sem repetir um run ativo e serializa sinais concorrentes', async () => {
    let liberar: (() => void) | undefined
    const inventario: InventarioGlobal = comporInventario([mvp, fatia('MVP13-F01', 1)])
    const repo = new RepoEmMemoria()
    const play = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        liberar = resolve
      })
      return { runId: 'run-1', estado: 'iniciado' as const, mensagem: 'iniciado' }
    })
    const dispatcher = new ContinuousDispatcher({
      inventario: { reconciliar: async () => inventario },
      repository: repo,
      sliceId: (_scope, no) => no.id,
      runs: {
        listarDaFatia: () => [{ id: 'run-1', estado: 'RUNNING' }],
        buscarPorChaveDispatch: () => undefined
      },
      play,
      agora: () => new Date('2026-10-08T12:00:00.000Z')
    })
    const a = dispatcher.reconciliar(scope)
    const b = dispatcher.reconciliar(scope)
    expect(a).toBe(b)
    liberar?.()
    const result = await a
    expect(result.estado).toBe('waiting')
    expect(play).not.toHaveBeenCalled()
  })

  it('retoma um run PLANNED com a mesma chave idempotente', async () => {
    const no = fatia('MVP13-F01', 1)
    const inventario = comporInventario([mvp, no])
    const runIdempotente = vi.fn((_scope: typeof scope, key: string) =>
      key.endsWith(':MVP13-F01') ? { id: 'run-retomado', estado: 'PLANNED' } : undefined
    )
    const play = vi.fn(async (_scope: typeof scope, _sliceId: string, _key: string) => ({
      runId: 'run-retomado',
      estado: 'iniciado' as const,
      mensagem: 'retomado'
    }))
    const dispatcher = new ContinuousDispatcher({
      inventario: { reconciliar: async () => inventario },
      repository: new RepoEmMemoria(),
      sliceId: (_scope, item) => item.id,
      runs: { listarDaFatia: () => [], buscarPorChaveDispatch: runIdempotente },
      play,
      agora: () => new Date('2026-10-08T12:00:00.000Z')
    })

    const result = await dispatcher.reconciliar(scope)
    expect(result.estado).toBe('dispatched')
    expect(play).toHaveBeenCalledTimes(1)
    expect(play.mock.calls[0]?.[2]).toBe(
      runIdempotente.mock.calls[0]?.[1].replace(':MVP13-F01', '')
    )
  })

  it('não repete uma decisão bloqueada para a mesma fingerprint do DAG', async () => {
    const inventario = comporInventario([mvp, fatia('MVP13-F01', 1)])
    const repository = new RepoEmMemoria()
    const play = vi.fn(async () => ({
      estado: 'recusado' as const,
      mensagem: 'A rota não está disponível.'
    }))
    const dispatcher = new ContinuousDispatcher({
      inventario: { reconciliar: async () => inventario },
      repository,
      sliceId: (_scope, no) => no.id,
      runs: { listarDaFatia: () => [], buscarPorChaveDispatch: () => undefined },
      play,
      agora: () => new Date('2026-10-08T12:00:00.000Z')
    })

    await dispatcher.reconciliar(scope)
    const second = await dispatcher.reconciliar(scope)

    expect(second.estado).toBe('blocked')
    expect(play).toHaveBeenCalledTimes(1)
  })
})
