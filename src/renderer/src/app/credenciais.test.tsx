import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CredentialStatusView } from '@shared/domain/credentials'
import { CredenciaisDoWorkspace } from './CredenciaisDoWorkspace'

/**
 * A seção de credenciais do Settings (SPEC-Providers-01, critérios 4 e 8), categoria Tela.
 *
 * O que estes testes provam é o que jsdom **consegue** provar: papéis, texto e o caminho que a
 * chave percorre. O que eles deliberadamente não afirmam é aparência — a lição de método do
 * MVP-003 (a suíte verde do login) vale aqui: jsdom não aplica folha de estilo, e uma asserção
 * de cor mediria a string que o próprio componente escreveu.
 *
 * O teste central é o do critério 2 **visto do renderer**: a chave digitada sai por
 * `setCredential` e não volta para lugar nenhum — nem para o DOM, nem para o estado do
 * componente.
 */

const listCredentials = vi.fn()
const setCredential = vi.fn()
const removeCredential = vi.fn()
const sendLog = vi.fn()

const CHAVE_DIGITADA = 'sk-ant-api03-chave-que-o-usuario-colou'

function statusDe(
  parcial: Partial<CredentialStatusView> & Pick<CredentialStatusView, 'key'>
): CredentialStatusView {
  return {
    provider: parcial.key,
    workspace: 'jarvis',
    status: 'missing',
    envDisponivel: false,
    ...parcial
  }
}

const TODAS_AUSENTES: readonly CredentialStatusView[] = [
  statusDe({ key: 'anthropic', provider: 'Anthropic (Claude)' }),
  statusDe({ key: 'openai', provider: 'OpenAI' }),
  statusDe({ key: 'gemini', provider: 'Google Gemini' })
]

beforeEach(() => {
  vi.clearAllMocks()
  listCredentials.mockResolvedValue(TODAS_AUSENTES)
  setCredential.mockResolvedValue(TODAS_AUSENTES)
  removeCredential.mockResolvedValue(TODAS_AUSENTES)

  Object.defineProperty(window, 'jarvis', {
    // `sendLog` entra porque o caminho de erro loga (ADR-005: o renderer captura, o main
    // grava). Sem ele, o `catch` do componente estoura ao tentar registrar a falha — e o
    // teste do erro passaria com uma rejeição não tratada em segundo plano.
    value: { listCredentials, setCredential, removeCredential, sendLog },
    configurable: true,
    writable: true
  })
})

async function montar(workspace: 'noa' | 'jarvis' = 'jarvis'): Promise<void> {
  render(
    <CredenciaisDoWorkspace
      workspace={workspace}
      nomeDoEspaco={workspace === 'jarvis' ? 'JARVIS OS' : 'NOA'}
    />
  )
  await waitFor(() => expect(listCredentials).toHaveBeenCalled())
}

describe('missing sem revelar valor (critério 4)', () => {
  it('lista os providers conhecidos e diz quais faltam, por nome', async () => {
    await montar()

    // Por nome do provider, e não pela chave técnica: o usuário reconhece "OpenAI", não
    // `openai`. RF-010 pede que a UI informe **quais** variáveis faltam.
    expect(await screen.findByText('Anthropic (Claude)')).toBeInTheDocument()
    expect(screen.getByText('OpenAI')).toBeInTheDocument()
    expect(screen.getByText('Google Gemini')).toBeInTheDocument()

    expect(screen.getAllByText(/não configurada/i)).toHaveLength(3)
  })

  it('credencial vinda do .env aparece como somente leitura, sem botão de remover', async () => {
    listCredentials.mockResolvedValue([
      statusDe({
        key: 'openai',
        provider: 'OpenAI',
        status: 'present',
        source: 'env',
        envDisponivel: true
      })
    ])

    await montar()

    expect(await screen.findByText(/somente leitura/i)).toBeInTheDocument()
    // Sem botão de remover: o env é read-only, e um botão ali prometeria uma ação que o app
    // não faz — apagar linha do arquivo de configuração do usuário.
    expect(screen.queryByRole('button', { name: /remover/i })).not.toBeInTheDocument()
  })

  it('credencial no vault mostra o estado e oferece remoção', async () => {
    listCredentials.mockResolvedValue([
      statusDe({ key: 'openai', provider: 'OpenAI', status: 'present', source: 'vault' })
    ])

    await montar()

    expect(await screen.findByText(/guardada cifrada neste dispositivo/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /remover/i })).toBeInTheDocument()
  })
})

