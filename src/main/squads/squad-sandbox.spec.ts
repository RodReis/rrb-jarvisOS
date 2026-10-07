import { describe, expect, it, vi } from 'vitest'
import type { PreflightOutcome, SandboxPreparado } from '@shared/domain/preflight'
import type { PedidoDePreflight } from '../pipeline/preflight-service'
import type { PedidoDeSandbox } from './squad-escritor'
import { SandboxDoEscritorReal, unidadeDeSandbox } from './squad-sandbox'
import { CLAUDE_CODE_LINUX_X64_SHA256, CLAUDE_CODE_VERSION, IMAGEM_DO_SQUAD } from './squad-imagem'

const PEDIDO: PedidoDeSandbox = {
  runId: 'run-1',
  projectId: 'p-1',
  workspaceId: 'jarvis',
  sliceId: 'f03',
  escritor: 'api',
  tarefaId: 'tar-1',
  tentativa: 1,
  repositorio: '/repo',
  baseSha: 'a'.repeat(40),
  pathsPermitidos: { origem: 'derivada', paths: ['src/api'], justificativa: 'write set' },
  contextPackId: 'pack-1'
}

const sandboxPreparado = (unidade: string): SandboxPreparado =>
  ({
    runId: unidade,
    containerNome: `jarvisos-run-${unidade}`,
    cwd: '/work',
    baseSha: 'a'.repeat(40),
    branch: `feat/f03-run-1-${unidade}`,
    worktreeNoHost: `/raiz/jarvisos-run-${unidade}`,
    pathsPermitidos: PEDIDO.pathsPermitidos,
    proxyUrl: 'http://proxy',
    modeloDaConstrucao: { provider: 'claude-code', modelo: 'm' }
  }) as unknown as SandboxPreparado

function montar(
  opcoes: {
    preflight?: (p: PedidoDePreflight) => PreflightOutcome
    adotar?: ReturnType<typeof vi.fn>
  } = {}
) {
  const preparados: PedidoDePreflight[] = []
  const parados: [string, string][] = []
  const registrados: { runId: string; tentativa: number; contextPackId: string }[] = []
  const liberadas: string[] = []
  const isolamento: [string, unknown][] = []
  const adotar =
    opcoes.adotar ??
    vi.fn((p: { worktree: string }) => ({
      ok: true,
      valor: {
        worktree: p.worktree,
        gitDir: '/gitdir',
        repositorio: '/repo',
        branch: 'b',
        baseSha: 'x'
      }
    }))
  const sandbox = new SandboxDoEscritorReal({
    preflight: {
      preparar: (p) => {
        preparados.push(p)
        return (
          opcoes.preflight?.(p) ?? {
            reason: 'liberado',
            mensagem: 'ok',
            sandbox: sandboxPreparado(p.runId)
          }
        )
      }
    },
    git: { adotarWorktree: adotar as never },
    docker: {
      parar: (nome, cwd) => {
        parados.push([nome, cwd])
        return true
      }
    },
    isolamento: { liberarRun: (runId, opcoes) => void isolamento.push([runId, opcoes]) },
    proxy: {
      registrarUnidade: (c) => {
        registrados.push(c)
        const chave = `chave-${registrados.length}`
        return { chave, caminho: `/u/${chave}` }
      },
      liberarUnidade: (chave) => void liberadas.push(chave)
    },
    raizOperacional: () => '/raiz',
    proxyUrl: () => 'http://proxy',
    cwdDoDocker: () => '/raiz'
  })
  return { sandbox, preparados, parados, adotar, registrados, liberadas, isolamento }
}

