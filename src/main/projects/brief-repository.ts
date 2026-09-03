/**
 * Persistência do prompt e do brief (SPEC-Jornada-02).
 *
 * O repositório só persiste e consulta — auditar fica no serviço, que conhece o contexto
 * (gerou? regenerou? o PI cortou um proposto?). Mesma divisão do `ProjectRepository`, do
 * `DecisionRepository` e do `PacoteRepository`.
 *
 * **Não existe `update` nem `delete`, e a ausência é o desenho** — a quarta vez que esta postura
 * aparece no projeto, pela mesma razão das três anteriores. Editar o prompt **insere** outra
 * linha; regenerar o brief **insere** outro. O critério 4 pede reproduzir qual revisão o PI
 * aceitou, e uma linha editável descreveria um brief que talvez não seja o que ele leu.
 *
 * A única escrita posterior é `marcarCommit`, que preenche o `commit_hash` quando o marco vira
 * commit. Ela não toca conteúdo nem hash: a linha continua descrevendo exatamente o que foi
 * gravado, e ganha só o ponteiro para a revisão do Git.
 */

import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import type { Afirmacao, BriefRegistrado, Pendencia, PromptDoProjeto } from '@shared/domain/brief'
import { log } from '../logging/logger'

interface PromptRow {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: string
  readonly project_id: string
  readonly texto: string
  readonly hash: string
  readonly commit_hash: string | null
  readonly created_at: string
}

interface BriefRow {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: string
  readonly project_id: string
  readonly prompt_id: string
  readonly afirmacoes: string
  readonly pendencias: string
  readonly hash: string
  readonly commit_hash: string | null
  readonly context_pack_id: string | null
  readonly created_at: string
}

function toPrompt(row: PromptRow): PromptDoProjeto {
  return {
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id as WorkspaceId,
    projectId: row.project_id,
    texto: row.texto,
    hash: row.hash,
    commitHash: row.commit_hash,
    created_at: row.created_at
  }
}

/**
 * Lê o JSON de afirmações ou pendências.
 *
 * **JSON ilegível vira lista vazia, e não exceção**, pela mesma razão que `parseRespostas` do
 * `ProjectRepository`: uma linha corrompida não deve impedir o PI de reabrir o projeto. Mas há
 * uma diferença que importa — aqui a lista vazia é **visível**: um brief sem afirmação nenhuma
 * não passa no gate, porque `blocosEmAberto` acusa os dez blocos descobertos. O dado corrompido
 * não vira silêncio; vira um brief que pede regeneração.
 */
function parseLista<T>(raw: string, campo: string): readonly T[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    log.db.warn('Conteúdo do brief ilegível; lista devolvida vazia', {
      op: 'select',
      table: 'project_brief',
      campo
    })
    return []
  }
}

function toBrief(row: BriefRow): BriefRegistrado {
  return {
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id as WorkspaceId,
    projectId: row.project_id,
    promptId: row.prompt_id,
    afirmacoes: parseLista<Afirmacao>(row.afirmacoes, 'afirmacoes'),
    pendencias: parseLista<Pendencia>(row.pendencias, 'pendencias'),
    hash: row.hash,
    commitHash: row.commit_hash,
    contextPackId: row.context_pack_id,
    created_at: row.created_at
  }
}

export type { BriefRegistrado, PromptDoProjeto }

export class BriefRepository {
  constructor(private readonly db: Database) {}

  /** Registra o prompt do PI. Append-only: editar o prompt insere outra linha. */
  registrarPrompt(prompt: PromptDoProjeto): PromptDoProjeto {
    this.db
      .prepare(
        `INSERT INTO project_prompt
           (id, user_id, workspace_id, project_id, texto, hash, commit_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        prompt.id,
        prompt.user_id,
        prompt.workspace_id,
        prompt.projectId,
        prompt.texto,
        prompt.hash,
        prompt.commitHash,
        prompt.created_at
      )

    log.db.info('Prompt do projeto registrado', { op: 'insert', table: 'project_prompt' })
    return prompt
  }

  /** O prompt vigente: o mais recente. Os anteriores continuam no banco como revisões. */
  promptVigente(userId: string, projectId: string): PromptDoProjeto | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM project_prompt
          WHERE user_id = ? AND project_id = ?
          ORDER BY created_at DESC, rowid DESC
          LIMIT 1`
      )
      .get(userId, projectId) as PromptRow | undefined

    return row ? toPrompt(row) : undefined
  }

  /** Todos os prompts do projeto, do mais recente ao mais antigo. */
  listarPrompts(userId: string, projectId: string): readonly PromptDoProjeto[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM project_prompt
          WHERE user_id = ? AND project_id = ?
          ORDER BY created_at DESC, rowid DESC`
      )
      .all(userId, projectId) as PromptRow[]

    return rows.map(toPrompt)
  }

  /**
   * Registra o brief. O `hash` é UNIQUE: dois briefs com o mesmo conteúdo canônico **são** o
   * mesmo brief, e regenerar sem mudar nada não cria revisão nova — mesma disciplina do
   * `pacote_estrutural`.
   */
  registrarBrief(brief: BriefRegistrado): BriefRegistrado {
    this.db
      .prepare(
        `INSERT INTO project_brief
           (id, user_id, workspace_id, project_id, prompt_id, afirmacoes, pendencias,
            hash, commit_hash, context_pack_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        brief.id,
        brief.user_id,
        brief.workspace_id,
        brief.projectId,
        brief.promptId,
        JSON.stringify(brief.afirmacoes),
        JSON.stringify(brief.pendencias),
        brief.hash,
        brief.commitHash,
        brief.contextPackId,
        brief.created_at
      )

    log.db.info('Brief registrado', { op: 'insert', table: 'project_brief' })
    return brief
  }

  /** O brief vigente: o mais recente. */
  briefVigente(userId: string, projectId: string): BriefRegistrado | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM project_brief
          WHERE user_id = ? AND project_id = ?
          ORDER BY created_at DESC, rowid DESC
          LIMIT 1`
      )
      .get(userId, projectId) as BriefRow | undefined

    return row ? toBrief(row) : undefined
  }

  findBriefByHash(userId: string, hash: string): BriefRegistrado | undefined {
    const row = this.db
      .prepare('SELECT * FROM project_brief WHERE user_id = ? AND hash = ?')
      .get(userId, hash) as BriefRow | undefined

    return row ? toBrief(row) : undefined
  }

  /** Todos os briefs do projeto, do mais recente ao mais antigo. */
  listarBriefs(userId: string, projectId: string): readonly BriefRegistrado[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM project_brief
          WHERE user_id = ? AND project_id = ?
          ORDER BY created_at DESC, rowid DESC`
      )
      .all(userId, projectId) as BriefRow[]

    return rows.map(toBrief)
  }

  /**
   * Aponta a linha para a revisão do Git. **Não toca conteúdo nem hash** — a linha continua
   * descrevendo exatamente o que foi gravado.
   */
  marcarCommitDoPrompt(userId: string, promptId: string, commitHash: string): boolean {
    const r = this.db
      .prepare('UPDATE project_prompt SET commit_hash = ? WHERE user_id = ? AND id = ?')
      .run(commitHash, userId, promptId)

    return r.changes > 0
  }

  marcarCommitDoBrief(userId: string, briefId: string, commitHash: string): boolean {
    const r = this.db
      .prepare('UPDATE project_brief SET commit_hash = ? WHERE user_id = ? AND id = ?')
      .run(commitHash, userId, briefId)

    return r.changes > 0
  }
}
