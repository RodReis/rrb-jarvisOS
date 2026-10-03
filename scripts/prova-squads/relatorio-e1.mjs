/**
 * Agrega a medição da M11-F00b em `reports/squads-prova-m11-f00b.md` (SPEC-Squads-00 § Emenda E1,
 * critérios de aceite 1–3). Só lê `reports/squads-prova-e1/*.json`: não mede nada e não decide nada
 * que os JSONs não digam — aprovado ou reprovado sai do número contra o critério do PI.
 *
 *   node scripts/prova-squads/relatorio-e1.mjs
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PASTA = join(RAIZ, 'reports', 'squads-prova-e1')
const SAIDA = join(RAIZ, 'reports', 'squads-prova-m11-f00b.md')
const CRITERIO_PLANOS = 0.8

const ler = (nome) => JSON.parse(readFileSync(join(PASTA, nome), 'utf8'))
const arquivos = readdirSync(PASTA).filter((a) => !a.startsWith('.'))
const pct = (x) => `${(x * 100).toFixed(1)}%`
const seg = (ms) => `${(ms / 1000).toFixed(1)} s`
const gb = (b) => (b === null || b === undefined ? '—' : `${(b / 1024 ** 3).toFixed(1)} GB`)

const snapshot = ler('snapshot.json')
const casos = ler('casos.json')
const ehFase = (nome) => nome.startsWith('fase:')
const orquestradores = arquivos
  .filter((a) => /^orquestrador-.*\.json$/.test(a))
  .map(ler)
  .sort((a, b) => a.modelo.localeCompare(b.modelo))
const integradores = arquivos
  .filter((a) => /^integrador-.*\.json$/.test(a))
  .map(ler)
  .sort((a, b) => a.camada.localeCompare(b.camada))
const locais = (lista, chave) => lista.filter((x) => !ehFase(x[chave]))

// Um resultado medido com outro instrumento não pode entrar neste relatório.
for (const i of integradores)
  if (i.instrumentoSha256 !== casos.instrumentoSha256)
    throw new Error(`integrador-${i.camada}.json foi medido com outro instrumento`)

/** Perdas dos casos de código por camada local, e quantas são só de `import`. */
const ehImport = (h) => h.adicionadas.every((l) => /^\s*import\b/.test(l) || l.trim() === '')
const locaisDeCodigo = locais(integradores, 'camada').map((i) => {
  const perdidos = i.resultados.filter((r) => !r.informativo).flatMap((r) => r.perdidosSemRegistro)
  return {
    camada: i.camada,
    perdas: perdidos.length,
    perdasDeImport: perdidos.filter(ehImport).length
  }
})

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
const motivosDe = (historico, tentativa) => {
  const h = historico.find((x) => x.tentativa === tentativa)
  if (!h || h.resultado === 'aceita') return '—'
  const por = {}
  for (const m of h.motivos) por[m.motivo] = (por[m.motivo] ?? 0) + 1
  return (
    Object.entries(por)
      .sort((a, b) => b[1] - a[1])
      .map(([m, n]) => `${m}×${n}`)
      .join(', ') || h.resultado
  )
}

/**
 * Uma chamada que estoura o tempo é indisponibilidade, como no produto — mas não pode inflar a
 * reprovação sem o leitor saber: o limite superior conta como aceita toda fatia interrompida.
 */
function notaDaFalhaDeExecucao(o) {
  const interrompidas = o.resultados.filter(
    (r) => !r.aceitoNoLimite && r.chamadas.some((c) => c.erro)
  )
  if (interrompidas.length === 0) return ''
  const teto = o.aceitosNoLimite + interrompidas.length
  return ` ${interrompidas.length} fatia(s) terminaram por falha de execução (${interrompidas.map((r) => r.fatia).join(', ')}: chamada acima do timeout de 5 min do cliente, tratada como indisponibilidade, como no produto). Mesmo contando todas como aceitas, o limite superior é ${teto}/${o.total} = ${pct(teto / o.total)}.`
}

