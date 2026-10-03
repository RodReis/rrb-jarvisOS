/**
 * O executor do escritor isolado (SPEC-Squads-03, critérios 1, 2, 4, 5 e 6), de ponta a ponta no que
 * importa: **Git real** pelo `TerminalEngine` real, **pool real** (slots e fencing), **auditoria
 * real**. O agente é falso, mas escreve **de verdade** no worktree do host — a prova de escopo só
 * significa algo se o diff vier de arquivos de verdade.
 */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Approval, RevisaoAprovada } from '@shared/domain/aprovacoes'
import type { ContextPack } from '@shared/domain/context-pack'
import { CONFIG_PADRAO } from '@shared/domain/pool'
import type { Mvp, Slice } from '@shared/domain/roadmap'
import { idDoEscritor } from '@shared/domain/squad-execucao'
import type { FonteDaTarefa } from '../context/context-service'
import type {
  PedidoAoAgente,
  PedidoDeSandbox,
  PedidoDoEscritor,
  SandboxDoEscritor
} from './squad-escritor'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { PolicyService } = await import('../policy/policy-service')
const { AllowlistRepository } = await import('../policy/allowlist-repository')
const { CommandAllowlistRepository } = await import('../policy/command-allowlist-repository')
const { ExecutionRepository } = await import('../execution/execution-repository')
const { ApprovalRepository } = await import('../execution/approval-repository')
const { TerminalEngine } = await import('../execution/terminal-engine')
const { GitRunner } = await import('../projects/git-runner')
const { PipelineRepository } = await import('../pipeline/pipeline-repository')
const { LeaseRepository } = await import('../pipeline/lease-repository')
const { FilaService } = await import('../pipeline/fila-service')
const { PoolRepository } = await import('../pipeline/pool-repository')
const { PoolService } = await import('../pipeline/pool-service')
const { SquadGit } = await import('./squad-git')
const { GerenteDeSlots } = await import('./squad-slots')
const { ExecutorDeEscritor } = await import('./squad-escritor')

const USER = 'u-1'
const WS = 'jarvis' as const
const PROJETO = 'p-a'

function temGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const comGit = temGit() ? describe : describe.skip

const origem: Mvp['origem'] = { tipo: 'decisao', decisaoId: 'd-1', perguntaId: 'p-1' }
const MVPS: readonly Mvp[] = [
  { id: 'm1', numero: 1, titulo: 'MVP 1', tese: 't', estado: 'na-fila', dependeDe: [], origem }
]
const SLICES: readonly Slice[] = [
  { id: 'f1', mvpId: 'm1', numero: 1, titulo: 'F1', specSlug: 'spec-f1', detalhada: true, origem }
]
const REVISOES: readonly RevisaoAprovada[] = [{ artefato: 'spec-f1', hash: 'h-1' }]

let dir: string
let appDir: string
let repo: string
let db: Db
let baseSha: string
let audit: InstanceType<typeof AuditRepository>
let pool: InstanceType<typeof PoolService>
let fila: InstanceType<typeof FilaService>
let gerente: InstanceType<typeof GerenteDeSlots>
let squadGit: InstanceType<typeof SquadGit>
let executor: InstanceType<typeof ExecutorDeEscritor>
let encerrados: PedidoDeSandbox[]
let preparados: PedidoDeSandbox[]
let sandboxFalha: string | undefined
/** O que o agente faz no worktree. O padrão edita um arquivo do write set e responde com o resultado. */
let agente: (
  p: PedidoAoAgente,
  sandbox: PedidoDeSandbox
) => Promise<{ ok: true; texto: string } | { ok: false; motivo: string }>
let intervaloDoHeartbeatMs = 3_600_000

const git = (args: string[], cwd = repo): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

const FONTES: readonly FonteDaTarefa[] = [
  { caminho: 'src/api/a.ts', texto: 'export const a = 1\n', origem: 'explicito', motivo: 'entrada' }
]
const PACK = {
  id: 'pack-1',
  hash: 'h'.repeat(64),
  itens: [{ caminho: 'src/api/a.ts', hash: 'x', origem: 'explicito', bytes: 19, motivo: 'entrada' }]
} as unknown as ContextPack

const resultado = (parcial: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schema: 'parecer@1',
    conclusao: 'Implementei a rota.',
    evidencia: [{ tipo: 'arquivo', referencia: 'src/api/a.ts', detalhe: 'rota nova' }],
    confianca: 'alta',
    lacunas: [],
    ...parcial
  })

function pedido(parcial: Partial<PedidoDoEscritor> = {}): PedidoDoEscritor {
  const base: PedidoDoEscritor = {
    runId: '',
    projectId: PROJETO,
    workspaceId: WS,
    sliceId: 'f1',
    escritor: 'api',
    tarefa: {
      id: 't1',
      papel: 'desenvolvedor',
      capacidade: 'arquitetura',
      camada: 'especialista',
      escritor: 'api',
      paths: ['src/api'],
      schemaDeResultado: 'parecer@1',
      regraDeConclusao: 'a rota responde',
      limites: { maxTurnos: 5, maxMinutos: 5, maxTokensEntrada: 50_000, maxTokensSaida: 4_000 }
    },
    objetivo: 'implementar a rota',
    contexto: { pack: PACK, fontes: FONTES },
    modelo: { provider: 'claude-code', modelo: 'claude-sonnet-5-5' },
    repositorio: repo,
    baseSha,
    tentativa: 1,
    ...parcial
  }
  return { ...base, runId: parcial.runId ?? runAtual }
}

