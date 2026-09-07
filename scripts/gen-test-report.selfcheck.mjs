/**
 * Self-check do gerador de relatório (ADR-003). Roda com
 * `node scripts/gen-test-report.selfcheck.mjs` — sem framework, sem fixture.
 *
 * Por que não é Vitest: este script prova a *guarda*, e a guarda não pode
 * depender do mesmo runner que ela audita. `assert` puro do Node basta e não
 * atravessa a fronteira de `include` dos projects do Vitest.
 *
 * Portado verbatim do `rrb-proplan` (docs/TESTING.md §10.2). Cada caso aqui
 * corresponde a uma forma real de o append-only quebrar em silêncio — no
 * proplan o histórico de uma spec inteira sumiu sob CI verde.
 */
import { strict as assert } from 'node:assert'

import {
  droppedHistory,
  estadoAtualComparavel,
  hasHistoryEntry,
  keepHistory,
  perdaDeArquivos,
  shouldRequireEntry
} from './gen-test-report.mjs'

const LINHA_A =
  '| 2026-07-16 | #3 | SPEC-016 | Regras de Negócio | 501 | 501 | 0 | 76.7 | #65 | [#65](https://x/pull/65) |'
const LINHA_B =
  '| 2026-07-16 | #3 | SPEC-016 | Banco | 0 | 0 | 0 | — | #65 | [#65](https://x/pull/65) |'
const LINHA_NOVA =
  '| 2026-07-17 | #70 | SPEC-020 | Regras de Negócio | 536 | 536 | 0 | 78.2 | #71 | [#71](https://x/pull/71) |'

const TABLE_HEADER =
  '| Data | Issue | SPEC | Categoria | Testes | Pass | Falha | Cobertura % | PR | Link PR |\n' +
  '|------|-------|------|-----------|-------:|-----:|------:|------------:|----:|--------|'

/** Documento mínimo com as duas seções, como o gerador escreve. */
function doc(historico, estadoAtual = []) {
  return [
    '## Estado atual',
    '',
    TABLE_HEADER,
    ...estadoAtual,
    '',
    '## Histórico por entrega',
    '',
    TABLE_HEADER,
    ...historico,
    ''
  ].join('\n')
}

function run(nome, fn) {
  fn()
  console.log(`  ok — ${nome}`)
}

console.log('[selfcheck] gen-test-report')

run('keepHistory lê só a seção de histórico, nunca o Estado atual', () => {
  const estadoAtual = ['| — | — | — | Regras de Negócio | 509 | 509 | 0 | 78.2 | — | — |']
  assert.deepEqual(keepHistory(doc([LINHA_A], estadoAtual)), [LINHA_A])
})

run('keepHistory ignora cabeçalho e separador da tabela', () => {
  const linhas = keepHistory(doc([LINHA_A, LINHA_B]))
  assert.deepEqual(linhas, [LINHA_A, LINHA_B])
})

run('append puro: nada perdido quando só acrescenta', () => {
  const antes = doc([LINHA_A, LINHA_B])
  const depois = doc([LINHA_A, LINHA_B, LINHA_NOVA])
  assert.deepEqual(droppedHistory(antes, depois), [])
})

run('idêntico: nada perdido', () => {
  const d = doc([LINHA_A, LINHA_B])
  assert.deepEqual(droppedHistory(d, d), [])
})

run('O BUG HERDADO DO PROPLAN: histórico zerado é detectado', () => {
  const antes = doc([LINHA_A, LINHA_B])
  const zerado = doc([])
  assert.deepEqual(droppedHistory(antes, zerado), [LINHA_A, LINHA_B])
})

run('linha commitada reescrita (upsert) conta como perdida', () => {
  const antes = doc([LINHA_A])
  const adulterada = doc([LINHA_A.replace('501 | 501', '999 | 999')])
  assert.deepEqual(droppedHistory(antes, adulterada), [LINHA_A])
})

run('uma sumindo no meio é detectada, as outras não viram falso positivo', () => {
  const antes = doc([LINHA_A, LINHA_B, LINHA_NOVA])
  const depois = doc([LINHA_A, LINHA_NOVA])
  assert.deepEqual(droppedHistory(antes, depois), [LINHA_B])
})

run('primeira execução (sem histórico anterior) não acusa perda', () => {
  assert.deepEqual(droppedHistory('', doc([LINHA_NOVA])), [])
})

