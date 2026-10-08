import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { EscopoDoRun, PipelineRepository } from '../pipeline/pipeline-repository'
import type { AuditRepository } from '../storage/audit-repository'
import { calcularCustoUsd, isRotaUnmetered } from '@shared/domain/ai'
import { PAPEIS_QUE_ESCREVEM, type SquadPlan, type TarefaDoPlano } from '@shared/domain/squad-plano'
import type { LimitesAgregadosDoPlano } from '@shared/domain/squad-resolucao'
import type { SnapshotDoSquad } from './squad-snapshot'

export interface ConsumoDaTarefaDoSquad {
  readonly chamadas: number
  readonly tokensEntrada: number
  readonly tokensSaida: number
  readonly turnos: number
  readonly duracaoMs: number
  readonly usd: number
}

interface ReservaCalculada extends ConsumoDaTarefaDoSquad {
  readonly tarefa: TarefaDoPlano
  readonly escritor?: string
  readonly tarefas: number
  readonly escritores: number
  readonly workers: number
}

interface LinhaDaReserva {
  readonly task_id: string
  readonly writer_id: string | null
  readonly role: string
  readonly layer: string
  readonly attempt: number
  readonly state: 'reserved' | 'consumed' | 'indeterminate' | 'released' | 'overrun'
  readonly reserved_calls: number
  readonly reserved_tokens_in: number
  readonly reserved_tokens_out: number
  readonly reserved_turns: number
  readonly reserved_duration_ms: number
  readonly reserved_usd: number
  readonly actual_calls: number | null
  readonly actual_tokens_in: number | null
  readonly actual_tokens_out: number | null
  readonly actual_turns: number | null
  readonly actual_duration_ms: number | null
  readonly actual_usd: number | null
}

const METRICAS = ['chamadas', 'tokensEntrada', 'tokensSaida', 'turnos', 'duracaoMs', 'usd'] as const

function numeroSeguro(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0
}

function limitesValidos(valor: unknown): valor is LimitesAgregadosDoPlano {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return false
  const v = valor as Record<string, unknown>
  return (
    [
      'tarefas',
      'escritores',
      'workers',
      'chamadas',
      'tokensEntrada',
      'tokensSaida',
      'turnos',
      'duracaoMs'
    ].every((chave) => Number.isSafeInteger(v[chave]) && (v[chave] as number) >= 0) &&
    numeroSeguro(v.usd) &&
    Array.isArray(v.camadasMedidas)
  )
}

const PREFIXO_TAREFA_INTEGRADOR = '__integrador__-'
const ehTarefaIntegrador = (taskId: string): boolean => taskId.startsWith(PREFIXO_TAREFA_INTEGRADOR)

function tarefaDoRun(
  run: ReturnType<PipelineRepository['buscar']>,
  taskId: string
):
  | {
      readonly tarefa: TarefaDoPlano
      readonly snapshot: SnapshotDoSquad
      readonly limites: LimitesAgregadosDoPlano
    }
  | undefined {
  const plano = run?.squadPlan as SquadPlan | undefined
  const snapshot = run?.squadSnapshot as SnapshotDoSquad | undefined
  const limites = run?.squadBudgetLimits
  if (plano === undefined || snapshot === undefined || !limitesValidos(limites)) return undefined
  const tarefa =
    plano.tarefas.find((item) => item.id === taskId) ??
    (ehTarefaIntegrador(taskId) && snapshot.perfil.integrador !== undefined
      ? ({
          id: taskId,
          papel: 'integrador',
          capacidade: 'analise',
          camada: snapshot.perfil.integrador.camada,
          entradas: [],
          dependencias: [],
          paths: [],
          schemaDeResultado: 'integracao@1',
          limites: {
            maxTurnos: snapshot.perfil.limites.maxTurnosPorTarefa,
            maxMinutos: snapshot.perfil.limites.maxMinutosPorTarefa,
            maxTokensEntrada: snapshot.perfil.limites.maxTokensEntradaPorTarefa,
            maxTokensSaida: snapshot.perfil.limites.maxTokensSaidaPorTarefa
          },
          fundamento: { criterio: 1 },
          regraDeConclusao: 'integracao validada pelo manifesto'
        } satisfies TarefaDoPlano)
      : undefined)
  return tarefa === undefined ? undefined : { tarefa, snapshot, limites }
}

