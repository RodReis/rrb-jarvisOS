/**
 * As tentativas de merge sob o MergeLease (SPEC-Scheduler-04, migration 52).
 *
 * O lease diz **quem** está na seção crítica; esta tabela diz **o que ele está fazendo**: qual PR,
 * qual head, e se o efeito já foi confirmado. Gravar `iniciada` antes da chamada é o que deixa um
 * crash legível: a linha de pé significa "o merge pode ter saído", e a reconciliação consulta o
 * GitHub antes de repetir — nunca o contrário.
 *
 * As garantias que importam moram no `WHERE`, no `EXISTS` e nos UNIQUE parciais, não em um `if`
 * antes. Entre "o token confere?" e "grava" não há janela: é a mesma instrução SQL.
 */

import type { Database } from 'better-sqlite3'
import { ESTADOS_DO_RUN, ehTerminal } from '@shared/domain/pipeline'
import type { EstadoDaTentativa } from '@shared/domain/merge-serializado'

export interface TentativaDeMerge {
  readonly id: number
  readonly userId: string
  readonly runId: string
  readonly projectId: string
  readonly recurso: string
  readonly pullRequest: number
  readonly headSha: string
  readonly fencingToken: number
  readonly estado: EstadoDaTentativa
  readonly mergeSha?: string
  readonly iniciadaEm: number
  readonly concluidaEm?: number
}

export interface NovaTentativa {
  readonly runId: string
  readonly projectId: string
  readonly recurso: string
  readonly pullRequest: number
  readonly headSha: string
  readonly fencingToken: number
}

/**
 * Por que a tentativa não começou. Cada motivo manda o chamador para um lugar diferente:
 *
 *  - `run-fora-de-pr-ci`: o run foi cancelado ou terminou — **não mergear**;
 *  - `lease-perdido`: o token não é mais o vigente — voltar à fila do lease;
 *  - `tentativa-em-aberto`: outra tentativa na mesma base ficou sem resolução — esperar a
 *    reconciliação, porque não se sabe se aquele merge aconteceu;
 *  - `ja-tentada`: este run já tem tentativa viva para este PR e head — reconciliar, não repetir.
 */
export type RecusaDaTentativa =
  'run-fora-de-pr-ci' | 'lease-perdido' | 'tentativa-em-aberto' | 'ja-tentada'

export type ResultadoDoInicio =
  | { readonly tipo: 'iniciada'; readonly tentativa: TentativaDeMerge }
  | { readonly tipo: 'recusada'; readonly motivo: RecusaDaTentativa }

interface TentativaRow {
  id: number
  user_id: string
  run_id: string
  project_id: string
  recurso: string
  pull_request: number
  head_sha: string
  fencing_token: number
  estado: EstadoDaTentativa
  merge_sha: string | null
  iniciada_em: number
  concluida_em: number | null
}

function toTentativa(row: TentativaRow): TentativaDeMerge {
  return {
    id: row.id,
    userId: row.user_id,
    runId: row.run_id,
    projectId: row.project_id,
    recurso: row.recurso,
    pullRequest: row.pull_request,
    headSha: row.head_sha,
    fencingToken: row.fencing_token,
    estado: row.estado,
    ...(row.merge_sha === null ? {} : { mergeSha: row.merge_sha }),
    iniciadaEm: row.iniciada_em,
    ...(row.concluida_em === null ? {} : { concluidaEm: row.concluida_em })
  }
}

const TERMINAIS = ESTADOS_DO_RUN.filter(ehTerminal)
const PLACEHOLDERS_DOS_TERMINAIS = TERMINAIS.map(() => '?').join(', ')

export class MergeRepository {
  constructor(private readonly db: Database) {}

  /**
   * Abre a tentativa **se** o run ainda está em `PR_CI` **e** o lease do recurso é dele com o
   * token apresentado. As duas conferências e o `INSERT` rodam na mesma transação: um cancelamento
   * ou uma reconciliação não cabe entre elas.
   *
   * É também onde a corrida do cancelamento tardio é decidida a favor de um dos lados: se o run
   * já foi cancelado, a tentativa não nasce; se a tentativa nasceu, o cancelamento a enxerga
   * (`emCursoDoRun`) e é recusado.
   */
  iniciar(userId: string, dados: NovaTentativa, agora: number): ResultadoDoInicio {
    const abrir = this.db.transaction((): ResultadoDoInicio => {
      const run = this.db
        .prepare('SELECT estado FROM pipeline_run WHERE id = ? AND user_id = ?')
        .get(dados.runId, userId) as { estado: string } | undefined
      if (run?.estado !== 'PR_CI') return { tipo: 'recusada', motivo: 'run-fora-de-pr-ci' }

      const lease = this.db
        .prepare(
          'SELECT 1 AS ok FROM lease WHERE user_id = ? AND recurso = ? AND proprietario = ? AND fencing_token = ?'
        )
        .get(userId, dados.recurso, dados.runId, dados.fencingToken)
      if (lease === undefined) return { tipo: 'recusada', motivo: 'lease-perdido' }

      try {
        const info = this.db
          .prepare(
            `INSERT INTO merge_tentativa
               (user_id, run_id, project_id, recurso, pull_request, head_sha, fencing_token,
                estado, iniciada_em)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'iniciada', ?)`
          )
          .run(
            userId,
            dados.runId,
            dados.projectId,
            dados.recurso,
            dados.pullRequest,
            dados.headSha,
            dados.fencingToken,
            agora
          )
        const tentativa = this.buscar(userId, Number(info.lastInsertRowid)) as TentativaDeMerge
        return { tipo: 'iniciada', tentativa }
      } catch {
        // O banco recusou por um dos dois UNIQUE parciais. A distinção importa ao chamador.
        const aberta = this.db
          .prepare(
            "SELECT run_id FROM merge_tentativa WHERE user_id = ? AND recurso = ? AND estado = 'iniciada'"
          )
          .get(userId, dados.recurso) as { run_id: string } | undefined
        return {
          tipo: 'recusada',
          motivo:
            aberta !== undefined && aberta.run_id !== dados.runId
              ? 'tentativa-em-aberto'
              : 'ja-tentada'
        }
      }
    })

    return abrir()
  }

