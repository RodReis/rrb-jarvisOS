/**
 * Costura do Play ao ciclo produtivo do Squad. O plano e o executor são portas fornecidas pelo
 * bootstrap, enquanto este serviço governa estados, TESTE/REVIEWER e a publicação do SHA aprovado.
 */
import type { PathsPermitidos, SandboxPreparado } from '@shared/domain/preflight'
import type { PerfilDeCi } from '@shared/domain/ci-profile'
import type { SquadPlan } from '@shared/domain/squad-plano'
import type { SnapshotDoSquad } from './squad-snapshot'
import type { SquadGit } from './squad-git'
import type { PedidoDeExecucao } from '../pipeline/encadeador-de-runs'
import type { FilaService } from '../pipeline/fila-service'
import type { PipelineRepository } from '../pipeline/pipeline-repository'
import type { ResultadoDaEntrega } from '../pipeline/entrega-service'
import type {
  CicloDeRevisao,
  DependenciasDoCiclo,
  PedidoDeProducao,
  ProducaoDoTrabalho,
  ResultadoDoCiclo,
  RevisaoDoCiclo
} from './squad-ciclo'
import type { ResultadoDoSquad } from './squad-executor'
import { limitesAgregadosDoPlano } from '@shared/domain/squad-resolucao'

export interface PreparacaoDoSquad {
  readonly snapshot: SnapshotDoSquad
  readonly baseSha: string
  readonly paths: PathsPermitidos
  readonly plano: SquadPlan
  readonly perfilCi: PerfilDeCi
  readonly git: SquadGit
}

export interface DependenciasDoOrquestradorDeExecucao {
  readonly runs: Pick<
    PipelineRepository,
    'buscar' | 'workspaceDoRun' | 'registrarProgressoDoSquad' | 'registrarPlanoDoSquad'
  >
  readonly fila: Pick<FilaService, 'transicionar'>
  readonly preparar: (pedido: PedidoDeExecucao) => Promise<PreparacaoDoSquad>
  readonly ciclo: (
    pedido: PedidoDeExecucao,
    preparar: PreparacaoDoSquad,
    produzir: DependenciasDoCiclo['produzir']
  ) => { readonly ciclo: CicloDeRevisao; readonly revisao: RevisaoDoCiclo }
  readonly produzir: (
    pedido: PedidoDeExecucao,
    preparar: PreparacaoDoSquad,
    producao: PedidoDeProducao
  ) => Promise<{
    readonly producao: ProducaoDoTrabalho
    readonly resultado: ResultadoDoSquad
  }>
  readonly publicar: (
    pedido: PedidoDeExecucao,
    preparar: PreparacaoDoSquad,
    commitSha: string,
    sandbox: SandboxPreparado
  ) => Promise<ResultadoDaEntrega>
  readonly prepararSandboxDePublicacao: (
    pedido: PedidoDeExecucao,
    preparar: PreparacaoDoSquad,
    commitSha: string
  ) => { readonly sandbox?: SandboxPreparado; readonly motivo?: string }
  readonly userId: () => string
}

const resumoSeguro = (resultado: ResultadoDoSquad) =>
  resultado.tarefas.map((tarefa) => ({
    tarefaId: tarefa.tarefaId,
    papel: tarefa.papel,
    estado: tarefa.estado,
    ...(tarefa.execucao?.estado === 'concluida' && 'commitSha' in tarefa.execucao
      ? { commitSha: tarefa.execucao.commitSha }
      : {})
  }))

export class SquadOrquestradorDeExecucao {
  private readonly emVoo = new Map<
    string,
    {
      readonly controle: AbortController
      readonly terminou: Promise<void>
      readonly concluir: () => void
    }
  >()

  constructor(private readonly deps: DependenciasDoOrquestradorDeExecucao) {}

  interromper(runId: string): void {
    this.emVoo.get(runId)?.controle.abort()
  }

  /** A recuperação espera os snapshots e o finally dos escritores antes de remover recursos. */
  quandoParar(runId: string): Promise<void> | undefined {
    return this.emVoo.get(runId)?.terminou
  }

