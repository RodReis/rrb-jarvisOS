/**
 * O inventário durável de recursos por run (SPEC-Scheduler-03).
 *
 * **A pergunta que ele responde depois de um crash:** *quais recursos este run tinha, e em que
 * ponto da criação ele parou?* Cada recurso entra como `planejado` **antes** de ser criado e vira
 * `criado` depois de confirmado — o mesmo padrão intenção-antes/confirmação-depois do diário de
 * efeitos. O lease continua sendo a posse do recurso; o inventário é o **registro** dele, e é o
 * único que cobre rede, sidecar, branch e perfil.
 *
 * O `UNIQUE` parcial do banco é a barreira de colisão: dois runs não registram o mesmo container,
 * rede, branch ou porta ao mesmo tempo, nem por bug do chamador.
 */

import type { Database } from 'better-sqlite3'
import {
  transicaoValida,
  type EstadoDoRecurso,
  type TipoDeRecurso
} from '@shared/domain/isolamento'

export interface RecursoDoRun {
  readonly id: number
  readonly runId: string
  readonly projectId: string
  readonly tipo: TipoDeRecurso
  readonly identificador: string
  readonly estado: EstadoDoRecurso
  readonly labels: Readonly<Record<string, string>>
  readonly detalhes: Readonly<Record<string, string>>
  readonly criadoEm: number
  readonly atualizadoEm: number
}

export interface PlanoDeRecurso {
  readonly runId: string
  readonly projectId: string
  readonly tipo: TipoDeRecurso
  readonly identificador: string
  readonly labels: Readonly<Record<string, string>>
  /** O que a reconciliação precisa para agir e não é label Docker (ex.: `repositorio`). */
  readonly detalhes?: Readonly<Record<string, string>>
}

interface RecursoRow {
  readonly id: number
  readonly run_id: string
  readonly project_id: string
  readonly tipo: TipoDeRecurso
  readonly identificador: string
  readonly estado: EstadoDoRecurso
  readonly labels: string
  readonly detalhes: string
  readonly criado_em: number
  readonly atualizado_em: number
}

const COLUNAS =
  'id, run_id, project_id, tipo, identificador, estado, labels, detalhes, criado_em, atualizado_em'

function lerMapa(texto: string): Readonly<Record<string, string>> {
  try {
    return JSON.parse(texto) as Record<string, string>
  } catch {
    return {}
  }
}

function toRecurso(row: RecursoRow): RecursoDoRun {
  return {
    id: row.id,
    runId: row.run_id,
    projectId: row.project_id,
    tipo: row.tipo,
    identificador: row.identificador,
    estado: row.estado,
    labels: lerMapa(row.labels),
    detalhes: lerMapa(row.detalhes),
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em
  }
}

export class InventarioRepository {
  constructor(private readonly db: Database) {}

  /**
   * Registra a intenção de criar o recurso.
   *
   * Idempotente para o **mesmo run**: repetir o pedido devolve o registro que já existe, porque
   * retomar um preflight que morreu no meio não pode falhar por "já planejado". Para **outro
   * run** devolve `undefined` — o identificador tem dono, e o `UNIQUE` parcial segura a janela
   * entre olhar e gravar.
   */
  planejar(userId: string, plano: PlanoDeRecurso, agora: number): RecursoDoRun | undefined {
    return this.db.transaction((): RecursoDoRun | undefined => {
      const existente = this.buscar(userId, plano.tipo, plano.identificador)
      if (existente !== undefined) return existente.runId === plano.runId ? existente : undefined

      const info = this.db
        .prepare(
          `INSERT INTO recurso_run
             (user_id, run_id, project_id, tipo, identificador, estado, labels, detalhes, criado_em, atualizado_em)
           VALUES (?, ?, ?, ?, ?, 'planejado', ?, ?, ?, ?)`
        )
        .run(
          userId,
          plano.runId,
          plano.projectId,
          plano.tipo,
          plano.identificador,
          JSON.stringify(plano.labels),
          JSON.stringify(plano.detalhes ?? {}),
          agora,
          agora
        )
      return this.porId(userId, Number(info.lastInsertRowid))
    })()
  }

  /** Avança o recurso no ciclo. Devolve `false` para transição inválida ou registro alheio. */
  mudarEstado(userId: string, id: number, para: EstadoDoRecurso, agora: number): boolean {
    return this.db.transaction((): boolean => {
      const atual = this.porId(userId, id)
      if (atual === undefined || !transicaoValida(atual.estado, para)) return false

      const info = this.db
        .prepare(
          'UPDATE recurso_run SET estado = ?, atualizado_em = ? WHERE id = ? AND user_id = ?'
        )
        .run(para, agora, id, userId)
      return info.changes > 0
    })()
  }

  /** O recurso vivo (não removido) com este identificador, se houver. */
  buscar(userId: string, tipo: TipoDeRecurso, identificador: string): RecursoDoRun | undefined {
    const row = this.db
      .prepare(
        `SELECT ${COLUNAS} FROM recurso_run
         WHERE user_id = ? AND tipo = ? AND identificador = ? AND estado <> 'removido'`
      )
      .get(userId, tipo, identificador) as RecursoRow | undefined
    return row === undefined ? undefined : toRecurso(row)
  }

  /** Os recursos do run, em ordem de criação. O removido só aparece se pedido. */
  listarDoRun(userId: string, runId: string, incluirRemovidos = false): RecursoDoRun[] {
    const filtro = incluirRemovidos ? '' : "AND estado <> 'removido'"
    const rows = this.db
      .prepare(
        `SELECT ${COLUNAS} FROM recurso_run
         WHERE user_id = ? AND run_id = ? ${filtro} ORDER BY id`
      )
      .all(userId, runId) as RecursoRow[]
    return rows.map(toRecurso)
  }

  /** Tudo que ainda não foi removido, de todos os runs. */
  listarAtivos(userId: string): RecursoDoRun[] {
    const rows = this.db
      .prepare(
        `SELECT ${COLUNAS} FROM recurso_run
         WHERE user_id = ? AND estado <> 'removido' ORDER BY id`
      )
      .all(userId) as RecursoRow[]
    return rows.map(toRecurso)
  }

  /** Os runs que ainda têm recurso a reconciliar, em ordem estável. */
  runsComRecurso(userId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT run_id FROM recurso_run
         WHERE user_id = ? AND estado <> 'removido' GROUP BY run_id ORDER BY MIN(id)`
      )
      .all(userId) as { run_id: string }[]
    return rows.map((r) => r.run_id)
  }

  /** As redes que o inventário conhece e ainda não removeu: a lista fechada da exceção do ADR-007. */
  redesAtivas(userId: string): ReadonlySet<string> {
    const rows = this.db
      .prepare(
        `SELECT identificador FROM recurso_run
         WHERE user_id = ? AND tipo = 'rede' AND estado <> 'removido'`
      )
      .all(userId) as { identificador: string }[]
    return new Set(rows.map((r) => r.identificador))
  }

  private porId(userId: string, id: number): RecursoDoRun | undefined {
    const row = this.db
      .prepare(`SELECT ${COLUNAS} FROM recurso_run WHERE id = ? AND user_id = ?`)
      .get(id, userId) as RecursoRow | undefined
    return row === undefined ? undefined : toRecurso(row)
  }
}
