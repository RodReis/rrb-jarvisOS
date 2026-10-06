import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import type { ResultadoDoCronograma } from '@shared/domain/cronograma'
import { HistoricoDoCronograma } from './HistoricoDoCronograma'

const resultado: ResultadoDoCronograma = {
  id: 'r1',
  sequenciaId: 's1',
  nome: 'Chegada',
  iniciadoEm: '2026-10-06T11:00:00.000Z',
  gatilho: 'evento',
  atividades: [
    { id: 'a', tipo: 'falar', estado: 'executada' },
    { id: 'b', tipo: 'tocar-midia-local', estado: 'nao-executada', motivo: 'mídia indisponível' }
  ]
}
let publicar: ((r: ResultadoDoCronograma) => void) | undefined
beforeEach(() => {
  publicar = undefined
  Object.defineProperty(window, 'jarvis', {
    configurable: true,
    value: {
      historicoDoCronograma: vi.fn(async () => []),
      onResultadoDoCronograma: vi.fn((listener) => {
        publicar = listener
        return () => {
          publicar = undefined
        }
      })
    }
  })
})

describe('histórico do cronograma', () => {
  it('mostra resultado publicado enquanto o Command Center está aberto', async () => {
    render(<HistoricoDoCronograma />)
    expect(screen.queryByText('Chegada')).not.toBeInTheDocument()
    await act(async () => {
      publicar?.(resultado)
    })
    expect(screen.getByText('Chegada')).toBeInTheDocument()
    expect(screen.getByText(/mídia indisponível/)).toBeInTheDocument()
  })
})
