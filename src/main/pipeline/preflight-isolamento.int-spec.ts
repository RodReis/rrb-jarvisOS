/**
 * O preflight com isolamento por run (SPEC-Scheduler-03).
 *
 * O mundo Docker/Git é um dublê em memória; o resto é real (SQLite, leases, inventário,
 * `IsolamentoService`). O que se mede é o contrato: cada run sai com recursos próprios e
 * etiquetados, a colisão é recusada **antes** de criar qualquer coisa, e a falha no meio devolve
 * o que já foi criado.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@shared/domain/entities'
import type { EntradaDoScanner } from '@shared/domain/isolamento'
import type { PathsPermitidos } from '@shared/domain/preflight'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { LeaseRepository } = await import('./lease-repository')
const { InventarioRepository } = await import('./inventario-repository')
const { ExecutionLedgerRepository } = await import('./execution-ledger-repository')
const { IsolamentoService } = await import('./isolamento-service')
const { PreflightService } = await import('./preflight-service')

const USER = 'u-1'
const WS: WorkspaceId = 'jarvis'
const AGORA = 1_700_000_000_000
const PATHS: PathsPermitidos = { paths: ['src'], origem: 'spec', justificativa: 'teste' }
const SANDBOX_LIMPO: EntradaDoScanner = {
  env: ['PATH=/usr/bin', 'ANTHROPIC_BASE_URL=http://172.20.0.2:8080'],
  montagens: [{ origem: '/raiz/x', destino: '/work', somenteLeitura: false }],
  comando: ['sleep', 'infinity'],
  arquivos: []
}

/** O mundo: o que o Docker "tem" depois de cada chamada do preflight. */
class MundoDocker {
  containers = new Map<string, { runId?: string; portas: number[] }>()
  redes = new Map<string, { runId?: string }>()
  montagens: Record<string, unknown>[] = []
  redesCriadas: { nome: string; labels: Record<string, string> }[] = []
  proxies: { nome: string; labels: Record<string, string> }[] = []
  containerSobe = true
  inspecao: EntradaDoScanner | undefined = SANDBOX_LIMPO
  chamadas: string[] = []

  disponivel = (): boolean => true
  portaOcupadaPorContainer = (): boolean => false
  portasEmUso = (): ReadonlySet<number> =>
    new Set([...this.containers.values()].flatMap((c) => c.portas))
  criarRedeDeEgress = (
    nome: string,
    _cwd: string,
    labels: Record<string, string> = {}
  ): boolean => {
    this.redesCriadas.push({ nome, labels })
    this.redes.set(nome, { runId: labels['jarvisos.run'] })
    return true
  }
  subirProxyDeEgress = (d: { nome: string; labels?: Record<string, string> }): boolean => {
    this.proxies.push({ nome: d.nome, labels: d.labels ?? {} })
    this.containers.set(d.nome, { runId: d.labels?.['jarvisos.run'], portas: [] })
    return true
  }
  ipDoProxyNaRedeDeEgress = (): string => '172.20.0.2'
  subir = (
    m: Record<string, unknown> & { containerNome: string; labels?: Record<string, string> }
  ): boolean => {
    this.montagens.push(m)
    if (!this.containerSobe) return false
    this.containers.set(m.containerNome, { runId: m.labels?.['jarvisos.run'], portas: [] })
    return true
  }
  parar = (nome: string): boolean => {
    this.chamadas.push(`parar:${nome}`)
    this.containers.delete(nome)
    return true
  }
  removerRede = (nome: string): boolean => {
    this.chamadas.push(`rede-rm:${nome}`)
    this.redes.delete(nome)
    return true
  }
  containerExiste = (nome: string): boolean => this.containers.has(nome)
  redeDeEgressExiste = (nome: string): boolean => this.redes.has(nome)
  listarGeridos = (): { containers: unknown[]; redes: unknown[] } => ({
    containers: [...this.containers].map(([nome, c]) => ({ nome, runId: c.runId })),
    redes: [...this.redes].map(([nome, r]) => ({ nome, runId: r.runId }))
  })
  inspecionarSandbox = (): EntradaDoScanner | undefined => this.inspecao
}

let dir: string
let db: Db
let docker: MundoDocker
let inventario: InstanceType<typeof InventarioRepository>
let leases: InstanceType<typeof LeaseRepository>
let worktrees: Set<string>
let perfis: string[]
let gitCalls: string[][]

