import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorCredentialStatusView } from '@shared/domain/connectors'
import { CredenciaisDeConector } from './CredenciaisDeConector'

/**
 * A seção de credenciais de conector do Settings (SPEC-Conectores-05, critério 7), categoria Tela.
 *
 * O que estes testes provam é o que jsdom **consegue** provar: papéis, texto e o caminho que a
 * chave percorre. O que eles deliberadamente não afirmam é aparência — jsdom não aplica folha de
 * estilo, e uma asserção de cor mediria a string que o próprio componente escreveu.
 *
 * O teste central é o mesmo da tela de IA, e pelo mesmo motivo: a chave digitada sai por
 * `setConnectorCredential` e não volta para lugar nenhum — nem para o DOM, nem para o estado do
 * componente. O que esta tela acrescenta é o conector que **não** tem campo de chave (o GitHub,
 * que vem do Device Flow), e a garantia de que ele ainda assim aparece com estado visível.
 */

const listConnectorCredentials = vi.fn()
const setConnectorCredential = vi.fn()
const removeConnectorCredential = vi.fn()
const sendLog = vi.fn()

const CHAVE_DIGITADA = 'tvly-chave-que-o-usuario-colou'

function statusDe(
  parcial: Partial<ConnectorCredentialStatusView> &
    Pick<ConnectorCredentialStatusView, 'key' | 'conector'>
): ConnectorCredentialStatusView {
  return {
    workspace: 'jarvis',
    status: 'missing',
    gerenciavel: parcial.key !== 'github',
    ...parcial
  }
}

const TODAS_AUSENTES: readonly ConnectorCredentialStatusView[] = [
  statusDe({ key: 'github', conector: 'GitHub' }),
  statusDe({ key: 'tavily', conector: 'Tavily' })
]

beforeEach(() => {
  vi.clearAllMocks()
  listConnectorCredentials.mockResolvedValue(TODAS_AUSENTES)
  setConnectorCredential.mockResolvedValue(TODAS_AUSENTES)
  removeConnectorCredential.mockResolvedValue(TODAS_AUSENTES)

  Object.defineProperty(window, 'jarvis', {
    // `sendLog` entra porque o caminho de erro loga (ADR-005: o renderer captura, o main
    // grava). Sem ele, o `catch` do componente estoura ao registrar a falha.
    value: { listConnectorCredentials, setConnectorCredential, removeConnectorCredential, sendLog },
    configurable: true,
    writable: true
  })
})

async function montar(workspace: 'noa' | 'jarvis' = 'jarvis'): Promise<void> {
  render(
    <CredenciaisDeConector
      workspace={workspace}
      nomeDoEspaco={workspace === 'jarvis' ? 'JARVIS OS' : 'NOA'}
    />
  )
  await waitFor(() => expect(listConnectorCredentials).toHaveBeenCalled())
}

describe('estado visível por conector, sem revelar valor (critério 7)', () => {
  it('lista os conectores conhecidos e diz quais faltam, pelo nome do serviço', async () => {
    await montar()

    // Pelo rótulo do conector, e não pela chave técnica: o usuário reconhece "Tavily", não
    // `tavily`.
    expect(await screen.findByText('Tavily')).toBeInTheDocument()
    expect(screen.getByText('GitHub')).toBeInTheDocument()
    expect(screen.getAllByText(/não configurada/i)).toHaveLength(2)
  })

  it('a chave no vault aparece como configurada e oferece remoção', async () => {
    listConnectorCredentials.mockResolvedValue([
      statusDe({ key: 'tavily', conector: 'Tavily', status: 'present' })
    ])

    await montar()

    expect(await screen.findByText(/guardada cifrada neste dispositivo/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /remover/i })).toBeInTheDocument()
  })

  it('a lista é do espaço ativo e o cabeçalho diz qual é', async () => {
    // Sem isso, o usuário configuraria a chave num espaço achando que configurou nos dois.
    await montar('noa')

    expect(screen.getByText(/NOA/)).toBeInTheDocument()
    expect(listConnectorCredentials).toHaveBeenCalledWith('noa')
  })
})

