import { app, ipcMain } from 'electron'
import {
  IPC_CHANNELS,
  IPC_SEND_CHANNELS,
  type AppInfo,
  type AuditVerification,
  type WorkspaceSwitchResult
} from '@shared/contracts/ipc'
import { AUTH_MENSAGENS, type AuthSnapshot } from '@shared/contracts/auth'
import { parseLogInput } from '@shared/contracts/logging-input'
import { isSensitivity, type PolicyContext, type PolicyDecision } from '@shared/policies'
import { isWorkspaceId, type AuditEvent, type AuditEventType } from '@shared/domain/entities'
import type { AuthService } from '../auth/auth-service'
import { log, writeLog } from '../logging/logger'
import type { AllowlistRepository } from '../policy/allowlist-repository'
import type { PolicyService } from '../policy/policy-service'
import type { WorkflowService } from '../workflows/workflow-service'
import { isWorkflowStatus } from '@shared/domain/workflows'
import type { Automation, AutomationInput, Workflow, WorkflowInput } from '@shared/domain/workflows'
import type { PreferencesService } from '../preferences/preferences-service'
import type { AuditRepository } from '../storage/audit-repository'
import type { WorkspaceService } from '../workspace/workspace-service'

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
  /** Ausente quando as credenciais não estão configuradas — o app roda sem login. */
  readonly auth?: AuthService
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
