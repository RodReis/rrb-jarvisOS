/**
 * A recuperação de runs que perderam o dono ou terminaram sem devolver o que seguravam
 * (SPEC-Scheduler-05, regras 1 e 2).
 *
 * A pergunta que este serviço responde: **este run ainda tem dono? se não, o que ele segurava
 * pode voltar à fila?**
 *
 * **A decisão é da função pura** (`decidirRecuperacao`): aqui só se **observa** — lease, executor,
 * merge — e se executa o veredito. Dois trabalhos:
 *
 *  - `recolher(runId)`: o run **já terminou** e devolve slot e travas. Só depois de o isolamento
 *    devolver os recursos e a fonte real (Docker) confirmar o executor morto: container que não
 *    parou, ou que o Docker não soube dizer, **segura o slot** — falha de limpeza não é liberação;
 *  - `supervisionar()`: varre os slots. Run ativo cujo lease expirou **e** cujo executor está
 *    provadamente morto vai a `BLOCKED` com a ação de retomada; o resto — lease vigente, executor
 *    vivo (lentidão), executor indeterminado, merge no ar — não é tocado. Cada run é decidido
 *    sozinho, com o que foi observado sobre ele: a falha de um nunca libera o que é do outro
 *    (regra 2).
 *
 * **Síncrono de propósito:** tudo que se consulta (SQLite, `docker ps`) é síncrono neste processo.
 * Uma `Promise` criaria a impressão de concorrência que não existe — e abriria uma janela entre
 * "observei" e "agi" que o JavaScript síncrono não tem.
 */

import type { WorkspaceId } from '@shared/domain/entities'
import { estadoDoLease, type Lease } from '@shared/domain/lease'
import type { PendenciaDeLimpeza } from '@shared/domain/limpeza'
import { ehTerminal, type PipelineRun } from '@shared/domain/pipeline'
import {
  decidirRecuperacao,
  type ExecutorObservado,
  type ObservacaoDoRun,
  type SlotObservado
} from '@shared/domain/recuperacao'
import { lerIdDoEscritor } from '@shared/domain/squad-execucao'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { FilaService } from './fila-service'
import type { LeaseRepository } from './lease-repository'
import type { PipelineRepository } from './pipeline-repository'
import type { PoolService } from './pool-service'
import type { AchadoDaReconciliacao } from './reconciliacao-service'

/** O que a recuperação pede ao isolamento: devolver o run e as unidades de sandbox dele. */
export interface IsolamentoDaRecuperacao {
  readonly liberarRunEUnidades: (runId: string) => {
    readonly removidos: readonly string[]
    readonly pendencias: readonly PendenciaDeLimpeza[]
  }
}

export interface RecuperacaoDeps {
  readonly runs: PipelineRepository
  readonly leases: LeaseRepository
  readonly pool: PoolService
  /** Só o que a recuperação usa da fila: bloquear com o token e passar a vez. */
  readonly fila: Pick<FilaService, 'transicionar' | 'despachar'>
  readonly audit: AuditRepository
  readonly userId: () => string
  /** O isolamento por run. Opcional: sem ele a recuperação só enxerga leases. */
  readonly isolamento?: IsolamentoDaRecuperacao
  /**
   * O executor do run está vivo? A fonte é o Docker. **Falha de consulta é `desconhecido`**, nunca
   * `morto`: não ver o container porque o Docker não respondeu não é ele ter sumido.
   */
  readonly executor: (runId: string) => ExecutorObservado
  /** Há merge no ar (ou confirmado e ainda não registrado) para o run? */
  readonly mergeEmCurso: (runId: string) => boolean
  readonly agora?: () => number
}

export interface ResultadoDoRecolhimento {
  readonly recolhido: boolean
  readonly motivo: string
  readonly pendencias: readonly PendenciaDeLimpeza[]
}

const SEM_PENDENCIAS: readonly PendenciaDeLimpeza[] = []

export class RecuperacaoService {
  private readonly agora: () => number

  constructor(private readonly deps: RecuperacaoDeps) {
    this.agora = deps.agora ?? ((): number => Date.now())
  }

