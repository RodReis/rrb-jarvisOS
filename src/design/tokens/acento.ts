/**
 * Acento do usuário (SPEC-DesignSystem-02; README §2.4).
 *
 * **Paleta fechada de 8 swatches**, não color picker livre — o usuário escolhe por módulo na
 * tela CHOICE. Ser um conjunto conhecido é o que permite pré-calcular o ajuste de contraste em
 * vez de validar cor arbitrária em runtime.
 */

import type { ModoUi, Modulo } from './semantic'

/** As 8 cores oferecidas, em ambos os módulos — README §2.4. */
export const PALETA_ACENTO = [
  '#D3AF37',
  '#FF2C2C',
  '#2CFF05',
  '#2323FF',
  '#C4C4C4',
  '#FFFFE3',
  '#8A00C4',
  '#FF5C00'
] as const

export type CorAcento = (typeof PALETA_ACENTO)[number]

/** Default de fábrica por módulo — README §2.4. */
export const ACENTO_PADRAO: Readonly<Record<Modulo, CorAcento>> = {
  jarvis: '#FF5C00',
  noa: '#C4C4C4'
}

/**
 * Helper de alfa — README §2.4: concatena um byte hex ao `#rrggbb`.
 *
 * Os bytes usados no protótipo: `'1a'`/`'20'`/`'33'` (brilhos suaves), `'59'` 35%, `'80'` 50%,
 * `'b3'` 70%, `'cc'` 80%.
 */
export function hexA(hex: string, alfaHex: string): string {
  return `${hex}${alfaHex}`
}

/** Converte `#rrggbb` em canais 0–255. */
function paraRgb(hex: string): readonly [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Luminância relativa (WCAG 2.x) — insumo do cálculo de contraste.
 *
 * A fórmula é a da especificação, não uma aproximação: o critério de aceite fala em "contraste
 * legível", e uma média ingênua de canais erraria justamente nas cores saturadas da paleta
 * (o verde `#2CFF05` é muito mais luminoso que o azul `#2323FF` com canais de valor parecido).
 */
export function luminancia(hex: string): number {
  const canais = paraRgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2]
}

/** Razão de contraste WCAG entre duas cores (1:1 a 21:1). */
export function contraste(corA: string, corB: string): number {
  const a = luminancia(corA)
  const b = luminancia(corB)
  const [claro, escuro] = a > b ? [a, b] : [b, a]
  return (claro + 0.05) / (escuro + 0.05)
}

/** Contraste mínimo para texto normal — WCAG 2.2 AA (PRD §14). */
export const CONTRASTE_MINIMO = 4.5

/** Ajusta a luminância de um hex mantendo hue e saturação (conversão via HSL). */
function ajustarLuminancia(hex: string, deltaL: number): string {
  const [r, g, b] = paraRgb(hex).map((c) => c / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min

  let h = 0
  let s = 0
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else h = ((r - g) / d + 4) / 6
  }

  const novoL = Math.min(1, Math.max(0, l + deltaL))

  const hue = (p: number, q: number, t: number): number => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }

  const q = novoL < 0.5 ? novoL * (1 + s) : novoL + s - novoL * s
  const p = 2 * novoL - q
  const canais =
    s === 0 ? [novoL, novoL, novoL] : [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)]

  const byte = (v: number): string =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${canais.map(byte).join('')}`
}

/**
 * Ajuste de tom **só para leitura** (decisão do PI, 2026-07-21).
 *
 * O acento é **preservado** como identidade nas superfícies de marca — borda, glow, fill, dot.
 * Só quando ele renderiza **texto legível** e o contraste falha (sobretudo no claro) a
 * luminância é empurrada até atingir leitura. Nunca rejeita a cor, nunca toca semânticas.
 *
 * Não é o gate de "rejeitar com explicação" do PRD §9.3: aquilo barraria a escolha do usuário;
 * isto a mantém e conserta só o contexto onde ela seria ilegível.
 *
 * O passo é pequeno e iterado em vez de calculado de uma vez porque a relação entre luminância
 * HSL e contraste WCAG não é linear — chutar um delta erraria para mais ou para menos.
 */
export function acentoParaLeitura(acento: string, fundo: string): string {
  if (contraste(acento, fundo) >= CONTRASTE_MINIMO) return acento

  // Fundo claro pede acento mais escuro, e vice-versa.
  const direcao = luminancia(fundo) > 0.5 ? -1 : 1
  let candidato = acento

  for (let passo = 0; passo < 40; passo++) {
    candidato = ajustarLuminancia(candidato, direcao * 0.025)
    if (contraste(candidato, fundo) >= CONTRASTE_MINIMO) return candidato
  }

  // Saturou o ajuste sem atingir a régua: devolve o extremo alcançado, que ainda lê melhor que
  // o original. Preto/branco puro resolveria o número, mas apagaria a identidade — e preservar
  // a cor escolhida é o ponto da decisão do PI.
  return candidato
}

/**
 * Cor de texto legível **sobre** uma cor de preenchimento.
 *
 * Diferente de `acentoParaLeitura`, que ajusta o acento para ser lido *sobre o fundo da tela*:
 * aqui o acento **é** o fundo (botão primário sólido), e o que se escolhe é o rótulo. Preto ou
 * branco, o que der mais contraste — não há terceira opção que ajude, e inventar um cinza
 * intermediário só reduziria a legibilidade.
 *
 * Nasceu da correção do colapso da ação primária (`/impeccable critique`, F03a): com fundo
 * sólido no acento, o rótulo não pode mais herdar a cor de texto da tela.
 */
export function contrasteSobre(fundo: string): '#000000' | '#ffffff' {
  return contraste('#000000', fundo) >= contraste('#ffffff', fundo) ? '#000000' : '#ffffff'
}

/**
 * Variante de **leitura** de uma cor semântica.
 *
 * As semânticas (`ok/warn/err/info/violet`) são cores de marca do protótipo e não invertem com
 * o modo (PRD §15) — mas foram desenhadas para fundo escuro. Como **texto no modo claro** todas
 * as cinco falham a régua de 4.5:1: `err` 2.53:1, `violet` 2.52:1, `warn` 1.99:1, `ok` 1.78:1,
 * `info` 1.54:1. Medido no `/impeccable critique` da F03a; o PRODUCT.md exige contraste nos
 * **dois** modos ("o claro é canônico, não uma cortesia").
 *
 * A solução é a mesma que o acento já usava: preservar a cor como identidade em borda, glow e
 * preenchimento, e ajustar **só a luminância** onde ela renderiza texto. O que muda é que agora
 * as semânticas também passam por isso — antes só o acento passava, e o teste afirmava a cor
 * literal sem nunca medir o contraste.
 */
export function semanticaParaLeitura(cor: string, fundo: string): string {
  return acentoParaLeitura(cor, fundo)
}

/**
 * Ajuste pré-calculado para as 8 cores × 2 modos.
 *
 * A paleta é fechada e conhecida (README §2.4), então o resultado é determinístico e cabe numa
 * tabela — sem picker, sem validação de cor arbitrária em runtime.
 */
export function tabelaLeitura(fundoPorModo: Readonly<Record<ModoUi, string>>) {
  const modos: readonly ModoUi[] = ['dark', 'light']
  return Object.fromEntries(
    modos.map((modo) => [
      modo,
      Object.fromEntries(
        PALETA_ACENTO.map((cor) => [cor, acentoParaLeitura(cor, fundoPorModo[modo])])
      )
    ])
  ) as Record<ModoUi, Record<CorAcento, string>>
}
