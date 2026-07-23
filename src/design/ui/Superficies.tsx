import * as RadixSeparator from '@radix-ui/react-separator'
import { cx, BORDA, SUPERFICIE, TRANSICAO } from './base'
import type { TomSemantico } from './semantica'
import {
  CLASSE_BORDA_SEMANTICA,
  CLASSE_FUNDO_SEMANTICO,
  CLASSE_TEXTO_SEMANTICO,
  ICONE_SEMANTICO,
  NOME_DO_TOM
} from './semantica'

/**
 * Superfícies e rótulos (SPEC-DesignSystem-03b, PRD §11.4).
 *
 * Card, Panel, Badge, Tag e Separator — as peças que carregam informação sem interagir. A forma
 * vem das telas do protótipo (`screens/agents/04-aos.png`, `screens/noa/05-noa.png`): raio de
 * card, borda neutra de baixo alfa, sombra com glow do acento, label mono UPPERCASE.
 */

interface CardProps {
  readonly children: React.ReactNode
  /** Título opcional — vira `<h3>`, para a hierarquia de cabeçalho ficar correta. */
  readonly titulo?: string
  /** Eleva no hover. Só quando o card **inteiro** é clicável; senão é ruído. */
  readonly interativo?: boolean
  readonly onClick?: () => void
}

export function Card({
  children,
  titulo,
  interativo = false,
  onClick
}: CardProps): React.JSX.Element {
  const clicavel = interativo && onClick !== undefined

  /*
   * Card clicável vira `<button>`, não `<div onClick>`. Um div com handler não recebe foco,
   * não responde a Enter/Espaço e não é anunciado como acionável — a armadilha mais comum em
   * lista de cards. Quando não é clicável, fica `<article>`: continua sendo um bloco de
   * conteúdo autônomo para quem navega por marcos.
   */
  const Elemento = clicavel ? 'button' : 'article'

  return (
    <Elemento
      type={clicavel ? 'button' : undefined}
      onClick={clicavel ? onClick : undefined}
      className={cx(
        'flex flex-col gap-2 rounded-[var(--jos-raio-card)] p-4 text-left',
        BORDA,
        SUPERFICIE,
        'shadow-[var(--jos-sombra-card)]',
        clicavel &&
          cx(
            'cursor-pointer hover:border-[var(--jos-cor-acento)]',
            'hover:shadow-[var(--jos-sombra-card),0_0_30px_-14px_var(--jos-cor-acento)]',
            'focus-visible:outline-none focus-visible:border-[var(--jos-cor-acento)]',
            'focus-visible:shadow-[0_0_0_1px_var(--jos-cor-acento)]'
          ),
        TRANSICAO
      )}
    >
      {titulo !== undefined && (
        <h3 className="font-[var(--jos-peso-forte)] text-[length:var(--jos-texto-realce)]">
          {titulo}
        </h3>
      )}
      {children}
    </Elemento>
  )
}

interface PanelProps {
  readonly children: React.ReactNode
  readonly titulo?: string
  /**
   * Tom semântico — pinta a borda e o ícone do cabeçalho.
   *
   * Sem tom, o painel é neutro. Com tom, ele carrega **ícone + texto**, nunca só a borda
   * colorida: quem não distingue a cor precisa do mesmo sinal (critério 4).
   */
  readonly tom?: TomSemantico
  /** Ações do rodapé — os botões que a tela `09-aos.png` mostra dentro do painel. */
  readonly acoes?: React.ReactNode
}

/**
 * Painel — bloco de conteúdo com cabeçalho, corpo e ações.
 *
 * Diferente do `Card` por ter estrutura declarada (cabeçalho/corpo/ações) e por poder carregar
 * tom semântico. O `Card` é superfície solta; o `Panel` é uma seção.
 */
export function Panel({ children, titulo, tom, acoes }: PanelProps): React.JSX.Element {
  const Icone = tom !== undefined ? ICONE_SEMANTICO[tom] : null

  return (
    <section
      className={cx(
        'flex flex-col gap-3 rounded-[var(--jos-raio-card)] p-4',
        'border',
        tom === undefined
          ? 'border-[rgba(var(--jos-borda-rgb),0.12)]'
          : CLASSE_BORDA_SEMANTICA[tom],
        SUPERFICIE
      )}
    >
      {titulo !== undefined && (
        <header className="flex items-center gap-2">
          {Icone !== null && tom !== undefined && (
            <>
              <Icone
                aria-hidden="true"
                className={cx('size-[var(--jos-tamanho-icone)]', CLASSE_TEXTO_SEMANTICO[tom])}
              />
              {/* O ícone é decorativo; quem informa o estado por voz é este texto. Sem ele, um
                  painel de erro seria anunciado como um painel qualquer. */}
              <span className="sr-only">{NOME_DO_TOM[tom]}:</span>
            </>
          )}
          <h3 className="font-[var(--jos-peso-forte)] text-[length:var(--jos-texto-realce)]">
            {titulo}
          </h3>
        </header>
      )}
      <div className="flex flex-col gap-2">{children}</div>
      {acoes !== undefined && <footer className="flex flex-wrap gap-2 pt-1">{acoes}</footer>}
    </section>
  )
}

