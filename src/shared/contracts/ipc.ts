/**
 * Contrato do IPC — a única fronteira entre renderer e main.
 *
 * Regra inviolável (docs/ARCHITECTURE.md § Fronteiras de segurança): o renderer nunca
 * executa comando, nunca lê segredo, nunca acessa Node. Todo canal exposto ao renderer
 * é nomeado aqui; não existe `invoke` genérico. Adicionar capacidade = adicionar um
 * canal nesta lista e um handler correspondente no main.
 */

/** Canais de request/response (renderer → main → renderer). */
export const IPC_CHANNELS = {
  /** Metadados do app (nome, versão, ambiente). Sem segredo, sem caminho de disco. */
  appInfo: 'app:info'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

/** Informação pública do app exposta ao renderer. */
export interface AppInfo {
  readonly name: string
  readonly version: string
  readonly electronVersion: string
  /** `development` ou `production` — nunca variáveis de ambiente cruas. */
  readonly environment: 'development' | 'production'
}

/**
 * A ponte exposta em `window.jarvis`. É o contrato completo: o que não está aqui,
 * o renderer não alcança.
 */
export interface JarvisBridge {
  getAppInfo(): Promise<AppInfo>
}

/** Nome da propriedade exposta via contextBridge no renderer. */
export const BRIDGE_KEY = 'jarvis' as const
