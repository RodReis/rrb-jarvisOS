import { useEffect, useRef } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import * as RadixAlertDialog from '@radix-ui/react-alert-dialog'
import * as RadixPopover from '@radix-ui/react-popover'
import * as RadixDropdown from '@radix-ui/react-dropdown-menu'
import { X } from 'lucide-react'
import { Button } from './Button'
import { cx } from './base'

/**
 * Overlays (SPEC-DesignSystem-03b, PRD §11.5; critérios 1 e 3).
 *
 * Dialog, AlertDialog, Popover, DropdownMenu e Drawer — todos sobre Radix, todos com o que a
 * spec exige: focus-trap, `Escape` fecha, e o foco **retorna ao gatilho** ao fechar. Isso não é
 * detalhe: sem retorno de foco, quem navega por teclado fica perdido no topo da página cada vez
 * que fecha um modal. O Radix entrega os três de fábrica; o valor aqui é encapsulá-lo com
 * superfície própria (o consumidor não compõe `Root`/`Portal`/`Overlay`).
 *
 * O `backdrop` some no `prefers-reduced-motion` sem animar; o conteúdo sempre aparece (a
 * animação é enfeite da entrada, nunca gate da visibilidade).
 */

const BACKDROP = cx(
  'fixed inset-0 z-[var(--jos-camada-modal)] bg-[var(--jos-cor-backdrop)]',
  // Fade puro no backdrop: `surgir` inclui `translate`, que não se aplica a um overlay que
  // ocupa a tela inteira. `animate-in fade-in` é a versão só-opacidade.
  'data-[state=open]:animate-[aparecer_var(--jos-duracao-rapida)_ease-out]'
)

const PAINEL_MODAL = cx(
  'fixed left-1/2 top-1/2 z-[var(--jos-camada-modal)] w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2',
  'flex flex-col gap-4 rounded-[var(--jos-raio-modal)] p-5',
  'border border-[rgba(var(--jos-borda-rgb),0.16)] bg-[var(--jos-cor-superficie-elevada)]',
  'shadow-[var(--jos-sombra-card)]',
  'data-[state=open]:animate-[surgir_var(--jos-duracao-media)_ease-out]'
)

/**
 * Devolve o foco a quem abriu o overlay.
 *
 * O Radix já faz isso **quando ele é dono do gatilho** (`Trigger`), como em Popover e
 * DropdownMenu. Dialog, AlertDialog e Drawer aqui são controlados por prop (`aberto`) e não têm
 * `Trigger` — o Radix não tem como saber para onde voltar, e no fechamento o foco cai no
 * `<body>`. Quem navega por teclado volta ao topo do documento a cada modal fechado.
 *
 * Então guardamos o elemento focado no instante da abertura e o restauramos no fechamento. A
 * guarda `isConnected` cobre o caso de o gatilho ter saído do DOM enquanto o modal estava aberto
 * (uma linha de lista que o próprio modal excluiu): focar um nó órfão não faz nada, e insistir
 * seria pior que deixar o foco cair no body.
 */
function useRetornoDeFoco(aberto: boolean): void {
  const origem = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (aberto) {
      origem.current = document.activeElement as HTMLElement | null
      return
    }
    const alvo = origem.current
    origem.current = null
    if (alvo !== null && alvo.isConnected) alvo.focus()
  }, [aberto])
}

interface DialogProps {
  readonly aberto: boolean
  readonly onFechar: () => void
  readonly titulo: string
  /** Descrição — ligada por `aria-describedby`. Ausência é anunciada corretamente pelo Radix. */
  readonly descricao?: string
  readonly children: React.ReactNode
  readonly rodape?: React.ReactNode
}

/**
 * Modal de conteúdo — formulário, detalhe, confirmação **não** destrutiva.
 *
 * Para destrutivo, use `AlertDialog`: ele exige uma resposta e não fecha por clique fora.
 */
