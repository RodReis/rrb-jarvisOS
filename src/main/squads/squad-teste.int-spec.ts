/**
 * A etapa TESTE (SPEC-Squads-04): a suíte sobre o resultado integrado.
 *
 * O Docker e o Preflight são dublês — a mecânica real do sandbox é o smoke opt-in desta fatia —,
 * mas a **auditoria é real** (banco de verdade): o que se prova aqui é a decisão — verde só quando
 * todo passo passou, `nao-rodou` nunca vira verde, falha externa não é falha do código.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { PreflightOutcome } from '@shared/domain/preflight'
import type { PedidoDePreflight } from '../pipeline/preflight-service'
import type { ExecutorDeSuite } from './squad-teste'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { EtapaDeTeste, SuiteNoSandbox, resumoDaSuite, unidadeDaSuite, MAX_EVIDENCIA } =
  await import('./squad-teste')

type Pedido = Parameters<InstanceType<typeof SuiteNoSandbox>['rodar']>[0]
type Execucao = {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  timeoutExcedido: boolean
}

const USER = 'u-1'
const SANDBOX = {
  runId: 'run-1-teste-t1',
  containerNome: 'jarvis-teste',
  worktreeNoHost: '/raiz/wt-teste',
  cwd: '/work'
}

const ok = (): Execucao => ({
  ok: true,
  stdout: '',
  stderr: '',
  exitCode: 0,
  timeoutExcedido: false
})
const falha = (stderr: string, stdout = ''): Execucao => ({
  ok: false,
  stdout,
  stderr,
  exitCode: 1,
  timeoutExcedido: false
})

let dir: string
let db: Db
let preflight: { preparar: Mock<(pedido: PedidoDePreflight) => PreflightOutcome> }
let docker: {
  exec: Mock<(c: string, comando: readonly string[], cwd: string) => Execucao>
  matarProcesso: Mock<(c: string, cwd: string) => void>
  parar: Mock<(nome: string, cwd: string) => boolean>
}
let respostas: Record<string, Execucao>

const liberado: PreflightOutcome = { reason: 'liberado', mensagem: 'ok', sandbox: SANDBOX as never }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-squad-teste-'))
  db = openDatabase(join(dir, 'jarvis.db'))
  respostas = {}
  preflight = { preparar: vi.fn<(pedido: PedidoDePreflight) => PreflightOutcome>(() => liberado) }
  docker = {
    exec: vi.fn(
      (_c: string, comando: readonly string[], _cwd: string) => respostas[comando[0] ?? ''] ?? ok()
    ),
    matarProcesso: vi.fn<(c: string, cwd: string) => void>(),
    parar: vi.fn<(nome: string, cwd: string) => boolean>(() => true)
  }
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const pedido = (extra: Partial<Pedido> = {}): Pedido => ({
  runId: 'run-1',
  projectId: 'p-1',
  sliceId: 's-1',
  repositorio: '/repo',
  commitSha: 'a'.repeat(40),
  comandos: { test: ['t'], lint: ['l'], typecheck: ['c'], build: ['b'] },
  tentativa: 1,
  ...extra
})

const liberados: [string, unknown][] = []

const suite = () =>
  new SuiteNoSandbox({
    preflight,
    docker,
    isolamento: { liberarRun: (runId, opcoes) => void liberados.push([runId, opcoes]) },
    raizOperacional: () => '/raiz',
    proxyUrl: () => 'http://proxy',
    cwdDoDocker: () => '/docker-cwd'
  })

describe('SuiteNoSandbox', () => {
  it('registra evidência resumida e redigida da suíte', async () => {
    const registrarEvidencia = vi.fn()
    const resultado = await new SuiteNoSandbox({
      preflight,
      docker,
      raizOperacional: () => '/raiz',
      proxyUrl: () => 'http://proxy',
      cwdDoDocker: () => '/docker-cwd',
      registrarEvidencia
    }).rodar(pedido())
    expect(resultado.estado).toBe('verde')
    expect(registrarEvidencia).toHaveBeenCalledWith(
      'run-1',
      1,
      JSON.stringify({ estado: 'verde', passos: ['test', 'lint', 'typecheck', 'build'] })
    )
  })

  it('redige evidência antes de retornar e não transforma falha de persistência em falha da suíte', async () => {
    respostas['t'] = falha('token=chave_falsa_de_fixture_sem_credencial')
    const registrarEvidencia = vi.fn(() => {
      throw new Error('SQLite indisponível')
    })
    const resultado = await new SuiteNoSandbox({
      preflight,
      docker,
      raizOperacional: () => '/raiz',
      proxyUrl: () => 'http://proxy',
      cwdDoDocker: () => '/docker-cwd',
      registrarEvidencia
    }).rodar(pedido())

    expect(resultado.estado).toBe('vermelha')
    expect(JSON.stringify(resultado)).not.toContain('sk_live_')
    expect(JSON.stringify(resultado)).toContain('[redigido]')
  })

  it('todo passo passou: verde, com os passos na ordem', async () => {
    const r = await suite().rodar(pedido())

    expect(r).toEqual({ estado: 'verde', passos: ['test', 'lint', 'typecheck', 'build'] })
  })

  it('roda somente as validações declaradas no perfil aprovado, na ordem do perfil', async () => {
    const perfil = {
      schemaVersion: 1,
      profileId: 'python-1',
      runtime: 'python',
      versaoDoRuntime: '3.12',
      sistema: 'windows',
      shell: 'pwsh',
      instalacao: { argv: ['pip', 'install', '-r', 'requirements.txt'] },
      timeoutEmMinutos: 30,
      validacoes: [
        { id: 'ruff', nome: 'lint', argv: ['ruff', 'check', '.'], grupo: 'qualidade' },
        { id: 'mypy', nome: 'typecheck', argv: ['mypy', '.'], grupo: 'qualidade' },
        { id: 'pytest', nome: 'test', argv: ['pytest', '-q'], grupo: 'testes' }
      ]
    } as const

    const r = await suite().rodar(pedido({ perfilDeCi: perfil as never }))

    expect(r).toEqual({ estado: 'verde', passos: ['ruff', 'mypy', 'pytest'] })
    expect(docker.exec.mock.calls.map(([, comando]) => comando)).toEqual([
      ['ruff', 'check', '.'],
      ['mypy', '.'],
      ['pytest', '-q']
    ])
  })

  it('sobe o sandbox SOBRE o commit integrado, com unidade e branch próprias da tentativa', async () => {
    await suite().rodar(pedido({ tentativa: 2 }))

    expect(preflight.preparar).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: unidadeDaSuite('run-1', 2),
        base: 'a'.repeat(40),
        sufixoDaBranch: 'teste-t2'
      })
    )
  })

  it('a suíte roda no container, com o worktree como cwd, e o container para no fim', async () => {
    await suite().rodar(pedido())

    expect(docker.exec).toHaveBeenCalledWith('jarvis-teste', ['t'], '/raiz/wt-teste')
    expect(docker.parar).toHaveBeenCalledWith('jarvis-teste', '/docker-cwd')
  })

  it('para no primeiro passo vermelho, com passo, classe e a cauda da evidência', async () => {
    respostas['l'] = falha('src/a.ts: 3 erros de lint')

    const r = await suite().rodar(pedido())

    expect(r).toEqual({
      estado: 'vermelha',
      passo: 'lint',
      classificacao: 'corrigivel',
      evidencia: 'src/a.ts: 3 erros de lint',
      passos: ['test']
    })
    expect(docker.exec).toHaveBeenCalledTimes(2)
  })

  it('falha de rede é externa: não é culpa do código do escritor', async () => {
    respostas['t'] = falha('npm ERR! ETIMEDOUT')

    const r = await suite().rodar(pedido())

    expect(r).toMatchObject({ estado: 'vermelha', classificacao: 'externo' })
  })

  it('a evidência é só o fim da saída, com teto', async () => {
    respostas['t'] = falha(`${'ruído\n'.repeat(5000)}ERRO FINAL`)

    const r = await suite().rodar(pedido())

    expect(r.estado === 'vermelha' && r.evidencia.length).toBeLessThanOrEqual(MAX_EVIDENCIA)
    expect(r.estado === 'vermelha' && r.evidencia.endsWith('ERRO FINAL')).toBe(true)
  })

  it('o container para mesmo quando o passo falha', async () => {
    respostas['t'] = falha('x')

    await suite().rodar(pedido())

    expect(docker.parar).toHaveBeenCalledTimes(1)
  })

  it('sandbox que não subiu: nao-rodou — nunca verde', async () => {
    preflight.preparar.mockReturnValue({
      reason: 'docker-indisponivel',
      mensagem: 'Docker fora do ar'
    })

    const r = await suite().rodar(pedido())

    expect(r).toEqual({ estado: 'nao-rodou', motivo: 'docker-indisponivel: Docker fora do ar' })
    expect(docker.exec).not.toHaveBeenCalled()
  })

  it.each(['test', 'lint', 'typecheck', 'build'] as const)(
    'comando de %s que o projeto não declara: nao-rodou, a suíte que não existe não está verde',
    async (passo) => {
      const comandos = { test: ['t'], lint: ['l'], typecheck: ['c'], build: ['b'], [passo]: [] }

      const r = await suite().rodar(pedido({ comandos }))

      expect(r).toEqual({ estado: 'nao-rodou', motivo: `comando-ausente:${passo}` })
      expect(preflight.preparar).not.toHaveBeenCalled()
    }
  )

  it('cancelada antes de começar: nem sobe o sandbox', async () => {
    const controle = new AbortController()
    controle.abort()

    const r = await suite().rodar(pedido({ signal: controle.signal }))

    expect(r).toEqual({ estado: 'cancelada' })
    expect(preflight.preparar).not.toHaveBeenCalled()
  })

  it('cancelada no meio: mata o processo, para o container e não roda o passo seguinte', async () => {
    const controle = new AbortController()
    docker.exec.mockImplementation((_c, comando) => {
      if (comando[0] === 't') controle.abort()
      return ok()
    })

    const r = await suite().rodar(pedido({ signal: controle.signal }))

    expect(r).toEqual({ estado: 'cancelada' })
    expect(docker.matarProcesso).toHaveBeenCalledWith('jarvis-teste', '/raiz/wt-teste')
    expect(docker.exec).toHaveBeenCalledTimes(1)
    expect(docker.parar).toHaveBeenCalledTimes(1)
  })
})

describe('EtapaDeTeste', () => {
  const etapa = (executor: ExecutorDeSuite = suite()) =>
    new EtapaDeTeste({
      suite: executor,
      audit: new AuditRepository(db, 'chave-de-teste'),
      userId: () => USER,
      workspaceId: () => 'jarvis'
    })

  it('devolve o resultado da suíte e audita estado, passo e classe — sem a saída do projeto', async () => {
    respostas['t'] = falha('SEGREDO-NA-SAIDA: senha=123')

    const r = await etapa().executar(pedido())

    expect(r.estado).toBe('vermelha')
    const eventos = new AuditRepository(db, 'chave-de-teste')
      .list(USER)
      .filter((e) => e.type === 'squad-teste')
    expect(eventos).toHaveLength(1)
    expect(eventos[0]?.payload).toMatchObject({
      runId: 'run-1',
      tentativa: 1,
      estado: 'vermelha',
      passo: 'test',
      classificacao: 'corrigivel'
    })
    expect(JSON.stringify(eventos[0]?.payload)).not.toContain('SEGREDO')
  })

  it('executor que lança vira nao-rodou: a etapa nunca lança e nunca presume verde', async () => {
    const quebrado: ExecutorDeSuite = {
      rodar: () => Promise.reject(new TypeError('explodiu'))
    }

    const r = await etapa(quebrado).executar(pedido())

    expect(r).toEqual({ estado: 'nao-rodou', motivo: 'erro inesperado: TypeError' })
  })
})

describe('resumoDaSuite', () => {
  it.each([
    [{ estado: 'verde', passos: ['test', 'lint'] } as const, 'suíte verde: test, lint'],
    [{ estado: 'cancelada' } as const, 'suíte cancelada'],
    [{ estado: 'nao-rodou', motivo: 'sem docker' } as const, 'suíte não rodou: sem docker']
  ])('%j', (resultado, esperado) => {
    expect(resumoDaSuite(resultado)).toBe(esperado)
  })

  it('vermelha traz o passo, a classe e a evidência', () => {
    expect(
      resumoDaSuite({
        estado: 'vermelha',
        passo: 'test',
        classificacao: 'corrigivel',
        evidencia: '1 falhou',
        passos: []
      })
    ).toBe('suíte vermelha no passo test (corrigivel):\n1 falhou')
  })
})

describe('SuiteNoSandbox: isolamento por run (SPEC-Scheduler-03)', () => {
  it('ao terminar devolve o que montou, preservando o worktree do commit integrado', async () => {
    liberados.length = 0

    await suite().rodar(pedido({ tentativa: 3 }))

    // O preflight dublê devolve sempre o mesmo sandbox: o que importa é que a suíte devolve o que o
    // **sandbox** diz ser o run dele.
    expect(liberados).toEqual([[liberado.sandbox?.runId, { preservarWorktree: true }]])
  })
})
