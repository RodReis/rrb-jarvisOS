/**
 * O executor do plano do Squad (SPEC-Squads-03): leva um `SquadPlan` já **validado** do grafo de
 * tarefas ao fim, despachando cada uma ao executor do seu papel.
 *
 *  - **O grafo manda**: uma tarefa só começa com todas as dependências `concluida`. A que depende
 *    de uma tarefa que não concluiu **não roda** — termina `cancelada`, com o motivo — e a
 *    propagação é transitiva. Os ramos independentes seguem.
 *  - **Workers até um teto, escritores até o pool**: os workers somente leitura rodam em paralelo
 *    (limite próprio do Squad: a SPEC-Scheduler-01 os deixou fora do pool). Os escritores são
 *    todos despachados, e quem os contém é o **pool** — um slot por escritor, regra 5.
 *  - **O contexto é montado aqui, pelo kernel**, a partir das `entradas` do plano; o que não monta
 *    recusa a tarefa (`recusada`, com a razão), e nada roda sem contexto autorizado.
 *  - **As tarefas de um mesmo escritor rodam em sequência**, cada uma a partir do commit da
 *    anterior que concluiu: um escritor tem um slot, e duas tarefas dele ao mesmo tempo disputariam
 *    o mesmo ambiente. O que a primeira commitou é o ponto de partida da segunda.
 *  - **Uma tentativa por tarefa.** A repetição — dentro do limite da M9-F04 — é de quem decide o
 *    retrabalho (F04, MVP-028): este executor roda o plano uma vez e devolve o que cada tarefa foi.
 *
 * Todo desfecho é um estado terminal **auditado**: os executores de worker e de escritor auditam o
 * que rodaram; este arquivo audita o que **nem chegou a rodar** (dependência, contexto).
 */

import type { AiProvider } from '@shared/domain/ai'
import type { WorkspaceId } from '@shared/domain/entities'
import type { ModeloEscolhido } from '@shared/domain/modelo-da-fase'
import { escritoresColidemPorNome, type EstadoDaTarefa } from '@shared/domain/squad-execucao'
import { PAPEIS_QUE_ESCREVEM, type SquadPlan, type TarefaDoPlano } from '@shared/domain/squad-plano'
import type { AuditRepository } from '../storage/audit-repository'
import type { ContextoDaTarefa, BuscaDaTarefa } from './squad-contexto'
import type { ExecutorDeEscritor, ResultadoDoEscritor } from './squad-escritor'
import type { ExecutorDeWorker, ResultadoDoWorker } from './squad-worker'

/** Quantos workers somente leitura rodam ao mesmo tempo. Escritores são limitados pelo pool. */
export const MAX_WORKERS_EM_PARALELO = 4

type EstadoTerminal = Exclude<EstadoDaTarefa, 'pendente' | 'em-execucao'>

/** O que cada tarefa foi, qualquer que tenha sido o executor — ou a razão de nem ter rodado. */
export interface ResultadoDaTarefaDoSquad {
  readonly tarefaId: string
  readonly papel: TarefaDoPlano['papel']
  readonly estado: EstadoTerminal
  readonly motivo?: string
  /** O resultado do executor, quando a tarefa chegou a rodar. */
  readonly execucao?: ResultadoDoWorker | ResultadoDoEscritor
}

export type EstadoDoSquad = 'concluido' | 'parcial' | 'cancelado'

export interface ResultadoDoSquad {
  readonly estado: EstadoDoSquad
  /** Uma entrada por tarefa do plano, na ordem dele. */
  readonly tarefas: readonly ResultadoDaTarefaDoSquad[]
}

