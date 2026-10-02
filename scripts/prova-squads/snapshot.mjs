/**
 * Snapshot da medição da M11-F00 (SPEC-Squads-00, critério 4): tudo o que a medição consome,
 * fixado e com hash, antes de qualquer modelo rodar.
 *
 * Uso:
 *   node scripts/prova-squads/snapshot.mjs
 *
 * Grava `reports/squads-prova/snapshot.json`. O orquestrador e o integrador **recusam rodar** se
 * o hash do validador ou do conjunto não bate com o snapshot — é isso que impede ajustar o
 * validador para um modelo passar (SPEC, "Fora") sem deixar rastro.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SAIDA = join(RAIZ, 'reports', 'squads-prova', 'snapshot.json')

/** Fatias mergeadas dos MVP-009, MVP-010 e MVP-026 (PI, 2026-10-02). O PR é o que as entregou. */
export const CONJUNTO = [
  { mvp: 9, fatia: 'F01', issue: 101, pr: 190, spec: 'spec-entrega-01-publicacao-github.md' },
  { mvp: 9, fatia: 'F02', issue: 102, pr: 208, spec: 'spec-entrega-02-dag-fila-reconciliacao.md' },
  {
    mvp: 9,
    fatia: 'F03',
    issue: 103,
    pr: 211,
    spec: 'spec-entrega-03-worktree-preflight-docker.md'
  },
  { mvp: 9, fatia: 'F04', issue: 104, pr: 231, spec: 'spec-entrega-04-construcao-recuperacao.md' },
  { mvp: 9, fatia: 'F05', issue: 105, pr: 235, spec: 'spec-entrega-05-revisao-ci-merge.md' },
  {
    mvp: 9,
    fatia: 'F06',
    issue: 106,
    pr: 236,
    spec: 'spec-entrega-06-evidencia-limpeza-continuidade.md'
  },
  { mvp: 10, fatia: 'F01', issue: 116, pr: 360, spec: 'spec-multi-executor-01-runtime.md' },
  {
    mvp: 10,
    fatia: 'F02',
    issue: 117,
    pr: 267,
    spec: 'spec-multi-executor-02-autenticacao-codex.md'
  },
  {
    mvp: 10,
    fatia: 'F03',
    issue: 118,
    pr: 363,
    spec: 'spec-multi-executor-03-codex-exec-adapter.md'
  },
  {
    mvp: 10,
    fatia: 'F04',
    issue: 119,
    pr: 365,
    spec: 'spec-multi-executor-04-roteamento-revisao-cruzada.md'
  },
  {
    mvp: 10,
    fatia: 'F05',
    issue: 120,
    pr: 366,
    spec: 'spec-multi-executor-05-ui-prova-operacional.md'
  },
  { mvp: 26, fatia: 'F01', issue: 251, pr: 258, spec: 'spec-fases-01-fase-e-card-do-projeto.md' },
  {
    mvp: 26,
    fatia: 'F02',
    issue: 252,
    pr: 262,
    spec: 'spec-fases-02-catalogo-e-modelo-por-fase.md'
  },
  { mvp: 26, fatia: 'F03', issue: 253, pr: 263, spec: 'spec-fases-03-console-da-geracao.md' },
  {
    mvp: 26,
    fatia: 'F04',
    issue: 254,
    pr: 264,
    spec: 'spec-fases-04-marcos-git-e-gate-da-construcao.md'
  },
  { mvp: 26, fatia: 'F05', issue: 255, pr: 265, spec: 'spec-fases-05-modelo-da-fase-no-run.md' },
  { mvp: 26, fatia: 'F06', issue: 256, pr: 269, spec: 'spec-fases-06-codex-no-ponto-unico.md' }
]

/** Perfil único da prova: o que a F01 vai formalizar, aqui fixo e declarado. */
export const PERFIL = {
  capacidadesPermitidas: [
    'ler-repositorio',
    'escrever-codigo',
    'escrever-testes',
    'rodar-testes',
    'atualizar-docs',
    'revisar'
  ],
  camadasPermitidas: ['local', 'fase'],
  maxEscritores: 2,
  maxTarefas: 12
}

const git = (...args) =>
  execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8', maxBuffer: 1 << 28 })
const sha256 = (texto) => createHash('sha256').update(texto).digest('hex')

/** Critérios numerados da seção "Critérios de aceite" da SPEC. */
export function lerCriterios(markdown) {
  const secao = markdown.split(/^## /m).find((s) => /^crit[ée]rios de aceite/i.test(s)) ?? ''
  return [...secao.matchAll(/^(\d+)\.\s+(.+)$/gm)].map((m) => ({
    n: Number(m[1]),
    texto: m[2].trim()
  }))
}

function fatia(item) {
  const merge = execFileSync(
    'gh',
    ['pr', 'view', String(item.pr), '--json', 'mergeCommit', '--jq', '.mergeCommit.oid'],
    {
      cwd: RAIZ,
      encoding: 'utf8'
    }
  ).trim()
  if (merge === '') throw new Error(`PR #${item.pr} sem commit de merge`)
  const specPath = `docs/spec/${item.spec}`
  const spec = git('show', `${merge}:${specPath}`)
  const arquivos = git('diff', '--name-only', `${merge}^`, merge).split('\n').filter(Boolean)
  const dirs = [...new Set(arquivos.map((a) => dirname(a).replace(/\\/g, '/')))].sort()
  return {
    id: `M${item.mvp}-${item.fatia}`,
    ...item,
    merge,
    specPath,
    specSha256: sha256(spec),
    criterios: lerCriterios(spec),
    arquivosAlterados: arquivos.length,
    pathsPermitidos: [...new Set([...dirs, 'docs'])]
  }
}

function hardware() {
  const saida = (cmd, args) => {
    try {
      return execFileSync(cmd, args, { encoding: 'utf8' }).trim()
    } catch {
      return 'indisponível'
    }
  }
  return {
    gpu: saida('nvidia-smi', [
      '--query-gpu=name,memory.total,driver_version',
      '--format=csv,noheader'
    ]),
    node: process.version,
    so: `${process.platform} ${process.arch}`
  }
}

export function montarSnapshot() {
  const fatias = CONJUNTO.map(fatia)
  const vazias = fatias.filter((f) => f.criterios.length === 0).map((f) => f.id)
  if (vazias.length > 0) throw new Error(`SPEC sem critérios numerados: ${vazias.join(', ')}`)

  return {
    criadoEm: new Date().toISOString(),
    hardware: hardware(),
    perfil: PERFIL,
    validadorSha256: sha256(
      readFileSync(join(RAIZ, 'src/main/squads/prova/squad-plan.ts'), 'utf8')
    ),
    manifestoSha256: sha256(
      readFileSync(join(RAIZ, 'src/main/squads/prova/manifesto-hunks.ts'), 'utf8')
    ),
    fatias
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  git('fetch', '-q', 'origin', 'main')
  const snapshot = montarSnapshot()
  mkdirSync(dirname(SAIDA), { recursive: true })
  writeFileSync(SAIDA, `${JSON.stringify(snapshot, null, 2)}\n`)
  for (const f of snapshot.fatias)
    console.log(
      `${f.id}  PR #${f.pr}  ${f.merge.slice(0, 8)}  critérios=${f.criterios.length}  arquivos=${f.arquivosAlterados}`
    )
  console.log(`\nvalidador ${snapshot.validadorSha256.slice(0, 12)} → ${SAIDA}`)
}
