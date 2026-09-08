import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiProvider } from '@shared/domain/ai'
import { ROTEAMENTO_PADRAO, type ProviderStatus, type RoutingPolicy } from '@shared/domain/routing'
import type { PhaseModelPolicy } from '@shared/domain/modelo-da-fase'
import { POLITICA_DE_MODELO_PADRAO } from '@shared/domain/modelo-da-fase'
import { ProvidersDoWorkspace } from './ProvidersDoWorkspace'

/**
 * A tela de providers do Settings (SPEC-Providers-04, critérios 5 e 8), categoria Tela.
 *
 * O que estes testes afirmam: papéis, texto, a operação por teclado e o caminho que cada edição
 * percorre até a ponte. O que eles **não** afirmam é aparência — jsdom não aplica folha de
 * estilo, e a cor do indicador de estado é prova de navegador.
 *
 * O teste central do critério 8 é que a tela **não decide nem mede**: o estado exibido é o que
 * veio do main, e reordenar uma rota manda a lista nova pela ponte em vez de guardá-la só
 * localmente.
 */

const getProviderStatus = vi.fn()
const getProviderModels = vi.fn()
const setProviderModel = vi.fn()
const getRouting = vi.fn()
const setRoute = vi.fn()
const getPhaseModels = vi.fn()
const estadoDoCodex = vi.fn()
const entrarNoCodex = vi.fn()
const sairDoCodex = vi.fn()
const setModoDoCodex = vi.fn()
const setPhaseModel = vi.fn()
const sendLog = vi.fn()

function statusDe(provider: AiProvider, parcial: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    provider,
    estado: 'online',
    modelo: 'claude-opus-5',
    origem: 'cloud',
    latenciaMs: 12,
    unmetered: false,
    ...parcial
  }
}

const STATUS_PADRAO: readonly ProviderStatus[] = [
  statusDe('anthropic'),
  statusDe('gemini', { modelo: 'gemini-2.5-pro' }),
  statusDe('ollama', { estado: 'offline', modelo: 'llama3.1', origem: 'local', unmetered: true }),
  statusDe('claude-code', { origem: 'local', unmetered: true })
]

const ROTAS_PADRAO: RoutingPolicy = {
  user_id: 'user-1',
  workspace_id: 'jarvis',
  rotas: ROTEAMENTO_PADRAO
}

const POLITICA_PADRAO: PhaseModelPolicy = {
  user_id: 'user-1',
  workspace_id: 'jarvis',
  fases: POLITICA_DE_MODELO_PADRAO
}

beforeEach(() => {
  vi.clearAllMocks()
  getProviderStatus.mockResolvedValue(STATUS_PADRAO)
  getRouting.mockResolvedValue(ROTAS_PADRAO)
  setRoute.mockResolvedValue(ROTAS_PADRAO)
  getPhaseModels.mockResolvedValue(POLITICA_PADRAO)
  estadoDoCodex.mockResolvedValue({
    saude: 'auth_required',
    codexHome: 'C:/userData/codex-pipeline',
    modo: 'subscription_limited'
  })
  setPhaseModel.mockResolvedValue(POLITICA_PADRAO)
  setProviderModel.mockResolvedValue(true)
  getProviderModels.mockImplementation(async (p: AiProvider) =>
    p === 'anthropic' ? ['claude-opus-5', 'claude-haiku-4-5'] : ['gemini-2.5-pro', 'llama3.1']
  )

  Object.defineProperty(window, 'jarvis', {
    value: {
      getProviderStatus,
      getProviderModels,
      setProviderModel,
      getRouting,
      setRoute,
      getPhaseModels,
      setPhaseModel,
      // O perfil do Codex (SPEC-Multi-Executor-02) é montado dentro desta tela e consulta o
      // estado ao montar. Sem o dublê, o `.then` do contêiner estoura em toda asserção daqui.
      estadoDoCodex,
      entrarNoCodex,
      sairDoCodex,
      setModoDoCodex,
      sendLog
    },
    configurable: true,
    writable: true
  })
})

/**
 * A seção de uma rota, pelo título.
 *
 * As cinco rotas repetem os mesmos nomes de provider, então quase toda asserção sobre ordem
 * precisa de escopo — sem ele, "2. Google Gemini" acha cinco elementos e o teste não afirma
 * nada sobre a rota que interessa.
 */
