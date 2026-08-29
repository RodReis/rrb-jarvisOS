import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BRIDGE_KEY,
  IPC_CHANNELS,
  IPC_EVENT_CHANNELS,
  IPC_SEND_CHANNELS
} from '@shared/contracts/ipc'

const exposeInMainWorld = vi.fn()
const invoke = vi.fn().mockResolvedValue({})
const send = vi.fn()
const on = vi.fn()
const removeListener = vi.fn()

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (...args: unknown[]) => exposeInMainWorld(...args)
  },
  ipcRenderer: {
    invoke: (...args: unknown[]) => invoke(...args),
    send: (...args: unknown[]) => send(...args),
    on: (...args: unknown[]) => on(...args),
    removeListener: (...args: unknown[]) => removeListener(...args)
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
    on.mockClear()
    removeListener.mockClear()
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
      'addAllowedCommand',
      'addAllowedDirectory',
      'classifyAction',
      'createAutomation',
      'createWorkflow',
      'getAppInfo',
      'getAuth',
      'getPreferences',
      'getWorkspace',
      'listAllowedCommands',
      'listAllowedDirectories',
      'listAuditEvents',
      'listAutomations',
      'listCredentials',
      'listExecutionRuns',
      'listPendingApprovals',
      'listWorkflows',
      'login',
      'logout',
      'minimizeToTray',
      'onAuthChanged',
      'removeAllowedCommand',
      'removeAllowedDirectory',
      'removeAutomation',
      'removeCredential',
      'removeWorkflow',
      'resolveApproval',
      'runCommand',
      'runWorkflowReal',
      'runWorkflowSimulated',
      'savePreferences',
      'sendLog',
      'setAutomationEnabled',
      'setCredential',
      'setWorkflowStatus',
      'switchWorkspace',
      'updateWorkflow',
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

  it('roteia os canais de auth pelos nomes do contrato', async () => {
    const bridge = await carregarPonte()

    await (bridge.getAuth as () => Promise<unknown>)()
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.authGet)

    await (bridge.login as () => Promise<unknown>)()
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.authLogin)

    await (bridge.logout as () => Promise<unknown>)()
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.authLogout)
  })

  it('não expõe nada que entregue token ao renderer (critério 4)', async () => {
    const bridge = await carregarPonte()

    // A superfície é fechada por nome: um `getToken`/`getSession`/`refreshToken` aqui
    // seria o caminho tipado até a credencial que a SPEC-03 proíbe existir.
    //
    // O vault (SPEC-Providers-01) trouxe três métodos com `credential` no nome, e a guarda
    // ficou **mais** estrita em vez de mais frouxa: em vez de aceitar qualquer nome com a
    // palavra, ela agora enumera exatamente os três que existem — e todos gerenciam
    // *metadados* (status, origem, provider), nenhum devolve valor. Um `getCredential`
    // amanhã não entra nesta lista, e por isso quebra o teste.
    const GESTAO_DE_CREDENCIAL_SEM_VALOR = ['listCredentials', 'setCredential', 'removeCredential']

    const suspeitos = Object.keys(bridge)
      .filter((k) => /token|secret|credential|session/i.test(k))
      .filter((k) => !GESTAO_DE_CREDENCIAL_SEM_VALOR.includes(k))

    expect(suspeitos).toEqual([])
  })

  it('nenhum método do vault tem forma de devolver o valor de uma credencial', async () => {
    const bridge = await carregarPonte()

    // O critério 2 diz "o renderer nunca recebe o valor". A prova aqui é a **ausência de
    // canal**: os três métodos do vault roteiam para canais que devolvem status, e não existe
    // nenhum canal no contrato cujo nome sugira leitura de segredo. Se alguém adicionar
    // `credential:read`, este teste é o que fica vermelho.
    const canaisDeCredencial = Object.entries(IPC_CHANNELS)
      .filter(([nome]) => /credential/i.test(nome))
      .map(([, canal]) => canal)

    expect(canaisDeCredencial).toEqual([
      IPC_CHANNELS.credentialList,
      IPC_CHANNELS.credentialSet,
      IPC_CHANNELS.credentialRemove
    ])

    await (bridge.listCredentials as (w: string) => Promise<unknown>)('jarvis')
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.credentialList, 'jarvis')

    // `setCredential` leva o valor de ida — e a assimetria é o desenho: entra e não volta.
    await (bridge.setCredential as (k: string, v: string, w: string) => Promise<unknown>)(
      'openai',
      'sk-secreto',
      'jarvis'
    )
    expect(invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.credentialSet,
      'openai',
      'sk-secreto',
      'jarvis'
    )
  })

  it('onAuthChanged devolve um cancelador e não vaza o evento do Electron', async () => {
    const bridge = await carregarPonte()
    const recebidos: unknown[][] = []

    const cancelar = (bridge.onAuthChanged as (l: (s: unknown) => void) => () => void)((...args) =>
      recebidos.push(args)
    )

    // O preload registrou no canal de push e devolveu como desassinar — sem isso, o
    // listener sobreviveria ao componente e vazaria a cada remontagem.
    expect(on).toHaveBeenCalledWith(IPC_EVENT_CHANNELS.authChanged, expect.any(Function))
    expect(typeof cancelar).toBe('function')

    // Simula o main empurrando: o listener recebe só o snapshot, nunca o
    // `IpcRendererEvent` — que carrega `sender` e daria ao renderer um objeto do Electron.
    const registrado = on.mock.calls.at(-1)?.[1] as (e: unknown, s: unknown) => void
    registrado({ sender: 'objeto-do-electron' }, { state: 'ativo' })

    expect(recebidos).toEqual([[{ state: 'ativo' }]])

    cancelar()
    expect(removeListener).toHaveBeenCalledWith(
      IPC_EVENT_CHANNELS.authChanged,
      expect.any(Function)
    )
  })

  it('recusa expor a ponte quando contextIsolation está desligado', async () => {
    Object.defineProperty(process, 'contextIsolated', { value: false, configurable: true })
    vi.resetModules()
    await expect(import('./index')).rejects.toThrow(/contextIsolation/)
  })
})
