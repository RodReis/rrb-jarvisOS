import { randomUUID } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'
import type { WorkspaceId } from '@shared/domain/entities'
import { validarPerfilDeCi } from '@shared/domain/ci-profile'
import { IMAGEM_DO_SQUAD } from '../squads/squad-imagem'
import {
  auditarSnapshotDoSquad,
  type SnapshotDoSquad
} from '../squads/squad-snapshot'
import type { ContextService } from '../context/context-service'
import type { PhaseModelService } from '../ai/phase-model-service'
import type { PathsPermitidos } from '@shared/domain/preflight'
import { chaveDeProjeto } from '@shared/domain/publicacao'
import type { ConnectorRequest } from '@shared/domain/connectors'
import { CONNECTOR_CONTRACT_VERSION } from '@shared/domain/connectors'
import {
  GITHUB_OPERATIONS,
  type CheckNormalizado,
  type IssueStateNormalizado,
  type MergeStateNormalizado
} from '@shared/domain/github-automation'
import type {
  ConsultaDeChecks,
  PedidoDePlay,
  QuadroDeExecucao,
  ResultadoDoPlay
} from '@shared/domain/quadro-execucao'
import { projetarQuadro } from '@shared/domain/quadro-execucao'
import { chaveDeFatia } from '@shared/domain/publicacao'
import type { RoadmapRepository } from '../projects/roadmap-repository'
import type { RoadmapService } from '../projects/roadmap-service'
import { lerPerfilDeCiVersionado } from '../projects/ci-profile-revision'
import type { ExternalRefRepository } from '../projects/external-ref-repository'
import type { ProjectRepository } from '../projects/project-repository'
import type { ConnectorService } from '../connectors/connector-service'
import type { PedidoDeExecucao } from './encadeador-de-runs'
import type { FilaService } from './fila-service'
import type { PipelineRepository } from './pipeline-repository'
import type { RunPrRepository } from './run-pr-repository'
import { log } from '../logging/logger'

export interface QuadroExecucaoDeps {
  readonly userId: () => string
  readonly roadmap: RoadmapRepository
  readonly roadmapService: RoadmapService
  readonly refs: ExternalRefRepository
  readonly projects: ProjectRepository
  readonly contexts: ContextService
  readonly phaseModels: PhaseModelService
  readonly raizOperacional: () => string
  readonly runs: PipelineRepository
  readonly fila: FilaService
  readonly runPrs: RunPrRepository
  readonly connectors: ConnectorService
  readonly audit?: import('../storage/audit-repository').AuditRepository
  readonly criarSnapshotDoSquad?: (modelo: { provider: string; modelo: string }) => SnapshotDoSquad
  /** Só é fornecido quando o caminho de produção do Squad estiver composto. */
  readonly executar?: (pedido: PedidoDeExecucao) => Promise<unknown>
  readonly agora?: () => number
}

