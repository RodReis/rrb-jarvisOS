/**
 * Persistência das decisões do wizard (SPEC-Planejamento-03).
 *
 * O repositório só persiste e consulta — auditar fica no serviço, que conhece o contexto
 * (escolheu? delegou? substituiu?), mesma divisão do `ProjectRepository`.
 *
 * **Não existe `update` nem `delete` aqui, e a ausência é o desenho.** Revisar uma resposta é
 * `registrar` outra linha com `substituiu` apontando para a anterior. Um método de update
 * deixaria o critério 5 ("contradição nunca é corrigida silenciosamente") dependendo de ninguém
 * chamá-lo: bastaria um call site futuro sobrescrever a decisão anterior para ela sumir da tela
 * que deveria mostrá-la.
 */

import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import type { Decision } from '@shared/domain/wizard'
import { isAutorDaDecisao, isDecisionReason } from '@shared/domain/wizard'
import { log } from '../logging/logger'

interface DecisionRow {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: string
  readonly project_id: string
  readonly pergunta_id: string
  readonly etapa: string
  readonly escolha: string | null
  readonly texto: string | null
  readonly recomendacao: string
  readonly justificativa: string
  readonly autor: string
  readonly motivo: string
  readonly substituiu: string | null
  readonly created_at: string
}

/**
 * Converte a linha do banco no contrato de domínio.
 *
 * **`autor` desconhecido vira `'agente'`, nunca `'pi'`.** Uma linha gravada por versão futura,
 * ou corrompida, não pode ganhar por acidente o único autor que aprova gate (invariante 3 do
 * CONVENTION §4). O default fecha para o lado que não autoriza — mesma postura fail-closed do
 * Policy Engine.
 */
function toDecision(row: DecisionRow): Decision {
  return {
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id as WorkspaceId,
    projectId: row.project_id,
    perguntaId: row.pergunta_id,
    etapa: row.etapa,
    escolha: row.escolha,
    texto: row.texto,
    recomendacao: row.recomendacao,
    justificativa: row.justificativa,
    autor: isAutorDaDecisao(row.autor) ? row.autor : 'agente',
    motivo: isDecisionReason(row.motivo) ? row.motivo : 'escolhida',
    substituiu: row.substituiu,
    created_at: row.created_at
  }
}

export class DecisionRepository {
  constructor(private readonly db: Database) {}

  /**
   * O histórico completo do projeto, na ordem em que foi decidido.
   *
   * Devolve o histórico inteiro — inclusive as substituídas — porque é ele que
   * `decisoesVigentes` reduz. Filtrar aqui entregaria só o estado atual e tiraria do domínio a
   * capacidade de mostrar o que foi trocado.
   */
  listar(userId: string, projectId: string): readonly Decision[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM decision WHERE user_id = ? AND project_id = ? ORDER BY created_at, rowid'
      )
      .all(userId, projectId) as DecisionRow[]
    return rows.map(toDecision)
  }

  findById(userId: string, id: string): Decision | undefined {
    const row = this.db
      .prepare('SELECT * FROM decision WHERE user_id = ? AND id = ?')
      .get(userId, id) as DecisionRow | undefined
    return row === undefined ? undefined : toDecision(row)
  }

  /** Insere uma decisão. Único caminho de escrita — não há update nem delete por desenho. */
  registrar(decisao: Decision): Decision {
    this.db
      .prepare(
        `INSERT INTO decision
           (id, user_id, workspace_id, project_id, pergunta_id, etapa, escolha, texto,
            recomendacao, justificativa, autor, motivo, substituiu, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        decisao.id,
        decisao.user_id,
        decisao.workspace_id,
        decisao.projectId,
        decisao.perguntaId,
        decisao.etapa,
        decisao.escolha,
        decisao.texto,
        decisao.recomendacao,
        decisao.justificativa,
        decisao.autor,
        decisao.motivo,
        decisao.substituiu,
        decisao.created_at
      )
    log.db.info('Decisão de planejamento registrada', { op: 'insert', table: 'decision' })
    return decisao
  }
}
