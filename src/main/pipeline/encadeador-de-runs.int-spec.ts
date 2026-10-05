/**
 * O encadeador de produção de um run (SPEC-Scheduler-05, PR-B), contra o pool real: `FilaService`,
 * `PoolService` e SQLite de verdade, ligados pelo `aoAdquirir` como em produção. Preflight, entrega
 * e proxy são dublês — o que se prova aqui é a **costura**: quem espera, quem renova, quem aborta.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Approval, RevisaoAprovada } from '@shared/domain/aprovacoes'
import { CONFIG_PADRAO } from '@shared/domain/pool'
import type { Mvp, Slice } from '@shared/domain/roadmap'
import type { PreflightOutcome, SandboxPreparado } from '@shared/domain/preflight'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { PipelineRepository } = await import('./pipeline-repository')
const { LeaseRepository } = await import('./lease-repository')
const { FilaService } = await import('./fila-service')
const { PoolRepository } = await import('./pool-repository')
const { PoolService } = await import('./pool-service')
const { GerenteDeSlots, ganchosDosSlots } = await import('../squads/squad-slots')
const { EncadeadorDeRuns } = await import('./encadeador-de-runs')

const USER = 'u-1'
const WS = 'jarvis' as const
const PROJETO = 'p-a'
const AGORA = 1_700_000_000_000

const origem: Mvp['origem'] = { tipo: 'decisao', decisaoId: 'd-1', perguntaId: 'p-1' }
const MVPS: readonly Mvp[] = [
  { id: 'm1', numero: 1, titulo: 'MVP 1', tese: 't', estado: 'na-fila', dependeDe: [], origem }
]
const SLICES: readonly Slice[] = [
  { id: 'f1', mvpId: 'm1', numero: 1, titulo: 'F1', specSlug: 'spec-f1', detalhada: true, origem }
]
const REVISOES: readonly RevisaoAprovada[] = [{ artefato: 'spec-f1', hash: 'h-1' }]

const aprovacao: Approval = {
  id: 'a-1',
  user_id: USER,
  workspace_id: WS,
  projectId: PROJETO,
  gate: 'SLICE_ENTRY',
  revisoes: REVISOES,
  identidade: 'sessao-1',
  autor: 'pi',
  created_at: new Date(AGORA).toISOString()
}

let dir: string
let db: Db
let pool: InstanceType<typeof PoolService>
let fila: InstanceType<typeof FilaService>
let gerente: InstanceType<typeof GerenteDeSlots>
let runs: InstanceType<typeof PipelineRepository>
let relogio: number

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-encadeador-'))
  relogio = AGORA
  db = openDatabase(join(dir, 'teste.db'))
  runs = new PipelineRepository(db)
  const leases = new LeaseRepository(db)
  const audit = new AuditRepository(db, 'chave-de-teste')
  pool = new PoolService({
    db,
    pool: new PoolRepository(db),
    leases,
    audit,
    userId: () => USER,
    workspaceId: () => WS,
    gates: (item) => fila.gatesDoItem(item),
    ativar: (item) => fila.ativarRun(item),
    agora: () => relogio
  })
  fila = new FilaService({
    runs,
    pool,
    workspaceId: () => WS,
    audit,
    roadmap: () => ({ mvps: MVPS, slices: SLICES }),
    aprovacoes: () => [aprovacao],
    revisoesDoGate: () => REVISOES,
    userId: () => USER,
    mergeAutonomoLigado: () => true,
    ...ganchosDosSlots(() => gerente),
    agora: () => relogio
  })
  gerente = new GerenteDeSlots(fila)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Um run `READY`, como o PI o deixa depois da aprovação. */
function pronto(continuaDe?: string, projeto = PROJETO): string {
  const run = fila.criarRun(projeto, WS, 'f1', continuaDe)
  fila.transicionar(projeto, WS, run.id, 'AWAITING_PI')
  fila.transicionar(projeto, WS, run.id, 'READY')
  return run.id
}

