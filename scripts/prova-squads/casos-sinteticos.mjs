/**
 * Casos sintéticos do integrador da M11-F00 (decisão do PI, 2026-10-02): conflito de código
 * fabricado **sobre fatias reais**, com a verdade conhecida.
 *
 * A reconstrução por pares de fatias deu zero casos (o histórico é linear, WIP=1), então o
 * conflito é injetado de forma controlada. Para um PR real B de código, com base `B^`:
 *
 *   W1 = o diff de B inteiro, menos o último hunk do arquivo-alvo F
 *   W2 = só esse último hunk de F + o primeiro hunk de F **mutado** (um comentário `// w2` no fim
 *        da primeira linha adicionada)
 *
 * W1 e W2 editam as mesmas linhas de formas diferentes, então o `git merge` conflita nelas. A
 * união dos dois é B (mais o comentário), então a **verdade é conhecida**: a árvore de B, cuja
 * suíte passou no CI da época. O integrador acerta se preservar todo hunk de W1 e W2 — ou
 * descartar o mutado **com registro**, que é o que o manifesto mede.
 *
 * Rotulado "sintético" em todo lugar que o número aparece: o conflito é fabricado, o código e a
 * verdade são do histórico.
 */

import { git, aplicarSobre, CODIGO } from './casos.mjs'

const COMENTARIO = ' // w2'

/** Separa um diff unificado em arquivos e hunks; só arquivos de texto modificados. */
export function parsearDiff(diff) {
  const arquivos = []
  const inteiros = []
  for (const bloco of diff.split(/^(?=diff --git )/m)) {
    if (!bloco.startsWith('diff --git ')) continue
    const corte = bloco.search(/^@@/m)
    if (corte === -1 || /^(new|deleted) file mode|^rename from|^Binary files/m.test(bloco)) {
      inteiros.push(bloco)
      continue
    }
    const cabecalho = bloco.slice(0, corte)
    const hunks = bloco
      .slice(corte)
      .split(/^(?=@@)/m)
      .filter(Boolean)
    const caminho = /^\+\+\+ b\/(.+)$/m.exec(cabecalho)?.[1]
    if (caminho) arquivos.push({ caminho, cabecalho, hunks })
  }
  return { arquivos, inteiros }
}

const montar = (arquivo, hunks) => `${arquivo.cabecalho}${hunks.join('')}`

const ehTeste = (p) => /\.(spec|test|int-spec|prova)\.[tj]sx?$/.test(p) || p.startsWith('tests/')

/** Primeira linha adicionada que aceita comentário no fim sem quebrar a sintaxe. */
function mutar(hunk) {
  const linhas = hunk.split('\n')
  // Código, não docblock: um conflito dentro de comentário não exercita o integrador.
  const i = linhas.findIndex(
    (l, k) => k > 0 && /^\+\s*[^\s*/].*[;)]\s*$/.test(l) && !l.includes('//')
  )
  if (i === -1) return undefined
  const copia = [...linhas]
  copia[i] = `${copia[i]}${COMENTARIO}`
  return copia.join('\n')
}

/** Escolhe o arquivo-alvo e monta os dois patches; `undefined` se a fatia não serve de caso. */
export function planejarCaso(fatia) {
  const diff = git(['diff', '--binary', `${fatia.merge}^`, fatia.merge, '--', ...CODIGO])
  const { arquivos, inteiros } = parsearDiff(diff)
  const candidatos = arquivos
    .filter((a) => !ehTeste(a.caminho) && a.hunks.length >= 2)
    .map((a) => ({ a, mutado: mutar(a.hunks[0]) }))
    .filter((c) => c.mutado !== undefined)
    .sort((x, y) => y.a.hunks.length - x.a.hunks.length)
  const escolhido = candidatos[0]
  if (!escolhido) return undefined

  const { a: alvo, mutado } = escolhido
  const ultimo = alvo.hunks.at(-1)
  // Arquivo novo, apagado ou renomeado vai inteiro no W1: os hunks de outros arquivos importam
  // dele, e sem ele a árvore integrada nem compila — defeito do caso, não do integrador.
  const patchW1 =
    arquivos
      .map((f) => (f === alvo ? montar(f, f.hunks.slice(0, -1)) : montar(f, f.hunks)))
      .join('') + inteiros.join('')
  const patchW2 = montar(alvo, [mutado, ultimo])
  return { alvo: alvo.caminho, hunksNoAlvo: alvo.hunks.length, patchW1, patchW2 }
}

/** Reconstrói W1/W2 como commits. `--recount` porque o patch parcial perde o deslocamento. */
export function construirSintetico(fatia) {
  const plano = planejarCaso(fatia)
  if (!plano) return { motivo: 'sem arquivo de código com 2+ hunks e linha mutável' }
  const base = git(['rev-parse', `${fatia.merge}^`]).trim()
  const w1 = aplicarSobre(base, plano.patchW1, `W1 ${fatia.id}`, ['--recount'])
  const w2 = aplicarSobre(base, plano.patchW2, `W2 ${fatia.id}`, ['--recount'])
  if (!w1 || !w2) return { motivo: 'patch parcial não aplica na base' }

  const merge = git(['merge-tree', '--write-tree', '--name-only', `--merge-base=${base}`, w1, w2], {
    tolerar: true
  })
  if (!merge.falhou) return { motivo: 'o merge é limpo (conflito não se formou)' }
  return {
    tipo: 'sintetico',
    id: `S-${fatia.id}`,
    fatia: fatia.id,
    base,
    w1,
    w2,
    verdade: fatia.merge,
    alvo: plano.alvo,
    hunksNoAlvo: plano.hunksNoAlvo,
    conflitos: [...merge.saida.matchAll(/^CONFLICT \(content\): Merge conflict in (.+)$/gm)].map(
      (m) => m[1]
    )
  }
}