function secaoDaRota(titulo: string): HTMLElement {
  const cabecalho = screen
    .getAllByRole('heading', { level: 4 })
    .find((h) => h.textContent === titulo)

  if (cabecalho?.parentElement == null) throw new Error(`rota não encontrada: ${titulo}`)
  return cabecalho.parentElement
}

async function montar(workspace: 'noa' | 'jarvis' = 'jarvis'): Promise<void> {
  render(
    <ProvidersDoWorkspace
      workspace={workspace}
      nomeDoEspaco={workspace === 'jarvis' ? 'JARVIS OS' : 'NOA'}
    />
  )
  await waitFor(() => expect(getProviderStatus).toHaveBeenCalled())
  await screen.findByText(/Roteamento por tipo de tarefa/i)
}

describe('status por provider (critérios 5 e 6)', () => {
  it('lista os quatro providers pelo nome legível, não pelo identificador', async () => {
    await montar()

    // Pelo `role="status"`, que é a linha de cada provider: o nome também aparece nos
    // rótulos do editor de rotas, e uma busca solta acharia as duas ocorrências.
    const nomes = screen.getAllByRole('status').map((s) => s.textContent)

    expect(nomes.some((n) => n?.includes('Anthropic (Claude API)'))).toBe(true)
    expect(nomes.some((n) => n?.includes('Google Gemini'))).toBe(true)
    expect(nomes.some((n) => n?.includes('Ollama (local)'))).toBe(true)
    expect(nomes.some((n) => n?.includes('Claude Code CLI'))).toBe(true)
  })

  it('distingue online de offline por papel de status, não só por cor', async () => {
    await montar()

    const status = screen.getAllByRole('status')
    const ollama = status.find((s) => s.textContent?.includes('Ollama'))
    const anthropic = status.find((s) => s.textContent?.includes('Anthropic'))

    // O `data-jos-status` é o que o DS pinta — e o que jsdom consegue afirmar. A cor em si é
    // prova de navegador.
    expect(ollama).toHaveAttribute('data-jos-status', 'inativo')
    expect(anthropic).toHaveAttribute('data-jos-status', 'ativo')
  })

  it('mostra origem e ausência de custo como texto legível', async () => {
    // "Roda na minha máquina" e "não cobra por chamada" são fatos que o usuário precisa ler.
    await montar()

    // Escopado a lista de providers: desde a SPEC-Fases-02 as combos de modelo por fase mostram
    // as mesmas Tags, e uma contagem sobre a aba inteira mediria as duas superficies juntas.
    const lista = within(screen.getByRole('group', { name: /providers deste espaço/i }))

    expect(lista.getAllByText('Local').length).toBeGreaterThan(0)
    expect(lista.getAllByText('Nuvem').length).toBeGreaterThan(0)
    expect(lista.getAllByText(/sem custo por chamada/i).length).toBe(2)
  })

  it('mostra a latência medida pelo main', async () => {
    await montar()
    expect(screen.getAllByText('12 ms').length).toBe(4)
  })

  it('nomeia o espaço: os providers do JARVIS não são os do NOA', async () => {
    await montar('noa')
    expect(screen.getByText(/Providers de IA · NOA/)).toBeInTheDocument()
  })

  it('explica o fallback — o usuário precisa saber que a chamada cai para o próximo', async () => {
    await montar()
    expect(screen.getByText(/cai para o próximo da lista/i)).toBeInTheDocument()
  })
})

describe('troca de modelo (critério 5)', () => {
  it('manda a troca pela ponte e recarrega o estado do main', async () => {
    const usuario = userEvent.setup()
    await montar()

    // O `Select` do DS é Radix (botão + listbox), não `<select>` nativo: abrir e clicar na
    // opção é o caminho que o usuário percorre, e o único que `userEvent` alcança aqui.
    await usuario.click(screen.getByLabelText(/Modelo do Anthropic/i))
    await usuario.click(await screen.findByRole('option', { name: 'claude-haiku-4-5' }))

    await waitFor(() =>
      expect(setProviderModel).toHaveBeenCalledWith('anthropic', 'claude-haiku-4-5', 'jarvis')
    )
    // Recarrega em vez de aplicar localmente: o estado exibido é o que o **main** confirma.
    await waitFor(() => expect(getProviderStatus).toHaveBeenCalledTimes(2))
  })

  it('modelo recusado pelo main vira mensagem, não mudança silenciosa', async () => {
    const usuario = userEvent.setup()
    setProviderModel.mockResolvedValue(false)
    await montar()

    await usuario.click(screen.getByLabelText(/Modelo do Anthropic/i))
    await usuario.click(await screen.findByRole('option', { name: 'claude-haiku-4-5' }))

    expect(await screen.findByText(/não está disponível para este provider/i)).toBeInTheDocument()
  })
})

