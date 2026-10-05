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

import type { FaseDaVoz, HotkeyDeMuteDaEscuta } from '@shared/domain/voz'
import { HOTKEY_DE_MUTE_PADRAO, isHotkeyDeMuteDaEscuta } from '@shared/domain/voz'
import type { WakeWordEngine } from './wake-word-engine'
import { LIMIAR_PADRAO_WAKE_WORD, validarLimiar } from './wake-word-engine'

export type ViaDaEscuta = 'interface' | 'hotkey' | 'restauracao'

/** O que sobrevive ao reinício. `undefined` na primeira execução. */
export interface EstadoPersistidoDaEscuta {
  readonly ativa: boolean
  readonly frase: boolean
  readonly palmas: boolean
  readonly sensibilidade: number
  readonly hotkey: HotkeyDeMuteDaEscuta
}

export interface EventoDeEscuta {
  readonly gatilho: 'frase' | 'palmas'
  /** Só a frase tem confiança medida. */
  readonly confianca?: number
  /** Relógio local para medir a passagem do gatilho ao turno, sem transportar áudio. */
  readonly fimDoGatilhoMs?: number
  readonly sessaoBloqueada: boolean
}

/** Um disparo visto no modo de teste de Settings: a confiança medida e o limiar que valia. */
export interface DisparoDeTeste {
  readonly gatilho: 'frase' | 'palmas'
  /** Só a frase tem confiança medida. */
  readonly confianca?: number
  readonly limiar: number
}

export interface EstadoDaEscutaNoMain extends EstadoPersistidoDaEscuta {
  readonly fase: FaseDaVoz
  readonly recusaSerial: number
  /** Se o modelo da wake word está pronto no disco. */
  readonly disponivel: boolean
  /** Se o SO aceitou registrar a hotkey de mute. */
  readonly hotkeyRegistrada: boolean
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
  readonly auditar: (
    evento:
      | {
          readonly type: 'voz.escuta.ligada' | 'voz.escuta.desligada'
          readonly payload: { readonly via: ViaDaEscuta }
        }
      | {
          readonly type: 'voz.microfone.posse'
          readonly payload: { readonly de: DonoDoMicrofone; readonly para: DonoDoMicrofone }
        }
  ) => void
  /** `powerMonitor` do Electron: lido a cada disparo. */
  readonly sessaoBloqueada: () => boolean
  /** Se um turno de conversa já está em andamento. */
  readonly turnoAtivo: () => boolean
  /** Avisa a tela que abra (`true`) ou **encerre** (`false`) o stream do microfone. */
  readonly aoMudarCaptura: (aberta: boolean) => void
  readonly aoMudarEstado?: () => void
  readonly aoDisparar: (evento: EventoDeEscuta) => void
  /** Onde o disparo cai no modo de teste, no lugar de `aoDisparar`. */
  readonly aoTestar?: (disparo: DisparoDeTeste) => void
  /**
   * Registra a hotkey global de mute no SO, liberando a anterior, e diz se foi aceita. É da
   * composição porque `globalShortcut` é API do Electron — e porque a auditoria do registro mora
   * lá, ao lado da do push-to-talk.
   */
  readonly registrarHotkey?: (hotkey: HotkeyDeMuteDaEscuta) => boolean
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

/** O modo de teste esquecido ligado deixaria a escuta sem abrir turno nenhum, em silêncio. */
export const TETO_DO_TESTE_PADRAO_MS = 120_000

export type DonoDoMicrofone = 'nenhum' | 'wake-word' | 'push-to-talk'

const PADRAO: EstadoPersistidoDaEscuta = {
  ativa: true,
  frase: true,
  palmas: true,
  sensibilidade: LIMIAR_PADRAO_WAKE_WORD,
  hotkey: HOTKEY_DE_MUTE_PADRAO
}

export class EscutaService {
  private persistido: EstadoPersistidoDaEscuta = PADRAO
  private ativa = false
  private disponivel = false
  private hotkeyRegistrada = false
  private turno = false
  private fase: FaseDaVoz = 'ocioso'
  private capturaAberta = false
  private dono: DonoDoMicrofone = 'nenhum'
  private recusaSerial = 0
  private relogioDoTurno: ReturnType<typeof setTimeout> | undefined
  private teste = false
  private relogioDoTeste: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly deps: DepsDaEscuta) {}

  estado(): EstadoDaEscutaNoMain {
    return {
      ...this.persistido,
      ativa: this.ativa,
      fase: this.ativa && this.capturaAberta && this.fase === 'ocioso' ? 'escutando' : this.fase,
      recusaSerial: this.recusaSerial,
      disponivel: this.disponivel,
      hotkeyRegistrada: this.hotkeyRegistrada
    }
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
    this.hotkeyRegistrada = this.deps.registrarHotkey?.(this.persistido.hotkey) ?? false
    this.disponivel = await this.deps.modeloPronto()

    if (this.persistido.ativa && this.disponivel) await this.ligar('restauracao')
  }

  /** Reavalia o modelo depois de um download; um kill switch salvo continua prevalecendo. */
  async atualizarDisponibilidade(): Promise<void> {
    this.disponivel = await this.deps.modeloPronto()
    if (this.persistido.ativa && this.disponivel && !this.ativa) await this.ligar('restauracao')
  }

