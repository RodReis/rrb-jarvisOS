/**
 * A hotkey global que abre e fecha a gravação (SPEC-Voz-01, critério 5).
 *
 * Ela funciona **com a janela minimizada**, que é o ponto: falar com o assistente sem trazer o
 * app para a frente é a diferença entre um atalho e um botão.
 *
 * ## O `globalShortcut` fica atrás de uma interface
 *
 * Registrar atalho global é do Electron, e o Electron não roda em teste unitário. A interface
 * `RegistradorDeAtalho` é o que permite exercitar aqui as regras que importam — recusa de
 * atalho já tomado, troca que libera o anterior, auditoria da mudança — sem abrir uma janela.
 *
 * ## Registrar é ação sensível
 *
 * Um atalho global intercepta a tecla **no sistema inteiro**, inclusive por cima de outros
 * aplicativos. Por isso a mudança gera `AuditEvent` (CLAUDE.md § Regras invioláveis): quem
 * olhar a cadeia depois consegue dizer quando o app passou a escutar qual combinação.
 *
 * ## Atalho tomado não é erro do app
 *
 * O sistema recusa quando outro programa já registrou a combinação, e isso é comum
 * (`Ctrl+Shift+Espaço` é disputado). O desfecho nomeado deixa a tela dizer "escolha outra" em
 * vez de mostrar uma falha genérica sobre um estado que o usuário pode consertar em um clique.
 */

/** O default. Combinação improvável de colidir, e ainda assim o desfecho de recusa existe. */
export const HOTKEY_PADRAO = 'CommandOrControl+Shift+Space'

/** O `globalShortcut` do Electron, atrás de uma interface para o teste não precisar dele. */
export interface RegistradorDeAtalho {
  /** `false` quando o sistema recusa — normalmente porque outro programa já o tem. */
  readonly registrar: (atalho: string, acao: () => void) => boolean
  readonly liberar: (atalho: string) => void
}

export interface DepsDaHotkey {
  readonly registrador: RegistradorDeAtalho
  /** O que o toque faz. É o `alternar` da sessão de gravação. */
  readonly aoAcionar: () => void
  readonly auditar: (evento: {
    readonly type: string
    readonly payload: Record<string, unknown>
  }) => void
}

export type DesfechoDoRegistro =
  | { readonly estado: 'ok'; readonly atalho: string }
  | { readonly estado: 'ja-em-uso'; readonly atalho: string }

export class HotkeyDaVoz {
  private atual: string | undefined

  constructor(private readonly deps: DepsDaHotkey) {}

  /** O atalho em vigor, ou `undefined` quando nenhum está registrado. */
  get registrada(): string | undefined {
    return this.atual
  }

  /**
   * Passa a escutar `atalho`, liberando o anterior.
   *
   * O anterior é liberado **antes** de tentar o novo: sem isso, trocar de `A` para `A` falharia
   * por conflito com ele mesmo, e o usuário veria "já em uso" sobre o próprio atalho.
   */
  registrar(atalho: string = HOTKEY_PADRAO): DesfechoDoRegistro {
    const anterior = this.atual
    if (anterior !== undefined) {
      this.deps.registrador.liberar(anterior)
      this.atual = undefined
    }

    if (!this.deps.registrador.registrar(atalho, this.deps.aoAcionar)) {
      // O anterior já foi liberado e o novo não entrou: o app fica sem hotkey, e é honesto.
      // Reregistrar o anterior aqui deixaria a tela dizendo "não deu" com o atalho antigo ainda
      // ativo — e o usuário sem saber qual das duas combinações vale.
      this.deps.auditar({
        type: 'voz.hotkey.recusada',
        payload: { atalho, anterior: anterior ?? null }
      })

      return { estado: 'ja-em-uso', atalho }
    }

    this.atual = atalho
    // Ação sensível: passa a interceptar a tecla no sistema inteiro, por cima de outros apps.
    this.deps.auditar({
      type: 'voz.hotkey.registrada',
      payload: { atalho, anterior: anterior ?? null }
    })

    return { estado: 'ok', atalho }
  }

  /** Para de escutar. Idempotente — chamar sem atalho registrado é silêncio. */
  liberar(): void {
    if (this.atual === undefined) return

    const atalho = this.atual
    this.atual = undefined
    this.deps.registrador.liberar(atalho)
    this.deps.auditar({ type: 'voz.hotkey.liberada', payload: { atalho } })
  }
}