describe('o conector que vem do Device Flow aparece, mas sem campo de chave', () => {
  it('o GitHub não oferece Configurar — a credencial dele não é colada', async () => {
    // Aparecer importa: o critério pede estado **visível**, e omitir o conector faria a tela
    // mentir por ausência. O que ele não pode ter é um campo de texto que gravaria por cima do
    // par access/refresh e quebraria o refresh em silêncio.
    await montar()

    expect(screen.getByText('GitHub')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /configurar/i })).toHaveLength(1)
    expect(await screen.findByText(/conecte a conta pelo fluxo do conector/i)).toBeInTheDocument()
  })

  it('mesmo configurado, o GitHub não oferece remoção por esta tela', async () => {
    listConnectorCredentials.mockResolvedValue([
      statusDe({ key: 'github', conector: 'GitHub', status: 'present', gerenciavel: false })
    ])

    await montar()

    expect(screen.queryByRole('button', { name: /remover/i })).not.toBeInTheDocument()
  })
})

describe('a chave entra e não volta (visto do renderer)', () => {
  it('o valor digitado é enviado ao main e desaparece da tela', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: /configurar/i }))
    await userEvent.type(await screen.findByLabelText(/chave de api/i), CHAVE_DIGITADA)
    await userEvent.click(screen.getByRole('button', { name: /salvar chave/i }))

    await waitFor(() =>
      expect(setConnectorCredential).toHaveBeenCalledWith('tavily', CHAVE_DIGITADA, 'jarvis')
    )

    // A prova é sobre o DOM inteiro, não sobre o campo: depois do submit, a chave não está em
    // lugar nenhum da página — nem como valor de input, nem como texto, nem como atributo.
    await waitFor(() => expect(document.body.innerHTML).not.toContain(CHAVE_DIGITADA))
  })

  it('nada do que o main devolve carrega a chave — a view não tem campo para ela', async () => {
    setConnectorCredential.mockResolvedValue([
      statusDe({ key: 'tavily', conector: 'Tavily', status: 'present' })
    ])

    await montar()

    await userEvent.click(screen.getByRole('button', { name: /configurar/i }))
    await userEvent.type(await screen.findByLabelText(/chave de api/i), CHAVE_DIGITADA)
    await userEvent.click(screen.getByRole('button', { name: /salvar chave/i }))

    // `/guardada cifrada/` e não `/configurada/`: esta última casa também com "Não
    // configurada", e a asserção passaria sem a tela ter mudado de estado.
    await waitFor(() =>
      expect(screen.getByText(/guardada cifrada neste dispositivo/i)).toBeInTheDocument()
    )
    expect(document.body.innerHTML).not.toContain(CHAVE_DIGITADA)
  })

  it('a remoção passa pelo diálogo de confirmação antes de chamar o main', async () => {
    listConnectorCredentials.mockResolvedValue([
      statusDe({ key: 'tavily', conector: 'Tavily', status: 'present' })
    ])

    await montar()
    await userEvent.click(await screen.findByRole('button', { name: /^remover$/i }))

    // O clique abre o diálogo e **não** remove: remover credencial sem confirmação tiraria do
    // usuário a chance de perceber o que vai acontecer.
    expect(removeConnectorCredential).not.toHaveBeenCalled()

    await userEvent.click(screen.getAllByRole('button', { name: /remover/i }).at(-1) as HTMLElement)
    await waitFor(() => expect(removeConnectorCredential).toHaveBeenCalledWith('tavily', 'jarvis'))
  })
})

describe('falha de leitura vira aviso, não lista vazia silenciosa', () => {
  it('mostra o alerta quando a ponte recusa', async () => {
    // A lição da M4-F03: "você não tem nenhuma credencial" e "não sabemos quais são" são
    // afirmações diferentes, e mostrar a primeira quando vale a segunda é mentir por omissão.
    listConnectorCredentials.mockRejectedValue(new Error('ipc caiu'))

    render(<CredenciaisDeConector workspace="jarvis" nomeDoEspaco="JARVIS OS" />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível ler/i)
  })
})
