/**
 * Checagem de allowlist de diretórios — a parte **pura** (SPEC-Execucao-03).
 *
 * Mora em `src/shared` porque é lógica sem I/O: comparação de paths **já canonizados**.
 * A canonicalização em si (resolver `..`, `.`, symlink) exige `node:fs` e por isso vive no
 * main (`allowlist-canon.ts`) — `src/shared` compila também para o renderer, que não tem Node.
 * A divisão é deliberada: o main resolve o path real, esta função decide se ele está dentro.
 *
 * **Anti-escape é o ponto.** Um path que canoniza para fora de todo diretório permitido
 * retorna `false` — é assim que traversal `../` e symlink apontando pra fora são barrados.
 * Como o main já resolveu o path real antes de chamar aqui, o `..`/symlink viram um caminho
 * absoluto normal; o que resta é a comparação de contenção, feita por **segmento**.
 */

/** Separa um path POSIX/Windows em segmentos, descartando vazios (`//`, barra final). */
function segments(path: string): string[] {
  // Normaliza a barra: o main entrega paths do SO, e no Windows vêm com `\`.
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg.length > 0)
}

/**
 * `child` está dentro de (ou é igual a) `parent`? Comparação por **segmento**, não por
 * prefixo de string: sem isso `/home/user/foobar` casaria `/home/user/foo`, e um diretório
 * vizinho de nome parecido vazaria a allowlist. Cada segmento de `parent` tem de bater
 * exatamente com o de `child` na mesma posição.
 *
 * Case-sensitive por ora: o alvo de dev é Linux (o CI e o Docker). Windows tem FS
 * case-insensitive, mas granularidade de plataforma fica pro MVP-003, quando há FS real a
 * gatear — aqui a allowlist é dado + checagem, não enforcement (spec § Fora).
 */
function isInside(child: string[], parent: string[]): boolean {
  if (parent.length > child.length) return false
  return parent.every((seg, i) => seg === child[i])
}

/**
 * O path canonizado está dentro de algum diretório permitido (também canonizado)?
 *
 * Matching **recursivo**: permitir um diretório inclui suas subpastas (`isInside` cobre
 * "igual ou abaixo"). Allowlist vazia ⇒ nada é permitido — a postura conservadora da spec
 * (default de fábrica é só o diretório do app, e mesmo ele é uma entrada explícita da lista).
 *
 * Pré-condição: `canonPath` e cada `canonAllowlist[i]` já passaram pela canonicalização do
 * main (absolutos, sem `..`/`.`/symlink). Passar um path cru aqui não quebra a comparação de
 * segmentos, mas **não** oferece a garantia anti-symlink — essa mora na canonicalização.
 */
export function isPathAllowed(canonPath: string, canonAllowlist: readonly string[]): boolean {
  if (canonAllowlist.length === 0) return false

  const alvo = segments(canonPath)
  return canonAllowlist.some((permitido) => isInside(alvo, segments(permitido)))
}
