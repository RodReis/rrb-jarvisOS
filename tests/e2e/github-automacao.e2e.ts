import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import electronPath from 'electron'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

/**
 * A automação do GitHub no **app real** (SPEC-Conectores-04).
 *
 * O que este arquivo prova e nenhuma outra camada prova: que as nove capacidades estão ligadas no
 * caminho montado — preload real, IPC real, `ConnectorService` real com governança, adapter real.
 * Os testes de integração exercitam o adapter construído à mão; aqui ele é o que o `index.ts`
 * compôs no boot, e uma capacidade declarada mas não registrada apareceria como
 * `capacidade-desconhecida` vinda do próprio núcleo.
 *
 * O GitHub é substituído por um servidor local **com estado e contador de requisições**
 * (`GITHUB_API_ORIGIN`) — a técnica da M6-F02/F03. É o que torna "repetir não duplica" observável
 * de fora: se o `ensure` duplicasse, o recurso apareceria duas vezes no estado do servidor.
 *
 * A credencial entra pelo cofre real, pela ponte real: o Device Flow da F03 roda contra o mesmo
 * servidor, então o token que o adapter usa é o que o app guardou — não um valor injetado no teste.
 */

let app: ElectronApplication
let userData: string
let servidor: Server
let origem: string

/** Estado do GitHub falso, e o contador que sustenta as afirmações de idempotência. */
let issues: { id: number; number: number; title: string; body: string }[] = []
let pulls: {
  number: number
  state: string
  head: { sha: string; ref: string }
  merged: boolean
  merge_commit_sha?: string
}[] = []
let repos = new Set<string>()
let requisicoes: { metodo: string; caminho: string }[] = []

const OWNER = 'RodReis'
const REPO = 'repo-do-e2e'
const SHA = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'
const OUTRO_SHA = 'f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1'
const CLIENT_ID = 'Iv1.client-do-e2e'
const ACCESS = 'ghu_access_do_e2e'

