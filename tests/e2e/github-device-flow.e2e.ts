import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import electronPath from 'electron'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

/**
 * O Device Flow do GitHub no **app real** (SPEC-Conectores-03, critérios 1, 2, 3, 4 e 8).
 *
 * O que este arquivo prova e nenhuma outra camada prova: que o fluxo está **ligado** no caminho
 * montado — preload real, IPC real, main real, banco real, `safeStorage` real. Os testes de
 * integração provam a regra com um `GithubAuthService` construído à mão; aqui o serviço é o que
 * o `index.ts` compôs no boot, e uma dependência esquecida ali apareceria como um fluxo que a
 * tela abre mas o cofre não recebe.
 *
 * O GitHub é substituído por um **servidor local que conta requisições** (`GITHUB_OAUTH_ORIGIN`)
 * — a decisão de método do PI na M6-F02, que separa "o mock não foi chamado" de "a requisição
 * não saiu". As requisições que chegam são guardadas inteiras, e é sobre elas que o critério 1
 * é verificado: nenhuma carrega `client_secret`.
 *
 * O que este teste **não** faz: falar com o GitHub de verdade. O smoke real contra a API precisa
 * de uma GitHub App registrada, que ainda não existe (decisão do PI de 2026-08-29) — o limite
 * está registrado na entrega.
 */

let app: ElectronApplication
let userData: string
let servidor: Server
let origem: string

/** Toda requisição que chegou ao servidor falso. É a evidência do critério 1. */
let requisicoes: { url: string; corpo: string }[] = []
/** Quantos pollings o app fez — o número que separa "esperou" de "desistiu". */
let pollings = 0
/** Quantas vezes o servidor deve responder `authorization_pending` antes de liberar o token. */
let pendentes = 0

