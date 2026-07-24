/**
 * Gerador do relatório de testes (ADR-003). Repo-agnóstico: lê tudo de
 * `test-report.config.json` — o único arquivo que muda por projeto. Os NÚMEROS
 * vêm sempre da saída `--json` dos runners (vitest/playwright) + o
 * `coverage-summary.json`; nada é digitado à mão. É a nossa própria filosofia
 * (evidência de máquina, nunca narrada) aplicada ao nosso CI.
 *
 * Portado verbatim do `rrb-proplan` (docs/TESTING.md §10.1), com duas adaptações
 * de forma, não de lógica: ESM em vez de CommonJS (o jarvis é `type: module` e
 * não tem ts-node) e as referências de ADR/gerenciador ajustadas para este repo.
 *
 * Uso:
 *   node scripts/gen-test-report.mjs            # gera/atualiza reports/TESTS.md
 *   node scripts/gen-test-report.mjs --check    # falha (exit 1) se divergir
 *
 * Metadados da entrega (linha do registro) via env:
 *   REPORT_DATE (YYYY-MM-DD) · REPORT_ISSUE (#N) · REPORT_SPEC · REPORT_PR (#N)
 *   REPORT_PR_URL (link do PR; sem ela, monta de `repoUrl` do config + o número)
 * Ausentes → '—' (o relatório continua verdadeiro nos números, que é o que o
 * --check verifica; metadados são rótulos humanos).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = resolve(ROOT, 'test-report.config.json')

const HEADER = [
  '<!-- GERADO AUTOMATICAMENTE por scripts/gen-test-report.mjs — NÃO EDITAR À MÃO.',
  '     Fonte dos números: vitest/playwright --json. Divergência é barrada no CI. -->'
].join('\n')

const TABLE_HEADER =
  '| Data | Issue | SPEC | Categoria | Testes | Pass | Falha | Cobertura % | PR | Link PR |\n' +
  '|------|-------|------|-----------|-------:|-----:|------:|------------:|----:|--------|'

function loadConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
}

/** Lê a saída `--json` de um runner (Vitest emite o formato Jest-compatível). */
function readRunnerJson(path) {
  const abs = resolve(ROOT, path)
  if (!existsSync(abs)) return { total: 0, passed: 0, failed: 0 }
  const j = JSON.parse(readFileSync(abs, 'utf-8'))
  return {
    total: j.numTotalTests ?? 0,
    passed: j.numPassedTests ?? 0,
    failed: j.numFailedTests ?? 0
  }
}

/**
 * Lê o JSON do Playwright (formato próprio: suites/specs com stats).
 *
 * Sem chamador ativo desde o card #34: nenhuma categoria do config declara
 * `playwrightJson` (o E2E virou check de CI à parte, fora do relatório). Mantido
 * de propósito — o gerador é repo-agnóstico (porta verbatim, TESTING.md §7) e
 * outra stack pode voltar a somar Playwright a uma categoria só declarando o
 * caminho. `buildRows` já o chama condicionalmente (`cat.playwrightJson ? …`).
 */
function readPlaywrightJson(path) {
  const abs = resolve(ROOT, path)
  if (!existsSync(abs)) return { total: 0, passed: 0, failed: 0 }
  const j = JSON.parse(readFileSync(abs, 'utf-8'))
  const s = j.stats ?? {}
  const passed = s.expected ?? 0
  const failed = (s.unexpected ?? 0) + (s.flaky ?? 0)
  return { total: passed + failed, passed, failed }
}

/** Cobertura de linhas (%) do coverage-summary.json, ou '—' se ausente. */
function readCoverage(path) {
  if (!path) return '—'
  const abs = resolve(ROOT, path)
  if (!existsSync(abs)) return '—'
  const j = JSON.parse(readFileSync(abs, 'utf-8'))
  const pct = j.total?.lines?.pct
  return typeof pct === 'number' ? pct.toFixed(1) : '—'
}

