import { describe, it, expect, vi } from 'vitest'
import { DockerRunner, PERFIL_CLAUDE_NO_CONTAINER } from './docker-runner'
import type { TerminalEngine } from '../execution/terminal-engine'
import type { CommandReason, CommandState } from '@shared/domain/terminal'

interface Resposta {
  stdout?: string
  state?: CommandState
  reason?: CommandReason
  exitCode?: number | null
}

/** Dublê do TerminalEngine: guarda cada submissão e responde por args. */
function terminalDuble(responder: (args: readonly string[]) => Resposta = () => ({})): {
  terminal: TerminalEngine
  chamadas: string[][]
} {
  const chamadas: string[][] = []
  const terminal = {
    run: vi.fn((submission: { readonly args: readonly string[] }) => {
      chamadas.push([...submission.args])
      const r = responder(submission.args)
      return {
        id: 'x',
        state: r.state ?? 'concluido',
        reason: r.reason ?? 'executado',
        stdout: r.stdout ?? '',
        stderr: '',
        exitCode: r.exitCode ?? 0,
        durationMs: 1
      }
    })
  } as unknown as TerminalEngine
  return { terminal, chamadas }
}

const runner = (t: TerminalEngine): DockerRunner => new DockerRunner(t, () => 'ws1' as never)
const LABELS = { 'jarvisos.gerido': 'true', 'jarvisos.run': 'r1' }

describe('labels nos recursos do run', () => {
  it('o container sobe com as labels do run', () => {
    const { terminal, chamadas } = terminalDuble()
    runner(terminal).subir(
      {
        worktreeNoHost: '/w',
        gitMetaNoHost: '/w/.gitmeta',
        gitCommonNoHost: '/r/.git',
        containerNome: 'c1',
        redeDeEgress: 'rede1',
        proxyUrl: 'http://1.2.3.4:8080',
        labels: LABELS
      },
      '/cwd'
    )

    const args = chamadas[0] ?? []
    expect(args).toContain('--label')
    expect(args).toContain('jarvisos.run=r1')
    expect(args.indexOf('--label')).toBeLessThan(args.indexOf('node:22-bookworm'))
  })

  it('sem labels o comando é o de sempre', () => {
    const { terminal, chamadas } = terminalDuble()
    runner(terminal).subir(
      {
        worktreeNoHost: '/w',
        gitMetaNoHost: '/w/.gitmeta',
        gitCommonNoHost: '/r/.git',
        containerNome: 'c1',
        redeDeEgress: 'rede1',
        proxyUrl: 'http://x'
      },
      '/cwd'
    )

    expect(chamadas[0]).not.toContain('--label')
  })

  it('a rede e o sidecar também levam as labels', () => {
    const { terminal, chamadas } = terminalDuble((args) =>
      args[0] === 'network' && args[1] === 'inspect' ? { state: 'falhou', exitCode: 1 } : {}
    )
    const docker = runner(terminal)
    docker.criarRedeDeEgress('rede1', '/cwd', LABELS)
    docker.subirProxyDeEgress(
      { nome: 'p1', redeDeEgress: 'rede1', porta: 8080, proxyDoHost: 'h:1', labels: LABELS },
      '/cwd'
    )

    const criarRede = chamadas.find((a) => a[0] === 'network' && a[1] === 'create') ?? []
    const subirProxy = chamadas.find((a) => a[0] === 'run') ?? []
    expect(criarRede).toContain('jarvisos.run=r1')
    expect(subirProxy).toContain('jarvisos.run=r1')
  })

  it('monta o perfil exclusivo do run e aponta o CLAUDE_CONFIG_DIR para ele', () => {
    const { terminal, chamadas } = terminalDuble()
    runner(terminal).subir(
      {
        worktreeNoHost: '/w',
        gitMetaNoHost: '/w/.gitmeta',
        gitCommonNoHost: '/r/.git',
        containerNome: 'c1',
        redeDeEgress: 'rede1',
        proxyUrl: 'http://x',
        perfilClaudeNoHost: '/raiz/c1-perfil/claude'
      },
      '/cwd'
    )

    const args = chamadas[0] ?? []
    expect(args).toContain(`/raiz/c1-perfil/claude:${PERFIL_CLAUDE_NO_CONTAINER}`)
    expect(args).toContain(`CLAUDE_CONFIG_DIR=${PERFIL_CLAUDE_NO_CONTAINER}`)
  })
})

describe('portasEmUso', () => {
  it('soma as portas publicadas agora e as configuradas em container parado', () => {
    const { terminal } = terminalDuble((args) => {
      if (args[0] === 'ps' && args.includes('{{.ID}}')) return { stdout: 'aaa\nbbb\n' }
      if (args[0] === 'ps') return { stdout: '0.0.0.0:20001->5432/tcp\n' }
      if (args[0] === 'inspect') return { stdout: '20002 \n\n20003 20004 \n' }
      return {}
    })

    expect([...(runner(terminal).portasEmUso('/cwd') ?? [])].sort()).toEqual([
      20001, 20002, 20003, 20004
    ])
  })

  it('devolve undefined quando o Docker falha: falha de detecção não é lista vazia', () => {
    const { terminal } = terminalDuble(() => ({ state: 'falhou', exitCode: 1 }))

    expect(runner(terminal).portasEmUso('/cwd')).toBeUndefined()
  })

  it('sem nenhum container não chama o inspect', () => {
    const { terminal, chamadas } = terminalDuble(() => ({ stdout: '' }))

    expect(runner(terminal).portasEmUso('/cwd')).toEqual(new Set())
    expect(chamadas.some((a) => a[0] === 'inspect')).toBe(false)
  })
})