export interface PedidoDoSquad {
  readonly runId: string
  readonly projectId: string
  readonly workspaceId: WorkspaceId
  readonly sliceId: string
  readonly repositorio: string
  /** O SHA de onde o contexto e os worktrees saem: o mesmo para todas as tarefas do plano. */
  readonly baseSha: string
  readonly rota: AiProvider
  readonly plano: SquadPlan
  /** O que a tarefa precisa fazer, em texto do kernel (nunca texto de agente). */
  readonly objetivoDe: (tarefa: TarefaDoPlano) => string
  /** O modelo da camada da tarefa, do snapshot do Squad. `numCtx` é obrigatório para o local. */
  readonly modeloDe: (tarefa: TarefaDoPlano) => { modelo: ModeloEscolhido; numCtx?: number }
  readonly buscasDe?: (tarefa: TarefaDoPlano) => readonly BuscaDaTarefa[]
  readonly regras?: readonly string[]
  /** A tentativa de cada tarefa (a partir de 1). Ausente = 1. */
  readonly tentativas?: ReadonlyMap<string, number>
  readonly signal?: AbortSignal
}

export interface DependenciasDoExecutorDoSquad {
  readonly contexto: Pick<ContextoDaTarefa, 'montar'>
  readonly worker: Pick<ExecutorDeWorker, 'executar'>
  readonly escritor: Pick<ExecutorDeEscritor, 'executar'>
  readonly audit: AuditRepository
  readonly userId: () => string
  readonly workspaceId: () => WorkspaceId
  /** O teto de workers em paralelo. Inválido (zero, negativo, NaN) cai no padrão. */
  readonly maxWorkers?: number
}

export class ExecutorDoSquad {
  private readonly maxWorkers: number

  constructor(private readonly deps: DependenciasDoExecutorDoSquad) {
    const pedido = deps.maxWorkers
    this.maxWorkers =
      pedido !== undefined && Number.isInteger(pedido) && pedido > 0
        ? pedido
        : MAX_WORKERS_EM_PARALELO
  }

  async executar(pedido: PedidoDoSquad): Promise<ResultadoDoSquad> {
    const resultados = new Map<string, ResultadoDaTarefaDoSquad>()
    const emAndamento = new Map<string, Promise<void>>()
    let workersRodando = 0
    // Um escritor por vez, e cada tarefa dele parte do commit da anterior que concluiu.
    const escritoresOcupados = new Set<string>()
    const baseDoEscritor = new Map<string, string>()

    const terminar = (
      t: TarefaDoPlano,
      r: Omit<ResultadoDaTarefaDoSquad, 'tarefaId' | 'papel'>
    ): void => {
      resultados.set(t.id, { tarefaId: t.id, papel: t.papel, ...r })
    }
    let falha: unknown
    try {
      this.recusarNomesQueColidem(pedido, terminar)

      for (;;) {
        this.cancelarOQueNaoPodeRodar(pedido, resultados, terminar)

        for (const tarefa of pedido.plano.tarefas) {
          if (resultados.has(tarefa.id) || emAndamento.has(tarefa.id)) continue
          if (!this.dependenciasConcluidas(tarefa, resultados)) continue
          const escreve = PAPEIS_QUE_ESCREVEM.includes(tarefa.papel)
          const escritor = tarefa.escritor as string
          if (!escreve && workersRodando >= this.maxWorkers) continue
          if (escreve && escritoresOcupados.has(escritor)) continue

          if (escreve) escritoresOcupados.add(escritor)
          else workersRodando += 1
          const base = escreve ? (baseDoEscritor.get(escritor) ?? pedido.baseSha) : pedido.baseSha
          const rodando = this.rodar(pedido, tarefa, base)
            .then((r) => {
              terminar(tarefa, r)
              const commit = (r.execucao as ResultadoDoEscritor | undefined)?.commitSha
              if (escreve && r.estado === 'concluida' && commit !== undefined) {
                baseDoEscritor.set(escritor, commit)
              }
            })
            .finally(() => {
              emAndamento.delete(tarefa.id)
              if (escreve) escritoresOcupados.delete(escritor)
              else workersRodando -= 1
            })
          emAndamento.set(tarefa.id, rodando)
        }

        if (emAndamento.size === 0) break
        await Promise.race(emAndamento.values())
      }

      // O que sobrou sem rodar e sem motivo já registrado: dependência que não existe, ou ciclo.
      for (const tarefa of pedido.plano.tarefas) {
        if (!resultados.has(tarefa.id)) {
          this.registrar(pedido, tarefa, 'cancelada', 'dependencias-nao-resolvidas')
          terminar(tarefa, { estado: 'cancelada', motivo: 'dependencias-nao-resolvidas' })
        }
      }
    } catch (erro) {
      falha = erro
    }

    // Quem já rodava (um escritor com slot, por exemplo) termina antes de o plano devolver: o
    // executor nunca rejeita e nunca larga uma tarefa viva para trás.
    await Promise.allSettled(emAndamento.values())
    if (falha !== undefined) {
      const motivo = `erro inesperado: ${falha instanceof Error ? falha.name : 'desconhecido'}`
      for (const tarefa of pedido.plano.tarefas) {
        if (resultados.has(tarefa.id)) continue
        try {
          this.registrar(pedido, tarefa, 'falhou', motivo)
        } catch {
          // a auditoria pode ser a própria causa: a tarefa ainda recebe o estado terminal
        }
        terminar(tarefa, { estado: 'falhou', motivo })
      }
    }

    const tarefas = pedido.plano.tarefas.map(
      (t) => resultados.get(t.id) as ResultadoDaTarefaDoSquad
    )
    return { estado: estadoDoSquad(pedido, tarefas), tarefas }
  }

