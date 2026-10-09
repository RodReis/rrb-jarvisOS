import { createHash } from 'node:crypto'
import type { WorkspaceId } from '@shared/domain/entities'
import { elegivelParaExecucao, type InventarioGlobal, type NoInventario } from './inventario-global'
import type { InventarioGlobalService } from './inventario-global-service'
import type { EscopoDoInventario } from './inventario-snapshot-repository'
import { log } from '../logging/logger'

export type EstadoDoDispatcher = 'dispatched' | 'waiting' | 'blocked' | 'drained'

/** Evita varrer o GitHub na mesma cadência curta usada pela recuperação local. */
export const INTERVALO_DO_DISPATCHER_MS = 60_000

export interface DecisaoDoDispatcher {
  readonly idempotencyKey: string
  readonly dagFingerprint: string
  readonly nodeId?: string
  readonly runId?: string
  readonly estado: EstadoDoDispatcher
  readonly causa?: string
  readonly retomarEm?: string
}

export interface ContinuousDispatcherRepository {
  buscar(escopo: EscopoDoInventario, idempotencyKey: string): DecisaoDoDispatcher | undefined
  gravar(escopo: EscopoDoInventario, decisao: DecisaoDoDispatcher, agora: string): void
  cursor(escopo: EscopoDoInventario, dagFingerprint: string, agora: string): void
}

export interface ContinuousDispatcherDeps {
  readonly inventario: Pick<InventarioGlobalService, 'reconciliar'>
  readonly repository: ContinuousDispatcherRepository
  readonly sliceId: (escopo: EscopoDoInventario, no: NoInventario) => string | undefined
  readonly runs: {
    listarDaFatia(
      escopo: {
        readonly userId: string
        readonly workspaceId: WorkspaceId
        readonly projectId: string
      },
      sliceId: string
    ): readonly { readonly id: string; readonly estado: string }[]
    buscarPorChaveDispatch(
      escopo: {
        readonly userId: string
        readonly workspaceId: WorkspaceId
        readonly projectId: string
      },
      dispatchKey: string
    ): { readonly id: string; readonly estado: string } | undefined
  }
  readonly play: (
    escopo: EscopoDoInventario,
    sliceId: string,
    idempotencyKey: string
  ) => Promise<{
    readonly runId?: string
    readonly estado: 'iniciado' | 'bloqueado' | 'recusado'
    readonly mensagem: string
  }>
  readonly quotaReset?: (escopo: EscopoDoInventario, no: NoInventario) => string | undefined
  readonly podeDespachar?: (escopo: EscopoDoInventario) => boolean
  readonly agora?: () => Date
}

export interface ResultadoDaReconciliacao {
  readonly estado: EstadoDoDispatcher
  readonly decisoes: readonly DecisaoDoDispatcher[]
}

/** Orquestra uma reconciliação por vez; inventário incompleto nunca libera execução. */
export class ContinuousDispatcher {
  private readonly emReconciliacao = new Map<string, Promise<ResultadoDaReconciliacao>>()

  constructor(private readonly deps: ContinuousDispatcherDeps) {}

  reconciliar(escopo: EscopoDoInventario): Promise<ResultadoDaReconciliacao> {
    const chaveDoEscopo = `${escopo.userId}\0${escopo.workspaceId}\0${escopo.projectId}`
    const existente = this.emReconciliacao.get(chaveDoEscopo)
    if (existente !== undefined) return existente
    const ciclo = this.executarCiclo(escopo).finally(() => {
      if (this.emReconciliacao.get(chaveDoEscopo) === ciclo)
        this.emReconciliacao.delete(chaveDoEscopo)
    })
    this.emReconciliacao.set(chaveDoEscopo, ciclo)
    return ciclo
  }

