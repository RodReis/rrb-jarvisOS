/**
 * Integrador da M11-F00b (SPEC-Squads-00 § Emenda E1): o instrumento corrigido.
 *
 *   TSX_TSCONFIG_PATH=tsconfig.node.json npx tsx scripts/prova-squads/integrador-e1.mjs congelar
 *   TSX_TSCONFIG_PATH=tsconfig.node.json npx tsx scripts/prova-squads/integrador-e1.mjs <camada>
 *
 * `congelar` monta os seis casos, **prova que o instrumento é válido antes de medir** e grava o
 * resultado com hash em `reports/squads-prova-e1/casos.json`:
 *
 *  - os dois lados conflitam de verdade no `git`, no módulo e no spec;
 *  - o manifesto aplicado à verdade dá zero perdido e zero não resolvido (piso zero por construção);
 *  - a suíte do spec passa na base, em cada lado e na verdade.
 *
 * `<camada>` (`hermes3:8b`, `qwen3:8b`, `fase:<modelo>`) recusa rodar se o instrumento mudou depois
 * do congelamento ou se os casos não se reconstroem com os mesmos SHAs. O critério do PI vale para
 * os casos de código com suíte; os merges históricos de docs entram como informativos.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditarIntegracao, extrairHunks } from '../../src/main/squads/prova/manifesto-hunks.ts'
import {
  colisoesDeNome,
  montarLado,
  montarVerdade
} from '../../src/main/squads/prova/caso-sintetico.ts'
import { git } from './casos.mjs'
import { CASOS_E1 } from './casos-e1.mjs'
import { integrarCaso, rodarSuite } from './integrador.mjs'
import { chamarOllama } from './orquestrador.mjs'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PASTA = join(RAIZ, 'reports', 'squads-prova-e1')
const PASTA_V1 = join(RAIZ, 'reports', 'squads-prova')
const ARQUIVO_DOS_CASOS = join(PASTA, 'casos.json')

/** Datas fixas: o mesmo caso produz os mesmos SHAs, e é isso que o congelamento confere. */
const AUTOR = {
  GIT_AUTHOR_NAME: 'prova',
  GIT_AUTHOR_EMAIL: 'prova@local',
  GIT_COMMITTER_NAME: 'prova',
  GIT_COMMITTER_EMAIL: 'prova@local',
  GIT_AUTHOR_DATE: '2026-10-03T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-10-03T00:00:00Z'
}

const sha256 = (t) => createHash('sha256').update(t).digest('hex')
const lerArquivo = (caminho) => readFileSync(join(RAIZ, caminho), 'utf8')

/** O que define o instrumento: se qualquer um muda, a medição anterior deixa de valer. */
const ARQUIVOS_DO_INSTRUMENTO = [
  'scripts/prova-squads/casos-e1.mjs',
  'src/main/squads/prova/caso-sintetico.ts',
  'src/main/squads/prova/manifesto-hunks.ts'
]
export const hashDoInstrumento = () =>
  sha256(ARQUIVOS_DO_INSTRUMENTO.map((a) => `${a}\n${lerArquivo(a)}`).join('\n--\n'))