const sandboxDe = (runId: string): SandboxPreparado => ({
  runId,
  containerNome: `jarvis-${runId}`,
  cwd: '/work',
  baseSha: 'abc',
  branch: `feat/f1-${runId.slice(0, 8)}`,
  worktreeNoHost: `/host/${runId}`,
  pathsPermitidos: { paths: ['src'], origem: 'spec', justificativa: 'SPEC' },
  proxyUrl: 'http://172.20.0.2:8080',
  modeloDaConstrucao: { provider: 'claude-code', modelo: 'claude-opus-5' }
})

const liberado = (runId: string): PreflightOutcome => ({
  reason: 'liberado',
  mensagem: 'ok',
  sandbox: sandboxDe(runId)
})

const recusado: PreflightOutcome = {
  reason: 'docker-indisponivel',
  mensagem: 'O Docker não respondeu.',
  retomada: 'Subir o Docker.'
}

const BLOQUEIO = {
  causa: 'docker-indisponivel',
  evidencia: 'O Docker não respondeu.',
  tentativas: 0,
  porQueNaoSeguir: 'Sem sandbox não há execução.',
  retomada: 'Subir o Docker.'
}

const pedidoDe = (runId: string) => ({
  runId,
  workspaceId: WS,
  raizOperacional: '/raiz',
  repositorio: '/repo',
  base: 'main',
  alvo: { owner: 'o', repo: 'r', branchBase: 'main' },
  issue: 7,
  titulo: '[F1] fatia',
  promptInicial: 'construa',
  contextPackId: 'pack-1',
  comandosDeValidacao: {
    test: ['npm', 'test'],
    lint: ['npm', 'run', 'lint'],
    typecheck: ['npm', 'run', 'typecheck'],
    build: ['npm', 'run', 'build']
  }
})

interface Dobles {
  preflight: { preparar: ReturnType<typeof vi.fn>; bloqueioDe: ReturnType<typeof vi.fn> }
  entrega: { entregar: ReturnType<typeof vi.fn> }
  proxy: {
    registrarUnidade: ReturnType<typeof vi.fn>
    liberarUnidade: ReturnType<typeof vi.fn>
    url: ReturnType<typeof vi.fn>
  }
}

function dobles(entregar?: (pedido: { runId: string; signal?: AbortSignal }) => Promise<unknown>) {
  let n = 0
  const d: Dobles = {
    preflight: {
      preparar: vi.fn((p: { runId: string }) => liberado(p.runId)),
      bloqueioDe: vi.fn(() => BLOQUEIO)
    },
    entrega: {
      entregar: vi.fn(
        entregar ?? (async () => ({ estadoFinal: 'AWAITING_MERGE' as const, pullRequest: 1 }))
      )
    },
    proxy: {
      registrarUnidade: vi.fn(() => {
        n += 1
        return { chave: `chave-${n}`, caminho: `/u/${'0'.repeat(31)}${n}` }
      }),
      liberarUnidade: vi.fn(),
      url: vi.fn(() => 'http://host.docker.internal:1')
    }
  }
  return d
}

function encadeador(
  d: Dobles,
  intervaloDoHeartbeatMs = 5,
  perfilCodex?: { renovar: (r: string) => boolean; liberar: (r: string) => boolean }
) {
  return new EncadeadorDeRuns({
    slots: gerente,
    fila,
    runs,
    preflight: d.preflight as never,
    entrega: d.entrega as never,
    proxy: d.proxy as never,
    intervaloDoHeartbeatMs,
    ...(perfilCodex === undefined ? {} : { perfilCodex })
  })
}

const volta = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Espera até a condição valer (ou o teto), em vez de apostar quantas batidas cabem em N ms. */
async function ate(condicao: () => boolean, tetoMs = 2_000): Promise<void> {
  const limite = Date.now() + tetoMs
  while (!condicao() && Date.now() < limite) await volta(5)
}

