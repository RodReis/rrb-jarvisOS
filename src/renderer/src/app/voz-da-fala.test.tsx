import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PreferenciasDeVoz } from './PreferenciasDeVoz'
import type { PreferencesSnapshot } from '@shared/contracts/ipc'
import type { DesfechoDaFala, ProntidaoDoTts } from '@shared/domain/visemes'

/**
 * A escolha de voz e o preview em Settings (SPEC-Voz-02, critério 5).
 *
 * Ponte por `vi.stubGlobal`, não `defineProperty`: a propriedade definida sobrevive ao
 * `unstubAllGlobals` do vizinho e quebra outro arquivo só no CI.
 *
 * Web Audio não existe no jsdom, então o `AudioContext` é dublado aqui. O que estes testes medem é
 * a **tela** — que o preview aparece, que o erro tem próxima ação, que trocar de voz para a fala.
 * Que o áudio realmente toca e nunca sobrepõe é medido em `reproducao-de-fala.spec.ts`, contando
 * fontes ativas.
 */

const falar = vi.fn()
const prontidaoDoTts = vi.fn()

function prontidao(extra: Partial<ProntidaoDoTts> = {}): ProntidaoDoTts {
  return {
    pronta: true,
    faltando: [],
    vozes: [
      { id: 'pt_BR-faber-medium', rotulo: 'Faber', timeline: 'exato' },
      { id: 'pt_BR-edresson-low', rotulo: 'Edresson', timeline: 'estimado' }
    ],
    ...extra
  }
}

function falaOk(): DesfechoDaFala {
  return {
    estado: 'ok',
    fala: {
      pcm: Int16Array.from({ length: 2205 }, () => 1000),
      sampleRate: 22050,
      visemes: [{ viseme: 'aa', startMs: 0, endMs: 100 }],
      timeline: 'exato'
    }
  }
}

function preferencias(extra: Partial<PreferencesSnapshot> = {}): PreferencesSnapshot {
  return {
    locale: 'pt-BR',
    theme: 'sistema',
    resolvedTheme: 'escuro',
    accentNoa: '#C4C4C4',
    accentJarvis: '#C4C4C4',
    vozModelo: 'small',
    vozIdioma: 'pt',
    vozHotkey: 'Control+Shift+Space',
    vozTimeoutMs: 60_000,
    vozDaFala: 'pt_BR-faber-medium',
    ...extra
  }
}

/** Um `AudioContext` de mentira: o jsdom não tem Web Audio, e o que se mede aqui é a tela. */
function dublarWebAudio(): void {
  vi.stubGlobal(
    'AudioContext',
    class {
      destination = {}
      createBuffer(_canais: number, tamanho: number): { getChannelData: () => Float32Array } {
        return { getChannelData: () => new Float32Array(tamanho) }
      }
      createBufferSource(): Record<string, unknown> {
        return {
          buffer: null,
          onended: null,
          connect: () => {},
          disconnect: () => {},
          start(this: { onended?: () => void }) {
            // Termina sozinho no tick seguinte: sem isto, a promessa `terminou` nunca resolveria
            // e o botão ficaria em "Falando..." para sempre.
            setTimeout(() => this.onended?.(), 0)
          },
          stop: () => {}
        }
      }
      close(): Promise<void> {
        return Promise.resolve()
      }
    }
  )
}

