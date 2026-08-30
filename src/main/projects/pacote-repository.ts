/**
 * Persistência da evidência e do pacote estrutural (SPEC-Planejamento-04).
 *
 * O repositório só persiste e consulta — auditar fica no serviço, mesma divisão do
 * `ProjectRepository` e do `DecisionRepository`.
 *
 * **Não existe `update` nem `delete` aqui, e a ausência é o desenho** — a terceira vez que esta
 * postura aparece no projeto, pela mesma razão das duas anteriores: regerar o pacote **insere**
 * outro, e o `hash` UNIQUE reconhece quando o conteúdo é o mesmo. Um método de edição faria o
 * hash descrever um conteúdo que talvez não seja o que virou commit, e o invariante 2 do
 * `CONVENTION.md` §4 passaria a depender de ninguém ter mexido depois.
 *
 * A única escrita posterior é `marcarCommit`, que preenche o `commit_hash` quando o marco vira
 * commit. Ela não toca o conteúdo nem o hash: o pacote continua descrevendo exatamente o que
 * foi escrito no disco, e ganha só o ponteiro para a revisão do Git.
 */

import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import type { EvidenceItem } from '@shared/domain/tavily'
import type { DocumentoGerado, PacoteEstrutural } from '@shared/domain/pacote-estrutural'
import { log } from '../logging/logger'

interface EvidenceRow {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: string
  readonly project_id: string
  readonly url: string
  readonly url_original: string
  readonly dominio: string
  readonly titulo: string | null
  readonly publicado_em: string | null
  readonly coletado_em: string
  readonly conteudo: string
  readonly hash_conteudo: string
  readonly trecho: string | null
  readonly hash_trecho: string | null
  readonly request_id: string | null
  readonly created_at: string
}

interface PacoteRow {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: string
  readonly project_id: string
  readonly documentos: string
  readonly hash: string
  readonly commit_hash: string | null
  readonly created_at: string
}

/**
 * Converte a linha em `EvidenceItem`.
 *
 * Campo opcional volta como `undefined`, não `null`: o tipo do domínio usa `?`, e devolver
 * `null` faria `titulo ?? 'sem título'` funcionar mas `'titulo' in item` mentir.
 */
function toEvidence(row: EvidenceRow): EvidenceItem {
  return {
    url: row.url,
    urlOriginal: row.url_original,
    dominio: row.dominio,
    titulo: row.titulo ?? undefined,
    publicadoEm: row.publicado_em ?? undefined,
    coletadoEm: row.coletado_em,
    conteudo: row.conteudo,
    hashConteudo: row.hash_conteudo,
    trecho: row.trecho ?? undefined,
    hashTrecho: row.hash_trecho ?? undefined,
    requestId: row.request_id ?? undefined
  }
}

/**
 * Lê os documentos gravados. JSON ilegível devolve lista vazia em vez de estourar — mesma
 * postura do `parseRespostas` da M8-F01: um pacote corrompido não deve impedir o usuário de
 * abrir o projeto, e o arquivo no disco continua sendo a fonte do que foi escrito.
 */
function parseDocumentos(raw: string): readonly DocumentoGerado[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as DocumentoGerado[]) : []
  } catch {
    log.db.warn('Documentos do pacote ilegíveis; pacote devolvido sem conteúdo', {
      op: 'select',
      table: 'pacote_estrutural'
    })
    return []
  }
}

function toPacote(row: PacoteRow): PacoteEstrutural {
  return {
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id as WorkspaceId,
    projectId: row.project_id,
    documentos: parseDocumentos(row.documentos),
    hash: row.hash,
    commitHash: row.commit_hash,
    created_at: row.created_at
  }
}

/** O que o repositório precisa saber para gravar uma evidência. */
export interface EvidenciaParaGravar {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly projectId: string
  readonly item: EvidenceItem
  readonly created_at: string
}

export class PacoteRepository {
  constructor(private readonly db: Database) {}

