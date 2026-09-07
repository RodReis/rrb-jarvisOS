/**
 * Persistência da prova de um run (SPEC-Entrega-06, critérios 1, 2, 5 e 9).
 *
 * **Append-only por run, ao contrário de `external_ref`.** Aquele guarda *onde o recurso está* —
 * um fato que muda quando o recurso muda, e cuja versão antiga não prova nada. Este guarda *o que
 * aconteceu*, e reescrever apagaria a evidência. O `UNIQUE(user_id, run_id)` faz o banco recusar
 * a segunda gravação em vez de confiar na disciplina do chamador; retomada cria run novo
 * (`continuaDe` em `PipelineRun`), nunca regrava o anterior.
 *
 * **Expirar não apaga a linha.** `expirado_em` registra que o anexo pesado saiu; hash, bytes e
 * data continuam, porque é o hash que o ledger referencia. Apagar a linha deixaria uma referência
 * versionada apontando para o nada — exatamente o que o critério 9 proíbe.
 *
 * **Listas em JSON, e não em tabelas-filhas.** Eventos, checks e artefatos são lidos sempre
 * juntos com o ledger e nunca consultados por si — três tabelas dariam três joins para responder
 * a única pergunta que alguém faz ("o que aconteceu neste run?"). Quando o artefato precisa ser
 * consultado sozinho, para a retenção, ele tem tabela própria (`artefato_retido`).
 */

import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { AiProvider } from '@shared/domain/ai'
import type {
  ArtefatoReferenciado,
  CheckDoLedger,
  CorrelacaoDeCi,
  EventoDoLedger,
  ExecutionLedger
} from '@shared/domain/execution-ledger'
import type { PendenciaDeLimpeza, RecursoLimpavel } from '@shared/domain/limpeza'
import type { EstadoDoRun } from '@shared/domain/pipeline'
import type { ArtefatoRetido } from '@shared/domain/retencao'
import { log } from '../logging/logger'

interface LedgerRow {
  readonly user_id: string
  readonly project_id: string
  readonly run_id: string
  readonly estado_final: string
  readonly duracao_ms: number
  readonly tentativas: number
  readonly tokens: number
  readonly creditos: number
  readonly custo_usd: number
  readonly eventos: string
  readonly head_sha: string | null
  readonly merge_sha: string | null
  readonly checks: string
  readonly artefatos: string
  readonly encerrado_em: string
  readonly provider: string | null
  readonly modelo: string | null
  /** JSON do bloco `CorrelacaoDeCi`, ou `null` quando a execução de CI não foi observada. */
  readonly correlacao_ci: string | null
}

interface ArtefatoRow {
  readonly id: string
  readonly run_id: string
  readonly hash: string
  readonly bytes: number
  readonly criado_em: string
  readonly fixado: number
  readonly estado_do_run: string
}

interface PendenciaRow {
  readonly run_id: string
  readonly recurso: string
  readonly identificador: string
  readonly motivo: string
  readonly em: string
}

export class ExecutionLedgerRepository {
  constructor(private readonly db: Database) {}

