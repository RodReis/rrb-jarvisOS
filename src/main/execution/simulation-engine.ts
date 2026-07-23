/**
 * Motor de execução em modo simulado (SPEC-Execucao-05) — a headline do MVP-002.
 *
 * Percorre as etapas de um workflow (Fatia 04) **sem tocar recurso real**, classificando cada
 * uma (Fatia 02) e checando paths na allowlist (Fatia 03), e produz um `ExecutionRun`
 * rastreável, auditado (ADR-004) e logado (ADR-005). É a prova de que o caminho seguro de
 * execução funciona ponta a ponta — com **zero efeito colateral**.
 *
 * **O invariante desta fatia é a ausência.** Este arquivo não importa `node:fs`,
 * `node:child_process`, nem nada de rede — não por esquecimento, por desenho. "Simular" uma
 * ação é produzir o veredito e a nota que ela *teria*, nunca executá-la. Classificação e
 * allowlist rodam em **modo report**: entram no trace, não barram. Barrar de verdade é o
 * MVP-003.
 */

import { randomUUID } from 'node:crypto'
import type { PolicyService } from '../policy/policy-service'
import type { AllowlistRepository } from '../policy/allowlist-repository'
import type { WorkflowRepository } from '../workflows/workflow-repository'
import type { ExecutionRepository } from './execution-repository'
import { canonicalize } from '../policy/allowlist-canon'
import { isPathAllowed } from '@shared/policies'
import type { ExecutionRun, ExecutionState, StepTrace } from '@shared/domain/execution'
import type { Workflow, WorkflowStep } from '@shared/domain/workflows'
import type { WorkspaceId } from '@shared/domain/entities'
import type { AuditRepository } from '../storage/audit-repository'
import { log } from '../logging/logger'

/**
 * Uma etapa declara que quer simular falha via `params.simulateFailure: true` (decisão do
 * PI). Fica no dado do workflow, não no schema — some naturalmente quando a execução for
 * real (MVP-003), sem deixar campo morto.
 */
function querSimularFalha(step: WorkflowStep): boolean {
  return step.descriptor.params?.['simulateFailure'] === true
}

/** O path que a etapa referencia, se houver. Convenção: `params.path`. */
function pathDaEtapa(step: WorkflowStep): string | undefined {
  const p = step.descriptor.params?.['path']
  return typeof p === 'string' ? p : undefined
}

export class SimulationEngine {
  constructor(
    private readonly workflows: WorkflowRepository,
    private readonly policy: PolicyService,
    private readonly allowlist: AllowlistRepository,
    private readonly runs: ExecutionRepository,
    private readonly audit: AuditRepository,
    private readonly userId: () => string
  ) {}

