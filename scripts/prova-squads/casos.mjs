/**
 * Casos "dois escritores" do integrador da M11-F00, reconstruídos do histórico (decisão do PI,
 * 2026-10-02: pares de fatias do conjunto de referência).
 *
 * Por que reconstruir: o processo do projeto é WIP=1 e linear — nenhum dos 17 PRs de referência
 * conflitou com a main da sua época, então não há merge histórico conflitante de código. Para um
 * par (A, B), com A mergeada antes de B:
 *
 *   base = A^                       o estado antes de A
 *   W1   = base + patch de A        o primeiro escritor, o diff real de A
 *   W2   = base + patch de B        o segundo escritor, o diff real de B (B^→B) aplicado sobre a
 *                                   base com `git apply --3way`, como se B tivesse nascido dela
 *
 * Só vira caso o par cujo W2 existe (o patch de B aplica na base) **e** cujo merge W1+W2 conflita
 * de verdade no `git merge-tree`. A verdade de comparação é B real — a main depois das duas.
 * Determinístico: o mesmo par produz as mesmas árvores, então o caso se reconstrói pelo snapshot.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * O escopo de código. STATUS.md, DEVELOPMENT.md e TESTS.md são editados por toda fatia (o
 * processo manda), e o contexto do patch de B depende do que A escreveu neles — nenhum dos 136
 * pares aplicava por causa só deles. O integrador da F00 prova código; docs entra na verdade, não
 * nos lados.
 */
export const CODIGO = ['src', 'tests', 'scripts']

const AUTOR = {
  GIT_AUTHOR_NAME: 'prova',
  GIT_AUTHOR_EMAIL: 'prova@local',
  GIT_COMMITTER_NAME: 'prova',
  GIT_COMMITTER_EMAIL: 'prova@local'
}

export function git(args, { env = {}, entrada, tolerar = false, cwd = RAIZ } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
      env: { ...process.env, ...env },
      input: entrada,
      stdio: ['pipe', 'pipe', 'pipe']
    })
  } catch (e) {
    if (tolerar) return { falhou: true, saida: `${e.stdout ?? ''}${e.stderr ?? ''}` }
    throw e
  }
}

const arquivosDe = (a, b) =>
  git(['diff', '--name-only', a, b, '--', ...CODIGO])
    .split('\n')
    .filter(Boolean)

/** Patch de código de uma fatia: o diff do merge dela contra o pai. */
export const patchDe = (merge) => git(['diff', '--binary', `${merge}^`, merge, '--', ...CODIGO])

/** Commit = base + patch (3-way, índice temporário). `undefined` se o patch não aplica. */
export function aplicarSobre(base, patch, rotulo, extra = []) {
  const pasta = mkdtempSync(join(tmpdir(), 'caso-'))
  try {
    const env = { GIT_INDEX_FILE: join(pasta, 'index') }
    git(['read-tree', base], { env })
    const aplicado = git(['apply', '--cached', '--3way', ...extra, '-'], {
      env,
      entrada: patch,
      tolerar: true
    })
    if (aplicado.falhou) return undefined
    const arvore = git(['write-tree'], { env }).trim()
    return git(['commit-tree', arvore, '-p', base, '-m', rotulo], { env: AUTOR }).trim()
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
}

/** Monta W1 e W2 e roda o merge; devolve o caso ou o motivo de o par não ser um. */
export function construirCaso(pr1, pr2) {
  const base = git(['rev-parse', `${pr1.merge}^`]).trim()
  const comuns = arquivosDe(base, pr1.merge).filter((f) =>
    arquivosDe(`${pr2.merge}^`, pr2.merge).includes(f)
  )
  if (comuns.length === 0) return { motivo: 'sem arquivo de código em comum' }

  const w1 = aplicarSobre(base, patchDe(pr1.merge), `W1 ${pr1.id}`)
  const w2 = aplicarSobre(base, patchDe(pr2.merge), `W2 ${pr2.id}`)
  if (w1 === undefined || w2 === undefined)
    return { motivo: 'o patch do segundo escritor não aplica na base', comuns }

  const merge = git(['merge-tree', '--write-tree', '--name-only', `--merge-base=${base}`, w1, w2], {
    tolerar: true
  })
  if (!merge.falhou) return { motivo: 'o merge dos dois lados é limpo', comuns }
  const conflitos = [
    ...merge.saida.matchAll(/^CONFLICT \(content\): Merge conflict in (.+)$/gm)
  ].map((m) => m[1])
  if (conflitos.length === 0)
    return { motivo: 'falha do merge-tree sem conflito de conteúdo', comuns }
  return { base, w1, w2, conflitos, verdade: pr2.merge, comuns }
}

/** Todo par ordenado pela história: o primeiro é sempre o ancestral do segundo. */
export function pares(fatias) {
  const lista = fatias.map((f) => ({ id: f.id, pr: f.pr, merge: f.merge }))
  const ordenada = lista.sort((x, y) =>
    git(['merge-base', '--is-ancestor', x.merge, y.merge], { tolerar: true }).falhou ? 1 : -1
  )
  const saida = []
  for (let i = 0; i < ordenada.length; i++)
    for (let j = i + 1; j < ordenada.length; j++) saida.push([ordenada[i], ordenada[j]])
  return saida
}
