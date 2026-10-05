import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DisparoDaEscuta, EstadoDaEscuta } from '@shared/domain/voz'
import { EscutaDaVoz } from './EscutaDaVoz'

/**
 * O indicador permanente e o kill switch da escuta (SPEC-Escuta-01, critérios 8 e 9).
 *
 * O que prova o kill switch é a captura **encerrada**: o dublê da captura conta `parar()`. Medir
 * só o rótulo deixaria passar o microfone aberto com a tela dizendo "desligada" (lição da M17-F05).
 */

const LIGADA: EstadoDaEscuta = {
  ativa: true,
  disponivel: true,
  frase: true,
  palmas: true,
  sensibilidade: 0.5,
  hotkey: 'Control+Alt+M',
  hotkeyRegistrada: true
}

let estado: EstadoDaEscuta
let avisarMudanca: ((e: EstadoDaEscuta) => void) | undefined
let avisarDisparo: ((d: DisparoDaEscuta) => void) | undefined
const estadoDaEscuta = vi.fn()
const definirEscutaAtiva = vi.fn()
const enviarPcmDaEscuta = vi.fn()

beforeEach(() => {
  estado = LIGADA
  avisarMudanca = undefined
  avisarDisparo = undefined
  estadoDaEscuta.mockReset().mockImplementation(async () => estado)
  definirEscutaAtiva.mockReset().mockResolvedValue({ ok: true })
  enviarPcmDaEscuta.mockReset()
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: {
      enumerateDevices: vi.fn(async () => [
        { kind: 'audioinput', deviceId: 'headset-2', label: 'Headset' }
      ])
    }
  })
  vi.stubGlobal('jarvis', {
    estadoDaEscuta,
    definirEscutaAtiva,
    enviarPcmDaEscuta,
    onEscutaMudou: (ouvinte: (e: EstadoDaEscuta) => void) => {
      avisarMudanca = ouvinte
      return () => {
        avisarMudanca = undefined
      }
    },
    onEscutaDisparo: (ouvinte: (d: DisparoDaEscuta) => void) => {
      avisarDisparo = ouvinte
      return () => {
        avisarDisparo = undefined
      }
    },
    sendLog: vi.fn()
  })
})

afterEach(() => vi.unstubAllGlobals())

/** Uma captura que registra o que a tela pediu, e quando foi encerrada. */
function capturaFalsa() {
  const parar = vi.fn(async () => undefined)
  const iniciarTurno = vi.fn(() => ({
    capturar: vi.fn(async () => async () => new Int16Array()),
    cancelar: vi.fn()
  }))
  let aoBloco: ((b: Int16Array) => void) | undefined
  const abrir = vi.fn(async (_id: string | undefined, receber: (b: Int16Array) => void) => {
    aoBloco = receber
    return { parar, iniciarTurno, nivelRms: () => 0 }
  })
  return { abrir, parar, iniciarTurno, bloco: (b: Int16Array) => aoBloco?.(b) }
}

function montar(captura = capturaFalsa(), aoDisparar = vi.fn()) {
  const resultado = render(
    <EscutaDaVoz entradaId="headset-2" aoDisparar={aoDisparar} abrirCaptura={captura.abrir} />
  )
  return { ...resultado, captura, aoDisparar }
}

describe('indicador permanente (critério 9)', () => {
  it('projeta as fases do main no indicador, sem estado de turno local', async () => {
    montar()
    await screen.findByText(/escuta ligada/i)
    for (const [fase, texto] of [
      ['gravando', /ouvindo/i],
      ['transcrevendo', /transcrevendo/i],
      ['pensando', /pensando/i],
      ['falando', /falando/i],
      ['escutando', /escuta ligada/i]
    ] as const) {
      act(() => avisarMudanca?.({ ...LIGADA, fase }))
      expect(screen.getByRole('status')).toHaveTextContent(texto)
    }
  })

  it('sinaliza disparo recusado durante turno ocupado', async () => {
    montar()
    await screen.findByText(/escuta ligada/i)
    act(() => avisarMudanca?.({ ...LIGADA, fase: 'pensando', recusaSerial: 1 }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/estou atendendo o turno atual/i)
  })

  it('com a escuta ativa e o microfone aberto, o indicador diz que está ouvindo', async () => {
    montar()

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/escuta ligada/i))
    expect(screen.getByRole('switch', { name: /escuta/i })).toBeChecked()
  })

  it('o estado é dito em texto, e não só pela cor do ponto', async () => {
    montar()
    await screen.findByText(/escuta ligada/i)

    estado = { ...LIGADA, ativa: false }
    act(() => avisarMudanca?.(estado))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/escuta desligada/i))
  })

  it('escuta ativa cujo microfone não abriu não se anuncia como ligada', async () => {
    const captura = capturaFalsa()
    captura.abrir.mockRejectedValueOnce(new DOMException('negado', 'NotAllowedError'))
    montar(captura)

    // Indicador verde sobre microfone fechado seria mentir; o oposto — fechado sobre aberto — é
    // o que a SPEC chama de defeito. Aqui o texto nomeia o problema e a ação.
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/microfone não abriu/i)
    )
    expect(screen.queryByText(/escuta ligada/i)).not.toBeInTheDocument()
  })

  it('sem modelo pronto, diz que está indisponível e não deixa ligar', async () => {
    estado = { ...LIGADA, ativa: false, disponivel: false }
    const { captura } = montar()

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/indisponível/i))
    expect(screen.getByRole('switch', { name: /escuta/i })).toBeDisabled()
    expect(captura.abrir).not.toHaveBeenCalled()
  })
})

