import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, shell } from 'electron'
import { RENDERER_SECURITY } from '@shared/contracts/security'

// O main é bundlado como ESM (Electron 28+): `__dirname` não existe nesse escopo.
const currentDir = dirname(fileURLToPath(import.meta.url))

/**
 * Sinaliza que o app está encerrando de verdade.
 *
 * Sem isto o handler de `close` minimizaria para o tray também no "Sair", e o app nunca
 * fecharia — o clássico "não consigo mais sair do programa". Quem sai de verdade chama
 * `permitirEncerramento()` antes de `app.quit()`.
 */
let encerrando = false

export function permitirEncerramento(): void {
  encerrando = true
}

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

  // Fechar no "X" = minimizar para o tray (SPEC-02, decisão do PI: sem prompt). O app
  // segue rodando; só o "Sair" do tray encerra, e ele levanta a flag antes.
  window.on('close', (event) => {
    if (encerrando) return
    event.preventDefault()
    window.hide()
  })

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