/** O hunk é só de `import`: fundir dois imports numa linha é equivalente, e o manifesto não o reconhece. */
const soImport = (h) => h.adicionadas.every((l) => /^\s*import\b/.test(l) || l.trim() === '')
const perdidosDeImport = (r) => r.perdidosSemRegistro.filter(soImport).length
/** O caso passaria se as perdas só-de-import fossem aceitas — leitura alternativa, nunca o veredito. */
const aprovadoSemImport = (r) =>
  r.perdidosSemRegistro.length === perdidosDeImport(r) &&
  r.naoResolvidos.length === 0 &&
  r.falhas.length === 0 &&
  r.marcadoresRestantes === 0 &&
  r.suite.aplicavel &&
  r.suite.ok

p('# Prova M11-F00b — integrador reprovado e F00-bis do orquestrador local', '')
p(
  '> Gerado por `scripts/prova-squads/relatorio-e1.mjs` a partir de `reports/squads-prova-e1/*.json`.',
  '> SPEC: [SPEC-Squads-00 § Emenda E1](../docs/spec/spec-squads-00-prova-orquestrador-integrador.md) · issue #373. Substitui a conclusão do [relatório da F00](squads-prova-m11-f00.md), que fica como histórico.',
  ''
)

p('## Veredito', '')
p('| Critério do PI | Resultado | Número |', '|---|---|---|')
for (const o of locais(orquestradores, 'modelo'))
  p(
    `| Orquestrador \`${o.modelo}\` ≥ 80% de planos aceitos dentro do limite (3 tentativas) | **${o.taxaNoLimite >= CRITERIO_PLANOS ? 'APROVADO' : 'REPROVADO'}** | ${o.aceitosNoLimite}/${o.total} = ${pct(o.taxaNoLimite)} (1ª tentativa: ${o.aceitosNaPrimeira}/${o.total}) |`
  )
for (const i of integradores)
  p(
    `| Integrador \`${i.camada}\`: zero hunk perdido sem registro **e** 100% de suítes verdes, nos casos de código | **${i.aprovado ? 'APROVADO' : 'REPROVADO'}** | ${i.casosAprovados}/${i.casosDoCriterio} casos aprovados |`
  )
p('')
const aprovadosPlanos = locais(orquestradores, 'modelo').filter(
  (o) => o.taxaNoLimite >= CRITERIO_PLANOS
)
p(
  aprovadosPlanos.length === 0
    ? '**Orquestrador:** nenhum modelo local atingiu o critério. O padrão segue sendo o **modelo da fase**, e o local fica como opção (SPEC-Squads-00, regra 2).'
    : `**Orquestrador:** candidato(s) a padrão: ${aprovadosPlanos.map((o) => `\`${o.modelo}\``).join(', ')}. A decisão de adotar é do PI, e o prompt de produção (\`montarPedido\`) ainda não leva o bloco da base — ver *Limites declarados*.`,
  ''
)
const integradoresAprovados = integradores.filter((i) => i.aprovado)
p(
  integradoresAprovados.length === 0
    ? '**Integrador:** nenhuma camada candidata atingiu o critério.'
    : `**Integrador:** ${integradoresAprovados.map((i) => `\`${i.camada}\``).join(', ')} ${integradoresAprovados.length === 1 ? 'atingiu' : 'atingiram'} o critério nos ${integradoresAprovados[0].casosDoCriterio} casos de código com suíte.`,
  ''
)

p('## Ambiente (regra 4 da SPEC)', '')
p(`- GPU: ${snapshot.hardware.gpu}`)
p(`- Node ${snapshot.hardware.node} · ${snapshot.hardware.so}`)
p(`- Modelos Ollama: ${modelosOllama.join('; ')}`)
p(
  `- \`num_ctx\` pedido: ${orquestradores[0]?.numCtxPedido ?? '—'} · temperatura 0 · semente 42 · \`think: false\``
)
p(`- Snapshot: ${snapshot.criadoEm} · commit \`${snapshot.commit.slice(0, 8)}\``)
p('- Arquivos congelados por hash (o orquestrador e o integrador recusam rodar se algum mudou):')
for (const [a, h] of Object.entries(snapshot.arquivosCongelados))
  p(`  - \`${h.slice(0, 12)}\` ${a}`)
p(`- Instrumento do integrador: \`${casos.instrumentoSha256.slice(0, 12)}\` · ${casos.criadoEm}`)
p('')

