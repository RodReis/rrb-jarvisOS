import { describe, expect, it } from 'vitest'
import { PromotionProviderError } from '../promotion-ports'
import { RailwayBackupAdapter, type RailwayBackupConfig } from './railway-backup-adapter'

const TOKEN = 'rw-token-super-secreto-123'
const PROJETO = 'proj-1'
const AMBIENTE_ID = 'env-prod'
const VOLUME_INSTANCIA = 'vi-1'
const ANTIGO = { id: 'bk-antigo', name: 'old', createdAt: '2026-10-01T10:00:00.000Z' }
const NOVO = { id: 'bk-novo', name: 'new', createdAt: '2026-10-14T10:00:00.000Z' }

const conexao = (...nos: unknown[]) => ({ edges: nos.map((node) => ({ node })) })
const ambientes = conexao(
  { id: 'env-stg', name: 'staging' },
  { id: AMBIENTE_ID, name: 'production' }
)
const instancia = (over: Record<string, unknown> = {}) => ({
  id: VOLUME_INSTANCIA,
  environmentId: AMBIENTE_ID,
  serviceInstance: { serviceName: 'postgres' },
  ...over
})
const volumes = (...instancias: unknown[]) => ({
  project: {
    volumes: conexao({ id: 'vol-1', name: 'pg', volumeInstances: conexao(...instancias) })
  }
})

type Handler = (variaveis: Record<string, unknown>) => Response | Promise<Response>
type Rotas = Record<string, Handler | Response>

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })
const dados = (data: unknown) => json({ data })

const rotasFelizes = (listas: unknown[][]): Rotas => {
  let chamada = 0
  return {
    environments: dados({ environments: ambientes }),
    projectVolumes: dados(volumes(instancia())),
    volumeInstanceBackupCreate: dados({ volumeInstanceBackupCreate: true }),
    volumeInstanceBackupList: () => {
      const lista = listas[Math.min(chamada++, listas.length - 1)]
      return dados({ volumeInstanceBackupList: lista })
    }
  }
}

/** Fetch falso: roteia pelo nome da operação GraphQL e guarda cada requisição. */
function rede(rotas: Rotas) {
  const requisicoes: { url: string; init: RequestInit; operacao: string }[] = []
  const http = (async (url: string | URL, init: RequestInit = {}) => {
    const corpo = JSON.parse(String(init.body)) as {
      query: string
      variables: Record<string, unknown>
    }
    const operacao = /(?:query|mutation)\s+(\w+)/.exec(corpo.query)![1]!
    requisicoes.push({ url: String(url), init, operacao })
    const rota = rotas[operacao]
    if (!rota) return json({ errors: [{ message: 'operacao desconhecida' }] }, 400)
    const r = typeof rota === 'function' ? await rota(corpo.variables) : rota
    return new Response(await r.clone().text(), { status: r.status })
  }) as typeof fetch
  return { http, requisicoes }
}

function adapter(rotas: Rotas, extra: Partial<RailwayBackupConfig> = {}) {
  const { http, requisicoes } = rede(rotas)
  let agora = 0
  const dormiu: number[] = []
  const a = new RailwayBackupAdapter({
    token: TOKEN,
    projectId: PROJETO,
    databaseService: 'postgres',
    environments: { staging: 'staging', production: 'production' },
    fetch: http,
    timeoutMs: 3000,
    intervalMs: 1000,
    sleep: async (ms) => {
      dormiu.push(ms)
      agora += ms
    },
    now: () => agora,
    ...extra
  })
  return { a, requisicoes, dormiu }
}

async function erroDe(p: Promise<unknown>): Promise<PromotionProviderError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(PromotionProviderError)
    return e as PromotionProviderError
  }
  throw new Error('esperava falha')
}

