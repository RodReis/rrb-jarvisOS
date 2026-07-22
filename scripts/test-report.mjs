/**
 * Orquestrador do relatório de testes (ADR-003). Roda os runners com saída
 * `--json` nos caminhos que o `test-report.config.json` espera, depois chama o
 * gerador. Portável (Windows dev + Linux CI).
 *
 *   node scripts/test-report.mjs             # roda tudo + gera reports/TESTS.md
 *   node scripts/test-report.mjs --check     # roda tudo + falha se divergir
 *   node scripts/test-report.mjs --no-run    # só gera do que já existe em reports/.raw
 *   node scripts/test-report.mjs --selfcheck # só prova o gerador (não roda runners)
 *
 * Esta é a peça que **muda por stack** (docs/TESTING.md §10.4): no lugar do
 * `jest --selectProjects` do proplan, roda uma execução Vitest por categoria
 * (`--project`), cada uma com seu `outputFile` e diretório de cobertura.
 *
 * Testes que falham NÃO abortam o relatório — o número de falhas é o dado. Só o
 * gerador (via --check) barra o CI, e por divergência de número, não por falha.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RAW = resolve(ROOT, 'reports/.raw')
const check = process.argv.includes('--check')
const selfcheck = process.argv.includes('--selfcheck')
const noRun = process.argv.includes('--no-run') || selfcheck
const isWin = process.platform === 'win32'

function run(cmd, args, cwd = ROOT) {
  console.log(`\n$ ${cmd} ${args.join(' ')}  (${cwd})`)
  // shell:true no Windows para resolver o .cmd do npx (spawn não acha .cmd sem
  // shell). Com shell, caminho com espaço ("C:\Program Files\…") precisa de
  // aspas — senão o cmd corta no primeiro espaço.
  const quote = (s) => (isWin && s.includes(' ') ? `"${s}"` : s)
  const r = spawnSync(isWin ? quote(cmd) : cmd, isWin ? args.map(quote) : args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
    shell: isWin
  })
  if (r.error) console.error(`  ! falhou ao executar: ${r.error.message}`)
  // Não aborta em falha de teste: a contagem de falhas é o dado do relatório.
  return r.status ?? 0
}

/** Uma execução Vitest por categoria — JSON e cobertura em caminhos próprios. */
function runVitestProject(project, rawName, coverageDir) {
  run('npx', [
    'vitest',
    'run',
    '--project',
    project,
    '--coverage',
    '--coverage.reporter=json-summary',
    `--coverage.reportsDirectory=coverage/${coverageDir}`,
    '--reporter=json',
    '--outputFile',
    resolve(RAW, rawName)
  ])
}

if (!noRun) {
  mkdirSync(RAW, { recursive: true })

  // As 3 categorias do ADR-003. `banco` nasce vazia (SQLite entra na Fatia 04) e
  // a parte Playwright de `tela` entra na Fatia 03 — ambas contam 0 sem invalidar
  // o relatório (docs/TESTING.md §8).
  runVitestProject('regras', 'regras.json', 'regras')
  runVitestProject('banco', 'banco.json', 'banco')
  runVitestProject('tela', 'tela-vitest.json', 'tela')
}

const entry = selfcheck ? 'scripts/gen-test-report.selfcheck.mjs' : 'scripts/gen-test-report.mjs'
const genArgs = [resolve(ROOT, entry)]
if (check) genArgs.push('--check')
process.exit(run(process.execPath, genArgs))
