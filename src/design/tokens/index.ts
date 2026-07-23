/**
 * Camada `tokens` do design system (SPEC-DesignSystem-01).
 *
 * Base da pirâmide: valores de design como **CSS variables**, para que trocar de tema
 * (claro/escuro, NOA/JARVIS) troque variável e não classe. Esta camada **não depende de
 * React** — é o que permite consumi-la de um teste puro, de um script ou do próprio CSS.
 *
 * Esta fatia entrega só o esqueleto e o contrato de nome; os valores concretos (cor,
 * tipografia, espaçamento) são a Fatia 02.
 */

/** Prefixo único das variáveis do DS — evita colidir com variável de terceiro no `:root`. */
export const PREFIXO_TOKEN = '--jos' as const

/**
 * Monta a referência CSS de um token pelo nome.
 *
 * Existe para que o nome da variável seja construído num lugar só: um `var(--jos-...)`
 * digitado à mão em cada componente é onde o typo silencioso (variável inexistente
 * resolve para vazio, sem erro) se esconde.
 */
export function tokenCss(nome: string): string {
  return `var(${PREFIXO_TOKEN}-${nome})`
}