describe('a chave entra e não volta (critério 2, visto do renderer)', () => {
  it('o valor digitado é enviado ao main e desaparece da tela', async () => {
    await montar()

    await userEvent.click(screen.getAllByRole('button', { name: /configurar/i })[0]!)
    await userEvent.type(await screen.findByLabelText(/chave de api/i), CHAVE_DIGITADA)
    await userEvent.click(screen.getByRole('button', { name: /salvar chave/i }))

    await waitFor(() =>
      expect(setCredential).toHaveBeenCalledWith('anthropic', CHAVE_DIGITADA, 'jarvis')
    )

    // A prova é sobre o DOM inteiro, não sobre o campo: depois do submit, a chave não está
    // em lugar nenhum da página — nem como valor de input, nem como texto, nem como atributo.
    await waitFor(() => expect(document.body.innerHTML).not.toContain(CHAVE_DIGITADA))
  })

  it('nada do que o main devolve carrega a chave — a view não tem campo para ela', async () => {
    setCredential.mockResolvedValue([
      statusDe({
        key: 'anthropic',
        provider: 'Anthropic (Claude)',
        status: 'present',
        source: 'vault'
      })
    ])

    await montar()

    await userEvent.click(screen.getAllByRole('button', { name: /configurar/i })[0]!)
    await userEvent.type(await screen.findByLabelText(/chave de api/i), CHAVE_DIGITADA)
    await userEvent.click(screen.getByRole('button', { name: /salvar chave/i }))

    // O status mudou (o retorno do main foi aplicado) e a chave não reapareceu.
    expect(await screen.findByText(/guardada cifrada neste dispositivo/i)).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain(CHAVE_DIGITADA)
  })

  it('a mensagem obrigatória do BYOK aparece antes do campo', async () => {
    await montar()
    await userEvent.click(screen.getAllByRole('button', { name: /configurar/i })[0]!)

    // Texto literal do PRD §12.5, herdado do `ProviderSetup` do DS: informa que a chave fica
    // no dispositivo, que agentes só rodam com a Plataforma aberta e que trocar de computador
    // exige reconfigurar. Parafraseá-la apagaria a segunda ou a terceira informação.
    expect(await screen.findByText(/não são armazenadas na nuvem/i)).toBeInTheDocument()
    expect(screen.getByText(/somente enquanto a Plataforma estiver aberta/i)).toBeInTheDocument()
  })
})

describe('escopo por espaço (critério 1, visto do renderer)', () => {
  it('consulta a ponte com o espaço ativo e o diz na tela', async () => {
    await montar('noa')

    expect(listCredentials).toHaveBeenCalledWith('noa')
    // Sem dizer de qual espaço a lista é, o usuário configuraria a chave num espaço achando
    // que configurou nos dois — que é exatamente o isolamento que o critério 1 garante.
    expect(screen.getByText(/chaves de NOA/i)).toBeInTheDocument()
  })

  it('remover pede confirmação e informa o impacto antes de chamar o main', async () => {
    listCredentials.mockResolvedValue([
      statusDe({ key: 'openai', provider: 'OpenAI', status: 'present', source: 'vault' })
    ])

    await montar()
    await userEvent.click(await screen.findByRole('button', { name: /^remover$/i }))

    // O diálogo do DS exige o número de execuções afetadas mesmo quando é zero: "nenhuma
    // execução será afetada" é informação, e omiti-la deixaria o usuário supondo.
    expect(
      await screen.findByText(/nenhuma execução em andamento será afetada/i)
    ).toBeInTheDocument()
    expect(removeCredential).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /remover chave de OpenAI/i }))
    await waitFor(() => expect(removeCredential).toHaveBeenCalledWith('openai', 'jarvis'))
  })
})

describe('falha do IPC vira mensagem de produto', () => {
  it('erro ao listar mostra alerta sem texto técnico', async () => {
    listCredentials.mockRejectedValue(new Error('EPIPE: broken pipe'))

    await montar()

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/não foi possível ler as credenciais/i)
    // `error.message` cru na tela é o que a CONVENTION proíbe: o que quebrou é o IPC, e o
    // texto técnico não ajuda quem está tentando colar uma chave.
    expect(alerta).not.toHaveTextContent(/EPIPE/)
  })
})
