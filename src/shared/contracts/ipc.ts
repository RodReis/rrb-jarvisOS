/**
 * Contrato do IPC — a única fronteira entre renderer e main.
 *
 * Regra inviolável (docs/ARCHITECTURE.md § Fronteiras de segurança): o renderer nunca
 * executa comando, nunca lê segredo, nunca acessa Node. Todo canal exposto ao renderer
 * é nomeado aqui; não existe `invoke` genérico. Adicionar capacidade = adicionar um
 * canal nesta lista e um handler correspondente no main.
 */

import type {
  AccentColor,
  AuditEvent,
  AuditEventType,
  Locale,
  ResolvedTheme,
  ThemePreference,
  UserPreferences,
  WorkspaceId
} from '../domain/entities'
import type { AuthSnapshot } from './auth'
import type { LogInput } from './logging'
import type { PolicyContext, PolicyDecision } from '../policies/contracts'
import type {
  Automation,
  AutomationInput,
  Workflow,
  WorkflowInput,
  WorkflowStatus
} from '../domain/workflows'
import type { ExecutionRun } from '../domain/execution'
import type { CommandExecution, CommandSubmission } from '../domain/terminal'
import type { CredentialKey, CredentialStatusView } from '../domain/credentials'
import type { AiCallHandle, AiRequest, AiStreamEvent } from '../domain/ai'
import type { ApprovalDecision, ApprovalRequest } from '../domain/execution'

