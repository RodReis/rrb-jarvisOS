import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalControlado } from './TerminalControlado'

/**
 * Painel do terminal controlado (SPEC-ExecucaoReal-02, critério 10).
 *
 * O painel é testado **isolado**, não pelo `App`: o que se investiga aqui é a forma da
 * submissão e a exibição do desfecho, não o gate de entrada nem a navegação — esses já têm
 * suíte própria.
 *
 * A ponte é mockada porque o renderer não executa nada: toda decisão vem do main. Um mock que
 * decidisse política aqui provaria a política do teste, não a do produto.
 */

const runCommand = vi.fn()
const listAllowedCommands = vi.fn()
const addAllowedCommand = vi.fn()
const removeAllowedCommand = vi.fn()

function execucao(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'cmd-1',
    user_id: 'u-1',
    workspace_id: 'jarvis',
    binary: 'git',
    args: ['status'],
    cwd: '/permitido',
    state: 'concluido',
    reason: 'executado',
    stdout: 'nothing to commit',
    stderr: '',
    exitCode: 0,
    durationMs: 42,
    correlationId: 'corr-1',
    created_at: '2026-08-28T12:00:00.000Z',
    ...over
  }
}

beforeEach(() => {
  runCommand.mockClear()
  listAllowedCommands.mockClear()
  addAllowedCommand.mockClear()
  removeAllowedCommand.mockClear()
  listAllowedCommands.mockResolvedValue(['git'])
  addAllowedCommand.mockResolvedValue(['git', 'node'])
  removeAllowedCommand.mockResolvedValue([])
  runCommand.mockResolvedValue(execucao())

  Object.defineProperty(window, 'jarvis', {
    value: {
      runCommand,
      listAllowedCommands,
      addAllowedCommand,
      removeAllowedCommand,
      sendLog: vi.fn()
    },
    configurable: true,
    writable: true
  })
})

describe('painel do terminal controlado', () => {
  it('submete binário e argumentos separados — nunca uma linha de comando', async () => {
    // A forma da submissão é a barreira: o main recebe campos, não uma string a tokenizar.
    render(<TerminalControlado workspace="jarvis" />)

    await userEvent.type(screen.getByLabelText(/^comando$/i), 'git')
    await userEvent.type(screen.getByLabelText(/argumentos/i), 'status --short')
    await userEvent.type(screen.getByLabelText(/diretório de trabalho/i), '/permitido')
    await userEvent.click(screen.getByRole('button', { name: /executar/i }))

    await waitFor(() =>
      expect(runCommand).toHaveBeenCalledWith(
        { binary: 'git', args: ['status', '--short'], cwd: '/permitido' },
        'jarvis'
      )
    )
  })

  it('não deixa submeter sem comando ou sem diretório', async () => {
    render(<TerminalControlado workspace="jarvis" />)

    expect(screen.getByRole('button', { name: /executar/i })).toBeDisabled()

    await userEvent.type(screen.getByLabelText(/^comando$/i), 'git')
    expect(screen.getByRole('button', { name: /executar/i })).toBeDisabled()

    await userEvent.type(screen.getByLabelText(/diretório de trabalho/i), '/permitido')
    expect(screen.getByRole('button', { name: /executar/i })).toBeEnabled()
  })

  it('mostra a saída e o exit code de um comando concluído', async () => {
    render(<TerminalControlado workspace="jarvis" />)

    await userEvent.type(screen.getByLabelText(/^comando$/i), 'git')
    await userEvent.type(screen.getByLabelText(/diretório de trabalho/i), '/permitido')
    await userEvent.click(screen.getByRole('button', { name: /executar/i }))

    const saida = await screen.findByRole('log', { name: /saída do comando/i }).catch(() => null)
    const regiao = saida ?? (await screen.findByLabelText(/saída do comando/i))

    expect(regiao).toHaveTextContent('nothing to commit')
    expect(regiao).toHaveTextContent('código 0')
  })

  it('explica em português por que um comando foi bloqueado — nunca o enum cru', async () => {
    runCommand.mockResolvedValue(
      execucao({
        state: 'bloqueado',
        reason: 'binario-fora-da-allowlist',
        stdout: '',
        exitCode: null
      })
    )
    render(<TerminalControlado workspace="jarvis" />)

    await userEvent.type(screen.getByLabelText(/^comando$/i), 'curl')
    await userEvent.type(screen.getByLabelText(/diretório de trabalho/i), '/permitido')
    await userEvent.click(screen.getByRole('button', { name: /executar/i }))

    expect(await screen.findByText(/não está na lista de permitidos/i)).toBeInTheDocument()
    expect(screen.queryByText('binario-fora-da-allowlist')).not.toBeInTheDocument()
  })

  it('avisa que um comando destrutivo ficou pendente de aprovação', async () => {
    runCommand.mockResolvedValue(
      execucao({
        state: 'aguardando-aprovacao',
        reason: 'aguardando-aprovacao-destrutivo',
        motivoDestrutivo: 'Remove arquivos ou diretórios',
        stdout: '',
        exitCode: null,
        approvalRequestId: 'apr-1'
      })
    )
    render(<TerminalControlado workspace="jarvis" />)

    await userEvent.type(screen.getByLabelText(/^comando$/i), 'rm')
    await userEvent.type(screen.getByLabelText(/diretório de trabalho/i), '/permitido')
    await userEvent.click(screen.getByRole('button', { name: /executar/i }))

    expect(await screen.findByText(/remove arquivos ou diretórios/i)).toBeInTheDocument()
    expect(screen.getByText(/decida em operações/i)).toBeInTheDocument()
  })

  it('não comunica estado só por cor — o estado tem rótulo em texto', async () => {
    runCommand.mockResolvedValue(
      execucao({ state: 'falhou', reason: 'falha-na-execucao', exitCode: 1 })
    )
    render(<TerminalControlado workspace="jarvis" />)

    await userEvent.type(screen.getByLabelText(/^comando$/i), 'git')
    await userEvent.type(screen.getByLabelText(/diretório de trabalho/i), '/permitido')
    await userEvent.click(screen.getByRole('button', { name: /executar/i }))

    expect(await screen.findByText('Falhou')).toBeInTheDocument()
  })

  it('lista, permite e revoga comandos da allowlist do espaço', async () => {
    render(<TerminalControlado workspace="jarvis" />)

    expect(await screen.findByText('git')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(/permitir comando/i), 'node')
    await userEvent.click(screen.getByRole('button', { name: /^permitir$/i }))

    await waitFor(() => expect(addAllowedCommand).toHaveBeenCalledWith('node', 'jarvis'))
    expect(await screen.findByText('node')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /revogar git/i }))
    await waitFor(() => expect(removeAllowedCommand).toHaveBeenCalledWith('git', 'jarvis'))
  })

  it('avisa quando nenhum comando está permitido — o terminal nasce inerte', async () => {
    listAllowedCommands.mockResolvedValue([])
    render(<TerminalControlado workspace="jarvis" />)

    expect(await screen.findByText(/nenhum comando permitido/i)).toBeInTheDocument()
  })

  it('é operável por teclado do primeiro campo ao botão', async () => {
    render(<TerminalControlado workspace="jarvis" />)
    await screen.findByText('git')

    await userEvent.tab()
    expect(screen.getByLabelText(/^comando$/i)).toHaveFocus()

    await userEvent.tab()
    expect(screen.getByLabelText(/argumentos/i)).toHaveFocus()

    await userEvent.tab()
    expect(screen.getByLabelText(/diretório de trabalho/i)).toHaveFocus()
  })
})
