/**
 * E2E do fluxo de login no app Electron real (SPEC-Fundacao-03, critério 9).
 *
 * O que só este teste prova, e nenhum unitário provaria: que `contextIsolation` ligado,
 * preload, canais IPC, janela e renderer funcionam **juntos**. Os testes de componente
 * rodam contra uma ponte dublada; aqui a ponte é a de verdade.
 *
 * O provedor externo fica fora: a tela de consentimento do Google é HTML de terceiro, e
 * automatizá-la produz teste que quebra quando eles mudam o layout — sem dizer nada sobre
 * o nosso app. O recorte é o fluxo **até** o navegador abrir, mais a prova de que a
 * fronteira de segurança se sustenta com o app rodando.
 */

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// O pacote `electron` exporta o caminho do binário; o .d.ts descreve a API do runtime,
// daí o duplo cast — em Node, o valor É uma string.
import electronPath from 'electron'

let app: ElectronApplication
let userData: string

test.beforeEach(async () => {
  // `userData` isolado por execução: o app guarda SQLite, logs e cofre ali, e reaproveitar
  // o diretório do desenvolvedor faria o teste ler a sessão real de quem o roda.
  userData = mkdtempSync(join(tmpdir(), 'jarvis-e2e-'))

  // `ELECTRON_RUN_AS_NODE` herdado do shell faz o Electron subir como Node puro — o
  // import de `electron` some e o erro aparece como "does not provide an export named
  // BrowserWindow", que parece falha de bundle e não é. Limpar aqui torna o E2E
  // independente do ambiente de quem o roda.
  const ambiente = { ...process.env }
  delete ambiente.ELECTRON_RUN_AS_NODE

  /**
   * `executablePath` explícito NÃO é cosmético — é o que desativa o loader que o
   * Playwright injeta (`-r loader.js`) quando resolve o Electron sozinho. Esse loader
   * aplica os switches de teste do Chromium ao main process, entre eles
   * `--password-store=basic`: no Linux isso força o os_crypt pro backend `basic_text`,
   * `safeStorage.isEncryptionAvailable()` responde false, e o boot falha alto por
   * desenho (ADR-004) — a janela nunca nasce e o E2E morre em "timeout esperando
   * window", com o keyring do CI perfeitamente funcional ao lado.
   *
   * `chromiumSandbox: true` impede o `--no-sandbox` que o launcher acrescenta por
   * padrão no Linux — o sandbox do renderer é critério de aceite da SPEC-Fundacao-03,
   * e um E2E que o desliga passaria exatamente onde deveria provar a fronteira.
   */
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    chromiumSandbox: true,
    args: ['.', `--user-data-dir=${userData}`],
    env: {
      ...ambiente,
      NODE_ENV: 'development',
      // Sem credenciais o app sobe no estado "login indisponível", que é justamente um dos
      // caminhos que a spec exige tratar — e mantém o E2E offline e determinístico.
      SUPABASE_URL: '',
      SUPABASE_PUBLISHABLE_KEY: ''
    }
  })

  // O reporter engole o stderr do processo principal, e todo erro de boot no CI
  // (sandbox, keyring, display) aparece como um mudo "timeout esperando window".
  // Ecoar aqui é o que transforma esses timeouts em erro legível no log.
  app.process().stderr?.on('data', (chunk: Buffer) => {
    console.error(`[electron stderr] ${chunk.toString().trimEnd()}`)
  })
  // O logger do app (winston, console ligado fora de produção) escreve no stdout —
  // é onde a promise rejeitada do boot aparece.
  app.process().stdout?.on('data', (chunk: Buffer) => {
    console.error(`[electron stdout] ${chunk.toString().trimEnd()}`)
  })
})

test.afterEach(async () => {
  /**
   * Encerra com `app.exit()`, não com `close()` nem `quit()`. Os dois travam aqui, por
   * duas razões que se somam:
   *
   * 1. O app **vive no tray**: `window-all-closed` é deliberadamente vazio (SPEC-02),
   *    então fechar a janela não encerra o processo — `close()` espera um `exit` que
   *    nunca vem e deixa a janela aberta na tela de quem roda a suíte.
   * 2. `quit()` dispara `will-quit`, que fecha o logger; os timers de rotação do
   *    `winston-daily-rotate-file` seguram o event loop e o processo continua vivo.
   *
   * `exit()` encerra sem esperar handles pendentes (~200ms, medido). É adequado porque o
   * `userData` é descartável: não há estado a preservar, e o desligamento gracioso é
   * coberto pelos testes de unidade — não é o que este E2E investiga.
   */
  await app?.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
  await app?.close().catch(() => undefined)

  rmSync(userData, { recursive: true, force: true })
})

test('o app sobe na tela de entrada e não expõe o shell sem sessão', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  // A porta de entrada aparece…
  await expect(janela.getByRole('heading', { name: 'JARVIS OS' })).toBeVisible()
  // …e o shell não: quem não entrou não alcança espaços nem navegação. Esta é a asserção
  // que só o E2E consegue fazer com preload e IPC reais no circuito.
  await expect(janela.getByRole('radiogroup')).toHaveCount(0)
  await expect(janela.getByRole('navigation')).toHaveCount(0)
})

