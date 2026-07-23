import { cx, TRANSICAO } from './base'

/**
 * Link (SPEC-DesignSystem-03a, PRD §11.1).
 *
 * **Link navega, botão age** — a distinção não é estética, é o que o leitor de tela anuncia e
 * o que o teclado faz (Enter num link, Enter *e* Espaço num botão). Um `<a>` sem `href` que
 * dispara `onClick` é a armadilha clássica: parece link, não recebe foco, não abre em nova
 * aba. Por isso `href` é obrigatório aqui; ação sem navegação usa `Button`.
 *
 * Sublinhado por padrão: cor sozinha não distingue link de texto (PRD §14, WCAG 1.4.1) — e é
 * exatamente o caso que o critério 2 desta fatia cobra.
 */

interface LinkProps {
  readonly href: string
  readonly children: React.ReactNode
  /**
   * Link externo — abre em nova aba com `rel` seguro e anuncia o destino.
   *
   * `noopener` não é opcional: sem ele a página aberta ganha acesso a `window.opener` e pode
   * navegar a origem para outro lugar.
   */
  readonly externo?: boolean
}

export function Link({ href, children, externo = false }: LinkProps): React.JSX.Element {
  return (
    <a
      href={href}
      target={externo ? '_blank' : undefined}
      rel={externo ? 'noopener noreferrer' : undefined}
      className={cx(
        'inline-flex items-center gap-1 underline underline-offset-4',
        'text-[var(--jos-cor-acento-leitura)] decoration-[rgba(var(--jos-borda-rgb),0.4)]',
        'hover:decoration-[var(--jos-cor-acento)]',
        'outline-none focus-visible:rounded-[4px] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--jos-cor-acento)]',
        TRANSICAO
      )}
    >
      {children}
      {externo && (
        <>
          {/* O ícone é decorativo; quem informa "abre em nova aba" é o texto abaixo, que fica
              visível só para tecnologia assistiva. Ícone sozinho não chega a quem não o vê. */}
          <span aria-hidden="true">↗</span>
          <span className="sr-only">(abre em nova aba)</span>
        </>
      )}
    </a>
  )
}
