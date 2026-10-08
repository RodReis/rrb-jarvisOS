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
import type { SquadPlan } from '@shared/domain/squad-plano'
import type { Camada } from '@shared/domain/squad-perfil'
import type { LimitesAgregadosDoPlano } from '@shared/domain/squad-resolucao'
import { isCamada } from '@shared/domain/squad-perfil'
import { verificarSnapshot, type SnapshotDoSquad } from '../squads/squad-snapshot'
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
  readonly dispatch_key: string | null
  readonly estado: string
  readonly continua_de: string | null
  readonly bloqueio: string | null
  readonly squad_snapshot: string | null
  readonly squad_progress: string | null
  readonly squad_plan: string | null
  readonly squad_budget_limits: string | null
  readonly squad_cost_limit_usd: number | null
  readonly squad_cost_measured: number | null
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
  let squadSnapshot: SnapshotDoSquad | undefined
  let squadProgress: PipelineRun['squadProgress']
  let squadPlan: SquadPlan | undefined
  let squadBudgetLimits: LimitesAgregadosDoPlano | undefined
  try {
    if (row.squad_snapshot !== null) {
      const candidato: unknown = JSON.parse(row.squad_snapshot)
      if (snapshotValido(candidato)) squadSnapshot = candidato
      else log.db.warn('Snapshot do Squad inválido no pipeline_run.', { runId: row.id })
    }
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
  try {
    if (row.squad_plan !== null) {
      const lido: unknown = JSON.parse(row.squad_plan)
      if (typeof lido === 'object' && lido !== null && Array.isArray((lido as SquadPlan).tarefas)) {
        squadPlan = lido as SquadPlan
      }
    }
  } catch {
    log.db.warn('Plano do Squad ilegível no pipeline_run.', { runId: row.id })
  }
  try {
    if (row.squad_budget_limits !== null) {
      const lido: unknown = JSON.parse(row.squad_budget_limits)
      if (limitesAgregadosValidos(lido)) squadBudgetLimits = lido
      else log.db.warn('Tetos do Squad inválidos no pipeline_run.', { runId: row.id })
    }
  } catch {
    log.db.warn('Tetos do Squad ilegíveis no pipeline_run.', { runId: row.id })
  }

  return {
    id: row.id,
    user_id: row.user_id,
    projectId: row.project_id,
    sliceId: row.slice_id,
    ...(row.dispatch_key === null ? {} : { dispatchKey: row.dispatch_key }),
    estado: row.estado as EstadoDoRun,
    ...(row.continua_de === null ? {} : { continuaDe: row.continua_de }),
    ...(bloqueio === undefined ? {} : { bloqueio }),
    ...(squadSnapshot === undefined ? {} : { squadSnapshot }),
    ...(squadProgress === undefined ? {} : { squadProgress }),
    ...(squadPlan === undefined ? {} : { squadPlan }),
    ...(squadBudgetLimits === undefined ? {} : { squadBudgetLimits }),
    ...(row.squad_cost_limit_usd === null ? {} : { squadCostLimitUsd: row.squad_cost_limit_usd }),
    ...(row.squad_cost_measured === null
      ? {}
      : { squadCostMeasured: row.squad_cost_measured === 1 }),
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

/** Checagem estrutural antes de passar o JSON persistido ao verificador de hash/resolução. */
function ehSnapshotDoSquad(valor: unknown): valor is SnapshotDoSquad {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return false
  const v = valor as Record<string, unknown>
  return (
    typeof v.registroDeCapacidades === 'number' &&
    typeof v.perfil === 'object' &&
    v.perfil !== null &&
    typeof v.revisao === 'string' &&
    typeof v.ambiente === 'object' &&
    v.ambiente !== null &&
    typeof v.modeloDaFase === 'object' &&
    v.modeloDaFase !== null &&
    typeof v.resolucao === 'object' &&
    v.resolucao !== null
  )
}

function snapshotValido(valor: unknown): valor is SnapshotDoSquad {
  if (!ehSnapshotDoSquad(valor)) return false
  try {
    return verificarSnapshot(valor)
  } catch {
    return false
  }
}

function limitesAgregadosValidos(valor: unknown): valor is LimitesAgregadosDoPlano {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return false
  const limite = valor as Record<string, unknown>
  const contagens = [
    'tarefas',
    'escritores',
    'workers',
    'chamadas',
    'tokensEntrada',
    'tokensSaida',
    'turnos',
    'duracaoMs'
  ]
  return (
    contagens.every(
      (chave) => Number.isSafeInteger(limite[chave]) && (limite[chave] as number) >= 0
    ) &&
    Number.isFinite(limite.usd) &&
    (limite.usd as number) >= 0 &&
    Array.isArray(limite.camadasMedidas) &&
    limite.camadasMedidas.every(isCamada)
  )
}

export class PipelineRepository {
  constructor(private readonly db: Database) {}

  /** Cria um run. `continuaDe` vincula a retomada ao run bloqueado que a originou. */
  criar(
    escopo: EscopoDoRun,
    dados: {
      readonly sliceId: string
      readonly estado: EstadoDoRun
      readonly continuaDe?: string
      readonly dispatchKey?: string
    },
    agora: Date
  ): PipelineRun {
    if (dados.dispatchKey !== undefined) {
      const existente = this.buscarPorChaveDispatch(escopo, dados.dispatchKey)
      if (existente !== undefined) return existente
    }
    const id = randomUUID()
    const iso = agora.toISOString()

    try {
      this.db
        .prepare(
          `INSERT INTO pipeline_run
           (id, user_id, workspace_id, project_id, slice_id, estado, continua_de, bloqueio, dispatch_key,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
        )
        .run(
          id,
          escopo.userId,
          escopo.workspaceId,
          escopo.projectId,
          dados.sliceId,
          dados.estado,
          dados.continuaDe ?? null,
          dados.dispatchKey ?? null,
          iso,
          iso
        )
    } catch (error) {
      const concorrente =
        dados.dispatchKey === undefined
          ? undefined
          : this.buscarPorChaveDispatch(escopo, dados.dispatchKey)
      if (concorrente !== undefined) return concorrente
      throw error
    }

    return {
      id,
      user_id: escopo.userId,
      projectId: escopo.projectId,
      sliceId: dados.sliceId,
      estado: dados.estado,
      ...(dados.dispatchKey === undefined ? {} : { dispatchKey: dados.dispatchKey }),
      ...(dados.continuaDe === undefined ? {} : { continuaDe: dados.continuaDe }),
      created_at: iso,
      updated_at: iso
    }
  }

  /** Persiste o snapshot do Squad antes de qualquer dispatch, restrito ao escopo do run. */
  registrarSnapshotDoSquad(
    escopo: EscopoDoRun,
    runId: string,
    snapshot: SnapshotDoSquad,
    agora: Date
  ): boolean {
    if (!snapshotValido(snapshot)) return false
    const atual = this.db
      .prepare(
        `SELECT squad_snapshot FROM pipeline_run
          WHERE id = ? AND user_id = ? AND workspace_id = ? AND project_id = ? AND estado = 'PLANNED'`
      )
      .get(runId, escopo.userId, escopo.workspaceId, escopo.projectId) as
      { readonly squad_snapshot: string | null } | undefined
    if (atual?.squad_snapshot !== null && atual?.squad_snapshot !== undefined)
      return atual.squad_snapshot === JSON.stringify(snapshot)
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

  registrarPlanoDoSquad(
    escopo: EscopoDoRun,
    runId: string,
    plano: SquadPlan,
    agora: Date,
    congelamento?: {
      readonly limiteUsd: number
      readonly medido: boolean
      readonly limites?: LimitesAgregadosDoPlano
    }
  ): boolean {
    if (!Array.isArray(plano.tarefas)) return false
    if (
      congelamento !== undefined &&
      (!Number.isFinite(congelamento.limiteUsd) ||
        congelamento.limiteUsd < 0 ||
        (congelamento.limites !== undefined && !limitesAgregadosValidos(congelamento.limites)))
    )
      return false
    const resultado = this.db
      .prepare(
        `UPDATE pipeline_run SET squad_plan = ?,
          squad_cost_limit_usd = COALESCE(?, squad_cost_limit_usd),
          squad_cost_measured = COALESCE(?, squad_cost_measured),
          squad_budget_limits = COALESCE(?, squad_budget_limits), updated_at = ?
        WHERE id = ? AND user_id = ? AND workspace_id = ? AND project_id = ?
          AND squad_snapshot IS NOT NULL AND squad_plan IS NULL
          AND (? IS NULL OR estado = 'READY')
          AND estado NOT IN ('MERGED','AWAITING_MERGE','BLOCKED','CANCELLED')`
      )
      .run(
        JSON.stringify(plano),
        congelamento?.limiteUsd ?? null,
        congelamento === undefined ? null : congelamento.medido ? 1 : 0,
        congelamento?.limites === undefined ? null : JSON.stringify(congelamento.limites),
        agora.toISOString(),
        runId,
        escopo.userId,
        escopo.workspaceId,
        escopo.projectId,
        congelamento?.limiteUsd ?? null
      )
    return resultado.changes === 1
  }

  /** Teto de custo versionado com o run, calculado antes da primeira chamada do Squad. */
  registrarCustoMaximoDoSquad(
    escopo: EscopoDoRun,
    runId: string,
    limiteUsd: number,
    medido: boolean,
    agora: Date
  ): boolean {
    if (!Number.isFinite(limiteUsd) || limiteUsd < 0) return false
    const atual = this.db
      .prepare(
        `SELECT squad_cost_limit_usd, squad_cost_measured FROM pipeline_run
          WHERE id = ? AND user_id = ? AND workspace_id = ? AND project_id = ?`
      )
      .get(runId, escopo.userId, escopo.workspaceId, escopo.projectId) as
      | {
          readonly squad_cost_limit_usd: number | null
          readonly squad_cost_measured: number | null
        }
      | undefined
    if (atual?.squad_cost_limit_usd !== null && atual?.squad_cost_limit_usd !== undefined)
      return (
        atual.squad_cost_limit_usd === limiteUsd && atual.squad_cost_measured === (medido ? 1 : 0)
      )
    const resultado = this.db
      .prepare(
        `UPDATE pipeline_run SET squad_cost_limit_usd = ?, squad_cost_measured = ?, updated_at = ?
          WHERE id = ? AND user_id = ? AND workspace_id = ? AND project_id = ?
            AND squad_snapshot IS NOT NULL AND squad_cost_limit_usd IS NULL
            AND estado NOT IN ('MERGED','AWAITING_MERGE','BLOCKED','CANCELLED')`
      )
      .run(
        limiteUsd,
        medido ? 1 : 0,
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
    if (row === undefined) return undefined
    const run = toRun(row)
    if (run.squadPlan === undefined) return run
    const uso = this.consumo(run)
    return uso === undefined ? run : { ...run, squadBudgetUsage: uso }
  }

  buscarPorChaveDispatch(escopo: EscopoDoRun, dispatchKey: string): PipelineRun | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM pipeline_run
          WHERE user_id = ? AND workspace_id = ? AND project_id = ? AND dispatch_key = ?`
      )
      .get(escopo.userId, escopo.workspaceId, escopo.projectId, dispatchKey) as RunRow | undefined
    return row === undefined ? undefined : this.buscar(row.id)
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

    return rows.map((row) => {
      const run = toRun(row)
      if (run.squadPlan === undefined) return run
      const uso = this.consumo(run)
      return uso === undefined ? run : { ...run, squadBudgetUsage: uso }
    })
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

    return rows.map((row) => {
      const run = toRun(row)
      if (run.squadPlan === undefined) return run
      const uso = this.consumo(run)
      return uso === undefined ? run : { ...run, squadBudgetUsage: uso }
    })
  }

  private consumo(run: PipelineRun): PipelineRun['squadBudgetUsage'] | undefined {
    const linha = this.db
      .prepare(
        `SELECT COUNT(DISTINCT CASE WHEN state <> 'released' THEN task_id END) AS tarefas,
              GROUP_CONCAT(DISTINCT CASE WHEN state <> 'released' THEN layer END) AS camadas,
              COUNT(DISTINCT CASE WHEN state <> 'released' THEN writer_id END) AS escritores,
              COUNT(DISTINCT CASE WHEN state <> 'released' AND writer_id IS NULL THEN task_id END) AS workers,
              COALESCE(SUM(CASE WHEN state IN ('reserved','indeterminate') THEN reserved_calls ELSE COALESCE(actual_calls,0) END),0) AS chamadas,
              COALESCE(SUM(CASE WHEN state IN ('reserved','indeterminate') THEN reserved_tokens_in ELSE COALESCE(actual_tokens_in,0) END),0) AS tokensEntrada,
              COALESCE(SUM(CASE WHEN state IN ('reserved','indeterminate') THEN reserved_tokens_out ELSE COALESCE(actual_tokens_out,0) END),0) AS tokensSaida,
              COALESCE(SUM(CASE WHEN state IN ('reserved','indeterminate') THEN reserved_turns ELSE COALESCE(actual_turns,0) END),0) AS turnos,
              COALESCE(SUM(CASE WHEN state IN ('reserved','indeterminate') THEN reserved_duration_ms ELSE COALESCE(actual_duration_ms,0) END),0) AS duracaoMs,
              COALESCE(SUM(CASE WHEN state IN ('reserved','indeterminate') THEN reserved_usd ELSE COALESCE(actual_usd,0) END),0) AS usd,
              SUM(CASE WHEN state IN ('reserved','indeterminate') THEN 1 ELSE 0 END) AS pendentes,
              SUM(CASE WHEN state = 'overrun' THEN 1 ELSE 0 END) AS falhasDeTeto
         FROM squad_budget_reservation
        WHERE user_id = ? AND workspace_id = ? AND project_id = ? AND run_id = ?`
      )
      .get(run.user_id, this.workspaceDoRun(run.id), run.projectId, run.id) as
      | ({ readonly camadas: string | null } & Record<
          | 'tarefas'
          | 'escritores'
          | 'workers'
          | 'chamadas'
          | 'tokensEntrada'
          | 'tokensSaida'
          | 'turnos'
          | 'duracaoMs'
          | 'usd'
          | 'pendentes'
          | 'falhasDeTeto',
          number
        >)
      | undefined
    if (linha === undefined || linha.pendentes === undefined) return undefined
    return {
      tarefas: linha.tarefas,
      escritores: linha.escritores,
      workers: linha.workers,
      chamadas: linha.chamadas,
      tokensEntrada: linha.tokensEntrada,
      tokensSaida: linha.tokensSaida,
      turnos: linha.turnos,
      duracaoMs: linha.duracaoMs,
      usd: linha.usd,
      camadasMedidas: (typeof linha.camadas === 'string'
        ? linha.camadas.split(',')
        : []) as Camada[],
      pendentes: linha.pendentes,
      falhasDeTeto: linha.falhasDeTeto
    }
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