describe('o caminho do run: slot → preflight → entrega', () => {
  it('encadeia com o token do slot, a unidade do proxy e a branch que o preflight criou', async () => {
    const d = dobles()
    const run = pronto()

    const r = await encadeador(d).executar(pedidoDe(run))

    expect(r).toEqual({
      tipo: 'entrega',
      resultado: { estadoFinal: 'AWAITING_MERGE', pullRequest: 1 }
    })
    expect(d.proxy.registrarUnidade).toHaveBeenCalledWith({
      workspaceId: WS,
      runId: run,
      tentativa: 1,
      contextPackId: 'pack-1'
    })
    expect(d.preflight.preparar).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: run,
        projectId: PROJETO,
        sliceId: 'f1',
        tentativa: 1,
        proxyUrl: 'http://host.docker.internal:1',
        caminhoDoProxy: `/u/${'0'.repeat(31)}1`
      })
    )
    const token = pool.slotDoRun(run)?.fencingToken
    expect(typeof token).toBe('number')
    expect(d.entrega.entregar).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: run,
        projectId: PROJETO,
        fencingToken: token,
        // A branch que a entrega publica é a que o preflight criou, nunca uma segunda.
        alvo: expect.objectContaining({ branchDaFatia: sandboxDe(run).branch })
      })
    )
  })

  it('libera a unidade do proxy e esquece o run ao terminar, em qualquer desfecho', async () => {
    const d = dobles()
    const run = pronto()
    const e = encadeador(d)

    await e.executar(pedidoDe(run))

    expect(d.proxy.liberarUnidade).toHaveBeenCalledWith('chave-1')
    expect(e.estaEmVoo(run)).toBe(false)
  })

  it('cada retomada da mesma fatia é uma tentativa nova, com branch própria', async () => {
    const d = dobles()
    const primeiro = pronto()
    fila.transicionar(PROJETO, WS, primeiro, 'CANCELLED')
    const segundo = pronto(primeiro)

    await encadeador(d).executar(pedidoDe(segundo))

    expect(d.preflight.preparar).toHaveBeenCalledWith(
      expect.objectContaining({ runId: segundo, tentativa: 2 })
    )
    expect(d.proxy.registrarUnidade).toHaveBeenCalledWith(expect.objectContaining({ tentativa: 2 }))
  })

  it('o mesmo run não entra duas vezes em voo', async () => {
    let soltar: () => void = () => {}
    const d = dobles(
      () =>
        new Promise((r) => {
          soltar = () => r({ estadoFinal: 'AWAITING_MERGE' })
        })
    )
    const run = pronto()
    const e = encadeador(d)

    const a = e.executar(pedidoDe(run))
    await volta()
    const b = await e.executar(pedidoDe(run))

    expect(b).toEqual({ tipo: 'sem-slot', motivo: 'indisponivel' })
    expect(d.entrega.entregar).toHaveBeenCalledTimes(1)
    soltar()
    await a
  })
})

describe('o write set previsto é o dos paths que o run declarou, enquanto ele está em voo', () => {
  it('responde com os paths da SPEC durante a execução e esquece ao terminar', async () => {
    let durante: readonly string[] | undefined
    const run = pronto()
    const e = encadeador(
      dobles(async () => {
        durante = e.writeSetPrevisto(run)
        return { estadoFinal: 'AWAITING_MERGE' }
      })
    )

    await e.executar({
      ...pedidoDe(run),
      pathsDaSpec: { paths: ['src/a', 'src/b'], origem: 'spec', justificativa: 'SPEC' }
    })

    expect(durante).toEqual(['src/a', 'src/b'])
    expect(e.writeSetPrevisto(run)).toBeUndefined()
  })

  it('run sem paths declarados não tem write set: a prova fica incompleta e ele segue em sequência', async () => {
    let durante: readonly string[] | undefined = ['x']
    const run = pronto()
    const e = encadeador(
      dobles(async () => {
        durante = e.writeSetPrevisto(run)
        return { estadoFinal: 'AWAITING_MERGE' }
      })
    )

    await e.executar(pedidoDe(run))

    expect(durante).toBeUndefined()
  })

  it('o write set já está declarado quando o pool decide (a prova pergunta no ciclo de adquirir)', async () => {
    let noPedidoDoSlot: readonly string[] | undefined
    const run = pronto()
    const e = encadeador(dobles())
    const original = gerente.adquirirRun.bind(gerente)
    vi.spyOn(gerente, 'adquirirRun').mockImplementation((p) => {
      noPedidoDoSlot = e.writeSetPrevisto(run)
      return original(p)
    })

    await e.executar({
      ...pedidoDe(run),
      pathsDaSpec: { paths: ['src/a'], origem: 'spec', justificativa: 'SPEC' }
    })

    expect(noPedidoDoSlot).toEqual(['src/a'])
  })
})

