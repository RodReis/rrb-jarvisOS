/**
 * Orquestrador do relatório de testes (ADR-003). Roda os runners com saída
 * `--json` nos caminhos que o `test-report.config.json` espera, depois chama o
 * gerador. Portável (Windows dev + Linux CI).
 *
 *   node scripts/test-report.mjs             # roda tudo + gera reports/TESTS.md
 *   node scripts/test-report.mjs --check     # roda tudo + falha se divergir
 *   node scripts/test-report.mjs --no-run    # só gera do que já existe em reports/.raw
 *   node scripts/test-report.mjs --selfcheck # só prova o gerador (não roda runners)
 *   node scripts/test-report.mjs --check --require-entry
 *                                            # + exige linha da entrega no histórico
 *                                            # (CI, em PR que altera teste)
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
    resolve(RAW, rawName),
    // Segundo reporter, para o terminal. O `--reporter=json` escreve só no arquivo:
    // sem isto, teste que falha **no CI** não aparece em lugar nenhum do log — a
    // única pista fica sendo a divergência de números que a guarda acusa depois,
    // que diz *que* houve falha e não *qual*. Custou uma rodada de CI às cegas.
    '--reporter=default'
  ])
}

if (!noRun) {
  mkdirSync(RAW, { recursive: true })

  // As 3 categorias do ADR-003. A parte Playwright de `tela` passou a existir na
  // Fatia 03 (SPEC-Fundacao-03, critério 9) — antes contava 0 sem invalidar o
  // relatório (docs/TESTING.md §8).
  runVitestProject('regras', 'regras.json', 'regras')
  runVitestProject('banco', 'banco.json', 'banco')
  runVitestProject('tela', 'tela-vitest.json', 'tela')

  // E2E Electron. Exige o build (`out/`) — o Playwright sobe o app empacotado, não o
  // servidor de dev, então rodá-lo sem build testaria a versão anterior do código.
  run('npm', ['run', 'build'])
  // O reporter JSON e o caminho de saída vêm do `playwright.config.ts`, que já grava
  // em `reports/.raw/tela-playwright.json` — o mesmo caminho que o
  // `test-report.config.json` declara para a categoria Tela.
  run('npx', ['playwright', 'test'])
}

const entry = selfcheck ? 'scripts/gen-test-report.selfcheck.mjs' : 'scripts/gen-test-report.mjs'
const genArgs = [resolve(ROOT, entry)]
if (check) genArgs.push('--check')
// Repasse explícito: o wrapper filtra as flags que conhece, então uma flag nova
// do gerador seria descartada em silêncio — e uma guarda que nunca roda é pior
// que guarda nenhuma, porque parece estar protegendo.
if (process.argv.includes('--require-entry')) genArgs.push('--require-entry')
process.exit(run(process.execPath, genArgs))
