import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BRIDGE_KEY, IPC_CHANNELS, IPC_SEND_CHANNELS } from '@shared/contracts/ipc'

const exposeInMainWorld = vi.fn()
const invoke = vi.fn().mockResolvedValue({})
const send = vi.fn()

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (...args: unknown[]) => exposeInMainWorld(...args)
  },
  ipcRenderer: {
    invoke: (...args: unknown[]) => invoke(...args),
    send: (...args: unknown[]) => send(...args)
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
    expect(Object.keys(bridge).sort()).toEqual([
      'getAppInfo',
      'getWorkspace',
      'listAuditEvents',
      'minimizeToTray',
      'sendLog',
      'switchWorkspace',
      'verifyAuditChain'
    ])
  })

  it('não expõe nada que grave auditoria — a UI não fabrica evidência', async () => {
    const bridge = await carregarPonte()

    expect(Object.keys(bridge).some((k) => /append|insert|write.*audit/i.test(k))).toBe(false)
  })

  it('roteia os canais de auditoria e workspace pelos nomes do contrato', async () => {
    const bridge = await carregarPonte()

    await (bridge.verifyAuditChain as () => Promise<unknown>)()
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.auditVerify)

    await (bridge.switchWorkspace as (w: string) => Promise<unknown>)('noa')
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.workspaceSwitch, 'noa')
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

  it('roteia sendLog pelo canal de ida, sem esperar resposta', async () => {
    // `send`, não `invoke`: o renderer não pode ficar esperando o disco para logar.
    const bridge = await carregarPonte()
    const registro = { level: 'info', category: 'ui', msg: 'Tela carregada' }

    const retorno = (bridge.sendLog as (r: unknown) => unknown)(registro)

    expect(send).toHaveBeenCalledWith(IPC_SEND_CHANNELS.log, registro)
    expect(invoke).not.toHaveBeenCalled()
    expect(retorno).toBeUndefined()
  })

  it('recusa expor a ponte quando contextIsolation está desligado', async () => {
    Object.defineProperty(process, 'contextIsolated', { value: false, configurable: true })
    vi.resetModules()
    await expect(import('./index')).rejects.toThrow(/contextIsolation/)
  })
})