interface BadgeProps {
  readonly children: React.ReactNode
  readonly tom?: TomSemantico
  /**
   * Ponto de status à esquerda — o padrão `● OPERACIONAL` das telas.
   *
   * O ponto **acompanha** o texto, nunca o substitui: ele é reforço visual do que já está
   * escrito (critério 4).
   */
  readonly comPonto?: boolean
}

/**
 * Etiqueta de estado — mono UPPERCASE, como em `UNREACHABLE` e `AMBIENTE ● OPERACIONAL`.
 *
 * Estado sempre em **texto**; cor e ponto são reforço. Um badge que dependesse da cor seria
 * ilegível em alto contraste e para daltônicos.
 */
export function Badge({ children, tom, comPonto = false }: BadgeProps): React.JSX.Element {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-[var(--jos-raio-chip)] px-2 py-0.5',
        'font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)]',
        'uppercase tracking-[var(--jos-tracking-label)]',
        'border',
        tom === undefined
          ? 'border-[rgba(var(--jos-borda-rgb),0.24)] text-[var(--jos-cor-texto-secundario)]'
          : cx(CLASSE_BORDA_SEMANTICA[tom], CLASSE_TEXTO_SEMANTICO[tom])
      )}
    >
      {comPonto && (
        <span
          aria-hidden="true"
          className={cx(
            'size-1.5 shrink-0 rounded-full',
            tom === undefined ? 'bg-current' : CLASSE_FUNDO_SEMANTICO[tom]
          )}
        />
      )}
      {children}
    </span>
  )
}

interface TagProps {
  readonly children: React.ReactNode
  /** Remover a tag. Presente ⇒ renderiza o botão de remoção. */
  readonly onRemover?: () => void
  /** Rótulo acessível do botão de remoção — precisa dizer **o quê** remove. */
  readonly rotuloRemover?: string
}

/**
 * Tag — rótulo de categoria, opcionalmente removível.
 *
 * Diferente do `Badge`, que comunica **estado do sistema**: a tag classifica conteúdo e pode
 * ser editada pelo usuário. Por isso ela tem remoção e o badge não.
 */
export function Tag({ children, onRemover, rotuloRemover }: TagProps): React.JSX.Element {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-[var(--jos-raio-pill)] px-2.5 py-0.5',
        'text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto-secundario)]',
        'border border-[rgba(var(--jos-borda-rgb),0.24)]'
      )}
    >
      {children}
      {onRemover !== undefined && (
        <button
          type="button"
          onClick={onRemover}
          // O rótulo nomeia o alvo: "Remover" sozinho não diz o quê, e numa lista de tags o
          // leitor de tela anunciaria vários botões idênticos.
          aria-label={rotuloRemover ?? `Remover ${String(children)}`}
          className={cx(
            'flex size-4 items-center justify-center rounded-full leading-none',
            'hover:text-[var(--jos-cor-texto)]',
            'focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--jos-cor-acento)]',
            TRANSICAO
          )}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </span>
  )
}

interface SeparatorProps {
  readonly orientacao?: 'horizontal' | 'vertical'
  /**
   * Separador com significado semântico (separa grupos) em vez de puramente decorativo.
   *
   * O default é **decorativo**: a maioria dos separadores é visual, e anunciá-los polui a
   * leitura por tecnologia assistiva.
   */
  readonly semantico?: boolean
}

export function Separator({
  orientacao = 'horizontal',
  semantico = false
}: SeparatorProps): React.JSX.Element {
  return (
    <RadixSeparator.Root
      orientation={orientacao}
      decorative={!semantico}
      className={cx(
        'shrink-0 bg-[rgba(var(--jos-borda-rgb),0.16)]',
        orientacao === 'horizontal' ? 'h-px w-full' : 'h-full w-px'
      )}
    />
  )
}
