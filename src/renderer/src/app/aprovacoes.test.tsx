import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalRequest } from '@shared/domain/execution'
import { AprovacoesPendentes } from './AprovacoesPendentes'

/**
 * Card da fila de aprovações (#84 — SPEC-DS-04b, critério 1).
 *
 * A fila é compartilhada entre filesystem (F01) e terminal (F02) de propósito, então o que
 * esta suíte prova é a **distinção**: um pedido de comando precisa dizer que é execução de
 * comando e mostrar binário, argumentos e cwd — descrevê-lo como "Filesystem" faz o usuário
 * aprovar às cegas, que é exatamente a confirmação genérica que a spec proíbe.
 */

const listPendingApprovals = vi.fn()

function pedido(over: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'ap-1',
    user_id: 'u-1',
    workspace_id: 'jarvis',
    runId: 'run-1',
    stepId: 'comando',
    action: 'process.execute',
    status: 'pendente',
    risk: 'alto',
    reason: 'aguardando-aprovacao-destrutivo',
    operation: {},
    created_at: '2026-08-29T12:00:00.000Z',
    ...over
  }
}

beforeEach(() => {
  listPendingApprovals.mockClear()

  Object.defineProperty(window, 'jarvis', {
    value: { listPendingApprovals, resolveApproval: vi.fn(), sendLog: vi.fn() },
    configurable: true
  })
})

describe('Card de aprovação pendente', () => {
  it('descreve um comando de terminal com binário e argumentos, não como filesystem', async () => {
    listPendingApprovals.mockResolvedValue([
      pedido({
        operation: { kind: 'comando', binary: 'node', args: ['--force'], cwd: '/permitido' }
      })
    ])

    render(<AprovacoesPendentes workspace="jarvis" />)

    expect(await screen.findByText('Executar comando: node --force')).toBeInTheDocument()
    expect(screen.queryByText(/^Filesystem:/)).not.toBeInTheDocument()
  })

  it('mostra o diretório de trabalho no escopo do comando', async () => {
    listPendingApprovals.mockResolvedValue([
      pedido({
        operation: { kind: 'comando', binary: 'node', args: ['--force'], cwd: '/permitido' }
      })
    ])

    render(<AprovacoesPendentes workspace="jarvis" />)

    expect(await screen.findByText('node --force (em /permitido)')).toBeInTheDocument()
  })

  it('mantém a descrição de filesystem para as operações de arquivo', async () => {
    listPendingApprovals.mockResolvedValue([
      pedido({
        stepId: 'etapa-1',
        action: 'fs.write',
        reason: 'elevada-por-path-fora-da-allowlist',
        operation: { kind: 'write', path: '/tmp/a.txt' }
      })
    ])

    render(<AprovacoesPendentes workspace="jarvis" />)

    expect(await screen.findByText('Filesystem: write')).toBeInTheDocument()
    expect(screen.getByText('/tmp/a.txt')).toBeInTheDocument()
  })
})
