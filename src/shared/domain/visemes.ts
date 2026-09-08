/**
 * O contrato da timeline de bocas (SPEC-Voz-02, critério 2) e o mapa fonema → viseme.
 *
 * ## Por que viseme, e não fonema
 *
 * Um viseme é a **forma da boca**, não o som. Vários fonemas compartilham a mesma forma — `p`,
 * `b` e `m` são indistinguíveis olhando, e é por isso que leitura labial é difícil. A F04 anima
 * ~15 formas; animar 152 fonemas do IPA seria trabalho jogado fora, invisível na tela.
 *
 * Isto também é a fronteira: a F04 **não conhece fonema**. Trocar o engine de TTS, ou o caminho
 * que produz as durações, não chega até ela.
 *
 * ## Por que o mapa é dado, e não `switch`
 *
 * É tabela de tradução que vai crescer com cada idioma novo. Como `switch` espalhado no código,
 * cada voz nova viraria edição de lógica; como dado, é uma linha a mais — e um teste consegue
 * afirmar sobre ele inteiro (nenhum fonema do modelo cai fora), o que um `switch` não permite.
 */

/**
 * As formas de boca. Conjunto reduzido e **fechado**: a F04 desenha uma pose por valor.
 *
 * Segue o agrupamento clássico de Preston Blair (animação tradicional), que é por *aparência* e
 * não por fonologia — `f` e `v` moram juntos porque a boca faz a mesma coisa, ainda que um seja
 * surdo e o outro sonoro.
 */
export const VISEMES = [
  'silencio',
  'pbm',
  'fv',
  'th',
  'dnt',
  'kg',
  'ch',
  'sz',
  'rr',
  'aa',
  'ee',
  'ih',
  'oh',
  'ou',
  'nasal'
] as const

export type Viseme = (typeof VISEMES)[number]

/**
 * Um trecho da timeline: esta boca, deste instante até este.
 *
 * `endMs` é absoluto e não duração porque a F04 lê a timeline procurando "quem vale agora" a cada
 * quadro; com duração ela teria que somar tudo desde o começo a cada consulta.
 */
export interface VisemeEvent {
  readonly viseme: Viseme
  readonly startMs: number
  readonly endMs: number
}

/**
 * O que `speak()` devolve: o áudio e a timeline, mais o controle da fala em curso.
 *
 * **Handle, não blob** (decisão do Cowork na spec). A síntese é em bloco nesta fatia, mas F03, F04
 * e F05 consomem esta assinatura — quando o streaming por sentença vier, ele muda a implementação
 * do handle, não o que os três já escreveram.
 */
export interface SpeechHandle {
  /** PCM 16 bits mono, na taxa que a voz usa (varia por voz: faber 22050, edresson 16000). */
  readonly pcm: Int16Array
  readonly sampleRate: number
  readonly visemes: readonly VisemeEvent[]
  /**
   * Como a timeline foi obtida. Observável porque o critério 3 exige, e porque `estimado` é sinal
   * de que a voz perdeu o alinhamento — sem isto, uma regressão no engine passaria despercebida.
   */
  readonly timeline: 'exato' | 'estimado'
}

/** Uma voz instalada, do ponto de vista de quem escolhe em Settings. */
export interface VozInstalada {
  readonly id: string
  readonly rotulo: string
  /** Se esta voz devolve durações exatas por fonema, ou cai na estimativa (achado do spike). */
  readonly timeline: 'exato' | 'estimado'
}

/** O que falta para o app falar, e o que já dá para ouvir. */
export interface ProntidaoDoTts {
  readonly pronta: boolean
  /** Os ids dos artefatos de voz que ainda faltam. Vazio quando há voz no disco. */
  readonly faltando: readonly string[]
  readonly vozes: readonly VozInstalada[]
}

/**
 * O desfecho de uma fala, do ponto de vista de quem desenha a tela.
 *
 * Cada estado é uma **próxima ação** diferente, pela mesma régua do STT: `indisponivel` pede
 * baixar uma voz, `falhou` pede tentar de novo, `sem-texto` não pede nada. Fundir os dois
 * primeiros daria à primeira execução do app a ação errada.
 */
export type DesfechoDaFala =
  | { readonly estado: 'ok'; readonly fala: SpeechHandle }
  | { readonly estado: 'sem-texto' }
  | { readonly estado: 'indisponivel' }
  | { readonly estado: 'falhou'; readonly motivo: string }

/**
 * Fonema (IPA do espeak-ng) → viseme.
 *
 * Cobre os 152 símbolos do `phoneme_id_map` do Piper, não só os que o português usa: voz nova de
 * outro idioma não pode cair no vazio. Fonema desconhecido resolve para `silencio` em
 * `visemeDoFonema` — boca parada erra menos que boca aleatória.
 */
