import { describe, expect, it } from 'vitest'
import { PromotionProviderError } from '../promotion-ports'
import type { CommandOptions, CommandResult, CommandRunner } from './command-runner'
import {
  RailwayPromotionBackendAdapter,
  type RailwayPromotionBackendConfig
} from './railway-promotion-backend-adapter'

const TOKEN = 'tok_SEGREDO_DO_PROVEDOR_123'
const DIGEST = `sha256:${'a'.repeat(64)}`
const OUTRO_DIGEST = `sha256:${'b'.repeat(64)}`
const IMAGEM = `ghcr.io/dono/app@${DIGEST}`
const IMAGEM_ANTERIOR = `ghcr.io/dono/app@${OUTRO_DIGEST}`
const RELEASE = 'rel-0f3a9c1e77b2'
const SHA = 'c'.repeat(40)

const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '', timedOut: false })
const erro = (stderr: string, code = 1): CommandResult => ({
  code,
  stdout: '',
  stderr,
  timedOut: false
})
const tempo: CommandResult = { code: null, stdout: '', stderr: '', timedOut: true }

interface Chamada {
  binary: string
  args: readonly string[]
  options?: CommandOptions
}

interface Implantacao {
  id: string
  status: string
  createdAt: string
  meta?: unknown
}

const implantacao = (id: string, status: string, imagem: string | null, minuto: number) => ({
  id,
  status,
  createdAt: `2026-10-14T10:${String(minuto).padStart(2, '0')}:00Z`,
  meta: imagem ? { image: imagem } : {}
})

/**
 * Railway falso com estado: `deployment list` devolve as implantações atuais, `environment edit`
 * cria uma nova que percorre `statusDaNova` a cada listagem (último valor se repete).
 */
function railwayFalso(inicial: Implantacao[], statusDaNova: string[] = ['SUCCESS']) {
  const chamadas: Chamada[] = []
  const lista = [...inicial]
  let nova: { item: Implantacao; passos: string[] } | null = null
  const runner: CommandRunner = {
    async run(binary, args, options) {
      chamadas.push({ binary, args: [...args], options })
      if (args[0] === 'deployment' && args[1] === 'list') {
        if (nova) {
          nova.item.status = nova.passos.length > 1 ? nova.passos.shift()! : nova.passos[0]
        }
        return ok(JSON.stringify(lista))
      }
      if (args[0] === 'environment' && args[1] === 'edit') {
        const imagem = args[args.indexOf('source.image') + 1]
        nova = {
          item: implantacao('dep-novo', 'INITIALIZING', imagem, 59),
          passos: [...statusDaNova]
        }
        lista.unshift(nova.item)
        return ok('{}')
      }
      throw new Error(`comando inesperado: ${args.join(' ')}`)
    }
  }
  return { runner, chamadas }
}

function relogioFalso() {
  let agora = 0
  return {
    sleep: async (ms: number) => {
      agora += ms
    },
    now: () => agora
  }
}

const CONFIG_BASE: Omit<RailwayPromotionBackendConfig, 'sleep' | 'now'> = {
  workdir: 'C:/trabalho/railway',
  token: TOKEN,
  environments: { staging: 'staging', production: 'production' },
  backendService: 'backend',
  pollIntervalMs: 1_000,
  deployTimeoutMs: 10_000
}

function adapter(runner: CommandRunner, extra: Partial<RailwayPromotionBackendConfig> = {}) {
  return new RailwayPromotionBackendAdapter(runner, {
    ...CONFIG_BASE,
    ...relogioFalso(),
    ...extra
  })
}

const entrada = {
  environment: 'staging' as const,
  imageUri: IMAGEM,
  releaseId: RELEASE,
  sourceSha: SHA
}

const rodar = <T>(p: Promise<T>) => p.catch((e: unknown) => e)

