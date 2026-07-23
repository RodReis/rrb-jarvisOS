import * as RadixSelect from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import type { AtributosDoControle } from './Field'
import { ALTURA_CONTROLE, BORDA, cx, DESABILITADO, FOCO, SUPERFICIE, TRANSICAO } from './base'

/**
 * Seleção de uma opção (SPEC-DesignSystem-03a, PRD §11.2; critério 3).
 *
 * Encapsula o `Select` do Radix — teclado, `aria-activedescendant`, foco em portal e navegação
 * por digitação vêm prontos. A **superfície pública é própria**: o consumidor passa uma lista
 * de `{ valor, rotulo }` e não vê `Select.Root`/`Trigger`/`Portal`. Expor a composição do
 * Radix transformaria a API dele em contrato do DS, e trocar de primitivo passaria a quebrar
 * todo consumidor.
 *
 * O conteúdo vai para **portal** de propósito: um dropdown `position: absolute` dentro de um
 * container com `overflow: hidden` é cortado — armadilha clássica em painel com rolagem.
 */

export interface OpcaoSelect {
  readonly valor: string
  readonly rotulo: string
  readonly desabilitada?: boolean
}

interface SelectProps extends Partial<AtributosDoControle> {
  readonly valor: string
  readonly onMudar: (valor: string) => void
  readonly opcoes: readonly OpcaoSelect[]
  readonly placeholder?: string
  readonly desabilitado?: boolean
}

export function Select({
  valor,
  onMudar,
  opcoes,
  placeholder = 'Selecione',
  desabilitado = false,
  ...campo
}: SelectProps): React.JSX.Element {
  return (
    <RadixSelect.Root value={valor} onValueChange={onMudar} disabled={desabilitado}>
      <RadixSelect.Trigger
        {...campo}
        style={{ height: ALTURA_CONTROLE }}
        className={cx(
          'inline-flex w-full items-center justify-between gap-2 rounded-[var(--jos-raio-card)] px-3.5',
          'text-[14px] font-[family-name:var(--jos-fonte-corpo)] text-[var(--jos-cor-texto)]',
          BORDA,
          SUPERFICIE,
          'data-[placeholder]:text-[var(--jos-cor-texto-suave)]',
          'aria-[invalid=true]:border-[var(--jos-cor-err)]',
          FOCO,
          TRANSICAO,
          DESABILITADO
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon>
          <ChevronDown aria-hidden="true" className="size-4 opacity-70" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={6}
          className={cx(
            'z-[var(--jos-camada-overlay)] min-w-[var(--radix-select-trigger-width)] overflow-hidden',
            'rounded-[var(--jos-raio-card)] shadow-[var(--jos-sombra-card)]',
            BORDA,
            'bg-[var(--jos-cor-superficie-elevada)]'
          )}
        >
          <RadixSelect.Viewport className="p-1">
            {opcoes.map((o) => (
              <RadixSelect.Item
                key={o.valor}
                value={o.valor}
                disabled={o.desabilitada}
                className={cx(
                  'relative flex cursor-default select-none items-center gap-2 rounded-[var(--jos-raio-chip)]',
                  'py-2 pl-8 pr-3 text-[14px] text-[var(--jos-cor-texto)] outline-none',
                  'data-[highlighted]:bg-[color-mix(in_srgb,var(--jos-cor-acento)_14%,transparent)]',
                  'data-[disabled]:opacity-45'
                )}
              >
                {/* O item selecionado carrega **check + destaque**, não só cor de fundo. */}
                <RadixSelect.ItemIndicator className="absolute left-2 flex">
                  <Check aria-hidden="true" className="size-4" />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{o.rotulo}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}
