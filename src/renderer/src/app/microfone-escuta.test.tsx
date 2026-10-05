import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Microfone } from './Microfone'
import type { DisparoRecebido } from './EscutaDaVoz'

/**
 * O turno aberto pela escuta no Command Center (SPEC-Escuta-01, critérios 6, 7 e 13).
 *
 * O que estes testes prendem é a costura do disparo: o gatilho começa a gravar **sem botão**, o
 * silêncio devolve a tela a `ocioso` **sem chamar a IA**, e a tela avisa o main de quando o turno
 * começa e termina (senão a escuta abriria um segundo turno por cima, ou ficaria surda).
 */

const transcreverAudio = vi.fn()
const perguntarAoJarvis = vi.fn()
const informarTurnoDaEscuta = vi.fn()
const falar = vi.fn()

const DISPARO: Omit<DisparoRecebido, 'capturaDoTurno'> = {
  id: 1,
  gatilho: 'frase',
  sessaoBloqueada: false
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  transcreverAudio.mockReset().mockResolvedValue({
    estado: 'ok',
    resultado: { texto: 'que horas são?', idioma: 'pt', segmentos: [] }
  })
  perguntarAoJarvis.mockReset().mockResolvedValue({ estado: 'ok', resposta: 'Dez horas.' })
  informarTurnoDaEscuta.mockReset()
  falar.mockReset().mockResolvedValue({ estado: 'indisponivel' })
  vi.stubGlobal('jarvis', {
    transcreverAudio,
    prontidaoDaVoz: vi.fn().mockResolvedValue({ pronta: true, faltando: [], compute: 'cuda' }),
    baixarArtefatoDeVoz: vi.fn(),
    perguntarAoJarvis,
    historicoDaConversa: vi.fn().mockResolvedValue([]),
    falar,
    informarTurnoDaEscuta,
    onVozHotkey: vi.fn(() => () => {}),
    sendLog: vi.fn()
  })
})

afterEach(() => {
  // Desmonta antes de tirar a ponte: o desmonte ainda avisa o main de que o turno acabou.
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Uma captura cujo nível o teste conduz, e que registra o encerramento. */
function capturaConduzida() {
  let nivel: ((n: number) => void) | undefined
  const encerrar = vi.fn(async () => new Int16Array(16_000))
  const capturar = vi.fn(async (_id?: string, aoNivel?: (n: number) => void) => {
    nivel = aoNivel
    return encerrar
  })
  return { capturar, encerrar, nivel: (n: number) => nivel?.(n) }
}

const reprodutorFalso = () => ({
  tocar: () => ({
    terminou: Promise.resolve(),
    cancelar: () => {},
    posicaoMs: () => Number.MAX_SAFE_INTEGER,
    saidaAplicada: Promise.resolve(true),
    nivelRms: () => 0
  }),
  cancelar: () => {}
})

function montar(
  captura: ReturnType<typeof capturaConduzida>,
  disparo?: Omit<DisparoRecebido, 'capturaDoTurno'>,
  criarFala: typeof reprodutorFalso = reprodutorFalso
) {
  const aoTratarDisparo = vi.fn()
  const capturarPushToTalk = vi.fn(async () => {
    throw new Error('O turno da escuta não pode abrir um segundo microfone.')
  })
  const resultado = render(
    <Microfone
      workspace="jarvis"
      vozDaFala="pt_BR-faber-medium"
      entradaId="microfone-teste"
      capturar={capturarPushToTalk}
      criarFala={criarFala as never}
      criarMedidor={async () => ({ nivelRms: () => 0, parar: async () => {} })}
      disparo={
        disparo
          ? { ...disparo, capturaDoTurno: { capturar: captura.capturar, cancelar: vi.fn() } }
          : undefined
      }
      aoTratarDisparo={aoTratarDisparo}
    />
  )
  return { ...resultado, aoTratarDisparo, capturarPushToTalk, criarFala }
}

/** Avança o relógio em passos de 250 ms, o ritmo com que a captura mede o nível. */
async function passar(ms: number, nivel: () => void = () => {}): Promise<void> {
  for (let t = 0; t < ms; t += 250) {
    nivel()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
  }
}

describe('o disparo começa o turno sem botão', () => {
  it('grava assim que o disparo chega, e o consome para não repetir', async () => {
    const captura = capturaConduzida()
    const { aoTratarDisparo, capturarPushToTalk } = montar(captura, DISPARO)

    await screen.findByRole('button', { name: /ouvindo/i })

    expect(captura.capturar).toHaveBeenCalledTimes(1)
    expect(capturarPushToTalk).not.toHaveBeenCalled()
    expect(aoTratarDisparo).toHaveBeenCalledWith(1)
  })

  it('sem disparo, a tela não abre o microfone sozinha', async () => {
    const captura = capturaConduzida()
    montar(captura, undefined)
    await screen.findByRole('button', { name: /segure para falar/i })

    expect(captura.capturar).not.toHaveBeenCalled()
  })

  it('avisa o main quando o turno começa e quando termina', async () => {
    const captura = capturaConduzida()
    montar(captura, DISPARO)
    await screen.findByRole('button', { name: /ouvindo/i })
    await waitFor(() => expect(informarTurnoDaEscuta).toHaveBeenLastCalledWith(true))

    await passar(1_000, () => captura.nivel(3_000))
    await passar(2_000, () => captura.nivel(100))

    await screen.findByRole('button', { name: /segure para falar/i }, { timeout: 5_000 })
    expect(informarTurnoDaEscuta).toHaveBeenLastCalledWith(false)
  })
})

describe('posse compartilhada do microfone (SPEC-Escuta-02, critério 1)', () => {
  it('aguarda a decisão inicial da escuta antes de pedir permissão', async () => {
    const abrirStream = vi.fn()
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: {
        getUserMedia: abrirStream,
        enumerateDevices: vi.fn(async () => [])
      }
    })
    render(
      <Microfone
        workspace="jarvis"
        vozDaFala="pt_BR-faber-medium"
        entradaId="microfone-teste"
        escutaAtiva={null}
        criarFala={reprodutorFalso as never}
      />
    )
    await screen.findByRole('button', { name: /segure para falar/i })
    expect(abrirStream).not.toHaveBeenCalled()
  })

  it('push-to-talk usa o stream da escuta sem abrir segunda captura', async () => {
    const captura = capturaConduzida()
    const capturarSeparado = vi.fn(async () => {
      throw new Error('Segundo getUserMedia proibido')
    })
    const iniciarTurno = vi.fn(() => ({ capturar: captura.capturar, cancelar: vi.fn() }))
    render(
      <Microfone
        workspace="jarvis"
        vozDaFala="pt_BR-faber-medium"
        entradaId="microfone-teste"
        capturaCompartilhada={{ iniciarTurno, nivelRms: () => 0, parar: async () => {} }}
        escutaAtiva
        capturar={capturarSeparado}
        criarFala={reprodutorFalso as never}
        criarMedidor={async () => {
          throw new Error('Medidor abriu segundo getUserMedia')
        }}
      />
    )
    const botao = await screen.findByRole('button', { name: /segure para falar/i })
    fireEvent.pointerDown(botao, { pointerId: 1 })
    await waitFor(() => expect(captura.capturar).toHaveBeenCalledTimes(1))
    expect(iniciarTurno).toHaveBeenCalledWith(false)
    expect(capturarSeparado).not.toHaveBeenCalled()
    fireEvent.pointerUp(botao)
    await waitFor(() => expect(captura.encerrar).toHaveBeenCalledTimes(1))
  })
})