run('CRLF (checkout Windows) não vira falso positivo', () => {
  const commitado = doc([LINHA_A, LINHA_B]).replace(/\n/g, '\r\n') // como o git entrega
  const gerado = doc([LINHA_A, LINHA_B]) // como o gerador emite (LF)
  assert.deepEqual(droppedHistory(commitado, gerado), [])
  assert.deepEqual(keepHistory(commitado), [LINHA_A, LINHA_B])
})

run('CRLF não mascara perda real', () => {
  const commitado = doc([LINHA_A, LINHA_B]).replace(/\n/g, '\r\n')
  assert.deepEqual(droppedHistory(commitado, doc([LINHA_A])), [LINHA_B])
})

// --- carimbo da entrega -----------------------------------------------------
// A guarda que barra o merge quando um PR altera testes e não deixa linha no
// histórico. Sem estes checks, um bug nela a desligaria em silêncio — que é
// exatamente como, no repo de origem, o registro de uma spec sumiu sob CI verde.

run('reconhece a linha da issue no histórico', () => {
  assert.equal(hasHistoryEntry(doc([LINHA_A, LINHA_B]), '#3'), true)
})

run('issue sem linha no histórico é recusada', () => {
  assert.equal(hasHistoryEntry(doc([LINHA_A]), '#99'), false)
})

run('histórico vazio recusa qualquer issue', () => {
  assert.equal(hasHistoryEntry(doc([]), '#3'), false)
})

// O furo real: rodar local sem PR gera meta.issue = '—'. Se isso contasse como
// carimbo, a guarda passaria justamente no caso que ela existe para pegar.
run("issue '—' (execução local, sem PR) nunca conta como carimbo", () => {
  assert.equal(hasHistoryEntry(doc([LINHA_A]), '—'), false)
  assert.equal(hasHistoryEntry(doc([LINHA_A]), ''), false)
})

// Casa a célula inteira: com `includes`, '#1' validaria a linha da '#10'.
run('não confunde #1 com #10 (prefixo não basta)', () => {
  const linha10 = LINHA_A.replace('| #3 |', '| #10 |')
  assert.equal(hasHistoryEntry(doc([linha10]), '#1'), false)
  assert.equal(hasHistoryEntry(doc([linha10]), '#10'), true)
})

run('CRLF não impede reconhecer o carimbo', () => {
  const crlf = doc([LINHA_A]).replace(/\n/g, '\r\n')
  assert.equal(hasHistoryEntry(crlf, '#3'), true)
})

// O 'Estado atual' tem linhas `| — | — | — |` por contrato; se o parser as
// lesse, toda entrega pareceria carimbada.
run('linha do Estado atual não é confundida com carimbo', () => {
  const estado = '| — | — | — | Regras de Negócio | 509 | 509 | 0 | 78.2 | — | — |'
  assert.equal(hasHistoryEntry(doc([], [estado]), '#3'), false)
})

// --- quando a cobrança se aplica -------------------------------------------
// `hasHistoryEntry` responde "está carimbado?". Estes respondem "cabe cobrar?",
// que é uma decisão separada — e foi onde a guarda nasceu quebrada: no PR #26
// ela cobrou carimbo de um PR de infra sem `refs #N`, exigindo uma linha que o
// gerador se recusa a escrever ("sem issue não acrescenta"). Guarda impossível
// de satisfazer é guarda que alguém desliga.

run('cobra o carimbo quando há issue e o CI pediu', () => {
  assert.equal(shouldRequireEntry(true, '#8'), true)
})

run('não cobra fora do CI, mesmo com issue', () => {
  assert.equal(shouldRequireEntry(false, '#8'), false)
})

run('não cobra PR de infra, sem `refs #N` (o furo do #26)', () => {
  assert.equal(shouldRequireEntry(true, '—'), false)
  assert.equal(shouldRequireEntry(true, ''), false)
  assert.equal(shouldRequireEntry(true, undefined), false)
})

