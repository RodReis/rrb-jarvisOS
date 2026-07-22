import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS, IPC_SEND_CHANNELS } from '@shared/contracts/ipc'
import type { AuditEvent } from '@shared/domain/entities'
import { buildAppInfo, registerIpcHandlers, type IpcDependencies } from './handlers'

const handle = vi.fn()
const on = vi.fn()
const writeLog = vi.fn()
const logIpc = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

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
vi.mock('../logging/logger', () => ({
  log: new Proxy({}, { get: () => logIpc }),
  writeLog: (...args: unknown[]) => writeLog(...args)
}))

function evento(over: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'e-1',
    user_id: 'local',
    type: 'login',
    payload: {},
    created_at: '2026-07-22T10:00:00.000Z',
    seq: 1,
    prev_hash: 'genesis',
    hash: 'h',
    ...over
  }
}

const audit = {
  list: vi.fn(() => [evento(), evento({ id: 'e-2', type: 'logout', seq: 2 })]),
  verify: vi.fn(() => ({ ok: true, checked: 2 })),
  append: vi.fn()
}

const workspaces = {
  atual: vi.fn(() => 'jarvis' as const),
  trocar: vi.fn((destino: string) => ({ workspace: destino, auditSeq: 3 }))
}

const minimizeToTray = vi.fn()

const preferences = {
  atual: vi.fn(() => ({ locale: 'pt-BR', theme: 'sistema', resolvedTheme: 'escuro' })),
  salvar: vi.fn((p: Record<string, unknown>) => ({
    locale: p['locale'] ?? 'pt-BR',
    theme: p['theme'] ?? 'sistema',
    resolvedTheme: 'escuro'
  }))
}

const deps = {
  audit,
  workspaces,
  preferences,
  // Função desde a F03: a identidade muda em runtime (local antes do login, usuário da
  // sessão depois), então os handlers a resolvem a cada chamada em vez de capturá-la.
  userId: () => 'local',
  minimizeToTray
} as unknown as IpcDependencies

/** Recupera o handler registrado num canal de request/response e o invoca. */
function invocar(canal: string, ...args: unknown[]): unknown {
  registerIpcHandlers(deps)
  const fn = handle.mock.calls.find(([c]) => c === canal)?.[1] as (
    evento: unknown,
    ...rest: unknown[]
  ) => unknown
  return fn({}, ...args)
}

/** Recupera o ouvinte de um canal só de ida e o dispara, como o Electron faria. */
function emitir(canal: string, payload?: unknown): void {
  registerIpcHandlers(deps)
  const fn = on.mock.calls.find(([c]) => c === canal)?.[1] as (
    evento: unknown,
    payload: unknown
  ) => void
  fn({}, payload)
}

beforeEach(() => {
  handle.mockClear()
  on.mockClear()
  writeLog.mockClear()
  minimizeToTray.mockClear()
  audit.list.mockClear()
  workspaces.trocar.mockClear()
  logIpc.info.mockClear()
  logIpc.warn.mockClear()
  logIpc.error.mockClear()
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
    registerIpcHandlers(deps)

    const registrados = handle.mock.calls.map(([canal]) => canal).sort()
    expect(registrados).toEqual(Object.values(IPC_CHANNELS).sort())
  })

  it('registra um ouvinte para cada canal só de ida, e só para eles', () => {
    registerIpcHandlers(deps)

    const registrados = on.mock.calls.map(([canal]) => canal).sort()
    expect(registrados).toEqual(Object.values(IPC_SEND_CHANNELS).sort())
  })
})

describe('canal de log do renderer', () => {
  it('grava o registro marcando a origem como renderer', () => {
    emitir(IPC_SEND_CHANNELS.log, { level: 'info', category: 'ui', msg: 'Tela carregada' })

    expect(writeLog).toHaveBeenCalledWith({
      level: 'info',
      category: 'ui',
      msg: 'Tela carregada',
      source: 'renderer'
    })
  })

  it('descarta payload que não casa com o contrato em vez de gravar', () => {
    emitir(IPC_SEND_CHANNELS.log, { level: 'info', category: 'financeiro', msg: 'x' })

    expect(writeLog).not.toHaveBeenCalled()
  })

  it('não deixa o renderer forjar a origem do registro', () => {
    emitir(IPC_SEND_CHANNELS.log, {
      level: 'info',
      category: 'ui',
      msg: 'x',
      source: 'main'
    })

    expect(writeLog).toHaveBeenCalledWith(expect.objectContaining({ source: 'renderer' }))
  })
})

