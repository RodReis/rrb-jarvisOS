import * as RadixTabs from '@radix-ui/react-tabs'
import { cx, FOCO, LABEL_MONO, TRANSICAO } from './base'

/**
 * Abas (PRD §11.3 — navegação dentro de uma tela).
 *
 * Nasceu com a reforma das Configurações (decisão do PI, 2026-08-30): a tela acumulou oito
 * seções de três MVPs num scroll único, e "muita informação numa tela" era a queixa literal.
 * Vive no DS, e não como layout local do Settings, pela regra de ouro do PRODUCT.md: *um módulo
 * novo nasce consistente sem que ninguém escreva CSS local* — a próxima tela com seções demais
 * usa este componente, não uma cópia.
 *
 * Radix por baixo, como todo primitivo com comportamento: o teclado do padrão WAI-ARIA
 * (setas, Home/End, roving tabindex) vem do primitivo, testado por quem o mantém — reescrevê-lo
 * aqui seria assumir a manutenção de um teclado que já existe pronto.
 *
 * **A aba ativa carrega borda e cor, nunca só cor** (princípio 2 do produto): o sublinhado no
 * acento é reforçado pelo peso e pela cor do texto, e some no `LABEL_MONO` suave quando
 * inativa. Quem olha de relance distingue pela forma; quem não vê cor, pelo peso.
 */

export interface AbaDefinicao {
  readonly valor: string
  readonly rotulo: string
}

interface TabsProps {
  /** Aba inicial. Não-controlado de propósito: qual aba está aberta é estado de UI local. */
  readonly padrao: string
  readonly abas: readonly AbaDefinicao[]
  /** Nome acessível da lista de abas — sem ele o leitor anuncia "lista de abas" sem dizer de quê. */
  readonly rotulo: string
  readonly children: React.ReactNode
}

export function Tabs({ padrao, abas, rotulo, children }: TabsProps): React.JSX.Element {
  return (
    <RadixTabs.Root defaultValue={padrao} className="flex flex-col gap-6">
      {/*
       * A lista rola horizontal em telas estreitas em vez de quebrar linha: uma segunda linha
       * de abas faria a primeira parecer conteúdo, e o padrão de abas perde o sentido quando
       * elas deixam de formar uma régua única.
       */}
      <RadixTabs.List
        aria-label={rotulo}
        className="flex gap-1 overflow-x-auto border-b border-[rgba(var(--jos-borda-rgb),0.14)]"
      >
        {abas.map((aba) => (
          <RadixTabs.Trigger
            key={aba.valor}
            value={aba.valor}
            className={cx(
              LABEL_MONO,
              TRANSICAO,
              FOCO,
              // -mb-px: a borda ativa cobre a régua da lista, colando aba e painel.
              '-mb-px shrink-0 border-b-2 border-transparent px-4 py-3',
              'hover:text-[var(--jos-cor-texto)]',
              'data-[state=active]:border-[var(--jos-cor-acento)] data-[state=active]:font-[var(--jos-peso-semi)] data-[state=active]:text-[var(--jos-cor-texto)]'
            )}
          >
            {aba.rotulo}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {children}
    </RadixTabs.Root>
  )
}

interface TabPanelProps {
  readonly valor: string
  readonly children: React.ReactNode
}

/**
 * O painel de uma aba. `tabIndex` fica no default do Radix (o painel recebe foco ao trocar),
 * que é o comportamento do padrão ARIA — o leitor de tela aterrissa no conteúdo novo, não na
 * lista de abas que acabou de deixar.
 */
export function TabPanel({ valor, children }: TabPanelProps): React.JSX.Element {
  return (
    <RadixTabs.Content value={valor} className={cx(FOCO, 'flex flex-col gap-8 outline-none')}>
      {children}
    </RadixTabs.Content>
  )
}
