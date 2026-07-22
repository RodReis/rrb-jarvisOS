/**
 * Fluxo de autenticação ponta a ponta contra o SQLite real (categoria "Banco").
 *
 * Prova os critérios 2, 3, 5 e 8 da SPEC-Fundacao-03 sem rede: o Supabase entra dublado,
 * porque o que está sob teste é o comportamento **local-first** — o que o app faz com a
 * sessão depois que o provedor respondeu, que é justamente o que precisa valer offline.
 *
 * O que não está aqui: o fluxo feliz de ponta a ponta com janela real, que é o E2E
 * Playwright-Electron (critério 9), e a cifra do `safeStorage`, exercitada em
 * `token-vault.spec.ts` — aqui o cofre é o dublê em memória.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database as Db } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OFFLINE_SESSION_MAX_DAYS, type AuthSnapshot } from '@shared/contracts/auth'

const logCat = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { openDatabase } = await import('../storage/database')
const { AuditRepository } = await import('../storage/audit-repository')
const { SessionRepository, UserProfileRepository } = await import('../storage/repositories')
const { AuthService } = await import('./auth-service')
const { startLoopbackServer } = await import('./loopback-server')
import type { StoredTokens, TokenVault } from './token-vault'

const MS_POR_DIA = 24 * 60 * 60 * 1000

/** Tokens de teste. Valores reconhecíveis para o teste de redaction poder procurá-los. */
const ACCESS_TOKEN = 'access-token-secreto-abc123'
const REFRESH_TOKEN = 'refresh-token-secreto-xyz789'

const SESSAO_SUPABASE = {
  access_token: ACCESS_TOKEN,
  refresh_token: REFRESH_TOKEN,
  expires_at: 1_800_000_000,
  user: {
    id: 'u-google-1',
    email: 'rodrigo@example.com',
    user_metadata: { full_name: 'Rodrigo Reis' }
  }
}

/** Cofre em memória: o teste da cifra real vive em `token-vault.spec.ts`. */
class CofreEmMemoria implements TokenVault {
  private tokens: StoredTokens | undefined

  read(): StoredTokens | undefined {
    return this.tokens
  }
  write(tokens: StoredTokens): void {
    this.tokens = tokens
  }
  clear(): void {
    this.tokens = undefined
  }
}

let dir: string
let db: Db
let audit: InstanceType<typeof AuditRepository>
let profiles: InstanceType<typeof UserProfileRepository>
let sessions: InstanceType<typeof SessionRepository>
let vault: CofreEmMemoria
let agora: Date
let transicoes: unknown[]

