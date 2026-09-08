import { describe, expect, it } from 'vitest'
import {
  montarFala,
  timelineEstimada,
  timelineExata,
  type AlinhamentoDeFonema
} from './timeline-de-visemes'

/**
 * A timeline de visemes (SPEC-Voz-02, critérios 2 e 3).
 *
 * O critério 2 pede quatro propriedades — não-vazia, ordenada, sem sobreposição, cobrindo a
 * duração do áudio. Elas valem para os **dois** caminhos, e é isso que o critério 3 quer dizer com
 * "trocar o caminho não quebra consumidor": os testes de propriedade abaixo rodam contra os dois.
 */

const SR = 22050

/** Os primeiros fonemas de "Bom dia" medidos no spike com a `pt_BR-faber-medium`. */
const ALINHAMENTO_REAL: readonly AlinhamentoDeFonema[] = [
  { fonema: '^', amostras: 768 },
  { fonema: 'b', amostras: 512 },
  { fonema: 'ˈ', amostras: 512 },
  { fonema: 'o', amostras: 512 },
  { fonema: '̃', amostras: 512 },
  { fonema: 'n', amostras: 512 },
  { fonema: ' ', amostras: 512 },
  { fonema: 'd', amostras: 512 },
  { fonema: 'ʒ', amostras: 768 },
  { fonema: 'ˈ', amostras: 512 },
  { fonema: 'i', amostras: 512 },
  { fonema: 'ʲ', amostras: 768 },
  { fonema: '$', amostras: 512 }
]

function propriedadesDoCriterio2(eventos: readonly { startMs: number; endMs: number }[]): void {
  expect(eventos.length).toBeGreaterThan(0)

  for (const e of eventos) expect(e.endMs).toBeGreaterThan(e.startMs)

  for (let i = 1; i < eventos.length; i++) {
    // Ordenada E sem sobreposição de uma vez: o início de cada um é exatamente o fim do anterior.
    expect(eventos[i].startMs).toBeCloseTo(eventos[i - 1].endMs, 6)
  }
}

describe('timeline exata', () => {
  it('cumpre as quatro propriedades do critério 2', () => {
    const eventos = timelineExata(ALINHAMENTO_REAL, SR)
    propriedadesDoCriterio2(eventos)

    const totalAmostras = ALINHAMENTO_REAL.reduce((a, x) => a + x.amostras, 0)
    expect(eventos[0].startMs).toBeCloseTo(0, 6)
    expect(eventos[eventos.length - 1].endMs).toBeCloseTo((totalAmostras / SR) * 1000, 6)
  })

  it('funde fonemas vizinhos que dão a mesma boca', () => {
    // `p` e `b` são a mesma pose. Dois eventos fariam a F04 redesenhar a boca fechada no meio dela.
    const eventos = timelineExata(
      [
        { fonema: 'p', amostras: 1000 },
        { fonema: 'b', amostras: 1000 },
        { fonema: 'a', amostras: 1000 }
      ],
      SR
    )

    expect(eventos.map((e) => e.viseme)).toEqual(['pbm', 'aa'])
    expect(eventos[0].endMs).toBeCloseTo((2000 / SR) * 1000, 6)
  })

  it('ignora fonema de duração zero sem furar a timeline', () => {
    // Evento sem largura nunca seria desenhado, mas ocuparia um `startMs` e quebraria a
    // continuidade que o critério 2 exige.
    const eventos = timelineExata(
      [
        { fonema: 'a', amostras: 1000 },
        { fonema: 'f', amostras: 0 },
        { fonema: 'i', amostras: 1000 }
      ],
      SR
    )

    expect(eventos.map((e) => e.viseme)).toEqual(['aa', 'ih'])
    propriedadesDoCriterio2(eventos)
  })
})

