#!/usr/bin/env node
/**
 * Smoke real do conector Tavily (SPEC-Conectores-05 e 06 § Testes e evidência).
 *
 * O que o teste contra servidor local não pode provar: que a API **de verdade** se comporta como
 * o adapter espera. O servidor falso responde o que eu escrevi que ele responde; aqui a Tavily
 * responde o que ela responde. É a diferença entre "meu contrato está coerente" e "meu contrato
 * está certo" — e nas fatias anteriores foi sempre o smoke real que achou o que nenhum dublê
 * acharia (a listagem eventualmente consistente do GitHub, na F04).
 *
 * **Consome créditos reais.** O teto abaixo é conservador de propósito, e o script para quando o
 * alcança: uma busca `basic` (1 crédito), uma `advanced` (2) e uma extração de 2 URLs (1) — 4
 * créditos no total, contra o teto diário padrão de 100.
 *
 * Chave via `.env` local (`TAVILY_API_KEY`), **jamais** commitada nem impressa. O smoke não roda
 * no CI — não há segredo lá, e não deve haver.
 *
 * Uso:
 *   node --env-file=.env scripts/smoke-tavily.mjs
 */

const CHAVE = process.env.TAVILY_API_KEY
const ORIGEM = process.env.TAVILY_API_ORIGIN ?? 'https://api.tavily.com'

/** Teto de créditos desta execução. O script para antes de estourá-lo. */
const TETO_DE_CREDITOS = 6

if (!CHAVE) {
  console.error(
    'Falta TAVILY_API_KEY. Use:\n' +
      '  node --env-file=.env scripts/smoke-tavily.mjs\n\n' +
      'A chave nunca é impressa nem gravada — só usada no cabeçalho Authorization.'
  )
  process.exit(2)
}

let passos = 0
let falhas = 0
let creditosGastos = 0

function relatar(nome, ok, detalhe) {
  passos += 1
  if (!ok) falhas += 1
  console.log(`${ok ? '  ok' : '  FALHA'}  ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
}

/**
 * Chama a Tavily pelas mesmas rotas e o mesmo formato de corpo que `tavily-adapter.ts`.
 *
 * Reimplementadas aqui em vez de importadas do `src/`: o build do main é ESM empacotado para o
 * Electron, e importá-lo de um script Node solto exigiria montar o bundle inteiro. O que este
 * script verifica é o **contrato da API**, e divergir do código de produção é justamente o que
 * ele detectaria — por isso as rotas estão escritas por extenso, para a comparação ser visível.
 */
async function api(caminho, corpo) {
  if (creditosGastos >= TETO_DE_CREDITOS) {
    throw new Error(`Teto de ${TETO_DE_CREDITOS} créditos alcançado — o smoke para aqui.`)
  }

  const resposta = await fetch(`${ORIGEM}${caminho}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${CHAVE}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(corpo)
  })

  let dados
  try {
    dados = await resposta.json()
  } catch {
    dados = undefined
  }

  const cobrado = dados?.usage?.credits ?? dados?.usage?.total_credits_used ?? 0
  creditosGastos += cobrado

  return { status: resposta.status, ok: resposta.ok, corpo: dados, cobrado }
}