function buildRows(cfg) {
  return cfg.categories.map((cat) => {
    const runner = readRunnerJson(cat.resultsJson)
    const pw = cat.playwrightJson
      ? readPlaywrightJson(cat.playwrightJson)
      : { total: 0, passed: 0, failed: 0 }
    return {
      category: cat.name,
      tests: runner.total + pw.total,
      pass: runner.passed + pw.passed,
      fail: runner.failed + pw.failed,
      coverage: readCoverage(cat.coverageSummary)
    }
  })
}

/**
 * Metadados da entrega. O link do PR vem de `REPORT_PR_URL` (o CI tem a URL
 * pronta em `github.event.pull_request.html_url`); sem ela, monta de
 * `repoUrl` do config + o número do PR. Sem nenhum dos dois → '—'. O gerador
 * não conhece GitHub nem lê o git remote — segue repo-agnóstico (TESTING.md §7).
 */
function buildMeta(cfg) {
  const pr = envOrDash('REPORT_PR')
  return {
    date: envOrDash('REPORT_DATE'),
    issue: envOrDash('REPORT_ISSUE'),
    spec: envOrDash('REPORT_SPEC'),
    pr,
    prLink: prLinkOf(pr, cfg.repoUrl)
  }
}

/** Env ausente OU vazia → '—'. O CI exporta a var vazia quando o PR não traz o
 *  metadado (ex.: sem `refs #N` no corpo); vazio é ausência, não um rótulo. */
function envOrDash(name) {
  const v = process.env[name]
  return v && v.trim() ? v.trim() : '—'
}

/** `#62` + base → `[#62](https://…/pull/62)`. Sem número ou sem base → '—'. */
function prLinkOf(pr, repoUrl) {
  const fromEnv = process.env.REPORT_PR_URL?.trim()
  const url = fromEnv || urlFromBase(pr, repoUrl)
  return url && pr !== '—' ? `[${pr}](${url})` : '—'
}

