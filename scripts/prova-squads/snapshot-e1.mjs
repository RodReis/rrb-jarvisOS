/**
 * Snapshot da F00-bis (SPEC-Squads-00 § Emenda E1, critério de reprodução): o que a medição do
 * orquestrador consome, fixado com hash antes de qualquer modelo rodar.
 *
 *   node scripts/prova-squads/snapshot-e1.mjs
 *
 * O conjunto é o da primeira medição (as mesmas 17 fatias, lidas de `snapshot.json`); o que muda é
 * o instrumento: o validador é o **endurecido de produção** (`squad-plano.ts`, SPEC-Squads-02 §
 * E1), o pedido é o de produção (`squad-prompt.ts`) mais o bloco da base (`base-do-prompt.ts`), e o
 * laço de replanejamento é o do `planejarSquad`. Os hashes abaixo travam o `orquestrador-e1` — que
 * recusa rodar se qualquer um mudou, para ninguém ajustar o validador até um modelo passar.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PASTA = join(RAIZ, 'reports', 'squads-prova-e1')
export const ARQUIVO_DO_SNAPSHOT = join(PASTA, 'snapshot.json')

/** O que define a decisão de aceite e o texto que o modelo recebe. */
export const ARQUIVOS_CONGELADOS = [
  'src/shared/domain/squad-plano.ts',
  'src/shared/domain/squad-plano-esquema.ts',
  'src/shared/domain/squad-perfil.ts',
  'src/shared/domain/squad-capacidades.ts',
  'src/shared/domain/squad-resolucao.ts',
  'src/shared/domain/attempt.ts',
  'src/main/squads/squad-prompt.ts',
  'src/main/squads/squad-planejador.ts',
  'src/main/squads/squad-snapshot.ts',
  'src/main/squads/prova/base-do-prompt.ts'
]

const sha256 = (t) => createHash('sha256').update(t).digest('hex')
const git = (...a) => execFileSync('git', a, { cwd: RAIZ, encoding: 'utf8', maxBuffer: 1 << 28 })
const cmd = (c, a) => {
  try {
    return execFileSync(c, a, { encoding: 'utf8' }).trim()
  } catch {
    return 'indisponível'
  }
}

export const hashesDosArquivos = () =>
  Object.fromEntries(
    ARQUIVOS_CONGELADOS.map((a) => [a, sha256(readFileSync(join(RAIZ, a), 'utf8'))])
  )

export function montarSnapshot() {
  const v1 = JSON.parse(readFileSync(join(RAIZ, 'reports/squads-prova/snapshot.json'), 'utf8'))
  const fatias = v1.fatias.map((f) => ({
    id: f.id,
    issue: f.issue,
    pr: f.pr,
    merge: f.merge,
    base: git('rev-parse', `${f.merge}^`).trim(),
    specPath: f.specPath,
    specSha256: f.specSha256,
    titulo: git('show', `${f.merge}:${f.specPath}`).split('\n')[0].replace(/^#\s*/, '').trim(),
    criterios: f.criterios,
    pathsPermitidos: f.pathsPermitidos
  }))
  return {
    criadoEm: new Date().toISOString(),
    commit: git('rev-parse', 'HEAD').trim(),
    hardware: {
      gpu: cmd('nvidia-smi', [
        '--query-gpu=name,memory.total,driver_version',
        '--format=csv,noheader'
      ]),
      node: process.version,
      so: `${process.platform} ${process.arch}`
    },
    arquivosCongelados: hashesDosArquivos(),
    fontesPermitidas: ['docs', 'src', 'tests'],
    orcamentoUsd: 1,
    fatias
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const snapshot = montarSnapshot()
  mkdirSync(PASTA, { recursive: true })
  writeFileSync(ARQUIVO_DO_SNAPSHOT, `${JSON.stringify(snapshot, null, 2)}\n`)
  for (const [a, h] of Object.entries(snapshot.arquivosCongelados)) console.log(h.slice(0, 12), a)
  console.log(`\n${snapshot.fatias.length} fatias → ${ARQUIVO_DO_SNAPSHOT}`)
}
