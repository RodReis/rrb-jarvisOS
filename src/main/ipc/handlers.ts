import { app, ipcMain } from 'electron'
import { IPC_CHANNELS, IPC_SEND_CHANNELS, type AppInfo } from '@shared/contracts/ipc'
import { parseLogInput } from '@shared/contracts/logging-input'
import { log, writeLog } from '../logging/logger'

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
 * Registra os handlers dos canais declarados em `IPC_CHANNELS` e `IPC_SEND_CHANNELS`.
 * Cada canal do contrato tem exatamente um handler aqui — não há rota genérica.
 *
 * A regra "todo método loga" (CONVENTION §3) vale aqui: cada canal emite `info` no fluxo
 * normal e `error` na falha, com `direction` marcando a entrada e a saída da chamada.
 */
export function registerIpcHandlers(): void {
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
}
