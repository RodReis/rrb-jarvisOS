/**
 * O PR que cada run publicou (SPEC-Scheduler-05).
 *
 * O run não lembrava o próprio PR — o número morava na memória da entrega e, no fim, no ledger do
 * run encerrado. Cancelar um run com o trabalho já no remoto precisa achá-lo para convertê-lo em
 * rascunho, e a conversão precisa sobreviver a um crash entre o cancelamento e a chamada.
 *
 * **O rascunho é intenção antes, resultado depois** (o mesmo padrão do diário de efeitos):
 * `pedirRascunho` grava `pendente` antes de a chamada sair, `concluirRascunho` grava o desfecho
 * depois, e `pendentes` é o que a reconciliação refaz. Só persiste e consulta; nunca chama a origem.
 */

import type { Database } from 'better-sqlite3'

export type EstadoDoRascunho = 'pendente' | 'convertido' | 'indisponivel' | 'nao-aberto'

/** O que o run sabe do PR dele. `rascunho` ausente = ninguém pediu. */
export interface PrDoRun {
  readonly runId: string
  readonly owner: string
  readonly repo: string
  readonly pullRequest: number
  readonly branch: string
  readonly rascunho?: EstadoDoRascunho
}

interface Linha {
  readonly run_id: string
  readonly owner: string
  readonly repo: string
  readonly pull_request: number
  readonly branch: string
  readonly rascunho: EstadoDoRascunho | null
}

const paraPr = (l: Linha): PrDoRun => ({
  runId: l.run_id,
  owner: l.owner,
  repo: l.repo,
  pullRequest: l.pull_request,
  branch: l.branch,
  ...(l.rascunho === null ? {} : { rascunho: l.rascunho })
})

export class RunPrRepository {
  constructor(private readonly db: Database) {}

  /** Idempotente: repetir atualiza o PR e **preserva** o estado do rascunho. */
  registrar(userId: string, pr: Omit<PrDoRun, 'rascunho'>, agora: number): void {
    this.db
      .prepare(
        `INSERT INTO run_pr
           (user_id, run_id, owner, repo, pull_request, branch, rascunho, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT (user_id, run_id) DO UPDATE SET
           owner = excluded.owner, repo = excluded.repo, pull_request = excluded.pull_request,
           branch = excluded.branch, updated_at = excluded.updated_at`
      )
      .run(userId, pr.runId, pr.owner, pr.repo, pr.pullRequest, pr.branch, agora, agora)
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

  /** O que a reconciliação refaz: a intenção gravada que um crash deixou sem resultado. */
  pendentes(userId: string): readonly PrDoRun[] {
    const linhas = this.db
      .prepare(
        "SELECT * FROM run_pr WHERE user_id = ? AND rascunho = 'pendente' ORDER BY created_at"
      )
      .all(userId) as Linha[]
    return linhas.map(paraPr)
  }

  private mudar(
    userId: string,
    runId: string,
    para: EstadoDoRascunho | null,
    agora: number,
    onde: string
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
