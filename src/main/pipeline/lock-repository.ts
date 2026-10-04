/**
 * Persistência dos locks, da prova de independência e das expansões (SPEC-Scheduler-02).
 *
 * **O lock é o write set do run, no banco.** Uma linha por caminho (prefixo por segmento) e por
 * recurso lógico, e ele vive enquanto o lease do slot do dono existir: quem o encerra é a liberação
 * do slot ou a reconciliação do dono (critério 5), nunca o tempo. Lease expirado continua segurando
 * — a expiração pode ser máquina lenta, não processo morto.
 *
 * Duas escolhas de desenho:
 *
 *  - **A checagem e a gravação são uma transação.** `adquirir` lê as travas do projeto, procura
 *    conflito e grava, tudo dentro de `db.transaction`: ou o run fica com *todas* as travas pedidas
 *    ou com nenhuma. Gravar só as que não conflitam deixaria o run escrevendo num path sem trava.
 *  - **O UNIQUE é a segunda barreira, não a primeira.** A sobreposição de prefixos não cabe num
 *    índice; é o código que a detecta. O `UNIQUE(user_id, project_id, tipo, chave)` garante o resto:
 *    dois runs não seguram a mesma chave exata, nem o mesmo recurso, nem por bug.
 */

import type { Database } from 'better-sqlite3'
import {
  conflitosDeTrava,
  type ConflitoDeTrava,
  type Razao,
  type TravaExistente,
  type TravasDoWriteSet
} from '@shared/domain/independencia'

export type OrigemDaTrava = 'inicial' | 'expansao'

export interface EscopoRegistrado {
  readonly projectId: string
  /** `false` = a fonte não soube dizer o write set: o run não prova independência de ninguém. */
  readonly conhecido: boolean
  readonly catalogoVersao: number
}

export type ResultadoDaAquisicao =
  { readonly ok: true } | { readonly ok: false; readonly conflitos: readonly ConflitoDeTrava[] }

export interface ProvaRegistrada {
  readonly runId: string
  readonly projectId: string
  readonly independente: boolean
  readonly fingerprint: string
  readonly catalogoVersao: number
  readonly razoes: readonly Razao[]
  /** Os runs ativos contra os quais a prova valeu. */
  readonly contra: readonly string[]
}

export interface ProvaLida extends ProvaRegistrada {
  readonly em: number
  readonly invalidadaEm: number | undefined
}

export interface ExpansaoRegistrada {
  readonly runId: string
  readonly projectId: string
  readonly caminhos: readonly string[]
  readonly resultado: 'adquirida' | 'conflito'
  readonly conflitos: readonly ConflitoDeTrava[]
}

export interface ExpansaoLida extends ExpansaoRegistrada {
  readonly em: number
}

interface TravaRow {
  readonly run_id: string
  readonly tipo: 'caminho' | 'recurso'
  readonly chave: string
}

const lerJson = <T>(texto: string, padrao: T): T => {
  try {
    return JSON.parse(texto) as T
  } catch {
    return padrao
  }
}

export class LockRepository {
  constructor(private readonly db: Database) {}

  registrarEscopo(
    userId: string,
    dados: {
      readonly runId: string
      readonly projectId: string
      readonly conhecido: boolean
      readonly catalogoVersao: number
    },
    agora: number
  ): void {
    this.db
      .prepare(
        `INSERT INTO pool_escopo (run_id, user_id, project_id, conhecido, catalogo_versao, registrado_em)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET
           conhecido = excluded.conhecido, catalogo_versao = excluded.catalogo_versao`
      )
      .run(
        dados.runId,
        userId,
        dados.projectId,
        dados.conhecido ? 1 : 0,
        dados.catalogoVersao,
        agora
      )
  }

  escopo(runId: string): EscopoRegistrado | undefined {
    const row = this.db
      .prepare('SELECT project_id, conhecido, catalogo_versao FROM pool_escopo WHERE run_id = ?')
      .get(runId) as { project_id: string; conhecido: number; catalogo_versao: number } | undefined
    return row === undefined
      ? undefined
      : {
          projectId: row.project_id,
          conhecido: row.conhecido === 1,
          catalogoVersao: row.catalogo_versao
        }
  }

