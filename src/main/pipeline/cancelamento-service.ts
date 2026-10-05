/**
 * O cancelamento seletivo de um run (SPEC-Scheduler-05, regra 4 e critério 4).
 *
 * A pergunta que este serviço responde: **cancelar esta fatia agora — o que acontece com ela, com
 * o trabalho que já está no remoto e com a fatia ao lado?**
 *
 * A matriz aprovada (V2 §11.3, `limpeza.ts`) decide **o que cada fase preserva**; este serviço a
 * executa na ordem certa:
 *
 *  1. a fase sai do estado do run e de ele ter PR (`faseDoCancelamento`);
 *  2. a intenção do rascunho é gravada **antes** de qualquer efeito — um crash a deixa `pendente`
 *     e a reconciliação a refaz;
 *  3. a fila transiciona o run para `CANCELLED` — é aí que o cancelamento pode ser **recusado**
 *     (merge no ar: o merge confirmado na origem não se desfaz). Recusado, nada mais acontece: o
 *     pedido de rascunho é desfeito e a entrega em curso **não** é interrompida;
 *  4. a entrega em curso é interrompida e, por `aoEncerrarSemConclusao`, a recuperação para o
 *     executor, devolve os recursos e **só então** o slot;
 *  5. o PR vira rascunho, **quando possível**.
 *
 * **O que nunca acontece aqui:** fechar o PR, apagar a branch, mergear, criar revert. A única
 * operação que sai para a origem é `pr.convert-to-draft`, e ela recusa PR que não está aberto.
 *
 * **O cancelamento nunca lança por causa da origem.** Rascunho é "quando possível" (V2 §11.3): a
 * origem fora do ar deixa o pedido `pendente` e o run cancelado do mesmo jeito — o PR continua lá,
 * preservado; só a sinalização fica para depois. Recusa definitiva (repositório sem suporte a
 * rascunho) vira `indisponivel`, registrado, e não é repetida.
 *
 * **Só o run cancelado é tocado** (regra 2): nada aqui lê nem escreve o estado, o slot, as travas
 * ou o PR de outro run.
 */

import { randomUUID } from 'node:crypto'
import {
  CONNECTOR_CONTRACT_VERSION,
  type ConnectorOutcome,
  type ConnectorRequest
} from '@shared/domain/connectors'
import type { WorkspaceId } from '@shared/domain/entities'
import { GITHUB_OPERATIONS } from '@shared/domain/github-automation'
import { planoDeLimpeza, type FaseDeCancelamento } from '@shared/domain/limpeza'
import { faseDoCancelamento } from '@shared/domain/recuperacao'
import type { ConnectorService } from '../connectors/connector-service'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { FilaService } from './fila-service'
import type { PipelineRepository } from './pipeline-repository'
import type { AchadoDaReconciliacao } from './reconciliacao-service'
import type { PrDoRun, RunPrRepository } from './run-pr-repository'

const TIMEOUT_DA_CHAMADA_MS = 30_000

/** O que aconteceu com o PR do run cancelado. */
export type DesfechoDoRascunho =
  /** O run não tinha PR (ou a fase não pede rascunho). */
  | 'sem-pr'
  | 'convertido'
  /** O PR já era rascunho. */
  | 'ja-era'
  /** O PR não está aberto (fechado ou mergeado): nunca é reaberto como rascunho. */
  | 'nao-aberto'
  /** A origem recusou de forma definitiva (ex.: repositório sem suporte a rascunho). */
  | 'indisponivel'
  /** A origem não respondeu: o pedido fica gravado e a reconciliação o refaz. */
  | 'pendente'

export type ResultadoDoCancelamento =
  | {
      readonly cancelado: true
      readonly fase: FaseDeCancelamento
      readonly rascunho: DesfechoDoRascunho
    }
  | {
      readonly cancelado: false
      readonly motivo: 'run-inexistente' | 'run-terminal' | 'merge-em-curso' | 'recusado'
      readonly mensagem: string
    }

export interface CancelamentoDeps {
  readonly runs: PipelineRepository
  readonly fila: Pick<FilaService, 'transicionar'>
  readonly prs: RunPrRepository
  readonly connectors: Pick<ConnectorService, 'call'>
  readonly audit: AuditRepository
  readonly userId: () => string
  /**
   * Interrompe a entrega em curso do run (o `AbortSignal` que o `EntregaService` observa). Só é
   * chamado **depois** de o cancelamento ser aceito: recusado, o merge no ar segue.
   */
  readonly interromper?: (runId: string) => void
  readonly agora?: () => number
}

export class CancelamentoService {
  private readonly agora: () => number

  constructor(private readonly deps: CancelamentoDeps) {
    this.agora = deps.agora ?? ((): number => Date.now())
  }

