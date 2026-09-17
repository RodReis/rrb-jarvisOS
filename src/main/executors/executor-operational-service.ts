import type { WorkspaceId } from '@shared/domain/entities'
import {
  buildExecutorPreview,
  isExecutorDeCodigo,
  type ExecutorOperationalView
} from '@shared/domain/executor-operacional'
import type { CodexProfileService } from '../ai/codex-profile-service'
import type { ExecutorPreferenceRepository } from './executor-preference-repository'

export interface ExecutorOperationalDeps {
  readonly userId: () => string
  readonly repository: ExecutorPreferenceRepository
  readonly codex: CodexProfileService
  readonly claudeDisponivel: () => Promise<boolean>
  readonly headSha: (projectId: string) => string
}

export class ExecutorOperationalService {
  constructor(private readonly deps: ExecutorOperationalDeps) {}

  async view(projectId: string, workspaceId: WorkspaceId): Promise<ExecutorOperationalView> {
    const preference = this.deps.repository.find(this.deps.userId(), workspaceId, projectId)
    const [codex, claudeDisponivel] = await Promise.all([
      this.deps.codex.estado(),
      this.deps.claudeDisponivel()
    ])
    const preview = buildExecutorPreview({ preference, codex, claudeDisponivel, gastoUsd: 0 })
    const now = new Date().toISOString()

    return {
      preference,
      preview,
      proof: {
        projectId,
        workspaceId,
        writer: preview.writer,
        revisor: preview.revisor,
        modoDaRevisao: preview.modoDaRevisao,
        headSha: this.deps.headSha(projectId),
        checks: [],
        resultado: 'not_run',
        motivo:
          'Prova operacional real depende de repositório exclusivo e orçamento/autorização explícitos.',
        createdAt: now
      }
    }
  }

  async save(input: {
    readonly projectId: string
    readonly workspaceId: WorkspaceId
    readonly executores: readonly string[]
    readonly fallbackPermitido: boolean
    readonly tetoUsd?: number
  }): Promise<ExecutorOperationalView> {
    const preference = this.deps.repository.save({
      userId: this.deps.userId(),
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      executores: input.executores.filter(isExecutorDeCodigo),
      fallbackPermitido: input.fallbackPermitido,
      ...(input.tetoUsd === undefined ? {} : { tetoUsd: input.tetoUsd }),
      updatedAt: ''
    })

    return await this.view(preference.projectId, preference.workspaceId)
  }
}
