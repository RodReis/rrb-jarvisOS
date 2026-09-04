import { contextBridge, ipcRenderer } from 'electron'
import {
  BRIDGE_KEY,
  IPC_CHANNELS,
  IPC_EVENT_CHANNELS,
  IPC_SEND_CHANNELS,
  type AppInfo,
  type AuditVerification,
  type ConnectorCreditLimitsInput,
  type ConnectorCreditView,
  type ContextPackRequest,
  type JarvisBridge,
  type PreferencesSnapshot,
  type WorkspaceSwitchResult
} from '@shared/contracts/ipc'
import type { AlvoDaPublicacao, PublicacaoOutcome } from '@shared/domain/publicacao'
import type { ExecutionLedger } from '@shared/domain/execution-ledger'
import type { PendenciaDeLimpeza } from '@shared/domain/limpeza'
import type { MergePolicyOutcome, PoliticaDeMerge, VistaDaFila } from '@shared/domain/pipeline'
import type { ContextPack, ContextPackOutcome, FalhaRegistrada } from '@shared/domain/context-pack'
import type { CapacidadeResolvida } from '@shared/domain/skills'
import type { AuthSnapshot } from '@shared/contracts/auth'
import type { LogInput } from '@shared/contracts/logging'
import type { PolicyContext, PolicyDecision } from '@shared/policies'
import type {
  Automation,
  AutomationInput,
  Workflow,
  WorkflowInput,
  WorkflowStatus
} from '@shared/domain/workflows'
import type { ExecutionRun } from '@shared/domain/execution'
import type { ApprovalDecision, ApprovalRequest } from '@shared/domain/execution'
import type { CommandExecution, CommandSubmission } from '@shared/domain/terminal'
import type { AiCallHandle, AiProvider, AiRequest, AiStreamEvent } from '@shared/domain/ai'
import type { ProviderRoute, ProviderStatus, RoutingPolicy } from '@shared/domain/routing'
import type { Fase } from '@shared/domain/fase'
import type { Etapa } from '@shared/domain/jornada'
import type {
  EventoDaGeracao,
  GenerationEvent,
  GenerationTrace
} from '@shared/domain/geracao'
import type {
  PhaseModelPolicy,
  ProjectModelOverride,
  RotaComModelo
} from '@shared/domain/modelo-da-fase'
import type {
  ConnectorCapability,
  ConnectorCredentialKey,
  ConnectorCredentialStatusView,
  ConnectorError,
  ConnectorId,
  ConnectorOutcome,
  ConnectorRequest
} from '@shared/domain/connectors'
import type { GithubAuthSnapshot, GithubDeviceFlowView } from '@shared/domain/github-auth'
import type {
  MarcoDocumental,
  MarcoOutcome,
  PlanningSession,
  Project,
  ProjectOutcome
} from '@shared/domain/projects'
import type {
  Decision,
  EstadoDoWizard,
  Resposta,
  RespostaOutcome,
  VistaDoWizard
} from '@shared/domain/wizard'
import type { GeracaoDePerguntasOutcome } from '@shared/domain/refinamento'
import type { PacoteEstrutural, PacoteOutcome } from '@shared/domain/pacote-estrutural'
import type { Anexo, AnexoOutcome, TipoDeAnexo } from '@shared/domain/anexos-de-design'
import type { ValidacaoDoPrototipo } from '@shared/domain/validacao-de-prototipo'
import type { PacoteArquitetura } from '@shared/domain/arquitetura'
import type { Roadmap } from '@shared/domain/roadmap'
import type {
  MvpGerado,
  RoadmapGeradoOutcome,
  RoadmapRegistrado
} from '@shared/domain/roadmap-gerado'
import type { ResumoDoProjeto } from '@shared/domain/fase'
import type { EstadoDaJornada, TransicaoOutcome } from '@shared/domain/jornada'
import type { BriefRegistrado, GeracaoOutcome, PromptDoProjeto } from '@shared/domain/brief'
import type { PrdOutcome, PrdRegistrado } from '@shared/domain/prd'
import type {
  ArquiteturaGeradaOutcome,
  ArquiteturaRegistrada
} from '@shared/domain/arquitetura-gerada'
import type { ResultadoDaRota } from '@shared/domain/rota-de-geracao'
import type {
  Approval,
  AprovacaoOutcome,
  Gate,
  MudancaDeArtefato,
  RevisaoAprovada
} from '@shared/domain/aprovacoes'
import type { CredentialKey, CredentialStatusView } from '@shared/domain/credentials'
import type { BudgetLimitsInput, BudgetSnapshot } from '@shared/domain/budget'
import type {
  AuditEvent,
  AuditEventType,
  UserPreferences,
  WorkspaceId
} from '@shared/domain/entities'