describe('o escopo do run é do run, não do chamador (SPEC-Scheduler-05, revisão de segurança)', () => {
  it('workspace diferente do run: recusa como inexistente, sem slot e sem montar nada', async () => {
    const d = dobles()
    const run = pronto()

    const r = await encadeador(d).executar({ ...pedidoDe(run), workspaceId: 'noa' })

    expect(r).toEqual({ tipo: 'sem-slot', motivo: 'indisponivel' })
    expect(pool.slotDoRun(run)).toBeUndefined()
    expect(d.proxy.registrarUnidade).not.toHaveBeenCalled()
    expect(d.preflight.preparar).not.toHaveBeenCalled()
  })

  it('só run READY entra: run que não passa pelo gate da fila não espera para sempre', async () => {
    const d = dobles()
    const run = fila.criarRun(PROJETO, WS, 'f1').id

    const r = await encadeador(d).executar(pedidoDe(run))

    expect(r).toEqual({ tipo: 'sem-slot', motivo: 'indisponivel' })
    expect(pool.vista().fila).toEqual([])
  })

  it('interrompido entre a aquisição e o sandbox: nada é montado e o run é bloqueado com o token', async () => {
    const d = dobles()
    const run = pronto()
    const e = encadeador(d)
    // O abort chega no instante em que o slot é adquirido (o preflight ainda não rodou).
    const adquirir = vi.spyOn(gerente, 'adquirirRun')
    adquirir.mockImplementation(async (p) => {
      const r = await GerenteDeSlots.prototype.adquirirRun.call(gerente, p)
      e.interromper(run)
      return r
    })

    const r = await e.executar(pedidoDe(run))

    expect(r).toEqual({ tipo: 'sem-slot', motivo: 'cancelada' })
    expect(d.preflight.preparar).not.toHaveBeenCalled()
    expect(runs.buscar(run)?.estado).toBe('BLOCKED')
  })
})

