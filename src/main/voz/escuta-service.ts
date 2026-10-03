/**
 * O serviço da escuta contínua (SPEC-Escuta-01, critérios 7, 8, 10, 11 e 12).
 *
 * A pergunta que este arquivo responde: **o microfone está aberto agora, por quê, e quem pode
 * fechá-lo?** A captura é do renderer (`getUserMedia` é Web API); aqui moram as decisões — ligar,
 * desligar, restaurar, qual gatilho vale, quando um disparo é ignorado — e o aviso à tela que abre
 * ou fecha o stream. Tudo o que toca o mundo (engine, sidecar, SO, disco, auditoria) entra por
 * injeção, porque é isso que torna o kill switch testável: o que prova o kill switch é o stream
 * fechado, e só um dublê de `aoMudarCaptura` consegue afirmar isso.
 *
 * ## Quatro decisões
 *
 *  - **O kill switch vence.** O estado desligado fica persistido e prevalece sobre o padrão "liga
 *    sozinha"; só um modelo pronto liga a escuta sem pedido.
 *  - **Toda mudança de estado é auditada, com a via** (`interface`, `hotkey`, `restauracao`).
 *    Pedir o estado em que já está não muda nada e, por isso, não audita nem avisa a tela.
 *  - **A hotkey de mute é o próprio kill switch**, acionado por outro caminho: corta a captura com
 *    a janela minimizada e fica persistido como qualquer desligamento.
 *  - **Disparo durante turno ativo é ignorado**, e o bloqueio da sessão é lido **a cada disparo**:
 *    guardá-lo da restauração serviria o estado de antes de o PI travar a máquina.
 *
 * O que não mora aqui: o que acontece depois do disparo (janela, voz, silêncio). O serviço só
 * diz quem disparou e se a sessão estava bloqueada; quem abre o turno decide o resto.
 */

import type { WakeWordEngine } from './wake-word-engine'
import { LIMIAR_PADRAO_WAKE_WORD, validarLimiar } from './wake-word-engine'

export type ViaDaEscuta = 'interface' | 'hotkey' | 'restauracao'

/** O que sobrevive ao reinício. `undefined` na primeira execução. */
export interface EstadoPersistidoDaEscuta {
  readonly ativa: boolean
  readonly frase: boolean
  readonly palmas: boolean
  readonly sensibilidade: number
}

export interface EventoDeEscuta {
  readonly gatilho: 'frase' | 'palmas'
  /** Só a frase tem confiança medida. */
  readonly confianca?: number
  readonly sessaoBloqueada: boolean
}

export interface EstadoDaEscutaNoMain extends EstadoPersistidoDaEscuta {
  /** Se o modelo da wake word está pronto no disco. */
  readonly disponivel: boolean
}

export type DesfechoDeLigar =
  { readonly ok: true } | { readonly ok: false; readonly motivo: 'MODELO_AUSENTE' }

export interface DepsDaEscuta {
  readonly engine: WakeWordEngine
  readonly palmas: {
    readonly alimentar: (pcm: Int16Array) => boolean
    readonly limpar: () => void
  }
  readonly estado: {
    readonly ler: () => EstadoPersistidoDaEscuta | undefined
    readonly gravar: (estado: EstadoPersistidoDaEscuta) => void
  }
  /** Se o modelo da wake word está baixado e verificado. */
  readonly modeloPronto: () => Promise<boolean>
  readonly auditar: (evento: {
    readonly type: 'voz.escuta.ligada' | 'voz.escuta.desligada'
    readonly payload: { readonly via: ViaDaEscuta }
  }) => void
  /** `powerMonitor` do Electron: lido a cada disparo. */
  readonly sessaoBloqueada: () => boolean
  /** Se um turno de conversa já está em andamento. */
  readonly turnoAtivo: () => boolean
  /** Avisa a tela que abra (`true`) ou **encerre** (`false`) o stream do microfone. */
  readonly aoMudarCaptura: (aberta: boolean) => void
  readonly aoDisparar: (evento: EventoDeEscuta) => void
  /** Teto do turno aberto pela escuta; passado dele a escuta volta a ouvir. */
  readonly tetoDoTurnoMs?: number
  readonly agendar?: (acao: () => void, ms: number) => ReturnType<typeof setTimeout>
  readonly cancelar?: (relogio: ReturnType<typeof setTimeout>) => void
}

/**
 * Sem teto, um turno que a tela esquece de encerrar (janela recarregada, erro no meio da resposta)
 * deixaria a escuta surda até o próximo boot — e o indicador diria que está ouvindo.
 */
export const TETO_DO_TURNO_PADRAO_MS = 120_000

const PADRAO: EstadoPersistidoDaEscuta = {
  ativa: true,
  frase: true,
  palmas: true,
  sensibilidade: LIMIAR_PADRAO_WAKE_WORD
}

