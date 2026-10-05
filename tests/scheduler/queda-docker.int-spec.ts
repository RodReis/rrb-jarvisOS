/**
 * A recuperação por run contra o Docker **real** (SPEC-Scheduler-05, PR-C — critérios 4 e 6).
 *
 * O dublê prova a decisão; só o Docker de verdade prova a mecânica: que o container do sandbox
 * (`sleep infinity`, detached) **continua de pé** depois que o app cai, que a label o liga ao run,
 * que o observador o enxerga, e que a recuperação o devolve sem tocar no do vizinho. Mesmo padrão do
 * `isolamento-docker.int-spec.ts`: no CI o daemon é obrigatório; localmente, sem Docker, os testes
 * pulam com motivo.
 *
 * `FilaService`, `PoolService` e `RecuperacaoService` são os reais, sobre SQLite real, e o
 * isolamento é o `IsolamentoService` real com o `DockerRunner` real — a composição do `index.ts`.
 */

import { randomUUID } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Approval, RevisaoAprovada } from '@shared/domain/aprovacoes'
import type { WorkspaceId } from '@shared/domain/entities'
import { VALIDADE_DO_LEASE_MS } from '@shared/domain/lease'
import { labelsDoRecurso } from '@shared/domain/isolamento'
import type { Mvp, Slice } from '@shared/domain/roadmap'
import type { TerminalEngine } from '../../src/main/execution/terminal-engine'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../../src/main/logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn(),
  writeLog: vi.fn()
}))

const { openDatabase } = await import('../../src/main/storage/database')
const { AuditRepository } = await import('../../src/main/storage/audit-repository')
const { LeaseRepository } = await import('../../src/main/pipeline/lease-repository')
const { InventarioRepository } = await import('../../src/main/pipeline/inventario-repository')
const { ExecutionLedgerRepository } =
  await import('../../src/main/pipeline/execution-ledger-repository')
const { DockerRunner } = await import('../../src/main/pipeline/docker-runner')
const { IsolamentoService } = await import('../../src/main/pipeline/isolamento-service')
const { portaLivreNoHost } = await import('../../src/main/pipeline/isolamento-host')
const { PipelineRepository } = await import('../../src/main/pipeline/pipeline-repository')
const { FilaService } = await import('../../src/main/pipeline/fila-service')
const { PoolRepository } = await import('../../src/main/pipeline/pool-repository')
const { PoolService } = await import('../../src/main/pipeline/pool-service')
const { RecuperacaoService } = await import('../../src/main/pipeline/recuperacao-service')
const { observadorDeExecutor } = await import('../../src/main/pipeline/verificadores-de-sandbox')
const { CONFIG_PADRAO } = await import('@shared/domain/pool')

const USER = 'u-1'
const WS: WorkspaceId = 'jarvis'
const IMAGEM = 'alpine:latest'
const SUFIXO = randomUUID().slice(0, 8)
const AGORA = 1_700_000_000_000

