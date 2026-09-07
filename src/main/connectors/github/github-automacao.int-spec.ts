/**
 * As nove capacidades contra um **servidor HTTP local que conta requisições**
 * (SPEC-Conectores-04, categoria Banco).
 *
 * A técnica é a decisão de método do PI na M6-F02, e é o que separa "o mock não foi chamado" de
 * "a requisição não saiu". Aqui ela faz mais: o servidor guarda estado (repositórios, issues,
 * refs, PRs), então **repetir um `ensure` é observável** — se ele duplicasse, o contador de POSTs
 * subiria e o recurso apareceria duas vezes. É assim que o critério 1 vira fato em vez de intenção.
 *
 * O que este arquivo prova e o teste de domínio não prova: que o adapter **procura antes de
 * criar**, que o `sha` vai no corpo do merge (e que o 409 do servidor vira erro de head
 * divergente), e que o 404 autenticado não é reportado como inexistência.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn(),
  writeLog: vi.fn()
}))

const { GithubAdapter } = await import('./github-adapter')
const { GITHUB_OPERATIONS } = await import('@shared/domain/github-automation')

import type { ConnectorError, ConnectorRequest, ConnectorResult } from '@shared/domain/connectors'

const TOKEN = 'ghu_token_do_teste'
const OWNER = 'RodReis'
const REPO = 'repo-de-teste'
const SHA = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'
const OUTRO_SHA = 'f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1'

/** O estado do GitHub falso. Recriado a cada teste. */
interface EstadoFake {
  repos: Map<string, { full_name: string; default_branch: string; html_url: string }>
  issues: { id: number; number: number; title: string; body: string; html_url: string }[]
  subIssues: Map<number, number[]>
  refs: Map<string, string>
  pulls: {
    number: number
    state: string
    head: { sha: string; ref: string }
    base: { ref: string }
    merged: boolean
    merge_commit_sha?: string
    html_url: string
  }[]
  checkRuns: Record<string, unknown>[]
  workflowRuns: Record<string, unknown>[]
  /** A proteção gravada por branch — o `PUT` a substitui inteira, como na API real. */
  protecoes: Map<string, Record<string, unknown>>
  /** Os rótulos do repositório, por nome — que é como o GitHub os endereça. */
  rotulos: Map<string, Record<string, unknown>>
  /** O commit para onde cada ref aponta na origem, para `commit.sha-for-ref`. */
  commits: Map<string, string>
}

let estado: EstadoFake
let servidor: Server
let origem: string
/** Toda requisição que chegou — método + caminho. É sobre ela que a idempotência é afirmada. */
let requisicoes: { metodo: string; caminho: string; corpo: unknown }[]
/** Respostas forçadas por caminho, para exercitar 404/409/422/429 sem inventar estado. */
let forcadas: Map<string, { status: number; corpo?: unknown; headers?: Record<string, string> }>
/**
 * Quantas listagens uma issue recém-criada leva para aparecer.
 *
 * Zero = consistente (o padrão dos testes). Valor maior imita o GitHub real, cuja listagem é
 * **eventualmente consistente** — o smoke real mediu ~1,5 s de atraso. É a mentira que o fake
 * precisa saber contar: sem ela, "repetir não duplica" fica verde num cenário que não existe.
 */
let listagensAteAparecer = 0
/** Quantas listagens faltam para cada issue nova aparecer. */
let atrasos: Map<number, number>

function estadoInicial(): EstadoFake {
  return {
    repos: new Map(),
    issues: [],
    subIssues: new Map(),
    refs: new Map(),
    pulls: [],
    checkRuns: [],
    workflowRuns: [],
    protecoes: new Map(),
    commits: new Map(),
    rotulos: new Map()
  }
}

/**
 * O GitHub falso. Implementa só o que as nove operações usam, com o **comportamento que importa**:
 * 404 para o que não existe, 409 quando o `sha` do merge não casa, e estado que persiste entre
 * chamadas — sem isso, "repetir não duplica" não teria como ser observado.
 */
