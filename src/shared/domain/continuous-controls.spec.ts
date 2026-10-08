import { describe, expect, it } from 'vitest'
import { isComandoDeControle, isEscopoDeControle } from './continuous-controls'

describe('contratos de controles operacionais', () => {
  it('valida escopos sem aceitar identidade vazia nem projeto em branco', () => {
    expect(isEscopoDeControle({ userId: 'u-1', workspaceId: 'jarvis' })).toBe(true)
    expect(isEscopoDeControle({ userId: '', workspaceId: 'jarvis' })).toBe(false)
    expect(isEscopoDeControle({ userId: 'u-1', workspaceId: 'jarvis', projectId: ' ' })).toBe(false)
  })

  it('aceita pausa e switches fechados, rejeita ação inventada', () => {
    expect(
      isComandoDeControle({
        escopo: { userId: 'u-1', workspaceId: 'jarvis' },
        acao: { tipo: 'pausa', pausada: true },
        idempotencyKey: 'k1'
      })
    ).toBe(true)
    expect(
      isComandoDeControle({
        escopo: { userId: 'u-1', workspaceId: 'jarvis', projectId: 'p-1' },
        acao: { tipo: 'pausa', pausada: null },
        idempotencyKey: 'k1b'
      })
    ).toBe(true)
    expect(
      isComandoDeControle({
        escopo: { userId: 'u-1', workspaceId: 'jarvis' },
        acao: { tipo: 'switch', controle: 'merge', habilitado: null },
        idempotencyKey: 'k2'
      })
    ).toBe(true)
    expect(
      isComandoDeControle({
        escopo: { userId: 'u-1', workspaceId: 'jarvis' },
        acao: { tipo: 'switch', controle: 'shell', habilitado: true },
        idempotencyKey: 'k3'
      })
    ).toBe(false)
  })
})