describe('unidade de sandbox', () => {
  it('fixa a imagem local na versão e no checksum aprovados', () => {
    expect(CLAUDE_CODE_VERSION).toBe('2.1.278')
    expect(CLAUDE_CODE_LINUX_X64_SHA256).toBe(
      '5c4735937844e84f8a93306e841a5b0e12252909b07870f789b190468da147ab'
    )
    expect(IMAGEM_DO_SQUAD).toBe('jarvisos/squad-executor:claude-code-2.1.278')
    expect(IMAGEM_DO_SQUAD).not.toContain('latest')
  })

  it('é única por run, escritor, tarefa e tentativa', () => {
    const base = { runId: 'run-1', escritor: 'api', tarefaId: 'tar-1', tentativa: 1 }

    expect(unidadeDeSandbox(base)).toBe('run-1-api-tar-1-t1')
    expect(unidadeDeSandbox({ ...base, escritor: 'ui' })).not.toBe(unidadeDeSandbox(base))
    expect(unidadeDeSandbox({ ...base, tarefaId: 'tar-2' })).not.toBe(unidadeDeSandbox(base))
    expect(unidadeDeSandbox({ ...base, tentativa: 2 })).not.toBe(unidadeDeSandbox(base))
    expect(unidadeDeSandbox({ ...base, runId: 'run-2' })).not.toBe(unidadeDeSandbox(base))
  })
})

describe('preparar', () => {
  it('entrega ao Preflight a unidade como se fosse o run, com a base, o escopo e o sufixo da branch', async () => {
    const { sandbox, preparados } = montar()

    await sandbox.preparar(PEDIDO)

    expect(preparados).toEqual([
      {
        runId: 'run-1-api-tar-1-t1',
        projectId: 'p-1',
        sliceId: 'f03',
        raizOperacional: '/raiz',
        repositorio: '/repo',
        base: 'a'.repeat(40),
        pathsDaSpec: PEDIDO.pathsPermitidos,
        proxyUrl: 'http://proxy',
        imagemDoSandbox: 'jarvisos/squad-executor:claude-code-2.1.278',
        sufixoDaBranch: 'api-tar-1-t1',
        caminhoDoProxy: '/u/chave-1'
      }
    ])
  })

  it('seleciona a imagem local fixada da CLI sem alterar a imagem dos outros sandboxes', async () => {
    const { sandbox, preparados } = montar()

    await sandbox.preparar(PEDIDO)

    expect(preparados[0]).toMatchObject({
      imagemDoSandbox: 'jarvisos/squad-executor:claude-code-2.1.278'
    })
  })

  it('adota o worktree que o Preflight criou, na base e na branch dele', async () => {
    const { sandbox, adotar } = montar()

    const r = await sandbox.preparar(PEDIDO)

    expect(adotar).toHaveBeenCalledWith({
      repositorio: '/repo',
      worktree: '/raiz/jarvisos-run-run-1-api-tar-1-t1',
      branch: 'feat/f03-run-1-run-1-api-tar-1-t1',
      baseSha: 'a'.repeat(40)
    })
    expect(r).toMatchObject({
      ok: true,
      worktree: { worktree: '/raiz/jarvisos-run-run-1-api-tar-1-t1' }
    })
  })

  it('dois escritores do mesmo run recebem unidades, e portanto ambientes, distintos', async () => {
    const { sandbox, preparados } = montar()

    await sandbox.preparar(PEDIDO)
    await sandbox.preparar({ ...PEDIDO, escritor: 'ui' })

    expect(preparados.map((p) => p.runId)).toEqual(['run-1-api-tar-1-t1', 'run-1-ui-tar-1-t1'])
    expect(preparados.map((p) => p.sufixoDaBranch)).toEqual(['api-tar-1-t1', 'ui-tar-1-t1'])
  })

  it('cada motivo de recusa do Preflight vira recusa do sandbox, com o motivo e a mensagem', async () => {
    for (const reason of ['docker-indisponivel', 'proxy-indisponivel', 'arvore-suja'] as const) {
      const { sandbox, adotar } = montar({
        preflight: () => ({ reason, mensagem: 'explicação' })
      })

      const r = await sandbox.preparar(PEDIDO)

      expect(r).toEqual({ ok: false, motivo: `${reason}: explicação` })
      expect(adotar).not.toHaveBeenCalled()
    }
  })

  it('um sandbox que acompanha uma recusa não é usado: a razão manda, não a presença do objeto', async () => {
    const { sandbox, adotar } = montar({
      preflight: (p) => ({
        reason: 'arvore-suja',
        mensagem: 'sujo',
        sandbox: sandboxPreparado(p.runId)
      })
    })

    expect(await sandbox.preparar(PEDIDO)).toEqual({ ok: false, motivo: 'arvore-suja: sujo' })
    expect(adotar).not.toHaveBeenCalled()
    expect(sandbox.containerDe('/raiz/jarvisos-run-run-1-api-tar-1-t1')).toBeUndefined()
  })

  it('adota na base que o Preflight resolveu, não na que o pedido trouxe', async () => {
    const { sandbox, adotar } = montar({
      preflight: (p) => ({
        reason: 'liberado',
        mensagem: 'ok',
        sandbox: { ...sandboxPreparado(p.runId), baseSha: 'b'.repeat(40) }
      })
    })

    await sandbox.preparar(PEDIDO)

    expect(adotar).toHaveBeenCalledWith(expect.objectContaining({ baseSha: 'b'.repeat(40) }))
  })

  it('liberado sem sandbox é recusa, não sucesso', async () => {
    const { sandbox } = montar({ preflight: () => ({ reason: 'liberado', mensagem: 'ok' }) })

    expect(await sandbox.preparar(PEDIDO)).toEqual({ ok: false, motivo: 'liberado: ok' })
  })

  it('se o worktree não pode ser adotado, o container que subiu é parado', async () => {
    const adotar = vi.fn(() => ({ ok: false, motivo: 'fora do .git do repositório' }))
    const { sandbox, parados } = montar({ adotar })

    const r = await sandbox.preparar(PEDIDO)

    expect(r).toEqual({ ok: false, motivo: 'worktree-nao-adotado: fora do .git do repositório' })
    expect(parados).toEqual([['jarvisos-run-run-1-api-tar-1-t1', '/raiz']])
    expect(sandbox.containerDe('/raiz/jarvisos-run-run-1-api-tar-1-t1')).toBeUndefined()
  })
})