describe('teto de gravação (SPEC-Escuta-02, critério 8)', () => {
  it('encerra o turno aberto por voz no teto configurado mesmo com fala contínua', async () => {
    const captura = capturaConduzida()
    render(
      <Microfone
        workspace="jarvis"
        vozDaFala="pt_BR-faber-medium"
        entradaId="microfone-teste"
        vozTimeoutMs={2_000}
        capturar={async () => {
          throw new Error('Segundo microfone proibido')
        }}
        criarFala={reprodutorFalso as never}
        criarMedidor={async () => ({ nivelRms: () => 0, parar: async () => {} })}
        disparo={{ ...DISPARO, capturaDoTurno: { capturar: captura.capturar, cancelar: vi.fn() } }}
      />
    )
    await screen.findByRole('button', { name: /ouvindo/i })
    await passar(2_250, () => captura.nivel(3_000))
    await waitFor(() => expect(captura.encerrar).toHaveBeenCalledTimes(1))
  })

  it('encerra o push-to-talk no mesmo teto configurado', async () => {
    const captura = capturaConduzida()
    render(
      <Microfone
        workspace="jarvis"
        vozDaFala="pt_BR-faber-medium"
        entradaId="microfone-teste"
        vozTimeoutMs={2_000}
        capturar={captura.capturar}
        criarFala={reprodutorFalso as never}
        criarMedidor={async () => ({ nivelRms: () => 0, parar: async () => {} })}
      />
    )
    const botao = await screen.findByRole('button', { name: /segure para falar/i })
    fireEvent.pointerDown(botao, { pointerId: 1 })
    await waitFor(() => expect(captura.capturar).toHaveBeenCalledTimes(1))
    await passar(2_250, () => captura.nivel(3_000))
    await waitFor(() => expect(captura.encerrar).toHaveBeenCalledTimes(1))
  })
})

