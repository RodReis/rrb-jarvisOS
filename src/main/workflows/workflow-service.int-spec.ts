/**
 * Registro de workflows/automações contra o SQLite real (SPEC-Execucao-04, categoria Banco).
 *
 * Prova o round-trip do schema pleno (critério 1), que nada dispara (critérios 2/4), que a
 * edição é classificada + auditada com cadeia íntegra (critério 5), e a compatibilidade das
 * etapas com a taxonomia do Policy Engine (critério 6).
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RISK_TAXONOMY } from '@shared/policies'
import type { WorkflowStep } from '@shared/domain/workflows'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { PolicyService } = await import('../policy/policy-service')
const { WorkflowRepository } = await import('./workflow-repository')
const { AutomationRepository } = await import('./automation-repository')
const { WorkflowService } = await import('./workflow-service')

let dir: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let service: InstanceType<typeof WorkflowService>

const etapaExemplo: WorkflowStep = {
  id: 's-1',
  descriptor: { action: 'fs.list-allowed', params: { dir: '/x' } },
  mode: 'sequencial',
  requiresApproval: false
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-wf-'))
  db = openDatabase(join(dir, 'teste.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  const policy = new PolicyService(audit, () => 'u-1')
  service = new WorkflowService(
    new WorkflowRepository(db),
    new AutomationRepository(db),
    policy,
    audit,
    () => 'u-1'
  )
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('workflow — schema pleno e round-trip (critério 1)', () => {
  it('cria com etapas/triggers e relê idêntico; nasce disabled', () => {
    const criado = service.createWorkflow({
      workspace_id: 'jarvis',
      name: 'Daily Summary',
      steps: [
        etapaExemplo,
        { ...etapaExemplo, id: 's-2', mode: 'paralelo', requiresApproval: true }
      ],
      triggers: [{ id: 't-1', type: 'cron', config: { expr: '0 8 * * *' } }]
    })

    expect(criado.status).toBe('disabled')

    const [lido] = service.listWorkflows('jarvis')
    expect(lido?.name).toBe('Daily Summary')
    expect(lido?.steps).toHaveLength(2)
    expect(lido?.steps[1]?.mode).toBe('paralelo')
    expect(lido?.steps[1]?.requiresApproval).toBe(true)
    expect(lido?.triggers[0]?.type).toBe('cron')
  })

  it('é escopado por usuário e workspace', () => {
    service.createWorkflow({ workspace_id: 'jarvis', name: 'W-jarvis', steps: [etapaExemplo] })
    // Outro workspace do mesmo usuário não vê o workflow do JARVIS.
    expect(service.listWorkflows('noa')).toHaveLength(0)
    expect(service.listWorkflows('jarvis')).toHaveLength(1)
  })
})

describe('nada dispara e nenhuma execução ocorre (critérios 2 e 4)', () => {
  it('registrar um trigger cron não agenda nada — lastRun/nextRun ficam nulos', () => {
    const wf = service.createWorkflow({
      workspace_id: 'jarvis',
      name: 'Com cron',
      steps: [etapaExemplo],
      triggers: [{ id: 't-1', type: 'cron', config: { expr: '* * * * *' } }]
    })
    expect(wf.lastRun).toBeUndefined()
    expect(wf.nextRun).toBeUndefined()
  })

  it('ativar o workflow muda o status, mas não executa etapa (lastRun continua nulo)', () => {
    const wf = service.createWorkflow({ workspace_id: 'jarvis', name: 'W', steps: [etapaExemplo] })
    const ativado = service.setWorkflowStatus(wf.id, 'online')
    expect(ativado?.status).toBe('online')
    expect(ativado?.lastRun).toBeUndefined() // catálogo, não execução
  })
})

describe('edição é classificada e auditada; cadeia íntegra (critério 5)', () => {
  it('criar workflow gera decisão de política + evento workflow-change', () => {
    service.createWorkflow({ workspace_id: 'jarvis', name: 'W', steps: [etapaExemplo] })

    const tipos = audit.list('u-1').map((e) => e.type)
    expect(tipos).toContain('policy-decision') // a classificação (F02)
    expect(tipos).toContain('workflow-change') // a mudança de catálogo
    expect(audit.verify('u-1').ok).toBe(true)
  })

  it('cada mutação encadeia; N edições ⇒ cadeia continua íntegra', () => {
    const wf = service.createWorkflow({ workspace_id: 'jarvis', name: 'W', steps: [etapaExemplo] })
    service.setWorkflowStatus(wf.id, 'online')
    service.updateWorkflow(wf.id, { name: 'W renomeado' })
    expect(audit.verify('u-1').ok).toBe(true)
  })
})

describe('automação (RF-007, critério 3)', () => {
  it('cria com gatilho e alvo; nasce desabilitada e é auditada', () => {
    const auto = service.createAutomation({
      workspace_id: 'jarvis',
      name: 'Alerta',
      trigger: { id: 't-1', type: 'manual' },
      target: { descriptor: { action: 'message.internal-draft' } }
    })
    expect(auto.enabled).toBe(false)
    expect(auto.retryCount).toBe(0)
    expect(audit.list('u-1').map((e) => e.type)).toContain('automation-change')
  })

  it('ativar/desativar persiste e não dispara', () => {
    const auto = service.createAutomation({
      workspace_id: 'jarvis',
      name: 'A',
      trigger: { id: 't-1', type: 'manual' },
      target: { workflowId: 'wf-x' }
    })
    const ativada = service.setAutomationEnabled(auto.id, true)
    expect(ativada?.enabled).toBe(true)
    expect(ativada?.lastRun).toBeUndefined()
  })
})

describe('etapas são compatíveis com a taxonomia do Policy Engine (critério 6)', () => {
  it('a ação de uma etapa é um id reconhecido pela taxonomia — a Fatia 05 poderá classificar', () => {
    // O elo 04→02→05: `descriptor.action` casa com uma entrada do seed do Policy Engine.
    expect(RISK_TAXONOMY.has(etapaExemplo.descriptor.action)).toBe(true)
  })
})
