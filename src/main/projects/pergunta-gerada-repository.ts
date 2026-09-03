/**
 * Persistência das perguntas de refinamento geradas por IA (SPEC-Jornada-02, § Refinamento).
 *
 * **Por que não é o `DecisionRepository` sozinho.** `Decision` guarda a *resposta*; ele não
 * guarda a *pergunta* quando ela não vem de um catálogo fixo em código. A M8-F03 podia deixar a
 * pergunta implícita porque `CATALOGO_DO_CONTEXTO` é código versionado. Aqui a pergunta é
 * gerada por projeto, a partir do prompt daquele projeto — sem persisti-la, reabrir o projeto
 * no meio do refinamento perderia o enunciado, as opções e a justificativa que o PI lia.
 *
 * **Não existe `update`, e a ausência é o desenho** — a quinta vez com esta postura no
 * projeto. Regenerar insere as perguntas que faltam; `marcarRespondida` é a única escrita
 * posterior, e ela não toca o conteúdo da pergunta — só o estado.
 */

import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import type { OpcaoDaPergunta } from '@shared/domain/wizard'
import type { PerguntaGerada } from '@shared/domain/pergunta-gerada'
import { log } from '../logging/logger'

/** Uma pergunta gerada, com o estado que só o banco guarda. */
export interface PerguntaGeradaRegistrada extends PerguntaGerada {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly projectId: string
  readonly estado: 'pendente' | 'respondida'
  readonly created_at: string
}

interface PerguntaRow {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: string
  readonly project_id: string
  readonly bloco: string
  readonly por_que: string
  readonly titulo: string
  readonly enunciado: string
  readonly opcoes: string
  readonly recomendada: string
  readonly justificativa: string
  readonly aceita_texto_livre: number
  readonly delegavel: number
  readonly estado: string
  readonly created_at: string
}

/**
 * Lê o JSON de opções. **Ilegível vira lista vazia**, mesma postura de `parseLista` do
 * `BriefRepository`: uma linha corrompida não trava a leitura, mas uma pergunta sem opção
 * nenhuma não passa em `validarPerguntaGerada` — o dado corrompido não vira silêncio.
 */
function parseOpcoes(raw: string): readonly OpcaoDaPergunta[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as OpcaoDaPergunta[]) : []
  } catch {
    log.db.warn('Opções da pergunta gerada ilegíveis; lista devolvida vazia', {
      op: 'select',
      table: 'pergunta_gerada'
    })
    return []
  }
}

function toPergunta(row: PerguntaRow): PerguntaGeradaRegistrada {
  return {
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id as WorkspaceId,
    projectId: row.project_id,
    bloco: row.bloco as PerguntaGerada['bloco'],
    porQue: row.por_que,
    // `etapa` é sempre 'refinamento' aqui — o contrato `Pergunta` a pede porque é
    // compartilhado com o catálogo estático da M8-F03, mas o refinamento tem uma etapa só.
    etapa: 'refinamento',
    titulo: row.titulo,
    enunciado: row.enunciado,
    opcoes: parseOpcoes(row.opcoes),
    recomendada: row.recomendada,
    justificativa: row.justificativa,
    aceitaTextoLivre: row.aceita_texto_livre === 1,
    delegavel: row.delegavel === 1,
    estado: row.estado === 'respondida' ? 'respondida' : 'pendente',
    created_at: row.created_at
  }
}

export class PerguntaGeradaRepository {
  constructor(private readonly db: Database) {}

  /** Registra uma pergunta gerada. Append-only: regenerar insere outra, nunca edita. */
  registrar(pergunta: PerguntaGeradaRegistrada): PerguntaGeradaRegistrada {
    this.db
      .prepare(
        `INSERT INTO pergunta_gerada
           (id, user_id, workspace_id, project_id, bloco, por_que, titulo, enunciado, opcoes,
            recomendada, justificativa, aceita_texto_livre, delegavel, estado, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        pergunta.id,
        pergunta.user_id,
        pergunta.workspace_id,
        pergunta.projectId,
        pergunta.bloco,
        pergunta.porQue,
        pergunta.titulo,
        pergunta.enunciado,
        JSON.stringify(pergunta.opcoes),
        pergunta.recomendada,
        pergunta.justificativa,
        pergunta.aceitaTextoLivre ? 1 : 0,
        pergunta.delegavel ? 1 : 0,
        pergunta.estado,
        pergunta.created_at
      )

    log.db.info('Pergunta de refinamento registrada', { op: 'insert', table: 'pergunta_gerada' })
    return pergunta
  }

  /** Todas as perguntas do projeto, da mais antiga à mais recente — a ordem em que surgiram. */
  listar(userId: string, projectId: string): readonly PerguntaGeradaRegistrada[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM pergunta_gerada
          WHERE user_id = ? AND project_id = ?
          ORDER BY created_at ASC, rowid ASC`
      )
      .all(userId, projectId) as PerguntaRow[]

    return rows.map(toPergunta)
  }

  /** As perguntas ainda não respondidas — o que falta ao refinamento. */
  listarPendentes(userId: string, projectId: string): readonly PerguntaGeradaRegistrada[] {
    return this.listar(userId, projectId).filter((p) => p.estado === 'pendente')
  }

  findById(userId: string, id: string): PerguntaGeradaRegistrada | undefined {
    const row = this.db
      .prepare('SELECT * FROM pergunta_gerada WHERE user_id = ? AND id = ?')
      .get(userId, id) as PerguntaRow | undefined

    return row ? toPergunta(row) : undefined
  }

  /**
   * Marca como respondida. **Não toca conteúdo** — só o estado, para a pergunta não voltar a
   * ser oferecida numa retomada. O registro da resposta em si é do `DecisionRepository`.
   */
  marcarRespondida(userId: string, id: string): boolean {
    const r = this.db
      .prepare("UPDATE pergunta_gerada SET estado = 'respondida' WHERE user_id = ? AND id = ?")
      .run(userId, id)

    return r.changes > 0
  }
}