describe('barge-in (SPEC-Escuta-02, critério 4)', () => {
  it('novo disparo durante a fala para a fonte de áudio e abre novo turno', async () => {
    const captura = capturaConduzida()
    const pararFonte = vi.fn()
    let resolverFim: (() => void) | undefined
    const terminou = new Promise<void>((resolver) => {
      resolverFim = resolver
    })
    const cancelar = vi.fn(() => {
      pararFonte()
      resolverFim?.()
    })
    const criarFala = () => ({
      cancelar,
      tocar: () => ({
        cancelar,
        terminou,
        posicaoMs: () => 0,
        saidaAplicada: Promise.resolve(true),
        nivelRms: () => 0
      })
    })
    falar.mockResolvedValue({
      estado: 'ok',
      fala: { pcm: new Int16Array(22_050), sampleRate: 22_050, visemes: [], timeline: 'estimado' }
    })
    const segundoCaptura = capturaConduzida()
    const segundo = {
      ...DISPARO,
      id: 2,
      fimDoGatilhoMs: Date.now() - 250,
      capturaDoTurno: { capturar: segundoCaptura.capturar, cancelar: vi.fn() }
    }
    const { rerender, aoTratarDisparo, capturarPushToTalk } = montar(captura, DISPARO, criarFala)
    await screen.findByRole('button', { name: /ouvindo/i })
    await passar(1_000, () => captura.nivel(3_000))
    await passar(2_000, () => captura.nivel(100))
    await waitFor(() => expect(falar).toHaveBeenCalled())

    rerender(
      <Microfone
        workspace="jarvis"
        vozDaFala="pt_BR-faber-medium"
        entradaId="microfone-teste"
        capturar={capturarPushToTalk}
        criarFala={criarFala as never}
        criarMedidor={async () => ({ nivelRms: () => 0, parar: async () => {} })}
        disparo={segundo}
        aoTratarDisparo={aoTratarDisparo}
      />
    )
    await waitFor(() => expect(segundoCaptura.capturar).toHaveBeenCalledTimes(1))
    expect(pararFonte).toHaveBeenCalledTimes(1)
    expect(window.jarvis.sendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'Fala interrompida por barge-in',
        ctx: expect.objectContaining({ latenciaBargeInMs: expect.any(Number) })
      })
    )
    expect(screen.getByText(/Fala interrompida por um novo pedido/i)).toBeInTheDocument()
  })
})

describe('silêncio após o disparo (critério 13)', () => {
  it('sem fala em 3 s volta a ocioso sem transcrever nem chamar a IA', async () => {
    const captura = capturaConduzida()
    montar(captura, DISPARO)
    await screen.findByRole('button', { name: /ouvindo/i })

    await passar(3_500, () => captura.nivel(100))

    await screen.findByRole('button', { name: /segure para falar/i })
    expect(screen.getByText(/gatilho detectado, mas não ouvi uma pergunta/i)).toBeInTheDocument()
    // A captura é encerrada (o microfone fecha), e nada vai ao STT nem ao ponto único de IA.
    expect(captura.encerrar).toHaveBeenCalledTimes(1)
    expect(transcreverAudio).not.toHaveBeenCalled()
    expect(perguntarAoJarvis).not.toHaveBeenCalled()
  })

  it('com fala e depois silêncio, transcreve e pergunta', async () => {
    const captura = capturaConduzida()
    montar(captura, DISPARO)
    await screen.findByRole('button', { name: /ouvindo/i })

    await passar(1_000, () => captura.nivel(3_000))
    await passar(2_000, () => captura.nivel(100))

    await waitFor(() => expect(transcreverAudio).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(perguntarAoJarvis).toHaveBeenCalledWith('que horas são?', 'jarvis'))
  })
})

describe('a sessão bloqueada responde só por voz (critério 7)', () => {
  it('o turno corre igual: o que muda — a janela não sobe — é decidido no main', async () => {
    const captura = capturaConduzida()
    montar(captura, { ...DISPARO, sessaoBloqueada: true })

    await screen.findByRole('button', { name: /ouvindo/i })
    await passar(1_000, () => captura.nivel(3_000))
    await passar(2_000, () => captura.nivel(100))

    // A resposta é falada pelo mesmo caminho do push-to-talk; sem janela, a fala é a resposta.
    await waitFor(() => expect(falar).toHaveBeenCalledWith('Dez horas.', 'pt_BR-faber-medium'))
  })
})

describe('disparo com a voz ainda não pronta', () => {
  it('não grava, explica a próxima ação e libera o main do turno que não vai acontecer', async () => {
    vi.mocked(window.jarvis.prontidaoDaVoz).mockResolvedValue({
      pronta: false,
      faltando: ['modelo/model.bin'],
      compute: 'cpu-int8'
    })
    const captura = capturaConduzida()
    const { aoTratarDisparo } = montar(captura, DISPARO)

    // Sem runtime não há como transcrever: gravar abriria o microfone para nada, e o main ficaria
    // ignorando gatilhos até o teto do turno.
    await waitFor(() => expect(informarTurnoDaEscuta).toHaveBeenCalledWith(false))
    expect(captura.capturar).not.toHaveBeenCalled()
    expect(aoTratarDisparo).toHaveBeenCalledWith(1)
    expect(await screen.findByText(/a voz ainda não está pronta/i)).toBeInTheDocument()
  })
})
