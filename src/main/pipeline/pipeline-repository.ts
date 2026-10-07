/**
 * Persistência dos runs da pipeline (SPEC-Entrega-02).
 *
 * **Uma linha por run, com o estado mutável nela.** A história de "por onde passou" mora na
 * auditoria, que é encadeada e à prova de adulteração (ADR-004), não aqui. Guardá-la nas duas
 * tornaria uma delas a errada no dia em que divergissem.
 *
 * O que **não** é sobrescrito é o run inteiro: retomada de bloqueio cria uma linha nova com
 * `continua_de` apontando para a anterior (§ Estados). Reabrir o run terminado apagaria o fato
 * de que houve um bloqueio, e o critério 4 precisa reconstituir exatamente isso.
 *
 * Este repositório **só persiste e consulta; nunca audita** — a auditoria é do serviço, que tem
 * o contexto de por que a transição aconteceu.
 */

import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import type { BloqueioExterno } from '@shared/domain/pacote-estrutural'
import type { EstadoDoRun, PipelineRun } from '@shared/domain/pipeline'
import { log } from '../logging/logger'

/** O escopo obrigatório de toda leitura e escrita (CONVENTION §2). */
export interface EscopoDoRun {
  readonly userId: string
  readonly workspaceId: WorkspaceId
  readonly projectId: string
}

interface RunRow {
  readonly id: string
  readonly user_id: string
  readonly project_id: string
  readonly slice_id: string
  readonly estado: string
  readonly continua_de: string | null
  readonly bloqueio: string | null
  readonly squad_snapshot: string | null
  readonly squad_progress: string | null
  readonly created_at: string
  readonly updated_at: string
}

/**
 * Converte a linha em run.
 *
 * **Bloqueio ilegível vira ausente, e o estado não muda.** Um JSON corrompido não pode virar um
 * bloqueio inventado — e também não pode derrubar a leitura do run inteiro, senão um caractere
 * ruim numa linha esconderia todo o histórico da fatia. Quem valida a completude do bloqueio é o
 * serviço, na escrita, onde ainda dá para recusar.
 */
