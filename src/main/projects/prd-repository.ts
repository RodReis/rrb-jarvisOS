/**
 * Persistência do PRD, do Landscape e da Convention gerados (SPEC-Jornada-03).
 *
 * O repositório só persiste e consulta — auditar fica no serviço, que conhece o contexto
 * (gerou? regenerou? o PI cortou um proposto?). Mesma divisão do `BriefRepository` e do
 * `PacoteRepository`.
 *
 * **Não existe `update` nem `delete`, e a ausência é o desenho** — a sexta vez que esta postura
 * aparece no projeto, pela mesma razão das cinco anteriores. Regenerar **insere** outra linha, e
 * o `hash` UNIQUE reconhece quando o conteúdo é o mesmo. A spec é literal: *"regenerar depois de
 * aceitar cria revisão nova e reabre o gate — nunca substitui a aceita"*, e uma linha editável
 * faria o hash descrever um conteúdo que talvez não seja o que o PI leu.
 *
 * A única escrita posterior é `marcarCommit`, que preenche o `commit_hash` quando o marco vira
 * commit. Ela não toca conteúdo nem hash.
 */

import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import type { BloqueioExterno } from '@shared/domain/pacote-estrutural'
import type { AfirmacaoDoPrd, PrdRegistrado } from '@shared/domain/prd'
import { contradicaoGravada } from '@shared/domain/prd'
import { log } from '../logging/logger'

interface PrdRow {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: string
  readonly project_id: string
  readonly brief_hash: string
  readonly afirmacoes: string
  readonly contradicoes: string
  readonly bloqueio: string | null
  readonly hash: string
  readonly commit_hash: string | null
  readonly context_pack_id: string | null
  readonly created_at: string
}

/**
 * Lê o JSON de uma coluna de lista.
 *
 * **JSON ilegível vira lista vazia, e não exceção**, mesma postura de `parseLista` do
 * `BriefRepository`: uma linha corrompida não deve impedir o PI de reabrir o projeto. E, como
 * lá, a lista vazia é **visível** — um PRD sem afirmação nenhuma tem os três documentos vazios
 * na tela, e o que ele pede é regeneração, não silêncio.
 */
function parseLista<T>(raw: string, campo: string): readonly T[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    log.db.warn('Conteúdo do PRD ilegível; lista devolvida vazia', {
      op: 'select',
      table: 'project_prd',
      campo
    })
    return []
  }
}

/**
 * Lê o bloqueio gravado.
 *
 * Ilegível vira `undefined`, e a consequência é deliberada: o Landscape deixa de aparecer como
 * pendente. É o lado seguro aqui — um bloqueio fantasma travaria a leitura de um documento que
 * pode estar completo, enquanto a ausência dele só deixa de exibir um aviso cujo conteúdo o
 * banco já perdeu.
 */
function parseBloqueio(raw: string | null): BloqueioExterno | undefined {
  if (raw === null) return undefined

  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as BloqueioExterno) : undefined
  } catch {
    log.db.warn('Bloqueio do Landscape ilegível; tratado como ausente', {
      op: 'select',
      table: 'project_prd'
    })
    return undefined
  }
}

function toPrd(row: PrdRow): PrdRegistrado {
  const bloqueio = parseBloqueio(row.bloqueio)

  return {
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id as WorkspaceId,
    projectId: row.project_id,
    briefHash: row.brief_hash,
    afirmacoes: parseLista<AfirmacaoDoPrd>(row.afirmacoes, 'afirmacoes'),
    contradicoes: parseLista<Record<string, unknown>>(row.contradicoes, 'contradicoes').map(
      contradicaoGravada
    ),
    ...(bloqueio === undefined ? {} : { bloqueioDoLandscape: bloqueio }),
    hash: row.hash,
    commitHash: row.commit_hash,
    contextPackId: row.context_pack_id,
    created_at: row.created_at
  }
}

export class PrdRepository {
  constructor(private readonly db: Database) {}

  /**
   * Registra a revisão. Conteúdo idêntico **é** a mesma revisão: o `hash` UNIQUE a reconhece, e
   * devolver a existente evita estourar quando regenerar não mudou nada.
   */
  registrar(prd: PrdRegistrado): PrdRegistrado {
    const existente = this.findByHash(prd.user_id, prd.hash)
    if (existente !== undefined) return existente

    this.db
      .prepare(
        `INSERT INTO project_prd
           (id, user_id, workspace_id, project_id, brief_hash, afirmacoes, contradicoes,
            bloqueio, hash, commit_hash, context_pack_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        prd.id,
        prd.user_id,
        prd.workspace_id,
        prd.projectId,
        prd.briefHash,
        JSON.stringify(prd.afirmacoes),
        JSON.stringify(prd.contradicoes),
        prd.bloqueioDoLandscape === undefined ? null : JSON.stringify(prd.bloqueioDoLandscape),
        prd.hash,
        prd.commitHash,
        prd.contextPackId,
        prd.created_at
      )

    log.db.info('PRD registrado', { op: 'insert', table: 'project_prd' })
    return prd
  }

  /** A revisão vigente: a mais recente. As anteriores continuam no banco. */
  vigente(userId: string, projectId: string): PrdRegistrado | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM project_prd
          WHERE user_id = ? AND project_id = ?
          ORDER BY created_at DESC, rowid DESC
          LIMIT 1`
      )
      .get(userId, projectId) as PrdRow | undefined

    return row ? toPrd(row) : undefined
  }

  findByHash(userId: string, hash: string): PrdRegistrado | undefined {
    const row = this.db
      .prepare('SELECT * FROM project_prd WHERE user_id = ? AND hash = ?')
      .get(userId, hash) as PrdRow | undefined

    return row ? toPrd(row) : undefined
  }

  /** Todas as revisões do projeto, da mais recente à mais antiga. */
  listar(userId: string, projectId: string): readonly PrdRegistrado[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM project_prd
          WHERE user_id = ? AND project_id = ?
          ORDER BY created_at DESC, rowid DESC`
      )
      .all(userId, projectId) as PrdRow[]

    return rows.map(toPrd)
  }

  /** Aponta a linha para a revisão do Git. **Não toca conteúdo nem hash.** */
  marcarCommit(userId: string, prdId: string, commitHash: string): boolean {
    const r = this.db
      .prepare('UPDATE project_prd SET commit_hash = ? WHERE user_id = ? AND id = ?')
      .run(commitHash, userId, prdId)

    return r.changes > 0
  }
}
