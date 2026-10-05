import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReproducaoDasBoasVindas } from '@shared/domain/boas-vindas'
import { instalarReproducaoDasBoasVindas } from './reproducao-das-boas-vindas'
import { criarReprodutor } from './reproducao-de-fala'

vi.mock('./reproducao-de-fala', () => ({ criarReprodutor: vi.fn() }))
vi.mock('./referencia-da-fala', () => ({ iniciarReferenciaDaFala: vi.fn(() => vi.fn()) }))

function ambiente(saidaAplicada: boolean) {
  let listener: ((pedido: ReproducaoDasBoasVindas) => void) | undefined
  let disparar: (() => void) | undefined
  const confirmar = vi.fn()
  const tocar = vi.fn(() => ({
    cancelar: vi.fn(),
    posicaoMs: () => 0,
    nivelRms: () => 0,
    saidaAplicada: Promise.resolve(saidaAplicada),
    terminou: Promise.resolve()
  }))
  vi.mocked(criarReprodutor).mockReturnValue({ tocar, cancelar: vi.fn() })
  Object.assign(window, {
    jarvis: {
      onReproducaoDasBoasVindas: (fn: (pedido: ReproducaoDasBoasVindas) => void) => {
        listener = fn
        return vi.fn()
      },
      onEscutaDisparo: (fn: () => void) => {
        disparar = fn
        return vi.fn()
      },
      informarBoasVindasProntas: vi.fn(),
      confirmarReproducaoDasBoasVindas: confirmar,
      informarFaseDaVoz: vi.fn(),
      estadoDaEscuta: async () => ({ fase: 'escutando', ativa: true }),
      falar: async () => ({
        estado: 'ok',
        fala: { pcm: new Int16Array([1, 2]), sampleRate: 22050, visemes: [] }
      })
    }
  })
  return {
    enviar: (pedido: ReproducaoDasBoasVindas) => listener?.(pedido),
    disparar: () => disparar?.(),
    confirmar,
    tocar
  }
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('reprodução da chegada no dispositivo escolhido', () => {
  it('espera o fim da fala e confirma saída explícita aplicada', async () => {
    const c = ambiente(true)
    const remover = instalarReproducaoDasBoasVindas('voz-padrao', 'headset-g432')
    c.enviar({ id: 'chegada-1', acao: 'fala', texto: 'Bom dia.' })
    await vi.waitFor(() => expect(c.confirmar).toHaveBeenCalledWith('chegada-1', true))
    expect(c.tocar).toHaveBeenCalledWith(
      expect.objectContaining({ sampleRate: 22050 }),
      'headset-g432'
    )
    remover()
  })

  it('recusa fallback silencioso para o dispositivo padrão', async () => {
    const c = ambiente(false)
    const remover = instalarReproducaoDasBoasVindas('voz-padrao', 'headset-g432')
    c.enviar({ id: 'chegada-2', acao: 'fala', texto: 'Bom dia.' })
    await vi.waitFor(() => expect(c.confirmar).toHaveBeenCalledWith('chegada-2', false))
    remover()
  })

  it('não fala sobre um turno iniciado antes da reprodução', async () => {
    const c = ambiente(true)
    vi.spyOn(window.jarvis, 'estadoDaEscuta').mockResolvedValue({
      fase: 'gravando',
      ativa: true
    } as never)
    const remover = instalarReproducaoDasBoasVindas('voz-padrao')
    c.enviar({ id: 'chegada-turno', acao: 'fala', texto: 'Bom dia.' })
    await vi.waitFor(() => expect(c.confirmar).toHaveBeenCalledWith('chegada-turno', false))
    expect(c.tocar).not.toHaveBeenCalled()
    remover()
  })

  it('recusa saudação se o usuário disparou a escuta durante a síntese', async () => {
    const c = ambiente(true)
    let liberar: ((valor: unknown) => void) | undefined
    vi.spyOn(window.jarvis, 'falar').mockImplementationOnce(
      () => new Promise((resolve) => (liberar = resolve)) as never
    )
    const remover = instalarReproducaoDasBoasVindas('voz-padrao')
    c.enviar({ id: 'chegada-interrompida', acao: 'fala', texto: 'Bom dia.' })
    await vi.waitFor(() => expect(window.jarvis.falar).toHaveBeenCalledOnce())
    c.disparar()
    liberar?.({ estado: 'ok', fala: { pcm: new Int16Array([1]), sampleRate: 22050 } })
    await vi.waitFor(() => expect(c.confirmar).toHaveBeenCalledWith('chegada-interrompida', false))
    expect(c.tocar).not.toHaveBeenCalled()
    remover()
  })

  it('inicia a mídia local na mesma saída escolhida depois da saudação', async () => {
    const c = ambiente(true)
    const setSinkId = vi.fn().mockResolvedValue(undefined)
    const play = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal(
      'Audio',
      class {
        setSinkId = setSinkId
        play = play
        pause = vi.fn()
        onended: (() => void) | null = null
        onerror: (() => void) | null = null
      }
    )
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:chegada'),
      revokeObjectURL: vi.fn()
    })
    const remover = instalarReproducaoDasBoasVindas('voz-padrao', 'headset-g432')
    c.enviar({ id: 'chegada-3', acao: 'midia', dados: new Uint8Array([1, 2]), tipo: 'audio/wav' })
    await vi.waitFor(() => expect(c.confirmar).toHaveBeenCalledWith('chegada-3', true))
    expect(setSinkId).toHaveBeenCalledWith('headset-g432')
    expect(play).toHaveBeenCalledOnce()
    remover()
  })
})