function calcularReserva(
  tarefa: TarefaDoPlano,
  snapshot: SnapshotDoSquad,
  override?: {
    readonly tokensEntrada: number
    readonly tokensSaida: number
    readonly duracaoMs: number
  }
): ReservaCalculada | undefined {
  const modelo =
    snapshot.resolucao.camadas[tarefa.camada as keyof typeof snapshot.resolucao.camadas]?.modelo
  if (modelo === undefined) return undefined
  const tokensEntrada = override?.tokensEntrada ?? tarefa.limites.maxTokensEntrada
  const tokensSaida = override?.tokensSaida ?? tarefa.limites.maxTokensSaida
  const duracaoMs = override?.duracaoMs ?? tarefa.limites.maxMinutos * 60_000
  const escritor =
    PAPEIS_QUE_ESCREVEM.includes(tarefa.papel) && tarefa.papel !== 'integrador'
      ? tarefa.escritor
      : undefined
  if (tarefa.papel === 'desenvolvedor' && escritor === undefined) return undefined
  const usd = isRotaUnmetered(modelo.provider)
    ? 0
    : calcularCustoUsd(modelo.provider, modelo.modelo, {
        tokensEntrada,
        tokensSaida
      })
  return {
    tarefa,
    ...(escritor === undefined ? {} : { escritor }),
    tarefas: 1,
    escritores: escritor === undefined ? 0 : 1,
    workers: tarefa.papel === 'integrador' ? 0 : escritor === undefined ? 1 : 0,
    chamadas: 1,
    tokensEntrada,
    tokensSaida,
    turnos: override === undefined ? tarefa.limites.maxTurnos : 1,
    duracaoMs,
    usd
  }
}

function soma(linhas: readonly LinhaDaReserva[], campo: (typeof METRICAS)[number]): number {
  return linhas.reduce((total, linha) => {
    if (linha.state === 'released') return total
    if (linha.state === 'reserved' || linha.state === 'indeterminate') {
      const coluna = {
        chamadas: 'reserved_calls',
        tokensEntrada: 'reserved_tokens_in',
        tokensSaida: 'reserved_tokens_out',
        turnos: 'reserved_turns',
        duracaoMs: 'reserved_duration_ms',
        usd: 'reserved_usd'
      }[campo] as keyof LinhaDaReserva
      return total + (linha[coluna] as number)
    }
    const coluna = {
      chamadas: 'actual_calls',
      tokensEntrada: 'actual_tokens_in',
      tokensSaida: 'actual_tokens_out',
      turnos: 'actual_turns',
      duracaoMs: 'actual_duration_ms',
      usd: 'actual_usd'
    }[campo] as keyof LinhaDaReserva
    return total + ((linha[coluna] as number | null) ?? 0)
  }, 0)
}

/** Reserva transacional antes do dispatch; consumo observado substitui reserva após o executor. */
export class SquadOrcamentoService {
  constructor(
    private readonly db: Database,
    private readonly runs: Pick<PipelineRepository, 'buscar' | 'workspaceDoRun'>,
    private readonly audit: AuditRepository,
    private readonly agora: () => Date = () => new Date()
  ) {}

  reservar(
    escopo: EscopoDoRun,
    runId: string,
    taskId: string,
    tentativa: number
  ): { readonly permitido: boolean; readonly motivo?: string } {
    return this.reservarComLimites(escopo, runId, taskId, tentativa)
  }