async function main() {
  console.log(`\nSmoke real — Tavily (teto de ${TETO_DE_CREDITOS} créditos)\n`)

  // 1. search.query em `basic` — o caminho comum, e o custo declarado pelo domínio.
  const basica = await api('/search', {
    query: 'plataformas de agentes autônomos para desenvolvimento de software',
    search_depth: 'basic',
    max_results: 5,
    include_usage: true
  })

  relatar(
    'search.query (basic) responde 200',
    basica.ok,
    basica.ok ? undefined : `HTTP ${basica.status}`
  )
  if (!basica.ok) {
    console.error('\nA busca falhou. Confira a chave e o plano antes de seguir.')
    process.exit(1)
  }

  const fontes = Array.isArray(basica.corpo?.results) ? basica.corpo.results : []
  relatar('resultado traz fontes com URL', fontes.length > 0 && fontes.every((f) => f.url))
  relatar('resposta traz request_id', typeof basica.corpo?.request_id === 'string')

  // O que este passo verifica é a **tabela de créditos do domínio** contra a cobrança real: se a
  // Tavily mudar o preço de `basic`, `creditosDaBusca` passa a mentir para o gate — e o gate
  // deixaria passar chamadas que estouram a cota.
  relatar(
    'busca basic custa 1 crédito, como o domínio declara',
    basica.cobrado === 1,
    `cobrado: ${basica.cobrado}`
  )

  // 2. search.query em `advanced` — o dobro, e é isso que justifica `basic` ser o padrão.
  const avancada = await api('/search', {
    query: 'mercado de ferramentas de pesquisa web para agentes',
    search_depth: 'advanced',
    max_results: 3,
    include_usage: true
  })

  relatar('search.query (advanced) responde 200', avancada.ok)
  relatar(
    'busca advanced custa 2 créditos, como o domínio declara',
    avancada.cobrado === 2,
    `cobrado: ${avancada.cobrado}`
  )

  // 3. extract.content — a extração de duas fontes reais que a busca devolveu.
  const alvos = fontes.slice(0, 2).map((f) => f.url)
  if (alvos.length < 2) {
    relatar('extract.content (2 URLs)', false, 'a busca não devolveu 2 fontes para extrair')
  } else {
    const extraidas = await api('/extract', {
      urls: alvos,
      extract_depth: 'basic',
      format: 'markdown',
      include_usage: true
    })

    relatar('extract.content responde 200', extraidas.ok)

    const resultados = Array.isArray(extraidas.corpo?.results) ? extraidas.corpo.results : []
    const falhadas = Array.isArray(extraidas.corpo?.failed_results)
      ? extraidas.corpo.failed_results
      : []

    // Sucessos e falhas **lado a lado**, que é o formato de que o critério 3 da F06 depende: a
    // falha parcial preserva as válidas porque a própria API as separa.
    relatar(
      'extração devolve results e failed_results lado a lado',
      Array.isArray(extraidas.corpo?.results) && Array.isArray(extraidas.corpo?.failed_results),
      `${resultados.length} ok, ${falhadas.length} falha(s)`
    )

    relatar(
      'conteúdo extraído vem em raw_content, e não vazio',
      resultados.length === 0 ||
        resultados.every((r) => typeof r.raw_content === 'string' && r.raw_content.length > 0)
    )

    // O conteúdo extraído é **maior** que o snippet da busca — é o fato que sustenta a regra da
    // F06 (Search descobre, Extract confirma). Se fossem equivalentes, exigir extração para
    // sustentar afirmação seria cerimônia.
    const snippet = fontes[0]?.content ?? ''
    const extraido = resultados.find((r) => r.url === alvos[0])?.raw_content ?? ''
    relatar(
      'o conteúdo extraído é substancialmente maior que o snippet da busca',
      extraido.length > snippet.length,
      `${snippet.length} → ${extraido.length} caracteres`
    )

    // **A cobrança da extração não é local à chamada.** Foi este passo que descobriu: a mesma
    // extração de 2 URLs custou 0 numa execução e 1 na seguinte. Sondando com seis chamadas
    // seguidas de 1 URL, o padrão apareceu — `0,0,0,0,1,0`: a Tavily acumula URLs entre chamadas
    // e cobra 1 crédito a cada 5 no total.
    //
    // Por isso o adapter **não** reconstrói o valor: ele usa o `usage` da resposta, e o que
    // protege a cota é o gate, com a estimativa, antes de a chamada sair. Nenhum servidor falso
    // mostraria isso — ele responde o número que eu escrevi que ele responde.
    //
    // O que se afirma aqui, então, é o que é estável: a cobrança de uma extração de 2 URLs cabe
    // em {0, 1} — nunca 2, que é o que uma cobrança por URL daria.
    relatar(
      'a extração cobra por grupo acumulado — 2 URLs custam 0 ou 1, nunca 2',
      extraidas.cobrado === 0 || extraidas.cobrado === 1,
      `cobrado: ${extraidas.cobrado}`
    )

    // E o campo tem o nome que a API usa de fato: `usage.credits` nas duas rotas, não
    // `total_credits_used` como a doc previa para o Extract.
    relatar(
      'o uso vem em usage.credits, e não em usage.total_credits_used',
      typeof extraidas.corpo?.usage?.credits === 'number',
      JSON.stringify(extraidas.corpo?.usage)
    )
  }

  // 4. O 401 — a tradução que o adapter faz do erro de credencial. Não custa crédito.
  const semChave = await fetch(`${ORIGEM}/search`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'x' })
  })
  relatar(
    'chamada sem credencial responde 401, como o adapter espera',
    semChave.status === 401,
    `HTTP ${semChave.status}`
  )

  console.log(
    `\n${falhas === 0 ? 'OK' : 'FALHOU'} — ${passos - falhas}/${passos} passos, ` +
      `${creditosGastos} crédito(s) consumido(s)\n`
  )

  process.exit(falhas === 0 ? 0 : 1)
}

main().catch((erro) => {
  // A mensagem do erro pode citar a URL, nunca a chave — ela só existe no cabeçalho.
  console.error(`\nErro no smoke: ${erro.message}\n`)
  process.exit(1)
})
