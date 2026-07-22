/**
 * Ícone de bandeja e o menu Abrir/Sair (SPEC-Fundacao-02).
 *
 * O app é de uso contínuo: fechar a janela o esconde, não o encerra. O tray é o que torna
 * isso reversível — sem ele, "fechar = minimizar" viraria um app que some sem forma de
 * voltar.
 */

import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'
import { log } from './logging/logger'
import { permitirEncerramento } from './window'

/**
 * Referência de módulo: sem ela o `Tray` é coletado pelo GC e o ícone some da bandeja
 * depois de alguns segundos — sintoma clássico e difícil de diagnosticar.
 */
let tray: Tray | undefined

/** Traz a janela de volta, esteja ela escondida, minimizada ou apenas sem foco. */
export function revelarJanela(window: BrowserWindow): void {
  if (!window.isVisible()) window.show()
  if (window.isMinimized()) window.restore()
  window.focus()
}

export function createTray(window: BrowserWindow): Tray {
  // Ícone vazio: a identidade visual entra no MVP-003 (design system). Um `nativeImage`
  // vazio ainda registra o ícone na bandeja e mantém o menu funcional.
  tray = new Tray(nativeImage.createEmpty())
  tray.setToolTip('JARVIS OS')

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Abrir',
        click: () => {
          log.ipc.info('Janela restaurada pelo menu do tray')
          revelarJanela(window)
        }
      },
      { type: 'separator' },
      {
        label: 'Sair',
        click: () => {
          log.sistema.info('Encerramento solicitado pelo menu do tray')
          // Levanta a flag antes do quit: senão o handler de `close` da janela
          // interceptaria o fechamento e o app apenas se esconderia de novo.
          permitirEncerramento()
          app.quit()
        }
      }
    ])
  )

  // Clique no ícone restaura — o gesto que o usuário tenta primeiro.
  tray.on('click', () => revelarJanela(window))

  return tray
}

export function destroyTray(): void {
  tray?.destroy()
  tray = undefined
}