describe('editor de rotas (critérios 3 e 8)', () => {
  it('mostra a ordem de preferência numerada por tipo de tarefa', async () => {
    await montar()

    // A ordem **é** o dado: sem a numeração, duas listas com os mesmos providers pareceriam
    // iguais na tela e roteariam diferente. Escopado na rota de Conversa porque cinco rotas
    // repetem os mesmos nomes — a numeração só significa algo dentro de uma delas.
    const conversa = secaoDaRota('Conversa')

    expect(within(conversa).getByText(/1\. Anthropic/)).toBeInTheDocument()
    expect(within(conversa).getByText(/2\. Google Gemini/)).toBeInTheDocument()
  })

  it('subir um provider manda a lista reordenada pela ponte', async () => {
    const usuario = userEvent.setup()
    await montar()

    /*
     * O `$` no fim é load-bearing: a M17-F03 acrescentou a rota **Conversa por voz**, cujo
     * rótulo contém "Conversa". Sem a âncora, `/em Conversa/i` casa as duas linhas e o
     * `getByRole` estoura com "found multiple elements" — foi assim que dois testes deste
     * arquivo reprovaram quando o tipo de tarefa novo entrou.
     */
    // `chat` padrão: anthropic, gemini, ollama. Subir o gemini o põe em primeiro.
    await usuario.click(screen.getByRole('button', { name: /Subir Google Gemini em Conversa$/i }))

    await waitFor(() =>
      expect(setRoute).toHaveBeenCalledWith(
        expect.objectContaining({
          taskType: 'chat',
          preferencia: ['gemini', 'anthropic', 'ollama']
        }),
        'jarvis'
      )
    )
  })

  it('descer um provider manda a lista reordenada', async () => {
    const usuario = userEvent.setup()
    await montar()

    await usuario.click(
      screen.getByRole('button', { name: /Descer Anthropic \(Claude API\) em Conversa$/i })
    )

    await waitFor(() =>
      expect(setRoute).toHaveBeenCalledWith(
        expect.objectContaining({ preferencia: ['gemini', 'anthropic', 'ollama'] }),
        'jarvis'
      )
    )
  })

  it('o primeiro da lista não pode subir, nem o último descer', async () => {
    await montar()

    expect(
      screen.getByRole('button', { name: /Subir Anthropic \(Claude API\) em Conversa$/i })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /Descer Ollama \(local\) em Conversa$/i })
    ).toBeDisabled()
  })

  it('incluir um provider ausente o acrescenta ao fim da preferência', async () => {
    const usuario = userEvent.setup()
    await montar()

    // `chat` padrão não lista o claude-code.
    await usuario.click(
      screen.getByRole('button', { name: /Incluir Claude Code CLI em Conversa$/i })
    )

    await waitFor(() =>
      expect(setRoute).toHaveBeenCalledWith(
        expect.objectContaining({
          taskType: 'chat',
          preferencia: ['anthropic', 'gemini', 'ollama', 'claude-code']
        }),
        'jarvis'
      )
    )
  })

  it('o toggle de preferência local manda a rota com o novo valor', async () => {
    const usuario = userEvent.setup()
    await montar()

    await usuario.click(
      screen.getByRole('checkbox', { name: /Preferir provider local em Código/i })
    )

    await waitFor(() =>
      expect(setRoute).toHaveBeenCalledWith(
        expect.objectContaining({ taskType: 'code', preferirLocal: true }),
        'jarvis'
      )
    )
  })

  it('cobre os cinco tipos de tarefa, pelo rótulo em pt-BR', async () => {
    await montar()

    for (const rotulo of ['Conversa', 'Código', 'Embedding', 'Resumo', 'Visão']) {
      expect(screen.getByRole('heading', { name: rotulo, level: 4 })).toBeInTheDocument()
    }
  })

  it('rota vazia diz que ninguém atende, em vez de mostrar lista em branco', async () => {
    getRouting.mockResolvedValue({
      ...ROTAS_PADRAO,
      rotas: {
        ...ROTEAMENTO_PADRAO,
        vision: { taskType: 'vision', preferencia: [], preferirLocal: false }
      }
    })
    await montar()

    expect(screen.getByText(/Nenhum provider atende este tipo de tarefa/i)).toBeInTheDocument()
  })

  it('falha ao salvar vira mensagem', async () => {
    const usuario = userEvent.setup()
    setRoute.mockRejectedValue(new Error('ipc caiu'))
    await montar()

    await usuario.click(screen.getByRole('button', { name: /Subir Google Gemini em Conversa$/i }))

    expect(await screen.findByText(/não foi possível salvar a rota/i)).toBeInTheDocument()
  })
})

