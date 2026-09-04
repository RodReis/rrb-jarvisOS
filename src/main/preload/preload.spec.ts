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
      'anexarDesign',
      'answerWizard',
      'aplicarEventoDaJornada',
      'aprovarGate',
      'awaitGithubAuth',
      'buildContextPack',
      'callAi',
      'callConnector',
      'cancelAi',
      'cancelGithubAuth',
      'carregarArquitetura',
      'carregarBrief',
      'carregarPrd',
      'carregarRoadmap',
      'carregarRoadmapGerado',
      'classifyAction',
      'clearPhaseModelOverride',
      'completeMilestone',
      'cortarPropostoDaArquitetura',
      'cortarPropostoDoBrief',
      'cortarPropostoDoPrd',
      'createAutomation',
      'createProject',
      'createWorkflow',
      'definirPoliticaDeMerge',
      'descartarAjusteDaArquitetura',
      'escolherAnexo',
      'escolherMvpDoRoadmap',
      'estadoDaJornada',
      'estadoDoRefinamento',
      'estadoDoSandbox',
      'generationEvents',
      'generationHistory',
      'gerarArquiteturaPorIa',
      'gerarBrief',
      'gerarPacote',
      'gerarPerguntasDeRefinamento',
      'gerarPrd',
      'gerarRoadmapPorIa',
      'getAppDirectory',
      'getAppInfo',
      'getAuth',
      'getBudget',
      'getConnectorCredits',
      'getGithubAuthStatus',
      'getPhaseModelOverrides',
      'getPhaseModels',
      'getPlanningSession',
      'getPreferences',
      'getProviderModels',
      'getProviderStatus',
      'getRouting',
      'getWizardState',
      'getWorkspace',
      'historicoDoRefinamento',
      'importProject',
      'jornadaDeVarios',
      'ledgerDoRun',
      'lerPoliticaDeMerge',
      'lerPromptDoProjeto',
      'listAllowedCommands',
      'listAllowedDirectories',
      'listAuditEvents',
      'listAutomations',
      'listCapabilities',
      'listConnectorCapabilities',
      'listConnectorCredentials',
      'listContextPacks',
      'listCredentials',
      'listExecutionRuns',
      'listFailures',
      'listPendingApprovals',
      'listProjects',
      'listWorkflows',
      'listarAnexos',
      'listarAprovacoes',
      'listarArquiteturas',
      'listarPacotes',
      'login',
      'logout',
      'logoutGithub',
      'marcosDoProjeto',
      'minimizeToTray',
      'mvpsElegiveis',
      'onAiStreamEvent',
      'onAuthChanged',
      'onGenerationEvent',
      'pendenciasDeLimpeza',
      'pickAllowedDirectory',
      'pickProjectDirectory',
      'proporTermoDePesquisa',
      'publicarNoGitHub',
      'removeAllowedCommand',
      'removeAllowedDirectory',
      'removeAutomation',
      'removeConnectorCredential',
      'removeCredential',
      'removeProject',
      'removeWorkflow',
      'removerAnexo',
      'renameProject',
      'resolveApproval',
      'resolveFailure',
      'responderPerguntaDaSpec',
      'responderRefinamento',
      'resumoDeVarios',
      'revisoesDoGate',
      'rotaDaGeracao',
      'runCommand',
      'runWorkflowReal',
      'runWorkflowSimulated',
      'salvarPromptDoProjeto',
      'savePlanningAnswers',
      'savePreferences',
      'sendLog',
      'setAutomationEnabled',
      'setBudgetLimits',
      'setConnectorCredential',
      'setConnectorCreditLimits',
      'setCredential',
      'setGithubClientId',
      'setPhaseModel',
      'setPhaseModelOverride',
      'setProviderModel',
      'setRoute',
      'setWorkflowStatus',
      'simularMudanca',
      'startGithubAuth',
      'switchWorkspace',
      'updateWorkflow',
      'validarPrototipos',
      'verifyAuditChain',
      'vistaDaFila'
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
    //
    // A M6-F05 trouxe o trio irmão para credencial de **conector**, e a guarda continua
    // enumerando: seis nomes, todos de metadados. `ConnectorCredentialStatusView` não tem campo
    // onde o segredo caiba, do mesmo modo que `CredentialStatusView` não tem.
    const GESTAO_DE_CREDENCIAL_SEM_VALOR = [
      'listCredentials',
      'setCredential',
      'removeCredential',
      'listConnectorCredentials',
      'setConnectorCredential',
      'removeConnectorCredential'
    ]

    // A M8-F01 trouxe `session` num sentido **diferente** do que a guarda persegue: a
    // `PlanningSession` é o rascunho do wizard (etapa + respostas do usuário), não uma sessão
    // de autenticação — o tipo não tem campo onde token caiba, do mesmo modo que
    // `CredentialStatusView` não tem. Enumerado, e não isento por regex mais frouxo: afrouxar
    // o padrão deixaria passar o `getAuthSession` de amanhã, que é exatamente o que a guarda
    // existe para pegar.
    const SESSAO_DE_PLANEJAMENTO_SEM_TOKEN = ['getPlanningSession', 'savePlanningAnswers']

    const suspeitos = Object.keys(bridge)
      .filter((k) => /token|secret|credential|session/i.test(k))
      .filter((k) => !GESTAO_DE_CREDENCIAL_SEM_VALOR.includes(k))
      .filter((k) => !SESSAO_DE_PLANEJAMENTO_SEM_TOKEN.includes(k))

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
      IPC_CHANNELS.credentialRemove,
      // O trio de conector (M6-F05) roteia para status pela mesma razão e com a mesma ausência:
      // não há `connectors:credential-read`.
      IPC_CHANNELS.connectorCredentialList,
      IPC_CHANNELS.connectorCredentialSet,
      IPC_CHANNELS.connectorCredentialRemove
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

  it('não existe canal de proxy HTTP genérico (SPEC-Conectores-01, critério 6)', async () => {
    const bridge = await carregarPonte()

    // A prova é por **ausência**, como a do vault: nenhum canal do contrato aceita endereço,
    // e nenhum método da ponte tem nome que sugira alcançar um. Se alguém adicionar um
    // `connectors:fetch` ou um `httpRequest` amanhã, é aqui que fica vermelho — e a diferença
    // entre o núcleo de conectores e um proxy é exatamente esta linha.
    const canaisDeConector = Object.entries(IPC_CHANNELS)
      .filter(([nome]) => /connector/i.test(nome))
      .map(([, canal]) => canal)

    expect(canaisDeConector).toEqual([
      IPC_CHANNELS.connectorsCapabilities,
      IPC_CHANNELS.connectorsInvoke,
      // SPEC-Conectores-02: os dois do teto de créditos. Enumerados como os outros — um canal
      // futuro que aceitasse endereço não entra nesta lista, e por isso quebra o teste.
      IPC_CHANNELS.connectorCreditsGet,
      IPC_CHANNELS.connectorCreditsSetLimits,
      // SPEC-Conectores-05: os três da credencial de conector. Nenhum aceita endereço — levam
      // chave lógica de um enum fechado e espaço —, e enumerá-los aqui é o que mantém a guarda
      // capaz de acusar o canal que aceitasse.
      IPC_CHANNELS.connectorCredentialList,
      IPC_CHANNELS.connectorCredentialSet,
      IPC_CHANNELS.connectorCredentialRemove
    ])

    expect(
      Object.keys(bridge).filter((k) => /fetch|http|request|proxy|url|endpoint/i.test(k))
    ).toEqual([])

    // E o que o método existente leva é o pedido tipado, pelo canal nomeado.
    const pedido = { connector: 'github', operation: 'issues.create' }
    await (bridge.callConnector as (r: unknown, w: string) => Promise<unknown>)(pedido, 'jarvis')
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.connectorsInvoke, pedido, 'jarvis')
  })

  it('recusa expor a ponte quando contextIsolation está desligado', async () => {
    Object.defineProperty(process, 'contextIsolated', { value: false, configurable: true })
    vi.resetModules()
    await expect(import('./index')).rejects.toThrow(/contextIsolation/)
  })
})
