import { describe, expect, it } from 'vitest'
import { buildExecutorPreview, type ExecutorPreference } from './executor-operacional'
import type { CodexProfileState } from './codex-profile'

const preference: ExecutorPreference = {
  userId: 'u1',
  workspaceId: 'jarvis',
  projectId: 'p1',
  executores: ['codex-exec', 'claude-code'],
  fallbackPermitido: true,
  updatedAt: ''
}

const codex: CodexProfileState = {
  saude: 'quota_unknown',
  codexHome: 'C:/userData/codex-pipeline',
  modo: 'subscription_limited'
}

describe('visao operacional de executores', () => {
  it('quota_unknown aparece como desconhecida e ainda pode ser elegivel no modo de assinatura', () => {
    const preview = buildExecutorPreview({ preference, codex, claudeDisponivel: true, gastoUsd: 0 })

    expect(preview.writer).toBe('codex-exec')
    expect(preview.revisor).toBe('claude-code')
    expect(preview.modoDaRevisao).toBe('cruzada')
    expect(preview.estados.find((e) => e.executor === 'codex-exec')).toMatchObject({
      quota: 'quota_unknown',
      elegivel: true
    })
  })

  it('modo pago sem teto bloqueia antes da execucao', () => {
    const preview = buildExecutorPreview({
      preference: { ...preference, executores: ['codex-exec'] },
      codex: { ...codex, modo: 'subscription_credits' },
      claudeDisponivel: false,
      gastoUsd: 0
    })

    expect(preview.decisao).toBe('bloqueado')
    expect(preview.estados.find((e) => e.executor === 'codex-exec')?.elegivel).toBe(false)
  })
})
