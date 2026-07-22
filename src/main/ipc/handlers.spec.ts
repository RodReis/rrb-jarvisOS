import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { buildAppInfo, registerIpcHandlers } from './handlers'

const handle = vi.fn()

vi.mock('electron', () => ({
  app: {
    getName: () => 'JARVIS OS',
    getVersion: () => '0.1.0',
    isPackaged: false
  },
  ipcMain: {
    handle: (...args: unknown[]) => handle(...args)
  }
}))

describe('buildAppInfo', () => {
  it('devolve apenas os campos públicos do contrato', () => {
    const info = buildAppInfo()
    expect(Object.keys(info).sort()).toEqual(['electronVersion', 'environment', 'name', 'version'])
  })

  it('marca ambiente de desenvolvimento quando o app não está empacotado', () => {
    expect(buildAppInfo().environment).toBe('development')
  })
})

describe('registerIpcHandlers', () => {
  it('registra um handler para cada canal do contrato, e só para eles', () => {
    handle.mockClear()
    registerIpcHandlers()

    const registrados = handle.mock.calls.map(([canal]) => canal).sort()
    expect(registrados).toEqual(Object.values(IPC_CHANNELS).sort())
  })
})
