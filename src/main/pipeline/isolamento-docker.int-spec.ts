/**
 * O isolamento por run contra o Docker **real** (SPEC-Scheduler-03).
 *
 * O dublê prova a decisão; só o Docker de verdade prova a mecânica: que a label chega ao
 * container, que `docker network rm` remove, que `docker ps -a` enxerga a porta de container
 * parado, que o `find` do scanner roda no container e que a reconciliação devolve só o que é do
 * run morto. Foi o que a memória do projeto cravou depois de a F04 do Squad passar 25 testes com
 * dublê e esconder dois defeitos.
 *
 * Mesmo padrão do `docker-egress.int-spec.ts`: no CI o daemon é obrigatório e a ausência é falha
 * alta; localmente, sem Docker, os testes pulam com motivo. Recursos levam prefixo `test-<uuid>` e
 * a imagem é a `alpine`, para não puxar centenas de MB.
 */

import { randomUUID } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@shared/domain/entities'
import { escanearSandbox, labelsDoRecurso } from '@shared/domain/isolamento'
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
const { DockerRunner, PERFIL_CLAUDE_NO_CONTAINER } = await import('./docker-runner')
const { IsolamentoService } = await import('./isolamento-service')
const { portaLivreNoHost } = await import('./isolamento-host')

const USER = 'u-1'
const WS: WorkspaceId = 'jarvis'
const IMAGEM = 'alpine:latest'
const SUFIXO = randomUUID().slice(0, 8)

function docker(args: readonly string[]): { readonly ok: boolean; readonly saida: string } {
  try {
    return { ok: true, saida: execFileSync('docker', [...args], { encoding: 'utf8' }) }
  } catch (erro) {
    return { ok: false, saida: erro instanceof Error ? erro.message : String(erro) }
  }
}