p('## F00-bis — orquestrador, por modelo e por fatia', '')
p(
  'Cada fatia passa pelo `planejarSquad` de produção: pedido de `montarPedido` + bloco da base (árvore de arquivos e stack), validador endurecido, feedback das rejeições e o limite de três tentativas da M9-F04. As fatias são as 17 da primeira medição.',
  ''
)
for (const o of orquestradores) {
  p(
    `### \`${o.modelo}\` — ${o.aceitosNoLimite}/${o.total} dentro do limite (${pct(o.taxaNoLimite)}); ${o.aceitosNaPrimeira}/${o.total} na primeira tentativa`,
    ''
  )
  p(
    '| Fatia | Critérios | 1ª tentativa | Dentro do limite | Rejeições (1ª) | Rejeições (última) | Plano (tarefas / escritores / paths) | Latência | Prompt máx. (tokens) | Truncado |',
    '|---|---:|---|---|---|---|---|---:|---:|---|'
  )
  for (const r of o.resultados) {
    const ultima = r.historico.at(-1)?.tentativa
    const plano = r.plano
      ? `${r.plano.tarefas} / ${r.plano.escritores} / ${r.plano.paths.length}`
      : '—'
    const lat = r.chamadas.reduce((s, c) => s + c.latenciaMs, 0)
    const promptMax = Math.max(0, ...r.chamadas.map((c) => c.promptTokens ?? 0))
    const truncou = r.chamadas.some((c) => c.truncado)
    p(
      `| ${r.fatia} | ${r.criterios} | ${r.primeiraTentativa} | ${r.aceitoNoLimite ? `aceito (t${r.tentativasAteAceitar})` : 'rejeitado'} | ${motivosDe(r.historico, 1)} | ${r.aceitoNoLimite ? '—' : motivosDe(r.historico, ultima)} | ${plano} | ${seg(lat)} | ${promptMax && !ehFase(o.modelo) ? promptMax : '—'} | ${truncou ? '**sim**' : 'não'} |`
    )
  }
  const lat = o.resultados
    .map((r) => r.chamadas.reduce((s, c) => s + c.latenciaMs, 0))
    .sort((a, b) => a - b)
  const vram = o.resultados.flatMap((r) => r.chamadas.map((c) => c.vramBytes)).find((v) => v)
  const motivos = {}
  for (const r of o.resultados)
    for (const h of r.historico)
      for (const m of h.motivos) motivos[m.motivo] = (motivos[m.motivo] ?? 0) + 1
  p(
    '',
    `Latência por fatia (todas as tentativas): mediana ${seg(lat[Math.floor(lat.length / 2)])}, máxima ${seg(lat.at(-1))}. VRAM ${gb(vram)}. Chamadas com falha de execução: ${o.resultados.flatMap((r) => r.chamadas).filter((c) => c.erro).length}.${notaDaFalhaDeExecucao(o)}`,
    `Rejeições por motivo, em todas as tentativas: ${
      Object.entries(motivos)
        .sort((a, b) => b[1] - a[1])
        .map(([m, n]) => `${m}×${n}`)
        .join(', ') || 'nenhuma'
    }.`,
    ''
  )
}

p('## Integrador — o instrumento corrigido', '')
p(
  `**Os ${casos.casos.length} casos de código** têm, em cada um, dois escritores que acrescentam **comportamentos diferentes no mesmo ponto** do módulo e do spec, cada um com teste próprio. Conflitam de verdade no \`git\` (módulo e spec); a verdade é a base com os dois lados, e o manifesto aplicado a ela dá **zero perdido e zero não resolvido** — o piso é zero por construção. A suíte do spec passou na base, em cada lado e na verdade **antes** de qualquer camada rodar:`,
  '',
  '| Caso | Alvo | Hunks | Base | Lado 1 | Lado 2 | Verdade |',
  '|---|---|---:|---|---|---|---|'
)
for (const c of casos.casos) {
  const s = (r) => (r.aplicavel && r.ok ? 'verde' : '**vermelha**')
  p(
    `| ${c.id} | \`${c.alvo}\` | ${c.hunks} | ${s(c.controle.base)} | ${s(c.controle.lado1)} | ${s(c.controle.lado2)} | ${s(c.controle.verdade)} |`
  )
}
p('')
p(
  '**Bloco não resolvido é falha do caso**, nunca hunk preservado: o manifesto separa o hunk que só existe dentro de um bloco em conflito (`naoResolvidos`), e o caso só passa com zero perdidos, zero não resolvidos, nenhuma falha de resolução e a suíte verde.',
  ''
)