  private async executarCiclo(escopo: EscopoDoInventario): Promise<ResultadoDaReconciliacao> {
    const agora = this.deps.agora ?? (() => new Date())
    const observadoEm = agora().toISOString()
    let inventario: InventarioGlobal
    try {
      inventario = await this.deps.inventario.reconciliar(escopo)
    } catch (error) {
      const motivo = error instanceof Error ? error.message : 'Falha ao reconciliar inventário.'
      const decisao: DecisaoDoDispatcher = {
        idempotencyKey: chave(escopo, 'reconciliacao', 'incompleta'),
        dagFingerprint: 'incompleto',
        estado: 'blocked',
        causa: motivo
      }
      this.deps.repository.gravar(escopo, decisao, observadoEm)
      return { estado: 'blocked', decisoes: [decisao] }
    }

    this.deps.repository.cursor(escopo, inventario.fingerprint, observadoEm)
    if (this.deps.podeDespachar?.(escopo) === false) {
      const decisao = this.gravar(
        escopo,
        inventario,
        undefined,
        'waiting',
        'Execução pausada ou desabilitada por controle operacional.',
        observadoEm
      )
      return { estado: 'waiting', decisoes: [decisao] }
    }
    if (inventario.diagnosticos.length > 0 || inventario.ordem.length === 0) {
      const decisao = this.gravar(
        escopo,
        inventario,
        undefined,
        'blocked',
        inventario.diagnosticos.map((item) => item.mensagem).join(' ') ||
          'O DAG não contém nós executáveis.',
        observadoEm
      )
      return { estado: 'blocked', decisoes: [decisao] }
    }

    const porId = new Map(inventario.nos.map((no) => [no.id, no]))
    const decisoes: DecisaoDoDispatcher[] = []
    const esperas: string[] = []
    const mapeamentosAusentes: string[] = []
    const aguardandoFila: string[] = []
    let candidatas = 0

    for (const nodeId of inventario.ordem) {
      const no = porId.get(nodeId)
      if (no === undefined || no.tipo !== 'fatia' || !elegivelParaExecucao(no, inventario)) continue
      candidatas += 1
      if (no.issue === undefined || !no.issue.aberta) {
        mapeamentosAusentes.push(`${no.id} (issue ausente/fechada)`)
        continue
      }
      const labels = no.issue.labels ?? []
      if (!labels.includes('proplan:todo')) {
        if (labels.includes('proplan:backlog') || labels.includes('proplan:next')) {
          aguardandoFila.push(no.id)
          continue
        }
        mapeamentosAusentes.push(`${no.id} (sem prioridade proplan:todo)`)
        continue
      }
      const sliceId = this.deps.sliceId(escopo, no)
      if (sliceId === undefined) {
        mapeamentosAusentes.push(no.id)
        continue
      }
      const idempotencyKey = chave(escopo, nodeId, inventario.fingerprint)
      const anterior = this.deps.repository.buscar(escopo, idempotencyKey)
      if (anterior?.estado === 'dispatched' || anterior?.estado === 'waiting') {
        if (
          anterior.estado === 'waiting' &&
          anterior.retomarEm !== undefined &&
          Date.parse(anterior.retomarEm) > agora().getTime()
        ) {
          esperas.push(anterior.retomarEm)
          continue
        }
      }
      if (anterior?.estado === 'blocked') {
        decisoes.push(anterior)
        continue
      }

      const runDoDispatch = this.deps.runs.buscarPorChaveDispatch(
        escopo,
        `${idempotencyKey}:${sliceId}`
      )
      if (runDoDispatch !== undefined && ['PLANNED', 'READY'].includes(runDoDispatch.estado)) {
        const resposta = await this.deps.play(escopo, sliceId, idempotencyKey)
        const estado: EstadoDoDispatcher = resposta.estado === 'iniciado' ? 'dispatched' : 'blocked'
        const decisao = this.gravar(
          escopo,
          inventario,
          no,
          estado,
          estado === 'blocked' ? resposta.mensagem : undefined,
          observadoEm,
          resposta.runId ?? runDoDispatch.id
        )
        decisoes.push(decisao)
        continue
      }

      const runs = this.deps.runs.listarDaFatia(escopo, sliceId)
      const ativo = runs.find(
        (run) => !['MERGED', 'AWAITING_MERGE', 'BLOCKED', 'CANCELLED'].includes(run.estado)
      )
      const mergePendenteDeReconciliação = runs.find((run) =>
        ['MERGED', 'AWAITING_MERGE'].includes(run.estado)
      )
      const terminalSemRetentativa = runs.find((run) =>
        ['BLOCKED', 'CANCELLED'].includes(run.estado)
      )
      if (ativo !== undefined || mergePendenteDeReconciliação !== undefined) {
        const estado = 'waiting'
        const causa =
          ativo !== undefined
            ? `A fatia já tem run ${ativo.id} em ${ativo.estado}.`
            : `A fatia já tem run ${mergePendenteDeReconciliação?.id} aguardando a projeção GitHub.`
        const decisao = this.gravar(
          escopo,
          inventario,
          no,
          estado,
          causa,
          observadoEm,
          ativo?.id ?? mergePendenteDeReconciliação?.id
        )
        decisoes.push(decisao)
        esperas.push(observadoEm)
        continue
      }
      if (terminalSemRetentativa !== undefined) {
        const decisao = this.gravar(
          escopo,
          inventario,
          no,
          'blocked',
          `O run ${terminalSemRetentativa.id} terminou em ${terminalSemRetentativa.estado}; a SPEC não autoriza repetição automática.`,
          observadoEm,
          terminalSemRetentativa.id
        )
        decisoes.push(decisao)
        continue
      }

      const reset = this.deps.quotaReset?.(escopo, no)
      if (
        reset !== undefined &&
        Number.isFinite(Date.parse(reset)) &&
        Date.parse(reset) > agora().getTime()
      ) {
        const decisao = this.gravar(
          escopo,
          inventario,
          no,
          'waiting',
          'Quota da rota de execução esgotada.',
          observadoEm,
          undefined,
          reset
        )
        decisoes.push(decisao)
        esperas.push(reset)
        continue
      }

      this.gravar(
        escopo,
        inventario,
        no,
        'waiting',
        'Despacho registrado; aguardando confirmação do run idempotente.',
        observadoEm
      )
      const resposta = await this.deps.play(escopo, sliceId, idempotencyKey)
      const estado: EstadoDoDispatcher = resposta.estado === 'iniciado' ? 'dispatched' : 'blocked'
      const decisao = this.gravar(
        escopo,
        inventario,
        no,
        estado,
        estado === 'blocked' ? resposta.mensagem : undefined,
        observadoEm,
        resposta.runId
      )
      decisoes.push(decisao)
      if (resposta.estado === 'iniciado') continue
    }

    // Registrar cada gate pendente individualmente mesmo quando outro ramo pode avançar.
    // Sem esta decisão por nó, o resultado global "dispatched" escondia o bloqueio local.
    for (const nodeId of inventario.ordem) {
      const no = porId.get(nodeId)
      if (
        no === undefined ||
        no.tipo !== 'fatia' ||
        no.estadoTecnico !== 'pendente' ||
        no.gateAprovado ||
        decisoes.some((decisao) => decisao.nodeId === no.id)
      )
        continue
      const decisao = this.gravar(
        escopo,
        inventario,
        no,
        'blocked',
        `${no.id} aguarda gate aprovado pelo PI; somente este ramo permanece bloqueado.`,
        observadoEm
      )
      decisoes.push(decisao)
    }

    if (decisoes.some((decisao) => decisao.estado === 'dispatched'))
      return { estado: 'dispatched', decisoes }
    if (esperas.length > 0) return { estado: 'waiting', decisoes }
    if (aguardandoFila.length > 0) {
      const decisao = this.gravar(
        escopo,
        inventario,
        undefined,
        'waiting',
        `Aguardando promoção para proplan:todo pelo responsável: ${aguardandoFila.join(', ')}.`,
        observadoEm
      )
      decisoes.push(decisao)
      return { estado: 'waiting', decisoes }
    }
    const emAndamento = inventario.nos.find(
      (no) => no.tipo === 'fatia' && no.estadoTecnico === 'em-andamento'
    )
    if (emAndamento !== undefined) {
      const decisao = this.gravar(
        escopo,
        inventario,
        emAndamento,
        'waiting',
        `${emAndamento.id} já está em andamento na projeção reconciliada.`,
        observadoEm
      )
      decisoes.push(decisao)
      return { estado: 'waiting', decisoes }
    }
    if (mapeamentosAusentes.length > 0) {
      const decisao = this.gravar(
        escopo,
        inventario,
        undefined,
        'blocked',
        `IDs do roadmap não encontrados para: ${mapeamentosAusentes.join(', ')}.`,
        observadoEm
      )
      decisoes.push(decisao)
      return { estado: 'blocked', decisoes }
    }
    if (candidatas === 0) {
      const bloqueada = inventario.nos.find(
        (no) =>
          no.tipo === 'fatia' &&
          (no.bloqueado ||
            no.estadoTecnico === 'bloqueado' ||
            no.estadoTecnico === 'desconhecido' ||
            no.spec.estado !== 'aprovada' ||
            !no.gateAprovado)
      )
      const bloqueadas = bloqueada !== undefined
      const decisao = this.gravar(
        escopo,
        inventario,
        undefined,
        bloqueadas ? 'blocked' : 'drained',
        bloqueadas
          ? `${bloqueada.id} aguarda SPEC aprovada, gate válido ou remoção de bloqueio.`
          : undefined,
        observadoEm
      )
      decisoes.push(decisao)
      return { estado: decisao.estado, decisoes }
    }
    return { estado: 'blocked', decisoes }
  }