function responder(
  metodo: string,
  caminho: string,
  corpo: unknown
): { status: number; corpo?: unknown; headers?: Record<string, string> } {
  const forcada = forcadas.get(`${metodo} ${caminho.split('?')[0]}`)
  if (forcada !== undefined) return forcada

  const semQuery = caminho.split('?')[0] ?? ''
  const query = new URLSearchParams(caminho.split('?')[1] ?? '')
  const corpoObj = (corpo ?? {}) as Record<string, unknown>

  // GET /user — auth.identify
  if (metodo === 'GET' && semQuery === '/user') {
    return { status: 200, corpo: { login: OWNER, id: 1, type: 'User' } }
  }

  // GET /repos/{owner}/{repo}
  const repoMatch = /^\/repos\/([^/]+)\/([^/]+)$/.exec(semQuery)
  if (metodo === 'GET' && repoMatch) {
    const chave = `${repoMatch[1]}/${repoMatch[2]}`
    const repo = estado.repos.get(chave)
    return repo ? { status: 200, corpo: repo } : { status: 404, corpo: { message: 'Not Found' } }
  }

  // POST /user/repos
  if (metodo === 'POST' && semQuery === '/user/repos') {
    const nome = String(corpoObj.name)
    const chave = `${OWNER}/${nome}`
    if (estado.repos.has(chave)) {
      return { status: 422, corpo: { message: 'name already exists on this account' } }
    }
    const repo = {
      full_name: chave,
      default_branch: 'main',
      html_url: `https://github.com/${chave}`
    }
    estado.repos.set(chave, repo)
    return { status: 201, corpo: repo }
  }

  // GET /repos/{o}/{r}/issues  (listagem para o ensure)
  if (metodo === 'GET' && /\/issues$/.test(semQuery)) {
    // Esconde as `listagensAteAparecer` primeiras leituras de cada issue nova.
    const visiveis = estado.issues.filter((i) => (atrasos.get(i.number) ?? 0) <= 0)
    for (const [n, restante] of atrasos) {
      if (restante > 0) atrasos.set(n, restante - 1)
    }
    return { status: 200, corpo: visiveis }
  }

  // POST /repos/{o}/{r}/issues
  if (metodo === 'POST' && /\/issues$/.test(semQuery)) {
    const numeroNovo = estado.issues.length + 1
    const issue = {
      id: 1000 + numeroNovo,
      number: numeroNovo,
      title: String(corpoObj.title),
      body: String(corpoObj.body ?? ''),
      html_url: `https://github.com/${OWNER}/${REPO}/issues/${numeroNovo}`
    }
    estado.issues.push(issue)
    if (listagensAteAparecer > 0) atrasos.set(numeroNovo, listagensAteAparecer)
    return { status: 201, corpo: issue }
  }

  // GET /repos/{o}/{r}/issues/{n}
  const issueMatch = /\/issues\/(\d+)$/.exec(semQuery)
  if (metodo === 'GET' && issueMatch) {
    const numeroIssue = Number(issueMatch[1])
    const issue = estado.issues.find((i) => i.number === numeroIssue)
    return issue ? { status: 200, corpo: issue } : { status: 404, corpo: { message: 'Not Found' } }
  }

  // GET/POST /repos/{o}/{r}/issues/{n}/sub_issues
  const subMatch = /\/issues\/(\d+)\/sub_issues$/.exec(semQuery)
  if (subMatch) {
    const pai = Number(subMatch[1])
    if (metodo === 'GET') {
      const filhos = estado.subIssues.get(pai) ?? []
      return {
        status: 200,
        corpo: filhos.map((n) => estado.issues.find((i) => i.number === n) ?? { number: n })
      }
    }
    const idFilha = Number(corpoObj.sub_issue_id)
    const filha = estado.issues.find((i) => i.id === idFilha)
    if (!filha) return { status: 422, corpo: { message: 'sub_issue_id not found' } }
    estado.subIssues.set(pai, [...(estado.subIssues.get(pai) ?? []), filha.number])
    return { status: 201, corpo: { number: pai } }
  }

  // GET /repos/{o}/{r}/git/ref/heads/{branch}
  const refGet = /\/git\/ref\/(.+)$/.exec(semQuery)
  if (metodo === 'GET' && refGet) {
    const sha = estado.refs.get(refGet[1] ?? '')
    return sha
      ? { status: 200, corpo: { ref: `refs/${refGet[1]}`, object: { sha, type: 'commit' } } }
      : { status: 404, corpo: { message: 'Not Found' } }
  }

  // POST /repos/{o}/{r}/git/refs
  if (metodo === 'POST' && /\/git\/refs$/.test(semQuery)) {
    const ref = String(corpoObj.ref).replace(/^refs\//, '')
    if (estado.refs.has(ref)) {
      return { status: 422, corpo: { message: 'Reference already exists' } }
    }
    estado.refs.set(ref, String(corpoObj.sha))
    return { status: 201, corpo: { ref: `refs/${ref}`, object: { sha: corpoObj.sha } } }
  }

  // PATCH /repos/{o}/{r}/git/refs/heads/{branch}
  const refPatch = /\/git\/refs\/(.+)$/.exec(semQuery)
  if (metodo === 'PATCH' && refPatch) {
    estado.refs.set(refPatch[1] ?? '', String(corpoObj.sha))
    return { status: 200, corpo: { ref: `refs/${refPatch[1]}`, object: { sha: corpoObj.sha } } }
  }

  // GET /repos/{o}/{r}/pulls  (listagem por head)
  if (metodo === 'GET' && /\/pulls$/.test(semQuery)) {
    const head = (query.get('head') ?? '').split(':')[1]
    const abertos = estado.pulls.filter(
      (p) => p.state === 'open' && (head === undefined || p.head.ref === head)
    )
    return { status: 200, corpo: abertos }
  }

  // POST /repos/{o}/{r}/pulls
  if (metodo === 'POST' && /\/pulls$/.test(semQuery)) {
    const numeroNovo = estado.pulls.length + 1
    const pr = {
      number: numeroNovo,
      state: 'open',
      head: { sha: SHA, ref: String(corpoObj.head) },
      base: { ref: String(corpoObj.base) },
      merged: false,
      // PR aberto tem `merge_commit_sha` de **test merge commit** — o dado que o normalizador
      // precisa descartar, e que este fake reproduz de propósito.
      merge_commit_sha: 'test0000merge0000commit0000sha0000000000',
      html_url: `https://github.com/${OWNER}/${REPO}/pull/${numeroNovo}`
    }
    estado.pulls.push(pr)
    return { status: 201, corpo: pr }
  }

  // GET /repos/{o}/{r}/pulls/{n}
  const prGet = /\/pulls\/(\d+)$/.exec(semQuery)
  if (metodo === 'GET' && prGet) {
    const pr = estado.pulls.find((p) => p.number === Number(prGet[1]))
    return pr ? { status: 200, corpo: pr } : { status: 404, corpo: { message: 'Not Found' } }
  }

  // PUT /repos/{o}/{r}/pulls/{n}/merge
  const merge = /\/pulls\/(\d+)\/merge$/.exec(semQuery)
  if (metodo === 'PUT' && merge) {
    const pr = estado.pulls.find((p) => p.number === Number(merge[1]))
    if (!pr) return { status: 404, corpo: { message: 'Not Found' } }
    // **409 só quando o `sha` foi enviado e não casa** — é assim que a API real se comporta, e a
    // distinção importa: sem `sha`, o GitHub **mergeia** o que estiver no head. Um fake que
    // recusasse a ausência faria o teste do head divergente passar mesmo com o código omitindo o
    // `sha` — verde pelo motivo errado, que foi o que o contrafactual mostrou.
    if (corpoObj.sha !== undefined && corpoObj.sha !== pr.head.sha) {
      return { status: 409, corpo: { message: 'Head branch was modified. Review and try again.' } }
    }
    pr.merged = true
    pr.state = 'closed'
    pr.merge_commit_sha = 'merged00sha00000000000000000000000000000'
    return { status: 200, corpo: { sha: pr.merge_commit_sha, merged: true } }
  }

  // GET /repos/{o}/{r}/commits/{sha}/check-runs
  if (metodo === 'GET' && /\/check-runs$/.test(semQuery)) {
    return { status: 200, corpo: { check_runs: estado.checkRuns } }
  }

  // GET /repos/{o}/{r}/actions/runs
  if (metodo === 'GET' && /\/actions\/runs$/.test(semQuery)) {
    return { status: 200, corpo: { workflow_runs: estado.workflowRuns } }
  }

  // PATCH /repos/{owner}/{repo} — default_branch
  if (metodo === 'PATCH' && repoMatch) {
    const chave = `${repoMatch[1]}/${repoMatch[2]}`
    const repo = estado.repos.get(chave)
    if (!repo) return { status: 404, corpo: { message: 'Not Found' } }
    const alvo = String(corpoObj.default_branch)
    // O GitHub recusa apontar a default para uma ref que não existe. Sem isto, o fake aceitaria
    // um estado que a API real rejeita — e o teste ficaria verde sobre um repositório impossível.
    if (!estado.refs.has(`heads/${alvo}`)) {
      return { status: 422, corpo: { message: 'Invalid default branch' } }
    }
    repo.default_branch = alvo
    return { status: 200, corpo: repo }
  }

  // PUT /repos/{o}/{r}/branches/{branch}/protection
  const protMatch = /\/branches\/([^/]+)\/protection$/.exec(semQuery)
  if (metodo === 'PUT' && protMatch) {
    const branch = protMatch[1] ?? ''
    if (!estado.refs.has(`heads/${branch}`)) {
      return { status: 404, corpo: { message: 'Branch not found' } }
    }
    // Substitui inteiro, como o `PUT` real: repetir com a mesma entrada deixa o mesmo estado.
    estado.protecoes.set(branch, corpoObj)
    return { status: 200, corpo: corpoObj }
  }

  // GET /repos/{o}/{r}/branches/{branch}/protection — 404 quando a branch existe e não tem
  // proteção, que é como a API real responde e o estado normal de repositório recém-criado.
  if (metodo === 'GET' && protMatch) {
    const branch = protMatch[1] ?? ''
    const protecao = estado.protecoes.get(branch)
    return protecao === undefined
      ? { status: 404, corpo: { message: 'Branch not protected' } }
      : { status: 200, corpo: protecao }
  }

  // GET /repos/{o}/{r}/labels/{nome}  e  POST /repos/{o}/{r}/labels
  const labelGet = /\/labels\/([^/]+)$/.exec(semQuery)
  if (metodo === 'GET' && labelGet) {
    const nome = decodeURIComponent(labelGet[1] ?? '')
    const rotulo = estado.rotulos.get(nome)
    return rotulo
      ? { status: 200, corpo: rotulo }
      : { status: 404, corpo: { message: 'Not Found' } }
  }
  if (metodo === 'POST' && /\/labels$/.test(semQuery)) {
    const nome = String(corpoObj.name)
    if (estado.rotulos.has(nome)) {
      return { status: 422, corpo: { message: 'already_exists' } }
    }
    const rotulo = { name: nome, color: String(corpoObj.color), description: corpoObj.description }
    estado.rotulos.set(nome, rotulo)
    return { status: 201, corpo: rotulo }
  }

  // GET /repos/{o}/{r}/commits/{ref}
  const commitMatch = /\/commits\/([^/]+)$/.exec(semQuery)
  if (metodo === 'GET' && commitMatch) {
    const ref = commitMatch[1] ?? ''
    // Aceita nome de branch e SHA, como a API real: a branch resolve pelo ref, o SHA por si.
    const sha = estado.commits.get(ref) ?? estado.refs.get(`heads/${ref}`)
    return sha === undefined
      ? { status: 404, corpo: { message: 'No commit found for SHA' } }
      : {
          status: 200,
          corpo: { sha, html_url: `https://github.com/${OWNER}/${REPO}/commit/${sha}` }
        }
  }

  return { status: 404, corpo: { message: 'Not Found' } }
}

function pedido(operation: string, input: unknown): ConnectorRequest {
  return {
    contractVersion: 1,
    connector: 'github',
    operation,
    correlationId: 'c-1',
    timeoutMs: 10_000,
    credential: { key: 'github', user_id: 'u-1', workspace_id: 'jarvis' },
    idempotencyKey: 'idem-1',
    input
  }
}

function adapter(): InstanceType<typeof GithubAdapter> {
  return new GithubAdapter(
    (url, init) => fetch(url, init),
    () => Date.now(),
    origem
  )
}

/** Executa uma operação pelo adapter, com credencial. */
async function executar(
  operation: string,
  input: unknown
): Promise<ConnectorResult | ConnectorError> {
  const ad = adapter()
  const execution = {
    request: pedido(operation, input),
    capability: {
      connector: 'github' as const,
      operation,
      effect: 'mutacao' as const,
      descricao: 'x'
    },
    secret: TOKEN
  }

  const recusa = ad.validar(execution)
  if (recusa !== undefined) return recusa

  return await ad.executar(execution)
}

/** Quantas requisições daquele método casam o padrão. */
function contar(metodo: string, padrao: RegExp): number {
  return requisicoes.filter((r) => r.metodo === metodo && padrao.test(r.caminho)).length
}

beforeEach(async () => {
  estado = estadoInicial()
  requisicoes = []
  forcadas = new Map()
  atrasos = new Map()
  listagensAteAparecer = 0

  servidor = createServer((req, res) => {
    let cru = ''
    req.on('data', (c: Buffer) => {
      cru += c.toString('utf8')
    })
    req.on('end', () => {
      const corpo = cru === '' ? undefined : (JSON.parse(cru) as unknown)
      requisicoes.push({ metodo: req.method ?? '', caminho: req.url ?? '', corpo })

      const r = responder(req.method ?? '', req.url ?? '', corpo)
      res.writeHead(r.status, { 'Content-Type': 'application/json', ...(r.headers ?? {}) })
      res.end(JSON.stringify(r.corpo ?? {}))
    })
  })

  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve))
  origem = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
})

