/**
 * Persistência dos anexos de design e do pacote de arquitetura (SPEC-Planejamento-05).
 *
 * O repositório só persiste e consulta — auditar fica no serviço, mesma divisão do
 * `PacoteRepository` e do `DecisionRepository`.
 *
 * **`design_attachment` tem `update`, e as duas tabelas irmãs não.** A diferença não é descuido:
 * um pacote é uma *revisão* (regerar insere outra, e o hash reconhece a igualdade), enquanto um
 * anexo é um *lugar* — `docs/prototipos/home.html` é um só, e reanexar é substituir o arquivo
 * que está ali. Insistir em append-only aqui daria ao gate duas linhas para o mesmo caminho e a
 * pergunta *"qual hash está no disco?"* passaria a ter duas respostas, sendo que só uma é
 * verdade. O `UNIQUE(user_id, project_id, caminho)` é o que torna isso explícito no schema.
 *
 * `pacote_arquitetura` **não** tem update, pela mesma razão dos outros pacotes: ele descreve o
 * que foi escrito no disco, e editá-lo faria o hash descrever outra coisa.
 */

import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import type { Anexo, TipoDeAnexo } from '@shared/domain/anexos-de-design'
import type { DocumentoGerado } from '@shared/domain/pacote-estrutural'
import type { PacoteArquitetura } from '@shared/domain/arquitetura'
import { log } from '../logging/logger'

interface AnexoRow {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: string
  readonly project_id: string
  readonly tipo: string
  readonly caminho: string
  readonly origem: string
  readonly hash: string
  readonly bytes: number
  readonly anexado_em: string
}

interface ArquiteturaRow {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: string
  readonly project_id: string
  readonly pacote_estrutural_id: string
  readonly documentos: string
  readonly anexos: string
  readonly hash: string
  readonly commit_hash: string | null
  readonly created_at: string
}

function toAnexo(row: AnexoRow): Anexo {
  return {
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id as WorkspaceId,
    projectId: row.project_id,
    tipo: row.tipo as TipoDeAnexo,
    caminho: row.caminho,
    origem: row.origem,
    hash: row.hash,
    bytes: row.bytes,
    anexadoEm: row.anexado_em
  }
}

/**
 * Lê JSON gravado. Ilegível devolve vazio em vez de estourar — mesma postura do
 * `parseDocumentos` da M8-F04: um pacote corrompido não deve impedir o usuário de abrir o
 * projeto, e o arquivo no disco continua sendo a fonte do que foi escrito.
 */
function parseJson<T>(raw: string, tabela: string): readonly T[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    log.db.warn('JSON do pacote ilegível; devolvido sem conteúdo', { op: 'select', table: tabela })
    return []
  }
}

function toArquitetura(row: ArquiteturaRow): PacoteArquitetura {
  return {
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id as WorkspaceId,
    projectId: row.project_id,
    pacoteEstruturalId: row.pacote_estrutural_id,
    documentos: parseJson<DocumentoGerado>(row.documentos, 'pacote_arquitetura'),
    anexos: parseJson<Anexo>(row.anexos, 'pacote_arquitetura'),
    hash: row.hash,
    commitHash: row.commit_hash,
    created_at: row.created_at
  }
}

export class AnexoRepository {
  constructor(private readonly db: Database) {}

