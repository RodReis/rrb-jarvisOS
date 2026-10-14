import { existsSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { CommandRunner } from './adapters/command-runner'

/**
 * Guardas da entrada `release:promote` (SPEC-Release-04), isoladas para serem testadas sem o
 * Electron. Cada uma fecha um caminho pelo qual código que ninguém aprovou chegaria a Produção ou
 * a um segredo do operador.
 */

/** SHA de commit completo (SHA-1 ou SHA-256): prefixo curto colide e identifica pouco. */
const SHA_COMPLETO = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i
/** Referência de Git sem `--opção` disfarçada, espaço ou caracter de controle. */
const REFERENCIA_VALIDA = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/
const TIMEOUT_GIT_MS = 2 * 60_000

export type ResultadoDeMerge = 'ok' | 'not-merged' | 'unverifiable'

/**
 * O commit a promover precisa estar na branch base (foi revisado e mergeado). Sem isso,
 * `--event merge --sha <qualquer HEAD local>` levaria um commit nunca revisado até Produção, já
 * que o resto só confere que a árvore local é aquele commit. A base é atualizada antes: um
 * `origin/main` velho recusaria merge recente. O que o git não consegue provar (rede, ref
 * inexistente) é `unverifiable`, e quem chama não promove.
 */
export async function exigirCommitMergeado(
  runner: CommandRunner,
  dir: string,
  sha: string,
  baseRef: string
): Promise<ResultadoDeMerge> {
  if (!SHA_COMPLETO.test(sha)) throw new TypeError('A promoção exige o SHA completo do commit.')
  if (!REFERENCIA_VALIDA.test(baseRef)) throw new TypeError('Referência da branch base inválida.')
  const opcoes = { cwd: dir, timeoutMs: TIMEOUT_GIT_MS }
  const atualizar = await runner.run('git', ['fetch', '--quiet', 'origin'], opcoes)
  if (atualizar.code !== 0 || atualizar.timedOut) return 'unverifiable'
  const r = await runner.run('git', ['merge-base', '--is-ancestor', sha, baseRef], opcoes)
  if (r.timedOut) return 'unverifiable'
  // `merge-base --is-ancestor`: 0 = é ancestral, 1 = não é; qualquer outro código é erro do git.
  if (r.code === 0) return 'ok'
  return r.code === 1 ? 'not-merged' : 'unverifiable'
}

/** `alvo` é a própria `base` ou está dentro dela (sem escapar por `..`). */
export function estaDentroDe(base: string, alvo: string): boolean {
  const rel = relative(resolve(base), resolve(alvo))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * `.vercelignore` tem precedência sobre o `.gitignore` no `vercel deploy`: arquivos que o Git
 * ignora (`.env.production`, `dist/`, `.npmrc`) passariam a ser publicados, e a verificação de
 * árvore limpa não os enxerga. Sem o arquivo, o `.gitignore` é a única regra.
 */
export function temVercelIgnore(workdir: string): boolean {
  return existsSync(join(workdir, '.vercelignore'))
}

/**
 * Ambiente do processo de E2E. O comando vem de um commit já mergeado, mas roda na máquina do
 * operador: HOME e os diretórios de credencial (`~/.railway`, `%APPDATA%` da Vercel, o login do
 * GHCR em `DOCKER_CONFIG`) apontam para uma pasta temporária vazia. Só o cache de navegadores do
 * Playwright é mantido, porque sem ele o E2E nem abre. Nenhum token do provedor é repassado.
 */
export function ambienteIsoladoDoE2e(
  pastaTemporaria: string,
  origem: Readonly<Record<string, string | undefined>>
): Record<string, string> {
  const base = pastaTemporaria.replace(/\\/g, '/')
  const env: Record<string, string> = {
    HOME: `${base}/home`,
    USERPROFILE: `${base}/home`,
    APPDATA: `${base}/appdata`,
    LOCALAPPDATA: `${base}/localappdata`,
    DOCKER_CONFIG: `${base}/docker`
  }
  const navegadores =
    origem.PLAYWRIGHT_BROWSERS_PATH ??
    (origem.LOCALAPPDATA
      ? `${origem.LOCALAPPDATA.replace(/\\/g, '/')}/ms-playwright`
      : origem.HOME
        ? `${origem.HOME.replace(/\\/g, '/')}/.cache/ms-playwright`
        : undefined)
  if (navegadores) env.PLAYWRIGHT_BROWSERS_PATH = navegadores
  return env
}
