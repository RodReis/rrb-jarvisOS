import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@shared/domain/entities'
import { App } from './App'
import { entrarPelaChoice } from './test-utils'
import { ROTEAMENTO_PADRAO } from '@shared/domain/routing'

const sendLog = vi.fn()
const minimizeToTray = vi.fn()
const switchWorkspace = vi.fn()
const getWorkspace = vi.fn()
const getPreferences = vi.fn()
const savePreferences = vi.fn()
const getAuth = vi.fn()
const login = vi.fn()
const logout = vi.fn()
const listPendingApprovals = vi.fn()
const resolveApproval = vi.fn()
const runWorkflowReal = vi.fn()
const listCredentials = vi.fn()
const getBudget = vi.fn()
const getProviderStatus = vi.fn()
const getProviderModels = vi.fn()
const setProviderModel = vi.fn()
const getRouting = vi.fn()
const setRoute = vi.fn()
const setBudgetLimits = vi.fn()
const setCredential = vi.fn()
// SPEC-Providers-02: o painel de chamada de IA vive no Settings e assina o canal de stream ao
// montar. Sem estes no dublê, montar o Settings estoura antes de qualquer asserção.
const callAi = vi.fn()
const cancelAi = vi.fn()
const onAiStreamEvent = vi.fn(() => () => {})
const removeCredential = vi.fn()
// SPEC-ExecucaoReal-03: a seção de diretórios permitidos também consulta a ponte ao montar,
// e as duas leituras vão num `Promise.all` — faltando qualquer uma, a seção inteira cai no
// `catch` e põe um segundo `role="alert"` na página.
const listAllowedDirectories = vi.fn(() => Promise.resolve([]))
const getAppDirectory = vi.fn(() => Promise.resolve('/app/userData'))
const pickAllowedDirectory = vi.fn(() => Promise.resolve([]))
const removeAllowedDirectory = vi.fn(() => Promise.resolve([]))

