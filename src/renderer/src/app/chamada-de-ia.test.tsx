import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiStreamEvent } from '@shared/domain/ai'
import { ChamadaDeIa } from './ChamadaDeIa'

/**
 * O painel de chamada de IA (SPEC-Providers-02, critério 2), categoria Tela.
 *
 * O que se prova aqui é o **incremental**: o texto aparece por partes, não de uma vez. É a
 * diferença entre streaming e uma resposta que fingiu ser stream, e é observável em jsdom
 * porque é comportamento de estado, não de pintura.
 *
 * O que estes testes deliberadamente não afirmam é aparência — a lição do MVP-003 (e do FIX
 * #107 na semana passada): jsdom não aplica folha de estilo, e asserção de cor aqui mediria a
 * string que o próprio componente escreveu.
 */

const callAi = vi.fn()
const cancelAi = vi.fn()
const sendLog = vi.fn()

/** O listener que o componente registrou — é por ele que o teste "emite" chunks. */
let emitir: ((evento: AiStreamEvent) => void) | undefined
const cancelarAssinatura = vi.fn()

const ID = 'chamada-1'

beforeEach(() => {
  vi.clearAllMocks()
  emitir = undefined
  callAi.mockResolvedValue({ id: ID, provider: 'anthropic', model: 'claude-opus-5' })
  cancelAi.mockResolvedValue(undefined)

  Object.defineProperty(window, 'jarvis', {
    value: {
      callAi,
      cancelAi,
      sendLog,
      onAiStreamEvent: (listener: (evento: AiStreamEvent) => void) => {
        emitir = listener
        return cancelarAssinatura
      }
    },
    configurable: true,
    writable: true
  })
})

function montar(): void {
  render(<ChamadaDeIa workspace="jarvis" nomeDoEspaco="JARVIS OS" />)
}

/** Digita o prompt e clica em Enviar — o caminho que o usuário percorre. */
async function enviar(prompt = 'qual a capital da Franca'): Promise<void> {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Prompt'), prompt)
  await user.click(screen.getByRole('button', { name: 'Enviar' }))
  await waitFor(() => expect(callAi).toHaveBeenCalled())
}

describe('streaming visto do renderer (critério 2)', () => {
  it('monta o texto incrementalmente — cada chunk soma ao anterior', async () => {
    montar()
    await enviar()

    emitir?.({ tipo: 'chunk', id: ID, texto: 'Paris' })
    expect(await screen.findByText('Paris')).toBeInTheDocument()

    // O segundo chunk **soma**. Se o componente substituísse em vez de concatenar, a tela
    // mostraria só o último pedaço — que é o bug clássico de streaming e passa despercebido
    // com respostas curtas.
    emitir?.({ tipo: 'chunk', id: ID, texto: ' e a capital.' })
    expect(await screen.findByText('Paris e a capital.')).toBeInTheDocument()
  })

  it('dispara a chamada sem carregar credencial — só provider e prompt', async () => {
    montar()
    await enviar('oi')

    // O critério 8 visto do renderer: o que sai pela ponte não tem campo de chave. A asserção
    // é sobre o argumento inteiro porque um campo extra passaria por uma checagem por nome.
    expect(callAi).toHaveBeenCalledWith({ provider: 'anthropic', prompt: 'oi' }, 'jarvis')
  })

  it('descarta chunks de uma chamada que não é a corrente', async () => {
    montar()
    await enviar()

    emitir?.({ tipo: 'chunk', id: ID, texto: 'da corrente' })
    // Chunk de outra chamada (o usuário disparou uma nova): tem de ser ignorado. Sem isto, uma
    // resposta antiga que ainda estava chegando escreveria por cima da nova.
    emitir?.({ tipo: 'chunk', id: 'outra-chamada', texto: 'INTRUSO' })

    expect(await screen.findByText('da corrente')).toBeInTheDocument()
    expect(screen.queryByText(/INTRUSO/)).not.toBeInTheDocument()
  })
})

