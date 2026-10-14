import { describe, expect, it } from 'vitest'
import type { PromotionCheck, PromotionGateOutcome } from '../promotion-ports'
import { HttpPromotionVerifier, type HttpPromotionVerifierConfig } from './http-promotion-verifier'

const STG_BACK = 'https://api-staging.exemplo.com'
const STG_FRONT = 'https://staging.exemplo.com'
const PRD_BACK = 'https://api.exemplo.com'
const PRD_FRONT = 'https://app.exemplo.com'
const DIGEST = `sha256:${'a'.repeat(64)}`
const OUTRO_DIGEST = `sha256:${'b'.repeat(64)}`
const FRONT_DEPLOY = 'dpl_frontend_1'
const TODOS: readonly PromotionCheck[] = [
  'backend_health',
  'frontend_wiring',
  'smoke',
  'e2e_essential'
]

type Rota = Response | (() => Response)

function resposta(corpo: string, status = 200): Response {
  return new Response(corpo, { status })
}

const runtime = (apiUrl: unknown) => resposta(JSON.stringify({ apiUrl }))

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

/** Rotas saudáveis dos DOIS ambientes: cada um aponta só para o seu backend. */
const ok: Record<string, Rota> = {
  [`${STG_BACK}/health`]: resposta('ok'),
  [`${PRD_BACK}/health`]: resposta('ok'),
  [`${STG_FRONT}/runtime-config.json`]: runtime(STG_BACK),
  [`${PRD_FRONT}/runtime-config.json`]: runtime(PRD_BACK),
  [`${STG_FRONT}/`]: resposta('<html></html>'),
  [`${PRD_FRONT}/`]: resposta('<html></html>')
}

interface Opcoes {
  tentativas?: number
  config?: Partial<HttpPromotionVerifierConfig>
}

function verificador(rotas: Record<string, Rota>, extra: Opcoes = {}) {
  const { http, chamadas } = rede(rotas)
  let agora = 0
  const e2eChamadas: string[] = []
  const v = new HttpPromotionVerifier({
    environments: {
      staging: { backendUrl: STG_BACK, frontendUrl: STG_FRONT },
      production: { backendUrl: PRD_BACK, frontendUrl: PRD_FRONT }
    },
    currentBackend: async () => ({ deploymentId: 'dep_1', digest: DIGEST }),
    currentFrontend: async () => FRONT_DEPLOY,
    e2e: {
      run: async (ambiente) => {
        e2eChamadas.push(ambiente)
        return true
      }
    },
    fetch: http,
    timeoutMs: (extra.tentativas ?? 1) * 1000,
    intervalMs: 1000,
    sleep: async (ms) => {
      agora += ms
    },
    now: () => agora,
    ...extra.config
  })
  return { v, chamadas, e2eChamadas }
}

const entrada = (
  environment: 'staging' | 'production' = 'staging',
  checks: readonly PromotionCheck[] = TODOS
) => ({ environment, checks, backendDigest: DIGEST, frontendDeploymentId: FRONT_DEPLOY })

const de = (r: readonly PromotionGateOutcome[], gate: PromotionCheck) =>
  r.find((g) => g.gate === gate)!

