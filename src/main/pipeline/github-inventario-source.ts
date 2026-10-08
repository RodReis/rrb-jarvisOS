import { createHash, randomUUID } from 'node:crypto'
import type { ConnectorOutcome, ConnectorRequest } from '@shared/domain/connectors'
import { CONNECTOR_CONTRACT_VERSION } from '@shared/domain/connectors'
import type { RepositoryInventoryNormalizado } from '@shared/domain/github-automation'
import { GITHUB_OPERATIONS } from '@shared/domain/github-automation'
import type { EscopoDoInventario } from './inventario-snapshot-repository'
import type { ProjecaoGithubDoInventario } from './inventario-global-service'
import { projetarEstadoGithub } from './inventario-github-projector'
import type { NoInventario } from './inventario-global'
import type { ConnectorService } from '../connectors/connector-service'

interface RepoAlvo {
  readonly owner: string
  readonly repo: string
}

/** Leitura autenticada via ConnectorService; falha ou paginação incompleta nunca vira snapshot. */
export class GithubInventarioFonte {
  constructor(
    private readonly connectors: ConnectorService,
    private readonly repoDoProjeto: (
      projectId: string,
      escopo: EscopoDoInventario
    ) => RepoAlvo | undefined
  ) {}

  async lerGithub(
    escopo: EscopoDoInventario,
    nosLocais: readonly NoInventario[]
  ): Promise<ProjecaoGithubDoInventario> {
    const repo = this.repoDoProjeto(escopo.projectId, escopo)
    if (repo === undefined) throw new Error('Projeto sem referência de repositório GitHub.')

    const request: ConnectorRequest = {
      contractVersion: CONNECTOR_CONTRACT_VERSION,
      connector: 'github',
      operation: GITHUB_OPERATIONS.getRepositoryInventory,
      correlationId: randomUUID(),
      timeoutMs: 30_000,
      credential: {
        key: 'github',
        user_id: escopo.userId,
        workspace_id: escopo.workspaceId
      },
      input: repo
    }
    const outcome = await this.connectors.call(request, {
      userId: escopo.userId,
      workspace: escopo.workspaceId
    })
    const snapshot = inventoryOutcome(outcome)
    const normalizado = normalizarOrdem(snapshot)

    return {
      nos: projetarEstadoGithub(nosLocais, normalizado),
      revisao: createHash('sha256').update(JSON.stringify(normalizado), 'utf8').digest('hex'),
      completa: true
    }
  }
}

function inventoryOutcome(outcome: ConnectorOutcome): RepositoryInventoryNormalizado {
  if (!outcome.ok || !ehInventario(outcome.data)) {
    // Mensagem deliberadamente não inclui payload/erro remoto: o ConnectorService já registrou
    // proveniência e redigiu auditoria, e um snapshot inválido jamais é reutilizável.
    throw new Error('Não foi possível obter o inventário completo do GitHub.')
  }
  return outcome.data
}

function ehInventario(valor: unknown): valor is RepositoryInventoryNormalizado {
  if (typeof valor !== 'object' || valor === null) return false
  const dado = valor as Partial<RepositoryInventoryNormalizado>
  return (
    Array.isArray(dado.issues) &&
    dado.issues.every(
      (issue) =>
        typeof issue?.numero === 'number' &&
        Number.isSafeInteger(issue.numero) &&
        issue.numero > 0 &&
        typeof issue.titulo === 'string' &&
        (issue.estado === 'open' || issue.estado === 'closed') &&
        Array.isArray(issue.labels) &&
        issue.labels.every((label) => typeof label === 'string')
    ) &&
    Array.isArray(dado.pullRequests) &&
    dado.pullRequests.every(
      (pull) =>
        typeof pull?.numero === 'number' &&
        Number.isSafeInteger(pull.numero) &&
        pull.numero > 0 &&
        (pull.estado === 'open' || pull.estado === 'closed') &&
        typeof pull.merged === 'boolean' &&
        typeof pull.headBranch === 'string' &&
        typeof pull.headSha === 'string' &&
        typeof pull.baseBranch === 'string' &&
        Array.isArray(pull.issuesReferenciadas) &&
        pull.issuesReferenciadas.every((issue) => Number.isSafeInteger(issue) && issue > 0) &&
        (pull.checks === 'pending' ||
          pull.checks === 'success' ||
          pull.checks === 'failure' ||
          pull.checks === 'unknown')
    ) &&
    Array.isArray(dado.branches) &&
    dado.branches.every(
      (branch) => typeof branch?.nome === 'string' && typeof branch.sha === 'string'
    )
  )
}

function normalizarOrdem(
  inventario: RepositoryInventoryNormalizado
): RepositoryInventoryNormalizado {
  const compararTexto = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
  return {
    issues: [...inventario.issues]
      .map((issue) => ({ ...issue, labels: [...issue.labels].sort() }))
      .sort((a, b) => a.numero - b.numero),
    pullRequests: [...inventario.pullRequests]
      .map((pull) => ({
        ...pull,
        issuesReferenciadas: [...pull.issuesReferenciadas].sort((a, b) => a - b)
      }))
      .sort((a, b) => a.numero - b.numero),
    branches: [...inventario.branches].sort((a, b) => compararTexto(a.nome, b.nome))
  }
}