/** Dublê do Supabase que devolve uma sessão válida sem tocar a rede. */
function supabaseDublado(overrides: Record<string, unknown> = {}): never {
  return {
    auth: {
      signInWithOAuth: vi.fn().mockResolvedValue({
        data: { url: 'https://accounts.google.com/o/oauth2/v2/auth?fake=1' },
        error: null
      }),
      exchangeCodeForSession: vi.fn().mockResolvedValue({
        data: { session: SESSAO_SUPABASE },
        error: null
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      ...overrides
    }
  } as never
}

function criarServico(supabase = supabaseDublado()): InstanceType<typeof AuthService> {
  return new AuthService({
    supabase,
    vault,
    audit,
    profiles,
    sessions,
    openExternal: vi.fn().mockResolvedValue(undefined),
    onChange: (snapshot) => transicoes.push(snapshot),
    now: () => agora
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-auth-'))
  db = openDatabase(join(dir, 'teste.db'))
  audit = new AuditRepository(db, 'chave-de-teste')
  profiles = new UserProfileRepository(db)
  sessions = new SessionRepository(db)
  vault = new CofreEmMemoria()
  agora = new Date('2026-07-22T12:00:00.000Z')
  transicoes = []
  logCat.info.mockClear()
  logCat.warn.mockClear()
  logCat.error.mockClear()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Grava a sessão como um login bem-sucedido teria feito, sem passar pelo OAuth. */
function semearSessaoAtiva(diasAtras = 0): void {
  const autenticadoEm = new Date(agora.getTime() - diasAtras * MS_POR_DIA)
  const expiraEm = new Date(autenticadoEm.getTime() + OFFLINE_SESSION_MAX_DAYS * MS_POR_DIA)

  profiles.save({
    id: SESSAO_SUPABASE.user.id,
    name: 'Rodrigo Reis',
    email: SESSAO_SUPABASE.user.email,
    locale: 'pt-BR',
    theme: 'sistema'
  })

  sessions.save({
    id: 'sessao-1',
    user_id: SESSAO_SUPABASE.user.id,
    expires_at: expiraEm.toISOString(),
    last_online_auth_at: autenticadoEm.toISOString(),
    created_at: autenticadoEm.toISOString()
  })

  vault.write({
    accessToken: ACCESS_TOKEN,
    refreshToken: REFRESH_TOKEN,
    expiresAt: SESSAO_SUPABASE.expires_at
  })
}

describe('AuthService — login (critérios 1 e 5)', () => {
  /**
   * Dirige o fluxo real: dispara `login()`, espera o navegador ser "aberto" e então bate
   * no loopback com o código, como o Google faria. Exercita servidor, troca e persistência
   * de ponta a ponta — só o Supabase é dublado.
   */
  async function loginDirigido(query: string): Promise<AuthSnapshot> {
    // O `redirectTo` que o serviço passa ao Supabase é a porta do loopback; guardá-lo é
    // o que permite ao dublê do navegador bater de volta como o Google faria.
    let redirectCapturado = ''

    const abrirNavegador = vi.fn(async () => {
      await fetch(`${redirectCapturado}/${query}`)
    })

    const supabase = supabaseDublado({
      signInWithOAuth: vi.fn((opcoes: { options: { redirectTo: string } }) => {
        redirectCapturado = opcoes.options.redirectTo
        return Promise.resolve({
          data: { url: `https://accounts.google.com/o/oauth2/v2/auth?fake=1` },
          error: null
        })
      })
    })

    const servico = new AuthService({
      supabase,
      vault,
      audit,
      profiles,
      sessions,
      openExternal: abrirNavegador,
      onChange: (snapshot) => transicoes.push(snapshot),
      now: () => agora
    })

    return await servico.login()
  }

  it('conclui o login, persiste a sessão e expõe nome e e-mail', async () => {
    const snapshot = await loginDirigido('?code=codigo-de-teste')

    expect(snapshot.state).toBe('ativo')
    expect(snapshot.profile?.name).toBe('Rodrigo Reis')
    expect(snapshot.profile?.email).toBe('rodrigo@example.com')

    // Sessão e cofre gravados: é o que faz o relançamento offline funcionar depois.
    expect(sessions.findActive(SESSAO_SUPABASE.user.id)).toBeDefined()
    expect(vault.read()?.refreshToken).toBe(REFRESH_TOKEN)
  })

  it('audita o login com o user_id da sessão (critério 5)', async () => {
    await loginDirigido('?code=codigo-de-teste')

    const eventos = audit.list(SESSAO_SUPABASE.user.id)
    const login = eventos.find((e) => e.type === 'login')

    expect(login).toBeDefined()
    expect(login?.user_id).toBe(SESSAO_SUPABASE.user.id)
    expect(login?.created_at).toBeTruthy()
    // Auditoria não é lugar de credencial: o payload não pode carregar o token.
    expect(JSON.stringify(login?.payload)).not.toContain(ACCESS_TOKEN)
  })

  it('a janela offline expira 30 dias após o login (ADR-001)', async () => {
    const snapshot = await loginDirigido('?code=codigo-de-teste')

    const esperado = new Date(agora.getTime() + OFFLINE_SESSION_MAX_DAYS * MS_POR_DIA)
    expect(snapshot.expiresAt).toBe(esperado.toISOString())
  })

  it('vira erro com mensagem de UI quando o provedor recusa (critério 6)', async () => {
    const snapshot = await loginDirigido('?error=access_denied')

    expect(snapshot.state).toBe('erro')
    expect(snapshot.mensagem).toBeTruthy()
    // Sem stack trace e sem jargão do provedor vazando para a tela.
    expect(snapshot.mensagem).not.toContain('access_denied')
    expect(snapshot.mensagem).not.toMatch(/\bat\s+\w+\./)
  })
})

describe('AuthService — relançamento offline (critério 2)', () => {
  it('entra direto com sessão cacheada válida, sem tocar a rede', async () => {
    semearSessaoAtiva(3)

    // Supabase que estoura se for chamado: prova que a restauração é 100% local.
    const service = criarServico(
      supabaseDublado({
        signInWithOAuth: vi.fn().mockRejectedValue(new Error('não deveria chamar a rede')),
        exchangeCodeForSession: vi.fn().mockRejectedValue(new Error('não deveria chamar a rede'))
      })
    )

    const snapshot = await service.restaurar()

    expect(snapshot.state).toBe('ativo')
    expect(snapshot.profile?.email).toBe('rodrigo@example.com')
  })

  it('audita login-offline-reuse ao reusar a sessão (critério 5)', async () => {
    semearSessaoAtiva(3)
    await criarServico().restaurar()

    const eventos = audit.list(SESSAO_SUPABASE.user.id)
    expect(eventos.map((e) => e.type)).toContain('login-offline-reuse')
  })

  it('exige novo login depois dos 30 dias, mesmo com token no disco', async () => {
    // Autenticado há 31 dias: fora da janela do ADR-001.
    semearSessaoAtiva(OFFLINE_SESSION_MAX_DAYS + 1)

    const snapshot = await criarServico().restaurar()

    expect(snapshot.state).toBe('sessao-expirada')
    // O cofre é limpo: sessão vencida não deixa credencial de longa duração no disco.
    expect(vault.read()).toBeUndefined()
  })

  it('mantém a sessão no último dia da janela (limite inclusivo)', async () => {
    semearSessaoAtiva(OFFLINE_SESSION_MAX_DAYS - 1)

    const snapshot = await criarServico().restaurar()

    expect(snapshot.state).toBe('ativo')
  })

  it('trata cofre sem metadados de sessão como deslogado', async () => {
    // Cofre com token mas sem linha em `session`: estado inconsistente.
    vault.write({ accessToken: 'a', refreshToken: 'b', expiresAt: 1 })

    const snapshot = await criarServico().restaurar()

    expect(snapshot.state).toBe('deslogado')
    expect(vault.read()).toBeUndefined()
  })
})

describe('AuthService — logout (critério 3)', () => {
  it('apaga tokens, metadados e audita, voltando para deslogado', async () => {
    semearSessaoAtiva()
    const service = criarServico()
    await service.restaurar()

    const snapshot = await service.logout()

    expect(snapshot.state).toBe('deslogado')
    expect(snapshot.profile).toBeUndefined()
    expect(vault.read()).toBeUndefined()
    expect(sessions.findActive(SESSAO_SUPABASE.user.id)).toBeUndefined()
    expect(audit.list(SESSAO_SUPABASE.user.id).map((e) => e.type)).toContain('logout')
  })

  it('limpa o estado local mesmo quando a revogação online falha', async () => {
    semearSessaoAtiva()
    const service = criarServico(
      supabaseDublado({
        signOut: vi.fn().mockRejectedValue(new Error('fetch failed'))
      })
    )
    await service.restaurar()

    const snapshot = await service.logout()

    // O usuário pediu para sair: ficar preso numa sessão por falta de rede seria o pior
    // resultado possível numa máquina compartilhada.
    expect(snapshot.state).toBe('deslogado')
    expect(vault.read()).toBeUndefined()
  })
})

describe('AuthService — logging da categoria auth (critério 8)', () => {
  it('não grava token nem refresh token em nenhum registro de log', async () => {
    semearSessaoAtiva()
    const service = criarServico()

    await service.restaurar()
    await service.logout()

    // Varre tudo que foi logado — mensagem e contexto — atrás dos segredos.
    const tudoQueFoiLogado = JSON.stringify([
      ...logCat.info.mock.calls,
      ...logCat.warn.mock.calls,
      ...logCat.error.mock.calls
    ])

    expect(tudoQueFoiLogado).not.toContain(ACCESS_TOKEN)
    expect(tudoQueFoiLogado).not.toContain(REFRESH_TOKEN)
  })

  it('emite info nas transições do fluxo feliz', async () => {
    semearSessaoAtiva()
    await criarServico().restaurar()

    expect(logCat.info).toHaveBeenCalled()
  })
})

describe('servidor loopback', () => {
  it('atende em 127.0.0.1 e devolve o code da query string', async () => {
    const handle = await startLoopbackServer(5000)

    try {
      expect(handle.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

      const resposta = await fetch(`${handle.redirectUri}/?code=abc-123`)
      expect(resposta.ok).toBe(true)

      await expect(handle.resultado).resolves.toEqual({ code: 'abc-123', error: undefined })
    } finally {
      handle.close()
    }
  })

  it('propaga o erro devolvido pelo provedor', async () => {
    const handle = await startLoopbackServer(5000)

    try {
      await fetch(`${handle.redirectUri}/?error=access_denied`)
      await expect(handle.resultado).resolves.toEqual({
        code: undefined,
        error: 'access_denied'
      })
    } finally {
      handle.close()
    }
  })
})