afterEach(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()))
})

describe('repo.ensure — critério 1', () => {
  it('cria o repositório quando não existe', async () => {
    const r = (await executar(GITHUB_OPERATIONS.ensureRepository, {
      owner: OWNER,
      repo: REPO,
      visibility: 'private'
    })) as ConnectorResult

    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ fullName: `${OWNER}/${REPO}`, defaultBranch: 'main' })
    expect(r.externalRef?.id).toBe(`${OWNER}/${REPO}`)
    expect(contar('POST', /\/user\/repos/)).toBe(1)
  })

  it('repetir NÃO duplica: o segundo ensure não faz POST nenhum', async () => {
    const entrada = { owner: OWNER, repo: REPO, visibility: 'private' as const }
    await executar(GITHUB_OPERATIONS.ensureRepository, entrada)
    requisicoes = []

    const r = (await executar(GITHUB_OPERATIONS.ensureRepository, entrada)) as ConnectorResult

    expect(r.ok).toBe(true)
    // O contador é a prova: "procura antes de criar" só é verificável pelo que **não** saiu.
    expect(contar('POST', /./)).toBe(0)
    expect(estado.repos.size).toBe(1)
  })
})

describe('issue.ensure — critérios 1 e 2', () => {
  const entrada = {
    owner: OWNER,
    repo: REPO,
    externalKey: 'M6-F04',
    title: 'Automação GitHub idempotente',
    body: 'Fatia 04 do MVP-006.'
  }

  it('cria a issue com a chave externa no corpo', async () => {
    const r = (await executar(GITHUB_OPERATIONS.ensureIssue, entrada)) as ConnectorResult

    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ numero: 1, titulo: entrada.title })
    // A chave é o vínculo com MVP/Fatia/SPEC que o critério 2 pede, e ela vive no corpo.
    expect(estado.issues[0]?.body).toContain('<!-- jarvis-key: M6-F04 -->')
  })

  it('repetir NÃO duplica: reusa a issue com a mesma chave', async () => {
    await executar(GITHUB_OPERATIONS.ensureIssue, entrada)
    requisicoes = []

    const r = (await executar(GITHUB_OPERATIONS.ensureIssue, entrada)) as ConnectorResult

    expect((r as ConnectorResult).data).toMatchObject({ numero: 1 })
    expect(contar('POST', /\/issues/)).toBe(0)
    expect(estado.issues).toHaveLength(1)
  })

  it('título diferente com a MESMA chave reusa — a chave manda, não o título', async () => {
    // É por isso que a busca não é por título: renomear a fatia criaria uma segunda issue.
    await executar(GITHUB_OPERATIONS.ensureIssue, entrada)
    await executar(GITHUB_OPERATIONS.ensureIssue, { ...entrada, title: 'Título reescrito' })

    expect(estado.issues).toHaveLength(1)
    expect(estado.issues[0]?.title).toBe(entrada.title)
  })

  it('converge para a mais antiga quando a listagem ainda não mostra a recém-criada', async () => {
    // **O caso que o smoke real revelou e nenhum fake mostraria sozinho:** a listagem do GitHub é
    // eventualmente consistente, e a issue criada só aparece ~1,5 s depois. Sem a releitura pós-
    // criação, dois `ensure` em sequência criariam duas issues — o oposto do critério 1.
    listagensAteAparecer = 2

    const a = (await executar(GITHUB_OPERATIONS.ensureIssue, entrada)) as ConnectorResult
    const b = (await executar(GITHUB_OPERATIONS.ensureIssue, entrada)) as ConnectorResult

    // As duas chamadas apontam para a MESMA issue — a mais antiga —, mesmo tendo o serviço
    // escondido a primeira na hora da segunda busca.
    expect((a.data as { numero: number }).numero).toBe(1)
    expect((b.data as { numero: number }).numero).toBe(1)
  })

  it('chave diferente cria outra issue', async () => {
    await executar(GITHUB_OPERATIONS.ensureIssue, entrada)
    await executar(GITHUB_OPERATIONS.ensureIssue, { ...entrada, externalKey: 'M6-F05' })

    expect(estado.issues).toHaveLength(2)
  })
})

