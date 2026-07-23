import * as RadixSwitch from '@radix-ui/react-switch'
import { tokenCss } from '../tokens'

/**
 * Alternador liga/desliga — primeiro componente da camada `ui` (SPEC-DesignSystem-01).
 *
 * Encapsula o `Switch` do Radix: o consumidor importa daqui e **nunca** do
 * `@radix-ui/react-switch` (PRD §24 "Radix exposto"). O motivo não é estético — é que a
 * API do Radix vira contrato público do DS no dia em que um `patterns` a importa direto,
 * e trocar de primitivo passa a exigir tocar em todo consumidor.
 *
 * Por isso as props abaixo são uma lista fechada, escrita à mão: `extends
 * RadixSwitch.SwitchProps` reabriria a superfície inteira por herança.
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
      // Cor por token: o tema troca a variável, o componente não conhece a cor.
      style={{ backgroundColor: ligado ? tokenCss('cor-acento') : tokenCss('cor-superficie') }}
      className="inline-flex h-6 w-10 items-center rounded-full border border-current/20 transition disabled:opacity-50"
    >
      <RadixSwitch.Thumb className="block size-4 translate-x-1 rounded-full bg-current transition data-[state=checked]:translate-x-5" />
    </RadixSwitch.Root>
  )
}