  /** Evento apenas acorda o ciclo; a decisão sempre vem de uma nova leitura das fontes. */
  sinalizar(escopo: EscopoDoInventario): void {
    queueMicrotask(() => {
      void this.reconciliar(escopo).catch((error: unknown) => {
        log.agent.warn('O dispatcher não concluiu a reconciliação sinalizada', {
          projectId: escopo.projectId,
          motivo: error instanceof Error ? error.message : 'desconhecido'
        })
      })
    })
  }

  private gravar(
    escopo: EscopoDoInventario,
    inventario: InventarioGlobal,
    no: NoInventario | undefined,
    estado: EstadoDoDispatcher,
    causa: string | undefined,
    agora: string,
    runId?: string,
    retomarEm?: string
  ): DecisaoDoDispatcher {
    const nodeId = no?.id
    const decisao: DecisaoDoDispatcher = {
      idempotencyKey: chave(escopo, nodeId ?? estado, inventario.fingerprint),
      dagFingerprint: inventario.fingerprint,
      ...(nodeId === undefined ? {} : { nodeId }),
      ...(runId === undefined ? {} : { runId }),
      estado,
      ...(causa === undefined ? {} : { causa }),
      ...(retomarEm === undefined ? {} : { retomarEm })
    }
    this.deps.repository.gravar(escopo, decisao, agora)
    return decisao
  }
}

function chave(escopo: EscopoDoInventario, nodeId: string, fingerprint: string): string {
  return createHash('sha256')
    .update(
      `${escopo.userId}\0${escopo.workspaceId}\0${escopo.projectId}\0${nodeId}\0${fingerprint}`
    )
    .digest('hex')
}
