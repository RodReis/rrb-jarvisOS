import * as RadixProgress from '@radix-ui/react-progress'
import { cx } from './base'
import type { TomSemantico } from './semantica'
import { CLASSE_FUNDO_SEMANTICO } from './semantica'

/**
 * Indicadores de quantidade e carregamento (SPEC-DesignSystem-03b, PRD §11.4).
 *
 * Progress, Meter, Spinner e Skeleton. A forma vem do card de finanças do protótipo
 * (`screens/noa/05-noa.png`): trilho escuro, fill na cor, número tabular ao lado.
 *
 * A diferença que decide qual usar:
 * - `Progress` — avanço de um processo que **vai terminar** (upload, execução). Tem começo e fim.
 * - `Meter` — nível de uma **medida estática** (orçamento usado, disco cheio). Não "progride".
 * O ARIA distingue os dois (`progressbar` vs `meter`), e o leitor de tela anuncia diferente.
 */

interface ProgressProps {
  /** 0 a 100. `undefined` = indeterminado (processo sem fim conhecido). */
  readonly valor?: number
  readonly rotulo: string
  readonly tom?: TomSemantico
}

export function Progress({ valor, rotulo, tom }: ProgressProps): React.JSX.Element {
  const indeterminado = valor === undefined
  const fill = tom !== undefined ? CLASSE_FUNDO_SEMANTICO[tom] : 'bg-[var(--jos-cor-acento)]'

  return (
    <RadixProgress.Root
      value={indeterminado ? null : valor}
      aria-label={rotulo}
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-[rgba(var(--jos-borda-rgb),0.16)]"
    >
      <RadixProgress.Indicator
        className={cx(
          'h-full rounded-full',
          fill,
          // Indeterminado: uma faixa que desliza, em vez de largura fixa. A animação lê a
          // duração do token, então `prefers-reduced-motion` a congela (F02).
          indeterminado
            ? 'w-1/3 animate-[deslizar_var(--jos-duracao-lenta)_ease-in-out_infinite]'
            : 'transition-[width] duration-[var(--jos-duracao-media)] ease-[var(--jos-curva-padrao)]'
        )}
        style={indeterminado ? undefined : { width: `${valor}%` }}
      />
    </RadixProgress.Root>
  )
}

interface MeterProps {
  readonly valor: number
  readonly minimo?: number
  readonly maximo?: number
  readonly rotulo: string
  /**
   * Faixas que **mudam o tom** conforme o valor — orçamento no verde, alerta no âmbar, estouro
   * no vermelho. Sem faixas, usa o acento.
   *
   * As faixas são dado, não `if` embutido: quem usa o Meter descreve o que cada nível significa,
   * porque "80% é ruim" depende da medida (80% de meta atingida é bom; 80% de disco é ruim).
   */
  readonly faixas?: ReadonlyArray<{ ate: number; tom: TomSemantico }>
  readonly formatar?: (valor: number) => string
  /** Mostra o rótulo **ao lado da barra**. Ver o comentário no corpo do componente (F06). */
  readonly rotuloVisivel?: boolean
}

/**
 * Medidor de nível — a barra de orçamento das telas de Finanças.
 *
 * `role="meter"` e não `progressbar`: é medida estática. O valor formatado aparece **em texto**
 * ao lado, com algarismos tabulares — a barra sozinha não informa o número.
 */
