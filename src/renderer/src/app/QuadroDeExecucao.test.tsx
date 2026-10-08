import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { QuadroDeExecucao } from '@shared/domain/quadro-execucao'
import type { SnapshotDeControles } from '@shared/domain/continuous-controls'
import { QuadroDeExecucao as TelaDoQuadro } from './QuadroDeExecucao'

describe('equipe do Squad no cartão do quadro', () => {
  it('mostra modelos, teto de custo, workflow e progresso persistido', async () => {
    const run = {
      id: 'run-1',
      user_id: 'u-1',
      projectId: 'p-1',
      sliceId: 's-1',
      estado: 'RUNNING',
      created_at: '2026-10-07T12:00:00.000Z',
      updated_at: '2026-10-07T12:01:00.000Z',
      squadSnapshot: {
        perfil: { escritores: 1, revisor: { camada: 'especialista' } },
        resolucao: {
          camadas: {
            orquestrador: { modelo: { provider: 'claude-code', modelo: 'claude-fable-5-1' } },
            executor: { modelo: { provider: 'claude-code', modelo: 'claude-fable-5-1' } },
            especialista: { modelo: { provider: 'claude-code', modelo: 'claude-fable-5-1' } }
          }
        }
      },
      squadCostLimitUsd: 0,
      squadCostMeasured: false,
      squadProgress: [{ tarefaId: 'dev-1', papel: 'desenvolvedor', estado: 'concluida' }]
    } as const
    const quadro: QuadroDeExecucao = {
      projectId: 'p-1',
      geradoEm: '2026-10-07T12:01:00.000Z',
      colunas: [
        {
          id: 'developer',
          titulo: 'DEVELOPER',
          cartoes: [
            {
              sliceId: 's-1',
              mvpId: 'm-1',
              numeroDoMvp: 28,
              numeroDaFatia: 1,
              titulo: 'Fatia de execução',
              specExecutavel: true,
              issue: 370,
              coluna: 'developer',
              aprovacaoPendente: {
                id: 'approval-1',
                acao: 'db.alter-structure',
                motivo: 'alteracao-estrutural-de-banco'
              },
              run,
              equipe: {
                objetivo: 'Fatia de execução',
                escritores: 1,
                membros: [
                  { papel: 'Orquestrador', provider: 'claude-code', modelo: 'claude-fable-5-1' },
                  { papel: 'Executor', provider: 'claude-code', modelo: 'claude-fable-5-1' },
                  { papel: 'Reviewer', provider: 'claude-code', modelo: 'claude-fable-5-1' }
                ],
                workflow: ['DEVELOPER', 'TESTE', 'REVIEWER', 'PR/MERGE', 'DONE', 'Finalizado (PI)'],
                limiteCusto: { usd: 0, medido: false },
                progresso: run.squadProgress
              },
              dependenciasAbertas: [],
              consulta: { estado: 'nao-consultado', checksPendentes: [], checks: [] }
            }
          ]
        }
      ]
    }
    vi.stubGlobal('jarvis', {
      quadroDeExecucao: vi.fn(async () => quadro),
      lerControlesContinuos: vi.fn(async () => controles),
      definirControleContinuo: vi.fn(async () => ({ status: 'updated', snapshot: controles })),
      playNoQuadro: vi.fn(async () => []),
      cancelarNoQuadro: vi.fn(async () => ({
        cancelado: true,
        fase: 'durante-execucao',
        rascunho: 'sem-pr'
      })),
      resolverAprovacaoDoSquad: vi.fn(async () => true)
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<TelaDoQuadro projectId="p-1" workspace="jarvis" />)

    expect(await screen.findByText('Controles operacionais')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pausar após os runs ativos' }))
    await waitFor(() =>
      expect(window.jarvis.definirControleContinuo).toHaveBeenCalledWith(
        expect.objectContaining({
          escopo: { workspaceId: 'jarvis', projectId: 'p-1' },
          acao: { tipo: 'pausa', pausada: true }
        })
      )
    )

    expect(await screen.findByText('Equipe · 1 escritor(es)')).toBeInTheDocument()
    expect(screen.getByText('Orquestrador: claude-fable-5-1 (claude-code)')).toBeInTheDocument()
    expect(
      screen.getByText('Teto de custo: sem custo variável medido para a rota escolhida')
    ).toBeInTheDocument()
    expect(screen.getByText(/DEVELOPER → TESTE → REVIEWER → PR\/MERGE → DONE/)).toBeInTheDocument()
    expect(screen.getByText('desenvolvedor: concluída')).toBeInTheDocument()
    expect(screen.getByText('Aguardando PI')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar ação' }))
    await waitFor(() =>
      expect(window.jarvis.resolverAprovacaoDoSquad).toHaveBeenCalledWith(
        'p-1',
        'approval-1',
        'aprovado',
        'jarvis'
      )
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar run' }))
    await waitFor(() =>
      expect(window.jarvis.cancelarNoQuadro).toHaveBeenCalledWith('p-1', 'run-1', 'jarvis')
    )
    await waitFor(() => expect(window.jarvis.quadroDeExecucao).toHaveBeenCalled())
    vi.unstubAllGlobals()
  })
})

const controles: SnapshotDeControles = {
  escopo: 'projeto',
  projetoId: 'p-1',
  pausa: { pausada: false, drenando: false, noEscopoAtual: false, noWorkspace: false },
  controles: {
    execucao: { enabled: true, herdado: false },
    gasto: { enabled: true, herdado: false },
    push: { enabled: true, herdado: false },
    'criacao-pr': { enabled: true, herdado: false },
    merge: { enabled: true, herdado: false }
  },
  ativos: []
}
