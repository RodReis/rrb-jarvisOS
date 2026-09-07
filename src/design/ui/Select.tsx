import * as RadixSelect from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import type { AtributosDoControle } from './Field'
import { ALTURA_CONTROLE, BORDA, cx, DESABILITADO, FOCO, SUPERFICIE, TRANSICAO } from './base'
import { useContainerDeOverlay } from '../tokens/provider'

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
  /*
   * O nó do `ProvedorDeTema` — o mesmo conserto que o FIX #107 aplicou aos `Overlays`, e que
   * **nunca chegou aqui**.
   *
   * Os tokens `--jos-*` são `style` inline no `div` do provider, não em `:root`. Sem `container`,
   * o Radix monta o portal no `<body>`, fora dessa subárvore, e lá **toda** variável resolve para
   * vazio: a lista sai sem fundo (transparente sobre o conteúdo), sem raio, sem sombra e sem
   * `z-index` — então qualquer elemento posicionado da página passa por cima dela.
   *
   * Foi exatamente o que a captura do PI mostrou nas duas telas de escolha de modelo: as opções
   * legíveis por cima da prosa atrás delas, e o botão da página cruzando o dropdown. O `Dialog` e
   * o `Popover` já estavam corrigidos; o `Select` e o `Combobox` ficaram para trás porque a
   * correção foi feita arquivo a arquivo, e ninguém varreu os outros `Portal` do DS.
   */
  const container = useContainerDeOverlay()

  return (
    <RadixSelect.Root value={valor} onValueChange={onMudar} disabled={desabilitado}>
      <RadixSelect.Trigger
        {...campo}
        style={{ height: ALTURA_CONTROLE }}
        className={cx(
          'inline-flex w-full items-center justify-between gap-2 rounded-[var(--jos-raio-card)] px-3.5',
          'text-[length:var(--jos-texto-corpo)] font-[family-name:var(--jos-fonte-corpo)] text-[var(--jos-cor-texto)]',
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

      <RadixSelect.Portal container={container}>
        <RadixSelect.Content
          position="popper"
          sideOffset={6}
          className={cx(
            /*
             * Largura pelo **conteúdo**, com o gatilho como piso — não `w-[trigger-width]`.
             *
             * O rótulo de modelo tem três segmentos ("Claude Code CLI · Opus 5 ·
             * claude-opus-5"), e numa coluna estreita a lista herdava a largura do campo e
             * truncava cada opção. O PI escolhia entre reticências. O teto na largura
             * disponível impede que a lista saia da janela ao crescer.
             */
            'z-[var(--jos-camada-overlay)] w-max overflow-hidden',
            'min-w-[var(--radix-select-trigger-width)]',
            'max-w-[min(var(--jos-tamanho-lista-maxima),var(--radix-select-content-available-width))]',
            // Teto de altura na altura disponível, e rolagem no viewport interno: um catálogo
            // de modelos que cresça acima da janela empurraria as últimas opções para fora da
            // tela — sem barra, sem sinal de que existem, e sem alcance por mouse.
            'max-h-[var(--radix-select-content-available-height)]',
            'rounded-[var(--jos-raio-card)] shadow-[var(--jos-sombra-card)]',
            BORDA,
            'bg-[var(--jos-cor-superficie-overlay)]'
          )}
        >
          <RadixSelect.Viewport className="max-h-[inherit] overflow-y-auto p-1">
            {opcoes.map((o) => (
              <RadixSelect.Item
                key={o.valor}
                value={o.valor}
                disabled={o.desabilitada}
                className={cx(
                  'relative flex cursor-default select-none items-center gap-2 rounded-[var(--jos-raio-chip)]',
                  'py-2 pl-8 pr-3 text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)] outline-none',
                  // Uma opção por linha: com o rótulo quebrando, o check da esquerda descolava
                  // da segunda linha e a lista deixava de se ler como uma coluna de escolhas.
                  'whitespace-nowrap',
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