  /**
   * Registra o ato de anexar — ou substitui o anexo que ocupava o mesmo caminho.
   *
   * `ON CONFLICT ... DO UPDATE` e não `INSERT` puro: o destino é único (o arquivo no disco é um
   * só), e reanexar precisa atualizar hash e instante juntos, numa escrita. Duas operações
   * (delete + insert) deixariam uma janela em que o gate veria o projeto sem o anexo.
   */
  registrar(anexo: Anexo): Anexo {
    this.db
      .prepare(
        `INSERT INTO design_attachment
           (id, user_id, workspace_id, project_id, tipo, caminho, origem, hash, bytes, anexado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, project_id, caminho) DO UPDATE SET
           tipo = excluded.tipo,
           origem = excluded.origem,
           hash = excluded.hash,
           bytes = excluded.bytes,
           anexado_em = excluded.anexado_em`
      )
      .run(
        anexo.id,
        anexo.user_id,
        anexo.workspace_id,
        anexo.projectId,
        anexo.tipo,
        anexo.caminho,
        anexo.origem,
        anexo.hash,
        anexo.bytes,
        anexo.anexadoEm
      )

    log.db.info('Anexo de design registrado', { op: 'insert', table: 'design_attachment' })

    // Relê em vez de devolver o argumento: numa substituição o `id` que vale é o da linha que já
    // existia, e devolver o novo daria à tela um identificador que o banco não tem.
    const row = this.db
      .prepare(
        'SELECT * FROM design_attachment WHERE user_id = ? AND project_id = ? AND caminho = ?'
      )
      .get(anexo.user_id, anexo.projectId, anexo.caminho) as AnexoRow | undefined

    return row ? toAnexo(row) : anexo
  }

  /** Os anexos do projeto, do mais antigo ao mais recente. */
  listar(userId: string, projectId: string): readonly Anexo[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM design_attachment WHERE user_id = ? AND project_id = ? ORDER BY anexado_em, rowid'
      )
      .all(userId, projectId) as AnexoRow[]
    return rows.map(toAnexo)
  }

  /**
   * Remove o anexo. É a única exclusão do módulo, e existe porque o PI pode ter anexado o
   * arquivo errado — sem ela, um protótipo enganado ficaria para sempre satisfazendo o gate.
   *
   * **Não apaga o arquivo do disco**, pela mesma razão que `projectRemove` não apaga a pasta:
   * apagar arquivo do usuário é operação destrutiva, e destrutivo pertence ao fluxo de aprovação
   * humana — não a um efeito colateral de desregistrar.
   */
  remover(userId: string, projectId: string, caminho: string): boolean {
    const r = this.db
      .prepare('DELETE FROM design_attachment WHERE user_id = ? AND project_id = ? AND caminho = ?')
      .run(userId, projectId, caminho)
    return r.changes > 0
  }

  /**
   * Grava o pacote de arquitetura — ou devolve o existente quando o conteúdo é o mesmo.
   *
   * Mesma postura do `registrarPacote` da M8-F04: remontar um pacote idêntico **é** a mesma
   * revisão, e inserir outra linha daria duas identidades ao mesmo conteúdo.
   */
  registrarArquitetura(pacote: PacoteArquitetura): PacoteArquitetura {
    const existente = this.db
      .prepare('SELECT * FROM pacote_arquitetura WHERE user_id = ? AND hash = ?')
      .get(pacote.user_id, pacote.hash) as ArquiteturaRow | undefined

    if (existente !== undefined) return toArquitetura(existente)

    this.db
      .prepare(
        `INSERT INTO pacote_arquitetura
           (id, user_id, workspace_id, project_id, pacote_estrutural_id, documentos, anexos,
            hash, commit_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        pacote.id,
        pacote.user_id,
        pacote.workspace_id,
        pacote.projectId,
        pacote.pacoteEstruturalId,
        JSON.stringify(pacote.documentos),
        JSON.stringify(pacote.anexos),
        pacote.hash,
        pacote.commitHash,
        pacote.created_at
      )

    log.db.info('Pacote de arquitetura registrado', { op: 'insert', table: 'pacote_arquitetura' })
    return pacote
  }

  /** Os pacotes de arquitetura do projeto, do mais recente ao mais antigo. */
  listarArquiteturas(userId: string, projectId: string): readonly PacoteArquitetura[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM pacote_arquitetura WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC, rowid DESC'
      )
      .all(userId, projectId) as ArquiteturaRow[]
    return rows.map(toArquitetura)
  }

  /** Preenche o `commit_hash` quando o marco vira commit. Não toca conteúdo nem hash. */
  marcarCommit(userId: string, pacoteId: string, commitHash: string): void {
    this.db
      .prepare('UPDATE pacote_arquitetura SET commit_hash = ? WHERE user_id = ? AND id = ?')
      .run(commitHash, userId, pacoteId)
  }
}
