import { describe, expect, it } from 'vitest'
import { HttpPreviewVerifier } from './http-preview-verifier'

const RUN = '0f3a9c1e-77b2-4d5e-9a10-aaaaaaaaaaaa'
const SHA = 'a'.repeat(40)
const BACKEND = 'https://api-pv-aaaa-g1.up.railway.app'
const OUTRO_BACKEND = 'https://api-pv-bbbb-g1.up.railway.app'
const FRONT = 'https://web-1.vercel.app'
const entrada = { previewRunId: RUN, sourceSha: SHA, backendUrl: BACKEND, frontendUrl: FRONT }

type Rota = Response | (() => Response)

function resposta(corpo: string, status = 200): Response {
  return new Response(corpo, { status })
}

/** Servidor falso por URL exata; rota ausente é 404, como na rede de verdade. */
function rede(rotas: Record<string, Rota>) {
  const chamadas: string[] = []
  const http = (async (url: string | URL) => {
    const chave = String(url)
    chamadas.push(chave)
    const rota = rotas[chave]
    if (!rota) return resposta('', 404)
    if (typeof rota === 'function') return rota()
    // Corpo novo a cada chamada: cancelar um clone (tee) esperaria para sempre pelo original.
    return new Response(await rota.clone().text(), { status: rota.status })
  }) as typeof fetch
  return { http, chamadas }
}

function verificador(rotas: Record<string, Rota>, extra: { tentativas?: number } = {}) {
  const { http, chamadas } = rede(rotas)
  let agora = 0
  const v = new HttpPreviewVerifier({
    fetch: http,
    timeoutMs: (extra.tentativas ?? 1) * 1000,
    intervalMs: 1000,
    sleep: async (ms) => {
      agora += ms
    },
    now: () => agora
  })
  return { v, chamadas }
}

const identidadeCerta = resposta(JSON.stringify({ previewRunId: RUN, sourceSha: SHA }))
const html = (js: string) => resposta(`<html><script type="module" src="${js}"></script></html>`)
const resultado = (r: Awaited<ReturnType<HttpPreviewVerifier['verify']>>, gate: string) =>
  r.find((g) => g.gate === gate)!