describe('estados da chamada (critério 2)', () => {
  it('mostra `streaming` enquanto a resposta chega e `concluída` no fim', async () => {
    montar()
    expect(screen.getByText('Pronto')).toBeInTheDocument()

    await enviar()
    expect(screen.getByText('Recebendo resposta…')).toBeInTheDocument()

    emitir?.({
      tipo: 'fim',
      id: ID,
      estado: 'concluido',
      custo: {
        provider: 'anthropic',
        model: 'claude-opus-5',
        workspace: 'jarvis',
        estimadoUsd: 0.02,
        realUsd: 0.0175,
        usage: { tokensEntrada: 1_000, tokensSaida: 500 },
        latenciaPrimeiroChunkMs: 340,
        latenciaTotalMs: 1_200
      }
    })

    expect(await screen.findByText('Concluída')).toBeInTheDocument()
  })

  it('bloqueia o envio enquanto uma chamada está em andamento', async () => {
    montar()
    await enviar()

    // Duas chamadas simultâneas misturariam os textos na tela — e a segunda gastaria dinheiro
    // por uma resposta que o usuário não pediu duas vezes.
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled()
    expect(screen.getByLabelText('Prompt')).toBeDisabled()
  })

  it('não envia prompt vazio', async () => {
    montar()
    const user = userEvent.setup()

    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled()
    await user.type(screen.getByLabelText('Prompt'), '   ')
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled()
    expect(callAi).not.toHaveBeenCalled()
  })
})

describe('falha (critério 7)', () => {
  it('mostra o motivo em papel de alerta e volta a permitir o envio', async () => {
    montar()
    await enviar()

    emitir?.({
      tipo: 'fim',
      id: ID,
      estado: 'falhou',
      erro: 'Nenhuma credencial configurada para este provider.'
    })

    // `role="alert"` e não texto solto: a falha precisa ser anunciada por leitor de tela. Um
    // erro que só existe visualmente deixa quem não vê a tela esperando por uma resposta que
    // não vem.
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Nenhuma credencial configurada')
    expect(await screen.findByText('Falhou')).toBeInTheDocument()

    // Sair de `streaming` é o que devolve o controle ao usuário — travado ali, ele reabriria
    // a tela para tentar de novo.
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled()
  })

  it('falha no próprio IPC não deixa a tela girando para sempre', async () => {
    callAi.mockRejectedValueOnce(new Error('ponte caiu'))
    montar()
    await enviar()

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível iniciar')
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled()
  })
})

describe('custo na tela (critério 4)', () => {
  it('mostra tokens, custo real e as duas latências', async () => {
    montar()
    await enviar()

    emitir?.({
      tipo: 'fim',
      id: ID,
      estado: 'concluido',
      custo: {
        provider: 'anthropic',
        model: 'claude-opus-5',
        workspace: 'jarvis',
        estimadoUsd: 0.02,
        realUsd: 0.0175,
        usage: { tokensEntrada: 1_000, tokensSaida: 500 },
        latenciaPrimeiroChunkMs: 340,
        latenciaTotalMs: 1_200
      }
    })

    // O número aparece porque é o que a F03 vai bloquear. Ver o valor antes de o gate existir
    // é o que torna o gate previsível para quem usa.
    const rodape = await screen.findByText(/tokens de entrada/)
    expect(rodape).toHaveTextContent('1000 tokens de entrada')
    expect(rodape).toHaveTextContent('500 de saída')
    expect(rodape).toHaveTextContent('US$ 0.01750')
    expect(rodape).toHaveTextContent('340 ms')
    expect(rodape).toHaveTextContent('1200 ms')
  })
})

describe('ciclo de vida', () => {
  it('cancela a chamada em voo ao desmontar', async () => {
    const { unmount } = render(<ChamadaDeIa workspace="jarvis" nomeDoEspaco="JARVIS OS" />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Prompt'), 'oi')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(callAi).toHaveBeenCalled())

    unmount()

    // Uma resposta que continua chegando para uma tela que não existe é custo pago por nada.
    expect(cancelAi).toHaveBeenCalledWith(ID)
    expect(cancelarAssinatura).toHaveBeenCalled()
  })

  it('não cancela nada quando não há chamada em voo', () => {
    const { unmount } = render(<ChamadaDeIa workspace="jarvis" nomeDoEspaco="JARVIS OS" />)
    unmount()

    expect(cancelAi).not.toHaveBeenCalled()
  })
})
