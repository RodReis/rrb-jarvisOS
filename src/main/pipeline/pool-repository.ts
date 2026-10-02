/**
 * Persistência do pool de execução (SPEC-Scheduler-01).
 *
 * **Tudo o que o scheduler decide a partir de está no banco**: a configuração, a fila, a vez de
 * cada projeto, a sequência do fencing token e o histórico de decisões. O serviço não guarda
 * estado em memória — é isso que faz o reinício preservar posição, lease e motivo de espera sem
 * duplicar run (critério 3): não há nada para perder, porque não há nada em memória.
 *
 * Duas escolhas de desenho:
 *
 *  - **A fila é idempotente por `run_id`.** Enfileirar o mesmo run duas vezes — um retry depois de
 *    um crash — devolve a linha que já existe, com a posição e a idade originais. Um `INSERT`
 *    que sobrescrevesse a idade faria o run voltar ao fim da fila a cada reinício.
 *  - **O token só avança.** `proximoToken` incrementa e devolve na mesma instrução; o valor
 *    sobrevive à liberação do lease e à reconciliação, porque é por usuário, não por lease. Um
 *    token reutilizado seria um dono antigo voltando a valer.
 */

import type { Database } from 'better-sqlite3'
import type { ConfigDoPool, MotivoDeEspera } from '@shared/domain/pool'
import type { PoolMetricas } from '@shared/domain/pool-vista'
import { CONFIG_PADRAO, validarConfig } from '@shared/domain/pool'

export type EstadoDaFila = 'esperando' | 'adquirido' | 'cancelado'

export interface ItemPersistido {
  readonly runId: string
  readonly userId: string
  readonly projectId: string
  readonly sliceId: string
  readonly prioridade: number
  readonly enfileiradoEm: number
  readonly executor?: string
  readonly classe?: string
  readonly estado: EstadoDaFila
  readonly motivo?: MotivoDeEspera
}

export interface NovoItem {
  readonly runId: string
  readonly projectId: string
  readonly sliceId: string
  readonly prioridade: number
  readonly executor?: string
  readonly classe?: string
}

export type TipoDeDecisao = 'adquirido' | 'liberado' | 'reconciliado' | 'cancelado'

interface FilaRow {
  readonly run_id: string
  readonly user_id: string
  readonly project_id: string
  readonly slice_id: string
  readonly prioridade: number
  readonly enfileirado_em: number
  readonly executor: string | null
  readonly classe: string | null
  readonly estado: EstadoDaFila
  readonly motivo: string | null
}

function lerMotivo(json: string | null): MotivoDeEspera | undefined {
  if (json === null) return undefined
  try {
    return JSON.parse(json) as MotivoDeEspera
  } catch {
    // Motivo ilegível não derruba a fila: o próximo ciclo o recalcula.
    return undefined
  }
}

function toItem(row: FilaRow): ItemPersistido {
  const motivo = lerMotivo(row.motivo)
  return {
    runId: row.run_id,
    userId: row.user_id,
    projectId: row.project_id,
    sliceId: row.slice_id,
    prioridade: row.prioridade,
    enfileiradoEm: row.enfileirado_em,
    ...(row.executor === null ? {} : { executor: row.executor }),
    ...(row.classe === null ? {} : { classe: row.classe }),
    estado: row.estado,
    ...(motivo === undefined ? {} : { motivo })
  }
}

const mediana = (valores: readonly number[]): number => {
  const ordenados = [...valores].sort((a, b) => a - b)
  const meio = Math.floor(ordenados.length / 2)
  return ordenados.length % 2 === 1
    ? ordenados[meio]
    : Math.round((ordenados[meio - 1] + ordenados[meio]) / 2)
}

export class PoolRepository {
  constructor(private readonly db: Database) {}

  /** A configuração do usuário; a padrão quando nunca foi gravada ou quando a gravada não valida. */
  config(userId: string): ConfigDoPool {
    const row = this.db.prepare('SELECT config FROM pool_config WHERE user_id = ?').get(userId) as
      { config: string } | undefined
    if (row === undefined) return CONFIG_PADRAO

    try {
      const lida = validarConfig(JSON.parse(row.config))
      // Config corrompida não pode parar a máquina nem abrir o paralelismo: cai no padrão seguro.
      return lida.ok ? lida.config : CONFIG_PADRAO
    } catch {
      return CONFIG_PADRAO
    }
  }

  definirConfig(userId: string, config: ConfigDoPool, agora: number): void {
    this.db
      .prepare(
        `INSERT INTO pool_config (user_id, config, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at`
      )
      .run(userId, JSON.stringify(config), new Date(agora).toISOString())
  }

