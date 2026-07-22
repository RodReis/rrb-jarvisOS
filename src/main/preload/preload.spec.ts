import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BRIDGE_KEY, IPC_CHANNELS } from '@shared/contracts/ipc'

const exposeInMainWorld = vi.fn()
const invoke = vi.fn().mockResolvedValue({})

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (...args: unknown[]) => exposeInMainWorld(...args)
  },
  ipcRenderer: {
    invoke: (...args: unknown[]) => invoke(...args)
  }
}))

/** Carrega o preload num módulo limpo e devolve o objeto realmente exposto. */
async function carregarPonte(): Promise<Record<string, unknown>> {
  vi.resetModules()
  await import('./index')
  const [, bridge] = exposeInMainWorld.mock.calls.at(-1) as [string, Record<string, unknown>]
  return bridge
}

describe('ponte do preload', () => {
  beforeEach(() => {
    exposeInMainWorld.mockClear()
    invoke.mockClear()
    // O preload só expõe a ponte quando o contexto está isolado.
    Object.defineProperty(process, 'contextIsolated', { value: true, configurable: true })
  })

  it('expõe a ponte sob a chave do contrato', async () => {
    await carregarPonte()
    expect(exposeInMainWorld).toHaveBeenCalledTimes(1)
    expect(exposeInMainWorld.mock.calls[0]?.[0]).toBe(BRIDGE_KEY)
  })

  it('expõe somente os métodos do contrato — nenhum canal genérico', async () => {
    const bridge = await carregarPonte()
    // Critério de aceite 4: a superfície é fechada. Um `invoke`/`send`/`on` cru aqui
    // deixaria o renderer alcançar qualquer handler do main.
    expect(Object.keys(bridge).sort()).toEqual(['getAppInfo'])
  })

  it('não expõe ipcRenderer nem primitivas de canal arbitrário', async () => {
    const bridge = await carregarPonte()
    for (const proibido of ['invoke', 'send', 'sendSync', 'on', 'once', 'postMessage']) {
      expect(bridge).not.toHaveProperty(proibido)
    }
  })

  it('roteia getAppInfo pelo canal declarado no contrato', async () => {
    const bridge = await carregarPonte()
    await (bridge.getAppInfo as () => Promise<unknown>)()
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.appInfo)
  })

  it('recusa expor a ponte quando contextIsolation está desligado', async () => {
    Object.defineProperty(process, 'contextIsolated', { value: false, configurable: true })
    vi.resetModules()
    await expect(import('./index')).rejects.toThrow(/contextIsolation/)
  })
})
