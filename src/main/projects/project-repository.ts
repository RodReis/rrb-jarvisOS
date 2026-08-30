/**
 * Persistência de projeto e sessão de planejamento (SPEC-Planejamento-01).
 *
 * O repositório só persiste e consulta. Auditar fica no `ProjectService`, que conhece o
 * contexto (criou? importou? recusou por colisão?) e mantém o par evento → efeito no mesmo
 * fluxo — mesma divisão de `ApprovalRepository`.
 *
 * **A detecção de colisão mora aqui, em consulta, e não no `mkdir` do serviço.** O critério 3
 * exige que colisão não crie diretório parcial nem modifique o alvo, e a única forma de
 * garantir isso é perguntar antes de escrever: descobrir a colisão por exceção de FS já
 * significaria ter começado a escrever.
 */

import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import type {
  MarcoDocumental,
  PlanningSession,
  Project,
  ProjectOrigin
} from '@shared/domain/projects'
import { isMarcoDocumental } from '@shared/domain/projects'
import { log } from '../logging/logger'

interface ProjectRow {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: string
  readonly nome: string
  readonly slug: string
  readonly diretorio: string
  readonly origem: string
  readonly git_preexistente: number
  readonly created_at: string
}

interface SessionRow {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: string
  readonly project_id: string
  readonly etapa: string
  readonly respostas: string
  readonly ultimo_marco: string | null
  readonly updated_at: string
  readonly created_at: string
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id as WorkspaceId,
    nome: row.nome,
    slug: row.slug,
    diretorio: row.diretorio,
    origem: row.origem as ProjectOrigin,
    // SQLite não tem boolean: a coluna é 0/1 e a conversão mora aqui, uma vez, e não em cada
    // call site — onde um `row.git_preexistente` cru seria truthy até quando vale 0.
    gitPreexistente: row.git_preexistente === 1,
    created_at: row.created_at
  }
}

/**
 * Lê as respostas gravadas. JSON inválido vira mapa vazio em vez de estourar: a sessão é
 * estado de trabalho, e uma linha corrompida não deve impedir o usuário de reabrir o projeto —
 * ele perde o rascunho, não o projeto. Perder tudo por causa de um rascunho ilegível seria o
 * oposto do que o critério 1 (retomar sem perder identidade) protege.
 */
function parseRespostas(raw: string): Readonly<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    log.db.warn('Respostas de planejamento ilegíveis; sessão reaberta vazia', {
      op: 'select',
      table: 'planning_session'
    })
    return {}
  }
}

function toSession(row: SessionRow): PlanningSession {
  return {
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id as WorkspaceId,
    projectId: row.project_id,
    etapa: row.etapa,
    respostas: parseRespostas(row.respostas),
    // Marco desconhecido (gravado por uma versão futura, ou lixo) vira `null`, não a string
    // crua: o tipo promete um `MarcoDocumental`, e devolver algo fora do enum faria o mapa de
    // mensagens render `undefined` na tela de quem só confiou no tipo.
    ultimoMarco: isMarcoDocumental(row.ultimo_marco) ? row.ultimo_marco : null,
    updated_at: row.updated_at,
    created_at: row.created_at
  }
}

export class ProjectRepository {
  constructor(private readonly db: Database) {}

  /** Projetos do usuário naquele espaço, do mais recente para o mais antigo. */
  list(userId: string, workspaceId: WorkspaceId): readonly Project[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM project
          WHERE user_id = ? AND workspace_id = ?
          ORDER BY created_at DESC`
      )
      .all(userId, workspaceId) as ProjectRow[]

    return rows.map(toProject)
  }

  findById(userId: string, id: string): Project | undefined {
    const row = this.db
      .prepare('SELECT * FROM project WHERE user_id = ? AND id = ?')
      .get(userId, id) as ProjectRow | undefined

    return row ? toProject(row) : undefined
  }

  /**
   * O projeto que já ocupa aquele slug, se houver. É a consulta que detecta colisão **antes**
   * de escrever — e por isso ela devolve o projeto inteiro, não um booleano: a UI oferece
   * *retomar* o que colidiu (critério 1), e para retomar precisa saber qual é.
   */
  findBySlug(userId: string, workspaceId: WorkspaceId, slug: string): Project | undefined {
    const row = this.db
      .prepare('SELECT * FROM project WHERE user_id = ? AND workspace_id = ? AND slug = ?')
      .get(userId, workspaceId, slug) as ProjectRow | undefined

    return row ? toProject(row) : undefined
  }

  /**
   * O projeto já registrado naquele diretório, se houver. Separado de `findBySlug` porque a
   * importação colide por **diretório** e não por nome: o usuário pode importar um repositório
   * já registrado dando a ele outro nome, e sem esta consulta os dois projetos disputariam o
   * mesmo histórico Git.
   */
  findByDiretorio(userId: string, diretorio: string): Project | undefined {
    const row = this.db
      .prepare('SELECT * FROM project WHERE user_id = ? AND diretorio = ?')
      .get(userId, diretorio) as ProjectRow | undefined

    return row ? toProject(row) : undefined
  }

  save(project: Project): Project {
    this.db
      .prepare(
        `INSERT INTO project
           (id, user_id, workspace_id, nome, slug, diretorio, origem, git_preexistente, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        project.id,
        project.user_id,
        project.workspace_id,
        project.nome,
        project.slug,
        project.diretorio,
        project.origem,
        project.gitPreexistente ? 1 : 0,
        project.created_at
      )

    log.db.info('Projeto registrado', { op: 'insert', table: 'project' })
    return project
  }

