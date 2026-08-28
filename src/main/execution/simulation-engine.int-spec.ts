/**
 * Motor de execução simulada contra o SQLite real (SPEC-Execucao-05, categoria Banco).
 *
 * Prova a headline do MVP-002: percorrer um workflow **sem tocar recurso real**, com cada
 * etapa classificada (F02) e checada na allowlist (F03), produzindo um `ExecutionRun`
 * auditado e rastreável.
 *
 * O teste mais importante aqui é o de **zero efeito colateral** (critério 2): um workflow com
 * etapa "gravar arquivo" roda e o arquivo **não existe** depois. É o invariante da fatia.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowStep } from '@shared/domain/workflows'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { PolicyService } = await import('../policy/policy-service')
const { AllowlistRepository } = await import('../policy/allowlist-repository')
const { WorkflowRepository } = await import('../workflows/workflow-repository')
const { ExecutionRepository } = await import('./execution-repository')
const { SimulationEngine } = await import('./simulation-engine')

let dir: string
let appDir: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let workflows: InstanceType<typeof WorkflowRepository>
let runs: InstanceType<typeof ExecutionRepository>
let engine: InstanceType<typeof SimulationEngine>

/** Cria um workflow do usuário de teste e devolve o id. */
function criarWorkflow(steps: readonly WorkflowStep[]): string {
  return workflows.create({
    user_id: 'u-1',
    workspace_id: 'jarvis',
    name: 'W de teste',
    steps
  }).id
}

