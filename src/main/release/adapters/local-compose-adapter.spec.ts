import { describe, expect, it } from 'vitest'
import type { CommandResult, CommandRunner } from './command-runner'
import { ReferenciaMutavelError } from '@shared/domain/release-artifact'
import {
  ComposeBlockedError,
  LocalComposeAdapter,
  lerServicosDoCompose,
  portasPublicadas,
  type ComposeProfile
} from './local-compose-adapter'

const LEASE = 'lease-0123456789'
const ID1 = 'a'.repeat(12)
const ID2 = 'b'.repeat(64)
const PROFILE: ComposeProfile = {
  postgresPreferredPort: 55_500,
  backend: { context: 'b', containerPort: 3000, healthPath: '/health', preferredPort: 55_510 },
  frontend: { context: 'f', containerPort: 3001, healthPath: '/', preferredPort: 55_520 }
}

const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '', timedOut: false })
const falha: CommandResult = { code: 1, stdout: '', stderr: 'x', timedOut: false }

function runner(
  responder: (args: readonly string[]) => CommandResult
): CommandRunner & { chamadas: string[][] } {
  const chamadas: string[][] = []
  return {
    chamadas,
    async run(_b, args) {
      chamadas.push([...args])
      return responder(args)
    }
  }
}

const opcoes = { composeFile: 'compose.yml', portFree: () => true, sleep: async () => undefined }

describe('ensureDocker', () => {
  it('Docker no ar: segue sem tentar ligar', async () => {
    let ligou = false
    const r = runner(() => ok('29.0'))
    await new LocalComposeAdapter(r, {
      ...opcoes,
      autoStartDocker: true,
      startDocker: async () => ((ligou = true), true)
    }).ensureDocker()
    expect(ligou).toBe(false)
  })

  it('Docker desligado e sem autorização: bloqueia sem tentar ligar', async () => {
    let ligou = false
    const adapter = new LocalComposeAdapter(
      runner(() => falha),
      { ...opcoes, startDocker: async () => ((ligou = true), true) }
    )
    await expect(adapter.ensureDocker()).rejects.toMatchObject({ code: 'docker-unavailable' })
    expect(ligou).toBe(false)
  })

  it('binário ausente também é "docker-unavailable"', async () => {
    const r: CommandRunner = {
      run: async () => {
        throw new Error('spawn docker ENOENT')
      }
    }
    await expect(new LocalComposeAdapter(r, opcoes).ensureDocker()).rejects.toMatchObject({
      code: 'docker-unavailable'
    })
  })

  it('autorizado: liga o Docker e espera ele responder', async () => {
    let respondendo = false
    const r = runner(() => (respondendo ? ok('29.0') : falha))
    await new LocalComposeAdapter(r, {
      ...opcoes,
      autoStartDocker: true,
      startDocker: async () => ((respondendo = true), true)
    }).ensureDocker()
    expect(respondendo).toBe(true)
  })

  it('autorizado mas que não inicia: "docker-not-started"', async () => {
    const adapter = new LocalComposeAdapter(
      runner(() => falha),
      { ...opcoes, autoStartDocker: true, startDocker: async () => false }
    )
    await expect(adapter.ensureDocker()).rejects.toMatchObject({ code: 'docker-not-started' })
  })

  it('ligou mas nunca respondeu: "docker-not-started" ao fim da espera', async () => {
    const adapter = new LocalComposeAdapter(
      runner(() => falha),
      { ...opcoes, autoStartDocker: true, startDocker: async () => true, dockerWaitMs: 5 }
    )
    await expect(adapter.ensureDocker()).rejects.toMatchObject({ code: 'docker-not-started' })
  })
})

