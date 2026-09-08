/**
 * De alinhamento de fonemas para timeline de bocas (SPEC-Voz-02, critérios 2 e 3).
 *
 * Os dois caminhos que a spec prevê moram aqui, e devolvem o **mesmo** tipo:
 *
 * - **exato** — o Piper devolve `num_samples` por fonema (achado do spike: `include_alignments`
 *   no `load` **e** no `synthesize`, cobertura de 100% do áudio);
 * - **estimado** — a voz perdeu o alinhamento e as durações são distribuídas por peso, ancoradas
 *   na duração **real** do áudio.
 *
 * ## Por que o plano B continua existindo
 *
 * O spike mediu que `pt_BR-edresson-low` devolve alinhamento **vazio, sem erro** — um fonema fora
 * do `phoneme_id_map` faz o Piper zerar a lista inteira com um log de debug. Decisão do PI em
 * 2026-09-08: manter a voz, com ela provando o plano B em produção. Por isso a escolha do caminho
 * olha o **retorno**, nunca a intenção de quem pediu.
 */

import { visemeDoFonema, type SpeechHandle, type VisemeEvent } from '@shared/domain/visemes'

/** O que o Piper devolve por fonema quando o alinhamento funciona. */
export interface AlinhamentoDeFonema {
  readonly fonema: string
  readonly amostras: number
}

/**
 * Pesos relativos de duração, por viseme, para o plano B.
 *
 * Não são milissegundos: são proporções normalizadas contra a duração real do áudio. Vogal segura
 * mais que oclusiva — `paz` tem o `a` mais longo que o `p` — e distribuir tudo igualmente faria a
 * boca abrir e fechar em metrônomo, que é pior que a estimativa grosseira.
 */
const PESO: Readonly<Record<string, number>> = {
  silencio: 0.6,
  pbm: 0.7,
  fv: 0.9,
  th: 0.9,
  dnt: 0.7,
  kg: 0.8,
  ch: 1.0,
  sz: 1.0,
  rr: 0.7,
  aa: 1.6,
  ee: 1.4,
  ih: 1.2,
  oh: 1.5,
  ou: 1.3,
  nasal: 1.1
}

/**
 * Timeline pelas durações reais do engine.
 *
 * Fonemas vizinhos que dão a **mesma** boca viram um evento só: `p` seguido de `b` é uma boca
 * fechada que dura os dois, e emitir dois eventos faria a F04 redesenhar a mesma pose no meio.
 */
export function timelineExata(
  alinhamentos: readonly AlinhamentoDeFonema[],
  sampleRate: number
): readonly VisemeEvent[] {
  const eventos: VisemeEvent[] = []
  let amostrasAteAqui = 0

  for (const { fonema, amostras } of alinhamentos) {
    const viseme = visemeDoFonema(fonema)
    const startMs = (amostrasAteAqui / sampleRate) * 1000
    amostrasAteAqui += amostras
    const endMs = (amostrasAteAqui / sampleRate) * 1000

    const anterior = eventos[eventos.length - 1]
    if (anterior !== undefined && anterior.viseme === viseme) {
      eventos[eventos.length - 1] = { viseme, startMs: anterior.startMs, endMs }
      continue
    }

    // Fonema de duração zero não vira evento: seria um instante sem largura, e a F04 nunca o
    // desenharia — mas ele quebraria a regra de "sem sobreposição" com o `startMs` do vizinho.
    if (endMs > startMs) eventos.push({ viseme, startMs, endMs })
  }

  return eventos
}

/**
 * Timeline estimada, ancorada na duração real do áudio.
 *
 * A âncora é o que impede a dessincronização no fim da frase: durações absolutas por classe de
 * fonema acumulariam erro a cada sílaba, e a boca terminaria de falar antes ou depois do som.
 * Distribuindo proporcionalmente, o último `endMs` **é** a duração do áudio, por construção.
 */
export function timelineEstimada(
  fonemas: readonly string[],
  duracaoMs: number
): readonly VisemeEvent[] {
  const visemes = fonemas.map(visemeDoFonema)
  const pesos = visemes.map((v) => PESO[v] ?? 1)
  const somaDosPesos = pesos.reduce((a, b) => a + b, 0)

  if (somaDosPesos === 0 || duracaoMs <= 0) return []

  const eventos: VisemeEvent[] = []
  let pesoAteAqui = 0

  for (let i = 0; i < visemes.length; i++) {
    const viseme = visemes[i]
    const startMs = (pesoAteAqui / somaDosPesos) * duracaoMs
    pesoAteAqui += pesos[i]
    const endMs = (pesoAteAqui / somaDosPesos) * duracaoMs

    const anterior = eventos[eventos.length - 1]
    if (anterior !== undefined && anterior.viseme === viseme) {
      eventos[eventos.length - 1] = { viseme, startMs: anterior.startMs, endMs }
      continue
    }

    if (endMs > startMs) eventos.push({ viseme, startMs, endMs })
  }

  return eventos
}

/**
 * Monta o handle escolhendo o caminho pelo que o engine **devolveu**.
 *
 * Alinhamento ausente ou vazio cai na estimativa. É aqui que o achado do spike vira código: pedir
 * alinhamento não garante recebê-lo, e tratar a lista vazia como "sem fonemas" produziria uma
 * timeline vazia — boca parada durante a fala inteira, sem nada acusando.
 */
export function montarFala(entrada: {
  readonly pcm: Int16Array
  readonly sampleRate: number
  readonly fonemas: readonly string[]
  readonly alinhamentos?: readonly AlinhamentoDeFonema[]
}): SpeechHandle {
  const { pcm, sampleRate, fonemas, alinhamentos } = entrada
  const duracaoMs = (pcm.length / sampleRate) * 1000

  if (alinhamentos !== undefined && alinhamentos.length > 0) {
    return {
      pcm,
      sampleRate,
      visemes: timelineExata(alinhamentos, sampleRate),
      timeline: 'exato'
    }
  }

  return {
    pcm,
    sampleRate,
    visemes: timelineEstimada(fonemas, duracaoMs),
    timeline: 'estimado'
  }
}