const etapaOk: WorkflowStep = {
  id: 's-ok',
  descriptor: { action: 'fs.list-allowed' },
  mode: 'sequencial',
  requiresApproval: false
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-exec-'))
  appDir = join(dir, 'userData')
  db = openDatabase(join(dir, 'teste.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  workflows = new WorkflowRepository(db)
  runs = new ExecutionRepository(db)
  engine = new SimulationEngine(
    workflows,
    new PolicyService(audit, () => 'u-1'),
    new AllowlistRepository(db, audit, appDir),
    runs,
    audit,
    () => 'u-1'
  )
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('caminho feliz: run persistido com trace (critério 1)', () => {
  it('percorre as etapas e termina concluído, com trace por etapa', () => {
    const id = criarWorkflow([etapaOk, { ...etapaOk, id: 's-2' }])
    const run = engine.runWorkflow(id, 'jarvis')

    expect(run.state).toBe('concluido')
    expect(run.trace).toHaveLength(2)
    expect(run.trace[0]?.outcome).toBe('simulado-ok')
    expect(run.trace[0]?.decision.tier).toBe('baixo') // veio da F02
    expect(run.correlationId).toBeTruthy()
  })

  it('o run é persistido e escopado por usuário/workspace', () => {
    const id = criarWorkflow([etapaOk])
    const run = engine.runWorkflow(id, 'jarvis')

    const persistido = runs.findById('u-1', run.id)
    expect(persistido?.state).toBe('concluido')
    expect(persistido?.trace).toHaveLength(1)
    // Outro usuário não enxerga o run.
    expect(runs.findById('u-2', run.id)).toBeUndefined()
  })

  it('workflow inexistente ⇒ run cancelado, registrado em vez de erro engolido', () => {
    const run = engine.runWorkflow('id-que-nao-existe', 'jarvis')
    expect(run.state).toBe('cancelado')
    expect(run.workflowId).toBeNull()
    expect(run.trace).toHaveLength(0)
  })
})

describe('ZERO EFEITO COLATERAL — o invariante da fatia (critério 2)', () => {
  it('etapa "gravar arquivo" NÃO cria arquivo — só registra que simulou', () => {
    const alvo = join(dir, 'nao-deve-existir.txt')
    const id = criarWorkflow([
      {
        id: 's-write',
        descriptor: { action: 'fs.write-allowed', params: { path: alvo, conteudo: 'x' } },
        mode: 'sequencial',
        requiresApproval: false
      }
    ])

    const run = engine.runWorkflow(id, 'jarvis')

    // A prova: o arquivo não existe. A etapa "rodou" e nada aconteceu no disco.
    expect(existsSync(alvo)).toBe(false)
    expect(run.trace[0]?.outcome).toBe('simulado-ok')
    expect(run.trace[0]?.nota).toContain('simulada')
  })

  it('nenhum arquivo novo aparece no diretório do teste além do banco', () => {
    const id = criarWorkflow([
      {
        id: 's-write',
        descriptor: { action: 'fs.delete-move-overwrite', params: { path: join(dir, 'x') } },
        mode: 'sequencial',
        requiresApproval: false
      }
    ])

    const antes = readdirSync(dir).sort()
    engine.runWorkflow(id, 'jarvis')
    // Mesma listagem depois: a simulação não criou, moveu nem apagou nada.
    expect(readdirSync(dir).sort()).toEqual(antes)
  })
})

describe('classificação (F02) e allowlist (F03) entram no trace (critério 3)', () => {
  it('etapa com path FORA do permitido é registrada como fora e tem tier elevado', () => {
    const fora = join(dir, 'fora-da-allowlist')
    const id = criarWorkflow([
      {
        id: 's-path',
        descriptor: { action: 'fs.list-allowed', params: { path: fora } },
        mode: 'sequencial',
        requiresApproval: false
      }
    ])

    const run = engine.runWorkflow(id, 'jarvis')
    const t = run.trace[0]

    expect(t?.pathAllowed).toBe(false)
    // A F03 alimentou a F02: fora da allowlist elevou o tier (baixo → medio).
    expect(t?.decision.tier).toBe('medio')
    expect(t?.decision.reason).toBe('elevada-por-path-fora-da-allowlist')
  })

  it('etapa sem path não tem checagem de allowlist no trace', () => {
    const id = criarWorkflow([etapaOk])
    const run = engine.runWorkflow(id, 'jarvis')
    expect(run.trace[0]?.pathAllowed).toBeUndefined()
  })

  it('modo report: etapa classificada `bloqueado` NÃO barra o run', () => {
    // Ação fora da taxonomia ⇒ fail-closed ⇒ `bloqueado`. Mesmo assim o run conclui:
    // barrar é enforcement, e enforcement é MVP-003.
    const id = criarWorkflow([
      {
        id: 's-desconhecida',
        descriptor: { action: 'acao.que.nao.existe' },
        mode: 'sequencial',
        requiresApproval: false
      }
    ])

    const run = engine.runWorkflow(id, 'jarvis')
    expect(run.trace[0]?.decision.tier).toBe('bloqueado')
    expect(run.state).toBe('concluido') // não barrou
  })
})

describe('estado `falhou` com falha declarável (critério 4)', () => {
  it('etapa com params.simulateFailure leva o run a falhou', () => {
    const id = criarWorkflow([
      {
        id: 's-falha',
        descriptor: { action: 'fs.list-allowed', params: { simulateFailure: true } },
        mode: 'sequencial',
        requiresApproval: false
      }
    ])

    const run = engine.runWorkflow(id, 'jarvis')
    expect(run.state).toBe('falhou')
    expect(run.trace[0]?.outcome).toBe('simulado-falha')
  })

  it('etapas após a falha não são percorridas', () => {
    const id = criarWorkflow([
      {
        id: 's-falha',
        descriptor: { action: 'fs.list-allowed', params: { simulateFailure: true } },
        mode: 'sequencial',
        requiresApproval: false
      },
      { ...etapaOk, id: 's-nunca-roda' }
    ])

    const run = engine.runWorkflow(id, 'jarvis')
    expect(run.trace).toHaveLength(1)
    expect(run.trace.map((t) => t.stepId)).not.toContain('s-nunca-roda')
  })
})

describe('`aguardando aprovação` é marco e auto-continua (critério 5)', () => {
  it('etapa requiresApproval vira marco e o run segue até concluído', () => {
    const id = criarWorkflow([
      { ...etapaOk, id: 's-aprovacao', requiresApproval: true },
      { ...etapaOk, id: 's-depois' }
    ])

    const run = engine.runWorkflow(id, 'jarvis')

    expect(run.trace[0]?.outcome).toBe('marco-aprovacao')
    // Auto-continua: a etapa seguinte rodou e o run concluiu.
    expect(run.trace).toHaveLength(2)
    expect(run.state).toBe('concluido')
  })
})

describe('auditoria e correlationId (critério 6)', () => {
  it('início/fim do run e cada etapa geram AuditEvent; cadeia íntegra', () => {
    const id = criarWorkflow([etapaOk, { ...etapaOk, id: 's-2' }])
    engine.runWorkflow(id, 'jarvis')

    const tipos = audit.list('u-1').map((e) => e.type)
    // 2 marcos de run (início/fim) + 1 por etapa.
    expect(tipos.filter((t) => t === 'execution-run')).toHaveLength(2)
    expect(tipos.filter((t) => t === 'execution-step')).toHaveLength(2)
    expect(audit.verify('u-1').ok).toBe(true)
  })

  it('o correlationId do run aparece nos eventos de auditoria', () => {
    const id = criarWorkflow([etapaOk])
    const run = engine.runWorkflow(id, 'jarvis')

    const comCorrelacao = audit
      .list('u-1')
      .filter((e) => (e.payload as { correlationId?: string }).correlationId === run.correlationId)

    // Início, fim e a etapa — todos costurados pelo mesmo correlationId (ADR-005).
    expect(comCorrelacao.length).toBeGreaterThanOrEqual(3)
  })
})