  async executar(pedido: PedidoDeExecucao): Promise<ResultadoDaEntrega | ResultadoDoCiclo> {
    const run = this.deps.runs.buscar(pedido.runId)
    if (
      run === undefined ||
      run.estado !== 'READY' ||
      this.deps.runs.workspaceDoRun(pedido.runId) !== pedido.workspaceId
    ) {
      return { estado: 'parado', motivo: 'erro-interno', detalhe: 'run-nao-pronto', tentativas: 0 }
    }
    const projectId = pedido.projectId ?? run.projectId
    const sliceId = pedido.sliceId ?? run.sliceId
    if (pedido.specPath === undefined || pedido.specText === undefined) {
      this.bloquear(
        pedido,
        'pedido-incompleto',
        'A execução do Squad exige a SPEC aprovada completa.'
      )
      return { estado: 'parado', motivo: 'erro-interno', detalhe: 'spec-ausente', tentativas: 0 }
    }

    const controle = new AbortController()
    let concluir!: () => void
    const terminou = new Promise<void>((resolve) => {
      concluir = resolve
    })
    const emVoo = { controle, terminou, concluir }
    this.emVoo.set(pedido.runId, emVoo)
    const abortar = (): void => controle.abort()
    pedido.signal?.addEventListener('abort', abortar, { once: true })
    if (pedido.signal?.aborted) abortar()
    const pedidoDoRun: PedidoDeExecucao = { ...pedido, signal: controle.signal }
    try {
      if (controle.signal.aborted) return this.cancelado()
      const preparado = await this.deps.preparar(pedidoDoRun)
      if (controle.signal.aborted) return this.cancelado()
      const atual = this.deps.runs.buscar(pedido.runId)
      if (atual !== undefined && atual.squadPlan === undefined) {
        const limites = limitesAgregadosDoPlano(
          preparado.plano,
          preparado.snapshot.resolucao,
          preparado.snapshot.perfil
        )
        const salvo = this.deps.runs.registrarPlanoDoSquad(
          { userId: atual.user_id, workspaceId: pedido.workspaceId, projectId: atual.projectId },
          pedido.runId,
          preparado.plano,
          new Date(),
          {
            limiteUsd: limites.usd,
            medido: limites.camadasMedidas.length > 0,
            limites
          }
        )
        if (!salvo) throw new Error('Não foi possível persistir o plano validado do Squad.')
      }
      const composto = this.deps.ciclo(pedidoDoRun, preparado, async (producao) => {
        const executada = await this.deps.produzir(pedidoDoRun, preparado, producao)
        this.registrarProgresso(pedido, executada.resultado)
        return executada.producao
      })
      const resultado = await composto.ciclo.executar({
        runId: pedido.runId,
        projectId,
        sliceId,
        repositorio: pedido.repositorio,
        baseSha: preparado.baseSha,
        comandos: pedido.comandosDeValidacao,
        perfilDeCi: preparado.perfilCi,
        revisao: composto.revisao,
        signal: controle.signal
      })

      if (controle.signal.aborted) return this.cancelado()
      if (resultado.estado !== 'aprovado') {
        this.bloquear(pedido, resultado.motivo, resultado.detalhe ?? resultado.motivo)
        return resultado
      }

      const sandbox = this.deps.prepararSandboxDePublicacao(
        pedidoDoRun,
        preparado,
        resultado.commitSha
      )
      if (sandbox.sandbox === undefined) {
        this.bloquear(
          pedido,
          'preflight-publicacao',
          sandbox.motivo ?? 'preflight recusou a publicação'
        )
        return {
          estado: 'parado',
          motivo: 'falha-externa',
          detalhe: sandbox.motivo,
          tentativas: resultado.tentativas
        }
      }
      if (controle.signal.aborted) return this.cancelado()
      const entregue = await this.deps.publicar(
        pedidoDoRun,
        preparado,
        resultado.commitSha,
        sandbox.sandbox
      )
      if (entregue.estadoFinal === 'BLOCKED') {
        this.bloquear(
          pedido,
          entregue.bloqueio?.causa ?? 'entrega',
          entregue.bloqueio?.mensagem ?? 'A publicação foi bloqueada.'
        )
      }
      return entregue
    } catch (erro) {
      // Exceções de providers, comandos e conteúdo do agente podem carregar resposta bruta ou
      // credenciais. O ledger/UI guardam só a classe do erro; o detalhe permanece nos logs locais.
      const tipo = erro instanceof Error ? erro.name : 'ErroDesconhecido'
      const mensagem = `Falha interna (${tipo}); consulte o log local do run.`
      this.bloquear(pedido, 'orquestrador-squad', mensagem)
      return {
        estado: 'parado',
        motivo: 'erro-interno',
        detalhe: mensagem,
        tentativas: 0
      }
    } finally {
      pedido.signal?.removeEventListener('abort', abortar)
      if (this.emVoo.get(pedido.runId) === emVoo) this.emVoo.delete(pedido.runId)
      concluir()
    }
  }

  private cancelado(): ResultadoDoCiclo {
    return { estado: 'parado', motivo: 'cancelada', tentativas: 0 }
  }

  registrarProgresso(pedido: PedidoDeExecucao, resultado: ResultadoDoSquad): void {
    const run = this.deps.runs.buscar(pedido.runId)
    if (run === undefined) return
    this.deps.runs.registrarProgressoDoSquad(
      { userId: this.deps.userId(), workspaceId: pedido.workspaceId, projectId: run.projectId },
      pedido.runId,
      resumoSeguro(resultado),
      new Date()
    )
  }

  private bloquear(pedido: PedidoDeExecucao, causa: string, evidencia: string): void {
    const atual = this.deps.runs.buscar(pedido.runId)
    if (atual === undefined || ['BLOCKED', 'CANCELLED', 'DONE'].includes(atual.estado)) return
    this.deps.fila.transicionar(atual.projectId, pedido.workspaceId, pedido.runId, 'BLOCKED', {
      causa: causa.slice(0, 120),
      evidencia: evidencia.slice(0, 500),
      tentativas: 0,
      porQueNaoSeguir: 'O ciclo não comprovou todas as etapas exigidas para publicar.',
      retomada: 'Revise a evidência do run e inicie uma nova execução após corrigir a causa.'
    })
  }
}
