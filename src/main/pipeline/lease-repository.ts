/**
 * Persistência dos leases (SPEC-Entrega-02, critérios 2 e 3).
 *
 * **A garantia do WIP=1 é o `UNIQUE(user_id, recurso)`, não o `if` do serviço.** Uma checagem em
 * memória ("está livre? então adquire") tem uma janela entre a leitura e a escrita, e dois
 * processos que a atravessem juntos adquirem os dois. O índice fecha essa janela no banco: o
 * segundo `INSERT` viola a restrição e a aquisição falha, mesmo que a checagem tenha passado.
 *
 * Por isso `adquirir` **não** faz `INSERT ... ON CONFLICT DO UPDATE`: sobrescrever o dono no
 * conflito é exatamente o roubo que o critério 3 proíbe. O conflito é a resposta certa e vira
 * recusa.
 */

import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { Lease } from '@shared/domain/lease'
import { proximaExpiracao } from '@shared/domain/lease'

interface LeaseRow {
  readonly id: string
  readonly user_id: string
  readonly proprietario: string
  readonly recurso: string
  readonly project_id: string | null
  readonly heartbeat_em: number
  readonly expira_em: number
  readonly created_at: string
}

function toLease(row: LeaseRow): Lease {
  return {
    id: row.id,
    user_id: row.user_id,
    proprietario: row.proprietario,
    recurso: row.recurso,
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
    heartbeatEm: row.heartbeat_em,
    expiraEm: row.expira_em,
    created_at: row.created_at
  }
}

export class LeaseRepository {
  constructor(private readonly db: Database) {}

  buscar(userId: string, recurso: string): Lease | undefined {
    const row = this.db
      .prepare('SELECT * FROM lease WHERE user_id = ? AND recurso = ?')
      .get(userId, recurso) as LeaseRow | undefined

    return row === undefined ? undefined : toLease(row)
  }

  /**
   * Insere o lease, ou devolve `undefined` se o recurso já tem dono.
   *
   * A recusa vem do `UNIQUE`, capturada aqui: quem decide *o que fazer* com um recurso ocupado é
   * o serviço, que sabe distinguir "vigente" de "expirado, chame a reconciliação".
   */
  adquirir(
    userId: string,
    dados: {
      readonly proprietario: string
      readonly recurso: string
      readonly projectId?: string
    },
    agora: number
  ): Lease | undefined {
    const id = randomUUID()
    const expiraEm = proximaExpiracao(agora)
    const criadoEm = new Date(agora).toISOString()

    try {
      this.db
        .prepare(
          `INSERT INTO lease
             (id, user_id, proprietario, recurso, project_id, heartbeat_em, expira_em, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          userId,
          dados.proprietario,
          dados.recurso,
          dados.projectId ?? null,
          agora,
          expiraEm,
          criadoEm
        )
    } catch {
      // Violação do UNIQUE: outro run já detém o recurso. Não é erro — é a resposta.
      return undefined
    }

    return {
      id,
      user_id: userId,
      proprietario: dados.proprietario,
      recurso: dados.recurso,
      ...(dados.projectId === undefined ? {} : { projectId: dados.projectId }),
      heartbeatEm: agora,
      expiraEm,
      created_at: criadoEm
    }
  }

  /**
   * Renova o lease do próprio dono, empurrando a expiração.
   *
   * O `WHERE proprietario = ?` impede que um run renove o lease de outro — sem ele, um heartbeat
   * com o recurso errado manteria vivo indefinidamente um lease abandonado.
   *
   * **Renova mesmo expirado**, e de propósito: só o próprio dono chega aqui, e recusar a
   * renovação de quem ainda está vivo (mas atrasado) o mandaria para a reconciliação por atraso
   * de relógio. O que o critério 3 proíbe é *outro* run tomar o lease, e isso o `WHERE` já
   * garante.
   */
  renovar(userId: string, recurso: string, proprietario: string, agora: number): boolean {
    const resultado = this.db
      .prepare(
        `UPDATE lease
            SET heartbeat_em = ?, expira_em = ?
          WHERE user_id = ? AND recurso = ? AND proprietario = ?`
      )
      .run(agora, proximaExpiracao(agora), userId, recurso, proprietario)

    return resultado.changes === 1
  }

  /** Libera o lease do próprio dono. Liberar o de outro é roubo com outro nome. */
  liberar(userId: string, recurso: string, proprietario: string): boolean {
    const resultado = this.db
      .prepare('DELETE FROM lease WHERE user_id = ? AND recurso = ? AND proprietario = ?')
      .run(userId, recurso, proprietario)

    return resultado.changes === 1
  }

  /**
   * Remove o lease **decidido pela reconciliação**, sem exigir o proprietário.
   *
   * É o único caminho que tira um lease de outro run, e existe só para a reconciliação usar
   * depois de confirmar que o dono morreu (critério 3). Separado de `liberar` porque a diferença
   * entre "o dono devolveu" e "a reconciliação decidiu que não há dono" precisa aparecer no call
   * site — um método que fizesse os dois convidaria ao roubo por descuido.
   */
  removerReconciliado(userId: string, recurso: string): boolean {
    const resultado = this.db
      .prepare('DELETE FROM lease WHERE user_id = ? AND recurso = ?')
      .run(userId, recurso)

    return resultado.changes === 1
  }

  /** Todos os leases do usuário. A reconciliação do boot varre esta lista. */
  listar(userId: string): readonly Lease[] {
    const rows = this.db
      .prepare('SELECT * FROM lease WHERE user_id = ? ORDER BY created_at ASC')
      .all(userId) as LeaseRow[]

    return rows.map(toLease)
  }
}