export function Meter({
  valor,
  minimo = 0,
  maximo = 100,
  rotulo,
  faixas,
  formatar = (v) => String(v),
  rotuloVisivel = false
}: MeterProps): React.JSX.Element {
  const proporcao = Math.min(1, Math.max(0, (valor - minimo) / (maximo - minimo)))

  // O tom é escolhido pela primeira faixa cujo teto o valor ainda não ultrapassou.
  const tom = faixas?.find((f) => valor <= f.ate)?.tom
  const fill = tom !== undefined ? CLASSE_FUNDO_SEMANTICO[tom] : 'bg-[var(--jos-cor-acento)]'

  return (
    <div className="flex items-center gap-3">
      {/*
       * Rótulo **visível**, opcional (F06).
       *
       * Até a F06 o rótulo vivia só em `aria-label`: acessível a quem usa leitor de tela e
       * invisível para quem enxerga. A captura do JARVIS HUD mostrou quatro barras com números à
       * direita e nenhuma forma de saber qual era CPU, RAM, GPU ou DISK — o inverso exato do
       * critério "estado nunca só por cor": informação essencial ausente da tela.
       *
       * É opcional porque nem todo uso precisa: no `Panel` "Passos hoje" do NOA, o título do
       * painel já nomeia a medida, e repetir o rótulo ao lado da barra seria ruído. Quem sabe se
       * o nome já está no contexto é quem monta a tela.
       */}
      {rotuloVisivel && (
        <span className="w-16 shrink-0 font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[var(--jos-tracking-label)] text-[var(--jos-cor-texto-suave)]">
          {rotulo}
        </span>
      )}
      <div
        role="meter"
        aria-label={rotulo}
        aria-valuenow={valor}
        aria-valuemin={minimo}
        aria-valuemax={maximo}
        aria-valuetext={formatar(valor)}
        className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[rgba(var(--jos-borda-rgb),0.16)]"
      >
        <div
          className={cx(
            'h-full rounded-full transition-[width]',
            'duration-[var(--jos-duracao-media)] ease-[var(--jos-curva-padrao)]',
            fill
          )}
          style={{ width: `${proporcao * 100}%` }}
        />
      </div>
      <span className="w-14 shrink-0 text-right font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto)] [font-variant-numeric:tabular-nums]">
        {formatar(valor)}
      </span>
    </div>
  )
}

interface SpinnerProps {
  /** Rótulo do que está carregando — anunciado por `role="status"`. */
  readonly rotulo: string
  readonly tamanho?: 'pequeno' | 'medio'
}

/**
 * Girador de carga.
 *
 * `role="status"` com o rótulo: quem usa leitor de tela ouve "carregando <o quê>", não fica no
 * silêncio de um ícone girando. `aria-live` implícito do `status` não interrompe o que o
 * usuário está fazendo — é a prioridade certa para carregamento (não é urgência).
 */
export function Spinner({ rotulo, tamanho = 'medio' }: SpinnerProps): React.JSX.Element {
  return (
    <span role="status" className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className={cx(
          'animate-spin rounded-full border-2 border-current border-t-transparent',
          'text-[var(--jos-cor-acento)]',
          tamanho === 'pequeno' ? 'size-4' : 'size-6'
        )}
        style={{ animationDuration: 'var(--jos-duracao-lenta)' }}
      />
      <span className="sr-only">{rotulo}</span>
    </span>
  )
}

interface SkeletonProps {
  readonly largura?: string
  readonly altura?: string
  /** Arredondamento — `pill` para avatar/chip, `card` para bloco. */
  readonly forma?: 'texto' | 'card' | 'pill'
}

/**
 * Esqueleto de carregamento.
 *
 * Para conteúdo que **vai chegar** — o register product prefere skeleton a spinner no meio do
 * conteúdo, porque preserva o layout e não faz a página "pular" quando o dado carrega.
 *
 * `aria-hidden`: o esqueleto é ruído para a tecnologia assistiva. Quem anuncia o carregamento é
 * o `role="status"` da região que o contém (LoadingState) — o esqueleto é só a pintura.
 */
export function Skeleton({
  largura = '100%',
  altura = '1rem',
  forma = 'texto'
}: SkeletonProps): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{ width: largura, height: altura }}
      className={cx(
        'block animate-pulse bg-[rgba(var(--jos-borda-rgb),0.16)]',
        forma === 'texto' && 'rounded-[var(--jos-raio-chip)]',
        forma === 'card' && 'rounded-[var(--jos-raio-card)]',
        forma === 'pill' && 'rounded-[var(--jos-raio-pill)]'
      )}
    />
  )
}