let runAtual: string
function novoRun(projectId = PROJETO): string {
  const run = fila.criarRun(projectId, WS, 'f1')
  fila.transicionar(projectId, WS, run.id, 'AWAITING_PI')
  fila.transicionar(projectId, WS, run.id, 'READY')
  return run.id
}

const eventos = (): { marco: string; estado: string; [k: string]: unknown }[] =>
  audit
    .list(USER)
    .filter((e) => e.type === 'squad-tarefa')
    .map((e) => e.payload as { marco: string; estado: string })

const escrever = (p: PedidoAoAgente, caminho: string, conteudo = 'novo\n'): void => {
  mkdirSync(join(p.worktree.worktree, caminho, '..'), { recursive: true })
  writeFileSync(join(p.worktree.worktree, caminho), conteudo)
}

const agentePadrao: typeof agente = async (p) => {
  escrever(p, 'src/api/a.ts', 'export const a = 100\n')
  return { ok: true, texto: resultado() }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-squad-escritor-'))
  appDir = join(dir, 'userData')
  repo = join(appDir, 'projeto')
  mkdirSync(join(repo, 'src', 'api'), { recursive: true })
  db = openDatabase(join(dir, 'app.db'))
  audit = new AuditRepository(db, 'chave-de-teste')

  const policy = new PolicyService(audit, () => USER)
  const comandos = new CommandAllowlistRepository(db, audit, policy)
  comandos.remove(USER, 'jarvis', 'git')
  comandos.add(USER, 'jarvis', 'git')
  const runner = new GitRunner(
    new TerminalEngine(
      policy,
      comandos,
      new AllowlistRepository(db, audit, appDir),
      new ExecutionRepository(db),
      new ApprovalRepository(db),
      audit,
      () => USER
    )
  )
  squadGit = new SquadGit({ git: runner, workspaceId: () => 'jarvis' })

  git(['init', '--initial-branch=main'])
  git(['config', 'user.email', 'teste@local'])
  git(['config', 'user.name', 'Teste'])
  git(['config', 'core.autocrlf', 'false'])
  writeFileSync(join(repo, 'src', 'api', 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(repo, 'README.md'), '# projeto\n')
  git(['add', '-A'])
  git(['commit', '-m', 'base'])
  baseSha = git(['rev-parse', 'HEAD'])

  const aprovacao = (projectId: string): Approval => ({
    id: `a-${projectId}`,
    user_id: USER,
    workspace_id: WS,
    projectId,
    gate: 'SLICE_ENTRY',
    revisoes: REVISOES,
    identidade: 'sessao-1',
    autor: 'pi',
    created_at: new Date().toISOString()
  })
  pool = new PoolService({
    db,
    pool: new PoolRepository(db),
    leases: new LeaseRepository(db),
    audit,
    userId: () => USER,
    workspaceId: () => WS,
    gates: (item) => fila.gatesDoItem(item),
    ativar: (item) => fila.ativarRun(item)
  })
  fila = new FilaService({
    runs: new PipelineRepository(db),
    pool,
    workspaceId: () => WS,
    audit,
    roadmap: () => ({ mvps: MVPS, slices: SLICES }),
    aprovacoes: (escopo) => [aprovacao(escopo.projectId)],
    revisoesDoGate: () => REVISOES,
    userId: () => USER,
    mergeAutonomoLigado: () => true,
    aoAdquirir: (a) => gerente.anunciar(a)
  })
  gerente = new GerenteDeSlots(fila)

  encerrados = []
  preparados = []
  sandboxFalha = undefined
  agente = agentePadrao
  intervaloDoHeartbeatMs = 3_600_000
  runAtual = novoRun()
  executor = montarExecutor()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function montarExecutor(
  gitDoKernel: Pick<
    InstanceType<typeof SquadGit>,
    'alteracoes' | 'commitar' | 'remover'
  > = squadGit,
  aoPreparar?: () => void
): InstanceType<typeof ExecutorDeEscritor> {
  const sandbox: SandboxDoEscritor = {
    preparar: async (p) => {
      aoPreparar?.()
      preparados.push(p)
      if (sandboxFalha !== undefined) return { ok: false, motivo: sandboxFalha }
      const r = squadGit.criarWorktree({
        repositorio: p.repositorio,
        worktree: join(appDir, `wt-${p.escritor}-t${p.tentativa}`),
        branch: `feat/${p.escritor}-t${p.tentativa}`,
        baseSha: p.baseSha
      })
      return r.ok ? { ok: true, worktree: r.valor } : { ok: false, motivo: r.motivo }
    },
    encerrar: async (p) => void encerrados.push(p)
  }
  /** O pedido de sandbox de cada worktree: dois escritores em paralelo não podem dividir uma variável. */
  const porWorktree = new Map<string, PedidoDeSandbox>()
  return new ExecutorDeEscritor({
    git: gitDoKernel,
    slots: gerente,
    sandbox: {
      preparar: async (p) => {
        const r = await sandbox.preparar(p)
        if (r.ok) porWorktree.set(r.worktree.worktree, p)
        return r
      },
      encerrar: sandbox.encerrar
    },
    agente: { executar: (p) => agente(p, porWorktree.get(p.worktree.worktree) as PedidoDeSandbox) },
    audit,
    userId: () => USER,
    workspaceId: () => WS,
    intervaloDoHeartbeatMs
  })
}

/** Reconstrói o executor com o intervalo de heartbeat atual (os testes de lease o encurtam). */
const remontar = (): void => void (executor = montarExecutor())

comGit('o escritor conclui: o kernel prova e commita (critérios 1 e 2)', () => {
  it('commita só o que provou dentro do write set, com a identidade do kernel', async () => {
    const r = await executor.executar(pedido())

    expect(r.estado).toBe('concluida')
    expect(r.escritor).toBe('api')
    expect(r.arquivos).toEqual(['src/api/a.ts'])
    expect(r.commitSha).toBe(git(['rev-parse', 'feat/api-t1']))
    expect(r.commitSha).not.toBe(baseSha)
    expect(git(['show', '--name-only', '--format=%an|%s', 'feat/api-t1'])).toBe(
      'JARVIS OS|jarvis t1 (api) tentativa 1\n\nsrc/api/a.ts'
    )
    expect(git(['show', 'feat/api-t1:src/api/a.ts'])).toBe('export const a = 100')
    // O repositório principal não foi tocado: o escritor trabalhou no worktree dele.
    expect(readFileSync(join(repo, 'src', 'api', 'a.ts'), 'utf8')).toBe('export const a = 1\n')
    expect(git(['rev-parse', 'main'])).toBe(baseSha)
  })

  it('lê o resultado, calcula a assinatura e remove o worktree já commitado', async () => {
    const r = await executor.executar(pedido())

    expect(r.resultado?.conclusao).toBe('Implementei a rota.')
    expect(r.assinatura).toMatch(/^[0-9a-f]{64}$/)
    expect(r.worktree).toBeUndefined()
    expect(existsSync(join(appDir, 'wt-api-t1'))).toBe(false)
  })

  it('a evidência pode citar um arquivo que o escritor alterou, mesmo fora do pacote', async () => {
    agente = async (p) => {
      escrever(p, 'src/api/novo.ts', 'novo\n')
      return {
        ok: true,
        texto: resultado({ evidencia: [{ tipo: 'arquivo', referencia: 'src/api/novo.ts' }] })
      }
    }

    const r = await executor.executar(pedido())

    expect(r.estado).toBe('concluida')
    expect(r.arquivos).toEqual(['src/api/novo.ts'])
  })

  it('solta o slot, derruba o sandbox e audita início e fim — sem o texto do agente', async () => {
    agente = async (p) => {
      escrever(p, 'src/api/a.ts', 'conteudo-unico-do-arquivo-xyz\n')
      return { ok: true, texto: resultado({ conclusao: 'conclusao-unica-do-agente-abc' }) }
    }

    const r = await executor.executar(pedido())

    expect(pool.vista().ocupados).toEqual([])
    expect(encerrados).toHaveLength(1)
    expect(eventos().map((e) => [e.marco, e.estado])).toEqual([
      ['inicio', 'em-execucao'],
      ['fim', 'concluida']
    ])
    expect(eventos()[1]).toMatchObject({
      runId: runAtual,
      tarefaId: 't1',
      escritor: 'api',
      packId: 'pack-1',
      baseSha,
      commitSha: r.commitSha,
      assinatura: r.assinatura,
      arquivos: 1
    })
    const trilha = JSON.stringify(audit.list(USER))
    expect(trilha).not.toContain('conclusao-unica-do-agente-abc')
    expect(trilha).not.toContain('conteudo-unico-do-arquivo-xyz')
  })

  it('o resultado nunca carrega o fencing token', async () => {
    const r = await executor.executar(pedido())

    expect(Object.keys(r)).not.toContain('fencingToken')
    expect(JSON.stringify(r)).not.toContain('fencingToken')
  })

  it('o agente recebe o write set, as ferramentas de leitura do material e o sinal de parada', async () => {
    let recebido: PedidoAoAgente | undefined
    agente = async (p) => {
      recebido = p
      escrever(p, 'src/api/a.ts')
      return { ok: true, texto: resultado() }
    }

    await executor.executar(pedido())

    expect(recebido?.system).toContain('- src/api')
    expect(recebido?.system).toContain('não há shell, não há Git')
    expect(recebido?.prompt).toContain('implementar a rota')
    expect(recebido?.prompt).toContain('export const a = 1')
    expect(recebido?.limites.maxMinutos).toBe(5)
    expect(recebido?.signal.aborted).toBe(false)
    expect(recebido?.worktree.baseSha).toBe(baseSha)
  })
})

comGit('o escopo é provado pelo diff, e reprova o escritor inteiro (critério 2)', () => {
  const semCommit = async (r: Promise<Awaited<ReturnType<typeof executor.executar>>>) => {
    const resultadoDoEscritor = await r
    expect(git(['rev-parse', 'feat/api-t1'])).toBe(baseSha)
    expect(pool.vista().ocupados).toEqual([])
    return resultadoDoEscritor
  }

  it('um arquivo fora do write set: falhou, nada commitado, worktree preservado', async () => {
    agente = async (p) => {
      escrever(p, 'src/api/a.ts')
      escrever(p, 'src/ui/fora.ts')
      return { ok: true, texto: resultado() }
    }

    const r = await semCommit(executor.executar(pedido()))

    expect(r).toMatchObject({
      estado: 'falhou',
      motivo: 'escopo-violado',
      violacoes: { fugas: 1, simbolicos: 0, invalidos: 0 }
    })
    expect(r.worktree).toBe(join(appDir, 'wt-api-t1'))
    expect(existsSync(join(appDir, 'wt-api-t1', 'src', 'ui', 'fora.ts'))).toBe(true)
    expect(eventos().at(-1)).toMatchObject({
      estado: 'falhou',
      violacoes: { fugas: 1, simbolicos: 0, invalidos: 0 }
    })
  })

  it('o write set é por segmento: `src/api-v2` não é `src/api`', async () => {
    agente = async (p) => {
      escrever(p, 'src/api-v2/x.ts')
      return { ok: true, texto: resultado() }
    }

    const r = await semCommit(executor.executar(pedido()))

    expect(r).toMatchObject({ estado: 'falhou', motivo: 'escopo-violado' })
  })

  it('nome que o kernel não commita: segredo e reservado', async () => {
    agente = async (p) => {
      escrever(p, 'src/api/.env', 'X=1\n')
      escrever(p, 'src/api/NUL.ts')
      return { ok: true, texto: resultado() }
    }

    const r = await semCommit(executor.executar(pedido()))

    expect(r.violacoes).toEqual({ fugas: 0, simbolicos: 0, invalidos: 2 })
  })

  it('o link simbólico reprova, mesmo dentro do write set', async () => {
    agente = async (p) => {
      escrever(p, 'src/api/a.ts')
      try {
        symlinkSync(join(dir, 'fora'), join(p.worktree.worktree, 'src', 'api', 'atalho'))
      } catch {
        // Sem privilégio de symlink (Windows sem modo desenvolvedor): nada a provar aqui.
      }
      return { ok: true, texto: resultado() }
    }

    const r = await executor.executar(pedido())

    if (existsSync(join(appDir, 'wt-api-t1', 'src', 'api', 'atalho'))) {
      expect(r).toMatchObject({ estado: 'falhou', motivo: 'escopo-violado' })
      expect(r.violacoes?.simbolicos).toBe(1)
      expect(git(['rev-parse', 'feat/api-t1'])).toBe(baseSha)
    }
  })

  it('a prova é por worktree: um escritor que escreve no escopo do outro é reprovado', async () => {
    pool.configurar({ ...CONFIG_PADRAO, paralelismo: true })
    agente = async (p, sandbox) => {
      if (sandbox.escritor === 'api') escrever(p, 'src/ui/invade.ts')
      else escrever(p, 'src/ui/u.ts')
      return {
        ok: true,
        texto: resultado({ evidencia: [{ tipo: 'arquivo', referencia: 'src/ui/u.ts' }] })
      }
    }
    const ui = {
      escritor: 'ui',
      tarefa: { ...pedido().tarefa, id: 't2', escritor: 'ui', paths: ['src/ui'] }
    }

    const [a, b] = await Promise.all([
      executor.executar(pedido()),
      executor.executar(pedido({ ...ui }))
    ])

    expect(a).toMatchObject({ estado: 'falhou', motivo: 'escopo-violado' })
    expect(b).toMatchObject({ estado: 'concluida', arquivos: ['src/ui/u.ts'] })
    expect(git(['rev-parse', 'feat/api-t1'])).toBe(baseSha)
    expect(git(['show', 'feat/ui-t1:src/ui/u.ts'])).toBe('novo')
  })

  it('sem nenhuma alteração é incompleta, não sucesso presumido', async () => {
    agente = async () => ({ ok: true, texto: resultado() })

    const r = await semCommit(executor.executar(pedido()))

    expect(r).toMatchObject({ estado: 'incompleta', motivo: 'sem-alteracoes', arquivos: [] })
  })
})

comGit('o resultado do agente é dado não confiável: só `concluida` commita', () => {
  const semCommit = (): void => {
    expect(git(['rev-parse', 'feat/api-t1'])).toBe(baseSha)
  }

  it('saída sem JSON é inválida, e o trabalho fica no worktree', async () => {
    agente = async (p) => {
      escrever(p, 'src/api/a.ts')
      return { ok: true, texto: 'terminei, está tudo certo' }
    }

    const r = await executor.executar(pedido())

    expect(r).toMatchObject({ estado: 'invalida', motivo: 'saida-sem-json' })
    expect(r.worktree).toBe(join(appDir, 'wt-api-t1'))
    semCommit()
  })

  it('schema errado, chave a mais e assinatura forjada são inválidos', async () => {
    for (const ruim of [{ schema: 'achados@1' }, { extra: 1 }, { assinatura: 'forjada' }]) {
      agente = async (p) => {
        escrever(p, 'src/api/a.ts')
        return { ok: true, texto: resultado(ruim) }
      }
      const r = await executor.executar(pedido({ tentativa: 1 }))
      expect(r.estado).toBe('invalida')
      expect(r.assinatura).toBeUndefined()
      // O worktree é o mesmo da tentativa 1: o resto do teste só confere o estado.
      rmSync(join(appDir, 'wt-api-t1'), { recursive: true, force: true })
      git(['worktree', 'prune'])
      git(['branch', '-D', 'feat/api-t1'])
    }
  })

  it('evidência que não está no pacote nem no diff é incompleta, e não commita', async () => {
    agente = async (p) => {
      escrever(p, 'src/api/a.ts')
      return {
        ok: true,
        texto: resultado({ evidencia: [{ tipo: 'arquivo', referencia: 'src/api/inventado.ts' }] })
      }
    }

    const r = await executor.executar(pedido())

    expect(r.estado).toBe('incompleta')
    expect(r.motivo).toMatch(/evid/i)
    expect(r.descartadas).toEqual(['src/api/inventado.ts'])
    expect(r.assinatura).toBeDefined()
    expect(r.worktree).toBe(join(appDir, 'wt-api-t1'))
    semCommit()
  })
})

comGit('falha, prazo, cancelamento e lease têm estado terminal próprio (critério 4)', () => {
  const pendurado = (p: PedidoAoAgente): Promise<{ ok: false; motivo: string }> =>
    new Promise((resolve) => {
      const parar = (): void => resolve({ ok: false, motivo: 'interrompido' })
      if (p.signal.aborted) parar()
      else p.signal.addEventListener('abort', parar, { once: true })
    })

  it('falha do agente: falhou, com o worktree preservado e o slot solto', async () => {
    agente = async (p) => {
      escrever(p, 'src/api/a.ts')
      return { ok: false, motivo: 'o agente travou' }
    }

    const r = await executor.executar(pedido())

    expect(r).toMatchObject({ estado: 'falhou', motivo: 'o agente travou' })
    expect(r.worktree).toBe(join(appDir, 'wt-api-t1'))
    expect(pool.vista().ocupados).toEqual([])
    expect(encerrados).toHaveLength(1)
  })

  it('exceção do agente vira falha com o nome do erro, e o slot é solto', async () => {
    agente = async () => {
      throw new TypeError('detalhe interno que não vai para a auditoria')
    }

    const r = await executor.executar(pedido())

    expect(r).toMatchObject({ estado: 'falhou', motivo: 'agente: TypeError' })
    expect(pool.vista().ocupados).toEqual([])
    expect(JSON.stringify(audit.list(USER))).not.toContain('detalhe interno')
  })

  it('estourou o prazo do plano: timeout, e nada é commitado', async () => {
    agente = (p) => {
      escrever(p, 'src/api/a.ts')
      return pendurado(p)
    }
    const base = pedido()

    const r = await executor.executar({
      ...base,
      tarefa: { ...base.tarefa, limites: { ...base.tarefa.limites, maxMinutos: 0.001 } }
    })

    expect(r).toMatchObject({ estado: 'timeout', motivo: 'prazo-do-plano' })
    expect(git(['rev-parse', 'feat/api-t1'])).toBe(baseSha)
    expect(pool.vista().ocupados).toEqual([])
  })

  it('cancelada no meio da execução: cancelada, e o slot é solto', async () => {
    agente = pendurado
    const controle = new AbortController()
    setTimeout(() => controle.abort(), 40)

    const r = await executor.executar(pedido({ signal: controle.signal }))

    expect(r).toMatchObject({ estado: 'cancelada', motivo: 'cancelada' })
    expect(pool.vista().ocupados).toEqual([])
    expect(eventos().map((e) => e.estado)).toEqual(['em-execucao', 'cancelada'])
  })

  it('cancelada antes de começar: nem toma slot, nem prepara sandbox, e só o fim é auditado', async () => {
    const controle = new AbortController()
    controle.abort()

    const r = await executor.executar(pedido({ signal: controle.signal }))

    expect(r).toMatchObject({ estado: 'cancelada', motivo: 'cancelada-antes-de-iniciar' })
    expect(preparados).toHaveLength(0)
    expect(eventos().map((e) => [e.marco, e.estado])).toEqual([['fim', 'cancelada']])
  })

  it('cancelada na fila: sai da fila, e o slot de quem espera nunca é tomado por ela', async () => {
    const outro = await gerente.adquirir({
      projectId: PROJETO,
      workspaceId: WS,
      runId: runAtual,
      escritor: 'ui'
    })
    if (!outro.ok) throw new Error('o outro escritor deveria ter o slot')
    const controle = new AbortController()
    setTimeout(() => controle.abort(), 30)

    const r = await executor.executar(pedido({ signal: controle.signal }))

    expect(r).toMatchObject({ estado: 'cancelada', motivo: 'cancelada-na-fila' })
    expect(preparados).toHaveLength(0)
    expect(pool.vista().fila).toEqual([])
    gerente.liberar(PROJETO, WS, outro.unidade, outro.fencingToken)
    expect(pool.slotDoRun(idDoEscritor(runAtual, 'api'))).toBeUndefined()
  })

  it('perdeu o lease durante a execução: o agente é abortado e nada é commitado', async () => {
    intervaloDoHeartbeatMs = 15
    remontar()
    agente = async (p) => {
      escrever(p, 'src/api/a.ts')
      // O slot some por baixo do escritor (reconciliação, por exemplo).
      pool.encerrar(idDoEscritor(runAtual, 'api'))
      return pendurado(p)
    }

    const r = await executor.executar(pedido())

    expect(r).toMatchObject({ estado: 'falhou', motivo: 'lease-perdido' })
    expect(git(['rev-parse', 'feat/api-t1'])).toBe(baseSha)
  })

  it('o dono antigo não confirma: com o slot trocado, o trabalho dele não é commitado', async () => {
    agente = async (p) => {
      escrever(p, 'src/api/a.ts')
      // O lease é reatribuído a outro dono (token novo) sem o heartbeat ter notado.
      const unidade = idDoEscritor(runAtual, 'api')
      pool.encerrar(unidade)
      pool.reabrir(unidade)
      pool.ciclo()
      return { ok: true, texto: resultado() }
    }

    const r = await executor.executar(pedido())

    expect(r).toMatchObject({ estado: 'falhou', motivo: 'fencing-invalido' })
    expect(git(['rev-parse', 'feat/api-t1'])).toBe(baseSha)
  })

  it('o heartbeat renova o lease enquanto o agente trabalha', async () => {
    intervaloDoHeartbeatMs = 15
    remontar()
    let antes = 0
    let depois = 0
    agente = async (p) => {
      escrever(p, 'src/api/a.ts')
      antes = pool.slotDoRun(idDoEscritor(runAtual, 'api'))?.heartbeatEm ?? 0
      await new Promise((r) => setTimeout(r, 120))
      depois = pool.slotDoRun(idDoEscritor(runAtual, 'api'))?.heartbeatEm ?? 0
      return { ok: true, texto: resultado() }
    }

    const r = await executor.executar(pedido())

    expect(r.estado).toBe('concluida')
    expect(depois).toBeGreaterThan(antes)
  })

  it('o heartbeat que lança é lease perdido: o agente é abortado e nada é commitado', async () => {
    intervaloDoHeartbeatMs = 10
    remontar()
    vi.spyOn(fila, 'renovarSlot').mockImplementation(() => {
      throw new Error('banco indisponível')
    })
    agente = async (p) => {
      escrever(p, 'src/api/a.ts')
      return pendurado(p)
    }

    const r = await executor.executar(pedido())

    expect(r).toMatchObject({ estado: 'falhou', motivo: 'lease-perdido' })
    expect(git(['rev-parse', 'feat/api-t1'])).toBe(baseSha)
  })

  it('o sandbox que não sobe é falha, e o slot é solto', async () => {
    sandboxFalha = 'docker parado'

    const r = await executor.executar(pedido())

    expect(r).toMatchObject({ estado: 'falhou', motivo: 'sandbox-indisponivel: docker parado' })
    expect(pool.vista().ocupados).toEqual([])
    expect(encerrados).toHaveLength(1)
  })
})

comGit('um slot, dois escritores: em sequência, sem erro (critério 6 e regra 5)', () => {
  it('o segundo espera o primeiro terminar e roda depois, cada um no seu worktree', async () => {
    let simultaneos = 0
    let maximo = 0
    agente = async (p, sandbox) => {
      simultaneos += 1
      maximo = Math.max(maximo, simultaneos)
      escrever(p, sandbox.escritor === 'api' ? 'src/api/a.ts' : 'src/ui/u.ts')
      await new Promise((r) => setTimeout(r, 50))
      simultaneos -= 1
      return {
        ok: true,
        texto: resultado({
          evidencia: [
            {
              tipo: 'arquivo',
              referencia: sandbox.escritor === 'api' ? 'src/api/a.ts' : 'src/ui/u.ts'
            }
          ]
        })
      }
    }
    const ui = {
      escritor: 'ui',
      tarefa: { ...pedido().tarefa, id: 't2', escritor: 'ui', paths: ['src/ui'] }
    }

    const [a, b] = await Promise.all([
      executor.executar(pedido()),
      executor.executar(pedido({ ...ui }))
    ])

    expect(a.estado).toBe('concluida')
    expect(b.estado).toBe('concluida')
    expect(maximo).toBe(1)
    expect(a.commitSha).not.toBe(b.commitSha)
    expect(git(['rev-parse', 'feat/api-t1'])).toBe(a.commitSha)
    expect(git(['rev-parse', 'feat/ui-t1'])).toBe(b.commitSha)
    expect(pool.vista().ocupados).toEqual([])
  })

  it('com o paralelismo ligado, os dois rodam juntos, cada um no seu slot e no seu worktree', async () => {
    pool.configurar({ ...CONFIG_PADRAO, paralelismo: true })
    let simultaneos = 0
    let maximo = 0
    agente = async (p, sandbox) => {
      simultaneos += 1
      maximo = Math.max(maximo, simultaneos)
      const arquivo = sandbox.escritor === 'api' ? 'src/api/a.ts' : 'src/ui/u.ts'
      escrever(p, arquivo)
      await new Promise((r) => setTimeout(r, 60))
      simultaneos -= 1
      return {
        ok: true,
        texto: resultado({ evidencia: [{ tipo: 'arquivo', referencia: arquivo }] })
      }
    }
    const ui = {
      escritor: 'ui',
      tarefa: { ...pedido().tarefa, id: 't2', escritor: 'ui', paths: ['src/ui'] }
    }

    const [a, b] = await Promise.all([
      executor.executar(pedido()),
      executor.executar(pedido({ ...ui }))
    ])

    expect(a).toMatchObject({ estado: 'concluida' })
    expect(b).toMatchObject({ estado: 'concluida' })
    expect(maximo).toBe(2)
    expect(a.arquivos).toEqual(['src/api/a.ts'])
    expect(b.arquivos).toEqual(['src/ui/u.ts'])
  })
})

comGit('a nova tentativa do escritor (M9-F04)', () => {
  it('depois de falhar, a segunda tentativa volta à fila e conclui num worktree novo', async () => {
    agente = async () => ({ ok: false, motivo: 'primeira falhou' })
    const primeira = await executor.executar(pedido())
    expect(primeira.estado).toBe('falhou')

    agente = agentePadrao
    const segunda = await executor.executar(pedido({ tentativa: 2 }))

    expect(segunda.estado).toBe('concluida')
    expect(segunda.tentativa).toBe(2)
    expect(git(['rev-parse', 'feat/api-t2'])).toBe(segunda.commitSha)
    expect(preparados.map((p) => p.tentativa)).toEqual([1, 2])
  })

  it('o sandbox sabe de que tarefa é: duas tarefas do mesmo escritor não dividem ambiente', async () => {
    await executor.executar(pedido())

    expect(preparados.map((p) => p.tarefaId)).toEqual(['t1'])
  })

  it('a quarta tentativa é recusada, sem tomar slot', async () => {
    const r = await executor.executar(pedido({ tentativa: 4 }))

    expect(r).toMatchObject({ estado: 'recusada', motivo: 'tentativas-esgotadas' })
    expect(preparados).toHaveLength(0)
  })
})

comGit('o que nem entra na fila é recusado, com o motivo', () => {
  const recusada = async (p: PedidoDoEscritor, motivo: string): Promise<void> => {
    const r = await executor.executar(p)

    expect(r).toMatchObject({ estado: 'recusada', motivo })
    expect(preparados).toHaveLength(0)
    expect(pool.vista().fila).toEqual([])
    expect(eventos().map((e) => [e.marco, e.estado])).toEqual([['fim', 'recusada']])
  }

  it('papel que não é desenvolvedor: o worker lê, o integrador é da F04', async () => {
    for (const papel of ['explorador', 'testador', 'revisor', 'integrador'] as const) {
      const p = pedido()
      const r = await executor.executar({ ...p, tarefa: { ...p.tarefa, papel } })
      expect(r).toMatchObject({ estado: 'recusada', motivo: 'papel-nao-suportado' })
    }
  })

  it('schema desconhecido', async () => {
    const p = pedido()
    await recusada(
      { ...p, tarefa: { ...p.tarefa, schemaDeResultado: 'x@9' } },
      'schema-desconhecido'
    )
  })

  it('escritor divergente do plano ou com nome inválido', async () => {
    await recusada(pedido({ escritor: 'ui' }), 'escritor-divergente')
    const p = pedido()
    for (const escritor of ['a b', 'a:b', '', 'x'.repeat(33)]) {
      const r = await executor.executar({ ...p, escritor, tarefa: { ...p.tarefa, escritor } })
      expect(r).toMatchObject({ estado: 'recusada', motivo: 'escritor-invalido' })
    }
  })

  it('write set vazio ou com caminho que o kernel não aceita', async () => {
    const p = pedido()
    for (const paths of [[], [''], ['../fora'], ['/abs'], ['.env'], ['src/api', 'NUL']]) {
      const r = await executor.executar({ ...p, tarefa: { ...p.tarefa, paths } })
      expect(r).toMatchObject({ estado: 'recusada', motivo: 'escopo-invalido' })
    }
  })

  it('tentativa, limite e contexto inválidos', async () => {
    const p = pedido()
    expect((await executor.executar({ ...p, tentativa: 0 })).motivo).toBe('tentativa-invalida')
    expect(
      (
        await executor.executar({
          ...p,
          tarefa: { ...p.tarefa, limites: { ...p.tarefa.limites, maxMinutos: 0 } }
        })
      ).motivo
    ).toBe('limite-invalido')
    expect((await executor.executar({ ...p, contexto: { pack: PACK, fontes: [] } })).motivo).toBe(
      'sem-contexto'
    )
  })

  it('contexto que passa do limite de entrada da tarefa', async () => {
    const p = pedido()
    await recusada(
      { ...p, tarefa: { ...p.tarefa, limites: { ...p.tarefa.limites, maxTokensEntrada: 10 } } },
      'contexto-acima-do-limite'
    )
  })
})

comGit('os caminhos de erro do kernel têm estado terminal próprio', () => {
  type GitDoKernel = Parameters<typeof montarExecutor>[0]

  /** O Git real, com uma operação trocada: dá para provocar o erro que o Git real não dá por demanda. */
  const comGitFalso = (troca: Record<string, unknown>): NonNullable<GitDoKernel> =>
    ({
      alteracoes: squadGit.alteracoes.bind(squadGit),
      commitar: squadGit.commitar.bind(squadGit),
      remover: squadGit.remover.bind(squadGit),
      ...troca
    }) as NonNullable<GitDoKernel>

  it('run que o pool não conhece: o slot é indisponível, e nada sobe', async () => {
    const r = await executor.executar(pedido({ runId: 'nao-existe' }))

    expect(r).toMatchObject({ estado: 'falhou', motivo: 'slot-indisponivel' })
    expect(preparados).toHaveLength(0)
    expect(eventos().map((e) => e.estado)).toEqual(['em-execucao', 'falhou'])
  })

  it('o diff que o Git não consegue ler é falha, com o slot solto', async () => {
    executor = montarExecutor(
      comGitFalso({ alteracoes: () => ({ ok: false, motivo: 'índice corrompido' }) })
    )

    const r = await executor.executar(pedido())

    expect(r).toMatchObject({ estado: 'falhou', motivo: 'diff-indisponivel: índice corrompido' })
    expect(pool.vista().ocupados).toEqual([])
    expect(git(['rev-parse', 'feat/api-t1'])).toBe(baseSha)
  })

  it('o link simbólico que o Git aponta reprova, contado em violacoes', async () => {
    executor = montarExecutor(
      comGitFalso({
        alteracoes: () => ({
          ok: true,
          valor: { caminhos: ['src/api/a.ts', 'src/api/l'], simbolicos: ['src/api/l'] }
        })
      })
    )

    const r = await executor.executar(pedido())

    expect(r).toMatchObject({
      estado: 'falhou',
      motivo: 'escopo-violado',
      violacoes: { fugas: 0, simbolicos: 1, invalidos: 0 }
    })
  })

  it('o commit que falha é falha, e o trabalho fica no worktree', async () => {
    executor = montarExecutor(
      comGitFalso({ commitar: () => ({ ok: false, motivo: 'hook recusou' }) })
    )

    const r = await executor.executar(pedido())

    expect(r).toMatchObject({ estado: 'falhou', motivo: 'commit-falhou: hook recusou' })
    expect(r.worktree).toBe(join(appDir, 'wt-api-t1'))
    expect(r.resultado).toBeDefined()
    expect(r.commitSha).toBeUndefined()
    expect(pool.vista().ocupados).toEqual([])
  })

  it('o worktree que não dá para remover continua nomeado no resultado concluído', async () => {
    executor = montarExecutor(
      comGitFalso({ remover: () => ({ ok: false, motivo: 'worktree-sujo' }) })
    )

    const r = await executor.executar(pedido())

    expect(r.estado).toBe('concluida')
    expect(r.worktree).toBe(join(appDir, 'wt-api-t1'))
  })

  it('exceção do sandbox vira falha com o nome do erro, e o slot é solto', async () => {
    const original = executor
    executor = montarExecutor(undefined, () => {
      throw new TypeError('o docker caiu com detalhe interno')
    })

    const r = await executor.executar(pedido())

    expect(r).toMatchObject({ estado: 'falhou', motivo: 'erro inesperado: TypeError' })
    expect(pool.vista().ocupados).toEqual([])
    expect(JSON.stringify(audit.list(USER))).not.toContain('detalhe interno')
    expect(original).toBeDefined()
  })
})

comGit('o commit e a evidência cobrem o que o escritor provou', () => {
  it('commita todos os arquivos provados, não só o primeiro', async () => {
    agente = async (p) => {
      escrever(p, 'src/api/a.ts')
      escrever(p, 'src/api/b.ts')
      escrever(p, 'src/api/c.ts')
      return { ok: true, texto: resultado() }
    }

    const r = await executor.executar(pedido())

    expect(r.arquivos).toEqual(['src/api/a.ts', 'src/api/b.ts', 'src/api/c.ts'])
    expect(git(['show', '--name-only', '--format=', 'feat/api-t1']).split(/\r?\n/).sort()).toEqual([
      'src/api/a.ts',
      'src/api/b.ts',
      'src/api/c.ts'
    ])
  })

  it('a evidência pode citar um arquivo do pacote que o escritor não alterou', async () => {
    agente = async (p) => {
      escrever(p, 'src/api/novo.ts')
      return { ok: true, texto: resultado() } // cita src/api/a.ts, que só está no pacote
    }

    const r = await executor.executar(pedido())

    expect(r.estado).toBe('concluida')
    expect(r.arquivos).toEqual(['src/api/novo.ts'])
  })

  it('com mais de um objeto na saída, lê o que tem a forma do resultado', async () => {
    agente = async (p) => {
      escrever(p, 'src/api/a.ts')
      return { ok: true, texto: `exemplo: {"outra":1}\nresultado: ${resultado()}` }
    }

    const r = await executor.executar(pedido())

    expect(r.estado).toBe('concluida')
    expect(r.resultado?.conclusao).toBe('Implementei a rota.')
  })
})
