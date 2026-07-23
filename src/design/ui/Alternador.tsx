import * as RadixSwitch from '@radix-ui/react-switch'
import { cx, DESABILITADO, FOCO, TRANSICAO } from './base'

/**
 * Alternador liga/desliga (Switch) — nasceu na SPEC-DesignSystem-01 como primeiro componente
 * da camada `ui`; alinhado ao vocabulário de controles na 03a.
 *
 * Encapsula o `Switch` do Radix: o consumidor importa daqui e **nunca** do
 * `@radix-ui/react-switch` (PRD §24 "Radix exposto"). O motivo não é estético — é que a API do
 * Radix vira contrato público do DS no dia em que um `patterns` a importa direto, e trocar de
 * primitivo passa a exigir tocar em todo consumidor.
 *
 * Por isso as props são uma lista fechada, escrita à mão: `extends RadixSwitch.SwitchProps`
 * reabriria a superfície inteira por herança, e um `{...rest}` faria o mesmo em runtime.
 */

interface AlternadorProps {
  /** Rótulo acessível — o alternador não tem texto visível próprio. */
  readonly rotulo: string
  readonly ligado: boolean
  readonly onMudar: (ligado: boolean) => void
  readonly desabilitado?: boolean
}

export function Alternador({
  rotulo,
  ligado,
  onMudar,
  desabilitado = false
}: AlternadorProps): React.JSX.Element {
  return (
    <RadixSwitch.Root
      aria-label={rotulo}
      checked={ligado}
      onCheckedChange={onMudar}
      disabled={desabilitado}
      className={cx(
        'inline-flex h-6 w-11 shrink-0 items-center rounded-full border p-0.5',
        'border-[rgba(var(--jos-borda-rgb),0.48)] bg-[var(--jos-cor-superficie)]',
        // Ligado: fundo no acento **e** a alça desloca. A posição da alça é o que sobrevive ao
        // alto contraste e ao daltonismo — cor sozinha não comunica estado (critério 2).
        'data-[state=checked]:border-[var(--jos-cor-acento)]',
        'data-[state=checked]:bg-[color-mix(in_srgb,var(--jos-cor-acento)_40%,transparent)]',
        FOCO,
        TRANSICAO,
        DESABILITADO
      )}
    >
      <RadixSwitch.Thumb
        className={cx(
          'block size-4 rounded-full bg-[var(--jos-cor-texto)]',
          'transition-transform duration-[var(--jos-duracao-rapida)] ease-[var(--jos-curva-padrao)]',
          'data-[state=checked]:translate-x-5 data-[state=checked]:bg-[var(--jos-cor-acento)]'
        )}
      />
    </RadixSwitch.Root>
  )
}
