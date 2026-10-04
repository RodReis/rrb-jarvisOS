/**
 * Duas fatias concorrentes, com Git, Docker e SQLite **reais** (SPEC-Scheduler-03, critérios 1, 2,
 * 3, 4 e 5): o preflight de verdade prepara dois runs, o executor "escreve" num deles, o app
 * "cai", e a reconciliação devolve só o que é do run morto.
 *
 * É a prova que o dublê não dá: a mudança num worktree **não aparece** no outro nem no checkout
 * do usuário (conferido por `git status` e por `docker exec`), as portas são exclusivas, o scanner
 * olha o container que o Docker realmente criou, e o inventário volta a zero sem órfão no Docker
 * nem no Git.
 *
 * Mesmo padrão do `docker-egress.int-spec.ts`: no CI o daemon é obrigatório; localmente, sem
 * Docker, pula com motivo. O sandbox roda na `alpine` (poucos MB) e o sidecar na imagem pinada.
 */

import { randomUUID } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@shared/domain/entities'
import type { PathsPermitidos } from '@shared/domain/preflight'
import type { TerminalEngine } from '../execution/terminal-engine'

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
const { DockerRunner, IMAGEM_DO_PROXY_DE_EGRESS, prepararGitMeta } = await import('./docker-runner')
const { IsolamentoService } = await import('./isolamento-service')
const { PreflightService } = await import('./preflight-service')
const { descartarArtefatosDoSandbox, portaLivreNoHost, prepararPerfil, removerPerfil } =
  await import('./isolamento-host')

const USER = 'u-1'
const WS: WorkspaceId = 'jarvis'
const IMAGEM = 'alpine:latest'
const SUFIXO = randomUUID().slice(0, 8)
const PATHS: PathsPermitidos = { paths: ['src'], origem: 'spec', justificativa: 'teste' }

function docker(args: readonly string[]): { readonly ok: boolean; readonly saida: string } {
  try {
    return { ok: true, saida: execFileSync('docker', [...args], { encoding: 'utf8' }) }
  } catch (erro) {
    return { ok: false, saida: erro instanceof Error ? erro.message : String(erro) }
  }
}

function git(args: readonly string[], cwd: string): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim()
}

/** O `GitRunner` que executa `git` de verdade: o que se mede é o resultado no disco. */
const gitReal = {
  run: (args: readonly string[], cwd: string): { ok: boolean; saida: string } => {
    try {
      return { ok: true, saida: git(args, cwd) }
    } catch {
      return { ok: false, saida: '' }
    }
  }
}

function terminalReal(): TerminalEngine {
  return {
    run: (s: { binary: string; args: readonly string[] }) => {
      const r = spawnSync(s.binary, [...s.args], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 180_000
      })
      const ok = r.status === 0
      return {
        id: 'x',
        state: ok ? 'concluido' : 'falhou',
        reason: ok ? 'executado' : 'falha-na-execucao',
        stdout: r.stdout ?? '',
        stderr: r.stderr ?? '',
        exitCode: r.status,
        durationMs: 1
      }
    }
  } as unknown as TerminalEngine
}

let dockerNoAr = false
let dir: string
let repo: string
let raiz: string
let db: Db
let runner: InstanceType<typeof DockerRunner>
let ativos: Set<string>

beforeAll(() => {
  dockerNoAr = docker(['info', '--format', '{{.ServerVersion}}']).ok
  if (!dockerNoAr && process.env.CI) {
    throw new Error(
      'Docker não respondeu. No CI o daemon é obrigatório — verifique o runner e o step do job.'
    )
  }
  if (dockerNoAr) {
    docker(['pull', '--quiet', IMAGEM])
    docker(['pull', '--quiet', IMAGEM_DO_PROXY_DE_EGRESS])
  }
}, 240_000)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-concorrente-'))
  repo = join(dir, 'projeto')
  raiz = join(dir, 'operacional')
  mkdirSync(raiz)
  execFileSync('git', ['init', '--initial-branch=main', repo], { encoding: 'utf8' })
  git(['config', 'user.email', 'teste@exemplo.com'], repo)
  git(['config', 'user.name', 'Teste'], repo)
  git(['config', 'core.autocrlf', 'false'], repo)
  mkdirSync(join(repo, 'src'))
  writeFileSync(join(repo, 'src', 'index.ts'), 'export {}\n')
  git(['add', '.'], repo)
  git(['commit', '-m', 'inicial'], repo)

  db = openDatabase(join(dir, 'app.db'))
  runner = new DockerRunner(terminalReal(), () => WS)
  ativos = new Set()
})