describe('portas', () => {
  const docker = (publicadas = '') =>
    runner((args) => (args[0] === 'ps' ? ok(publicadas) : ok('29.0')))

  it('usa a preferida quando livre', async () => {
    const env = await new LocalComposeAdapter(docker(), opcoes).open(PROFILE, LEASE)
    expect(env.ports).toEqual({ postgres: 55_500, backend: 55_510, frontend: 55_520 })
  })

  it('porta publicada por outro contêiner é pulada, nunca reutilizada', async () => {
    const env = await new LocalComposeAdapter(
      docker('127.0.0.1:55500->5432/tcp, 0.0.0.0:55501->80/tcp'),
      opcoes
    ).open(PROFILE, LEASE)
    expect(env.ports.postgres).toBe(55_502)
  })

  it('porta ocupada no host é pulada', async () => {
    const env = await new LocalComposeAdapter(docker(), {
      ...opcoes,
      portFree: (p) => p !== 55_510
    }).open(PROFILE, LEASE)
    expect(env.ports.backend).toBe(55_511)
  })

  it('três serviços nunca recebem a mesma porta', async () => {
    const env = await new LocalComposeAdapter(docker(), opcoes).open(
      {
        ...PROFILE,
        backend: { ...PROFILE.backend, preferredPort: 55_500 },
        frontend: { ...PROFILE.frontend, preferredPort: 55_500 }
      },
      LEASE
    )
    expect(new Set(Object.values(env.ports)).size).toBe(3)
  })

  it('sem porta livre na faixa: bloqueio explícito', async () => {
    const adapter = new LocalComposeAdapter(docker(), { ...opcoes, portFree: () => false })
    await expect(adapter.open(PROFILE, LEASE)).rejects.toBeInstanceOf(ComposeBlockedError)
    await expect(adapter.open(PROFILE, LEASE)).rejects.toMatchObject({ code: 'port-unavailable' })
  })

  it('o nome do projeto é derivado do lease e exclusivo por lease', async () => {
    const a = await new LocalComposeAdapter(docker(), opcoes).open(PROFILE, 'lease-aaaaaaaa')
    const b = await new LocalComposeAdapter(docker(), opcoes).open(PROFILE, 'lease-bbbbbbbb')
    expect(a.project).toMatch(/^jarvisrel-[a-f0-9]{12}$/)
    expect(a.project).not.toBe(b.project)
  })

  it('recusa lease fora do padrão antes de falar com o Docker', async () => {
    const r = docker()
    await expect(new LocalComposeAdapter(r, opcoes).open(PROFILE, 'x; rm -rf')).rejects.toThrow(
      TypeError
    )
    expect(r.chamadas).toHaveLength(0)
  })
})

describe('cleanup', () => {
  it('filtra pelas DUAS marcas (lease e temporário) em contêiner, rede e volume', async () => {
    const r = runner((args) =>
      args.includes('-q') || args.includes('-aq') ? ok(`${ID1}\n${ID2}\n`) : ok()
    )
    const out = await new LocalComposeAdapter(r, opcoes).cleanup(LEASE)
    expect(out).toEqual({ containers: 2, networks: 2, volumes: 2 })
    const listagens = r.chamadas.filter((a) => a.includes('--filter'))
    expect(listagens).toHaveLength(3)
    for (const a of listagens) {
      expect(a).toContain(`label=jarvisos.release-lease=${LEASE}`)
      expect(a).toContain('label=jarvisos.temporary=true')
    }
  })

  it('nada pertencente ao lease: não chama remoção', async () => {
    const r = runner(() => ok(''))
    const out = await new LocalComposeAdapter(r, opcoes).cleanup(LEASE)
    expect(out).toEqual({ containers: 0, networks: 0, volumes: 0 })
    expect(r.chamadas.some((a) => a[0] === 'rm' || a.includes('rm'))).toBe(false)
  })

  it('falha ao remover não finge sucesso', async () => {
    const r = runner((args) => (args[0] === 'rm' ? falha : ok(ID1)))
    await expect(new LocalComposeAdapter(r, opcoes).cleanup(LEASE)).rejects.toMatchObject({
      code: 'cleanup-failed'
    })
  })

  it('lease vazio ou malformado nunca vira filtro que casa com tudo', async () => {
    const r = runner(() => ok(ID1))
    await expect(new LocalComposeAdapter(r, opcoes).cleanup('')).rejects.toThrow(TypeError)
    expect(r.chamadas).toHaveLength(0)
  })
})

