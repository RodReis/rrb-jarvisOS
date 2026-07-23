/**
 * AppShell e navegação (SPEC-DesignSystem-04a, critérios 1–5; protótipo JARVISOS §2 / NOA §2).
 *
 * O shell do protótipo é um grid de medidas fixas — `60px 232px 1fr` por `52px 1fr 34px` — e
 * **os dois espaços usam a mesma estrutura**, trocando só tokens e conteúdo. Isso não é
 * coincidência de layout: é a tese da base única aparecendo na maior peça do sistema. Um shell
 * por identidade seria a duplicação que o MVP-003 existe para evitar.
 *
 * Tudo entra por props. O DS não sabe o que é workspace, não consulta IPC e não decide para
 * onde navegar — quem faz isso é o renderer (`src/renderer/src/app/AppShell.tsx`), que compõe
 * estes blocos com o estado real. É o que mantém a fronteira da F01 verde e o que permite ao
 * teste montar o shell inteiro sem ponte nenhuma.
 */

import { ProvedorDeTema, FundoDaIdentidade } from '../tokens/provider'
import type { CorAcento } from '../tokens/acento'
import type { ModoUi, Modulo } from '../tokens/semantic'
import { cx } from '../ui/base'

/** Medidas do grid — protótipo JARVISOS §2 e NOA §2, idênticas nos dois espaços. */
export const GRID = {
  rail: '60px',
  sidebar: '232px',
  topbar: '52px',
  rodape: '34px'
} as const

export interface ItemDeNavegacao {
  readonly id: string
  readonly rotulo: string
  readonly ativo?: boolean
}

export interface GrupoDeNavegacao {
  readonly titulo: string
  readonly itens: readonly ItemDeNavegacao[]
}

/**
 * Grupo de navegação — protótipo NOA §2 ("mono uppercase, item ativo com barra/dot no acento").
 *
 * O item ativo é marcado por `aria-current="page"` **e** por dois sinais visuais (barra lateral
 * no acento + peso). Cor sozinha não serve: é a mesma regra de "estado nunca só por cor" que a
 * F03a firmou, e aqui ela vale para o item de menu como valia para o botão.
 */
export function NavigationGroup({
  grupo,
  onNavegar
}: {
  readonly grupo: GrupoDeNavegacao
  readonly onNavegar: (id: string) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="px-3 py-1 font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[var(--jos-tracking-label)] text-[var(--jos-cor-texto-suave)]">
        {grupo.titulo}
      </span>
      {grupo.itens.map((item) => (
        <button
          key={item.id}
          type="button"
          // `aria-current="page"` é o que o leitor de tela anuncia. As classes abaixo são
          // reforço visual — nunca a fonte da informação.
          aria-current={item.ativo === true ? 'page' : undefined}
          onClick={() => onNavegar(item.id)}
          className={cx(
            'relative rounded-[var(--jos-raio-chip-largo)] px-3 py-2 text-left',
            'text-[length:var(--jos-texto-corpo)]',
            'transition-[background-color,color] duration-[var(--jos-duracao-rapida)]',
            'outline-none focus-visible:ring-1 focus-visible:ring-[var(--jos-cor-acento)]',
            item.ativo === true
              ? 'font-[var(--jos-peso-medio)] text-[var(--jos-cor-texto)] before:absolute before:left-0 before:top-1/2 before:h-4 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-[var(--jos-cor-acento)]'
              : 'text-[var(--jos-cor-texto-secundario)] hover:bg-[rgba(var(--jos-borda-rgb),0.06)]'
          )}
        >
          {item.rotulo}
        </button>
      ))}
    </div>
  )
}

export interface ItemDoRail {
  readonly id: string
  readonly rotulo: string
  readonly icone: React.ReactNode
  readonly ativo?: boolean
}

/**
 * Rail (60px) — a coluna de ícones. No JARVIS é o **rail dual** (Command Center ⇄ Agents OS,
 * critério 3); no NOA são atalhos de view. A estrutura é a mesma; o conteúdo vem por prop.
 *
 * Cada botão carrega `aria-label` **e** `title`: só ícone, sem rótulo visível, exige nome
 * acessível — senão o leitor de tela anuncia "botão" e o usuário de mouse não descobre o que é
 * sem clicar.
 */