  /**
   * Grava as evidências de uma coleta, numa transação.
   *
   * Tudo ou nada de propósito: metade das evidências gravadas descreveria uma pesquisa que não
   * aconteceu, e o `LANDSCAPE.md` gerado a partir dela citaria fonte cuja prova ficou faltando.
   */
  registrarEvidencias(evidencias: readonly EvidenciaParaGravar[]): number {
    if (evidencias.length === 0) return 0

    const insert = this.db.prepare(
      `INSERT INTO evidence
         (id, user_id, workspace_id, project_id, url, url_original, dominio, titulo,
          publicado_em, coletado_em, conteudo, hash_conteudo, trecho, hash_trecho,
          request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    this.db.transaction((linhas: readonly EvidenciaParaGravar[]) => {
      for (const e of linhas) {
        insert.run(
          e.id,
          e.user_id,
          e.workspace_id,
          e.projectId,
          e.item.url,
          e.item.urlOriginal,
          e.item.dominio,
          e.item.titulo ?? null,
          e.item.publicadoEm ?? null,
          e.item.coletadoEm,
          e.item.conteudo,
          e.item.hashConteudo,
          e.item.trecho ?? null,
          e.item.hashTrecho ?? null,
          e.item.requestId ?? null,
          e.created_at
        )
      }
    })(evidencias)

    log.db.info('Evidências registradas', { op: 'insert', table: 'evidence' })
    return evidencias.length
  }

  /** As evidências do projeto, da mais antiga para a mais recente. */
  listarEvidencias(userId: string, projectId: string): readonly EvidenceItem[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM evidence WHERE user_id = ? AND project_id = ? ORDER BY created_at, rowid'
      )
      .all(userId, projectId) as EvidenceRow[]
    return rows.map(toEvidence)
  }

  /**
   * Grava o pacote — ou devolve o existente quando o conteúdo canônico é o mesmo.
   *
   * O `hash` é UNIQUE, e remontar um pacote idêntico **é** a mesma revisão: inserir outra linha
   * daria duas identidades ao mesmo conteúdo, e *"qual pacote virou este commit?"* passaria a
   * ter duas respostas certas. Mesma postura do `context_pack` da M8-F02.
   */
  registrarPacote(pacote: PacoteEstrutural): PacoteEstrutural {
    const existente = this.findByHash(pacote.user_id, pacote.hash)
    if (existente !== undefined) return existente

    this.db
      .prepare(
        `INSERT INTO pacote_estrutural
           (id, user_id, workspace_id, project_id, documentos, hash, commit_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        pacote.id,
        pacote.user_id,
        pacote.workspace_id,
        pacote.projectId,
        JSON.stringify(pacote.documentos),
        pacote.hash,
        pacote.commitHash,
        pacote.created_at
      )

    log.db.info('Pacote estrutural registrado', { op: 'insert', table: 'pacote_estrutural' })
    return pacote
  }

  findByHash(userId: string, hash: string): PacoteEstrutural | undefined {
    const row = this.db
      .prepare('SELECT * FROM pacote_estrutural WHERE user_id = ? AND hash = ?')
      .get(userId, hash) as PacoteRow | undefined
    return row === undefined ? undefined : toPacote(row)
  }

  /** Os pacotes do projeto, do mais recente ao mais antigo (ordem de inserção). */
  listarPacotes(userId: string, projectId: string): readonly PacoteEstrutural[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM pacote_estrutural WHERE user_id = ? AND project_id = ? ORDER BY rowid DESC'
      )
      .all(userId, projectId) as PacoteRow[]
    return rows.map(toPacote)
  }

  /**
   * Aponta o pacote para a revisão do Git. Não toca conteúdo nem hash — o pacote continua
   * descrevendo o que foi escrito no disco, e ganha só o ponteiro para o commit.
   */
  marcarCommit(userId: string, pacoteId: string, commitHash: string): boolean {
    const resultado = this.db
      .prepare('UPDATE pacote_estrutural SET commit_hash = ? WHERE user_id = ? AND id = ?')
      .run(commitHash, userId, pacoteId)
    return resultado.changes > 0
  }
}