function toRun(row: RunRow): PipelineRun {
  let bloqueio: BloqueioExterno | undefined
  if (row.bloqueio !== null) {
    try {
      bloqueio = JSON.parse(row.bloqueio) as BloqueioExterno
    } catch {
      log.db.warn('Bloqueio ilegível no pipeline_run; lido como ausente.', { runId: row.id })
    }
  }
  let squadSnapshot: unknown
  let squadProgress: PipelineRun['squadProgress']
  try {
    if (row.squad_snapshot !== null) squadSnapshot = JSON.parse(row.squad_snapshot) as unknown
  } catch {
    log.db.warn('Snapshot do Squad ilegível no pipeline_run.', { runId: row.id })
  }
  try {
    if (row.squad_progress !== null) {
      const lido: unknown = JSON.parse(row.squad_progress)
      if (Array.isArray(lido)) squadProgress = lido as PipelineRun['squadProgress']
    }
  } catch {
    log.db.warn('Progresso do Squad ilegível no pipeline_run.', { runId: row.id })
  }

  return {
    id: row.id,
    user_id: row.user_id,
    projectId: row.project_id,
    sliceId: row.slice_id,
    estado: row.estado as EstadoDoRun,
    ...(row.continua_de === null ? {} : { continuaDe: row.continua_de }),
    ...(bloqueio === undefined ? {} : { bloqueio }),
    ...(squadSnapshot === undefined ? {} : { squadSnapshot }),
    ...(squadProgress === undefined ? {} : { squadProgress }),
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

export class PipelineRepository {
  constructor(private readonly db: Database) {}

  /** Cria um run. `continuaDe` vincula a retomada ao run bloqueado que a originou. */
  criar(
    escopo: EscopoDoRun,
    dados: { readonly sliceId: string; readonly estado: EstadoDoRun; readonly continuaDe?: string },
    agora: Date
  ): PipelineRun {
    const id = randomUUID()
    const iso = agora.toISOString()

    this.db
      .prepare(
        `INSERT INTO pipeline_run
           (id, user_id, workspace_id, project_id, slice_id, estado, continua_de, bloqueio,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .run(
        id,
        escopo.userId,
        escopo.workspaceId,
        escopo.projectId,
        dados.sliceId,
        dados.estado,
        dados.continuaDe ?? null,
        iso,
        iso
      )

    return {
      id,
      user_id: escopo.userId,
      projectId: escopo.projectId,
      sliceId: dados.sliceId,
      estado: dados.estado,
      ...(dados.continuaDe === undefined ? {} : { continuaDe: dados.continuaDe }),
      created_at: iso,
      updated_at: iso
    }
  }

  /** Persiste o snapshot do Squad antes de qualquer dispatch, restrito ao escopo do run. */
  registrarSnapshotDoSquad(
    escopo: EscopoDoRun,
    runId: string,
    snapshot: unknown,
    agora: Date
  ): boolean {
    const resultado = this.db
      .prepare(
        `UPDATE pipeline_run SET squad_snapshot = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND workspace_id = ? AND project_id = ?
          AND squad_snapshot IS NULL AND estado = 'PLANNED'`
      )
      .run(
        JSON.stringify(snapshot),
        agora.toISOString(),
        runId,
        escopo.userId,
        escopo.workspaceId,
        escopo.projectId
      )
    return resultado.changes === 1
  }

  /** Resumo mínimo de tarefas, atualizado só enquanto o run permanece ativo e escopado. */
  registrarProgressoDoSquad(
    escopo: EscopoDoRun,
    runId: string,
    progresso: NonNullable<PipelineRun['squadProgress']>,
    agora: Date
  ): boolean {
    if (
      progresso.some(
        (item) =>
          typeof item.tarefaId !== 'string' ||
          typeof item.papel !== 'string' ||
          typeof item.estado !== 'string' ||
          (item.motivo !== undefined &&
            (typeof item.motivo !== 'string' || item.motivo.length > 160)) ||
          (item.commitSha !== undefined && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(item.commitSha))
      )
    )
      return false
    const resultado = this.db
      .prepare(
        `UPDATE pipeline_run SET squad_progress = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND workspace_id = ? AND project_id = ?
          AND squad_snapshot IS NOT NULL AND estado NOT IN ('MERGED','AWAITING_MERGE','BLOCKED','CANCELLED')`
      )
      .run(
        JSON.stringify(progresso),
        agora.toISOString(),
        runId,
        escopo.userId,
        escopo.workspaceId,
        escopo.projectId
      )
    return resultado.changes === 1
  }

  /**
   * Grava o novo estado do run, **só se ele ainda estiver no estado esperado**.
   *
   * O `WHERE estado = ?` é compare-and-set: dois processos que leram o mesmo run e tentam
   * avançá-lo só deixam um passar, e o segundo recebe `false` em vez de sobrescrever
   * silenciosamente uma transição que não viu. É a mesma proteção que o `UNIQUE` do lease dá ao
   * WIP, um nível abaixo.
   */
  transicionar(
    runId: string,
    de: EstadoDoRun,
    para: EstadoDoRun,
    agora: Date,
    bloqueio?: BloqueioExterno
  ): boolean {
    const resultado = this.db
      .prepare(
        `UPDATE pipeline_run
            SET estado = ?, bloqueio = ?, updated_at = ?
          WHERE id = ? AND estado = ?`
      )
      .run(
        para,
        bloqueio === undefined ? null : JSON.stringify(bloqueio),
        agora.toISOString(),
        runId,
        de
      )

    return resultado.changes === 1
  }

  /**
   * A transição de um run que **detém um slot do pool**, condicionada ao fencing token no próprio
   * `UPDATE` (SPEC-Scheduler-01, critério 4). Confirmar progresso e conferir a posse são um passo
   * só, no banco: entre "o token confere?" e "grava" não existe janela em que o lease possa mudar
   * de dono. Um dono antigo — o que perdeu o lease e voltou — carrega um token que já não é o
   * vigente, e a transição simplesmente não acontece.
   */
  transicionarComFencing(
    runId: string,
    de: EstadoDoRun,
    para: EstadoDoRun,
    agora: Date,
    fencingToken: number,
    bloqueio?: BloqueioExterno
  ): boolean {
    const resultado = this.db
      .prepare(
        `UPDATE pipeline_run
            SET estado = ?, bloqueio = ?, updated_at = ?
          WHERE id = ? AND estado = ?
            AND EXISTS (
              SELECT 1 FROM lease
               WHERE lease.user_id = pipeline_run.user_id
                 AND lease.proprietario = pipeline_run.id
                 AND lease.recurso LIKE 'wip:slot:%'
                 AND lease.fencing_token = ?
            )`
      )
      .run(
        para,
        bloqueio === undefined ? null : JSON.stringify(bloqueio),
        agora.toISOString(),
        runId,
        de,
        fencingToken
      )

    return resultado.changes === 1
  }

  buscar(runId: string): PipelineRun | undefined {
    const row = this.db.prepare('SELECT * FROM pipeline_run WHERE id = ?').get(runId) as
      RunRow | undefined

    return row === undefined ? undefined : toRun(row)
  }

  /** O espaço do run. O `PipelineRun` não o carrega; quem age por conta própria (a recuperação) precisa dele. */
  workspaceDoRun(runId: string): WorkspaceId | undefined {
    const row = this.db.prepare('SELECT workspace_id FROM pipeline_run WHERE id = ?').get(runId) as
      { readonly workspace_id: WorkspaceId } | undefined

    return row?.workspace_id
  }

  /** Os runs de uma fatia, do mais recente para o mais antigo. */
  listarDaFatia(escopo: EscopoDoRun, sliceId: string): readonly PipelineRun[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM pipeline_run
          WHERE user_id = ? AND project_id = ? AND slice_id = ?
          ORDER BY created_at DESC`
      )
      .all(escopo.userId, escopo.projectId, sliceId) as RunRow[]

    return rows.map(toRun)
  }

  /**
   * Os runs em estado não-terminal do usuário, de **todos** os projetos.
   *
   * De todos porque a reconciliação e o WIP são da máquina, não do projeto (emenda 1): filtrar
   * por projeto aqui deixaria um run pendurado de outro projeto invisível para o `reconcileAll`
   * do boot — e é justamente esse que segura o slot global.
   */
  listarAtivos(userId: string): readonly PipelineRun[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM pipeline_run
          WHERE user_id = ?
            AND estado NOT IN ('MERGED', 'AWAITING_MERGE', 'BLOCKED', 'CANCELLED')
          ORDER BY created_at ASC`
      )
      .all(userId) as RunRow[]

    return rows.map(toRun)
  }

  /**
   * As fatias com run `MERGED`: a fonte de "esta dependência terminou" para a fila.
   *
   * `AWAITING_MERGE` **não** conta como concluída: o PR está verde, mas o merge não aconteceu, e
   * a fatia seguinte construiria sobre uma base que ainda não existe na branch-base.
   */
  fatiasConcluidas(escopo: EscopoDoRun): readonly { readonly sliceId: string }[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT slice_id FROM pipeline_run
          WHERE user_id = ? AND project_id = ? AND estado = 'MERGED'`
      )
      .all(escopo.userId, escopo.projectId) as { readonly slice_id: string }[]

    return rows.map((r) => ({ sliceId: r.slice_id }))
  }
}
