import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cx, FOCO, LABEL_MONO, TRANSICAO } from './base'

/**
 * Divulgação progressiva — um bloco que abre e fecha (PRD §11.4).
 *
 * Nasceu com o console da geração (SPEC-Fases-03): o painel da etapa é retrátil, e o resultado
 * de cada ferramenta é colapsável dentro dele. Vive no DS, e não como estado local da tela, pela
 * regra do PRODUCT.md — *um módulo novo nasce consistente sem que ninguém escreva CSS local*.
 *
 * ## Por que `<details>` e não Radix
 *
 * Todo outro primitivo com comportamento deste DS usa Radix, e a razão é sempre a mesma: o
 * teclado do padrão WAI-ARIA vem pronto e testado. Aqui o argumento **inverte-se** — `<details>`
 * já é o elemento nativo desse padrão. Ele traz foco, `Enter`/`Espaço`, o estado exposto ao
 * leitor de tela e a busca do navegador dentro do conteúdo fechado (Chrome abre o bloco ao achar
 * o termo com Ctrl+F). Um `@radix-ui/react-collapsible` acrescentaria uma dependência para
 * reimplementar o que o navegador faz melhor, e perderia a busca.
 *
 * O que o navegador **não** dá é a estética: o marcador triangular padrão não pertence a design
 * system nenhum. Ele é removido e substituído pelo chevron do Lucide, que gira — o mesmo
 * vocabulário de ícone do resto da camada.
 *
 * ## O estado não é só a rotação
 *
 * O chevron gira, **e** o rótulo muda de peso e de cor quando aberto. Cor sozinha nunca comunica
 * estado (princípio 2 do produto), e uma rotação sozinha é fraca para quem enxerga pouco: são
 * três sinais redundantes — ângulo, peso e contraste — mais o `aria-expanded` que o próprio
 * `<details>` publica.
 */

interface DisclosureProps {
  /** O rótulo do bloco. Nomeia o que está dentro, não a ação de abrir. */
  readonly rotulo: React.ReactNode
  /**
   * Conteúdo à direita do rótulo, sempre visível — contagem, status, duração.
   *
   * Fica **fora** do `children` de propósito: é a informação que justifica abrir (ou não), e
   * escondê-la dentro do bloco fechado faria o usuário abrir para descobrir se valia abrir.
   */
  readonly resumo?: React.ReactNode
  readonly children: React.ReactNode
  /** Começa aberto. Não-controlado: qual bloco está aberto é estado de UI local. */
  readonly abertoPorPadrao?: boolean
  /**
   * Controlado — para quando **outra coisa** decide a abertura. O console usa isto: o painel
   * abre sozinho quando a geração começa (critério 6) e depois respeita a escolha do PI.
   */
  readonly aberto?: boolean
  readonly onAbertoChange?: (aberto: boolean) => void
  /** Densidade reduzida, para o bloco aninhado (o resultado dentro da linha de ferramenta). */
  readonly compacto?: boolean
}

export function Disclosure({
  rotulo,
  resumo,
  children,
  abertoPorPadrao = false,
  aberto,
  onAbertoChange,
  compacto = false
}: DisclosureProps): React.JSX.Element {
  /**
   * O estado interno, para o modo não-controlado.
   *
   * `<details>` **não** tem `defaultOpen` — o React só reconhece `defaultValue`/`defaultChecked`,
   * e em formulários. Escrever `defaultOpen` não dá erro nenhum: o atributo simplesmente não
   * chega ao DOM, e o bloco nasce fechado ignorando `abertoPorPadrao`. Foi o que o teste pegou.
   *
   * Com `open` sempre presente, o React controla o elemento nos dois modos — e é por isso que
   * `onToggle` precisa gravar aqui, senão o clique abriria o `<details>` e o render seguinte o
   * fecharia de volta.
   */
  const [abertoInterno, setAbertoInterno] = useState(abertoPorPadrao)
  const estaAberto = aberto ?? abertoInterno

  return (
    <details
      open={estaAberto}
      onToggle={(evento) => {
        // `onToggle` e não `onClick` no summary: o `<details>` também abre por busca do
        // navegador (Ctrl+F) e por `Enter`, e um handler no clique perderia esses dois caminhos.
        const { open } = evento.currentTarget
        if (aberto === undefined) setAbertoInterno(open)
        onAbertoChange?.(open)
      }}
      className="group/disclosure"
    >
      <summary
        className={cx(
          'flex cursor-pointer list-none items-center gap-2 rounded-[var(--jos-raio-controle)]',
          compacto ? 'py-1' : 'py-2',
          // O triângulo nativo sai pelos dois caminhos: `list-style` cobre o Firefox e o
          // pseudo-elemento do WebKit cobre Safari e Chrome. Só um dos dois deixaria o marcador
          // aparecer em metade dos navegadores.
          '[&::-webkit-details-marker]:hidden',
          FOCO,
          TRANSICAO
        )}
      >
        <ChevronRight
          aria-hidden="true"
          className={cx(
            'shrink-0 text-[var(--jos-cor-texto-suave)]',
            compacto ? 'size-3.5' : 'size-4',
            // A rotação usa `transform`, nunca propriedade de layout; a duração vem do token,
            // então `prefers-reduced-motion` a zera de uma vez (base.ts).
            'transition-transform duration-[var(--jos-duracao-rapida)]',
            'group-open/disclosure:rotate-90'
          )}
        />

        <span
          className={cx(
            'min-w-0 flex-1 text-left',
            compacto ? LABEL_MONO : 'text-sm',
            // Peso e cor **junto** com o ângulo do chevron: três sinais para o mesmo estado.
            'text-[var(--jos-cor-texto-suave)] group-open/disclosure:font-medium',
            'group-open/disclosure:text-[var(--jos-cor-texto)]',
            TRANSICAO
          )}
        >
          {rotulo}
        </span>

        {resumo !== undefined && <span className="shrink-0">{resumo}</span>}
      </summary>

      <div className={compacto ? 'pl-5 pt-1' : 'pl-6 pt-2'}>{children}</div>
    </details>
  )
}
