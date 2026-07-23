/**
 * Camada `tokens` do design system (SPEC-DesignSystem-01 e 02).
 *
 * Base da pirâmide: valores de design expostos como **CSS variables**, para que trocar de tema
 * (claro/escuro, NOA/JARVIS) troque variável e não classe. Esta camada **não depende de React**
 * — exceto o `provider.tsx`, que é a ponte de aplicação e por isso é exportado à parte.
 *
 * O dado de tema (`tema-prototipo.json`) é **extraído** do protótipo por
 * `scripts/extrair-tokens-prototipo.mjs`, nunca transcrito à mão: são 142 valores de cor, e um
 * typo aí não quebra nada — só fica sutilmente errado.
 */

/** Prefixo único das variáveis do DS — evita colidir com variável de terceiro no `:root`. */
export const PREFIXO_TOKEN = '--jos' as const

/**
 * Monta a referência CSS de um token pelo nome.
 *
 * Existe para que o nome da variável seja construído num lugar só: um `var(--jos-...)`
 * digitado à mão em cada componente é onde o typo silencioso (variável inexistente resolve
 * para vazio, sem erro) se esconde.
 */
export function tokenCss(nome: string): string {
  return `var(${PREFIXO_TOKEN}-${nome})`
}

export {
  BREAKPOINT,
  CAMADA,
  CURVA,
  DURACAO,
  ESPACAMENTO_LETRA,
  ESPACO,
  FONTE,
  PESO,
  RAIO,
  SOMBRA,
  sombraComGlow,
  TAMANHO,
  TEXTO
} from './base'

export {
  borda,
  bordaRgb,
  modoEfetivo,
  papeis,
  RISCO,
  STATUS,
  SUPERFICIES_DE_MARCA,
  superficieDeMarca,
  TELAS_INTERNAS,
  tokenDeTema,
  type ModoUi,
  type Modulo,
  type Superficie,
  type SuperficieDeMarca
} from './semantic'

export {
  ACENTO_PADRAO,
  acentoParaLeitura,
  contraste,
  CONTRASTE_MINIMO,
  contrasteSobre,
  hexA,
  luminancia,
  PALETA_ACENTO,
  semanticaParaLeitura,
  tabelaLeitura,
  type CorAcento
} from './acento'
