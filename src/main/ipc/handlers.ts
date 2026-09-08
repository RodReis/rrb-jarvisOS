import type { VozService } from '../voz/voz-service'
import type { DesfechoDoDownload } from '@shared/domain/voz'
import { app, dialog, ipcMain } from 'electron'
import {
  IPC_CHANNELS,
  IPC_EVENT_CHANNELS,
  IPC_SEND_CHANNELS,
  type AppInfo,
  type AuditVerification,
  type WorkspaceSwitchResult
} from '@shared/contracts/ipc'
import { AUTH_MENSAGENS, type AuthSnapshot } from '@shared/contracts/auth'
import type { ExecutionLedgerRepository } from '../pipeline/execution-ledger-repository'
import type { PreflightService } from '../pipeline/preflight-service'
import { parseLogInput } from '@shared/contracts/logging-input'
import { isSensitivity, type PolicyContext, type PolicyDecision } from '@shared/policies'
import { isWorkspaceId, type AuditEvent, type AuditEventType } from '@shared/domain/entities'
import type { AuthService } from '../auth/auth-service'
import { log, writeLog } from '../logging/logger'
import type { AllowlistRepository } from '../policy/allowlist-repository'
import type { PolicyService } from '../policy/policy-service'
import type { WorkflowService } from '../workflows/workflow-service'
import type { SimulationEngine } from '../execution/simulation-engine'
import type { RealFileSystemEngine } from '../execution/real-filesystem-engine'
import type { TerminalEngine } from '../execution/terminal-engine'
import type { CommandAllowlistRepository } from '../policy/command-allowlist-repository'
import type { CredentialService } from '../credentials/credential-service'
import type { ExecutionRepository } from '../execution/execution-repository'
import type { ApprovalDecision, ExecutionRun } from '@shared/domain/execution'
import type { CommandExecution, CommandSubmission } from '@shared/domain/terminal'
import { isCredentialKey, type CredentialStatusView } from '@shared/domain/credentials'
import { isWorkflowStatus } from '@shared/domain/workflows'
import type { Automation, AutomationInput, Workflow, WorkflowInput } from '@shared/domain/workflows'
import type { PreferencesService } from '../preferences/preferences-service'
import type { AuditRepository } from '../storage/audit-repository'
import type { WorkspaceService } from '../workspace/workspace-service'
import type { ApprovalRepository } from '../execution/approval-repository'
import type { AiCallService } from '../ai/call-provider'
import { BudgetInputError, type BudgetService } from '../budget/budget-service'
import type { RoutingService } from '../ai/routing-service'
import type { RoutingRepository } from '../ai/routing-repository'
import type { ProviderStatus, RoutingPolicy } from '@shared/domain/routing'
import { isBudgetLimitsInput, type BudgetSnapshot } from '@shared/domain/budget'
import { isProviderRoute, isTaskType } from '@shared/domain/routing'
import type { PhaseModelService } from '../ai/phase-model-service'
import type { CodexProfileService } from '../ai/codex-profile-service'
import type { PhaseModelPolicy, ProjectModelOverride } from '@shared/domain/modelo-da-fase'
import {
  isModeloEscolhido,
  isProjectModelOverride,
  isRotaComModelo
} from '@shared/domain/modelo-da-fase'
import type { CodexBillingMode, CodexProfileState } from '@shared/domain/codex-profile'
import { isCodexBillingMode } from '@shared/domain/codex-profile'
import { isFase } from '@shared/domain/fase'
import { isEtapa } from '@shared/domain/jornada'
import type { GenerationEvent, GenerationTrace } from '@shared/domain/geracao'
import type { GenerationTraceService } from '../ai/generation-trace-service'
import {
  isConnectorCredentialKey,
  isConnectorRequest,
  type ConnectorCapability,
  type ConnectorCredentialStatusView,
  type ConnectorError,
  type ConnectorOutcome
} from '@shared/domain/connectors'
import type { ConnectorService } from '../connectors/connector-service'
import { CreditInputError, type CreditService } from '../connectors/credit-service'
import type { GithubAuthService } from '../connectors/github/github-auth-service'
import type { GithubAuthSnapshot, GithubDeviceFlowView } from '@shared/domain/github-auth'
import type { UserProfileRepository } from '../storage/repositories'
import type { ProjectService } from '../projects/project-service'
import type { WizardService } from '../projects/wizard-service'
import type { PacoteService } from '../projects/pacote-service'
import type {
  CandidatoDeContexto,
  ContextService,
  PedidoDeContexto
} from '../context/context-service'
import { isOrigemDeContexto } from '@shared/domain/context-pack'
import type { ContextPack, ContextPackOutcome, FalhaRegistrada } from '@shared/domain/context-pack'
import type { CapacidadeResolvida } from '@shared/domain/skills'
import {
  isMarcoDocumental,
  type MarcoOutcome,
  type PlanningSession,
  type Project,
  type ProjectOutcome
} from '@shared/domain/projects'
import { isAutorDaDecisao, type RespostaOutcome, type VistaDoWizard } from '@shared/domain/wizard'
import type { PacoteEstrutural, PacoteOutcome } from '@shared/domain/pacote-estrutural'
import type { Anexo, AnexoOutcome } from '@shared/domain/anexos-de-design'
import { EXTENSOES_DO_ANEXO, isTipoDeAnexo } from '@shared/domain/anexos-de-design'
import type { ValidacaoDoPrototipo } from '@shared/domain/validacao-de-prototipo'
import type { PacoteArquitetura } from '@shared/domain/arquitetura'
import type { AlvoDaPublicacao, PublicacaoOutcome } from '@shared/domain/publicacao'
import type { ExecutionLedger } from '@shared/domain/execution-ledger'
import type { PendenciaDeLimpeza } from '@shared/domain/limpeza'
import type { MergePolicyOutcome, PoliticaDeMerge, VistaDaFila } from '@shared/domain/pipeline'
import type { Roadmap } from '@shared/domain/roadmap'
import type {
  MvpGerado,
  RoadmapGeradoOutcome,
  RoadmapRegistrado
} from '@shared/domain/roadmap-gerado'
import type {
  Approval,
  AprovacaoOutcome,
  Gate,
  MudancaDeArtefato,
  RevisaoAprovada
} from '@shared/domain/aprovacoes'
import { NATUREZAS, isGate } from '@shared/domain/aprovacoes'
import type { PublicacaoService } from '../projects/publicacao-service'
import type { MergePolicyService } from '../pipeline/merge-policy-service'
import type { FilaService } from '../pipeline/fila-service'
import type { VistaDeMarcos } from '@shared/domain/marcos'
import type { MarcosService } from '../projects/marcos-service'
import type { RoadmapService } from '../projects/roadmap-service'
import type { RoadmapGeradoService } from '../projects/roadmap-gerado-service'
import type { JornadaService } from '../projects/jornada-service'
import type { BriefService } from '../projects/brief-service'
import type { PrdService } from '../projects/prd-service'
import type { ArquiteturaService } from '../projects/arquitetura-service'
import type { RefinamentoService } from '../projects/refinamento-service'
import type { GeracaoDePerguntasOutcome } from '@shared/domain/refinamento'
import type { Decision, EstadoDoWizard, Resposta } from '@shared/domain/wizard'
import type { BriefRegistrado, GeracaoOutcome, PromptDoProjeto } from '@shared/domain/brief'
import type { PrdOutcome, PrdRegistrado } from '@shared/domain/prd'
import type {
  ArquiteturaGeradaOutcome,
  ArquiteturaRegistrada
} from '@shared/domain/arquitetura-gerada'
import type { ResultadoDaRota } from '@shared/domain/rota-de-geracao'
import type { ResumoDoProjeto } from '@shared/domain/fase'
import type { EstadoDasRotas } from '@shared/domain/rota-de-geracao'
import type { WorkspaceId } from '@shared/domain/entities'
import type { EstadoDaJornada, TransicaoOutcome } from '@shared/domain/jornada'
import type { AnexoService } from '../projects/anexo-service'
import { isConnectorId } from '@shared/domain/connectors'
import type { ConnectorCreditView } from '@shared/contracts/ipc'
import {
  isAiProvider,
  type AiCallHandle,
  type AiRequest,
  type AiStreamEvent
} from '@shared/domain/ai'
import { MODELO_PADRAO } from '@shared/domain/ai'

/**
 * Normaliza o contexto de política vindo do renderer (fronteira de confiança).
 *
 * `workspace` fora do enum vira `jarvis` — o espaço **mais restrito** para a regra de
 * sensibilidade (CONVENTION §2). Na dúvida sobre o ambiente, tratar como JARVIS é a escolha
 * fail-safe: erra para mais cauteloso, nunca para menos. `sensitivity` inválida é descartada
 * (vira `undefined`); `detail` só passa se for objeto — o `PolicyService` o redige depois.
 */
function parsePolicyContext(value: unknown): PolicyContext {
  const source =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

  const workspace = source['workspace'] === 'noa' ? 'noa' : 'jarvis'
  const sensitivity = isSensitivity(source['sensitivity']) ? source['sensitivity'] : undefined
  const detail =
    typeof source['detail'] === 'object' && source['detail'] !== null
      ? (source['detail'] as Record<string, unknown>)
      : undefined

  return {
    workspace,
    ...(sensitivity ? { sensitivity } : {}),
    ...(detail ? { detail } : {})
  }
}

/**
 * A **forma** de uma `Resposta` vinda do renderer. O vocabulário — a escolha ser opção real, a
 * delegação ser permitida — é do serviço; barrar aqui duplicaria a regra em dois lugares que
 * divergiriam. `undefined` é "forma inválida", e quem chama decide o outcome.
 */
function lerResposta(resposta: unknown): Resposta | undefined {
  const r = resposta as Partial<Resposta> | null
  if (
    r === null ||
    typeof r !== 'object' ||
    typeof r.perguntaId !== 'string' ||
    (r.escolha !== null && typeof r.escolha !== 'string') ||
    (r.texto !== null && typeof r.texto !== 'string') ||
    (r.autor !== 'pi' && r.autor !== 'agente')
  ) {
    return undefined
  }

  return {
    perguntaId: r.perguntaId,
    escolha: r.escolha ?? null,
    texto: r.texto ?? null,
    autor: r.autor,
    ...(r.aceitarSubstituicao === true ? { aceitarSubstituicao: true } : {})
  }
}

/**
 * Valida o pedido de contexto na fronteira (SPEC-Planejamento-02; CONVENTION §2).
 *
 * Devolve `undefined` quando o pedido não casa o contrato. O que se valida aqui é **forma**, e
 * só forma: se há projeto, tarefa, etapa e ao menos um candidato com caminho e origem
 * conhecidos. A política — segredo, teto, exceção — mora no serviço, e repeti-la aqui criaria
 * uma segunda fonte que divergiria da primeira no dia em que uma das duas mudasse.
 *
 * O candidato de origem desconhecida é **descartado**, não corrigido para um default: um item
 * cuja origem o app não reconhece entraria no manifesto declarando uma procedência inventada, e
 * a origem é justamente o que distingue "o usuário anexou" de "a busca encontrou".
 */
