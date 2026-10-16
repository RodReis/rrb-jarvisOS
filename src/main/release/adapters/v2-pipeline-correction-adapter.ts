import type { AuditRepository } from '../../storage/audit-repository'
import type { PipelineRepository } from '../../pipeline/pipeline-repository'
import {
  V2CorrectionUnavailable,
  type CorrectionRequest,
  type V2CorrectionPort
} from '../correction/dispatcher'

/**
 * Retorno à V2 (SPEC-Release-05, critério 6): abre, na fatia de origem, um run novo em `PLANNED`.
 * É exatamente o que `FilaService.criarRun` faz — o run segue o fluxo normal da V2, inclusive o
 * gate `SLICE_ENTRY`, que reaproveita a aprovação vigente da MESMA revisão da SPEC: correção que
 * não altera o escopo não pede novo aceite, e uma SPEC que mudou volta a pedir. Este adaptador não
 * aprova, não pula estado e não encosta em Produção. A chave de dispatch (`release-correction:…`)
 * torna a abertura idempotente. O contexto (`contextJson`) fica no registro da correção da
 * release, endereçável por essa chave; a auditoria leva só o que a auditoria de runs já leva.
 */
export class V2PipelineCorrectionAdapter implements V2CorrectionPort {
  constructor(
    private readonly runs: PipelineRepository,
    private readonly audit: AuditRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  async open(pedido: CorrectionRequest): Promise<{ runId: string }> {
    const escopo = {
      userId: pedido.scope.userId,
      workspaceId: pedido.scope.workspaceId,
      projectId: pedido.scope.projectId
    }
    const existente = this.runs.buscarPorChaveDispatch(escopo, pedido.dispatchKey)
    if (existente) return { runId: existente.id }
    // A V2 só reabre o que ela conhece: fatia sem nenhum run neste projeto não é fatia da V2.
    if (this.runs.listarDaFatia(escopo, pedido.sliceId).length === 0)
      throw new V2CorrectionUnavailable('slice-unknown')
    const run = this.runs.criar(
      escopo,
      { sliceId: pedido.sliceId, estado: 'PLANNED', dispatchKey: pedido.dispatchKey },
      this.now()
    )
    this.audit.append({
      user_id: escopo.userId,
      workspace_id: escopo.workspaceId,
      type: 'pipeline-transition',
      payload: {
        runId: run.id,
        projectId: escopo.projectId,
        sliceId: run.sliceId,
        de: null,
        para: 'PLANNED'
      }
    })
    return { runId: run.id }
  }
}
