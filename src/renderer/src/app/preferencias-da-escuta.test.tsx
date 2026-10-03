import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DisparoDeTesteDaEscuta, EstadoDaEscuta } from '@shared/domain/voz'
import { PreferenciasDaEscuta } from './PreferenciasDaEscuta'

/**
 * A seção da escuta em Settings (SPEC-Escuta-01, critério 12 e a revisão de escopo de 2026-10-03):
 * cada gatilho liga e desliga separadamente, o limiar vale na detecção seguinte e o modo de teste
 * mostra a confiança medida de cada disparo.
 */

const BASE: EstadoDaEscuta = {
  ativa: true,
  disponivel: true,
  frase: true,
  palmas: true,
  sensibilidade: 0.5,
  hotkey: 'Control+Alt+M',
  hotkeyRegistrada: true
}

let estado: EstadoDaEscuta
let avisarEstado: ((e: EstadoDaEscuta) => void) | undefined
let avisarTeste: ((d: DisparoDeTesteDaEscuta) => void) | undefined
const definirGatilhosDaEscuta = vi.fn()
const definirSensibilidadeDaEscuta = vi.fn()
const definirModoDeTesteDaEscuta = vi.fn()
const definirHotkeyDaEscuta = vi.fn()

beforeEach(() => {
  estado = BASE
  avisarEstado = undefined
  avisarTeste = undefined
  definirGatilhosDaEscuta
    .mockReset()
    .mockImplementation(async (g) => (estado = { ...estado, ...g }))
  definirSensibilidadeDaEscuta
    .mockReset()
    .mockImplementation(async (s) => (estado = { ...estado, sensibilidade: s }))
  definirModoDeTesteDaEscuta.mockReset().mockImplementation(async () => estado)
  definirHotkeyDaEscuta
    .mockReset()
    .mockImplementation(async (h) => (estado = { ...estado, hotkey: h }))
  vi.stubGlobal('jarvis', {
    estadoDaEscuta: vi.fn(async () => estado),
    definirGatilhosDaEscuta,
    definirSensibilidadeDaEscuta,
    definirModoDeTesteDaEscuta,
    definirHotkeyDaEscuta,
    onEscutaMudou: (l: (e: EstadoDaEscuta) => void) => {
      avisarEstado = l
      return () => {
        avisarEstado = undefined
      }
    },
    onEscutaTeste: (l: (d: DisparoDeTesteDaEscuta) => void) => {
      avisarTeste = l
      return () => {
        avisarTeste = undefined
      }
    },
    sendLog: vi.fn()
  })
})

afterEach(() => {
  // Desmonta antes de tirar a ponte: o desmonte encerra o modo de teste pela ponte.
  cleanup()
  vi.unstubAllGlobals()
})

async function montar() {
  render(<PreferenciasDaEscuta />)
  await screen.findByRole('switch', { name: /ei, amigo/i })
}

describe('gatilhos (revisão de escopo de 2026-10-03)', () => {
  it('mostra os dois gatilhos com o estado do main', async () => {
    estado = { ...BASE, palmas: false }
    await montar()

    expect(screen.getByRole('switch', { name: /ei, amigo/i })).toBeChecked()
    expect(screen.getByRole('switch', { name: /duas palmas/i })).not.toBeChecked()
  })

  it('desligar as palmas manda só esse gatilho, mantendo a frase', async () => {
    await montar()

    await userEvent.click(screen.getByRole('switch', { name: /duas palmas/i }))

    expect(definirGatilhosDaEscuta).toHaveBeenCalledWith({ frase: true, palmas: false })
  })

  it('o último gatilho ligado não pode ser desligado — para parar de ouvir há o interruptor da escuta', async () => {
    estado = { ...BASE, palmas: false }
    await montar()

    // Escuta ligada sem gatilho nenhum seria microfone aberto sem função, com o indicador dizendo
    // que está ouvindo.
    expect(screen.getByRole('switch', { name: /ei, amigo/i })).toBeDisabled()
    expect(screen.getByText(/para parar de ouvir/i)).toBeInTheDocument()
  })
})

