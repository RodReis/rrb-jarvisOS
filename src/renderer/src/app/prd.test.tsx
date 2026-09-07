import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventoDaGeracao, GenerationEvent } from '@shared/domain/geracao'
import { ComTrilha } from './trilha-de-teste'
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
const contradicoesDoPrd = vi.fn()
const responderContradicaoDoPrd = vi.fn()
const cancelarAssinatura = vi.fn()
/** O ouvinte que a tela registra no canal de eventos da geração (#318). */
let emitir: ((payload: EventoDaGeracao) => void) | undefined

/** Emite um evento de etapa como o main o entregaria, e espera o React reagir. */
async function chega(evento: GenerationEvent): Promise<void> {
  await waitFor(() => expect(emitir).toBeDefined())
  emitir?.({ traceId: 'etapas:p-1', evento })
}

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

/**
 * Monta o painel **junto do botão que a trilha desenha** (#332, defeito 4).
 *
 * O gerar e o aceitar saíram do painel por decisão do PI. A etapa escolhe qual dos dois o botão
 * da trilha oferece: `prd` gera, `prd-aceito` aceita.
 */
function montar(etapa: 'prd' | 'prd-aceito' = 'prd'): void {
  render(
    <ComTrilha
      etapa={etapa}
      painel={({ onAcaoDaEtapa, onOcupado, onBloqueioDoAceite }) => (
        <PrdDoProjeto
          workspace="jarvis"
          projectId="p-1"
          nomeDoProjeto="Leituras"
          onAceito={vi.fn()}
          etapa={etapa}
          onAcaoDaEtapa={onAcaoDaEtapa}
          onOcupado={onOcupado}
          onBloqueioDoAceite={onBloqueioDoAceite}
        />
      )}
    />
  )
}

beforeEach(() => {
  emitir = undefined
  cancelarAssinatura.mockClear()
  proporTermoDePesquisa.mockReset().mockResolvedValue('ferramentas de leitura')
  gerarPrd.mockReset().mockResolvedValue({ resultado: 'gerado', mensagem: 'ok' })
  carregarPrd.mockReset().mockResolvedValue(null)
  cortarPropostoDoPrd.mockReset().mockResolvedValue(null)
  aplicarEventoDaJornada.mockReset().mockResolvedValue({ resultado: 'avancou' })
  contradicoesDoPrd.mockReset().mockResolvedValue(null)
  responderContradicaoDoPrd.mockReset().mockResolvedValue({ reason: 'registrada', mensagem: 'ok' })

  Object.defineProperty(window, 'jarvis', {
    value: {
      proporTermoDePesquisa,
      gerarPrd,
      carregarPrd,
      cortarPropostoDoPrd,
      aplicarEventoDaJornada,
      contradicoesDoPrd,
      responderContradicaoDoPrd,
      onGenerationEvent: (ouvinte: (payload: EventoDaGeracao) => void) => {
        emitir = ouvinte
        return cancelarAssinatura
      },
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
    montar('prd-aceito')

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Aceitar o PRD/i })).toBeEnabled()
    )
  })
})