function parsePedidoDeContexto(value: unknown): PedidoDeContexto | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const source = value as Record<string, unknown>

  const projectId = source['projectId']
  const tarefa = source['tarefa']
  const etapa = source['etapa']
  const rota = source['rota']

  if (
    typeof projectId !== 'string' ||
    typeof tarefa !== 'string' ||
    typeof etapa !== 'string' ||
    !isAiProvider(rota)
  ) {
    return undefined
  }

  const brutos = Array.isArray(source['candidatos']) ? source['candidatos'] : []
  const candidatos: CandidatoDeContexto[] = []

  for (const bruto of brutos) {
    if (typeof bruto !== 'object' || bruto === null) continue
    const item = bruto as Record<string, unknown>
    const caminho = item['caminho']
    const origem = item['origem']

    if (typeof caminho !== 'string' || caminho.length === 0 || !isOrigemDeContexto(origem)) {
      continue
    }

    const linhas = item['linhas']
    const faixa =
      typeof linhas === 'object' &&
      linhas !== null &&
      typeof (linhas as Record<string, unknown>)['de'] === 'number' &&
      typeof (linhas as Record<string, unknown>)['ate'] === 'number'
        ? {
            de: (linhas as Record<string, number>)['de'] as number,
            ate: (linhas as Record<string, number>)['ate'] as number
          }
        : undefined

    candidatos.push({
      caminho,
      origem,
      motivo: typeof item['motivo'] === 'string' ? item['motivo'] : 'selecionado na tela',
      ...(faixa === undefined ? {} : { linhas: faixa })
    })
  }

  if (candidatos.length === 0) return undefined

  const excecao = source['excecaoDeLeituraAmpla']
  const excecaoValida =
    typeof excecao === 'object' &&
    excecao !== null &&
    typeof (excecao as Record<string, unknown>)['motivo'] === 'string' &&
    typeof (excecao as Record<string, unknown>)['tetoDeBytes'] === 'number'
      ? {
          motivo: (excecao as Record<string, string>)['motivo'] as string,
          tetoDeBytes: (excecao as Record<string, number>)['tetoDeBytes'] as number,
          autorizadoPor:
            typeof (excecao as Record<string, unknown>)['autorizadoPor'] === 'string'
              ? ((excecao as Record<string, string>)['autorizadoPor'] as string)
              : '',
          autorizadoEm: new Date().toISOString()
        }
      : undefined

  const regras = Array.isArray(source['regras'])
    ? source['regras'].filter((r): r is string => typeof r === 'string')
    : undefined

  return {
    projectId,
    tarefa,
    etapa,
    candidatos,
    rota,
    ...(regras === undefined ? {} : { regras }),
    ...(typeof source['resumoAnterior'] === 'string'
      ? { resumoAnterior: source['resumoAnterior'] }
      : {}),
    ...(excecaoValida === undefined ? {} : { excecaoDeLeituraAmpla: excecaoValida }),
    ...(typeof source['tetoDeTokens'] === 'number' ? { tetoDeTokens: source['tetoDeTokens'] } : {}),
    ...(typeof source['motivoDaExpansao'] === 'string'
      ? { motivoDaExpansao: source['motivoDaExpansao'] }
      : {}),
    ...(typeof source['packAnterior'] === 'string' ? { packAnterior: source['packAnterior'] } : {})
  }
}

/** Monta o payload público do app. Sem segredo, sem caminho de disco, sem env cru. */
export function buildAppInfo(): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    electronVersion: process.versions.electron,
    environment: app.isPackaged ? 'production' : 'development'
  }
}

/**
 * O que os handlers precisam para responder. Entra por parâmetro, não por import de
 * singleton: é o que permite exercitar os canais em teste sem abrir banco nem subir janela.
 */
export interface IpcDependencies {
  readonly audit: AuditRepository
  readonly workspaces: WorkspaceService
  readonly preferences: PreferencesService
  /**
   * Reaplica o que vive **fora** do banco depois de salvar (SPEC-Voz-01, critério 6).
   *
   * A hotkey é registrada no SO, não no SQLite: gravar a preferência nova sem re-registrar
   * deixaria o atalho antigo valendo até o próximo boot — e o critério pede que a mudança valha
   * na chamada seguinte, sem restart.
   */
  readonly aoSalvarPreferencias?: () => void
  /**
   * Dono da auditoria consultada pelo canal `audit:list`.
   *
   * É função e não string desde a F03: o usuário deixa de ser fixo — antes do login é o
   * usuário local, depois é o da sessão. Capturar o valor no registro dos handlers
   * congelaria o id do boot e faria a UI listar a auditoria de quem não está logado.
   */
  readonly userId: () => string
  /** Policy Engine (SPEC-Execucao-02): classifica e audita a decisão, não bloqueia. */
  readonly policy: PolicyService
  /** Allowlist de diretórios (SPEC-Execucao-03): edição auditada, checagem no main. */
  readonly allowlist: AllowlistRepository
  /** Registro de workflows/automações (SPEC-Execucao-04): CRUD classificado + auditado. */
  readonly workflows: WorkflowService
  /** Motor de execução simulada (SPEC-Execucao-05): zero efeito colateral. */
  readonly execution: SimulationEngine
  /** Motor de filesystem real (SPEC-ExecucaoReal-01): enforcement fail-closed. */
  readonly realExecution: RealFileSystemEngine
  /** Motor do terminal controlado (SPEC-ExecucaoReal-02): duas barreiras + timeout. */
  readonly terminal: TerminalEngine
  /** Allowlist de comandos (SPEC-ExecucaoReal-02, 1ª barreira): edição de alto risco. */
  readonly commandAllowlist: CommandAllowlistRepository
  /** Projeto local e planejamento (SPEC-Planejamento-01): Git só pelo terminal controlado. */
  readonly projects: ProjectService
  /**
   * Contexto, skills e orçamento (SPEC-Planejamento-02): o manifesto que toda geração exige.
   * A leitura de arquivo acontece **aqui dentro**, sob o diretório do projeto — nunca no
   * renderer, que só indica caminhos.
   */
  readonly contexts: ContextService
  /**
   * O wizard orientado (SPEC-Planejamento-03): a pergunta pendente e o registro da decisão.
   * Serviço próprio, e não um método a mais do `ProjectService`, porque a trilha de decisões
   * tem regra própria — append-only e com autoria — que nada tem a ver com o ciclo de vida do
   * projeto no disco.
   */
  readonly wizard: WizardService
  /**
   * O pacote estrutural (SPEC-Planejamento-04): PRD, Landscape e Convention compostos das
   * decisões e das evidências. Serviço próprio porque a pesquisa externa, o bloqueio e a
   * revisão imutável têm regra própria — nada disso é ciclo de vida de projeto.
   */
  readonly pacotes: PacoteService
  readonly anexos: AnexoService
  readonly roadmap: RoadmapService
  readonly roadmapGerado: RoadmapGeradoService
  readonly marcos: MarcosService
  readonly jornada: JornadaService
  /**
   * O estado das rotas do ambiente, medido **uma vez** por leitura da lista.
   *
   * Async e fora do serviço porque medir a assinatura custa um `spawn` do CLI: doze projetos
   * dariam doze processos para desenhar uma tela só. O estado é propriedade do ambiente, não do
   * projeto, então uma medição serve todos os cards do lote.
   */
  readonly estadoDasRotas: (workspace: WorkspaceId) => Promise<EstadoDasRotas>
  readonly brief: BriefService
  readonly prd: PrdService
  readonly arquitetura: ArquiteturaService
  readonly refinamento: RefinamentoService
  readonly publicacao: PublicacaoService
  /** O kill-switch do merge autônomo (SPEC-Entrega-02/05). */
  readonly mergePolicy: MergePolicyService
  /** A fila de execução (SPEC-Entrega-02). Exposta só para leitura. */
  readonly fila: FilaService
  readonly preflight: PreflightService
  /** A prova dos runs e as pendências de limpeza (SPEC-Entrega-06). Leitura apenas. */
  readonly executionLedger: ExecutionLedgerRepository
  /** Vault de credenciais (SPEC-Providers-01): status para a UI, valor só dentro do main. */
  readonly credentials: CredentialService
  /** Runs persistidos, para a UI listar o histórico. */
  readonly runs: ExecutionRepository
  /** Fila de aprovações pendentes do usuário corrente. */
  readonly approvals: ApprovalRepository
  /** O serviço de voz (SPEC-Voz-01). Injetado como todo o resto — o IPC não conhece o engine. */
  readonly voz: VozService
  readonly baixarArtefatoDeVoz: (id: string) => Promise<DesfechoDoDownload>
  /** Ausente quando as credenciais não estão configuradas — o app roda sem login. */
  readonly auth?: AuthService
  /** Ponto único de chamada de IA (SPEC-Providers-02): classifica, estima, audita, mede. */
  readonly ai: AiCallService
  /** Gate de orçamento (SPEC-Providers-03): a UI lê limites e acumulado, e edita limites. */
  readonly budget: BudgetService
  /** Roteamento e healthcheck (SPEC-Providers-04): status por provider e edição de rotas. */
  readonly routing: RoutingService
  /** O repositório, para a lista de modelos — leitura pura, sem passar pelo serviço. */
  readonly routingRepo: RoutingRepository
  /** O modelo de cada fase (SPEC-Fases-02): política do workspace e overrides por projeto. */
  readonly phaseModels: PhaseModelService
  /** O perfil isolado do Codex (SPEC-Multi-Executor-02): saúde, login e modo de cobrança. */
  readonly codex: CodexProfileService
  /**
   * A trilha das gerações (SPEC-Fases-03). O renderer só **lê** por aqui — quem grava é o ponto
   * único, e não há canal que escreva evento.
   */
  readonly generationTraces: GenerationTraceService
  /** O ponto único de conectores (SPEC-Conectores-01). */
  readonly connectors: ConnectorService
  /** O ledger de créditos de conector (SPEC-Conectores-02). */
  readonly connectorCredits: CreditService
  /** O Device Flow do GitHub App (SPEC-Conectores-03). */
  readonly githubAuth: GithubAuthService
  /** O override do `client_id`, lido e gravado no perfil — não é segredo, não vai ao vault. */
  readonly profiles: UserProfileRepository
  /** Minimizar para o tray. Injetado porque a janela nasce depois dos handlers. */
  readonly minimizeToTray: () => void
}

/**
 * Registra os handlers dos canais declarados em `IPC_CHANNELS` e `IPC_SEND_CHANNELS`.
 * Cada canal do contrato tem exatamente um handler aqui — não há rota genérica.
 *
 * A regra "todo método loga" (CONVENTION §3) vale aqui: cada canal emite `info` no fluxo
 * normal e `error` na falha, com `direction` marcando a entrada e a saída da chamada.
 */