export function Dialog({
  aberto,
  onFechar,
  titulo,
  descricao,
  children,
  rodape
}: DialogProps): React.JSX.Element {
  useRetornoDeFoco(aberto)

  return (
    <RadixDialog.Root open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={BACKDROP} />
        <RadixDialog.Content className={PAINEL_MODAL}>
          <header className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <RadixDialog.Title className="font-[var(--jos-peso-forte)] text-[length:var(--jos-texto-secao)]">
                {titulo}
              </RadixDialog.Title>
              {descricao !== undefined && (
                <RadixDialog.Description className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
                  {descricao}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close asChild>
              <button
                type="button"
                aria-label="Fechar"
                className={cx(
                  'flex size-8 shrink-0 items-center justify-center rounded-[var(--jos-raio-chip)]',
                  'text-[var(--jos-cor-texto-suave)] hover:text-[var(--jos-cor-texto)]',
                  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--jos-cor-acento)]'
                )}
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </RadixDialog.Close>
          </header>
          <div className="flex flex-col gap-3">{children}</div>
          {rodape !== undefined && (
            <footer className="flex justify-end gap-3 pt-1">{rodape}</footer>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

interface AlertDialogProps {
  readonly aberto: boolean
  readonly onFechar: () => void
  readonly onConfirmar: () => void
  readonly titulo: string
  /** Mostra o **impacto** da ação antes da confirmação (PRD §7.4). */
  readonly descricao: string
  /**
   * Rótulo do botão de confirmação — **verbo específico**, nunca "OK" (critério 3).
   *
   * "Excluir 3 workflows" diz o que vai acontecer; "OK" pede fé. A spec cobra o verbo
   * específico como contrato: é o único componente onde este rótulo não tem default.
   */
  readonly verboConfirmar: string
  readonly destrutivo?: boolean
}

/**
 * Diálogo de confirmação — **o caminho de toda ação destrutiva** (critério 3).
 *
 * Diferente do `Dialog`: não fecha por clique fora nem por Escape casual sem intenção clara
 * (o Radix `AlertDialog` já impõe isso), e o foco inicial vai para o botão **seguro** (Cancelar),
 * não para o destrutivo — o usuário confirma por escolha, não por Enter reflexo.
 *
 * A regra da spec — "ação destrutiva usa AlertDialog, nunca só toast" — é de contrato: um toast
 * some sozinho e não coleta resposta; confirmar exclusão num toast seria confiar que o usuário
 * leu a tempo.
 */
export function AlertDialog({
  aberto,
  onFechar,
  onConfirmar,
  titulo,
  descricao,
  verboConfirmar,
  destrutivo = true
}: AlertDialogProps): React.JSX.Element {
  useRetornoDeFoco(aberto)

  return (
    <RadixAlertDialog.Root open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <RadixAlertDialog.Portal>
        <RadixAlertDialog.Overlay className={BACKDROP} />
        <RadixAlertDialog.Content className={PAINEL_MODAL}>
          <RadixAlertDialog.Title className="font-[var(--jos-peso-forte)] text-[length:var(--jos-texto-secao)]">
            {titulo}
          </RadixAlertDialog.Title>
          <RadixAlertDialog.Description className="text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
            {descricao}
          </RadixAlertDialog.Description>
          <footer className="flex justify-end gap-3 pt-1">
            {/* Cancelar recebe o foco inicial (o Radix o faz por padrão no primeiro tabbable, e a
                ordem aqui o coloca antes). O usuário confirma por escolha, não por reflexo. */}
            <RadixAlertDialog.Cancel asChild>
              <Button variante="secundaria">Cancelar</Button>
            </RadixAlertDialog.Cancel>
            <RadixAlertDialog.Action asChild>
              <Button variante={destrutivo ? 'perigo' : 'primaria'} onClick={onConfirmar}>
                {verboConfirmar}
              </Button>
            </RadixAlertDialog.Action>
          </footer>
        </RadixAlertDialog.Content>
      </RadixAlertDialog.Portal>
    </RadixAlertDialog.Root>
  )
}

interface PopoverProps {
  readonly gatilho: React.ReactNode
  readonly children: React.ReactNode
}

/**
 * Popover — conteúdo flutuante ancorado a um gatilho (filtro, seletor de cor, detalhe rápido).
 *
 * Vai para **portal** de propósito: dentro de um painel com `overflow: hidden`, um popover
 * posicionado por `absolute` seria cortado. Foco entra no conteúdo, Escape fecha, foco retorna.
 */
export function Popover({ gatilho, children }: PopoverProps): React.JSX.Element {
  return (
    <RadixPopover.Root>
      <RadixPopover.Trigger asChild>{gatilho}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          sideOffset={6}
          className={cx(
            'z-[var(--jos-camada-overlay)] w-64 rounded-[var(--jos-raio-card)] p-3',
            'border border-[rgba(var(--jos-borda-rgb),0.16)] bg-[var(--jos-cor-superficie-elevada)]',
            'shadow-[var(--jos-sombra-card)]',
            'data-[state=open]:animate-[surgir_var(--jos-duracao-rapida)_ease-out]'
          )}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  )
}

export interface ItemMenu {
  readonly rotulo: string
  readonly onSelecionar: () => void
  readonly destrutivo?: boolean
  readonly icone?: React.ReactNode
}

interface DropdownMenuProps {
  readonly gatilho: React.ReactNode
  readonly itens: readonly ItemMenu[]
}

/**
 * Menu de ações — o `⋯` que abre uma lista de comandos sobre um item.
 *
 * `role="menu"` de verdade (via Radix): setas navegam, Enter aciona, digitar salta para o item,
 * Escape fecha. Um menu de `<button>`s soltos num `<div>` perde tudo isso. Item destrutivo lê a
 * cor de erro — mas confirmação de destrutivo real continua sendo `AlertDialog`, não o clique
 * direto no menu.
 */
export function DropdownMenu({ gatilho, itens }: DropdownMenuProps): React.JSX.Element {
  return (
    <RadixDropdown.Root>
      <RadixDropdown.Trigger asChild>{gatilho}</RadixDropdown.Trigger>
      <RadixDropdown.Portal>
        <RadixDropdown.Content
          sideOffset={6}
          align="end"
          className={cx(
            'z-[var(--jos-camada-overlay)] min-w-44 rounded-[var(--jos-raio-card)] p-1',
            'border border-[rgba(var(--jos-borda-rgb),0.16)] bg-[var(--jos-cor-superficie-elevada)]',
            'shadow-[var(--jos-sombra-card)]'
          )}
        >
          {itens.map((item) => (
            <RadixDropdown.Item
              key={item.rotulo}
              onSelect={item.onSelecionar}
              className={cx(
                'flex cursor-default items-center gap-2 rounded-[var(--jos-raio-chip)] px-2.5 py-2',
                'text-[length:var(--jos-texto-corpo)] outline-none',
                'data-[highlighted]:bg-[rgba(var(--jos-borda-rgb),0.08)]',
                item.destrutivo === true
                  ? 'text-[var(--jos-cor-err-leitura)]'
                  : 'text-[var(--jos-cor-texto)]'
              )}
            >
              {item.icone !== undefined && (
                <span aria-hidden="true" className="inline-flex">
                  {item.icone}
                </span>
              )}
              {item.rotulo}
            </RadixDropdown.Item>
          ))}
        </RadixDropdown.Content>
      </RadixDropdown.Portal>
    </RadixDropdown.Root>
  )
}

interface DrawerProps {
  readonly aberto: boolean
  readonly onFechar: () => void
  readonly titulo: string
  readonly children: React.ReactNode
  readonly lado?: 'direita' | 'esquerda'
}

/**
 * Gaveta lateral — painel que desliza da borda (detalhes de um item, filtros extensos).
 *
 * Construída sobre o `Dialog` do Radix (mesmo focus-trap, Escape e retorno de foco), só com
 * posicionamento de borda em vez de centro. Não há primitivo `Drawer` no Radix; herdar o
 * `Dialog` é mais barato e mais correto que reimplementar o focus-trap.
 */
export function Drawer({
  aberto,
  onFechar,
  titulo,
  children,
  lado = 'direita'
}: DrawerProps): React.JSX.Element {
  useRetornoDeFoco(aberto)

  return (
    <RadixDialog.Root open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={BACKDROP} />
        <RadixDialog.Content
          className={cx(
            'fixed top-0 z-[var(--jos-camada-modal)] flex h-full w-[min(90vw,26rem)] flex-col gap-4 p-5',
            'border-[rgba(var(--jos-borda-rgb),0.16)] bg-[var(--jos-cor-superficie-elevada)]',
            'shadow-[var(--jos-sombra-card)]',
            lado === 'direita'
              ? 'right-0 border-l data-[state=open]:animate-[entrar-direita_var(--jos-duracao-media)_ease-out]'
              : 'left-0 border-r data-[state=open]:animate-[entrar-esquerda_var(--jos-duracao-media)_ease-out]'
          )}
        >
          <header className="flex items-center justify-between gap-4">
            <RadixDialog.Title className="font-[var(--jos-peso-forte)] text-[length:var(--jos-texto-secao)]">
              {titulo}
            </RadixDialog.Title>
            <RadixDialog.Close asChild>
              <button
                type="button"
                aria-label="Fechar"
                className={cx(
                  'flex size-8 shrink-0 items-center justify-center rounded-[var(--jos-raio-chip)]',
                  'text-[var(--jos-cor-texto-suave)] hover:text-[var(--jos-cor-texto)]',
                  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--jos-cor-acento)]'
                )}
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </RadixDialog.Close>
          </header>
          <div className="flex flex-1 flex-col gap-3 overflow-auto">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