  reservarIntegracao(
    escopo: EscopoDoRun,
    runId: string,
    taskId: string,
    tentativa: number,
    limites: {
      readonly tokensEntrada: number
      readonly tokensSaida: number
      readonly duracaoMs: number
    }
  ): { readonly permitido: boolean; readonly motivo?: string } {
    if (!ehTarefaIntegrador(taskId) || !Object.values(limites).every(numeroSeguro))
      return { permitido: false, motivo: 'limites-invalidos' }
    return this.reservarComLimites(escopo, runId, taskId, tentativa, limites)
  }

  private reservarComLimites(
    escopo: EscopoDoRun,
    runId: string,
    taskId: string,
    tentativa: number,
    override?: {
      readonly tokensEntrada: number
      readonly tokensSaida: number
      readonly duracaoMs: number
    }
  ): { readonly permitido: boolean; readonly motivo?: string } {
    if (!Number.isSafeInteger(tentativa) || tentativa < 1)
      return { permitido: false, motivo: 'tentativa-invalida' }
    const executar = this.db.transaction(() => {
      const run = this.runs.buscar(runId)
      if (
        run === undefined ||
        run.user_id !== escopo.userId ||
        run.projectId !== escopo.projectId ||
        this.runs.workspaceDoRun(runId) !== escopo.workspaceId ||
        !['READY', 'RUNNING', 'VALIDATING', 'REVIEWING'].includes(run.estado)
      )
        return { permitido: false, motivo: 'run-indisponivel' }

      const item = tarefaDoRun(run, taskId)
      const limites = item?.limites ?? (override === undefined ? undefined : run.squadBudgetLimits)
      const reserva =
        item === undefined ? undefined : calcularReserva(item.tarefa, item.snapshot, override)
      if (
        (item === undefined && !ehTarefaIntegrador(taskId)) ||
        limites === undefined ||
        reserva === undefined
      )
        return { permitido: false, motivo: 'teto-ausente-ou-tarefa-desconhecida' }
      if (Math.abs(limites.usd - (run.squadCostLimitUsd ?? Number.NaN)) > 1e-9) {
        return { permitido: false, motivo: 'teto-financeiro-divergente' }
      }

      const anterior = this.db
        .prepare(
          `SELECT state FROM squad_budget_reservation
          WHERE user_id = ? AND workspace_id = ? AND project_id = ? AND run_id = ? AND task_id = ? AND attempt = ?`
        )
        .get(escopo.userId, escopo.workspaceId, escopo.projectId, runId, taskId, tentativa) as
        { state: string } | undefined
      if (anterior !== undefined) return { permitido: false, motivo: 'tentativa-ja-reservada' }

      const linhas = this.db
        .prepare(
          `SELECT task_id, writer_id, role, layer, attempt, state,
                reserved_calls, reserved_tokens_in, reserved_tokens_out, reserved_turns,
                reserved_duration_ms, reserved_usd, actual_calls, actual_tokens_in,
                actual_tokens_out, actual_turns, actual_duration_ms, actual_usd
           FROM squad_budget_reservation
          WHERE user_id = ? AND workspace_id = ? AND project_id = ? AND run_id = ?`
        )
        .all(escopo.userId, escopo.workspaceId, escopo.projectId, runId) as LinhaDaReserva[]

      if (linhas.some((linha) => linha.state === 'overrun')) {
        this.auditar(escopo, runId, taskId, tentativa, 'bloqueado', 'sobreconsumo-anterior', {})
        return { permitido: false, motivo: 'teto-agregado-excedido' }
      }

      const tarefasVistas = new Set(
        linhas
          .filter((linha) => linha.state !== 'released' && !ehTarefaIntegrador(linha.task_id))
          .map((linha) => linha.task_id)
      )
      const ativas = linhas.filter((linha) => linha.state !== 'released')
      const escritoresVistos = new Set(ativas.flatMap((linha) => lineWriter(linha)))
      const workersVistos = new Set(
        ativas
          .filter((linha) => linha.writer_id === null && !ehTarefaIntegrador(linha.task_id))
          .map((linha) => linha.task_id)
      )
      const totais = {
        tarefas:
          tarefasVistas.size +
          (tarefasVistas.has(taskId) || ehTarefaIntegrador(taskId) || item === undefined ? 0 : 1),
        escritores:
          escritoresVistos.size +
          (reserva.escritor !== undefined && !escritoresVistos.has(reserva.escritor) ? 1 : 0),
        workers:
          workersVistos.size +
          (reserva.escritor === undefined &&
          !ehTarefaIntegrador(taskId) &&
          !workersVistos.has(taskId)
            ? 1
            : 0),
        chamadas: soma(linhas, 'chamadas') + reserva.chamadas,
        tokensEntrada: soma(linhas, 'tokensEntrada') + reserva.tokensEntrada,
        tokensSaida: soma(linhas, 'tokensSaida') + reserva.tokensSaida,
        turnos: soma(linhas, 'turnos') + reserva.turnos,
        duracaoMs: soma(linhas, 'duracaoMs') + reserva.duracaoMs,
        usd: soma(linhas, 'usd') + reserva.usd
      }
      const anteriorDaTarefa = linhas.filter((linha) => linha.task_id === taskId)
      const jaFoiContada = tarefasVistas.has(taskId)
      const reservadoTarefa = {
        chamadas: soma(anteriorDaTarefa, 'chamadas') + reserva.chamadas,
        tokensEntrada: soma(anteriorDaTarefa, 'tokensEntrada') + reserva.tokensEntrada,
        tokensSaida: soma(anteriorDaTarefa, 'tokensSaida') + reserva.tokensSaida,
        turnos: soma(anteriorDaTarefa, 'turnos') + reserva.turnos,
        duracaoMs: soma(anteriorDaTarefa, 'duracaoMs') + reserva.duracaoMs,
        usd: soma(anteriorDaTarefa, 'usd') + reserva.usd
      }
      const excedeu =
        (!jaFoiContada && totais.tarefas > limites.tarefas) ||
        totais.escritores > limites.escritores ||
        totais.workers > limites.workers ||
        totais.chamadas > limites.chamadas ||
        totais.tokensEntrada > limites.tokensEntrada ||
        totais.tokensSaida > limites.tokensSaida ||
        totais.turnos > limites.turnos ||
        totais.duracaoMs > limites.duracaoMs ||
        totais.usd > limites.usd + 1e-9 ||
        reservadoTarefa.chamadas > reserva.tarefa.limites.maxTurnos ||
        reservadoTarefa.tokensEntrada > reserva.tarefa.limites.maxTokensEntrada ||
        reservadoTarefa.tokensSaida > reserva.tarefa.limites.maxTokensSaida ||
        reservadoTarefa.turnos > reserva.tarefa.limites.maxTurnos ||
        reservadoTarefa.duracaoMs > reserva.tarefa.limites.maxMinutos * 60_000 ||
        reservadoTarefa.usd > reserva.usd + 1e-9
      if (excedeu) {
        this.auditar(
          escopo,
          runId,
          taskId,
          tentativa,
          'bloqueado',
          'teto-agregado-excedido',
          totais
        )
        return { permitido: false, motivo: 'teto-agregado-excedido' }
      }

      const agora = this.agora().toISOString()
      this.db
        .prepare(
          `INSERT INTO squad_budget_reservation
           (id, user_id, workspace_id, project_id, run_id, task_id, writer_id, role, layer, attempt, state,
           reserved_tasks, reserved_writers, reserved_workers, reserved_calls, reserved_tokens_in,
           reserved_tokens_out, reserved_turns, reserved_duration_ms, reserved_usd, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          randomUUID(),
          escopo.userId,
          escopo.workspaceId,
          escopo.projectId,
          runId,
          taskId,
          reserva.escritor ?? null,
          reserva.tarefa.papel,
          reserva.tarefa.camada,
          tentativa,
          reserva.escritores,
          reserva.workers,
          reserva.chamadas,
          reserva.tokensEntrada,
          reserva.tokensSaida,
          reserva.turnos,
          reserva.duracaoMs,
          reserva.usd,
          agora,
          agora
        )
      this.auditar(escopo, runId, taskId, tentativa, 'reservado', 'dispatch-autorizado', totais)
      return { permitido: true }
    })
    return executar()
  }

  registrarConsumo(
    escopo: EscopoDoRun,
    runId: string,
    taskId: string,
    tentativa: number,
    consumo: ConsumoDaTarefaDoSquad
  ): boolean {
    if (
      !METRICAS.every(
        (chave) =>
          numeroSeguro(consumo[chave]) && (chave === 'usd' || Number.isSafeInteger(consumo[chave]))
      )
    )
      return false
    const executar = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT * FROM squad_budget_reservation
          WHERE user_id = ? AND workspace_id = ? AND project_id = ? AND run_id = ? AND task_id = ? AND attempt = ?`
        )
        .get(escopo.userId, escopo.workspaceId, escopo.projectId, runId, taskId, tentativa) as
        | (LinhaDaReserva & {
            readonly id: string
            readonly reserved_tasks: number
            readonly reserved_writers: number
            readonly reserved_workers: number
          })
        | undefined
      if (row === undefined || row.state !== 'reserved') return false

      const writer = row.writer_id !== null
      const excedeu =
        consumo.chamadas > row.reserved_calls ||
        consumo.tokensEntrada > row.reserved_tokens_in ||
        consumo.tokensSaida > row.reserved_tokens_out ||
        consumo.turnos > row.reserved_turns ||
        consumo.duracaoMs > row.reserved_duration_ms ||
        consumo.usd > row.reserved_usd + 1e-9 ||
        consumo.tokensEntrada >
          (row as LinhaDaReserva & { readonly task_id: string }).reserved_tokens_in
      const estado = excedeu ? 'overrun' : 'consumed'
      this.db
        .prepare(
          `UPDATE squad_budget_reservation SET state = ?, actual_tasks = 1, actual_writers = ?,
           actual_workers = ?, actual_calls = ?, actual_tokens_in = ?, actual_tokens_out = ?,
           actual_turns = ?, actual_duration_ms = ?, actual_usd = ?, updated_at = ?
          WHERE id = ? AND state = 'reserved'`
        )
        .run(
          estado,
          writer ? 1 : 0,
          writer ? 0 : 1,
          consumo.chamadas,
          consumo.tokensEntrada,
          consumo.tokensSaida,
          consumo.turnos,
          consumo.duracaoMs,
          consumo.usd,
          this.agora().toISOString(),
          row.id
        )
      this.auditar(escopo, runId, taskId, tentativa, estado, 'consumo-observado', { ...consumo })
      return !excedeu
    })
    return executar()
  }

