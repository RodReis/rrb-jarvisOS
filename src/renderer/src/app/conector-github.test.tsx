import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GithubAuthSnapshot } from '@shared/domain/github-auth'
import { ConectorGitHub } from './ConectorGitHub'

/**
 * O painel de conexão com o GitHub (SPEC-Conectores-03, critério 9), categoria Tela.
 *
 * O que estes testes provam é o que jsdom **consegue** provar: papéis, texto e o caminho que o
 * usuário percorre. Aparência não é afirmada aqui — jsdom não aplica folha de estilo, e uma
 * asserção de cor mediria a string que o próprio componente escreveu (a lição da suíte verde do
 * login, MVP-003).
 *
 * O teste central é o critério 2 **visto do renderer**: a superfície da ponte não tem método
 * que devolva token, e o painel não tem por onde recebê-lo. Aqui isso é verificado pelo que a
 * tela mostra — e pelo que o mock **não** oferece.
 */

const getGithubAuthStatus = vi.fn()
const startGithubAuth = vi.fn()
const awaitGithubAuth = vi.fn()
const cancelGithubAuth = vi.fn()
const logoutGithub = vi.fn()
const setGithubClientId = vi.fn()
const sendLog = vi.fn()

const AGORA = Date.parse('2026-08-29T12:00:00.000Z')

function snapshot(parcial: Partial<GithubAuthSnapshot> = {}): GithubAuthSnapshot {
  return { estado: 'missing', renovavel: false, clientIdConfigurado: true, ...parcial }
}

const FLUXO = {
  userCode: 'WDJB-MJHT',
  verificationUri: 'https://github.com/login/device',
  expiraEm: new Date(AGORA + 900_000).toISOString()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.setSystemTime(AGORA)

  getGithubAuthStatus.mockResolvedValue(snapshot())
  startGithubAuth.mockResolvedValue(FLUXO)
  awaitGithubAuth.mockResolvedValue(snapshot({ estado: 'present', renovavel: true }))
  cancelGithubAuth.mockResolvedValue(undefined)
  logoutGithub.mockResolvedValue(snapshot())
  setGithubClientId.mockResolvedValue(snapshot())

  Object.defineProperty(window, 'jarvis', {
    value: {
      getGithubAuthStatus,
      startGithubAuth,
      awaitGithubAuth,
      cancelGithubAuth,
      logoutGithub,
      setGithubClientId,
      // O caminho de erro loga (ADR-005). Sem isto, o `catch` estoura ao registrar a falha e o
      // teste do erro passaria com uma rejeição não tratada em segundo plano.
      sendLog
    },
    configurable: true,
    writable: true
  })
})

function montar(): void {
  render(<ConectorGitHub workspace="jarvis" nomeDoEspaco="JARVIS OS" />)
}

describe('estado do conector', () => {
  it('sem credencial, mostra não conectado e oferece conectar', async () => {
    montar()

    expect(await screen.findByText('Não conectado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /conectar ao github/i })).toBeInTheDocument()
    // Sem credencial não há o que desconectar: o botão prometeria uma ação sem efeito.
    expect(screen.queryByRole('button', { name: /desconectar/i })).not.toBeInTheDocument()
  })

  it('conectado mostra o estado e o caminho de desconectar', async () => {
    getGithubAuthStatus.mockResolvedValue(
      snapshot({
        estado: 'present',
        renovavel: true,
        expiraEm: new Date(AGORA + 3_600_000).toISOString()
      })
    )
    montar()

    expect(await screen.findByText('Conectado')).toBeInTheDocument()
    expect(screen.getByText(/renova sozinha/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /desconectar/i })).toBeInTheDocument()
  })

  it('expirado é distinto de não conectado — o usuário precisa saber que já conectou', async () => {
    getGithubAuthStatus.mockResolvedValue(snapshot({ estado: 'expirado', renovavel: false }))
    montar()

    expect(await screen.findByText('Sessão expirada')).toBeInTheDocument()
    expect(screen.getByText(/reconecte para continuar/i)).toBeInTheDocument()
  })

  it('sem client ID, explica o que falta e não oferece um botão que sempre falharia', async () => {
    getGithubAuthStatus.mockResolvedValue(snapshot({ clientIdConfigurado: false }))
    montar()

    expect(await screen.findByText(/falta o client id/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /conectar ao github/i })).toBeDisabled()
  })

  it('falha ao ler o estado mostra mensagem de produto, não erro técnico', async () => {
    getGithubAuthStatus.mockRejectedValue(new Error('EPIPE: ipc quebrou'))
    montar()

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/não foi possível ler o estado/i)
    expect(alerta).not.toHaveTextContent('EPIPE')
  })
})

