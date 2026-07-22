/**
 * Opções de segurança do renderer (docs/ARCHITECTURE.md § Fronteiras de segurança).
 *
 * Mora em `shared/contracts` — e não junto da criação da janela — porque é *contrato*,
 * não comportamento: precisa ser verificável por teste sem carregar o Electron.
 */
export const RENDERER_SECURITY = {
  /** Isola o contexto do preload do mundo da página. */
  contextIsolation: true,
  /** Sem `require`/`process`/APIs Node no renderer. */
  nodeIntegration: false,
  /** Renderer roda em sandbox do Chromium. */
  sandbox: true,
  /** Bloqueia conteúdo remoto inseguro. */
  webSecurity: true
} as const
