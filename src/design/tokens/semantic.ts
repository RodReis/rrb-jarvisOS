/**
 * Tokens semânticos (SPEC-DesignSystem-02, PRD §9.1; README §2.2/§2.3).
 *
 * Duas famílias, com regras opostas de mutabilidade:
 *
 * - **`STATUS` / `RISCO`** — cores do protótipo, **fixas**. Não invertem no claro e o usuário
 *   **não** as retematiza (PRD §15). O motivo é semântico, não estético: se "erro" pudesse ser
 *   verde porque alguém escolheu o acento verde, a cor pararia de significar erro.
 * - **`papeis()`** — os papéis de superfície/texto/borda, que **derivam** dos 71 tokens do
 *   protótipo conforme o modo. Aqui é onde o nome opaco (`jt16`) vira nome legível
 *   (`surfaceRaised`): componentes das fatias seguintes consomem só isto, nunca o `jt*` cru.
 */

import temaPrototipo from './tema-prototipo.json'

/** Semânticas de estado — README §2.3. Idênticas nos dois módulos e nos dois modos. */
export const STATUS = {
  ok: '#34d399',
  warn: '#f59e0b',
  err: '#ff6b81',
  info: '#7dd3fc',
  /** Memória / skills / knowledge. */
  violet: '#a78bfa'
} as const

/**
 * Níveis de risco do Policy Engine (MVP-002 F02).
 *
 * Mapeiam para as semânticas em vez de introduzir cores novas — risco *é* um estado, e duas
 * paletas para a mesma ideia divergiriam com o tempo.
 */
export const RISCO = {
  baixo: STATUS.ok,
  medio: STATUS.warn,
  alto: STATUS.err,
  bloqueado: STATUS.err
} as const

export type ModoUi = 'dark' | 'light'
export type Modulo = 'jarvis' | 'noa'

/**
 * Superfícies que **nunca invertem** — README §2.6, critério 2 da spec.
 *
 * Login, Choice, overlay de transição e Toasts permanecem sempre escuros: são identidade de
 * marca, não tela de trabalho. O claro/escuro se aplica **só** às telas internas.
 *
 * Isto é dado, não convenção implícita, porque a alternativa seria confiar em que ninguém
 * montaria o provider por engano em volta do Login. `superficieDeMarca()` é a checagem que
 * torna a regra verificável — e é a razão de a lista morar aqui, ao lado dos papéis, e não
 * espalhada em comentários das telas que ainda nem existem (F03b/F04a).
 */
export const SUPERFICIES_DE_MARCA = ['login', 'choice', 'transicao', 'toast'] as const

export type SuperficieDeMarca = (typeof SUPERFICIES_DE_MARCA)[number]

/** Telas internas — as únicas que respondem ao `uiTheme`. */
export const TELAS_INTERNAS = ['jarvis', 'noa'] as const

export type Superficie = SuperficieDeMarca | (typeof TELAS_INTERNAS)[number]

/** Uma superfície de marca ignora o `uiTheme` e lê sempre os valores escuros. */
export function superficieDeMarca(superficie: Superficie): boolean {
  return (SUPERFICIES_DE_MARCA as readonly string[]).includes(superficie)
}

/**
 * O modo **efetivo** de uma superfície.
 *
 * Telas internas seguem o `uiTheme` do usuário; superfícies de marca ficam em `dark` mesmo com
 * `uiTheme='light'`. Toda leitura de tema deveria passar por aqui — é o ponto único onde a
 * exceção da marca é aplicada, em vez de cada tela lembrar de aplicá-la.
 */
export function modoEfetivo(superficie: Superficie, uiTheme: ModoUi): ModoUi {
  return superficieDeMarca(superficie) ? 'dark' : uiTheme
}

interface MapaTema {
  readonly [token: string]: string
}

const TEMA: Readonly<Record<ModoUi, MapaTema>> = temaPrototipo

/**
 * Papéis de superfície/texto/borda por módulo e modo.
 *
 * O mapa `jt*`/`nt*` → papel foi lido do protótipo e do README §2.6 (tabela de pares). Só os
 * papéis que a tabela nomeia entram aqui; os demais tokens do protótipo continuam disponíveis
 * como dado bruto (`tokenDeTema`) para as fatias que forem portar telas específicas — inventar
 * papel para 71 tokens seria decidir escopo que não é meu.
 */
/**
 * Token de card por módulo.
 *
 * **Os índices de `jt*` e `nt*` são independentes** — não são duas numerações paralelas do
 * mesmo papel. `jt16` é o card do JARVIS (`rgba(24,27,33,.7)`), mas `nt16` é uma cor de
 * **texto** (`#c8d4ce`); o card do NOA é `nt2` (`rgba(22,27,25,.7)`).
 *
 * Derivar o nome por interpolação (`${prefixo}16`) parecia elegante e produzia campo com fundo
 * claro sobre página escura no NOA — texto ilegível, e nenhum teste de papel acusaria. O mapa
 * explícito é feio de propósito: ele obriga a conferir o token no dado em vez de supor.
 */
const CARD_POR_MODULO: Readonly<Record<Modulo, string>> = {
  jarvis: 'jt16',
  noa: 'nt2'
}

export function papeis(modulo: Modulo, modo: ModoUi) {
  const t = TEMA[modo]

  return {
    /** Fundo do app — README §2.6, linha "fundo app". */
    surface:
      modulo === 'jarvis'
        ? modo === 'dark'
          ? '#0a0b0e'
          : '#f5f6f8'
        : modo === 'dark'
          ? '#0b0d0d'
          : '#f2f4f2',
    /** Card — o token de cada módulo, do mapa explícito acima. */
    surfaceRaised: t[CARD_POR_MODULO[modulo]],
    textPrimary: modo === 'dark' ? '#eef1f5' : '#111316',
    textSecondary: modo === 'dark' ? '#9aa3b2' : '#27292d',
    /** Label mono / caption. */
    textMuted: modo === 'dark' ? '#6b7382' : '#44464b',
    /** RGB base da borda — o alfa é aplicado por uso (`borda(...)`). */
    borderRgb: bordaRgb(modulo, modo)
  } as const
}

/**
 * RGB base da borda — README §2.6: "o RGB base vira token preservando o alfa de cada uso".
 *
 * A borda é RGB e não cor pronta porque cada uso aplica um alfa diferente (`.08`–`.12` nas
 * divisórias, mais forte em foco). Congelar um alfa aqui obrigaria um token por opacidade.
 */
export function bordaRgb(modulo: Modulo, modo: ModoUi): string {
  if (modulo === 'jarvis') return modo === 'dark' ? '200,204,212' : '30,35,46'
  return modo === 'dark' ? '200,212,206' : '34,44,38'
}

/** Monta a cor de borda com o alfa do uso. */
export function borda(modulo: Modulo, modo: ModoUi, alfa: number): string {
  return `rgba(${bordaRgb(modulo, modo)},${alfa})`
}

/**
 * Acesso ao token bruto do protótipo, para as fatias que portarem telas específicas.
 *
 * Lança quando o token não existe: um `jt99` inventado devolveria `undefined`, e o CSS engole
 * valor indefinido em silêncio — a tela ficaria sutilmente errada sem nada falhar.
 */
export function tokenDeTema(token: string, modo: ModoUi): string {
  const valor = TEMA[modo][token]
  if (valor === undefined) {
    throw new Error(`Token de tema desconhecido: ${token} (modo ${modo}).`)
  }
  return valor
}