function responder(
  metodo: string,
  caminho: string,
  corpo: Record<string, unknown>
): { status: number; corpo: unknown } {
  const semQuery = caminho.split('?')[0] ?? ''

  // --- Device Flow (F03), para o app autenticar de verdade antes de automatizar ---
  if (semQuery === '/login/device/code') {
    return {
      status: 200,
      corpo: {
        device_code: 'dc-e2e',
        user_code: 'E2E-CODE',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 1
      }
    }
  }
  if (semQuery === '/login/oauth/access_token') {
    return { status: 200, corpo: { access_token: ACCESS, token_type: 'bearer' } }
  }

  // --- REST API ---
  if (metodo === 'GET' && semQuery === '/user') {
    return { status: 200, corpo: { login: OWNER, id: 1, type: 'User' } }
  }

  const repoMatch = /^\/repos\/([^/]+)\/([^/]+)$/.exec(semQuery)
  if (metodo === 'GET' && repoMatch) {
    const chave = `${repoMatch[1]}/${repoMatch[2]}`
    return repos.has(chave)
      ? { status: 200, corpo: { full_name: chave, default_branch: 'main' } }
      : { status: 404, corpo: { message: 'Not Found' } }
  }

  if (metodo === 'POST' && semQuery === '/user/repos') {
    const chave = `${OWNER}/${String(corpo.name)}`
    repos.add(chave)
    return { status: 201, corpo: { full_name: chave, default_branch: 'main' } }
  }

  if (metodo === 'GET' && /\/issues$/.test(semQuery)) return { status: 200, corpo: issues }

  if (metodo === 'POST' && /\/issues$/.test(semQuery)) {
    const numero = issues.length + 1
    const issue = {
      id: 1000 + numero,
      number: numero,
      title: String(corpo.title),
      body: String(corpo.body ?? '')
    }
    issues.push(issue)
    return { status: 201, corpo: issue }
  }

  if (metodo === 'GET' && /\/pulls$/.test(semQuery)) {
    return { status: 200, corpo: pulls.filter((p) => p.state === 'open') }
  }

  if (metodo === 'POST' && /\/pulls$/.test(semQuery)) {
    const numero = pulls.length + 1
    const pr = {
      number: numero,
      state: 'open',
      head: { sha: SHA, ref: String(corpo.head) },
      merged: false,
      // PR aberto tem `merge_commit_sha` de test merge commit — o dado que não pode vazar.
      merge_commit_sha: 'test0000merge0000commit0000sha0000000000'
    }
    pulls.push(pr)
    return { status: 201, corpo: pr }
  }

  const prGet = /\/pulls\/(\d+)$/.exec(semQuery)
  if (metodo === 'GET' && prGet) {
    const pr = pulls.find((p) => p.number === Number(prGet[1]))
    return pr ? { status: 200, corpo: pr } : { status: 404, corpo: { message: 'Not Found' } }
  }

  const merge = /\/pulls\/(\d+)\/merge$/.exec(semQuery)
  if (metodo === 'PUT' && merge) {
    const pr = pulls.find((p) => p.number === Number(merge[1]))
    if (!pr) return { status: 404, corpo: { message: 'Not Found' } }
    if (corpo.sha !== undefined && corpo.sha !== pr.head.sha) {
      return { status: 409, corpo: { message: 'Head branch was modified.' } }
    }
    pr.merged = true
    pr.state = 'closed'
    pr.merge_commit_sha = 'merged0sha000000000000000000000000000000'
    return { status: 200, corpo: { sha: pr.merge_commit_sha, merged: true } }
  }

  if (metodo === 'GET' && /\/check-runs$/.test(semQuery)) {
    return {
      status: 200,
      corpo: {
        check_runs: [
          { name: 'test', head_sha: SHA, status: 'completed', conclusion: 'success' },
          // Um check verde de OUTRO commit: o gate precisa ignorá-lo.
          { name: 'antigo', head_sha: OUTRO_SHA, status: 'completed', conclusion: 'success' }
        ]
      }
    }
  }

  return { status: 404, corpo: { message: 'Not Found' } }
}

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'jarvis-e2e-gh-auto-'))
  issues = []
  pulls = []
  repos = new Set()
  requisicoes = []

  servidor = createServer((req, res) => {
    let cru = ''
    req.on('data', (c: Buffer) => {
      cru += c.toString('utf8')
    })
    req.on('end', () => {
      requisicoes.push({ metodo: req.method ?? '', caminho: req.url ?? '' })

      const tipo = req.headers['content-type'] ?? ''
      let corpo: Record<string, unknown> = {}
      if (cru !== '') {
        corpo = tipo.includes('json')
          ? (JSON.parse(cru) as Record<string, unknown>)
          : Object.fromEntries(new URLSearchParams(cru))
      }

      const r = responder(req.method ?? '', req.url ?? '', corpo)
      res.writeHead(r.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(r.corpo))
    })
  })

  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve))
  origem = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`

  const ambiente = { ...process.env }
  delete ambiente.ELECTRON_RUN_AS_NODE

  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    chromiumSandbox: true,
    args: ['.', `--user-data-dir=${userData}`],
    env: {
      ...ambiente,
      NODE_ENV: 'development',
      SUPABASE_URL: '',
      SUPABASE_PUBLISHABLE_KEY: '',
      // As duas origens: o OAuth da F03 e a REST API da F04 são hosts distintos no GitHub, e
      // aqui os dois apontam ao mesmo servidor local.
      GITHUB_OAUTH_ORIGIN: origem,
      GITHUB_API_ORIGIN: origem
    }
  })

  app.process().stderr?.on('data', (c: Buffer) => console.error(`[electron stderr] ${c}`))
})

test.afterEach(async () => {
  await app?.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
  await app?.close().catch(() => undefined)
  await new Promise<void>((resolve) => servidor.close(() => resolve()))
  rmSync(userData, { recursive: true, force: true })
})

/**
 * Autentica pela ponte real (Device Flow da F03) e devolve a página.
 *
 * A credencial vai para o **cofre real** com `safeStorage` real, e é de lá que o adapter a lê no
 * momento da chamada. Injetar um token no teste provaria menos: o caminho token→cofre→adapter é
 * parte do que esta fatia usa.
 */
async function autenticado(): Promise<import('@playwright/test').Page> {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  await janela.evaluate(async (id: string) => {
    const bridge = (
      window as unknown as {
        jarvis: {
          setGithubClientId: (c: string, w: string) => Promise<unknown>
          startGithubAuth: (w: string) => Promise<unknown>
          awaitGithubAuth: (w: string) => Promise<unknown>
        }
      }
    ).jarvis

    await bridge.setGithubClientId(id, 'jarvis')
    await bridge.startGithubAuth('jarvis')
    await bridge.awaitGithubAuth('jarvis')
  }, CLIENT_ID)

  return janela
}

/** Chama uma capacidade pelo canal real `connectors:invoke`. */
function invocar(
  janela: import('@playwright/test').Page,
  operation: string,
  input: unknown
): Promise<Record<string, unknown>> {
  return janela.evaluate(
    async ([op, entrada]: [string, unknown]) => {
      const bridge = (
        window as unknown as {
          jarvis: { callConnector: (r: unknown, w: string) => Promise<Record<string, unknown>> }
        }
      ).jarvis

      return await bridge.callConnector(
        {
          contractVersion: 1,
          connector: 'github',
          operation: op,
          correlationId: `e2e-${op}`,
          timeoutMs: 15_000,
          idempotencyKey: `idem-${op}`,
          credential: { key: 'github', user_id: 'local', workspace_id: 'jarvis' },
          input: entrada
        },
        'jarvis'
      )
    },
    [operation, input] as [string, unknown]
  )
}

test('as doze capacidades chegam ao renderer pela listagem do núcleo', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  // Filtrado pelo conector: o registro passou a ter Tavily na M6-F05, e este teste é sobre as
  // capacidades **do GitHub**. Sem o filtro, ele quebraria a cada conector novo por um motivo
  // que nada tem a ver com o que afirma.
  const operacoes = await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          listConnectorCapabilities: () => Promise<{ connector: string; operation: string }[]>
        }
      }
    ).jarvis
    return (await bridge.listConnectorCapabilities())
      .filter((c) => c.connector === 'github')
      .map((c) => c.operation)
  })

  expect(operacoes).toEqual([
    'auth.identify',
    'repo.ensure',
    'issue.ensure',
    'issue.ensure-dependency',
    'ref.ensure',
    'pr.ensure',
    'checks.for-head',
    'actions.runs-for-head',
    'pr.squash-merge',
    'pr.merge-state',
    'repo.set-default-branch',
    'branch.ensure-protection',
    'commit.sha-for-ref'
  ])
})

test('repetir ensureIssue pelo app real não duplica a issue', async () => {
  const janela = await autenticado()
  const entrada = {
    owner: OWNER,
    repo: REPO,
    externalKey: 'M6-F04',
    title: 'Fatia 04',
    body: 'Automação idempotente.'
  }

  const primeira = await invocar(janela, 'issue.ensure', entrada)
  const segunda = await invocar(janela, 'issue.ensure', entrada)

  expect(primeira.ok).toBe(true)
  expect(segunda.ok).toBe(true)
  expect((segunda.data as { numero: number }).numero).toBe(
    (primeira.data as { numero: number }).numero
  )

  // O contador é a prova: um POST só, mesmo com duas chamadas.
  const posts = requisicoes.filter((r) => r.metodo === 'POST' && /\/issues$/.test(r.caminho))
  expect(posts).toHaveLength(1)
  expect(issues).toHaveLength(1)
})

test('repetir ensureRepository pelo app real não cria um segundo repositório', async () => {
  const janela = await autenticado()
  const entrada = { owner: OWNER, repo: REPO, visibility: 'private' }

  await invocar(janela, 'repo.ensure', entrada)
  await invocar(janela, 'repo.ensure', entrada)

  expect(requisicoes.filter((r) => r.caminho === '/user/repos')).toHaveLength(1)
  expect(repos.size).toBe(1)
})

test('o merge exige o head esperado, e o head divergente é barrado', async () => {
  const janela = await autenticado()
  await invocar(janela, 'pr.ensure', {
    owner: OWNER,
    repo: REPO,
    head: 'feat/x',
    base: 'main',
    title: 'T',
    body: ''
  })

  const barrado = await invocar(janela, 'pr.squash-merge', {
    owner: OWNER,
    repo: REPO,
    pullRequest: 1,
    expectedHeadSha: OUTRO_SHA
  })

  expect(barrado.ok).toBe(false)
  expect(barrado.code).toBe('validacao-invalida')
  expect(pulls[0]?.merged).toBe(false)

  const mergeado = await invocar(janela, 'pr.squash-merge', {
    owner: OWNER,
    repo: REPO,
    pullRequest: 1,
    expectedHeadSha: SHA
  })

  expect(mergeado.ok).toBe(true)
  expect((mergeado.data as { mergeSha: string }).mergeSha).toBe(
    'merged0sha000000000000000000000000000000'
  )
})

test('merge sem expectedHeadSha é recusado antes de sair do app', async () => {
  const janela = await autenticado()
  await invocar(janela, 'pr.ensure', {
    owner: OWNER,
    repo: REPO,
    head: 'feat/x',
    base: 'main',
    title: 'T',
    body: ''
  })

  const antes = requisicoes.filter((r) => r.metodo === 'PUT').length
  const r = await invocar(janela, 'pr.squash-merge', { owner: OWNER, repo: REPO, pullRequest: 1 })

  expect(r.ok).toBe(false)
  expect(r.code).toBe('validacao-invalida')
  // Nenhuma requisição de merge saiu: a recusa é gratuita.
  expect(requisicoes.filter((x) => x.metodo === 'PUT')).toHaveLength(antes)
})

test('os checks vêm normalizados e o de outro commit é distinguível pelo SHA', async () => {
  const janela = await autenticado()

  const r = await invocar(janela, 'checks.for-head', { owner: OWNER, repo: REPO, sha: SHA })

  expect(r.ok).toBe(true)
  const checks = r.data as { nome: string; headSha: string }[]
  expect(checks).toHaveLength(2)
  // O gate distingue pelo SHA, e o dado que chega ao renderer carrega essa informação — sem ela,
  // um check verde de outro commit pareceria aprovar este.
  expect(checks.filter((c) => c.headSha === SHA)).toHaveLength(1)
  expect(checks.filter((c) => c.headSha === OUTRO_SHA)).toHaveLength(1)
})

test('PR aberto não devolve mergeSha ao renderer', async () => {
  const janela = await autenticado()
  await invocar(janela, 'pr.ensure', {
    owner: OWNER,
    repo: REPO,
    head: 'feat/x',
    base: 'main',
    title: 'T',
    body: ''
  })

  const r = await invocar(janela, 'pr.merge-state', { owner: OWNER, repo: REPO, pullRequest: 1 })

  expect((r.data as { merged: boolean }).merged).toBe(false)
  // O test merge commit não pode atravessar o IPC como se fosse o merge real.
  expect(JSON.stringify(r.data)).not.toContain('test0000merge')
})

test('a chamada é auditada e a cadeia continua verificável', async () => {
  const janela = await autenticado()
  await invocar(janela, 'repo.ensure', { owner: OWNER, repo: REPO, visibility: 'private' })

  const { eventos, cadeia } = await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          listAuditEvents: () => Promise<{ type: string; payload?: unknown }[]>
          verifyAuditChain: () => Promise<unknown>
        }
      }
    ).jarvis
    return { eventos: await bridge.listAuditEvents(), cadeia: await bridge.verifyAuditChain() }
  })

  const chamadas = eventos.filter((e) => e.type === 'connector-call')
  expect(chamadas.length).toBeGreaterThanOrEqual(2)
  expect(JSON.stringify(chamadas)).toContain('repo.ensure')
  // O token nunca entra na auditoria (ADR-004).
  expect(JSON.stringify(eventos)).not.toContain(ACCESS)

  expect(cadeia).toMatchObject({ ok: true })
})
