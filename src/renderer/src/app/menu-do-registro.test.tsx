import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@shared/domain/entities'
import { entrarPelaChoice } from './test-utils'

/**
 * A sidebar como projeção do registro (SPEC-Shell-01, critérios 1 a 5).
 *
 * Arquivo próprio, e a ponte instalada com `vi.stubGlobal`: os vizinhos que usam
 * `Object.defineProperty` deixam a propriedade sobreviver ao `unstubAllGlobals`, e o efeito só
 * aparece no CI, num arquivo que não é o culpado.
 */

const getWorkspace = vi.fn()
const getPreferences = vi.fn()
const getAuth = vi.fn()
const switchWorkspace = vi.fn()

const PERFIL = {
  id: 'u-1',
  name: 'Rodrigo Reis',
  email: 'rodrigo@example.com',
  locale: 'pt-BR' as const,
  theme: 'sistema' as const
}

beforeEach(() => {
  getAuth.mockResolvedValue({ state: 'ativo', profile: PERFIL })
  getWorkspace.mockResolvedValue('jarvis' as WorkspaceId)
  switchWorkspace.mockImplementation((w: WorkspaceId) =>
    Promise.resolve({ workspace: w, auditSeq: 1 })
  )
  getPreferences.mockResolvedValue({ locale: 'pt-BR', theme: 'sistema', resolvedTheme: 'escuro' })

  vi.stubGlobal('jarvis', {
    getAppInfo: vi.fn(),
    sendLog: vi.fn(),
    minimizeToTray: vi.fn(),
    switchWorkspace,
    getWorkspace,
    getPreferences,
    savePreferences: vi.fn(async () => ({
      locale: 'pt-BR',
      theme: 'sistema',
      resolvedTheme: 'escuro'
    })),
    listAuditEvents: vi.fn(),
    verifyAuditChain: vi.fn(),
    getAuth,
    login: vi.fn(),
    logout: vi.fn(),
    runWorkflowReal: vi.fn(),
    listPendingApprovals: vi.fn(async () => []),
    resolveApproval: vi.fn(),
    onAuthChanged: vi.fn(() => () => undefined),
    // A rota inicial virou `voz` (SPEC-Voz-01): entrar no shell consulta a prontidão.
    prontidaoDaVoz: vi.fn(async () => ({ pronta: false, faltando: [], compute: 'cpu-int8' })),
    transcreverAudio: vi.fn(async () => ({ estado: 'sem-audio' })),
    baixarArtefatoDeVoz: vi.fn(async () => ({ estado: 'ok' })),
    // A tela do microfone assina o canal da hotkey ao montar; sem isto o efeito estoura antes
    // de o teste chegar ao que ele mede.
    onVozHotkey: vi.fn(() => () => undefined),
    listProjects: vi.fn(async () => []),
    listPermittedDirectories: vi.fn(async () => []),
    // O Terminal é um dos itens visíveis, e o critério 2 abre **todos** eles: sem estes, o
    // efeito da tela estoura antes de o teste chegar ao que mede.
    listAllowedCommands: vi.fn(async () => []),
    runCommand: vi.fn(),
    listCommandHistory: vi.fn(async () => [])
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Um item **do menu**, não qualquer texto da tela.
 *
 * O rodapé e o título da seção repetem o nome da rota ativa, então `getByText` casaria três
 * vezes. O item é um `button`: mirar no papel prova que é o controle clicável da sidebar.
 */
function itemDoMenu(rotulo: string): HTMLElement {
  return screen.getByRole('button', { name: rotulo })
}

function temItemDeMenu(rotulo: string): boolean {
  return screen.queryAllByRole('button', { name: rotulo }).length > 0
}

/** Os nomes acessíveis dos itens de navegação que a sidebar mostra agora. */
function itensDoMenu(): readonly string[] {
  return screen
    .getAllByRole('button')
    .map((b) => b.textContent?.trim() ?? '')
    .filter((t) => t !== '')
}

describe('sidebar projetada do registro (critério 3)', () => {
  it('mostra Projects Hub, Terminal e Settings no Professional Ops', async () => {
    await entrarPelaChoice('jarvis')

    await waitFor(() => expect(itemDoMenu('Projects Hub')).toBeInTheDocument())
    expect(itemDoMenu('Terminal')).toBeInTheDocument()
    expect(itemDoMenu('Settings')).toBeInTheDocument()
  })

  it('mostra os cabeçalhos dos grupos que têm item, e só eles', async () => {
    await entrarPelaChoice('jarvis')

    // O cabeçalho é estilizado em uppercase pelo CSS; o texto no DOM é o do i18n.
    await waitFor(() => expect(screen.getByText('Negócios')).toBeInTheDocument())
    expect(screen.getByText('Sistema')).toBeInTheDocument()
    // COMANDO acendeu na SPEC-Voz-01: o microfone é o primeiro item que ele ganhou. É a
    // projeção funcionando — a fatia registrou o módulo e o grupo apareceu sozinho.
    expect(screen.getByText('Comando')).toBeInTheDocument()
    // Grupo sem item visível não é renderizado — um cabeçalho sozinho prometeria uma seção
    // que não leva a lugar nenhum.
    expect(screen.queryByText('Intel')).not.toBeInTheDocument()
    expect(screen.queryByText('Operações')).not.toBeInTheDocument()
  })

  it('não mostra item de módulo que ainda não existe (regra 2)', async () => {
    await entrarPelaChoice('jarvis')

    await waitFor(() => expect(itemDoMenu('Projects Hub')).toBeInTheDocument())
    // `Command Center` fica de fora desta lista de propósito: ele **existe** na tela, mas como
    // botão do **rail** (o par Professional Ops ⇄ Agents OS do protótipo), não como item de
    // menu. Afirmar a ausência dele aqui reprovaria por um acerto.
    for (const oculto of ['Kanban', 'Analytics', 'Metas', 'Studio', 'HUD', 'Insights']) {
      expect(temItemDeMenu(oculto), `${oculto} não tem módulo`).toBe(false)
    }
  })

  it('a rota `inicio` sumiu do menu (regra 6)', async () => {
    await entrarPelaChoice('jarvis')

    await waitFor(() => expect(itemDoMenu('Projects Hub')).toBeInTheDocument())
    expect(temItemDeMenu('Início')).toBe(false)
  })
})

describe('um caminho por tela (critério 5)', () => {
  it('Connectors e Providers não são itens do menu — são abas do Settings', async () => {
    await entrarPelaChoice('jarvis')

    await waitFor(() => expect(itemDoMenu('Settings')).toBeInTheDocument())
    expect(itensDoMenu()).not.toContain('Connectors')
    expect(itensDoMenu()).not.toContain('Providers')
  })

  it('o Settings é alcançável em um clique', async () => {
    await entrarPelaChoice('jarvis')

    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))

    // O Settings monta em abas (FIX #172); a tablist é a prova de que chegou nele.
    await waitFor(() => expect(screen.getByRole('tablist')).toBeInTheDocument())
  })
})

describe('nenhuma rota visível cai no placeholder (critério 2)', () => {
  it('cada item do menu abre módulo, não o cabeçalho de placeholder', async () => {
    await entrarPelaChoice('jarvis')
    await waitFor(() => expect(itemDoMenu('Projects Hub')).toBeInTheDocument())

    for (const item of ['Voz', 'Projects Hub', 'Terminal', 'Settings']) {
      await userEvent.click(itemDoMenu(item))
      // O texto do placeholder é o que a fatia promete nunca mais aparecer.
      expect(screen.queryByText(/conteúdo placeholder/i), `${item} caiu no placeholder`).toBeNull()
    }
  })
})

describe('rodapé sem pill inventado (critério 7)', () => {
  it('não mostra "MODO AUTÔNOMO" — não há estado real que o alimente', async () => {
    await entrarPelaChoice('jarvis')

    await waitFor(() => expect(itemDoMenu('Projects Hub')).toBeInTheDocument())
    expect(screen.queryByText(/modo aut[oô]nomo/i)).not.toBeInTheDocument()
  })
})
