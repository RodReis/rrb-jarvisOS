import { useId } from 'react'
import * as RadixCheckbox from '@radix-ui/react-checkbox'
import * as RadixRadioGroup from '@radix-ui/react-radio-group'
import * as RadixSlider from '@radix-ui/react-slider'
import { Check, Minus } from 'lucide-react'
import type { AtributosDoControle } from './Field'
import { cx, DESABILITADO, FOCO, LABEL_MONO, SUPERFICIE, TRANSICAO } from './base'

/**
 * Controles de escolha e faixa (SPEC-DesignSystem-03a, PRD §11.2; critério 3).
 *
 * Todos sobre Radix, todos com **superfície pública própria**: o consumidor nunca importa
 * `@radix-ui/*` nem compõe `Root`/`Item`/`Indicator`. O que ele passa é dado (`opcoes`,
 * `valor`) e callbacks tipados.
 *
 * O alvo de toque respeita WCAG 2.2 (2.5.8): a caixa desenhada tem 18–20px, mas a área
 * clicável inclui o rótulo, que é o que o `label` envolvente garante.
 */

const CAIXA = cx(
  'flex size-[20px] shrink-0 items-center justify-center rounded-[5px] border',
  'border-[rgba(var(--jos-borda-rgb),0.24)]',
  SUPERFICIE,
  // Marcado: fundo no acento **e** o ícone de check. O ícone é o que sobrevive ao alto
  // contraste e ao daltonismo — cor sozinha não comunica estado (critério 2).
  'data-[state=checked]:border-[var(--jos-cor-acento)]',
  'data-[state=checked]:bg-[color-mix(in_srgb,var(--jos-cor-acento)_22%,transparent)]',
  'data-[state=indeterminate]:border-[var(--jos-cor-acento)]',
  FOCO,
  TRANSICAO,
  DESABILITADO
)

interface CheckboxProps extends Partial<AtributosDoControle> {
  readonly rotulo: string
  readonly marcado: boolean | 'indeterminado'
  readonly onMudar: (marcado: boolean) => void
  readonly desabilitado?: boolean
}

export function Checkbox({
  rotulo,
  marcado,
  onMudar,
  desabilitado = false,
  ...campo
}: CheckboxProps): React.JSX.Element {
  const id = useId()
  const estado = marcado === 'indeterminado' ? 'indeterminate' : marcado

  return (
    <div className="flex items-center gap-2.5">
      <RadixCheckbox.Root
        {...campo}
        id={id}
        checked={estado}
        onCheckedChange={(v) => onMudar(v === true)}
        disabled={desabilitado}
        className={CAIXA}
      >
        <RadixCheckbox.Indicator className="text-[var(--jos-cor-acento-leitura)]">
          {marcado === 'indeterminado' ? (
            <Minus aria-hidden="true" className="size-3.5" />
          ) : (
            <Check aria-hidden="true" className="size-3.5" />
          )}
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      {/* O rótulo é clicável: amplia o alvo muito além dos 20px da caixa. */}
      <label
        htmlFor={id}
        className={cx(
          'cursor-pointer text-[14px] text-[var(--jos-cor-texto)]',
          desabilitado && 'cursor-not-allowed opacity-45'
        )}
      >
        {rotulo}
      </label>
    </div>
  )
}

export interface OpcaoRadio {
  readonly valor: string
  readonly rotulo: string
  readonly desabilitada?: boolean
}

interface RadioGroupProps extends Partial<AtributosDoControle> {
  readonly valor: string
  readonly onMudar: (valor: string) => void
  readonly opcoes: readonly OpcaoRadio[]
  readonly desabilitado?: boolean
  /** Nome acessível do grupo — sem ele o leitor anuncia opções sem dizer do quê. */
  readonly rotulo?: string
  readonly orientacao?: 'vertical' | 'horizontal'
}

