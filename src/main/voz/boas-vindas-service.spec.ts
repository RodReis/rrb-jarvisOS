import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BoasVindasService,
  type ConfiguracaoDasBoasVindas,
  type DepsDasBoasVindas,
  type EstadoDasBoasVindas
} from './boas-vindas-service'

const CONFIG: ConfiguracaoDasBoasVindas = {
  ativa: true,
  janelaInicio: 6 * 60,
  janelaFim: 23 * 60,
  tetoDaPersonaMs: 100,
  frases: { manha: 'Bom dia.', tarde: 'Boa tarde.', noite: 'Boa noite.' },
  midiaAtiva: true,
  midia: { tipo: 'arquivo', caminho: 'C:\\musica.mp3' }
}

function cenario() {
  let instante = new Date(2026, 9, 5, 8, 0)
  let estado: EstadoDasBoasVindas = {}
  let config = CONFIG
  let escutaAtiva = true
  let audioAtivo: boolean | undefined = false
  const ordem: string[] = []
  const gerarSaudacao = vi.fn(
    async (_hora: Date, _ausencia: number | null, _signal: AbortSignal) => 'Olá, Rodrigo.'
  )
  const falar = vi.fn(async (texto: string) => {
    ordem.push(`fala:${texto}`)
  })
  const tocarMidia = vi.fn(async () => {
    ordem.push('mídia')
  })
  const publicar = vi.fn((evento: unknown) => {
    ordem.push('evento')
    return evento
  })
  const deps: DepsDasBoasVindas = {
    agora: () => instante,
    configuracao: () => config,
    escutaAtiva: () => escutaAtiva,
    audioAtivo: async () => audioAtivo,
    estado: {
      ler: () => estado,
      gravar: (novo) => {
        estado = novo
      }
    },
    gerarSaudacao,
    falar,
    tocarMidia,
    publicar
  }
  return {
    service: new BoasVindasService(deps),
    gerarSaudacao,
    falar,
    tocarMidia,
    publicar,
    ordem,
    get estado() {
      return estado
    },
    set estado(novo: EstadoDasBoasVindas) {
      estado = novo
    },
    set instante(novo: Date) {
      instante = novo
    },
    set config(novo: ConfiguracaoDasBoasVindas) {
      config = novo
    },
    set escutaAtiva(novo: boolean) {
      escutaAtiva = novo
    },
    set audioAtivo(novo: boolean | undefined) {
      audioAtivo = novo
    }
  }
}

afterEach(() => vi.useRealTimers())

describe('BoasVindasService', () => {
  it('saúda no primeiro desbloqueio local, não no segundo, e volta no dia seguinte', async () => {
    const c = cenario()
    expect(await c.service.desbloqueou()).toBe('saudou')
    expect(await c.service.desbloqueou()).toBe('ignorado')
    c.instante = new Date(2026, 9, 6, 8, 0)
    expect(await c.service.desbloqueou()).toBe('saudou')
    expect(c.falar).toHaveBeenCalledTimes(2)
    expect(c.gerarSaudacao.mock.calls[1]?.[1]).toBe(24 * 60 * 60 * 1000)
  })

  it('enfileira voz antes da mídia e publica hora e ausência sem consumidor', async () => {
    const c = cenario()
    await c.service.desbloqueou()
    expect(c.ordem).toEqual(['fala:Olá, Rodrigo.', 'evento', 'mídia'])
    expect(c.gerarSaudacao.mock.calls[0]?.[0]).toEqual(new Date(2026, 9, 5, 8, 0))
    expect(c.gerarSaudacao.mock.calls[0]?.[1]).toBeNull()
    expect(c.publicar).toHaveBeenCalledWith({
      tipo: 'boas-vindas',
      hora: new Date(2026, 9, 5, 8, 0).toISOString(),
      ausenciaMs: null
    })
  })

  it.each(['modo', 'janela', 'kill-switch', 'audio', 'audio-indeterminado'] as const)(
    'não fala nem toca mídia sob a guarda %s',
    async (guarda) => {
      const c = cenario()
      if (guarda === 'modo') c.config = { ...CONFIG, ativa: false }
      if (guarda === 'janela') c.instante = new Date(2026, 9, 5, 3, 0)
      if (guarda === 'kill-switch') c.escutaAtiva = false
      if (guarda === 'audio') c.audioAtivo = true
      if (guarda === 'audio-indeterminado') c.audioAtivo = undefined
      expect(await c.service.desbloqueou()).toBe('ignorado')
      expect(c.gerarSaudacao).not.toHaveBeenCalled()
      expect(c.falar).not.toHaveBeenCalled()
      expect(c.tocarMidia).not.toHaveBeenCalled()
      expect(c.publicar).not.toHaveBeenCalled()
    }
  )

  it('obedece ao desligar da mídia sem desligar a saudação', async () => {
    const c = cenario()
    c.config = { ...CONFIG, midiaAtiva: false }
    expect(await c.service.desbloqueou()).toBe('saudou')
    expect(c.falar).toHaveBeenCalledOnce()
    expect(c.tocarMidia).not.toHaveBeenCalled()
  })

  it('respeita o teto por período mesmo se o marcador do dia divergir', async () => {
    const c = cenario()
    c.estado = { ultimoPeriodoSaudado: '2026-10-05:manha' }
    expect(await c.service.desbloqueou()).toBe('ignorado')
    expect(c.falar).not.toHaveBeenCalled()
  })

  it('recusa falar quando outro áudio começa durante a geração', async () => {
    const c = cenario()
    let liberar: ((texto: string) => void) | undefined
    c.gerarSaudacao.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          liberar = resolve
        })
    )
    const desfecho = c.service.desbloqueou()
    // A primeira consulta ocorre antes da geração.
    await Promise.resolve()
    c.audioAtivo = true
    liberar?.('Olá.')
    expect(await desfecho).toBe('ignorado')
    expect(c.falar).not.toHaveBeenCalled()
    expect(c.publicar).not.toHaveBeenCalled()
  })

  it('usa frase fixa se a persona falha ou devolve texto vazio', async () => {
    const c = cenario()
    c.gerarSaudacao.mockRejectedValueOnce(new Error('Ollama fora'))
    await c.service.desbloqueou()
    expect(c.falar).toHaveBeenCalledWith('Bom dia.')
    c.instante = new Date(2026, 9, 6, 8, 0)
    c.gerarSaudacao.mockResolvedValueOnce('  ')
    await c.service.desbloqueou()
    expect(c.falar).toHaveBeenLastCalledWith('Bom dia.')
  })

  it('usa frase fixa no timeout e ignora resposta tardia', async () => {
    vi.useFakeTimers()
    const c = cenario()
    c.gerarSaudacao.mockImplementationOnce(async () => new Promise(() => undefined))
    const desfecho = c.service.desbloqueou()
    await vi.advanceTimersByTimeAsync(100)
    expect(await desfecho).toBe('saudou')
    expect(c.falar).toHaveBeenCalledExactlyOnceWith('Bom dia.')
  })

  it('reserva o dia antes de gerar e recusa desbloqueio concorrente', async () => {
    const c = cenario()
    let liberar: ((texto: string) => void) | undefined
    c.gerarSaudacao.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          liberar = resolve
        })
    )
    const primeiro = c.service.desbloqueou()
    expect(await c.service.desbloqueou()).toBe('ignorado')
    liberar?.('Olá.')
    expect(await primeiro).toBe('saudou')
    expect(c.falar).toHaveBeenCalledOnce()
  })
})
