#!/usr/bin/env node
/**
 * Smoke real da automação do GitHub (SPEC-Conectores-04 § Testes e evidência).
 *
 * O que o E2E não pode provar: que a API **de verdade** se comporta como o adapter espera. O
 * servidor falso responde o que eu escrevi que ele responde; aqui o GitHub responde o que ele
 * responde. É a diferença entre "meu contrato está coerente" e "meu contrato está certo".
 *
 * **Cria efeito externo real.** Roda contra um repositório descartável, criando issue, sub-issue,
 * branch, PR e fazendo squash merge. Nunca aponte para um repositório que importa.
 *
 * Token via `source: env` (SPEC-Conectores-03 § decisões): apenas em execução local, **jamais**
 * commitado nem gravado no vault. O smoke não roda no CI — não há segredo lá, e não deve haver.
 *
 * Uso:
 *   GITHUB_SMOKE_TOKEN=ghp_... GITHUB_SMOKE_OWNER=usuario GITHUB_SMOKE_REPO=repo-descartavel \
 *     node scripts/smoke-github.mjs
 *
 * O token precisa de escopo para repositório, issues e pull requests no repo alvo.
 */

const TOKEN = process.env.GITHUB_SMOKE_TOKEN
const OWNER = process.env.GITHUB_SMOKE_OWNER
const REPO = process.env.GITHUB_SMOKE_REPO
const ORIGEM = process.env.GITHUB_API_ORIGIN ?? 'https://api.github.com'

if (!TOKEN || !OWNER || !REPO) {
  console.error(
    'Faltam variáveis. Use:\n' +
      '  GITHUB_SMOKE_TOKEN=... GITHUB_SMOKE_OWNER=... GITHUB_SMOKE_REPO=... node scripts/smoke-github.mjs\n\n' +
      'O repositório precisa ser DESCARTÁVEL: o smoke cria issue, branch, PR e faz merge nele.'
  )
  process.exit(2)
}

/** Carimbo único por execução — o que torna cada rodada independente da anterior. */
const CARIMBO = new Date()
  .toISOString()
  .replace(/[^0-9]/g, '')
  .slice(0, 14)
const CHAVE_EXTERNA = `SMOKE-${CARIMBO}`
const BRANCH = `smoke/${CARIMBO}`

let passos = 0
let falhas = 0