describe('HttpPreviewVerifier', () => {
  const ok = {
    [`${BACKEND}/health`]: resposta('ok'),
    [`${BACKEND}/preview-identity`]: identidadeCerta,
    [`${FRONT}/`]: html('/assets/app.js'),
    [`${FRONT}/assets/app.js`]: resposta(`const api="${BACKEND}";`)
  }

  it('passa health, identidade e frontend quando tudo é do mesmo run', async () => {
    const { v } = verificador(ok)
    const r = await v.verify(entrada)
    expect(r.map((g) => [g.gate, g.result])).toEqual([
      ['health', 'passed'],
      ['identidade', 'passed'],
      ['frontend', 'passed']
    ])
  })

  it('backend de outro PR responde outra identidade e bloqueia', async () => {
    const { v } = verificador({
      ...ok,
      [`${BACKEND}/preview-identity`]: resposta(
        JSON.stringify({ previewRunId: 'outro-run', sourceSha: SHA })
      )
    })
    expect(resultado(await v.verify(entrada), 'identidade')).toMatchObject({
      result: 'blocked',
      reason: 'identity-mismatch'
    })
  })

  it('backend com o SHA de outro commit também bloqueia', async () => {
    const { v } = verificador({
      ...ok,
      [`${BACKEND}/preview-identity`]: resposta(
        JSON.stringify({ previewRunId: RUN, sourceSha: 'b'.repeat(40) })
      )
    })
    expect(resultado(await v.verify(entrada), 'identidade').result).toBe('blocked')
  })

  it('backend sem endpoint de identidade bloqueia, não presume', async () => {
    const rotas = { ...ok }
    delete (rotas as Record<string, Rota>)[`${BACKEND}/preview-identity`]
    const { v } = verificador(rotas)
    expect(resultado(await v.verify(entrada), 'identidade')).toMatchObject({
      result: 'blocked',
      reason: 'identity-unavailable'
    })
  })

  it('frontend ligado ao backend de outro Preview bloqueia mesmo com o nosso presente', async () => {
    const { v } = verificador({
      ...ok,
      [`${FRONT}/assets/app.js`]: resposta(`const a="${BACKEND}",b="${OUTRO_BACKEND}";`)
    })
    expect(resultado(await v.verify(entrada), 'frontend')).toMatchObject({
      result: 'blocked',
      reason: 'frontend-foreign-backend'
    })
  })

  it('frontend que não menciona o nosso backend bloqueia', async () => {
    const { v } = verificador({
      ...ok,
      [`${FRONT}/assets/app.js`]: resposta('const api="/local";')
    })
    expect(resultado(await v.verify(entrada), 'frontend')).toMatchObject({
      result: 'blocked',
      reason: 'frontend-wiring'
    })
  })

  it('só segue assets do mesmo domínio do frontend', async () => {
    const { v, chamadas } = verificador({
      ...ok,
      [`${FRONT}/`]: html('https://cdn.exemplo.com/x.js')
    })
    await v.verify(entrada)
    expect(chamadas.some((c) => c.startsWith('https://cdn.exemplo.com'))).toBe(false)
  })

  it('saúde que demora a subir passa dentro do prazo', async () => {
    let tentativas = 0
    const { v } = verificador(
      { ...ok, [`${BACKEND}/health`]: () => resposta('', (tentativas += 1) < 3 ? 503 : 200) },
      { tentativas: 5 }
    )
    expect(resultado(await v.verify(entrada), 'health').result).toBe('passed')
    expect(tentativas).toBe(3)
  })

  it('backend fora do ar bloqueia a saúde e deixa a identidade desconhecida', async () => {
    const { v } = verificador(
      { ...ok, [`${BACKEND}/health`]: resposta('', 503) },
      { tentativas: 2 }
    )
    const r = await v.verify(entrada)
    expect(resultado(r, 'health')).toMatchObject({ result: 'blocked', reason: 'health-down' })
    expect(resultado(r, 'identidade').result).toBe('unknown')
  })

  it('frontend fora do ar bloqueia com razão própria', async () => {
    const { v } = verificador({ ...ok, [`${FRONT}/`]: resposta('', 502) })
    expect(resultado(await v.verify(entrada), 'frontend')).toMatchObject({
      result: 'blocked',
      reason: 'frontend-down'
    })
  })

  it('commit novo: espera o rollout até a identidade bater, em vez de reprovar a do container antigo', async () => {
    let chamadas = 0
    const { v } = verificador(
      {
        ...ok,
        [`${BACKEND}/preview-identity`]: () =>
          resposta(
            JSON.stringify({
              previewRunId: RUN,
              sourceSha: (chamadas += 1) < 3 ? 'b'.repeat(40) : SHA
            })
          )
      },
      { tentativas: 6 }
    )
    expect(resultado(await v.verify(entrada), 'identidade').result).toBe('passed')
    expect(chamadas).toBe(3)
  })

  it('identidade que nunca bate dentro do prazo bloqueia com mismatch', async () => {
    const { v } = verificador(
      {
        ...ok,
        [`${BACKEND}/preview-identity`]: resposta(
          JSON.stringify({ previewRunId: RUN, sourceSha: 'b'.repeat(40) })
        )
      },
      { tentativas: 3 }
    )
    expect(resultado(await v.verify(entrada), 'identidade')).toMatchObject({
      result: 'blocked',
      reason: 'identity-mismatch'
    })
  })

  it('não segue redirecionamento e cada requisição tem prazo', async () => {
    const opcoes: RequestInit[] = []
    const http = (async (_url: string | URL, init?: RequestInit) => {
      opcoes.push(init ?? {})
      return resposta('ok')
    }) as typeof fetch
    const v = new HttpPreviewVerifier({
      fetch: http,
      timeoutMs: 1,
      intervalMs: 1,
      sleep: async () => undefined
    })
    await v.verify(entrada)
    expect(opcoes.length).toBeGreaterThan(0)
    for (const o of opcoes) {
      expect(o.redirect).toBe('error')
      expect(o.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('redirecionamento (fetch rejeita com redirect:error) não vira saúde passada', async () => {
    const http = (async () => {
      throw new TypeError('redirect mode is set to error')
    }) as typeof fetch
    const v = new HttpPreviewVerifier({
      fetch: http,
      timeoutMs: 1,
      intervalMs: 1,
      sleep: async () => undefined
    })
    expect(resultado(await v.verify(entrada), 'health').result).toBe('blocked')
  })

  it('caminho de saúde ou identidade que escapa da origem é recusado na construção', () => {
    for (const caminho of ['//169.254.169.254/x', '/\\host', 'health', 'http://x', '/a b'])
      expect(() => new HttpPreviewVerifier({ healthPath: caminho })).toThrow(TypeError)
    expect(() => new HttpPreviewVerifier({ identityPath: '//host' })).toThrow(TypeError)
  })

  it('só verifica domínios do provedor: IP, localhost e domínio próprio são recusados', async () => {
    const { v } = verificador(ok)
    for (const [backendUrl, frontendUrl] of [
      ['https://169.254.169.254', FRONT],
      ['https://localhost', FRONT],
      [BACKEND, 'https://evil.example.com'],
      ['http://api.up.railway.app', FRONT]
    ] as const)
      await expect(v.verify({ ...entrada, backendUrl, frontendUrl })).rejects.toMatchObject({
        code: 'incompatible-state'
      })
  })

  it('corpo de identidade acima do teto é indisponível, não é lido inteiro', async () => {
    const { v } = verificador({
      ...ok,
      [`${BACKEND}/preview-identity`]: resposta('x'.repeat(64 * 1024))
    })
    expect(resultado(await v.verify(entrada), 'identidade')).toMatchObject({
      result: 'blocked',
      reason: 'identity-unavailable'
    })
  })
})
