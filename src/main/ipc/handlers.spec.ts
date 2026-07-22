import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS, IPC_SEND_CHANNELS } from '@shared/contracts/ipc'
import { buildAppInfo, registerIpcHandlers } from './handlers'

const handle = vi.fn()
const on = vi.fn()
const writeLog = vi.fn()

vi.mock('electron', () => ({
  app: {
    getName: () => 'JARVIS OS',
    getVersion: () => '0.1.0',
    isPackaged: false
  },
  ipcMain: {
    handle: (...args: unknown[]) => handle(...args),
    on: (...args: unknown[]) => on(...args)
  }
}))

// O logger real abriria arquivos em disco; aqui interessa *o que* seria gravado.
vi.mock('../logging/logger', () => {
  const categoria = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  return {
    log: new Proxy({}, { get: () => categoria }),
    writeLog: (...args: unknown[]) => writeLog(...args)
  }
})

/** Executa o ouvinte registrado no canal de log, como o Electron faria. */
function emitirLogDoRenderer(payload: unknown): void {
  registerIpcHandlers()
  const ouvinte = on.mock.calls.find(([canal]) => canal === IPC_SEND_CHANNELS.log)?.[1] as (
    evento: unknown,
    payload: unknown
  ) => void
  ouvinte({}, payload)
}

beforeEach(() => {
  handle.mockClear()
  on.mockClear()
  writeLog.mockClear()
})

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
  it('registra um handler para cada canal de request/response, e só para eles', () => {
    registerIpcHandlers()

    const registrados = handle.mock.calls.map(([canal]) => canal).sort()
    expect(registrados).toEqual(Object.values(IPC_CHANNELS).sort())
  })

  it('registra um ouvinte para cada canal só de ida, e só para eles', () => {
    registerIpcHandlers()

    const registrados = on.mock.calls.map(([canal]) => canal).sort()
    expect(registrados).toEqual(Object.values(IPC_SEND_CHANNELS).sort())
  })
})

describe('canal de log do renderer', () => {
  it('grava o registro marcando a origem como renderer', () => {
    emitirLogDoRenderer({ level: 'info', category: 'ui', msg: 'Tela carregada' })

    expect(writeLog).toHaveBeenCalledWith({
      level: 'info',
      category: 'ui',
      msg: 'Tela carregada',
      source: 'renderer'
    })
  })

  it('descarta payload que não casa com o contrato em vez de gravar', () => {
    // O IPC é fronteira de confiança: categoria inventada viraria arquivo com categoria
    // fora do contrato. Descartar é deliberado — não se "conserta" registro malformado.
    emitirLogDoRenderer({ level: 'info', category: 'financeiro', msg: 'x' })

    expect(writeLog).not.toHaveBeenCalled()
  })

  it('não deixa o renderer forjar a origem do registro', () => {
    emitirLogDoRenderer({ level: 'info', category: 'ui', msg: 'x', source: 'main' })

    expect(writeLog).toHaveBeenCalledWith(expect.objectContaining({ source: 'renderer' }))
  })
})
