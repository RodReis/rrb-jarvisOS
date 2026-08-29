/**
 * O Device Flow contra o SQLite real (SPEC-Conectores-03, categoria Banco).
 *
 * Prova os critérios **pelo efeito**, não pela intenção — a mesma disciplina de
 * `credential-vault.int-spec.ts`:
 *
 * - "nenhum segredo de servidor é distribuído" (crit. 1): as requisições que saíram são
 *   inspecionadas campo a campo, e nenhuma carrega `client_secret`.
 * - "token nunca chega ao renderer" (crit. 2): o snapshot é serializado e o token procurado
 *   dentro do JSON. Um campo novo que vazasse o token quebraria isto, mesmo sem ninguém lembrar
 *   de escrever uma asserção sobre ele.
 * - "polling termina" (crit. 3): cada desfecho é exercitado com um servidor falso que conta
 *   requisições — é o número de chamadas que separa "esperou" de "desistiu".
 * - "refresh substitui atomicamente" (crit. 4): o refresh que falha deixa o cofre com o par
 *   **antigo inteiro**, não meio-escrito.
 *
 * A cifra é dublada pelo mesmo motivo e da mesma forma que no vault: `safeStorage` real exige o
 * Electron rodando. O que a dublagem substitui é o algoritmo, não o caminho.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn(),
  writeLog: vi.fn()
}))

const { openDatabase } = await import('../../storage/database')
const { AuditRepository } = await import('../../storage/audit-repository')
const { CredentialRepository } = await import('../../credentials/credential-repository')
const { GithubAuthService, GITHUB_VAULT_KEY } = await import('./github-auth-service')

/** XOR + base64, como no teste do vault: o byte gravado nunca é o byte original. */
const MASCARA = 0x5a
const cipherFalso = {
  encrypt(plaintext: string): Buffer {
    return Buffer.from(Buffer.from(plaintext, 'utf8').map((b) => b ^ MASCARA))
  },
  decrypt(ciphertext: Buffer): string {
    return Buffer.from(ciphertext.map((b) => b ^ MASCARA)).toString('utf8')
  }
}

const CTX = { userId: 'u-1', workspace: 'jarvis' as const }
const CLIENT_ID = 'Iv1.cliente-de-teste'
const ACCESS = 'ghu_access_token_super_secreto'
const REFRESH = 'ghr_refresh_token_super_secreto'
const AGORA = Date.parse('2026-08-29T12:00:00.000Z')

/** Uma resposta de `fetch` dublada, com só o que o serviço lê. */
function resposta(corpo: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => corpo,
    headers: new Headers()
  } as Response
}

let dir: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let credentials: InstanceType<typeof CredentialRepository>
/** Toda requisição que saiu — é sobre esta lista que o critério 1 é verificado. */
let requisicoes: { url: string; body: URLSearchParams }[]
let esperas: number[]

function servico(
  respostas: unknown[],
  opcoes: { clientId?: string; agora?: () => number } = {}
): InstanceType<typeof GithubAuthService> {
  let i = 0
  return new GithubAuthService(
    credentials,
    audit,
    () => opcoes.clientId ?? CLIENT_ID,
    async (url, init) => {
      requisicoes.push({
        url,
        body: new URLSearchParams(typeof init.body === 'string' ? init.body : '')
      })
      const proxima = respostas[Math.min(i, respostas.length - 1)]
      i += 1
      if (proxima instanceof Error) throw proxima
      return resposta(proxima)
    },
    async (ms) => {
      esperas.push(ms)
    },
    opcoes.agora ?? (() => AGORA)
  )
}

const GRANT_OK = {
  device_code: 'dc-de-teste',
  user_code: 'WDJB-MJHT',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 5
}