/**
 * Perfil da sessão usada nestes testes. O `App` só monta o AppShell quando a auth está
 * `ativo` (SPEC-03), então a suíte do shell precisa partir de um usuário logado — o que
 * ela investiga é espaço e preferências, não o gate de entrada.
 */
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
      sendLog,
      minimizeToTray,
      switchWorkspace,
      getWorkspace,
      getPreferences,
      savePreferences,
      listAuditEvents: vi.fn(),
      verifyAuditChain: vi.fn(),
      getAuth,
      login,
      logout,
      runWorkflowReal,
      listPendingApprovals,
      resolveApproval,
      // A seção de credenciais do Settings (SPEC-Providers-01) consulta a ponte ao montar.
      // Sem estes três, a tela cai no `catch` e exibe o próprio alerta de erro — que é como
      // este mock incompleto se manifestaria: um segundo `role="alert"` na página.
      listCredentials,
      setCredential,
      // Mesma razão dos três acima: o painel de orçamento (SPEC-Providers-03) consulta a ponte
      // ao montar, e sem estes dois a tela cai no `catch` e exibe o próprio alerta de erro.
      getBudget,
      setBudgetLimits,
      // Mesma razão dos anteriores: a tela de providers (SPEC-Providers-04) consulta a ponte
      // ao montar. Sem estes cinco ela cai no `catch` e o Settings dos testes exercitaria um
      // painel em estado de erro — verde, mas não é o Settings que o usuário vê.
      getProviderStatus,
      getProviderModels,
      setProviderModel,
      getRouting,
      setRoute,
      callAi,
      cancelAi,
      onAiStreamEvent,
      removeCredential,
      listAllowedDirectories,
      getAppDirectory,
      pickAllowedDirectory,
      removeAllowedDirectory,
      // Devolve a função de cancelamento, como a ponte real: sem isso o `useEffect`
      // tentaria chamar `undefined` na desmontagem e o cleanup estouraria.
      onAuthChanged: vi.fn(() => () => undefined)
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
  listCredentials.mockResolvedValue([])
  const ORCAMENTO_PADRAO = {
    policy: {
      user_id: 'u-1',
      workspace_id: 'jarvis' as const,
      dailyLimit: 1,
      monthlyLimit: 1,
      alertThreshold: 0.8,
      currency: 'USD' as const
    },
    gasto: { diaUsd: 0, mesUsd: 0 }
  }
  getBudget.mockResolvedValue(ORCAMENTO_PADRAO)
  getProviderStatus.mockResolvedValue([])
  getProviderModels.mockResolvedValue([])
  setProviderModel.mockResolvedValue(true)
  const ROTAS_PADRAO = { user_id: 'u-1', workspace_id: 'jarvis' as const, rotas: ROTEAMENTO_PADRAO }
  getRouting.mockResolvedValue(ROTAS_PADRAO)
  setRoute.mockResolvedValue(ROTAS_PADRAO)
  setBudgetLimits.mockResolvedValue(ORCAMENTO_PADRAO)
  setCredential.mockResolvedValue([])
  onAiStreamEvent.mockReturnValue(() => {})
  removeCredential.mockResolvedValue([])
  minimizeToTray.mockClear()
  savePreferences.mockClear()
  listPendingApprovals.mockClear()
  resolveApproval.mockClear()
  runWorkflowReal.mockClear()
  getAuth.mockResolvedValue({ state: 'ativo', profile: PERFIL_LOGADO })
  listPendingApprovals.mockResolvedValue([])
  resolveApproval.mockResolvedValue({ id: 'run-1', state: 'concluido' })
  runWorkflowReal.mockResolvedValue({ id: 'run-1', state: 'concluido' })
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
  // Antes ("abre sempre no JARVIS OS") esta suíte partia direto do shell. Com a SPEC-CHOICE-01 o
  // app abre na CHOICE (a regra "sempre JARVIS" foi **revogada** pela emenda à SPEC-Fundacao-02),
  // e o shell só monta depois de escolher um espaço. `entrarPelaChoice()` atravessa a CHOICE; o
  // que cada teste prova sobre o shell não muda — só o caminho até ele.

  it('identifica o espaço ativo em qualquer tela (critério 2)', async () => {
    await entrarPelaChoice()

    expect(screen.getByRole('radio', { name: /JARVIS OS/i })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('radio', { name: /NOA/i })).toHaveAttribute('aria-checked', 'false')
  })

  it('não oferece Desenvolvimento como espaço (critério 5)', async () => {
    await entrarPelaChoice()

    const espacos = screen.getAllByRole('radio').map((b) => b.textContent ?? '')

    expect(espacos).toHaveLength(2)
    expect(espacos.join(' ')).not.toMatch(/desenvolvimento|agentic/i)
  })

  it('A→B→A restaura a rota de A e a de B nunca vaza (critério 1)', async () => {
    // O cenário exato do critério de aceite, agora pela UI real.
    await entrarPelaChoice()

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
    await entrarPelaChoice()
    switchWorkspace.mockClear() // ignora a chamada da entrada pela CHOICE; o assunto é a troca no rail.

    await trocarPara('NOA')

    expect(switchWorkspace).toHaveBeenCalledWith('noa')
    expect(sendLog).toHaveBeenCalledWith(expect.objectContaining({ category: 'ui', level: 'info' }))
  })

  it('mostra erro e não troca o espaço quando o main recusa', async () => {
    // Se a auditoria falhar no main, o espaço não muda — a UI tem de refletir isso.
    await entrarPelaChoice()
    switchWorkspace.mockRejectedValueOnce(new Error('auditoria falhou'))

    await userEvent.click(screen.getByRole('radio', { name: /NOA/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível alternar/i)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('JARVIS OS')
    expect(sendLog).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'ui', level: 'error' })
    )
  })

  it('pede ao main para minimizar para a bandeja', async () => {
    await entrarPelaChoice()

    await userEvent.click(screen.getByRole('button', { name: /minimizar/i }))

    expect(minimizeToTray).toHaveBeenCalled()
  })

  it('mostra aprovações pendentes em Operações e resolve pela ponte', async () => {
    listPendingApprovals.mockResolvedValueOnce([
      {
        id: 'apr-1',
        user_id: 'u-1',
        workspace_id: 'jarvis',
        runId: 'run-1',
        stepId: 's-read',
        action: 'fs.list-allowed',
        status: 'pendente',
        risk: 'medio',
        reason: 'elevada-por-path-fora-da-allowlist',
        operation: { kind: 'read', path: 'C:\\fora\\entrada.txt' },
        created_at: '2026-07-24T10:00:00.000Z'
      }
    ])

    await entrarPelaChoice()
    await userEvent.click(screen.getByRole('button', { name: 'Operações' }))

    expect(await screen.findByText('Etapa s-read')).toBeInTheDocument()
    expect(
      screen.getByText('Autoriza uma exceção pontual fora da allowlist para esta execução.')
    ).toBeInTheDocument()

    const aprovar = screen.getByRole('button', { name: 'Aprovar' })
    aprovar.focus()
    await userEvent.keyboard('{Enter}')

    expect(resolveApproval).toHaveBeenCalledWith('apr-1', 'aprovado')
  })

  /**
   * Critério 5 da SPEC-ExecucaoReal-01: a fila é operável por teclado, com foco visível, e o
   * risco nunca aparece só por cor. O teste acima resolve pela ponte mas dá o foco na mão
   * (`.focus()`), o que não prova que a ordem de tabulação chega aos botões — aqui a travessia
   * é por `Tab`, como a de quem só tem o teclado.
   */
  it('percorre a fila de aprovação por teclado, com risco legível sem cor', async () => {
    listPendingApprovals.mockResolvedValueOnce([
      {
        id: 'apr-2',
        user_id: 'u-1',
        workspace_id: 'jarvis',
        runId: 'run-2',
        stepId: 's-delete',
        action: 'fs.delete-move-overwrite',
        status: 'pendente',
        risk: 'alto',
        reason: 'operacao-destrutiva',
        operation: { kind: 'delete', path: 'C:\\permitido\\antigo.txt' },
        created_at: '2026-07-24T10:05:00.000Z'
      }
    ])

    await entrarPelaChoice()
    await userEvent.click(screen.getByRole('button', { name: 'Operações' }))
    await screen.findByText('Etapa s-delete')

    // O risco alto se lê como texto, não só pelo tom: quem não distingue cor continua sabendo.
    expect(screen.getByText('Risco alto')).toBeInTheDocument()

    const aprovar = screen.getByRole('button', { name: 'Aprovar' })
    const negar = screen.getByRole('button', { name: 'Negar' })

    // Tabula até Aprovar em vez de focar na mão — prova que os botões estão na ordem de foco.
    for (let i = 0; i < 40 && document.activeElement !== aprovar; i += 1) {
      await userEvent.tab()
    }
    expect(aprovar).toHaveFocus()
    // O anel de foco do DS (`ANEL_FOCO`, base.ts) é `focus-visible` — aparece para o teclado e
    // não para o clique. Sem ele, o foco existe mas ninguém vê onde está.
    expect(aprovar).toHaveClass('focus-visible:border-[var(--jos-cor-acento)]')

    await userEvent.tab()
    expect(negar).toHaveFocus()

    await userEvent.keyboard('{Enter}')
    expect(resolveApproval).toHaveBeenCalledWith('apr-2', 'negado')
  })

  it('exibe erro quando a ponte falha ao carregar o espaço', async () => {
    // A falha é no `getWorkspace` do boot do shell — que só roda depois de a CHOICE mandar
    // entrar. O shell não monta; o `alert` aparece no lugar do heading, então aqui não se
    // usa `entrarPelaChoice` (ela espera o heading), e sim o clique cru no card.
    getWorkspace.mockRejectedValueOnce(new Error('sem ponte'))
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: /entrar em JARVIS/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/espaço de trabalho/i)
  })

  it('não acessa Node — a ponte é a única superfície usada', () => {
    const janela = window as unknown as Record<string, unknown>

    expect(janela.require).toBeUndefined()
    expect(janela.module).toBeUndefined()
  })
})

