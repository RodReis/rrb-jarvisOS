/**
 * Gate de autenticação na UI (SPEC-Fundacao-03, critérios 1, 3 e 6).
 *
 * Renderiza o `App`, e não a `TelaLogin` isolada, porque o que a spec exige é o
 * comportamento do gate: quem não está `ativo` não alcança o shell. Testar o componente
 * solto provaria que ele pinta, não que ele protege.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthSnapshot } from '@shared/contracts/auth'
import { App } from '../app/App'

const getAuth = vi.fn()
const login = vi.fn()
const logout = vi.fn()
/** Tipado explicitamente: sem o parâmetro, o vi.fn infere tupla vazia e o teste que
 *  recupera o listener não compila. */
const onAuthChanged = vi.fn((_listener: (snapshot: AuthSnapshot) => void) => () => undefined)

const PERFIL = {
  id: 'u-1',
  name: 'Rodrigo Reis',
  email: 'rodrigo@example.com',
  locale: 'pt-BR' as const,
  theme: 'sistema' as const
}

function mockarPonte(): void {
  Object.defineProperty(window, 'jarvis', {
    value: {
      getAppInfo: vi.fn(),
      sendLog: vi.fn(),
      minimizeToTray: vi.fn(),
      switchWorkspace: vi.fn().mockResolvedValue({ workspace: 'jarvis', auditSeq: 1 }),
      getWorkspace: vi.fn().mockResolvedValue('jarvis'),
      getPreferences: vi
        .fn()
        .mockResolvedValue({ locale: 'pt-BR', theme: 'sistema', resolvedTheme: 'escuro' }),
      savePreferences: vi.fn(),
      listAuditEvents: vi.fn(),
      verifyAuditChain: vi.fn(),
      getAuth,
      login,
      logout,
      onAuthChanged
    },
    configurable: true,
    writable: true
  })
}

/** Renderiza o app com o estado de auth informado e espera a tela assentar. */
async function renderizarCom(snapshot: AuthSnapshot): Promise<void> {
  getAuth.mockResolvedValue(snapshot)
  render(<App />)
  await waitFor(() => expect(getAuth).toHaveBeenCalled())
}

beforeEach(() => {
  getAuth.mockReset()
  login.mockReset()
  logout.mockReset()
  onAuthChanged.mockClear()
  mockarPonte()
})

describe('gate de autenticação', () => {
  it('mostra a tela de login e não monta o shell quando deslogado', async () => {
    await renderizarCom({ state: 'deslogado' })

    expect(await screen.findByRole('button', { name: /entrar com o google/i })).toBeVisible()
    // O shell não pode existir: quem não entrou não alcança espaços nem navegação.
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  })

  it('monta o shell e mostra nome e e-mail quando ativo (critério 1)', async () => {
    await renderizarCom({ state: 'ativo', profile: PERFIL })

    expect(await screen.findByText('Rodrigo Reis')).toBeVisible()
    expect(screen.getByText('rodrigo@example.com')).toBeVisible()
    expect(screen.getByRole('radiogroup')).toBeInTheDocument()
  })

  it('dispara o login pela ponte ao clicar em entrar', async () => {
    login.mockResolvedValue({ state: 'ativo', profile: PERFIL })
    await renderizarCom({ state: 'deslogado' })

    await userEvent.click(await screen.findByRole('button', { name: /entrar com o google/i }))

    expect(login).toHaveBeenCalledTimes(1)
  })

  it('desabilita o botão enquanto autentica e explica que o navegador abriu', async () => {
    await renderizarCom({ state: 'autenticando' })

    const botao = await screen.findByRole('button', { name: /aguardando o navegador/i })
    expect(botao).toBeDisabled()
    expect(screen.getByText(/volte aqui quando terminar/i)).toBeVisible()
  })

  it('exibe a mensagem do main no erro, sem stack trace (critério 6)', async () => {
    const mensagem = 'Sem conexão com a internet. Verifique a rede e tente entrar de novo.'
    await renderizarCom({ state: 'erro', mensagem })

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(mensagem)
    // Nada de rastro técnico na tela: nem stack, nem nome de arquivo, nem "Error:".
    expect(alerta.textContent).not.toMatch(/\bat\s|\.ts:\d+|Error:/)
  })

  it('sessão expirada avisa e oferece tentar novamente', async () => {
    await renderizarCom({
      state: 'sessao-expirada',
      mensagem: 'Sua sessão expirou. Entre novamente para continuar.'
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(/sessão expirou/i)
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeVisible()
  })

  it('logout volta para a tela de login (critério 3)', async () => {
    logout.mockResolvedValue({ state: 'deslogado' })
    await renderizarCom({ state: 'ativo', profile: PERFIL })

    await userEvent.click(await screen.findByRole('button', { name: /^sair$/i }))

    expect(logout).toHaveBeenCalledTimes(1)
    // A UI reflete o que o main devolveu: o shell some e o perfil deixa de ser exibido.
    await waitFor(() => expect(screen.queryByText('rodrigo@example.com')).not.toBeInTheDocument())
    expect(await screen.findByRole('button', { name: /entrar com o google/i })).toBeVisible()
  })

  it('reflete a transição empurrada pelo main sem novo pedido da UI', async () => {
    await renderizarCom({ state: 'autenticando' })

    // O login termina no navegador, minutos depois: quem avisa é o push do main.
    const listener = onAuthChanged.mock.calls[0]?.[0]
    expect(listener).toBeDefined()
    listener?.({ state: 'ativo', profile: PERFIL })

    expect(await screen.findByText('rodrigo@example.com')).toBeVisible()
  })
})