describe('HttpPromotionVerifier', () => {
  it('passa os quatro checks em Staging', async () => {
    const { v, e2eChamadas } = verificador(ok)
    const r = await v.verify(entrada('staging'))
    expect(r.map((g) => [g.gate, g.result])).toEqual(TODOS.map((g) => [g, 'passed']))
    expect(e2eChamadas).toEqual(['staging'])
  })

  it('em Produção só fala com os domínios de Produção', async () => {
    const { v, chamadas, e2eChamadas } = verificador(ok)
    const r = await v.verify(entrada('production'))
    expect(r.every((g) => g.result === 'passed')).toBe(true)
    expect(chamadas.length).toBeGreaterThan(0)
    for (const c of chamadas) expect(c.startsWith(PRD_BACK) || c.startsWith(PRD_FRONT)).toBe(true)
    expect(e2eChamadas).toEqual(['production'])
  })

  it('devolve só os checks pedidos, na ordem pedida', async () => {
    const { v, chamadas } = verificador(ok)
    const r = await v.verify(entrada('staging', ['smoke', 'backend_health']))
    expect(r.map((g) => g.gate)).toEqual(['smoke', 'backend_health'])
    expect(chamadas.some((c) => c.endsWith('/runtime-config.json'))).toBe(false)
  })

  describe('backend_health', () => {
    it('digest diferente do implantado bloqueia como identity-mismatch, mesmo saudável', async () => {
      const { v } = verificador(ok, {
        config: { currentBackend: async () => ({ deploymentId: 'dep_x', digest: OUTRO_DIGEST }) }
      })
      expect(de(await v.verify(entrada()), 'backend_health')).toEqual({
        gate: 'backend_health',
        result: 'blocked',
        reason: 'identity-mismatch'
      })
    })

    it('ambiente sem deployment (null) é identity-mismatch', async () => {
      const { v } = verificador(ok, { config: { currentBackend: async () => null } })
      expect(de(await v.verify(entrada()), 'backend_health')).toMatchObject({
        result: 'blocked',
        reason: 'identity-mismatch'
      })
    })

    it('falha do provedor ao consultar a identidade é identity-unavailable', async () => {
      const { v } = verificador(ok, {
        config: {
          currentBackend: async () => {
            throw new Error('token ghp_segredo rejeitado')
          }
        }
      })
      const g = de(await v.verify(entrada()), 'backend_health')
      expect(g).toMatchObject({ result: 'blocked', reason: 'identity-unavailable' })
      expect(JSON.stringify(g)).not.toContain('ghp_segredo')
    })

    it('saúde fora do ar bloqueia como health-down', async () => {
      const { v } = verificador(
        { ...ok, [`${STG_BACK}/health`]: resposta('', 503) },
        { tentativas: 2 }
      )
      expect(de(await v.verify(entrada()), 'backend_health')).toMatchObject({
        result: 'blocked',
        reason: 'health-down'
      })
    })

    it('saúde que demora a subir passa dentro do prazo', async () => {
      let tentativas = 0
      const { v } = verificador(
        { ...ok, [`${STG_BACK}/health`]: () => resposta('', (tentativas += 1) < 3 ? 503 : 200) },
        { tentativas: 5 }
      )
      const r = await v.verify(entrada('staging', ['backend_health']))
      expect(de(r, 'backend_health').result).toBe('passed')
      expect(tentativas).toBe(3)
    })

    it('rollout em curso: espera o digest bater em vez de reprovar o container antigo', async () => {
      let consultas = 0
      const { v } = verificador(ok, {
        tentativas: 6,
        config: {
          currentBackend: async () => ({
            deploymentId: 'dep_1',
            digest: (consultas += 1) < 3 ? OUTRO_DIGEST : DIGEST
          })
        }
      })
      expect(de(await v.verify(entrada()), 'backend_health').result).toBe('passed')
      expect(consultas).toBe(3)
    })

    it('usa o healthPath configurado', async () => {
      const { v, chamadas } = verificador(
        { ...ok, [`${STG_BACK}/readyz`]: resposta('ok') },
        { config: { healthPath: '/readyz' } }
      )
      expect(
        de(await v.verify(entrada('staging', ['backend_health'])), 'backend_health').result
      ).toBe('passed')
      expect(chamadas).toEqual([`${STG_BACK}/readyz`])
    })
  })

  describe('frontend_wiring', () => {
    it('apiUrl com caminho na origem certa passa (compara a origem, não o texto)', async () => {
      const { v } = verificador({
        ...ok,
        [`${STG_FRONT}/runtime-config.json`]: runtime(`${STG_BACK}/v1/`)
      })
      expect(de(await v.verify(entrada()), 'frontend_wiring').result).toBe('passed')
    })

    it('frontend de Staging apontando para o backend de Produção bloqueia', async () => {
      const { v } = verificador({ ...ok, [`${STG_FRONT}/runtime-config.json`]: runtime(PRD_BACK) })
      expect(de(await v.verify(entrada()), 'frontend_wiring')).toEqual({
        gate: 'frontend_wiring',
        result: 'blocked',
        reason: 'frontend-foreign-backend'
      })
    })

    it('frontend de Produção apontando para o backend de Staging bloqueia', async () => {
      const { v } = verificador({ ...ok, [`${PRD_FRONT}/runtime-config.json`]: runtime(STG_BACK) })
      expect(de(await v.verify(entrada('production')), 'frontend_wiring')).toMatchObject({
        result: 'blocked',
        reason: 'frontend-foreign-backend'
      })
    })

    it('origem que difere só no esquema ou na porta também é de outro backend', async () => {
      for (const apiUrl of ['http://api-staging.exemplo.com', `${STG_BACK}:8443`]) {
        const { v } = verificador({ ...ok, [`${STG_FRONT}/runtime-config.json`]: runtime(apiUrl) })
        expect(de(await v.verify(entrada()), 'frontend_wiring')).toMatchObject({
          reason: 'frontend-foreign-backend'
        })
      }
    })

    it('runtime-config ausente, JSON inválido ou sem apiUrl válido é frontend-wiring', async () => {
      const casos: Record<string, Rota> = {
        ausente: resposta('', 404),
        'json inválido': resposta('{não é json'),
        'sem apiUrl': resposta('{}'),
        'apiUrl não-string': runtime(42),
        'apiUrl ilegível': runtime('isto não é url'),
        'corpo null': resposta('null')
      }
      for (const [nome, rota] of Object.entries(casos)) {
        const { v } = verificador({ ...ok, [`${STG_FRONT}/runtime-config.json`]: rota })
        expect(de(await v.verify(entrada()), 'frontend_wiring'), nome).toEqual({
          gate: 'frontend_wiring',
          result: 'blocked',
          reason: 'frontend-wiring'
        })
      }
    })

    it('runtime-config acima de 16 KB é recusado, não lido parcialmente', async () => {
      // O JSON é válido e aponta para o backend certo; só o tamanho o reprova.
      const grande = JSON.stringify({ apiUrl: STG_BACK, enchimento: 'x'.repeat(17 * 1024) })
      const { v } = verificador({ ...ok, [`${STG_FRONT}/runtime-config.json`]: resposta(grande) })
      expect(de(await v.verify(entrada()), 'frontend_wiring')).toMatchObject({
        result: 'blocked',
        reason: 'frontend-wiring'
      })
    })

    it('deployment de frontend diferente do promovido é identity-mismatch', async () => {
      const { v } = verificador(ok, { config: { currentFrontend: async () => 'dpl_outro' } })
      expect(de(await v.verify(entrada()), 'frontend_wiring')).toMatchObject({
        result: 'blocked',
        reason: 'identity-mismatch'
      })
    })

    it('ambiente sem frontend (null) é identity-mismatch e falha do provedor, identity-unavailable', async () => {
      const nulo = verificador(ok, { config: { currentFrontend: async () => null } })
      expect(de(await nulo.v.verify(entrada()), 'frontend_wiring').reason).toBe('identity-mismatch')
      const quebrado = verificador(ok, {
        config: {
          currentFrontend: async () => {
            throw new Error('boom')
          }
        }
      })
      expect(de(await quebrado.v.verify(entrada()), 'frontend_wiring').reason).toBe(
        'identity-unavailable'
      )
    })

    it('espera a propagação da configuração de runtime após a promoção', async () => {
      let leituras = 0
      const { v } = verificador(
        {
          ...ok,
          [`${STG_FRONT}/runtime-config.json`]: () =>
            (leituras += 1) < 3 ? resposta('', 502) : runtime(STG_BACK)
        },
        { tentativas: 5 }
      )
      expect(de(await v.verify(entrada()), 'frontend_wiring').result).toBe('passed')
      expect(leituras).toBe(3)
    })

    it('usa o runtimeConfigPath configurado', async () => {
      const { v, chamadas } = verificador(
        { ...ok, [`${STG_FRONT}/cfg/app.json`]: runtime(STG_BACK) },
        { config: { runtimeConfigPath: '/cfg/app.json' } }
      )
      await v.verify(entrada('staging', ['frontend_wiring']))
      expect(chamadas).toContain(`${STG_FRONT}/cfg/app.json`)
      expect(chamadas).not.toContain(`${STG_FRONT}/runtime-config.json`)
    })
  })

  describe('smoke', () => {
    it('visita cada smokePath no frontend e a saúde do backend', async () => {
      const { v, chamadas } = verificador(
        { ...ok, [`${STG_FRONT}/login`]: resposta('ok') },
        { config: { smokePaths: ['/', '/login'] } }
      )
      expect(de(await v.verify(entrada('staging', ['smoke'])), 'smoke').result).toBe('passed')
      expect(chamadas).toEqual([`${STG_FRONT}/`, `${STG_FRONT}/login`, `${STG_BACK}/health`])
    })

    it('um smokePath fora do ar bloqueia como smoke-failed', async () => {
      const { v } = verificador(
        { ...ok, [`${STG_FRONT}/login`]: resposta('', 500) },
        { config: { smokePaths: ['/', '/login'] } }
      )
      expect(de(await v.verify(entrada('staging', ['smoke'])), 'smoke')).toEqual({
        gate: 'smoke',
        result: 'blocked',
        reason: 'smoke-failed'
      })
    })

    it('saúde do backend fora do ar também reprova o smoke', async () => {
      const { v } = verificador({ ...ok, [`${STG_BACK}/health`]: resposta('', 503) })
      expect(de(await v.verify(entrada('staging', ['smoke'])), 'smoke')).toMatchObject({
        reason: 'smoke-failed'
      })
    })
  })

  describe('e2e_essential', () => {
    it('sem executor configurado falha fechado, nunca passa em silêncio', async () => {
      const { v } = verificador(ok, { config: { e2e: undefined } })
      expect(de(await v.verify(entrada('staging', ['e2e_essential'])), 'e2e_essential')).toEqual({
        gate: 'e2e_essential',
        result: 'blocked',
        reason: 'e2e-not-configured'
      })
    })

    it('jornada que devolve false bloqueia como e2e-failed', async () => {
      const { v } = verificador(ok, { config: { e2e: { run: async () => false } } })
      expect(de(await v.verify(entrada()), 'e2e_essential')).toMatchObject({
        result: 'blocked',
        reason: 'e2e-failed'
      })
    })

    it('exceção na jornada bloqueia como e2e-failed sem vazar a mensagem', async () => {
      const { v } = verificador(ok, {
        config: {
          e2e: {
            run: async () => {
              throw new Error('senha=hunter2 em https://u:p@interno')
            }
          }
        }
      })
      const g = de(await v.verify(entrada()), 'e2e_essential')
      expect(g).toMatchObject({ result: 'blocked', reason: 'e2e-failed' })
      expect(JSON.stringify(g)).not.toMatch(/hunter2|interno/)
    })
  })

  describe('requisições', () => {
    it('não segue redirecionamento e cada requisição tem prazo', async () => {
      const opcoes: RequestInit[] = []
      const http = (async (_url: string | URL, init?: RequestInit) => {
        opcoes.push(init ?? {})
        return resposta('{"apiUrl":"' + STG_BACK + '"}')
      }) as typeof fetch
      const { v } = verificador(ok, { config: { fetch: http } })
      await v.verify(entrada())
      expect(opcoes.length).toBeGreaterThan(0)
      for (const o of opcoes) {
        expect(o.redirect).toBe('error')
        expect(o.signal).toBeInstanceOf(AbortSignal)
      }
    })

    it('redirecionamento (fetch rejeita com redirect:error) não vira check passado', async () => {
      const http = (async () => {
        throw new TypeError('redirect mode is set to error: https://u:p@evil.test/')
      }) as typeof fetch
      const { v } = verificador(ok, { config: { fetch: http } })
      const r = await v.verify(entrada('staging', ['backend_health', 'frontend_wiring', 'smoke']))
      expect(r.map((g) => g.result)).toEqual(['blocked', 'blocked', 'blocked'])
      expect(JSON.stringify(r)).not.toMatch(/evil|u:p/)
    })

    it('todo motivo é um código curto, nunca texto de runtime', async () => {
      const http = (async () => {
        throw new Error('ECONNREFUSED 10.0.0.5:5432 com senha')
      }) as typeof fetch
      const { v } = verificador(ok, { config: { fetch: http, e2e: undefined } })
      for (const g of await v.verify(entrada())) expect(g.reason).toMatch(/^[a-z0-9._-]{1,64}$/)
    })
  })

  describe('configuração', () => {
    const base = {
      environments: {
        staging: { backendUrl: STG_BACK, frontendUrl: STG_FRONT },
        production: { backendUrl: PRD_BACK, frontendUrl: PRD_FRONT }
      },
      currentBackend: async () => null,
      currentFrontend: async () => null
    }

    it('URL que não é https, tem credencial ou é ilegível vira TypeError', () => {
      for (const url of [
        'http://api.exemplo.com',
        'https://user:senha@api.exemplo.com',
        'api.exemplo.com',
        ''
      ]) {
        expect(
          () =>
            new HttpPromotionVerifier({
              ...base,
              environments: {
                ...base.environments,
                staging: { backendUrl: url, frontendUrl: STG_FRONT }
              }
            }),
          url
        ).toThrow(TypeError)
        expect(
          () =>
            new HttpPromotionVerifier({
              ...base,
              environments: {
                ...base.environments,
                production: { backendUrl: PRD_BACK, frontendUrl: url }
              }
            }),
          url
        ).toThrow(TypeError)
      }
    })

    it('caminho que escapa da origem é recusado na construção', () => {
      for (const caminho of ['//169.254.169.254/x', '/\\host', 'health', 'http://x', '/a b']) {
        expect(() => new HttpPromotionVerifier({ ...base, healthPath: caminho }), caminho).toThrow(
          TypeError
        )
        expect(
          () => new HttpPromotionVerifier({ ...base, runtimeConfigPath: caminho }),
          caminho
        ).toThrow(TypeError)
        expect(
          () => new HttpPromotionVerifier({ ...base, smokePaths: ['/', caminho] }),
          caminho
        ).toThrow(TypeError)
      }
    })
  })
})