describe('RailwayPromotionBackendAdapter.deploy', () => {
  it('troca a imagem por digest, grava a identidade da release e espera o SUCCESS', async () => {
    const { runner, chamadas } = railwayFalso(
      [implantacao('dep-velho', 'SUCCESS', IMAGEM_ANTERIOR, 10)],
      ['INITIALIZING', 'BUILDING', 'DEPLOYING', 'SUCCESS']
    )

    const r = await adapter(runner).deploy(entrada)

    expect(r).toEqual({ deploymentId: 'dep-novo' })
    const edicao = chamadas.find((c) => c.args[0] === 'environment' && c.args[1] === 'edit')!
    expect(edicao.binary).toBe('railway')
    expect(edicao.args).toEqual(
      expect.arrayContaining([
        '--environment', 'staging',
        '--service-config', 'backend', 'source.image', IMAGEM,
        '--service-config', 'backend', 'variables.RELEASE_ID.value', RELEASE,
        '--service-config', 'backend', 'variables.RELEASE_SOURCE_SHA.value', SHA,
        '--json'
      ]) // prettier-ignore
    )
    // O deploy só termina depois de várias listagens: ninguém declara saudável antes do SUCCESS.
    expect(chamadas.filter((c) => c.args[1] === 'list').length).toBeGreaterThanOrEqual(4)
  })

  it('o token vai só no ambiente do filho e é redigido; nunca em argumento', async () => {
    const { runner, chamadas } = railwayFalso([])

    await adapter(runner).deploy(entrada)

    for (const c of chamadas) {
      expect(c.args.join(' ')).not.toContain(TOKEN)
      expect(c.options?.env).toEqual({ RAILWAY_API_TOKEN: TOKEN })
      expect(c.options?.redact).toContain(TOKEN)
      expect(c.options?.cwd).toBe('C:/trabalho/railway')
    }
  })

  it('opera no nome de ambiente configurado, não no rótulo lógico', async () => {
    const { runner, chamadas } = railwayFalso([])

    await adapter(runner, { environments: { staging: 'stg', production: 'prd' } }).deploy({
      ...entrada,
      environment: 'production'
    })

    const alvos = chamadas.map((c) => c.args[c.args.indexOf('--environment') + 1])
    expect(new Set(alvos)).toEqual(new Set(['prd']))
  })

  it('é idempotente: se o ambiente já roda o digest com SUCCESS, devolve o id sem criar outro', async () => {
    const { runner, chamadas } = railwayFalso([
      implantacao('dep-corrente', 'SUCCESS', IMAGEM, 20),
      implantacao('dep-velho', 'REMOVED', IMAGEM_ANTERIOR, 10)
    ])

    const r = await adapter(runner).deploy(entrada)

    expect(r).toEqual({ deploymentId: 'dep-corrente' })
    expect(chamadas.some((c) => c.args[1] === 'edit')).toBe(false)
  })

  it('mesmo digest com deployment que não está em SUCCESS não conta como reuso', async () => {
    const { runner, chamadas } = railwayFalso([
      implantacao('dep-quebrado', 'FAILED', IMAGEM, 20),
      implantacao('dep-velho', 'SUCCESS', IMAGEM_ANTERIOR, 10)
    ])

    const r = await adapter(runner).deploy(entrada)

    expect(r).toEqual({ deploymentId: 'dep-novo' })
    expect(chamadas.some((c) => c.args[1] === 'edit')).toBe(true)
  })

  it.each(['FAILED', 'CRASHED', 'REMOVED'])(
    'deployment novo que termina em %s é falha, não timeout',
    async (status) => {
      const { runner } = railwayFalso([], ['BUILDING', status])

      const falha = await rodar(adapter(runner).deploy(entrada))

      expect(falha).toBeInstanceOf(PromotionProviderError)
      expect(falha).toMatchObject({ code: 'failed' })
    }
  )

  it('deployment que nunca chega ao SUCCESS dentro do prazo é timeout', async () => {
    const { runner } = railwayFalso([], ['DEPLOYING'])

    const falha = await rodar(adapter(runner).deploy(entrada))

    expect(falha).toMatchObject({ code: 'timeout' })
  })

  it('ignora deployments que já existiam: só o novo conta para o veredito', async () => {
    // O velho em FAILED não pode ser confundido com o resultado do deploy em curso.
    const { runner } = railwayFalso(
      [implantacao('dep-velho', 'FAILED', IMAGEM_ANTERIOR, 10)],
      ['DEPLOYING', 'SUCCESS']
    )

    await expect(adapter(runner).deploy(entrada)).resolves.toEqual({ deploymentId: 'dep-novo' })
  })

  it.each([
    ['tag mutável', 'ghcr.io/dono/app:latest'],
    ['tag com versão', 'ghcr.io/dono/app:1.2.3'],
    ['digest curto', 'ghcr.io/dono/app@sha256:abc'],
    ['digest sem repositório', DIGEST],
    ['digest com maiúsculas', `ghcr.io/dono/app@sha256:${'A'.repeat(64)}`],
    ['referência com espaço', `ghcr.io/dono/app @${DIGEST}`],
    ['digest seguido de lixo', `${IMAGEM} --flag`]
  ])('recusa %s antes de qualquer chamada à CLI', async (_nome, imageUri) => {
    const { runner, chamadas } = railwayFalso([])

    const falha = await rodar(adapter(runner).deploy({ ...entrada, imageUri }))

    expect(falha).toMatchObject({ code: 'incompatible-state' })
    expect(chamadas).toHaveLength(0)
  })

  it.each([
    ['preview', 'preview-template'],
    ['maiúsculas', 'Staging'],
    ['vazio', ''],
    ['produção por apelido', 'prod']
  ])('recusa ambiente fora da lista configurada (%s) sem tocar na CLI', async (_n, ambiente) => {
    const { runner, chamadas } = railwayFalso([])

    const falha = await rodar(
      adapter(runner).deploy({ ...entrada, environment: ambiente as 'staging' })
    )

    expect(falha).toMatchObject({ code: 'incompatible-state' })
    expect(chamadas).toHaveLength(0)
  })

  it('recusa identidade de release que quebraria o argumento da CLI', async () => {
    const { runner, chamadas } = railwayFalso([])

    const a = await rodar(adapter(runner).deploy({ ...entrada, releaseId: 'rel; rm -rf /' }))
    const b = await rodar(adapter(runner).deploy({ ...entrada, sourceSha: 'não-é-sha' }))

    expect(a).toMatchObject({ code: 'incompatible-state' })
    expect(b).toMatchObject({ code: 'incompatible-state' })
    expect(chamadas).toHaveLength(0)
  })

  it.each([
    ['auth', erro('Error: Unauthorized. Please login again'), 'auth'],
    ['quota', erro('Error: limit reached for your plan'), 'quota'],
    ['estado incompatível', erro('Error: environment conflict (409)'), 'incompatible-state'],
    ['timeout da CLI', tempo, 'timeout'],
    ['falha genérica', erro('algo estranho aconteceu'), 'failed']
  ])('falha da CLI (%s) vira código fechado, sem texto do provedor', async (_n, resposta, code) => {
    const runner: CommandRunner = { run: async () => resposta }

    const falha = await rodar(adapter(runner).deploy(entrada))

    expect(falha).toBeInstanceOf(PromotionProviderError)
    expect(falha).toMatchObject({ code })
    expect((falha as Error).message).not.toMatch(/Unauthorized|limit reached|conflict|estranho/)
  })

  it('falha da CLI na edição também não deixa o token na mensagem', async () => {
    const runner: CommandRunner = {
      run: async (_b, args) =>
        args[0] === 'environment' ? erro(`falhou com ${TOKEN}`) : ok(JSON.stringify([]))
    }

    const falha = await rodar(adapter(runner).deploy(entrada))

    expect((falha as Error).message).not.toContain(TOKEN)
  })

  it.each([
    ['saída que não é JSON', 'isto não é json'],
    ['objeto sem a chave da lista', '{"outra":1}'],
    ['item sem status', '[{"id":"dep-1","createdAt":"2026-10-14T10:00:00Z"}]'],
    ['item sem id', '[{"status":"SUCCESS","createdAt":"2026-10-14T10:00:00Z"}]'],
    ['lista de strings', '["dep-1"]']
  ])('resposta parcial da listagem (%s) é falha, não ambiente vazio', async (_n, saida) => {
    const runner: CommandRunner = { run: async () => ok(saida) }

    const falha = await rodar(adapter(runner).deploy(entrada))

    expect(falha).toMatchObject({ code: 'failed' })
  })

  it('aceita a lista dentro de um objeto { deployments }', async () => {
    const { runner } = railwayFalso([])
    const envolvido: CommandRunner = {
      run: async (b, a, o) => {
        const r = await runner.run(b, a, o)
        return a[1] === 'list' ? ok(JSON.stringify({ deployments: JSON.parse(r.stdout) })) : r
      }
    }

    await expect(adapter(envolvido).deploy(entrada)).resolves.toEqual({ deploymentId: 'dep-novo' })
  })
})

