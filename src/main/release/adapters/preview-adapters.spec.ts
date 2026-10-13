import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PreviewProviderError } from '../preview-ports'
import type { CommandOptions, CommandResult, CommandRunner } from './command-runner'
import { RailwayBackendAdapter, type RailwayPreviewConfig } from './railway-backend-adapter'
import { RailwayDatabaseAdapter } from './railway-database-adapter'
import { VercelFrontendAdapter } from './vercel-frontend-adapter'

const TOKEN = 'tok_SEGREDO_DO_PROVEDOR_123'
const SENHA = 'senha-do-banco-temporario'
const DIGEST = `sha256:${'a'.repeat(64)}`
const IMAGEM = `ghcr.io/dono/app@${DIGEST}`
const NOME = 'pv-0f3a9c1e77b2-g1'
const RUN = '0f3a9c1e-77b2-4d5e-9a10-aaaaaaaaaaaa'
const SHA = 'b'.repeat(40)

const CONFIG: RailwayPreviewConfig = {
  workdir: 'C:/trabalho/railway',
  token: TOKEN,
  templateEnvironment: 'preview-template',
  backendService: 'backend',
  databaseService: 'postgres',
  backendPort: 3311
}

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

/** Runner roteirizado por prefixo do comando; registra argumentos e opções de cada chamada. */
function runnerDe(
  roteiro: (chamada: Chamada, indice: number) => CommandResult
): CommandRunner & { chamadas: Chamada[] } {
  const chamadas: Chamada[] = []
  return {
    chamadas,
    async run(binary, args, options) {
      const chamada = { binary, args: [...args], options }
      chamadas.push(chamada)
      return roteiro(chamada, chamadas.length - 1)
    }
  }
}

const comecaCom = (c: Chamada, ...prefixo: string[]): boolean =>
  prefixo.every((p, i) => c.args[i] === p)