  marcarIndeterminado(escopo: EscopoDoRun, runId: string, taskId: string, tentativa: number): void {
    const result = this.db
      .prepare(
        `UPDATE squad_budget_reservation SET state = 'indeterminate', updated_at = ?
        WHERE user_id = ? AND workspace_id = ? AND project_id = ? AND run_id = ?
          AND task_id = ? AND attempt = ? AND state = 'reserved'`
      )
      .run(
        this.agora().toISOString(),
        escopo.userId,
        escopo.workspaceId,
        escopo.projectId,
        runId,
        taskId,
        tentativa
      )
    if (result.changes === 1)
      this.auditar(escopo, runId, taskId, tentativa, 'indeterminado', 'uso-nao-observado', {})
  }

  liberarAntesDoDispatch(
    escopo: EscopoDoRun,
    runId: string,
    taskId: string,
    tentativa: number
  ): void {
    const result = this.db
      .prepare(
        `UPDATE squad_budget_reservation SET state = 'released', updated_at = ?
        WHERE user_id = ? AND workspace_id = ? AND project_id = ? AND run_id = ?
          AND task_id = ? AND attempt = ? AND state = 'reserved'`
      )
      .run(
        this.agora().toISOString(),
        escopo.userId,
        escopo.workspaceId,
        escopo.projectId,
        runId,
        taskId,
        tentativa
      )
    if (result.changes === 1)
      this.auditar(escopo, runId, taskId, tentativa, 'liberado', 'dispatch-nao-iniciado', {})
  }