/** O `TerminalEngine` que executa de verdade, sem política: a política tem o teste dela. */
function terminalReal(): TerminalEngine {
  return {
    run: (submissao: { binary: string; args: readonly string[] }) => {
      const r = spawnSync(submissao.binary, [...submissao.args], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 120_000
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
let db: Db
let runner: InstanceType<typeof DockerRunner>
let servidores: Server[]
const criados = { containers: new Set<string>(), redes: new Set<string>() }

beforeAll(() => {
  dockerNoAr = docker(['info', '--format', '{{.ServerVersion}}']).ok
  if (!dockerNoAr && process.env.CI) {
    throw new Error(
      'Docker não respondeu. No CI o daemon é obrigatório — verifique o runner e o step do job.'
    )
  }
  if (dockerNoAr) docker(['pull', '--quiet', IMAGEM])
}, 180_000)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-isol-docker-'))
  db = openDatabase(join(dir, 'app.db'))
  runner = new DockerRunner(terminalReal(), () => WS)
  servidores = []
})

afterEach(async () => {
  await Promise.all(servidores.map((s) => new Promise((ok) => s.close(ok))))
  for (const c of criados.containers) docker(['rm', '--force', c])
  for (const r of criados.redes) docker(['network', 'rm', r])
  criados.containers.clear()
  criados.redes.clear()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

afterAll(() => {
  // Rede de sobra de um teste que morreu antes do `afterEach`: só as deste arquivo, pelo sufixo.
  const sobras = docker(['network', 'ls', '--format', '{{.Name}}']).saida.split('\n')
  for (const nome of sobras.filter((n) => n.includes(SUFIXO))) docker(['network', 'rm', nome])
})

const nome = (prefixo: string, run: string): string => `test-${prefixo}-${run}-${SUFIXO}`
const identidade = (run: string) => ({
  runId: `${run}-${SUFIXO}`,
  sliceId: 'F03',
  projectId: 'p',
  tentativa: 1
})

/** Sobe rede + container de um run pelo `DockerRunner` real, com labels e perfil exclusivo. */
function subirRun(run: string): { container: string; rede: string; perfil: string } {
  const id = identidade(run)
  const rede = nome('egress', run)
  const container = nome('run', run)
  const worktree = join(dir, `wt-${run}`)
  const gitMeta = join(dir, `gm-${run}`)
  const gitCommon = join(dir, `gc-${run}`)
  const perfil = join(dir, `perfil-${run}`, 'claude')
  for (const d of [worktree, gitMeta, gitCommon, perfil]) mkdirSync(d, { recursive: true })

  criados.redes.add(rede)
  criados.containers.add(container)
  expect(runner.criarRedeDeEgress(rede, dir, labelsDoRecurso(id))).toBe(true)
  expect(
    runner.subir(
      {
        worktreeNoHost: worktree,
        gitMetaNoHost: gitMeta,
        gitCommonNoHost: gitCommon,
        containerNome: container,
        redeDeEgress: rede,
        proxyUrl: 'http://172.20.0.2:8080',
        imagem: IMAGEM,
        labels: labelsDoRecurso(id),
        perfilClaudeNoHost: perfil
      },
      dir
    )
  ).toBe(true)
  return { container, rede, perfil }
}

describe('labels e posse com o Docker real', () => {
  it('container e rede aparecem na listagem com o run de cada um', async ({ skip }) => {
    skip(!dockerNoAr, 'Docker fora do ar')
    const a = subirRun('a')
    const b = subirRun('b')

    const geridos = runner.listarGeridos(dir)

    expect(geridos?.containers).toEqual(
      expect.arrayContaining([
        { nome: a.container, runId: identidade('a').runId },
        { nome: b.container, runId: identidade('b').runId }
      ])
    )
    expect(geridos?.redes).toEqual(
      expect.arrayContaining([
        { nome: a.rede, runId: identidade('a').runId },
        { nome: b.rede, runId: identidade('b').runId }
      ])
    )
  }, 120_000)

  it('docker network rm remove a rede que ficou sem container', async ({ skip }) => {
    skip(!dockerNoAr, 'Docker fora do ar')
    const a = subirRun('rm')
    expect(runner.parar(a.container, dir)).toBe(true)

    expect(runner.removerRede(a.rede, dir)).toBe(true)

    expect(runner.redeDeEgressExiste(a.rede, dir)).toBe(false)
    criados.redes.delete(a.rede)
  }, 120_000)

  it('rede com container conectado não é removida: o Docker recusa e o método diz false', async ({
    skip
  }) => {
    skip(!dockerNoAr, 'Docker fora do ar')
    const a = subirRun('ocupada')

    expect(runner.removerRede(a.rede, dir)).toBe(false)
    expect(runner.redeDeEgressExiste(a.rede, dir)).toBe(true)
  }, 120_000)
})

describe('portas com o Docker real', () => {
  it('vê a porta publicada agora e a configurada em container parado', async ({ skip }) => {
    skip(!dockerNoAr, 'Docker fora do ar')
    const publicada = nome('pub', 'x')
    const parado = nome('par', 'x')
    criados.containers.add(publicada).add(parado)
    expect(
      docker(['run', '-d', '--name', publicada, '-p', '127.0.0.1:20501:80', IMAGEM, 'sleep', '300'])
        .ok
    ).toBe(true)
    expect(
      docker(['create', '--name', parado, '-p', '127.0.0.1:20502:80', IMAGEM, 'true']).ok
    ).toBe(true)

    const emUso = runner.portasEmUso(dir)

    expect(emUso?.has(20501)).toBe(true)
    // O `docker ps` sozinho não vê esta: o container nem rodou. É o que "configurada" quer dizer.
    expect(emUso?.has(20502)).toBe(true)
  }, 120_000)

  it('dois runs recebem portas distintas e nenhuma é a de um container existente', async ({
    skip
  }) => {
    skip(!dockerNoAr, 'Docker fora do ar')
    const ocupante = nome('ocupa', 'x')
    criados.containers.add(ocupante)
    docker(['run', '-d', '--name', ocupante, '-p', '127.0.0.1:20000:80', IMAGEM, 'sleep', '300'])
    const servico = montarServico()

    const a = servico.alocarPorta(identidade('pa'))
    const b = servico.alocarPorta(identidade('pb'))

    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.porta).not.toBe(b.porta)
      expect([a.porta, b.porta]).not.toContain(20000)
    }
  }, 120_000)

  it('pula a porta que um processo do host escuta', async ({ skip }) => {
    skip(!dockerNoAr, 'Docker fora do ar')
    const servidor = createServer()
    servidores.push(servidor)
    await new Promise<void>((ok) => servidor.listen(20000, '127.0.0.1', ok))

    const r = montarServico().alocarPorta(identidade('ph'))

    expect(r.ok && r.porta !== 20000).toBe(true)
  }, 120_000)
})

describe('scanner com o Docker real', () => {
  it('o sandbox que o DockerRunner monta está limpo', async ({ skip }) => {
    skip(!dockerNoAr, 'Docker fora do ar')
    const a = subirRun('limpo')

    const entrada = runner.inspecionarSandbox(a.container, dir)

    expect(entrada).toBeDefined()
    expect(entrada?.montagens.map((m) => m.destino)).toEqual(
      expect.arrayContaining(['/work', PERFIL_CLAUDE_NO_CONTAINER])
    )
    expect(entrada && escanearSandbox(entrada)).toEqual([])
  }, 120_000)

  it('acha credencial em variável de ambiente e em arquivo dentro do container', async ({
    skip
  }) => {
    skip(!dockerNoAr, 'Docker fora do ar')
    const sujo = nome('sujo', 'x')
    criados.containers.add(sujo)
    expect(
      docker([
        'run',
        '-d',
        '--name',
        sujo,
        '--env',
        'GITHUB_TOKEN=ghp_nao_vaza_este_valor',
        IMAGEM,
        'sleep',
        '300'
      ]).ok
    ).toBe(true)
    docker(['exec', sujo, 'sh', '-c', 'echo registry=x > /root/.npmrc'])

    const entrada = runner.inspecionarSandbox(sujo, dir)
    const achados = entrada === undefined ? [] : escanearSandbox(entrada)

    expect(achados.map((a) => `${a.origem}:${a.referencia}`)).toEqual(
      expect.arrayContaining(['env:GITHUB_TOKEN', 'arquivo:/root/.npmrc'])
    )
    expect(JSON.stringify(achados)).not.toContain('ghp_nao_vaza_este_valor')
  }, 120_000)

  it('container inexistente é indeterminado, não limpo', async ({ skip }) => {
    skip(!dockerNoAr, 'Docker fora do ar')

    expect(runner.inspecionarSandbox(`test-nao-existe-${SUFIXO}`, dir)).toBeUndefined()
  }, 60_000)
})

function montarServico(
  runAtivo: (runId: string) => boolean = () => false
): InstanceType<typeof IsolamentoService> {
  return new IsolamentoService({
    docker: runner,
    git: { run: () => ({ ok: true }) },
    inventario: new InventarioRepository(db),
    leases: new LeaseRepository(db),
    ledger: new ExecutionLedgerRepository(db),
    audit: new AuditRepository(db, 'chave-de-teste'),
    userId: () => USER,
    workspaceId: () => WS,
    runAtivo,
    worktreeExiste: () => false,
    descartarArtefatos: () => undefined,
    removerDiretorio: () => undefined,
    portaLivreNoHost,
    cwd: () => dir,
    faixa: { inicio: 20000, fim: 20050 }
  })
}

describe('crash e reconciliação com o Docker real', () => {
  it('devolve os recursos do run morto, e o run ativo continua inteiro', async ({ skip }) => {
    skip(!dockerNoAr, 'Docker fora do ar')
    const servico = montarServico((runId) => runId === identidade('vivo').runId)
    const morto = subirRun('morto')
    const vivo = subirRun('vivo')
    for (const [run, r] of [
      ['morto', morto],
      ['vivo', vivo]
    ] as const) {
      const id = identidade(run)
      servico.confirmar(servico.planejar(id, 'rede', r.rede)!.id)
      servico.confirmar(servico.planejar(id, 'container', r.container)!.id)
    }

    // O "crash": nada foi limpo. Uma instância nova de serviço é o app reabrindo.
    const achados = await montarServico((runId) => runId === identidade('vivo').runId).reconciliar()

    expect(achados.find((a) => a.recurso === `run:${identidade('morto').runId}`)?.decisao).toBe(
      'liberado'
    )
    expect(runner.containerExiste(morto.container, dir)).toBe(false)
    expect(runner.redeDeEgressExiste(morto.rede, dir)).toBe(false)
    expect(runner.containerExiste(vivo.container, dir)).toBe(true)
    expect(runner.redeDeEgressExiste(vivo.rede, dir)).toBe(true)
    criados.redes.delete(morto.rede)
    criados.containers.delete(morto.container)
  }, 180_000)

  it('recurso gerido sem registro é reportado e fica intacto', async ({ skip }) => {
    skip(!dockerNoAr, 'Docker fora do ar')
    const orfao = subirRun('orfao')

    const achados = await montarServico().reconciliar()

    expect(achados.map((a) => a.recurso)).toEqual(
      expect.arrayContaining([`container:${orfao.container}`, `rede:${orfao.rede}`])
    )
    expect(runner.containerExiste(orfao.container, dir)).toBe(true)
    expect(runner.redeDeEgressExiste(orfao.rede, dir)).toBe(true)
  }, 120_000)
})