describe('RailwayBackendAdapter', () => {
  function ambienteNovo(): ReturnType<typeof runnerDe> {
    let criado = false
    return runnerDe((c) => {
      if (comecaCom(c, 'environment', 'list'))
        return ok(criado ? JSON.stringify([{ id: 'env-1', name: NOME }]) : '[]')
      if (comecaCom(c, 'environment', 'new')) {
        criado = true
        return ok('{}')
      }
      if (comecaCom(c, 'domain', 'list'))
        return ok(criado ? JSON.stringify([{ domain: `api-${NOME}.up.railway.app` }]) : '[]')
      throw new Error(`comando inesperado: ${c.args.join(' ')}`)
    })
  }

  it('cria o ambiente duplicando o modelo, com imagem por digest e identidade do run', async () => {
    const runner = ambienteNovo()
    const r = await new RailwayBackendAdapter(runner, CONFIG).provision({
      name: NOME, imageUri: IMAGEM, sourceSha: SHA, previewRunId: RUN
    }) // prettier-ignore

    expect(r).toEqual({
      externalId: 'env-1',
      backendUrl: `https://api-${NOME}.up.railway.app`,
      databaseExternalId: 'env-1:postgres'
    })
    const novo = runner.chamadas.find((c) => comecaCom(c, 'environment', 'new'))!
    expect(novo.args).toEqual(
      expect.arrayContaining(['--duplicate', 'preview-template', IMAGEM, RUN, SHA])
    )
  })

  it('o token vai só no ambiente do processo filho, redigido, e nunca em argumento', async () => {
    const runner = ambienteNovo()
    await new RailwayBackendAdapter(runner, CONFIG).provision({
      name: NOME, imageUri: IMAGEM, sourceSha: SHA, previewRunId: RUN
    }) // prettier-ignore

    for (const c of runner.chamadas) {
      expect(c.args.join(' ')).not.toContain(TOKEN)
      expect(c.options?.env).toEqual({ RAILWAY_API_TOKEN: TOKEN })
      expect(c.options?.redact).toContain(TOKEN)
      expect(c.options?.cwd).toBe(CONFIG.workdir)
    }
  })

  it('ambiente que já existe é atualizado no lugar, nunca recriado', async () => {
    const runner = runnerDe((c) => {
      if (comecaCom(c, 'environment', 'list'))
        return ok(JSON.stringify({ environments: [{ id: 'env-1', name: NOME }] }))
      if (comecaCom(c, 'environment', 'edit')) return ok('{}')
      if (comecaCom(c, 'domain', 'list')) return ok(JSON.stringify([`api-${NOME}.up.railway.app`]))
      throw new Error(`comando inesperado: ${c.args.join(' ')}`)
    })
    await new RailwayBackendAdapter(runner, CONFIG).provision({
      name: NOME, imageUri: IMAGEM, sourceSha: SHA, previewRunId: RUN
    }) // prettier-ignore

    expect(runner.chamadas.some((c) => comecaCom(c, 'environment', 'new'))).toBe(false)
    expect(runner.chamadas.some((c) => comecaCom(c, 'environment', 'edit'))).toBe(true)
  })

  it('só procura por nome exato: prefixo parecido não conta como posse', async () => {
    const runner = runnerDe((c) => {
      if (comecaCom(c, 'environment', 'list'))
        return ok(JSON.stringify([{ id: 'x', name: `${NOME}-extra` }]))
      return ok('{}')
    })
    expect(await new RailwayBackendAdapter(runner, CONFIG).destroy(NOME)).toBe('absent')
    expect(runner.chamadas.some((c) => comecaCom(c, 'environment', 'delete'))).toBe(false)
  })

  it('recusa ambiente que não tem nome de Preview, mesmo existindo (Produção, Staging)', async () => {
    const runner = runnerDe(() => ok('[]'))
    const adapter = new RailwayBackendAdapter(runner, CONFIG)
    for (const nome of ['production', 'staging', 'preview-base'])
      await expect(adapter.destroy(nome)).rejects.toMatchObject({ code: 'incompatible-state' })
    expect(runner.chamadas).toEqual([])
  })

  it('recusa como modelo Staging, Produção ou outro Preview', () => {
    for (const modelo of [
      'production',
      'Staging',
      'prod-clone',
      'main',
      'preview-base',
      NOME,
      'preview-template/../production'
    ])
      expect(
        () =>
          new RailwayBackendAdapter(
            runnerDe(() => ok()),
            { ...CONFIG, templateEnvironment: modelo }
          )
      ).toThrow(TypeError)
  })

  it('recusa imagem sem digest (tag é mutável)', async () => {
    await expect(
      new RailwayBackendAdapter(runnerDe(() => ok('[]')), CONFIG).provision({
        name: NOME, imageUri: 'ghcr.io/dono/app:latest', sourceSha: SHA, previewRunId: RUN
      }) // prettier-ignore
    ).rejects.toMatchObject({ code: 'incompatible-state' })
  })

  it('apagar só vale se o ambiente sumiu: exit 0 com o ambiente ainda lá é falha', async () => {
    const runner = runnerDe((c) => {
      if (comecaCom(c, 'environment', 'list'))
        return ok(JSON.stringify([{ id: 'env-1', name: NOME }]))
      return ok('{}')
    })
    await expect(new RailwayBackendAdapter(runner, CONFIG).destroy(NOME)).rejects.toMatchObject({
      code: 'failed'
    })
  })

  it('apaga e confirma quando o ambiente some da listagem', async () => {
    let apagado = false
    const runner = runnerDe((c) => {
      if (comecaCom(c, 'environment', 'list'))
        return ok(apagado ? '[]' : JSON.stringify([{ id: 'env-1', name: NOME }]))
      if (comecaCom(c, 'environment', 'delete')) {
        apagado = true
        return ok('{}')
      }
      throw new Error('inesperado')
    })
    expect(await new RailwayBackendAdapter(runner, CONFIG).destroy(NOME)).toBe('destroyed')
  })

  it.each([
    ['auth', erro('Unauthorized: invalid token')],
    ['quota', erro('Error: project limit reached for your plan')],
    ['timeout', tempo],
    ['incompatible-state', erro('environment already exists')],
    ['failed', erro('algo estranho', 2)]
  ] as const)(
    'classifica a falha %s sem repassar o texto do provedor',
    async (codigo, resposta) => {
      const runner = runnerDe((c) => (comecaCom(c, 'environment', 'list') ? ok('[]') : resposta))
      const falha = await new RailwayBackendAdapter(runner, CONFIG)
        .provision({ name: NOME, imageUri: IMAGEM, sourceSha: SHA, previewRunId: RUN })
        .catch((e: unknown) => e)

      expect(falha).toBeInstanceOf(PreviewProviderError)
      expect((falha as PreviewProviderError).code).toBe(codigo)
      expect((falha as PreviewProviderError).message).not.toMatch(
        /Unauthorized|limit reached|already exists|estranho/
      )
    }
  )

  it('JSON ilegível é falha do provedor, não lista vazia que autoriza criar', async () => {
    const runner = runnerDe(() => ok('isto não é json'))
    await expect(
      new RailwayBackendAdapter(runner, CONFIG).provision({
        name: NOME, imageUri: IMAGEM, sourceSha: SHA, previewRunId: RUN
      }) // prettier-ignore
    ).rejects.toMatchObject({ code: 'failed' })
  })
})

