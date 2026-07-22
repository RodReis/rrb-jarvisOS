import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@shared/domain/entities'
import { App } from './App'

const sendLog = vi.fn()
const minimizeToTray = vi.fn()
const switchWorkspace = vi.fn()
const getWorkspace = vi.fn()
const getPreferences = vi.fn()
const savePreferences = vi.fn()

function mockarPonte(): void {
  Object.defineProperty(window, 'jarvis', {
    value: {
      getAppInfo: vi.fn(),
      sendLog,
      minimizeToTray,
      switchWorkspace,
      getWorkspace,
      getPreferences,
      savePreferences,
      listAuditEvents: vi.fn(),
      verifyAuditChain: vi.fn()
    },
    configurable: true,
    writable: true
  })
}

/** Clica no botão do espaço e espera o header refletir a troca. */
async function trocarPara(nome: string): Promise<void> {
  await userEvent.click(screen.getByRole('radio', { name: new RegExp(nome, 'i') }))
  await waitFor(() =>
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(new RegExp(nome, 'i'))
  )
}

beforeEach(() => {
  sendLog.mockClear()
  minimizeToTray.mockClear()
  savePreferences.mockClear()
  // O main é a fonte do espaço ativo; o mock reflete a troca, como ele faria.
  getWorkspace.mockResolvedValue('jarvis' as WorkspaceId)
  switchWorkspace.mockImplementation((w: WorkspaceId) =>
    Promise.resolve({ workspace: w, auditSeq: 1 })
  )
  getPreferences.mockResolvedValue({
    locale: 'pt-BR',
    theme: 'sistema',
    resolvedTheme: 'escuro'
  })
  savePreferences.mockImplementation((p: Record<string, unknown>) =>
    Promise.resolve({
      locale: p['locale'] ?? 'pt-BR',
      theme: p['theme'] ?? 'sistema',
      resolvedTheme: p['theme'] === 'claro' ? 'claro' : 'escuro'
    })
  )
  mockarPonte()
})

