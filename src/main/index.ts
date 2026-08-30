import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { IPC_EVENT_CHANNELS } from '@shared/contracts/ipc'
import { AuthService } from './auth/auth-service'
import { createSupabaseClient, readSupabaseConfig } from './auth/supabase-client'
import { SafeStorageTokenVault } from './auth/token-vault'
import { registerIpcHandlers } from './ipc/handlers'
import { AiCallService } from './ai/call-provider'
import { AnthropicAdapter } from './ai/anthropic-adapter'
import { GeminiAdapter } from './ai/gemini-adapter'
import { OllamaAdapter } from './ai/ollama-adapter'
import { ClaudeCodeAdapter } from './ai/claude-code-adapter'
import { RoutingService, SondaDeAdapters } from './ai/routing-service'
import { RoutingRepository } from './ai/routing-repository'
import { BudgetService } from './budget/budget-service'
import { BudgetRepository } from './budget/budget-repository'
import { AllowlistRepository } from './policy/allowlist-repository'
import { canonicalize } from './policy/allowlist-canon'
import { PolicyService } from './policy/policy-service'
import { PreferencesService } from './preferences/preferences-service'
import { WorkflowService } from './workflows/workflow-service'
import { WorkflowRepository } from './workflows/workflow-repository'
import { AutomationRepository } from './workflows/automation-repository'
import { SimulationEngine } from './execution/simulation-engine'
import { ExecutionRepository } from './execution/execution-repository'
import { ApprovalRepository } from './execution/approval-repository'
import { RealFileSystemEngine } from './execution/real-filesystem-engine'
import { TerminalEngine } from './execution/terminal-engine'
import { CommandAllowlistRepository } from './policy/command-allowlist-repository'
import { ProjectRepository } from './projects/project-repository'
import { ProjectService } from './projects/project-service'
import { DecisionRepository } from './projects/decision-repository'
import { WizardService } from './projects/wizard-service'
import { PacoteRepository } from './projects/pacote-repository'
import { PacoteService } from './projects/pacote-service'
import { AnexoRepository } from './projects/anexo-repository'
import { AnexoService } from './projects/anexo-service'
import { RoadmapRepository } from './projects/roadmap-repository'
import { PublicacaoService } from './projects/publicacao-service'
import { RoadmapService } from './projects/roadmap-service'
import { GitRunner } from './projects/git-runner'
import { ContextRepository } from './context/context-repository'
import { ContextService } from './context/context-service'
import { CredentialService } from './credentials/credential-service'
import { ConnectorRegistry } from './connectors/registry'
import { ConnectorService } from './connectors/connector-service'
import { CreditService } from './connectors/credit-service'
import { GithubAdapter } from './connectors/github/github-adapter'
import { TavilyAdapter } from './connectors/tavily/tavily-adapter'
import { GithubAuthService } from './connectors/github/github-auth-service'
import { CreditRepository } from './connectors/credit-repository'
import { CredentialRepository } from './credentials/credential-repository'
import { SafeStorageCipher } from './credentials/secret-vault'
import { carregarEnv } from './env'
import { closeLogger, initLogger, log } from './logging/logger'
import { initRendererLogBridge } from './logging/renderer-bridge'
import { LOCAL_USER_ID, LOCAL_USER_PROFILE } from './storage/local-user'
import { closeStorage, initStorage } from './storage'
import { createTray, destroyTray, revelarJanela } from './tray'
import { WorkspaceService } from './workspace/workspace-service'
import { createMainWindow } from './window'