  /**
   * Devolve o slot e as travas de um run **terminal**. Idempotente: sem slot, não há o que fazer.
   *
   * A ordem é a segurança: primeiro os recursos (o isolamento para o container pela label), depois
   * a confirmação de que o executor morreu, e só então o slot. Um run `CANCELLED` com o container
   * ainda de pé segura o slot — liberar passaria a vez a outro executor sobre a mesma máquina.
   */
  recolher(runId: string): ResultadoDoRecolhimento {
    const run = this.deps.runs.buscar(runId)
    if (run === undefined || !ehTerminal(run.estado)) {
      return recusado('O run não terminou: a recuperação só recolhe o que acabou.')
    }
    if (this.slotsDoRun(runId).length === 0) {
      return recusado('O run não segura slot.')
    }

    const devolvido = this.deps.isolamento?.liberarRunEUnidades(runId)
    const pendencias = devolvido?.pendencias ?? SEM_PENDENCIAS
    const containerPendente = pendencias.some(
      (p) => p.recurso === 'container' || p.recurso === 'sidecar'
    )
    if (containerPendente) {
      return this.adiar(run, 'Um container do run não parou: o slot continua ocupado.', pendencias)
    }

    const executor = this.deps.executor(runId)
    if (executor !== 'morto') {
      return this.adiar(
        run,
        executor === 'vivo'
          ? 'O executor do run continua vivo depois da limpeza: o slot continua ocupado.'
          : 'O Docker não confirmou que o executor parou: o slot continua ocupado.',
        pendencias
      )
    }

    const liberou = this.deps.pool.encerrarDoRun(runId)
    this.auditar(run, 'recolhido', `Run em ${run.estado}: slot e travas devolvidos.`)
    // A vez passa a quem esperava; o terminal que chegou até aqui não pode deixar a fila parada.
    this.deps.fila.despachar()
    return {
      recolhido: liberou,
      motivo: `Run em ${run.estado}: slot e travas devolvidos.`,
      pendencias
    }
  }

  /**
   * Varre os slots e recupera o que perdeu o dono. **Cada run é decidido pelo que foi observado
   * sobre ele** — o saudável não é tocado porque o vizinho morreu.
   */
  supervisionar(): readonly AchadoDaReconciliacao[] {
    const achados: AchadoDaReconciliacao[] = []

    for (const [runId, slots] of this.slotsPorRun()) {
      const run = this.deps.runs.buscar(runId)
      if (run === undefined) continue

      const observacao = this.observar(run, slots)
      const decisao = decidirRecuperacao(observacao)
      const recurso = `run:${runId}`

      switch (decisao.acao) {
        case 'manter':
          achados.push({ recurso, decisao: 'intacto', motivo: decisao.motivo })
          break
        case 'aguardar':
          achados.push({ recurso, decisao: 'bloqueado', motivo: decisao.motivo })
          break
        case 'recolher': {
          const r = this.recolher(runId)
          achados.push({
            recurso,
            decisao: r.recolhido ? 'liberado' : 'bloqueado',
            motivo: r.motivo
          })
          break
        }
        case 'bloquear-e-recolher':
          achados.push(this.bloquearERecolher(run, slots, decisao.motivo))
          break
      }
    }

    return achados
  }

  /** Executor e merge só são consultados quando a decisão depende deles: Docker custa. */
  private observar(run: PipelineRun, slots: readonly Lease[]): ObservacaoDoRun {
    const slot = estadoDoSlot(slots, this.agora())
    const precisaDoExecutor = !ehTerminal(run.estado) && slot === 'expirado'
    return {
      estado: run.estado,
      slot,
      executor: precisaDoExecutor ? this.deps.executor(run.id) : 'desconhecido',
      mergeEmCurso: precisaDoExecutor && this.deps.mergeEmCurso(run.id)
    }
  }

