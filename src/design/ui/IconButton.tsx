import { ALTURA_CONTROLE, BORDA, cx, DESABILITADO, FOCO, SUPERFICIE, TRANSICAO } from './base'

/**
 * Botão só de ícone (SPEC-DesignSystem-03a, PRD §11.1).
 *
 * `rotulo` é **obrigatório** e não tem default: um botão de ícone sem nome acessível é um botão
 * que o leitor de tela anuncia como "botão", e nada mais. Fazer a prop obrigatória é o que
 * transforma essa regra em erro de compilação em vez de achado de auditoria.
 */

interface IconButtonProps {
  /** Nome acessível — o que o leitor de tela anuncia. Obrigatório por desenho. */
  readonly rotulo: string
  readonly children: React.ReactNode
  readonly onClick?: () => void
  readonly desabilitado?: boolean
  /** Marca o botão como ativo (`aria-pressed`) — para toggles de barra de ferramentas. */
  readonly ativo?: boolean
  readonly tipo?: 'button' | 'submit'
}

export function IconButton({
  rotulo,
  children,
  onClick,
  desabilitado = false,
  ativo,
  tipo = 'button'
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      type={tipo}
      onClick={onClick}
      disabled={desabilitado}
      aria-label={rotulo}
      aria-pressed={ativo}
      title={rotulo}
      style={{ height: ALTURA_CONTROLE, width: ALTURA_CONTROLE }}
      className={cx(
        'inline-flex items-center justify-center rounded-[var(--jos-raio-rail)]',
        BORDA,
        SUPERFICIE,
        'text-[var(--jos-cor-texto-secundario)]',
        'hover:text-[var(--jos-cor-texto)] hover:border-[rgba(var(--jos-borda-rgb),0.24)]',
        // Estado ativo carrega borda **e** cor de texto: só a cor de fundo seria diferença que
        // some no alto contraste (critério 2 — nunca só por cor).
        ativo === true &&
          'border-[var(--jos-cor-acento)] text-[var(--jos-cor-acento-leitura)] bg-[color-mix(in_srgb,var(--jos-cor-acento)_12%,transparent)]',
        FOCO,
        TRANSICAO,
        DESABILITADO
      )}
    >
      {/* O ícone é decorativo: quem nomeia o botão é o `aria-label`. */}
      <span aria-hidden="true" className="inline-flex">
        {children}
      </span>
    </button>
  )
}