  /**
   * Confirma o efeito **só se o token ainda é o vigente**. Quem perdeu o lease durante a chamada
   * não grava a confirmação; a tentativa fica `iniciada` e a reconciliação a resolve consultando a
   * origem (regra 2 da SPEC: só o dono atual confirma).
   */
  confirmar(userId: string, id: number, mergeSha: string, agora: number): boolean {
    const resultado = this.db
      .prepare(
        `UPDATE merge_tentativa
            SET estado = 'confirmada', merge_sha = ?, concluida_em = ?
          WHERE id = ? AND user_id = ? AND estado = 'iniciada'
            AND EXISTS (SELECT 1 FROM lease l
                         WHERE l.user_id = merge_tentativa.user_id
                           AND l.recurso = merge_tentativa.recurso
                           AND l.proprietario = merge_tentativa.run_id
                           AND l.fencing_token = merge_tentativa.fencing_token)`
      )
      .run(mergeSha, agora, id, userId)

    return resultado.changes === 1
  }

  /**
   * Confirma por **reconciliação**: a origem diz que o PR está mergeado, e é ela a prova — não há
   * dono a conferir. Separado de `confirmar` pelo mesmo motivo de `removerReconciliado`: a
   * diferença entre "o dono confirmou" e "a reconciliação constatou" precisa aparecer no call site.
   */
  confirmarReconciliado(userId: string, id: number, mergeSha: string, agora: number): boolean {
    const resultado = this.db
      .prepare(
        `UPDATE merge_tentativa SET estado = 'confirmada', merge_sha = ?, concluida_em = ?
          WHERE id = ? AND user_id = ? AND estado = 'iniciada'`
      )
      .run(mergeSha, agora, id, userId)

    return resultado.changes === 1
  }

  /** A origem mostrou que o PR **não** foi mergeado: o head pode ser tentado de novo. */
  abandonar(userId: string, id: number, agora: number): boolean {
    const resultado = this.db
      .prepare(
        `UPDATE merge_tentativa SET estado = 'abandonada', concluida_em = ?
          WHERE id = ? AND user_id = ? AND estado = 'iniciada'`
      )
      .run(agora, id, userId)

    return resultado.changes === 1
  }

  buscar(userId: string, id: number): TentativaDeMerge | undefined {
    const row = this.db
      .prepare('SELECT * FROM merge_tentativa WHERE id = ? AND user_id = ?')
      .get(id, userId) as TentativaRow | undefined

    return row === undefined ? undefined : toTentativa(row)
  }

  /** A tentativa viva (`iniciada` ou `confirmada`) do run para um PR e head. */
  buscarViva(
    userId: string,
    runId: string,
    pullRequest: number,
    headSha: string
  ): TentativaDeMerge | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM merge_tentativa
          WHERE user_id = ? AND run_id = ? AND pull_request = ? AND head_sha = ?
            AND estado <> 'abandonada'`
      )
      .get(userId, runId, pullRequest, headSha) as TentativaRow | undefined

    return row === undefined ? undefined : toTentativa(row)
  }

  /** As tentativas sem resolução: o que a reconciliação do boot precisa olhar. */
  iniciadas(userId: string): readonly TentativaDeMerge[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM merge_tentativa WHERE user_id = ? AND estado = 'iniciada' ORDER BY id ASC"
      )
      .all(userId) as TentativaRow[]

    return rows.map(toTentativa)
  }

  /**
   * Tentativas **confirmadas** cujo run ainda está em `PR_CI`: o merge aconteceu, e o run não
   * chegou a registrar. É o rastro de um crash entre a confirmação e a conclusão do run.
   */
  confirmadasComRunAberto(userId: string): readonly TentativaDeMerge[] {
    const rows = this.db
      .prepare(
        `SELECT t.* FROM merge_tentativa t
           JOIN pipeline_run r ON r.id = t.run_id AND r.user_id = t.user_id
          WHERE t.user_id = ? AND t.estado = 'confirmada' AND r.estado = 'PR_CI'
          ORDER BY t.id ASC`
      )
      .all(userId) as TentativaRow[]

    return rows.map(toTentativa)
  }

  /**
   * O run tem merge em curso ou já confirmado e ainda não registrado no run?
   *
   * É o que o cancelamento consulta antes de vencer. Com o merge no ar, ou confirmado na origem e
   * pendente de registro, cancelar deixaria o run `CANCELLED` com o PR já mergeado — o que o
   * critério 5 proíbe.
   */
  emCursoDoRun(userId: string, runId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS ok FROM merge_tentativa t
           JOIN pipeline_run r ON r.id = t.run_id AND r.user_id = t.user_id
          WHERE t.user_id = ? AND t.run_id = ?
            AND (t.estado = 'iniciada'
                 OR (t.estado = 'confirmada' AND r.estado NOT IN (${PLACEHOLDERS_DOS_TERMINAIS})))
          LIMIT 1`
      )
      .get(userId, runId, ...TERMINAIS)

    return row !== undefined
  }
}