export function registerIpcHandlers(deps: IpcDependencies): void {
  ipcMain.handle(IPC_CHANNELS.appInfo, () => {
    log.ipc.info('Metadados do app solicitados', { canal: IPC_CHANNELS.appInfo, direction: 'in' })

    try {
      const info = buildAppInfo()
      log.ipc.info('Metadados do app devolvidos', {
        canal: IPC_CHANNELS.appInfo,
        direction: 'out',
        ambiente: info.environment
      })
      return info
    } catch (error) {
      log.ipc.error('Falha ao montar metadados do app', { canal: IPC_CHANNELS.appInfo, error })
      throw error
    }
  })

  // Auditoria: leitura apenas. O renderer não abre o SQLite (SPEC-04, critério 6), e
  // gravar evento é ato do main disparado por um fluxo real — nunca a pedido da UI.
  ipcMain.handle(IPC_CHANNELS.auditList, (_event, type?: unknown): readonly AuditEvent[] => {
    const eventos = deps.audit.list(deps.userId())
    // Filtro de tipo aplicado aqui, e não numa query montada com string vinda do
    // renderer: o canal aceita um valor externo e ele não vira SQL em hipótese alguma.
    const filtrados =
      typeof type === 'string'
        ? eventos.filter((e) => e.type === (type as AuditEventType))
        : eventos

    log.ipc.info('Eventos de auditoria consultados', {
      canal: IPC_CHANNELS.auditList,
      direction: 'out',
      quantidade: filtrados.length
    })

    return filtrados
  })

  ipcMain.handle(IPC_CHANNELS.auditVerify, (): AuditVerification => {
    const resultado = deps.audit.verify(deps.userId()) as AuditVerification

    if (!resultado.ok) {
      log.ipc.warn('Verificação da cadeia de auditoria acusou quebra', {
        canal: IPC_CHANNELS.auditVerify,
        seq: resultado.brokenAt
      })
    }

    return resultado
  })

  ipcMain.handle(IPC_CHANNELS.workspaceGet, () => deps.workspaces.atual())

  ipcMain.handle(
    IPC_CHANNELS.workspaceSwitch,
    (_event, destino: unknown): WorkspaceSwitchResult => {
      // `Desenvolvimento` e qualquer string inventada param aqui: o enum é fechado
      // (CONVENTION §2) e o renderer é fronteira de confiança.
      if (!isWorkspaceId(destino)) {
        log.ipc.warn('Troca de espaço recusada: destino fora do enum', {
          canal: IPC_CHANNELS.workspaceSwitch
        })
        throw new Error('Espaço de trabalho inválido.')
      }

      try {
        return deps.workspaces.trocar(destino)
      } catch (error) {
        log.ipc.error('Falha ao alternar espaço de trabalho', {
          canal: IPC_CHANNELS.workspaceSwitch,
          destino,
          error
        })
        throw error
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.preferencesGet, () => deps.preferences.atual())

  ipcMain.handle(IPC_CHANNELS.preferencesSave, (_event, payload: unknown) => {
    // O serviço descarta campo fora do enum; aqui basta garantir que é objeto.
    const pedido = typeof payload === 'object' && payload !== null ? payload : {}

    try {
      const resultado = deps.preferences.salvar(pedido)
      deps.aoSalvarPreferencias?.()
      log.ipc.info('Preferências atualizadas', {
        canal: IPC_CHANNELS.preferencesSave,
        direction: 'out',
        idioma: resultado.locale,
        tema: resultado.theme
      })
      return resultado
    } catch (error) {
      log.ipc.error('Falha ao gravar preferências', {
        canal: IPC_CHANNELS.preferencesSave,
        error
      })
      throw error
    }
  })

  /**
   * Canais de auth (SPEC-03). Os três devolvem `AuthSnapshot` e nada além — o token não
   * atravessa a ponte (critério 4). Sem `auth` configurado, respondem o estado de
   * credenciais ausentes em vez de estourar: o app roda sem login (`.env.example`).
   */
  const semCredenciais: AuthSnapshot = {
    state: 'erro',
    mensagem: AUTH_MENSAGENS['credenciais-ausentes']
  }

  ipcMain.handle(IPC_CHANNELS.authGet, (): AuthSnapshot => {
    return deps.auth?.atual() ?? semCredenciais
  })

  ipcMain.handle(IPC_CHANNELS.authLogin, async (): Promise<AuthSnapshot> => {
    log.auth.info('Login solicitado pela interface', {
      canal: IPC_CHANNELS.authLogin,
      direction: 'in'
    })

    if (!deps.auth) {
      log.auth.warn('Login indisponível: credenciais do Supabase não configuradas')
      return semCredenciais
    }

    // O `AuthService` já converte falha em snapshot de erro (critério 6); o catch aqui
    // cobre só o imprevisto, para o canal nunca rejeitar e deixar a UI pendurada.
    try {
      return await deps.auth.login()
    } catch (error) {
      log.auth.error('Falha inesperada no canal de login', {
        canal: IPC_CHANNELS.authLogin,
        error
      })
      return { state: 'erro', mensagem: AUTH_MENSAGENS['falha-no-provedor'] }
    }
  })

  ipcMain.handle(IPC_CHANNELS.authLogout, async (): Promise<AuthSnapshot> => {
    log.auth.info('Logout solicitado pela interface', {
      canal: IPC_CHANNELS.authLogout,
      direction: 'in'
    })

    if (!deps.auth) return semCredenciais

    return await deps.auth.logout()
  })

  // Policy Engine (SPEC-Execucao-02, critério 7): o renderer não avalia política — pede,
  // o main classifica e audita, e devolve a decisão. Modo report: nada é barrado aqui.
  ipcMain.handle(
    IPC_CHANNELS.policyClassify,
    (_event, action: unknown, context: unknown): PolicyDecision => {
      // Fronteira de confiança: `action` e `context` vêm do renderer. Ação inválida não é
      // erro a estourar — é o próprio caso fail-closed: o `evaluate` a trata como
      // desconhecida (`bloqueado`). O que se valida aqui é a *forma* do contexto.
      const acao = typeof action === 'string' ? action : ''
      const ctx = parsePolicyContext(context)

      log.agent.info('Classificação de política solicitada', {
        canal: IPC_CHANNELS.policyClassify,
        direction: 'in',
        action: acao
      })

      return deps.policy.classify(acao, ctx)
    }
  )

  // Allowlist de diretórios (SPEC-Execucao-03, critério 5). O renderer nunca toca o FS nem
  // a tabela: lê e edita por aqui, e a checagem/persistência ficam no main. Os três
  // devolvem a lista atualizada, para a UI refletir sem um segundo round-trip.
  ipcMain.handle(IPC_CHANNELS.allowlistList, (): readonly string[] => {
    return deps.allowlist.list(deps.userId())
  })

  ipcMain.handle(IPC_CHANNELS.allowlistAdd, (_event, path: unknown): readonly string[] => {
    // `path` vem do renderer (fronteira de confiança). String vazia/não-string não vira
    // erro: o repositório canoniza e a checagem downstream barra o que resolver pra fora.
    const alvo = typeof path === 'string' ? path : ''
    if (alvo) deps.allowlist.add(deps.userId(), alvo)
    return deps.allowlist.list(deps.userId())
  })

  ipcMain.handle(IPC_CHANNELS.allowlistRemove, (_event, path: unknown): readonly string[] => {
    const alvo = typeof path === 'string' ? path : ''
    if (alvo) deps.allowlist.remove(deps.userId(), alvo)
    return deps.allowlist.list(deps.userId())
  })

  // Seletor nativo de pasta (SPEC-ExecucaoReal-03, decisão 2 do PI). O diálogo abre **aqui**,
  // não no renderer: escolher um caminho é tocar o filesystem, e a fronteira do ARCHITECTURE
  // não abre exceção para leitura. O renderer só dispara o canal e recebe a lista de volta.
  ipcMain.handle(IPC_CHANNELS.allowlistPick, async (): Promise<readonly string[]> => {
    const escolha = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    const [diretorio] = escolha.filePaths

    // Duas condições, não uma: `canceled` cobre o usuário fechando o diálogo, e a checagem do
    // path cobre um retorno confirmado porém vazio — que passaria `undefined` ao repositório
    // como se fosse escolha. Sem adicionar não há `AuditEvent`: ele nasce dentro do `add`.
    if (!escolha.canceled && diretorio) {
      deps.allowlist.add(deps.userId(), diretorio)
    }

    return deps.allowlist.list(deps.userId())
  })

  // O diretório do app (default de fábrica). Só-leitura, para a UI saber qual item da lista
  // apresentar como fixo — o repositório já recusa removê-lo, este canal só torna a regra
  // visível na tela em vez de deixá-la ser inferida por posição.
  ipcMain.handle(IPC_CHANNELS.allowlistAppDir, (): string => {
    return deps.allowlist.appDirectory()
  })

  // Registro de workflows/automações (SPEC-Execucao-04, critério 7). CRUD de definições —
  // nada executa. `workspace` vem do renderer: validado contra o enum fechado antes de
  // tocar o serviço; o resto do input o serviço/repositório trata (JSON de etapas etc.).
  ipcMain.handle(IPC_CHANNELS.workflowList, (_event, workspace: unknown): readonly Workflow[] => {
    if (!isWorkspaceId(workspace)) return []
    return deps.workflows.listWorkflows(workspace)
  })

  ipcMain.handle(IPC_CHANNELS.workflowCreate, (_event, input: unknown): Workflow => {
    // O input carrega workspace + etapas. Validamos o workspace (fronteira); as etapas são
    // dados de catálogo que o repositório serializa — não há execução a proteger aqui.
    const pedido = input as Omit<WorkflowInput, 'user_id'>
    if (!isWorkspaceId(pedido?.workspace_id)) {
      throw new Error('Workspace inválido.')
    }
    return deps.workflows.createWorkflow(pedido)
  })

  ipcMain.handle(
    IPC_CHANNELS.workflowUpdate,
    (_event, id: unknown, patch: unknown): Workflow | undefined => {
      if (typeof id !== 'string') return undefined
      return deps.workflows.updateWorkflow(id, (patch ?? {}) as Partial<Workflow>)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.workflowSetStatus,
    (_event, id: unknown, status: unknown): Workflow | undefined => {
      if (typeof id !== 'string' || !isWorkflowStatus(status)) return undefined
      return deps.workflows.setWorkflowStatus(id, status)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.workflowRemove,
    (_event, id: unknown, workspace: unknown): boolean => {
      if (typeof id !== 'string' || !isWorkspaceId(workspace)) return false
      return deps.workflows.removeWorkflow(id, workspace)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.automationList,
    (_event, workspace: unknown): readonly Automation[] => {
      if (!isWorkspaceId(workspace)) return []
      return deps.workflows.listAutomations(workspace)
    }
  )

  ipcMain.handle(IPC_CHANNELS.automationCreate, (_event, input: unknown): Automation => {
    const pedido = input as Omit<AutomationInput, 'user_id'>
    if (!isWorkspaceId(pedido?.workspace_id)) {
      throw new Error('Workspace inválido.')
    }
    return deps.workflows.createAutomation(pedido)
  })

  ipcMain.handle(
    IPC_CHANNELS.automationSetEnabled,
    (_event, id: unknown, enabled: unknown): Automation | undefined => {
      if (typeof id !== 'string') return undefined
      return deps.workflows.setAutomationEnabled(id, enabled === true)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.automationRemove,
    (_event, id: unknown, workspace: unknown): boolean => {
      if (typeof id !== 'string' || !isWorkspaceId(workspace)) return false
      return deps.workflows.removeAutomation(id, workspace)
    }
  )

  // Execução simulada (SPEC-Execucao-05, critério 7). O renderer só dispara e lê; o motor
  // roda no main e não toca recurso real. Gatilho manual — nada é agendado.
  ipcMain.handle(
    IPC_CHANNELS.executionRun,
    (_event, workflowId: unknown, workspace: unknown): ExecutionRun => {
      if (typeof workflowId !== 'string' || !isWorkspaceId(workspace)) {
        throw new Error('Parâmetros inválidos para execução simulada.')
      }
      log.agent.info('Execução simulada solicitada pela interface', {
        canal: IPC_CHANNELS.executionRun,
        direction: 'in',
        workflowId
      })
      return deps.execution.runWorkflow(workflowId, workspace)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.executionRunReal,
    (_event, workflowId: unknown, workspace: unknown): ExecutionRun => {
      if (typeof workflowId !== 'string' || !isWorkspaceId(workspace)) {
        throw new Error('Parâmetros inválidos para execução real.')
      }
      log.agent.info('Execução real de filesystem solicitada pela interface', {
        canal: IPC_CHANNELS.executionRunReal,
        direction: 'in',
        workflowId
      })
      return deps.realExecution.runWorkflow(workflowId, workspace)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.executionList,
    (_event, workspace: unknown): readonly ExecutionRun[] => {
      if (!isWorkspaceId(workspace)) return []
      return deps.runs.list(deps.userId(), workspace)
    }
  )

  /*
   * Voz (SPEC-Voz-01, critério 3).
   *
   * Três canais, e o que eles **devolvem** é o ponto: texto ou desfecho nomeado. Nada de
   * caminho de modelo, comando ou PID — com isso na mão, a tela deixaria de falar com uma
   * capacidade e passaria a falar com uma implementação.
   */
  ipcMain.handle(IPC_CHANNELS.vozTranscrever, async (_event, pcm: unknown) => {
    // O PCM atravessa a ponte como `Int16Array`; qualquer outra coisa é chamada malformada, e
    // tratá-la como áudio vazio dá à tela o desfecho honesto em vez de uma exceção opaca.
    if (!(pcm instanceof Int16Array)) return { estado: 'sem-audio' as const }
    return deps.voz.transcrever(pcm)
  })

  ipcMain.handle(IPC_CHANNELS.vozProntidao, async () => deps.voz.prontidao())

  ipcMain.handle(IPC_CHANNELS.vozBaixarArtefato, async (_event, id: unknown) => {
    if (typeof id !== 'string') {
      return { estado: 'falhou' as const, motivo: 'Artefato não identificado.' }
    }
    return deps.baixarArtefatoDeVoz(id)
  })

  ipcMain.handle(IPC_CHANNELS.approvalList, (_event, workspace: unknown) => {
    if (!isWorkspaceId(workspace)) return []
    return deps.approvals.listPending(deps.userId(), workspace)
  })

  // Resolver uma aprovação **roteia pelo motor que a criou**.
  //
  // A fila é uma só de propósito (a F02 reusa a da F01 — o usuário tem um lugar para ver o
  // que espera por ele), mas retomar um comando é executar processo, e retomar uma etapa de
  // filesystem é tocar arquivo: dois motores. O discriminante é o `kind` gravado no payload
  // da operação — `comando` para terminal, as operações de FS para o resto. Sem este
  // roteamento, aprovar um comando cairia no motor de filesystem, que não saberia o que fazer
  // com o payload e falharia a etapa silenciosamente.
  ipcMain.handle(
    IPC_CHANNELS.approvalResolve,
    (_event, id: unknown, decision: unknown): ExecutionRun | CommandExecution | undefined => {
      if (typeof id !== 'string' || (decision !== 'aprovado' && decision !== 'negado')) {
        throw new Error('Parâmetros inválidos para aprovação.')
      }

      const pedido = deps.approvals.findById(deps.userId(), id)
      if (pedido?.operation['kind'] === 'comando') {
        return deps.terminal.resolveApproval(id, decision as ApprovalDecision)
      }

      return deps.realExecution.resolveApproval(id, decision as ApprovalDecision)
    }
  )

  // Terminal controlado (SPEC-ExecucaoReal-02). O renderer submete; **só o main executa**.
  //
  // A validação aqui é de *forma* (fronteira de confiança), não de política: binário e cwd
  // precisam ser string e os argumentos precisam ser strings. Quem decide se o comando pode
  // rodar é o motor, com as duas barreiras — repetir a decisão aqui criaria uma segunda
  // fonte de política, e duas fontes divergem.
  ipcMain.handle(
    IPC_CHANNELS.terminalRun,
    (_event, submission: unknown, workspace: unknown): CommandExecution => {
      const pedido =
        typeof submission === 'object' && submission !== null
          ? (submission as Record<string, unknown>)
          : {}

      const binary = typeof pedido['binary'] === 'string' ? pedido['binary'] : ''
      const cwd = typeof pedido['cwd'] === 'string' ? pedido['cwd'] : ''
      const args = Array.isArray(pedido['args'])
        ? pedido['args'].filter((a): a is string => typeof a === 'string')
        : []

      if (!isWorkspaceId(workspace) || binary.length === 0 || cwd.length === 0) {
        throw new Error('Parâmetros inválidos para execução de comando.')
      }

      log.agent.info('Execução de comando solicitada pela interface', {
        canal: IPC_CHANNELS.terminalRun,
        direction: 'in',
        binary
      })

      const entrada: CommandSubmission = { binary, args, cwd }
      return deps.terminal.run(entrada, workspace)
    }
  )

  // Allowlist de comandos. Escopada por espaço; `add`/`remove` classificam (alto risco) e
  // auditam no repositório. Devolvem a lista atualizada, como os canais de diretório.
  ipcMain.handle(
    IPC_CHANNELS.commandAllowlistList,
    (_event, workspace: unknown): readonly string[] => {
      if (!isWorkspaceId(workspace)) return []
      return deps.commandAllowlist.list(deps.userId(), workspace)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.commandAllowlistAdd,
    (_event, binary: unknown, workspace: unknown): readonly string[] => {
      if (!isWorkspaceId(workspace)) return []
      const alvo = typeof binary === 'string' ? binary : ''
      if (alvo) deps.commandAllowlist.add(deps.userId(), workspace, alvo)
      return deps.commandAllowlist.list(deps.userId(), workspace)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.commandAllowlistRemove,
    (_event, binary: unknown, workspace: unknown): readonly string[] => {
      if (!isWorkspaceId(workspace)) return []
      const alvo = typeof binary === 'string' ? binary : ''
      if (alvo) deps.commandAllowlist.remove(deps.userId(), workspace, alvo)
      return deps.commandAllowlist.list(deps.userId(), workspace)
    }
  )

  // Vault de credenciais (SPEC-Providers-01, critério 8). Os três canais devolvem a lista de
  // status — nunca valor. O ator é **fixo em `usuario`** aqui, e não parâmetro: o que chega
  // por este canal veio da UI, onde só o dono digita. Deixar o renderer escolher o ator faria
  // do campo uma forma de o agente se declarar usuário e escapar da classificação de alto
  // risco — a distinção do critério 5 só vale enquanto o call site a decide.
  ipcMain.handle(
    IPC_CHANNELS.credentialList,
    (_event, workspace: unknown): readonly CredentialStatusView[] => {
      if (!isWorkspaceId(workspace)) return []
      return deps.credentials.listStatus(deps.userId(), workspace)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.credentialSet,
    (_event, key: unknown, value: unknown, workspace: unknown): readonly CredentialStatusView[] => {
      if (!isWorkspaceId(workspace) || !isCredentialKey(key)) return []

      // Valor vazio não é "gravar string vazia": é ausência de entrada, e gravá-la deixaria a
      // credencial `present` com um valor que o provider recusaria. Vira no-op.
      const segredo = typeof value === 'string' ? value.trim() : ''
      if (segredo.length === 0) return deps.credentials.listStatus(deps.userId(), workspace)

      // Sem `ctx` com a chave: o log registra o fato e o provider, nunca o valor.
      log.integracao.info('Credencial submetida pela interface', {
        canal: IPC_CHANNELS.credentialSet,
        direction: 'in',
        key
      })

      return deps.credentials.set(deps.userId(), workspace, key, segredo, 'usuario')
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.credentialRemove,
    (_event, key: unknown, workspace: unknown): readonly CredentialStatusView[] => {
      if (!isWorkspaceId(workspace) || !isCredentialKey(key)) return []
      return deps.credentials.remove(deps.userId(), workspace, key, 'usuario')
    }
  )

  // Chamada de IA (SPEC-Providers-02, critérios 2 e 8). O `invoke` devolve só o handle; o
  // texto chega pelo canal de evento, um `send` por chunk. O renderer **nunca** recebe a
  // credencial: quem a lê do Vault é o ponto único de chamada, dentro do main.
  //
  ipcMain.handle(
    IPC_CHANNELS.aiCall,
    async (event, request: unknown, workspace: unknown): Promise<AiCallHandle | undefined> => {
      if (!isWorkspaceId(workspace)) return undefined
      if (typeof request !== 'object' || request === null) return undefined

      const bruto = request as Partial<AiRequest>
      // Validação na fronteira: prompt não-vazio, e **um dos dois** caminhos de escolha —
      // provider explícito (fechado pelo enum) ou `taskType` (fechado pela taxonomia). Aceitar
      // um pedido sem nenhum dos dois empurraria a recusa para dentro do serviço, longe de
      // quem a causou. O `model` é aceito como veio porque a tabela de preço já trata modelo
      // desconhecido — recusá-lo aqui exigiria uma segunda lista em sincronia com a primeira.
      const temProvider = isAiProvider(bruto.provider)
      const temTarefa = isTaskType(bruto.taskType)
      if (!temProvider && !temTarefa) return undefined

      const prompt = typeof bruto.prompt === 'string' ? bruto.prompt.trim() : ''
      if (prompt.length === 0) return undefined

      const pedido: AiRequest = {
        prompt,
        ...(temProvider ? { provider: bruto.provider } : {}),
        ...(temTarefa ? { taskType: bruto.taskType } : {}),
        ...(typeof bruto.model === 'string' ? { model: bruto.model } : {}),
        ...(typeof bruto.system === 'string' ? { system: bruto.system } : {}),
        ...(typeof bruto.maxTokens === 'number' ? { maxTokens: bruto.maxTokens } : {}),
        // SPEC-Planejamento-02, critério 1. Este handler **reconstrói** o pedido campo a campo
        // em vez de repassar o objeto cru — e por isso um campo novo que não seja copiado aqui
        // some silenciosamente no caminho. Foi o que o E2E pegou: sem estas duas linhas, toda
        // chamada vinda da UI chegava ao ponto único sem `contextPackId` e era recusada por
        // falta de contexto, inclusive as que o declaravam.
        ...(typeof bruto.contextPackId === 'string' ? { contextPackId: bruto.contextPackId } : {}),
        ...(bruto.diagnostico === true ? { diagnostico: true } : {})
      }

      // Sem prompt no log: o texto do usuário é conteúdo, e o canal registra o fato da
      // chamada, não o que ela diz.
      log.ipc.info('Chamada de IA solicitada pela interface', {
        canal: IPC_CHANNELS.aiCall,
        direction: 'in',
        provider: pedido.provider ?? null,
        taskType: pedido.taskType ?? null
      })

      const stream = deps.ai.call(pedido, { userId: deps.userId(), workspace })
      const iterador = stream[Symbol.asyncIterator]()

      // O primeiro evento é consumido aqui para descobrir o `id` que o serviço gerou — é ele
      // que o renderer usa para casar os chunks. Consumir e **reemitir** (em vez de descartar)
      // é o que impede o primeiro pedaço de texto de sumir quando a resposta é curta.
      const primeiro = await iterador.next()
      if (primeiro.done === true) return undefined

      const id = primeiro.value.id

      // O bombeamento roda **solto**, sem `await`: o `invoke` tem de devolver o handle agora
      // para que o renderer assine os eventos. Esperar o stream aqui entregaria o handle
      // depois da resposta inteira — que é exatamente o oposto de streaming.
      void (async () => {
        try {
          let evento: IteratorResult<AiStreamEvent> = primeiro
          while (evento.done !== true) {
            // A janela pode ter fechado no meio do stream. `isDestroyed` antes de cada envio
            // porque `send` num `webContents` morto lança — e derrubaria o bombeamento.
            if (event.sender.isDestroyed()) break
            event.sender.send(IPC_EVENT_CHANNELS.aiStreamEvent, evento.value)
            evento = await iterador.next()
          }
        } catch (erro) {
          log.ai.error('Falha ao bombear o stream de IA para o renderer', {
            correlationId: id,
            direction: 'out',
            stack: erro instanceof Error ? erro.stack : undefined
          })
        }
      })()

      // O handle carrega **só o que o handler sabe**. Com roteamento por `taskType`, quem
      // atende é decidido dentro do serviço, depois deste retorno — afirmar um provider aqui
      // seria prever a escolha, e a previsão erraria toda vez que houvesse fallback. O
      // provider realmente usado chega no `CostEvent` do evento `fim`.
      return {
        id,
        ...(pedido.provider === undefined ? {} : { provider: pedido.provider }),
        ...(pedido.provider !== undefined && pedido.model === undefined
          ? { model: MODELO_PADRAO[pedido.provider] }
          : {}),
        ...(pedido.model === undefined ? {} : { model: pedido.model })
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.aiCancel, (_event, id: unknown): void => {
    if (typeof id !== 'string') return
    // No-op quando a chamada já terminou: cancelar o que acabou não é erro, é corrida normal
    // entre o clique do usuário e o fim do stream.
    deps.ai.cancel(id)
  })

  // Orçamento (SPEC-Providers-03, critério 8). Leitura e edição de **limites**; a decisão do
  // gate não tem canal — quem pergunta "cabe?" é o ponto único, de dentro do main.
  ipcMain.handle(IPC_CHANNELS.budgetGet, (_event, workspace: unknown): BudgetSnapshot => {
    const escopo = isWorkspaceId(workspace) ? workspace : 'noa'
    return deps.budget.snapshot({ userId: deps.userId(), workspace: escopo })
  })

  ipcMain.handle(
    IPC_CHANNELS.budgetSetLimits,
    (_event, limites: unknown, workspace: unknown): BudgetSnapshot => {
      const escopo = isWorkspaceId(workspace) ? workspace : 'noa'
      const scope = { userId: deps.userId(), workspace: escopo }

      // Validação na fronteira (CONVENTION §2): o payload do IPC é entrada externa como
      // qualquer outra. Forma errada devolve o estado corrente em vez de lançar — a tela
      // precisa continuar mostrando um orçamento, e o erro de forma é do chamador, não do
      // usuário.
      if (!isBudgetLimitsInput(limites)) {
        log.ipc.warn('Limites de orçamento descartados por não casarem com o contrato', {
          canal: IPC_CHANNELS.budgetSetLimits
        })
        return deps.budget.snapshot(scope)
      }

      try {
        return deps.budget.setLimits(scope, limites)
      } catch (erro) {
        // `BudgetInputError` é recusa de **valor** (limite negativo, limiar fora de 0–1), e
        // não de forma: o usuário digitou algo que a UI deixou passar. Devolver o estado
        // corrente mantém a tela consistente — ela mostra o que de fato vale.
        if (erro instanceof BudgetInputError) {
          log.ipc.warn('Limites de orçamento recusados', {
            canal: IPC_CHANNELS.budgetSetLimits,
            motivo: erro.message
          })
          return deps.budget.snapshot(scope)
        }
        throw erro
      }
    }
  )

  // Providers e roteamento (SPEC-Providers-04, critérios 5 e 8). Leitura de status e edição de
  // rotas/modelo. **Não há canal de seleção**: quem escolhe quem atende é o ponto único, no
  // main — um canal aqui daria ao renderer uma decisão que ele só poderia duplicar.
  ipcMain.handle(
    IPC_CHANNELS.providerStatus,
    async (_event, workspace: unknown): Promise<readonly ProviderStatus[]> => {
      const escopo = isWorkspaceId(workspace) ? workspace : 'noa'
      return await deps.routing.status({ userId: deps.userId(), workspace: escopo })
    }
  )

  /*
   * O perfil isolado do Codex (SPEC-Multi-Executor-02).
   *
   * **Nenhum destes handlers aceita segredo**, e não por validação: não há parâmetro onde ele
   * caiba. O login dispara `codex login --device-auth` e devolve a instrução que o PI segue no
   * navegador; a credencial nasce dentro do `CODEX_HOME` e este processo nunca a vê (critério 1).
   */
  ipcMain.handle(IPC_CHANNELS.codexEstado, async (): Promise<CodexProfileState> => {
    return await deps.codex.estado()
  })

  ipcMain.handle(
    IPC_CHANNELS.codexLogin,
    async (): Promise<{ readonly ok: boolean; readonly instrucao: string }> => {
      return await deps.codex.iniciarLogin()
    }
  )

  ipcMain.handle(IPC_CHANNELS.codexLogout, async (): Promise<boolean> => {
    return await deps.codex.logout()
  })

  ipcMain.handle(
    IPC_CHANNELS.codexSetModo,
    (_event, modo: unknown, habilitado: unknown): CodexBillingMode | undefined => {
      // Guard de fronteira, como `isModeloEscolhido` na M26-F02: modo inválido é recusado aqui,
      // antes de o serviço decidir qualquer coisa. E `habilitado` só é verdadeiro quando **é**
      // `true` — um valor truthy qualquer vindo do renderer não pode virar autorização de gasto.
      if (!isCodexBillingMode(modo)) return undefined
      return deps.codex.aplicarModo(modo, habilitado === true)
    }
  )

  ipcMain.handle(IPC_CHANNELS.providerModels, (_event, provider: unknown): readonly string[] => {
    if (!isAiProvider(provider)) return []
    return deps.routingRepo.modelosDisponiveis(provider)
  })

  ipcMain.handle(
    IPC_CHANNELS.providerSetModel,
    (_event, provider: unknown, modelo: unknown, workspace: unknown): boolean => {
      if (!isAiProvider(provider) || typeof modelo !== 'string') return false
      const escopo = isWorkspaceId(workspace) ? workspace : 'noa'
      return deps.routing.setModelo({ userId: deps.userId(), workspace: escopo }, provider, modelo)
    }
  )

  ipcMain.handle(IPC_CHANNELS.routingGet, (_event, workspace: unknown): RoutingPolicy => {
    const escopo = isWorkspaceId(workspace) ? workspace : 'noa'
    return deps.routing.rotas({ userId: deps.userId(), workspace: escopo })
  })

  ipcMain.handle(
    IPC_CHANNELS.routingSetRoute,
    (_event, rota: unknown, workspace: unknown): RoutingPolicy => {
      const escopo = isWorkspaceId(workspace) ? workspace : 'noa'
      const scope = { userId: deps.userId(), workspace: escopo }

      // Forma errada devolve o estado corrente em vez de lançar — a tela precisa continuar
      // mostrando rotas, e o erro de forma é do chamador, não do usuário.
      if (!isProviderRoute(rota)) {
        log.ipc.warn('Rota de provider descartada por não casar com o contrato', {
          canal: IPC_CHANNELS.routingSetRoute
        })
        return deps.routing.rotas(scope)
      }

      return deps.routing.setRota(scope, rota)
    }
  )

  /*
   * Modelo por fase (SPEC-Fases-02, criterios 2, 3 e 4).
   *
   * A fronteira recusa o par fora do catalogo **antes** de gravar, e e isso que o criterio 4
   * pede provar: nenhuma chamada sai. `isModeloEscolhido` checa conteudo e nao so forma — e o
   * que impede `{ anthropic, claude-fable-5-1 }`, que tem a forma certa e e exatamente o que a
   * decisao 4 do MVP-026 proibe.
   */
  ipcMain.handle(IPC_CHANNELS.phaseModelGet, (_event, workspace: unknown): PhaseModelPolicy => {
    const escopo = isWorkspaceId(workspace) ? workspace : 'noa'
    return deps.phaseModels.politica({ userId: deps.userId(), workspace: escopo })
  })

  ipcMain.handle(
    IPC_CHANNELS.phaseModelSet,
    (
      _event,
      fase: unknown,
      rota: unknown,
      provider: unknown,
      modelo: unknown,
      workspace: unknown
    ): PhaseModelPolicy | undefined => {
      const escopo = isWorkspaceId(workspace) ? workspace : 'noa'
      const scope = { userId: deps.userId(), workspace: escopo }

      // `isModeloEscolhido` sobre o par inteiro, e não `isAiProvider` + `typeof modelo`: só o
      // guard do par sabe que `claude-fable-5-1` é válido em `claude-code` e proibido em
      // `anthropic`. Validar os dois campos separados aceitaria a combinação que não existe.
      const par = { provider, modelo }

      if (!isFase(fase) || !isRotaComModelo(rota) || !isModeloEscolhido(par)) {
        log.ipc.warn('Modelo de fase descartado por não casar com o contrato', {
          canal: IPC_CHANNELS.phaseModelSet
        })
        return undefined
      }

      return deps.phaseModels.setModeloDaFase(scope, fase, rota, par.provider, par.modelo)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.phaseModelOverrides,
    (_event, projectId: unknown, workspace: unknown): readonly ProjectModelOverride[] => {
      if (typeof projectId !== 'string' || projectId.length === 0) return []
      const escopo = isWorkspaceId(workspace) ? workspace : 'noa'
      return deps.phaseModels.overrides({ userId: deps.userId(), workspace: escopo }, projectId)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.phaseModelSetOverride,
    (_event, override: unknown, workspace: unknown): ProjectModelOverride | undefined => {
      const escopo = isWorkspaceId(workspace) ? workspace : 'noa'

      if (!isProjectModelOverride(override)) {
        log.ipc.warn('Override de modelo descartado por não casar com o contrato', {
          canal: IPC_CHANNELS.phaseModelSetOverride
        })
        return undefined
      }

      return deps.phaseModels.setOverrideDoProjeto(
        { userId: deps.userId(), workspace: escopo },
        override
      )
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.phaseModelClearOverride,
    (_event, projectId: unknown, fase: unknown, rota: unknown, workspace: unknown): boolean => {
      const escopo = isWorkspaceId(workspace) ? workspace : 'noa'

      if (typeof projectId !== 'string' || !isFase(fase) || !isRotaComModelo(rota)) return false

      return deps.phaseModels.removerOverride(
        { userId: deps.userId(), workspace: escopo },
        projectId,
        fase,
        rota
      )
    }
  )

  // Console da geração (SPEC-Fases-03, critério 6). Dois canais de leitura: a lista das gerações
  // de uma etapa e os eventos de uma delas. O escopo vem do main (`deps.userId()`), nunca do
  // pedido — o renderer não escolhe de quem é a trilha que lê.
  ipcMain.handle(
    IPC_CHANNELS.generationHistory,
    (
      _event,
      projectId: unknown,
      etapa: unknown,
      workspace: unknown
    ): readonly GenerationTrace[] => {
      if (typeof projectId !== 'string' || projectId.length === 0 || !isEtapa(etapa)) return []
      const escopo = isWorkspaceId(workspace) ? workspace : 'noa'

      return deps.generationTraces.historico(
        { userId: deps.userId(), workspace: escopo },
        projectId,
        etapa
      )
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.generationEvents,
    (_event, traceId: unknown, workspace: unknown): readonly GenerationEvent[] => {
      if (typeof traceId !== 'string' || traceId.length === 0) return []
      const escopo = isWorkspaceId(workspace) ? workspace : 'noa'

      return deps.generationTraces.eventos({ userId: deps.userId(), workspace: escopo }, traceId)
    }
  )

  // Conectores (SPEC-Conectores-01, critérios 5 e 6). **Dois canais, nenhum genérico**: listar
  // o que os adapters declaram, e executar uma dessas operações. Não existe canal que receba
  // URL — a diferença entre este par e um proxy HTTP é que o renderer nomeia uma operação de
  // uma lista fechada, e quem sabe que endereço isso vira é o adapter, no main.
  ipcMain.handle(IPC_CHANNELS.connectorsCapabilities, (): readonly ConnectorCapability[] =>
    deps.connectors.capabilities()
  )

  ipcMain.handle(
    IPC_CHANNELS.connectorsInvoke,
    async (_event, request: unknown, workspace: unknown): Promise<ConnectorOutcome> => {
      const escopo = isWorkspaceId(workspace) ? workspace : 'noa'

      // Forma errada vira `ConnectorError` em vez de exceção, pelo mesmo motivo que o desfecho
      // do serviço é união discriminada: o renderer precisa **mostrar** a recusa, e um throw
      // atravessando o IPC chega como erro genérico sem código estável para tratar.
      if (!isConnectorRequest(request)) {
        log.ipc.warn('Pedido a conector descartado por não casar com o contrato', {
          canal: IPC_CHANNELS.connectorsInvoke
        })

        return {
          ok: false,
          code: 'validacao-invalida',
          mensagem: 'O pedido não casa com o contrato de conectores.',
          retryable: false,
          acao: 'corrigir-entrada',
          provenance: {
            connector: 'github',
            operation: 'desconhecida',
            obtidoEm: new Date().toISOString()
          }
        }
      }

      log.ipc.info('Chamada a conector solicitada pela interface', {
        correlationId: request.correlationId,
        canal: IPC_CHANNELS.connectorsInvoke,
        connector: request.connector,
        operation: request.operation
      })

      return await deps.connectors.call(request, { userId: deps.userId(), workspace: escopo })
    }
  )

  // Teto de créditos por conector (SPEC-Conectores-02, critério 8). Leitura e edição; **nenhum
  // canal decide** se a chamada cabe — isso é do gate, no ponto único.
  ipcMain.handle(
    IPC_CHANNELS.connectorCreditsGet,
    (_event, connector: unknown, workspace: unknown): ConnectorCreditView | undefined => {
      if (!isConnectorId(connector)) return undefined
      const escopo = isWorkspaceId(workspace) ? workspace : 'noa'
      return deps.connectorCredits.snapshot({ userId: deps.userId(), workspace: escopo }, connector)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.connectorCreditsSetLimits,
    (
      _event,
      connector: unknown,
      limites: unknown,
      workspace: unknown
    ): ConnectorCreditView | undefined => {
      if (!isConnectorId(connector)) return undefined
      const escopo = isWorkspaceId(workspace) ? workspace : 'noa'
      const scope = { userId: deps.userId(), workspace: escopo }

      const valores = limites as { dailyLimit?: unknown; monthlyLimit?: unknown } | null
      if (
        valores === null ||
        typeof valores?.dailyLimit !== 'number' ||
        typeof valores?.monthlyLimit !== 'number'
      ) {
        log.ipc.warn('Teto de créditos descartado por não casar com o contrato', {
          canal: IPC_CHANNELS.connectorCreditsSetLimits
        })
        return deps.connectorCredits.snapshot(scope, connector)
      }

      try {
        return deps.connectorCredits.setLimits(scope, connector, {
          dailyLimit: valores.dailyLimit,
          monthlyLimit: valores.monthlyLimit
        })
      } catch (erro) {
        // Entrada inválida devolve o estado corrente em vez de lançar — como o
        // `setBudgetLimits`: a tela precisa continuar mostrando um teto, e o erro de forma é do
        // chamador, não do usuário.
        if (erro instanceof CreditInputError) {
          log.ipc.warn('Teto de créditos recusado', {
            canal: IPC_CHANNELS.connectorCreditsSetLimits,
            motivo: erro.message
          })
          return deps.connectorCredits.snapshot(scope, connector)
        }
        throw erro
      }
    }
  )

  // Credenciais de conector (SPEC-Conectores-05, critério 7). Trio irmão do de credenciais de
  // IA, com as mesmas duas garantias: o retorno nunca carrega valor, e o ator é **fixo em
  // `usuario`** — deixá-lo vir do renderer daria ao agente uma forma de se declarar usuário e
  // escapar da classificação de alto risco.
  ipcMain.handle(
    IPC_CHANNELS.connectorCredentialList,
    (_event, workspace: unknown): readonly ConnectorCredentialStatusView[] => {
      if (!isWorkspaceId(workspace)) return []
      return deps.credentials.listConnectorStatus(deps.userId(), workspace)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.connectorCredentialSet,
    (
      _event,
      key: unknown,
      value: unknown,
      workspace: unknown
    ): readonly ConnectorCredentialStatusView[] => {
      if (!isWorkspaceId(workspace) || !isConnectorCredentialKey(key)) return []

      // Valor vazio é ausência de entrada, não "gravar string vazia": gravá-la deixaria a
      // credencial `present` com um valor que a Tavily recusaria. Vira no-op.
      const segredo = typeof value === 'string' ? value.trim() : ''
      if (segredo.length === 0)
        return deps.credentials.listConnectorStatus(deps.userId(), workspace)

      // A credencial gerida por Device Flow não entra por aqui — gravar um texto colado por
      // cima do par access/refresh quebraria o refresh em silêncio. O serviço também recusa;
      // a guarda aqui evita a exceção atravessar o IPC como falha genérica.
      if (key === 'github') {
        log.ipc.warn('Credencial do GitHub recusada: ela vem do Device Flow', {
          canal: IPC_CHANNELS.connectorCredentialSet
        })
        return deps.credentials.listConnectorStatus(deps.userId(), workspace)
      }

      // Sem `ctx` com a chave: o log registra o fato e o conector, nunca o valor.
      log.integracao.info('Credencial de conector submetida pela interface', {
        canal: IPC_CHANNELS.connectorCredentialSet,
        direction: 'in',
        connector: key
      })

      return deps.credentials.setConnector(deps.userId(), workspace, key, segredo, 'usuario')
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.connectorCredentialRemove,
    (_event, key: unknown, workspace: unknown): readonly ConnectorCredentialStatusView[] => {
      if (!isWorkspaceId(workspace) || !isConnectorCredentialKey(key)) return []
      return deps.credentials.removeConnector(deps.userId(), workspace, key, 'usuario')
    }
  )

  // Autenticação do GitHub por Device Flow (SPEC-Conectores-03, critério 9).
  //
  // **Nenhum destes canais devolve token**, e a garantia é a forma do retorno:
  // `GithubAuthSnapshot` e `GithubDeviceFlowView` não têm campo onde access ou refresh token
  // caiba. É a mesma garantia estrutural do `CredentialStatusView` da M5-F01 — o renderer não
  // recebe o segredo porque não existe caminho tipado por onde ele passe.
  ipcMain.handle(
    IPC_CHANNELS.githubAuthStatus,
    (_event, workspace: unknown): GithubAuthSnapshot => {
      const escopo = isWorkspaceId(workspace) ? workspace : 'noa'
      return deps.githubAuth.snapshot({ userId: deps.userId(), workspace: escopo })
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.githubAuthStart,
    async (_event, workspace: unknown): Promise<GithubDeviceFlowView | ConnectorError> => {
      const escopo = isWorkspaceId(workspace) ? workspace : 'noa'
      log.ipc.info('Device Flow do GitHub solicitado pela interface', {
        canal: IPC_CHANNELS.githubAuthStart,
        connector: 'github'
      })
      return await deps.githubAuth.iniciar({ userId: deps.userId(), workspace: escopo })
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.githubAuthAwait,
    async (_event, workspace: unknown): Promise<GithubAuthSnapshot | ConnectorError> => {
      const escopo = isWorkspaceId(workspace) ? workspace : 'noa'
      return await deps.githubAuth.aguardarAutorizacao({ userId: deps.userId(), workspace: escopo })
    }
  )

  ipcMain.handle(IPC_CHANNELS.githubAuthCancel, (_event, workspace: unknown): void => {
    const escopo = isWorkspaceId(workspace) ? workspace : 'noa'
    deps.githubAuth.cancelar({ userId: deps.userId(), workspace: escopo })
  })

  ipcMain.handle(
    IPC_CHANNELS.githubAuthLogout,
    (_event, workspace: unknown): GithubAuthSnapshot => {
      const escopo = isWorkspaceId(workspace) ? workspace : 'noa'
      return deps.githubAuth.logout({ userId: deps.userId(), workspace: escopo })
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.githubSetClientId,
    (_event, clientId: unknown, workspace: unknown): GithubAuthSnapshot => {
      const escopo = isWorkspaceId(workspace) ? workspace : 'noa'
      // Só texto é aceito; qualquer outra coisa vira "limpar", que é voltar ao embutido. O
      // renderer é fronteira de confiança, e um objeto gravado aqui viraria `[object Object]`
      // na URL do Device Flow.
      deps.profiles.saveGithubClientId(
        deps.userId(),
        typeof clientId === 'string' ? clientId : undefined
      )
      return deps.githubAuth.snapshot({ userId: deps.userId(), workspace: escopo })
    }
  )

  // Projeto local e planejamento (SPEC-Planejamento-01, critério 8).
  //
  // A validação aqui é de **forma** (fronteira de confiança), não de política: o serviço decide
  // se o projeto pode nascer, com as checagens de nome, colisão e allowlist. Repetir a decisão
  // aqui criaria uma segunda fonte — e duas fontes divergem.
  //
  // Nenhum destes canais recebe comando: a UI pede *projeto* e *marco*, e o Git é consequência
  // disso no main, pelo terminal controlado (decisão 2 do PI).
  ipcMain.handle(IPC_CHANNELS.projectList, (_event, workspace: unknown): readonly Project[] => {
    if (!isWorkspaceId(workspace)) return []
    return deps.projects.list(workspace)
  })

  ipcMain.handle(
    IPC_CHANNELS.projectCreate,
    (_event, nome: unknown, workspace: unknown, diretorioBase: unknown): ProjectOutcome => {
      if (!isWorkspaceId(workspace)) {
        throw new Error('Workspace inválido.')
      }

      // `diretorioBase` ausente é o caminho comum e **correto**: o projeto nasce sob o
      // diretório do app (decisão 1 do PI). Um valor não-string vira ausência em vez de erro —
      // o default é seguro por construção, e recusar aqui só trocaria um caminho permitido por
      // uma mensagem técnica.
      const base = typeof diretorioBase === 'string' && diretorioBase ? diretorioBase : undefined

      return deps.projects.criar(typeof nome === 'string' ? nome : '', workspace, base)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.projectImport,
    (_event, diretorio: unknown, workspace: unknown, nomeSugerido: unknown): ProjectOutcome => {
      if (!isWorkspaceId(workspace)) {
        throw new Error('Workspace inválido.')
      }

      const nome = typeof nomeSugerido === 'string' ? nomeSugerido : undefined
      return deps.projects.importar(typeof diretorio === 'string' ? diretorio : '', workspace, nome)
    }
  )

  // Seletor nativo de pasta para importar. Mesma razão do `allowlist:pick`: escolher caminho é
  // tocar o filesystem, e a fronteira do ARCHITECTURE não abre exceção para leitura. **Não**
  // adiciona à allowlist — importar não amplia permissão (critério 7); o serviço recusa depois
  // se a pasta escolhida estiver fora, com a ação concreta na mensagem.
  ipcMain.handle(IPC_CHANNELS.projectPickDirectory, async (): Promise<string> => {
    const escolha = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    const [diretorio] = escolha.filePaths
    return !escolha.canceled && diretorio ? diretorio : ''
  })

  ipcMain.handle(
    IPC_CHANNELS.projectRename,
    (_event, projectId: unknown, nome: unknown, workspace: unknown): ProjectOutcome => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') {
        throw new Error('Parâmetros inválidos para renomear projeto.')
      }
      return deps.projects.renomear(projectId, typeof nome === 'string' ? nome : '', workspace)
    }
  )

  // Desregistra sem tocar o disco. A ausência de qualquer opção de apagar arquivo é o desenho,
  // não uma lacuna: apagar pasta do usuário é operação destrutiva, e destrutivo pertence ao
  // fluxo de aprovação humana — não a um parâmetro opcional deste canal.
  ipcMain.handle(
    IPC_CHANNELS.projectRemove,
    (_event, projectId: unknown, workspace: unknown): boolean => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') return false
      return deps.projects.remover(projectId, workspace)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.projectSession,
    (_event, projectId: unknown, workspace: unknown): PlanningSession | null => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') return null
      return deps.projects.abrirSessao(projectId, workspace) ?? null
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.projectSaveAnswers,
    (
      _event,
      projectId: unknown,
      etapa: unknown,
      respostas: unknown,
      workspace: unknown
    ): PlanningSession | null => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') return null

      const mapa =
        typeof respostas === 'object' && respostas !== null
          ? (respostas as Record<string, unknown>)
          : {}

      return (
        deps.projects.salvarRespostas(
          projectId,
          typeof etapa === 'string' ? etapa : 'inicio',
          mapa,
          workspace
        ) ?? null
      )
    }
  )

  // O único gatilho de commit. `marco` é validado contra o enum fechado **antes** de chegar ao
  // serviço: a mensagem de commit é derivada dele, e um valor livre produziria um commit com
  // mensagem `undefined` num repositório do usuário.
  ipcMain.handle(
    IPC_CHANNELS.projectCompleteMilestone,
    (_event, projectId: unknown, marco: unknown, workspace: unknown): MarcoOutcome | null => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string' || !isMarcoDocumental(marco)) {
        return null
      }
      return deps.projects.concluirMarco(projectId, marco, workspace) ?? null
    }
  )

  // O wizard orientado (SPEC-Planejamento-03). Como nos demais, o handler valida **forma** na
  // fronteira e não decide política: se a pergunta existe, se a escolha é opção real e se a
  // delegação é permitida são perguntas do serviço, que as responde contra o catálogo. Repetir
  // a validação aqui criaria uma segunda fonte que divergiria da primeira na primeira pergunta
  // nova.
  ipcMain.handle(
    IPC_CHANNELS.wizardState,
    (_event, projectId: unknown, workspace: unknown): VistaDoWizard | null => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') return null

      const estado = deps.wizard.estado(projectId)
      if (estado === undefined) return null

      return { estado, historico: deps.wizard.historico(projectId) }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.wizardAnswer,
    (_event, projectId: unknown, resposta: unknown, workspace: unknown): RespostaOutcome => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') {
        return { reason: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
      }

      const bruta = typeof resposta === 'object' && resposta !== null ? resposta : {}
      const { perguntaId, escolha, texto, autor, aceitarSubstituicao } = bruta as Record<
        string,
        unknown
      >

      if (typeof perguntaId !== 'string') {
        return { reason: 'pergunta-desconhecida', mensagem: 'Pergunta desconhecida.' }
      }

      return deps.wizard.responder(
        projectId,
        {
          perguntaId,
          escolha: typeof escolha === 'string' ? escolha : null,
          texto: typeof texto === 'string' ? texto : null,
          // Autor fora do contrato vira `pi` — o valor que **não** ganha o passe da delegação.
          // Cair para `agente` deixaria um renderer comprometido gravar decisão como se fosse
          // delegada, e a delegação é justamente o caminho que não aprova gate.
          autor: isAutorDaDecisao(autor) ? autor : 'pi',
          aceitarSubstituicao: aceitarSubstituicao === true
        },
        workspace
      )
    }
  )

  // O pacote estrutural (SPEC-Planejamento-04). O handler valida **forma** e não decide nada:
  // se as decisões bastam, se a pesquisa saiu e se a evidência sustenta são perguntas do
  // serviço. Repetir a política aqui criaria uma segunda fonte que divergiria da primeira.
  ipcMain.handle(
    IPC_CHANNELS.pacoteGerar,
    async (
      _event,
      projectId: unknown,
      consulta: unknown,
      workspace: unknown
    ): Promise<PacoteOutcome> => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') {
        return { reason: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
      }
      return await deps.pacotes.gerar(
        { projectId, consulta: typeof consulta === 'string' ? consulta : '' },
        workspace
      )
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.pacoteListar,
    (_event, projectId: unknown): readonly PacoteEstrutural[] =>
      typeof projectId === 'string' ? deps.pacotes.listar(projectId) : []
  )

  // Roadmap e gates (SPEC-Planejamento-06). O gate mora no serviço; o handler valida a forma na
  // fronteira e não decide nada — repetir a política aqui criaria uma segunda fonte.
  ipcMain.handle(
    IPC_CHANNELS.roadmapCarregar,
    (_event, projectId: unknown, workspace: unknown): Roadmap => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') {
        return { mvps: [], slices: [] }
      }
      return deps.roadmap.carregar(projectId, workspace)
    }
  )

  /**
   * O roadmap gerado por IA (SPEC-Jornada-05). Quatro canais, como o contrato descreve: propor,
   * ler, escolher o MVP e responder as perguntas da SPEC.
   *
   * A fronteira valida **forma**, não vocabulário: um id de MVP desconhecido atravessa e o
   * serviço recusa com `mvp-inelegivel`. Barrar aqui duplicaria a lista de MVPs em dois lugares
   * que divergiriam — a mesma decisão que a M25-F01 tomou com os eventos da jornada.
   */
  ipcMain.handle(
    IPC_CHANNELS.roadmapGerarPorIa,
    async (_event, projectId: unknown, workspace: unknown): Promise<RoadmapGeradoOutcome> => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') {
        return { resultado: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
      }
      return await deps.roadmapGerado.gerar(projectId, workspace)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.roadmapCarregarGerado,
    (_event, projectId: unknown, workspace: unknown): RoadmapRegistrado | null => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') return null
      return deps.roadmapGerado.carregar(projectId) ?? null
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.roadmapElegiveis,
    (_event, projectId: unknown, workspace: unknown): readonly MvpGerado[] => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') return []
      return deps.roadmapGerado.elegiveis(projectId)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.roadmapEscolherMvp,
    async (
      _event,
      projectId: unknown,
      mvpId: unknown,
      workspace: unknown
    ): Promise<RoadmapGeradoOutcome> => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string' || typeof mvpId !== 'string') {
        return { resultado: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
      }
      return await deps.roadmapGerado.escolherMvp(projectId, mvpId, workspace)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.roadmapResponderPergunta,
    (
      _event,
      projectId: unknown,
      perguntaId: unknown,
      resposta: unknown,
      workspace: unknown
    ): RoadmapGeradoOutcome => {
      if (
        !isWorkspaceId(workspace) ||
        typeof projectId !== 'string' ||
        typeof perguntaId !== 'string' ||
        typeof resposta !== 'string'
      ) {
        return { resultado: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
      }
      return deps.roadmapGerado.responderPergunta(projectId, perguntaId, resposta, workspace)
    }
  )

  /**
   * A jornada de planejamento (SPEC-Jornada-01).
   *
   * **Três canais, e nenhum recebe uma etapa.** É o critério 1 na fronteira: a única escrita é
   * por evento nomeado, e o serviço recusa o que não reconhece. Um handler que aceitasse a
   * etapa deixaria o renderer declarar onde o projeto está — decisão que é do main, que tem os
   * fatos.
   */
  ipcMain.handle(
    IPC_CHANNELS.jornadaEstado,
    (_event, projectId: unknown, workspace: unknown): EstadoDaJornada | null => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') return null
      return deps.jornada.estado(projectId, workspace) ?? null
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.jornadaEstadoDeVarios,
    (_event, projectIds: unknown, workspace: unknown): readonly EstadoDaJornada[] => {
      if (!isWorkspaceId(workspace) || !Array.isArray(projectIds)) return []
      // Filtra a forma antes de agir: um id que não é string chegaria à consulta do banco, e a
      // ponte valida forma em todo handler pela mesma razão — o renderer é processo que pode
      // ser comprometido.
      const ids = projectIds.filter((id): id is string => typeof id === 'string')
      return deps.jornada.estadoDeVarios(ids, workspace)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.jornadaResumoDeVarios,
    async (
      _event,
      projectIds: unknown,
      workspace: unknown
    ): Promise<readonly ResumoDoProjeto[]> => {
      if (!isWorkspaceId(workspace) || !Array.isArray(projectIds)) return []
      const ids = projectIds.filter((id): id is string => typeof id === 'string')
      return deps.jornada.resumoDeVarios(ids, workspace, await deps.estadoDasRotas(workspace))
    }
  )

  /**
   * Aplica um evento. Devolve o desfecho **inclusive na recusa**: "este evento sai de outra
   * etapa" é resposta legítima que a tela mostra, não erro a rejeitar.
   */
  ipcMain.handle(
    IPC_CHANNELS.jornadaEvento,
    (_event, projectId: unknown, evento: unknown, workspace: unknown): TransicaoOutcome | null => {
      if (
        !isWorkspaceId(workspace) ||
        typeof projectId !== 'string' ||
        typeof evento !== 'string'
      ) {
        return null
      }
      return deps.jornada.aplicarEvento(projectId, evento, workspace) ?? null
    }
  )

  /**
   * O prompt e o brief (SPEC-Jornada-02).
   *
   * **Nenhum handler recebe afirmação nem texto de brief.** O renderer pede o ato; o conteúdo é
   * produzido e validado no main. Um canal que aceitasse o brief pronto seria o caminho por onde
   * uma afirmação sem origem entraria — o que os critérios 3 e 4 existem para impedir.
   */
  ipcMain.handle(
    IPC_CHANNELS.briefSalvarPrompt,
    (_event, projectId: unknown, texto: unknown, workspace: unknown): PromptDoProjeto | null => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string' || typeof texto !== 'string') {
        return null
      }
      return deps.brief.salvarPrompt(projectId, texto, workspace) ?? null
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.briefLerPrompt,
    (_event, projectId: unknown, workspace: unknown): PromptDoProjeto | null => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') return null
      return deps.brief.lerPrompt(projectId) ?? null
    }
  )

  /**
   * Gera o brief. Devolve o desfecho **inclusive nas recusas**: "nenhuma rota autorizada" é
   * resposta legítima que o PI lê com a ação nomeada, não erro a rejeitar.
   */
  ipcMain.handle(
    IPC_CHANNELS.briefGerar,
    async (_event, projectId: unknown, workspace: unknown): Promise<GeracaoOutcome> => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') {
        return { resultado: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
      }
      return await deps.brief.gerarBrief(projectId, workspace)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.briefCarregar,
    (_event, projectId: unknown, workspace: unknown): BriefRegistrado | null => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') return null
      return deps.brief.carregar(projectId) ?? null
    }
  )

  /** A rota que seria usada agora, sem gerar. É o que deixa a tela mostrar o bloqueio antes. */
  ipcMain.handle(
    IPC_CHANNELS.briefRota,
    async (_event, projectId: unknown, workspace: unknown): Promise<ResultadoDaRota> => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') {
        return {
          decisao: 'bloqueado',
          motivo: 'sem-rota-alguma',
          acao: 'Projeto não encontrado.'
        }
      }
      return await deps.brief.rotaAtual(projectId, workspace)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.briefCortarProposto,
    (
      _event,
      projectId: unknown,
      afirmacaoId: unknown,
      workspace: unknown
    ): BriefRegistrado | null => {
      if (
        !isWorkspaceId(workspace) ||
        typeof projectId !== 'string' ||
        typeof afirmacaoId !== 'string'
      ) {
        return null
      }
      return deps.brief.cortarProposto(projectId, afirmacaoId, workspace) ?? null
    }
  )

  /**
   * O PRD, o Landscape e a Convention (SPEC-Jornada-03).
   *
   * **Propor o termo e gerar são handlers separados**, e é o critério 3 na fronteira: a pesquisa
   * só roda com o termo que o PI confirmou. Um handler único faria a chamada à Tavily acontecer
   * antes de o PI ver o que seria buscado — e gastaria crédito numa busca que ele talvez
   * recusasse.
   *
   * **Nenhum handler recebe afirmação nem texto de documento**, mesma postura dos do brief.
   */
  ipcMain.handle(
    IPC_CHANNELS.prdProporTermo,
    async (_event, projectId: unknown, workspace: unknown): Promise<string | null> => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') return null
      return (await deps.prd.proporTermo(projectId, workspace)) ?? null
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.prdGerar,
    async (_event, projectId: unknown, termo: unknown, workspace: unknown): Promise<PrdOutcome> => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') {
        return { resultado: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
      }

      // Termo não textual vira string vazia, que é o caminho legítimo de "gerar sem pesquisa":
      // rejeitar aqui trataria como erro o que o critério 4 define como desfecho válido.
      return await deps.prd.gerar(
        { projectId, termo: typeof termo === 'string' ? termo : '' },
        workspace
      )
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.prdCarregar,
    (_event, projectId: unknown, workspace: unknown): PrdRegistrado | null => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') return null
      return deps.prd.carregar(projectId) ?? null
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.prdCortarProposto,
    (
      _event,
      projectId: unknown,
      afirmacaoId: unknown,
      workspace: unknown
    ): PrdRegistrado | null => {
      if (
        !isWorkspaceId(workspace) ||
        typeof projectId !== 'string' ||
        typeof afirmacaoId !== 'string'
      ) {
        return null
      }
      return deps.prd.cortarProposto(projectId, afirmacaoId, workspace) ?? null
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.prdContradicoes,
    (_event, projectId: unknown, workspace: unknown): VistaDoWizard | null => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') return null
      return deps.prd.contradicoes(projectId) ?? null
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.prdResponderContradicao,
    (_event, projectId: unknown, resposta: unknown, workspace: unknown): RespostaOutcome => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') {
        return { reason: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
      }

      const lida = lerResposta(resposta)
      if (lida === undefined) {
        return { reason: 'escolha-invalida', mensagem: 'Resposta com forma inválida.' }
      }

      return deps.prd.responderContradicao(projectId, lida, workspace)
    }
  )

  /*
   * A arquitetura, as decisões, os testes e a revisão gerados por IA (SPEC-Jornada-04).
   *
   * O gate de anexos, o validador de âncora e a análise de coerência moram no serviço; o handler
   * valida a forma do pedido na fronteira e não decide nada — duplicar a política aqui criaria
   * uma segunda fonte que divergiria da primeira.
   */
  ipcMain.handle(
    IPC_CHANNELS.arquiteturaGerarPorIa,
    async (_event, projectId: unknown, workspace: unknown): Promise<ArquiteturaGeradaOutcome> => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') {
        return { resultado: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
      }
      return await deps.arquitetura.gerar(projectId, workspace)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.arquiteturaCarregar,
    (_event, projectId: unknown, workspace: unknown): ArquiteturaRegistrada | null => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') return null
      return deps.arquitetura.carregar(projectId) ?? null
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.arquiteturaCortarProposto,
    (
      _event,
      projectId: unknown,
      afirmacaoId: unknown,
      workspace: unknown
    ): ArquiteturaRegistrada | null => {
      if (
        !isWorkspaceId(workspace) ||
        typeof projectId !== 'string' ||
        typeof afirmacaoId !== 'string'
      ) {
        return null
      }
      return deps.arquitetura.cortarProposto(projectId, afirmacaoId, workspace) ?? null
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.arquiteturaDescartarAjuste,
    (
      _event,
      projectId: unknown,
      ajusteId: unknown,
      workspace: unknown
    ): ArquiteturaRegistrada | null => {
      if (
        !isWorkspaceId(workspace) ||
        typeof projectId !== 'string' ||
        typeof ajusteId !== 'string'
      ) {
        return null
      }
      return deps.arquitetura.descartarAjuste(projectId, ajusteId, workspace) ?? null
    }
  )

  /**
   * O refinamento por perguntas geradas (SPEC-Jornada-02).
   *
   * **Nenhum handler recebe o enunciado da pergunta.** A pergunta vive no banco desde que foi
   * gerada; aceitá-la de volta deixaria o renderer reescrever o que o PI leu, e a decisão
   * gravada citaria uma pergunta que talvez nunca tenha sido feita.
   */
  ipcMain.handle(
    IPC_CHANNELS.refinamentoGerar,
    async (_event, projectId: unknown, workspace: unknown): Promise<GeracaoDePerguntasOutcome> => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') {
        return { resultado: 'sem-prompt', mensagem: 'Projeto não encontrado.' }
      }
      return await deps.refinamento.gerarPerguntas(projectId, workspace)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.refinamentoEstado,
    (_event, projectId: unknown, workspace: unknown): EstadoDoWizard | null => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') return null
      return deps.refinamento.estado(projectId) ?? null
    }
  )

  /**
   * Registra a resposta. A **forma** é validada aqui; o vocabulário (a escolha ser uma opção
   * real, a delegação ser permitida) é do serviço — barrar aqui duplicaria a regra em dois
   * lugares que divergiriam.
   */
  ipcMain.handle(
    IPC_CHANNELS.refinamentoResponder,
    (_event, projectId: unknown, resposta: unknown, workspace: unknown): RespostaOutcome => {
      const invalida: RespostaOutcome = {
        reason: 'projeto-inexistente',
        mensagem: 'Projeto não encontrado.'
      }
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') return invalida

      const lida = lerResposta(resposta)
      if (lida === undefined) {
        return { reason: 'escolha-invalida', mensagem: 'Resposta com forma inválida.' }
      }

      return deps.refinamento.responder(projectId, lida, workspace)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.refinamentoHistorico,
    (_event, projectId: unknown, workspace: unknown): readonly Decision[] => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') return []
      return deps.refinamento.historico(projectId)
    }
  )

  /**
   * SPEC-Entrega-01: publica o repositório e o backlog aprovado.
   *
   * Valida a **forma** do alvo antes de agir, como todo handler desta ponte: o renderer é um
   * processo que pode ser comprometido, e um `owner` que não é string chegaria à URL do push. O que
   * ele **não** escolhe é o conteúdo — as issues saem do que o PI aprovou para a fila, lido aqui.
   */
  ipcMain.handle(
    IPC_CHANNELS.publicacaoPublicar,
    async (
      _event,
      projectId: unknown,
      alvo: unknown,
      workspace: unknown
    ): Promise<PublicacaoOutcome> => {
      const invalido: PublicacaoOutcome = { reason: 'projeto-inexistente', criados: 0 }
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') return invalido

      const a = alvo as Partial<AlvoDaPublicacao> | null
      if (
        a === null ||
        typeof a !== 'object' ||
        typeof a.owner !== 'string' ||
        typeof a.repo !== 'string' ||
        typeof a.origem !== 'string'
      ) {
        return invalido
      }

      return await deps.publicacao.publicar(projectId, workspace, {
        owner: a.owner,
        repo: a.repo,
        origem: a.origem
      })
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.filaVista,
    (_event, projectId: unknown, workspace: unknown): VistaDaFila => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') {
        return { ativos: [], concluidas: [], bloqueadas: [] }
      }
      return deps.fila.vista(projectId, workspace)
    }
  )

  /**
   * O estado do sandbox (SPEC-Entrega-03). Só leitura: responde "a máquina está pronta?" sem
   * preparar nada — preparar é ato da pipeline, nunca do renderer.
   */
  ipcMain.handle(IPC_CHANNELS.sandboxEstado, () => deps.preflight.estado(app.getAppPath()))

  /**
   * A prova de um run encerrado (SPEC-Entrega-06, critério 7).
   *
   * O `userId` vem da sessão no main, nunca do renderer: um `userId` atravessando a ponte
   * deixaria a UI ler o ledger de outro usuário só pedindo. Mesma postura de todo handler
   * escopado desta base.
   */
  ipcMain.handle(
    IPC_CHANNELS.ledgerDoRun,
    (_event, runId: unknown): ExecutionLedger | undefined => {
      if (typeof runId !== 'string' || runId === '') return undefined
      return deps.executionLedger.buscar(deps.userId(), runId)
    }
  )

  /** O que a limpeza não removeu e segue reconciliável (SPEC-Entrega-06, critério 5). */
  ipcMain.handle(IPC_CHANNELS.limpezaPendencias, (): readonly PendenciaDeLimpeza[] =>
    deps.executionLedger.listarPendencias(deps.userId())
  )

  /**
   * O kill-switch do merge autônomo (SPEC-Entrega-02/05).
   *
   * Como em todo handler desta base, a **forma** é validada aqui e a **decisão** mora no serviço:
   * repetir a regra de identidade neste ponto criaria uma segunda fonte da política.
   */
  ipcMain.handle(
    IPC_CHANNELS.mergePolicyLer,
    (_event, projectId: unknown, workspace: unknown): PoliticaDeMerge => {
      // Forma inválida devolve o default ligado — o mesmo que um projeto sem decisão registrada.
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') return { autonomo: true }
      return deps.mergePolicy.politica(projectId)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.mergePolicyDefinir,
    (_event, projectId: unknown, autonomo: unknown, workspace: unknown): MergePolicyOutcome => {
      if (
        !isWorkspaceId(workspace) ||
        typeof projectId !== 'string' ||
        typeof autonomo !== 'boolean'
      ) {
        return { reason: 'sem-mudanca', mensagem: 'Pedido inválido.' }
      }
      return deps.mergePolicy.definir(projectId, workspace, autonomo)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.aprovacaoListar,
    (_event, projectId: unknown, workspace: unknown): readonly Approval[] => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') return []
      return deps.roadmap.aprovacoes(projectId, workspace)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.aprovacaoRevisoes,
    (_event, projectId: unknown, gate: unknown, workspace: unknown): readonly RevisaoAprovada[] => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string' || !isGate(gate)) return []
      return deps.roadmap.revisoesDoGate(projectId, gate, workspace)
    }
  )

  // **A identidade não vem por parâmetro**: o serviço a lê da sessão autenticada. Um parâmetro
  // aqui deixaria o renderer declarar quem aprovou — e o critério 4 pergunta exatamente isso.
  ipcMain.handle(
    IPC_CHANNELS.aprovacaoAprovar,
    (_event, projectId: unknown, gate: unknown, workspace: unknown): AprovacaoOutcome => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') {
        return { reason: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
      }
      if (!isGate(gate)) {
        return { reason: 'sem-revisoes', mensagem: 'Gate desconhecido.' }
      }
      return deps.roadmap.aprovar(projectId, gate, workspace)
    }
  )

  // O painel de marcos (SPEC-Fases-04). Leitura pura: nenhuma escrita no Git sai daqui — o botão
  // "Commitar marco" da tela usa `projectCompleteMilestone`, a retomada da M8-F01.
  ipcMain.handle(
    IPC_CHANNELS.marcosVista,
    (_event, projectId: unknown, workspace: unknown): VistaDeMarcos => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') {
        return {
          disponivel: false,
          linhas: [],
          repositorio: { sujos: [], headInterrompido: false, head: '' },
          mensagem: 'Projeto não encontrado.'
        }
      }
      return deps.marcos.vista(projectId, workspace)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.aprovacaoSimular,
    (_event, projectId: unknown, mudancas: unknown, workspace: unknown): readonly Gate[] => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') return []
      if (!Array.isArray(mudancas)) return []

      // A natureza vem do renderer, então é validada aqui — e o **default é `semantica`**:
      // uma natureza que não reconhecemos tem de invalidar, não passar. Fechar para o lado
      // seguro é a mesma postura do `autor` desconhecido virando `agente` na M8-F03.
      const validadas: MudancaDeArtefato[] = mudancas
        .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
        .filter((m) => typeof m.artefato === 'string' && typeof m.hashNovo === 'string')
        .map((m) => ({
          artefato: m.artefato as string,
          hashNovo: m.hashNovo as string,
          natureza:
            typeof m.natureza === 'string' &&
            (NATUREZAS as readonly string[]).includes(m.natureza) &&
            m.natureza === 'cosmetica'
              ? 'cosmetica'
              : 'semantica'
        }))

      return deps.roadmap.simularMudanca(projectId, validadas, workspace)
    }
  )

  // Anexos de design (SPEC-Planejamento-05). O gate mora no serviço; o handler valida a forma na
  // fronteira e não decide nada — repetir a política aqui criaria uma segunda fonte.

  // Seletor nativo de arquivo. Mesma razão do `allowlist:pick` e do `project:pick`: escolher
  // caminho é tocar o filesystem, e a fronteira do ARCHITECTURE não abre exceção para leitura.
  // **Não anexa**: devolve o caminho, e o ato que conta para o gate é o canal seguinte.
  ipcMain.handle(IPC_CHANNELS.anexoEscolher, async (_event, tipo: unknown): Promise<string> => {
    if (!isTipoDeAnexo(tipo)) return ''
    const escolha = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        {
          name: tipo,
          // Sem o ponto: o Electron espera a extensão nua no filtro.
          extensions: EXTENSOES_DO_ANEXO[tipo].map((e) => e.replace(/^\./, ''))
        }
      ]
    })
    const [caminho] = escolha.filePaths
    return !escolha.canceled && caminho ? caminho : ''
  })

  ipcMain.handle(
    IPC_CHANNELS.anexoAnexar,
    (
      _event,
      projectId: unknown,
      tipo: unknown,
      origem: unknown,
      workspace: unknown
    ): AnexoOutcome => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') {
        return { reason: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
      }
      if (!isTipoDeAnexo(tipo) || typeof origem !== 'string' || origem === '') {
        return { reason: 'tipo-incompativel', mensagem: 'Escolha um arquivo válido.' }
      }
      return deps.anexos.anexar(projectId, tipo, origem, workspace)
    }
  )

  ipcMain.handle(IPC_CHANNELS.anexoListar, (_event, projectId: unknown): readonly Anexo[] =>
    typeof projectId === 'string' ? deps.anexos.listar(projectId) : []
  )

  ipcMain.handle(
    IPC_CHANNELS.anexoRemover,
    (_event, projectId: unknown, caminho: unknown, workspace: unknown): boolean => {
      if (!isWorkspaceId(workspace) || typeof projectId !== 'string') return false
      if (typeof caminho !== 'string') return false
      return deps.anexos.remover(projectId, caminho, workspace)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.anexoValidar,
    async (_event, projectId: unknown): Promise<readonly ValidacaoDoPrototipo[]> =>
      typeof projectId === 'string' ? await deps.anexos.validar(projectId) : []
  )

  ipcMain.handle(
    IPC_CHANNELS.arquiteturaListar,
    (_event, projectId: unknown): readonly PacoteArquitetura[] =>
      typeof projectId === 'string' ? deps.anexos.listarArquiteturas(projectId) : []
  )

  // Contexto, skills e orçamento (SPEC-Planejamento-02). O gate do critério 1 mora no serviço;
  // o handler valida a forma do pedido na fronteira e não decide nada — duplicar a política
  // aqui criaria uma segunda fonte que divergiria da primeira.
  ipcMain.handle(
    IPC_CHANNELS.contextBuild,
    (_event, pedido: unknown, workspace: unknown): ContextPackOutcome => {
      if (!isWorkspaceId(workspace)) {
        throw new Error('Workspace inválido.')
      }

      const validado = parsePedidoDeContexto(pedido)
      if (validado === undefined) {
        // Recusa de forma, não de política: o pedido não casa o contrato. Desfecho e não
        // exceção, pelo mesmo motivo dos outros — a tela precisa mostrar o que houve.
        return {
          reason: 'contexto-vazio',
          mensagem: 'O pedido de contexto está incompleto. Selecione ao menos um arquivo.'
        }
      }

      return deps.contexts.montar(validado, workspace)
    }
  )

  ipcMain.handle(IPC_CHANNELS.contextList, (_event, projectId: unknown): readonly ContextPack[] => {
    if (typeof projectId !== 'string') return []
    return deps.contexts.listar(projectId)
  })

  // Sem parâmetro: as capacidades são do **ambiente**, não do projeto. E devolvem sempre a
  // lista completa — é o critério 5 valendo na fronteira também.
  ipcMain.handle(IPC_CHANNELS.contextCapabilities, (): readonly CapacidadeResolvida[] =>
    deps.contexts.capacidades()
  )

  ipcMain.handle(
    IPC_CHANNELS.contextFailures,
    (_event, projectId: unknown): readonly FalhaRegistrada[] => {
      if (typeof projectId !== 'string') return []
      return deps.contexts.listarFalhas(projectId)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.contextResolveFailure,
    (_event, projectId: unknown, fingerprint: unknown, workspace: unknown): boolean => {
      if (
        !isWorkspaceId(workspace) ||
        typeof projectId !== 'string' ||
        typeof fingerprint !== 'string'
      ) {
        return false
      }
      return deps.contexts.resolverFalha(projectId, workspace, fingerprint)
    }
  )

  // Só de ida: o renderer manda o registro, o main grava. Sem resposta de propósito —
  // esperar confirmação de log tornaria a UI refém do disco.
  ipcMain.on(IPC_SEND_CHANNELS.log, (_event, payload: unknown) => {
    const input = parseLogInput(payload)

    if (!input) {
      log.ipc.warn('Registro de log do renderer descartado por não casar com o contrato', {
        canal: IPC_SEND_CHANNELS.log
      })
      return
    }

    writeLog({ ...input, source: 'renderer' })
  })

  ipcMain.on(IPC_SEND_CHANNELS.windowMinimizeToTray, () => {
    log.ipc.info('Janela minimizada para o tray', {
      canal: IPC_SEND_CHANNELS.windowMinimizeToTray
    })
    deps.minimizeToTray()
  })
}
