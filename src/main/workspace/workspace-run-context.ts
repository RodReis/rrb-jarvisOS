import { AsyncLocalStorage } from 'node:async_hooks'
import type { WorkspaceId } from '@shared/domain/entities'

/** Mantém cada execução longa no workspace de origem, mesmo com outros runs concorrentes. */
export class WorkspaceRunContext {
  private readonly storage = new AsyncLocalStorage<WorkspaceId>()

  run<T>(workspaceId: WorkspaceId, operation: () => T): T {
    return this.storage.run(workspaceId, operation)
  }

  atual(fallback: () => WorkspaceId): WorkspaceId {
    return this.storage.getStore() ?? fallback()
  }
}