/** Canais de request/response (renderer → main → renderer). */
export const IPC_CHANNELS = {
  /** Metadados do app (nome, versão, ambiente). Sem segredo, sem caminho de disco. */
  appInfo: 'app:info',
  /**
   * Auditoria do usuário corrente (SPEC-04, critério 6). O renderer **não** abre o
   * SQLite: pede por aqui e o main consulta. Só leitura — gravar auditoria é ato do
   * main, disparado por um fluxo real, nunca por pedido da UI.
   */
  auditList: 'audit:list',
  /** Recomputa a cadeia e devolve o veredito (ADR-004, camada 3). */
  auditVerify: 'audit:verify',
  /** Espaço ativo. Ao abrir é sempre JARVIS OS (decisão do PI na SPEC-02). */
  workspaceGet: 'workspace:get',
  /** Troca o espaço ativo; o main audita e loga a transição. */
  workspaceSwitch: 'workspace:switch',
  /** Preferências do usuário corrente + o tema já resolvido (SPEC-05). */
  preferencesGet: 'preferences:get',
  /** Grava idioma e/ou tema. Ação de baixo risco: **não** gera AuditEvent (SPEC-05). */
  preferencesSave: 'preferences:save',
  /** Estado corrente da autenticação. Nunca devolve token (SPEC-03, critério 4). */
  authGet: 'auth:get',
  /**
   * Inicia o login Google. O fluxo abre no **navegador do sistema** e retorna por um
   * servidor loopback local (decisão do PI na SPEC-03) — nunca em webview do Electron,
   * onde o app enxergaria as credenciais digitadas pelo usuário.
   */
  authLogin: 'auth:login',
  /** Revoga a sessão, apaga os tokens e volta para `deslogado` (critério 3). */
  authLogout: 'auth:logout',
  /**
   * Classifica uma ação pelo Policy Engine e devolve a `PolicyDecision` (SPEC-Execucao-02,
   * critério 7). O `evaluate` roda no **main** — o renderer nunca avalia política, só lê o
   * resultado. Modo report: a decisão é auditada, mas nada é barrado nesta fatia.
   */
  policyClassify: 'policy:classify',
  /**
   * Allowlist de diretórios permitidos (SPEC-Execucao-03, critério 5). O renderer **não**
   * lê/edita FS nem a allowlist direto — vê e edita via estes canais; a checagem e a
   * persistência vivem no main. `add`/`remove` auditam (ADR-004).
   */
  allowlistList: 'allowlist:list',
  allowlistAdd: 'allowlist:add',
  allowlistRemove: 'allowlist:remove',
  /**
   * Seletor nativo de pasta (SPEC-ExecucaoReal-03, decisão 2 do PI). O diálogo abre no
   * **main** — o renderer nunca toca o filesystem, nem para escolher um caminho. Escolha
   * confirmada entra na allowlist já canonizada; cancelar não altera nada e não audita.
   */
  allowlistPick: 'allowlist:pick',
  /**
   * O diretório gerido pelo app (`userData`), canônico. Só-leitura: a UI precisa saber
   * **qual** dos paths de `allowlist:list` é o default de fábrica para apresentá-lo como
   * fixo (SPEC-ExecucaoReal-03, critério 4) — o repositório já recusa removê-lo, e sem
   * este canal a tela teria de inferir a identidade dele por posição na lista.
   */
  allowlistAppDir: 'allowlist:app-dir',
  /**
   * Registro de workflows e automações (SPEC-Execucao-04, critério 7). CRUD de **definições**
   * — nada executa. O renderer nunca toca o storage: vê e edita por aqui, e criar/alterar/
   * toggle é classificado (F02) + auditado no main.
   */
  workflowList: 'workflow:list',
  workflowCreate: 'workflow:create',
  workflowUpdate: 'workflow:update',
  workflowSetStatus: 'workflow:set-status',
  workflowRemove: 'workflow:remove',
  automationList: 'automation:list',
  automationCreate: 'automation:create',
  automationSetEnabled: 'automation:set-enabled',
  automationRemove: 'automation:remove',
  /**
   * Execução simulada (SPEC-Execucao-05, critério 7). O renderer **dispara** o run por
   * gatilho manual e lê o `ExecutionRun`/trace; o motor roda no **main**. Zero efeito
   * colateral — nada toca FS, rede, terminal ou provider.
   */
  executionRun: 'execution:run',
  executionRunReal: 'execution:run-real',
  executionList: 'execution:list',
  approvalList: 'approval:list',
  approvalResolve: 'approval:resolve',
  /**
   * Terminal controlado (SPEC-ExecucaoReal-02). O renderer **submete** binário + argumentos +
   * cwd e lê o resultado; quem executa o processo é o main. O renderer nunca toca
   * `child_process` (ARCHITECTURE § Fronteiras 1) — nem indiretamente: não há canal que aceite
   * uma linha de comando a ser interpretada por shell.
   *
   * A allowlist de **comandos** é conceito novo desta fatia e vive separada da de diretórios:
   * um comando precisa das duas (binário permitido **e** cwd permitido).
   */
  terminalRun: 'terminal:run',
  commandAllowlistList: 'command-allowlist:list',
  commandAllowlistAdd: 'command-allowlist:add',
  commandAllowlistRemove: 'command-allowlist:remove',
  /**
   * Vault de credenciais (SPEC-Providers-01, critério 8). **Nenhum destes canais devolve o
   * valor de uma credencial** — nem existe canal que o peça. O renderer vê `status`, `source`
   * e o nome do provider; o segredo só é decifrado no main, no instante da chamada ao
   * provider (F02).
   *
   * `set` recebe o valor **de ida** (é o usuário digitando a própria chave no Settings), e a
   * assimetria é o desenho: entra e nunca volta. O retorno dos três canais é a lista de
   * status atualizada, para a UI refletir sem novo round-trip.
   */
  credentialList: 'credential:list',
  credentialSet: 'credential:set',
  credentialRemove: 'credential:remove',
  /**
   * Dispara uma chamada de IA (SPEC-Providers-02, critério 8). Devolve só o `AiCallHandle` —
   * o texto chega pelo canal de evento `aiStreamEvent`, casado pelo `id`. O renderer **nunca**
   * vê a credencial: quem a lê do Vault é o ponto único de chamada, no main.
   */
  aiCall: 'ai:call',
  /** Aborta uma chamada em andamento (o usuário fechou a tela ou desistiu). */
  aiCancel: 'ai:cancel'
} as const

/**
 * Canais só de ida (renderer → main), sem resposta.
 *
 * Separados dos de request/response porque o main os registra com `ipcMain.on`, não
 * `ipcMain.handle` — e porque o teste que prova "um handler por canal do contrato" precisa
 * distinguir os dois grupos para não acusar falso positivo.
 */
export const IPC_SEND_CHANNELS = {
  /**
   * Registro de log vindo do renderer. O renderer nunca escreve em disco (ADR-005): ele
   * captura e encaminha; quem grava é o winston do main, escritor único.
   */
  log: 'log:record',
  /** Minimiza para o tray. Ação de janela vive no main; o renderer só pede (SPEC-02). */
  windowMinimizeToTray: 'window:minimizar-tray'
} as const