describe('AppShell', () => {
  it('abre sempre no JARVIS OS (decisão do PI)', async () => {
    render(<App />)

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('JARVIS OS')
  })

  it('identifica o espaço ativo em qualquer tela (critério 2)', async () => {
    render(<App />)
    await screen.findByRole('heading', { level: 1 })

    expect(screen.getByRole('radio', { name: /JARVIS OS/i })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('radio', { name: /NOA/i })).toHaveAttribute('aria-checked', 'false')
  })

  it('não oferece Desenvolvimento como espaço (critério 5)', async () => {
    render(<App />)
    await screen.findByRole('heading', { level: 1 })

    const espacos = screen.getAllByRole('radio').map((b) => b.textContent ?? '')

    expect(espacos).toHaveLength(2)
    expect(espacos.join(' ')).not.toMatch(/desenvolvimento|agentic/i)
  })

  it('A→B→A restaura a rota de A e a de B nunca vaza (critério 1)', async () => {
    // O cenário exato do critério de aceite, agora pela UI real.
    render(<App />)
    await screen.findByRole('heading', { level: 1 })

    // Navega no JARVIS até "Operações".
    await userEvent.click(screen.getByRole('button', { name: 'Operações' }))
    expect(screen.getByRole('button', { name: 'Operações' })).toHaveAttribute(
      'aria-current',
      'page'
    )

    // Vai para o NOA: a rota do JARVIS não pode aparecer aqui.
    await trocarPara('NOA')
    expect(screen.queryByRole('button', { name: 'Operações' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Agenda' }))

    // Volta ao JARVIS: a rota dele foi preservada.
    await trocarPara('JARVIS OS')
    expect(screen.getByRole('button', { name: 'Operações' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.queryByRole('button', { name: 'Agenda' })).not.toBeInTheDocument()
  })

  it('troca de espaço passa pelo main, que audita', async () => {
    // A UI não muda o espaço sozinha: pede ao main e reflete o que ele devolveu.
    render(<App />)
    await screen.findByRole('heading', { level: 1 })

    await trocarPara('NOA')

    expect(switchWorkspace).toHaveBeenCalledWith('noa')
    expect(sendLog).toHaveBeenCalledWith(expect.objectContaining({ category: 'ui', level: 'info' }))
  })

  it('mostra erro e não troca o espaço quando o main recusa', async () => {
    // Se a auditoria falhar no main, o espaço não muda — a UI tem de refletir isso.
    switchWorkspace.mockRejectedValueOnce(new Error('auditoria falhou'))
    render(<App />)
    await screen.findByRole('heading', { level: 1 })

    await userEvent.click(screen.getByRole('radio', { name: /NOA/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível alternar/i)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('JARVIS OS')
    expect(sendLog).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'ui', level: 'error' })
    )
  })

  it('pede ao main para minimizar para a bandeja', async () => {
    render(<App />)
    await screen.findByRole('heading', { level: 1 })

    await userEvent.click(screen.getByRole('button', { name: /minimizar/i }))

    expect(minimizeToTray).toHaveBeenCalled()
  })

  it('exibe erro quando a ponte falha ao carregar o espaço', async () => {
    getWorkspace.mockRejectedValueOnce(new Error('sem ponte'))
    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/espaço de trabalho/i)
  })

  it('não acessa Node — a ponte é a única superfície usada', () => {
    const janela = window as unknown as Record<string, unknown>

    expect(janela.require).toBeUndefined()
    expect(janela.module).toBeUndefined()
  })
})

describe('Settings (SPEC-05)', () => {
  /** Entra na tela de Settings do espaço ativo. */
  async function abrirSettings(): Promise<void> {
    await screen.findByRole('heading', { level: 1 })
    await userEvent.click(screen.getByRole('button', { name: 'Configurações' }))
  }

  it('é acessível nos dois workspaces', async () => {
    render(<App />)
    await abrirSettings()
    expect(screen.getByLabelText('Idioma')).toBeInTheDocument()

    // Troca de espaço e confirma que a tela continua alcançável.
    await trocarPara('NOA')
    await userEvent.click(screen.getByRole('button', { name: 'Configurações' }))
    expect(screen.getByLabelText('Idioma')).toBeInTheDocument()
  })

  it('troca o idioma e a UI muda na hora, sem reiniciar (critério 1)', async () => {
    render(<App />)
    await abrirSettings()

    await userEvent.selectOptions(screen.getByLabelText('Idioma'), 'en-US')

    // A prova da troca a quente: o próprio rótulo da tela muda de idioma.
    expect(await screen.findByLabelText('Language')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(savePreferences).toHaveBeenCalledWith({ locale: 'en-US' })
  })

  it('aplica o tema escolhido no documento (critério 2)', async () => {
    render(<App />)
    await abrirSettings()

    await userEvent.click(screen.getByRole('radio', { name: 'Claro' }))

    await waitFor(() => expect(document.documentElement.dataset.tema).toBe('claro'))
    expect(savePreferences).toHaveBeenCalledWith({ theme: 'claro' })
  })

  it('aplica o tema resolvido pelo main quando a preferência é `sistema`', async () => {
    // `sistema` não pinta nada por si: quem resolve para claro/escuro é o main, via
    // `nativeTheme`. A UI aplica o resultado.
    render(<App />)
    await abrirSettings()

    await waitFor(() => expect(document.documentElement.dataset.tema).toBe('escuro'))
    expect(screen.getByRole('radio', { name: 'Sistema' })).toHaveAttribute('aria-checked', 'true')
  })

  it('mostra erro quando o main recusa a gravação', async () => {
    savePreferences.mockRejectedValueOnce(new Error('disco cheio'))
    render(<App />)
    await abrirSettings()

    await userEvent.click(screen.getByRole('radio', { name: 'Escuro' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível salvar/i)
  })

  it('a rota de Settings também é preservada por espaço', async () => {
    // Settings é rota dos dois espaços, não uma exceção fora do mapa — então segue a
    // mesma regra de isolamento (SPEC-02, critério 1).
    render(<App />)
    await abrirSettings()

    await trocarPara('NOA')
    expect(screen.queryByLabelText('Idioma')).not.toBeInTheDocument()

    await trocarPara('JARVIS OS')
    expect(screen.getByLabelText('Idioma')).toBeInTheDocument()
  })
})