  /** Todas as travas do projeto, de todos os runs, na ordem em que foram adquiridas. */
  travasDoProjeto(userId: string, projectId: string): readonly TravaExistente[] {
    const rows = this.db
      .prepare(
        'SELECT run_id, tipo, chave FROM pool_lock WHERE user_id = ? AND project_id = ? ORDER BY id ASC'
      )
      .all(userId, projectId) as TravaRow[]
    return rows.map((r) => ({ runId: r.run_id, tipo: r.tipo, chave: r.chave }))
  }

  /** As travas de um run, em ordem estável. */
  travasDoRun(runId: string): TravasDoWriteSet {
    const rows = this.db
      .prepare('SELECT tipo, chave FROM pool_lock WHERE run_id = ? ORDER BY chave ASC')
      .all(runId) as { tipo: 'caminho' | 'recurso'; chave: string }[]
    return {
      caminhos: rows.filter((r) => r.tipo === 'caminho').map((r) => r.chave),
      recursos: rows.filter((r) => r.tipo === 'recurso').map((r) => r.chave)
    }
  }

  /**
   * Trava caminhos e recursos para o run — todos ou nenhum. O dono repetindo a aquisição (retry
   * depois de crash, ou expansão que repete caminhos) não conflita consigo mesmo.
   */
  adquirir(
    userId: string,
    runId: string,
    projectId: string,
    travas: TravasDoWriteSet,
    origem: OrigemDaTrava,
    agora: number
  ): ResultadoDaAquisicao {
    return this.db.transaction((): ResultadoDaAquisicao => {
      const conflitos = conflitosDeTrava(runId, travas, this.travasDoProjeto(userId, projectId))
      if (conflitos.length > 0) return { ok: false, conflitos }

      // `OR IGNORE` é para o retry do próprio dono (a chave já é dele). Conflito com outro run já
      // foi recusado acima; o UNIQUE só seria a segunda barreira se aquela checagem falhasse.
      const inserir = this.db.prepare(
        `INSERT OR IGNORE INTO pool_lock (user_id, run_id, project_id, tipo, chave, adquirido_em, origem)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      for (const chave of travas.caminhos) {
        inserir.run(userId, runId, projectId, 'caminho', chave, agora, origem)
      }
      for (const chave of travas.recursos) {
        inserir.run(userId, runId, projectId, 'recurso', chave, agora, origem)
      }
      return { ok: true }
    })()
  }

  /** Solta as travas e o escopo do run. Devolve quantas travas saíram. */
  soltar(runId: string): number {
    return this.db.transaction((): number => {
      const { changes } = this.db.prepare('DELETE FROM pool_lock WHERE run_id = ?').run(runId)
      this.db.prepare('DELETE FROM pool_escopo WHERE run_id = ?').run(runId)
      // A aquisição acabou: o conflito que ela teve fica no histórico, mas não vale para a próxima
      // tentativa do mesmo id (o escritor reabre o item com o mesmo `run_id`).
      this.db
        .prepare(
          'UPDATE pool_expansao SET encerrada_em = ? WHERE run_id = ? AND encerrada_em IS NULL'
        )
        .run(Date.now(), runId)
      return changes
    })()
  }

  /**
   * Solta o que pertence a run **sem slot**. O lease do slot é o que prende o lock: lease que sumiu
   * foi liberado ou reconciliado, e um crash entre "removi o lease" e "soltei o lock" deixaria lock
   * órfão para sempre. Lease expirado ainda existe, então continua segurando (critério 5).
   * Devolve os runs liberados.
   */
  varrerOrfaos(userId: string): readonly string[] {
    return this.db.transaction((): readonly string[] => {
      const orfaos = this.db
        .prepare(
          `SELECT run_id FROM pool_lock WHERE user_id = ?
             AND run_id NOT IN (SELECT proprietario FROM lease WHERE user_id = ? AND recurso LIKE 'wip:slot:%')
           UNION
           SELECT run_id FROM pool_escopo WHERE user_id = ?
             AND run_id NOT IN (SELECT proprietario FROM lease WHERE user_id = ? AND recurso LIKE 'wip:slot:%')
           ORDER BY 1`
        )
        .all(userId, userId, userId, userId) as { run_id: string }[]
      const ids = orfaos.map((o) => o.run_id)
      for (const id of ids) this.soltar(id)
      return ids
    })()
  }

  registrarProva(userId: string, prova: ProvaRegistrada, agora: number): void {
    this.db
      .prepare(
        `INSERT INTO pool_prova
           (user_id, run_id, project_id, independente, fingerprint, catalogo_versao, razoes, contra, em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        prova.runId,
        prova.projectId,
        prova.independente ? 1 : 0,
        prova.fingerprint,
        prova.catalogoVersao,
        JSON.stringify(prova.razoes),
        JSON.stringify(prova.contra),
        agora
      )
  }

  provasDoRun(runId: string): readonly ProvaLida[] {
    const rows = this.db
      .prepare('SELECT * FROM pool_prova WHERE run_id = ? ORDER BY id ASC')
      .all(runId) as {
      run_id: string
      project_id: string
      independente: number
      fingerprint: string
      catalogo_versao: number
      razoes: string
      contra: string
      em: number
      invalidada_em: number | null
    }[]
    return rows.map((r) => ({
      runId: r.run_id,
      projectId: r.project_id,
      independente: r.independente === 1,
      fingerprint: r.fingerprint,
      catalogoVersao: r.catalogo_versao,
      razoes: lerJson<Razao[]>(r.razoes, []),
      contra: lerJson<string[]>(r.contra, []),
      em: r.em,
      invalidadaEm: r.invalidada_em ?? undefined
    }))
  }

  /**
   * Marca como inválidas as provas que contavam com este run (regra 4: mudança estrutural invalida
   * a prova dos afetados). Não apaga — o registro é a evidência de que a prova existiu. Idempotente:
   * o carimbo da primeira invalidação fica.
   */
  invalidarProvas(userId: string, runId: string, agora: number): number {
    return this.db
      .prepare(
        `UPDATE pool_prova SET invalidada_em = ?
          WHERE user_id = ? AND invalidada_em IS NULL
            AND EXISTS (SELECT 1 FROM json_each(pool_prova.contra) WHERE value = ?)`
      )
      .run(agora, userId, runId).changes
  }

  registrarExpansao(userId: string, e: ExpansaoRegistrada, agora: number): void {
    this.db
      .prepare(
        `INSERT INTO pool_expansao (user_id, run_id, project_id, caminhos, resultado, conflitos, em)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        e.runId,
        e.projectId,
        JSON.stringify(e.caminhos),
        e.resultado,
        JSON.stringify(e.conflitos),
        agora
      )
  }

  /** O run perdeu uma disputa de lock **nesta aquisição** e não amplia mais? */
  perdeuDisputa(runId: string): boolean {
    return (
      this.db
        .prepare(
          "SELECT 1 FROM pool_expansao WHERE run_id = ? AND resultado = 'conflito' AND encerrada_em IS NULL LIMIT 1"
        )
        .get(runId) !== undefined
    )
  }

  expansoesDoRun(runId: string): readonly ExpansaoLida[] {
    const rows = this.db
      .prepare('SELECT * FROM pool_expansao WHERE run_id = ? ORDER BY id ASC')
      .all(runId) as {
      run_id: string
      project_id: string
      caminhos: string
      resultado: 'adquirida' | 'conflito'
      conflitos: string
      em: number
    }[]
    return rows.map((r) => ({
      runId: r.run_id,
      projectId: r.project_id,
      caminhos: lerJson<string[]>(r.caminhos, []),
      resultado: r.resultado,
      conflitos: lerJson<ConflitoDeTrava[]>(r.conflitos, []),
      em: r.em
    }))
  }
}