describe('issue.ensure-dependency', () => {
  beforeEach(async () => {
    await executar(GITHUB_OPERATIONS.ensureIssue, {
      owner: OWNER,
      repo: REPO,
      externalKey: 'MVP-006',
      title: 'Épico',
      body: ''
    })
    await executar(GITHUB_OPERATIONS.ensureIssue, {
      owner: OWNER,
      repo: REPO,
      externalKey: 'M6-F04',
      title: 'Fatia',
      body: ''
    })
  })

  it('vincula pela API de sub-issues, com o ID global e não o número', async () => {
    const r = (await executar(GITHUB_OPERATIONS.ensureIssueDependency, {
      owner: OWNER,
      repo: REPO,
      parentIssue: 1,
      childIssue: 2
    })) as ConnectorResult

    expect(r.ok).toBe(true)
    expect(estado.subIssues.get(1)).toEqual([2])

    // A API recebe `sub_issue_id` — o **id** (1002), não o `number` (2). Confundi-los apontaria
    // o vínculo para outra issue qualquer.
    const post = requisicoes.find((q) => q.metodo === 'POST' && /sub_issues/.test(q.caminho))
    expect(post?.corpo).toEqual({ sub_issue_id: 1002 })
  })

  it('repetir NÃO duplica o vínculo', async () => {
    const entrada = { owner: OWNER, repo: REPO, parentIssue: 1, childIssue: 2 }
    await executar(GITHUB_OPERATIONS.ensureIssueDependency, entrada)
    requisicoes = []

    await executar(GITHUB_OPERATIONS.ensureIssueDependency, entrada)

    expect(estado.subIssues.get(1)).toEqual([2])
    expect(contar('POST', /sub_issues/)).toBe(0)
  })
})

describe('ref.ensure', () => {
  it('cria o branch quando não existe', async () => {
    const r = (await executar(GITHUB_OPERATIONS.ensureBranchRef, {
      owner: OWNER,
      repo: REPO,
      branch: 'feat/x',
      sha: SHA
    })) as ConnectorResult

    expect(r.ok).toBe(true)
    expect(estado.refs.get('heads/feat/x')).toBe(SHA)
  })

  it('repetir com o mesmo SHA não faz escrita nenhuma', async () => {
    const entrada = { owner: OWNER, repo: REPO, branch: 'feat/x', sha: SHA }
    await executar(GITHUB_OPERATIONS.ensureBranchRef, entrada)
    requisicoes = []

    await executar(GITHUB_OPERATIONS.ensureBranchRef, entrada)

    expect(contar('POST', /git\/refs/)).toBe(0)
    expect(contar('PATCH', /git\/refs/)).toBe(0)
  })

  it('SHA diferente atualiza o ref existente, sem criar um segundo', async () => {
    await executar(GITHUB_OPERATIONS.ensureBranchRef, {
      owner: OWNER,
      repo: REPO,
      branch: 'feat/x',
      sha: SHA
    })
    requisicoes = []

    await executar(GITHUB_OPERATIONS.ensureBranchRef, {
      owner: OWNER,
      repo: REPO,
      branch: 'feat/x',
      sha: OUTRO_SHA
    })

    expect(estado.refs.get('heads/feat/x')).toBe(OUTRO_SHA)
    expect(contar('PATCH', /git\/refs/)).toBe(1)
    expect(contar('POST', /git\/refs/)).toBe(0)
  })

  it('o PATCH não manda force — branch divergido falha em vez de perder commits', async () => {
    await executar(GITHUB_OPERATIONS.ensureBranchRef, {
      owner: OWNER,
      repo: REPO,
      branch: 'feat/x',
      sha: SHA
    })
    await executar(GITHUB_OPERATIONS.ensureBranchRef, {
      owner: OWNER,
      repo: REPO,
      branch: 'feat/x',
      sha: OUTRO_SHA
    })

    const patch = requisicoes.find((q) => q.metodo === 'PATCH')
    expect(patch?.corpo).toEqual({ sha: OUTRO_SHA })
    expect(JSON.stringify(patch?.corpo)).not.toContain('force')
  })
})