  /**
   * Duas tarefas de escrita cujo `escritor-tarefa`, depois de sanitizado, dá o mesmo nome (`a_b` e
   * `a-b`) reusariam o container e a branch uma da outra: a segunda não roda.
   */
  private recusarNomesQueColidem(
    pedido: PedidoDoSquad,
    terminar: (t: TarefaDoPlano, r: Omit<ResultadoDaTarefaDoSquad, 'tarefaId' | 'papel'>) => void
  ): void {
    const escrevem = pedido.plano.tarefas.filter((t) => PAPEIS_QUE_ESCREVEM.includes(t.papel))
    const nomeDe = (t: TarefaDoPlano): string => `${t.escritor as string}-${t.id}`
    for (const [, repetido] of escritoresColidemPorNome(escrevem.map(nomeDe))) {
      const tarefa = escrevem.find((t) => nomeDe(t) === repetido)
      if (tarefa === undefined) continue
      this.registrar(pedido, tarefa, 'recusada', 'nome-colide')
      terminar(tarefa, { estado: 'recusada', motivo: 'nome-colide' })
    }
  }

  private dependenciasConcluidas(
    tarefa: TarefaDoPlano,
    resultados: ReadonlyMap<string, ResultadoDaTarefaDoSquad>
  ): boolean {
    return tarefa.dependencias.every((d) => resultados.get(d)?.estado === 'concluida')
  }

  /** Tarefa cuja dependência terminou sem concluir não roda: cancelada, e a propagação é transitiva. */
  private cancelarOQueNaoPodeRodar(
    pedido: PedidoDoSquad,
    resultados: Map<string, ResultadoDaTarefaDoSquad>,
    terminar: (t: TarefaDoPlano, r: Omit<ResultadoDaTarefaDoSquad, 'tarefaId' | 'papel'>) => void
  ): void {
    let mudou = true
    while (mudou) {
      mudou = false
      for (const tarefa of pedido.plano.tarefas) {
        if (resultados.has(tarefa.id)) continue
        const falhou = tarefa.dependencias.find((d) => {
          const estado = resultados.get(d)?.estado
          return estado !== undefined && estado !== 'concluida'
        })
        if (falhou === undefined) continue
        const motivo = `dependencia-nao-concluida:${falhou}`
        this.registrar(pedido, tarefa, 'cancelada', motivo)
        terminar(tarefa, { estado: 'cancelada', motivo })
        mudou = true
      }
    }
  }

