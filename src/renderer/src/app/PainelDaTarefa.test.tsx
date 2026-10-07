import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PainelDaTarefa as Modelo } from '@shared/domain/painel-tarefa'
import { PainelDaTarefa } from './PainelDaTarefa'

const painel: Modelo = {
  projectId: 'project-1',
  runId: 'run-1',
  workspace: 'jarvis',
  estado: 'encerrado',
  snapshotsCompletos: true,
  tarefas: [
    {
      tarefaId: 'writer-1',
      papel: 'Escritor',
      estado: 'concluida',
      dependencias: [],
      paths: ['src/example.ts'],
      traces: [],
      snapshots: [
        {
          id: 'file-1',
          caminho: 'src/example.ts',
          sha256: 'abc',
          bytes: 22,
          tipo: 'texto',
          estado: 'disponivel'
        }
      ],
      diffs: [
        { id: 'diff-1', caminho: 'src/example.ts', sha256: 'def', bytes: 17, estado: 'disponivel' }
      ]
    }
  ],
  plano: [{ tarefaId: 'writer-1', papel: 'Escritor', dependencias: [] }],
  arquivosDeTeste: [],
  conteudosDeTeste: [],
  traces: {},
  eventosDeTarefa: {},
  tracesPorTarefa: {},
  atualizadoEm: '2026-10-07T12:00:00.000Z'
}

describe('PainelDaTarefa', () => {
  beforeEach(() => {
    vi.stubGlobal('jarvis', {
      painelDaTarefa: vi.fn(async () => painel),
      painelDaTarefaConteudo: vi.fn(async () => 'const answer = 42\n'),
      onSquadTaskEvent: vi.fn(() => vi.fn())
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('reabre tarefa, lê arquivo via IPC escopado e permite busca no conteúdo sem edição', async () => {
    const user = userEvent.setup()
    render(<PainelDaTarefa runId="run-1" workspace="jarvis" onFechar={vi.fn()} />)

    expect(await screen.findByRole('button', { name: 'Escritor' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Arquivos' }))
    await user.click(screen.getByRole('button', { name: /src\/example\.ts/ }))
    expect(await screen.findByLabelText('Conteúdo do arquivo')).toHaveTextContent('answer = 42')
    expect(window.jarvis.painelDaTarefaConteudo).toHaveBeenCalledWith('run-1', 'file-1', 'jarvis')

    await user.type(screen.getByRole('textbox', { name: 'Buscar no arquivo' }), 'answer')
    await waitFor(() =>
      expect(screen.getByLabelText('Conteúdo do arquivo').querySelector('mark')?.textContent).toBe(
        'answer'
      )
    )
    expect(screen.getByLabelText('Conteúdo do arquivo').querySelector('input, textarea')).toBeNull()
  })

  it('cancela a assinatura ao fechar o componente', async () => {
    const cancelar = vi.fn()
    vi.mocked(window.jarvis.onSquadTaskEvent).mockReturnValue(cancelar)
    const { unmount } = render(
      <PainelDaTarefa runId="run-1" workspace="jarvis" onFechar={vi.fn()} />
    )
    await waitFor(() => expect(window.jarvis.painelDaTarefa).toHaveBeenCalled())
    unmount()
    expect(cancelar).toHaveBeenCalledOnce()
  })
})