  /**
   * O run perdeu o dono: bloqueia com o token do lease que ainda consta — o dono antigo não pode
   * apresentá-lo, mas o registro do slot é a prova de quem detinha — e devolve o que segurava.
   */
  private bloquearERecolher(
    run: PipelineRun,
    slots: readonly Lease[],
    motivo: string
  ): AchadoDaReconciliacao {
    const recurso = `run:${run.id}`
    const dono = slots.find((l) => l.proprietario === run.id) ?? slots[0]
    const workspaceId = this.deps.runs.workspaceDoRun(run.id)
    if (dono?.fencingToken === undefined || workspaceId === undefined) {
      return {
        recurso,
        decisao: 'bloqueado',
        motivo: 'O lease do slot não tem o token que prova o dono: o run não foi bloqueado.'
      }
    }

    const resultado = this.deps.fila.transicionar(
      run.projectId,
      workspaceId,
      run.id,
      'BLOCKED',
      {
        causa: 'executor-perdido',
        evidencia: `O lease do slot expirou em ${new Date(dono.expiraEm).toISOString()} e a consulta ao Docker não encontrou container do run em execução.`,
        tentativas: 0,
        porQueNaoSeguir:
          'O executor morreu e o trabalho local pode estar incompleto: continuar sem olhar o worktree e a branch arriscaria sobrescrever ou duplicar trabalho.',
        retomada:
          'Criar um run vinculado (continuaDe) a este: ele reaproveita a branch e o PR só se a branch e o head SHA forem reconciliados com a origem.'
      },
      dono.fencingToken
    )
    if (resultado.reason !== 'transicionado') {
      return {
        recurso,
        decisao: 'bloqueado',
        motivo: `O run não pôde ser bloqueado (${resultado.reason}): ${resultado.mensagem}`
      }
    }

    this.auditar(run, 'bloqueado-por-recuperacao', motivo)
    // O gancho da fila (`aoEncerrarSemConclusao`) já recolheu, se estava ligado; chamar de novo é
    // inofensivo (idempotente) e cobre o caso em que não está. O que decide é o slot que restou.
    const r = this.recolher(run.id)
    const devolvido = this.slotsDoRun(run.id).length === 0
    return {
      recurso,
      decisao: devolvido ? 'liberado' : 'bloqueado',
      motivo: `${motivo} ${devolvido ? 'Slot e travas devolvidos.' : r.motivo}`
    }
  }

  private adiar(
    run: PipelineRun,
    motivo: string,
    pendencias: readonly PendenciaDeLimpeza[]
  ): ResultadoDoRecolhimento {
    // Só o log: a varredura repete a cada ciclo, e uma linha de auditoria por volta afogaria a
    // cadeia. A pendência que importa ao PI já está no ledger, gravada pelo isolamento.
    log.agent.warn('Recolhimento adiado', { runId: run.id, motivo })
    return { recolhido: false, motivo, pendencias }
  }

  /** Os slots do run — o dele e os dos escritores do Squad —, agrupados pelo run dono. */
  private slotsPorRun(): ReadonlyMap<string, readonly Lease[]> {
    const porRun = new Map<string, Lease[]>()
    for (const lease of this.deps.leases.listarSlots(this.deps.userId())) {
      const runId = lerIdDoEscritor(lease.proprietario)?.runId ?? lease.proprietario
      porRun.set(runId, [...(porRun.get(runId) ?? []), lease])
    }
    return porRun
  }

  private slotsDoRun(runId: string): readonly Lease[] {
    return this.slotsPorRun().get(runId) ?? []
  }

  private auditar(run: PipelineRun, acao: string, motivo: string): void {
    this.deps.audit.append({
      user_id: this.deps.userId(),
      workspace_id: (this.deps.runs.workspaceDoRun(run.id) ?? 'jarvis') as WorkspaceId,
      type: 'pipeline-lease',
      payload: { acao, runId: run.id, estado: run.estado, motivo }
    })
  }
}

const recusado = (motivo: string): ResultadoDoRecolhimento => ({
  recolhido: false,
  motivo,
  pendencias: SEM_PENDENCIAS
})

/** O slot do run: vigente se **algum** lease do grupo está vivo — um escritor ativo basta. */
function estadoDoSlot(slots: readonly Lease[], agora: number): SlotObservado {
  if (slots.length === 0) return 'ausente'
  return slots.some((l) => estadoDoLease(l, agora) === 'vigente') ? 'vigente' : 'expirado'
}
