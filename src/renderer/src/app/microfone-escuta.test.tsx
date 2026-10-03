import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
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

const DISPARO: DisparoRecebido = { id: 1, gatilho: 'frase', sessaoBloqueada: false }

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

function montar(captura: ReturnType<typeof capturaConduzida>, disparo?: DisparoRecebido) {
  const aoTratarDisparo = vi.fn()
  const resultado = render(
    <Microfone
      workspace="jarvis"
      vozDaFala="pt_BR-faber-medium"
      entradaId="microfone-teste"
      capturar={captura.capturar}
      criarFala={reprodutorFalso as never}
      criarMedidor={async () => ({ nivelRms: () => 0, parar: async () => {} })}
      disparo={disparo}
      aoTratarDisparo={aoTratarDisparo}
    />
  )
  return { ...resultado, aoTratarDisparo }
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
    const { aoTratarDisparo } = montar(captura, DISPARO)

    await screen.findByRole('button', { name: /ouvindo/i })

    expect(captura.capturar).toHaveBeenCalledTimes(1)
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
    expect(informarTurnoDaEscuta).toHaveBeenLastCalledWith(true)

    await passar(1_000, () => captura.nivel(3_000))
    await passar(2_000, () => captura.nivel(100))

    await screen.findByRole('button', { name: /segure para falar/i }, { timeout: 5_000 })
    expect(informarTurnoDaEscuta).toHaveBeenLastCalledWith(false)
  })
})

describe('silêncio após o disparo (critério 13)', () => {
  it('sem fala em 3 s volta a ocioso sem transcrever nem chamar a IA', async () => {
    const captura = capturaConduzida()
    montar(captura, DISPARO)
    await screen.findByRole('button', { name: /ouvindo/i })

    await passar(3_500, () => captura.nivel(100))

    await screen.findByRole('button', { name: /segure para falar/i })
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