for (const i of integradores) {
  p(
    `### Camada \`${i.camada}\` — ${i.aprovado ? 'APROVADA' : 'REPROVADA'} (${i.casosAprovados}/${i.casosDoCriterio})`,
    ''
  )
  {
    const alt = i.resultados.filter((x) => !x.informativo && aprovadoSemImport(x)).length
    if (alt !== i.casosAprovados)
      p(
        `Leitura alternativa, que **não** é o veredito: se fundir "import" numa linha fosse aceito, ${alt}/${i.casosDoCriterio} casos passariam.`,
        ''
      )
  }
  p(
    '| Caso | Blocos | Hunks | Preservados | Descartados c/ motivo | **Perdidos sem registro** | **Não resolvidos** | Falhas de resolução | Suíte | Latência |',
    '|---|---:|---:|---:|---:|---:|---:|---|---|---:|'
  )
  for (const r of i.resultados.filter((x) => !x.informativo)) {
    const suite = r.suite.aplicavel ? (r.suite.ok ? 'verde' : '**vermelha**') : 'n/a'
    p(
      `| ${r.caso} | ${r.blocos} | ${r.hunks} | ${r.preservados} | ${r.descartadosComMotivo} | ${r.perdidosSemRegistro.length}${perdidosDeImport(r) > 0 ? ` (${perdidosDeImport(r)} só de import)` : ''} | ${r.naoResolvidos.length} | ${r.falhas.length === 0 ? '—' : r.falhas.join('; ').slice(0, 70)} | ${suite} | ${seg(r.latenciaMs)} |`
    )
  }
  const info = i.resultados.filter((x) => x.informativo)
  if (info.length > 0) {
    p('', '*Merges históricos de docs (informativos, fora do critério):*', '')
    p(
      '| Caso | Blocos | Hunks | Preservados | Perdidos sem registro | Não resolvidos | Falhas de resolução |',
      '|---|---:|---:|---:|---:|---:|---|'
    )
    for (const r of info)
      p(
        `| ${r.caso} | ${r.blocos} | ${r.hunks} | ${r.preservados} | ${r.perdidosSemRegistro.length} | ${r.naoResolvidos.length} | ${r.falhas.length === 0 ? '—' : `${r.falhas.length} bloco(s): ${r.falhas[0].slice(0, 50)}`} |`
      )
  }
  p('')
}

p('## Critérios de aceite da emenda', '')
p(
  '1. **Relatório por modelo e por fatia, primeira tentativa e dentro do limite:** seção *F00-bis*, acima.',
  '2. **Teste negativo do manifesto — bloco não resolvido cai em falha:** `src/main/squads/prova/manifesto-hunks.spec.ts` (*bloco não resolvido*), suíte Regras.',
  '3. **Teste do caso sintético — a verdade preserva os dois comportamentos e a suíte dela passa:** `src/main/squads/prova/caso-sintetico.spec.ts` prova a forma (conflito real no `git`, verdade com os dois lados, piso zero); a suíte da verdade passando está na tabela de controle acima, medida nos worktrees reais antes das camadas.',
  ''
)

p('## Reprodução pelo snapshot', '')
p(
  '```',
  'node scripts/prova-squads/snapshot-e1.mjs                 # fixa fatias, hashes do validador, do pedido e do laço (não rodar de novo: invalida as medições)',
  'TSX_TSCONFIG_PATH=tsconfig.node.json npx tsx scripts/prova-squads/integrador-e1.mjs congelar',
  'TSX_TSCONFIG_PATH=tsconfig.node.json npx tsx scripts/prova-squads/orquestrador-e1.mjs <hermes3:8b|qwen3:8b|fase:claude-fable-5-1>',
  'TSX_TSCONFIG_PATH=tsconfig.node.json npx tsx scripts/prova-squads/integrador-e1.mjs <camada>',
  'node scripts/prova-squads/relatorio-e1.mjs',
  '```',
  '',
  'O orquestrador recusa rodar se um dos arquivos congelados mudou; o integrador, se o instrumento mudou ou se os casos não se reconstroem com os mesmos SHAs (commits com data e autor fixos).',
  ''
)