  async ligar(via: ViaDaEscuta): Promise<DesfechoDeLigar> {
    this.disponivel = await this.deps.modeloPronto()
    if (!this.disponivel) return { ok: false, motivo: 'MODELO_AUSENTE' }
    if (this.ativa) return { ok: true }

    this.ativa = true
    if (this.dono === 'nenhum') this.definirDono('wake-word')
    this.persistir({ ativa: true })
    this.deps.palmas.limpar()
    this.deps.aoMudarCaptura(true)
    this.deps.auditar({ type: 'voz.escuta.ligada', payload: { via } })
    return { ok: true }
  }

  async desligar(via: ViaDaEscuta): Promise<void> {
    if (!this.ativa) return

    this.ativa = false
    this.capturaAberta = false
    if (this.dono === 'wake-word') this.definirDono('nenhum')
    this.persistir({ ativa: false })
    this.definirTurno(false)
    this.definirModoDeTeste(false)
    this.deps.palmas.limpar()
    this.deps.aoMudarCaptura(false)
    this.deps.auditar({ type: 'voz.escuta.desligada', payload: { via } })
    // Com o microfone fechado, o pré-roll (1,5 s de áudio) e o processo do detector não ficam de
    // pé. A falha em encerrar é do engine, e o microfone já está fechado: não desfaz o desligamento.
    await this.deps.engine.encerrar().catch(() => undefined)
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

  /**
   * Troca a hotkey de mute (critério 11). Só vale combinação da lista fechada: o renderer não
   * escolhe um atalho global qualquer. Atalho ocupado por outro app não é erro — o estado
   * `hotkeyRegistrada` diz que não pegou, e a escuta segue valendo pelo interruptor da tela.
   */
  async definirHotkey(hotkey: unknown): Promise<void> {
    if (!isHotkeyDeMuteDaEscuta(hotkey)) return
    this.hotkeyRegistrada = this.deps.registrarHotkey?.(hotkey) ?? false
    this.persistir({ hotkey })
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

  /** A fase do turno mora no main; o renderer apenas relata os marcos da captura e da fala. */
  definirFase(fase: FaseDaVoz): void {
    if (this.fase === fase) return
    this.fase = fase
    this.deps.aoMudarEstado?.()
  }

  confirmarCapturaAberta(aberta: boolean): void {
    if (this.capturaAberta === aberta) return
    this.capturaAberta = aberta
    this.deps.aoMudarEstado?.()
  }

  definirDono(dono: DonoDoMicrofone): void {
    if (this.dono === dono) return
    const de = this.dono
    this.deps.auditar({ type: 'voz.microfone.posse', payload: { de, para: dono } })
    this.dono = dono
    this.deps.aoMudarEstado?.()
  }

  /**
   * Settings pede para ver cada disparo com a confiança medida (critério 12). No modo de teste o
   * disparo **não** abre turno nem sobe a janela: quem ajusta a sensibilidade não quer começar
   * uma conversa a cada tentativa. Expira sozinho, e desligar a escuta também o encerra.
   */
  definirModoDeTeste(ativo: boolean): void {
    const cancelar = this.deps.cancelar ?? clearTimeout
    if (this.relogioDoTeste !== undefined) {
      cancelar(this.relogioDoTeste)
      this.relogioDoTeste = undefined
    }
    this.teste = ativo
    if (!ativo) return

    const agendar = this.deps.agendar ?? setTimeout
    this.relogioDoTeste = agendar(() => {
      this.relogioDoTeste = undefined
      this.teste = false
    }, TETO_DO_TESTE_PADRAO_MS)
  }

  private emTurno(): boolean {
    return this.fase !== 'falando' && (this.turno || this.deps.turnoAtivo())
  }

  /** Um bloco de PCM 16 kHz mono vindo da captura. Desligada, ou em turno, não faz nada. */
  async receberPcm(pcm: Int16Array): Promise<void> {
    if (!this.ativa || this.dono === 'push-to-talk') return
    if (this.emTurno() && this.fase === 'ocioso') return

    if (this.persistido.palmas && this.deps.palmas.alimentar(pcm)) {
      this.disparar({ gatilho: 'palmas', fimDoGatilhoMs: Date.now() })
      return
    }
    if (!this.persistido.frase) return

    const deteccao = await this.deps.engine.alimentar(pcm)
    // O turno pode ter começado enquanto o engine pensava: o disparo tardio seria um segundo turno.
    if (deteccao !== null) {
      this.disparar({
        gatilho: 'frase',
        confianca: deteccao.confianca,
        fimDoGatilhoMs: deteccao.fimDaFraseMs
      })
    }
  }

  private disparar(evento: Omit<EventoDeEscuta, 'sessaoBloqueada'>): void {
    if (this.teste) {
      this.deps.aoTestar?.({
        gatilho: evento.gatilho,
        ...(evento.confianca === undefined ? {} : { confianca: evento.confianca }),
        limiar: this.deps.engine.obterLimiar()
      })
      return
    }
    if (this.emTurno()) {
      this.recusaSerial++
      this.deps.aoMudarEstado?.()
      return
    }
    this.definirTurno(true)
    this.definirFase('gravando')
    this.deps.aoDisparar({ ...evento, sessaoBloqueada: this.deps.sessaoBloqueada() })
  }

  private persistir(mudanca: Partial<EstadoPersistidoDaEscuta>): void {
    this.persistido = { ...this.persistido, ...mudanca }
    this.deps.estado.gravar(this.persistido)
  }
}