describe('RailwayPromotionBackendAdapter.current', () => {
  it('devolve o SUCCESS mais recente com o digest da imagem', async () => {
    const { runner, chamadas } = railwayFalso([
      implantacao('dep-velho', 'SUCCESS', IMAGEM_ANTERIOR, 10),
      implantacao('dep-corrente', 'SUCCESS', IMAGEM, 20),
      implantacao('dep-quebrado', 'FAILED', IMAGEM_ANTERIOR, 30)
    ])

    const r = await adapter(runner).current('production')

    expect(r).toEqual({ deploymentId: 'dep-corrente', digest: DIGEST })
    expect(chamadas[0].args).toEqual(
      expect.arrayContaining(['deployment', 'list', '--service', 'backend', '--environment', 'production', '--json'])
    ) // prettier-ignore
  })

  it('devolve null quando o ambiente nunca teve um deployment saudável', async () => {
    const { runner } = railwayFalso([
      implantacao('dep-1', 'FAILED', IMAGEM, 10),
      implantacao('dep-2', 'BUILDING', IMAGEM, 20)
    ])

    await expect(adapter(runner).current('staging')).resolves.toBeNull()
  })

  it('devolve null com a lista vazia', async () => {
    const { runner } = railwayFalso([])

    await expect(adapter(runner).current('staging')).resolves.toBeNull()
  })

  it('SUCCESS sem digest legível é falha: null reconciliaria como ambiente vazio', async () => {
    const { runner } = railwayFalso([implantacao('dep-1', 'SUCCESS', null, 10)])

    await expect(adapter(runner).current('staging')).rejects.toMatchObject({ code: 'failed' })
  })

  it('lê a imagem aninhada na meta quando ela não está na raiz', async () => {
    const aninhado: CommandRunner = {
      run: async () =>
        ok(
          JSON.stringify([
            {
              id: 'dep-1',
              status: 'SUCCESS',
              createdAt: '2026-10-14T10:00:00Z',
              meta: { serviceManifest: { deploy: { source: { image: IMAGEM } } } }
            }
          ])
        )
    }

    await expect(adapter(aninhado).current('staging')).resolves.toEqual({
      deploymentId: 'dep-1',
      digest: DIGEST
    })
  })

  it('recusa ambiente fora da lista configurada', async () => {
    const { runner, chamadas } = railwayFalso([])

    await expect(adapter(runner).current('homolog' as 'staging')).rejects.toMatchObject({
      code: 'incompatible-state'
    })
    expect(chamadas).toHaveLength(0)
  })
})

