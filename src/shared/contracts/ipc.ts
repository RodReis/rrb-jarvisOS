/**
 * Contrato do IPC — a única fronteira entre renderer e main.
 *
 * Regra inviolável (docs/ARCHITECTURE.md § Fronteiras de segurança): o renderer nunca
 * executa comando, nunca lê segredo, nunca acessa Node. Todo canal exposto ao renderer
 * é nomeado aqui; não existe `invoke` genérico. Adicionar capacidade = adicionar um
 * canal nesta lista e um handler correspondente no main.
 */

import type {
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
  policyClassify: 'policy:classify'
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
  authChanged: 'auth:changed'
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
 */
export interface PreferencesSnapshot {
  readonly locale: Locale
  readonly theme: ThemePreference
  readonly resolvedTheme: ResolvedTheme
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
}

/** Nome da propriedade exposta via contextBridge no renderer. */
export const BRIDGE_KEY = 'jarvis' as const
