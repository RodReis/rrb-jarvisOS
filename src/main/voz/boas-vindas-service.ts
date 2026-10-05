/** Decisão e sequência da chegada (SPEC-Escuta-03). Nenhuma entrada vem de transcrição. */
import type {
  ConfiguracaoDasBoasVindas,
  EstadoDasBoasVindas,
  EventoBoasVindas
} from '@shared/domain/boas-vindas'
export type { ConfiguracaoDasBoasVindas, EstadoDasBoasVindas, EventoBoasVindas }

export interface DepsDasBoasVindas {
  readonly agora: () => Date
  readonly configuracao: () => ConfiguracaoDasBoasVindas
  readonly escutaAtiva: () => boolean
  /** `undefined` significa que não foi possível provar silêncio no sistema. */
  readonly audioAtivo: () => Promise<boolean | undefined>
  readonly estado: {
    readonly ler: () => EstadoDasBoasVindas
    readonly gravar: (estado: EstadoDasBoasVindas) => void
  }
  readonly gerarSaudacao: (
    hora: Date,
    ausenciaMs: number | null,
    signal: AbortSignal
  ) => Promise<string>
  readonly falar: (texto: string) => Promise<void>
  readonly tocarMidia: () => Promise<void>
  readonly publicar: (evento: EventoBoasVindas) => void
  readonly agendar?: (acao: () => void, ms: number) => ReturnType<typeof setTimeout>
  readonly cancelar?: (relogio: ReturnType<typeof setTimeout>) => void
}

function diaLocal(data: Date): string {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
}

function periodo(data: Date): 'manha' | 'tarde' | 'noite' {
  const hora = data.getHours()
  return hora < 12 ? 'manha' : hora < 18 ? 'tarde' : 'noite'
}

function dentroDaJanela(config: ConfiguracaoDasBoasVindas, data: Date): boolean {
  const minuto = data.getHours() * 60 + data.getMinutes()
  if (config.janelaInicio <= config.janelaFim) {
    return minuto >= config.janelaInicio && minuto < config.janelaFim
  }
  return minuto >= config.janelaInicio || minuto < config.janelaFim
}

export class BoasVindasService {
  private emAndamento = false

  constructor(private readonly deps: DepsDasBoasVindas) {}

  async desbloqueou(): Promise<'saudou' | 'ignorado'> {
    if (this.emAndamento) return 'ignorado'
    this.emAndamento = true
    try {
      const agora = this.deps.agora()
      const dia = diaLocal(agora)
      const estado = this.deps.estado.ler()
      if (estado.ultimoDiaDesbloqueado === dia) return 'ignorado'

      const ausenciaMs =
        estado.ultimoDesbloqueioMs === undefined
          ? null
          : Math.max(0, agora.getTime() - estado.ultimoDesbloqueioMs)
      this.deps.estado.gravar({
        ...estado,
        ultimoDiaDesbloqueado: dia,
        ultimoDesbloqueioMs: agora.getTime()
      })

      const config = this.deps.configuracao()
      const chaveDoPeriodo = `${dia}:${periodo(agora)}`
      if (
        !config.ativa ||
        !dentroDaJanela(config, agora) ||
        !this.deps.escutaAtiva() ||
        estado.ultimoPeriodoSaudado === chaveDoPeriodo
      ) {
        return 'ignorado'
      }
      // Uma falha da consulta nativa não é prova de silêncio. Não interromper uma chamada vence.
      if ((await this.deps.audioAtivo()) !== false) return 'ignorado'

      const fraseFixa = config.frases[periodo(agora)]
      const saudacao = await this.saudarComTeto(
        agora,
        ausenciaMs,
        config.tetoDaPersonaMs,
        fraseFixa
      )
      // A geração pode levar segundos. Uma chamada iniciada nesse intervalo também vence.
      if ((await this.deps.audioAtivo()) !== false || !this.deps.escutaAtiva()) return 'ignorado'
      await this.deps.falar(saudacao)
      this.deps.estado.gravar({
        ...this.deps.estado.ler(),
        ultimoPeriodoSaudado: chaveDoPeriodo
      })
      this.deps.publicar({
        tipo: 'boas-vindas',
        hora: agora.toISOString(),
        ausenciaMs
      })
      if (config.midiaAtiva) await this.deps.tocarMidia()
      return 'saudou'
    } finally {
      this.emAndamento = false
    }
  }

  private async saudarComTeto(
    agora: Date,
    ausenciaMs: number | null,
    tetoMs: number,
    fraseFixa: string
  ): Promise<string> {
    const cancelar = new AbortController()
    const agendar = this.deps.agendar ?? setTimeout
    const cancelarRelogio = this.deps.cancelar ?? clearTimeout
    let relogio: ReturnType<typeof setTimeout> | undefined
    const teto = new Promise<string>((resolve) => {
      relogio = agendar(() => {
        cancelar.abort()
        resolve(fraseFixa)
      }, tetoMs)
    })
    try {
      const gerada = await Promise.race([
        this.deps.gerarSaudacao(agora, ausenciaMs, cancelar.signal),
        teto
      ])
      return gerada.trim() || fraseFixa
    } catch {
      return fraseFixa
    } finally {
      if (relogio !== undefined) cancelarRelogio(relogio)
    }
  }
}