  /**
   * Roda um workflow em modo simulado por gatilho manual, e devolve o `ExecutionRun`.
   *
   * O run tem um `correlationId` que costura suas entradas de log (ADR-005) e é o mesmo em
   * todo o trace. Início e fim geram `AuditEvent` (ADR-004), e cada etapa também — "cada
   * execução gera rastreio auditável" (RF-006).
   */
  runWorkflow(workflowId: string, workspaceId: WorkspaceId): ExecutionRun {
    const userId = this.userId()
    const correlationId = randomUUID()
    const startedAt = new Date().toISOString()

    const workflow = this.workflows.findById(userId, workflowId)

    // Auditoria de início. Se o workflow não existe, o run nasce e morre `cancelado` — um
    // gatilho para um id inexistente é um fato a registrar, não um erro a engolir.
    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'execution-run',
      payload: { marco: 'inicio', workflowId, correlationId }
    })
    log.agent.info('Execução simulada iniciada', { workflowId, correlationId })

    const { trace, state } = workflow
      ? this.percorrer(workflow, workspaceId, correlationId)
      : { trace: [] as StepTrace[], state: 'cancelado' as ExecutionState }

    const finishedAt = new Date().toISOString()
    const run: ExecutionRun = {
      id: randomUUID(),
      user_id: userId,
      workspace_id: workspaceId,
      workflowId: workflow ? workflowId : null,
      state,
      trace,
      correlationId,
      startedAt,
      finishedAt,
      created_at: finishedAt
    }

    this.runs.save(run)

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'execution-run',
      payload: { marco: 'fim', runId: run.id, state, correlationId }
    })
    log.agent.info('Execução simulada concluída', { runId: run.id, state, correlationId })

    return run
  }

  /**
   * Percorre as etapas e monta o trace. Devolve o estado final.
   *
   * Semântica das etapas: uma etapa que **falha** encerra o run em `falhou` — as seguintes
   * não são percorridas (não há retentativa real nesta fatia; o caminho de falha é o que se
   * exercita). `requiresApproval` vira **marco** e o run **auto-continua** (o fluxo de
   * aprovação é MVP-003). Paralelo é honrado semanticamente: a ordem do array basta, o
   * simulador não precisa de concorrência real.
   */
  private percorrer(
    workflow: Workflow,
    workspaceId: WorkspaceId,
    correlationId: string
  ): { trace: StepTrace[]; state: ExecutionState } {
    const trace: StepTrace[] = []

    for (const step of workflow.steps) {
      const stepTrace = this.simularEtapa(step, workspaceId, correlationId)
      trace.push(stepTrace)

      // Uma falha simulada encerra o run. As etapas restantes não rodam.
      if (stepTrace.outcome === 'simulado-falha') {
        return { trace, state: 'falhou' }
      }
    }

    return { trace, state: 'concluido' }
  }

  /**
   * Simula **uma** etapa: classifica (F02), checa allowlist se há path (F03), e produz o
   * resultado — sempre sem efeito real. Audita a etapa e loga com o `correlationId` do run.
   */
  private simularEtapa(
    step: WorkflowStep,
    workspaceId: WorkspaceId,
    correlationId: string
  ): StepTrace {
    const inicio = Date.now()
    const userId = this.userId()
    const path = pathDaEtapa(step)

    // F03 — checa a allowlist se a etapa referencia um path. `undefined` = sem path. O
    // resultado entra no trace e alimenta a classificação; **não** barra (modo report).
    let pathAllowed: boolean | undefined
    if (path !== undefined) {
      const permitidos = this.allowlist.list(userId)
      pathAllowed = isPathAllowed(canonicalize(path), permitidos)
    }

    // F02 — classifica a etapa. O path (dentro/fora) é insumo da decisão (Fatia 03→02).
    const decision = this.policy.classify(step.descriptor.action, {
      workspace: workspaceId,
      ...(pathAllowed !== undefined ? { pathAllowed } : {}),
      detail: step.descriptor.params
    })

    // O resultado simulado. Precedência: aprovação é marco (auto-continua); depois, falha
    // declarada; senão, sucesso. Nenhum ramo toca recurso real.
    let outcome: StepTrace['outcome']
    let nota: string
    if (step.requiresApproval) {
      outcome = 'marco-aprovacao'
      nota = 'Etapa exigiria aprovação humana; na simulação o run auto-continua (MVP-003).'
    } else if (querSimularFalha(step)) {
      outcome = 'simulado-falha'
      nota = 'Falha simulada declarada pela etapa (params.simulateFailure).'
    } else {
      outcome = 'simulado-ok'
      nota = `Ação "${step.descriptor.action}" simulada — nenhum efeito real produzido.`
    }

    const stepTrace: StepTrace = {
      stepId: step.id,
      action: step.descriptor.action,
      decision,
      ...(pathAllowed !== undefined ? { pathAllowed } : {}),
      outcome,
      nota,
      durationMs: Date.now() - inicio
    }

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'execution-step',
      payload: {
        stepId: step.id,
        action: step.descriptor.action,
        tier: decision.tier,
        outcome,
        correlationId
      }
    })
    log.agent.info('Etapa simulada', {
      stepId: step.id,
      action: step.descriptor.action,
      outcome,
      correlationId
    })

    return stepTrace
  }
}
