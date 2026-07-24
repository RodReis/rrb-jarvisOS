import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@shared/domain/entities'
import { entrarPelaChoice } from './test-utils'

/**
 * AppShell re-plataformado: navegação e resiliência (SPEC-DesignSystem-04a, critérios 1, 3 e 4).
 *
 * Complementa `AppShell.test.tsx`, que **não foi tocado**: aqueles 15 testes provam que as
 * garantias da SPEC-Fundacao-02 sobreviveram à troca de plataforma visual. Esta suíte prova o
 * que a F04a acrescenta — o toggle de tema na topbar, o rail dual do JARVIS e a resiliência do
 * shell.
 *
 * O critério 2 (WorkspaceSwitcher) não se repete aqui: ele já é o assunto de quatro testes do
 * arquivo da fundação, e reescrevê-los mediria a mesma coisa duas vezes.
 */

const minimizeToTray = vi.fn()
const switchWorkspace = vi.fn()
const getWorkspace = vi.fn()
const getPreferences = vi.fn()
const savePreferences = vi.fn()
const getAuth = vi.fn()

const PERFIL_LOGADO = {
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
      minimizeToTray,
      switchWorkspace,
      getWorkspace,
      getPreferences,
      savePreferences,
      listAuditEvents: vi.fn(),
      verifyAuditChain: vi.fn(),
      getAuth,
      login: vi.fn(),
      logout: vi.fn(),
      onAuthChanged: vi.fn(() => () => undefined)
    },
    configurable: true,
    writable: true
  })
}

/**
 * Entra pela CHOICE e espera o shell montar. Com a SPEC-CHOICE-01 o `App` abre na CHOICE, não no
 * shell; a travessia mora em `entrarPelaChoice` (test-utils). O default `jarvis` reproduz o antigo
 * destino de entrada, então o que cada teste prova sobre o shell não muda — só o caminho até ele.
 */
async function esperarShell(espaco: WorkspaceId = 'jarvis'): Promise<void> {
  await entrarPelaChoice(espaco)
}

beforeEach(() => {
  minimizeToTray.mockClear()
  savePreferences.mockClear()
  getAuth.mockResolvedValue({ state: 'ativo', profile: PERFIL_LOGADO })
  getWorkspace.mockResolvedValue('jarvis' as WorkspaceId)
  switchWorkspace.mockImplementation((w: WorkspaceId) =>
    Promise.resolve({ workspace: w, auditSeq: 1 })
  )
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

describe('critério 1 — o shell compõe o grid e o toggle troca o `uiTheme`', () => {
  it('monta rail, sidebar, topbar e rodapé', async () => {
    await esperarShell()

    // Por marcador estrutural: o teste afirma que as **quatro regiões do grid do protótipo**
    // existem, sem depender do texto que cada uma exibe (que é conteúdo, não estrutura).
    expect(document.querySelector('[data-jos-rail]')).toBeInTheDocument()
    expect(document.querySelector('[data-jos-sidebar]')).toBeInTheDocument()
    expect(document.querySelector('[data-jos-topbar]')).toBeInTheDocument()
    expect(document.querySelector('[data-jos-rodape]')).toBeInTheDocument()
  })

  it('o toggle sol/lua alterna o tema sem reload, persistindo pela mesma via do Settings', async () => {
    await esperarShell()

    const toggle = screen.getByRole('button', { name: /alternar entre tema/i })
    // `aria-pressed` é o que o leitor de tela usa para dizer se o claro está ligado.
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(toggle)

    // Persiste pelo caminho do Settings (SPEC-Fundacao-05) em vez de estado local: os dois
    // controles mexem na mesma preferência e discordariam se cada um guardasse a sua.
    await waitFor(() => expect(savePreferences).toHaveBeenCalledWith({ theme: 'claro' }))
    await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'))
  })

  it('o tema aplicado é o resolvido pelo main, não a preferência crua', async () => {
    // `theme: 'sistema'` não diz se pinta claro ou escuro — quem resolve é o main. Ler a
    // preferência crua aqui deixaria o shell escuro com o sistema em claro.
    getPreferences.mockResolvedValue({ locale: 'pt-BR', theme: 'sistema', resolvedTheme: 'claro' })
    await esperarShell()

    expect(screen.getByRole('button', { name: /alternar entre tema/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })
})

describe('critério 3 — rail dual do JARVIS', () => {
  it('oferece Command Center e Agents OS, com o ativo marcado', async () => {
    await esperarShell()

    const command = screen.getByRole('button', { name: /command center/i })
    expect(command).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: /agents os/i })).not.toHaveAttribute('aria-current')
  })

  it('alternar o rail troca a navegação da sidebar — as duas não discordam', async () => {
    await esperarShell()

    // No Command Center, "Operações" está na sidebar e "Agentes" não.
    expect(screen.getByRole('button', { name: 'Operações' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agentes' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /agents os/i }))

    // Depois da troca, inverte-se — e o rail acompanha. Um estado de sub-módulo separado da
    // rota deixaria o rail aceso num lado e a sidebar no outro.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Agentes' })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Operações' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /agents os/i })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  it('o NOA não tem rail dual — o sub-módulo é do JARVIS, não um quarto espaço', async () => {
    // `Agentic OS` é área interna do JARVIS (CLAUDE.md § Regras técnicas invioláveis). Se ele
    // aparecesse no NOA, teria virado um espaço por acidente.
    getWorkspace.mockResolvedValue('noa' as WorkspaceId)
    await esperarShell('noa')

    expect(screen.queryByRole('button', { name: /agents os/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /command center/i })).not.toBeInTheDocument()
  })
})

describe('critério 4 — o shell sobrevive à falha do runtime', () => {
  it('mantém navegação e contexto visual quando a ponte falha ao trocar de espaço', async () => {
    // A falha simulada é a mais próxima de "runtime caiu" que o shell pode observar: o main
    // recusa a chamada. O critério 4 exige que isso **não** derrube o shell (PRD §16.3).
    switchWorkspace.mockRejectedValue(new Error('runtime indisponível'))
    await esperarShell()

    await userEvent.click(screen.getByRole('radio', { name: /noa/i }))

    // O aviso aparece…
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    // …e o shell continua inteiro e navegável: as quatro regiões de pé, e a navegação responde.
    expect(document.querySelector('[data-jos-rail]')).toBeInTheDocument()
    expect(document.querySelector('[data-jos-sidebar]')).toBeInTheDocument()
    expect(document.querySelector('[data-jos-topbar]')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Operações' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Operações' })).toHaveAttribute(
        'aria-current',
        'page'
      )
    )
  })

  it('a falha não troca o espaço — o shell reflete o main, não o clique', async () => {
    switchWorkspace.mockRejectedValue(new Error('runtime indisponível'))
    await esperarShell()

    await userEvent.click(screen.getByRole('radio', { name: /noa/i }))
    await screen.findByRole('alert')

    // Continua no JARVIS: o espaço ativo é o que o main confirmou, e ele recusou.
    expect(screen.getByRole('radio', { name: /jarvis/i })).toHaveAttribute('aria-checked', 'true')
  })
})
