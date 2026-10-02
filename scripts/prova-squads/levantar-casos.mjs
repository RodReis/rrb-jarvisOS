/**
 * Levanta os casos do integrador e grava `reports/squads-prova/casos-integrador.json`:
 *
 *  - **sintético**: conflito fabricado sobre cada fatia de referência que comporte (casos-sinteticos.mjs);
 *  - **histórico**: os merges reais de `main` que conflitaram — todos de docs (sem suíte);
 *  - os pares de fatias reconstruídos (casos.mjs), que deram zero casos, com o motivo de cada descarte,
 *    para o relatório declarar o tamanho real da amostra e por que ela não é maior.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { construirCaso, git, pares } from './casos.mjs'
import { construirSintetico } from './casos-sinteticos.mjs'
import { auditarIntegracao, extrairHunks } from '../../src/main/squads/prova/manifesto-hunks.ts'

const PASTA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'reports', 'squads-prova')
const snapshot = JSON.parse(readFileSync(join(PASTA, 'snapshot.json'), 'utf8'))

const casos = []
const descartados = { pares: {}, sinteticos: {} }

for (const fatia of snapshot.fatias) {
  const r = construirSintetico(fatia)
  if (r.tipo) {
    casos.push(r)
    console.log(
      `SINTÉTICO ${r.id}  ${r.alvo} (${r.hunksNoAlvo} hunks)  conflitos: ${r.conflitos.join(', ')}`
    )
  } else descartados.sinteticos[fatia.id] = r.motivo
}

for (const [p1, p2] of pares(snapshot.fatias)) {
  const r = construirCaso(p1, p2)
  if (r.conflitos) casos.push({ tipo: 'par', id: `P-${p1.id}+${p2.id}`, ...r })
  else descartados.pares[r.motivo] = (descartados.pares[r.motivo] ?? 0) + 1
}

// Merges reais com conflito (dois pais, merge-tree falha). Verdade = o commit de merge de verdade.
const mergesReais = git(['rev-list', '--merges', 'origin/main']).split('\n').filter(Boolean)
for (const m of mergesReais) {
  const [, p1, p2] = git(['rev-list', '--parents', '-n1', m]).trim().split(' ')
  const base = git(['merge-base', p1, p2], { tolerar: true })
  if (base.falhou) continue
  const t = git(['merge-tree', '--write-tree', '--name-only', p1, p2], { tolerar: true })
  if (!t.falhou) continue
  const conflitos = [...t.saida.matchAll(/^CONFLICT \(content\): Merge conflict in (.+)$/gm)].map(
    (x) => x[1]
  )
  if (conflitos.length === 0) continue
  const assunto = git(['log', '-1', '--format=%s', m]).trim()
  casos.push({
    tipo: 'historico',
    id: `H-${m.slice(0, 8)}`,
    base: base.trim(),
    w1: p1,
    w2: p2,
    verdade: m,
    conflitos,
    assunto
  })
  console.log(`HISTÓRICO H-${m.slice(0, 8)}  ${conflitos.join(', ')}`)
}

/**
 * Calibração do manifesto: o resultado de verdade (o PR real, ou o merge humano) também passa pela
 * auditoria. Se a verdade "perde" hunk, esse é o piso do instrumento — um hunk que o merge humano
 * descartou de propósito (o comentário `// w2`, uma linha de docs superada) — e o número do
 * integrador só significa algo lido ao lado dele.
 */
for (const c of casos.filter((x) => x.tipo !== 'par')) {
  const lados =
    c.tipo === 'sintetico' ? construirSintetico(snapshot.fatias.find((f) => f.id === c.fatia)) : c
  const manifesto = [
    ...extrairHunks(git(['diff', lados.base, lados.w1])),
    ...extrairHunks(git(['diff', lados.base, lados.w2]))
  ]
  const lerFinal = (a) => {
    const r = git(['show', `${c.verdade}:${a}`], { tolerar: true })
    return r.falhou ? undefined : r
  }
  c.hunksDoManifesto = manifesto.length
  c.perdidosNaVerdade = auditarIntegracao(manifesto, lerFinal, []).perdidosSemRegistro.length
}

mkdirSync(PASTA, { recursive: true })
writeFileSync(
  join(PASTA, 'casos-integrador.json'),
  `${JSON.stringify({ casos, descartados }, null, 2)}\n`
)
const por = (t) => casos.filter((c) => c.tipo === t).length
console.log(`\nsintéticos=${por('sintetico')} históricos=${por('historico')} pares=${por('par')}`)
console.log('descartados:', JSON.stringify(descartados))
