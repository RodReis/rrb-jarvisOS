/**
 * Tokens-base do design system (SPEC-DesignSystem-02, PRD §9.1).
 *
 * Valores **extraídos do protótipo** (`docs/design/design-system/README.md` §2.5/§3/§6): a spec
 * manda fidelidade — onde protótipo e PRD divergirem sobre a experiência realizada, o protótipo
 * vence. O PRD governa só a forma de implementar (tipado, CSS variables, a11y).
 *
 * Esta camada é **primitiva**: nomes descrevem o valor (`raio.card`), não o papel na tela. Quem
 * dá papel é `semantic.ts`. A separação é o que permite trocar a cor de uma superfície sem
 * caçar todo lugar que usava aquele valor cru.
 */

/** Raios — README §2.5. */
export const RAIO = {
  /** Rail e ícones. */
  rail: '9px',
  /** Chips e pills pequenos. */
  chip: '5px',
  chipLargo: '8px',
  card: '10px',
  cardLargo: '12px',
  modal: '13px',
  modalLargo: '16px',
  /** Pill totalmente arredondada. */
  pill: '99px'
} as const

/** Espaçamento — README §2.5 ("gaps"). */
export const ESPACO = {
  lista: '9px',
  listaLargo: '10px',
  form: '10px',
  formLargo: '12px',
  layout: '12px',
  layoutLargo: '18px'
} as const

/**
 * Sombras — README §2.5.
 *
 * O glow do acento não entra aqui: ele depende da cor escolhida pelo usuário e é montado em
 * runtime (`sombraComGlow`), porque token estático não conhece o acento.
 */
export const SOMBRA = {
  card: '0 20px 46px -18px rgba(0,0,0,.9)'
} as const

/** Monta a sombra de card com o glow do acento — README §2.5. */
export function sombraComGlow(acento: string): string {
  return `${SOMBRA.card}, 0 0 30px -14px ${acento}`
}

/**
 * Movimento — README §6.
 *
 * "Durações 0.18–0.6s para UI; loops ambientais 2–30s; easing padrão cubic-bezier(.2,.7,.2,1)."
 * O respeito a `prefers-reduced-motion` é adição de a11y sobre o protótipo (spec § Movimento) e
 * vive no provider, não aqui: o token diz quanto dura, a preferência do usuário diz se dura.
 */
export const DURACAO = {
  rapida: '180ms',
  media: '280ms',
  lenta: '600ms'
} as const

export const CURVA = {
  /** Easing padrão de toda a UI do protótipo. */
  padrao: 'cubic-bezier(.2,.7,.2,1)',
  hover: 'ease'
} as const

/** Tipografia — README §3. */
export const FONTE = {
  /** Logotipos e títulos de tela. */
  display: "'Michroma', system-ui, sans-serif",
  /** Corpo, botões, cards, números grandes. Mantida inclusive em texto denso (decisão do PI). */
  corpo: "'Rajdhani', system-ui, sans-serif",
  /** Labels de seção, timestamps, terminais, badges, código. */
  mono: "'Share Tech Mono', ui-monospace, monospace"
} as const

export const PESO = {
  medio: '500',
  semi: '600',
  forte: '700'
} as const

/**
 * Escala tipográfica (PRD §9.1; register product: escala fixa em rem, não fluida).
 *
 * Razão ~1.15 entre passos — apertada de propósito: uma UI operacional tem muito mais níveis
 * de texto que uma página de marca, e contraste exagerado vira ruído. Os valores saem do
 * protótipo (label mono 11px, corpo 14px, título de tela 20–24px).
 *
 * Existe porque a Fatia 03a encontrou `text-[14px]` repetido em sete arquivos: tamanho de
 * fonte digitado à mão é onde a escala se desfaz sem ninguém perceber.
 */
export const TEXTO = {
  /** Label mono, caption, timestamp. */
  micro: '11px',
  /** Mensagem de campo, badge. */
  mini: '12px',
  /** Rótulo de botão em mono UPPERCASE. */
  acao: '13px',
  /** Corpo e controles — o tamanho padrão da UI. */
  corpo: '14px',
  /** Texto de destaque dentro de painel. */
  realce: '16px',
  /** Título de seção. */
  secao: '20px',
  /** Título de tela (Michroma). */
  tela: '24px'
} as const

/**
 * Tamanhos de caixa dos controles.
 *
 * `controle` é a altura única de campo e botão (44px): alvo de toque do WCAG 2.2 e a medida do
 * protótipo. As densidades `comfortable`/`compact` foram cortadas do MVP (decisão do PI na
 * F02), então isto é uma lista curta de papéis — não uma escala de espaçamento.
 */
export const TAMANHO = {
  /** Altura de campo, botão, select — toda a família alinha aqui. */
  controle: '44px',
  /**
   * Alvo mínimo de ponteiro — WCAG 2.2 SC 2.5.8, nível **AA**.
   *
   * Vale para todo controle que não tenha rótulo clicável ampliando a área. O checkbox e o
   * radio ficam abaixo disto na caixa desenhada (`marcador`) porque o `<label>` associado faz
   * parte do alvo; a alça do slider não tem nada adjacente, então usa esta medida.
   */
  alvoMinimo: '24px',
  /** Caixa de checkbox e radio. O alvo real é maior: o rótulo também é clicável. */
  marcador: '20px',
  /** Ícone dentro de controle. */
  icone: '16px',
  /** Ícone pequeno (mensagem de campo, indicador). */
  iconeMini: '14px'
} as const

/**
 * `letter-spacing` das labels pequenas — README §3: "toda label pequena e caption é Share Tech
 * Mono em UPPERCASE com letter-spacing 1.5–3px".
 */
export const ESPACAMENTO_LETRA = {
  label: '1.5px',
  labelLargo: '3px',
  /** Títulos em Michroma: 2–6px. */
  titulo: '2px',
  tituloLargo: '6px'
} as const

/**
 * Camadas de empilhamento (PRD §9.1).
 *
 * O protótipo não declara escala de z-index — usa valores avulsos. Aqui a escala é nomeada
 * porque componentes reutilizáveis precisam saber quem cobre quem sem inspecionar o vizinho.
 */
export const CAMADA = {
  base: 0,
  elevado: 10,
  overlay: 100,
  modal: 200,
  toast: 300
} as const

/** Breakpoints (PRD §9.1). O app é desktop; os pontos existem para densidade de janela. */
export const BREAKPOINT = {
  estreito: '900px',
  largo: '1280px',
  amplo: '1600px'
} as const