describe('Settings (SPEC-05)', () => {
  /** Entra pela CHOICE e abre a tela de Settings do espaço ativo. */
  async function abrirSettings(): Promise<void> {
    await entrarPelaChoice()
    await userEvent.click(screen.getByRole('button', { name: 'Configurações' }))
  }

  it('é acessível nos dois workspaces', async () => {
    await abrirSettings()
    expect(screen.getByLabelText('Idioma')).toBeInTheDocument()

    // Troca de espaço e confirma que a tela continua alcançável.
    await trocarPara('NOA')
    await userEvent.click(screen.getByRole('button', { name: 'Configurações' }))
    expect(screen.getByLabelText('Idioma')).toBeInTheDocument()
  })

  it('troca o idioma e a UI muda na hora, sem reiniciar (critério 1)', async () => {
    await abrirSettings()

    await userEvent.selectOptions(screen.getByLabelText('Idioma'), 'en-US')

    // A prova da troca a quente: o próprio rótulo da tela muda de idioma.
    expect(await screen.findByLabelText('Language')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(savePreferences).toHaveBeenCalledWith({ locale: 'en-US' })
  })

  it('aplica o tema escolhido no documento (critério 2)', async () => {
    await abrirSettings()

    await userEvent.click(screen.getByRole('radio', { name: 'Claro' }))

    await waitFor(() => expect(document.documentElement.dataset.tema).toBe('claro'))
    expect(savePreferences).toHaveBeenCalledWith({ theme: 'claro' })
  })

  it('aplica o tema resolvido pelo main quando a preferência é `sistema`', async () => {
    // `sistema` não pinta nada por si: quem resolve para claro/escuro é o main, via
    // `nativeTheme`. A UI aplica o resultado.
    await abrirSettings()

    await waitFor(() => expect(document.documentElement.dataset.tema).toBe('escuro'))
    expect(screen.getByRole('radio', { name: 'Sistema' })).toHaveAttribute('aria-checked', 'true')
  })

  it('mostra erro quando o main recusa a gravação', async () => {
    await abrirSettings()
    savePreferences.mockRejectedValueOnce(new Error('disco cheio'))

    await userEvent.click(screen.getByRole('radio', { name: 'Escuro' }))

    // `findAllByRole` e não `findByRole`: a tela de Settings tem duas regiões que podem
    // alertar (preferências e credenciais), e uma busca que exige alerta único passaria a
    // depender de a outra estar sempre silenciosa. O que este teste afirma é que **existe**
    // o alerta da gravação — não que ele é o único da página.
    const alertas = await screen.findAllByRole('alert')
    expect(alertas.some((a) => /não foi possível salvar/i.test(a.textContent ?? ''))).toBe(true)
  })

  it('a rota de Settings também é preservada por espaço', async () => {
    // Settings é rota dos dois espaços, não uma exceção fora do mapa — então segue a
    // mesma regra de isolamento (SPEC-02, critério 1).
    await abrirSettings()

    await trocarPara('NOA')
    expect(screen.queryByLabelText('Idioma')).not.toBeInTheDocument()

    await trocarPara('JARVIS OS')
    expect(screen.getByLabelText('Idioma')).toBeInTheDocument()
  })

  it('oferece o acento por módulo com o mesmo seletor da CHOICE (SPEC-CHOICE-01, crit. 5)', async () => {
    await abrirSettings()

    // Os dois grupos de acento, um por módulo — a paleta fechada, não picker livre.
    const grupoNoa = screen.getByRole('radiogroup', { name: /acento de NOA/i })
    const grupoJarvis = screen.getByRole('radiogroup', { name: /acento de JARVIS/i })
    expect(grupoNoa).toBeInTheDocument()
    expect(grupoJarvis).toBeInTheDocument()

    // Escolher grava `accentJarvis` pela mesma via da CHOICE — um valor, dois lugares de edição.
    await userEvent.click(within(grupoJarvis).getByRole('radio', { name: '#D3AF37' }))
    await waitFor(() => expect(savePreferences).toHaveBeenCalledWith({ accentJarvis: '#D3AF37' }))
  })
})
