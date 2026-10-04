/**
 * A limpeza de um run que o inventário conhece (SPEC-Scheduler-03).
 *
 * Com o isolamento por run, quem devolve os recursos é o inventário — conferido pela label, sem
 * `--force`. O caminho antigo (lease + `git worktree remove --force`) fica só para o run que o
 * inventário não conhece, que é o que existia antes desta fatia.
 */

import { describe, expect, it, vi } from 'vitest'
import type { SandboxPreparado } from '@shared/domain/preflight'

const logCat = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logCat }),
  setCurrentWorkspace: vi.fn()
}))

const { LimpezaService } = await import('./limpeza-service')

const SANDBOX: SandboxPreparado = {
  runId: 'run-a',
  containerNome: 'jarvisos-run-run-a',
  cwd: '/work',
  baseSha: 'a'.repeat(40),
  branch: 'feat/f03-run-a',
  worktreeNoHost: '/raiz/jarvisos-run-run-a',
  pathsPermitidos: { paths: ['src'], origem: 'spec', justificativa: 'teste' },
  proxyUrl: 'http://1.2.3.4:8080',
  modeloDaConstrucao: { provider: 'claude-code', modelo: 'claude-opus-5' }
}

const PEDIDO = {
  runId: 'run-a',
  userId: 'u-1',
  projectId: 'p',
  repositorio: '/repo',
  sandbox: SANDBOX,
  fase: 'depois-do-merge' as const,
  estadoFinal: 'DONE' as never
}

function montar(
  inventariado: boolean,
  liberacao = { removidos: [] as string[], pendencias: [] as unknown[] }
) {
  const docker = { parar: vi.fn(() => true), matarProcesso: vi.fn() }
  const git = { run: vi.fn(() => ({ ok: true })) }
  const leases = { buscar: vi.fn(() => undefined), liberar: vi.fn(), listar: vi.fn(() => []) }
  const ledger = { registrarPendencia: vi.fn() }
  const isolamento = {
    inventariado: vi.fn(() => inventariado),
    liberarRun: vi.fn(() => liberacao)
  }
  const servico = new LimpezaService({
    docker,
    git,
    leases: leases as never,
    ledger: ledger as never,
    isolamento: isolamento as never,
    workspaceId: () => 'jarvis'
  })
  return { servico, docker, git, isolamento }
}

describe('LimpezaService com o inventário do isolamento', () => {
  it('delega ao inventário e devolve o que ele removeu, sem a branch', () => {
    const { servico, docker, git, isolamento } = montar(true, {
      removidos: ['sidecar', 'container', 'rede', 'worktree', 'perfil', 'porta', 'branch'],
      pendencias: []
    })

    const r = servico.limpar(PEDIDO)

    expect(isolamento.liberarRun).toHaveBeenCalledWith('run-a')
    expect(r.removidos).toEqual(['sidecar', 'container', 'rede', 'worktree', 'perfil', 'porta'])
    expect(r.pendencias).toEqual([])
    // Nenhum comando do caminho antigo: nada de `--force`.
    expect(git.run).not.toHaveBeenCalled()
    expect(docker.parar).not.toHaveBeenCalled()
  })

  it('devolve as pendências do inventário', () => {
    const pendencia = {
      runId: 'run-a',
      recurso: 'rede',
      identificador: 'jarvisos-egress-run-a',
      motivo: 'O Docker não removeu a rede.',
      em: '2026-10-04T00:00:00.000Z'
    }
    const { servico } = montar(true, { removidos: ['container'], pendencias: [pendencia] })

    expect(servico.limpar(PEDIDO).pendencias).toEqual([pendencia])
  })

  it('fase que preserva o snapshot não remove nada, nem pelo inventário', () => {
    const { servico, isolamento } = montar(true)

    servico.limpar({ ...PEDIDO, fase: 'durante-execucao' })

    expect(isolamento.liberarRun).not.toHaveBeenCalled()
  })

  it('run que o inventário não conhece segue o caminho antigo', () => {
    const { servico, isolamento } = montar(false)

    servico.limpar(PEDIDO)

    expect(isolamento.liberarRun).not.toHaveBeenCalled()
  })
})