function montar(): InstanceType<typeof PreflightService> {
  const audit = new AuditRepository(db, 'chave-de-teste')
  const git = {
    run: (args: readonly string[]) => {
      gitCalls.push([...args])
      if (args[0] === 'rev-parse') return { ok: true, saida: 'a'.repeat(40) }
      if (args[2] === 'worktree' && args[3] === 'add') worktrees.add(String(args[6]))
      if (args[0] === 'worktree' && args[1] === 'remove') worktrees.delete(String(args[2]))
      return { ok: true, saida: '' }
    }
  }
  const isolamento = new IsolamentoService({
    docker: docker as never,
    git,
    inventario,
    leases,
    ledger: new ExecutionLedgerRepository(db),
    audit,
    userId: () => USER,
    workspaceId: () => WS,
    runAtivo: () => false,
    worktreeExiste: (caminho) => worktrees.has(caminho),
    descartarArtefatos: vi.fn(),
    removerDiretorio: (caminho) => {
      perfis.splice(perfis.indexOf(caminho), 1)
    },
    portaLivreNoHost: () => true,
    cwd: () => '/raiz',
    agora: () => AGORA
  })
  return new PreflightService({
    git: git as never,
    docker: docker as never,
    leases,
    audit,
    userId: () => USER,
    workspaceId: () => WS,
    proxyNoAr: () => true,
    derivarPaths: () => undefined,
    modeloDaConstrucao: () => ({ provider: 'claude-code', modelo: 'claude-opus-5' }),
    prepararGitMeta: () => '/gitmeta',
    prepararPerfil: (caminho: string) => {
      perfis.push(caminho)
      return true
    },
    isolamento,
    agora: () => AGORA
  })
}

let preflight: ReturnType<typeof montar>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-pre-isol-'))
  db = openDatabase(join(dir, 'app.db'))
  docker = new MundoDocker()
  inventario = new InventarioRepository(db)
  leases = new LeaseRepository(db)
  worktrees = new Set()
  perfis = []
  gitCalls = []
  preflight = montar()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const pedido = (runId: string, extra: Record<string, unknown> = {}) => ({
  runId,
  projectId: 'p',
  sliceId: 'F03',
  raizOperacional: '/raiz',
  repositorio: '/repo',
  base: 'main',
  pathsDaSpec: PATHS,
  proxyUrl: 'http://host.docker.internal:9999',
  ...extra
})

const doRun = (runId: string) =>
  inventario.listarDoRun(USER, runId).map((r) => `${r.tipo}:${r.estado}`)

describe('recursos próprios e etiquetados', () => {
  it('registra worktree, branch, rede, sidecar, container e perfil, todos criados', () => {
    const r = preflight.preparar(pedido('run-a'))

    expect(r.reason).toBe('liberado')
    expect(doRun('run-a')).toEqual([
      'branch:criado',
      'worktree:criado',
      'rede:criado',
      'sidecar:criado',
      'perfil:criado',
      'container:criado'
    ])
  })

  it('o worktree do inventário guarda o repositório de onde a limpeza vai agir', () => {
    preflight.preparar(pedido('run-a'))

    expect(
      inventario.listarDoRun(USER, 'run-a').find((r) => r.tipo === 'worktree')?.detalhes
    ).toEqual({ repositorio: '/repo' })
  })

  it('container, rede e sidecar nascem com as labels do run', () => {
    preflight.preparar(pedido('run-a', { tentativa: 2 }))

    for (const labels of [
      docker.redesCriadas[0]?.labels,
      docker.proxies[0]?.labels,
      docker.montagens[0]?.['labels'] as Record<string, string>
    ]) {
      expect(labels).toMatchObject({
        'jarvisos.gerido': 'true',
        'jarvisos.run': 'run-a',
        'jarvisos.fatia': 'F03',
        'jarvisos.projeto': 'p',
        'jarvisos.tentativa': '2'
      })
    }
  })

  it('o container monta o perfil exclusivo do run', () => {
    preflight.preparar(pedido('run-a'))

    expect(docker.montagens[0]?.['perfilClaudeNoHost']).toBe(
      '/raiz/jarvisos-run-run-a-perfil/claude'
    )
    expect(perfis).toEqual(['/raiz/jarvisos-run-run-a-perfil'])
  })

  it('a branch é exclusiva por tentativa quando o run declara a tentativa', () => {
    const r = preflight.preparar(pedido('run-a', { tentativa: 2 }))

    expect(r.sandbox?.branch).toBe('feat/f03-run-a-t2')
  })

  it('sem tentativa a branch é a de sempre', () => {
    expect(preflight.preparar(pedido('run-a')).sandbox?.branch).toBe('feat/f03-run-a')
  })

  it('o sandbox devolve o perfil do run', () => {
    expect(preflight.preparar(pedido('run-a')).sandbox?.perfilClaudeNoHost).toBe(
      '/raiz/jarvisos-run-run-a-perfil/claude'
    )
  })
})