/**
 * Preload — a ponte tipada e o único ponto de contato do renderer com o main.
 *
 * Expõe métodos nomeados, nunca `ipcRenderer` cru nem um `invoke(canal, ...)` genérico:
 * um canal arbitrário deixaria o renderer alcançar qualquer handler do main, o que
 * anularia a fronteira de segurança (docs/ARCHITECTURE.md).
 */
const bridge: JarvisBridge = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC_CHANNELS.appInfo),
  // `send`, não `invoke`: o renderer não espera confirmação de gravação (ADR-005 — quem
  // escreve é o main). Aguardar o disco para logar prenderia a UI ao IO.
  sendLog: (record: LogInput): void => ipcRenderer.send(IPC_SEND_CHANNELS.log, record),

  listAuditEvents: (type?: AuditEventType): Promise<readonly AuditEvent[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.auditList, type),
  verifyAuditChain: (): Promise<AuditVerification> => ipcRenderer.invoke(IPC_CHANNELS.auditVerify),

  getWorkspace: (): Promise<WorkspaceId> => ipcRenderer.invoke(IPC_CHANNELS.workspaceGet),
  switchWorkspace: (workspace: WorkspaceId): Promise<WorkspaceSwitchResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceSwitch, workspace),

  getPreferences: (): Promise<PreferencesSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.preferencesGet),
  savePreferences: (preferences: UserPreferences): Promise<PreferencesSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.preferencesSave, preferences),

  getAuth: (): Promise<AuthSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.authGet),
  login: (): Promise<AuthSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.authLogin),
  logout: (): Promise<AuthSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.authLogout),

  onAuthChanged: (listener: (snapshot: AuthSnapshot) => void): (() => void) => {
    // O `IpcRendererEvent` fica de fora da chamada: ele carrega `sender`, um objeto do
    // Electron que não pode vazar para o renderer. O listener recebe só o snapshot.
    const wrapped = (_event: unknown, snapshot: AuthSnapshot): void => listener(snapshot)

    ipcRenderer.on(IPC_EVENT_CHANNELS.authChanged, wrapped)

    return () => ipcRenderer.removeListener(IPC_EVENT_CHANNELS.authChanged, wrapped)
  },

  minimizeToTray: (): void => ipcRenderer.send(IPC_SEND_CHANNELS.windowMinimizeToTray),

  classifyAction: (action: string, context: PolicyContext): Promise<PolicyDecision> =>
    ipcRenderer.invoke(IPC_CHANNELS.policyClassify, action, context),

  listAllowedDirectories: (): Promise<readonly string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.allowlistList),
  addAllowedDirectory: (path: string): Promise<readonly string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.allowlistAdd, path),
  removeAllowedDirectory: (path: string): Promise<readonly string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.allowlistRemove, path),
  // Sem argumento: quem escolhe o caminho é o usuário, no diálogo nativo que abre no main.
  pickAllowedDirectory: (): Promise<readonly string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.allowlistPick),
  getAppDirectory: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.allowlistAppDir),

  listWorkflows: (workspace: WorkspaceId): Promise<readonly Workflow[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.workflowList, workspace),
  createWorkflow: (input: Omit<WorkflowInput, 'user_id'>): Promise<Workflow> =>
    ipcRenderer.invoke(IPC_CHANNELS.workflowCreate, input),
  updateWorkflow: (
    id: string,
    patch: Partial<Pick<Workflow, 'name' | 'steps' | 'triggers' | 'schedule'>>
  ): Promise<Workflow | undefined> => ipcRenderer.invoke(IPC_CHANNELS.workflowUpdate, id, patch),
  setWorkflowStatus: (id: string, status: WorkflowStatus): Promise<Workflow | undefined> =>
    ipcRenderer.invoke(IPC_CHANNELS.workflowSetStatus, id, status),
  removeWorkflow: (id: string, workspace: WorkspaceId): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.workflowRemove, id, workspace),

  listAutomations: (workspace: WorkspaceId): Promise<readonly Automation[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.automationList, workspace),
  createAutomation: (input: Omit<AutomationInput, 'user_id'>): Promise<Automation> =>
    ipcRenderer.invoke(IPC_CHANNELS.automationCreate, input),
  setAutomationEnabled: (id: string, enabled: boolean): Promise<Automation | undefined> =>
    ipcRenderer.invoke(IPC_CHANNELS.automationSetEnabled, id, enabled),
  removeAutomation: (id: string, workspace: WorkspaceId): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.automationRemove, id, workspace),

  runWorkflowSimulated: (workflowId: string, workspace: WorkspaceId): Promise<ExecutionRun> =>
    ipcRenderer.invoke(IPC_CHANNELS.executionRun, workflowId, workspace),
  runWorkflowReal: (workflowId: string, workspace: WorkspaceId): Promise<ExecutionRun> =>
    ipcRenderer.invoke(IPC_CHANNELS.executionRunReal, workflowId, workspace),
  listExecutionRuns: (workspace: WorkspaceId): Promise<readonly ExecutionRun[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.executionList, workspace),
  listPendingApprovals: (workspace: WorkspaceId): Promise<readonly ApprovalRequest[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.approvalList, workspace),
  resolveApproval: (
    id: string,
    decision: ApprovalDecision
  ): Promise<ExecutionRun | CommandExecution | undefined> =>
    ipcRenderer.invoke(IPC_CHANNELS.approvalResolve, id, decision),

  runCommand: (submission: CommandSubmission, workspace: WorkspaceId): Promise<CommandExecution> =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalRun, submission, workspace),
  listAllowedCommands: (workspace: WorkspaceId): Promise<readonly string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.commandAllowlistList, workspace),
  addAllowedCommand: (binary: string, workspace: WorkspaceId): Promise<readonly string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.commandAllowlistAdd, binary, workspace),
  removeAllowedCommand: (binary: string, workspace: WorkspaceId): Promise<readonly string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.commandAllowlistRemove, binary, workspace),
  listCredentials: (workspace: WorkspaceId): Promise<readonly CredentialStatusView[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.credentialList, workspace),
  setCredential: (
    key: CredentialKey,
    value: string,
    workspace: WorkspaceId
  ): Promise<readonly CredentialStatusView[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.credentialSet, key, value, workspace),
  removeCredential: (
    key: CredentialKey,
    workspace: WorkspaceId
  ): Promise<readonly CredentialStatusView[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.credentialRemove, key, workspace),

  callAi: (request: AiRequest, workspace: WorkspaceId): Promise<AiCallHandle> =>
    ipcRenderer.invoke(IPC_CHANNELS.aiCall, request, workspace),
  cancelAi: (id: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.aiCancel, id),

  onAiStreamEvent: (listener: (evento: AiStreamEvent) => void): (() => void) => {
    // Mesmo recorte do `onAuthChanged`: o `IpcRendererEvent` fica de fora da chamada porque
    // carrega `sender`, um objeto do Electron que não pode vazar para o renderer.
    const wrapped = (_event: unknown, evento: AiStreamEvent): void => listener(evento)

    ipcRenderer.on(IPC_EVENT_CHANNELS.aiStreamEvent, wrapped)

    return () => ipcRenderer.removeListener(IPC_EVENT_CHANNELS.aiStreamEvent, wrapped)
  },

  /**
   * A assinatura do console da geração (SPEC-Fases-03 § Superfície).
   *
   * **É aqui que "um canal por `traceId`" acontece**: o transporte é um canal só, e o filtro por
   * geração mora nesta função. O painel assina o seu trace e recebe só o dele — mesma ergonomia
   * de um canal dedicado, sem sair da união fechada de `IpcEventChannel` nem furar o teste de
   * contrato que exige um handler por canal declarado.
   */
  onGenerationEvent: (
    traceId: string,
    listener: (evento: GenerationEvent) => void
  ): (() => void) => {
    const wrapped = (_event: unknown, payload: EventoDaGeracao): void => {
      if (payload.traceId !== traceId) return
      listener(payload.evento)
    }

    ipcRenderer.on(IPC_EVENT_CHANNELS.generationEvent, wrapped)

    return () => ipcRenderer.removeListener(IPC_EVENT_CHANNELS.generationEvent, wrapped)
  },

  generationHistory: (
    projectId: string,
    etapa: Etapa,
    workspace: WorkspaceId
  ): Promise<readonly GenerationTrace[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.generationHistory, projectId, etapa, workspace),

  generationEvents: (
    traceId: string,
    workspace: WorkspaceId
  ): Promise<readonly GenerationEvent[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.generationEvents, traceId, workspace),

  getBudget: (workspace: WorkspaceId): Promise<BudgetSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.budgetGet, workspace),
  setBudgetLimits: (limites: BudgetLimitsInput, workspace: WorkspaceId): Promise<BudgetSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.budgetSetLimits, limites, workspace),

  getProviderStatus: (workspace: WorkspaceId): Promise<readonly ProviderStatus[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.providerStatus, workspace),
  getProviderModels: (provider: AiProvider): Promise<readonly string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.providerModels, provider),
  setProviderModel: (
    provider: AiProvider,
    modelo: string,
    workspace: WorkspaceId
  ): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.providerSetModel, provider, modelo, workspace),
  getRouting: (workspace: WorkspaceId): Promise<RoutingPolicy> =>
    ipcRenderer.invoke(IPC_CHANNELS.routingGet, workspace),
  setRoute: (rota: ProviderRoute, workspace: WorkspaceId): Promise<RoutingPolicy> =>
    ipcRenderer.invoke(IPC_CHANNELS.routingSetRoute, rota, workspace),
  getPhaseModels: (workspace: WorkspaceId): Promise<PhaseModelPolicy> =>
    ipcRenderer.invoke(IPC_CHANNELS.phaseModelGet, workspace),
  setPhaseModel: (
    fase: Fase,
    rota: RotaComModelo,
    provider: AiProvider,
    modelo: string,
    workspace: WorkspaceId
  ): Promise<PhaseModelPolicy | undefined> =>
    ipcRenderer.invoke(IPC_CHANNELS.phaseModelSet, fase, rota, provider, modelo, workspace),
  getPhaseModelOverrides: (
    projectId: string,
    workspace: WorkspaceId
  ): Promise<readonly ProjectModelOverride[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.phaseModelOverrides, projectId, workspace),
  setPhaseModelOverride: (
    override: ProjectModelOverride,
    workspace: WorkspaceId
  ): Promise<ProjectModelOverride | undefined> =>
    ipcRenderer.invoke(IPC_CHANNELS.phaseModelSetOverride, override, workspace),
  clearPhaseModelOverride: (
    projectId: string,
    fase: Fase,
    rota: RotaComModelo,
    workspace: WorkspaceId
  ): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.phaseModelClearOverride, projectId, fase, rota, workspace),

  listConnectorCapabilities: (): Promise<readonly ConnectorCapability[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.connectorsCapabilities),
  callConnector: (request: ConnectorRequest, workspace: WorkspaceId): Promise<ConnectorOutcome> =>
    ipcRenderer.invoke(IPC_CHANNELS.connectorsInvoke, request, workspace),
  getConnectorCredits: (
    connector: ConnectorId,
    workspace: WorkspaceId
  ): Promise<ConnectorCreditView> =>
    ipcRenderer.invoke(IPC_CHANNELS.connectorCreditsGet, connector, workspace),
  setConnectorCreditLimits: (
    connector: ConnectorId,
    limites: ConnectorCreditLimitsInput,
    workspace: WorkspaceId
  ): Promise<ConnectorCreditView> =>
    ipcRenderer.invoke(IPC_CHANNELS.connectorCreditsSetLimits, connector, limites, workspace),
  // Credenciais de conector (SPEC-Conectores-05, crit. 7). Como no trio de credenciais de IA, o
  // valor entra e nunca volta: o retorno é a lista de status, sem campo onde o segredo caiba.
  listConnectorCredentials: (
    workspace: WorkspaceId
  ): Promise<readonly ConnectorCredentialStatusView[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.connectorCredentialList, workspace),
  setConnectorCredential: (
    key: ConnectorCredentialKey,
    value: string,
    workspace: WorkspaceId
  ): Promise<readonly ConnectorCredentialStatusView[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.connectorCredentialSet, key, value, workspace),
  removeConnectorCredential: (
    key: ConnectorCredentialKey,
    workspace: WorkspaceId
  ): Promise<readonly ConnectorCredentialStatusView[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.connectorCredentialRemove, key, workspace),
  // GitHub por Device Flow (SPEC-Conectores-03). **Nenhuma destas funções devolve token** — não
  // existe `getGithubToken` na ponte, e é essa ausência que garante o critério 2.
  getGithubAuthStatus: (workspace: WorkspaceId): Promise<GithubAuthSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.githubAuthStatus, workspace),
  startGithubAuth: (workspace: WorkspaceId): Promise<GithubDeviceFlowView | ConnectorError> =>
    ipcRenderer.invoke(IPC_CHANNELS.githubAuthStart, workspace),
  awaitGithubAuth: (workspace: WorkspaceId): Promise<GithubAuthSnapshot | ConnectorError> =>
    ipcRenderer.invoke(IPC_CHANNELS.githubAuthAwait, workspace),
  cancelGithubAuth: (workspace: WorkspaceId): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.githubAuthCancel, workspace),
  logoutGithub: (workspace: WorkspaceId): Promise<GithubAuthSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.githubAuthLogout, workspace),
  setGithubClientId: (clientId: string, workspace: WorkspaceId): Promise<GithubAuthSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.githubSetClientId, clientId, workspace),

  // Projeto local e planejamento (SPEC-Planejamento-01). Nenhum canal de Git: a UI pede
  // projeto e marco; o Git roda no main, pelo terminal controlado (decisão 2 do PI).
  listProjects: (workspace: WorkspaceId): Promise<readonly Project[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectList, workspace),
  createProject: (
    nome: string,
    workspace: WorkspaceId,
    diretorioBase?: string
  ): Promise<ProjectOutcome> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectCreate, nome, workspace, diretorioBase),
  importProject: (
    diretorio: string,
    workspace: WorkspaceId,
    nomeSugerido?: string
  ): Promise<ProjectOutcome> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectImport, diretorio, workspace, nomeSugerido),
  pickProjectDirectory: (): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectPickDirectory),
  renameProject: (
    projectId: string,
    nome: string,
    workspace: WorkspaceId
  ): Promise<ProjectOutcome> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectRename, projectId, nome, workspace),
  removeProject: (projectId: string, workspace: WorkspaceId): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectRemove, projectId, workspace),
  getPlanningSession: (
    projectId: string,
    workspace: WorkspaceId
  ): Promise<PlanningSession | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectSession, projectId, workspace),
  savePlanningAnswers: (
    projectId: string,
    etapa: string,
    respostas: Readonly<Record<string, unknown>>,
    workspace: WorkspaceId
  ): Promise<PlanningSession | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectSaveAnswers, projectId, etapa, respostas, workspace),
  completeMilestone: (
    projectId: string,
    marco: MarcoDocumental,
    workspace: WorkspaceId
  ): Promise<MarcoOutcome | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.projectCompleteMilestone, projectId, marco, workspace),

  // O wizard orientado (SPEC-Planejamento-03). Dois métodos, como o contrato: ler o estado
  // **não** avança, e é isso que faz a retomada do critério 6 funcionar ao reabrir a tela.
  getWizardState: (projectId: string, workspace: WorkspaceId): Promise<VistaDoWizard | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.wizardState, projectId, workspace),
  answerWizard: (
    projectId: string,
    resposta: Resposta,
    workspace: WorkspaceId
  ): Promise<RespostaOutcome> =>
    ipcRenderer.invoke(IPC_CHANNELS.wizardAnswer, projectId, resposta, workspace),

  // O pacote estrutural (SPEC-Planejamento-04). Nenhum método recebe conteúdo de documento: a
  // tela pede a geração e mostra o que voltou; compor é do main, a partir de decisões e
  // evidências.
  gerarPacote: (
    projectId: string,
    consulta: string,
    workspace: WorkspaceId
  ): Promise<PacoteOutcome> =>
    ipcRenderer.invoke(IPC_CHANNELS.pacoteGerar, projectId, consulta, workspace),
  listarPacotes: (projectId: string): Promise<readonly PacoteEstrutural[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.pacoteListar, projectId),

  // Roadmap e gates (SPEC-Planejamento-06). `gerarRoadmap` e `aprovarGate` são métodos
  // distintos, e a separação é a fatia: gerar propõe, aprovar aceita. **A identidade não
  // atravessa a ponte** — ela vem da sessão no main, porque um parâmetro deixaria o renderer
  // declarar quem aprovou.
  carregarRoadmap: (projectId: string, workspace: WorkspaceId): Promise<Roadmap> =>
    ipcRenderer.invoke(IPC_CHANNELS.roadmapCarregar, projectId, workspace),
  // O roadmap gerado por IA (SPEC-Jornada-05). Propor, ler, escolher o MVP e responder as
  // perguntas da SPEC são atos distintos, e a ponte os mantém distintos: um método só faria a
  // geração escolher o que ela mesma propôs.
  gerarRoadmapPorIa: (projectId: string, workspace: WorkspaceId): Promise<RoadmapGeradoOutcome> =>
    ipcRenderer.invoke(IPC_CHANNELS.roadmapGerarPorIa, projectId, workspace),
  carregarRoadmapGerado: (
    projectId: string,
    workspace: WorkspaceId
  ): Promise<RoadmapRegistrado | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.roadmapCarregarGerado, projectId, workspace),
  mvpsElegiveis: (projectId: string, workspace: WorkspaceId): Promise<readonly MvpGerado[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.roadmapElegiveis, projectId, workspace),
  escolherMvpDoRoadmap: (
    projectId: string,
    mvpId: string,
    workspace: WorkspaceId
  ): Promise<RoadmapGeradoOutcome> =>
    ipcRenderer.invoke(IPC_CHANNELS.roadmapEscolherMvp, projectId, mvpId, workspace),
  responderPerguntaDaSpec: (
    projectId: string,
    perguntaId: string,
    resposta: string,
    workspace: WorkspaceId
  ): Promise<RoadmapGeradoOutcome> =>
    ipcRenderer.invoke(
      IPC_CHANNELS.roadmapResponderPergunta,
      projectId,
      perguntaId,
      resposta,
      workspace
    ),
  // A jornada: duas leituras e uma escrita. Nenhuma recebe etapa — só evento nomeado, porque
  // onde o projeto está é conclusão do main a partir dos fatos, não afirmação do renderer.
  estadoDaJornada: (projectId: string, workspace: WorkspaceId): Promise<EstadoDaJornada | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.jornadaEstado, projectId, workspace),
  jornadaDeVarios: (
    projectIds: readonly string[],
    workspace: WorkspaceId
  ): Promise<readonly EstadoDaJornada[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.jornadaEstadoDeVarios, projectIds, workspace),
  resumoDeVarios: (
    projectIds: readonly string[],
    workspace: WorkspaceId
  ): Promise<readonly ResumoDoProjeto[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.jornadaResumoDeVarios, projectIds, workspace),
  aplicarEventoDaJornada: (
    projectId: string,
    evento: string,
    workspace: WorkspaceId
  ): Promise<TransicaoOutcome | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.jornadaEvento, projectId, evento, workspace),
  // O prompt e o brief (SPEC-Jornada-02). Nenhum canal aceita afirmação nem texto de brief: a
  // tela pede o ato e mostra o que voltou, e o conteúdo é validado no main antes de gravar.
  salvarPromptDoProjeto: (
    projectId: string,
    texto: string,
    workspace: WorkspaceId
  ): Promise<PromptDoProjeto | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.briefSalvarPrompt, projectId, texto, workspace),
  lerPromptDoProjeto: (
    projectId: string,
    workspace: WorkspaceId
  ): Promise<PromptDoProjeto | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.briefLerPrompt, projectId, workspace),
  gerarBrief: (projectId: string, workspace: WorkspaceId): Promise<GeracaoOutcome> =>
    ipcRenderer.invoke(IPC_CHANNELS.briefGerar, projectId, workspace),
  carregarBrief: (projectId: string, workspace: WorkspaceId): Promise<BriefRegistrado | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.briefCarregar, projectId, workspace),
  rotaDaGeracao: (projectId: string, workspace: WorkspaceId): Promise<ResultadoDaRota> =>
    ipcRenderer.invoke(IPC_CHANNELS.briefRota, projectId, workspace),
  cortarPropostoDoBrief: (
    projectId: string,
    afirmacaoId: string,
    workspace: WorkspaceId
  ): Promise<BriefRegistrado | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.briefCortarProposto, projectId, afirmacaoId, workspace),
  // O PRD, o Landscape e a Convention (SPEC-Jornada-03). Propor o termo e gerar são canais
  // separados: a pesquisa não roda sem o PI confirmar o que será buscado (critério 3).
  proporTermoDePesquisa: (projectId: string, workspace: WorkspaceId): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.prdProporTermo, projectId, workspace),
  gerarPrd: (projectId: string, termo: string, workspace: WorkspaceId): Promise<PrdOutcome> =>
    ipcRenderer.invoke(IPC_CHANNELS.prdGerar, projectId, termo, workspace),
  carregarPrd: (projectId: string, workspace: WorkspaceId): Promise<PrdRegistrado | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.prdCarregar, projectId, workspace),
  cortarPropostoDoPrd: (
    projectId: string,
    afirmacaoId: string,
    workspace: WorkspaceId
  ): Promise<PrdRegistrado | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.prdCortarProposto, projectId, afirmacaoId, workspace),
  // A arquitetura, as decisões, os testes e a revisão (SPEC-Jornada-04). Descartar um ajuste é
  // canal próprio, e não um "aplicar": nenhum destes escreve no anexo do PI (critério 4).
  gerarArquiteturaPorIa: (
    projectId: string,
    workspace: WorkspaceId
  ): Promise<ArquiteturaGeradaOutcome> =>
    ipcRenderer.invoke(IPC_CHANNELS.arquiteturaGerarPorIa, projectId, workspace),
  carregarArquitetura: (
    projectId: string,
    workspace: WorkspaceId
  ): Promise<ArquiteturaRegistrada | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.arquiteturaCarregar, projectId, workspace),
  cortarPropostoDaArquitetura: (
    projectId: string,
    afirmacaoId: string,
    workspace: WorkspaceId
  ): Promise<ArquiteturaRegistrada | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.arquiteturaCortarProposto, projectId, afirmacaoId, workspace),
  descartarAjusteDaArquitetura: (
    projectId: string,
    ajusteId: string,
    workspace: WorkspaceId
  ): Promise<ArquiteturaRegistrada | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.arquiteturaDescartarAjuste, projectId, ajusteId, workspace),
  // O refinamento: gerar as perguntas, ler o estado, responder e consultar a trilha. Nenhum
  // canal recebe o enunciado de volta — só o id da pergunta que já está no banco.
  gerarPerguntasDeRefinamento: (
    projectId: string,
    workspace: WorkspaceId
  ): Promise<GeracaoDePerguntasOutcome> =>
    ipcRenderer.invoke(IPC_CHANNELS.refinamentoGerar, projectId, workspace),
  estadoDoRefinamento: (
    projectId: string,
    workspace: WorkspaceId
  ): Promise<EstadoDoWizard | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.refinamentoEstado, projectId, workspace),
  responderRefinamento: (
    projectId: string,
    resposta: Resposta,
    workspace: WorkspaceId
  ): Promise<RespostaOutcome> =>
    ipcRenderer.invoke(IPC_CHANNELS.refinamentoResponder, projectId, resposta, workspace),
  historicoDoRefinamento: (
    projectId: string,
    workspace: WorkspaceId
  ): Promise<readonly Decision[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.refinamentoHistorico, projectId, workspace),
  // O alvo atravessa a ponte; a credencial não. O token é resolvido no main, pelo mesmo cofre do
  // conector — mandá-lo daqui exigiria que o renderer o tivesse, e ele nunca tem.
  publicarNoGitHub: (
    projectId: string,
    alvo: AlvoDaPublicacao,
    workspace: WorkspaceId
  ): Promise<PublicacaoOutcome> =>
    ipcRenderer.invoke(IPC_CHANNELS.publicacaoPublicar, projectId, alvo, workspace),
  vistaDaFila: (projectId: string, workspace: WorkspaceId): Promise<VistaDaFila> =>
    ipcRenderer.invoke(IPC_CHANNELS.filaVista, projectId, workspace),
  estadoDoSandbox: (): Promise<{
    readonly dockerNoAr: boolean
    readonly proxyNoAr: boolean
  }> => ipcRenderer.invoke(IPC_CHANNELS.sandboxEstado),
  ledgerDoRun: (runId: string): Promise<ExecutionLedger | undefined> =>
    ipcRenderer.invoke(IPC_CHANNELS.ledgerDoRun, runId),
  pendenciasDeLimpeza: (): Promise<readonly PendenciaDeLimpeza[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.limpezaPendencias),
  lerPoliticaDeMerge: (projectId: string, workspace: WorkspaceId): Promise<PoliticaDeMerge> =>
    ipcRenderer.invoke(IPC_CHANNELS.mergePolicyLer, projectId, workspace),
  definirPoliticaDeMerge: (
    projectId: string,
    autonomo: boolean,
    workspace: WorkspaceId
  ): Promise<MergePolicyOutcome> =>
    ipcRenderer.invoke(IPC_CHANNELS.mergePolicyDefinir, projectId, autonomo, workspace),
  listarAprovacoes: (projectId: string, workspace: WorkspaceId): Promise<readonly Approval[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.aprovacaoListar, projectId, workspace),
  revisoesDoGate: (
    projectId: string,
    gate: Gate,
    workspace: WorkspaceId
  ): Promise<readonly RevisaoAprovada[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.aprovacaoRevisoes, projectId, gate, workspace),
  aprovarGate: (projectId: string, gate: Gate, workspace: WorkspaceId): Promise<AprovacaoOutcome> =>
    ipcRenderer.invoke(IPC_CHANNELS.aprovacaoAprovar, projectId, gate, workspace),
  simularMudanca: (
    projectId: string,
    mudancas: readonly MudancaDeArtefato[],
    workspace: WorkspaceId
  ): Promise<readonly Gate[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.aprovacaoSimular, projectId, mudancas, workspace),

  // Anexos de design e arquitetura (SPEC-Planejamento-05). Nenhum método recebe conteúdo de
  // arquivo: o renderer manda o *caminho* que o seletor nativo devolveu, e quem lê, copia e
  // hasheia é o main. Um método que aceitasse bytes seria um gravador de disco no renderer.
  escolherAnexo: (tipo: TipoDeAnexo): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.anexoEscolher, tipo),
  anexarDesign: (
    projectId: string,
    tipo: TipoDeAnexo,
    origem: string,
    workspace: WorkspaceId
  ): Promise<AnexoOutcome> =>
    ipcRenderer.invoke(IPC_CHANNELS.anexoAnexar, projectId, tipo, origem, workspace),
  listarAnexos: (projectId: string): Promise<readonly Anexo[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.anexoListar, projectId),
  removerAnexo: (projectId: string, caminho: string, workspace: WorkspaceId): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.anexoRemover, projectId, caminho, workspace),
  validarPrototipos: (projectId: string): Promise<readonly ValidacaoDoPrototipo[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.anexoValidar, projectId),
  listarArquiteturas: (projectId: string): Promise<readonly PacoteArquitetura[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.arquiteturaListar, projectId),

  // Contexto, skills e orçamento (SPEC-Planejamento-02). Nenhum método que leia arquivo: a tela
  // indica caminhos relativos e o main lê, dentro do diretório do projeto. Um `readFile` aqui
  // seria um leitor de disco no renderer — a fronteira que o ARCHITECTURE fecha.
  buildContextPack: (
    pedido: ContextPackRequest,
    workspace: WorkspaceId
  ): Promise<ContextPackOutcome> =>
    ipcRenderer.invoke(IPC_CHANNELS.contextBuild, pedido, workspace),
  listContextPacks: (projectId: string): Promise<readonly ContextPack[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.contextList, projectId),
  listCapabilities: (): Promise<readonly CapacidadeResolvida[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.contextCapabilities),
  listFailures: (projectId: string): Promise<readonly FalhaRegistrada[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.contextFailures, projectId),
  resolveFailure: (
    projectId: string,
    fingerprint: string,
    workspace: WorkspaceId
  ): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.contextResolveFailure, projectId, fingerprint, workspace)
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge)
} else {
  // contextIsolation desligado quebra a fronteira renderer↔Node. Falhar alto é
  // preferível a expor a ponte num contexto sem isolamento.
  throw new Error('contextIsolation está desabilitado — a ponte não será exposta.')
}
