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
import {
  isConnectorRequest,
  type ConnectorCapability,
  type ConnectorOutcome
} from '@shared/domain/connectors'
import type { ConnectorService } from '../connectors/connector-service'
import { CreditInputError, type CreditService } from '../connectors/credit-service'
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
  /** Motor de execução simulada (SPEC-Execucao-05): zero efeito colateral. */
  readonly execution: SimulationEngine
  /** Motor de filesystem real (SPEC-ExecucaoReal-01): enforcement fail-closed. */
  readonly realExecution: RealFileSystemEngine
  /** Motor do terminal controlado (SPEC-ExecucaoReal-02): duas barreiras + timeout. */
  readonly terminal: TerminalEngine
  /** Allowlist de comandos (SPEC-ExecucaoReal-02, 1ª barreira): edição de alto risco. */
  readonly commandAllowlist: CommandAllowlistRepository
  /** Vault de credenciais (SPEC-Providers-01): status para a UI, valor só dentro do main. */
  readonly credentials: CredentialService
  /** Runs persistidos, para a UI listar o histórico. */
  readonly runs: ExecutionRepository
  /** Fila de aprovações pendentes do usuário corrente. */
  readonly approvals: ApprovalRepository
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
  /** O ponto único de conectores (SPEC-Conectores-01). */
  readonly connectors: ConnectorService
  /** O ledger de créditos de conector (SPEC-Conectores-02). */
  readonly connectorCredits: CreditService
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
        ...(typeof bruto.maxTokens === 'number' ? { maxTokens: bruto.maxTokens } : {})
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
