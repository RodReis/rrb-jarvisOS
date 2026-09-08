import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Microfone } from './Microfone'
import type { DesfechoDaTranscricao, ProntidaoDaVoz } from '@shared/domain/voz'

/**
 * A tela do microfone (SPEC-Voz-01, critérios 4, 5 e 7).
 *
 * Ponte por `vi.stubGlobal`, não `defineProperty`: a propriedade definida sobrevive ao
 * `unstubAllGlobals` do vizinho e quebra outro arquivo só no CI.
 */

const transcreverAudio = vi.fn()
const prontidaoDaVoz = vi.fn()
const baixarArtefatoDeVoz = vi.fn()

/**
 * A assinatura do canal da hotkey, guardando o ouvinte.
 *
 * Guardar o callback é o ponto: o que os testes da hotkey medem é o que a tela faz **ao ser
 * avisada** pelo main, e um dublê que só conta chamadas de assinatura nunca chegaria lá.
 */
let avisarHotkey: ((gravando: boolean) => void) | undefined
const onVozHotkey = vi.fn((ouvinte: (gravando: boolean) => void) => {
  avisarHotkey = ouvinte
  return () => {
    avisarHotkey = undefined
  }
})

function prontidao(extra: Partial<ProntidaoDaVoz> = {}): ProntidaoDaVoz {
  return { pronta: true, faltando: [], compute: 'cuda', ...extra }
}