/**
 * Canais de push (main → renderer). O renderer assina; não pede.
 *
 * Existe porque o login não é request/response: o usuário sai para o navegador e volta
 * minutos depois, e a sessão pode expirar sozinha durante o uso. Sem push, a UI teria de
 * ficar consultando `auth:get` em intervalo — polling que gasta e ainda chega atrasado.
 */
export const IPC_EVENT_CHANNELS = {
  /** Novo `AuthSnapshot` a cada transição de estado. Nunca carrega token. */
  authChanged: 'auth:changed',
  /**
   * Um evento por chunk de uma chamada de IA, mais o `fim` (SPEC-Providers-02, critério 2).
   *
   * Canal de **evento** e não retorno do `invoke`: o ponto do streaming é o texto aparecer
   * enquanto chega. Um `invoke` que resolvesse com a resposta inteira entregaria o mesmo
   * conteúdo depois de o usuário ter esperado por ele em silêncio.
   */
  aiStreamEvent: 'ai:stream-event'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

export type IpcSendChannel = (typeof IPC_SEND_CHANNELS)[keyof typeof IPC_SEND_CHANNELS]

export type IpcEventChannel = (typeof IPC_EVENT_CHANNELS)[keyof typeof IPC_EVENT_CHANNELS]

/** Informação pública do app exposta ao renderer. */
export interface AppInfo {
  readonly name: string
  readonly version: string
  readonly electronVersion: string
  /** `development` ou `production` — nunca variáveis de ambiente cruas. */
  readonly environment: 'development' | 'production'
}

/**
 * Veredito da verificação da cadeia de auditoria, na forma que o renderer vê.
 *
 * Espelha o `ChainVerification` do main sem importá-lo: aquele módulo usa `node:crypto`
 * e não pode ser compilado para o renderer. Duplicar a *forma* aqui é o preço de manter
 * a fronteira; o teste de contrato prova que as duas não divergem.
 */
export type AuditVerification =
  | { readonly ok: true; readonly checked: number }
  | {
      readonly ok: false
      readonly checked: number
      readonly brokenAt: number
      readonly reason: 'hash-invalido' | 'prev-hash-nao-encadeia' | 'seq-fora-de-ordem'
      readonly detail: string
    }

/** Resultado de uma troca de espaço, já auditada pelo main. */
export interface WorkspaceSwitchResult {
  readonly workspace: WorkspaceId
  /** `seq` do `AuditEvent` gerado — deixa a UI provar que a troca foi registrada. */
  readonly auditSeq: number
}

/**
 * Preferências do usuário, com o tema **já resolvido** pelo main.
 *
 * `theme` é a preferência (`claro`/`escuro`/`sistema`); `resolvedTheme` é o que pintar
 * agora. A resolução acontece no main porque é ele quem enxerga o `nativeTheme` do SO —
 * o renderer não deve consultar o sistema por conta própria.
 *
 * `accentNoa`/`accentJarvis` vêm **já resolvidos**: nunca `null` aqui. Onde o `UserProfile` guarda
 * `null` ("não escolheu"), o main aplica o `ACENTO_PADRAO` do DS antes de mandar — o renderer
 * recebe sempre uma cor pintável, sem precisar conhecer o valor de fábrica.
 */
export interface PreferencesSnapshot {
  readonly locale: Locale
  readonly theme: ThemePreference
  readonly resolvedTheme: ResolvedTheme
  readonly accentNoa: AccentColor
  readonly accentJarvis: AccentColor
}

/**
 * A ponte exposta em `window.jarvis`. É o contrato completo: o que não está aqui,
 * o renderer não alcança.
 */
export interface JarvisBridge {
  getAppInfo(): Promise<AppInfo>
  /** Encaminha um registro de log ao main, que grava. Não devolve nada de propósito. */
  sendLog(record: LogInput): void
  /** Auditoria do usuário corrente. Leitura apenas — a UI nunca grava evento. */
  listAuditEvents(type?: AuditEventType): Promise<readonly AuditEvent[]>
  verifyAuditChain(): Promise<AuditVerification>
  getWorkspace(): Promise<WorkspaceId>
  switchWorkspace(workspace: WorkspaceId): Promise<WorkspaceSwitchResult>
  getPreferences(): Promise<PreferencesSnapshot>
  /** Grava e devolve o estado resultante, já com o tema resolvido. */
  savePreferences(preferences: UserPreferences): Promise<PreferencesSnapshot>

  /** Estado corrente da auth. Só estado e perfil — token não atravessa a ponte. */
  getAuth(): Promise<AuthSnapshot>
  /** Dispara o login; o resultado chega pelo `onAuthChanged`, não pelo retorno. */
  login(): Promise<AuthSnapshot>
  logout(): Promise<AuthSnapshot>
  /**
   * Assina as transições de auth. Devolve a função que cancela a assinatura — sem ela o
   * listener sobreviveria ao componente que o registrou e vazaria a cada remontagem.
   */
  onAuthChanged(listener: (snapshot: AuthSnapshot) => void): () => void

  /** Pede ao main para minimizar a janela para o tray. */
  minimizeToTray(): void

  /**
   * Classifica uma ação pelo Policy Engine (SPEC-Execucao-02, critério 7). O `evaluate`
   * roda no main; a UI só lê a `PolicyDecision`. Nesta fatia a decisão é auditada e
   * devolvida, **nunca** barra a execução (modo report).
   */
  classifyAction(action: string, context: PolicyContext): Promise<PolicyDecision>

  /**
   * Allowlist de diretórios (SPEC-Execucao-03, critério 5). O renderer vê e edita a lista
   * por aqui; a checagem de FS e a persistência ficam no main. `add`/`remove` auditam.
   * Devolvem a lista atualizada de paths canônicos permitidos.
   */
  listAllowedDirectories(): Promise<readonly string[]>
  addAllowedDirectory(path: string): Promise<readonly string[]>
  removeAllowedDirectory(path: string): Promise<readonly string[]>

  /**
   * Abre o seletor nativo de pasta no main e adiciona a escolha à allowlist
   * (SPEC-ExecucaoReal-03, critérios 2 e 3). Devolve a lista atualizada — igual à de
   * `listAllowedDirectories`, e **inalterada** quando o usuário cancela o diálogo.
   */
  pickAllowedDirectory(): Promise<readonly string[]>

  /**
   * O diretório gerido pelo app, canônico. A tela o compara com os itens da lista para
   * marcar o fixo; não é um path que o renderer possa usar para tocar o FS.
   */
  getAppDirectory(): Promise<string>

  /**
   * Registro de workflows e automações (SPEC-Execucao-04, critério 7). CRUD de definições;
   * nada executa. `create`/`update`/`setStatus`/`setEnabled`/`remove` classificam (F02) e
   * auditam no main. O `WorkflowInput`/`AutomationInput` da UI não traz `user_id` — o main o
   * resolve pela sessão corrente.
   */
  listWorkflows(workspace: WorkspaceId): Promise<readonly Workflow[]>
  createWorkflow(input: Omit<WorkflowInput, 'user_id'>): Promise<Workflow>
  updateWorkflow(
    id: string,
    patch: Partial<Pick<Workflow, 'name' | 'steps' | 'triggers' | 'schedule'>>
  ): Promise<Workflow | undefined>
  setWorkflowStatus(id: string, status: WorkflowStatus): Promise<Workflow | undefined>
  removeWorkflow(id: string, workspace: WorkspaceId): Promise<boolean>

  listAutomations(workspace: WorkspaceId): Promise<readonly Automation[]>
  createAutomation(input: Omit<AutomationInput, 'user_id'>): Promise<Automation>
  setAutomationEnabled(id: string, enabled: boolean): Promise<Automation | undefined>
  removeAutomation(id: string, workspace: WorkspaceId): Promise<boolean>

  /**
   * Dispara um workflow em **modo simulado** (SPEC-Execucao-05) e devolve o `ExecutionRun`
   * com o trace por etapa. Gatilho manual — nada é agendado. **Zero efeito colateral:** o
   * motor não toca FS, rede, terminal nem provider.
   */
  runWorkflowSimulated(workflowId: string, workspace: WorkspaceId): Promise<ExecutionRun>
  /** Dispara um workflow em modo real de filesystem, com enforcement e aprovação. */
  runWorkflowReal(workflowId: string, workspace: WorkspaceId): Promise<ExecutionRun>
  listExecutionRuns(workspace: WorkspaceId): Promise<readonly ExecutionRun[]>
  listPendingApprovals(workspace: WorkspaceId): Promise<readonly ApprovalRequest[]>
  /**
   * Resolve uma aprovação pendente. O retorno varia com o que estava pausado: uma etapa de
   * filesystem devolve o `ExecutionRun` retomado (F01); um comando devolve o
   * `CommandExecution` (F02). A fila é uma só — o painel de aprovações não distingue —, mas
   * o desfecho é do tipo do motor que executou.
   */
  resolveApproval(
    id: string,
    decision: ApprovalDecision
  ): Promise<ExecutionRun | CommandExecution | undefined>

  /**
   * Submete um comando ao terminal controlado (SPEC-ExecucaoReal-02) e devolve o resultado.
   *
   * **Binário e argumentos separados, nunca uma linha.** A assinatura é a garantia de
   * segurança: não existindo um campo "linha de comando", não há o que um shell interprete —
   * `;`, `&&` e `$()` chegam ao processo como texto literal de argumento. Uma API que
   * aceitasse a linha inteira reintroduziria a superfície que esta forma fecha.
   *
   * Nunca rejeita por política: uma recusa volta como `CommandExecution` com `state`
   * `bloqueado` e o `reason` correspondente — é desfecho a exibir, não erro a tratar.
   */
  runCommand(submission: CommandSubmission, workspace: WorkspaceId): Promise<CommandExecution>

  /**
   * Allowlist de **comandos** (1ª barreira). Escopada por espaço: o que o JARVIS pode
   * executar não é o que o NOA pode. `add`/`remove` são ações de **alto risco**, classificadas
   * e auditadas no main. Devolvem a lista atualizada, para a UI refletir sem novo round-trip.
   */
  listAllowedCommands(workspace: WorkspaceId): Promise<readonly string[]>
  addAllowedCommand(binary: string, workspace: WorkspaceId): Promise<readonly string[]>
  removeAllowedCommand(binary: string, workspace: WorkspaceId): Promise<readonly string[]>

  /**
   * Vault de credenciais (SPEC-Providers-01). **Não há método aqui que devolva o valor de uma
   * credencial** — e essa ausência é o critério 2, não um esquecimento: o renderer não tem
   * como pedir o segredo porque a ponte não tem forma de entregá-lo.
   *
   * `listCredentials` devolve **todas** as chaves conhecidas, inclusive as ausentes
   * (`status: missing`) — é o que permite a UI dizer o que falta sem exibir segredo (RF-010).
   *
   * `setCredential` recebe o valor de ida: o usuário digita a chave dele no Settings, ela
   * atravessa a ponte uma vez e é cifrada no main. Escopo por espaço: a mesma chave lógica
   * tem valores próprios no NOA e no JARVIS.
   */
  listCredentials(workspace: WorkspaceId): Promise<readonly CredentialStatusView[]>
  setCredential(
    key: CredentialKey,
    value: string,
    workspace: WorkspaceId
  ): Promise<readonly CredentialStatusView[]>
  removeCredential(
    key: CredentialKey,
    workspace: WorkspaceId
  ): Promise<readonly CredentialStatusView[]>

  /**
   * Dispara uma chamada de IA e devolve o handle (SPEC-Providers-02, critério 8).
   *
   * A resposta **não** vem por aqui: chega em chunks por `onAiStreamEvent`, casados pelo `id`
   * do handle. O renderer monta o texto incrementalmente e nunca toca a credencial.
   */
  callAi(request: AiRequest, workspace: WorkspaceId): Promise<AiCallHandle>
  /** Aborta uma chamada em andamento. No-op se ela já terminou. */
  cancelAi(id: string): Promise<void>
  /** Assina os eventos de stream. Devolve a função que cancela a assinatura. */
  onAiStreamEvent(listener: (evento: AiStreamEvent) => void): () => void
}

/** Nome da propriedade exposta via contextBridge no renderer. */
export const BRIDGE_KEY = 'jarvis' as const