const origem: Mvp['origem'] = { tipo: 'decisao', decisaoId: 'd-1', perguntaId: 'p-1' }
const IDS = ['f1', 'f2'] as const
const MVPS: readonly Mvp[] = IDS.map((id, i) => ({
  id: `m-${id}`,
  numero: i + 1,
  titulo: `MVP ${i + 1}`,
  tese: 't',
  estado: 'na-fila',
  dependeDe: [],
  origem
}))
const SLICES: readonly Slice[] = IDS.map((id) => ({
  id,
  mvpId: `m-${id}`,
  numero: 1,
  titulo: id,
  specSlug: 'spec-f1',
  detalhada: true,
  origem
}))
const REVISOES: readonly RevisaoAprovada[] = [{ artefato: 'spec-f1', hash: 'h-1' }]
const aprovacao = (projectId: string): Approval => ({
  id: `a-${projectId}`,
  user_id: USER,
  workspace_id: WS,
  projectId,
  gate: 'SLICE_ENTRY',
  revisoes: REVISOES,
  identidade: 'sessao-1',
  autor: 'pi',
  created_at: new Date(AGORA).toISOString()
})

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
let relogio: number
let runner: InstanceType<typeof DockerRunner>
let runs: InstanceType<typeof PipelineRepository>
let leases: InstanceType<typeof LeaseRepository>
let fila: InstanceType<typeof FilaService>
let isolamento: InstanceType<typeof IsolamentoService>
let recuperacao: InstanceType<typeof RecuperacaoService>
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
  dir = mkdtempSync(join(tmpdir(), 'jarvis-queda-docker-'))
  db = openDatabase(join(dir, 'app.db'))
  relogio = AGORA
  runner = new DockerRunner(terminalReal(), () => WS)
  runs = new PipelineRepository(db)
  leases = new LeaseRepository(db)
  const audit = new AuditRepository(db, 'chave-de-teste')

  const pool = new PoolService({
    db,
    pool: new PoolRepository(db),
    leases,
    audit,
    userId: () => USER,
    workspaceId: () => WS,
    gates: (item) => fila.gatesDoItem(item),
    ativar: (item) => fila.ativarRun(item),
    prova: () => true,
    agora: () => relogio
  })
  pool.configurar({ ...CONFIG_PADRAO, paralelismo: true, capacidadeGlobal: 2, maxPorProjeto: 2 })
  fila = new FilaService({
    runs,
    pool,
    workspaceId: () => WS,
    audit,
    roadmap: () => ({ mvps: MVPS, slices: SLICES }),
    aprovacoes: (escopo) => [aprovacao(escopo.projectId)],
    revisoesDoGate: () => REVISOES,
    userId: () => USER,
    mergeAutonomoLigado: () => true,
    transacao: (fn) => db.transaction(fn)(),
    emTransacao: () => db.inTransaction,
    aoEncerrarSemConclusao: (runId) => void recuperacao.recolher(runId),
    agora: () => relogio
  })
  // Como no `index.ts`: o inventário e a posse pela label, com o Docker real.
  isolamento = new IsolamentoService({
    docker: runner,
    git: { run: () => ({ ok: true }) },
    inventario: new InventarioRepository(db),
    leases,
    ledger: new ExecutionLedgerRepository(db),
    audit,
    userId: () => USER,
    workspaceId: () => WS,
    // Run **ativo** é o que o banco diz: o run que caiu ainda consta como ativo, e é por isso que
    // o isolamento sozinho não o toca.
    runAtivo: (runId) => runs.listarAtivos(USER).some((r) => r.id === runId),
    worktreeExiste: () => false,
    descartarArtefatos: () => undefined,
    prepararPerfil: () => true,
    removerDiretorio: () => undefined,
    portaLivreNoHost,
    cwd: () => dir,
    faixa: { inicio: 20100, fim: 20150 }
  })
  recuperacao = new RecuperacaoService({
    runs,
    leases,
    pool,
    fila,
    audit,
    userId: () => USER,
    isolamento,
    executor: observadorDeExecutor(runner, () => dir),
    mergeEmCurso: () => false,
    renovacaoGarantida: true,
    agora: () => relogio
  })
})