describe('canais de auditoria (SPEC-04, critério 6)', () => {
  it('consulta sempre escopada ao usuário corrente', () => {
    invocar(IPC_CHANNELS.auditList)

    // O renderer não escolhe o usuário: quem define o escopo é o main.
    expect(audit.list).toHaveBeenCalledWith('local')
  })

  it('filtra por tipo sem deixar o valor do renderer virar consulta', () => {
    const eventos = invocar(IPC_CHANNELS.auditList, 'logout') as AuditEvent[]

    expect(eventos).toHaveLength(1)
    expect(eventos[0]?.type).toBe('logout')
    // O filtro é aplicado em memória — a string externa nunca chega ao SQL.
    expect(audit.list).toHaveBeenCalledWith('local')
  })

  it('ignora filtro que não é string em vez de quebrar', () => {
    const eventos = invocar(IPC_CHANNELS.auditList, { malicioso: true }) as AuditEvent[]

    expect(eventos).toHaveLength(2)
  })

  it('devolve o veredito da cadeia', () => {
    expect(invocar(IPC_CHANNELS.auditVerify)).toEqual({ ok: true, checked: 2 })
  })

  it('registra warn quando a cadeia acusa quebra', () => {
    audit.verify.mockReturnValueOnce({
      ok: false,
      checked: 1,
      brokenAt: 2,
      reason: 'hash-invalido',
      detail: 'x'
    } as never)

    invocar(IPC_CHANNELS.auditVerify)

    expect(logIpc.warn).toHaveBeenCalled()
  })

  it('não expõe canal de gravação de auditoria ao renderer', () => {
    // Gravar evento é ato do main, disparado por um fluxo real. Um canal de escrita aqui
    // deixaria a UI fabricar evidência.
    registerIpcHandlers(deps)
    const canais = [...handle.mock.calls, ...on.mock.calls].map(([c]) => String(c))

    expect(canais.some((c) => /audit.*(append|insert|write|create)/i.test(c))).toBe(false)
  })
})

describe('canais de workspace (SPEC-02)', () => {
  it('devolve o espaço ativo', () => {
    expect(invocar(IPC_CHANNELS.workspaceGet)).toBe('jarvis')
  })

  it('troca para um espaço válido e devolve o seq auditado', () => {
    expect(invocar(IPC_CHANNELS.workspaceSwitch, 'noa')).toEqual({
      workspace: 'noa',
      auditSeq: 3
    })
  })

  it.each(['desenvolvimento', 'agentic-os', '', 'NOA', 42, null])(
    'recusa destino fora do enum: %s',
    (destino) => {
      // `Desenvolvimento` não é workspace (CONVENTION §2) — e o renderer é fronteira
      // de confiança, então o enum é validado aqui, não só no tipo.
      expect(() => invocar(IPC_CHANNELS.workspaceSwitch, destino)).toThrow(/inválido/)
      expect(workspaces.trocar).not.toHaveBeenCalled()
    }
  )
})

describe('canais de preferências (SPEC-05)', () => {
  it('devolve as preferências com o tema já resolvido', () => {
    expect(invocar(IPC_CHANNELS.preferencesGet)).toEqual({
      locale: 'pt-BR',
      theme: 'sistema',
      resolvedTheme: 'escuro'
    })
  })

  it('grava a mudança e devolve o estado resultante', () => {
    expect(invocar(IPC_CHANNELS.preferencesSave, { theme: 'claro' })).toMatchObject({
      theme: 'claro'
    })
  })

  it.each([
    ['string', 'claro'],
    ['null', null],
    ['número', 7]
  ])('trata payload não-objeto (%s) sem quebrar', (_caso, payload) => {
    // O serviço já descarta campo fora do enum; o handler só garante que chega objeto.
    expect(() => invocar(IPC_CHANNELS.preferencesSave, payload)).not.toThrow()
    expect(preferences.salvar).toHaveBeenCalledWith({})
  })
})

describe('canal de janela', () => {
  it('minimiza para o tray a pedido do renderer', () => {
    emitir(IPC_SEND_CHANNELS.windowMinimizeToTray)

    expect(minimizeToTray).toHaveBeenCalled()
  })
})
