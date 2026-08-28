/**
 * Motor de filesystem real (SPEC-ExecucaoReal-01).
 *
 * Este módulo é a virada do modo report para enforcement: a decisão de política e a
 * allowlist deixam de ser só rastro e passam a impedir ou pausar operações de verdade.
 * Ele toca apenas filesystem; processo/terminal fica para a F02.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { PolicyDecision } from '@shared/policies'
import { isPathAllowed } from '@shared/policies'
import { redact } from '@shared/contracts/logging-redaction'
import type { WorkspaceId } from '@shared/domain/entities'
import type {
  ApprovalDecision,
  ApprovalRequest,
  ExecutionRun,
  ExecutionState,
  StepTrace
} from '@shared/domain/execution'
import type { Workflow, WorkflowStep } from '@shared/domain/workflows'
import { log } from '../logging/logger'
import { canonicalize } from '../policy/allowlist-canon'
import type { AllowlistRepository } from '../policy/allowlist-repository'
import type { PolicyService } from '../policy/policy-service'
import type { AuditRepository } from '../storage/audit-repository'
import type { WorkflowRepository } from '../workflows/workflow-repository'
import type { ApprovalRepository } from './approval-repository'
import type { ExecutionRepository } from './execution-repository'

type FsOperationKind = 'read' | 'write' | 'delete' | 'move' | 'overwrite'

interface FsOperation {
  readonly kind: FsOperationKind
  readonly path: string
  readonly targetPath?: string
  readonly content?: string
}

function stringParam(step: WorkflowStep, key: string): string | undefined {
  const value = step.descriptor.params?.[key]
  return typeof value === 'string' ? value : undefined
}

function operationFromStep(step: WorkflowStep): FsOperation | undefined {
  const path = stringParam(step, 'path')
  if (!path) return undefined

  switch (step.descriptor.action) {
    case 'fs.list-allowed':
      return { kind: 'read', path }
    case 'fs.write-allowed':
      return {
        kind: existsSync(path) ? 'overwrite' : 'write',
        path,
        content: stringParam(step, 'content') ?? ''
      }
    case 'fs.delete-move-overwrite': {
      const operation = stringParam(step, 'operation')
      if (operation === 'delete') return { kind: 'delete', path }
      if (operation === 'move') {
        const targetPath = stringParam(step, 'targetPath')
        return targetPath ? { kind: 'move', path, targetPath } : undefined
      }
      if (operation === 'overwrite') {
        return { kind: 'overwrite', path, content: stringParam(step, 'content') ?? '' }
      }
      return undefined
    }
    case 'secrets.change':
      return { kind: 'overwrite', path, content: stringParam(step, 'content') ?? '' }
    default:
      return undefined
  }
}

function operationFromStored(raw: Readonly<Record<string, unknown>>): FsOperation | undefined {
  const kind = raw['kind']
  const path = raw['path']
  const targetPath = raw['targetPath']
  const content = raw['content']

  if (
    kind !== 'read' &&
    kind !== 'write' &&
    kind !== 'delete' &&
    kind !== 'move' &&
    kind !== 'overwrite'
  ) {
    return undefined
  }
  if (typeof path !== 'string') return undefined

  return {
    kind,
    path,
    ...(typeof targetPath === 'string' ? { targetPath } : {}),
    ...(typeof content === 'string' ? { content } : {})
  }
}

function isDestructive(operation: FsOperation): boolean {
  return operation.kind === 'delete' || operation.kind === 'move' || operation.kind === 'overwrite'
}

function isSecretPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/').toLowerCase()
  return /(^|\/)(\.env|.*secret.*|.*token.*|.*vault.*)$/.test(normalized)
}

function operationPayload(operation: FsOperation): Readonly<Record<string, unknown>> {
  return {
    kind: operation.kind,
    path: operation.path,
    ...(operation.targetPath ? { targetPath: operation.targetPath } : {}),
    ...(operation.content !== undefined ? { content: operation.content } : {})
  }
}

function outputSeguro(output: unknown): Readonly<Record<string, unknown>> {
  const redigido = redact(output)
  return typeof redigido === 'object' && redigido !== null
    ? (redigido as Readonly<Record<string, unknown>>)
    : { value: redigido }
}

export class RealFileSystemEngine {
  constructor(
    private readonly workflows: WorkflowRepository,
    private readonly policy: PolicyService,
    private readonly allowlist: AllowlistRepository,
    private readonly runs: ExecutionRepository,
    private readonly approvals: ApprovalRepository,
    private readonly audit: AuditRepository,
    private readonly userId: () => string
  ) {}

  runWorkflow(workflowId: string, workspaceId: WorkspaceId): ExecutionRun {
    const userId = this.userId()
    const correlationId = randomUUID()
    const startedAt = new Date().toISOString()
    const workflow = this.workflows.findById(userId, workflowId)

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'execution-run',
      payload: { modo: 'real-fs', marco: 'inicio', workflowId, correlationId }
    })
    log.agent.info('Execução real de filesystem iniciada', { workflowId, correlationId })

    const base: ExecutionRun = {
      id: randomUUID(),
      user_id: userId,
      workspace_id: workspaceId,
      workflowId: workflow ? workflowId : null,
      state: workflow ? 'em-execucao' : 'cancelado',
      trace: [],
      correlationId,
      startedAt,
      finishedAt: startedAt,
      created_at: startedAt
    }

    if (!workflow) {
      this.runs.save(base)
      return this.finishRun(base, 'cancelado')
    }

    this.runs.save(base)
    const run = this.percorrer(workflow, base, 0)
    if (run.state !== 'aguardando-aprovacao') {
      return this.finishRun(run, run.state)
    }
    return run
  }

  resolveApproval(id: string, decision: ApprovalDecision): ExecutionRun | undefined {
    const userId = this.userId()
    const approval = this.approvals.resolve(userId, id, decision)
    if (!approval) return undefined

    this.audit.append({
      user_id: userId,
      workspace_id: approval.workspace_id as WorkspaceId,
      type: 'approval-request',
      payload: {
        marco: 'resolucao',
        approvalRequestId: approval.id,
        runId: approval.runId,
        stepId: approval.stepId,
        decision
      }
    })

    const run = this.runs.findById(userId, approval.runId)
    if (!run || !run.workflowId) return run

    if (decision === 'negado') {
      return this.finishRun(this.replacePendingTrace(run, approval, 'real-falha'), 'falhou')
    }

    const workflow = this.workflows.findById(userId, run.workflowId)
    if (!workflow)
      return this.finishRun(this.replacePendingTrace(run, approval, 'real-falha'), 'falhou')

    const index = workflow.steps.findIndex((step) => step.id === approval.stepId)
    const step = workflow.steps[index]
    const operation = operationFromStored(approval.operation)
    if (!step || !operation) {
      return this.finishRun(this.replacePendingTrace(run, approval, 'real-falha'), 'falhou')
    }

    const resultado = this.executarOperacao({
      run,
      step,
      operation,
      decision: undefined,
      pathAllowed: false,
      approvedBy: approval.resolved_by
    })
    const atualizado = this.replaceTrace(run, approval.stepId, resultado)

    if (resultado.outcome === 'real-falha') return this.finishRun(atualizado, 'falhou')
    return this.finishRun(this.percorrer(workflow, atualizado, index + 1), 'concluido')
  }

  private percorrer(workflow: Workflow, run: ExecutionRun, startIndex: number): ExecutionRun {
    let atual = run

    for (let index = startIndex; index < workflow.steps.length; index += 1) {
      const step = workflow.steps[index]
      if (!step) continue

      const trace = this.executarEtapa(atual, step)
      atual = { ...atual, trace: [...atual.trace, trace], state: estadoPorOutcome(trace.outcome) }
      this.runs.update(atual)

      if (atual.state === 'aguardando-aprovacao' || atual.state === 'falhou') return atual
    }

    return { ...atual, state: 'concluido' }
  }

  private executarEtapa(run: ExecutionRun, step: WorkflowStep): StepTrace {
    const started = Date.now()
    const operation = operationFromStep(step)

    if (!operation) {
      const decision = this.policy.classify(step.descriptor.action, {
        workspace: run.workspace_id as WorkspaceId,
        detail: step.descriptor.params
      })
      return {
        stepId: step.id,
        action: step.descriptor.action,
        decision,
        outcome: 'bloqueado',
        nota: 'Ação de filesystem não reconhecida para execução real.',
        durationMs: Date.now() - started
      }
    }

    const permitidos = this.allowlist.list(run.user_id)
    const pathAllowed = isPathAllowed(canonicalize(operation.path), permitidos)
    const targetAllowed =
      operation.targetPath === undefined
        ? true
        : isPathAllowed(canonicalize(operation.targetPath), permitidos)

    const sensitivity = isSecretPath(operation.path) ? 'secret' : undefined
    const classifiedDecision = this.policy.classify(step.descriptor.action, {
      workspace: run.workspace_id as WorkspaceId,
      pathAllowed: pathAllowed && targetAllowed,
      ...(sensitivity ? { sensitivity } : {}),
      detail: { ...step.descriptor.params, operation: operation.kind }
    })
    const decision =
      operation.kind === 'write' && pathAllowed && targetAllowed
        ? { ...classifiedDecision, outcome: 'allow' as const }
        : classifiedDecision

    if (operation.kind === 'write' && !pathAllowed) {
      return {
        stepId: step.id,
        action: step.descriptor.action,
        decision: { ...decision, tier: 'bloqueado', outcome: 'block' },
        pathAllowed,
        outcome: 'bloqueado',
        nota: 'Gravação fora da allowlist bloqueada em enforcement fail-closed.',
        durationMs: Date.now() - started
      }
    }

    if (decision.outcome === 'block') {
      return {
        stepId: step.id,
        action: step.descriptor.action,
        decision,
        pathAllowed,
        outcome: 'bloqueado',
        nota: 'Ação bloqueada pelo Policy Engine.',
        durationMs: Date.now() - started
      }
    }

    if (decision.outcome === 'requires-approval' || isDestructive(operation)) {
      return this.criarAprovacao(run, step, operation, decision, pathAllowed, started)
    }

    return this.executarOperacao({ run, step, operation, decision, pathAllowed })
  }

  private criarAprovacao(
    run: ExecutionRun,
    step: WorkflowStep,
    operation: FsOperation,
    decision: PolicyDecision,
    pathAllowed: boolean,
    started: number
  ): StepTrace {
    const request: ApprovalRequest = {
      id: randomUUID(),
      user_id: run.user_id,
      workspace_id: run.workspace_id,
      runId: run.id,
      stepId: step.id,
      action: step.descriptor.action,
      status: 'pendente',
      risk: isDestructive(operation) ? 'alto' : decision.tier,
      reason: decision.reason,
      operation: operationPayload(operation),
      created_at: new Date().toISOString()
    }
    this.approvals.create(request)
    this.audit.append({
      user_id: run.user_id,
      workspace_id: run.workspace_id as WorkspaceId,
      type: 'approval-request',
      payload: {
        marco: 'criacao',
        approvalRequestId: request.id,
        runId: run.id,
        stepId: step.id,
        action: step.descriptor.action,
        operation: outputSeguro(operationPayload(operation))
      }
    })

    return {
      stepId: step.id,
      action: step.descriptor.action,
      decision: isDestructive(operation)
        ? { ...decision, tier: 'alto', outcome: 'requires-approval' }
        : decision,
      pathAllowed,
      outcome: 'aguardando-aprovacao',
      approvalRequestId: request.id,
      nota: 'Execução pausada aguardando aprovação humana.',
      durationMs: Date.now() - started
    }
  }

  private executarOperacao({
    run,
    step,
    operation,
    decision,
    pathAllowed,
    approvedBy
  }: {
    readonly run: ExecutionRun
    readonly step: WorkflowStep
    readonly operation: FsOperation
    readonly decision: PolicyDecision | undefined
    readonly pathAllowed: boolean
    readonly approvedBy?: string
  }): StepTrace {
    const started = Date.now()
    const policyDecision =
      decision ??
      this.policy.classify(step.descriptor.action, {
        workspace: run.workspace_id as WorkspaceId,
        pathAllowed,
        detail: { operation: operation.kind, approvedBy }
      })

    this.audit.append({
      user_id: run.user_id,
      workspace_id: run.workspace_id as WorkspaceId,
      type: 'filesystem-operation',
      payload: {
        marco: 'antes',
        runId: run.id,
        stepId: step.id,
        action: step.descriptor.action,
        operation: outputSeguro(operationPayload(operation)),
        approvedBy: approvedBy ?? null
      }
    })

    try {
      const output = this.apply(operation)
      this.audit.append({
        user_id: run.user_id,
        workspace_id: run.workspace_id as WorkspaceId,
        type: 'filesystem-operation',
        payload: {
          marco: 'depois',
          runId: run.id,
          stepId: step.id,
          action: step.descriptor.action,
          output: outputSeguro(output)
        }
      })
      log.agent.info('Operação real de filesystem concluída', {
        runId: run.id,
        stepId: step.id,
        operation: operation.kind,
        correlationId: run.correlationId
      })
      return {
        stepId: step.id,
        action: step.descriptor.action,
        decision: policyDecision,
        pathAllowed,
        outcome: 'real-ok',
        nota: 'Operação de filesystem executada.',
        output: outputSeguro(output),
        durationMs: Date.now() - started
      }
    } catch (error) {
      this.audit.append({
        user_id: run.user_id,
        workspace_id: run.workspace_id as WorkspaceId,
        type: 'filesystem-operation',
        payload: {
          marco: 'erro',
          runId: run.id,
          stepId: step.id,
          action: step.descriptor.action,
          error: outputSeguro(error instanceof Error ? { message: error.message } : { error })
        }
      })
      log.agent.error('Operação real de filesystem falhou', {
        runId: run.id,
        stepId: step.id,
        operation: operation.kind,
        error,
        correlationId: run.correlationId
      })
      return {
        stepId: step.id,
        action: step.descriptor.action,
        decision: policyDecision,
        pathAllowed,
        outcome: 'real-falha',
        nota: 'Operação de filesystem falhou.',
        output: outputSeguro(error instanceof Error ? { error: error.message } : { error }),
        durationMs: Date.now() - started
      }
    }
  }

  private apply(operation: FsOperation): Readonly<Record<string, unknown>> {
    switch (operation.kind) {
      case 'read':
        return { content: readFileSync(operation.path, 'utf8') }
      case 'write':
      case 'overwrite':
        mkdirSync(dirname(operation.path), { recursive: true })
        writeFileSync(operation.path, operation.content ?? '', 'utf8')
        return { path: operation.path, bytes: Buffer.byteLength(operation.content ?? '', 'utf8') }
      case 'delete':
        rmSync(operation.path, { recursive: true, force: false })
        return { path: operation.path, removed: true }
      case 'move':
        if (!operation.targetPath) throw new Error('Destino ausente para mover arquivo.')
        mkdirSync(dirname(operation.targetPath), { recursive: true })
        renameSync(operation.path, operation.targetPath)
        return { path: operation.path, targetPath: operation.targetPath, moved: true }
    }
  }

  private replacePendingTrace(
    run: ExecutionRun,
    approval: ApprovalRequest,
    outcome: 'real-falha'
  ): ExecutionRun {
    const trace = this.replaceTraceItem(run, approval.stepId, {
      outcome,
      nota: 'Aprovação negada; operação não executada.',
      durationMs: 0
    })
    return { ...run, trace }
  }

  private replaceTrace(run: ExecutionRun, stepId: string, trace: StepTrace): ExecutionRun {
    return { ...run, trace: run.trace.map((item) => (item.stepId === stepId ? trace : item)) }
  }

  private replaceTraceItem(
    run: ExecutionRun,
    stepId: string,
    patch: Partial<StepTrace>
  ): readonly StepTrace[] {
    return run.trace.map((item) => (item.stepId === stepId ? { ...item, ...patch } : item))
  }

  private finishRun(run: ExecutionRun, state: ExecutionState): ExecutionRun {
    const finishedAt = new Date().toISOString()
    const finalRun = { ...run, state, finishedAt }
    this.runs.update(finalRun)
    this.audit.append({
      user_id: run.user_id,
      workspace_id: run.workspace_id as WorkspaceId,
      type: 'execution-run',
      payload: {
        modo: 'real-fs',
        marco: 'fim',
        runId: run.id,
        state,
        correlationId: run.correlationId
      }
    })
    log.agent.info('Execução real de filesystem concluída', {
      runId: run.id,
      state,
      correlationId: run.correlationId
    })
    return finalRun
  }
}

function estadoPorOutcome(outcome: StepTrace['outcome']): ExecutionState {
  if (outcome === 'aguardando-aprovacao') return 'aguardando-aprovacao'
  if (outcome === 'bloqueado' || outcome === 'real-falha') return 'falhou'
  return 'em-execucao'
}
