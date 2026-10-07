/** Aprovação do PI para ações sensíveis de um run do Squad. */
import { createHash, randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { ApprovalDecision, ApprovalRequest } from '@shared/domain/execution'
import type { WorkspaceId } from '@shared/domain/entities'
import type { TarefaDoPlano } from '@shared/domain/squad-plano'
import type { PerfilDeCi } from '@shared/domain/ci-profile'
import { matchDestructivePattern } from '@shared/policies'
import type { ApprovalRepository } from '../execution/approval-repository'
import type { PolicyService } from '../policy/policy-service'
import type { AuditRepository } from '../storage/audit-repository'
import type { PipelineRepository } from '../pipeline/pipeline-repository'

export interface PedidoSensivelDoSquad {
  readonly runId: string
  readonly projectId: string
  readonly workspaceId: WorkspaceId
  readonly tarefaId: string
  readonly acao: 'alteracao-estrutural-de-banco' | 'comando-destrutivo'
  readonly alvo: string
  readonly signal?: AbortSignal
}

export interface SquadAprovacaoDeps {
  readonly db: Database
  readonly requests: Pick<ApprovalRepository, 'create' | 'findById' | 'listPending' | 'resolve'>
  readonly policy: Pick<PolicyService, 'classify'>
  readonly audit: Pick<AuditRepository, 'append'>
  readonly runs: Pick<PipelineRepository, 'buscar' | 'workspaceDoRun'>
  readonly userId: () => string
}

const ACAO_DA_POLITICA = {
  'alteracao-estrutural-de-banco': 'db.alter-structure',
  'comando-destrutivo': 'terminal.run-destructive'
} as const

export function alteraEstruturaDeBanco(tarefa: Pick<TarefaDoPlano, 'paths'>): boolean {
  return tarefa.paths.some((path) =>
    /(?:^|\/)(?:migrations?|schema)(?:\/|\.|$)|(?:^|\/)schema\.prisma$/i.test(
      path.replaceAll('\\', '/')
    )
  )
}

export function comandosDestrutivosDoPerfil(perfil: PerfilDeCi): readonly (readonly string[])[] {
  return [perfil.instalacao, ...perfil.validacoes]
    .map((etapa) => etapa.argv)
    .filter((argv) => {
      const [binario, ...args] = argv
      if (binario === undefined) return true
      if (matchDestructivePattern(binario, args) !== undefined) return true
      // Scripts podem esconder a migração num gerenciador de pacotes. O nome suspeito exige PI.
      return args.some((arg) =>
        /(?:^|[:_-])(migrate|migration|drop|destroy|reset)(?:$|[:_-])/i.test(arg)
      )
    })
}

export class SquadAprovacaoService {
  private readonly esperando = new Map<string, (aprovado: boolean) => void>()

  constructor(private readonly deps: SquadAprovacaoDeps) {}

  pendentesDoRun(runId: string, workspaceId: WorkspaceId): readonly ApprovalRequest[] {
    return this.deps.requests
      .listPending(this.deps.userId(), workspaceId)
      .filter(
        (item) =>
          item.runId === runId && item.operation['kind'] === 'squad' && this.esperando.has(item.id)
      )
  }

  /** No boot, pedido sem executor vivo é recusado e auditado; nunca autoriza efeito após crash. */
  reconciliarPendentes(): void {
    for (const workspace of ['noa', 'jarvis'] as const) {
      for (const request of this.deps.requests.listPending(this.deps.userId(), workspace)) {
        if (request.operation['kind'] === 'squad' && !this.esperando.has(request.id)) {
          this.encerrar(request.id, false, 'processo-reiniciado')
        }
      }
    }
  }

  async exigir(pedido: PedidoSensivelDoSquad): Promise<boolean> {
    if (!this.runAtivo(pedido.runId, pedido.projectId, pedido.workspaceId)) return false
    if (pedido.signal?.aborted) return false
    const userId = this.deps.userId()
    const acao = ACAO_DA_POLITICA[pedido.acao]
    const decisao = this.deps.policy.classify(acao, {
      workspace: pedido.workspaceId,
      detail: { runId: pedido.runId, tarefaId: pedido.tarefaId }
    })
    // A ação sensível nunca passa com `allow`; um seed de política incorreto falha fechado.
    if (decisao.outcome === 'allow') return false
    const alvoHash = createHash('sha256').update(pedido.alvo).digest('hex')
    const request: ApprovalRequest = {
      id: randomUUID(),
      user_id: userId,
      workspace_id: pedido.workspaceId,
      runId: pedido.runId,
      stepId: pedido.tarefaId,
      action: acao,
      status: 'pendente',
      risk: decisao.tier,
      reason: pedido.acao,
      operation: {
        kind: 'squad',
        projectId: pedido.projectId,
        acao: pedido.acao,
        alvoHash
      },
      created_at: new Date().toISOString()
    }
    this.deps.db.transaction(() => {
      this.deps.requests.create(request)
      this.auditar(request, 'solicitada')
    })()
    return await new Promise<boolean>((resolve) => {
      const abortar = (): void => {
        this.encerrar(request.id, false, 'run-cancelado')
      }
      this.esperando.set(request.id, (aprovado) => {
        pedido.signal?.removeEventListener('abort', abortar)
        resolve(aprovado)
      })
      pedido.signal?.addEventListener('abort', abortar, { once: true })
      if (pedido.signal?.aborted) abortar()
    })
  }

  resolver(
    id: string,
    decisao: ApprovalDecision,
    projectId: string,
    workspaceId: WorkspaceId
  ): boolean {
    const request = this.deps.requests.findById(this.deps.userId(), id)
    if (
      request?.status !== 'pendente' ||
      request.workspace_id !== workspaceId ||
      request.operation['kind'] !== 'squad' ||
      request.operation['projectId'] !== projectId ||
      !this.runAtivo(request.runId, projectId, workspaceId) ||
      !this.esperando.has(id)
    )
      return false
    this.encerrar(id, decisao === 'aprovado', 'decisao-do-pi')
    return true
  }

  private runAtivo(runId: string, projectId: string, workspaceId: WorkspaceId): boolean {
    const run = this.deps.runs.buscar(runId)
    return (
      run !== undefined &&
      run.user_id === this.deps.userId() &&
      run.projectId === projectId &&
      this.deps.runs.workspaceDoRun(runId) === workspaceId &&
      !['BLOCKED', 'CANCELLED', 'MERGED'].includes(run.estado)
    )
  }

  private encerrar(id: string, aprovado: boolean, origem: string): void {
    const request = this.deps.requests.findById(this.deps.userId(), id)
    if (request?.status !== 'pendente') return
    const resolvida = this.deps.db.transaction(() => {
      const atualizada = this.deps.requests.resolve(
        this.deps.userId(),
        id,
        aprovado ? 'aprovado' : 'negado'
      )
      if (atualizada !== undefined) this.auditar(atualizada, origem)
      return atualizada
    })()
    if (resolvida === undefined) return
    const acordar = this.esperando.get(id)
    this.esperando.delete(id)
    acordar?.(aprovado)
  }

  private auditar(request: ApprovalRequest, marco: string): void {
    this.deps.audit.append({
      user_id: request.user_id,
      workspace_id: request.workspace_id as WorkspaceId,
      type: 'approval-request',
      payload: {
        marco,
        approvalRequestId: request.id,
        runId: request.runId,
        tarefaId: request.stepId,
        acao: request.action,
        alvoHash: request.operation['alvoHash'],
        status: request.status,
        resolvedBy: request.resolved_by ?? null
      }
    })
  }
}
