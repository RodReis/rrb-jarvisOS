import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@shared/domain/entities'
import { App } from './App'

/**
 * Tela CHOICE — porta de entrada de cada sessão (SPEC-CHOICE-01).
 *
 * Cobre o que a fatia acrescenta: a CHOICE aparecer após o login (critério 1), escolher um espaço
 * levar ao shell (critério 2), a entrada auditar (critério 7), e o painel TEMA abrir com os
 * seletores de acento e tema. A troca de espaço no meio da sessão **não** é assunto aqui — ela
 * segue no rail, provada em `AppShell.test.tsx` (a spec deixa o rail intacto).
 */

const switchWorkspace = vi.fn()
const getWorkspace = vi.fn()
const getPreferences = vi.fn()
const savePreferences = vi.fn()
const sendLog = vi.fn()

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
      sendLog,
      minimizeToTray: vi.fn(),
      switchWorkspace,
      getWorkspace,
      getPreferences,
      savePreferences,
      listAuditEvents: vi.fn(),
      verifyAuditChain: vi.fn(),
      getAuth: vi.fn().mockResolvedValue({ state: 'ativo', profile: PERFIL }),
      login: vi.fn(),
      logout: vi.fn(),
      onAuthChanged: vi.fn(() => () => undefined)
    },
    configurable: true,
    writable: true
  })
}

/** Espera a CHOICE assentar — os dois cards de espaço presentes. */
async function esperarChoice(): Promise<void> {
  await screen.findByRole('button', { name: /entrar em NOA/i })
  await screen.findByRole('button', { name: /entrar em JARVIS/i })
}

beforeEach(() => {
  switchWorkspace.mockReset()
  sendLog.mockReset()
  savePreferences.mockReset()
  switchWorkspace.mockImplementation((w: WorkspaceId) =>
    Promise.resolve({ workspace: w, auditSeq: 1 })
  )
  getWorkspace.mockResolvedValue('jarvis' as WorkspaceId)
  getPreferences.mockResolvedValue({ locale: 'pt-BR', theme: 'sistema', resolvedTheme: 'escuro' })
  savePreferences.mockImplementation((p: Record<string, unknown>) =>
    Promise.resolve({
      locale: p['locale'] ?? 'pt-BR',
      theme: p['theme'] ?? 'sistema',
      resolvedTheme: p['theme'] === 'claro' ? 'claro' : 'escuro'
    })
  )
  mockarPonte()
})

describe('CHOICE — entrada (critérios 1, 2, 7)', () => {
  it('após o login, o app abre na CHOICE, não no shell (critério 1)', async () => {
    render(<App />)
    await esperarChoice()

    // Os dois espaços, lado a lado, com o título da tela. E o shell ainda não existe.
    expect(screen.getByRole('heading', { name: /escolha o espaço/i })).toBeInTheDocument()
    expect(
      screen.queryByRole('radiogroup', { name: /espaço de trabalho/i })
    ).not.toBeInTheDocument()
    expect(document.querySelector('[data-jos-rail]')).not.toBeInTheDocument()
  })

  it('escolher um card entra no espaço correspondente (critério 2)', async () => {
    render(<App />)
    await esperarChoice()

    await userEvent.click(screen.getByRole('button', { name: /entrar em JARVIS/i }))

    // O shell do espaço escolhido monta.
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('JARVIS OS')
    )
    expect(document.querySelector('[data-jos-rail]')).toBeInTheDocument()
  })

  it('entrar num espaço audita a troca pelo main (critério 7)', async () => {
    render(<App />)
    await esperarChoice()

    await userEvent.click(screen.getByRole('button', { name: /entrar em NOA/i }))

    // A entrada passa pelo main — é o `workspace-switch` da SPEC-04, agora disparado pela CHOICE.
    await waitFor(() => expect(switchWorkspace).toHaveBeenCalledWith('noa'))
    expect(sendLog).toHaveBeenCalledWith(expect.objectContaining({ category: 'ui', level: 'info' }))
  })

  it('a entrada acontece mesmo se a auditoria falhar — navegação não é refém do audit', async () => {
    // Barrar a entrada por um evento de auditoria seria mais grave que a auditoria perdida: o
    // shell monta de todo jeito, e a falha vira log.
    switchWorkspace.mockRejectedValueOnce(new Error('auditoria indisponível'))
    render(<App />)
    await esperarChoice()

    await userEvent.click(screen.getByRole('button', { name: /entrar em JARVIS/i }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('JARVIS OS')
    )
    expect(sendLog).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'ui', level: 'error' })
    )
  })
})

describe('CHOICE — painel TEMA (acento e tema como prévia)', () => {
  it('o painel começa fechado e abre no gatilho', async () => {
    render(<App />)
    await esperarChoice()

    const gatilho = screen.getByRole('button', { name: /ajustar tema e acento/i })
    expect(gatilho).toHaveAttribute('aria-expanded', 'false')
    // Fechado: os grupos de swatch não estão no DOM.
    expect(screen.queryByRole('radiogroup', { name: /acento de NOA/i })).not.toBeInTheDocument()

    await userEvent.click(gatilho)

    expect(gatilho).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('radiogroup', { name: /acento de NOA/i })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: /acento de JARVIS/i })).toBeInTheDocument()
  })

  it('o seletor de tema escreve a preferência (critério 6), sem inverter a CHOICE', async () => {
    render(<App />)
    await esperarChoice()

    await userEvent.click(screen.getByRole('button', { name: /ajustar tema e acento/i }))
    await userEvent.click(screen.getByRole('radio', { name: 'Claro' }))

    // Escreve a preferência de tema da SPEC-Fundacao-05 — a mesma via do Settings.
    await waitFor(() => expect(savePreferences).toHaveBeenCalledWith({ theme: 'claro' }))
    // A CHOICE não inverte: é superfície de marca, permanece escura mesmo com a preferência clara.
    expect(document.querySelector('[data-jos-tela="choice"]')).toBeInTheDocument()
  })
})
