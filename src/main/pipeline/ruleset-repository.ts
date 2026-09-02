/**
 * O histórico de snapshots do ruleset, por run (SPEC-Entrega-05, critério 11).
 *
 * **Append-only por desenho, não por convenção**: não existe `atualizar` nem `remover`. Cada
 * observação da regra da origem insere uma linha, e é a série que prova a reconciliação — um
 * `UPDATE` daria o estado corrente e apagaria o fato de que a regra mudou no meio do run.
 *
 * A ordem é por `rowid`, não por `observado_em`. Duas observações no mesmo milissegundo empatariam
 * na data, e o desempate ficaria por conta do plano de consulta — a mesma intermitência que a
 * M8-F02 já pagou com a listagem de packs. `rowid` é a ordem de inserção, que é exatamente o que
 * "o último snapshot" quer dizer aqui.
 */

import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import type { SnapshotDeRuleset } from '@shared/domain/ruleset'

export interface EscopoDoSnapshot {
  readonly userId: string
  readonly workspaceId: WorkspaceId
  readonly projectId: string
}

interface SnapshotRow {
  readonly run_id: string
  readonly branch: string
  readonly contexts: string
  readonly strict: number
  readonly protegida: number
  readonly merge_queue_exigida: number
  readonly ref: string
  readonly observado_em: string
}

const COLUNAS =
  'run_id, branch, contexts, strict, protegida, merge_queue_exigida, ref, observado_em'

/**
 * Reconstrói o snapshot da linha.
 *
 * `contexts` corrompido vira lista vazia em vez de estourar: o gate trata lista vazia como bloqueio
 * explicável (critério 10), que é o desfecho seguro. Estourar aqui derrubaria o run inteiro por
 * causa de uma linha de histórico, e adivinhar um conteúdo plausível seria pior — inventaria uma
 * regra que ninguém observou.
 */
function paraSnapshot(row: SnapshotRow): SnapshotDeRuleset {
  let contexts: string[] = []
  try {
    const parsed: unknown = JSON.parse(row.contexts)
    if (Array.isArray(parsed)) contexts = parsed.filter((c): c is string => typeof c === 'string')
  } catch {
    contexts = []
  }

  return {
    runId: row.run_id,
    branch: row.branch,
    contexts,
    strict: row.strict === 1,
    protegida: row.protegida === 1,
    mergeQueueExigida: row.merge_queue_exigida === 1,
    ref: row.ref,
    observadoEm: row.observado_em
  }
}

export class RulesetRepository {
  constructor(private readonly db: Database) {}

  /** Registra uma observação. Sempre insere: o histórico é a evidência. */
  registrar(escopo: EscopoDoSnapshot, snapshot: SnapshotDeRuleset): void {
    this.db
      .prepare(
        `INSERT INTO ruleset_snapshot
           (id, user_id, workspace_id, project_id, run_id, branch, contexts,
            strict, protegida, merge_queue_exigida, ref, observado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        escopo.userId,
        escopo.workspaceId,
        escopo.projectId,
        snapshot.runId,
        snapshot.branch,
        JSON.stringify(snapshot.contexts),
        snapshot.strict ? 1 : 0,
        snapshot.protegida ? 1 : 0,
        snapshot.mergeQueueExigida ? 1 : 0,
        snapshot.ref,
        snapshot.observadoEm
      )
  }

  /** O snapshot mais recente do run, ou `undefined` se o run ainda não observou a origem. */
  ultimo(userId: string, runId: string): SnapshotDeRuleset | undefined {
    const row = this.db
      .prepare(
        `SELECT ${COLUNAS} FROM ruleset_snapshot
         WHERE user_id = ? AND run_id = ?
         ORDER BY rowid DESC LIMIT 1`
      )
      .get(userId, runId) as SnapshotRow | undefined

    return row === undefined ? undefined : paraSnapshot(row)
  }

  /** A série do run, na ordem em que foi observada. É a evidência da reconciliação. */
  todos(userId: string, runId: string): readonly SnapshotDeRuleset[] {
    const rows = this.db
      .prepare(
        `SELECT ${COLUNAS} FROM ruleset_snapshot
         WHERE user_id = ? AND run_id = ?
         ORDER BY rowid ASC`
      )
      .all(userId, runId) as SnapshotRow[]

    return rows.map(paraSnapshot)
  }
}