  /** Monta o contexto e despacha ao executor do papel. Nunca lança. */
  private async rodar(
    pedido: PedidoDoSquad,
    tarefa: TarefaDoPlano,
    revisao: string
  ): Promise<Omit<ResultadoDaTarefaDoSquad, 'tarefaId' | 'papel'>> {
    try {
      const contexto = this.deps.contexto.montar({
        projectId: pedido.projectId,
        workspaceId: pedido.workspaceId,
        repositorio: pedido.repositorio,
        revisao,
        runId: pedido.runId,
        tarefa: { id: tarefa.id, entradas: tarefa.entradas },
        rota: pedido.rota,
        ...(pedido.buscasDe === undefined ? {} : { buscas: pedido.buscasDe(tarefa) }),
        ...(pedido.regras === undefined ? {} : { regras: pedido.regras })
      })
      if (!contexto.ok) {
        const motivo = `contexto-${contexto.razao}`
        this.registrar(pedido, tarefa, 'recusada', motivo)
        return { estado: 'recusada', motivo }
      }

      const { modelo, numCtx } = pedido.modeloDe(tarefa)
      const tentativa = pedido.tentativas?.get(tarefa.id) ?? 1
      const base = {
        runId: pedido.runId,
        tarefa,
        objetivo: pedido.objetivoDe(tarefa),
        contexto: { pack: contexto.pack, fontes: contexto.fontes },
        modelo,
        tentativa,
        ...(pedido.signal === undefined ? {} : { signal: pedido.signal })
      }

      if (PAPEIS_QUE_ESCREVEM.includes(tarefa.papel)) {
        const execucao = await this.deps.escritor.executar({
          ...base,
          projectId: pedido.projectId,
          workspaceId: pedido.workspaceId,
          sliceId: pedido.sliceId,
          escritor: tarefa.escritor as string,
          repositorio: pedido.repositorio,
          baseSha: revisao
        })
        return {
          estado: execucao.estado,
          ...(execucao.motivo === undefined ? {} : { motivo: execucao.motivo }),
          execucao
        }
      }

      const execucao = await this.deps.worker.executar({
        ...base,
        ...(numCtx === undefined ? {} : { numCtx })
      })
      return {
        estado: execucao.estado,
        ...(execucao.motivo === undefined ? {} : { motivo: execucao.motivo }),
        execucao
      }
    } catch (erro) {
      // Os executores não lançam; o que escapou até aqui é falha, e falha tem estado.
      const motivo = `erro inesperado: ${erro instanceof Error ? erro.name : 'desconhecido'}`
      this.registrar(pedido, tarefa, 'falhou', motivo)
      return { estado: 'falhou', motivo }
    }
  }

  /** Audita o fim de uma tarefa que **não rodou** (os executores auditam as que rodaram). */
  private registrar(
    pedido: PedidoDoSquad,
    tarefa: TarefaDoPlano,
    estado: EstadoTerminal,
    motivo: string
  ): void {
    this.deps.audit.append({
      user_id: this.deps.userId(),
      workspace_id: this.deps.workspaceId(),
      type: 'squad-tarefa',
      payload: {
        marco: 'fim',
        runId: pedido.runId,
        tarefaId: tarefa.id,
        papel: tarefa.papel,
        capacidade: tarefa.capacidade,
        camada: tarefa.camada,
        tentativa: pedido.tentativas?.get(tarefa.id) ?? 1,
        baseSha: pedido.baseSha,
        schemaDeResultado: tarefa.schemaDeResultado,
        estado,
        motivo
      }
    })
  }
}

function estadoDoSquad(
  pedido: PedidoDoSquad,
  tarefas: readonly ResultadoDaTarefaDoSquad[]
): EstadoDoSquad {
  // Tudo entregue é entregue: o sinal que chega no último instante não desfaz o trabalho.
  if (tarefas.every((t) => t.estado === 'concluida')) return 'concluido'
  return pedido.signal?.aborted === true ? 'cancelado' : 'parcial'
}