  consumoDoProjeto(escopo: Pick<EscopoDoRun, 'userId' | 'workspaceId' | 'projectId'>) {
    const linhas = this.db
      .prepare(
        `SELECT task_id, writer_id, role, layer, attempt, state, reserved_calls, reserved_tokens_in,
              reserved_tokens_out, reserved_turns, reserved_duration_ms, reserved_usd, actual_calls,
              actual_tokens_in, actual_tokens_out, actual_turns, actual_duration_ms, actual_usd
         FROM squad_budget_reservation
        WHERE user_id = ? AND workspace_id = ? AND project_id = ?`
      )
      .all(escopo.userId, escopo.workspaceId, escopo.projectId) as LinhaDaReserva[]
    return this.resumo(linhas)
  }

  consumoDoRun(escopo: EscopoDoRun, runId: string) {
    const linhas = this.db
      .prepare(
        `SELECT task_id, writer_id, role, layer, attempt, state, reserved_calls, reserved_tokens_in,
              reserved_tokens_out, reserved_turns, reserved_duration_ms, reserved_usd, actual_calls,
              actual_tokens_in, actual_tokens_out, actual_turns, actual_duration_ms, actual_usd
         FROM squad_budget_reservation
        WHERE user_id = ? AND workspace_id = ? AND project_id = ? AND run_id = ?`
      )
      .all(escopo.userId, escopo.workspaceId, escopo.projectId, runId) as LinhaDaReserva[]
    return this.resumo(linhas)
  }

