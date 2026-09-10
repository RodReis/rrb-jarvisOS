import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Microfone } from './Microfone'
import type { CapturaDeAudio } from './captura-de-audio'

/**
 * As ondas do Command Center (SPEC-Voz-05, critério 8).
 *
 * ## O que este arquivo prende, e por que não bastava afirmar o atributo
 *
 * `data-fonte-da-onda` diz de onde o desenho vem. Afirmá-lo sozinho seria medir o rótulo, não o
 * dado: a primeira versão desta fatia declarava `saida` durante a fala e desenhava, nas duas
 * situações, o RMS **do microfone** — o atributo estava certo e a onda mentia. É o mesmo vício
 * que o invariante do épico proíbe no lip-sync, mudado de lugar.
 *
 * Por isso cada teste cruza as duas fontes: a que deveria alimentar o desenho leva um nível
 * alto, a outra fica muda, e o que se afirma é a **altura das barras**. Trocar a fonte no
 * componente reprova, porque a fonte errada está em zero.
 *
 * As alturas: em repouso as barras valem 4px; com áudio ativo o piso é 8px (`Math.max(8, …)`),
 * e é por isso que o limite afirmado aqui é 20 e não 4 — 8px é o que sai quando a fonte lida
 * está muda, ou seja, exatamente o defeito. Com a fonte certa o valor satura em 54.
 */

const transcreverAudio = vi.fn()
const prontidaoDaVoz = vi.fn()
const baixarArtefatoDeVoz = vi.fn()
const perguntarAoJarvis = vi.fn()
const historicoDaConversa = vi.fn()
const falar = vi.fn()
const onVozHotkey = vi.fn(() => () => {})

/** Medidor de entrada mudo: qualquer altura acima do piso terá vindo da outra fonte. */
const medidorMudo = async (): Promise<{ nivelRms: () => number; parar: () => Promise<void> }> => ({
  nivelRms: () => 0,
  parar: async () => {}
})

/** Captura que anuncia um nível fixo — é ela quem alimenta as ondas durante `gravando`. */
function capturaComNivel(nivel: number): CapturaDeAudio {
  return async (_deviceId, onNivelRms) => {
    onNivelRms?.(nivel)
    return async () => new Int16Array(16_000)
  }
}

/** Fala que não termina: segura a tela em `falando` para a asserção acontecer. */
function falaPresa(nivelDaFala: number) {
  return () => ({
    tocar: () => ({
      terminou: new Promise<void>(() => {}),
      cancelar: () => {},
      posicaoMs: () => 0,
      saidaAplicada: Promise.resolve(true),
      nivelRms: () => nivelDaFala
    }),
    cancelar: () => {}
  })
}

const falaMuda = falaPresa(0)

beforeEach(() => {
  transcreverAudio.mockReset().mockResolvedValue({
    estado: 'ok',
    resultado: { texto: 'oi', idioma: 'pt', segmentos: [] }
  })
  prontidaoDaVoz.mockReset().mockResolvedValue({ pronta: true, faltando: [], compute: 'cuda' })
  baixarArtefatoDeVoz.mockReset().mockResolvedValue({ estado: 'ok' })
  perguntarAoJarvis.mockReset().mockResolvedValue({ estado: 'ok', resposta: 'Dois aguardando.' })
  historicoDaConversa.mockReset().mockResolvedValue([])
  falar.mockReset().mockResolvedValue({ estado: 'indisponivel' })
  onVozHotkey.mockClear()
  vi.stubGlobal('jarvis', {
    transcreverAudio,
    prontidaoDaVoz,
    baixarArtefatoDeVoz,
    perguntarAoJarvis,
    historicoDaConversa,
    falar,
    onVozHotkey,
    sendLog: vi.fn()
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function montar({
  capturar = capturaComNivel(0),
  criarFala = falaMuda
}: {
  capturar?: CapturaDeAudio
  criarFala?: unknown
} = {}): void {
  render(
    <Microfone
      workspace="jarvis"
      vozDaFala="pt_BR-faber-medium"
      entradaId="microfone-teste"
      entradaRotulo="Headset de teste"
      capturar={capturar}
      criarFala={criarFala as never}
      criarMedidor={medidorMudo}
    />
  )
}

function ondas(): HTMLElement {
  return screen.getByLabelText(/nivel do audio/i)
}

function alturaDaPrimeiraBarra(): number {
  const barra = ondas().querySelector<HTMLElement>('[data-barra-da-onda]')
  return Number.parseFloat(barra?.style.height ?? '0')
}

describe('as ondas do Command Center seguem a fonte certa (SPEC-Voz-05, critério 8)', () => {
  it('em repouso não anuncia captação nem saída, e as barras ficam no piso', async () => {
    montar()
    await screen.findByRole('button', { name: /segure para falar/i })

    expect(ondas()).toHaveAttribute('data-fonte-da-onda', 'repouso')
    await waitFor(() => expect(alturaDaPrimeiraBarra()).toBeLessThanOrEqual(4))
  })

  it('gravando desenha a entrada — o nível vem da captura', async () => {
    montar({ capturar: capturaComNivel(12_000) })

    const botao = await screen.findByRole('button', { name: /segure para falar/i })
    await userEvent.pointer({ keys: '[MouseLeft>]', target: botao })
    await screen.findByRole('button', { name: /ouvindo/i })

    expect(ondas()).toHaveAttribute('data-fonte-da-onda', 'entrada')
    // O medidor de entrada está mudo: passar do piso só é possível lendo a captura.
    await waitFor(() => expect(alturaDaPrimeiraBarra()).toBeGreaterThan(20))
  })

  it('falando desenha a saída — o nível vem da fala, com o microfone mudo', async () => {
    falar.mockResolvedValue({
      estado: 'ok',
      fala: { pcm: new Int16Array(8), sampleRate: 22_050, visemes: [] }
    })
    montar({ capturar: capturaComNivel(0), criarFala: falaPresa(9_000) })

    const botao = await screen.findByRole('button', { name: /segure para falar/i })
    await userEvent.pointer([{ keys: '[MouseLeft>]', target: botao }, { keys: '[/MouseLeft]' }])
    await screen.findByRole('button', { name: /falando/i })

    expect(ondas()).toHaveAttribute('data-fonte-da-onda', 'saida')
    /*
     * O contrafactual do critério: ler a entrada aqui devolveria o piso, porque a captura e o
     * medidor estão os dois em zero. Só a fala tem sinal.
     */
    await waitFor(() => expect(alturaDaPrimeiraBarra()).toBeGreaterThan(20))
  })
})
