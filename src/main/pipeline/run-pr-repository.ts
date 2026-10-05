/**
 * O PR que cada run publicou (SPEC-Scheduler-05).
 *
 * O run não lembrava o próprio PR — o número morava na memória da entrega e, no fim, no ledger do
 * run encerrado. Cancelar um run com o trabalho já no remoto precisa achá-lo para convertê-lo em
 * rascunho, e a conversão precisa sobreviver a um crash entre o cancelamento e a chamada.
 *
 * **O rascunho é intenção antes, resultado depois** (o mesmo padrão do diário de efeitos):
 * `pedirRascunho` grava `pendente` antes de a chamada sair, `concluirRascunho` grava o desfecho
 * depois, e `pendentes` é o que a reconciliação refaz — **espaçada** (`tentou_em`) e com contagem de
 * tentativas, para não martelar uma origem fora do ar. Só persiste e consulta; nunca chama a origem.
 */

import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'

export type EstadoDoRascunho =
  'pendente' | 'convertido' | 'indisponivel' | 'nao-aberto' | 'reaproveitado'

/** O que o run sabe do PR dele. `rascunho` ausente = ninguém pediu. */
export interface PrDoRun {
  readonly runId: string
  /** O espaço do run: é dado persistido, não derivado — vira credencial e escopo de auditoria. */
  readonly workspaceId: WorkspaceId
  readonly owner: string
  readonly repo: string
  readonly pullRequest: number
  readonly branch: string
  readonly rascunho?: EstadoDoRascunho
}

interface Linha {
  readonly run_id: string
  readonly workspace_id: WorkspaceId
  readonly owner: string
  readonly repo: string
  readonly pull_request: number
  readonly branch: string
  readonly rascunho: EstadoDoRascunho | null
  readonly tentativas: number
}

const paraPr = (l: Linha): PrDoRun => ({
  runId: l.run_id,
  workspaceId: l.workspace_id,
  owner: l.owner,
  repo: l.repo,
  pullRequest: l.pull_request,
  branch: l.branch,
  ...(l.rascunho === null ? {} : { rascunho: l.rascunho })
})

/** Os estados em que o run terminou: o PR dele já não é "em uso" por ele. */
const ESTADOS_TERMINAIS = "('MERGED', 'AWAITING_MERGE', 'BLOCKED', 'CANCELLED')"

export class RunPrRepository {
  constructor(private readonly db: Database) {}

  /** Idempotente: repetir atualiza o PR e **preserva** o estado do rascunho e as tentativas. */
  registrar(userId: string, pr: Omit<PrDoRun, 'rascunho'>, agora: number): void {
    this.db
      .prepare(
        `INSERT INTO run_pr
           (user_id, run_id, workspace_id, owner, repo, pull_request, branch, rascunho,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT (user_id, run_id) DO UPDATE SET
           owner = excluded.owner, repo = excluded.repo, pull_request = excluded.pull_request,
           branch = excluded.branch, updated_at = excluded.updated_at`
      )
      .run(
        userId,
        pr.runId,
        pr.workspaceId,
        pr.owner,
        pr.repo,
        pr.pullRequest,
        pr.branch,
        agora,
        agora
      )
  }

  doRun(userId: string, runId: string): PrDoRun | undefined {
    const linha = this.db
      .prepare('SELECT * FROM run_pr WHERE user_id = ? AND run_id = ?')
      .get(userId, runId) as Linha | undefined
    return linha === undefined ? undefined : paraPr(linha)
  }

  /** Grava a intenção. `false` quando não há PR ou o pedido já tem resultado — não reabre. */
  pedirRascunho(userId: string, runId: string, agora: number): boolean {
    return this.mudar(userId, runId, 'pendente', agora, 'rascunho IS NULL')
  }

