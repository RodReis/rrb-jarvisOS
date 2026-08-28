import { useState } from 'react'
import * as RadixTooltip from '@radix-ui/react-tooltip'
import { ChevronRight } from 'lucide-react'
import { cx } from './base'

/**
 * Estrutura de dados (SPEC-DesignSystem-03b, PRD §11.4).
 *
 * Table, Tree, Tooltip e EmptyState — a estrutura que organiza informação. A forma vem das
 * listas do protótipo (`screens/jarvis/05-ops.png`, `08-ops.png`): linhas com hover, label mono
 * de cabeçalho, número tabular.
 */

export interface Coluna<T> {
  readonly chave: string
  readonly cabecalho: string
  /** Renderiza a célula. Recebe a linha inteira, não só um campo. */
  readonly celula: (linha: T) => React.ReactNode
  /** Alinha à direita — para números, que leem melhor alinhados pela unidade. */
  readonly numerica?: boolean
}

interface TableProps<T> {
  readonly colunas: ReadonlyArray<Coluna<T>>
  readonly linhas: readonly T[]
  /** Extrai a chave estável de cada linha — nunca o índice, que quebra ao reordenar. */
  readonly chaveDaLinha: (linha: T) => string
  /** Legenda da tabela — `<caption>`, obrigatória para o leitor de tela saber o que é a tabela. */
  readonly legenda: string
  readonly onLinhaClique?: (linha: T) => void
  /** O que mostrar quando não há linhas. */
  readonly vazio?: React.ReactNode
}

/**
 * Tabela de dados.
 *
 * `<table>` semântica de verdade — `<caption>`, `<th scope="col">`, `<tbody>`. Uma grade de
 * `<div>`s com `role="grid"` seria mais fácil de estilizar e pior em tudo o que importa:
 * navegação por células, anúncio de "coluna X, linha Y", e o modo tabela dos leitores de tela.
 * Números em coluna própria com `tabular-nums`.
 */
