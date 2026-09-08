/**
 * A hotkey global de push-to-talk (SPEC-Voz-01, critério 5).
 *
 * ## Toggle, e não segurar
 *
 * No botão da tela o gesto é walkie-talkie — segurar grava, soltar transcreve. Na hotkey é
 * **toggle**: um toque abre, outro encerra (decisão do PI). A diferença não é capricho: o atalho
 * global funciona com a janela minimizada, e "segurar" ali dependeria de o SO entregar o
 * `keyup`, que ele não garante quando o foco muda no meio.
 *
 * ## Por que o timeout duro existe
 *
 * É consequência direta do toggle. Quem esquece de dar o segundo toque deixa o microfone aberto
 * indefinidamente — e um microfone aberto que o usuário não pediu é pior que um bug, parece
 * escuta. O teto encerra sozinho e transcreve o que houver.
 *
 * ## O que este arquivo não faz
 *
 * Não captura áudio nem transcreve. `globalShortcut` é API do main, e a captura é do renderer
 * (`getUserMedia` é Web API — a fronteira não é tocada). Aqui só se decide **quando** começa e
 * termina, e o aviso vai à tela pela ponte.
 */

/** O mínimo do `globalShortcut` do Electron que este arquivo toca. Injetado para teste. */
export interface AtalhoGlobal {
  readonly register: (acelerador: string, aoAcionar: () => void) => boolean
  readonly unregister: (acelerador: string) => void
}

export interface DepsDaHotkey {
  readonly atalho: AtalhoGlobal
  /** Avisa a tela que a gravação abriu ou fechou. É ela quem tem o microfone. */
  readonly aoAlternar: (gravando: boolean) => void
  readonly agendar?: (acao: () => void, ms: number) => ReturnType<typeof setTimeout>
  readonly cancelar?: (relogio: ReturnType<typeof setTimeout>) => void
  /** Registrar atalho é mudança observável do sistema — a spec pede auditoria. */
  readonly auditar?: (evento: { readonly acelerador: string; readonly registrado: boolean }) => void
}

export class HotkeyDaVoz {
  private aceleradorAtual: string | undefined
  private gravando = false
  private relogio: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly deps: DepsDaHotkey) {}

  /**
   * Registra o atalho, trocando o anterior se houver.
   *
   * Liberar o antigo **antes** de pedir o novo: registrar sem liberar deixaria dois aceleradores
   * ativos, e o antigo continuaria abrindo o microfone depois de o usuário tê-lo trocado em
   * Settings — a mudança pareceria não ter pegado.
   *
   * Devolve se conseguiu. `false` não é exceção: outro app pode já ter o atalho, e o que a tela
   * precisa é oferecer outra combinação, não morrer.
   */
  registrar(acelerador: string, timeoutMs: number): boolean {
    this.liberar()

    const ok = this.deps.atalho.register(acelerador, () => this.alternar(timeoutMs))
    if (ok) this.aceleradorAtual = acelerador

    this.deps.auditar?.({ acelerador, registrado: ok })
    return ok
  }

  /** Libera o atalho e encerra gravação aberta. Idempotente. */
  liberar(): void {
    if (this.gravando) this.alternar(0)

    if (this.aceleradorAtual !== undefined) {
      this.deps.atalho.unregister(this.aceleradorAtual)
      this.aceleradorAtual = undefined
    }
  }

  /** Se há gravação aberta por hotkey agora. */
  get estaGravando(): boolean {
    return this.gravando
  }

  private alternar(timeoutMs: number): void {
    const agendar = this.deps.agendar ?? setTimeout
    const cancelar = this.deps.cancelar ?? clearTimeout

    if (this.relogio !== undefined) {
      cancelar(this.relogio)
      this.relogio = undefined
    }

    this.gravando = !this.gravando
    this.deps.aoAlternar(this.gravando)

    /*
     * O teto só é armado ao **abrir**. Armá-lo também no fechamento agendaria uma reabertura
     * espontânea do microfone — o oposto exato do que ele existe para evitar.
     */
    if (this.gravando && timeoutMs > 0) {
      this.relogio = agendar(() => {
        this.relogio = undefined
        this.gravando = false
        this.deps.aoAlternar(false)
      }, timeoutMs)
    }
  }
}