describe('listarGeridos', () => {
  it('lista container e rede pela label de gerido, com o run de cada um', () => {
    const { terminal, chamadas } = terminalDuble((args) =>
      args[0] === 'ps'
        ? { stdout: 'jarvisos-run-a\ta\njarvisos-proxy-a\ta\n' }
        : { stdout: 'jarvisos-egress-a\ta\njarvisos-egress-b\tb\n' }
    )

    const achados = runner(terminal).listarGeridos('/cwd')

    expect(achados).toEqual({
      containers: [
        { nome: 'jarvisos-run-a', runId: 'a' },
        { nome: 'jarvisos-proxy-a', runId: 'a' }
      ],
      redes: [
        { nome: 'jarvisos-egress-a', runId: 'a' },
        { nome: 'jarvisos-egress-b', runId: 'b' }
      ]
    })
    expect(chamadas.flat()).toContain('label=jarvisos.gerido=true')
  })

  it('recurso gerido sem label de run vem com runId vazio, nunca inventado', () => {
    const { terminal } = terminalDuble((args) =>
      args[0] === 'ps' ? { stdout: 'solto\t\n' } : { stdout: '' }
    )

    expect(runner(terminal).listarGeridos('/cwd')?.containers).toEqual([
      { nome: 'solto', runId: undefined }
    ])
  })

  it('devolve undefined quando uma das listagens falha', () => {
    const { terminal } = terminalDuble((args) =>
      args[0] === 'ps' ? { stdout: 'a\tb\n' } : { state: 'falhou', exitCode: 1 }
    )

    expect(runner(terminal).listarGeridos('/cwd')).toBeUndefined()
  })
})

describe('removerRede', () => {
  it('é docker network rm do nome exato', () => {
    const { terminal, chamadas } = terminalDuble()

    expect(runner(terminal).removerRede('jarvisos-egress-a', '/cwd')).toBe(true)
    expect(chamadas[0]).toEqual(['network', 'rm', 'jarvisos-egress-a'])
  })

  it('devolve false quando o terminal recusa (política ou Docker)', () => {
    const { terminal } = terminalDuble(() => ({
      state: 'bloqueado',
      reason: 'aguardando-aprovacao-destrutivo'
    }))

    expect(runner(terminal).removerRede('r', '/cwd')).toBe(false)
  })
})

describe('inspecionarSandbox', () => {
  const inspecao = JSON.stringify({
    Config: {
      Env: ['PATH=/usr/bin', 'GIT_DIR=/work/.gitmeta'],
      Cmd: ['infinity'],
      Entrypoint: ['sleep']
    },
    Mounts: [
      { Source: '/raiz/c1', Destination: '/work', RW: true },
      { Source: '/r/.git', Destination: '/gitcommon', RW: false }
    ]
  })

  it('monta a entrada do scanner com env, montagens, comando e arquivos', () => {
    const { terminal } = terminalDuble((args) => {
      if (args[0] === 'inspect') return { stdout: inspecao }
      if (args[0] === 'exec') return { stdout: '/root/.npmrc\n/tmp/x\n' }
      return {}
    })

    expect(runner(terminal).inspecionarSandbox('c1', '/cwd')).toEqual({
      env: ['PATH=/usr/bin', 'GIT_DIR=/work/.gitmeta'],
      montagens: [
        { origem: '/raiz/c1', destino: '/work', somenteLeitura: false },
        { origem: '/r/.git', destino: '/gitcommon', somenteLeitura: true }
      ],
      comando: ['sleep', 'infinity'],
      arquivos: ['/root/.npmrc', '/tmp/x']
    })
  })

  it('procura arquivo só fora do worktree, onde o repositório do usuário não confunde', () => {
    const { terminal, chamadas } = terminalDuble((args) =>
      args[0] === 'inspect' ? { stdout: inspecao } : {}
    )
    runner(terminal).inspecionarSandbox('c1', '/cwd')

    const find = chamadas.find((a) => a[0] === 'exec') ?? []
    expect(find).toContain('find')
    expect(find).not.toContain('/work')
  })

  it('devolve undefined quando o inspect falha ou não é JSON', () => {
    const falha = terminalDuble(() => ({ state: 'falhou', exitCode: 1 }))
    const lixo = terminalDuble(() => ({ stdout: 'não é json' }))

    expect(runner(falha.terminal).inspecionarSandbox('c1', '/cwd')).toBeUndefined()
    expect(runner(lixo.terminal).inspecionarSandbox('c1', '/cwd')).toBeUndefined()
  })

  it('devolve undefined quando o find não roda: sem olhar o disco não há "limpo"', () => {
    const { terminal } = terminalDuble((args) =>
      args[0] === 'inspect' ? { stdout: inspecao } : { state: 'falhou', exitCode: 1 }
    )

    expect(runner(terminal).inspecionarSandbox('c1', '/cwd')).toBeUndefined()
  })
})