  /**
   * Põe o run na fila, ou devolve a linha que já existe — com a posição e a idade originais.
   * Um run cancelado ou já adquirido não volta a esperar por enfileirar de novo.
   */
  enfileirar(userId: string, item: NovoItem, agora: number): ItemPersistido {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO pool_fila
           (run_id, user_id, project_id, slice_id, prioridade, enfileirado_em, executor, classe,
            estado, motivo, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'esperando', NULL, ?)`
      )
      .run(
        item.runId,
        userId,
        item.projectId,
        item.sliceId,
        item.prioridade,
        agora,
        item.executor ?? null,
        item.classe ?? null,
        agora
      )

    return this.buscarItem(item.runId) as ItemPersistido
  }

  buscarItem(runId: string): ItemPersistido | undefined {
    const row = this.db.prepare('SELECT * FROM pool_fila WHERE run_id = ?').get(runId) as
      FilaRow | undefined
    return row === undefined ? undefined : toItem(row)
  }

  /** Quem espera, na ordem de chegada (a ordem justa é decidida pelo núcleo, não pelo SQL). */
  esperando(userId: string): readonly ItemPersistido[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM pool_fila WHERE user_id = ? AND estado = 'esperando' ORDER BY enfileirado_em ASC, run_id ASC"
      )
      .all(userId) as FilaRow[]
    return rows.map(toItem)
  }

  marcarAdquirido(runId: string, agora: number): boolean {
    return (
      this.db
        .prepare(
          "UPDATE pool_fila SET estado = 'adquirido', motivo = NULL, atualizado_em = ? WHERE run_id = ? AND estado = 'esperando'"
        )
        .run(agora, runId).changes === 1
    )
  }

  cancelar(runId: string, agora: number): boolean {
    return (
      this.db
        .prepare(
          "UPDATE pool_fila SET estado = 'cancelado', motivo = NULL, atualizado_em = ? WHERE run_id = ? AND estado = 'esperando'"
        )
        .run(agora, runId).changes === 1
    )
  }

  /** Grava o motivo atual. Sem mudança, não escreve: o ciclo roda toda hora e a fila é lida mais. */
  atualizarMotivo(runId: string, motivo: MotivoDeEspera, agora: number): void {
    const json = JSON.stringify(motivo)
    this.db
      .prepare(
        "UPDATE pool_fila SET motivo = ?, atualizado_em = ? WHERE run_id = ? AND estado = 'esperando' AND (motivo IS NOT ?)"
      )
      .run(json, agora, runId, json)
  }

  /** Quando cada projeto foi servido pela última vez. */
  vezes(userId: string): Readonly<Record<string, number>> {
    const rows = this.db
      .prepare('SELECT project_id, servido_em FROM pool_vez WHERE user_id = ?')
      .all(userId) as { project_id: string; servido_em: number }[]
    return Object.fromEntries(rows.map((r) => [r.project_id, r.servido_em]))
  }

  registrarVez(userId: string, projectId: string, agora: number): void {
    this.db
      .prepare(
        `INSERT INTO pool_vez (user_id, project_id, servido_em) VALUES (?, ?, ?)
         ON CONFLICT(user_id, project_id) DO UPDATE SET servido_em = excluded.servido_em`
      )
      .run(userId, projectId, agora)
  }

  /** O próximo fencing token do usuário: incrementa e devolve, na mesma instrução. */
  proximoToken(userId: string): number {
    const row = this.db
      .prepare(
        `INSERT INTO pool_sequencia (user_id, ultimo) VALUES (?, 1)
         ON CONFLICT(user_id) DO UPDATE SET ultimo = ultimo + 1
         RETURNING ultimo`
      )
      .get(userId) as { ultimo: number }
    return row.ultimo
  }

  registrarDecisao(
    userId: string,
    dados: {
      readonly runId: string
      readonly projectId: string
      readonly decisao: TipoDeDecisao
      readonly esperaMs?: number
    },
    agora: number
  ): void {
    this.db
      .prepare(
        `INSERT INTO pool_decisao (user_id, run_id, project_id, decisao, espera_ms, em)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(userId, dados.runId, dados.projectId, dados.decisao, dados.esperaMs ?? null, agora)
  }

  /**
   * As métricas da janela `[desde, agora]`: espera (mediana e máxima), decisões por tipo e o
   * tamanho e a idade da fila. A ocupação é do serviço, que sabe a capacidade e os leases.
   */
  metricas(userId: string, desde: number, agora: number): Omit<PoolMetricas, 'ocupacao'> {
    const esperas = (
      this.db
        .prepare(
          `SELECT espera_ms FROM pool_decisao
            WHERE user_id = ? AND decisao = 'adquirido' AND em >= ? AND espera_ms IS NOT NULL`
        )
        .all(userId, desde) as { espera_ms: number }[]
    ).map((r) => r.espera_ms)

    const porTipo = this.db
      .prepare(
        'SELECT decisao, COUNT(*) AS n FROM pool_decisao WHERE user_id = ? AND em >= ? GROUP BY decisao'
      )
      .all(userId, desde) as { decisao: TipoDeDecisao; n: number }[]
    const decisoes = { adquirido: 0, liberado: 0, reconciliado: 0, cancelado: 0 }
    for (const r of porTipo) decisoes[r.decisao] = r.n

    const fila = this.esperando(userId)
    const maisAntigo = fila.reduce<number | undefined>(
      (menor, i) => (menor === undefined || i.enfileiradoEm < menor ? i.enfileiradoEm : menor),
      undefined
    )

    return {
      fila: {
        tamanho: fila.length,
        ...(maisAntigo === undefined ? {} : { maisAntigoHaMs: Math.max(0, agora - maisAntigo) })
      },
      espera: {
        amostras: esperas.length,
        ...(esperas.length === 0
          ? {}
          : { medianaMs: mediana(esperas), maximaMs: Math.max(...esperas) })
      },
      decisoes
    }
  }
}