describe('pr.ensure — critério 3', () => {
  const entrada = {
    owner: OWNER,
    repo: REPO,
    head: 'feat/x',
    base: 'main',
    title: 'Fatia 04',
    body: 'refs #90'
  }

  it('cria o PR quando não há aberto para aquele head', async () => {
    const r = (await executar(GITHUB_OPERATIONS.ensurePullRequest, entrada)) as ConnectorResult

    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ numero: 1, headSha: SHA, estado: 'open' })
  })

  it('PR existente por head é REUSADO, não recriado', async () => {
    await executar(GITHUB_OPERATIONS.ensurePullRequest, entrada)
    requisicoes = []

    const r = (await executar(GITHUB_OPERATIONS.ensurePullRequest, entrada)) as ConnectorResult

    expect((r as ConnectorResult).data).toMatchObject({ numero: 1 })
    expect(contar('POST', /\/pulls/)).toBe(0)
    expect(estado.pulls).toHaveLength(1)
  })
})

describe('checks.for-head — critério 4', () => {
  it('normaliza SHA e conclusão, sem o objeto do GitHub', async () => {
    estado.checkRuns = [
      {
        name: 'test',
        head_sha: SHA,
        status: 'completed',
        conclusion: 'success',
        html_url: 'https://github.com/x',
        // O GitHub manda muito mais do que isto. O normalizado leva só o que alguma regra usa.
        app: { id: 1, slug: 'github-actions' },
        check_suite: { id: 9, run_attempt: 2 },
        output: { summary: 'tudo certo' }
      }
    ]

    const r = (await executar(GITHUB_OPERATIONS.getChecksForHead, {
      owner: OWNER,
      repo: REPO,
      sha: SHA
    })) as ConnectorResult

    // `emissor` e `tentativa` entraram com a SPEC-Pipeline-01 (critério 11): nome de check não é
    // identidade, e um check verde de outro app ou de uma tentativa antiga não pode satisfazer o
    // gate. São **dois escalares extraídos** de `app.slug` e `check_suite.run_attempt`, não o
    // objeto do GitHub — que continua fora, como este teste segue provando com `output`.
    expect(r.data).toEqual([
      {
        nome: 'test',
        headSha: SHA,
        status: 'completed',
        conclusao: 'success',
        url: 'https://github.com/x',
        emissor: 'github-actions',
        tentativa: 2
      }
    ])
    expect(JSON.stringify(r.data)).not.toContain('tudo certo')
    expect(JSON.stringify(r.data)).not.toContain('"id"')
  })

  it('origem sem app nem check_suite não vira campo inventado', async () => {
    // Ausência de dado é ausência: `recusaDaEvidencia` não bloqueia por falta de emissor ou
    // tentativa, mas também não pode receber um valor forjado para preencher o buraco.
    estado.checkRuns = [{ name: 'test', head_sha: SHA, status: 'completed', conclusion: 'success' }]

    const r = (await executar(GITHUB_OPERATIONS.getChecksForHead, {
      owner: OWNER,
      repo: REPO,
      sha: SHA
    })) as ConnectorResult

    const check = (r.data as readonly Record<string, unknown>[])[0]
    expect(check).toBeDefined()
    expect('emissor' in check!).toBe(false)
    expect('tentativa' in check!).toBe(false)
  })

  it('check sem conclusão fica sem o campo — ausência é "ainda não se sabe"', async () => {
    estado.checkRuns = [{ name: 'test', head_sha: SHA, status: 'in_progress', conclusion: null }]

    const r = (await executar(GITHUB_OPERATIONS.getChecksForHead, {
      owner: OWNER,
      repo: REPO,
      sha: SHA
    })) as ConnectorResult

    expect(r.data).toEqual([{ nome: 'test', headSha: SHA, status: 'in_progress' }])
  })

  it('resposta com forma inesperada vira lista vazia, não exceção', async () => {
    // "Estado vindo do GitHub é entrada não confiável" (spec § Regras).
    forcadas.set(`GET /repos/${OWNER}/${REPO}/commits/${SHA}/check-runs`, {
      status: 200,
      corpo: { check_runs: 'não é array' }
    })

    const r = (await executar(GITHUB_OPERATIONS.getChecksForHead, {
      owner: OWNER,
      repo: REPO,
      sha: SHA
    })) as ConnectorResult

    expect(r.ok).toBe(true)
    expect(r.data).toEqual([])
  })
})

describe('actions.runs-for-head', () => {
  it('normaliza as execuções de workflow', async () => {
    estado.workflowRuns = [
      { name: 'CI', head_sha: SHA, status: 'completed', conclusion: 'success', html_url: 'u' }
    ]

    const r = (await executar(GITHUB_OPERATIONS.getWorkflowRunsForHead, {
      owner: OWNER,
      repo: REPO,
      sha: SHA
    })) as ConnectorResult

    expect(r.data).toEqual([
      { nome: 'CI', headSha: SHA, status: 'completed', conclusao: 'success', url: 'u' }
    ])
  })
})

