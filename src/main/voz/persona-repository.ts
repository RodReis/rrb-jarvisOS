/**
 * A persona persistida por escopo (SPEC-Voz-03, critério 5).
 *
 * Uma linha por `user_id + workspace_id`, e **ausência de linha é a persona de fábrica valendo**
 * — nunca erro, nunca vazio. É o mesmo desenho de `phase_model_policy` e das preferências de voz:
 * o serviço resolve o padrão na leitura, então quem chama sempre recebe algo utilizável e não
 * precisa conhecer o valor de fábrica.
 */

import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import { TEXTO_LIVRE_PADRAO, type Persona } from './persona'
import { log } from '../logging/logger'

interface PersonaRow {
  readonly texto_livre: string
  readonly updated_at: string
}

export class PersonaRepository {
  constructor(private readonly db: Database) {}

  /** A persona do escopo, ou a de fábrica quando ainda não há linha. */
  buscar(userId: string, workspaceId: WorkspaceId): Persona {
    const row = this.db
      .prepare('SELECT texto_livre, updated_at FROM persona WHERE user_id = ? AND workspace_id = ?')
      .get(userId, workspaceId) as PersonaRow | undefined

    if (row === undefined) {
      return { texto_livre: TEXTO_LIVRE_PADRAO, updated_at: '' }
    }

    return { texto_livre: row.texto_livre, updated_at: row.updated_at }
  }

  /**
   * Grava a persona do escopo.
   *
   * `ON CONFLICT ... DO UPDATE` porque a operação é "esta é a persona agora", não "acrescente uma
   * persona": a chave primária é o escopo, e uma segunda linha para o mesmo par significaria duas
   * personas certas ao mesmo tempo.
   */
  salvar(userId: string, workspaceId: WorkspaceId, textoLivre: string): Persona {
    const updatedAt = new Date().toISOString()

    try {
      this.db
        .prepare(
          `INSERT INTO persona (user_id, workspace_id, texto_livre, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, workspace_id)
           DO UPDATE SET texto_livre = excluded.texto_livre, updated_at = excluded.updated_at`
        )
        .run(userId, workspaceId, textoLivre, updatedAt)

      // O **tamanho**, nunca o texto: a persona é escrita pelo usuário e pode conter o que ele
      // quiser sobre si; o log responde "mudou?" sem repetir o conteúdo (ADR-004).
      log.db.info('Persona gravada', {
        op: 'upsert',
        table: 'persona',
        bytes: Buffer.byteLength(textoLivre, 'utf8')
      })

      return { texto_livre: textoLivre, updated_at: updatedAt }
    } catch (error) {
      log.db.error('Falha ao gravar persona', { op: 'upsert', table: 'persona', error })
      throw error
    }
  }
}
