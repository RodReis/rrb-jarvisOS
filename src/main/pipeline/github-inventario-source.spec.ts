import { describe, expect, it, vi } from 'vitest'
import { CONNECTOR_CONTRACT_VERSION } from '@shared/domain/connectors'
import { GITHUB_OPERATIONS } from '@shared/domain/github-automation'
import type { ConnectorService } from '../connectors/connector-service'
import { GithubInventarioFonte } from './github-inventario-source'
import type { NoInventario } from './inventario-global'

const issue = {
  numero: 134,
  titulo: '[MVP13][F01] Inventário e DAG global',
  estado: 'open' as const,
  labels: ['proplan:doing']
}
const local: NoInventario = {
  id: 'M13-F01',
  tipo: 'fatia',
  mvpId: 'MVP-013',
  numero: 1,
  titulo: issue.titulo,
  dependeDe: [],
  estadoTecnico: 'em-andamento',
  spec: { estado: 'aprovada', revisaoAtual: 'a'.repeat(64), revisaoAprovada: 'a'.repeat(64) },
  gateAprovado: true,
  bloqueado: false,
  issue: { numero: issue.numero, aberta: true }
}

describe('GithubInventarioFonte', () => {
  it('usa ConnectorService e projeta a issue sem persistir corpo livre', async () => {
    const call = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        issues: [issue],
        pullRequests: [],
        branches: [{ nome: 'main', sha: 'b'.repeat(40) }]
      },
      provenance: {
        connector: 'github',
        operation: GITHUB_OPERATIONS.getRepositoryInventory,
        obtidoEm: '2026-10-08T00:00:00.000Z'
      },
      usage: { creditos: 0, latenciaMs: 10 }
    })
    const source = new GithubInventarioFonte(
      { call } as unknown as ConnectorService,
      (projectId) =>
        projectId === 'project-1' ? { owner: 'RodReis', repo: 'rrb-jarvisOS' } : undefined
    )

    const resultado = await source.lerGithub(
      { userId: 'u1', workspaceId: 'jarvis', projectId: 'project-1' },
      [local]
    )

    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({
        contractVersion: CONNECTOR_CONTRACT_VERSION,
        operation: GITHUB_OPERATIONS.getRepositoryInventory,
        credential: { key: 'github', user_id: 'u1', workspace_id: 'jarvis' },
        input: { owner: 'RodReis', repo: 'rrb-jarvisOS' }
      }),
      { userId: 'u1', workspace: 'jarvis' }
    )
    expect(resultado.completa).toBe(true)
    expect(resultado.nos[0]).toMatchObject({ id: 'M13-F01', estadoTecnico: 'em-andamento' })
  })

  it('falha fechado sem repositório ou diante de erro do conector', async () => {
    const conectorComErro = { call: vi.fn().mockResolvedValue({ ok: false, code: 'indisponivel' }) }
    const sourceSemRepo = new GithubInventarioFonte(
      conectorComErro as unknown as ConnectorService,
      () => undefined
    )
    const sourceComErro = new GithubInventarioFonte(
      conectorComErro as unknown as ConnectorService,
      () => ({ owner: 'RodReis', repo: 'rrb-jarvisOS' })
    )
    const escopo = { userId: 'u1', workspaceId: 'jarvis' as const, projectId: 'project-1' }

    await expect(sourceSemRepo.lerGithub(escopo, [local])).rejects.toThrow('sem referência')
    await expect(sourceComErro.lerGithub(escopo, [local])).rejects.toThrow('inventário completo')
  })
})
