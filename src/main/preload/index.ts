import { contextBridge, ipcRenderer } from 'electron'
import {
  BRIDGE_KEY,
  IPC_CHANNELS,
  IPC_EVENT_CHANNELS,
  IPC_SEND_CHANNELS,
  type AppInfo,
  type AuditVerification,
  type JarvisBridge,
  type PreferencesSnapshot,
  type WorkspaceSwitchResult
} from '@shared/contracts/ipc'
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
    ipcRenderer.invoke(IPC_CHANNELS.routingSetRoute, rota, workspace)
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge)
} else {
  // contextIsolation desligado quebra a fronteira renderer↔Node. Falhar alto é
  // preferível a expor a ponte num contexto sem isolamento.
  throw new Error('contextIsolation está desabilitado — a ponte não será exposta.')
}