/** Commit determinístico: a árvore da base com os arquivos trocados. */
function commitComArquivos(base, arquivos, rotulo) {
  const pasta = mkdtempSync(join(tmpdir(), 'e1-'))
  try {
    const env = { GIT_INDEX_FILE: join(pasta, 'index') }
    git(['read-tree', base], { env })
    for (const [caminho, texto] of Object.entries(arquivos)) {
      const oid = git(['hash-object', '-w', '--stdin'], { entrada: texto }).trim()
      git(['update-index', '--cacheinfo', `100644,${oid},${caminho}`], { env })
    }
    const arvore = git(['write-tree'], { env }).trim()
    return git(['commit-tree', arvore, '-p', base, '-m', rotulo], {
      env: { ...env, ...AUTOR }
    }).trim()
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
}

const arvoreDe = (commit) => git(['rev-parse', `${commit}^{tree}`]).trim()

/** Monta o caso e confere o que dá para conferir sem rodar suíte. Lança se o instrumento é inválido. */
export function montarCasoE1(definicao, fatias) {
  const fatia = fatias.find((f) => f.id === definicao.fatia)
  if (!fatia) throw new Error(`fatia ${definicao.fatia} fora do snapshot`)
  const base = fatia.merge
  const spec = definicao.modulo.replace(/\.ts$/, '.spec.ts')
  const original = {
    modulo: git(['show', `${base}:${definicao.modulo}`]),
    teste: git(['show', `${base}:${spec}`])
  }

  for (const lado of [definicao.lado1, definicao.lado2]) {
    const colide = [
      ...colisoesDeNome(original.modulo, lado),
      ...colisoesDeNome(original.teste, lado)
    ]
    if (colide.length > 0)
      throw new Error(`${definicao.fatia}: o lado redefine ${colide.join(', ')} da base`)
  }

  const l1 = montarLado(original, definicao.lado1)
  const l2 = montarLado(original, definicao.lado2)
  const v = montarVerdade(original, definicao.lado1, definicao.lado2)
  const em = (c) => ({ [definicao.modulo]: c.modulo, [spec]: c.teste })
  const w1 = commitComArquivos(base, em(l1), `W1 ${definicao.fatia}`)
  const w2 = commitComArquivos(base, em(l2), `W2 ${definicao.fatia}`)
  const verdade = commitComArquivos(base, em(v), `verdade ${definicao.fatia}`)

  const merge = git(['merge-tree', '--write-tree', '--name-only', `--merge-base=${base}`, w1, w2], {
    tolerar: true
  })
  if (!merge.falhou) throw new Error(`${definicao.fatia}: o merge dos dois lados é limpo`)
  const conflitos = [...merge.saida.matchAll(/^CONFLICT \(content\): Merge conflict in (.+)$/gm)]
    .map((m) => m[1])
    .sort()
  const esperados = [definicao.modulo, spec].sort()
  if (JSON.stringify(conflitos) !== JSON.stringify(esperados))
    throw new Error(`${definicao.fatia}: conflitos ${conflitos} ≠ ${esperados}`)

  // Piso zero por construção: o manifesto dos dois lados, lido contra a verdade.
  const manifesto = [
    ...extrairHunks(git(['diff', base, w1])),
    ...extrairHunks(git(['diff', base, w2]))
  ]
  const naVerdade = (a) => {
    const lido = git(['show', `${verdade}:${a}`], { tolerar: true })
    return lido.falhou ? undefined : lido
  }
  const piso = auditarIntegracao(manifesto, naVerdade, [])
  if (piso.perdidosSemRegistro.length > 0 || piso.naoResolvidos.length > 0)
    throw new Error(
      `${definicao.fatia}: a verdade perde hunks (${piso.perdidosSemRegistro.length})`
    )

  return {
    tipo: 'sintetico-e1',
    id: `E1-${definicao.fatia}`,
    fatia: definicao.fatia,
    base,
    w1,
    w2,
    verdade,
    alvo: definicao.modulo,
    specs: [spec],
    conflitos,
    hunks: manifesto.length
  }
}

function controlarSuites(caso) {
  const por = (nome, commit) => [nome, rodarSuite(arvoreDe(commit), caso.specs)]
  return Object.fromEntries([
    por('base', caso.base),
    por('lado1', caso.w1),
    por('lado2', caso.w2),
    por('verdade', caso.verdade)
  ])
}

const suiteOk = (r) => r?.aplicavel === true && r.ok === true

async function congelar() {
  const { fatias } = JSON.parse(readFileSync(join(PASTA_V1, 'snapshot.json'), 'utf8'))
  const casos = []
  for (const definicao of CASOS_E1) {
    const caso = montarCasoE1(definicao, fatias)
    const controle = controlarSuites(caso)
    const invalidos = Object.entries(controle)
      .filter(([, r]) => !suiteOk(r))
      .map(([nome]) => nome)
    console.log(
      `${caso.id.padEnd(12)} conflitos=${caso.conflitos.length} hunks=${caso.hunks} suítes: ` +
        Object.entries(controle)
          .map(([n, r]) => `${n}=${suiteOk(r) ? 'verde' : 'VERMELHA'}`)
          .join(' ')
    )
    if (invalidos.length > 0)
      throw new Error(`${caso.id}: suíte vermelha em ${invalidos.join(', ')} — caso inválido`)
    casos.push({ ...caso, controle })
  }
  mkdirSync(PASTA, { recursive: true })
  writeFileSync(
    ARQUIVO_DOS_CASOS,
    `${JSON.stringify({ criadoEm: new Date().toISOString(), instrumentoSha256: hashDoInstrumento(), casos }, null, 2)}\n`
  )
  console.log(`\n${casos.length} casos congelados → ${ARQUIVO_DOS_CASOS}`)
}

/** Os casos congelados, reconstruídos: o mesmo instrumento tem de dar os mesmos SHAs. */
function carregarCasosCongelados() {
  const congelado = JSON.parse(readFileSync(ARQUIVO_DOS_CASOS, 'utf8'))
  if (congelado.instrumentoSha256 !== hashDoInstrumento())
    throw new Error(
      'O instrumento mudou depois do congelamento (casos, manifesto ou caso-sintetico). ' +
        'Congelar de novo invalida as medições anteriores — decisão do PI, não do harness.'
    )
  const { fatias } = JSON.parse(readFileSync(join(PASTA_V1, 'snapshot.json'), 'utf8'))
  return congelado.casos.map((c) => {
    const refeito = montarCasoE1(
      CASOS_E1.find((d) => d.fatia === c.fatia),
      fatias
    )
    for (const k of ['w1', 'w2', 'verdade'])
      if (refeito[k] !== c[k])
        throw new Error(`${c.id}: ${k} não se reconstrói (${refeito[k]} ≠ ${c[k]})`)
    return { ...refeito, controle: c.controle }
  })
}

/** Os merges históricos (só docs): informativos, fora do critério do PI. */
const carregarHistoricos = () =>
  JSON.parse(readFileSync(join(PASTA_V1, 'casos-integrador.json'), 'utf8')).casos.filter(
    (c) => c.tipo === 'historico'
  )

/** Caso de código aprovado: nada perdido, nada em conflito, nenhum bloco sem resolução, suíte verde. */
export const casoAprovado = (r) =>
  r.perdidosSemRegistro.length === 0 &&
  r.naoResolvidos.length === 0 &&
  r.falhas.length === 0 &&
  r.marcadoresRestantes === 0 &&
  suiteOk(r.suite)

async function medir(camada) {
  const so = process.argv[3]
  const codigo = carregarCasosCongelados().filter((c) => so === undefined || c.id === so)
  const historicos = so === undefined ? carregarHistoricos() : []
  if (!camada.startsWith('fase:')) await chamarOllama(camada, [{ role: 'user', content: 'ok' }])

  const resultados = []
  for (const caso of [...codigo, ...historicos]) {
    const r = await integrarCaso(camada, caso)
    resultados.push({ ...r, informativo: caso.tipo === 'historico' })
    console.log(
      `${r.caso.padEnd(14)} hunks=${r.hunks} ok=${r.preservados} PERDIDOS=${r.perdidosSemRegistro.length} ` +
        `NAO_RESOLVIDOS=${r.naoResolvidos.length} falhas=${r.falhas.length} ` +
        `suite=${r.suite.aplicavel ? (r.suite.ok ? 'verde' : 'VERMELHA') : 'n/a'} ${r.latenciaMs}ms`
    )
  }
  const doCriterio = resultados.filter((r) => !r.informativo)
  const aprovados = doCriterio.filter(casoAprovado).length
  const saida = {
    camada,
    executadoEm: new Date().toISOString(),
    instrumentoSha256: hashDoInstrumento(),
    casosDoCriterio: doCriterio.length,
    casosAprovados: aprovados,
    aprovado: doCriterio.length > 0 && aprovados === doCriterio.length,
    resultados
  }
  mkdirSync(PASTA, { recursive: true })
  if (so === undefined)
    writeFileSync(
      join(PASTA, `integrador-${camada.replace(/[:/]/g, '_')}.json`),
      `${JSON.stringify(saida, null, 2)}\n`
    )
  console.log(
    `\n${camada}: ${aprovados}/${doCriterio.length} casos de código aprovados → ${saida.aprovado ? 'APROVADO' : 'REPROVADO'}`
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const alvo = process.argv[2]
  if (!alvo) {
    console.error('uso: integrador-e1.mjs congelar | <hermes3:8b|qwen3:8b|fase:<modelo>> [id]')
    process.exit(1)
  }
  ;(alvo === 'congelar' ? congelar() : medir(alvo)).catch((e) => {
    console.error(e.message ?? e)
    process.exit(1)
  })
}