export function RadioGroup({
  valor,
  onMudar,
  opcoes,
  desabilitado = false,
  rotulo,
  orientacao = 'vertical',
  ...campo
}: RadioGroupProps): React.JSX.Element {
  return (
    <RadixRadioGroup.Root
      {...campo}
      value={valor}
      onValueChange={onMudar}
      disabled={desabilitado}
      aria-label={rotulo}
      orientation={orientacao}
      className={cx('flex gap-3', orientacao === 'vertical' ? 'flex-col' : 'flex-row flex-wrap')}
    >
      {opcoes.map((o) => (
        <ItemRadio key={o.valor} opcao={o} desabilitadoGrupo={desabilitado} />
      ))}
    </RadixRadioGroup.Root>
  )
}

function ItemRadio({
  opcao,
  desabilitadoGrupo
}: {
  readonly opcao: OpcaoRadio
  readonly desabilitadoGrupo: boolean
}): React.JSX.Element {
  const id = useId()
  const inativo = desabilitadoGrupo || opcao.desabilitada === true

  return (
    <div className="flex items-center gap-2.5">
      <RadixRadioGroup.Item
        id={id}
        value={opcao.valor}
        disabled={opcao.desabilitada}
        className={cx(
          'flex size-[20px] shrink-0 items-center justify-center rounded-full border',
          'border-[rgba(var(--jos-borda-rgb),0.24)]',
          SUPERFICIE,
          'data-[state=checked]:border-[var(--jos-cor-acento)]',
          FOCO,
          TRANSICAO,
          DESABILITADO
        )}
      >
        {/* Ponto interno preenchido: a marca é geométrica, não só cromática. */}
        <RadixRadioGroup.Indicator className="size-2.5 rounded-full bg-[var(--jos-cor-acento)]" />
      </RadixRadioGroup.Item>
      <label
        htmlFor={id}
        className={cx(
          'cursor-pointer text-[14px] text-[var(--jos-cor-texto)]',
          inativo && 'cursor-not-allowed opacity-45'
        )}
      >
        {opcao.rotulo}
      </label>
    </div>
  )
}

interface SliderProps extends Partial<AtributosDoControle> {
  readonly valor: number
  readonly onMudar: (valor: number) => void
  readonly minimo?: number
  readonly maximo?: number
  readonly passo?: number
  readonly desabilitado?: boolean
  readonly rotulo: string
  /** Formata o valor exibido — `(v) => v + '%'`, por exemplo. */
  readonly formatar?: (valor: number) => string
}

/**
 * Faixa numérica.
 *
 * O **valor aparece em texto** ao lado do controle, com algarismos tabulares: uma posição de
 * alça sozinha não informa o número, e quem usa lupa ou leitor de tela precisa do valor
 * legível. O `aria-valuetext` do Radix leva a versão formatada para a tecnologia assistiva.
 */
export function Slider({
  valor,
  onMudar,
  minimo = 0,
  maximo = 100,
  passo = 1,
  desabilitado = false,
  rotulo,
  formatar = (v) => String(v),
  ...campo
}: SliderProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <RadixSlider.Root
        {...campo}
        value={[valor]}
        onValueChange={([v]) => onMudar(v)}
        min={minimo}
        max={maximo}
        step={passo}
        disabled={desabilitado}
        aria-label={rotulo}
        aria-valuetext={formatar(valor)}
        className={cx(
          'relative flex h-5 w-full flex-1 touch-none select-none items-center',
          desabilitado && 'opacity-45'
        )}
      >
        <RadixSlider.Track className="relative h-1 w-full grow rounded-full bg-[rgba(var(--jos-borda-rgb),0.16)]">
          <RadixSlider.Range className="absolute h-full rounded-full bg-[var(--jos-cor-acento)]" />
        </RadixSlider.Track>
        <RadixSlider.Thumb
          className={cx(
            'block size-4 rounded-full border-2 border-[var(--jos-cor-acento)]',
            'bg-[var(--jos-cor-superficie-elevada)]',
            FOCO,
            TRANSICAO
          )}
        />
      </RadixSlider.Root>
      <span
        className={cx(
          LABEL_MONO,
          'w-12 shrink-0 text-right text-[var(--jos-cor-texto)] [font-variant-numeric:tabular-nums]'
        )}
      >
        {formatar(valor)}
      </span>
    </div>
  )
}
