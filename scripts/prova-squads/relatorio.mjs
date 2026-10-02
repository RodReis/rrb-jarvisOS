/**
 * Agrega as medições da M11-F00 em `reports/squads-prova-m11-f00.md` (SPEC-Squads-00, critérios
 * 1, 2 e 4). Só lê o que está em `reports/squads-prova/*.json` — não mede nada, não decide nada
 * que os JSONs não digam: aprovado ou reprovado sai da comparação do número com o critério do PI.
 *
 *   node scripts/prova-squads/relatorio.mjs
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PASTA = join(RAIZ, 'reports', 'squads-prova')
const SAIDA = join(RAIZ, 'reports', 'squads-prova-m11-f00.md')
const CRITERIO_PLANOS = 0.8

const ler = (nome) => JSON.parse(readFileSync(join(PASTA, nome), 'utf8'))
const arquivos = readdirSync(PASTA)
const pct = (x) => `${(x * 100).toFixed(1)}%`
const gb = (b) => (b === null ? '—' : `${(b / 1024 ** 3).toFixed(1)} GB`)
const seg = (ms) => `${(ms / 1000).toFixed(1)} s`

const snapshot = ler('snapshot.json')
const orquestradores = arquivos
  .filter((a) => /^orquestrador-.*\.json$/.test(a) && !a.includes('.v1-'))
  .map(ler)
  .sort((a, b) => a.modelo.localeCompare(b.modelo))
const integradores = arquivos
  .filter((a) => /^integrador-.*\.json$/.test(a))
  .map(ler)
  .sort((a, b) => a.camada.localeCompare(b.camada))
const casos = existsSync(join(PASTA, 'casos-integrador.json'))
  ? ler('casos-integrador.json')
  : undefined
const v1 = arquivos.filter((a) => a.includes('.v1-')).map(ler)

const modelosOllama = (() => {
  try {
    return execFileSync('ollama', ['list'], { encoding: 'utf8' })
      .split('\n')
      .slice(1)
      .filter((l) => /hermes3:8b|qwen3:8b/.test(l))
      .map((l) =>
        l
          .split(/\s{2,}/)
          .slice(0, 2)
          .join(' · ')
      )
  } catch {
    return ['indisponível']
  }
})()

const L = []
const p = (...t) => L.push(...t)

p('# Prova M11-F00 — orquestrador local e integrador', '')
p(
  '> Gerado por `scripts/prova-squads/relatorio.mjs` a partir de `reports/squads-prova/*.json`. ',
  '> SPEC: [SPEC-Squads-00](../docs/spec/spec-squads-00-prova-orquestrador-integrador.md) · issue #369.',
  ''
)

p('## Veredito', '')
const aprovadoPlanos = orquestradores.filter(
  (o) => o.taxa >= CRITERIO_PLANOS && o.modelo.includes(':') && !o.modelo.startsWith('fase:')
)
p('| Critério do PI | Resultado | Número |', '|---|---|---|')
for (const o of orquestradores.filter((x) => !x.modelo.startsWith('fase:')))
  p(
    `| Orquestrador \`${o.modelo}\` ≥ 80% de planos aceitos | **${o.taxa >= CRITERIO_PLANOS ? 'APROVADO' : 'REPROVADO'}** | ${o.aceitos}/${o.total} = ${pct(o.taxa)} |`
  )
for (const i of integradores)
  p(
    `| Integrador \`${i.camada}\`: zero hunk perdido sem registro **e** 100% de suítes verdes | **${i.aprovado ? 'APROVADO' : 'REPROVADO'}** | perdidos sem registro: ${i.perdidosSemRegistro}; suítes verdes: ${i.suitesVerdes} |`
  )
p('')
p(
  aprovadoPlanos.length === 0
    ? '**Recomendação:** nenhum modelo local atingiu o critério. O padrão do orquestrador é o **modelo da fase**, pela assinatura (regra 2 da SPEC); o local fica como opção.'
    : `**Recomendação:** candidato(s) a padrão: ${aprovadoPlanos.map((o) => `\`${o.modelo}\``).join(', ')} — a decisão de adotar é do PI.`,
  ''
)

p('## Ambiente (regra 4)', '')
p(`- GPU: ${snapshot.hardware.gpu}`)
p(`- Node ${snapshot.hardware.node} · ${snapshot.hardware.so}`)
p(`- Modelos Ollama: ${modelosOllama.join('; ')}`)
p(
  `- \`num_ctx\` pedido: ${orquestradores[0]?.numCtxPedido ?? '—'} · temperatura 0 · semente ${orquestradores[0]?.semente ?? '—'} · \`think: false\``
)
p(
  `- Snapshot: ${snapshot.criadoEm} · validador \`${snapshot.validadorSha256.slice(0, 12)}\` · manifesto \`${snapshot.manifestoSha256.slice(0, 12)}\``
)
p('')

p('## Critério 1 — planos aceitos, por modelo e por fatia', '')
for (const o of orquestradores) {
  p(`### \`${o.modelo}\` — ${o.aceitos}/${o.total} (${pct(o.taxa)})`, '')
  p(
    '| Fatia | Critérios | Decisão | Motivos de rejeição | Latência | Prompt / saída (tokens) | `num_ctx` efetivo | VRAM |',
    '|---|---:|---|---|---:|---|---:|---:|'
  )
  for (const r of o.resultados) {
    const f = snapshot.fatias.find((x) => x.id === r.fatia)
    const motivos = [...new Set(r.decisao.rejeicoes.map((x) => x.motivo))]
    const contagem = motivos.map(
      (m) => `${m}×${r.decisao.rejeicoes.filter((x) => x.motivo === m).length}`
    )
    p(
      `| ${r.fatia} | ${f.criterios.length} | ${r.decisao.aceito ? 'aceito' : 'rejeitado'} | ${contagem.join(', ') || '—'} | ${seg(r.latenciaMs)} | ${r.promptTokens ?? '—'} / ${r.saidaTokens ?? '—'} | ${r.numCtxEfetivo ?? '—'} | ${gb(r.vramBytes)} |`
    )
  }
  const lat = o.resultados.map((r) => r.latenciaMs).sort((a, b) => a - b)
  const motivosTotais = {}
  for (const r of o.resultados)
    for (const x of r.decisao.rejeicoes)
      motivosTotais[x.motivo] = (motivosTotais[x.motivo] ?? 0) + 1
  p(
    '',
    `Latência: mediana ${seg(lat[Math.floor(lat.length / 2)])}, máxima ${seg(lat.at(-1))}. Truncamento de prompt: ${o.resultados.filter((r) => r.truncado).length}.`
  )
  p(
    `Rejeições por motivo: ${
      Object.entries(motivosTotais)
        .sort((a, b) => b[1] - a[1])
        .map(([m, n]) => `${m}×${n}`)
        .join(', ') || 'nenhuma'
    }.`,
    ''
  )
}
if (v1.length > 0) {
  p('### Medição v1 arquivada', '')
  for (const o of v1)
    p(
      `- \`${o.modelo}\` com o teto fixo de 12 tarefas: ${o.aceitos}/${o.total} (${pct(o.taxa)}). Duas fatias têm 13 critérios e cada tarefa aponta um critério só, então cobri-los com 12 tarefas era impossível para qualquer modelo; o teto passou a \`max(12, nº de critérios)\` no **perfil** — o validador, congelado por hash, não mudou. Os dois números ficam aqui para o PI ver o efeito da correção.`
    )
  p('')
}

p('## Critérios 2 e 3 — integrador', '')
if (casos) {
  const por = (t) => casos.casos.filter((c) => c.tipo === t).length
  p(
    `**Amostra:** ${por('sintetico')} casos sintéticos (conflito injetado sobre fatia real) + ${por('historico')} históricos reais (merges de \`main\` que conflitaram, todos de docs) + ${por('par')} reconstruídos por pares de fatias.`,
    '',
    'Os pares de fatias do conjunto de referência deram **zero** casos: o processo é WIP=1 e linear, e nenhuma das 17 fatias nasceu de uma main que andou. Motivos dos pares descartados: ' +
      Object.entries(casos.descartados.pares)
        .map(([m, n]) => `${m} (${n})`)
        .join('; ') +
      '.',
    ''
  )
}
const pisoDe = (id) => casos?.casos.find((c) => c.id === id)?.perdidosNaVerdade ?? '—'

p(
  '**Como ler os "perdidos sem registro".** O manifesto lista todo hunk que os dois escritores produziram e conta como perdido o que não está no resultado e não tem motivo registrado. O **piso** é o mesmo cálculo sobre a resposta de verdade (o PR real, ou o merge humano): ele não é zero. Nos sintéticos, o hunk mutado (`// w2`) só pode entrar se o integrador escolher um lado e **registrar** o descarte do outro; nos merges de docs, o humano também descartou linhas superadas sem registro. Um integrador no piso fez o que a verdade fez; acima do piso, perdeu algo a mais.',
  ''
)

for (const i of integradores) {
  p(`### Camada \`${i.camada}\` — ${i.aprovado ? 'APROVADA' : 'REPROVADA'}`, '')
  p(
    '| Caso | Tipo | Blocos | Hunks | Preservados | Descartados c/ motivo | **Perdidos sem registro** | Piso (perdidos na verdade) | Suíte | Falhas |',
    '|---|---|---:|---:|---:|---:|---:|---:|---|---|'
  )
  for (const r of i.resultados) {
    const suite = r.suite.aplicavel
      ? r.suite.ok
        ? 'verde'
        : '**vermelha**'
      : r.suite.ambienteInvalido
        ? 'ambiente inválido'
        : 'n/a (docs)'
    p(
      `| ${r.caso} | ${r.tipo} | ${r.blocos} | ${r.hunks} | ${r.preservados} | ${r.descartadosComMotivo} | ${r.perdidosSemRegistro.length} | ${pisoDe(r.caso)} | ${suite} | ${r.falhas.length === 0 ? '—' : r.falhas.join('; ').slice(0, 80)} |`
    )
  }
  p('')
}

p('## Critério 3 — o manifesto detecta perda injetada', '')
p(
  'Teste negativo em `src/main/squads/prova/manifesto-hunks.spec.ts`: hunk removido de propósito, arquivo inteiro sumido, remoção que não aconteceu e motivo em branco — os quatro caem em *perdido sem registro*. Roda na suíte Regras.',
  ''
)

p('## Critério 4 — reprodução pelo snapshot', '')
p(
  '```',
  'node scripts/prova-squads/snapshot.mjs            # fixa fatias, perfil, hash do validador (não rodar de novo: invalida as medições)',
  'TSX_TSCONFIG_PATH=tsconfig.node.json npx tsx scripts/prova-squads/orquestrador.mjs <hermes3:8b|qwen3:8b|fase:claude-fable-5-1>',
  'node scripts/prova-squads/levantar-casos.mjs',
  'TSX_TSCONFIG_PATH=tsconfig.node.json npx tsx scripts/prova-squads/integrador.mjs <camada>',
  'node scripts/prova-squads/relatorio.mjs',
  '```',
  '',
  'O orquestrador e o integrador **recusam rodar** se o hash de `squad-plan.ts` diverge do snapshot. Os prompts moram em `orquestrador.mjs` e `integrador.mjs` (versionados); o conjunto, em `snapshot.json`.',
  ''
)

p('## Limites declarados', '')
p(
  '- **Um plano por fatia, uma tentativa.** O critério é "planos aceitos"; replanejar até passar mediria a paciência do loop.',
  '- **Validador mínimo**, não o da F02. A taxa depende das regras dele (cobertura total dos critérios, redundância, escopo de paths); trocar regra muda o número, e por isso ele é congelado por hash.',
  '- **Diretórios permitidos** vêm dos diretórios que o PR real tocou — o modelo recebe o escopo que a fatia de fato teve.',
  '- **Conflitos do integrador são fabricados** nos casos sintéticos (código e verdade reais, conflito injetado); os históricos reais são só de docs, sem suíte. O "zero hunk perdido" vale para essa amostra pequena e não generaliza.',
  '- **O integrador é o `git merge-tree` + a camada por bloco em conflito.** O que o merge faz sozinho entra no manifesto como preservado por construção.',
  '- **Suíte = specs que o PR tocou + vizinhos do arquivo em conflito** (categoria Regras/Tela); `int-spec` fica fora. Caso cuja árvore da verdade já não passa neste ambiente é marcado "ambiente inválido" e sai do critério.',
  '- **Camada local não integra conflito grande.** Blocos acima de ~18 mil caracteres (`num_ctx` 8192) ficam com os marcadores de conflito (`falhas: fora_do_contexto`), e o manifesto os conta como preservados porque as duas versões estão no arquivo — quem pega o arquivo quebrado é a suíte, que nos merges de docs não existe. Os merges de docs não provam o integrador local.',
  '- **O manifesto tem piso, não zero.** A verdade também "perde" hunks (coluna Piso), então o critério literal do PI (zero perdido sem registro) reprova até o resultado humano; o relatório mostra os dois números e o veredito segue o critério literal.',
  '- **A suíte de cada caso sintético é parcial** (specs do PR + vizinhos), não a suíte inteira do projeto.',
  '- **Baseline por assinatura** (CLI do Claude, isolamento do adapter de produção), sem API paga.',
  ''
)

writeFileSync(SAIDA, `${L.join('\n')}\n`)
console.log(`→ ${SAIDA}`)