afterEach(() => {
  for (const c of criados.containers) docker(['rm', '--force', c])
  for (const r of criados.redes) docker(['network', 'rm', r])
  criados.containers.clear()
  criados.redes.clear()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

afterAll(() => {
  // Sobra de um teste que morreu antes do `afterEach`: só o que é deste arquivo, pelo sufixo.
  const linhas = (args: readonly string[]): string[] =>
    docker(args)
      .saida.split('\n')
      .map((l) => l.trim())
      .filter((l) => l.endsWith(`-${SUFIXO}`))
  for (const nome of linhas(['ps', '-a', '--format', '{{.Names}}'])) docker(['rm', '--force', nome])
  for (const nome of linhas(['network', 'ls', '--format', '{{.Name}}']))
    docker(['network', 'rm', nome])
})

/** Um run em `RUNNING` com slot e com container e rede **reais**, como o preflight os deixa. */
function executando(sliceId: string): { runId: string; container: string; rede: string } {
  const run = fila.criarRun('p-a', WS, sliceId)
  fila.transicionar('p-a', WS, run.id, 'AWAITING_PI')
  fila.transicionar('p-a', WS, run.id, 'READY')
  expect(fila.adquirirSlot('p-a', WS, run.id).reason).toBe('adquirido')

  const identidade = { runId: run.id, sliceId, projectId: 'p-a', tentativa: 1 }
  const container = `test-run-${run.id.slice(0, 8)}-${SUFIXO}`
  const rede = `test-egress-${run.id.slice(0, 8)}-${SUFIXO}`
  const worktree = join(dir, `wt-${sliceId}`)
  const gitMeta = join(dir, `gm-${sliceId}`)
  const gitCommon = join(dir, `gc-${sliceId}`)
  const perfil = join(dir, `perfil-${sliceId}`, 'claude')
  for (const d of [worktree, gitMeta, gitCommon, perfil]) mkdirSync(d, { recursive: true })
  writeFileSync(join(gitCommon, 'config'), '[core]\n\tbare = false\n')

  criados.redes.add(rede)
  criados.containers.add(container)
  expect(runner.criarRedeDeEgress(rede, dir, labelsDoRecurso(identidade))).toBe(true)
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
        labels: labelsDoRecurso(identidade),
        perfilClaudeNoHost: perfil
      },
      dir
    )
  ).toBe(true)
  isolamento.confirmar(isolamento.planejar(identidade, 'rede', rede)!.id)
  isolamento.confirmar(isolamento.planejar(identidade, 'container', container)!.id)
  return { runId: run.id, container, rede }
}

const estado = (runId: string): string | undefined => runs.buscar(runId)?.estado
const slotDe = (runId: string): unknown => leases.buscarSlotDoRun(USER, runId)

describe('critério 4 e 6 — cancelar uma fatia com o Docker real', () => {
  it('o container e a rede do cancelado somem; os do vizinho seguem de pé, com o slot dele', async ({
    skip
  }) => {
    skip(!dockerNoAr, 'Docker fora do ar')
    const a = executando('f1')
    const b = executando('f2')

    expect(fila.transicionar('p-a', WS, a.runId, 'CANCELLED').reason).toBe('transicionado')

    expect(runner.containerExiste(a.container, dir)).toBe(false)
    expect(runner.redeDeEgressExiste(a.rede, dir)).toBe(false)
    criados.containers.delete(a.container)
    criados.redes.delete(a.rede)
    expect(slotDe(a.runId)).toBeUndefined()

    expect(estado(b.runId)).toBe('RUNNING')
    expect(runner.containerExiste(b.container, dir)).toBe(true)
    expect(runner.redeDeEgressExiste(b.rede, dir)).toBe(true)
    expect(slotDe(b.runId)).toBeDefined()
  }, 180_000)
})

describe('critério 3 e 6 — o app cai com dois runs vivos e o container do Docker continua de pé', () => {
  it('o boot recupera os dois: bloqueia com a ação de retomada, remove container e rede, devolve o slot', async ({
    skip
  }) => {
    skip(!dockerNoAr, 'Docker fora do ar')
    const a = executando('f1')
    const b = executando('f2')
    // O container sobrevive à queda do app: é `sleep infinity`, detached. Quem o removeria?
    expect(runner.containerExiste(a.container, dir)).toBe(true)

    // O app cai, o tempo passa, o app sobe.
    relogio += VALIDADE_DO_LEASE_MS + 1
    recuperacao.supervisionar({ aoSubir: true })

    for (const r of [a, b]) {
      expect(estado(r.runId)).toBe('BLOCKED')
      expect(slotDe(r.runId)).toBeUndefined()
      expect(runner.containerExiste(r.container, dir)).toBe(false)
      expect(runner.redeDeEgressExiste(r.rede, dir)).toBe(false)
      criados.containers.delete(r.container)
      criados.redes.delete(r.rede)
    }
  }, 240_000)
})