const TOKEN_OK = {
  access_token: ACCESS,
  refresh_token: REFRESH,
  expires_in: 28_800,
  refresh_token_expires_in: 15_897_600,
  token_type: 'bearer'
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-github-auth-'))
  db = openDatabase(join(dir, 'app.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  credentials = new CredentialRepository(db, cipherFalso)
  requisicoes = []
  esperas = []
  logCat.info.mockClear()
  logCat.warn.mockClear()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('Device Flow — do código ao cofre', () => {
  it('abre o fluxo, autoriza e grava o payload estruturado cifrado', async () => {
    const service = servico([GRANT_OK, TOKEN_OK])

    const view = await service.iniciar(CTX)
    expect(view).toMatchObject({ userCode: 'WDJB-MJHT' })

    const snapshot = await service.aguardarAutorizacao(CTX)
    expect(snapshot).toMatchObject({ estado: 'present', renovavel: true })

    // Critério 8: o payload é estruturado, e as três partes estão numa linha só.
    const guardado = credentials.readPayload<{ accessToken: string; refreshToken: string }>(
      CTX.userId,
      CTX.workspace,
      GITHUB_VAULT_KEY
    )
    expect(guardado).toMatchObject({ accessToken: ACCESS, refreshToken: REFRESH })

    // `expires_at` legível **sem decifrar** — é o que a coluna existe para permitir.
    const prazo = db
      .prepare('SELECT expires_at FROM credential_ref WHERE user_id = ? AND key = ?')
      .get(CTX.userId, GITHUB_VAULT_KEY) as { expires_at: string }
    expect(prazo.expires_at).toBe(new Date(AGORA + 28_800_000).toISOString())
  })

  it('o disco não contém o token em claro', async () => {
    const service = servico([GRANT_OK, TOKEN_OK])
    await service.iniciar(CTX)
    await service.aguardarAutorizacao(CTX)

    const bytes = db
      .prepare('SELECT secret FROM credential_ref WHERE user_id = ? AND key = ?')
      .get(CTX.userId, GITHUB_VAULT_KEY) as { secret: Buffer }

    expect(bytes.secret.toString('utf8')).not.toContain(ACCESS)
    expect(bytes.secret.toString('utf8')).not.toContain(REFRESH)
  })

  it('nenhuma requisição carrega client_secret — critério 1', async () => {
    const service = servico([GRANT_OK, TOKEN_OK])
    await service.iniciar(CTX)
    await service.aguardarAutorizacao(CTX)

    expect(requisicoes.length).toBeGreaterThan(0)
    for (const req of requisicoes) {
      expect(req.body.get('client_secret')).toBeNull()
      expect(req.body.get('client_assertion')).toBeNull()
      expect([...req.body.keys()].join(',')).not.toContain('secret')
    }
  })

  it('o snapshot serializado não contém token nem refresh token — critério 2', async () => {
    const service = servico([GRANT_OK, TOKEN_OK])
    await service.iniciar(CTX)
    const snapshot = await service.aguardarAutorizacao(CTX)

    // Serializar e procurar dentro é o que pega um campo novo que ninguém lembrou de checar.
    const json = JSON.stringify(snapshot)
    expect(json).not.toContain(ACCESS)
    expect(json).not.toContain(REFRESH)
  })

  it('a view do fluxo não expõe o device_code — só o que o usuário digita', async () => {
    const service = servico([GRANT_OK])
    const view = await service.iniciar(CTX)

    expect(JSON.stringify(view)).not.toContain('dc-de-teste')
    expect(JSON.stringify(view)).toContain('WDJB-MJHT')
  })
})

describe('Polling — as quatro saídas do critério 3', () => {
  it('authorization_pending espera e repete até o token chegar', async () => {
    const service = servico([
      GRANT_OK,
      { error: 'authorization_pending' },
      { error: 'authorization_pending' },
      TOKEN_OK
    ])

    await service.iniciar(CTX)
    const snapshot = await service.aguardarAutorizacao(CTX)

    expect(snapshot).toMatchObject({ estado: 'present' })
    // Três pollings: dois pendentes e o que trouxe o token — mais a abertura do fluxo.
    expect(requisicoes).toHaveLength(4)
    expect(esperas).toEqual([5_000, 5_000, 5_000])
  })

  it('slow_down aumenta a espera de verdade, não só na decisão', async () => {
    const service = servico([GRANT_OK, { error: 'slow_down' }, { error: 'slow_down' }, TOKEN_OK])

    await service.iniciar(CTX)
    await service.aguardarAutorizacao(CTX)

    // A terceira espera parte do intervalo já dobrado; recomeçar do inicial seria [5, 10, 5].
    expect(esperas).toEqual([5_000, 10_000, 15_000])
  })

  it('expired_token termina o polling e não grava nada', async () => {
    const service = servico([GRANT_OK, { error: 'expired_token' }])

    await service.iniciar(CTX)
    const desfecho = await service.aguardarAutorizacao(CTX)

    expect(desfecho).toMatchObject({ ok: false, code: 'credencial-ausente', acao: 'reautenticar' })
    expect(credentials.find(CTX.userId, CTX.workspace, GITHUB_VAULT_KEY)).toBeUndefined()
  })

  it('access_denied termina como cancelado', async () => {
    const service = servico([GRANT_OK, { error: 'access_denied' }])

    await service.iniciar(CTX)
    expect(await service.aguardarAutorizacao(CTX)).toMatchObject({ ok: false, code: 'cancelado' })
  })

  it('grant vencido termina antes de gastar requisição — o relógio já sabe', async () => {
    let relogio = AGORA
    const service = servico([GRANT_OK, TOKEN_OK], { agora: () => relogio })

    await service.iniciar(CTX)
    expect(requisicoes).toHaveLength(1)

    relogio = AGORA + 900_001
    const desfecho = await service.aguardarAutorizacao(CTX)

    expect(desfecho).toMatchObject({ ok: false, code: 'credencial-ausente' })
    // Nenhuma requisição de polling saiu: a expiração é conferida antes de perguntar.
    expect(requisicoes).toHaveLength(1)
  })

  it('cancelar termina o polling por vontade do usuário', async () => {
    const service = servico([GRANT_OK, { error: 'authorization_pending' }])

    await service.iniciar(CTX)
    // Cancela antes de aguardar: o topo do laço observa o `aborted` na primeira volta.
    service.cancelar(CTX)

    const desfecho = await service.aguardarAutorizacao(CTX)
    expect(desfecho).toMatchObject({ ok: false, code: 'cancelado' })
    expect(requisicoes).toHaveLength(1)
  })

  it('aguardar sem fluxo aberto recusa em vez de girar', async () => {
    const service = servico([TOKEN_OK])
    expect(await service.aguardarAutorizacao(CTX)).toMatchObject({
      ok: false,
      code: 'validacao-invalida'
    })
  })

  it('sem client_id configurado, o fluxo nem abre', async () => {
    const service = servico([GRANT_OK], { clientId: '' })

    const desfecho = await service.iniciar(CTX)
    expect(desfecho).toMatchObject({ ok: false, code: 'credencial-ausente' })
    // A recusa é gratuita: nenhuma requisição saiu.
    expect(requisicoes).toHaveLength(0)
  })
})

describe('Renovação — critérios 4 e 5', () => {
  async function autenticar(expiresIn: number): Promise<void> {
    const service = servico([GRANT_OK, { ...TOKEN_OK, expires_in: expiresIn }])
    await service.iniciar(CTX)
    await service.aguardarAutorizacao(CTX)
    requisicoes = []
    esperas = []
  }

  it('token com folga é usado sem renovar', async () => {
    await autenticar(28_800)
    const service = servico([])

    expect(await service.tokenParaUso(CTX)).toBe(ACCESS)
    expect(requisicoes).toHaveLength(0)
  })

  it('token dentro da margem é renovado antes do uso, e o par novo substitui o antigo', async () => {
    await autenticar(30) // vence em 30s: dentro da margem de 60s
    const novo = { ...TOKEN_OK, access_token: 'ghu_novo', refresh_token: 'ghr_novo' }
    const service = servico([novo])

    expect(await service.tokenParaUso(CTX)).toBe('ghu_novo')

    const guardado = credentials.readPayload<{ accessToken: string; refreshToken: string }>(
      CTX.userId,
      CTX.workspace,
      GITHUB_VAULT_KEY
    )
    // Os dois trocaram juntos: um refresh novo com access antigo (ou o contrário) seria a
    // credencial meio-escrita que a escrita única existe para impedir.
    expect(guardado).toMatchObject({ accessToken: 'ghu_novo', refreshToken: 'ghr_novo' })
  })

  it('o refresh não manda client_secret — critério 1 também na renovação', async () => {
    await autenticar(30)
    const service = servico([{ ...TOKEN_OK, access_token: 'ghu_novo' }])
    await service.tokenParaUso(CTX)

    expect(requisicoes).toHaveLength(1)
    expect(requisicoes[0]?.body.get('grant_type')).toBe('refresh_token')
    expect(requisicoes[0]?.body.get('client_secret')).toBeNull()
  })

  it('refresh que falha deixa a credencial antiga inteira — não meio-escrita', async () => {
    await autenticar(30)
    const service = servico([new Error('rede caiu')])

    await service.tokenParaUso(CTX)

    const guardado = credentials.readPayload<{ accessToken: string; refreshToken: string }>(
      CTX.userId,
      CTX.workspace,
      GITHUB_VAULT_KEY
    )
    expect(guardado).toMatchObject({ accessToken: ACCESS, refreshToken: REFRESH })
  })

  it('refresh recusado pelo GitHub deixa a credencial antiga inteira', async () => {
    // Distinto do teste anterior: lá a **rede caiu** (exceção, caminho do `catch`); aqui o
    // GitHub **respondeu** recusando o refresh token (`bad_refresh_token`), que é o caminho do
    // `novo === undefined`. Os dois precisam preservar o cofre, e um teste só cobria um deles —
    // o contrafactual que apagava a credencial nesse ramo passou despercebido até aparecer aqui.
    await autenticar(30)
    const service = servico([{ error: 'bad_refresh_token' }])

    await service.tokenParaUso(CTX)

    const guardado = credentials.readPayload<{ accessToken: string; refreshToken: string }>(
      CTX.userId,
      CTX.workspace,
      GITHUB_VAULT_KEY
    )
    expect(guardado).toMatchObject({ accessToken: ACCESS, refreshToken: REFRESH })
  })

  it('refresh falho com token ainda válido devolve o que há em vez de bloquear', async () => {
    // Vence em 30s (dentro da margem, mas ainda no futuro): barrar aqui transformaria um
    // problema temporário do refresh numa indisponibilidade que o usuário não causou.
    await autenticar(30)
    const service = servico([new Error('rede caiu')])

    expect(await service.tokenParaUso(CTX)).toBe(ACCESS)
  })

  it('token já vencido com refresh falho não é usado', async () => {
    let relogio = AGORA
    const service = servico([GRANT_OK, { ...TOKEN_OK, expires_in: 60 }], { agora: () => relogio })
    await service.iniciar(CTX)
    await service.aguardarAutorizacao(CTX)

    relogio = AGORA + 120_000
    const comFalha = servico([new Error('rede caiu')], { agora: () => relogio })

    expect(await comFalha.tokenParaUso(CTX)).toBeUndefined()
  })

  it('sem credencial nenhuma, não há token e não há requisição', async () => {
    const service = servico([])
    expect(await service.tokenParaUso(CTX)).toBeUndefined()
    expect(requisicoes).toHaveLength(0)
  })
})

describe('Estado e logout', () => {
  it('sem credencial, o estado é missing', () => {
    expect(servico([]).snapshot(CTX)).toMatchObject({ estado: 'missing', renovavel: false })
  })

  it('credencial vencida aparece como expirado, não como missing', async () => {
    let relogio = AGORA
    const service = servico([GRANT_OK, { ...TOKEN_OK, expires_in: 60 }], { agora: () => relogio })
    await service.iniciar(CTX)
    await service.aguardarAutorizacao(CTX)

    relogio = AGORA + 120_000
    expect(servico([], { agora: () => relogio }).snapshot(CTX)).toMatchObject({
      estado: 'expirado',
      renovavel: true
    })
  })

  it('logout remove a credencial e volta a missing', async () => {
    const service = servico([GRANT_OK, TOKEN_OK])
    await service.iniciar(CTX)
    await service.aguardarAutorizacao(CTX)

    expect(service.logout(CTX)).toMatchObject({ estado: 'missing' })
    expect(credentials.find(CTX.userId, CTX.workspace, GITHUB_VAULT_KEY)).toBeUndefined()
  })

  it('a credencial é escopada por espaço — o NOA não vê a do JARVIS OS', async () => {
    const service = servico([GRANT_OK, TOKEN_OK])
    await service.iniciar(CTX)
    await service.aguardarAutorizacao(CTX)

    const noNoa = servico([]).snapshot({ userId: CTX.userId, workspace: 'noa' })
    expect(noNoa.estado).toBe('missing')
  })
})

describe('Auditoria', () => {
  it('registra as fases sem jamais gravar código ou token', async () => {
    const service = servico([GRANT_OK, TOKEN_OK])
    await service.iniciar(CTX)
    await service.aguardarAutorizacao(CTX)
    service.logout(CTX)

    const eventos = audit.list(CTX.userId).filter((e) => e.type === 'connector-auth')
    expect(eventos.map((e) => (e.payload as { fase: string }).fase)).toEqual(
      expect.arrayContaining(['inicio', 'autorizado', 'logout'])
    )

    const tudo = JSON.stringify(eventos)
    expect(tudo).not.toContain(ACCESS)
    expect(tudo).not.toContain(REFRESH)
    expect(tudo).not.toContain('dc-de-teste')
    expect(tudo).not.toContain('WDJB-MJHT')
  })

  it('a cadeia continua verificável depois do fluxo', async () => {
    const service = servico([GRANT_OK, TOKEN_OK])
    await service.iniciar(CTX)
    await service.aguardarAutorizacao(CTX)

    expect(audit.verify(CTX.userId)).toMatchObject({ ok: true })
  })
})
