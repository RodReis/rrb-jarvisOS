import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PrdDoProjeto } from './PrdDoProjeto'

/**
 * O gate do PRD, do Landscape e da Convention (SPEC-Jornada-03, categoria Tela).
 *
 * A tela é testada **isolada**, e a ponte é mockada: o renderer não decide nada — rota,
 * validação, pesquisa e corte são do main, e um mock que decidisse aqui provaria a política do
 * teste, não a do produto.
 *
 * O que estes testes protegem:
 *  - **Critério 3:** o termo é proposto e **editável**, e a pesquisa não roda ao abrir.
 *  - **Critério 4:** o bloqueio do Landscape aparece com a retomada e **não** trava o aceite.
 *  - **Critério 6:** contradição aparece com a recomendação e desabilita o aceite.
 *  - **§ Gate:** os propostos são visíveis por documento, não descobertos lendo tudo.
 *  - **Princípio 2:** a origem é dita em texto, não pintada.
 */

const proporTermoDePesquisa = vi.fn()
const gerarPrd = vi.fn()
const carregarPrd = vi.fn()
const cortarPropostoDoPrd = vi.fn()
const aplicarEventoDaJornada = vi.fn()

function afirmacao(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a-1',
    documento: 'PRD',
    secao: 'Escopo',
    texto: 'O produto organiza leituras por projeto.',
    origem: 'brief',
    referencia: 'b-1',
    ...over
  }
}

function prd(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'r-1',
    user_id: 'u-1',
    workspace_id: 'jarvis',
    projectId: 'p-1',
    briefHash: 'hb',
    afirmacoes: [afirmacao()],
    contradicoes: [],
    hash: 'h',
    commitHash: null,
    contextPackId: 'pack-1',
    created_at: '2026-09-03T10:00:00.000Z',
    ...over
  }
}

function montar(): void {
  render(
    <PrdDoProjeto workspace="jarvis" projectId="p-1" nomeDoProjeto="Leituras" onAceito={vi.fn()} />
  )
}

beforeEach(() => {
  proporTermoDePesquisa.mockReset().mockResolvedValue('ferramentas de leitura')
  gerarPrd.mockReset().mockResolvedValue({ resultado: 'gerado', mensagem: 'ok' })
  carregarPrd.mockReset().mockResolvedValue(null)
  cortarPropostoDoPrd.mockReset().mockResolvedValue(null)
  aplicarEventoDaJornada.mockReset().mockResolvedValue({ resultado: 'avancou' })

  Object.defineProperty(window, 'jarvis', {
    value: {
      proporTermoDePesquisa,
      gerarPrd,
      carregarPrd,
      cortarPropostoDoPrd,
      aplicarEventoDaJornada,
      sendLog: vi.fn()
    },
    configurable: true,
    writable: true
  })
})

describe('termo de pesquisa (critério 3)', () => {
  it('a IA propõe o termo ao abrir, e ele chega editável no campo', async () => {
    montar()

    expect(await screen.findByRole('textbox')).toHaveValue('ferramentas de leitura')
  })

  it('propor o termo não gera nada: a pesquisa espera a confirmação', async () => {
    montar()

    await screen.findByRole('textbox')
    expect(gerarPrd).not.toHaveBeenCalled()
  })

  it('o termo editado é o que vai para a geração, não o proposto', async () => {
    const user = userEvent.setup()
    montar()

    const campo = await screen.findByRole('textbox')
    await user.clear(campo)
    await user.type(campo, 'leitores offline')
    await user.click(screen.getByRole('button', { name: /gerar/i }))

    await waitFor(() => {
      expect(gerarPrd).toHaveBeenCalledWith('p-1', 'leitores offline', 'jarvis')
    })
  })

  it('campo vazio diz a consequência em vez de desabilitar o botão em silêncio', async () => {
    proporTermoDePesquisa.mockResolvedValue(null)
    montar()

    expect(await screen.findByText(/Landscape sai pendente/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /gerar/i })).toBeEnabled()
  })

  it('falha ao propor não impede o PI de escrever o dele', async () => {
    proporTermoDePesquisa.mockRejectedValue(new Error('sem rota'))
    montar()

    expect(await screen.findByRole('textbox')).toHaveValue('')
  })
})