describe('preparar que lança', () => {
  it('o Preflight lançar devolve ok:false e libera a chave do proxy — a unidade não vaza', async () => {
    const { sandbox, liberadas } = montar({
      preflight: () => {
        throw new TypeError('docker sumiu')
      }
    })

    const r = await sandbox.preparar(PEDIDO)

    expect(r).toEqual({ ok: false, motivo: 'erro-no-sandbox: TypeError' })
    expect(liberadas).toEqual(['chave-1'])
  })

  it('adotar lançar com o container já no ar para o container e libera a chave', async () => {
    const { sandbox, liberadas, parados } = montar({
      adotar: vi.fn(() => {
        throw new Error('git caiu')
      })
    })

    const r = await sandbox.preparar(PEDIDO)

    expect(r).toEqual({ ok: false, motivo: 'erro-no-sandbox: Error' })
    expect(liberadas).toEqual(['chave-1'])
    expect(parados).toEqual([['jarvisos-run-run-1-api-tar-1-t1', '/raiz']])
    expect(sandbox.containerDe('/raiz/jarvisos-run-run-1-api-tar-1-t1')).toBeUndefined()
  })
})

describe('a unidade no proxy (SPEC-Squads-03, critério 5)', () => {
  it('registra o run, a tentativa e o pack da unidade antes de subir o container', async () => {
    const { sandbox, registrados, preparados } = montar()

    await sandbox.preparar({ ...PEDIDO, tentativa: 2 })

    expect(registrados).toEqual([
      {
        runId: 'run-1',
        tentativa: 2,
        contextPackId: 'pack-1',
        workspaceId: 'jarvis',
        projectId: 'p-1',
        tarefaId: 'tar-1'
      }
    ])
    expect(preparados[0].caminhoDoProxy).toBe('/u/chave-1')
  })

  it('cada escritor e cada tentativa ganham a sua chave', async () => {
    const { sandbox, preparados } = montar()

    await sandbox.preparar(PEDIDO)
    await sandbox.preparar({ ...PEDIDO, escritor: 'ui' })
    await sandbox.preparar({ ...PEDIDO, tentativa: 2 })

    expect(preparados.map((p) => p.caminhoDoProxy)).toEqual([
      '/u/chave-1',
      '/u/chave-2',
      '/u/chave-3'
    ])
  })

  it('a chave é liberada se o Preflight recusa, e se o worktree não é adotado', async () => {
    const recusa = montar({ preflight: () => ({ reason: 'docker-indisponivel', mensagem: 'x' }) })
    await recusa.sandbox.preparar(PEDIDO)
    expect(recusa.liberadas).toEqual(['chave-1'])

    const semAdocao = montar({ adotar: vi.fn(() => ({ ok: false, motivo: 'x' })) })
    await semAdocao.sandbox.preparar(PEDIDO)
    expect(semAdocao.liberadas).toEqual(['chave-1'])
  })

  it('a chave continua valendo enquanto o escritor trabalha, e sai quando o sandbox encerra', async () => {
    const { sandbox, liberadas } = montar()
    await sandbox.preparar(PEDIDO)
    await sandbox.preparar({ ...PEDIDO, escritor: 'ui' })
    expect(liberadas).toEqual([])

    await sandbox.encerrar(PEDIDO)

    expect(liberadas).toEqual(['chave-1'])
  })

  it('encerrar o que nunca subiu não libera chave nenhuma', async () => {
    const { sandbox, liberadas } = montar()

    await sandbox.encerrar(PEDIDO)

    expect(liberadas).toEqual([])
  })
})

