/**
 * Persistência da arquitetura gerada por IA (SPEC-Jornada-04).
 *
 * O repositório só persiste e consulta — auditar fica no serviço, que conhece o contexto (gerou?
 * regenerou? o PI cortou um proposto?). Mesma divisão do `PrdRepository` e do `AnexoRepository`.
 *
 * **Não existe `update` nem `delete`, e a ausência é o desenho** — a sétima vez que esta postura
 * aparece no projeto, pela mesma razão das seis anteriores. Regenerar **insere** outra linha, e o
 * `hash` UNIQUE reconhece quando o conteúdo é o mesmo. O critério 6 é literal: *"regenerar após
 * aceite cria revisão nova; a aceita não muda"*, e uma linha editável faria o hash descrever um
 * conteúdo que talvez não seja o que o PI leu.
 *
 * A única escrita posterior é `marcarCommit`, que preenche o `commit_hash` quando o marco vira
 * commit. Ela não toca conteúdo nem hash.
 */

import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import type { Anexo } from '@shared/domain/anexos-de-design'
import type {
  AfirmacaoDaArquitetura,
  AjusteProposto,
  ArquiteturaRegistrada
} from '@shared/domain/arquitetura-gerada'
import { log } from '../logging/logger'

interface ArquiteturaGeradaRow {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: string
  readonly project_id: string
  readonly pacote_estrutural_id: string
  readonly afirmacoes: string
  readonly ajustes: string
  readonly anexos: string
  readonly hash: string
  readonly commit_hash: string | null
  readonly context_pack_id: string | null
  readonly created_at: string
}

/**
 * Lê o JSON de uma coluna de lista.
 *
 * **JSON ilegível vira lista vazia, e não exceção**, mesma postura de `parseLista` do
 * `PrdRepository`: uma linha corrompida não deve impedir o PI de reabrir o projeto. E, como lá, a
 * lista vazia é **visível** — uma arquitetura sem afirmação nenhuma tem os quatro documentos
 * vazios na tela, e o que ela pede é regeneração, não silêncio.
 */
function parseLista<T>(raw: string, campo: string): readonly T[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    log.db.warn('Conteúdo da arquitetura ilegível; lista devolvida vazia', {
      op: 'select',
      table: 'project_architecture',
      campo
    })
    return []
  }
}

function toArquitetura(row: ArquiteturaGeradaRow): ArquiteturaRegistrada {
  return {
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id as WorkspaceId,
    projectId: row.project_id,
    pacoteEstruturalId: row.pacote_estrutural_id,
    afirmacoes: parseLista<AfirmacaoDaArquitetura>(row.afirmacoes, 'afirmacoes'),
    ajustes: parseLista<AjusteProposto>(row.ajustes, 'ajustes'),
    anexos: parseLista<Anexo>(row.anexos, 'anexos'),
    hash: row.hash,
    commitHash: row.commit_hash,
    contextPackId: row.context_pack_id,
    created_at: row.created_at
  }
}

export class ArquiteturaRepository {
  constructor(private readonly db: Database) {}

  /**
   * Registra a revisão. Conteúdo idêntico **é** a mesma revisão: o `hash` UNIQUE a reconhece, e
   * devolver a existente evita estourar quando regenerar não mudou nada.
   */
  registrar(arquitetura: ArquiteturaRegistrada): ArquiteturaRegistrada {
    const existente = this.findByHash(arquitetura.user_id, arquitetura.hash)
    if (existente !== undefined) return existente

    this.db
      .prepare(
        `INSERT INTO project_architecture
           (id, user_id, workspace_id, project_id, pacote_estrutural_id, afirmacoes, ajustes,
            anexos, hash, commit_hash, context_pack_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        arquitetura.id,
        arquitetura.user_id,
        arquitetura.workspace_id,
        arquitetura.projectId,
        arquitetura.pacoteEstruturalId,
        JSON.stringify(arquitetura.afirmacoes),
        JSON.stringify(arquitetura.ajustes),
        JSON.stringify(arquitetura.anexos),
        arquitetura.hash,
        arquitetura.commitHash,
        arquitetura.contextPackId,
        arquitetura.created_at
      )

    log.db.info('Arquitetura registrada', { op: 'insert', table: 'project_architecture' })
    return arquitetura
  }

  /** A revisão vigente: a mais recente. As anteriores continuam no banco. */
  vigente(userId: string, projectId: string): ArquiteturaRegistrada | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM project_architecture
          WHERE user_id = ? AND project_id = ?
          ORDER BY created_at DESC, rowid DESC
          LIMIT 1`
      )
      .get(userId, projectId) as ArquiteturaGeradaRow | undefined

    return row ? toArquitetura(row) : undefined
  }

  findByHash(userId: string, hash: string): ArquiteturaRegistrada | undefined {
    const row = this.db
      .prepare('SELECT * FROM project_architecture WHERE user_id = ? AND hash = ?')
      .get(userId, hash) as ArquiteturaGeradaRow | undefined

    return row ? toArquitetura(row) : undefined
  }

  /** Todas as revisões do projeto, da mais recente à mais antiga. */
  listar(userId: string, projectId: string): readonly ArquiteturaRegistrada[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM project_architecture
          WHERE user_id = ? AND project_id = ?
          ORDER BY created_at DESC, rowid DESC`
      )
      .all(userId, projectId) as ArquiteturaGeradaRow[]

    return rows.map(toArquitetura)
  }

  /** Aponta a linha para a revisão do Git. **Não toca conteúdo nem hash.** */
  marcarCommit(userId: string, arquiteturaId: string, commitHash: string): boolean {
    const r = this.db
      .prepare('UPDATE project_architecture SET commit_hash = ? WHERE user_id = ? AND id = ?')
      .run(commitHash, userId, arquiteturaId)

    return r.changes > 0
  }
}