describe('duas fatias simultâneas', () => {
  it('têm paths, branches, containers, redes, perfis e leases distintos', () => {
    const a = preflight.preparar(pedido('run-a'))
    const b = preflight.preparar(pedido('run-b', { sliceId: 'F04' }))

    expect([a.reason, b.reason]).toEqual(['liberado', 'liberado'])
    const sa = a.sandbox!
    const sb = b.sandbox!
    expect(sa.worktreeNoHost).not.toBe(sb.worktreeNoHost)
    expect(sa.branch).not.toBe(sb.branch)
    expect(sa.containerNome).not.toBe(sb.containerNome)
    expect(sa.perfilClaudeNoHost).not.toBe(sb.perfilClaudeNoHost)
    expect(new Set(docker.redesCriadas.map((r) => r.nome)).size).toBe(2)
    expect(
      leases
        .listar(USER)
        .map((l) => l.proprietario)
        .sort()
    ).toEqual(['run-a', 'run-a', 'run-b', 'run-b'])
  })

  it('a colisão de branch entre runs é recusada antes de criar qualquer coisa do segundo', () => {
    // Os dois runs compartilham os oito primeiros caracteres: a branch coincide.
    expect(preflight.preparar(pedido('aaaaaaaa-1')).reason).toBe('liberado')

    const segundo = preflight.preparar(pedido('aaaaaaaa-2'))

    expect(segundo.reason).toBe('recurso-ocupado')
    expect(inventario.listarDoRun(USER, 'aaaaaaaa-2')).toEqual([])
    expect(docker.redes.has('jarvisos-egress-aaaaaaaa-2')).toBe(false)
    expect(worktrees.has('/raiz/jarvisos-run-aaaaaaaa-2')).toBe(false)
  })

  it('a porta declarada pelo projeto é de um run só', () => {
    expect(preflight.preparar(pedido('run-a', { portasDeServico: [20050] })).reason).toBe(
      'liberado'
    )

    const segundo = preflight.preparar(
      pedido('run-b', { sliceId: 'F04', portasDeServico: [20050] })
    )

    expect(segundo.reason).toBe('recurso-ocupado')
    expect(leases.buscar(USER, 'porta:20050')?.proprietario).toBe('run-a')
    expect(inventario.listarDoRun(USER, 'run-b')).toEqual([])
  })

  it('porta que um container de fora publica recusa o run', () => {
    docker.containers.set('de-fora', { portas: [20051] })

    const r = preflight.preparar(pedido('run-a', { portasDeServico: [20051] }))

    expect(r.reason).toBe('recurso-ocupado')
    expect(worktrees.size).toBe(0)
  })
})

describe('falha no meio da preparação', () => {
  it('container que não sobe: o que já nasceu é devolvido, sem órfão', () => {
    docker.containerSobe = false

    const r = preflight.preparar(pedido('run-a', { portasDeServico: [20052] }))

    expect(r.reason).toBe('docker-indisponivel')
    expect(docker.redes.size).toBe(0)
    expect(docker.containers.size).toBe(0)
    expect(worktrees.size).toBe(0)
    expect(inventario.listarAtivos(USER)).toEqual([])
    expect(leases.listar(USER)).toEqual([])
    expect(perfis).toEqual([])
  })

  it('a falha de um run não toca os recursos do outro', () => {
    preflight.preparar(pedido('run-a'))
    docker.containerSobe = false

    preflight.preparar(pedido('run-b', { sliceId: 'F04' }))

    expect(doRun('run-a')).toHaveLength(6)
    expect(docker.containers.has('jarvisos-run-run-a')).toBe(true)
    expect(docker.redes.has('jarvisos-egress-run-a')).toBe(true)
  })
})

describe('scanner de credenciais', () => {
  it('sandbox limpo é liberado, e o scanner foi consultado', () => {
    const r = preflight.preparar(pedido('run-a'))

    expect(r.reason).toBe('liberado')
  })

  it('credencial no container recusa o run e devolve os recursos', () => {
    docker.inspecao = { ...SANDBOX_LIMPO, env: [...SANDBOX_LIMPO.env, 'GITHUB_TOKEN=ghp_x'] }

    const r = preflight.preparar(pedido('run-a'))

    expect(r.reason).toBe('credencial-no-sandbox')
    expect(r.mensagem).toContain('GITHUB_TOKEN')
    expect(r.mensagem).not.toContain('ghp_x')
    expect(docker.containers.size).toBe(0)
    expect(inventario.listarAtivos(USER)).toEqual([])
  })

  it('não conseguir inspecionar também recusa: sem ver o container não há "limpo"', () => {
    docker.inspecao = undefined

    const r = preflight.preparar(pedido('run-a'))

    expect(r.reason).toBe('credencial-no-sandbox')
    expect(docker.containers.size).toBe(0)
  })
})