describe('o heartbeat vai da aquisição ao desfecho (regra 1 da SPEC-Scheduler-05)', () => {
  it('renova o slot com o token enquanto a entrega espera, e para quando ela termina', async () => {
    let soltar: () => void = () => {}
    const d = dobles(
      () =>
        new Promise((r) => {
          soltar = () => r({ estadoFinal: 'AWAITING_MERGE' })
        })
    )
    const run = pronto()
    const renovar = vi.spyOn(fila, 'renovarSlot')
    const pendente = encadeador(d, 5).executar(pedidoDe(run))

    await ate(() => renovar.mock.calls.length >= 3)
    const token = pool.slotDoRun(run)?.fencingToken
    expect(renovar.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(renovar).toHaveBeenCalledWith(run, token)

    soltar()
    await pendente
    const depois = renovar.mock.calls.length
    await volta(30)
    expect(renovar.mock.calls.length).toBe(depois)
  })

  it('o preflight já roda sob heartbeat: o run não está sem dono enquanto o sandbox sobe', async () => {
    const d = dobles()
    const run = pronto()
    const renovar = vi.spyOn(fila, 'renovarSlot')
    let batidasNoPreflight = -1
    d.preflight.preparar.mockImplementation((p: { runId: string }) => {
      // O preflight é síncrono: o intervalo só roda se ele cedesse o laço. O que se prova é que a
      // batida já está armada antes dele — o `clearInterval` do `finally` é o único a pará-la.
      batidasNoPreflight = renovar.mock.calls.length
      return liberado(p.runId)
    })

    await encadeador(d).executar(pedidoDe(run))

    expect(batidasNoPreflight).toBe(0)
    expect(renovar).not.toHaveBeenCalledWith(run, undefined)
  })

  it('perder o lease aborta a entrega: sem dono, ninguém segue escrevendo', async () => {
    let sinal: AbortSignal | undefined
    const d = dobles(async (p) => {
      sinal = p.signal
      await volta(40)
      return { estadoFinal: 'BLOCKED' }
    })
    const run = pronto()
    vi.spyOn(fila, 'renovarSlot').mockReturnValue(false)

    await encadeador(d, 5).executar(pedidoDe(run))

    expect(sinal?.aborted).toBe(true)
  })

  it('não conseguir nem perguntar (banco indisponível) vale o mesmo, sem exceção solta', async () => {
    let sinal: AbortSignal | undefined
    const d = dobles(async (p) => {
      sinal = p.signal
      await volta(40)
      return { estadoFinal: 'BLOCKED' }
    })
    const run = pronto()
    vi.spyOn(fila, 'renovarSlot').mockImplementation(() => {
      throw new Error('SQLITE_BUSY')
    })

    await encadeador(d, 5).executar(pedidoDe(run))

    expect(sinal?.aborted).toBe(true)
  })
})

describe('uma exceção passageira do heartbeat não derruba o run, duas seguidas sim', () => {
  it('um SQLITE_BUSY isolado é tolerado: a batida seguinte renova e a entrega segue', async () => {
    let sinal: AbortSignal | undefined
    const d = dobles(async (p) => {
      sinal = p.signal
      await volta(60)
      return { estadoFinal: 'AWAITING_MERGE' }
    })
    const run = pronto()
    const real = fila.renovarSlot.bind(fila)
    let chamadas = 0
    vi.spyOn(fila, 'renovarSlot').mockImplementation((r, t) => {
      chamadas += 1
      if (chamadas === 1) throw new Error('SQLITE_BUSY')
      return real(r, t)
    })

    await encadeador(d, 5).executar(pedidoDe(run))

    expect(chamadas).toBeGreaterThan(2)
    expect(sinal?.aborted).toBe(false)
  })
})

describe('a entrega que devolve BLOCKED sem mexer no run não o deixa ativo e sem dono', () => {
  const bloqueada = {
    estadoFinal: 'BLOCKED' as const,
    bloqueio: {
      causa: 'perfil-de-ci-invalido',
      acao: 'Corrigir o perfil.',
      mensagem: 'Perfil inválido.'
    }
  }

  it('o run vai a BLOCKED com a causa da entrega, e a recuperação pode devolver o slot', async () => {
    const d = dobles(async () => bloqueada)
    const run = pronto()

    await encadeador(d).executar(pedidoDe(run))

    expect(runs.buscar(run)?.estado).toBe('BLOCKED')
    expect(runs.buscar(run)?.bloqueio).toMatchObject({
      causa: 'perfil-de-ci-invalido',
      evidencia: 'Perfil inválido.',
      retomada: 'Corrigir o perfil.'
    })
  })

  it('run já terminal (cancelado durante a entrega) não é tocado de novo', async () => {
    const d = dobles(async (p) => {
      fila.transicionar(PROJETO, WS, p.runId, 'CANCELLED')
      return bloqueada
    })
    const run = pronto()
    const transicionar = vi.spyOn(fila, 'transicionar')

    await encadeador(d).executar(pedidoDe(run))

    expect(runs.buscar(run)?.estado).toBe('CANCELLED')
    // A fila já recusaria; o que se prova é que o encadeador nem tenta bloquear o terminal.
    expect(transicionar.mock.calls.filter((c) => c[3] === 'BLOCKED')).toEqual([])
  })
})

describe('a posse do perfil do Codex acompanha o run (decisão do PI, 2026-10-05)', () => {
  const perfil = () => ({ renovar: vi.fn(() => true), liberar: vi.fn(() => true) })

  it('a batida do slot renova também a posse do perfil, enquanto o run existir', async () => {
    let soltar: () => void = () => {}
    const d = dobles(
      () =>
        new Promise((r) => {
          soltar = () => r({ estadoFinal: 'AWAITING_MERGE' })
        })
    )
    const run = pronto()
    const p = perfil()
    const pendente = encadeador(d, 5, p).executar(pedidoDe(run))

    await ate(() => p.renovar.mock.calls.length >= 3)
    expect(p.renovar.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(p.renovar).toHaveBeenCalledWith(run)

    soltar()
    await pendente
    const depois = p.renovar.mock.calls.length
    await volta(30)
    expect(p.renovar.mock.calls.length).toBe(depois)
  })

  it('devolve a posse ao terminar com a entrega', async () => {
    const p = perfil()
    const run = pronto()

    await encadeador(dobles(), 5, p).executar(pedidoDe(run))

    expect(p.liberar).toHaveBeenCalledWith(run)
  })

  it('devolve a posse quando o preflight recusa', async () => {
    const p = perfil()
    const d = dobles()
    d.preflight.preparar.mockReturnValue({
      reason: 'docker-indisponivel',
      mensagem: 'x',
      retomada: 'y'
    })
    const run = pronto()

    await encadeador(d, 5, p).executar(pedidoDe(run))

    expect(p.liberar).toHaveBeenCalledWith(run)
  })

  it('devolve a posse quando a execução explode', async () => {
    const p = perfil()
    const d = dobles(async () => {
      throw new Error('explodiu')
    })
    const run = pronto()

    await expect(encadeador(d, 5, p).executar(pedidoDe(run))).rejects.toThrow()

    expect(p.liberar).toHaveBeenCalledWith(run)
  })

  it('cancelar o run em voo devolve a posse quando a entrega termina (o perfil não fica preso)', async () => {
    const run = pronto()
    const p = perfil()
    const e = encadeador(
      dobles(
        (pedido) =>
          new Promise((r) => {
            pedido.signal?.addEventListener('abort', () => r({ estadoFinal: 'BLOCKED' }))
          })
      ),
      5,
      p
    )
    const pendente = e.executar(pedidoDe(run))
    await volta(15)
    expect(p.liberar).not.toHaveBeenCalled()

    e.interromper(run)
    await pendente

    expect(p.liberar).toHaveBeenCalledWith(run)
  })

  it('uma falha passageira ao devolver é tentada de novo: o perfil não fica preso', async () => {
    const run = pronto()
    let chamadas = 0
    const p = {
      renovar: vi.fn(() => true),
      liberar: vi.fn(() => {
        chamadas += 1
        if (chamadas === 1) throw new Error('SQLITE_BUSY')
        return true
      })
    }

    await encadeador(dobles(), 5, p).executar(pedidoDe(run))

    expect(p.liberar).toHaveBeenCalledTimes(2)
  })

  it('falha ao renovar ou devolver a posse não derruba a batida nem o desfecho do run', async () => {
    const run = pronto()
    const p = {
      renovar: vi.fn(() => {
        throw new Error('SQLITE_BUSY')
      }),
      liberar: vi.fn(() => {
        throw new Error('SQLITE_BUSY')
      })
    }
    const d = dobles(async () => {
      await volta(30)
      return { estadoFinal: 'AWAITING_MERGE' as const }
    })

    const r = await encadeador(d, 5, p).executar(pedidoDe(run))

    expect(r).toEqual({ tipo: 'entrega', resultado: { estadoFinal: 'AWAITING_MERGE' } })
    expect(p.renovar).toHaveBeenCalled()
    expect(p.liberar).toHaveBeenCalled()
  })
})

describe('o preflight recusado bloqueia o run com o token, sem tocar na entrega', () => {
  it('vai a BLOCKED com os cinco campos e devolve o desfecho', async () => {
    const d = dobles()
    d.preflight.preparar.mockReturnValue(recusado)
    const run = pronto()

    const r = await encadeador(d).executar(pedidoDe(run))

    expect(r).toEqual({ tipo: 'preflight-recusado', outcome: recusado })
    expect(runs.buscar(run)?.estado).toBe('BLOCKED')
    expect(runs.buscar(run)?.bloqueio).toMatchObject({ causa: 'docker-indisponivel' })
    expect(d.entrega.entregar).not.toHaveBeenCalled()
    expect(d.proxy.liberarUnidade).toHaveBeenCalledWith('chave-1')
  })
})

describe('falha inesperada não deixa o run RUNNING sem dono', () => {
  it('bloqueia o run com o token, libera a unidade e relança', async () => {
    const d = dobles(async () => {
      throw new Error('explodiu')
    })
    const run = pronto()
    const e = encadeador(d)

    await expect(e.executar(pedidoDe(run))).rejects.toThrow('explodiu')

    expect(runs.buscar(run)?.estado).toBe('BLOCKED')
    expect(d.proxy.liberarUnidade).toHaveBeenCalledWith('chave-1')
    expect(e.estaEmVoo(run)).toBe(false)
  })
})

describe('interromper atinge só o run alvo (critério 4: cancelar um não derruba o outro)', () => {
  it('aborta a entrega do run pedido e deixa a do vizinho intacta', async () => {
    pool.configurar({ ...CONFIG_PADRAO, paralelismo: true })
    const sinais = new Map<string, AbortSignal>()
    const portas = new Map<string, () => void>()
    const d = dobles(
      (p) =>
        new Promise((r) => {
          if (p.signal !== undefined) sinais.set(p.runId, p.signal)
          portas.set(p.runId, () => r({ estadoFinal: 'AWAITING_MERGE' }))
        })
    )
    // Projetos diferentes: o limite por projeto (um) serializaria dois runs do mesmo.
    const a = pronto(undefined, 'p-a')
    const b = pronto(undefined, 'p-b')
    const e = encadeador(d)

    const ea = e.executar(pedidoDe(a))
    const eb = e.executar(pedidoDe(b))
    await volta(20)

    expect(e.interromper(a)).toBe(true)

    expect(sinais.get(a)?.aborted).toBe(true)
    expect(sinais.get(b)?.aborted).toBe(false)
    expect(e.estaEmVoo(b)).toBe(true)
    portas.get(a)?.()
    portas.get(b)?.()
    await Promise.all([ea, eb])
  })

  it('run que não está em voo neste processo: nada a interromper', () => {
    expect(encadeador(dobles()).interromper('outro')).toBe(false)
  })

  it('interromper quem ainda espera o slot o tira da fila, e nada é montado', async () => {
    const d = dobles(() => new Promise(() => {}))
    const primeiro = pronto()
    const segundo = pronto()
    const e = encadeador(d)
    void e.executar(pedidoDe(primeiro))
    await volta(20)
    const espera = e.executar(pedidoDe(segundo))
    await volta(10)
    expect(pool.vista().fila).toHaveLength(1)

    e.interromper(segundo)

    expect(await espera).toEqual({ tipo: 'sem-slot', motivo: 'cancelada' })
    expect(pool.vista().fila).toEqual([])
    expect(d.preflight.preparar).toHaveBeenCalledTimes(1)
    expect(d.proxy.registrarUnidade).toHaveBeenCalledTimes(1)
  })
})

describe('o paralelismo desligado serializa os runs (decisão 2 do PI)', () => {
  it('o segundo run só roda depois de o primeiro terminar', async () => {
    let soltar: () => void = () => {}
    const ordem: string[] = []
    const d = dobles(async (p) => {
      ordem.push(`inicio:${p.runId}`)
      if (ordem.length === 1) {
        await new Promise<void>((r) => {
          soltar = r
        })
      }
      ordem.push(`fim:${p.runId}`)
      // O terminal concluído solta o slot e passa a vez, como o `EntregaService` faz em produção.
      const token = pool.slotDoRun(p.runId)?.fencingToken
      fila.transicionar(PROJETO, WS, p.runId, 'VALIDATING', undefined, token)
      fila.transicionar(PROJETO, WS, p.runId, 'PR_CI', undefined, token)
      fila.concluir(PROJETO, WS, p.runId, token)
      return { estadoFinal: 'AWAITING_MERGE' }
    })
    const a = pronto()
    const b = pronto()
    const e = encadeador(d)

    const ea = e.executar(pedidoDe(a))
    await volta(10)
    const eb = e.executar(pedidoDe(b))
    await volta(20)
    expect(ordem).toEqual([`inicio:${a}`])

    soltar()
    await Promise.all([ea, eb])

    expect(ordem).toEqual([`inicio:${a}`, `fim:${a}`, `inicio:${b}`, `fim:${b}`])
  })
})