/**
 * Instância única (SPEC-02, critério 6). Precisa vir **antes** de qualquer inicialização:
 * a segunda instância deve morrer sem tocar no banco nem nos logs, senão duas instâncias
 * disputariam o mesmo arquivo SQLite.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let janela: BrowserWindow | undefined

  // Alguém tentou abrir o app de novo: em vez de uma segunda janela, foca a existente.
  app.on('second-instance', () => {
    if (janela) {
      log.sistema.info('Segunda instância bloqueada; janela existente trazida ao foco')
      revelarJanela(janela)
    }
  })

  app.whenReady().then(() => {
    // Agrupa a janela sob a identidade correta na barra de tarefas do Windows.
    app.setAppUserModelId('com.rodrigoreis.jarvisos')

    // Logging antes de tudo: uma falha no storage ou na criação da janela precisa
    // aparecer no arquivo. `userData/logs` fica fora do repo (ADR-005).
    initLogger(join(app.getPath('userData'), 'logs'), { console: !app.isPackaged })
    initRendererLogBridge()
    log.sistema.info('Aplicação iniciada', {
      versao: app.getVersion(),
      electron: process.versions.electron,
      plataforma: process.platform
    })

    /*
     * Carga do `.env` (FIX #43), depois do logger e **antes** de `criarAuthService`, que é o
     * primeiro a ler `process.env`. Depois do logger de propósito: `writeLog` engole a linha
     * enquanto o logger não existe, e "o arquivo foi lido?" foi exatamente a pergunta que este
     * bug deixou sem resposta por uma fatia inteira — o sinal precisa chegar ao disco.
     *
     * Só fora do empacotado: um app instalado lê configuração do sistema, não um arquivo de
     * desenvolvimento ao lado do binário. Vão para o log os **nomes** das chaves, nunca os
     * valores, que são credenciais.
     */
    if (!app.isPackaged) {
      const aplicadas = carregarEnv(join(app.getAppPath(), '.env'))
      log.sistema.info('Carga do .env concluída', { chaves: aplicadas })
    }

    // Storage depois do logger, antes dos handlers — que já podem consultá-lo.
    const storage = initStorage(app.getPath('userData'))
    // Usuário local da fundação: continua sendo a identidade de quem ainda não entrou.
    // Com a F03, ele deixa de ser o único — o usuário da sessão o substitui após o login.
    storage.profiles.save(LOCAL_USER_PROFILE)

    const auth = criarAuthService(app.getPath('userData'), storage, () => janela)

    /**
     * Identidade corrente: o usuário da sessão quando há login, o local caso contrário.
     *
     * É função porque o valor muda em runtime — capturar a string no boot congelaria o
     * escopo da auditoria no usuário local para sempre.
     */
    const userIdAtual = (): string => auth?.usuarioAtual()?.id ?? LOCAL_USER_ID

    const workspaces = new WorkspaceService(storage.audit, userIdAtual)
    // `nativeTheme` é a única fonte confiável do tema do SO; entra por injeção para o
    // serviço seguir testável sem Electron.
    const preferences = new PreferencesService(storage.profiles, LOCAL_USER_ID, () =>
      nativeTheme.shouldUseDarkColors ? 'escuro' : 'claro'
    )
    // Policy Engine (SPEC-Execucao-02): classifica e audita a decisão. Modo report — não
    // bloqueia nesta fatia. Compartilha o mesmo `userIdAtual` para a auditoria ser escopada.
    const policy = new PolicyService(storage.audit, userIdAtual)
    // Allowlist de diretórios (SPEC-Execucao-03). O default de fábrica é o `userData`, já
    // canonizado — o repositório compara paths canônicos, então a base tem de ser uma.
    const allowlist = new AllowlistRepository(
      storage.db,
      storage.audit,
      canonicalize(app.getPath('userData'))
    )
    // Registro de workflows/automações (SPEC-Execucao-04). Catálogo — nada executa. Compartilha
    // policy/audit/userId para a edição ser classificada e auditada no escopo do usuário.
    const workflowRepo = new WorkflowRepository(storage.db)
    const workflowsService = new WorkflowService(
      workflowRepo,
      new AutomationRepository(storage.db),
      policy,
      storage.audit,
      userIdAtual
    )
    // Motor de execução simulada (SPEC-Execucao-05): junta F02 (classifica), F03 (allowlist)
    // e F04 (definições). **Zero efeito colateral** — nada toca FS, rede ou terminal.
    const runs = new ExecutionRepository(storage.db)
    const approvals = new ApprovalRepository(storage.db)
    const execution = new SimulationEngine(
      workflowRepo,
      policy,
      allowlist,
      runs,
      storage.audit,
      userIdAtual
    )
    const realExecution = new RealFileSystemEngine(
      workflowRepo,
      policy,
      allowlist,
      runs,
      approvals,
      storage.audit,
      userIdAtual
    )

    // Terminal controlado (SPEC-ExecucaoReal-02): o segundo caminho de execução real. Reusa
    // `approvals`/`runs` da F01 de propósito — uma fila só de aprovações pendentes, um lugar
    // só para o usuário ver o que espera por ele. A allowlist de comandos é conceito novo e
    // nasce **vazia**: nada roda até o usuário permitir explicitamente.
    const commandAllowlist = new CommandAllowlistRepository(storage.db, storage.audit, policy)
    const terminal = new TerminalEngine(
      policy,
      commandAllowlist,
      allowlist,
      runs,
      approvals,
      storage.audit,
      userIdAtual
    )

    // Projeto local e planejamento (SPEC-Planejamento-01). O `GitRunner` recebe o **terminal**,
    // não um cliente de Git: é o que torna estruturalmente impossível existir um segundo
    // caminho de escrita de repositório fora do enforcement do MVP-004 (decisão 2 do PI). Não
    // há nada a injetar que permita contornar isso — só o terminal cabe no construtor.
    const projectRepository = new ProjectRepository(storage.db)
    // Uma instância só, compartilhada com a publicação (M9-F01): duas seriam dois objetos sobre o
    // mesmo terminal — inofensivo hoje, mas sugeriria que existe mais de um caminho de Git.
    const gitRunner = new GitRunner(terminal)
    const projects = new ProjectService({
      repository: projectRepository,
      allowlist,
      git: gitRunner,
      audit: storage.audit,
      userId: userIdAtual
    })

    // Contexto, skills e orçamento antes da IA (SPEC-Planejamento-02). Construído **antes** do
    // ponto único porque é dependência dele, pela mesma razão do gate de orçamento: um
    // `AiCallService` sem verificador de contexto seria a geração sem manifesto que o critério
    // 1 proíbe.
    //
    // `skills` é uma **função que devolve lista vazia** nesta fatia, e isso não é lacuna: é o
    // critério 5 sendo exercido no caminho real. Nenhuma skill está instalada, e todas as
    // capacidades continuam atendidas pelo procedimento direto — se o gate dependesse da skill,
    // o app estaria rodando agora sem ele. Quando houver registro de skills, é aqui que ele
    // entra, sem tocar no serviço.
    const contexts = new ContextService({
      repository: new ContextRepository(storage.db),
      projects: projectRepository,
      audit: storage.audit,
      userId: userIdAtual,
      skills: () => []
    })

    // O wizard orientado (SPEC-Planejamento-03). Recebe o `ProjectService` para o autosave do
    // rascunho: a trilha de decisões é dele, mas o `PlanningSession` continua sendo do projeto,
    // e duplicar a escrita da sessão aqui criaria dois donos do mesmo registro.
    //
    // O catálogo não é injetado no boot: em produção é sempre o do contexto, e deixá-lo
    // configurável daria ao chamador o poder de trocar as perguntas que o PI responde.
    const wizard = new WizardService({
      decisions: new DecisionRepository(storage.db),
      projects: projectRepository,
      projectService: projects,
      audit: storage.audit,
      userId: userIdAtual
    })

    // Vault de credenciais (SPEC-Providers-01): a base do MVP-005. A cifra é a mesma do cofre
    // de tokens (`safeStorage`/DPAPI) e é construída **aqui**, no boot, e não sob demanda: se
    // o SO não oferece cifra, é melhor o app falhar cedo e visível do que na primeira vez que
    // o usuário tentar salvar uma chave.
    const credentialRepository = new CredentialRepository(storage.db, new SafeStorageCipher())
    const credentials = new CredentialService(credentialRepository, storage.audit, policy)

    // Gate de orçamento (SPEC-Providers-03). Construído **antes** do ponto único porque é
    // dependência dele: um `AiCallService` sem gate seria um caminho até o provider sem
    // orçamento, que é exatamente o que o ponto único existe para não permitir.
    const budget = new BudgetService(new BudgetRepository(storage.db), storage.audit)

    // Ponto único de chamada de IA (SPEC-Providers-02). Construído **depois** do vault porque
    // depende dele: nenhum adapter chama provider sem credencial, e o serviço a resolve por
    // escopo no instante da chamada. O mapa de adapters é onde a F04 acrescenta providers.
    // Os quatro adapters (SPEC-Providers-04). O mapa é onde a F04 acrescentou os três novos —
    // e o ponto de chamada não mudou por causa disso, que é o critério 1 da F02 valendo na
    // prática. `ollama` e `claude-code` não recebem credencial: o primeiro fala com o
    // `localhost`, o segundo usa a sessão do próprio CLI.
    const ollamaAdapter = new OllamaAdapter()
    const claudeCodeAdapter = new ClaudeCodeAdapter()
    const adapters = {
      anthropic: new AnthropicAdapter(),
      gemini: new GeminiAdapter(),
      ollama: ollamaAdapter,
      'claude-code': claudeCodeAdapter
    }

    // Roteamento e healthcheck (SPEC-Providers-04). A sonda é montada aqui porque **cada
    // provider responde a uma pergunta diferente**: os locais têm healthcheck próprio (o
    // servidor pode não estar rodando), e os de nuvem estão indisponíveis para *este* usuário
    // quando falta credencial — pingar a API para descobrir isso custaria uma requisição por
    // checagem e responderia a pergunta errada.
    const routingRepo = new RoutingRepository(storage.db)
    const routing = new RoutingService(
      routingRepo,
      new SondaDeAdapters({
        anthropic: async () =>
          credentials.resolve(userIdAtual(), workspaces.atual(), 'anthropic') !== undefined,
        gemini: async () =>
          credentials.resolve(userIdAtual(), workspaces.atual(), 'gemini') !== undefined,
        ollama: () => ollamaAdapter.disponivel(),
        'claude-code': () => claudeCodeAdapter.disponivel()
      }),
      storage.audit
    )

    const ai = new AiCallService(
      adapters,
      credentials,
      policy,
      storage.audit,
      budget,
      routing,
      contexts
    )

    // Ponto único de conectores (SPEC-Conectores-01). **Runtime separado** do ponto único de
    // IA por decisão do PI (2026-08-29): compartilham o vault, a auditoria encadeada e o
    // ledger de uso, e nada além disso — `ai` não aparece na construção abaixo.
    //
    // O registro nasce **vazio**, e é isso que a fatia entrega: os adapters concretos (GitHub
    // na M6-F03/F04, Tavily na M6-F05/F06) se registram aqui quando existirem. Até lá, pedir
    // por um conector conhecido devolve `connector-nao-registrado` — que é o critério 1
    // valendo, não uma lacuna.
    const connectorRegistry = new ConnectorRegistry()
    // O primeiro adapter concreto (SPEC-Conectores-03): o limite que a F01 registrou
    // ("nenhum adapter concreto existe") fecha aqui. `auth.identify` veio na F03; as nove
    // capacidades idempotentes de automação, na F04.
    connectorRegistry.register(new GithubAdapter())
    // O segundo (SPEC-Conectores-05 e 06): pesquisa e extração de evidência. É o primeiro
    // conector que **cobra** — e por isso o primeiro cujo `custoEstimado` faz o gate de créditos
    // da F02 ter o que decidir.
    connectorRegistry.register(new TavilyAdapter())

    // O Device Flow (SPEC-Conectores-03). Lê e grava o **payload estruturado** no mesmo cofre
    // das credenciais de IA, com `expires_at` fora da cifra e rotação atômica — a emenda ao
    // Vault que o PI cravou como escopo desta fatia, sem reabrir a M5-F01.
    const githubAuth = new GithubAuthService(
      credentialRepository,
      storage.audit,
      // O override do `client_id` vem do perfil, não do cofre: não é segredo (é público por
      // desenho no Device Flow), e guardá-lo cifrado o anunciaria como se fosse.
      () => storage.profiles.findGithubClientId(userIdAtual())
    )
    // O gate de créditos (SPEC-Conectores-02). Construído **antes** do ponto único porque é
    // dependência dele, como o `BudgetService` é do `AiCallService`: um `ConnectorService` sem
    // gate seria um caminho até o conector sem teto.
    //
    // **Ledger separado do de USD** (decisão do PI): este conta créditos por conector, o
    // `budget` conta dólares por espaço. Nenhum dos dois soma o outro.
    const connectorCredits = new CreditService(new CreditRepository(storage.db), storage.audit)
    const connectors = new ConnectorService(
      connectorRegistry,
      // A fonte de segredo de conector lê o **mesmo cofre** das credenciais de IA: a coluna
      // `credential_ref.key` é texto e o índice único já endereça qualquer chave lógica. O que
      // é separado são as taxonomias (`ConnectorCredentialKey` versus `CredentialKey`), e elas
      // vivem nos tipos — um segundo cofre duplicaria cifra e migration por nada. O payload
      // estruturado (access + refresh + `expires_at`) e a rotação atômica são a M6-F03.
      {
        // O GitHub tem caminho próprio: seu segredo é o **payload OAuth**, e entregá-lo cru ao
        // adapter mandaria o JSON inteiro no header `Authorization`. `tokenParaUso` decifra,
        // **renova quando está vencendo** (critério 5) e devolve só o access token. Os demais
        // conectores seguem lendo o valor único, que é o formato deles.
        resolve: async (userId, workspace, key) =>
          key === 'github'
            ? await githubAuth.tokenParaUso({ userId, workspace })
            : credentialRepository.readSecret(userId, workspace, key)
      },
      policy,
      storage.audit,
      connectorCredits
    )

    // O pacote estrutural (SPEC-Planejamento-04). Recebe o `ConnectorService`, e **não** o
    // `TavilyAdapter`: o gate de créditos vive dentro do `call()`, e um adapter injetado aqui
    // seria o segundo caminho sem gate que o serviço de conectores existe para impedir.
    const pacotes = new PacoteService({
      repository: new PacoteRepository(storage.db),
      projects: projectRepository,
      projectService: projects,
      decisions: new DecisionRepository(storage.db),
      connectors,
      audit: storage.audit,
      userId: userIdAtual
    })

    // Os anexos de design e a arquitetura (SPEC-Planejamento-05). Recebe o `PacoteRepository`
    // para ler a revisão do PRD que a arquitetura assume (critério 3) — e não o `PacoteService`:
    // ele só precisa **ler** o pacote gerado, e depender do serviço lhe daria o poder de
    // disparar a geração do PRD, que não é dele.
    const anexos = new AnexoService({
      repository: new AnexoRepository(storage.db),
      projects: projectRepository,
      projectService: projects,
      decisions: new DecisionRepository(storage.db),
      pacotes: new PacoteRepository(storage.db),
      audit: storage.audit,
      userId: userIdAtual
    })

    // O roadmap e os gates (SPEC-Planejamento-06).
    //
    // `identidade` é o usuário **autenticado**, e não o `userIdAtual`: sem sessão o gate falha
    // fechado (decisão cravada da spec), e `userIdAtual` cai no usuário local — que existe
    // sempre e faria toda aprovação passar como se houvesse alguém logado. A distinção é o
    // critério 4: a aprovação registra *quem* aceitou, e "o usuário local" não é ninguém.
    const roadmapRepository = new RoadmapRepository(storage.db)
    const roadmap = new RoadmapService({
      repository: roadmapRepository,
      projects: projectRepository,
      projectService: projects,
      decisions: new DecisionRepository(storage.db),
      pacotes: new PacoteRepository(storage.db),
      anexos,
      audit: storage.audit,
      userId: userIdAtual,
      identidade: () => auth?.usuarioAtual()?.id
    })

    // Publicação no GitHub (SPEC-Entrega-01). Recebe o `ConnectorService`, **não** o
    // `GithubAdapter`: o gate de créditos, a policy e a auditoria vivem dentro do `call()`, e um
    // adapter injetado aqui seria o segundo caminho sem gate — o mesmo erro que o `GitRunner`
    // impede do lado do Git. O `token` é só para o push, que o terminal controlado não consegue
    // autenticar por ambiente; o conector resolve o dele por dentro.
    const publicacao = new PublicacaoService({
      projects: projectRepository,
      roadmap: roadmapRepository,
      git: gitRunner,
      connectors,
      audit: storage.audit,
      userId: userIdAtual,
      token: async (userId, workspace) => await githubAuth.tokenParaUso({ userId, workspace })
    })
    registerIpcHandlers({
      audit: storage.audit,
      workspaces,
      preferences,
      policy,
      allowlist,
      workflows: workflowsService,
      execution,
      realExecution,
      terminal,
      commandAllowlist,
      projects,
      contexts,
      wizard,
      pacotes,
      anexos,
      roadmap,
      publicacao,
      credentials,
      ai,
      budget,
      routing,
      routingRepo,
      connectors,
      connectorCredits,
      githubAuth,
      profiles: storage.profiles,
      runs,
      approvals,
      userId: userIdAtual,
      auth,
      minimizeToTray: () => janela?.hide()
    })

    janela = createMainWindow()
    createTray(janela)

    // Restaura a sessão do cofre depois da janela existir: a transição é empurrada ao
    // renderer, e sem janela o `webContents.send` cairia no vazio.
    void auth?.restaurar()

    // macOS: recriar a janela ao clicar no dock sem janelas abertas.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        log.sistema.info('Janela recriada a partir do dock')
        janela = createMainWindow()
      } else if (janela) {
        revelarJanela(janela)
      }
    })
  })
}

