import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, shell } from 'electron'
import { RENDERER_SECURITY } from '@shared/contracts/security'

// O main é bundlado como ESM (Electron 28+): `__dirname` não existe nesse escopo.
const currentDir = dirname(fileURLToPath(import.meta.url))

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0f19',
    webPreferences: {
      preload: join(currentDir, '../preload/index.cjs'),
      ...RENDERER_SECURITY
    }
  })

  // Evita o flash de janela em branco: mostra só quando o conteúdo está pronto.
  window.on('ready-to-show', () => window.show())

  // Link externo abre no navegador do sistema, nunca numa janela Electron.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(currentDir, '../renderer/index.html'))
  }

  return window
}