describe('limiar de disparo (critério 12)', () => {
  it('mostra o limiar atual em texto e o aplica a cada mudança, sem botão de salvar', async () => {
    await montar()

    const faixa = screen.getByRole('slider', { name: /limiar de disparo/i })
    expect(faixa).toHaveAttribute('aria-valuenow', '0.5')

    faixa.focus()
    await userEvent.keyboard('{ArrowRight}')

    await waitFor(() => expect(definirSensibilidadeDaEscuta).toHaveBeenCalledWith(0.55))
  })

  it('explica a direção: maior exige mais certeza', async () => {
    await montar()
    expect(screen.getByText(/maior.*mais certeza/i)).toBeInTheDocument()
  })
})

describe('teste ao vivo (critério 12)', () => {
  it('ligar o teste avisa o main, e cada disparo aparece com confiança e limiar', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: /testar ao vivo/i }))
    expect(definirModoDeTesteDaEscuta).toHaveBeenCalledWith(true)

    act(() => avisarTeste?.({ gatilho: 'frase', confianca: 0.91, limiar: 0.5 }))
    act(() => avisarTeste?.({ gatilho: 'palmas', limiar: 0.5 }))

    const lista = await screen.findByRole('list', { name: /disparos do teste/i })
    const itens = within(lista).getAllByRole('listitem')
    expect(itens).toHaveLength(2)
    // Mais recente primeiro; a confiança aparece como número legível.
    expect(itens[0]).toHaveTextContent(/palmas/i)
    expect(itens[1]).toHaveTextContent(/ei, amigo/i)
    expect(itens[1]).toHaveTextContent(/0,91/)
    expect(itens[1]).toHaveTextContent(/0,50/)
  })

  it('avisa que durante o teste a conversa não começa', async () => {
    await montar()
    await userEvent.click(screen.getByRole('button', { name: /testar ao vivo/i }))

    expect(await screen.findByText(/não abre conversa/i)).toBeInTheDocument()
  })

  it('sair da seção encerra o modo de teste — senão a escuta ficaria sem abrir turno', async () => {
    await montar()
    await userEvent.click(screen.getByRole('button', { name: /testar ao vivo/i }))
    definirModoDeTesteDaEscuta.mockClear()

    cleanup()

    expect(definirModoDeTesteDaEscuta).toHaveBeenCalledWith(false)
  })

  it('com a escuta desligada o teste não pode ser iniciado, e diz por quê', async () => {
    estado = { ...BASE, ativa: false }
    await montar()

    expect(screen.getByRole('button', { name: /testar ao vivo/i })).toBeDisabled()
    expect(screen.getByText(/ligue a escuta/i)).toBeInTheDocument()
  })

  it('desligar a escuta pelo mute encerra o teste na tela', async () => {
    await montar()
    await userEvent.click(screen.getByRole('button', { name: /testar ao vivo/i }))

    act(() => avisarEstado?.({ ...BASE, ativa: false }))

    expect(await screen.findByRole('button', { name: /testar ao vivo/i })).toBeDisabled()
    expect(screen.queryByText(/não abre conversa/i)).not.toBeInTheDocument()
  })
})

describe('hotkey de mute (critério 11)', () => {
  it('mostra a combinação atual como está escrita na tecla, não como a API a chama', async () => {
    await montar()

    expect(screen.getByRole('combobox', { name: /atalho de mute/i })).toHaveTextContent(
      'Ctrl + Alt + M'
    )
  })

  it('trocar o atalho manda só a combinação escolhida', async () => {
    await montar()

    await userEvent.click(screen.getByRole('combobox', { name: /atalho de mute/i }))
    await userEvent.click(await screen.findByRole('option', { name: 'Ctrl + Shift + K' }))

    expect(definirHotkeyDaEscuta).toHaveBeenCalledWith('Control+Shift+K')
  })

  it('atalho ocupado por outro app diz o que fazer, e o interruptor da tela segue valendo', async () => {
    estado = { ...BASE, hotkeyRegistrada: false }
    await montar()

    expect(await screen.findByText(/outro app já usa esse atalho/i)).toBeInTheDocument()
  })

  it('com o atalho registrado não mostra aviso nenhum', async () => {
    await montar()

    expect(screen.queryByText(/outro app já usa/i)).not.toBeInTheDocument()
  })
})