export function Rail({
  itens,
  rodape,
  onSelecionar,
  topo
}: {
  readonly itens: readonly ItemDoRail[]
  /** Itens do fim do rail (atalho para o outro espaço, sair) — protótipo JARVISOS §2. */
  readonly rodape?: readonly ItemDoRail[]
  readonly onSelecionar: (id: string) => void
  /** O mascote da identidade, quando houver (Fatia 05). */
  readonly topo?: React.ReactNode
}): React.JSX.Element {
  const botao = (item: ItemDoRail): React.JSX.Element => (
    <button
      key={item.id}
      type="button"
      aria-label={item.rotulo}
      title={item.rotulo}
      aria-current={item.ativo === true ? 'page' : undefined}
      onClick={() => onSelecionar(item.id)}
      className={cx(
        'grid size-10 place-items-center rounded-[var(--jos-raio-chip-largo)] border',
        'transition-[background-color,border-color,color] duration-[var(--jos-duracao-rapida)]',
        'outline-none focus-visible:ring-1 focus-visible:ring-[var(--jos-cor-acento)]',
        item.ativo === true
          ? 'border-[var(--jos-cor-acento)] bg-[rgba(var(--jos-borda-rgb),0.10)] text-[var(--jos-cor-acento-leitura)]'
          : 'border-transparent text-[var(--jos-cor-texto-secundario)] hover:bg-[rgba(var(--jos-borda-rgb),0.06)]'
      )}
    >
      {item.icone}
    </button>
  )

  return (
    <nav
      aria-label="Atalhos"
      data-jos-rail
      className="flex h-full flex-col items-center gap-2 border-r border-[rgba(var(--jos-borda-rgb),0.12)] py-3"
      style={{ width: GRID.rail }}
    >
      {topo}
      {itens.map(botao)}
      <div className="flex-1" />
      {rodape?.map(botao)}
    </nav>
  )
}

/**
 * Seletor de espaço (critério 2).
 *
 * `radiogroup` e não uma lista de botões: as opções são mutuamente exclusivas e o leitor de tela
 * precisa anunciar qual está ativa. É a mesma escolha do shell da fundação, preservada de
 * propósito — a SPEC-04a re-plataforma a aparência, não as garantias da SPEC-Fundacao-02.
 *
 * Note que a lista de espaços vem por prop: o DS não sabe que `Desenvolvimento` existe, muito
 * menos que ele deve ficar oculto. Essa é uma regra de produto, e quem a aplica é o renderer.
 */
export function WorkspaceSwitcher({
  espacos,
  ativo,
  onTrocar,
  rotulo
}: {
  readonly espacos: readonly { readonly id: string; readonly rotulo: string }[]
  readonly ativo: string
  readonly onTrocar: (id: string) => void
  readonly rotulo: string
}): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={rotulo} className="flex flex-col gap-1">
      {espacos.map((espaco) => {
        const selecionado = espaco.id === ativo
        return (
          <button
            key={espaco.id}
            type="button"
            role="radio"
            aria-checked={selecionado}
            onClick={() => onTrocar(espaco.id)}
            className={cx(
              'rounded-[var(--jos-raio-chip-largo)] border px-3 py-2 text-left',
              'text-[length:var(--jos-texto-corpo)]',
              'transition-[background-color,border-color] duration-[var(--jos-duracao-rapida)]',
              'outline-none focus-visible:ring-1 focus-visible:ring-[var(--jos-cor-acento)]',
              selecionado
                ? 'border-[var(--jos-cor-acento)] bg-[rgba(var(--jos-borda-rgb),0.10)] font-[var(--jos-peso-medio)] text-[var(--jos-cor-texto)]'
                : 'border-transparent text-[var(--jos-cor-texto-secundario)] hover:bg-[rgba(var(--jos-borda-rgb),0.06)]'
            )}
          >
            {espaco.rotulo}
          </button>
        )
      })}
    </div>
  )
}