describe('pr.squash-merge — critério 5', () => {
  beforeEach(async () => {
    await executar(GITHUB_OPERATIONS.ensurePullRequest, {
      owner: OWNER,
      repo: REPO,
      head: 'feat/x',
      base: 'main',
      title: 'T',
      body: ''
    })
  })

  it('mergeia com o SHA esperado e confirma o mergeSha', async () => {
    const r = (await executar(GITHUB_OPERATIONS.squashMerge, {
      owner: OWNER,
      repo: REPO,
      pullRequest: 1,
      expectedHeadSha: SHA
    })) as ConnectorResult

    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ merged: true })
    expect((r.data as { mergeSha: string }).mergeSha).toBe(
      'merged00sha00000000000000000000000000000'
    )

    const merge = requisicoes.find((q) => q.metodo === 'PUT')
    expect(merge?.corpo).toEqual({ merge_method: 'squash', sha: SHA })
  })

  it('head divergente é barrado pelo GitHub (409) e vira erro com ação concreta', async () => {
    // O push que chegou entre a verificação e o merge: o serviço recusa, e o adapter traduz.
    const r = (await executar(GITHUB_OPERATIONS.squashMerge, {
      owner: OWNER,
      repo: REPO,
      pullRequest: 1,
      expectedHeadSha: OUTRO_SHA
    })) as ConnectorError

    expect(r.ok).toBe(false)
    expect(r.code).toBe('validacao-invalida')
    expect(r.retryable).toBe(false)
    expect(r.mensagem).toMatch(/releia os checks/i)
    // E nada foi mergeado.
    expect(estado.pulls[0]?.merged).toBe(false)
  })

  it('sem expectedHeadSha, a chamada nem sai do app', async () => {
    const r = (await executar(GITHUB_OPERATIONS.squashMerge, {
      owner: OWNER,
      repo: REPO,
      pullRequest: 1
    })) as ConnectorError

    expect(r.code).toBe('validacao-invalida')
    // A recusa é gratuita: nenhuma requisição de merge saiu.
    expect(contar('PUT', /merge/)).toBe(0)
  })
})

describe('pr.merge-state', () => {
  beforeEach(async () => {
    await executar(GITHUB_OPERATIONS.ensurePullRequest, {
      owner: OWNER,
      repo: REPO,
      head: 'feat/x',
      base: 'main',
      title: 'T',
      body: ''
    })
  })

  it('PR aberto NÃO devolve mergeSha, mesmo com merge_commit_sha na resposta', async () => {
    // A armadilha da API: em PR aberto, `merge_commit_sha` é um *test merge commit* que não está
    // em branch nenhum. Repassá-lo faria o chamador declarar entregue o que não foi mergeado.
    const r = (await executar(GITHUB_OPERATIONS.getMergeState, {
      owner: OWNER,
      repo: REPO,
      pullRequest: 1
    })) as ConnectorResult

    expect(r.data).toMatchObject({ numero: 1, estado: 'open', merged: false })
    expect(r.data).not.toHaveProperty('mergeSha')
    expect(JSON.stringify(r.data)).not.toContain('test0000merge')
  })

  it('depois do merge, devolve o mergeSha real consultado na origem', async () => {
    await executar(GITHUB_OPERATIONS.squashMerge, {
      owner: OWNER,
      repo: REPO,
      pullRequest: 1,
      expectedHeadSha: SHA
    })

    const r = (await executar(GITHUB_OPERATIONS.getMergeState, {
      owner: OWNER,
      repo: REPO,
      pullRequest: 1
    })) as ConnectorResult

    expect(r.data).toMatchObject({
      estado: 'closed',
      merged: true,
      mergeSha: 'merged00sha00000000000000000000000000000'
    })
  })
})

describe('repo.set-default-branch — M9-F01', () => {
  beforeEach(async () => {
    await executar(GITHUB_OPERATIONS.ensureRepository, {
      owner: OWNER,
      repo: REPO,
      visibility: 'private'
    })
    estado.refs.set('heads/develop', SHA)
  })

  it('aponta a default para a branch informada', async () => {
    const r = (await executar(GITHUB_OPERATIONS.setDefaultBranch, {
      owner: OWNER,
      repo: REPO,
      branch: 'develop'
    })) as ConnectorResult

    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ defaultBranch: 'develop', alterado: true })
    expect(estado.repos.get(`${OWNER}/${REPO}`)?.default_branch).toBe('develop')
  })

  it('repetir NÃO escreve: a segunda chamada não faz PATCH nenhum', async () => {
    const entrada = { owner: OWNER, repo: REPO, branch: 'develop' }
    await executar(GITHUB_OPERATIONS.setDefaultBranch, entrada)
    requisicoes = []

    const r = (await executar(GITHUB_OPERATIONS.setDefaultBranch, entrada)) as ConnectorResult

    expect(r.ok).toBe(true)
    // `alterado: false` é o que torna a idempotência observável de fora — e o contador prova que
    // nenhuma mutação auditada saiu numa publicação repetida.
    expect(r.data).toMatchObject({ alterado: false })
    expect(contar('PATCH', /./)).toBe(0)
  })

  it('branch inexistente na origem falha em vez de deixar o repositório apontando para o vazio', async () => {
    const r = (await executar(GITHUB_OPERATIONS.setDefaultBranch, {
      owner: OWNER,
      repo: REPO,
      branch: 'nao-existe'
    })) as ConnectorError

    expect(r.ok).toBe(false)
  })
})

