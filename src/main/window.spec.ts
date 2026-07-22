import { describe, expect, it, vi } from 'vitest'
import { RENDERER_SECURITY } from '@shared/contracts/security'

const construtorDeJanela = vi.fn()

class BrowserWindowFake {
  webContents = { setWindowOpenHandler: vi.fn() }
  constructor(options: unknown) {
    construtorDeJanela(options)
  }
  on(): this {
    return this
  }
  loadURL(): void {}
  loadFile(): void {}
  show(): void {}
}

vi.mock('electron', () => ({
  app: { isPackaged: true },
  BrowserWindow: BrowserWindowFake,
  shell: { openExternal: vi.fn() }
}))

/**
 * A constante de segurança estar correta não basta: a janela precisa realmente usá-la.
 * Este teste liga as duas pontas (critério de aceite 3 da SPEC-Fundacao-01).
 */
describe('createMainWindow', () => {
  it('aplica as opções de segurança do contrato no webPreferences', async () => {
    const { createMainWindow } = await import('./window')
    createMainWindow()

    const options = construtorDeJanela.mock.calls[0]?.[0] as {
      webPreferences: Record<string, unknown>
    }
    expect(options.webPreferences).toMatchObject(RENDERER_SECURITY)
  })

  it('carrega um preload — o renderer nunca fica sem a ponte', async () => {
    construtorDeJanela.mockClear()
    const { createMainWindow } = await import('./window')
    createMainWindow()

    const options = construtorDeJanela.mock.calls[0]?.[0] as {
      webPreferences: { preload?: string }
    }
    expect(options.webPreferences.preload).toMatch(/preload/)
  })
})