/**
 * Monta o `AuthService`, ou devolve `undefined` quando não há credenciais.
 *
 * Ausência de credencial **não** é erro fatal: o app roda com o usuário local e só o login
 * fica indisponível (documentado no `.env.example`). Derrubar o boot por falta de um
 * projeto Supabase impediria qualquer um de clonar o repo e rodar.
 */
function criarAuthService(
  userDataDir: string,
  storage: ReturnType<typeof initStorage>,
  janelaAtual: () => BrowserWindow | undefined
): AuthService | undefined {
  const config = readSupabaseConfig()

  if (!config) {
    log.auth.warn(
      'Credenciais do Supabase ausentes: login indisponível. ' +
        'Preencha SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY no .env (ver .env.example).'
    )
    return undefined
  }

  const vault = new SafeStorageTokenVault(join(userDataDir, 'session.vault'))

  return new AuthService({
    supabase: createSupabaseClient(config, vault),
    vault,
    audit: storage.audit,
    profiles: storage.profiles,
    sessions: storage.sessions,
    openExternal: (url) => shell.openExternal(url),
    onChange: (snapshot) => {
      // `isDestroyed` evita erro na corrida entre o fim do login e o fechamento da janela.
      const alvo = janelaAtual()
      if (alvo && !alvo.isDestroyed()) {
        alvo.webContents.send(IPC_EVENT_CHANNELS.authChanged, snapshot)
      }
    }
  })
}

// Com tray, fechar a última janela **não** encerra o app (SPEC-02): ele continua vivo na
// bandeja. Quem encerra é o "Sair" do menu do tray.
app.on('window-all-closed', () => {
  // Sem handler algum o Electron encerraria sozinho fora do macOS; este bloco existe
  // justamente para impedir isso.
})

// Fecha banco e transports antes de sair; sem isso o último registro pode não chegar ao
// disco. Banco antes do logger: fechar o SQLite ainda pode gerar registro.
app.on('will-quit', () => {
  log.sistema.info('Aplicação encerrada')
  destroyTray()
  closeStorage()
  closeLogger()
})

// Falha não capturada é o caso em que o log mais importa — e o que mais some sem isto.
process.on('uncaughtException', (error) => {
  log.sistema.error('Exceção não capturada no processo principal', { error })
})

process.on('unhandledRejection', (reason) => {
  log.sistema.error('Promise rejeitada sem tratamento no processo principal', { reason })
})
