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

/**
 * Aparência por variante.
 *
 * **A hierarquia de ação é preenchimento, não matiz.** A primeira versão distinguia as
 * variantes só por cor (borda + 10% de fundo no acento), e isso colapsava: com um acento de
 * baixa croma — `#C4C4C4`, o **default do NOA**, e `#FFFFE3`, ambos na paleta de 8 —, primária,
 * carregando e desabilitado renderizavam como o mesmo botão cinza-claro. A ação que o fluxo
 * espera ficava indistinguível da que não pode ser clicada.
 *
 * Achado pelo `/impeccable critique` sobre a captura do NOA claro, com os 91 testes de papel
 * verdes: papel ARIA não mede rank visual.
 *
 * A correção aplica, ao nível da **variante**, a mesma regra que os componentes já seguem
 * internamente (PRD §14 — nunca só por cor): `primaria` é sólida e mais pesada; `perigo` é
 * contornada e pesada; `secundaria` é contornada e leve. Peso e preenchimento sobrevivem a
 * qualquer acento, ao alto contraste e ao daltonismo.
 */
const POR_VARIANTE: Readonly<Record<VarianteBotao, string>> = {
  // Preenchimento sólido: é o que separa a ação primária de todas as outras, independentemente
  // da cor escolhida. O rótulo lê por `--jos-cor-acento-contraste`, calculado contra o próprio
  // acento (preto ou branco, o que der contraste) — não contra o fundo da tela.
  primaria: cx(
    'border-[var(--jos-cor-acento)] bg-[var(--jos-cor-acento)]',
    'text-[var(--jos-cor-acento-contraste)] font-[var(--jos-peso-forte)]',
    'hover:brightness-110',
    'hover:shadow-[0_0_24px_-12px_var(--jos-cor-acento)]'
  ),
  secundaria: cx(
    BORDA,
    SUPERFICIE,
    'text-[var(--jos-cor-texto)]',
    'hover:border-[rgba(var(--jos-borda-rgb),0.24)]'
  ),
  // Contornada e pesada: distingue-se da secundária pelo peso mesmo antes de a cor ser lida.
  // Fica contornada, e não sólida, porque ação destrutiva não deve competir em proeminência
  // com a primária — o usuário não deve ser atraído a excluir.
  perigo: cx(
    'border-[var(--jos-cor-err)] text-[var(--jos-cor-err-leitura)] font-[var(--jos-peso-forte)]',
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
        'font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-acao)] uppercase tracking-[var(--jos-tracking-acao)]',
        larguraTotal && 'w-full',
        POR_VARIANTE[variante],
        FOCO,
        TRANSICAO,
        DESABILITADO
      )}
    >
      {/*
        O rótulo **permanece** enquanto carrega; o spinner entra ao lado dele.
        A primeira versão trocava o texto por "Aguarde", e num console operacional com várias
        ações em voo o usuário deixava de saber *qual* estava rodando — além de a largura do
        botão saltar. `aria-busy` já leva o estado à tecnologia assistiva, então a palavra
        nunca foi o que informava.
      */}
      {carregando ? <Girando /> : iconeInicial}
      <span>{children}</span>
      {!carregando && iconeFinal}
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
