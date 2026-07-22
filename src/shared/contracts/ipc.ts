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
import type { LogInput } from './logging'

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
  preferencesSave: 'preferences:save'
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

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

export type IpcSendChannel = (typeof IPC_SEND_CHANNELS)[keyof typeof IPC_SEND_CHANNELS]

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
  /** Pede ao main para minimizar a janela para o tray. */
  minimizeToTray(): void
}

/** Nome da propriedade exposta via contextBridge no renderer. */
export const BRIDGE_KEY = 'jarvis' as const
