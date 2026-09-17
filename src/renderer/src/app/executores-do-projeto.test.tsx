import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutorOperationalView } from '@shared/domain/executor-operacional'
import { ExecutoresDoProjeto } from './ExecutoresDoProjeto'

const executorView = vi.fn()
const saveExecutorPreference = vi.fn()

function view(over: Partial<ExecutorOperationalView> = {}): ExecutorOperationalView {
  return {
    preference: {
      userId: 'u-1',
      workspaceId: 'jarvis',
      projectId: 'p-1',
      executores: ['claude-code', 'codex-exec'],
      fallbackPermitido: true,
      updatedAt: '2026-09-17T01:00:00.000Z'
    },
    preview: {
      decisao: 'escolhido',
      writer: 'claude-code',
      revisor: 'codex-exec',
      motivo: 'Claude Code executa e Codex revisa.',
      estados: [
        {
          executor: 'claude-code',
          rotulo: 'Claude Code',
          disponivel: true,
          elegivel: true,
          quota: 'available',
          autenticacao: 'ok',
          modoDeCobranca: 'unmetered',
          modelo: 'claude-opus-5',
          motivo: 'CLI local disponível.'
        },
        {
          executor: 'codex-exec',
          rotulo: 'Codex',
          disponivel: true,
          elegivel: true,
          quota: 'quota_unknown',
          autenticacao: 'ok',
          modoDeCobranca: 'unmetered',
          modelo: 'gpt-5.6-sol',
          motivo: 'Plano por assinatura; quota não inspecionável localmente.'
        }
      ]
    },
    proof: {
      projectId: 'p-1',
      workspaceId: 'jarvis',
      writer: 'claude-code',
      revisor: 'codex-exec',
      modoDaRevisao: 'cruzada',
      headSha: '',
      checks: [],
      resultado: 'not_run',
      motivo: 'Prova real exige repositório exclusivo.',
      createdAt: '2026-09-17T01:00:00.000Z'
    },
    ...over
  }
}

beforeEach(() => {
  executorView.mockReset().mockResolvedValue(view())
  saveExecutorPreference.mockReset().mockResolvedValue(view())
  vi.stubGlobal('jarvis', {
    executorView,
    saveExecutorPreference,
    sendLog: vi.fn()
  })
})

describe('Executores do projeto', () => {
  it('mostra preview, quota desconhecida e prova operacional sem segredo', async () => {
    render(<ExecutoresDoProjeto projectId="p-1" workspace="jarvis" />)

    expect(await screen.findAllByText('Claude Code')).not.toHaveLength(0)
    expect(screen.getByText('Quota desconhecida')).toBeInTheDocument()
    expect(screen.getByText('Writer Claude Code · revisor Codex')).toBeInTheDocument()
    expect(screen.getByText('Prova real exige repositório exclusivo.')).toBeInTheDocument()
  })

  it('bloqueia teto inválido antes de persistir preferência', async () => {
    const usuario = userEvent.setup()
    render(<ExecutoresDoProjeto projectId="p-1" workspace="jarvis" />)

    await usuario.clear(await screen.findByLabelText('Teto para modos pagos (USD)'))
    await usuario.type(screen.getByLabelText('Teto para modos pagos (USD)'), '-1')
    await usuario.click(screen.getByRole('button', { name: /salvar preferência/i }))

    expect(
      await screen.findByText('Teto precisa ser um número maior ou igual a zero.')
    ).toBeInTheDocument()
    expect(saveExecutorPreference).not.toHaveBeenCalled()
  })

  it('salva preferência e teto pelo IPC tipado', async () => {
    const usuario = userEvent.setup()
    render(<ExecutoresDoProjeto projectId="p-1" workspace="jarvis" />)

    await screen.findByText('Prova real exige repositório exclusivo.')
    await usuario.type(screen.getByLabelText('Teto para modos pagos (USD)'), '12.5')
    await usuario.click(screen.getByRole('button', { name: /salvar preferência/i }))

    await waitFor(() =>
      expect(saveExecutorPreference).toHaveBeenCalledWith(
        'p-1',
        ['claude-code', 'codex-exec'],
        true,
        12.5,
        'jarvis'
      )
    )
  })
})