function pathsAutorizadosDaSpec(texto: string): PathsPermitidos | undefined {
  const secao = texto.match(/^## Paths permitidos\s*\r?\n([\s\S]*?)(?=^##?\s|\s*$)/im)?.[1]
  if (secao === undefined) return undefined
  const paths = [...secao.matchAll(/^\s*[-*]\s+`([^`]+)`/gm)].map(([, caminho]) => caminho.trim())
  if (paths.length === 0) return undefined
  return { origem: 'spec', paths, justificativa: 'Seção Paths permitidos da SPEC aprovada.' }
}

/** Projeção do estado persistido da fila e consultas reais ao GitHub no processo principal. */
export class QuadroExecucaoService {
  private readonly desconhecidasDesde = new Map<string, string>()
  private readonly agora: () => number

  constructor(private readonly deps: QuadroExecucaoDeps) {
    this.agora = deps.agora ?? Date.now
  }

  async vista(projectId: string, workspaceId: WorkspaceId): Promise<QuadroDeExecucao> {
    const userId = this.deps.userId()
    const escopo = { userId, workspaceId, projectId }
    const projeto = this.deps.projects.findById(userId, projectId)
    if (projeto === undefined || projeto.workspace_id !== workspaceId) {
      return projetarQuadro({
        projectId,
        mvps: [],
        slices: [],
        runs: [],
        concluidas: [],
        bloqueadas: [],
        agora: new Date(this.agora()).toISOString()
      })
    }

    const roadmap = this.deps.roadmap.carregar(escopo)
    const fila = this.deps.fila.vista(projectId, workspaceId)
    const refs = this.deps.refs.listar(escopo)
    const refsPorFatia = new Map(
      roadmap.slices.flatMap((slice) => {
        const mvp = roadmap.mvps.find((item) => item.id === slice.mvpId)
        if (mvp === undefined) return []
        const ref = refs.find(
          (item) =>
            item.alvo === 'issue' &&
            item.chaveExterna === chaveDeFatia(projectId, mvp.numero, slice.numero)
        )
        const numero = ref === undefined ? NaN : Number(ref.refId)
        return Number.isSafeInteger(numero) && numero > 0
          ? [[slice.id, { numero, ...(ref?.url === undefined ? {} : { url: ref.url }) }]]
          : []
      })
    )
    const repositorio = refs
      .find(
        (item) => item.alvo === 'repositorio' && item.chaveExterna === chaveDeProjeto(projectId)
      )
      ?.refId.split('/')

    const todosOsRuns = roadmap.slices.flatMap((slice) =>
      this.deps.runs.listarDaFatia(escopo, slice.id)
    )
    const consultas = new Map<string, ConsultaDeChecks>()
    await Promise.all(
      todosOsRuns
        .filter((run) => run.estado === 'PR_CI' || run.estado === 'AWAITING_MERGE')
        .map(async (run) => {
          consultas.set(run.id, await this.consultarChecks(userId, workspaceId, run.id))
        })
    )
    const finalizadas = new Set<string>()
    if (repositorio?.length === 2) {
      await Promise.all(
        roadmap.slices
          .filter((slice) => fila.concluidas.includes(slice.id))
          .map(async (slice) => {
            const issue = refsPorFatia.get(slice.id)
            if (issue === undefined) return
            const resposta = await this.chamarGithub(
              userId,
              workspaceId,
              GITHUB_OPERATIONS.getIssueState,
              {
                owner: repositorio[0],
                repo: repositorio[1],
                issue: issue.numero
              }
            )
            if (!resposta.ok) return
            const estado = resposta.data as IssueStateNormalizado
            if (estado.numero === issue.numero && estado.estado === 'closed' && estado.finalizado) {
              finalizadas.add(slice.id)
            }
          })
      )
    }

    return projetarQuadro({
      projectId,
      mvps: roadmap.mvps,
      slices: roadmap.slices,
      runs: todosOsRuns,
      concluidas: fila.concluidas,
      bloqueadas: fila.bloqueadas,
      issues: refsPorFatia,
      consultas,
      finalizadas,
      agora: new Date(this.agora()).toISOString()
    })
  }

  async play(pedido: PedidoDePlay, workspaceId: WorkspaceId): Promise<readonly ResultadoDoPlay[]> {
    if (
      typeof pedido.projectId !== 'string' ||
      pedido.projectId === '' ||
      !Array.isArray(pedido.sliceIds) ||
      pedido.sliceIds.length === 0 ||
      pedido.sliceIds.some((id) => typeof id !== 'string' || id === '') ||
      new Set(pedido.sliceIds).size !== pedido.sliceIds.length
    ) {
      return []
    }

    const userId = this.deps.userId()
    const escopo = { userId, workspaceId, projectId: pedido.projectId }
    const projeto = this.deps.projects.findById(userId, pedido.projectId)
    if (projeto === undefined || projeto.workspace_id !== workspaceId) {
      return pedido.sliceIds.map((sliceId) => ({
        sliceId,
        estado: 'recusado',
        mensagem: 'O projeto não existe neste espaço.'
      }))
    }
    const executar = this.deps.executar
    if (executar === undefined) {
      return pedido.sliceIds.map((sliceId) => ({
        sliceId,
        estado: 'recusado',
        mensagem: 'O Squad ainda não está ligado ao fluxo de execução do aplicativo.'
      }))
    }

    const roadmap = this.deps.roadmap.carregar(escopo)
    const selecionadas = pedido.sliceIds.map((sliceId) => ({
      sliceId,
      slice: roadmap.slices.find((item) => item.id === sliceId)
    }))
    const mvpIds = new Set(
      selecionadas.flatMap(({ slice }) => (slice === undefined ? [] : [slice.mvpId]))
    )
    if (mvpIds.size !== 1 || selecionadas.some(({ slice }) => slice === undefined)) {
      return pedido.sliceIds.map((sliceId) => ({
        sliceId,
        estado: 'recusado',
        mensagem: 'Selecione fatias existentes de um único MVP.'
      }))
    }
    const mvp = roadmap.mvps.find((item) => item.id === [...mvpIds][0])
    if (mvp?.estado !== 'na-fila') {
      return pedido.sliceIds.map((sliceId) => ({
        sliceId,
        estado: 'recusado',
        mensagem: 'O MVP ainda não foi liberado para execução.'
      }))
    }
    const refs = this.deps.refs.listar(escopo)
    const repoRef = refs.find(
      (item) =>
        item.alvo === 'repositorio' && item.chaveExterna === chaveDeProjeto(pedido.projectId)
    )
    const branchRef = refs.find(
      (item) => item.alvo === 'branch' && item.chaveExterna === chaveDeProjeto(pedido.projectId)
    )
    const repoParts = repoRef?.refId.split('/')
    if (repoParts?.length !== 2 || branchRef?.refId === undefined) {
      return pedido.sliceIds.map((sliceId) => ({
        sliceId,
        estado: 'recusado',
        mensagem: 'Repositório ou branch base não publicados para este projeto.'
      }))
    }
    const resultados: ResultadoDoPlay[] = []
    for (const { sliceId, slice } of selecionadas) {
      if (slice === undefined || !slice.detalhada) {
        resultados.push({
          sliceId,
          estado: 'recusado',
          mensagem: 'A fatia não tem SPEC executável.'
        })
        continue
      }
      const issueRef = this.deps.refs.buscar(
        escopo,
        'issue',
        chaveDeFatia(pedido.projectId, mvp.numero, slice.numero)
      )
      const issue = issueRef === undefined ? NaN : Number(issueRef.refId)
      if (!Number.isSafeInteger(issue) || issue <= 0) {
        resultados.push({ sliceId, estado: 'recusado', mensagem: 'A issue não está publicada.' })
        continue
      }
      let runId: string | undefined
      try {
        const fatia = slice
        const raizReal = realpathSync(projeto.diretorio)
        const caminhoDaSpec = realpathSync(resolve(raizReal, fatia.specSlug))
        const relativoDaSpec = relative(raizReal, caminhoDaSpec)
        if (isAbsolute(relativoDaSpec) || relativoDaSpec.startsWith('..')) {
          throw new Error('O caminho da SPEC excede o diretório do projeto.')
        }
        const textoDaSpec = readFileSync(caminhoDaSpec, 'utf8')
        const perfil = lerPerfilDeCiVersionado(projeto.diretorio)
        if (perfil === undefined) throw new Error('O pacote não contém um perfil de CI válido.')
        const problemasDoPerfil = validarPerfilDeCi(perfil.perfil)
        if (problemasDoPerfil.length > 0) throw new Error('O perfil de CI aprovado é inválido.')
        const aprovacoes = this.deps.roadmap.listarAprovacoes(escopo)
        const revisoesAtuais = this.deps.roadmapService.revisoesDoGate(
          pedido.projectId,
          'SLICE_ENTRY',
          workspaceId
        )
        const specAprovada = aprovacoes.some(
          (aprovacao) =>
            aprovacao.gate === 'SLICE_ENTRY' &&
            revisoesAtuais.length > 0 &&
            aprovacao.revisoes.length === revisoesAtuais.length &&
            revisoesAtuais.every((atual) =>
              aprovacao.revisoes.some(
                (revisao) => revisao.artefato === atual.artefato && revisao.hash === atual.hash
              )
            )
        )
        if (!specAprovada) throw new Error('A revisão atual da SPEC não está aprovada.')

        if (
          !revisoesAtuais.some(
            (item) => item.artefato === 'ci-profile.json' && item.hash === perfil.hash
          )
        )
          throw new Error('O perfil de CI atual não consta da revisão aprovada.')
        const modelo = this.deps.phaseModels.resolver(
          { userId, workspace: workspaceId },
          'construcao',
          'assinatura',
          pedido.projectId
        )
        if (modelo.provider !== 'claude-code')
          throw new Error('A rota de construção não corresponde ao executor configurado.')
        const criarSnapshot = this.deps.criarSnapshotDoSquad
        if (criarSnapshot === undefined)
          throw new Error('O snapshot de produção do Squad não está configurado.')
        const snapshotSquad = criarSnapshot(modelo)
        if (!snapshotSquad.resolucao.elegivel)
          throw new Error('O perfil do Squad não é elegível para esta rota.')
        const caminhos = pathsAutorizadosDaSpec(textoDaSpec)
        if (caminhos === undefined)
          throw new Error(
            'A SPEC aprovada não declara Paths permitidos; o preflight recusa execução sem esse escopo.'
          )
        const run = this.deps.fila.criarRun(pedido.projectId, workspaceId, sliceId)
        runId = run.id
        const contexto = this.deps.contexts.montarDaTarefa(
          {
            projectId: pedido.projectId,
            tarefa: `MVP-${mvp.numero} F${fatia.numero} ${fatia.titulo} (${runId})`,
            etapa: 'squad-tarefa',
            fontes: [
              {
                caminho: relativoDaSpec,
                texto: textoDaSpec,
                origem: 'explicito',
                motivo: 'SPEC aprovada da fatia selecionada para execução.'
              }
            ],
            rota: 'claude-code'
          },
          workspaceId
        )
        if (contexto.pack === undefined) throw new Error(contexto.mensagem)
        const registrado = this.deps.runs.registrarSnapshotDoSquad(
          escopo,
          run.id,
          snapshotSquad,
          new Date(this.agora())
        )
        if (!registrado) throw new Error('Não foi possível persistir o snapshot do Squad antes do Play.')
        auditarSnapshotDoSquad(
          this.deps.audit ?? (() => { throw new Error('A auditoria do Squad não está configurada.') })(),
          { userId, workspaceId },
          snapshotSquad
        )
        const execucao: PedidoDeExecucao = {
          runId: run.id,
          workspaceId,
          raizOperacional: this.deps.raizOperacional(),
          repositorio: projeto.diretorio,
          base: branchRef.refId,
          pathsDaSpec: caminhos,
          alvo: { owner: repoParts[0], repo: repoParts[1], branchBase: branchRef.refId },
          issue,
          titulo: fatia.titulo,
          promptInicial: textoDaSpec,
          contextPackId: contexto.pack.id,
          // O Squad executa as validações dinâmicas do PerfilDeCi no SuiteNoSandbox.
          // Este campo é apenas legado do EncadeadorDeRuns e não deve condensar Python em quatro
          // comandos fixos nem sugerir equivalência com o workflow aprovado.
          comandosDeValidacao: { test: [], lint: [], typecheck: [], build: [] },
          perfilDeCi: perfil.perfil,
          imagemDoSandbox: IMAGEM_DO_SQUAD
        }
        const aguardando = this.deps.fila.transicionar(
          pedido.projectId,
          workspaceId,
          run.id,
          'AWAITING_PI'
        )
        if (aguardando.reason !== 'transicionado') throw new Error(aguardando.mensagem)
        const pronto = this.deps.fila.transicionar(pedido.projectId, workspaceId, run.id, 'READY')
        if (pronto.reason !== 'transicionado') {
          const atual = this.deps.runs.buscar(run.id)
          throw new Error(atual?.bloqueio?.evidencia ?? pronto.mensagem)
        }
        void executar(execucao).catch((erro: unknown) => {
          log.agent.error('A execução do run falhou fora do fluxo esperado', {
            runId: run.id,
            motivo: erro instanceof Error ? erro.message : 'desconhecido'
          })
        })
        resultados.push({
          sliceId,
          runId: run.id,
          estado: 'iniciado',
          mensagem: 'Run enfileirado; a fila governa a aquisição do slot.'
        })
      } catch (erro) {
        const detalhe = erro instanceof Error ? erro.message : 'Dados de execução inválidos.'
        if (runId !== undefined) {
          this.deps.fila.transicionar(pedido.projectId, workspaceId, runId, 'BLOCKED', {
            causa: 'externo',
            evidencia: detalhe,
            tentativas: 0,
            porQueNaoSeguir: 'O run não pode avançar sem todos os gates e metadados válidos.',
            retomada: 'Corrija as fontes aprovadas e inicie um novo run.'
          })
        }
        resultados.push({
          sliceId,
          ...(runId === undefined ? {} : { runId }),
          estado: runId === undefined ? 'recusado' : 'bloqueado',
          mensagem: detalhe
        })
      }
    }
    return resultados
  }

  private async consultarChecks(
    userId: string,
    workspaceId: WorkspaceId,
    runId: string
  ): Promise<ConsultaDeChecks> {
    const pr = this.deps.runPrs.doRun(userId, runId)
    const agora = new Date(this.agora()).toISOString()
    if (pr === undefined) return this.desconhecido(runId, agora, 'O run ainda não registrou um PR.')

    const mergeState = await this.chamarGithub(
      userId,
      workspaceId,
      GITHUB_OPERATIONS.getMergeState,
      {
        owner: pr.owner,
        repo: pr.repo,
        pullRequest: pr.pullRequest
      }
    )
    if (!mergeState.ok) return this.desconhecido(runId, agora, mergeState.mensagem)
    const estado = mergeState.data as MergeStateNormalizado
    if (!/^[0-9a-f]{40,64}$/i.test(estado.headSha)) {
      return this.desconhecido(runId, agora, 'A origem não devolveu o SHA atual do PR.')
    }
    const checks = await this.chamarGithub(
      userId,
      workspaceId,
      GITHUB_OPERATIONS.getChecksForHead,
      {
        owner: pr.owner,
        repo: pr.repo,
        sha: estado.headSha
      }
    )
    if (!checks.ok) return this.desconhecido(runId, agora, checks.mensagem)
    const lista = Array.isArray(checks.data) ? (checks.data as readonly CheckNormalizado[]) : []
    if (lista.some((check) => check.headSha !== estado.headSha)) {
      return this.desconhecido(runId, agora, 'A origem devolveu checks de outro commit.')
    }
    this.desconhecidasDesde.delete(runId)
    return {
      estado: 'atualizado',
      consultadoEm: checks.provenance.obtidoEm,
      checks: lista.map((check) => ({
        nome: check.nome,
        status: check.status,
        ...(check.conclusao === undefined ? {} : { conclusao: check.conclusao })
      })),
      checksPendentes: lista
        .filter((check) => check.status !== 'completed')
        .map((check) => check.nome)
    }
  }

  private async chamarGithub(
    userId: string,
    workspace: WorkspaceId,
    operation: string,
    input: Record<string, unknown>
  ) {
    const request: ConnectorRequest = {
      contractVersion: CONNECTOR_CONTRACT_VERSION,
      connector: 'github',
      operation,
      correlationId: randomUUID(),
      timeoutMs: 30_000,
      credential: { key: 'github', user_id: userId, workspace_id: workspace },
      input
    }
    return await this.deps.connectors.call(request, { userId, workspace })
  }

  private desconhecido(runId: string, agora: string, erro: string): ConsultaDeChecks {
    const desde = this.desconhecidasDesde.get(runId) ?? agora
    this.desconhecidasDesde.set(runId, desde)
    return {
      estado: 'desconhecido',
      desconhecidoDesde: desde,
      checksPendentes: [],
      checks: [],
      erro
    }
  }
}