describe('timeline estimada (plano B)', () => {
  const FONEMAS = ['^', 'b', 'o', 'n', ' ', 'd', 'i', 'a', '$']

  it('cumpre as mesmas quatro propriedades', () => {
    propriedadesDoCriterio2(timelineEstimada(FONEMAS, 1000))
  })

  it('termina exatamente na duração do áudio, e não perto dela', () => {
    // A âncora é o ponto do plano B. Durações absolutas por classe acumulariam erro a cada sílaba
    // e a boca pararia antes ou depois do som — o defeito que a spec manda evitar por construção.
    for (const duracao of [250, 1000, 3471, 12345]) {
      const eventos = timelineEstimada(FONEMAS, duracao)
      expect(eventos[eventos.length - 1].endMs).toBeCloseTo(duracao, 6)
      expect(eventos[0].startMs).toBeCloseTo(0, 6)
    }
  })

  it('dá mais tempo a vogal que a oclusiva', () => {
    // Distribuição uniforme faria a boca bater em metrônomo. `a` tem que segurar mais que `p`.
    const eventos = timelineEstimada(['p', 'a'], 1000)
    const [pbm, aa] = eventos

    expect(pbm.viseme).toBe('pbm')
    expect(aa.viseme).toBe('aa')
    expect(aa.endMs - aa.startMs).toBeGreaterThan(pbm.endMs - pbm.startMs)
  })

  it('devolve vazio para áudio de duração zero em vez de estourar', () => {
    expect(timelineEstimada(FONEMAS, 0)).toEqual([])
    expect(timelineEstimada([], 1000)).toEqual([])
  })
})

describe('montarFala escolhe o caminho pelo que o engine devolveu', () => {
  const pcm = new Int16Array(22050)

  it('usa o exato quando o alinhamento veio', () => {
    const fala = montarFala({
      pcm,
      sampleRate: SR,
      fonemas: ['b', 'o'],
      alinhamentos: ALINHAMENTO_REAL
    })

    expect(fala.timeline).toBe('exato')
    propriedadesDoCriterio2(fala.visemes)
  })

  it('cai no estimado quando o alinhamento veio VAZIO — o caso medido da edresson', () => {
    // O spike mediu: `pt_BR-edresson-low` devolve lista vazia **sem erro**, porque um fonema fora
    // do `phoneme_id_map` faz o Piper zerar o alinhamento inteiro. Tratar isso como "sem fonemas"
    // produziria timeline vazia — boca parada durante a fala toda, sem nada acusando.
    const fala = montarFala({ pcm, sampleRate: SR, fonemas: ['b', 'o', 'n'], alinhamentos: [] })

    expect(fala.timeline).toBe('estimado')
    propriedadesDoCriterio2(fala.visemes)
    expect(fala.visemes[fala.visemes.length - 1].endMs).toBeCloseTo(1000, 6)
  })

  it('cai no estimado quando o engine nem devolveu o campo', () => {
    const fala = montarFala({ pcm, sampleRate: SR, fonemas: ['b', 'o', 'n'] })

    expect(fala.timeline).toBe('estimado')
    propriedadesDoCriterio2(fala.visemes)
  })

  it('entrega o mesmo tipo nos dois caminhos — o contrafactual do critério 3', () => {
    // O consumidor (F04) não sabe qual caminho está ativo: mesmas chaves, mesmo formato. Se um dia
    // um dos caminhos ganhar um campo que o outro não tem, este teste é quem avisa.
    const exato = montarFala({
      pcm,
      sampleRate: SR,
      fonemas: ['b'],
      alinhamentos: ALINHAMENTO_REAL
    })
    const estimado = montarFala({ pcm, sampleRate: SR, fonemas: ['b', 'o', 'n'], alinhamentos: [] })

    expect(Object.keys(exato).sort()).toEqual(Object.keys(estimado).sort())
    expect(Object.keys(exato.visemes[0]).sort()).toEqual(Object.keys(estimado.visemes[0]).sort())
  })

  it('leva o sample rate da voz, que varia entre elas', () => {
    // `faber` roda a 22050 e `edresson` a 16000 (medido no spike). Constante fixa dessincronizaria
    // a timeline de uma das duas.
    const fala = montarFala({
      pcm: new Int16Array(16000),
      sampleRate: 16000,
      fonemas: ['a'],
      alinhamentos: [{ fonema: 'a', amostras: 16000 }]
    })

    expect(fala.sampleRate).toBe(16000)
    expect(fala.visemes[0].endMs).toBeCloseTo(1000, 6)
  })
})