describe('container e encerramento', () => {
  it('o agente acha o container pelo worktree do escritor', async () => {
    const { sandbox } = montar()
    await sandbox.preparar(PEDIDO)
    await sandbox.preparar({ ...PEDIDO, escritor: 'ui' })

    expect(sandbox.containerDe('/raiz/jarvisos-run-run-1-api-tar-1-t1')).toEqual({
      container: 'jarvisos-run-run-1-api-tar-1-t1'
    })
    expect(sandbox.containerDe('/raiz/jarvisos-run-run-1-ui-tar-1-t1')).toEqual({
      container: 'jarvisos-run-run-1-ui-tar-1-t1'
    })
    expect(sandbox.containerDe('/outro/lugar')).toBeUndefined()
  })

  it('encerrar para o container daquele escritor, e só dele, e o esquece', async () => {
    const { sandbox, parados } = montar()
    await sandbox.preparar(PEDIDO)
    await sandbox.preparar({ ...PEDIDO, escritor: 'ui' })

    await sandbox.encerrar(PEDIDO)

    expect(parados).toEqual([['jarvisos-run-run-1-api-tar-1-t1', '/raiz']])
    expect(sandbox.containerDe('/raiz/jarvisos-run-run-1-api-tar-1-t1')).toBeUndefined()
    expect(sandbox.containerDe('/raiz/jarvisos-run-run-1-ui-tar-1-t1')).toBeDefined()
  })

  it('encerrar o que nunca subiu, ou já foi encerrado, não faz nada', async () => {
    const { sandbox, parados } = montar()

    await sandbox.encerrar(PEDIDO)
    await sandbox.preparar(PEDIDO)
    await sandbox.encerrar(PEDIDO)
    await sandbox.encerrar(PEDIDO)

    expect(parados).toHaveLength(1)
  })
})

describe('isolamento por run ao encerrar (SPEC-Scheduler-03)', () => {
  it('devolve rede, sidecar, perfil e portas da unidade, e preserva o worktree do kernel', async () => {
    const { sandbox, isolamento } = montar()
    await sandbox.preparar(PEDIDO)

    await sandbox.encerrar(PEDIDO)

    expect(isolamento).toEqual([[unidadeDeSandbox(PEDIDO), { preservarWorktree: true }]])
  })

  it('o worktree que não foi adotado também devolve os recursos que o preflight criou', async () => {
    const { sandbox, isolamento } = montar({
      adotar: vi.fn(() => ({ ok: false, motivo: 'HEAD divergente' }))
    })

    await sandbox.preparar(PEDIDO)

    expect(isolamento).toEqual([[unidadeDeSandbox(PEDIDO), { preservarWorktree: true }]])
  })

  it('encerrar o que nunca subiu não devolve nada', async () => {
    const { sandbox, isolamento } = montar()

    await sandbox.encerrar(PEDIDO)

    expect(isolamento).toEqual([])
  })
})