beforeEach(() => {
  falar.mockReset().mockResolvedValue(falaOk())
  prontidaoDoTts.mockReset().mockResolvedValue(prontidao())
  vi.stubGlobal('jarvis', { falar, prontidaoDoTts, sendLog: vi.fn() })
  dublarWebAudio()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Espera o bloco da voz montar.
 *
 * O `Select` do DS é Radix (botão + listbox em portal), não `<select>` nativo: as opções só
 * existem no DOM **depois** de abrir. Esperar pelo combobox é o que há antes disso — e ele só
 * aparece quando a `prontidaoDoTts` responde.
 */
async function esperarOBloco(): Promise<HTMLElement> {
  return screen.findByRole('combobox', { name: /Voz do JARVIS/i })
}

describe('a voz da fala em Settings', () => {
  it('lista as vozes instaladas para escolher', async () => {
    render(<PreferenciasDeVoz preferencias={preferencias()} onSalvar={vi.fn()} />)

    await userEvent.click(await esperarOBloco())

    expect(await screen.findByRole('option', { name: 'Faber' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Edresson' })).toBeInTheDocument()
  })

  it('sem voz baixada, mostra a ação em vez de um seletor vazio', async () => {
    // Oferecer um `Select` sem opção seria pedir uma escolha que não existe — e o usuário não
    // saberia que o que falta é um download.
    prontidaoDoTts.mockResolvedValue(prontidao({ pronta: false, vozes: [] }))

    render(<PreferenciasDeVoz preferencias={preferencias()} onSalvar={vi.fn()} />)

    expect(await screen.findByText(/Baixe uma voz/i)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /Voz do JARVIS/i })).not.toBeInTheDocument()
  })

  it('ouvir manda a frase padrão na voz escolhida', async () => {
    render(
      <PreferenciasDeVoz
        preferencias={preferencias({ vozDaFala: 'pt_BR-edresson-low' })}
        onSalvar={vi.fn()}
      />
    )

    await esperarOBloco()
    await userEvent.click(screen.getByRole('button', { name: /Ouvir/i }))

    expect(falar).toHaveBeenCalledWith(expect.stringContaining('JARVIS'), 'pt_BR-edresson-low')
  })

  it('trocar de voz grava a escolha', async () => {
    const onSalvar = vi.fn()
    render(<PreferenciasDeVoz preferencias={preferencias()} onSalvar={onSalvar} />)

    await userEvent.click(await esperarOBloco())
    await userEvent.click(await screen.findByRole('option', { name: 'Edresson' }))

    expect(onSalvar).toHaveBeenCalledWith({ vozDaFala: 'pt_BR-edresson-low' })
  })

  it('falha de síntese vira mensagem com próxima ação, não silêncio', async () => {
    // O botão voltar ao normal sem nada acontecer seria o pior desfecho: o usuário não saberia se
    // o áudio falhou ou se o alto-falante está mudo.
    falar.mockResolvedValue({ estado: 'falhou', motivo: 'o sidecar caiu' })

    render(<PreferenciasDeVoz preferencias={preferencias()} onSalvar={vi.fn()} />)

    await esperarOBloco()
    await userEvent.click(screen.getByRole('button', { name: /Ouvir/i }))

    expect(await screen.findByText(/Tente de novo/i)).toBeInTheDocument()
  })

  it('voz não baixada e falha de síntese dão mensagens diferentes', async () => {
    // Desfechos diferentes porque as ações são diferentes: um pede **baixar**, o outro pede
    // **tentar de novo**. Fundir os dois daria à primeira execução a ação errada.
    falar.mockResolvedValue({ estado: 'indisponivel' })

    render(<PreferenciasDeVoz preferencias={preferencias()} onSalvar={vi.fn()} />)

    await esperarOBloco()
    await userEvent.click(screen.getByRole('button', { name: /Ouvir/i }))

    expect(await screen.findByText(/Nenhuma voz baixada ainda/i)).toBeInTheDocument()
  })

  it('o botão volta a "Ouvir" quando a fala termina', async () => {
    render(<PreferenciasDeVoz preferencias={preferencias()} onSalvar={vi.fn()} />)

    await esperarOBloco()
    await userEvent.click(screen.getByRole('button', { name: /Ouvir/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /Ouvir/i })).toBeInTheDocument())
  })

  it('o preview não aparece na tela quando não há o que ouvir', async () => {
    prontidaoDoTts.mockResolvedValue(prontidao({ vozes: [] }))

    render(<PreferenciasDeVoz preferencias={preferencias()} onSalvar={vi.fn()} />)

    expect(await screen.findByText(/Baixe uma voz/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ouvir/i })).not.toBeInTheDocument()
  })

  it('os quatro campos da F01 continuam na tela', async () => {
    // A fatia acrescenta um bloco a uma tela que já existia. Este teste é o que acusa se o
    // acréscimo tiver derrubado o que estava lá.
    render(<PreferenciasDeVoz preferencias={preferencias()} onSalvar={vi.fn()} />)

    await esperarOBloco()
    expect(screen.getByRole('combobox', { name: /Modelo/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /Idioma da fala/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /Atalho global/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /Encerrar sozinho/i })).toBeInTheDocument()
  })
})