export function Table<T>({
  colunas,
  linhas,
  chaveDaLinha,
  legenda,
  onLinhaClique,
  vazio
}: TableProps<T>): React.JSX.Element {
  if (linhas.length === 0 && vazio !== undefined) {
    return <>{vazio}</>
  }

  return (
    <table className="w-full border-collapse text-[length:var(--jos-texto-corpo)]">
      <caption className="sr-only">{legenda}</caption>
      <thead>
        <tr className="border-b border-[rgba(var(--jos-borda-rgb),0.16)]">
          {colunas.map((c) => (
            <th
              key={c.chave}
              scope="col"
              className={cx(
                'px-3 py-2 font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)]',
                'uppercase tracking-[var(--jos-tracking-label)] text-[var(--jos-cor-texto-suave)]',
                c.numerica ? 'text-right' : 'text-left'
              )}
            >
              {c.cabecalho}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {linhas.map((linha) => {
          const clicavel = onLinhaClique !== undefined
          return (
            <tr
              key={chaveDaLinha(linha)}
              // Linha clicável recebe teclado: `tabIndex`, papel de botão e Enter/Espaço. Uma
              // `<tr onClick>` muda de cor no hover mas é inalcançável sem mouse.
              tabIndex={clicavel ? 0 : undefined}
              role={clicavel ? 'button' : undefined}
              onClick={clicavel ? () => onLinhaClique(linha) : undefined}
              onKeyDown={
                clicavel
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onLinhaClique(linha)
                      }
                    }
                  : undefined
              }
              className={cx(
                'border-b border-[rgba(var(--jos-borda-rgb),0.08)]',
                clicavel &&
                  cx(
                    'cursor-pointer hover:bg-[rgba(var(--jos-borda-rgb),0.06)]',
                    'focus-visible:outline-none focus-visible:bg-[color-mix(in_srgb,var(--jos-cor-acento)_10%,transparent)]'
                  )
              )}
            >
              {colunas.map((c) => (
                <td
                  key={c.chave}
                  className={cx(
                    'px-3 py-2.5 text-[var(--jos-cor-texto)]',
                    c.numerica && 'text-right [font-variant-numeric:tabular-nums]'
                  )}
                >
                  {c.celula(linha)}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export interface NoArvore {
  readonly id: string
  readonly rotulo: string
  readonly filhos?: readonly NoArvore[]
}

interface TreeProps {
  readonly nos: readonly NoArvore[]
  readonly rotulo: string
  readonly onSelecionar?: (id: string) => void
}

/**
 * Árvore de navegação — os grupos `Core / Harnesses / Teams` do rail do Agents OS.
 *
 * Segue o padrão ARIA `tree`: o container é `role="tree"`, cada nó é `treeitem`, e um nó com
 * filhos carrega `aria-expanded`. Sem esse contrato, é uma lista de indentações que o leitor de
 * tela lê como itens soltos, sem a hierarquia que a indentação sugere aos olhos.
 */
export function Tree({ nos, rotulo, onSelecionar }: TreeProps): React.JSX.Element {
  return (
    <ul role="tree" aria-label={rotulo} className="flex flex-col gap-0.5">
      {nos.map((no) => (
        <NoDaArvore key={no.id} no={no} nivel={1} onSelecionar={onSelecionar} />
      ))}
    </ul>
  )
}

function NoDaArvore({
  no,
  nivel,
  onSelecionar
}: {
  readonly no: NoArvore
  readonly nivel: number
  readonly onSelecionar?: (id: string) => void
}): React.JSX.Element {
  const [aberto, setAberto] = useState(true)
  const temFilhos = no.filhos !== undefined && no.filhos.length > 0

  return (
    <li role="treeitem" aria-expanded={temFilhos ? aberto : undefined}>
      <button
        type="button"
        onClick={() => {
          if (temFilhos) setAberto(!aberto)
          onSelecionar?.(no.id)
        }}
        style={{ paddingLeft: `${nivel * 12}px` }}
        className={cx(
          'flex w-full items-center gap-1.5 rounded-[var(--jos-raio-chip)] py-1.5 pr-2',
          'text-left text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto)]',
          'hover:bg-[rgba(var(--jos-borda-rgb),0.06)]',
          'focus-visible:outline-none focus-visible:bg-[color-mix(in_srgb,var(--jos-cor-acento)_10%,transparent)]'
        )}
      >
        {temFilhos ? (
          <ChevronRight
            aria-hidden="true"
            className={cx(
              'size-3.5 shrink-0 transition-transform duration-[var(--jos-duracao-rapida)]',
              aberto && 'rotate-90'
            )}
          />
        ) : (
          <span aria-hidden="true" className="size-3.5 shrink-0" />
        )}
        {no.rotulo}
      </button>
      {temFilhos && aberto && (
        <ul role="group" className="flex flex-col gap-0.5">
          {no.filhos?.map((filho) => (
            <NoDaArvore key={filho.id} no={filho} nivel={nivel + 1} onSelecionar={onSelecionar} />
          ))}
        </ul>
      )}
    </li>
  )
}

interface TooltipProps {
  readonly children: React.ReactNode
  readonly texto: string
}

/**
 * Dica contextual.
 *
 * Sobre Radix — hover **e** foco por teclado abrem (um tooltip só de hover é invisível para quem
 * navega por teclado), Escape fecha, e o texto é ligado ao gatilho por `aria-describedby`.
 *
 * Regra dura: tooltip é **complemento**, nunca a única fonte de uma informação essencial. Quem
 * usa toque não tem hover, e conteúdo crítico escondido atrás de um tooltip é conteúdo perdido.
 */
export function Tooltip({ children, texto }: TooltipProps): React.JSX.Element {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          sideOffset={6}
          className={cx(
            'z-[var(--jos-camada-overlay)] max-w-56 rounded-[var(--jos-raio-chip)] px-2.5 py-1.5',
            'border border-[rgba(var(--jos-borda-rgb),0.24)] bg-[var(--jos-cor-superficie-elevada)]',
            'text-[length:var(--jos-texto-mini)] text-[var(--jos-cor-texto)]',
            'shadow-[var(--jos-sombra-card)]'
          )}
        >
          {texto}
          <RadixTooltip.Arrow className="fill-[var(--jos-cor-superficie-elevada)]" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}

/** Provider do Tooltip — um por árvore, no topo do app. Exportado à parte por isso. */
export function TooltipProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  // `delayDuration` curto: 300ms é o suficiente para não disparar em passagem acidental do
  // mouse, sem fazer o usuário esperar quando ele de fato parou sobre o alvo.
  return <RadixTooltip.Provider delayDuration={300}>{children}</RadixTooltip.Provider>
}

interface EmptyStateProps {
  readonly titulo: string
  /** Explica **como sair** do vazio, não só que ele existe. */
  readonly descricao?: string
  readonly icone?: React.ReactNode
  /** Ação que preenche o vazio — "Criar o primeiro workflow". */
  readonly acao?: React.ReactNode
}

/**
 * Estado vazio.
 *
 * Ensina a interface em vez de dizer "nada aqui" (register product). O `titulo` diz o que
 * falta; a `descricao` diz como preencher; a `acao` faz. Um vazio que só informa a ausência
 * desperdiça o único momento em que o usuário está olhando para a lista errada.
 */
export function EmptyState({ titulo, descricao, icone, acao }: EmptyStateProps): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--jos-raio-card)] px-6 py-10 text-center">
      {icone !== undefined && (
        <span aria-hidden="true" className="text-[var(--jos-cor-texto-suave)]">
          {icone}
        </span>
      )}
      <p className="font-[var(--jos-peso-forte)] text-[length:var(--jos-texto-realce)] text-[var(--jos-cor-texto)]">
        {titulo}
      </p>
      {descricao !== undefined && (
        <p className="max-w-sm text-[length:var(--jos-texto-corpo)] text-[var(--jos-cor-texto-secundario)]">
          {descricao}
        </p>
      )}
      {acao !== undefined && <div className="pt-1">{acao}</div>}
    </div>
  )
}