// --- execução incompleta do runner (#232) ----------------------------------
// O pool do Vitest às vezes perde um worker e a execução **termina verde**: zero
// falhas, `success: true`, e um arquivo inteiro fora da contagem. O total apenas
// cai. A guarda anti-drift então compara o relatório contra a mesma execução
// incompleta e concorda consigo mesma — o número falso entra no histórico
// append-only, onde fica para sempre.
//
// `docs/TESTING.md` §1: *"evidência de máquina, nunca narrada"*. Execução que
// perde arquivo em silêncio deixa de ser evidência e vira afirmação.
//
// **Por que um piso, e não a comparação que a issue propunha.** A saída do
// runner diz quantos arquivos ele *relatou*, nunca quantos pretendia rodar —
// `numTotalTestSuites` conta blocos `describe` (379 contra 67 arquivos no banco),
// e compará-lo com `testResults` acusaria toda execução saudável. O piso é a
// única fonte confiável: quantos arquivos a última execução íntegra teve.

run('primeira execução da categoria não acusa — não há piso ainda', () => {
  assert.equal(perdaDeArquivos({ Banco: 67 }, {}), null)
})

run('mesma contagem passa', () => {
  assert.equal(perdaDeArquivos({ Banco: 67 }, { Banco: 67 }), null)
})

run('arquivo a mais passa — teste novo é rotina', () => {
  assert.equal(perdaDeArquivos({ Banco: 68 }, { Banco: 67 }), null)
})

run('arquivo a menos é acusado, com a categoria e os dois números', () => {
  const perda = perdaDeArquivos({ Banco: 66 }, { Banco: 67 })

  assert.equal(perda?.length, 1)
  assert.equal(perda[0].categoria, 'Banco')
  assert.equal(perda[0].agora, 66)
  assert.equal(perda[0].piso, 67)
})

run('acusa todas as categorias que perderam, não só a primeira', () => {
  const perda = perdaDeArquivos({ Banco: 66, Tela: 40 }, { Banco: 67, Tela: 41 })

  assert.equal(perda?.length, 2)
})

run('categoria que sumiu do config não é acusada', () => {
  // Remover uma categoria é decisão de quem edita o config, não perda de arquivo.
  assert.equal(perdaDeArquivos({ Banco: 67 }, { Banco: 67, Antiga: 10 }), null)
})

// --- Cobertura report-only (ADR-003 ponto 5, issue #327) ---------------------

run('cobertura diferente NÃO é divergência: o ADR-003 a declara report-only', () => {
  // O caso real da PR #326: dois arquivos de documentação, contagens idênticas,
  // e o gate reprovando por uma décima. A cobertura do Banco está em 87.05, e
  // uma única linha coberta a mais alterna o dígito entre execuções.
  const a = doc([], ['| — | — | — | Banco | 1215 | 1201 | 0 | 87.0 | — | — |'])
  const b = doc([], ['| — | — | — | Banco | 1215 | 1201 | 0 | 87.1 | — | — |'])
  assert.equal(estadoAtualComparavel(a), estadoAtualComparavel(b))
})

run('número de testes diferente CONTINUA sendo divergência', () => {
  const a = doc([], ['| — | — | — | Banco | 1215 | 1201 | 0 | 87.0 | — | — |'])
  const b = doc([], ['| — | — | — | Banco | 1200 | 1201 | 0 | 87.0 | — | — |'])
  assert.notEqual(estadoAtualComparavel(a), estadoAtualComparavel(b))
})

run('número de FALHAS diferente continua sendo divergência', () => {
  // O contrapeso que guarda contra o erro de índice: neutralizar a célula errada
  // apagaria justamente a coluna que a guarda existe para proteger.
  const a = doc([], ['| — | — | — | Banco | 1215 | 1201 | 0 | 87.0 | — | — |'])
  const b = doc([], ['| — | — | — | Banco | 1215 | 1201 | 9 | 87.0 | — | — |'])
  assert.notEqual(estadoAtualComparavel(a), estadoAtualComparavel(b))
})

run('número de aprovados diferente continua sendo divergência', () => {
  const a = doc([], ['| — | — | — | Banco | 1215 | 1201 | 0 | 87.0 | — | — |'])
  const b = doc([], ['| — | — | — | Banco | 1215 | 1100 | 0 | 87.0 | — | — |'])
  assert.notEqual(estadoAtualComparavel(a), estadoAtualComparavel(b))
})

run('a categoria continua sendo comparada', () => {
  const a = doc([], ['| — | — | — | Banco | 1215 | 1201 | 0 | 87.0 | — | — |'])
  const b = doc([], ['| — | — | — | Tela | 1215 | 1201 | 0 | 87.0 | — | — |'])
  assert.notEqual(estadoAtualComparavel(a), estadoAtualComparavel(b))
})

console.log('[selfcheck] OK — 31 checks')