describe('RailwayPromotionBackendAdapter.rollback', () => {
  const historico = () => [
    implantacao('dep-ruim', 'SUCCESS', IMAGEM, 30),
    implantacao('dep-bom', 'REMOVED', IMAGEM_ANTERIOR, 20)
  ]

  it('reimplanta a imagem do deployment alvo (CLI não tem rollback por id) e espera o SUCCESS', async () => {
    const { runner, chamadas } = railwayFalso(historico(), ['DEPLOYING', 'SUCCESS'])

    await adapter(runner).rollback({ environment: 'production', toDeploymentId: 'dep-bom' })

    const edicao = chamadas.find((c) => c.args[1] === 'edit')!
    expect(edicao.args).toEqual(
      expect.arrayContaining([
        '--environment', 'production',
        '--service-config', 'backend', 'source.image', IMAGEM_ANTERIOR
      ]) // prettier-ignore
    )
    expect(edicao.args.join(' ')).not.toContain('variables.')
    expect(chamadas.filter((c) => c.args[1] === 'list').length).toBeGreaterThanOrEqual(2)
  })

  it('rollback que não chega a SUCCESS propaga a falha', async () => {
    const { runner } = railwayFalso(historico(), ['CRASHED'])

    await expect(
      adapter(runner).rollback({ environment: 'production', toDeploymentId: 'dep-bom' })
    ).rejects.toMatchObject({ code: 'failed' })
  })

  it('rollback que estoura o prazo é timeout', async () => {
    const { runner } = railwayFalso(historico(), ['DEPLOYING'])

    await expect(
      adapter(runner).rollback({ environment: 'production', toDeploymentId: 'dep-bom' })
    ).rejects.toMatchObject({ code: 'timeout' })
  })

  it('deployment alvo desconhecido é not-found e nada é alterado', async () => {
    const { runner, chamadas } = railwayFalso(historico())

    await expect(
      adapter(runner).rollback({ environment: 'production', toDeploymentId: 'dep-fantasma' })
    ).rejects.toMatchObject({ code: 'not-found' })
    expect(chamadas.some((c) => c.args[1] === 'edit')).toBe(false)
  })

  it.each(['FAILED', 'CRASHED'])(
    'deployment alvo em %s nunca é um destino de rollback',
    async (status) => {
      const { runner, chamadas } = railwayFalso([
        implantacao('dep-bom', status, IMAGEM_ANTERIOR, 20)
      ])

      await expect(
        adapter(runner).rollback({ environment: 'production', toDeploymentId: 'dep-bom' })
      ).rejects.toMatchObject({ code: 'incompatible-state' })
      expect(chamadas.some((c) => c.args[1] === 'edit')).toBe(false)
    }
  )

  it('alvo sem imagem por digest na meta é estado incompatível', async () => {
    const { runner, chamadas } = railwayFalso([implantacao('dep-bom', 'REMOVED', null, 20)])

    await expect(
      adapter(runner).rollback({ environment: 'production', toDeploymentId: 'dep-bom' })
    ).rejects.toMatchObject({ code: 'incompatible-state' })
    expect(chamadas.some((c) => c.args[1] === 'edit')).toBe(false)
  })

  it('é idempotente: se o ambiente já serve o alvo, não cria outro deployment', async () => {
    const { runner, chamadas } = railwayFalso([
      implantacao('dep-bom', 'SUCCESS', IMAGEM_ANTERIOR, 20)
    ])

    await adapter(runner).rollback({ environment: 'production', toDeploymentId: 'dep-bom' })

    expect(chamadas.some((c) => c.args[1] === 'edit')).toBe(false)
  })

  it('recusa ambiente fora da lista configurada', async () => {
    const { runner, chamadas } = railwayFalso(historico())

    await expect(
      adapter(runner).rollback({ environment: 'preview' as 'staging', toDeploymentId: 'dep-bom' })
    ).rejects.toMatchObject({ code: 'incompatible-state' })
    expect(chamadas).toHaveLength(0)
  })
})

describe('RailwayPromotionBackendAdapter (configuração)', () => {
  it.each([
    ['ambientes iguais', { staging: 'x', production: 'x' }],
    ['staging vazio', { staging: '', production: 'production' }],
    ['production vazio', { staging: 'staging', production: '' }]
  ])('recusa configuração com %s', (_n, environments) => {
    const { runner } = railwayFalso([])
    expect(
      () => new RailwayPromotionBackendAdapter(runner, { ...CONFIG_BASE, environments })
    ).toThrow(TypeError)
  })
})