describe('RailwayDatabaseAdapter', () => {
  function banco(psql: (c: Chamada) => CommandResult): ReturnType<typeof runnerDe> {
    return runnerDe((c) => {
      if (c.binary === 'railway' && comecaCom(c, 'tcp-proxy', 'list')) return ok('[]')
      if (c.binary === 'railway' && comecaCom(c, 'tcp-proxy', 'create')) return ok('{}')
      if (c.binary === 'railway' && comecaCom(c, 'variable', 'list'))
        return ok(JSON.stringify({
          RAILWAY_TCP_PROXY_DOMAIN: 'proxy.rlwy.net',
          RAILWAY_TCP_PROXY_PORT: '12345',
          PGUSER: 'postgres',
          PGPASSWORD: SENHA,
          PGDATABASE: 'railway'
        })) // prettier-ignore
      return psql(c)
    })
  }

  const entrada = {
    name: NOME,
    migrations: [{ id: '001_base', sql: 'CREATE TABLE t(id int);', checksum: 'c'.repeat(64) }],
    seed: 'INSERT INTO t VALUES (1);'
  }

  it('aplica migrations e seed pela conexão do próprio ambiente, com a senha só no env', async () => {
    const runner = banco((c) => {
      const sql = (c.options?.input ?? '').toString()
      if (c.binary === 'psql' && sql.startsWith('SELECT id')) return ok('')
      if (c.binary === 'pg_dump') return ok('-- dump\nCREATE TABLE t(id int);')
      return ok('')
    })

    const r = await new RailwayDatabaseAdapter(runner, CONFIG).migrateAndSeed(entrada)

    expect(r).toMatchObject({ state: 'confirmed', applied: ['001_base'], seedApplied: true })
    const doBanco = runner.chamadas.filter((c) => c.binary === 'psql' || c.binary === 'pg_dump')
    expect(doBanco.length).toBeGreaterThan(0)
    for (const c of doBanco) {
      expect(c.args.join(' ')).not.toContain(SENHA)
      expect(c.options?.env).toMatchObject({
        PGPASSWORD: SENHA,
        PGHOST: 'proxy.rlwy.net',
        PGPORT: '12345',
        PGSSLMODE: 'require'
      })
      expect(c.options?.redact).toContain(SENHA)
    }
  })

  it('migration que falha devolve o código e não a saída do banco', async () => {
    const runner = banco((c) => {
      const sql = (c.options?.input ?? '').toString()
      if (sql.startsWith('SELECT id')) return ok('')
      if (sql.includes('CREATE TABLE t')) return erro(`ERRO: relação "t" já existe ${SENHA}`)
      return ok('')
    })

    const r = await new RailwayDatabaseAdapter(runner, CONFIG).migrateAndSeed(entrada)

    expect(r).toMatchObject({ state: 'failed', reason: 'migration-failed', failedAt: '001_base' })
    expect(JSON.stringify(r)).not.toContain(SENHA)
  })

  it('só abre o proxy do banco se ainda não houver um', async () => {
    const runner = runnerDe((c) => {
      if (comecaCom(c, 'tcp-proxy', 'list'))
        return ok(JSON.stringify([{ domain: 'proxy.rlwy.net' }]))
      if (comecaCom(c, 'variable', 'list'))
        return ok(
          JSON.stringify({
            RAILWAY_TCP_PROXY_DOMAIN: 'p',
            RAILWAY_TCP_PROXY_PORT: '1',
            PGUSER: 'u',
            PGPASSWORD: SENHA,
            PGDATABASE: 'd'
          })
        )
      return ok('')
    })
    await new RailwayDatabaseAdapter(runner, CONFIG).migrateAndSeed(entrada)
    expect(runner.chamadas.some((c) => comecaCom(c, 'tcp-proxy', 'create'))).toBe(false)
  })

  it('banco sem a variável de conexão é estado incompatível, não conexão chutada', async () => {
    const runner = runnerDe((c) => (comecaCom(c, 'variable', 'list') ? ok('{}') : ok('[]')))
    await expect(
      new RailwayDatabaseAdapter(runner, CONFIG).migrateAndSeed(entrada)
    ).rejects.toMatchObject({
      code: 'incompatible-state'
    })
  })

  it('SQL com barra invertida é recusado antes de qualquer conexão (meta-comando do psql)', async () => {
    const BARRA = String.fromCharCode(92)
    const casos = [
      {
        ...entrada,
        seed: `SELECT 1;
${BARRA}! calc`
      },
      {
        ...entrada,
        migrations: [{ id: '001_base', sql: `select 1 ${BARRA}! calc`, checksum: 'c'.repeat(64) }]
      }
    ]
    for (const caso of casos) {
      const runner = runnerDe(() => ok(''))
      await expect(
        new RailwayDatabaseAdapter(runner, CONFIG).migrateAndSeed(caso)
      ).rejects.toMatchObject({
        code: 'incompatible-state'
      })
      expect(runner.chamadas).toEqual([])
    }
  })

  it('recusa ambiente que não é de Preview antes de qualquer chamada', async () => {
    const runner = runnerDe(() => ok(''))
    await expect(
      new RailwayDatabaseAdapter(runner, CONFIG).migrateAndSeed({ ...entrada, name: 'production' })
    ).rejects.toMatchObject({ code: 'incompatible-state' })
    expect(runner.chamadas).toEqual([])
  })
})