p('## Limites declarados', '')
p(
  '- **O prompt de produção não leva o bloco da base.** A medição acrescenta a árvore de arquivos e a stack ao `system` (`src/main/squads/prova/base-do-prompt.ts`). Se o PI adotar o local como padrão, `montarPedido` precisa passar a levá-lo — o texto medido é o contrato.',
  '- **Perfil de produção:** `PERFIL_PADRAO` com o orquestrador local (um escritor, `num_ctx` 8192). A primeira medição permitia dois escritores; um escritor é o que o produto roda hoje.',
  '- **A árvore mostra os arquivos diretos de cada diretório permitido**, mais as subpastas (o validador aceita escrita nelas). A base de cada fatia é o pai do commit de merge.',
  '- **Os casos de código mudaram de arquivo-alvo** em quatro fatias (M9-F01, M9-F03, M26-F01, M26-F02), porque o alvo da primeira medição (`terminal-engine.ts`, `call-provider.ts`, `index.ts`, `ProjetosLocais.tsx`) não tem como ser testado por spec puro. As seis fatias são as mesmas; todo alvo agora é um módulo de `src/shared/domain` com spec vizinho. M9-F04 e M26-F06 mantêm o alvo.',
  '- **O conflito é "os dois acrescentam no mesmo ponto"** (fim do módulo, depois do último `import` do spec, fim do spec). Não cobre conflito semântico em lógica existente, em que a resolução exige reescrever uma função.',
  `- **O manifesto identifica o hunk pela linha.** Fundir dois \`import\` numa linha é equivalente e conta como perda sem registro: ${locaisDeCodigo
    .map((i) => `${i.perdasDeImport} das ${i.perdas} perdas do \`${i.camada}\``)
    .join(
      ' e '
    )} são só de import. O instrumento **não foi mudado depois de ver o resultado** (a SPEC proíbe ajustar o que se mede até um modelo passar); a leitura alternativa está em cada camada, o veredito não depende dela, e aceitar import fundido no manifesto fica como proposta ao PI para uma próxima medição.`,
  '- **O congelamento por hash cobre o que decide a aceitação e o texto do pedido** (validador, esquema, perfil, capacidades, limite de tentativas, `montarPedido`, `planejarSquad`, bloco da base; para o integrador, os casos, o manifesto e a forma do caso). **Não cobre os scripts do harness** (`integrador.mjs`, `integrador-e1.mjs`, `orquestrador.mjs`, `orquestrador-e1.mjs`): neles moram o prompt do integrador, o timeout do cliente e o cálculo de aprovado. O `orquestrador-e1.mjs` ganhou o `.catch` em volta da chamada ao modelo depois do primeiro commit, e por isso o `qwen3:8b` foi rerodado inteiro com ele; o `hermes3:8b` rodou antes dele e não teve erro de execução. Incluir os scripts no hash fica como proposta para a próxima medição. O relatório confere que cada JSON do integrador carrega o mesmo hash dos casos.',
  '- **O critério dos casos de código exige também zero descarte registrado**, porque a verdade contém os dois lados e qualquer descarte é perda de comportamento (o casamento do descarte é por conteúdo e um único trecho longo cobriria vários hunks). Nenhum caso de código de nenhuma camada tinha descarte; o veredito é o mesmo com ou sem a regra.',
  '- **Diretório `.` em `pathsPermitidos`** (M10-F03 e M10-F05) aparece na árvore como "não existe na base"; o validador não aceita escrita nele de qualquer forma, então a aceitação não muda, mas o texto que o modelo recebeu nessas duas fatias é impreciso.',
  '- **Três fatias do `qwen3:8b` terminaram por timeout do cliente** (5 min, geração longa), tratado como indisponibilidade como no produto; o limite superior sem elas está na tabela do modelo.',
  '- **Amostra de seis casos de código**, com comportamentos pequenos de propósito: mede se o integrador preserva os dois lados, não se ele sabe programar.',
  '- **A suíte de cada caso é o spec do módulo** (testes antigos mais os dois novos), não a suíte inteira do projeto.',
  '- **Os merges históricos de docs seguem informativos**: sem suíte, o resultado deles não prova o integrador.',
  '- **Controle da fase por assinatura** (CLI do Claude, isolamento do adapter de produção), sem API paga.',
  ''
)

writeFileSync(SAIDA, `${L.join('\n')}\n`)
console.log(`→ ${SAIDA}`)
