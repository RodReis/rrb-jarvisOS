import { describe, expect, it } from 'vitest'
import { PreviewProviderError } from '../preview-ports'
import type { CommandOptions, CommandResult, CommandRunner } from './command-runner'
import { VercelPromotionAdapter, type VercelPromotionConfig } from './vercel-promotion-adapter'

const TOKEN = 'tok_SEGREDO_DO_PROVEDOR_123'
const RELEASE = '0f3a9c1e-77b2-4d5e-9a10-aaaaaaaaaaaa'
const SHA = 'b'.repeat(40)
const DPL = 'dpl_abc12345'
const OUTRO = 'dpl_outro9876'
const CONFIG: VercelPromotionConfig = {
  workdir: 'C:/trabalho/vercel',
  token: TOKEN,
  stagingDomain: 'https://staging.jarvis.app',
  productionDomain: 'https://jarvis.app'
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

/** Runner roteirizado: registra argumentos e opções; o roteiro decide a resposta de cada chamada. */
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
const adapterDe = (runner: CommandRunner, config = CONFIG) =>
  new VercelPromotionAdapter(runner, config)

const meta = { jarvisRelease: RELEASE, jarvisSha: SHA }
const lista = (deployments: unknown[]) => JSON.stringify({ deployments })
const inspecao = (id: string) => JSON.stringify({ id, url: 'x.vercel.app', readyState: 'READY' })
const criado = (id = DPL) => JSON.stringify({ deployment: { id, url: 'web.vercel.app' } })

describe('VercelPromotionAdapter.build', () => {
  it('cria deployment de preview com a marca do release, sem --prod e sem URL de backend', async () => {
    const runner = runnerDe((c) => (comecaCom(c, 'list') ? ok(lista([])) : ok(criado())))

    const r = await adapterDe(runner).build({ releaseId: RELEASE, sourceSha: SHA })

    expect(r).toEqual({ deploymentId: DPL })
    const deploy = runner.chamadas.find((c) => comecaCom(c, 'deploy'))!
    expect(deploy.binary).toBe('vercel')
    expect(deploy.args).toEqual(
      expect.arrayContaining([
        '--meta',
        `jarvisRelease=${RELEASE}`,
        `jarvisSha=${SHA}`,
        '--format',
        'json'
      ])
    )
    for (const proibido of ['--prod', '--target', '--build-env', '--env', '-b', '-e'])
      expect(deploy.args).not.toContain(proibido)
    expect(deploy.options?.cwd).toBe(CONFIG.workdir)
  })

  it('reaproveita deployment READY com a mesma identidade', async () => {
    const runner = runnerDe((c) => {
      if (comecaCom(c, 'list'))
        return ok(lista([{ uid: DPL, url: 'a.vercel.app', state: 'READY', meta }]))
      throw new Error('não deveria implantar')
    })
    expect(await adapterDe(runner).build({ releaseId: RELEASE, sourceSha: SHA })).toEqual({
      deploymentId: DPL
    })
    expect(runner.chamadas.some((c) => comecaCom(c, 'deploy'))).toBe(false)
  })

  it('reaproveita o deployment mesmo depois de promovido (target production com a marca)', async () => {
    const runner = runnerDe((c) => {
      if (comecaCom(c, 'list'))
        return ok(
          lista([{ uid: DPL, url: 'a.vercel.app', state: 'READY', target: 'production', meta }])
        )
      throw new Error('não deveria implantar')
    })
    expect(
      (await adapterDe(runner).build({ releaseId: RELEASE, sourceSha: SHA })).deploymentId
    ).toBe(DPL)
  })

  it('não reaproveita deployment em build, de outro release ou de outro commit', async () => {
    const runner = runnerDe((c) =>
      comecaCom(c, 'list')
        ? ok(
            lista([
              { uid: 'dpl_building1', state: 'BUILDING', meta },
              {
                uid: 'dpl_outrorel1',
                state: 'READY',
                meta: { ...meta, jarvisRelease: 'outro-aaaa' }
              },
              { uid: 'dpl_outrosha1', state: 'READY', meta: { ...meta, jarvisSha: 'c'.repeat(40) } }
            ])
          )
        : ok(criado('dpl_novo12345'))
    )
    expect(
      (await adapterDe(runner).build({ releaseId: RELEASE, sourceSha: SHA })).deploymentId
    ).toBe('dpl_novo12345')
  })

  it('resposta sem a marca de posse é falha, nunca "tudo é do release"', async () => {
    const runner = runnerDe(() => ok(lista([{ uid: DPL, state: 'READY' }])))
    await expect(
      adapterDe(runner).build({ releaseId: RELEASE, sourceSha: SHA })
    ).rejects.toMatchObject({ code: 'incompatible-state' })
    expect(runner.chamadas.some((c) => comecaCom(c, 'deploy'))).toBe(false)
  })

  it('aceita a lista como array puro', async () => {
    const runner = runnerDe((c) =>
      comecaCom(c, 'list') ? ok(JSON.stringify([{ id: DPL, state: 'READY', meta }])) : ok('{}')
    )
    expect(
      (await adapterDe(runner).build({ releaseId: RELEASE, sourceSha: SHA })).deploymentId
    ).toBe(DPL)
  })

  it.each([
    ['JSON parcial na lista', '{"deployments": [', 'failed'],
    ['lista que não é array', '{"deployments": {"a": 1}}', 'failed']
  ])('%s é falha', async (_nome, saida, codigo) => {
    const runner = runnerDe(() => ok(saida))
    await expect(
      adapterDe(runner).build({ releaseId: RELEASE, sourceSha: SHA })
    ).rejects.toMatchObject({ code: codigo })
  })

  it('deploy sem identidade legível é falha', async () => {
    const runner = runnerDe((c) => (comecaCom(c, 'list') ? ok(lista([])) : ok('{"inesperado":1}')))
    await expect(
      adapterDe(runner).build({ releaseId: RELEASE, sourceSha: SHA })
    ).rejects.toMatchObject({ code: 'failed' })
  })

  it('id de deployment fora do formato dpl_ é falha', async () => {
    const runner = runnerDe((c) => (comecaCom(c, 'list') ? ok(lista([])) : ok(criado('lixo'))))
    await expect(
      adapterDe(runner).build({ releaseId: RELEASE, sourceSha: SHA })
    ).rejects.toMatchObject({ code: 'failed' })
  })

  it.each([
    ['auth', erro('Error: You are not logged in. Unauthorized')],
    ['quota', erro('Error: rate limit exceeded (429)')],
    ['incompatible-state', erro('Error: alias already exists')],
    ['timeout', tempo]
  ] as const)('classifica %s ao implantar sem vazar a mensagem do provedor', async (codigo, r) => {
    const runner = runnerDe((c) => (comecaCom(c, 'list') ? ok(lista([])) : r))
    const falha = await adapterDe(runner)
      .build({ releaseId: RELEASE, sourceSha: SHA })
      .catch((e: unknown) => e)
    expect(falha).toBeInstanceOf(PreviewProviderError)
    expect(falha).toMatchObject({ code: codigo })
    expect((falha as Error).message).not.toContain('Unauthorized')
  })

  it('recusa identidade inválida antes de qualquer comando', async () => {
    const runner = runnerDe(() => ok())
    const adapter = adapterDe(runner)
    await expect(adapter.build({ releaseId: 'x; rm', sourceSha: SHA })).rejects.toMatchObject({
      code: 'incompatible-state'
    })
    await expect(adapter.build({ releaseId: RELEASE, sourceSha: 'zzz' })).rejects.toMatchObject({
      code: 'incompatible-state'
    })
    expect(runner.chamadas).toEqual([])
  })

  it('o token vai só no env do filho, redigido, e nunca em argumento', async () => {
    const runner = runnerDe((c) => (comecaCom(c, 'list') ? ok(lista([])) : ok(criado())))
    await adapterDe(runner, { ...CONFIG, scope: 'minha-equipe' }).build({
      releaseId: RELEASE,
      sourceSha: SHA
    })
    for (const c of runner.chamadas) {
      expect(c.args.join(' ')).not.toContain(TOKEN)
      expect(c.options?.env).toEqual({ VERCEL_TOKEN: TOKEN })
      expect(c.options?.redact).toEqual([TOKEN])
      expect(c.args).toEqual(expect.arrayContaining(['--scope', 'minha-equipe']))
    }
  })
})

describe('VercelPromotionAdapter.current', () => {
  it('Staging: lê o deployment para o qual o alias aponta', async () => {
    const runner = runnerDe(() => ok(inspecao(DPL)))
    expect(await adapterDe(runner).current('staging')).toBe(DPL)
    expect(runner.chamadas[0]!.args.slice(0, 2)).toEqual(['inspect', 'staging.jarvis.app'])
    expect(runner.chamadas[0]!.args).toEqual(expect.arrayContaining(['--format', 'json']))
  })

  it('Produção: lê o domínio de produção, não o de Staging', async () => {
    const runner = runnerDe(() => ok(inspecao(OUTRO)))
    expect(await adapterDe(runner).current('production')).toBe(OUTRO)
    expect(runner.chamadas[0]!.args[1]).toBe('jarvis.app')
  })

  it('aceita o id aninhado em `deployment` e `uid`', async () => {
    expect(
      await adapterDe(runnerDe(() => ok(JSON.stringify({ deployment: { uid: DPL } })))).current(
        'staging'
      )
    ).toBe(DPL)
  })

  it('alias inexistente devolve null', async () => {
    const runner = runnerDe(() =>
      erro('Error: Can\'t find the deployment "staging.jarvis.app" (404)')
    )
    expect(await adapterDe(runner).current('staging')).toBeNull()
  })

  it('auth e timeout não viram null', async () => {
    await expect(
      adapterDe(runnerDe(() => erro('Error: invalid token'))).current('staging')
    ).rejects.toMatchObject({ code: 'auth' })
    await expect(adapterDe(runnerDe(() => tempo)).current('staging')).rejects.toMatchObject({
      code: 'timeout'
    })
  })

  it.each([
    ['JSON parcial', '{"id": "dpl_'],
    ['sem identidade', '{"url":"x.vercel.app"}'],
    ['id fora do formato', JSON.stringify({ id: 'qualquer-coisa' })]
  ])('%s é falha, nunca null', async (_nome, saida) => {
    await expect(adapterDe(runnerDe(() => ok(saida))).current('staging')).rejects.toMatchObject({
      code: 'failed'
    })
  })
})

describe('VercelPromotionAdapter.assign', () => {
  it('Staging: aponta o alias configurado para o deployment', async () => {
    let apontado = false
    const runner = runnerDe((c) => {
      if (comecaCom(c, 'inspect')) return apontado ? ok(inspecao(DPL)) : ok(inspecao(OUTRO))
      if (comecaCom(c, 'alias', 'set')) {
        apontado = true
        return ok('{}')
      }
      throw new Error(`inesperado: ${c.args.join(' ')}`)
    })

    await adapterDe(runner).assign({ environment: 'staging', deploymentId: DPL })

    const alias = runner.chamadas.find((c) => comecaCom(c, 'alias', 'set'))!
    expect(alias.args.slice(0, 4)).toEqual(['alias', 'set', DPL, 'staging.jarvis.app'])
    expect(alias.args.join(' ')).not.toContain(TOKEN)
  })

  it('Staging: se já serve o deployment, não faz nada', async () => {
    const runner = runnerDe(() => ok(inspecao(DPL)))
    await adapterDe(runner).assign({ environment: 'staging', deploymentId: DPL })
    expect(runner.chamadas.every((c) => comecaCom(c, 'inspect'))).toBe(true)
  })

  it('Staging sem alias anterior (null) também atribui', async () => {
    let apontado = false
    const runner = runnerDe((c) => {
      if (comecaCom(c, 'inspect')) return apontado ? ok(inspecao(DPL)) : erro('not found (404)')
      apontado = true
      return ok('{}')
    })
    await adapterDe(runner).assign({ environment: 'staging', deploymentId: DPL })
    expect(runner.chamadas.some((c) => comecaCom(c, 'alias', 'set'))).toBe(true)
  })

  it('Produção: promove o deployment existente, sem rebuild, esperando a conclusão', async () => {
    let promovido = false
    const runner = runnerDe((c) => {
      if (comecaCom(c, 'inspect')) return promovido ? ok(inspecao(DPL)) : ok(inspecao(OUTRO))
      if (comecaCom(c, 'promote')) {
        promovido = true
        return ok('Success! promoted')
      }
      throw new Error(`inesperado: ${c.args.join(' ')}`)
    })

    await adapterDe(runner).assign({ environment: 'production', deploymentId: DPL })

    const promote = runner.chamadas.find((c) => comecaCom(c, 'promote'))!
    expect(promote.args[1]).toBe(DPL)
    expect(promote.args).toEqual(expect.arrayContaining(['--timeout']))
    expect(runner.chamadas.some((c) => comecaCom(c, 'deploy'))).toBe(false)
    expect(runner.chamadas.some((c) => comecaCom(c, 'alias'))).toBe(false)
    expect(promote.options?.env).toEqual({ VERCEL_TOKEN: TOKEN })
  })

  it('Produção: se já serve o deployment, não promove de novo', async () => {
    const runner = runnerDe(() => ok(inspecao(DPL)))
    await adapterDe(runner).assign({ environment: 'production', deploymentId: DPL })
    expect(runner.chamadas.some((c) => comecaCom(c, 'promote'))).toBe(false)
  })

  it('Produção: promoção que a leitura posterior não confirma é falha', async () => {
    const runner = runnerDe((c) => (comecaCom(c, 'inspect') ? ok(inspecao(OUTRO)) : ok('')))
    await expect(
      adapterDe(runner).assign({ environment: 'production', deploymentId: DPL })
    ).rejects.toMatchObject({ code: 'failed' })
  })

  it.each([
    ['auth', erro('Error: Unauthorized (401)')],
    ['quota', erro('Error: too many requests')],
    ['incompatible-state', erro('Error: deployment is in an invalid state, conflict')],
    ['timeout', tempo]
  ] as const)('Produção: classifica %s ao promover', async (codigo, resposta) => {
    const runner = runnerDe((c) => (comecaCom(c, 'inspect') ? ok(inspecao(OUTRO)) : resposta))
    await expect(
      adapterDe(runner).assign({ environment: 'production', deploymentId: DPL })
    ).rejects.toMatchObject({ code: codigo })
  })

  it('Staging: erro do alias é classificado', async () => {
    const runner = runnerDe((c) =>
      comecaCom(c, 'inspect') ? ok(inspecao(OUTRO)) : erro('Forbidden')
    )
    await expect(
      adapterDe(runner).assign({ environment: 'staging', deploymentId: DPL })
    ).rejects.toMatchObject({ code: 'auth' })
  })

  it.each(['meu-projeto', 'dpl_', 'dpl_abc; rm -rf', 'https://x.vercel.app', ''])(
    'recusa id de deployment inválido (%s) antes de qualquer comando',
    async (id) => {
      const runner = runnerDe(() => ok())
      for (const environment of ['staging', 'production'] as const)
        await expect(
          adapterDe(runner).assign({ environment, deploymentId: id })
        ).rejects.toMatchObject({ code: 'incompatible-state' })
      expect(runner.chamadas).toEqual([])
    }
  )

  it('ambiente desconhecido é recusado', async () => {
    const runner = runnerDe(() => ok())
    await expect(
      adapterDe(runner).assign({ environment: 'preview' as never, deploymentId: DPL })
    ).rejects.toMatchObject({ code: 'incompatible-state' })
    expect(runner.chamadas).toEqual([])
  })
})

describe('VercelPromotionAdapter: configuração', () => {
  it.each([
    ['http', 'http://staging.jarvis.app'],
    ['com caminho', 'https://staging.jarvis.app/x'],
    ['com credencial', 'https://u:p@staging.jarvis.app'],
    ['com porta', 'https://staging.jarvis.app:8443'],
    ['vazio', ''],
    ['com espaço', 'staging jarvis.app'],
    ['injeção de opção', '--token=abc']
  ])('recusa domínio de alias %s', (_nome, dominio) => {
    expect(() =>
      adapterDe(
        runnerDe(() => ok()),
        { ...CONFIG, stagingDomain: dominio }
      )
    ).toThrow(TypeError)
    expect(() =>
      adapterDe(
        runnerDe(() => ok()),
        { ...CONFIG, productionDomain: dominio }
      )
    ).toThrow(TypeError)
  })

  it('aceita domínio com ou sem esquema https', async () => {
    const runner = runnerDe(() => ok(inspecao(DPL)))
    await adapterDe(runner, { ...CONFIG, stagingDomain: 'staging.jarvis.app' }).current('staging')
    expect(runner.chamadas[0]!.args[1]).toBe('staging.jarvis.app')
  })

  it('Staging e Produção no mesmo domínio são recusados', () => {
    expect(() =>
      adapterDe(
        runnerDe(() => ok()),
        { ...CONFIG, productionDomain: CONFIG.stagingDomain }
      )
    ).toThrow(TypeError)
  })
})
