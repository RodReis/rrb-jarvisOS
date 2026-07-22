import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REDACTED_PLACEHOLDER } from '@shared/contracts/logging'
import { log } from './log'

const sendLog = vi.fn()

function mockarPonte(): void {
  Object.defineProperty(window, 'jarvis', {
    value: { getAppInfo: vi.fn(), sendLog },
    configurable: true,
    writable: true
  })
}

function removerPonte(): void {
  Object.defineProperty(window, 'jarvis', { value: undefined, configurable: true, writable: true })
}

beforeEach(() => {
  sendLog.mockClear()
  mockarPonte()
})

describe('logger do renderer', () => {
  it('encaminha o registro pela ponte, sem escrever em disco', () => {
    // O renderer não tem acesso ao disco (fronteira de segurança da Fatia 01): tudo o que
    // ele pode fazer é entregar o registro ao main.
    log.ui.info('Tela carregada', { rota: '/' })

    expect(sendLog).toHaveBeenCalledWith({
      level: 'info',
      category: 'ui',
      msg: 'Tela carregada',
      ctx: { rota: '/' }
    })
  })

  it.each(['error', 'warn', 'info'] as const)('expõe o nível %s', (nivel) => {
    log.ui[nivel]('mensagem')

    expect(sendLog).toHaveBeenCalledWith(expect.objectContaining({ level: nivel }))
  })

  it('redige o segredo antes de atravessar o IPC', () => {
    // O main redige de novo antes de gravar; redigir aqui evita que o valor sequer trafegue.
    log.auth.error('Falha ao renovar sessão', { refreshToken: 'rt-secreto' })

    const [registro] = sendLog.mock.calls[0] as [{ ctx: Record<string, unknown> }]
    expect(registro.ctx['refreshToken']).toBe(REDACTED_PLACEHOLDER)
    expect(JSON.stringify(sendLog.mock.calls)).not.toContain('rt-secreto')
  })

  it('não quebra a UI quando a ponte não existe', () => {
    // Em teste de componente (jsdom) e antes de o preload carregar não há ponte. Um logger
    // que derruba a tela por não conseguir logar seria pior que o silêncio.
    removerPonte()

    expect(() => log.ui.info('sem ponte')).not.toThrow()
    expect(sendLog).not.toHaveBeenCalled()
  })

  it('oferece todas as categorias do contrato, inclusive as ainda sem fluxo', () => {
    // `ai`, `agent` e `integracao` nascem em MVPs posteriores. Existirem já com a mesma
    // assinatura é o que faz o log de in/out nascer padronizado quando elas chegarem.
    for (const categoria of ['integracao', 'ai', 'agent', 'db', 'auth', 'ipc', 'ui', 'sistema']) {
      expect(log[categoria as keyof typeof log]).toMatchObject({
        error: expect.any(Function),
        warn: expect.any(Function),
        info: expect.any(Function)
      })
    }
  })
})
