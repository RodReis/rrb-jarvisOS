/**
 * Serviço de workflows e automações (SPEC-Execucao-04).
 *
 * Junta três responsabilidades que os repositórios (só persistência) não têm:
 *  - **classificar** a edição pelo Policy Engine (Fatia 02) — criar/alterar/ativar workflow
 *    ou automação é `médio` risco (requisitos); a decisão é registrada;
 *  - **auditar** a mudança (ADR-004), com tipo próprio (`workflow-change`/`automation-change`);
 *  - delegar o CRUD aos repositórios.
 *
 * **Nada executa.** Ativar um workflow muda o status para `online` no catálogo; nenhuma etapa
 * roda (executar é a Fatia 05). O Policy Engine aqui está em **modo report** (F02): classifica
 * e audita, não barra — inclusive porque editar catálogo não é a ação de runtime que a
 * taxonomia mira, e sim uma mudança de configuração.
 */

import type { PolicyService } from '../policy/policy-service'
import type { WorkflowRepository } from './workflow-repository'
import type { AutomationRepository } from './automation-repository'
import type {
  Automation,
  AutomationInput,
  Workflow,
  WorkflowInput,
  WorkflowStatus
} from '@shared/domain/workflows'
import type { AuditRepository } from '../storage/audit-repository'
import { log } from '../logging/logger'

/** Ação da taxonomia (Fatia 02) que representa editar automação/workflow: médio risco. */
const ACAO_UPSERT_AUTOMACAO = 'automation.upsert'
/** Ativar/desativar workflow é `workflow.toggle` na taxonomia (também médio). */
const ACAO_TOGGLE_WORKFLOW = 'workflow.toggle'

export class WorkflowService {
  constructor(
    private readonly workflows: WorkflowRepository,
    private readonly automations: AutomationRepository,
    private readonly policy: PolicyService,
    private readonly audit: AuditRepository,
    private readonly userId: () => string
  ) {}

  /**
   * Classifica a edição pelo Policy Engine e audita, antes de devolver. Chamado por cada
   * mutação abaixo. O `evaluate` roda em modo report (não barra); registrar a classificação
   * é o que o critério 5 pede.
   */
  private classificarEauditar(
    action: string,
    workspaceId: Workflow['workspace_id'],
    tipo: 'workflow-change' | 'automation-change',
    payload: Readonly<Record<string, unknown>>
  ): void {
    // A classificação já gera seu próprio AuditEvent (policy-decision). Este audit é a
    // mudança de catálogo em si — evento distinto, tipo próprio, para a auditoria separar
    // "classifiquei a edição" de "a edição aconteceu".
    this.policy.classify(action, { workspace: workspaceId })
    this.audit.append({ user_id: this.userId(), workspace_id: workspaceId, type: tipo, payload })
  }

  // --- Workflows ------------------------------------------------------------

  createWorkflow(input: Omit<WorkflowInput, 'user_id'>): Workflow {
    const workflow = this.workflows.create({ ...input, user_id: this.userId() })
    this.classificarEauditar(ACAO_UPSERT_AUTOMACAO, input.workspace_id, 'workflow-change', {
      op: 'create',
      workflowId: workflow.id
    })
    log.agent.info('Workflow registrado', { workflowId: workflow.id, status: workflow.status })
    return workflow
  }

  listWorkflows(workspaceId: Workflow['workspace_id']): readonly Workflow[] {
    return this.workflows.list(this.userId(), workspaceId)
  }

  updateWorkflow(
    id: string,
    patch: Partial<Pick<Workflow, 'name' | 'steps' | 'triggers' | 'schedule'>>
  ): Workflow | undefined {
    const workflow = this.workflows.update(this.userId(), id, patch)
    if (workflow) {
      this.classificarEauditar(ACAO_UPSERT_AUTOMACAO, workflow.workspace_id, 'workflow-change', {
        op: 'update',
        workflowId: id
      })
    }
    return workflow
  }

  setWorkflowStatus(id: string, status: WorkflowStatus): Workflow | undefined {
    const workflow = this.workflows.setStatus(this.userId(), id, status)
    if (workflow) {
      this.classificarEauditar(ACAO_TOGGLE_WORKFLOW, workflow.workspace_id, 'workflow-change', {
        op: 'set-status',
        workflowId: id,
        status
      })
    }
    return workflow
  }

  removeWorkflow(id: string, workspaceId: Workflow['workspace_id']): boolean {
    const removido = this.workflows.remove(this.userId(), id)
    if (removido) {
      this.classificarEauditar(ACAO_UPSERT_AUTOMACAO, workspaceId, 'workflow-change', {
        op: 'remove',
        workflowId: id
      })
    }
    return removido
  }

  // --- Automações -----------------------------------------------------------

  createAutomation(input: Omit<AutomationInput, 'user_id'>): Automation {
    const automation = this.automations.create({ ...input, user_id: this.userId() })
    this.classificarEauditar(ACAO_UPSERT_AUTOMACAO, input.workspace_id, 'automation-change', {
      op: 'create',
      automationId: automation.id
    })
    return automation
  }

  listAutomations(workspaceId: Automation['workspace_id']): readonly Automation[] {
    return this.automations.list(this.userId(), workspaceId)
  }

  setAutomationEnabled(id: string, enabled: boolean): Automation | undefined {
    const automation = this.automations.setEnabled(this.userId(), id, enabled)
    if (automation) {
      this.classificarEauditar(
        ACAO_UPSERT_AUTOMACAO,
        automation.workspace_id,
        'automation-change',
        { op: 'set-enabled', automationId: id, enabled }
      )
    }
    return automation
  }

  removeAutomation(id: string, workspaceId: Automation['workspace_id']): boolean {
    const removido = this.automations.remove(this.userId(), id)
    if (removido) {
      this.classificarEauditar(ACAO_UPSERT_AUTOMACAO, workspaceId, 'automation-change', {
        op: 'remove',
        automationId: id
      })
    }
    return removido
  }
}
