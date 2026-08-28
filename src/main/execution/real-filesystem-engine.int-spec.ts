/**
 * Execução real de filesystem (SPEC-ExecucaoReal-01, categoria Banco).
 *
 * A prova aqui é por efeito: arquivo permitido nasce no disco, arquivo fora da allowlist não
 * nasce, destrutivo não acontece sem aprovação, e a cadeia de auditoria continua íntegra.
 */

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
const { ApprovalRepository } = await import('./approval-repository')
const { RealFileSystemEngine } = await import('./real-filesystem-engine')

let dir: string
let appDir: string
let permitido: string
let fora: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let workflows: InstanceType<typeof WorkflowRepository>
let runs: InstanceType<typeof ExecutionRepository>
let approvals: InstanceType<typeof ApprovalRepository>
let engine: InstanceType<typeof RealFileSystemEngine>

function etapa(over: Partial<WorkflowStep>): WorkflowStep {
  return {
    id: 's-1',
    descriptor: { action: 'fs.write-allowed', params: {} },
    mode: 'sequencial',
    requiresApproval: false,
    ...over
  }
}

function criarWorkflow(steps: readonly WorkflowStep[]): string {
  return workflows.create({
    user_id: 'u-1',
    workspace_id: 'jarvis',
    name: 'FS real',
    steps
  }).id
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-fs-real-'))
  appDir = join(dir, 'userData')
  permitido = join(dir, 'permitido')
  fora = join(dir, 'fora')
  mkdirSync(appDir)
  mkdirSync(permitido)
  mkdirSync(fora)

  db = openDatabase(join(dir, 'teste.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  workflows = new WorkflowRepository(db)
  runs = new ExecutionRepository(db)
  approvals = new ApprovalRepository(db)
  const allowlist = new AllowlistRepository(db, audit, appDir)
  allowlist.add('u-1', permitido)

  engine = new RealFileSystemEngine(
    workflows,
    new PolicyService(audit, () => 'u-1'),
    allowlist,
    runs,
    approvals,
    audit,
    () => 'u-1'
  )
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('enforcement de filesystem real', () => {
  it('grava arquivo dentro da allowlist e audita antes/depois', () => {
    const alvo = join(permitido, 'saida.txt')
    const id = criarWorkflow([
      etapa({
        descriptor: { action: 'fs.write-allowed', params: { path: alvo, content: 'ok' } }
      })
    ])

    const run = engine.runWorkflow(id, 'jarvis')

    expect(run.state).toBe('concluido')
    expect(readFileSync(alvo, 'utf8')).toBe('ok')
    expect(run.trace[0]?.outcome).toBe('real-ok')

    const eventos = audit.list('u-1')
    expect(eventos.filter((e) => e.type === 'filesystem-operation')).toHaveLength(2)
    expect(audit.verify('u-1').ok).toBe(true)
  })

  it('bloqueia gravação fora da allowlist sem criar arquivo', () => {
    const alvo = join(fora, 'nao-criar.txt')
    const id = criarWorkflow([
      etapa({
        descriptor: { action: 'fs.write-allowed', params: { path: alvo, content: 'vazou' } }
      })
    ])

    const run = engine.runWorkflow(id, 'jarvis')

    expect(run.state).toBe('falhou')
    expect(existsSync(alvo)).toBe(false)
    expect(run.trace[0]?.outcome).toBe('bloqueado')
    expect(approvals.listPending('u-1', 'jarvis')).toHaveLength(0)
  })

  it('pausa leitura fora da allowlist e só lê depois da aprovação', () => {
    const alvo = join(fora, 'entrada.txt')
    writeFileSync(alvo, 'conteudo externo')
    const id = criarWorkflow([
      etapa({
        descriptor: { action: 'fs.list-allowed', params: { path: alvo } }
      })
    ])

    const pendente = engine.runWorkflow(id, 'jarvis')
    const fila = approvals.listPending('u-1', 'jarvis')

    expect(pendente.state).toBe('aguardando-aprovacao')
    expect(fila).toHaveLength(1)
    expect(pendente.trace[0]?.outcome).toBe('aguardando-aprovacao')

    const concluido = engine.resolveApproval(fila[0]!.id, 'aprovado')

    expect(concluido?.state).toBe('concluido')
    expect(concluido?.trace[0]?.outcome).toBe('real-ok')
    expect(concluido?.trace[0]?.output).toEqual({ content: 'conteudo externo' })
    expect(audit.list('u-1').filter((e) => e.type === 'approval-request')).toHaveLength(2)
  })

  it('nega operação destrutiva sem apagar e aprova apagando de verdade', () => {
    const negado = join(permitido, 'negado.txt')
    const aprovado = join(permitido, 'aprovado.txt')
    writeFileSync(negado, 'fica')
    writeFileSync(aprovado, 'remove')

    const runNegado = engine.runWorkflow(
      criarWorkflow([
        etapa({
          id: 'delete-negado',
          descriptor: {
            action: 'fs.delete-move-overwrite',
            params: { operation: 'delete', path: negado }
          }
        })
      ]),
      'jarvis'
    )
    const reqNegada = approvals.listPending('u-1', 'jarvis')[0]!

    expect(runNegado.state).toBe('aguardando-aprovacao')
    expect(existsSync(negado)).toBe(true)

    const depoisNegado = engine.resolveApproval(reqNegada.id, 'negado')

    expect(depoisNegado?.state).toBe('falhou')
    expect(existsSync(negado)).toBe(true)

    engine.runWorkflow(
      criarWorkflow([
        etapa({
          id: 'delete-aprovado',
          descriptor: {
            action: 'fs.delete-move-overwrite',
            params: { operation: 'delete', path: aprovado }
          }
        })
      ]),
      'jarvis'
    )
    const reqAprovada = approvals.listPending('u-1', 'jarvis')[0]!

    const depoisAprovado = engine.resolveApproval(reqAprovada.id, 'aprovado')

    expect(depoisAprovado?.state).toBe('concluido')
    expect(existsSync(aprovado)).toBe(false)
  })
})