  /**
   * Renomeia o projeto. **Só o nome de exibição** (decisão do PI, 2026-08-29): `slug` e
   * `diretorio` não se movem.
   *
   * O motivo de não mover a pasta é o custo assimétrico: renomear o diretório exigiria mover um
   * repositório Git no disco e invalidaria qualquer caminho que já aponte para ele — inclusive
   * os que o usuário anotou fora do app. Um nome de exibição errado se conserta digitando; um
   * repositório movido debaixo de quem o referencia, não.
   */
  rename(userId: string, id: string, nome: string): Project | undefined {
    const info = this.db
      .prepare('UPDATE project SET nome = ? WHERE user_id = ? AND id = ?')
      .run(nome, userId, id)

    if (info.changes === 0) return undefined

    log.db.info('Projeto renomeado', { op: 'update', table: 'project' })
    return this.findById(userId, id)
  }

  /**
   * Desregistra o projeto. **Não toca o disco** (decisão do PI, 2026-08-29): a pasta, os
   * arquivos e o histórico Git permanecem, e o usuário pode reimportá-los.
   *
   * A sessão de planejamento vai junto porque ela não existe sem o projeto — mantê-la órfã
   * deixaria um rascunho que nada consegue reabrir. O que **não** vai junto é nada em disco:
   * apagar arquivo do usuário como efeito de "remover da lista" é o tipo de perda que nenhum
   * desfazer resolve.
   */
  remove(userId: string, id: string): boolean {
    const removida = this.db.transaction((): boolean => {
      this.db
        .prepare('DELETE FROM planning_session WHERE user_id = ? AND project_id = ?')
        .run(userId, id)

      return (
        this.db.prepare('DELETE FROM project WHERE user_id = ? AND id = ?').run(userId, id)
          .changes > 0
      )
    })()

    if (removida) {
      log.db.info('Projeto desregistrado', { op: 'delete', table: 'project' })
    }

    return removida
  }

  /** A sessão de planejamento do projeto, se já existir. */
  findSession(userId: string, projectId: string): PlanningSession | undefined {
    const row = this.db
      .prepare('SELECT * FROM planning_session WHERE user_id = ? AND project_id = ?')
      .get(userId, projectId) as SessionRow | undefined

    return row ? toSession(row) : undefined
  }

  /**
   * Grava a sessão. **Upsert por `project_id`**, e não insert: o autosave roda a cada mudança
   * do wizard, e uma linha por gravação faria o estado de trabalho crescer sem limite e a
   * leitura ter de escolher entre versões — quando só a última interessa.
   *
   * A retomada depois de reinício (critério 1) é consequência direta disto: o próximo boot lê
   * a mesma linha, com o que foi gravado por último.
   */
  saveSession(session: PlanningSession): PlanningSession {
    this.db
      .prepare(
        `INSERT INTO planning_session
           (id, user_id, workspace_id, project_id, etapa, respostas, ultimo_marco,
            updated_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           etapa        = excluded.etapa,
           respostas    = excluded.respostas,
           ultimo_marco = excluded.ultimo_marco,
           updated_at   = excluded.updated_at`
      )
      .run(
        session.id,
        session.user_id,
        session.workspace_id,
        session.projectId,
        session.etapa,
        JSON.stringify(session.respostas),
        session.ultimoMarco,
        session.updated_at,
        session.created_at
      )

    log.db.info('Sessão de planejamento salva', { op: 'upsert', table: 'planning_session' })
    return session
  }

  /** Registra que um marco foi commitado. Só o marco muda; o rascunho fica como está. */
  marcarMarco(userId: string, projectId: string, marco: MarcoDocumental): void {
    this.db
      .prepare(
        `UPDATE planning_session
            SET ultimo_marco = ?, updated_at = ?
          WHERE user_id = ? AND project_id = ?`
      )
      .run(marco, new Date().toISOString(), userId, projectId)

    log.db.info('Marco documental registrado', { op: 'update', table: 'planning_session' })
  }
}
