import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { registrarIpcDoCronograma } from './cronograma-ipc'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const showOpenDialog = vi.fn()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (canal: string, fn: (...args: unknown[]) => unknown) => handlers.set(canal, fn)
  },
  dialog: { showOpenDialog: (...args: unknown[]) => showOpenDialog(...args) }
}))
beforeEach(() => {
  handlers.clear()
  showOpenDialog.mockReset()
})

describe('IPC fechado do cronograma', () => {
  it('recusa caminho forjado e só salva a mídia escolhida no diálogo local', async () => {
    const salvar = vi.fn((config) => config)
    const autorizados = new Set<string>()
    registrarIpcDoCronograma(
      {
        ler: () => ({ versao: 1, ativa: false, sequencias: [] }),
        historico: () => [],
        salvar
      } as never,
      () => autorizados
    )
    const pedido = (caminho: string) => ({
      versao: 1,
      ativa: true,
      sequencias: [
        {
          id: 'entrada',
          nome: 'Chegada',
          ativa: true,
          gatilho: { tipo: 'evento', evento: 'boas-vindas' },
          atividades: [
            { id: 'musica', tipo: 'tocar-midia-local', midia: { tipo: 'arquivo', caminho } }
          ]
        }
      ]
    })
    expect(() =>
      handlers.get(IPC_CHANNELS.cronogramaSalvar)!({}, pedido('C:/segredo.mp3'))
    ).toThrow(/não selecionada/)
    expect(salvar).not.toHaveBeenCalled()
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:/musica.mp3'] })
    expect(await handlers.get(IPC_CHANNELS.cronogramaSelecionarMidia)!({}, 'arquivo')).toEqual({
      tipo: 'arquivo',
      caminho: 'C:/musica.mp3'
    })
    expect(handlers.get(IPC_CHANNELS.cronogramaSalvar)!({}, pedido('C:/musica.mp3'))).toMatchObject(
      { ativa: true }
    )
    expect(salvar).toHaveBeenCalledOnce()
  })
})
