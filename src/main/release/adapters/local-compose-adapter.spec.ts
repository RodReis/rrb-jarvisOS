import { describe, expect, it } from 'vitest'
import type { CommandResult, CommandRunner } from './command-runner'
import {
  ComposeBlockedError,
  LocalComposeAdapter,
  type ComposeProfile
} from './local-compose-adapter'

const LEASE = 'lease-0123456789'
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
      args.includes('-q') || args.includes('-aq') ? ok('id1\nid2\n') : ok()
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
    const r = runner((args) => (args[0] === 'rm' ? falha : ok('id1')))
    await expect(new LocalComposeAdapter(r, opcoes).cleanup(LEASE)).rejects.toMatchObject({
      code: 'cleanup-failed'
    })
  })

  it('lease vazio ou malformado nunca vira filtro que casa com tudo', async () => {
    const r = runner(() => ok('id1'))
    await expect(new LocalComposeAdapter(r, opcoes).cleanup('')).rejects.toThrow(TypeError)
    expect(r.chamadas).toHaveLength(0)
  })
})