afterEach(() => {
  // Limpeza do que o teste criou: containers, redes e worktrees deste sufixo.
  const nomes = docker(['ps', '-a', '--format', '{{.Names}}']).saida.split('\n')
  for (const n of nomes.filter((x) => x.includes(SUFIXO))) docker(['rm', '--force', n])
  const redes = docker(['network', 'ls', '--format', '{{.Name}}']).saida.split('\n')
  for (const n of redes.filter((x) => x.includes(SUFIXO))) docker(['network', 'rm', n])
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

afterAll(() => {
  const redes = docker(['network', 'ls', '--format', '{{.Name}}']).saida.split('\n')
  for (const n of redes.filter((x) => x.includes(SUFIXO))) docker(['network', 'rm', n])
})

function montarIsolamento(
  runAtivo: (runId: string) => boolean = (runId) => ativos.has(runId)
): InstanceType<typeof IsolamentoService> {
  return new IsolamentoService({
    docker: runner,
    git: gitReal,
    inventario: new InventarioRepository(db),
    leases: new LeaseRepository(db),
    ledger: new ExecutionLedgerRepository(db),
    audit: new AuditRepository(db, 'chave-de-teste'),
    userId: () => USER,
    workspaceId: () => WS,
    runAtivo,
    worktreeExiste: existsSync,
    descartarArtefatos: descartarArtefatosDoSandbox,
    prepararPerfil,
    removerDiretorio: removerPerfil,
    portaLivreNoHost,
    cwd: () => raiz,
    faixa: { inicio: 20300, fim: 20399 }
  })
}

function montarPreflight(isolamento = montarIsolamento()): InstanceType<typeof PreflightService> {
  return new PreflightService({
    git: gitReal as never,
    docker: runner,
    leases: new LeaseRepository(db),
    audit: new AuditRepository(db, 'chave-de-teste'),
    userId: () => USER,
    workspaceId: () => WS,
    proxyNoAr: () => true,
    derivarPaths: () => undefined,
    modeloDaConstrucao: () => ({ provider: 'claude-code', modelo: 'claude-opus-5' }),
    prepararGitMeta,
    isolamento,
    imagemDoSandbox: IMAGEM
  })
}

const pedido = (run: string, slice: string, extra: Record<string, unknown> = {}) => ({
  runId: `${run}-${SUFIXO}`,
  projectId: 'p',
  sliceId: slice,
  raizOperacional: raiz,
  repositorio: repo,
  base: 'main',
  pathsDaSpec: PATHS,
  proxyUrl: 'host.docker.internal:9',
  ...extra
})

const emExecucao = (container: string): boolean =>
  docker(['ps', '--filter', `name=^${container}$`, '--format', '{{.Names}}']).saida.trim() ===
  container

describe('duas fatias concorrentes com infra real', () => {
  it('têm worktree, branch, container, rede, porta e perfil próprios, e a mudança de uma não vaza', async ({
    skip
  }) => {
    skip(!dockerNoAr, 'Docker fora do ar')
    const preflight = montarPreflight()

    const a = preflight.preparar(pedido('a', 'F03', { portasDeServico: [20301] }))
    const b = preflight.preparar(pedido('b', 'F04', { portasDeServico: [20302] }))

    expect([a.reason, b.reason]).toEqual(['liberado', 'liberado'])
    const sa = a.sandbox!
    const sb = b.sandbox!

    // Critério 1: tudo distinto.
    expect(new Set([sa.worktreeNoHost, sb.worktreeNoHost]).size).toBe(2)
    expect(new Set([sa.branch, sb.branch]).size).toBe(2)
    expect(new Set([sa.containerNome, sb.containerNome]).size).toBe(2)
    expect(new Set([sa.perfilClaudeNoHost, sb.perfilClaudeNoHost]).size).toBe(2)
    expect(emExecucao(sa.containerNome) && emExecucao(sb.containerNome)).toBe(true)
    const redes = docker([
      'network',
      'ls',
      '--filter',
      'label=jarvisos.gerido=true',
      '--format',
      '{{.Name}}'
    ])
    expect(redes.saida.split('\n').filter((n) => n.includes(SUFIXO))).toHaveLength(2)

    // Critério 2: o executor escreve em A; B e o checkout do usuário não veem.
    writeFileSync(join(sa.worktreeNoHost, 'src', 'so-no-a.ts'), 'export const a = 1\n')
    expect(git(['status', '--porcelain', '--', 'src'], sa.worktreeNoHost)).toContain('so-no-a.ts')
    expect(git(['status', '--porcelain'], sb.worktreeNoHost)).not.toContain('so-no-a.ts')
    expect(git(['status', '--porcelain'], repo)).toBe('')
    expect(docker(['exec', sa.containerNome, 'ls', '/work/src']).saida).toContain('so-no-a.ts')
    expect(docker(['exec', sb.containerNome, 'ls', '/work/src']).saida).not.toContain('so-no-a.ts')

    // Critério 3: a porta de um é exclusiva — o outro run não a toma.
    const c = preflight.preparar(pedido('c', 'F05', { portasDeServico: [20301] }))
    expect(c.reason).toBe('recurso-ocupado')
    expect(docker(['ps', '-a', '--format', '{{.Names}}']).saida).not.toContain(
      `jarvisos-run-c-${SUFIXO}`
    )

    // Critério 4: o scanner olha o container que o Docker de fato criou, nos dois.
    const isolamento = montarIsolamento()
    expect(isolamento.escanear(sa.containerNome).estado).toBe('limpo')
    expect(isolamento.escanear(sb.containerNome).estado).toBe('limpo')
  }, 300_000)

  it('crash: a reconciliação devolve o run morto, preserva o trabalho na branch e não toca o outro', async ({
    skip
  }) => {
    skip(!dockerNoAr, 'Docker fora do ar')
    const preflight = montarPreflight()
    const a = preflight.preparar(pedido('a', 'F03', { portasDeServico: [20301] }))
    const b = preflight.preparar(pedido('b', 'F04', { portasDeServico: [20302] }))
    expect([a.reason, b.reason]).toEqual(['liberado', 'liberado'])
    const sa = a.sandbox!
    const sb = b.sandbox!

    // O kernel commita o trabalho do run A na branch dele, e então o app cai.
    writeFileSync(join(sa.worktreeNoHost, 'src', 'so-no-a.ts'), 'export const a = 1\n')
    git(['add', 'src/so-no-a.ts'], sa.worktreeNoHost)
    git(['commit', '-m', 'trabalho do A'], sa.worktreeNoHost)
    ativos.add(`b-${SUFIXO}`)

    // Uma instância nova de serviço é o app reabrindo.
    const achados = await montarIsolamento().reconciliar()

    expect(achados.find((x) => x.recurso === `run:a-${SUFIXO}`)?.decisao).toBe('liberado')
    expect(achados.find((x) => x.recurso === `run:b-${SUFIXO}`)?.decisao).toBe('bloqueado')

    // O run A: sem container, sem rede, sem worktree, sem perfil, sem lease nem inventário.
    expect(emExecucao(sa.containerNome)).toBe(false)
    expect(existsSync(sa.worktreeNoHost)).toBe(false)
    expect(existsSync(sa.perfilClaudeNoHost ?? '')).toBe(false)
    expect(git(['worktree', 'list'], repo)).not.toContain(sa.worktreeNoHost.replace(/\\/g, '/'))
    const inventario = new InventarioRepository(db)
    expect(inventario.listarDoRun(USER, `a-${SUFIXO}`)).toEqual([])
    expect(new LeaseRepository(db).buscar(USER, 'porta:20301')).toBeUndefined()

    // O trabalho não se perdeu: a branch continua e traz o commit.
    expect(git(['log', '--oneline', sa.branch], repo)).toContain('trabalho do A')

    // O run B: inteiro, em execução, com tudo no inventário.
    expect(emExecucao(sb.containerNome)).toBe(true)
    expect(existsSync(sb.worktreeNoHost)).toBe(true)
    expect(inventario.listarDoRun(USER, `b-${SUFIXO}`).length).toBeGreaterThan(0)
    expect(new LeaseRepository(db).buscar(USER, 'porta:20302')?.proprietario).toBe(`b-${SUFIXO}`)
  }, 300_000)

  it('trabalho não registrado segura o worktree: vira pendência, o resto é devolvido', async ({
    skip
  }) => {
    skip(!dockerNoAr, 'Docker fora do ar')
    const a = montarPreflight().preparar(pedido('a', 'F03', { portasDeServico: [20301] }))
    expect(a.reason).toBe('liberado')
    const sa = a.sandbox!
    // Arquivo que o kernel não registrou: o `git worktree remove` sem --force o recusa.
    writeFileSync(join(sa.worktreeNoHost, 'src', 'rascunho.ts'), 'nao commitado\n')

    const r = montarIsolamento().liberarRun(`a-${SUFIXO}`)

    expect(r.pendencias.map((p) => p.recurso)).toEqual(['worktree'])
    expect(existsSync(join(sa.worktreeNoHost, 'src', 'rascunho.ts'))).toBe(true)
    expect(emExecucao(sa.containerNome)).toBe(false)
    expect(
      docker(['network', 'ls', '--format', '{{.Name}}'])
        .saida.split('\n')
        .filter((n) => n.includes(SUFIXO))
    ).toEqual([])
  }, 300_000)

  it('inventário antes e depois: nenhum órfão no Docker, no Git nem no banco', async ({ skip }) => {
    skip(!dockerNoAr, 'Docker fora do ar')
    const preflight = montarPreflight()
    expect(preflight.preparar(pedido('a', 'F03')).reason).toBe('liberado')
    expect(preflight.preparar(pedido('b', 'F04')).reason).toBe('liberado')
    const inventario = new InventarioRepository(db)
    expect(inventario.listarAtivos(USER).length).toBeGreaterThanOrEqual(12)

    await montarIsolamento(() => false).reconciliar()

    expect(inventario.listarAtivos(USER)).toEqual([])
    expect(
      docker(['ps', '-a', '--format', '{{.Names}}'])
        .saida.split('\n')
        .filter((n) => n.includes(SUFIXO))
    ).toEqual([])
    expect(
      docker(['network', 'ls', '--format', '{{.Name}}'])
        .saida.split('\n')
        .filter((n) => n.includes(SUFIXO))
    ).toEqual([])
    expect(git(['worktree', 'list', '--porcelain'], repo).match(/^worktree /gm)).toHaveLength(1)
    expect(new LeaseRepository(db).listar(USER)).toEqual([])
  }, 300_000)
})