export class EscutaService {
  private persistido: EstadoPersistidoDaEscuta = PADRAO
  private ativa = false
  private disponivel = false
  private turno = false
  private relogioDoTurno: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly deps: DepsDaEscuta) {}

  estado(): EstadoDaEscutaNoMain {
    return { ...this.persistido, ativa: this.ativa, disponivel: this.disponivel }
  }

  /**
   * Lê o estado salvo e, se ele pede escuta ligada **e** há modelo pronto, liga. Sem estado salvo
   * vale o padrão (ligada); com `ativa: false` salvo, o kill switch prevalece e nada é auditado —
   * não houve mudança de estado.
   */
  async restaurar(): Promise<void> {
    this.persistido = this.deps.estado.ler() ?? PADRAO
    this.persistido = {
      ...this.persistido,
      sensibilidade: validarLimiar(this.persistido.sensibilidade)
    }
    this.deps.engine.definirLimiar(this.persistido.sensibilidade)
    this.disponivel = await this.deps.modeloPronto()

    if (this.persistido.ativa && this.disponivel) await this.ligar('restauracao')
  }

  async ligar(via: ViaDaEscuta): Promise<DesfechoDeLigar> {
    this.disponivel = await this.deps.modeloPronto()
    if (!this.disponivel) return { ok: false, motivo: 'MODELO_AUSENTE' }
    if (this.ativa) return { ok: true }

    this.ativa = true
    this.persistir({ ativa: true })
    this.deps.palmas.limpar()
    this.deps.aoMudarCaptura(true)
    this.deps.auditar({ type: 'voz.escuta.ligada', payload: { via } })
    return { ok: true }
  }

  async desligar(via: ViaDaEscuta): Promise<void> {
    if (!this.ativa) return

    this.ativa = false
    this.persistir({ ativa: false })
    this.definirTurno(false)
    this.deps.palmas.limpar()
    this.deps.aoMudarCaptura(false)
    this.deps.auditar({ type: 'voz.escuta.desligada', payload: { via } })
  }

  /** A hotkey global de mute: o mesmo kill switch, por outro caminho. */
  async alternarPorHotkey(): Promise<void> {
    if (this.ativa) await this.desligar('hotkey')
    else await this.ligar('hotkey')
  }

  async definirGatilhos(gatilhos: {
    readonly frase: boolean
    readonly palmas: boolean
  }): Promise<void> {
    this.persistir(gatilhos)
  }

  /** Vale na detecção seguinte, sem restart (critério 12). Fora da faixa é limitado, não aceito. */
  async definirSensibilidade(valor: number): Promise<void> {
    const sensibilidade = validarLimiar(valor)
    this.deps.engine.definirLimiar(sensibilidade)
    this.persistir({ sensibilidade })
  }

  /**
   * A tela avisa que um turno de conversa começou ou terminou — qualquer turno, inclusive o do
   * push-to-talk. O turno que o próprio disparo abre já nasce marcado aqui, de forma síncrona: o
   * PCM que ainda está a caminho não pode abrir um segundo.
   */
  definirTurno(ativo: boolean): void {
    const cancelar = this.deps.cancelar ?? clearTimeout
    if (this.relogioDoTurno !== undefined) {
      cancelar(this.relogioDoTurno)
      this.relogioDoTurno = undefined
    }
    this.turno = ativo
    if (!ativo) return

    const agendar = this.deps.agendar ?? setTimeout
    this.relogioDoTurno = agendar(() => {
      this.relogioDoTurno = undefined
      this.turno = false
    }, this.deps.tetoDoTurnoMs ?? TETO_DO_TURNO_PADRAO_MS)
  }

  private emTurno(): boolean {
    return this.turno || this.deps.turnoAtivo()
  }

  /** Um bloco de PCM 16 kHz mono vindo da captura. Desligada, ou em turno, não faz nada. */
  async receberPcm(pcm: Int16Array): Promise<void> {
    if (!this.ativa || this.emTurno()) return

    if (this.persistido.palmas && this.deps.palmas.alimentar(pcm)) {
      this.disparar({ gatilho: 'palmas' })
      return
    }
    if (!this.persistido.frase) return

    const deteccao = await this.deps.engine.alimentar(pcm)
    // O turno pode ter começado enquanto o engine pensava: o disparo tardio seria um segundo turno.
    if (deteccao !== null && !this.emTurno()) {
      this.disparar({ gatilho: 'frase', confianca: deteccao.confianca })
    }
  }

  private disparar(evento: Omit<EventoDeEscuta, 'sessaoBloqueada'>): void {
    this.definirTurno(true)
    this.deps.aoDisparar({ ...evento, sessaoBloqueada: this.deps.sessaoBloqueada() })
  }

  private persistir(mudanca: Partial<EstadoPersistidoDaEscuta>): void {
    this.persistido = { ...this.persistido, ...mudanca }
    this.deps.estado.gravar(this.persistido)
  }
}
