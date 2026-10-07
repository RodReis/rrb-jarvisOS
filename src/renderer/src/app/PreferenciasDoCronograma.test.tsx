import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ConfiguracaoDoCronograma } from '@shared/domain/cronograma'
import { PreferenciasDoCronograma } from './PreferenciasDoCronograma'

const inicial: ConfiguracaoDoCronograma = {
  versao: 1,
  ativa: false,
  sequencias: [
    {
      id: 'seq',
      nome: 'Chegada',
      ativa: true,
      gatilho: { tipo: 'evento', evento: 'boas-vindas' },
      atividades: [
        { id: 'fala', tipo: 'falar' },
        {
          id: 'midia',
          tipo: 'tocar-midia-local',
          midia: { tipo: 'arquivo', caminho: 'C:/musica.mp3' }
        }
      ]
    }
  ]
}
const lerCronograma = vi.fn(async () => inicial)
const salvarCronograma = vi.fn(async (c: ConfiguracaoDoCronograma) => c)
beforeEach(() => {
  lerCronograma.mockClear()
  salvarCronograma.mockClear()
  Object.defineProperty(window, 'jarvis', {
    configurable: true,
    value: { lerCronograma, salvarCronograma, selecionarMidiaDoCronograma: vi.fn(async () => null) }
  })
})

describe('editor do cronograma', () => {
  it('mostra a ordem e salva a reordenação pelo IPC', async () => {
    render(<PreferenciasDoCronograma />)
    const lista = await screen.findByRole('list')
    expect(within(lista).getAllByRole('listitem')[0]).toHaveTextContent('Falar pela persona')
    const segundo = within(lista).getAllByRole('listitem')[1]
    fireEvent.click(within(segundo).getByRole('button', { name: '↑' }))
    expect(within(lista).getAllByRole('listitem')[0]).toHaveTextContent('Tocar mídia local')
    fireEvent.click(screen.getByRole('button', { name: 'Validar e salvar' }))
    await waitFor(() =>
      expect(salvarCronograma).toHaveBeenCalledWith(
        expect.objectContaining({
          sequencias: [
            expect.objectContaining({
              atividades: [
                expect.objectContaining({ id: 'midia' }),
                expect.objectContaining({ id: 'fala' })
              ]
            })
          ]
        })
      )
    )
  })
  it('exibe a recusa de política retornada pelo main', async () => {
    salvarCronograma.mockRejectedValueOnce(new Error('Atividade fala (falar) recusada: tier médio'))
    render(<PreferenciasDoCronograma />)
    await screen.findByText('Chegada')
    fireEvent.click(screen.getByRole('button', { name: 'Validar e salvar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Atividade fala (falar) recusada')
  })
})