test('a ponte expõe só o contrato — sem ipcRenderer, sem token (critério 4)', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const superficie = await janela.evaluate(() => {
    const ponte = (globalThis as unknown as { jarvis: Record<string, unknown> }).jarvis
    return {
      metodos: Object.keys(ponte).sort(),
      // O renderer não pode alcançar Node nem o ipcRenderer cru com a fronteira ligada.
      temRequire: typeof (globalThis as unknown as { require?: unknown }).require,
      temProcess: typeof (globalThis as unknown as { process?: unknown }).process
    }
  })

  expect(superficie.metodos).toEqual([
    'addAllowedCommand',
    'addAllowedDirectory',
    // SPEC-Providers-02: os três da chamada de IA. Enumerados um a um (e não por padrão) pela
    // mesma razão da F01 — um padrão aceitaria um método futuro que devolvesse credencial.
    'callAi',
    // SPEC-Conectores-01: executa **uma** operação declarada por um adapter registrado. O que
    // o distingue de um proxy é o argumento — um `ConnectorRequest` que nomeia conector e
    // operação de listas fechadas, nunca uma URL.
    'callConnector',
    'cancelAi',
    'classifyAction',
    'createAutomation',
    'createWorkflow',
    // SPEC-ExecucaoReal-03: só-leitura, devolve o path do diretório gerido pelo app. É string,
    // não handle — a tela o compara com a lista para marcar o item fixo, e nada mais.
    'getAppDirectory',
    'getAppInfo',
    'getAuth',
    // SPEC-Providers-03: leitura do orçamento (limites + acumulado). Não há canal que pergunte
    // "esta chamada cabe?" — a decisão é do main, dentro do ponto único.
    'getBudget',
    // SPEC-Conectores-02: teto de créditos por conector. Leitura e edição do **teto** —
    // nenhum método pergunta se uma chamada cabe: essa decisão é do gate, no main.
    'getConnectorCredits',
    'getPreferences',
    // SPEC-Providers-04: providers e roteamento. Enumerados um a um, como todos os anteriores.
    // **Nenhum** deles seleciona provider: quem escolhe quem atende é o ponto único, no main.
    'getProviderModels',
    'getProviderStatus',
    'getRouting',
    'getWorkspace',
    'listAllowedCommands',
    'listAllowedDirectories',
    'listAuditEvents',
    'listAutomations',
    'listConnectorCapabilities',
    'listCredentials',
    'listExecutionRuns',
    'listPendingApprovals',
    'listWorkflows',
    'login',
    'logout',
    'minimizeToTray',
    'onAiStreamEvent',
    'onAuthChanged',
    // SPEC-ExecucaoReal-03: abre o seletor **no main**. Devolve a lista de paths, nunca um
    // handle de arquivo — é o que mantém o critério 6 (o renderer não toca o filesystem) de pé
    // mesmo com a tela oferecendo escolha de pasta.
    'pickAllowedDirectory',
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
    // SPEC-Providers-03: edição dos limites. O renderer edita; o cálculo e a decisão são do main.
    'setBudgetLimits',
    'setConnectorCreditLimits',
    'setCredential',
    // SPEC-Providers-04: troca de modelo ativo e edição de rota.
    'setProviderModel',
    'setRoute',
    'setWorkflowStatus',
    'switchWorkspace',
    'updateWorkflow',
    'verifyAuditChain'
  ])

  // Nenhum método entrega credencial — a superfície fechada é o critério 4 em runtime.
  //
  // O vault (SPEC-Providers-01) trouxe três métodos com `credential` no nome, e a guarda ficou
  // **mais** estrita: em vez de aceitar qualquer nome com a palavra, enumera exatamente os três
  // que existem — todos de *metadados* (status, origem, provider), nenhum devolve valor. Um
  // `getCredential` amanhã não entra nesta lista e quebra o teste, com o app rodando de verdade.
  const GESTAO_SEM_VALOR = ['listCredentials', 'setCredential', 'removeCredential']
  expect(
    superficie.metodos
      .filter((m) => /token|secret|session|credential/i.test(m))
      .filter((m) => !GESTAO_SEM_VALOR.includes(m))
  ).toEqual([])
  expect(superficie.temRequire).toBe('undefined')
  expect(superficie.temProcess).toBe('undefined')
})

test('sem credenciais configuradas, avisa com mensagem clara (critério 6)', async () => {
  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  // O app já **nasce** neste estado: sem `.env`, o `auth:get` do boot responde o erro de
  // credenciais ausentes, então o aviso aparece sem o usuário tentar nada — e o botão
  // convida a repetir, não a iniciar.
  const alerta = janela.getByRole('alert')
  await expect(alerta).toBeVisible()
  await expect(alerta).toContainText(/\.env/)
  await expect(janela.getByRole('button', { name: /tentar novamente/i })).toBeVisible()

  // Mensagem de produto, em pt-BR: sem stack trace, sem nome de arquivo, sem "Error:".
  const texto = (await alerta.textContent()) ?? ''
  expect(texto).not.toMatch(/\bat\s|\.ts:\d+|Error:/)

  // Repetir sem credenciais mantém o aviso — e não derruba o app.
  await janela.getByRole('button', { name: /tentar novamente/i }).click()
  await expect(alerta).toBeVisible()
})
