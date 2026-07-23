import { ALTURA_CONTROLE, BORDA, cx, DESABILITADO, FOCO, SUPERFICIE, TRANSICAO } from './base'

/**
 * Ações (SPEC-DesignSystem-03a, PRD §11.1).
 *
 * Três variantes com papéis distintos, não três estilos: `primaria` usa o **acento do
 * usuário** (a ação que o fluxo espera), `secundaria` usa borda neutra (alternativa legítima),
 * `perigo` usa `status-error` (destrutiva). A variante destrutiva lê a semântica e **não** o
 * acento — se o usuário escolhesse acento vermelho, "excluir" e "salvar" ficariam idênticos.
 */

type VarianteBotao = 'primaria' | 'secundaria' | 'perigo'

interface ButtonProps {
  readonly children: React.ReactNode
  readonly variante?: VarianteBotao
  readonly onClick?: () => void
  readonly desabilitado?: boolean
  /**
   * Estado de carregamento.
   *
   * Desabilita o botão **e** anuncia por `aria-busy` — o spinner sozinho não chega a quem usa
   * leitor de tela, e um botão que só "parece" ocupado aceita o segundo clique.
   */
  readonly carregando?: boolean
  readonly tipo?: 'button' | 'submit'
  /** Ocupa a largura do container — como o "ACESSAR" do login. */
  readonly larguraTotal?: boolean
  /** Ícone à direita do rótulo (a seta do protótipo). Decorativo: nunca leva significado. */
  readonly iconeFinal?: React.ReactNode
  /** Ícone à esquerda — logo de provedor, por exemplo. */
  readonly iconeInicial?: React.ReactNode
}

const POR_VARIANTE: Readonly<Record<VarianteBotao, string>> = {
  // Borda e glow no acento; o rótulo lê pela variável **de leitura**, que já vem com o tom
  // ajustado quando o acento escolhido seria ilegível como texto (F02).
  primaria: cx(
    'border-[var(--jos-cor-acento)] text-[var(--jos-cor-acento-leitura)]',
    'bg-[color-mix(in_srgb,var(--jos-cor-acento)_10%,transparent)]',
    'hover:bg-[color-mix(in_srgb,var(--jos-cor-acento)_18%,transparent)]',
    'hover:shadow-[0_0_24px_-12px_var(--jos-cor-acento)]'
  ),
  secundaria: cx(
    BORDA,
    SUPERFICIE,
    'text-[var(--jos-cor-texto)]',
    'hover:border-[rgba(var(--jos-borda-rgb),0.24)]'
  ),
  perigo: cx(
    'border-[var(--jos-cor-err)] text-[var(--jos-cor-err)]',
    'bg-[color-mix(in_srgb,var(--jos-cor-err)_10%,transparent)]',
    'hover:bg-[color-mix(in_srgb,var(--jos-cor-err)_18%,transparent)]'
  )
}

export function Button({
  children,
  variante = 'secundaria',
  onClick,
  desabilitado = false,
  carregando = false,
  tipo = 'button',
  larguraTotal = false,
  iconeFinal,
  iconeInicial
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type={tipo}
      onClick={onClick}
      disabled={desabilitado || carregando}
      aria-busy={carregando || undefined}
      style={{ height: ALTURA_CONTROLE }}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-[var(--jos-raio-card)] border px-5',
        // Rótulo em mono UPPERCASE: é a assinatura do botão no protótipo. Diverge do
        // "sem display font em label" do register product — fidelidade ao protótipo é a regra
        // da spec, e a escolha está registrada em PRODUCT.md.
        'font-[family-name:var(--jos-fonte-mono)] text-[13px] uppercase tracking-[2px]',
        larguraTotal && 'w-full',
        POR_VARIANTE[variante],
        FOCO,
        TRANSICAO,
        DESABILITADO
      )}
    >
      {carregando ? (
        <>
          {/* O texto acompanha o spinner: estado nunca só por forma ou cor (critério 2). */}
          <Girando />
          <span>Aguarde</span>
        </>
      ) : (
        <>
          {iconeInicial}
          <span>{children}</span>
          {iconeFinal}
        </>
      )}
    </button>
  )
}

/**
 * Indicador de carregamento.
 *
 * `aria-hidden` porque o `aria-busy` do botão já anuncia o estado — anunciar duas vezes faz o
 * leitor de tela repetir. A animação lê a duração do token, então `prefers-reduced-motion` a
 * congela junto com o resto (F02).
 */
function Girando(): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="size-3.5 animate-spin rounded-full border border-current border-t-transparent"
      style={{ animationDuration: 'calc(var(--jos-duracao-lenta) * 1.2)' }}
    />
  )
}