describe('captura e kill switch (critério 8)', () => {
  it('usa o novo ID do mesmo microfone depois que o Windows troca o identificador', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: {
        enumerateDevices: vi.fn(async () => [
          { kind: 'audioinput', deviceId: 'headset-novo', label: 'Headset' }
        ])
      }
    })
    const captura = capturaFalsa()
    render(
      <EscutaDaVoz
        entradaId="headset-2"
        entradaRotulo="Headset"
        aoDisparar={vi.fn()}
        abrirCaptura={captura.abrir}
      />
    )

    await screen.findByText(/escuta ligada/i)
    expect(captura.abrir).toHaveBeenCalledWith('headset-novo', expect.any(Function))
  })

  it('abre o dispositivo escolhido e manda os blocos de áudio ao main', async () => {
    const captura = capturaFalsa()
    montar(captura)
    await screen.findByText(/escuta ligada/i)

    const bloco = new Int16Array(1280)
    captura.bloco(bloco)

    expect(captura.abrir).toHaveBeenCalledWith('headset-2', expect.any(Function))
    expect(enviarPcmDaEscuta).toHaveBeenCalledWith(bloco)
  })

  it('desligar pela tela pede ao main e, quando o estado muda, encerra a captura de fato', async () => {
    const captura = capturaFalsa()
    montar(captura)
    await screen.findByText(/escuta ligada/i)

    await userEvent.click(screen.getByRole('switch', { name: /escuta/i }))
    expect(definirEscutaAtiva).toHaveBeenCalledWith(false)

    estado = { ...LIGADA, ativa: false }
    act(() => avisarMudanca?.(estado))

    await waitFor(() => expect(captura.parar).toHaveBeenCalledTimes(1))
  })

  it('o mute da hotkey, que não passa pela tela, também fecha o microfone', async () => {
    const captura = capturaFalsa()
    montar(captura)
    await screen.findByText(/escuta ligada/i)

    act(() => avisarMudanca?.({ ...LIGADA, ativa: false }))

    await waitFor(() => expect(captura.parar).toHaveBeenCalledTimes(1))
  })

  it('desmontar a tela encerra a captura', async () => {
    const captura = capturaFalsa()
    const { unmount } = montar(captura)
    await screen.findByText(/escuta ligada/i)

    unmount()

    await waitFor(() => expect(captura.parar).toHaveBeenCalledTimes(1))
  })

  it('desligar antes de a captura terminar de abrir não deixa o stream aberto', async () => {
    const captura = capturaFalsa()
    let terminarDeAbrir: (() => void) | undefined
    captura.abrir.mockImplementationOnce(
      () =>
        new Promise((resolver) => {
          terminarDeAbrir = () =>
            resolver({
              parar: captura.parar,
              iniciarTurno: captura.iniciarTurno,
              nivelRms: () => 0
            })
        })
    )
    montar(captura)
    await waitFor(() => expect(captura.abrir).toHaveBeenCalled())

    act(() => avisarMudanca?.({ ...LIGADA, ativa: false }))
    await act(async () => terminarDeAbrir?.())

    // A permissão do microfone pode demorar; o stream que chega depois do pedido de desligar
    // nasce condenado, senão fica aberto sem ninguém para fechá-lo.
    await waitFor(() => expect(captura.parar).toHaveBeenCalledTimes(1))
  })

  it('ligar sem modelo mostra o motivo e não abre captura', async () => {
    estado = { ...LIGADA, ativa: false }
    definirEscutaAtiva.mockResolvedValueOnce({ ok: false, motivo: 'MODELO_AUSENTE' })
    const { captura } = montar()

    await userEvent.click(await screen.findByRole('switch', { name: /escuta/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/modelo/i)
    expect(captura.abrir).not.toHaveBeenCalled()
  })
})

describe('o disparo', () => {
  it('repassa o gatilho e o bloqueio da sessão a quem conduz o turno', async () => {
    const { aoDisparar } = montar()
    await screen.findByText(/escuta ligada/i)

    act(() => avisarDisparo?.({ gatilho: 'palmas', sessaoBloqueada: true }))

    expect(aoDisparar).toHaveBeenCalledWith(
      { gatilho: 'palmas', sessaoBloqueada: true },
      expect.objectContaining({ capturar: expect.any(Function) })
    )
  })
})