function urlFromBase(pr, repoUrl) {
  const num = pr.replace(/^#/, '')
  if (!repoUrl || !/^\d+$/.test(num)) return null
  return `${repoUrl.replace(/\/+$/, '')}/pull/${num}`
}

function rowLine(r, m) {
  return `| ${m.date} | ${m.issue} | ${m.spec} | ${r.category} | ${r.tests} | ${r.pass} | ${r.fail} | ${r.coverage} | ${m.pr} | ${m.prLink} |`
}

const HISTORY_MARKER = '## Histórico por entrega'
const ESTADO_MARKER = '## Estado atual'

/**
 * Normaliza a quebra de linha antes de qualquer comparação. O gerador emite LF;
 * o arquivo commitado chega com CRLF num checkout Windows (`core.autocrlf`).
 * Sem isto o `--check` acusava divergência entre blocos idênticos — cada linha
 * diferia por um `\r` invisível no print do erro. Um guard que falha sempre é um
 * guard que ninguém lê: falhar em número certo é o mesmo que não falhar em
 * número errado.
 */
function lf(s) {
  return s.replace(/\r\n/g, '\n')
}

/**
 * Bloco "Estado atual" (só os números, metadados neutros) — é o que a guarda
 * anti-drift compara. Isola os números da forja sem depender dos rótulos
 * Data/Issue/PR, que legitimamente variam por PR.
 */
function estadoAtualBlock(docRaw) {
  const doc = lf(docRaw)
  const start = doc.indexOf(ESTADO_MARKER)
  if (start === -1) return ''
  const rest = doc.slice(start)
  const end = rest.indexOf(HISTORY_MARKER)
  return (end === -1 ? rest : rest.slice(0, end)).trim()
}

/**
 * Linhas do histórico já commitadas. Lê SÓ a seção após o marcador de
 * histórico — o "Estado atual" é sempre regenerado e nunca deve realimentar o
 * histórico.
 */
export function keepHistory(existingRaw) {
  const existing = lf(existingRaw)
  const idx = existing.indexOf(HISTORY_MARKER)
  if (idx === -1) return []
  const section = existing.slice(idx)
  const out = []
  for (const line of section.split('\n')) {
    if (!line.startsWith('| ') || line.includes('---')) continue
    if (line.includes('| Data |')) continue
    // Toda linha commitada fica. Append-only significa isto e nada mais.
    out.push(line.trimEnd())
  }
  return out
}

/**
 * O histórico é **append-only** (TESTING.md §4): linha commitada nunca é
 * reescrita nem descartada. Duas regras, ambas nascidas de bugs reais no
 * `rrb-proplan` — o jarvis herda o conserto, não precisa reviver o bug:
 *
 * 1. **Sem issue não apaga.** Uma versão anterior fazia
 *    `meta.issue !== '—' ? keepHistory(...) : []` — rodar `npm run test:report`
 *    local (sem PR, logo sem `refs #N`) **zerava o histórico inteiro**. Agora o
 *    histórico é sempre preservado.
 * 2. **Sem issue não acrescenta.** Uma linha `| — | — | — |` não é evidência
 *    de entrega: não diz o que foi entregue nem por qual PR. Rodar local
 *    atualiza só o `Estado atual` — que é regenerado por contrato.
 *
 * O "upsert" da versão anterior (remover as linhas da issue atual antes de
 * reescrevê-las) **contradizia o append-only** e foi removido: uma reentrega da
 * mesma issue vira uma linha nova, datada. Duas execuções são dois fatos.
 */
export function render(rows, existing, m) {
  const history = existing ? keepHistory(existing) : []
  const newLines = m.issue !== '—' ? rows.map((r) => rowLine(r, m)) : []
  const allLines = [...history, ...newLines]

  const estadoAtual =
    '## Estado atual\n\n' +
    'Totais da última execução (regenerado, não acumulado):\n\n' +
    TABLE_HEADER +
    '\n' +
    rows
      .map(
        (r) =>
          `| — | — | — | ${r.category} | ${r.tests} | ${r.pass} | ${r.fail} | ${r.coverage} | — | — |`
      )
      .join('\n')

  const historico =
    HISTORY_MARKER +
    '\n\n' +
    'Append-only — linhas de entregas passadas são imutáveis.\n\n' +
    TABLE_HEADER +
    '\n' +
    allLines.join('\n')

  return [
    HEADER,
    '',
    '# TESTS.md — Registro de evidência de testes',
    '',
    '> Gerado por `scripts/gen-test-report.mjs` (ADR-003). Números vêm do `--json`',
    '> dos runners. Ver `docs/TESTING.md` para a metodologia.',
    '',
    estadoAtual,
    '',
    historico,
    ''
  ].join('\n')
}

/**
 * Linhas do histórico de `before` que não sobreviveram em `after`.
 *
 * Append-only é **verificável por continência**, não por igualdade: o histórico
 * novo pode ter linhas a mais (a entrega atual), nunca a menos. Comparar os
 * blocos inteiros exigiria que Data/Issue/PR batessem — os metadados que variam
 * legitimamente por PR, e a razão de o `--check` olhar só os números do "Estado
 * atual" (TESTING.md §5). Continência não sofre desse problema.
 *
 * **O `before` tem de ser independente do arquivo auditado.** Uma primeira versão
 * desta guarda comparava o arquivo com a saída de `render(…, existing)` — que é
 * construída A PARTIR do próprio arquivo via `keepHistory`. Histórico apagado
 * ⇒ os dois lados vinham vazios ⇒ "íntegro". A guarda comparava o arquivo
 * corrompido consigo mesmo e passava. Por isso o call site usa como baseline o
 * blob do git na base do PR (`reportAtBase`): a evidência de que uma linha
 * existia não pode vir de dentro do arquivo que a apagou.
 */
export function droppedHistory(before, after) {
  const kept = new Set(keepHistory(after))
  return keepHistory(before).filter((line) => !kept.has(line))
}

/**
 * O relatório na revisão-baseline — a referência independente do append-only.
 *
 * Qual revisão importa: no CI de PR o checkout deixa HEAD no **merge commit**,
 * cujo `reports/TESTS.md` é a versão do próprio PR — comparar com ela seria o
 * mesmo auto-testemunho que essa guarda existe para fechar. A baseline correta
 * é o alvo do PR (`origin/main`), que é o histórico ao qual o PR acrescenta.
 * `REPORT_BASE_REF` deixa o CI dizer isso explicitamente; local, HEAD serve.
 *
 * Sem git, sem a ref, ou arquivo inexistente na baseline → null: não há
 * histórico anterior a proteger e a guarda não tem o que provar. Nunca derruba
 * o CI por ausência de git; só por linha que sumiu.
 */
function reportAtBase(cfg) {
  const ref = process.env.REPORT_BASE_REF?.trim() || 'HEAD'
  try {
    return execFileSync('git', ['show', `${ref}:${cfg.reportPath}`], {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
  } catch {
    return null // sem git, ref ausente, ou arquivo novo na baseline
  }
}

/**
 * A entrega tem linha no histórico? (guarda portada do rrb-proplan, 2026-07-22)
 *
 * O furo que fecha: os metadados da linha (`REPORT_ISSUE`/`REPORT_SPEC`/
 * `REPORT_PR`) só existem no CI, que os extrai do corpo do PR. Rodando
 * `npm run test:report` na máquina do dev eles não existem, e o gerador —
 * corretamente — atualiza só o "Estado atual" e **não** acrescenta linha
 * (`| — | — | — |` não é evidência de entrega). Nada verificava que a linha
 * passou a existir: no repo de origem, duas entregas mergearam com o histórico
 * mudo, e a tabela passou a sugerir que não tiveram teste — sendo que tinham
 * centenas de testes verdes.
 *
 * Não substitui o `--check`: aquele prova que os NÚMEROS não foram forjados;
 * este prova que a ENTREGA foi carimbada. Formas diferentes de mentir.
 */
/**
 * A cobrança do carimbo se aplica a este PR?
 *
 * Duas condições. `--require-entry` já limita ao CI (rodando local não há `refs
 * #N`, e o CI só passa a flag quando o PR mexe em arquivo de teste). Falta a
 * segunda: **é preciso haver uma issue**.
 *
 * Sem issue a cobrança é impossível de satisfazer — e por contrato, não por
 * acidente: o gerador se recusa a acrescentar linha quando `meta.issue === '—'`
 * (regra "sem issue não acrescenta", TESTING.md §5), então exigir a linha pediria
 * exatamente o que ele não escreve. É o caso do PR de infra que altera os próprios
 * scripts de teste sem pertencer a uma fatia: não é entrega, não há o que carimbar.
 */
export function shouldRequireEntry(requireEntry, issue) {
  return requireEntry && Boolean(issue) && issue !== '—'
}

export function hasHistoryEntry(docRaw, issue) {
  if (!issue || issue === '—') return false
  // A issue é a 2ª coluna: `| data | #N | SPEC | categoria | …`. Casar a célula
  // inteira evita que `#10` valide um PR que referencia a `#1`.
  return keepHistory(docRaw).some((line) => {
    const cells = line.split('|').map((c) => c.trim())
    return cells[2] === issue
  })
}

function main() {
  const check = process.argv.includes('--check')
  const requireEntry = process.argv.includes('--require-entry')
  const cfg = loadConfig()
  const meta = buildMeta(cfg)
  const reportAbs = resolve(ROOT, cfg.reportPath)
  const existing = existsSync(reportAbs) ? readFileSync(reportAbs, 'utf-8') : ''
  const rows = buildRows(cfg)
  const next = render(rows, existing, meta)

  if (check) {
    // Duas provas independentes, porque são duas formas de forjar:
    //   1. NÚMEROS — só a seção "Estado atual" (metadados neutros); não os
    //      rótulos Data/Issue/PR, que variam por PR. Pega o número editado à
    //      mão sem forçar cada PR a pré-commitar metadados.
    //   2. HISTÓRICO — append-only por continência contra a base do PR (ver
    //      `droppedHistory`). Números certos e histórico zerado passavam batido.
    const committed = estadoAtualBlock(existing)
    const fresh = estadoAtualBlock(next)
    if (committed !== fresh) {
      console.error(
        '[gen-test-report] DIVERGÊNCIA de NÚMEROS: reports/TESTS.md não bate com uma execução limpa.\n' +
          'Rode `npm run test:report` e commite o resultado. Números não podem ser editados à mão (ADR-003).\n' +
          `--- commitado ---\n${committed}\n--- execução limpa ---\n${fresh}`
      )
      process.exit(1)
    }

    // Baseline = git (base do PR), nunca `existing`: o arquivo não pode ser
    // testemunha da própria integridade (histórico apagado "concorda" consigo).
    const base = reportAtBase(cfg)
    const dropped = base ? droppedHistory(base, existing) : []
    if (dropped.length) {
      console.error(
        '[gen-test-report] HISTÓRICO PERDIDO: o append-only foi violado — ' +
          `${dropped.length} linha(s) commitada(s) sumiram de ${cfg.reportPath} (TESTING.md §4).\n` +
          'Linha de entrega passada é imutável: restaure-as (git checkout HEAD -- ' +
          `${cfg.reportPath}) e rode \`npm run test:report\` de novo.\n` +
          `--- linhas perdidas ---\n${dropped.join('\n')}`
      )
      process.exit(1)
    }

    // 3. CARIMBO — a entrega tem linha no histórico? Só quando o CI pede
    //    (`--require-entry`), porque exige uma issue conhecida: rodando local,
    //    sem PR, não há `refs #N` e a cobrança seria impossível de satisfazer.
    //
    //    O caso sem issue está em `shouldRequireEntry` (ver o porquê lá).
    const carimbavel = shouldRequireEntry(requireEntry, meta.issue)

    if (carimbavel && !hasHistoryEntry(existing, meta.issue)) {
      console.error(
        `[gen-test-report] ENTREGA SEM CARIMBO: ${cfg.reportPath} não tem linha de histórico para a issue ${meta.issue}.\n` +
          'Este PR altera testes, então a entrega precisa de evidência datada (ADR-003, TESTING.md §4).\n' +
          'Rode, na raiz do repo:\n' +
          `  REPORT_ISSUE=${meta.issue} REPORT_SPEC=${meta.spec} REPORT_PR=${meta.pr} npm run test:report\n` +
          'e commite o reports/TESTS.md. Sem isso a tabela sugere que a entrega não teve teste.'
      )
      process.exit(1)
    }

    let carimbo = ''
    if (carimbavel) {
      carimbo = ` Entrega ${meta.issue} carimbada no histórico.`
    } else if (requireEntry) {
      carimbo = ' PR sem `refs #N` (infra, não é entrega de fatia): nada a carimbar.'
    }

    console.log(
      '[gen-test-report] --check OK: os números batem com a execução limpa e o histórico está íntegro.' +
        carimbo
    )
    return
  }

  mkdirSync(dirname(reportAbs), { recursive: true })
  writeFileSync(reportAbs, next, 'utf-8')
  console.log(`[gen-test-report] escrito ${cfg.reportPath}:`)
  for (const r of rows) {
    console.log(
      `  ${r.category}: ${r.tests} testes, ${r.pass} pass, ${r.fail} falha, cob ${r.coverage}%`
    )
  }
}

// Só executa quando chamado como script — assim o self-check importa `render` e
// `keepHistory` sem disparar os runners.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
