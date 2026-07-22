import { app, BrowserWindow } from 'electron'
import { registerIpcHandlers } from './ipc/handlers'
import { createMainWindow } from './window'

app.whenReady().then(() => {
  // Agrupa a janela sob a identidade correta na barra de tarefas do Windows.
  app.setAppUserModelId('com.rodrigoreis.jarvisos')

  registerIpcHandlers()
  createMainWindow()

  // macOS: recriar a janela ao clicar no dock sem janelas abertas.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

// Tray e "fechar = minimizar" entram na Fatia 02; aqui, fechar tudo encerra o app.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