describe('contradições — pergunta no pop-up da M8-F03 (critério 6, emenda E1)', () => {
  const CONTRADICAO = {
    id: 'c-1',
    etapa: 'prd',
    afirmacoes: ['a-1', 'b-1'],
    titulo: 'Local ou nuvem',
    enunciado: 'O produto é local ou na nuvem?',
    opcoes: [
      { id: 'a', rotulo: 'Local', impacto: 'Sem sync entre máquinas.' },
      { id: 'b', rotulo: 'Nuvem', impacto: 'Exige conta e rede.' }
    ],
    recomendada: 'a',
    justificativa: 'Local, como o brief diz.',
    aceitaTextoLivre: true,
    delegavel: true
  }
  const COM_CONTRADICAO = prd({ contradicoes: [CONTRADICAO] })
  const VISTA_PENDENTE = {
    estado: { tipo: 'pergunta', pergunta: CONTRADICAO, restantes: 1 },
    historico: []
  }

  it('o pop-up abre sozinho com a pergunta e as opções, e a recomendada vem primeiro', async () => {
    carregarPrd.mockResolvedValue(COM_CONTRADICAO)
    contradicoesDoPrd.mockResolvedValue(VISTA_PENDENTE)
    montar()

    const dialogo = await screen.findByRole('dialog')
    expect(await within(dialogo).findByText(/O produto é local ou na nuvem/i)).toBeInTheDocument()
    const opcoes = within(dialogo).getAllByRole('radio')
    expect(opcoes[0]).toHaveAccessibleName(/Local/)
    expect(opcoes[0]).not.toBeChecked()
    expect(within(dialogo).getByRole('button', { name: /Decide por mim/i })).toBeInTheDocument()
  })

  it('a lista inline mostra a pergunta e a justificativa, nunca uma correção aplicada', async () => {
    carregarPrd.mockResolvedValue(COM_CONTRADICAO)
    contradicoesDoPrd.mockResolvedValue(VISTA_PENDENTE)
    montar()

    const lista = await screen.findByTestId('prd-contradicoes')
    expect(within(lista).getByText(/O produto é local ou na nuvem/i)).toBeInTheDocument()
    // A recomendada aparece pelo rótulo, com a justificativa ao lado — não só o porquê.
    expect(
      within(lista).getByText(/Recomendação: Local — Local, como o brief diz/i)
    ).toBeInTheDocument()
  })

  it('avisa o pai que o aceite está travado, para a trilha não oferecê-lo (#318)', async () => {
    carregarPrd.mockResolvedValue(COM_CONTRADICAO)
    contradicoesDoPrd.mockResolvedValue(VISTA_PENDENTE)
    const onBloqueio = vi.fn()

    render(
      <PrdDoProjeto
        workspace="jarvis"
        projectId="p-1"
        nomeDoProjeto="Leituras"
        onAceito={vi.fn()}
        etapa="prd-aceito"
        onBloqueioDoAceite={onBloqueio}
      />
    )

    // A razão é a mesma frase que o botão de baixo mostra: uma fonte, dois lugares.
    await waitFor(() =>
      expect(onBloqueio).toHaveBeenLastCalledWith('Resolva as contradições acima para aceitar.')
    )
  })

  it('sem contradição, o pai é avisado de que o aceite está livre', async () => {
    carregarPrd.mockResolvedValue(prd())
    const onBloqueio = vi.fn()

    render(
      <PrdDoProjeto
        workspace="jarvis"
        projectId="p-1"
        nomeDoProjeto="Leituras"
        onAceito={vi.fn()}
        etapa="prd-aceito"
        onBloqueioDoAceite={onBloqueio}
      />
    )

    await waitFor(() => expect(onBloqueio).toHaveBeenLastCalledWith(undefined))
  })

  it('trava o aceite, com a razão ao lado do botão', async () => {
    carregarPrd.mockResolvedValue(COM_CONTRADICAO)
    contradicoesDoPrd.mockResolvedValue(VISTA_PENDENTE)
    montar('prd-aceito')

    // O modal esconde o resto da página (aria-hidden); o aceite se confere com ele fechado.
    const dialogo = await screen.findByRole('dialog')
    await userEvent.click(within(dialogo).getAllByRole('button', { name: /Fechar/i })[0]!)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(screen.getByRole('button', { name: /Aceitar o PRD/i })).toBeDisabled()
    expect(screen.getByText(/Resolva as contradições/i)).toBeInTheDocument()
  })

  it('responder a última contradição gera os documentos de novo, sozinho, com o termo confirmado', async () => {
    // O termo só conta como confirmado quando o PI gerou com ele nesta sessão: a revisão com
    // contradição chega depois desse clique, e a última resposta regera com o mesmo termo.
    responderContradicaoDoPrd.mockResolvedValue({
      reason: 'registrada',
      mensagem: 'ok',
      estado: { tipo: 'concluido', decisoes: [] }
    })
    montar()
    await screen.findByRole('textbox')
    carregarPrd.mockResolvedValue(COM_CONTRADICAO)
    contradicoesDoPrd.mockResolvedValue(VISTA_PENDENTE)
    await userEvent.click(screen.getByRole('button', { name: /Gerar o PRD/i }))

    const dialogo = await screen.findByRole('dialog')
    await userEvent.click(await within(dialogo).findByRole('radio', { name: /Nuvem/ }))
    await userEvent.click(within(dialogo).getByRole('button', { name: /Confirmar/i }))

    await waitFor(() => expect(gerarPrd).toHaveBeenCalledTimes(2))
    expect(gerarPrd).toHaveBeenLastCalledWith('p-1', 'ferramentas de leitura', 'jarvis')
    expect(responderContradicaoDoPrd).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ perguntaId: 'c-1', escolha: 'b', autor: 'pi' }),
      'jarvis'
    )
  })

  it('tela reaberta: responder a última não regera com termo que ninguém confirmou (critério 3)', async () => {
    carregarPrd.mockResolvedValue(COM_CONTRADICAO)
    contradicoesDoPrd.mockResolvedValue(VISTA_PENDENTE)
    responderContradicaoDoPrd.mockResolvedValue({
      reason: 'registrada',
      mensagem: 'ok',
      estado: { tipo: 'concluido', decisoes: [] }
    })
    montar()

    const dialogo = await screen.findByRole('dialog')
    await userEvent.click(await within(dialogo).findByRole('radio', { name: /Nuvem/ }))
    // Depois da resposta o main diz que concluiu; a tela relê a vista em vez de regerar.
    contradicoesDoPrd.mockResolvedValue({
      estado: { tipo: 'concluido', decisoes: [] },
      historico: []
    })
    await userEvent.click(within(dialogo).getByRole('button', { name: /Confirmar/i }))

    // O pop-up fecha e a lista diz que falta gerar; a pesquisa não roda sem confirmação.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(gerarPrd).not.toHaveBeenCalled()
    expect(await screen.findByText(/Todas respondidas/i)).toBeInTheDocument()
  })

  it('com contradição que sobra, responder não regera — só avança para a próxima', async () => {
    carregarPrd.mockResolvedValue(COM_CONTRADICAO)
    contradicoesDoPrd.mockResolvedValue(VISTA_PENDENTE)
    responderContradicaoDoPrd.mockResolvedValue({
      reason: 'registrada',
      mensagem: 'ok',
      estado: { tipo: 'pergunta', pergunta: { ...CONTRADICAO, id: 'c-2' }, restantes: 1 }
    })
    montar()

    const dialogo = await screen.findByRole('dialog')
    await userEvent.click(await within(dialogo).findByRole('radio', { name: /Nuvem/ }))
    await userEvent.click(within(dialogo).getByRole('button', { name: /Confirmar/i }))

    await waitFor(() => expect(responderContradicaoDoPrd).toHaveBeenCalled())
    expect(gerarPrd).not.toHaveBeenCalled()
  })

  it('fechar o pop-up deixa o botão de reabrir na lista', async () => {
    carregarPrd.mockResolvedValue(COM_CONTRADICAO)
    contradicoesDoPrd.mockResolvedValue(VISTA_PENDENTE)
    montar()

    const dialogo = await screen.findByRole('dialog')
    // Dois botões respondem por 'Fechar': o do rodapé e o 'X' do Radix. Qualquer um serve.
    await userEvent.click(within(dialogo).getAllByRole('button', { name: /Fechar/i })[0]!)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Responder às contradições/i }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})

