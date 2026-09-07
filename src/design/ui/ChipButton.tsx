import { cx, DESABILITADO, FOCO, TRANSICAO, type PropsDeComposicao } from './base'

/**
 * Chip de metadado **acionável** — o dado é o próprio gatilho.
 *
 * Nasceu de um defeito real: o modelo do card de projeto (`claude-opus-5`) era um `IconButton`
 * carregando texto. O `IconButton` fixa `width` **e** `height` em 44px por desenho — é um alvo
 * quadrado para um glifo —, então o id do modelo quebrava em duas linhas dentro de uma caixa que
 * não crescia, e o texto vazava por fora da borda. Nenhum teste de papel acusa isso: o botão tem
 * nome acessível, aciona, recebe foco. Só a captura mostra.
 *
 * A diferença que justifica um componente e não uma prop no `IconButton`: **a largura vem do
 * conteúdo, e a altura é a da linha de texto**, não a do controle de formulário. Um chip de
 * metadado vive dentro de uma linha de metadados — dar a ele 44px de altura o transformaria num
 * botão que empurra a linha inteira e rouba a hierarquia do CTA do card.
 *
 * O que ele mantém do resto dos controles: foco visível no acento, transição sem propriedade de
 * layout, desabilitado com cursor **e** opacidade. O que ele não tem: preenchimento sólido nem
 * variantes — um chip que competisse com o botão primário derrotaria o motivo de ele existir.
 */

interface ChipButtonProps extends PropsDeComposicao {
  /** Nome acessível. Obrigatório: o texto visível é um id de máquina, e id não descreve a ação. */
  readonly rotulo: string
  readonly children: React.ReactNode
  readonly onClick?: React.MouseEventHandler<HTMLButtonElement>
  readonly desabilitado?: boolean
  /**
   * Marca que este valor **diverge do padrão** — o ponto ao lado do texto.
   *
   * Forma, e não só cor: o critério do DS é que estado nunca viva só na cor, e num chip de
   * metadado em `--jos-texto-micro` uma diferença de tom seria imperceptível de relance.
   */
  readonly divergente?: boolean
}

export function ChipButton({
  rotulo,
  children,
  onClick,
  desabilitado = false,
  divergente = false,
  ...composicao
}: ChipButtonProps): React.JSX.Element {
  return (
    <button
      {...composicao}
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      aria-label={rotulo}
      title={rotulo}
      className={cx(
        // `whitespace-nowrap` é o conserto do defeito: o id do modelo não tem espaço onde
        // quebrar de forma útil, e deixá-lo quebrar produzia "CLAUDE-" numa linha e "OPUS-5" na
        // outra, dentro de uma caixa dimensionada para uma linha só.
        'inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-[var(--jos-raio-pill)]',
        'border border-[rgba(var(--jos-borda-rgb),0.20)] px-2 py-0.5',
        'font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)]',
        'uppercase tracking-[var(--jos-tracking-label)]',
        'text-[var(--jos-cor-texto-secundario)]',
        'hover:border-[rgba(var(--jos-borda-rgb),0.38)] hover:text-[var(--jos-cor-texto)]',
        FOCO,
        TRANSICAO,
        DESABILITADO
      )}
    >
      {/* `min-w-0` + `truncate`: numa coluna estreita o id encurta com reticências em vez de
          esticar o card. O valor inteiro continua no `title` e no nome acessível. */}
      <span className="min-w-0 truncate">{children}</span>

      {divergente && (
        // O ponto é decorativo; quem informa a divergência ao leitor de tela é o `rotulo`, que
        // o consumidor escreve por extenso.
        <span
          aria-hidden="true"
          className="size-1 shrink-0 rounded-full bg-[var(--jos-cor-acento-leitura)]"
        />
      )}
    </button>
  )
}