describe('Device Flow', () => {
  it('mostra código, URL e prazo, e mantém o cancelar disponível durante a espera', async () => {
    // A espera nunca resolve: é o estado em que o usuário fica olhando o código.
    awaitGithubAuth.mockReturnValue(new Promise(() => {}))
    montar()

    await userEvent.click(await screen.findByRole('button', { name: /conectar ao github/i }))

    expect(await screen.findByText('WDJB-MJHT')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /github\.com\/login\/device/i })).toHaveAttribute(
      'href',
      FLUXO.verificationUri
    )
    // O prazo é número de minutos, não um ISO cru: quem lê precisa decidir se dá tempo.
    // Dois elementos têm `role="status"` — o badge de estado e o progresso do polling. O
    // progresso é o que anuncia a espera; procurar pelo texto é o que separa os dois.
    expect(screen.getByText(/aguardando a autorização/i)).toHaveTextContent(/mais 15 min/i)
    expect(screen.getByRole('button', { name: /cancelar/i })).toBeEnabled()
  })

  it('cancelar chama a ponte — a saída por vontade do usuário que o critério 3 exige', async () => {
    awaitGithubAuth.mockReturnValue(new Promise(() => {}))
    montar()

    await userEvent.click(await screen.findByRole('button', { name: /conectar ao github/i }))
    await userEvent.click(await screen.findByRole('button', { name: /cancelar/i }))

    expect(cancelGithubAuth).toHaveBeenCalledWith('jarvis')
  })

  it('autorizado, o painel volta ao estado conectado e o código some da tela', async () => {
    montar()

    await userEvent.click(await screen.findByRole('button', { name: /conectar ao github/i }))

    expect(await screen.findByText('Conectado')).toBeInTheDocument()
    // O código expira com o fluxo: deixá-lo na tela convidaria a digitar um código morto.
    expect(screen.queryByText('WDJB-MJHT')).not.toBeInTheDocument()
  })

  it('erro normalizado do main aparece como mensagem, e o fluxo fecha', async () => {
    awaitGithubAuth.mockResolvedValue({
      ok: false,
      code: 'credencial-ausente',
      mensagem: 'O código expirou antes de ser autorizado. Recomece a autenticação.',
      retryable: false,
      acao: 'reautenticar',
      provenance: { connector: 'github', operation: 'auth.device-flow', obtidoEm: '' }
    })
    montar()

    await userEvent.click(await screen.findByRole('button', { name: /conectar ao github/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/o código expirou/i)
    expect(screen.queryByText('WDJB-MJHT')).not.toBeInTheDocument()
  })

  it('recusa ao abrir o fluxo não deixa a tela em espera eterna', async () => {
    startGithubAuth.mockResolvedValue({
      ok: false,
      code: 'credencial-ausente',
      mensagem: 'Nenhum client ID de GitHub App configurado. Informe um em Configurações.',
      retryable: false,
      acao: 'reautenticar',
      provenance: { connector: 'github', operation: 'auth.device-flow', obtidoEm: '' }
    })
    montar()

    await userEvent.click(await screen.findByRole('button', { name: /conectar ao github/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/nenhum client id/i)
    expect(awaitGithubAuth).not.toHaveBeenCalled()
    // O botão volta a ficar disponível: a tela não fica presa num fluxo que nunca abriu.
    expect(screen.getByRole('button', { name: /conectar ao github/i })).toBeEnabled()
  })
})

describe('critério 2 — o token não tem por onde chegar aqui', () => {
  it('a ponte usada por este painel não expõe nenhum método que devolva token', () => {
    montar()

    const ponte = window.jarvis as unknown as Record<string, unknown>
    // Não é asserção de nome bonito: é a superfície inteira sendo conferida. Um
    // `getGithubToken` acrescentado à ponte quebraria isto antes de chegar à tela.
    for (const chave of Object.keys(ponte)) {
      expect(chave.toLowerCase()).not.toContain('token')
    }
  })

  it('nada do que a tela renderiza durante o fluxo contém device code', async () => {
    awaitGithubAuth.mockReturnValue(new Promise(() => {}))
    montar()

    await userEvent.click(await screen.findByRole('button', { name: /conectar ao github/i }))
    await screen.findByText('WDJB-MJHT')

    // O `startGithubAuth` devolve só a view; o device code nunca sai do main. Se um dia
    // vazasse para o contrato, ele apareceria no DOM e isto reprovaria.
    expect(document.body.textContent ?? '').not.toContain('device_code')
  })
})

describe('client ID override', () => {
  it('salva o override e limpa o campo', async () => {
    montar()
    await screen.findByText('Não conectado')

    const campo = screen.getByRole('textbox', { name: /client id/i })
    await userEvent.type(campo, 'Iv1.abc123')
    await userEvent.click(screen.getByRole('button', { name: /^salvar$/i }))

    await waitFor(() => expect(setGithubClientId).toHaveBeenCalledWith('Iv1.abc123', 'jarvis'))
    expect(campo).toHaveValue('')
  })

  it('o campo é opcional e diz como voltar ao padrão', async () => {
    montar()
    expect(await screen.findByText(/deixe em branco para voltar ao padrão/i)).toBeInTheDocument()
  })
})

describe('escopo', () => {
  it('lê o estado do espaço ativo', async () => {
    render(<ConectorGitHub workspace="noa" nomeDoEspaco="NOA" />)

    await waitFor(() => expect(getGithubAuthStatus).toHaveBeenCalledWith('noa'))
    // No NOA a credencial aparece ausente, sem erro nem bloqueio (spec § decisões cravadas).
    expect(await screen.findByText('Não conectado')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
