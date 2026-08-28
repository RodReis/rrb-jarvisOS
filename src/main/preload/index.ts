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
  listExecutionRuns: (workspace: WorkspaceId): Promise<readonly ExecutionRun[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.executionList, workspace)
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge)
} else {
  // contextIsolation desligado quebra a fronteira renderer↔Node. Falhar alto é
  // preferível a expor a ponte num contexto sem isolamento.
  throw new Error('contextIsolation está desabilitado — a ponte não será exposta.')
}