const MAPA: Readonly<Record<string, Viseme>> = {
  // Bilabiais: lábios fechados. A forma mais reconhecível de todas.
  p: 'pbm',
  b: 'pbm',
  m: 'pbm',
  ɓ: 'pbm',
  ʙ: 'pbm',
  ʘ: 'pbm',
  ɱ: 'pbm',

  // Labiodentais: dente no lábio inferior.
  f: 'fv',
  v: 'fv',
  ʋ: 'fv',
  ⱱ: 'fv',
  β: 'fv',
  ɸ: 'fv',

  // Dentais: língua entre os dentes. Raro em português, comum em inglês.
  θ: 'th',
  ð: 'th',

  // Alveolares: ponta da língua atrás dos dentes de cima.
  t: 'dnt',
  d: 'dnt',
  n: 'dnt',
  l: 'dnt',
  ɗ: 'dnt',
  ɖ: 'dnt',
  ʈ: 'dnt',
  ɳ: 'dnt',
  ɭ: 'dnt',
  ɬ: 'dnt',
  ɮ: 'dnt',
  ɺ: 'dnt',
  ɫ: 'dnt',
  ʎ: 'dnt',
  ɲ: 'dnt',
  ʟ: 'dnt',
  ɟ: 'dnt',

  // Velares e uvulares: fundo da boca. Pouca ação visível nos lábios.
  k: 'kg',
  ɡ: 'kg',
  g: 'kg',
  ŋ: 'kg',
  q: 'kg',
  ɢ: 'kg',
  ɠ: 'kg',
  ʛ: 'kg',
  ɴ: 'kg',
  x: 'kg',
  ɣ: 'kg',
  χ: 'kg',
  ʁ: 'kg',
  ħ: 'kg',
  ʕ: 'kg',
  ʔ: 'kg',
  ʡ: 'kg',
  ʢ: 'kg',
  ʜ: 'kg',
  h: 'kg',
  ɦ: 'kg',
  ɧ: 'kg',

  // Pós-alveolares: lábios arredondados e projetados.
  ʃ: 'ch',
  ʒ: 'ch',
  ʂ: 'ch',
  ʐ: 'ch',
  ɕ: 'ch',
  ʑ: 'ch',
  ʝ: 'ch',
  c: 'ch',

  // Sibilantes: dentes quase juntos.
  s: 'sz',
  z: 'sz',

  // Róticas.
  r: 'rr',
  ɾ: 'rr',
  ɹ: 'rr',
  ɻ: 'rr',
  ɽ: 'rr',
  ʀ: 'rr',
  ɰ: 'rr',

  // Vogais abertas: mandíbula baixa.
  a: 'aa',
  ɑ: 'aa',
  ɐ: 'aa',
  ɒ: 'aa',
  æ: 'aa',
  ʌ: 'aa',
  ɜ: 'aa',
  ɞ: 'aa',
  ɶ: 'aa',

  // Vogais médias anteriores: boca esticada.
  e: 'ee',
  ɛ: 'ee',
  ε: 'ee',
  ø: 'ee',
  œ: 'ee',
  ə: 'ee',
  ɘ: 'ee',
  ɚ: 'ee',
  ɵ: 'ee',

  // Vogais fechadas anteriores: fresta estreita.
  i: 'ih',
  ɪ: 'ih',
  y: 'ih',
  ʏ: 'ih',
  ɨ: 'ih',
  ᵻ: 'ih',
  j: 'ih',
  ʲ: 'ih',
  ɥ: 'ih',

  // Vogais médias posteriores: lábios arredondados.
  o: 'oh',
  ɔ: 'oh',
  ɤ: 'oh',

  // Vogais fechadas posteriores: lábios em bico.
  u: 'ou',
  ʊ: 'ou',
  ʉ: 'ou',
  ɯ: 'ou',
  w: 'ou',
  ʍ: 'ou',

  // Nasalidade: o til combinante do português. Marca o `ã`/`õ`, e a boca quase não muda.
  '̃': 'nasal',

  // Silêncio e marcação. O `^` e o `$` do Piper são início e fim de enunciado, o `_` é pausa —
  // todos boca parada, e é o que abre e fecha a timeline no lugar certo.
  ' ': 'silencio',
  '^': 'silencio',
  $: 'silencio',
  _: 'silencio',
  '.': 'silencio',
  ',': 'silencio',
  '!': 'silencio',
  '?': 'silencio',
  ';': 'silencio',
  ':': 'silencio',
  '-': 'silencio',
  '"': 'silencio',
  "'": 'silencio',
  '(': 'silencio',
  ')': 'silencio'
}

/**
 * Traduz um fonema. Desconhecido vira `silencio`.
 *
 * Diacrítico de acento (`ˈ`, `ˌ`), comprimento (`ː`) e afins não têm forma de boca própria — eles
 * modificam o fonema vizinho. Caem no default de propósito: quem desenha vê a boca continuar,
 * que é o que acontece de verdade.
 */
export function visemeDoFonema(fonema: string): Viseme {
  return MAPA[fonema] ?? 'silencio'
}