const CLIENT_ID = 'Iv1.client-id-do-e2e'
const ACCESS = 'ghu_access_do_e2e_super_secreto'
const REFRESH = 'ghr_refresh_do_e2e_super_secreto'
const USER_CODE = 'E2ET-CODE'

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'jarvis-e2e-github-'))
  requisicoes = []
  pollings = 0
  pendentes = 1

  servidor = createServer((req, res) => {
    let corpo = ''
    req.on('data', (c: Buffer) => {
      corpo += c.toString('utf8')
    })
    req.on('end', () => {
      requisicoes.push({ url: req.url ?? '', corpo })
      res.writeHead(200, { 'Content-Type': 'application/json' })

      if (req.url === '/login/device/code') {
        res.end(
          JSON.stringify({
            device_code: 'device-code-que-nunca-deve-chegar-a-tela',
            user_code: USER_CODE,
            verification_uri: 'https://github.com/login/device',
            expires_in: 900,
            // Intervalo curto: o teste espera o polling de verdade, e 5s por volta faria o
            // Playwright estourar antes de o fluxo terminar.
            interval: 1
          })
        )
        return
      }

      pollings += 1

      // O primeiro polling responde pendente: é o que prova que o app **espera e repete** em
      // vez de desistir na primeira resposta que não traz token.
      if (pendentes > 0) {
        pendentes -= 1
        res.end(JSON.stringify({ error: 'authorization_pending' }))
        return
      }

      res.end(
        JSON.stringify({
          access_token: ACCESS,
          refresh_token: REFRESH,
          expires_in: 28_800,
          refresh_token_expires_in: 15_897_600,
          token_type: 'bearer'
        })
      )
    })
  })

  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve))
  origem = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`

  // `ELECTRON_RUN_AS_NODE` herdado faz o Electron subir como Node puro (ver `login.e2e.ts`).
  const ambiente = { ...process.env }
  delete ambiente.ELECTRON_RUN_AS_NODE

  app = await electron.launch({
    // `executablePath` e `chromiumSandbox` pelas razões do `login.e2e.ts`: sem eles o loader do
    // Playwright injeta `--password-store=basic`, o `safeStorage` responde false e o boot falha
    // por desenho — que é justamente o que este teste precisa que funcione, já que o cofre é
    // metade do que ele verifica.
    executablePath: electronPath as unknown as string,
    chromiumSandbox: true,
    args: ['.', `--user-data-dir=${userData}`],
    env: {
      ...ambiente,
      NODE_ENV: 'development',
      SUPABASE_URL: '',
      SUPABASE_PUBLISHABLE_KEY: '',
      GITHUB_OAUTH_ORIGIN: origem
    }
  })

  app.process().stderr?.on('data', (c: Buffer) => console.error(`[electron stderr] ${c}`))
})

test.afterEach(async () => {
  // `app.exit()` e não `close()`/`quit()`: os dois travam por causa do tray e dos timers do
  // `winston-daily-rotate-file` (registrado em `login.e2e.ts`).
  await app?.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
  await app?.close().catch(() => undefined)
  await new Promise<void>((resolve) => servidor.close(() => resolve()))

  rmSync(userData, { recursive: true, force: true })
})

/** Configura o `client_id` e roda o fluxo inteiro pela ponte real. */
function autenticar(
  janela: import('@playwright/test').Page,
  clientId: string
): Promise<{ view: unknown; desfecho: unknown; status: unknown }> {
  return janela.evaluate(async (id: string) => {
    const bridge = (
      window as unknown as {
        jarvis: {
          setGithubClientId: (c: string, w: string) => Promise<unknown>
          startGithubAuth: (w: string) => Promise<unknown>
          awaitGithubAuth: (w: string) => Promise<unknown>
          getGithubAuthStatus: (w: string) => Promise<unknown>
        }
      }
    ).jarvis

    await bridge.setGithubClientId(id, 'jarvis')
    const view = await bridge.startGithubAuth('jarvis')
    const desfecho = await bridge.awaitGithubAuth('jarvis')
    const status = await bridge.getGithubAuthStatus('jarvis')

    return { view, desfecho, status }
  }, clientId)
}

test('o Device Flow completa pela ponte real e a credencial fica no cofre', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const { view, desfecho, status } = await autenticar(janela, CLIENT_ID)

  // A tela recebe o código a mostrar — e **só** o que ela precisa mostrar.
  expect(view).toMatchObject({ userCode: USER_CODE })
  expect(JSON.stringify(view)).not.toContain('device-code-que-nunca-deve-chegar-a-tela')

  // O fluxo terminou em sucesso, e o estado persistido diz `present`.
  expect(desfecho).toMatchObject({ estado: 'present', renovavel: true })
  expect(status).toMatchObject({ estado: 'present', clientIdConfigurado: true })

  // Dois pollings: o pendente e o que trouxe o token. Um só significaria que o app desistiu na
  // primeira resposta; três ou mais, que ele não parou ao receber o token.
  expect(pollings).toBe(2)
})

test('nenhuma requisição que saiu do app carrega client_secret', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')
  await autenticar(janela, CLIENT_ID)

  expect(requisicoes.length).toBeGreaterThan(0)
  for (const req of requisicoes) {
    const params = new URLSearchParams(req.corpo)
    expect(params.get('client_secret')).toBeNull()
    expect(params.get('client_assertion')).toBeNull()
    expect(params.get('client_id')).toBe(CLIENT_ID)
  }
})

test('nem token nem refresh token atravessam o IPC', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const { view, desfecho, status } = await autenticar(janela, CLIENT_ID)

  // Serializar tudo que voltou pela ponte e procurar os segredos dentro: um campo novo que os
  // vazasse quebraria isto sem ninguém precisar ter escrito uma asserção sobre ele.
  const tudo = JSON.stringify({ view, desfecho, status })
  expect(tudo).not.toContain(ACCESS)
  expect(tudo).not.toContain(REFRESH)

  // E a ponte não tem por onde pedir o token: não existe método que o devolva.
  const metodos = await janela.evaluate(() =>
    Object.keys(window as unknown as { jarvis: Record<string, unknown> }).length === 0
      ? []
      : Object.keys((window as unknown as { jarvis: Record<string, unknown> }).jarvis)
  )
  expect(metodos.filter((m) => m.toLowerCase().includes('token'))).toEqual([])
})

test('a cadeia de auditoria registra as fases e continua verificável', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')
  await autenticar(janela, CLIENT_ID)

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

  const doGithub = eventos.filter((e) => e.type === 'connector-auth')
  expect(doGithub.map((e) => (e.payload as { fase: string }).fase)).toEqual(
    expect.arrayContaining(['inicio', 'autorizado'])
  )

  // A auditoria não guarda o que não deve: nem código, nem token (ADR-004).
  const auditoria = JSON.stringify(doGithub)
  expect(auditoria).not.toContain(ACCESS)
  expect(auditoria).not.toContain(REFRESH)
  expect(auditoria).not.toContain(USER_CODE)

  expect(cadeia).toMatchObject({ ok: true })
})

test('sem client ID configurado, o fluxo nem sai do app', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const desfecho = await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: { startGithubAuth: (w: string) => Promise<unknown> }
      }
    ).jarvis
    return await bridge.startGithubAuth('jarvis')
  })

  expect(desfecho).toMatchObject({ ok: false, code: 'credencial-ausente' })
  // A recusa é gratuita: nenhuma requisição chegou ao servidor.
  expect(requisicoes).toHaveLength(0)
})

test('logout remove a credencial e o estado volta a missing', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')
  await autenticar(janela, CLIENT_ID)

  const depois = await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: {
          logoutGithub: (w: string) => Promise<unknown>
          getGithubAuthStatus: (w: string) => Promise<unknown>
        }
      }
    ).jarvis

    await bridge.logoutGithub('jarvis')
    return await bridge.getGithubAuthStatus('jarvis')
  })

  expect(depois).toMatchObject({ estado: 'missing', renovavel: false })
})

test('a credencial é escopada por espaço — o NOA não vê a do JARVIS OS', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')
  await autenticar(janela, CLIENT_ID)

  const noNoa = await janela.evaluate(async () => {
    const bridge = (
      window as unknown as {
        jarvis: { getGithubAuthStatus: (w: string) => Promise<unknown> }
      }
    ).jarvis
    return await bridge.getGithubAuthStatus('noa')
  })

  expect(noNoa).toMatchObject({ estado: 'missing' })
})