describe('documentos e origem', () => {
  it('mostra os três documentos como um só gate', async () => {
    carregarPrd.mockResolvedValue(prd())
    montar()

    expect(await screen.findByRole('heading', { name: 'PRD' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Landscape' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Convention' })).toBeInTheDocument()
  })

  it('a origem é dita em texto — legível sem depender de cor', async () => {
    carregarPrd.mockResolvedValue(prd())
    montar()

    // Duas ocorrências: a linha do documento e nada mais — `findAll` porque a mesma origem
    // pode repetir, e o que se prova aqui é que ela é **texto**, não uma classe de cor.
    expect((await screen.findAllByText(/do brief aceito/i)).length).toBeGreaterThan(0)
  })

  it('a afirmação de evidência mostra a URL que a sustenta', async () => {
    carregarPrd.mockResolvedValue(
      prd({
        afirmacoes: [
          afirmacao({
            id: 'l-1',
            documento: 'LANDSCAPE',
            secao: 'Alternativas',
            texto: 'A ferramenta cobra por assento.',
            origem: 'evidencia',
            referencia: undefined,
            fontes: ['https://exemplo.dev/a']
          })
        ]
      })
    )
    montar()

    expect(await screen.findByText('https://exemplo.dev/a')).toBeInTheDocument()
  })

  it('só proposto oferece corte: o que veio do brief não tem botão', async () => {
    carregarPrd.mockResolvedValue(
      prd({
        afirmacoes: [
          afirmacao(),
          afirmacao({ id: 'p-1', texto: 'Inferido.', origem: 'proposto', referencia: undefined })
        ]
      })
    )
    montar()

    await screen.findAllByText('Inferido.')

    // Duas ocorrências do mesmo proposto (lista de propostos + corpo do documento), e nenhuma
    // para a afirmação ancorada no brief.
    expect(screen.getAllByRole('button', { name: /Cortar a afirmação: Inferido/i })).toHaveLength(2)
    expect(
      screen.queryByRole('button', { name: /Cortar a afirmação: O produto organiza/i })
    ).toBeNull()
  })

  it('os propostos aparecem como conjunto, no documento a que pertencem', async () => {
    carregarPrd.mockResolvedValue(
      prd({
        afirmacoes: [
          afirmacao({
            id: 'p-1',
            texto: 'Inferido no PRD.',
            origem: 'proposto',
            referencia: undefined
          })
        ]
      })
    )
    montar()

    const lista = await screen.findByText(/1 afirmações propostas pela IA/i)

    expect(lista).toBeInTheDocument()
  })

  it('cortar manda um id, não a lista do que sobra', async () => {
    const user = userEvent.setup()
    carregarPrd.mockResolvedValue(
      prd({
        afirmacoes: [
          afirmacao({ id: 'p-1', texto: 'Inferido.', origem: 'proposto', referencia: undefined })
        ]
      })
    )
    montar()

    await screen.findAllByText('Inferido.')
    await user.click(screen.getAllByRole('button', { name: /Cortar a afirmação/i })[0]!)

    await waitFor(() => {
      expect(cortarPropostoDoPrd).toHaveBeenCalledWith('p-1', 'p-1', 'jarvis')
    })
  })
})

describe('bloqueio do Landscape (critério 4)', () => {
  const COM_BLOQUEIO = prd({
    bloqueioDoLandscape: {
      causa: 'sem-termo-de-pesquisa',
      evidencia: 'Nenhum termo foi confirmado.',
      tentativas: 0,
      porQueNaoSeguir: 'Sem fonte não há o que afirmar sobre terceiros.',
      retomada: 'Confirme um termo e gere de novo.'
    }
  })

  it('mostra o bloqueio com a retomada, dentro do documento', async () => {
    carregarPrd.mockResolvedValue(COM_BLOQUEIO)
    montar()

    expect(await screen.findByText(/Confirme um termo e gere de novo/i)).toBeInTheDocument()
  })

  it('NÃO trava o aceite — o PRD depende do brief, não do mercado', async () => {
    carregarPrd.mockResolvedValue(COM_BLOQUEIO)
    montar()

    expect(await screen.findByRole('button', { name: /Aceitar o PRD/i })).toBeEnabled()
  })
})

describe('contradições (critério 6)', () => {
  const COM_CONTRADICAO = prd({
    contradicoes: [
      {
        id: 'c-1',
        afirmacoes: ['a-1', 'b-1'],
        pergunta: 'O produto é local ou na nuvem?',
        recomendacao: 'Local, como o brief diz.'
      }
    ]
  })

  it('mostra a pergunta e a recomendação, nunca uma correção já aplicada', async () => {
    carregarPrd.mockResolvedValue(COM_CONTRADICAO)
    montar()

    expect(await screen.findByText(/O produto é local ou na nuvem/i)).toBeInTheDocument()
    expect(screen.getByText(/Local, como o brief diz/i)).toBeInTheDocument()
  })

  it('trava o aceite, com a razão ao lado do botão', async () => {
    carregarPrd.mockResolvedValue(COM_CONTRADICAO)
    montar()

    expect(await screen.findByRole('button', { name: /Aceitar o PRD/i })).toBeDisabled()
    expect(screen.getByText(/Resolva as contradições acima/i)).toBeInTheDocument()
  })
})

describe('aceite e desfechos', () => {
  it('o aceite vai pelo canal de evento da jornada, não por um canal próprio', async () => {
    const user = userEvent.setup()
    carregarPrd.mockResolvedValue(prd())
    montar()

    await user.click(await screen.findByRole('button', { name: /Aceitar o PRD/i }))

    await waitFor(() => {
      expect(aplicarEventoDaJornada).toHaveBeenCalledWith('p-1', 'prd-aceito', 'jarvis')
    })
  })

  it('bloqueio de rota vira aviso com a ação, não erro genérico', async () => {
    const user = userEvent.setup()
    gerarPrd.mockResolvedValue({
      resultado: 'bloqueado-sem-rota',
      mensagem: 'Nenhuma rota autorizada.',
      acao: 'Entre na sua conta Claude.'
    })
    montar()

    await screen.findByRole('textbox')
    await user.click(screen.getByRole('button', { name: /gerar/i }))

    expect(await screen.findByText(/Entre na sua conta Claude/i)).toBeInTheDocument()
  })

  it('saída recusada lista os problemas, um por linha', async () => {
    const user = userEvent.setup()
    gerarPrd.mockResolvedValue({
      resultado: 'saida-invalida',
      mensagem: 'A saída não passou no validador.',
      problemas: ['A afirmação a-1 ancora em b-99.']
    })
    montar()

    await screen.findByRole('textbox')
    await user.click(screen.getByRole('button', { name: /gerar/i }))

    expect(await screen.findByText(/ancora em b-99/i)).toBeInTheDocument()
  })

  it('sem revisão ainda, oferece o caminho em vez de uma tela vazia', async () => {
    montar()

    expect(await screen.findByText(/Nenhum documento ainda/i)).toBeInTheDocument()
  })
})