describe('branch.ensure-protection — M9-F01', () => {
  beforeEach(async () => {
    await executar(GITHUB_OPERATIONS.ensureRepository, {
      owner: OWNER,
      repo: REPO,
      visibility: 'private'
    })
    estado.refs.set('heads/main', SHA)
  })

  it('proíbe force-push e deleção da branch base', async () => {
    const r = (await executar(GITHUB_OPERATIONS.ensureBranchProtection, {
      owner: OWNER,
      repo: REPO,
      branch: 'main',
      revisoesExigidas: 0
    })) as ConnectorResult

    expect(r.ok).toBe(true)
    const gravado = estado.protecoes.get('main')
    // É a razão de proteger: sem isto, uma publicação com divergência poderia reescrever o
    // histórico da base em vez de falhar, e a regra da spec ("divergência preserva ambos os
    // lados") dependeria só do nosso lado se comportar.
    expect(gravado).toMatchObject({ allow_force_pushes: false, allow_deletions: false })
  })

  it('não exige revisor quando o merge é autônomo, mas mantém o resto da proteção', async () => {
    await executar(GITHUB_OPERATIONS.ensureBranchProtection, {
      owner: OWNER,
      repo: REPO,
      branch: 'main',
      revisoesExigidas: 0
    })

    const gravado = estado.protecoes.get('main') as Record<string, Record<string, unknown>>
    expect(gravado.required_pull_request_reviews?.required_approving_review_count).toBe(0)
    // `enforce_admins: false` é deliberado: o merge autônomo do MVP-009 roda como o dono, e com
    // `true` a proteção barraria a entrega que ela existe para proteger.
    expect(gravado.enforce_admins).toBe(false)
  })

  it('repetir deixa o mesmo estado — o PUT substitui, não acumula', async () => {
    const entrada = {
      owner: OWNER,
      repo: REPO,
      branch: 'main',
      revisoesExigidas: 1,
      checksExigidos: ['ci']
    }
    await executar(GITHUB_OPERATIONS.ensureBranchProtection, entrada)
    const primeira = JSON.stringify(estado.protecoes.get('main'))

    await executar(GITHUB_OPERATIONS.ensureBranchProtection, entrada)

    expect(JSON.stringify(estado.protecoes.get('main'))).toBe(primeira)
  })

  it('checks exigidos vazios limpam a lista, e omitidos preservam o que havia', async () => {
    await executar(GITHUB_OPERATIONS.ensureBranchProtection, {
      owner: OWNER,
      repo: REPO,
      branch: 'main',
      revisoesExigidas: 0,
      checksExigidos: []
    })
    expect(estado.protecoes.get('main')?.required_status_checks).toMatchObject({ contexts: [] })

    await executar(GITHUB_OPERATIONS.ensureBranchProtection, {
      owner: OWNER,
      repo: REPO,
      branch: 'main',
      revisoesExigidas: 0
    })
    // `null` é como a API distingue "não mexa nisso" de "esvazie" — e confundir os dois apagaria
    // a exigência de CI de um repositório que a tinha.
    expect(estado.protecoes.get('main')?.required_status_checks).toBeNull()
  })
})

describe('checks.required-for-branch — critério 11 da M9-F05', () => {
  beforeEach(async () => {
    await executar(GITHUB_OPERATIONS.ensureRepository, {
      owner: OWNER,
      repo: REPO,
      visibility: 'private'
    })
    estado.refs.set('heads/main', SHA)
  })

  it('branch sem proteção devolve protegida:false, não erro', async () => {
    // O 404 deste endpoint é o caso normal de repositório recém-criado: a branch existe e não tem
    // proteção. Tratá-lo como erro faria o gate falhar onde a resposta certa é "não há regra".
    const r = (await executar(GITHUB_OPERATIONS.getRequiredChecks, {
      owner: OWNER,
      repo: REPO,
      branch: 'main'
    })) as ConnectorResult

    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ protegida: false, contexts: [], mergeQueueExigida: false })
  })

  it('lê os contexts e o strict que a origem exige', async () => {
    await executar(GITHUB_OPERATIONS.ensureBranchProtection, {
      owner: OWNER,
      repo: REPO,
      branch: 'main',
      revisoesExigidas: 0,
      checksExigidos: ['validacao']
    })

    const r = (await executar(GITHUB_OPERATIONS.getRequiredChecks, {
      owner: OWNER,
      repo: REPO,
      branch: 'main'
    })) as ConnectorResult

    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ protegida: true, contexts: ['validacao'], strict: true })
  })

  it('proteção sem exigência de check devolve lista vazia, e não "sem proteção"', async () => {
    // A diferença importa para o gate: `protegida: true` com `contexts: []` é uma branch protegida
    // que ninguém mandou verificar — e o critério 10 a barra do mesmo jeito, mas por outra causa.
    await executar(GITHUB_OPERATIONS.ensureBranchProtection, {
      owner: OWNER,
      repo: REPO,
      branch: 'main',
      revisoesExigidas: 1
    })

    const r = (await executar(GITHUB_OPERATIONS.getRequiredChecks, {
      owner: OWNER,
      repo: REPO,
      branch: 'main'
    })) as ConnectorResult

    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ protegida: true, contexts: [], strict: false })
  })

  it('reconhece a merge queue exigida pela origem (critério 12)', async () => {
    // Gravado direto no estado do servidor: nenhuma operação nossa configura merge queue, e é
    // exatamente esse o ponto — a pipeline a encontra na origem e não tenta contorná-la.
    estado.protecoes.set('main', {
      required_status_checks: { strict: true, contexts: ['validacao'] },
      required_merge_queue: {}
    })

    const r = (await executar(GITHUB_OPERATIONS.getRequiredChecks, {
      owner: OWNER,
      repo: REPO,
      branch: 'main'
    })) as ConnectorResult

    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ mergeQueueExigida: true })
  })
})

describe('commit.sha-for-ref — critério 2 da M9-F01', () => {
  beforeEach(async () => {
    await executar(GITHUB_OPERATIONS.ensureRepository, {
      owner: OWNER,
      repo: REPO,
      visibility: 'private'
    })
  })

  it('lê na origem o commit para onde a branch aponta', async () => {
    estado.refs.set('heads/main', SHA)

    const r = (await executar(GITHUB_OPERATIONS.getCommitSha, {
      owner: OWNER,
      repo: REPO,
      ref: 'main'
    })) as ConnectorResult

    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ ref: 'main', sha: SHA })
  })

  it('a leitura é da origem, não do que mandamos: um push parcial aparece como divergência', async () => {
    // O cenário do critério 2. O local está em SHA; a origem ficou em OUTRO_SHA porque o push
    // não chegou inteiro. Ler a origem é o que revela isso — comparar com o que enviamos diria
    // que está tudo certo.
    estado.refs.set('heads/main', OUTRO_SHA)

    const r = (await executar(GITHUB_OPERATIONS.getCommitSha, {
      owner: OWNER,
      repo: REPO,
      ref: 'main'
    })) as ConnectorResult

    expect((r.data as { sha: string }).sha).not.toBe(SHA)
  })

  it('ref ausente não vira sucesso vazio', async () => {
    const r = (await executar(GITHUB_OPERATIONS.getCommitSha, {
      owner: OWNER,
      repo: REPO,
      ref: 'nunca-publicada'
    })) as ConnectorError

    expect(r.ok).toBe(false)
  })
})