function relatar(nome, ok, detalhe) {
  passos += 1
  if (!ok) falhas += 1
  console.log(`${ok ? '  ok' : '  FALHA'}  ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
}

async function api(metodo, caminho, corpo) {
  const resposta = await fetch(`${ORIGEM}${caminho}`, {
    method: metodo,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) })
  })

  let dados
  try {
    dados = await resposta.json()
  } catch {
    dados = undefined
  }

  return { status: resposta.status, ok: resposta.ok, corpo: dados }
}

/**
 * O smoke usa as mesmas rotas e o mesmo formato de corpo que `github-operations.ts`.
 *
 * Reimplementadas aqui em vez de importadas do `src/`: o build do main é ESM empacotado para o
 * Electron, e importá-lo de um script Node solto exigiria montar o bundle inteiro. O que este
 * script verifica é o **contrato da API**, e divergir do código de produção é justamente o que
 * ele detectaria — por isso as rotas estão escritas por extenso, para a comparação ser visível.
 */
async function main() {
  console.log(`\nSmoke real — ${OWNER}/${REPO} (chave ${CHAVE_EXTERNA})\n`)

  // 1. auth.identify
  const eu = await api('GET', '/user')
  relatar('auth.identify', eu.ok && typeof eu.corpo?.login === 'string', eu.corpo?.login)

  // 2. repo.ensure — o repositório precisa existir e ser alcançável
  const repo = await api('GET', `/repos/${OWNER}/${REPO}`)
  relatar('repo.ensure (existente)', repo.ok, repo.corpo?.full_name)
  if (!repo.ok) {
    console.error('\nO repositório não é alcançável. Crie-o antes, ou confira o token.')
    process.exit(1)
  }
  const baseBranch = repo.corpo?.default_branch ?? 'main'

  // 3. issue.ensure — cria com a chave externa no corpo
  const marcador = `<!-- jarvis-key: ${CHAVE_EXTERNA} -->`
  const issuePai = await api('POST', `/repos/${OWNER}/${REPO}/issues`, {
    title: `[SMOKE] Épico ${CARIMBO}`,
    body: `Criada pelo smoke da SPEC-Conectores-04.\n\n${marcador}`
  })
  relatar('issue.ensure (cria)', issuePai.ok, `#${issuePai.corpo?.number}`)

  // 3b. idempotência: a busca acha a issue pela chave, e um segundo ensure não criaria outra
  const listadas = await api('GET', `/repos/${OWNER}/${REPO}/issues?state=all&per_page=100`)
  const achadas = (Array.isArray(listadas.corpo) ? listadas.corpo : []).filter(
    (i) => !i.pull_request && typeof i.body === 'string' && i.body.includes(marcador)
  )
  relatar(
    'issue.ensure (idempotente: a chave acha exatamente uma)',
    achadas.length === 1,
    `${achadas.length} issue(s) com a chave`
  )

  // 4. issue.ensure-dependency — sub-issue de verdade, pela API
  const issueFilha = await api('POST', `/repos/${OWNER}/${REPO}/issues`, {
    title: `[SMOKE] Fatia ${CARIMBO}`,
    body: `<!-- jarvis-key: ${CHAVE_EXTERNA}-filha -->`
  })
  const vinculo = await api(
    'POST',
    `/repos/${OWNER}/${REPO}/issues/${issuePai.corpo?.number}/sub_issues`,
    { sub_issue_id: issueFilha.corpo?.id }
  )
  relatar('issue.ensure-dependency (sub-issue real)', vinculo.ok, `HTTP ${vinculo.status}`)

  const subIssues = await api(
    'GET',
    `/repos/${OWNER}/${REPO}/issues/${issuePai.corpo?.number}/sub_issues`
  )
  relatar(
    'issue.ensure-dependency (vínculo consultável na origem)',
    (Array.isArray(subIssues.corpo) ? subIssues.corpo : []).some(
      (i) => i.number === issueFilha.corpo?.number
    )
  )

  // 5. ref.ensure — branch a partir do head da base
  const refBase = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${baseBranch}`)
  const shaBase = refBase.corpo?.object?.sha
  relatar('ref.ensure (leitura da base)', refBase.ok, shaBase?.slice(0, 7))

  // Um commit novo no branch, para o PR ter diferença. Sem ele o GitHub recusa o PR com 422
  // ("No commits between…") — que é comportamento correto dele, e não o que este passo mede.
  const arquivo = `smoke-${CARIMBO}.md`
  const criouBranch = await api('POST', `/repos/${OWNER}/${REPO}/git/refs`, {
    ref: `refs/heads/${BRANCH}`,
    sha: shaBase
  })
  relatar('ref.ensure (cria branch)', criouBranch.ok, BRANCH)

  const commit = await api('PUT', `/repos/${OWNER}/${REPO}/contents/${arquivo}`, {
    message: `smoke ${CARIMBO}`,
    content: Buffer.from(`Smoke da SPEC-Conectores-04 em ${new Date().toISOString()}\n`).toString(
      'base64'
    ),
    branch: BRANCH
  })
  const headSha = commit.corpo?.commit?.sha
  relatar('commit no branch (preparo do PR)', commit.ok, headSha?.slice(0, 7))

  // 6. pr.ensure
  const pr = await api('POST', `/repos/${OWNER}/${REPO}/pulls`, {
    title: `[SMOKE] ${CARIMBO}`,
    body: `Smoke da SPEC-Conectores-04.\n\nrefs ${CHAVE_EXTERNA}`,
    head: BRANCH,
    base: baseBranch
  })
  relatar('pr.ensure (cria)', pr.ok, `#${pr.corpo?.number}`)

  // 6b. idempotência: buscar por head devolve o mesmo PR
  const porHead = await api(
    'GET',
    `/repos/${OWNER}/${REPO}/pulls?state=open&head=${OWNER}:${BRANCH}&base=${baseBranch}`
  )
  relatar(
    'pr.ensure (idempotente: head devolve o mesmo PR)',
    (Array.isArray(porHead.corpo) ? porHead.corpo : [])[0]?.number === pr.corpo?.number
  )

  // 7. checks.for-head e actions.runs-for-head
  const checks = await api('GET', `/repos/${OWNER}/${REPO}/commits/${headSha}/check-runs`)
  relatar(
    'checks.for-head',
    checks.ok && Array.isArray(checks.corpo?.check_runs),
    `${checks.corpo?.check_runs?.length ?? 0} check(s)`
  )

  const runs = await api('GET', `/repos/${OWNER}/${REPO}/actions/runs?head_sha=${headSha}`)
  relatar(
    'actions.runs-for-head',
    runs.ok && Array.isArray(runs.corpo?.workflow_runs),
    `${runs.corpo?.workflow_runs?.length ?? 0} run(s)`
  )

  // 8. pr.merge-state antes do merge — o test merge commit NÃO pode passar por merge real
  const antes = await api('GET', `/repos/${OWNER}/${REPO}/pulls/${pr.corpo?.number}`)
  relatar(
    'pr.merge-state (aberto: merged=false)',
    antes.corpo?.merged === false,
    `merge_commit_sha da API: ${String(antes.corpo?.merge_commit_sha).slice(0, 7)} (test merge — descartado pelo adapter)`
  )

  // 9. squashMerge com SHA ERRADO — precisa dar 409 (critério 5)
  const shaErrado = '0'.repeat(40)
  const barrado = await api('PUT', `/repos/${OWNER}/${REPO}/pulls/${pr.corpo?.number}/merge`, {
    merge_method: 'squash',
    sha: shaErrado
  })
  relatar(
    'pr.squash-merge (SHA errado → 409, o head divergente é barrado pelo GitHub)',
    barrado.status === 409,
    `HTTP ${barrado.status}`
  )

  // 10. squashMerge com o SHA certo
  const prAtual = await api('GET', `/repos/${OWNER}/${REPO}/pulls/${pr.corpo?.number}`)
  const headAtual = prAtual.corpo?.head?.sha
  const mergeado = await api('PUT', `/repos/${OWNER}/${REPO}/pulls/${pr.corpo?.number}/merge`, {
    merge_method: 'squash',
    sha: headAtual
  })
  relatar(
    'pr.squash-merge (SHA certo → merge)',
    mergeado.ok && mergeado.corpo?.merged === true,
    String(mergeado.corpo?.sha).slice(0, 7)
  )

  // 11. pr.merge-state depois — confirmado na origem
  const depois = await api('GET', `/repos/${OWNER}/${REPO}/pulls/${pr.corpo?.number}`)
  relatar(
    'pr.merge-state (confirmado na origem)',
    depois.corpo?.merged === true && depois.corpo?.state === 'closed',
    `mergeSha ${String(depois.corpo?.merge_commit_sha).slice(0, 7)}`
  )

  console.log(`\n${passos - falhas}/${passos} passos ok\n`)

  if (falhas > 0) process.exit(1)
}

main().catch((erro) => {
  // Sem o stack completo: a mensagem de rede pode citar URL com query, e o token está no header.
  console.error(`\nSmoke interrompido: ${erro?.name ?? 'erro'}\n`)
  process.exit(1)
})
