import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS, IPC_SEND_CHANNELS } from '@shared/contracts/ipc'
import type { ConfiguracaoDasBoasVindas } from '@shared/domain/boas-vindas'
import { CONFIGURACAO_PADRAO_DAS_BOAS_VINDAS } from './estado-das-boas-vindas-em-disco'
import { registrarIpcDasBoasVindas } from './boas-vindas-ipc'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const ouvintes = new Map<string, (...args: unknown[]) => unknown>()
const showOpenDialog = vi.fn()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (canal: string, fn: (...args: unknown[]) => unknown) => handlers.set(canal, fn),
    on: (canal: string, fn: (...args: unknown[]) => unknown) => ouvintes.set(canal, fn)
  },
  dialog: { showOpenDialog: (...args: unknown[]) => showOpenDialog(...args) }
}))

beforeEach(() => {
  handlers.clear()
  ouvintes.clear()
  showOpenDialog.mockReset()
})

function cenario() {
  let config: ConfiguracaoDasBoasVindas = CONFIGURACAO_PADRAO_DAS_BOAS_VINDAS
  const send = vi.fn()
  const webContents = { send, once: vi.fn() }
  const janela = { isDestroyed: () => false, webContents }
  const ponte = registrarIpcDasBoasVindas(
    {
      configuracao: () => config,
      salvarConfiguracao: (novo) => {
        config = novo
      }
    },
    () => janela as never
  )
  return {
    ponte,
    send,
    webContents,
    get config() {
      return config
    },
    handler: (canal: string) => handlers.get(canal)!,
    ouvinte: (canal: string) => ouvintes.get(canal)!
  }
}

describe('ponte fechada das boas-vindas', () => {
  it('registra exatamente seus canais declarados e ignora caminho forjado pelo renderer', () => {
    const c = cenario()
    expect([...handlers.keys()].sort()).toEqual(
      [
        IPC_CHANNELS.boasVindasLer,
        IPC_CHANNELS.boasVindasSalvar,
        IPC_CHANNELS.boasVindasSelecionarMidia
      ].sort()
    )
    expect([...ouvintes.keys()].sort()).toEqual(
      [IPC_SEND_CHANNELS.boasVindasPronto, IPC_SEND_CHANNELS.boasVindasReproducaoConcluida].sort()
    )
    c.handler(IPC_CHANNELS.boasVindasSalvar)(
      {},
      {
        ...CONFIGURACAO_PADRAO_DAS_BOAS_VINDAS,
        ativa: true,
        midia: { tipo: 'arquivo', caminho: 'C:\\segredo.txt' }
      }
    )
    expect(c.config.ativa).toBe(true)
    expect(c.config.midia).toBeNull()
  })

  it('só aceita fonte escolhida pelo diálogo do main', async () => {
    const c = cenario()
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\Musica\\chegada.mp3'] })
    await c.handler(IPC_CHANNELS.boasVindasSelecionarMidia)({}, 'arquivo')
    expect(c.config.midia).toEqual({ tipo: 'arquivo', caminho: 'C:\\Musica\\chegada.mp3' })
    expect(c.config.midiaAtiva).toBe(true)
  })

  it('só conclui reprodução iniciada pelo main com ACK da janela atual', async () => {
    const c = cenario()
    await expect(c.ponte.reproduzir({ acao: 'fala', texto: 'Olá.' })).rejects.toThrow(
      'indisponível'
    )
    c.ouvinte(IPC_SEND_CHANNELS.boasVindasPronto)({ sender: c.webContents })
    const reproduzindo = c.ponte.reproduzir({ acao: 'fala', texto: 'Olá.' })
    const [canal, pedido] = c.send.mock.calls[0] as [string, { id: string; texto: string }]
    expect(canal).toBe(IPC_EVENT_CHANNELS.boasVindasReproduzir)
    expect(pedido.texto).toBe('Olá.')
    c.ouvinte(IPC_SEND_CHANNELS.boasVindasReproducaoConcluida)({ sender: {} }, pedido.id, true)
    c.ouvinte(IPC_SEND_CHANNELS.boasVindasReproducaoConcluida)(
      { sender: c.webContents },
      pedido.id,
      true
    )
    await expect(reproduzindo).resolves.toBeUndefined()
  })

  it('pede cancelamento no prazo e espera ACK de parada antes de liberar a fila', async () => {
    vi.useFakeTimers()
    try {
      const c = cenario()
      c.ouvinte(IPC_SEND_CHANNELS.boasVindasPronto)({ sender: c.webContents })
      const reproduzindo = c.ponte.reproduzir({
        acao: 'midia',
        dados: new Uint8Array([1]),
        tipo: 'audio/wav'
      })
      const pedido = c.send.mock.calls[0]?.[1] as { id: string }
      await vi.advanceTimersByTimeAsync(120_000)
      expect(c.send).toHaveBeenLastCalledWith(
        IPC_EVENT_CHANNELS.boasVindasCancelarReproducao,
        pedido.id
      )
      c.ouvinte(IPC_SEND_CHANNELS.boasVindasReproducaoConcluida)(
        { sender: c.webContents },
        pedido.id,
        false
      )
      await expect(reproduzindo).rejects.toThrow('não concluída')
    } finally {
      vi.useRealTimers()
    }
  })
})