/** Sidebar (232px) — cabeçalho da identidade + grupos de navegação + rodapé opcional. */
export function Sidebar({
  titulo,
  subtitulo,
  children,
  rodape
}: {
  readonly titulo: string
  readonly subtitulo?: string
  readonly children?: React.ReactNode
  readonly rodape?: React.ReactNode
}): React.JSX.Element {
  return (
    <aside
      aria-label={titulo}
      data-jos-sidebar
      className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto border-r border-[rgba(var(--jos-borda-rgb),0.12)] p-3"
      style={{ width: GRID.sidebar }}
    >
      <div className="flex flex-col gap-0.5 px-3 pt-1">
        <span className="font-[family-name:var(--jos-fonte-display)] text-[length:var(--jos-texto-realce)] text-[var(--jos-cor-texto)]">
          {titulo}
        </span>
        {subtitulo !== undefined && (
          <span className="font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[var(--jos-tracking-label)] text-[var(--jos-cor-texto-suave)]">
            {subtitulo}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-4">{children}</div>
      {rodape}
    </aside>
  )
}

/**
 * TopBar (52px) — rótulo da view, o toggle sol/lua e as ações à direita.
 *
 * O toggle é do **`uiTheme` global** (README §2.6, critério 1): ele não pertence à identidade,
 * por isso o mesmo controle serve os dois espaços e trocá-lo move os dois juntos. O acento, ao
 * contrário, **não** tem seletor aqui — a paleta vive na tela CHOICE (spec §Escopo), e o shell
 * só consome o acento ativo.
 */
export function TopBar({
  titulo,
  uiTheme,
  onAlternarTema,
  rotuloTema,
  children
}: {
  readonly titulo: string
  readonly uiTheme: ModoUi
  readonly onAlternarTema: () => void
  /** Rótulo acessível do toggle, já traduzido — o DS não conhece i18n. */
  readonly rotuloTema: string
  readonly children?: React.ReactNode
}): React.JSX.Element {
  return (
    <header
      data-jos-topbar
      className="flex shrink-0 items-center justify-between gap-4 border-b border-[rgba(var(--jos-borda-rgb),0.12)] px-4"
      style={{ height: GRID.topbar }}
    >
      <h1 className="truncate font-[family-name:var(--jos-fonte-display)] text-[length:var(--jos-texto-secao)] text-[var(--jos-cor-texto)]">
        {titulo}
      </h1>
      <div className="flex items-center gap-2">
        {children}
        <button
          type="button"
          onClick={onAlternarTema}
          aria-label={rotuloTema}
          // `aria-pressed` comunica o estado do toggle — sem ele, quem usa leitor de tela ouve
          // "botão" e não sabe se o modo claro está ligado ou desligado.
          aria-pressed={uiTheme === 'light'}
          data-jos-toggle-tema
          className={cx(
            'grid size-9 place-items-center rounded-[var(--jos-raio-chip-largo)] border',
            'border-[rgba(var(--jos-borda-rgb),0.18)] text-[var(--jos-cor-texto-secundario)]',
            'transition-[background-color,color] duration-[var(--jos-duracao-rapida)]',
            'outline-none focus-visible:ring-1 focus-visible:ring-[var(--jos-cor-acento)]',
            'hover:bg-[rgba(var(--jos-borda-rgb),0.08)]'
          )}
        >
          {/* Sol e lua como texto: o glifo carrega a informação mesmo sem CSS, e o
              `aria-label` acima é quem nomeia a ação de fato. */}
          <span aria-hidden>{uiTheme === 'light' ? '☾' : '☀'}</span>
        </button>
      </div>
    </header>
  )
}

/** Rodapé (34px) — protótipo NOA §2: "© RRB Trading + versão". */
export function ShellFooter({
  children
}: {
  readonly children?: React.ReactNode
}): React.JSX.Element {
  return (
    <footer
      data-jos-rodape
      className="flex shrink-0 items-center justify-between border-t border-[rgba(var(--jos-borda-rgb),0.12)] px-4 font-[family-name:var(--jos-fonte-mono)] text-[length:var(--jos-texto-micro)] uppercase tracking-[var(--jos-tracking-label)] text-[var(--jos-cor-texto-suave)]"
      style={{ height: GRID.rodape }}
    >
      {children}
    </footer>
  )
}

export interface AppShellProps {
  readonly modulo: Modulo
  readonly uiTheme: ModoUi
  readonly accentJarvis: CorAcento
  readonly accentNoa: CorAcento
  readonly rail: React.ReactNode
  readonly sidebar: React.ReactNode
  readonly topbar: React.ReactNode
  readonly rodape?: React.ReactNode
  readonly children?: React.ReactNode
}

/**
 * O shell: grid do protótipo, com a identidade ativa aplicada.
 *
 * As regiões chegam como `ReactNode` em vez de props de dados. O motivo é a **resiliência do
 * critério 4**: se o shell montasse a navegação a partir de um objeto de estado, uma falha ao
 * produzir esse objeto derrubaria o shell inteiro. Recebendo nós já construídos, o que falha é
 * o conteúdo — o rail, a sidebar e a topbar continuam de pé e navegáveis.
 */
export function AppShell({
  modulo,
  uiTheme,
  accentJarvis,
  accentNoa,
  rail,
  sidebar,
  topbar,
  rodape,
  children
}: AppShellProps): React.JSX.Element {
  return (
    <ProvedorDeTema
      uiTheme={uiTheme}
      modulo={modulo}
      superficie={modulo}
      accentJarvis={accentJarvis}
      accentNoa={accentNoa}
    >
      <FundoDaIdentidade
        className="flex h-full min-h-0 font-[family-name:var(--jos-fonte-corpo)] text-[var(--jos-cor-texto)]"
        data-jos-appshell={modulo}
      >
        {rail}
        {sidebar}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {topbar}
          <main className="min-h-0 flex-1 overflow-auto p-4">{children}</main>
          {rodape}
        </div>
      </FundoDaIdentidade>
    </ProvedorDeTema>
  )
}
