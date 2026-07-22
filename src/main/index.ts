import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { registerIpcHandlers } from './ipc/handlers'
import { closeLogger, initLogger, log } from './logging/logger'
import { initRendererLogBridge } from './logging/renderer-bridge'
import { closeStorage, initStorage } from './storage'
import { createMainWindow } from './window'

app.whenReady().then(() => {
  // Agrupa a janela sob a identidade correta na barra de tarefas do Windows.
  app.setAppUserModelId('com.rodrigoreis.jarvisos')

  // Logging antes de tudo: uma falha no registro dos handlers ou na criação da janela
  // precisa aparecer no arquivo. `userData/logs` fica fora do repo (ADR-005).
  initLogger(join(app.getPath('userData'), 'logs'), { console: !app.isPackaged })
  initRendererLogBridge()
  log.sistema.info('Aplicação iniciada', {
    versao: app.getVersion(),
    electron: process.versions.electron,
    plataforma: process.platform
  })

  // Storage depois do logger (para uma falha de abertura aparecer no arquivo) e antes dos
  // handlers, que já podem consultá-lo. O banco fica no `userData`, junto dos logs.
  initStorage(app.getPath('userData'))

  registerIpcHandlers()
  createMainWindow()

  // macOS: recriar a janela ao clicar no dock sem janelas abertas.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      log.sistema.info('Janela recriada a partir do dock')
      createMainWindow()
    }
  })
})

// Tray e "fechar = minimizar" entram na Fatia 02; aqui, fechar tudo encerra o app.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Fecha os transports antes de sair; sem isso o último registro pode não chegar ao disco.
app.on('will-quit', () => {
  log.sistema.info('Aplicação encerrada')
  // Banco antes do logger: fechar o SQLite ainda pode gerar registro, e o logger
  // precisa estar vivo para recebê-lo.
  closeStorage()
  closeLogger()
})

// Falha não capturada é o caso em que o log mais importa — e o que mais some sem isto.
process.on('uncaughtException', (error) => {
  log.sistema.error('Exceção não capturada no processo principal', { error })
})

process.on('unhandledRejection', (reason) => {
  log.sistema.error('Promise rejeitada sem tratamento no processo principal', { reason })
})
