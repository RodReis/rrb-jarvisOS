import { describe, expect, it } from 'vitest'
import { RENDERER_SECURITY } from './security'

/**
 * Fronteira de segurança do renderer (docs/ARCHITECTURE.md; critério de aceite 3 da
 * SPEC-Fundacao-01). Estas asserções são o que impede uma regressão silenciosa: se
 * alguém ligar nodeIntegration ou desligar o sandbox, o teste quebra.
 */
describe('segurança do renderer', () => {
  it('mantém contextIsolation ligado', () => {
    expect(RENDERER_SECURITY.contextIsolation).toBe(true)
  })

  it('mantém nodeIntegration desligado — renderer não alcança require/process', () => {
    expect(RENDERER_SECURITY.nodeIntegration).toBe(false)
  })

  it('mantém o sandbox do Chromium ligado', () => {
    expect(RENDERER_SECURITY.sandbox).toBe(true)
  })

  it('mantém webSecurity ligada', () => {
    expect(RENDERER_SECURITY.webSecurity).toBe(true)
  })
})