beforeEach(() => {
  transcreverAudio.mockReset()
  prontidaoDaVoz.mockReset().mockResolvedValue(prontidao())
  baixarArtefatoDeVoz.mockReset().mockResolvedValue({ estado: 'ok' })
  avisarHotkey = undefined
  onVozHotkey.mockClear()
  vi.stubGlobal('jarvis', {
    transcreverAudio,
    prontidaoDaVoz,
    baixarArtefatoDeVoz,
    onVozHotkey
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Um dublê de captura: `getUserMedia` não existe em jsdom, e o que se mede aqui é a **lógica da
 * tela** — quando ela grava, quando transcreve, o que faz com cada desfecho. A captura real é
 * exercitada no app, no critério 5.
 */
function capturaFalsa(amostras = 16_000): () => Promise<() => Promise<Int16Array>> {
  return async () => async () => new Int16Array(amostras)
}

function montar(capturar = capturaFalsa()): ReturnType<typeof render> {
  // Devolve o resultado do `render` porque o teste de desmontagem precisa do `unmount`.
  return render(<Microfone workspace="jarvis" capturar={capturar} />)
}

describe('runtime ausente é convite, não erro (critério 4)', () => {
  it('oferece baixar quando falta artefato, em vez de dizer que falhou', async () => {
    // A primeira execução do app cai aqui. "Falhou" mandaria tentar de novo — ação que nunca
    // vai funcionar enquanto o runtime não existir.
    prontidaoDaVoz.mockResolvedValue(prontidao({ pronta: false, faltando: ['runtime-python'] }))
    montar()

    expect(await screen.findByRole('button', { name: /baixar/i })).toBeInTheDocument()
  })

  it('não oferece gravar enquanto o runtime não está pronto', async () => {
    prontidaoDaVoz.mockResolvedValue(prontidao({ pronta: false, faltando: ['runtime-python'] }))
    montar()

    await screen.findByRole('button', { name: /baixar/i })
    expect(screen.queryByRole('button', { name: /segure para falar/i })).not.toBeInTheDocument()
  })

  it('baixar chama a ponte e volta a consultar a prontidão', async () => {
    prontidaoDaVoz.mockResolvedValueOnce(prontidao({ pronta: false, faltando: ['runtime-python'] }))
    montar()

    await userEvent.click(await screen.findByRole('button', { name: /baixar/i }))

    expect(baixarArtefatoDeVoz).toHaveBeenCalledWith('runtime-python')
    // Sem reconsultar, a tela continuaria oferecendo baixar o que já baixou.
    await waitFor(() => expect(prontidaoDaVoz).toHaveBeenCalledTimes(2))
  })

  it('hash divergente diz o que houve, sem stack trace', async () => {
    prontidaoDaVoz.mockResolvedValue(prontidao({ pronta: false, faltando: ['runtime-python'] }))
    baixarArtefatoDeVoz.mockResolvedValue({ estado: 'hash-divergente' })
    montar()

    await userEvent.click(await screen.findByRole('button', { name: /baixar/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/integridade|verificação|hash/i)
  })
})

describe('o modo de compute aparece na tela (critério 7)', () => {
  it('indica CPU quando não há CUDA', async () => {
    prontidaoDaVoz.mockResolvedValue(prontidao({ compute: 'cpu-int8' }))
    montar()

    expect(await screen.findByText(/cpu/i)).toBeInTheDocument()
  })

  it('indica GPU quando há CUDA', async () => {
    montar()

    expect(await screen.findByText(/gpu|cuda/i)).toBeInTheDocument()
  })
})

describe('push-to-talk: segurar grava, soltar transcreve (critério 5)', () => {
  it('o botão anuncia o gesto, não só "gravar"', async () => {
    montar()

    // "Segure para falar" ensina o gesto; "Gravar" sugere clique, que não é o contrato aqui.
    expect(await screen.findByRole('button', { name: /segure para falar/i })).toBeInTheDocument()
  })

  it('mostra o texto transcrito quando o desfecho é ok', async () => {
    const desfecho: DesfechoDaTranscricao = {
      estado: 'ok',
      resultado: { texto: 'bom dia, jarvis', idioma: 'pt', segmentos: [] }
    }
    transcreverAudio.mockResolvedValue(desfecho)
    montar()

    const botao = await screen.findByRole('button', { name: /segure para falar/i })
    await userEvent.pointer([{ keys: '[MouseLeft>]', target: botao }, { keys: '[/MouseLeft]' }])

    expect(await screen.findByText('bom dia, jarvis')).toBeInTheDocument()
  })

  it('falha na transcrição oferece tentar de novo, não baixar', async () => {
    // A distinção do critério 2: "falhou" pede nova tentativa; "runtime ausente" pede download.
    transcreverAudio.mockResolvedValue({ estado: 'falhou', motivo: 'o sidecar encerrou' })
    montar()

    const botao = await screen.findByRole('button', { name: /segure para falar/i })
    await userEvent.pointer([{ keys: '[MouseLeft>]', target: botao }, { keys: '[/MouseLeft]' }])

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/tentar de novo|tente novamente/i)
    expect(alerta).not.toHaveTextContent(/baixar/i)
  })

  it('clique curto demais não vira erro na cara do usuário', async () => {
    // `sem-audio` é acidente, não falha: um alerta aqui puniria um clique sem querer.
    transcreverAudio.mockResolvedValue({ estado: 'sem-audio' })
    montar(capturaFalsa(0))

    const botao = await screen.findByRole('button', { name: /segure para falar/i })
    await userEvent.pointer([{ keys: '[MouseLeft>]', target: botao }, { keys: '[/MouseLeft]' }])

    await waitFor(() => expect(transcreverAudio).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('o áudio não sobrevive à transcrição (critério 8)', () => {
  it('a tela não guarda o último buffer', async () => {
    transcreverAudio.mockResolvedValue({
      estado: 'ok',
      resultado: { texto: 'oi', idioma: 'pt', segmentos: [] }
    })
    montar()

    const botao = await screen.findByRole('button', { name: /segure para falar/i })
    await userEvent.pointer([{ keys: '[MouseLeft>]', target: botao }, { keys: '[/MouseLeft]' }])
    await screen.findByText('oi')

    // O que a tela guarda é o **texto**. Nenhum elemento carrega áudio em atributo de dado.
    expect(document.body.innerHTML).not.toMatch(/data:audio|blob:|Int16Array/)
  })
})

describe('a hotkey global conduz a gravação (critério 5)', () => {
  it('assina o canal do main ao montar — o atalho chega com a janela minimizada', async () => {
    montar()
    await screen.findByRole('button', { name: /segure para falar/i })

    expect(onVozHotkey).toHaveBeenCalledTimes(1)
  })

  it('o aviso de abrir começa a gravação, e o de fechar transcreve', async () => {
    transcreverAudio.mockResolvedValue({
      estado: 'ok',
      resultado: { texto: 'dito pela hotkey', idioma: 'pt', segmentos: [] }
    })
    montar()
    await screen.findByRole('button', { name: /segure para falar/i })

    // O main só avisa: quem tem o microfone é a tela (`getUserMedia` é Web API do renderer).
    await act(async () => avisarHotkey?.(true))
    await screen.findByRole('button', { name: /ouvindo/i })

    await act(async () => avisarHotkey?.(false))
    await screen.findByText('dito pela hotkey')
  })

  it('cancela a assinatura ao desmontar — canal não fica pendurado', async () => {
    const { unmount } = montar()
    await screen.findByRole('button', { name: /segure para falar/i })

    unmount()

    expect(avisarHotkey).toBeUndefined()
  })
})
