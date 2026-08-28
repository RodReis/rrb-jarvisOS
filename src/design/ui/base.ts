/**
 * Vocabulário compartilhado dos controles (SPEC-DesignSystem-03a).
 *
 * A gramática visual vem do protótipo (tela de login e as 41 telas de `docs/design/`): campo e
 * botão a **44px**, raio de card, borda neutra de baixo alfa, foco no acento, label pequena em
 * mono UPPERCASE. Só três dos dezesseis componentes desta fatia têm tela de referência — o
 * resto deriva desta gramática, em vez de inventar estética nova a cada arquivo.
 *
 * Mora aqui, e não em cada componente, porque "mesma forma de botão, mesmo vocabulário de
 * formulário" é o que separa um design system de um punhado de componentes parecidos. Se a
 * altura do `Input` e a do `Select` puderem divergir, um dia divergem.
 */

/**
 * Altura única dos controles.
 *
 * 44px é o alvo de toque do WCAG 2.2 SC 2.5.5 (AAA) — bem acima do mínimo AA de 24px
 * (SC 2.5.8) — e é a altura do campo e do botão no
 * protótipo. As densidades `comfortable`/`compact` foram **cortadas do MVP** (decisão do PI na
 * F02) — por isso uma constante, não uma escala: uma escala aqui seria a densidade voltando
 * pela porta lateral.
 */
export const ALTURA_CONTROLE = '44px'

/** Altura do controle compacto embutido (ícone dentro de campo, dot de status). */
export const ALTURA_INTERNA = '24px'

/**
 * Classes do anel de foco.
 *
 * `focus-visible` e não `focus`: o anel deve aparecer para quem navega por teclado e não a
 * cada clique de mouse. A borda muda **junto** com o anel — quem enxerga pouco contraste de
 * sombra ainda percebe a mudança de borda (PRD §14: foco visível e não encoberto).
 */
export const FOCO =
  'outline-none focus-visible:border-[var(--jos-cor-acento)] focus-visible:shadow-[0_0_0_1px_var(--jos-cor-acento),0_0_18px_-8px_var(--jos-cor-acento)]'

/** Borda neutra padrão — o RGB vem do tema, o alfa é do uso (README §2.6). */
export const BORDA = 'border border-[rgba(var(--jos-borda-rgb),0.12)]'

/** Superfície de campo/controle: levemente elevada sobre o fundo do app. */
export const SUPERFICIE = 'bg-[var(--jos-cor-superficie-elevada)]'

/**
 * Transição padrão dos controles.
 *
 * Anima só `border-color`, `box-shadow`, `background-color` e `opacity` — nunca propriedade de
 * layout. A duração vem do token, então `prefers-reduced-motion` a zera de uma vez (F02).
 */
export const TRANSICAO =
  'transition-[border-color,box-shadow,background-color,opacity,transform] duration-[var(--jos-duracao-rapida)] ease-[var(--jos-curva-padrao)]'

/**
 * Estado desabilitado.
 *
 * Opacidade **e** cursor: opacidade sozinha comunica só a quem enxerga bem o contraste. O
 * `aria-disabled`/`disabled` de cada componente é quem informa a tecnologia assistiva — a
 * classe é o reforço visual, nunca a fonte da informação.
 */
export const DESABILITADO = 'disabled:opacity-45 disabled:cursor-not-allowed'

/** Label pequena — README §3: mono UPPERCASE com tracking. */
export const LABEL_MONO =
  'font-[family-name:var(--jos-fonte-mono)] uppercase tracking-[var(--jos-tracking-label)] text-[length:var(--jos-texto-micro)] text-[var(--jos-cor-texto-suave)]'

/** Junta classes ignorando vazios — evita `class=" a  b"` com espaços duplos. */
export function cx(...partes: ReadonlyArray<string | false | null | undefined>): string {
  return partes.filter(Boolean).join(' ')
}

/**
 * Props que os primitivos Radix injetam ao compor com `asChild`.
 *
 * `asChild` **clona** o filho e injeta `ref`, handlers e atributos de estado nele. Um componente
 * que declara props à mão e descarta o resto joga tudo isso fora em silêncio: o primitivo fica
 * sem referência ao elemento, o foco inicial nunca acontece e os handlers não chegam ao DOM.
 *
 * O efeito real, encontrado na prova visual da F03b: o `AlertDialog` nunca focava o botão seguro
 * (quem navega por teclado entrava num diálogo destrutivo sem foco), e um `Tooltip` com `Button`
 * dentro **não abria** nem emitia `aria-describedby`. `Dialog` e `Drawer` funcionavam só porque
 * usam `<button>` nativo no `Close asChild`.
 *
 * A decisão 4 da F03a — "o wrapper declara props à mão" — continua valendo no que ela protegia:
 * **não** herdamos a superfície do primitivo por `extends SwitchProps`, e o consumidor segue sem
 * acesso à API do Radix. O que se abre aqui é só o contrato de composição do DOM. Lista fechada,
 * e não `...rest` aberto — um spread livre reabriria a porta que a F03a fechou de propósito.
 */
export interface PropsDeComposicao {
  readonly ref?: React.Ref<HTMLButtonElement>
  /** Handlers que os primitivos injetam no gatilho (Tooltip, Popover, Dropdown, AlertDialog). */
  readonly onPointerDown?: React.PointerEventHandler<HTMLButtonElement>
  readonly onPointerEnter?: React.PointerEventHandler<HTMLButtonElement>
  readonly onPointerLeave?: React.PointerEventHandler<HTMLButtonElement>
  readonly onPointerMove?: React.PointerEventHandler<HTMLButtonElement>
  readonly onFocus?: React.FocusEventHandler<HTMLButtonElement>
  readonly onBlur?: React.FocusEventHandler<HTMLButtonElement>
  readonly onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>
  readonly onMouseDown?: React.MouseEventHandler<HTMLButtonElement>
  /** Atributos ARIA e de estado que o primitivo controla — nunca escritos à mão pelo consumidor. */
  readonly id?: string
  readonly 'aria-expanded'?: boolean
  readonly 'aria-controls'?: string
  readonly 'aria-describedby'?: string
  readonly 'aria-haspopup'?: React.AriaAttributes['aria-haspopup']
  readonly 'data-state'?: string
}