  async cancelar(
    projectId: string,
    workspaceId: WorkspaceId,
    runId: string
  ): Promise<ResultadoDoCancelamento> {
    const userId = this.deps.userId()
    const run = this.deps.runs.buscar(runId)
    if (run === undefined || run.user_id !== userId) {
      return { cancelado: false, motivo: 'run-inexistente', mensagem: 'Run não encontrado.' }
    }

    const pr = this.deps.prs.doRun(userId, runId)
    const fase = faseDoCancelamento(run.estado, pr !== undefined)
    if (fase === undefined) {
      return {
        cancelado: false,
        motivo: 'run-terminal',
        mensagem: `O run já terminou em ${run.estado}: não há o que cancelar.`
      }
    }

    // A intenção antes de qualquer efeito. Pedido que já existe (`pendente`, de um crash anterior)
    // vale: o que decide é o estado lido de volta, não o retorno de `pedirRascunho`.
    const querRascunho = pr !== undefined && planoDeLimpeza(fase).convertePrParaRascunho
    if (querRascunho) this.deps.prs.pedirRascunho(userId, runId, this.agora())

    const transicao = this.deps.fila.transicionar(projectId, workspaceId, runId, 'CANCELLED')
    if (transicao.reason !== 'transicionado') {
      if (querRascunho) this.deps.prs.desfazerPedido(userId, runId, this.agora())
      return {
        cancelado: false,
        motivo: transicao.reason === 'merge-em-curso' ? 'merge-em-curso' : 'recusado',
        mensagem: transicao.mensagem
      }
    }

    this.deps.interromper?.(runId)

    const rascunho =
      pr !== undefined && this.deps.prs.doRun(userId, runId)?.rascunho === 'pendente'
        ? await this.converterEmRascunho(userId, workspaceId, pr)
        : 'sem-pr'

    this.deps.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'pipeline-transition',
      payload: { cancelamento: true, runId, projectId, fase, rascunho }
    })
    return { cancelado: true, fase, rascunho }
  }

  /**
   * Refaz o rascunho que um crash (ou a origem fora do ar) deixou `pendente` — **só de run que de
   * fato está `CANCELLED`**. Um pedido pendente de run que ainda vive é resto de um cancelamento
   * que não chegou a acontecer, e converter o PR de um run saudável seria o oposto da regra 2.
   */
  async reconciliarRascunhos(): Promise<readonly AchadoDaReconciliacao[]> {
    const userId = this.deps.userId()
    const achados: AchadoDaReconciliacao[] = []

    for (const pr of this.deps.prs.pendentes(userId)) {
      const run = this.deps.runs.buscar(pr.runId)
      if (run?.estado !== 'CANCELLED') continue

      const workspaceId = this.deps.runs.workspaceDoRun(pr.runId)
      if (workspaceId === undefined) continue

      const desfecho = await this.converterEmRascunho(userId, workspaceId, pr)
      achados.push({
        recurso: `pr:${pr.runId}`,
        decisao: desfecho === 'pendente' ? 'bloqueado' : 'completado',
        motivo:
          desfecho === 'pendente'
            ? 'A origem não respondeu: o rascunho do PR do run cancelado continua pendente.'
            : `Rascunho do PR do run cancelado: ${desfecho}.`
      })
    }

    return achados
  }

  /**
   * Chama a origem e grava o desfecho. **Nunca lança**: exceção e erro retentável deixam o pedido
   * `pendente`; erro definitivo o fecha como `indisponivel`.
   */
  private async converterEmRascunho(
    userId: string,
    workspaceId: WorkspaceId,
    pr: PrDoRun
  ): Promise<DesfechoDoRascunho> {
    let outcome: ConnectorOutcome
    try {
      outcome = await this.chamar(userId, workspaceId, pr)
    } catch (erro) {
      log.agent.warn('Rascunho do PR não pôde ser pedido; fica pendente', {
        runId: pr.runId,
        erro: erro instanceof Error ? erro.message : String(erro)
      })
      return 'pendente'
    }

    const agora = this.agora()
    if (!outcome.ok) {
      if (outcome.retryable) return 'pendente'
      this.deps.prs.concluirRascunho(userId, pr.runId, 'indisponivel', agora)
      return 'indisponivel'
    }

    const dado = outcome.data as { rascunho?: boolean; jaEra?: boolean } | undefined
    if (dado?.rascunho !== true) {
      this.deps.prs.concluirRascunho(userId, pr.runId, 'nao-aberto', agora)
      return 'nao-aberto'
    }
    this.deps.prs.concluirRascunho(userId, pr.runId, 'convertido', agora)
    return dado.jaEra === true ? 'ja-era' : 'convertido'
  }

  private async chamar(
    userId: string,
    workspaceId: WorkspaceId,
    pr: PrDoRun
  ): Promise<ConnectorOutcome> {
    const request: ConnectorRequest = {
      contractVersion: CONNECTOR_CONTRACT_VERSION,
      connector: 'github',
      operation: GITHUB_OPERATIONS.convertToDraft,
      correlationId: randomUUID(),
      // Determinística por run e PR: repetir o pedido (reconciliação) é a mesma intenção.
      idempotencyKey: `rascunho:${pr.runId}:${pr.pullRequest}`,
      timeoutMs: TIMEOUT_DA_CHAMADA_MS,
      credential: { key: 'github', user_id: userId, workspace_id: workspaceId },
      input: { owner: pr.owner, repo: pr.repo, pullRequest: pr.pullRequest }
    }
    return await this.deps.connectors.call(request, { userId, workspace: workspaceId })
  }
}