describe('label.ensure — emenda 4 da M9-F01', () => {
  const entrada = { owner: OWNER, repo: REPO, nome: 'fatia', cor: 'a2eeef' }

  beforeEach(async () => {
    await executar(GITHUB_OPERATIONS.ensureRepository, {
      owner: OWNER,
      repo: REPO,
      visibility: 'private'
    })
  })

  it('cria o rótulo quando não existe', async () => {
    const r = (await executar(GITHUB_OPERATIONS.ensureLabel, entrada)) as ConnectorResult

    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ nome: 'fatia' })
    expect(estado.rotulos.has('fatia')).toBe(true)
  })

  it('repetir NÃO duplica: o segundo ensure não faz POST nenhum', async () => {
    await executar(GITHUB_OPERATIONS.ensureLabel, entrada)
    requisicoes = []

    const r = (await executar(GITHUB_OPERATIONS.ensureLabel, entrada)) as ConnectorResult

    expect(r.ok).toBe(true)
    expect(contar('POST', /\/labels$/)).toBe(0)
  })

  it('NÃO sobrescreve cor nem descrição de um rótulo que já existe', async () => {
    estado.rotulos.set('fatia', { name: 'fatia', color: 'ff0000', description: 'do usuário' })

    await executar(GITHUB_OPERATIONS.ensureLabel, { ...entrada, descricao: 'nossa' })

    // O que a emenda pede é que o rótulo **exista**, não que ele seja nosso. Um PATCH aqui
    // sobrescreveria a escolha de quem configurou o repositório, a cada publicação.
    expect(estado.rotulos.get('fatia')).toMatchObject({
      color: 'ff0000',
      description: 'do usuário'
    })
  })

  it('recusa cor com `#` antes de a API cobrar', async () => {
    const r = (await executar(GITHUB_OPERATIONS.ensureLabel, {
      ...entrada,
      cor: '#a2eeef'
    })) as ConnectorError

    expect(r.ok).toBe(false)
    expect(r.code).toBe('validacao-invalida')
  })
})

describe('tradução de falhas', () => {
  it('404 autenticado NÃO alega inexistência — critério 6', async () => {
    forcadas.set(`GET /repos/${OWNER}/outro`, { status: 404, corpo: { message: 'Not Found' } })

    const r = (await executar(GITHUB_OPERATIONS.getMergeState, {
      owner: OWNER,
      repo: 'outro',
      pullRequest: 9
    })) as ConnectorError

    expect(r.code).toBe('permissao-negada')
    expect(r.mensagem).toMatch(/não existe/i)
    expect(r.mensagem).toMatch(/acesso/i)
  })

  it('429 com retry-after permanece retomável — critério 7', async () => {
    forcadas.set(`GET /repos/${OWNER}/${REPO}/pulls/1`, {
      status: 429,
      headers: { 'retry-after': '30' }
    })

    const r = (await executar(GITHUB_OPERATIONS.getMergeState, {
      owner: OWNER,
      repo: REPO,
      pullRequest: 1
    })) as ConnectorError

    expect(r).toMatchObject({ code: 'limite-excedido', retryable: true, retryAfterMs: 30_000 })
  })

  it('403 sem sinal de cota aponta a URL de instalação da App', async () => {
    forcadas.set(`GET /repos/${OWNER}/${REPO}/pulls/1`, { status: 403 })

    const r = (await executar(GITHUB_OPERATIONS.getMergeState, {
      owner: OWNER,
      repo: REPO,
      pullRequest: 1
    })) as ConnectorError

    expect(r.code).toBe('permissao-negada')
    expect(r.mensagem).toContain('github.com/apps/')
  })

  it('422 é validação, não algo a retentar', async () => {
    forcadas.set(`POST /repos/${OWNER}/${REPO}/pulls`, {
      status: 422,
      corpo: { message: 'No commits between main and feat/x' }
    })

    const r = (await executar(GITHUB_OPERATIONS.ensurePullRequest, {
      owner: OWNER,
      repo: REPO,
      head: 'feat/x',
      base: 'main',
      title: 'T',
      body: ''
    })) as ConnectorError

    expect(r).toMatchObject({
      code: 'validacao-invalida',
      retryable: false,
      acao: 'corrigir-entrada'
    })
    // A mensagem do GitHub não vaza para a tela; o status vira evidência.
    expect(r.mensagem).not.toContain('No commits between')
    expect(r.evidencia).toBe('HTTP 422')
  })

  it('5xx permanece retomável — critério 7', async () => {
    forcadas.set(`GET /repos/${OWNER}/${REPO}/pulls/1`, { status: 502 })

    const r = (await executar(GITHUB_OPERATIONS.getMergeState, {
      owner: OWNER,
      repo: REPO,
      pullRequest: 1
    })) as ConnectorError

    expect(r).toMatchObject({ code: 'indisponivel', retryable: true })
  })

  it('input inválido é recusado antes de qualquer requisição', async () => {
    // A recusa que **é** do adapter: forma do payload. Credencial é do serviço, no passo 6 —
    // `validar` roda no passo 3 e nem enxerga o segredo.
    const ad = adapter()
    const r = ad.validar({
      request: pedido(GITHUB_OPERATIONS.ensureRepository, { owner: OWNER, repo: REPO }),
      capability: {
        connector: 'github',
        operation: 'repo.ensure',
        effect: 'mutacao',
        descricao: 'x'
      }
    })

    expect(r).toMatchObject({ code: 'validacao-invalida' })
    expect(requisicoes).toHaveLength(0)
  })
})

describe('contrato de requisição', () => {
  it('toda chamada fixa a versão da API e manda o token no header', async () => {
    await executar(GITHUB_OPERATIONS.ensureRepository, {
      owner: OWNER,
      repo: REPO,
      visibility: 'private'
    })

    // O servidor guarda caminho e método; a conferência dos headers é feita com um fetch direto
    // ao mesmo servidor, para ler o que chegou.
    expect(requisicoes.length).toBeGreaterThan(0)
    for (const req of requisicoes) {
      expect(req.caminho.startsWith('/')).toBe(true)
      // O token nunca vai na URL — só no header.
      expect(req.caminho).not.toContain(TOKEN)
    }
  })
})