describe('verificar de novo (critério 6)', () => {
  it('recarrega status e rotas do main', async () => {
    const usuario = userEvent.setup()
    await montar()

    await usuario.click(screen.getByRole('button', { name: /verificar de novo/i }))

    await waitFor(() => expect(getProviderStatus).toHaveBeenCalledTimes(2))
    expect(getRouting).toHaveBeenCalledTimes(2)
  })
})

describe('falha ao carregar', () => {
  it('mostra o erro NO LUGAR do conteúdo, não ao lado dele', async () => {
    // A régua herdada da M4-F03: com a carga falhando, exibir o aviso junto de uma lista vazia
    // diria "você não tem providers" quando o certo é "não sabemos quais são".
    getProviderStatus.mockRejectedValue(new Error('main fora'))
    render(<ProvidersDoWorkspace workspace="jarvis" nomeDoEspaco="JARVIS OS" />)

    expect(await screen.findByText(/não foi possível carregar os providers/i)).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText(/Roteamento por tipo de tarefa/i)).not.toBeInTheDocument()
  })
})

describe('operável por teclado (critério 5)', () => {
  it('os controles de ordem são botões alcançáveis e acionáveis por teclado', async () => {
    const usuario = userEvent.setup()
    await montar()

    // Reordenar por **botão** e não por arrastar é o que torna a operação possível sem mouse:
    // arrastar exigiria um alvo grande e um gesto que o teclado não tem.
    const subir = screen.getByRole('button', { name: /Subir Google Gemini em Conversa$/i })
    subir.focus()
    expect(subir).toHaveFocus()

    await usuario.keyboard('{Enter}')
    await waitFor(() => expect(setRoute).toHaveBeenCalled())
  })

  it('cada botão de ordem diz qual provider e qual tarefa move', async () => {
    // "Subir" sozinho seria ambíguo com cinco rotas na tela — quem usa leitor de tela ouviria
    // vinte botões idênticos.
    await montar()

    const conversa = screen
      .getAllByRole('heading', { level: 4 })
      .find((h) => h.textContent === 'Conversa')?.parentElement

    expect(conversa).toBeDefined()
    expect(
      within(conversa as HTMLElement).getByRole('button', {
        name: /Subir Google Gemini em Conversa$/i
      })
    ).toBeInTheDocument()
  })
})

/**
 * A aba Modelos (SPEC-Fases-02, critérios 1, 6 e 7).
 *
 * O que estes testes protegem não é o layout: é a **promessa do catálogo**. Um combo que oferece
 * Fable na rota paga é uma tela mentindo, e o erro só apareceria quando alguém escolhesse — na
 * fronteira, longe daqui.
 */
