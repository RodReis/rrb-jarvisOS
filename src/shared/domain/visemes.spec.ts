import { describe, expect, it } from 'vitest'
import { VISEMES, visemeDoFonema, type Viseme } from './visemes'

/**
 * O mapa fonema → viseme (SPEC-Voz-02, decisão do Cowork: mapa como dado versionado).
 *
 * O teste que importa não é "`p` vira `pbm`" — é **nenhum fonema do modelo cai fora**. O primeiro
 * afirma sobre uma linha; o segundo, sobre o mapa inteiro, que é o que impede a boca de travar
 * numa frase qualquer meses depois.
 */

/**
 * Os 152 símbolos do `phoneme_id_map` da `pt_BR-faber-medium`, lidos do arquivo de config da voz.
 *
 * Cravados aqui de propósito: o modelo mora em `userData` e só existe depois do download, então
 * ler dele em teste faria a suíte depender de rede. A lista é dado do catálogo Piper, estável por
 * revisão pinada — e se o catálogo mudar, é o teste que precisa saber primeiro.
 */
const FONEMAS_DO_MODELO = [
  '!',
  '"',
  '#',
  '$',
  "'",
  '(',
  ')',
  ',',
  '-',
  '.',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  ':',
  ';',
  '?',
  '^',
  '_',
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'q',
  'r',
  's',
  't',
  'u',
  'v',
  'w',
  'x',
  'y',
  'z',
  'æ',
  'ç',
  'ð',
  'ø',
  'ħ',
  'ŋ',
  'œ',
  'ǀ',
  'ǁ',
  'ǂ',
  'ǃ',
  'ɐ',
  'ɑ',
  'ɒ',
  'ɓ',
  'ɔ',
  'ɕ',
  'ɖ',
  'ɗ',
  'ɘ',
  'ə',
  'ɚ',
  'ɛ',
  'ɜ',
  'ɞ',
  'ɟ',
  'ɠ',
  'ɡ',
  'ɢ',
  'ɣ',
  'ɤ',
  'ɥ',
  'ɦ',
  'ɧ',
  'ɨ',
  'ɪ',
  'ɫ',
  'ɬ',
  'ɭ',
  'ɮ',
  'ɯ',
  'ɰ',
  'ɱ',
  'ɲ',
  'ɳ',
  'ɴ',
  'ɵ',
  'ɶ',
  'ɸ',
  'ɹ',
  'ɺ',
  'ɻ',
  'ɽ',
  'ɾ',
  'ʀ',
  'ʁ',
  'ʂ',
  'ʃ',
  'ʄ',
  'ʈ',
  'ʉ',
  'ʊ',
  'ʋ',
  'ʌ',
  'ʍ',
  'ʎ',
  'ʏ',
  'ʐ',
  'ʑ',
  'ʒ',
  'ʔ',
  'ʕ',
  'ʘ',
  'ʙ',
  'ʛ',
  'ʜ',
  'ʝ',
  'ʟ',
  'ʡ',
  'ʢ',
  'ʰ',
  'ʲ',
  'ˈ',
  'ˌ',
  'ː',
  'ˑ',
  '˞',
  'ˤ',
  '̃',
  '̧',
  '̩',
  '̪',
  '̯',
  'β',
  'ε',
  'θ',
  'χ',
  'ᵻ',
  '↑',
  '↓',
  'ⱱ'
] as const

/** Os fonemas que a `pt_BR-faber-medium` produziu de verdade no spike, com frases variadas. */
const FONEMAS_MEDIDOS_NO_SPIKE = [
  ' ',
  '$',
  ',',
  '.',
  '^',
  'a',
  'b',
  'd',
  'e',
  'i',
  'k',
  'm',
  'n',
  'o',
  'p',
  's',
  't',
  'u',
  'x',
  'ɐ',
  'ɛ',
  'ɡ',
  'ɾ',
  'ʊ',
  'ʒ',
  'ʲ',
  'ˈ',
  'ˌ',
  '̃'
] as const

describe('mapa fonema → viseme', () => {
  it('resolve todo fonema do modelo sem estourar', () => {
    for (const fonema of FONEMAS_DO_MODELO) {
      expect(VISEMES).toContain(visemeDoFonema(fonema))
    }
  })

  it('dá boca de verdade a todo fonema que a voz produziu no spike, menos os diacríticos', () => {
    // Os que sobram são acento (ˈ ˌ) e o espaço — modificam o vizinho ou são pausa, e boca parada
    // é a resposta certa para os três. Todo o resto tem que ter forma própria: um fonema audível
    // que resolvesse para `silencio` seria boca travada no meio da fala.
    const semFormaPropria = FONEMAS_MEDIDOS_NO_SPIKE.filter((f) => visemeDoFonema(f) === 'silencio')

    expect(semFormaPropria).toEqual([' ', '$', ',', '.', '^', 'ˈ', 'ˌ'])
  })

  it('agrupa por aparência, não por fonologia', () => {
    // p/b/m: surdo, sonoro e nasal — sons diferentes, boca idêntica. É o caso que prova que o
    // agrupamento é visual: um mapa organizado por fonologia separaria os três.
    expect(visemeDoFonema('p')).toBe<Viseme>('pbm')
    expect(visemeDoFonema('b')).toBe<Viseme>('pbm')
    expect(visemeDoFonema('m')).toBe<Viseme>('pbm')

    expect(visemeDoFonema('f')).toBe<Viseme>('fv')
    expect(visemeDoFonema('v')).toBe<Viseme>('fv')
  })

  it('trata o til combinante do português como nasal', () => {
    // O `ã` do espeak sai como dois símbolos: a vogal e o til. Sem entrada própria, o til cairia
    // no default e a boca abriria em `silencio` no meio de "não".
    expect(visemeDoFonema('̃')).toBe<Viseme>('nasal')
  })

  it('resolve fonema desconhecido para silêncio em vez de estourar', () => {
    // Voz de outro idioma pode trazer símbolo fora do mapa. Boca parada erra menos que exceção no
    // meio da fala — e menos que boca aleatória.
    expect(visemeDoFonema('ʬ')).toBe<Viseme>('silencio')
    expect(visemeDoFonema('')).toBe<Viseme>('silencio')
  })

  it('mantém o conjunto de visemes pequeno o bastante para a F04 desenhar', () => {
    // A spec pede ~12–15 formas. O teto não é estético: cada viseme é uma pose desenhada à mão.
    expect(VISEMES.length).toBeLessThanOrEqual(15)
    expect(new Set(VISEMES).size).toBe(VISEMES.length)
  })
})
