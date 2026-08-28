/**
 * Política de comando de terminal — a parte **pura** (SPEC-ExecucaoReal-02).
 *
 * Mora em `src/shared` pela mesma razão que `allowlist.ts`: é decisão sem I/O, e política
 * precisa ser verificável sem carregar o Electron. Quem executa o processo é o main; aqui
 * só se decide se ele *pode*.
 *
 * **As duas barreiras da spec** (RF-016 pede "só executa comandos permitidos" **e**
 * "bloqueio de comandos perigosos" — são exigências distintas, não sinônimos):
 *
 *   1. `isCommandAllowed` — o binário está na allowlist? Fora ⇒ `block`. Barra o desconhecido.
 *   2. `matchDestructivePattern` — o comando, ainda que com binário permitido, casa um padrão
 *      destrutivo? ⇒ eleva a `requires-approval`. Barra o uso destrutivo do permitido.
 *
 * A primeira sozinha deixaria `rm` allowlistado apagar o disco sem pausa; a segunda sozinha
 * deixaria qualquer binário desconhecido rodar desde que parecesse inofensivo. Precisam ser
 * as duas.
 *
 * **Por que não há parsing de linha de comando aqui.** Por decisão do PI (2026-08-28) a UI
 * submete binário e argumentos em campos **separados**, e o main executa com `shell: false`.
 * Isso elimina a classe inteira de bugs de tokenização: `;`, `&&`, `|`, `$()` e backtick não
 * são metacaracteres a rejeitar, porque nunca chegam a ser interpretados — sem shell, um `;`
 * num argumento é o caractere `;` literal, e não um encadeamento. Escrever um tokenizador
 * seria criar a superfície de ataque que a submissão em campos já fechou por construção.
 */

/** Um comando submetido: o binário e seus argumentos, já separados pela UI. */
export interface CommandRequest {
  /** O executável. Nome canônico (`git`), não caminho — a comparação é por nome. */
  readonly binary: string
  readonly args: readonly string[]
  /** Working directory. Checado contra a allowlist de **diretórios** (SPEC-Execucao-03). */
  readonly cwd: string
}

/**
 * Prefixos de elevação. Barrados **sempre** — `sem admin no MVP` é da ARCHITECTURE
 * (§ Terminal Executor), não uma preferência que a allowlist possa contornar: allowlistar
 * `sudo` não deve destravar elevação.
 *
 * Casado contra o binário, não contra a linha: sem shell, `sudo` só eleva se for ele o
 * processo executado. `sudo` num argumento é texto.
 */
export const PREFIXOS_DE_ELEVACAO: readonly string[] = [
  'sudo',
  'su',
  'doas',
  'runas',
  'pkexec',
  'gsudo',
  'elevate'
]

/**
 * Normaliza o binário para comparação: minúsculas, sem diretório e sem extensão executável
 * do Windows.
 *
 * Sem isto, `GIT.EXE`, `git.exe` e `/usr/bin/git` seriam três entradas distintas — e a
 * allowlist vazaria por variação de escrita, que é o pior jeito de falhar: parece que barrou.
 * Descartar o diretório é deliberado: a allowlist é por **nome de binário**, e deixar o path
 * participar faria `/tmp/malicioso/git` casar uma entrada `git` só por terminar igual.
 */
export function canonicalizeBinary(binary: string): string {
  const semDiretorio = binary.replaceAll('\\', '/').split('/').pop() ?? binary
  return semDiretorio.toLowerCase().replace(/\.(exe|cmd|bat|com|ps1)$/, '')
}

/**
 * O binário está na allowlist? Compara canônico contra canônico.
 *
 * Allowlist vazia ⇒ nada roda. É o **default de fábrica** da spec: o terminal nasce inerte,
 * e cada comando é um opt-in explícito do usuário. Espelha a postura da allowlist de
 * diretórios, onde permitir é sempre ato deliberado.
 */
export function isCommandAllowed(binary: string, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return false
  const alvo = canonicalizeBinary(binary)
  return allowlist.some((permitido) => canonicalizeBinary(permitido) === alvo)
}

/** Tentativa de rodar o processo com privilégio elevado. Nunca permitida no MVP. */
export function isElevationAttempt(binary: string): boolean {
  return PREFIXOS_DE_ELEVACAO.includes(canonicalizeBinary(binary))
}
