import { app, ipcMain } from 'electron'
import { IPC_CHANNELS, type AppInfo } from '@shared/contracts/ipc'

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
 * Registra os handlers dos canais declarados em `IPC_CHANNELS`.
 * Cada canal do contrato tem exatamente um handler aqui — não há rota genérica.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.appInfo, () => buildAppInfo())
}