  /**
   * Registra o ledger de um run encerrado.
   *
   * Lança quando o run já tem ledger — o `UNIQUE` do schema. Deixar a exceção subir é
   * deliberado: quem chamar duas vezes está tentando reescrever uma prova, e engolir isso em
   * silêncio esconderia um defeito de fluxo atrás de um "deu certo".
   */
  registrar(ledger: ExecutionLedger): void {
    this.db
      .prepare(
        `INSERT INTO execution_ledger
           (id, user_id, project_id, run_id, estado_final, duracao_ms, tentativas, tokens,
            creditos, custo_usd, eventos, head_sha, merge_sha, checks, artefatos, encerrado_em,
            provider, modelo, correlacao_ci)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        randomUUID(),
        ledger.userId,
        ledger.projectId,
        ledger.runId,
        ledger.estadoFinal,
        ledger.duracaoMs,
        ledger.tentativas,
        ledger.tokens,
        ledger.creditos,
        ledger.custoUsd,
        JSON.stringify(ledger.eventos),
        ledger.headSha ?? null,
        ledger.mergeSha ?? null,
        JSON.stringify(ledger.checks),
        JSON.stringify(ledger.artefatos),
        ledger.encerradoEm,
        ledger.provider ?? null,
        ledger.modelo ?? null,
        // O bloco inteiro ou nada: `null` diz "execução de CI não observada". Gravar `'{}'` no
        // lugar afirmaria que ela foi observada e veio vazia, que é outra coisa.
        ledger.correlacaoDeCi === undefined ? null : JSON.stringify(ledger.correlacaoDeCi)
      )

    log.db.info('Ledger do run registrado', {
      op: 'insert',
      table: 'execution_ledger',
      estado: ledger.estadoFinal
    })
  }

  buscar(userId: string, runId: string): ExecutionLedger | undefined {
    const row = this.db
      .prepare('SELECT * FROM execution_ledger WHERE user_id = ? AND run_id = ?')
      .get(userId, runId) as LedgerRow | undefined
    if (!row) return undefined

    return {
      runId: row.run_id,
      userId: row.user_id,
      projectId: row.project_id,
      estadoFinal: row.estado_final as EstadoDoRun,
      duracaoMs: row.duracao_ms,
      tentativas: row.tentativas,
      tokens: row.tokens,
      creditos: row.creditos,
      custoUsd: row.custo_usd,
      eventos: JSON.parse(row.eventos) as readonly EventoDoLedger[],
      ...(row.head_sha === null ? {} : { headSha: row.head_sha }),
      ...(row.merge_sha === null ? {} : { mergeSha: row.merge_sha }),
      checks: JSON.parse(row.checks) as readonly CheckDoLedger[],
      artefatos: JSON.parse(row.artefatos) as readonly ArtefatoReferenciado[],
      encerradoEm: row.encerrado_em,
      ...(row.provider === null ? {} : { provider: row.provider as AiProvider }),
      ...(row.modelo === null ? {} : { modelo: row.modelo }),
      ...(row.correlacao_ci === null || row.correlacao_ci === undefined
        ? {}
        : { correlacaoDeCi: JSON.parse(row.correlacao_ci) as CorrelacaoDeCi })
    }
  }

  registrarArtefato(userId: string, item: ArtefatoRetido): void {
    this.db
      .prepare(
        `INSERT INTO artefato_retido
           (id, user_id, run_id, hash, bytes, criado_em, fixado, estado_do_run, expirado_em)
         VALUES (?,?,?,?,?,?,?,?,NULL)`
      )
      .run(
        item.id,
        userId,
        item.runId,
        item.hash,
        item.bytes,
        item.criadoEm,
        item.fixado ? 1 : 0,
        item.estadoDoRun
      )
  }

  /**
   * Os artefatos que ainda têm anexo.
   *
   * Só os vivos: um já expirado não tem o que apagar, e ofertá-lo ao coletor o faria trabalhar em
   * vão a cada volta. A linha continua no banco — ela é a prova; o que saiu foi o anexo.
   */
  listarArtefatos(userId: string): readonly ArtefatoRetido[] {
    const rows = this.db
      .prepare(
        `SELECT id, run_id, hash, bytes, criado_em, fixado, estado_do_run
           FROM artefato_retido
          WHERE user_id = ? AND expirado_em IS NULL
          ORDER BY criado_em`
      )
      .all(userId) as readonly ArtefatoRow[]

    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      hash: row.hash,
      bytes: row.bytes,
      criadoEm: row.criado_em,
      fixado: row.fixado === 1,
      estadoDoRun: row.estado_do_run as EstadoDoRun
    }))
  }

  /** Idempotente: o `expirado_em IS NULL` impede reescrever a data de uma expiração anterior. */
  marcarExpirado(userId: string, id: string, agora = new Date().toISOString()): void {
    this.db
      .prepare(
        `UPDATE artefato_retido SET expirado_em = ?
          WHERE user_id = ? AND id = ? AND expirado_em IS NULL`
      )
      .run(agora, userId, id)
  }

  registrarPendencia(userId: string, pendencia: PendenciaDeLimpeza): void {
    this.db
      .prepare(
        `INSERT INTO pendencia_de_limpeza
           (id, user_id, run_id, recurso, identificador, motivo, em, resolvida_em)
         VALUES (?,?,?,?,?,?,?,NULL)`
      )
      .run(
        randomUUID(),
        userId,
        pendencia.runId,
        pendencia.recurso,
        pendencia.identificador,
        pendencia.motivo,
        pendencia.em
      )

    log.sistema.warn('Limpeza deixou pendência reconciliável', {
      recurso: pendencia.recurso,
      motivo: pendencia.motivo
    })
  }

  listarPendencias(userId: string): readonly PendenciaDeLimpeza[] {
    const rows = this.db
      .prepare(
        `SELECT run_id, recurso, identificador, motivo, em
           FROM pendencia_de_limpeza
          WHERE user_id = ? AND resolvida_em IS NULL
          ORDER BY em`
      )
      .all(userId) as readonly PendenciaRow[]

    return rows.map((row) => ({
      runId: row.run_id,
      recurso: row.recurso as RecursoLimpavel,
      identificador: row.identificador,
      motivo: row.motivo,
      em: row.em
    }))
  }
}