describe('modelos por fase (SPEC-Fases-02)', () => {
  /**
   * A combo de uma fase numa rota.
   *
   * Por `data-jos-*` e não por rótulo: os rótulos das combos se repetem nas três fases, e um
   * `getByLabelText` acharia três elementos. O `Select` do DS é Radix (botão + listbox em
   * portal), então esta função devolve o **gatilho** — abrir e clicar na opção é o caminho que
   * o usuário percorre e o único que `userEvent` alcança.
   */
  function combo(fase: string, rota: string): HTMLElement {
    const alvo = document.querySelector(
      `[data-jos-fase="${fase}"][data-jos-rota="${rota}"]`
    ) as HTMLElement | null

    expect(alvo).not.toBeNull()
    return alvo as HTMLElement
  }

  /** As opções que uma combo oferece, com a listbox aberta. */
  async function opcoesDe(fase: string, rota: string): Promise<readonly string[]> {
    await userEvent.click(combo(fase, rota))
    const listbox = await screen.findByRole('listbox')
    return within(listbox)
      .getAllByRole('option')
      .map((o) => o.textContent ?? '')
  }

  it('lista as três fases com o rótulo em português', async () => {
    await montar()

    for (const rotulo of ['Planejamento', 'Especificação', 'Construção']) {
      expect(screen.getByRole('heading', { name: rotulo, level: 4 })).toBeInTheDocument()
    }
  })

  it('Fable aparece na rota de assinatura (critério 1)', async () => {
    await montar()

    // O rótulo ganhou o **provider** na SPEC-Fases-06: com Claude e Codex na mesma combo, o nome
    // do modelo sozinho não diz de quem ele é. A garantia que importa (rótulo + id juntos, para
    // casar com o ledger) segue afirmada.
    expect(await opcoesDe('planejamento', 'assinatura')).toContain(
      'Claude Code CLI · Fable 5.1 · claude-fable-5-1'
    )
  })

  it('Fable NÃO aparece na rota paga: o catálogo resolve, não o runtime (critério 1)', async () => {
    await montar()

    const opcoes = await opcoesDe('planejamento', 'paga')

    expect(opcoes.some((o) => o.includes('claude-fable-5-1'))).toBe(false)
    // A combo não fica vazia por causa da ausência: a rota paga tem catálogo próprio.
    expect(opcoes).toContain('Anthropic (Claude API) · Opus 5 · claude-opus-5')
  })

  it('a combo mostra rótulo e id juntos, para casar com o ledger', async () => {
    await montar()

    expect(await opcoesDe('construcao', 'assinatura')).toContain(
      'Claude Code CLI · Opus 5 · claude-opus-5'
    )
  })

  it('o padrão do PI aparece: Fable no Planejamento, Opus na Construção', async () => {
    await montar()

    expect(combo('planejamento', 'assinatura')).toHaveTextContent('Fable 5.1')
    expect(combo('construcao', 'assinatura')).toHaveTextContent('Opus 5')
  })

  it('trocar grava a fase, a rota e o provider daquela rota', async () => {
    const usuario = userEvent.setup()
    await montar()

    await usuario.click(combo('construcao', 'assinatura'))
    await usuario.click(await screen.findByRole('option', { name: /Sonnet 5/ }))

    await waitFor(() =>
      expect(setPhaseModel).toHaveBeenCalledWith(
        'construcao',
        'assinatura',
        'claude-code',
        'claude-sonnet-5',
        'jarvis'
      )
    )
  })

  it('recusa na fronteira vira aviso legível, e a política mostrada não muda', async () => {
    // `undefined` é o main dizendo que o par não existe no catálogo (critério 4). Aplicar a
    // escolha localmente aqui esconderia que ela não pegou.
    setPhaseModel.mockResolvedValueOnce(undefined)
    const usuario = userEvent.setup()
    await montar()

    await usuario.click(combo('construcao', 'assinatura'))
    await usuario.click(await screen.findByRole('option', { name: /Sonnet 5/ }))

    expect(await screen.findByText(/não está disponível nesta rota/i)).toBeInTheDocument()
    expect(combo('construcao', 'assinatura')).toHaveTextContent('Opus 5')
  })

  it('o roteamento por tarefa continua na aba, sob Avançado e recolhido (critério 7)', async () => {
    await montar()

    const avancado = screen.getByText(/Avançado · Roteamento por tipo de tarefa/i)
    expect(avancado.closest('details')).not.toHaveAttribute('open')

    // Recolhido, mas presente: a SPEC-Providers-04 continua valendo, e MVP-007/017/021 vão
    // consumir o `ProviderRoute`.
    expect(
      screen.getByRole('button', { name: /Subir Google Gemini em Conversa$/i })
    ).toBeInTheDocument()
  })

  it('diz que a jornada não passa pelo roteamento por tarefa', async () => {
    // Duas listas de modelo na mesma aba sem esta frase fariam o PI editar a errada.
    await montar()

    expect(screen.getByText(/A geração de brief, PRD, arquitetura/i)).toBeInTheDocument()
  })
})