describe('aceite e desfechos', () => {
  it('o aceite vai pelo canal de evento da jornada, não por um canal próprio', async () => {
    const user = userEvent.setup()
    carregarPrd.mockResolvedValue(prd())
    montar('prd-aceito')

    await user.click(await screen.findByRole('button', { name: /Aceitar o PRD/i }))

    await waitFor(() => {
      expect(aplicarEventoDaJornada).toHaveBeenCalledWith('p-1', 'prd-aceito', 'jarvis')
    })
  })

  it('o aceite não aparece duplicado dentro do painel — ele mora na trilha', async () => {
    // A regra do PI (#332): avanço e aceite ficam na trilha; dois botões com o mesmo nome, um do
    // lado do outro, não dá. Este teste reprova se o botão do painel voltar.
    carregarPrd.mockResolvedValue(prd())
    montar('prd-aceito')

    const painel = await screen.findByLabelText('Aceite do PRD')
    expect(within(painel).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Aceitar o PRD/i })).toBeInTheDocument()
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

/**
 * O andamento da geração, na tela da etapa (#318).
 *
 * A barra vivia dentro do console, no fim da página, e contava as etapas de duas rodadas
 * somadas — o PI via uma rodada nova abrir em 60% com "Gravação" concluída da anterior. Aqui ela
 * fica junto do botão que dispara a geração, e o que ela conta é **uma** rodada.
 */
describe('andamento da geração (#318)', () => {
  it('a barra fica junto do botão de gerar, não no fim da página', async () => {
    montar()
    await chega({ tipo: 'etapa', etapa: 'pesquisa', estado: 'iniciada' })

    const andamento = await screen.findByRole('progressbar')
    const botao = screen.getByRole('button', { name: /Gerar/i })

    // `compareDocumentPosition`: o andamento vem **depois** do botão na ordem do documento, e
    // antes de tudo o mais — é isso que o PI vê sem rolar.
    expect(botao.compareDocumentPosition(andamento) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
  })

  it('sem etapa anunciada não há barra: 0% afirmaria que nada aconteceu', async () => {
    montar()

    expect(await screen.findByRole('button', { name: /Gerar/i })).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('conta só as etapas concluídas desta rodada', async () => {
    montar()
    await chega({ tipo: 'etapa', etapa: 'pesquisa', estado: 'iniciada' })
    await chega({ tipo: 'etapa', etapa: 'pesquisa', estado: 'concluida', resumo: '3 fontes.' })
    await chega({ tipo: 'etapa', etapa: 'documentos', estado: 'iniciada' })

    // 1 de 5: a que está em curso não vale meio passo.
    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '20')

    // A lista diz o estado de cada etapa: uma concluída, a seguinte em curso, o resto pendente.
    const andamento = screen.getByLabelText('Andamento da geração')
    expect(andamento.querySelector('[data-jos-etapa="documentos"]')).toHaveAttribute(
      'data-jos-estado',
      'iniciada'
    )
    expect(andamento.querySelector('[data-jos-etapa="pesquisa"]')).toHaveAttribute(
      'data-jos-estado',
      'concluida'
    )
  })

  it('o resumo mostrado é o da etapa em curso, não o da anterior', async () => {
    montar()
    await chega({ tipo: 'etapa', etapa: 'pesquisa', estado: 'concluida', resumo: '3 fontes.' })
    expect(await screen.findByText('3 fontes.')).toBeInTheDocument()

    await chega({ tipo: 'etapa', etapa: 'documentos', estado: 'iniciada' })

    // "3 fontes." pendurado sob "PRD, Landscape e Convention" descreveria a etapa errada.
    await waitFor(() => expect(screen.queryByText('3 fontes.')).not.toBeInTheDocument())
  })

  it('a rodada nova não herda as etapas da anterior', async () => {
    // O defeito exato que o PI viu: rodada nova abrindo em 60%, com "Gravação dos documentos —
    // os três documentos foram gravados" sobre uma rodada que ainda estava gerando.
    montar()
    await chega({ tipo: 'etapa', etapa: 'pesquisa', estado: 'concluida' })
    await chega({ tipo: 'etapa', etapa: 'contradicoes', estado: 'concluida' })
    await chega({ tipo: 'etapa', etapa: 'gravacao', estado: 'concluida', resumo: 'gravados.' })
    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '60')

    await chega({ tipo: 'etapa', etapa: 'pesquisa', estado: 'iniciada' })

    await waitFor(() =>
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
    )
    expect(screen.queryByText('gravados.')).not.toBeInTheDocument()
  })

  it('a falha da etapa é dita em texto, não só por cor', async () => {
    montar()
    await chega({ tipo: 'etapa', etapa: 'documentos', estado: 'falhou', resumo: 'Sem saída.' })

    expect(await screen.findByText('falhou')).toBeInTheDocument()
    expect(screen.getByText('Sem saída.')).toBeInTheDocument()
  })

  it('a gravação concluída recarrega a revisão — mesmo sem ter sido esta tela a gerar', async () => {
    // Trocar de menu e voltar não pode deixar o PI olhando a revisão velha: a geração corre no
    // main, e a tela lia o banco só ao montar.
    carregarPrd.mockResolvedValue(null)
    montar()
    await waitFor(() => expect(carregarPrd).toHaveBeenCalledTimes(1))

    carregarPrd.mockResolvedValue(prd())
    await chega({ tipo: 'etapa', etapa: 'gravacao', estado: 'concluida', resumo: 'gravados.' })

    expect(await screen.findByText(/O produto organiza leituras por projeto/i)).toBeInTheDocument()
  })

  it('geração em curso desabilita o botão de gerar, mesmo vinda de outra tela', async () => {
    montar()
    await waitFor(() => expect(screen.getByRole('button', { name: /Gerar/i })).toBeEnabled())

    await chega({ tipo: 'etapa', etapa: 'documentos', estado: 'iniciada' })

    await waitFor(() => expect(screen.getByRole('button', { name: /Gerar/i })).toBeDisabled())
  })

  it('cancela a assinatura ao desmontar — ouvinte vivo sobre tela morta vaza', async () => {
    const { unmount } = render(
      <PrdDoProjeto
        workspace="jarvis"
        projectId="p-1"
        nomeDoProjeto="Leituras"
        onAceito={vi.fn()}
      />
    )
    await waitFor(() => expect(emitir).toBeDefined())

    unmount()

    expect(cancelarAssinatura).toHaveBeenCalled()
  })
})