describe('cleanup: falha de detecção não é ausência (revisão)', () => {
  it.each([
    ['contêineres', 'ps'],
    ['redes', 'network'],
    ['volumes', 'volume']
  ])(
    'listagem de %s que falha bloqueia em vez de relatar limpeza feita',
    async (_nome, comando) => {
      const r = runner((args) =>
        args[0] === comando && args.includes('--filter') ? falha : ok('')
      )
      await expect(new LocalComposeAdapter(r, opcoes).cleanup(LEASE)).rejects.toMatchObject({
        code: 'cleanup-failed'
      })
    }
  )

  it('listagem com timeout também bloqueia', async () => {
    const r = runner(() => ({ code: null, stdout: '', stderr: '', timedOut: true }))
    await expect(new LocalComposeAdapter(r, opcoes).cleanup(LEASE)).rejects.toMatchObject({
      code: 'cleanup-failed'
    })
  })

  it('volumes são listados por NOME (como o Docker devolve) e são removidos', async () => {
    const r = runner((args) => {
      if (args[0] === 'volume' && args.includes('--filter')) return ok('jarvisrel_abc123_pgdata\n')
      if (args.includes('--filter')) return ok('')
      return ok()
    })
    const out = await new LocalComposeAdapter(r, opcoes).cleanup(LEASE)
    expect(out.volumes).toBe(1)
    expect(r.chamadas).toContainEqual(['volume', 'rm', 'jarvisrel_abc123_pgdata'])
  })

  it('nome de volume começando com hífen nunca chega ao rm', async () => {
    const r = runner((args) =>
      args[0] === 'volume' && args.includes('--filter') ? ok('-f\n') : ok('')
    )
    await expect(new LocalComposeAdapter(r, opcoes).cleanup(LEASE)).rejects.toMatchObject({
      code: 'cleanup-failed'
    })
  })

  it('id fora do formato do Docker nunca chega ao rm (poderia ser uma opção)', async () => {
    const r = runner((args) => (args.includes('--filter') ? ok('--force\n') : ok()))
    await expect(new LocalComposeAdapter(r, opcoes).cleanup(LEASE)).rejects.toMatchObject({
      code: 'cleanup-failed'
    })
    expect(r.chamadas.some((a) => a[0] === 'rm')).toBe(false)
  })
})

describe('portas: detecção que falha bloqueia', () => {
  it('docker ps que falha não vira "nenhuma porta em uso"', async () => {
    const r = runner((args) => (args[0] === 'ps' ? falha : ok('29.0')))
    await expect(new LocalComposeAdapter(r, opcoes).open(PROFILE, LEASE)).rejects.toMatchObject({
      code: 'compose-failed'
    })
  })

  it('portasPublicadas entende faixas e portas únicas', () => {
    const portas = portasPublicadas('0.0.0.0:8000-8002->80/tcp, 127.0.0.1:55500->5432/tcp')
    expect([...portas].sort()).toEqual([55500, 8000, 8001, 8002].sort())
  })

  it('faixa gigante não trava: tem teto', () => {
    expect(portasPublicadas('0.0.0.0:1-65000->80/tcp').size).toBeLessThanOrEqual(1_001)
  })
})

describe('lerServicosDoCompose', () => {
  it('aceita uma linha JSON por serviço', () => {
    const m = lerServicosDoCompose(
      '{"Service":"a","State":"running"}\n{"Service":"b","State":"exited"}\n'
    )
    expect(m.get('a')?.State).toBe('running')
    expect(m.get('b')?.State).toBe('exited')
  })

  it('aceita um array JSON (Compose antigo)', () => {
    const m = lerServicosDoCompose('[{"Service":"a","State":"running","Health":"healthy"}]')
    expect(m.get('a')).toMatchObject({ State: 'running', Health: 'healthy' })
  })

  it('saída vazia é nenhum serviço, nunca exceção silenciosa de parse', () => {
    expect(lerServicosDoCompose('').size).toBe(0)
  })
})

describe('ambiente: entradas que viram argumento', () => {
  const docker = runner((args) => (args[0] === 'ps' ? ok('') : ok('29.0')))

  it('nome de banco fora do padrão é recusado antes de qualquer chamada ao contêiner', async () => {
    const env = await new LocalComposeAdapter(docker, opcoes).open(PROFILE, LEASE)
    docker.chamadas.length = 0
    await expect(env.sql.run('SELECT 1', '-v')).rejects.toThrow(TypeError)
    await expect(env.sql.dump('x=y', [])).rejects.toThrow(TypeError)
    expect(docker.chamadas).toHaveLength(0)
  })

  it('imagem do backend por tag é recusada: só digest sobe', async () => {
    const env = await new LocalComposeAdapter(docker, opcoes).open(PROFILE, LEASE)
    await expect(env.upApplication('ghcr.io/dono/img:latest')).rejects.toBeInstanceOf(
      ReferenciaMutavelError
    )
  })
})
