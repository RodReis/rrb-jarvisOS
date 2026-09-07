/**
 * O estado de uma gravação em curso, e o timeout que a fecha (SPEC-Voz-01, critério 5).
 *
 * ## Duas formas de acionar, um estado só
 *
 * O botão da tela é walkie-talkie — segurar grava, soltar transcreve — e a hotkey global é
 * **toggle**: um toque abre, outro encerra. As duas terminam aqui, porque quem grava é o mesmo
 * microfone e uma sessão aberta pelo botão tem de ser fechável pela hotkey (e vice-versa). Dois
 * estados separados divergiriam no primeiro uso misto, e o microfone ficaria aberto sem nada na
 * tela dizendo isso.
 *
 * ## O timeout é consequência direta do toggle
 *
 * Segurar o botão tem fim natural: a mão solta. O toggle não — quem toca a hotkey e esquece
 * deixa o microfone aberto indefinidamente. Por isso o **timeout duro** (60 s por default,
 * configurável), que encerra a sessão como se o usuário tivesse soltado. Ele não é uma proteção
 * contra falha do app; é a resposta ao modo de acionar que a spec escolheu.
 *
 * ## Este arquivo não toca o microfone
 *
 * Quem captura é o renderer, por `getUserMedia`. Aqui mora só a máquina de estados — o que
 * permite testar o timeout e o toggle sem áudio, sem Electron e sem esperar 60 segundos.
 */

/** O default cravado pela spec. */
export const TIMEOUT_PADRAO_MS = 60_000

/** Por que a sessão terminou. A tela trata as três diferente. */
export type MotivoDoFim = 'soltou' | 'toggle' | 'timeout'

export interface DepsDaSessao {
  /** Injetado para o teste não esperar um minuto de verdade. */
  readonly agendar: (acao: () => void, ms: number) => ReturnType<typeof setTimeout>
  readonly cancelar: (relogio: ReturnType<typeof setTimeout>) => void
  /** Chamado quando a sessão fecha, por qualquer um dos três motivos. */
  readonly aoFechar: (motivo: MotivoDoFim) => void
  readonly timeoutMs?: number
}

export class SessaoDeGravacao {
  private relogio: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly deps: DepsDaSessao) {}

  get gravando(): boolean {
    return this.relogio !== undefined
  }

  /**
   * Abre a gravação. Abrir uma já aberta **não** reinicia o timeout.
   *
   * Reiniciar deixaria o toggle esquecido vivo para sempre se algo reabrisse a sessão em loop —
   * o timeout existe justamente para o caso em que ninguém está olhando.
   */
  abrir(): void {
    if (this.gravando) return

    this.relogio = this.deps.agendar(() => {
      // O relógio disparou: ele já não existe mais para ser cancelado, e zerar antes de avisar
      // impede que o `aoFechar` veja uma sessão que o próprio timeout acabou de encerrar.
      this.relogio = undefined
      this.deps.aoFechar('timeout')
    }, this.deps.timeoutMs ?? TIMEOUT_PADRAO_MS)
  }

  /** Fecha a gravação. Fechar uma que não está aberta é silêncio, não erro. */
  fechar(motivo: Exclude<MotivoDoFim, 'timeout'>): void {
    const relogio = this.relogio
    if (relogio === undefined) return

    this.relogio = undefined
    this.deps.cancelar(relogio)
    this.deps.aoFechar(motivo)
  }

  /** Um toque na hotkey: abre se fechada, fecha se aberta. */
  alternar(): void {
    if (this.gravando) this.fechar('toggle')
    else this.abrir()
  }

  /** Encerra sem avisar ninguém. Para o desligamento do app, onde não há tela para reagir. */
  descartar(): void {
    if (this.relogio === undefined) return

    this.deps.cancelar(this.relogio)
    this.relogio = undefined
  }
}