  /** O desfecho da conversão. Só conclui o que estava `pendente`: o resultado não é sobrescrito. */
  concluirRascunho(
    userId: string,
    runId: string,
    estado: Exclude<EstadoDoRascunho, 'pendente'>,
    agora: number
  ): boolean {
    return this.mudar(userId, runId, estado, agora, "rascunho = 'pendente'")
  }

  /** O cancelamento foi recusado depois do pedido: ninguém mais espera um rascunho. */
  desfazerPedido(userId: string, runId: string, agora: number): boolean {
    return this.mudar(userId, runId, null, agora, "rascunho = 'pendente'")
  }

  /** Conta uma tentativa de chamar a origem. Devolve quantas já foram feitas, contando esta. */
  registrarTentativa(userId: string, runId: string, agora: number): number {
    this.db
      .prepare(
        `UPDATE run_pr SET tentativas = tentativas + 1, tentou_em = ?
          WHERE user_id = ? AND run_id = ?`
      )
      .run(agora, userId, runId)
    return this.tentativas(userId, runId)
  }

  /** Quantas vezes a origem já foi chamada para o rascunho deste run. */
  tentativas(userId: string, runId: string): number {
    const linha = this.db
      .prepare('SELECT tentativas FROM run_pr WHERE user_id = ? AND run_id = ?')
      .get(userId, runId) as { tentativas: number } | undefined
    return linha?.tentativas ?? 0
  }

  /**
   * O que a reconciliação refaz: a intenção gravada sem resultado, **que não foi tentada há menos
   * de `espacamentoMs`**. Sem o espaçamento, uma origem fora do ar seria chamada a cada volta.
   */
  pendentes(userId: string, agora: number, espacamentoMs: number): readonly PrDoRun[] {
    // Também entra o PR de um run **já cancelado** que ninguém pediu em rascunho: a entrega em voo
    // pode ter publicado o PR depois do cancelamento, e a regra é que o PR do cancelado fique em
    // rascunho. O pedido é gravado pelo serviço antes da chamada.
    const linhas = this.db
      .prepare(
        `SELECT p.* FROM run_pr p
           LEFT JOIN pipeline_run r ON r.id = p.run_id AND r.user_id = p.user_id
          WHERE p.user_id = ?
            AND (p.rascunho = 'pendente' OR (p.rascunho IS NULL AND r.estado = 'CANCELLED'))
            AND (p.tentou_em IS NULL OR p.tentou_em + ? <= ?)
          ORDER BY p.created_at`
      )
      .all(userId, espacamentoMs, agora) as Linha[]
    return linhas.map(paraPr)
  }

  /**
   * Outro run **ainda ativo** aponta para o mesmo PR? É a retomada vinculada reaproveitando o PR do
   * run cancelado: convertê-lo em rascunho agora seria mudar o PR no meio da entrega do outro.
   */
  outroRunAtivoUsa(userId: string, runId: string): boolean {
    const linha = this.db
      .prepare(
        `SELECT 1 FROM run_pr alvo
           JOIN run_pr outro
             ON outro.user_id = alvo.user_id AND outro.owner = alvo.owner
            AND outro.repo = alvo.repo AND outro.pull_request = alvo.pull_request
            AND outro.run_id <> alvo.run_id
           JOIN pipeline_run r ON r.id = outro.run_id AND r.user_id = outro.user_id
          WHERE alvo.user_id = ? AND alvo.run_id = ? AND r.estado NOT IN ${ESTADOS_TERMINAIS}
          LIMIT 1`
      )
      .get(userId, runId)
    return linha !== undefined
  }

  private mudar(
    userId: string,
    runId: string,
    para: EstadoDoRascunho | null,
    agora: number,
    onde: 'rascunho IS NULL' | "rascunho = 'pendente'"
  ): boolean {
    return (
      this.db
        .prepare(
          `UPDATE run_pr SET rascunho = ?, updated_at = ?
            WHERE user_id = ? AND run_id = ? AND ${onde}`
        )
        .run(para, agora, userId, runId).changes === 1
    )
  }
}
