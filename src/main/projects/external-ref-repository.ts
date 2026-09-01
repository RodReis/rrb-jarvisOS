/**
 * Persistência das referências externas da publicação (SPEC-Entrega-01, emenda 6 de 2026-08-30).
 *
 * O que o app publicou no GitHub, e onde. Existe porque **as fatias seguintes precisam disso e não
 * deveriam redescobrir**: a M9-F05 escreve `refs #N` e precisa do número da issue; a reconciliação
 * da M9-F02 precisa dos SHAs publicados. Sem a tabela, cada uma faria uma chamada de rede a mais
 * por fatia — e receberia uma resposta que pode ter mudado no intervalo.
 *
 * **`upsert`, não `insert`.** Republicar é a operação normal desta fatia (o critério 1 existe para
 * isso), e um `INSERT` acumularia uma linha por publicação: "qual é o número da issue desta fatia?"
 * passaria a ter várias respostas, e escolher entre elas seria adivinhar. O `UNIQUE` sobre
 * `(user_id, project_id, alvo, chave_externa)` é a metade local da idempotência que o `ensure*`
 * garante do lado do GitHub.
 *
 * Deliberadamente **não** é append-only, ao contrário de `approval` e `pacote_estrutural`: aqueles
 * guardam o que alguém decidiu, e reescrever apagaria a decisão. Este guarda **onde o recurso
 * está** — um fato que muda quando o recurso muda, e cuja versão antiga não é evidência de nada.
 */

import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import type { AlvoDeRef, ReferenciaExterna } from '@shared/domain/publicacao'
import { log } from '../logging/logger'

/** O escopo obrigatório de toda leitura e escrita (CONVENTION §2). */
export interface EscopoDaRef {
  readonly userId: string
  readonly workspaceId: WorkspaceId
  readonly projectId: string
}

interface RefRow {
  readonly alvo: string
  readonly chave_externa: string
  readonly ref_id: string
  readonly url: string | null
  readonly sha: string | null
  readonly limitacao: string | null
}

function toRef(row: RefRow): ReferenciaExterna {
  return {
    alvo: row.alvo as AlvoDeRef,
    chaveExterna: row.chave_externa,
    refId: row.ref_id,
    ...(row.url === null ? {} : { url: row.url }),
    ...(row.sha === null ? {} : { sha: row.sha }),
    ...(row.limitacao === null ? {} : { limitacao: row.limitacao })
  }
}

export class ExternalRefRepository {
  constructor(private readonly db: Database) {}

  /**
   * Grava a referência, ou atualiza a que já existe para a mesma chave.
   *
   * `created_at` é preservado no conflito e só `updated_at` anda: a pergunta "quando este recurso
   * passou a existir" continua respondível depois de uma republicação, que é o que a reconciliação
   * da M9-F02 vai querer saber para distinguir o que ela criou do que já estava lá.
   */
  upsert(escopo: EscopoDaRef, ref: ReferenciaExterna): ReferenciaExterna {
    const agora = new Date().toISOString()

    this.db
      .prepare(
        `INSERT INTO external_ref
           (id, user_id, workspace_id, project_id, alvo, chave_externa, ref_id, url, sha,
            limitacao, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, project_id, alvo, chave_externa) DO UPDATE SET
           ref_id     = excluded.ref_id,
           url        = excluded.url,
           sha        = excluded.sha,
           limitacao  = excluded.limitacao,
           updated_at = excluded.updated_at`
      )
      .run(
        randomUUID(),
        escopo.userId,
        escopo.workspaceId,
        escopo.projectId,
        ref.alvo,
        ref.chaveExterna,
        ref.refId,
        ref.url ?? null,
        ref.sha ?? null,
        ref.limitacao ?? null,
        agora,
        agora
      )

    log.db.info('Referência externa registrada', { op: 'upsert', table: 'external_ref' })
    return ref
  }

  /** Todas as referências do projeto, na ordem em que nasceram. */
  listar(escopo: EscopoDaRef): readonly ReferenciaExterna[] {
    const rows = this.db
      .prepare(
        `SELECT alvo, chave_externa, ref_id, url, sha, limitacao FROM external_ref
          WHERE user_id = ? AND project_id = ?
          ORDER BY created_at, rowid`
      )
      .all(escopo.userId, escopo.projectId) as RefRow[]

    return rows.map(toRef)
  }

  /**
   * A referência de uma chave, se existir.
   *
   * É o que torna a reconciliação barata: antes de perguntar à origem, a publicação pergunta ao
   * banco. Devolve `undefined` — e não uma referência vazia — porque "não publiquei isto" e
   * "publiquei e não sei onde" são estados diferentes, e o segundo não deve existir.
   */
  buscar(
    escopo: EscopoDaRef,
    alvo: AlvoDeRef,
    chaveExterna: string
  ): ReferenciaExterna | undefined {
    const row = this.db
      .prepare(
        `SELECT alvo, chave_externa, ref_id, url, sha, limitacao FROM external_ref
          WHERE user_id = ? AND project_id = ? AND alvo = ? AND chave_externa = ?`
      )
      .get(escopo.userId, escopo.projectId, alvo, chaveExterna) as RefRow | undefined

    return row === undefined ? undefined : toRef(row)
  }
}