describe('RailwayBackupAdapter', () => {
  it('cria o backup e devolve o id do backup novo como backupRef', async () => {
    const { a, requisicoes } = adapter(rotasFelizes([[ANTIGO], [ANTIGO, NOVO]]))

    await expect(a.backup({ environment: 'production' })).resolves.toEqual({ backupRef: 'bk-novo' })

    expect(requisicoes.map((r) => r.operacao)).toEqual([
      'environments',
      'projectVolumes',
      'volumeInstanceBackupList',
      'volumeInstanceBackupCreate',
      'volumeInstanceBackupList'
    ])
  })

  it('fala só com o endpoint GraphQL, com token em header e sem seguir redirecionamento', async () => {
    const { a, requisicoes } = adapter(rotasFelizes([[], [NOVO]]))
    await a.backup({ environment: 'production' })

    for (const r of requisicoes) {
      expect(r.url).toBe('https://backboard.railway.com/graphql/v2')
      expect(r.init.method).toBe('POST')
      expect(r.init.redirect).toBe('error')
      expect(r.init.signal).toBeInstanceOf(AbortSignal)
      expect((r.init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`)
      expect(String(r.init.body)).not.toContain(TOKEN)
    }
  })

  it('usa o volume do serviço do banco no ambiente certo e cria o backup nele', async () => {
    const vistos: unknown[] = []
    const rotas = rotasFelizes([[], [NOVO]])
    rotas.projectVolumes = dados(
      volumes(
        instancia({ id: 'vi-staging', environmentId: 'env-stg' }),
        instancia({ id: 'vi-outro-servico', serviceInstance: { serviceName: 'redis' } }),
        instancia()
      )
    )
    rotas.volumeInstanceBackupCreate = (v) => {
      vistos.push(v)
      return dados({ volumeInstanceBackupCreate: true })
    }
    const { a } = adapter(rotas)

    await a.backup({ environment: 'production' })

    expect(vistos).toEqual([{ volumeInstanceId: VOLUME_INSTANCIA }])
  })

  it('não confunde backup antigo com o novo: espera um id que não estava na lista', async () => {
    const { a, requisicoes, dormiu } = adapter(
      rotasFelizes([[ANTIGO], [ANTIGO], [ANTIGO], [ANTIGO, NOVO]])
    )

    await expect(a.backup({ environment: 'production' })).resolves.toEqual({ backupRef: 'bk-novo' })

    expect(dormiu).toEqual([1000, 1000])
    expect(requisicoes.filter((r) => r.operacao === 'volumeInstanceBackupCreate')).toHaveLength(1)
  })

  it('com dois backups novos (agenda do Railway), escolhe o mais recente', async () => {
    const agendado = { id: 'bk-agenda', name: 'sched', createdAt: '2026-10-14T09:59:59.000Z' }
    const { a } = adapter(rotasFelizes([[ANTIGO], [ANTIGO, NOVO, agendado]]))

    await expect(a.backup({ environment: 'production' })).resolves.toEqual({ backupRef: 'bk-novo' })
  })

  it('backup que nunca aparece na listagem vira timeout', async () => {
    const { a, requisicoes } = adapter(rotasFelizes([[ANTIGO]]))

    const erro = await erroDe(a.backup({ environment: 'production' }))

    expect(erro.code).toBe('timeout')
    expect(requisicoes.filter((r) => r.operacao === 'volumeInstanceBackupCreate')).toHaveLength(1)
  })

  it.each([
    ['URL', 'https://evil.example/backup'],
    ['com espaço', 'bk novo'],
    ['começa com ponto', '.bk'],
    ['longo demais', 'a'.repeat(129)]
  ])('recusa backupRef inválido (%s)', async (_nome, id) => {
    const { a } = adapter(rotasFelizes([[], [{ id, createdAt: NOVO.createdAt }]]))

    expect((await erroDe(a.backup({ environment: 'production' }))).code).toBe('failed')
  })

  it('recusa ambiente fora da configuração, sem nenhuma requisição', async () => {
    const { a, requisicoes } = adapter(rotasFelizes([[NOVO]]), {
      environments: { staging: 'staging' }
    })

    const erro = await erroDe(a.backup({ environment: 'production' }))

    expect(erro.code).toBe('incompatible-state')
    expect(requisicoes).toHaveLength(0)
  })

  it('ambiente configurado que não existe no projeto é not-found', async () => {
    const { a } = adapter(rotasFelizes([[NOVO]]), { environments: { production: 'prd' } })

    expect((await erroDe(a.backup({ environment: 'production' }))).code).toBe('not-found')
  })

  it('serviço do banco sem volume no ambiente é not-found, sem criar backup', async () => {
    const rotas = rotasFelizes([[NOVO]])
    rotas.projectVolumes = dados(volumes(instancia({ environmentId: 'env-stg' })))
    const { a, requisicoes } = adapter(rotas)

    expect((await erroDe(a.backup({ environment: 'production' }))).code).toBe('not-found')
    expect(requisicoes.some((r) => r.operacao === 'volumeInstanceBackupCreate')).toBe(false)
  })

  it('dois volumes do banco no mesmo ambiente é estado incompatível', async () => {
    const rotas = rotasFelizes([[NOVO]])
    rotas.projectVolumes = dados(volumes(instancia(), instancia({ id: 'vi-2' })))
    const { a } = adapter(rotas)

    expect((await erroDe(a.backup({ environment: 'production' }))).code).toBe('incompatible-state')
  })

  describe('falhas da API', () => {
    it.each([401, 403])('HTTP %i é auth', async (status) => {
      const rotas = rotasFelizes([[NOVO]])
      rotas.environments = json({ errors: [{ message: 'x' }] }, status)

      expect((await erroDe(adapter(rotas).a.backup({ environment: 'production' }))).code).toBe(
        'auth'
      )
    })

    it('"Not Authorized" com HTTP 200 é auth', async () => {
      const rotas = rotasFelizes([[NOVO]])
      rotas.environments = json({
        errors: [{ message: 'Not Authorized', extensions: { code: 'INTERNAL_SERVER_ERROR' } }],
        data: null
      })

      expect((await erroDe(adapter(rotas).a.backup({ environment: 'production' }))).code).toBe(
        'auth'
      )
    })

    it('errors[] com HTTP 200 nunca é ignorado, mesmo com data presente', async () => {
      const rotas = rotasFelizes([[NOVO]])
      rotas.volumeInstanceBackupCreate = json({
        errors: [{ message: 'Backup limit reached for plan' }],
        data: { volumeInstanceBackupCreate: true }
      })

      expect((await erroDe(adapter(rotas).a.backup({ environment: 'production' }))).code).toBe(
        'failed'
      )
    })

    it('HTTP 429 é quota', async () => {
      const rotas = rotasFelizes([[NOVO]])
      rotas.environments = json({}, 429)

      expect((await erroDe(adapter(rotas).a.backup({ environment: 'production' }))).code).toBe(
        'quota'
      )
    })

    it('erro GraphQL de rate limit com HTTP 200 é quota', async () => {
      const rotas = rotasFelizes([[NOVO]])
      rotas.environments = json({ errors: [{ message: 'Rate limit exceeded' }] })

      expect((await erroDe(adapter(rotas).a.backup({ environment: 'production' }))).code).toBe(
        'quota'
      )
    })

    it('erro GraphQL "not found" é not-found', async () => {
      const rotas = rotasFelizes([[NOVO]])
      rotas.volumeInstanceBackupList = json({ errors: [{ message: 'Volume instance not found' }] })

      expect((await erroDe(adapter(rotas).a.backup({ environment: 'production' }))).code).toBe(
        'not-found'
      )
    })

    it('mutation que devolve false não é backup criado', async () => {
      const rotas = rotasFelizes([[NOVO]])
      rotas.volumeInstanceBackupCreate = dados({ volumeInstanceBackupCreate: false })

      expect((await erroDe(adapter(rotas).a.backup({ environment: 'production' }))).code).toBe(
        'failed'
      )
    })

    it.each([
      ['corpo que não é JSON', new Response('<html>oops</html>')],
      ['JSON sem data', json({ ok: true })],
      ['data nula', json({ data: null })],
      ['lista de ambientes com forma errada', dados({ environments: { edges: 'x' } })],
      ['HTTP 500', json({}, 500)]
    ])('resposta inesperada (%s) é failed', async (_nome, resposta) => {
      const rotas = rotasFelizes([[NOVO]])
      rotas.environments = resposta

      expect((await erroDe(adapter(rotas).a.backup({ environment: 'production' }))).code).toBe(
        'failed'
      )
    })

    it('listagem de backups com forma errada é failed', async () => {
      const rotas = rotasFelizes([[NOVO]])
      rotas.volumeInstanceBackupList = dados({ volumeInstanceBackupList: { id: 'x' } })

      expect((await erroDe(adapter(rotas).a.backup({ environment: 'production' }))).code).toBe(
        'failed'
      )
    })

    it('resposta acima do teto de bytes é recusada', async () => {
      const rotas = rotasFelizes([[NOVO]])
      rotas.environments = new Response('x'.repeat(1024 * 1024 + 1))

      expect((await erroDe(adapter(rotas).a.backup({ environment: 'production' }))).code).toBe(
        'failed'
      )
    })

    it('estouro do prazo da requisição é timeout', async () => {
      const { a } = adapter(rotasFelizes([[NOVO]]), {
        fetch: (async () => {
          throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
        }) as typeof fetch
      })

      expect((await erroDe(a.backup({ environment: 'production' }))).code).toBe('timeout')
    })

    it('falha de rede é failed', async () => {
      const { a } = adapter(rotasFelizes([[NOVO]]), {
        fetch: (async () => {
          throw new TypeError('fetch failed')
        }) as typeof fetch
      })

      expect((await erroDe(a.backup({ environment: 'production' }))).code).toBe('failed')
    })
  })

  describe('sigilo do token', () => {
    it('nunca aparece em erro, nem quando o provedor ecoa o token', async () => {
      const casos: Response[] = [
        json({ errors: [{ message: `Bad token ${TOKEN}` }] }),
        json({ errors: [{ message: `Not Authorized ${TOKEN}` }] }, 401),
        json({ errors: [{ message: `boom ${TOKEN}` }] }, 500),
        new Response(`eco ${TOKEN}`)
      ]
      for (const resposta of casos) {
        const rotas = rotasFelizes([[NOVO]])
        rotas.environments = resposta
        const erro = await erroDe(adapter(rotas).a.backup({ environment: 'production' }))
        expect(`${erro.message} ${erro.name} ${erro.stack ?? ''}`).not.toContain(TOKEN)
      }
    })

    it('nunca aparece quando o fetch lança um erro que o contém', async () => {
      const { a } = adapter(rotasFelizes([[NOVO]]), {
        fetch: (async () => {
          throw new Error(`falhou com Authorization: Bearer ${TOKEN}`)
        }) as typeof fetch
      })

      const erro = await erroDe(a.backup({ environment: 'production' }))

      expect(`${erro.message} ${erro.stack ?? ''}`).not.toContain(TOKEN)
    })
  })

  it('exige token, projeto e serviço do banco', () => {
    const base = { token: TOKEN, projectId: PROJETO, databaseService: 'postgres', environments: {} }
    for (const campo of ['token', 'projectId', 'databaseService'] as const)
      expect(() => new RailwayBackupAdapter({ ...base, [campo]: '' })).toThrow(TypeError)
  })
})
