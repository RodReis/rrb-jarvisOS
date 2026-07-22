import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppInfo } from '@shared/contracts/ipc'
import { App } from './App'

const appInfo: AppInfo = {
  name: 'JARVIS OS',
  version: '0.1.0',
  electronVersion: '43.2.0',
  environment: 'development'
}

const sendLog = vi.fn()

function mockarPonte(getAppInfo: () => Promise<AppInfo>): void {
  Object.defineProperty(window, 'jarvis', {
    value: { getAppInfo, sendLog },
    configurable: true,
    writable: true
  })
}

describe('App', () => {
  beforeEach(() => {
    sendLog.mockClear()
    mockarPonte(() => Promise.resolve(appInfo))
  })

  it('renderiza o título do app', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'JARVIS OS' })).toBeInTheDocument()
  })

  it('mostra os dados vindos da ponte tipada', async () => {
    render(<App />)
    expect(await screen.findByText('43.2.0')).toBeInTheDocument()
    expect(screen.getByText('0.1.0')).toBeInTheDocument()
  })

  it('não acessa Node — a ponte é a única superfície usada', () => {
    // O renderer roda sem nodeIntegration: `require` e `process` não existem no
    // contexto da página (critério de aceite 3 da SPEC-Fundacao-01).
    const janela = window as unknown as Record<string, unknown>
    expect(janela.require).toBeUndefined()
    expect(janela.module).toBeUndefined()
  })

  it('exibe mensagem de erro quando a ponte falha', async () => {
    mockarPonte(() => Promise.reject(new Error('falhou')))
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar as informações do app.'
    )
  })

  it('loga o carregamento da tela (regra "todo método loga")', async () => {
    render(<App />)
    await screen.findByText('43.2.0')

    expect(sendLog).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'info', category: 'ui', msg: 'Tela inicial carregada' })
    )
  })

  it('loga como error a falha da ponte, além de mostrá-la', async () => {
    mockarPonte(() => Promise.reject(new Error('falhou')))
    render(<App />)
    await screen.findByRole('alert')

    expect(sendLog).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', category: 'ui' })
    )
  })
})
