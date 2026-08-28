/**
 * Canonicalização de paths para a allowlist — a parte que toca o FS (SPEC-Execucao-03).
 *
 * Vive no main porque usa `node:fs` (resolve symlink de verdade). A comparação de contenção
 * é pura e mora em `src/shared/policies/allowlist.ts`; aqui só se produz o path canônico que
 * ela recebe. A divisão é o que mantém a regra testável sem Electron e a resolução real onde
 * o Node existe.
 *
 * **Por que `realpath` importa para o anti-escape (critério 2):** `path.resolve` sozinho
 * elimina `..`/`.` textualmente, mas não enxerga symlink. Um link dentro de um diretório
 * permitido apontando pra fora passaria pela resolução textual e continuaria "dentro". Só
 * `fs.realpathSync` segue o link até o alvo real — é ele que fecha o buraco do symlink.
 */

import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Devolve o path canônico (absoluto, sem `..`/`.`, symlinks resolvidos).
 *
 * `realpathSync` exige que o path **exista**. Nesta fatia isso é aceitável e até desejável:
 * a allowlist guarda diretórios reais (o do app existe; os que o usuário adiciona ele
 * escolhe de um que existe). Um path que não existe não tem "lugar real" a comparar — tratá-
 * lo como fora (retornando o resolve textual) é a escolha conservadora: na dúvida, não dentro.
 *
 * Por isso o fallback: quando `realpathSync` falha (path inexistente, permissão negada), cai
 * para `resolve` — que ao menos elimina `..`/`.`. O símbolo resolvido textualmente perde a
 * garantia anti-symlink, mas um path que não existe também não tem symlink a seguir; e a
 * checagem downstream ainda barra se ele resolver para fora dos permitidos.
 */
export function canonicalize(path: string): string {
  const absoluto = resolve(path)
  try {
    return realpathSync(absoluto)
  } catch {
    return absoluto
  }
}
