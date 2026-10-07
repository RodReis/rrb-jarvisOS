import { describe, expect, it } from 'vitest'
import { WorkspaceRunContext } from './workspace-run-context'

describe('WorkspaceRunContext', () => {
  it('preserva o workspace original em operações assíncronas concorrentes', async () => {
    const contexto = new WorkspaceRunContext()
    const ativo = 'noa' as const
    const padrao = () => ativo
    const aguardar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    const execucao = (workspace: 'jarvis' | 'noa', atraso: number) =>
      contexto.run(workspace, async () => {
        await aguardar(atraso)
        return contexto.atual(padrao)
      })

    const [primeira, segunda] = await Promise.all([execucao('jarvis', 10), execucao('noa', 1)])

    expect(primeira).toBe('jarvis')
    expect(segunda).toBe('noa')
    expect(contexto.atual(padrao)).toBe('noa')
  })
})