  private resumo(linhas: readonly LinhaDaReserva[]) {
    return {
      tarefas: new Set(
        linhas
          .filter((linha) => linha.state !== 'released' && !ehTarefaIntegrador(linha.task_id))
          .map((linha) => linha.task_id)
      ).size,
      escritores: new Set(linhas.filter((linha) => linha.state !== 'released').flatMap(lineWriter))
        .size,
      workers: new Set(
        linhas
          .filter(
            (linha) =>
              linha.state !== 'released' &&
              linha.writer_id === null &&
              !ehTarefaIntegrador(linha.task_id)
          )
          .map((linha) => linha.task_id)
      ).size,
      chamadas: soma(linhas, 'chamadas'),
      tokensEntrada: soma(linhas, 'tokensEntrada'),
      tokensSaida: soma(linhas, 'tokensSaida'),
      turnos: soma(linhas, 'turnos'),
      duracaoMs: soma(linhas, 'duracaoMs'),
      usd: soma(linhas, 'usd'),
      pendentes: linhas.filter(
        (linha) => linha.state === 'reserved' || linha.state === 'indeterminate'
      ).length,
      falhasDeTeto: linhas.filter((linha) => linha.state === 'overrun').length,
      camadasMedidas: [
        ...new Set(linhas.filter((linha) => linha.state !== 'released').map((linha) => linha.layer))
      ]
    }
  }

  private auditar(
    escopo: EscopoDoRun,
    runId: string,
    taskId: string,
    tentativa: number,
    decisao: string,
    motivo: string,
    consumo: Record<string, unknown>
  ): void {
    this.audit.append({
      user_id: escopo.userId,
      workspace_id: escopo.workspaceId,
      type: 'budget-decision',
      payload: {
        escopo: 'squad-run',
        projectId: escopo.projectId,
        runId,
        taskId,
        tentativa,
        decisao,
        motivo,
        consumo
      }
    })
  }
}

function lineWriter(linha: LinhaDaReserva): string[] {
  return linha.writer_id === null ? [] : [linha.writer_id]
}