describe('VercelFrontendAdapter', () => {
  const VERCEL = { workdir: 'C:/trabalho/vercel', token: TOKEN, apiUrlVariable: 'VITE_API_URL' }
  const BACKEND = 'https://api-pv.up.railway.app'
  const entradaVercel = { previewRunId: RUN, sourceSha: SHA, backendUrl: BACKEND }

  it('implanta com a marca de posse e a URL do backend recebido, nada mais', async () => {
    const runner = runnerDe((c) => {
      if (comecaCom(c, 'list')) return ok(JSON.stringify({ deployments: [] }))
      if (comecaCom(c, 'deploy'))
        return ok(JSON.stringify({ deployment: { id: 'dpl_abc12345', url: 'web-pv.vercel.app' } }))
      throw new Error('inesperado')
    })

    const r = await new VercelFrontendAdapter(runner, VERCEL).deploy(entradaVercel)

    expect(r).toEqual({ externalId: 'dpl_abc12345', url: 'https://web-pv.vercel.app' })
    const deploy = runner.chamadas.find((c) => comecaCom(c, 'deploy'))!
    expect(deploy.args).toEqual(
      expect.arrayContaining([
        `jarvisPreviewRun=${RUN}`,
        `jarvisSha=${SHA}`,
        `VITE_API_URL=${BACKEND}`
      ])
    )
    expect(deploy.args.join(' ')).not.toContain(TOKEN)
    expect(deploy.options?.env).toEqual({ VERCEL_TOKEN: TOKEN })
  })

  const marcaDoBackend = createHash('sha256')
    .update(new URL(BACKEND).origin)
    .digest('hex')
    .slice(0, 16)
  const meta = { jarvisPreviewRun: RUN, jarvisSha: SHA, jarvisBackend: marcaDoBackend }
  const listaCom = (deployments: unknown[]) => JSON.stringify({ deployments })

  it('reaproveita deployment pronto com a mesma identidade em vez de criar outro', async () => {
    const runner = runnerDe((c) => {
      if (comecaCom(c, 'list'))
        return ok(
          listaCom([{ uid: 'dpl_pronto123', url: 'web-1.vercel.app', state: 'READY', meta }])
        )
      throw new Error('não deveria implantar')
    })
    const r = await new VercelFrontendAdapter(runner, VERCEL).deploy(entradaVercel)
    expect(r.externalId).toBe('dpl_pronto123')
    expect(runner.chamadas.some((c) => comecaCom(c, 'deploy'))).toBe(false)
  })

  it('deployment ainda em build não é reaproveitado', async () => {
    const runner = runnerDe((c) => {
      if (comecaCom(c, 'list'))
        return ok(
          listaCom([{ uid: 'dpl_build1234', url: 'x.vercel.app', state: 'BUILDING', meta }])
        )
      return ok(JSON.stringify({ deployment: { id: 'dpl_novo12345', url: 'novo.vercel.app' } }))
    })
    const r = await new VercelFrontendAdapter(runner, VERCEL).deploy(entradaVercel)
    expect(r.externalId).toBe('dpl_novo12345')
  })

  it('não confia no filtro da CLI: deployment de outro run ou de outro commit não é reaproveitado', async () => {
    const runner = runnerDe((c) => {
      if (comecaCom(c, 'list'))
        return ok(
          listaCom([
            {
              uid: 'dpl_outrorun1',
              url: 'a.vercel.app',
              state: 'READY',
              meta: { ...meta, jarvisPreviewRun: 'outro-run-aaaa' }
            },
            {
              uid: 'dpl_outrosha1',
              url: 'b.vercel.app',
              state: 'READY',
              meta: { ...meta, jarvisSha: 'c'.repeat(40) }
            }
          ])
        )
      return ok(JSON.stringify({ deployment: { id: 'dpl_novo12345', url: 'novo.vercel.app' } }))
    })
    const r = await new VercelFrontendAdapter(runner, VERCEL).deploy(entradaVercel)
    expect(r.externalId).toBe('dpl_novo12345')
  })

  it('deployment de produção nunca é tratado como do Preview, mesmo com a marca', async () => {
    const runner = runnerDe(() =>
      ok(
        listaCom([
          { uid: 'dpl_producao1', url: 'p.vercel.app', state: 'READY', target: 'production', meta }
        ])
      )
    )
    expect(await new VercelFrontendAdapter(runner, VERCEL).list(RUN)).toEqual([])
  })

  it('resposta sem a marca de posse é falha, nunca "todos os deployments do projeto"', async () => {
    const runner = runnerDe(() => ok(listaCom([{ uid: 'dpl_semmeta11', url: 'p.vercel.app' }])))
    await expect(new VercelFrontendAdapter(runner, VERCEL).list(RUN)).rejects.toMatchObject({
      code: 'incompatible-state'
    })
  })

  it('domínio fora de vercel.app não chega ao PR', async () => {
    const runner = runnerDe((c) =>
      comecaCom(c, 'list')
        ? ok(listaCom([]))
        : ok(JSON.stringify({ deployment: { id: 'dpl_novo12345', url: 'evil.example.com' } }))
    )
    await expect(
      new VercelFrontendAdapter(runner, VERCEL).deploy(entradaVercel)
    ).rejects.toMatchObject({ code: 'incompatible-state' })
  })

  it('lista apenas deployments com a marca do run', async () => {
    const runner = runnerDe(() =>
      ok(
        listaCom([
          { uid: 'dpl_aaaaaa11', meta },
          { uid: 'lixo', meta },
          { id: 'dpl_bbbbbb22', meta },
          { uid: 'dpl_dooutro11', meta: { jarvisPreviewRun: 'outro-run-aaaa' } }
        ])
      )
    )
    expect(await new VercelFrontendAdapter(runner, VERCEL).list(RUN)).toEqual([
      'dpl_aaaaaa11',
      'dpl_bbbbbb22'
    ])
    expect(runner.chamadas[0]!.args).toEqual(
      expect.arrayContaining(['--meta', `jarvisPreviewRun=${RUN}`])
    )
  })

  it('remover: sucesso, ausente e falha', async () => {
    const respostas = [ok(), erro('Error: deployment not found', 1), erro('Unauthorized')]
    const runner = runnerDe((_c, i) => respostas[i]!)
    const adapter = new VercelFrontendAdapter(runner, VERCEL)
    expect(await adapter.destroy('dpl_abcdef12')).toBe('destroyed')
    expect(await adapter.destroy('dpl_abcdef12')).toBe('absent')
    await expect(adapter.destroy('dpl_abcdef12')).rejects.toMatchObject({ code: 'auth' })
  })

  it('só remove identificador de deployment, nunca nome de projeto', async () => {
    const runner = runnerDe(() => ok())
    await expect(
      new VercelFrontendAdapter(runner, VERCEL).destroy('meu-projeto')
    ).rejects.toMatchObject({
      code: 'incompatible-state'
    })
    expect(runner.chamadas).toEqual([])
  })

  it('backend que não é https não recebe frontend', async () => {
    const runner = runnerDe(() => ok())
    await expect(
      new VercelFrontendAdapter(runner, VERCEL).deploy({
        ...entradaVercel,
        backendUrl: 'http://api.local'
      })
    ).rejects.toMatchObject({ code: 'incompatible-state' })
  })

  it.each([
    ['quota', erro('Error: rate limit exceeded (429)')],
    ['timeout', tempo]
  ] as const)('classifica %s ao implantar', async (codigo, resposta) => {
    const runner = runnerDe((c) => (comecaCom(c, 'list') ? ok('{"deployments":[]}') : resposta))
    await expect(
      new VercelFrontendAdapter(runner, VERCEL).deploy(entradaVercel)
    ).rejects.toMatchObject({ code: codigo })
  })

  it('recusa nome de variável de ambiente fora do padrão', () => {
    expect(
      () =>
        new VercelFrontendAdapter(
          runnerDe(() => ok()),
          { ...VERCEL, apiUrlVariable: 'x; rm' }
        )
    ).toThrow(TypeError)
  })
})
