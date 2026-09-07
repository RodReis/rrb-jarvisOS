import { dirname, join, resolve } from 'node:path'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { VozService } from './voz/voz-service'
import { ARTEFATOS_DA_VOZ } from './voz/artefatos'
import { baixarArtefato } from './voz/download-de-artefato'
import { mkdirSync, writeFileSync } from 'node:fs'
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
import { PhaseModelRepository } from './ai/phase-model-repository'
import { PhaseModelService } from './ai/phase-model-service'
import { CodexProfileService } from './ai/codex-profile-service'
import { CodexAdapter } from './ai/codex-adapter'
import { abrirRunNeutro, type RunNeutro } from './ai/cwd-neutro'
import {
  SCHEMA_DAS_AFIRMACOES,
  SCHEMA_DO_BRIEF,
  SCHEMA_DAS_CONTRADICOES,
  SCHEMA_DAS_PERGUNTAS,
  SCHEMA_DA_SPEC,
  SCHEMA_DOS_AJUSTES,
  SCHEMA_DO_ROADMAP
} from '@shared/domain/json-schema-da-saida'
import { GenerationTraceService } from './ai/generation-trace-service'
import { GenerationTraceRepository } from './ai/generation-trace-repository'
import { QuotaRepository } from './ai/quota-repository'
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
import { ExternalRefRepository } from './projects/external-ref-repository'
import { PublicacaoService } from './projects/publicacao-service'
import { FilaService } from './pipeline/fila-service'
import { EffectJournalRepository } from './pipeline/effect-journal-repository'
import { LeaseRepository } from './pipeline/lease-repository'
import { MergePolicyRepository } from './pipeline/merge-policy-repository'
import { MergePolicyService } from './pipeline/merge-policy-service'
import { PipelineRepository } from './pipeline/pipeline-repository'
import { ReconciliacaoService } from './pipeline/reconciliacao-service'
import { MarcosService } from './projects/marcos-service'
import { RoadmapService } from './projects/roadmap-service'
import { RoadmapGeradoService } from './projects/roadmap-gerado-service'
import { RoadmapGeradoRepository } from './projects/roadmap-gerado-repository'
import { JornadaService } from './projects/jornada-service'
import { BriefService } from './projects/brief-service'
import { BriefRepository } from './projects/brief-repository'
import { PrdService } from './projects/prd-service'
import { ArquiteturaService } from './projects/arquitetura-service'
import { ArquiteturaRepository } from './projects/arquitetura-repository'
import { PrdRepository } from './projects/prd-repository'
import { RefinamentoService } from './projects/refinamento-service'
import { PerguntaGeradaRepository } from './projects/pergunta-gerada-repository'
import {
  SISTEMA_DAS_PERGUNTAS,
  SISTEMA_DO_BRIEF,
  lerPerguntasDoModelo,
  lerSaidaDoModeloDetalhada,
  promptDaGeracao,
  promptDasPerguntas
} from '@shared/domain/brief-schema'
import { ARQUIVO_DO_PROMPT } from '@shared/domain/brief'
import {
  SISTEMA_DAS_CONTRADICOES,
  SISTEMA_DO_PRD,
  SISTEMA_DO_TERMO,
  lerContradicoesDoModelo,
  lerDocumentosDoModelo,
  lerTermoDoModelo,
  promptDasContradicoes,
  promptDoPrd,
  promptDoTermo
} from '@shared/domain/prd-schema'
import {
  SISTEMA_DA_ARQUITETURA,
  SISTEMA_DA_COERENCIA,
  lerAjustesDoModelo,
  lerArquiteturaDoModelo,
  promptDaArquitetura,
  promptDaCoerencia
} from '@shared/domain/arquitetura-schema'
import {
  SISTEMA_DA_SPEC,
  SISTEMA_DO_ROADMAP,
  lerRoadmapDoModelo,
  lerSpecDoModelo,
  promptDaSpec,
  promptDoRoadmap
} from '@shared/domain/roadmap-schema'
import { ordemDaEtapa } from '@shared/domain/jornada'
import type { Etapa } from '@shared/domain/jornada'
import { faseDaEtapa, type Fase } from '@shared/domain/fase'
import type { RotaComModelo } from '@shared/domain/modelo-da-fase'
import type { WorkspaceId } from '@shared/domain/entities'
import type { AiProvider, AiStreamEvent } from '@shared/domain/ai'
import type { EstadoDaEtapa, EtapaDaGeracao } from '@shared/domain/geracao'
import type { EstadoDasRotas } from '@shared/domain/rota-de-geracao'
import { GitRunner } from './projects/git-runner'
import { DockerRunner, prepararGitMeta, TIMEOUT_DOCKER_MS } from './pipeline/docker-runner'
import { ConstrutorService } from './pipeline/construtor-service'
import { EntregaService } from './pipeline/entrega-service'
import { ExecutionLedgerRepository } from './pipeline/execution-ledger-repository'
import { LimpezaService } from './pipeline/limpeza-service'
import { RetencaoService } from './pipeline/retencao-service'
import { ExecutorProxy } from './pipeline/executor-proxy'
import { RulesetRepository } from './pipeline/ruleset-repository'
import { PreflightService } from './pipeline/preflight-service'
import { verificadorDeContainer, verificadorDePorta } from './pipeline/verificadores-de-sandbox'
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

  // `async` por causa da M9-F02: o `reconcileAll` do boot é **bloqueante** por decisão da spec —
  // nenhum trabalho novo é adquirido antes de ele terminar.
  app.whenReady().then(async () => {
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
    // O repositório sai da expressão porque a M9-F06 também o consome: o `ExecutionLedger`
    // soma o consumo do run por `run_id`, correlação que a M9-F05 passou a gravar.
    const budgetRepository = new BudgetRepository(storage.db)
    const budget = new BudgetService(budgetRepository, storage.audit)

    // Ponto único de chamada de IA (SPEC-Providers-02). Construído **depois** do vault porque
    // depende dele: nenhum adapter chama provider sem credencial, e o serviço a resolve por
    // escopo no instante da chamada. O mapa de adapters é onde a F04 acrescenta providers.
    // Os quatro adapters (SPEC-Providers-04). O mapa é onde a F04 acrescentou os três novos —
    // e o ponto de chamada não mudou por causa disso, que é o critério 1 da F02 valendo na
    // prática. `ollama` e `claude-code` não recebem credencial: o primeiro fala com o
    // `localhost`, o segundo usa a sessão do próprio CLI.
    /*
     * O perfil isolado do Codex (SPEC-Multi-Executor-02).
     *
     * O `CODEX_HOME` nasce sob `userData` — fora do perfil pessoal do PI e fora do repositório,
     * como a spec pede. Um terceiro requisito só apareceu medindo: o Codex **recusa** criar seus
     * binários auxiliares sob diretório temporário, então `TEMP` degradaria em silêncio.
     *
     * Nasce **antes** dos adapters porque o `CodexAdapter` depende dele: é o `CODEX_HOME` que faz
     * o CLI abrir a sessão da pipeline em vez do `~/.codex` pessoal do PI.
     */
    const codexProfile = new CodexProfileService({
      userDataDir: app.getPath('userData'),
      audit: storage.audit,
      userId: userIdAtual,
      workspaceId: () => workspaces.atual()
    })

    const ollamaAdapter = new OllamaAdapter()
    /**
     * O cwd neutro dos dois CLIs (emenda E1 à SPEC-Fases-03).
     *
     * Um diretório vazio por geração sob o `userData`, e **não** `process.cwd()`: em dev o
     * diretório do processo é o repositório do próprio JarvisOS, e o CLI carregava `CLAUDE.md`,
     * `.claude/`, regras, hooks e MCPs deste projeto para gerar o documento de outro — 230.444
     * tokens de entrada num refinamento de prompt pequeno.
     */
    const abrirRunDoCli = (): RunNeutro => abrirRunNeutro(app.getPath('userData'))
    const claudeCodeAdapter = new ClaudeCodeAdapter(abrirRunDoCli)
    // O quinto adapter (SPEC-Fases-06): a assinatura do Codex pelo mesmo ponto único. O perfil
    // entra por função e não por valor — quem o resolve é o `CodexProfileService`, e capturá-lo
    // aqui congelaria um caminho que pode mudar.
    const codexAdapter = new CodexAdapter(abrirRunDoCli, () => codexProfile.codexHome)
    const adapters = {
      anthropic: new AnthropicAdapter(),
      gemini: new GeminiAdapter(),
      ollama: ollamaAdapter,
      'claude-code': claudeCodeAdapter,
      codex: codexAdapter
    }

    // Roteamento e healthcheck (SPEC-Providers-04). A sonda é montada aqui porque **cada
    // provider responde a uma pergunta diferente**: os locais têm healthcheck próprio (o
    // servidor pode não estar rodando), e os de nuvem estão indisponíveis para *este* usuário
    // quando falta credencial — pingar a API para descobrir isso custaria uma requisição por
    // checagem e responderia a pergunta errada.
    const routingRepo = new RoutingRepository(storage.db)

    // O modelo de cada fase (SPEC-Fases-02). Ao lado do roteamento porque responde a pergunta
    // vizinha — aquele decide **quem** atende uma tarefa, este decide **com que modelo** a
    // jornada gera cada fase —, e as duas politicas vivem no mesmo escopo.
    const phaseModelRepo = new PhaseModelRepository(storage.db)
    const phaseModels = new PhaseModelService(phaseModelRepo, storage.audit)

    const routing = new RoutingService(
      routingRepo,
      new SondaDeAdapters({
        anthropic: async () =>
          credentials.resolve(userIdAtual(), workspaces.atual(), 'anthropic') !== undefined,
        gemini: async () =>
          credentials.resolve(userIdAtual(), workspaces.atual(), 'gemini') !== undefined,
        ollama: () => ollamaAdapter.disponivel(),
        'claude-code': () => claudeCodeAdapter.disponivel(),
        /*
         * O Codex está **pronto para gerar**? — binário no ar **e** perfil autenticado.
         *
         * Perguntar só pelo binário (como o `claude-code` faz) seria incoerente aqui, e de um
         * jeito que confunde: um Codex instalado e sem login apareceria **online** na tela de
         * providers enquanto toda geração por Sol bloqueia. O critério 6 da SPEC-Fases-06 pede
         * justamente que o health apareça — e um "online" que não gera é pior que um "offline".
         *
         * A diferença em relação ao Claude Code não é inconsistência: lá a sessão vive no perfil
         * pessoal do CLI e o app não a inspeciona; aqui o perfil é **da pipeline** (M10-F02) e o
         * `CodexProfileService` responde por ele. O detalhe de *por que* está fora (login,
         * quota, ferramenta) fica no painel do perfil, que tem os cinco estados.
         */
        codex: async () =>
          (await codexAdapter.disponivel()) &&
          (await codexProfile.estado()).saude !== 'auth_required'
      }),
      storage.audit
    )

    // Estado de quota das rotas subscription_limited (SPEC-Entrega-04, critério 12). Construído
    // aqui pela mesma razão do `budget`: é dependência do ponto único, não consulta opcional —
    // sem ele o gate de quota do `claude-code` fica sempre "desconhecido" em produção.
    const quota = new QuotaRepository(storage.db)

    // O console da geração (SPEC-Fases-03). O `publicar` empurra cada evento para o renderer no
    // canal único; quem filtra por `traceId` é o preload. `isDestroyed` pela mesma razão do
    // `authChanged`: a corrida entre o fim da geração e o fechamento da janela é normal, e um
    // `send` para uma janela morta lançaria dentro do coletor.
    const generationTraces = new GenerationTraceService(
      new GenerationTraceRepository(storage.db),
      (evento) => {
        if (janela !== undefined && !janela.isDestroyed()) {
          janela.webContents.send(IPC_EVENT_CHANNELS.generationEvent, evento)
        }
      }
    )

    const ai = new AiCallService(
      adapters,
      credentials,
      policy,
      storage.audit,
      budget,
      routing,
      contexts,
      quota,
      generationTraces
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
    // O diário de efeitos (SPEC-Entrega-02, § Diário de efeitos; issue #209). Construído antes
    // do ponto único porque é dependência dele — a reconciliação, mais abaixo, reusa a mesma
    // instância para ler as intenções pendentes.
    const effectJournal = new EffectJournalRepository(storage.db)
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
      effectJournal,
      connectorCredits
    )

    // Compartilhado com o `PrdService` e com o `ArquiteturaService`: os três leem e escrevem a
    // mesma tabela `pacote_estrutural`, que é onde a revisão do PRD que a arquitetura assume
    // (`pacoteEstruturalId`) mora desde a M8-F05.
    const pacoteRepository = new PacoteRepository(storage.db)

    // O pacote estrutural (SPEC-Planejamento-04). Recebe o `ConnectorService`, e **não** o
    // `TavilyAdapter`: o gate de créditos vive dentro do `call()`, e um adapter injetado aqui
    // seria o segundo caminho sem gate que o serviço de conectores existe para impedir.
    const pacotes = new PacoteService({
      repository: pacoteRepository,
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
    // O repositório é **compartilhado** com o `ArquiteturaService`: os dois leem os mesmos
    // anexos (o gate) e escrevem o mesmo `pacote_arquitetura` (a revisão que o gate
    // `PROJECT_PACKAGE` aprova). Duas instâncias sobre o mesmo banco funcionariam, mas a
    // ligação entre os dois serviços ficaria implícita — e é ela que o critério 5 depende.
    const anexoRepository = new AnexoRepository(storage.db)

    const anexos = new AnexoService({
      repository: anexoRepository,
      projects: projectRepository,
      projectService: projects,
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
    /*
     * O repositório da revisão gerada é criado aqui, antes do serviço que a produz, porque os
     * **gates** precisam dela: `MVP_ENTRY` aprova o MVP escolhido e `SLICE_ENTRY` a SPEC com as
     * respostas, e os dois moram no `RoadmapService`. Passar o serviço inteiro criaria um ciclo
     * — ele depende da projeção que este mesmo repositório grava —, e a leitura é só uma linha.
     */
    const roadmapGeradoRepository = new RoadmapGeradoRepository(storage.db)

    // O painel de marcos e o gate da Construção (SPEC-Fases-04). Lê o mesmo `gitRunner` que
    // commita os marcos: uma segunda instância não seria um segundo caminho de política — o
    // `TerminalEngine` é o mesmo —, mas seria uma segunda resposta para "qual Git o app usa".
    const marcos = new MarcosService({
      git: gitRunner,
      projects: projectRepository,
      pacotes: pacoteRepository,
      anexos,
      audit: storage.audit,
      userId: userIdAtual
    })

    const roadmap = new RoadmapService({
      repository: roadmapRepository,
      projects: projectRepository,
      pacotes: pacoteRepository,
      anexos,
      audit: storage.audit,
      userId: userIdAtual,
      identidade: () => auth?.usuarioAtual()?.id,
      roadmapGerado: (projectId) => roadmapGeradoRepository.vigente(userIdAtual(), projectId),
      verificarMarcos: (projectId, workspaceId) => marcos.verificar(projectId, workspaceId)
    })

    // A jornada de planejamento (SPEC-Jornada-01).
    //
    // Recebe o `RoadmapRepository` porque é lá que as aprovações de gate moram: a etapa é
    // derivada delas e dos marcos commitados, nunca declarada. `userIdAtual` basta aqui — o
    // serviço **lê** aprovações para derivar a etapa, e não registra nenhuma; quem exige a
    // identidade autenticada é o gate, no `RoadmapService` acima.
    const jornada = new JornadaService({
      repository: projectRepository,
      roadmap: roadmapRepository,
      audit: storage.audit,
      userId: userIdAtual,
      // O modelo que a próxima geração usaria — a **mesma** fonte que a geração consulta, e é o
      // que faz o card e o selo nunca discordarem (SPEC-Fases-01, critério 4).
      /*
       * O modelo do card e o da geracao sao **a mesma leitura** (SPEC-Fases-01, criterio 4).
       *
       * Ate a SPEC-Fases-02 era o modelo ativo do provider; agora e o da fase, com o override do
       * projeto. Deixar o `routingRepo.modeloAtivo` aqui faria o card anunciar Opus enquanto a
       * geracao sai por Fable — duas leituras "certas" em fontes diferentes, sem erro a
       * investigar.
       */
      modeloAtivo: (workspace, provider, fase, projectId) => {
        const rota = ROTA_DO_PROVIDER[provider]
        if (rota === undefined) return routingRepo.modeloAtivo(userIdAtual(), workspace, provider)

        return phaseModels.resolver({ userId: userIdAtual(), workspace }, fase, rota, projectId)
          .modelo
      },
      /*
       * O aceite documental deixa marco no Git (#259). Passa pelo `ProjectService` porque ele é
       * o **único gatilho de commit** do produto (M8-F01) — um segundo caminho até o Git faria
       * dois lugares decidirem o que entra no histórico do projeto.
       *
       * `commitado` é o que a jornada precisa saber: falha vira recusa da transição, e não uma
       * etapa adiante de uma evidência que não existe.
       */
      concluirMarco: (projectId, marco, workspace) =>
        projects.concluirMarco(projectId, marco, workspace)?.commitado ?? false,
      /*
       * O brief gerado fecha o refinamento (#281, decisão do PI de 2026-09-05).
       *
       * Lazy de propósito: o `briefRepository` nasce depois deste serviço, e antecipá-lo só
       * para esta linha reordenaria o wiring inteiro. A closure é resolvida na primeira
       * leitura da jornada, muito depois de os dois existirem.
       */
      temBrief: (projectId) => briefRepository.briefVigente(userIdAtual(), projectId) !== undefined
    })

    // O prompt e o brief refinado (SPEC-Jornada-02).
    //
    // **O estado das rotas é lido aqui, e não dentro do serviço**, porque quem sabe se a
    // assinatura está no ar é o adapter, e quem sabe da quota é o repositório — o serviço só
    // decide a partir do fato. Injetar a leitura mantém a decisão testável sem Electron.
    //
    // `optInDeRotaPaga` é **false fixo por enquanto**: nenhuma superfície o habilita ainda, e o
    // default tem de ser o que não gasta. Quando a M25-F03 trouxer a preferência por projeto,
    // é esta linha que passa a lê-la — até lá, a rota paga simplesmente não é alcançável, que é
    // o comportamento seguro do critério 6.
    /*
     * As duas leituras que o brief e o refinamento compartilham — extraídas para constantes
     * porque as duas gerações atravessam exatamente as mesmas barreiras: a rota decide se o
     * orçamento é USD ou uso, e o `ContextPack` é a pré-condição de qualquer chamada. Duplicá-las
     * deixaria as duas gerações divergirem no dia em que uma das cópias mudasse.
     */
    /** O card da lista pergunta pelo ambiente, não por um projeto. */
    const SEM_PROJETO = ''

    /*
     * A disponibilidade de **cada** assinatura (SPEC-Fases-06 § Dentro).
     *
     * `Record` e não `if`: com duas assinaturas, um `if (provider === 'codex')` faria a terceira
     * nascer com a checagem esquecida — e o modo de falha seria o pior possível, uma assinatura
     * que o app dá como indisponível sem nunca ter perguntado.
     */
    const ASSINATURA_NO_AR: Readonly<Partial<Record<AiProvider, () => Promise<boolean>>>> = {
      'claude-code': () => claudeCodeAdapter.disponivel(),
      codex: () => codexAdapter.disponivel()
    }

    /**
     * O estado das rotas **para a fase que vai gerar**.
     *
     * A `fase` entra na assinatura (decisão do PI, 2026-09-05) porque desde a SPEC-Fases-06 há
     * duas assinaturas, e **qual** delas precisa estar no ar depende do modelo que o PI escolheu
     * para aquela fase. Sem esse parâmetro, o app perguntaria sempre pelo Claude Code e
     * bloquearia uma geração por Sol com base na assinatura errada — ou, pior, a liberaria.
     *
     * **Nenhuma assinatura cai na outra**: a função devolve a disponibilidade *daquela* que a
     * fase escolheu, e `escolherRota` bloqueia se ela faltar. Um `||` entre as duas aqui seria
     * exatamente o fallback que a decisão 4 do MVP-025 proíbe, com o agravante de trocar de
     * fornecedor sem o PI decidir.
     */
    const estadoDasRotasDoProjeto = async (
      projectId: string,
      workspace: WorkspaceId,
      // **Obrigatória, sem default** — a razão que a M26-F04 cravou em `verificarMarcos` e a
      // M26-F05 em `modeloDaConstrucao`: um default de `'planejamento'` faria o RoadmapGerado
      // (que é `especificacao`) consultar a assinatura da fase errada, e o compilador não teria
      // como apontar. Sendo obrigatória, cada ponto de injeção declara a sua.
      fase: Fase
    ): Promise<EstadoDasRotas> => {
      const daFase = phaseModels.resolver(
        { userId: userIdAtual(), workspace },
        fase,
        'assinatura',
        projectId === '' ? undefined : projectId
      )
      const sonda = ASSINATURA_NO_AR[daFase.provider]
      const quotaDaAssinatura = quota.ler(userIdAtual(), workspace, daFase.provider)

      return {
        // Provider que não é rota de assinatura (a política guardada pode apontar um) responde
        // `false`: é fail-closed, e o bloqueio diz o que fazer. Inventar `true` liberaria uma
        // chamada por uma rota que não existe.
        assinaturaDisponivel: sonda === undefined ? false : await sonda(),
        assinaturaEsgotada: quotaDaAssinatura?.restante === 0,
        rotaPagaConfigurada:
          credentials.resolve(userIdAtual(), workspace, 'anthropic') !== undefined,
        optInDeRotaPaga: false,
        assinaturaDe: daFase.provider
      }
    }

    /*
     * O modelo que atende esta geracao (SPEC-Fases-02, criterio 2).
     *
     * As closures de geracao recebem o **provider** ja decidido (`rota`), nao a decisao; e o
     * `modeloDaFase` precisa da rota para saber qual dos dois combos ler — a rota de assinatura
     * oferece Fable, a paga nao. A traducao de volta e um `Record`, e nao um `if`: acrescentar
     * provider passa a ser acrescentar uma linha, e um `else` faria todo provider desconhecido
     * cair na rota errada em silencio.
     *
     * Vive aqui, ao lado das sete closures que o consomem, pela mesma razao que
     * `estadoDasRotasDoProjeto` vive: e composicao, nao regra — a regra e a funcao pura.
     */
    const ROTA_DO_PROVIDER: Readonly<Record<AiProvider, RotaComModelo | undefined>> = {
      'claude-code': 'assinatura',
      anthropic: 'paga',
      gemini: undefined,
      ollama: undefined,
      // **`assinatura`, e não uma terceira rota** (SPEC-Fases-06 § Dentro): o Codex atende pela
      // assinatura do PI, e o modo `api` dele é rota paga governada pelo mesmo opt-in por
      // projeto. As duas assinaturas dividem a mesma coluna do catálogo por fase, e nenhuma cai
      // na outra — quem garante isso é `escolherRota`.
      codex: 'assinatura'
    }

    const modeloDaGeracao = (
      etapa: Etapa,
      provider: AiProvider,
      projectId: string,
      workspace: WorkspaceId
    ): string | undefined => {
      const rota = ROTA_DO_PROVIDER[provider]
      // Provider que nao atende nenhuma das duas rotas da jornada nao tem modelo por fase a
      // resolver: devolve `undefined` e o ponto unico cai no `MODELO_PADRAO`, como antes desta
      // fatia. Inventar uma rota aqui faria a politica do PI valer para uma chamada que ele
      // nunca configurou.
      if (rota === undefined) return undefined

      return phaseModels.resolver(
        { userId: userIdAtual(), workspace },
        faseDaEtapa(etapa),
        rota,
        projectId
      ).modelo
    }

    const montarContextoDoPrompt = (
      projectId: string,
      workspace: WorkspaceId,
      rota: AiProvider
    ): string | undefined =>
      contexts.montar(
        {
          projectId,
          tarefa: 'Gerar o brief a partir do prompt do PI',
          etapa: 'prompt',
          candidatos: [
            { caminho: ARQUIVO_DO_PROMPT, origem: 'explicito', motivo: 'Prompt do projeto' }
          ],
          rota
        },
        workspace
      ).pack?.id

    const briefRepository = new BriefRepository(storage.db)

    /*
     * O refinamento vem **antes** do brief porque o brief cita as decisões dele: sem as
     * respostas do PI no pedido, toda afirmação vinda de uma escolha viraria `proposto`, e a
     * distinção entre "o PI decidiu" e "a IA inferiu" sumiria justo onde ela mais importa.
     */
    const refinamento = new RefinamentoService({
      perguntas: new PerguntaGeradaRepository(storage.db),
      decisions: new DecisionRepository(storage.db),
      projects: projectRepository,
      audit: storage.audit,
      userId: userIdAtual,
      promptVigente: (projectId) => briefRepository.promptVigente(userIdAtual(), projectId)?.texto,
      estadoDasRotas: (projectId, workspace) =>
        estadoDasRotasDoProjeto(projectId, workspace, 'planejamento'),
      montarContexto: montarContextoDoPrompt,
      gerar: async ({ projectId, workspace, prompt, blocosEmAberto, rota, contextPackId }) => {
        let texto = ''
        const model = modeloDaGeracao('refinamento', rota, projectId, workspace)

        for await (const evento of ai.call(
          {
            provider: rota,
            ...(model === undefined ? {} : { model }),
            system: SISTEMA_DAS_PERGUNTAS,
            jsonSchema: SCHEMA_DAS_PERGUNTAS,
            prompt: promptDasPerguntas(prompt, blocosEmAberto),
            contextPackId,
            console: { projectId, etapa: 'refinamento' }
          },
          { userId: userIdAtual(), workspace }
        )) {
          if (evento.tipo === 'chunk') {
            texto += evento.texto
            continue
          }
          if (evento.estado !== 'concluido') return {}
        }

        const perguntas = lerPerguntasDoModelo(texto)
        return perguntas === undefined ? {} : { perguntas }
      }
    })

    const brief = new BriefService({
      repository: briefRepository,
      audit: storage.audit,
      userId: userIdAtual,
      decisoesDoRefinamento: (projectId) => refinamento.decisoesParaOBrief(projectId),
      /*
       * Escreve `docs/PROMPT.md` e commita como marco documental — mesma sequência do
       * `PacoteService`: persistir primeiro (já feito no `BriefService`), escrever depois, git
       * por último, sempre pelo `ProjectService.concluirMarco` (M8-F01, o único gatilho de
       * commit). Sem isto o prompt nunca vira revisão, e `montarContexto` abaixo não teria o
       * que citar — a geração ficaria presa em "sem ContextPack" para sempre.
       */
      registrarPromptNoDisco: (projectId, texto, workspace) => {
        const projeto = projectRepository.findById(userIdAtual(), projectId)
        if (projeto === undefined) return undefined

        const alvo = resolve(join(projeto.diretorio, ARQUIVO_DO_PROMPT))
        const raiz = resolve(projeto.diretorio)
        // Mesma barreira de contenção do `PacoteService`: o caminho é constante, nunca vem do
        // chamador, mas a checagem custa uma linha e constante hoje não é constante para sempre.
        if (!alvo.startsWith(raiz)) return undefined

        mkdirSync(dirname(alvo), { recursive: true })
        writeFileSync(alvo, texto, 'utf8')

        const marco = projects.concluirMarco(projectId, 'prompt-registrado', workspace)
        return marco === undefined
          ? undefined
          : { ...(marco.commitHash === undefined ? {} : { commitHash: marco.commitHash }) }
      },
      /*
       * Monta o `ContextPack` a partir do `PROMPT.md` já commitado (SPEC-Planejamento-02,
       * critério 1) — a mesma barreira que qualquer outra geração do produto atravessa. O
       * candidato é `explicito`: é o caminho preferencial da spec, o que a própria geração
       * pediu para ler, não algo que uma busca estrutural encontrou.
       */
      montarContexto: montarContextoDoPrompt,
      estadoDasRotas: (projectId, workspace) =>
        estadoDasRotasDoProjeto(projectId, workspace, 'planejamento'),
      /*
       * A geração, pelo **ponto único** — nunca chamando o adapter direto.
       *
       * É a mesma fronteira que o `PublicacaoService` respeita com o `ConnectorService`: o gate
       * de orçamento, a policy, o registro de custo e a auditoria vivem dentro do `call()`, e um
       * adapter injetado aqui seria o segundo caminho sem gate.
       *
       * `provider` explícito, e não `taskType`: a rota já **foi decidida** pelo serviço, com o
       * bloqueio do critério 6 aplicado antes. Deixar o roteamento escolher de novo aqui
       * desfaria essa decisão — e poderia cair na rota paga que ninguém autorizou.
       */
      gerar: async ({ projectId, workspace, prompt, rota, contextPackId, decisoes, correcao }) => {
        let texto = ''
        const model = modeloDaGeracao('brief-aceito', rota, projectId, workspace)

        for await (const evento of ai.call(
          {
            provider: rota,
            ...(model === undefined ? {} : { model }),
            system: SISTEMA_DO_BRIEF,
            // O brief é o único contrato da jornada com duas chaves de topo (#280): as
            // pendências vivem ao lado das afirmações, e o schema de uma chave só as proibia.
            jsonSchema: SCHEMA_DO_BRIEF,
            prompt: promptDaGeracao(prompt, decisoes, correcao),
            contextPackId,
            /*
             * A etapa **onde a geração acontece**, não a que ela desbloqueia (#281).
             *
             * O console do `ProjetoAberto` filtra pela etapa da tela corrente. Com o brief
             * nascendo no fim do refinamento, registrar `brief-aceito` aqui esconderia do PI o
             * console da própria geração que ele acabou de disparar — ele só apareceria depois
             * de a jornada avançar, quando já não há o que acompanhar. As duas etapas são da
             * fase `planejamento`, então o isolamento do CLI não muda.
             */
            console: { projectId, etapa: 'refinamento' }
          },
          { userId: userIdAtual(), workspace }
        )) {
          if (evento.tipo === 'chunk') {
            texto += evento.texto
            continue
          }

          // `fim` fecha o stream. Estado diferente de concluído devolve saída ausente: a
          // distinção entre "a chamada falhou" e "veio inválida" é o que o serviço usa para
          // decidir se vale corrigir.
          if (evento.estado !== 'concluido') return {}
        }

        // A leitura **detalhada**: o motivo da recusa vem junto, e é ele que separa "o modelo
        // respondeu em português explicando um impedimento" de "o JSON veio quebrado". Sem essa
        // distinção os dois chegavam à tela do PI como a mesma frase de erro.
        const leitura = lerSaidaDoModeloDetalhada(texto)

        return leitura.saida === undefined
          ? {
              ...(leitura.recusa === undefined ? {} : { recusa: leitura.recusa }),
              ...(leitura.textoDoModelo === undefined
                ? {}
                : { textoDoModelo: leitura.textoDoModelo })
            }
          : { saida: leitura.saida }
      }
    })

    /*
     * O PRD, o Landscape e a Convention gerados por IA (SPEC-Jornada-03).
     *
     * Recebe o `PacoteRepository` além do seu próprio: a revisão gerada é gravada nas **duas**
     * tabelas, porque a M8-F05 procura em `pacote_estrutural` a revisão do PRD que a arquitetura
     * assume (`pacoteEstruturalId`). Gravar só na tabela nova quebraria o gate de anexos da
     * fatia seguinte; gravar só na antiga perderia a origem por afirmação.
     *
     * Recebe o `ConnectorService`, e **não** o `TavilyAdapter`, pela mesma razão do
     * `PacoteService`: o gate de créditos vive dentro do `call()`.
     */
    /**
     * Anuncia a etapa de uma geração para a tela (issue #337).
     *
     * **Uma função, injetada nos serviços que geram** — PRD, arquitetura e roadmap. Ela nasceu
     * inline no `PrdService` (#287) e ficou só lá: o PI gerou a arquitetura e o roadmap e viu o
     * botão girar sem nada dizer o que acontecia. Três cópias divergiriam na primeira correção
     * feita numa delas.
     *
     * O `traceId` é derivado do projeto (`etapas:<projectId>`) em vez de sorteado: as etapas
     * atravessam várias chamadas ao modelo, e um id novo a cada anúncio faria a tela tratar cada
     * etapa como uma geração diferente. Derivado, ele é o mesmo do começo ao fim — e não colide
     * com os traces do console, que são UUID.
     *
     * `isDestroyed` pela mesma razão do console: a corrida entre a geração e o fechamento da
     * janela é normal, e um `send` para janela morta lança de dentro do Electron.
     */
    const anunciarEtapa = (
      projectId: string,
      etapa: EtapaDaGeracao,
      estado: EstadoDaEtapa,
      resumo?: string
    ): void => {
      if (janela === undefined || janela.isDestroyed()) return

      janela.webContents.send(IPC_EVENT_CHANNELS.generationEvent, {
        traceId: `etapas:${projectId}`,
        evento: { tipo: 'etapa', etapa, estado, ...(resumo === undefined ? {} : { resumo }) }
      })
    }

    const prd = new PrdService({
      repository: new PrdRepository(storage.db),
      pacotes: pacoteRepository,
      decisions: new DecisionRepository(storage.db),
      projects: projectRepository,
      projectService: projects,
      connectors,
      audit: storage.audit,
      userId: userIdAtual,
      /*
       * O brief **aceito**: o vigente, e só quando a jornada já passou da etapa `brief-aceito`.
       *
       * A etapa é a resposta certa porque ela é derivada dos fatos (M25-F01) — perguntar ao
       * `BriefRepository` diria apenas que existe um brief, não que o PI o aceitou, e o
       * critério 1 exige a revisão **aceita** como âncora.
       */
      briefAceito: (projectId, workspace) => {
        const estado = jornada.estado(projectId, workspace)
        if (estado === undefined) return undefined
        if (ordemDaEtapa(estado.etapa) < ordemDaEtapa('prd')) return undefined
        return brief.carregar(projectId)
      },
      decisoesDoRefinamento: (projectId) => refinamento.decisoesParaOBrief(projectId),
      /*
       * O progresso da geração do pacote (SPEC-Jornada-03 § Geração).
       *
       * Vai pelo **mesmo canal** dos eventos do console, e não por um canal novo: o transporte
       * já existe, o preload já o entrega e o painel já filtra por `traceId`. Um segundo canal
       * para a mesma tela seria uma segunda coisa a manter, autorizar e testar.
       *
       * O `traceId` é derivado do projeto (`etapas:<projectId>`) em vez de sorteado: as etapas
       * atravessam várias chamadas ao modelo, e um id novo a cada anúncio faria a tela tratar
       * cada etapa como uma geração diferente. Derivado, ele é o mesmo do começo ao fim — e não
       * colide com os traces do console, que são UUID.
       *
       * `isDestroyed` pela mesma razão do console: a corrida entre a geração e o fechamento da
       * janela é normal, e um `send` para janela morta lança de dentro do Electron.
       */
      anunciarEtapa,
      montarContexto: montarContextoDoPrompt,
      estadoDasRotas: (projectId, workspace) =>
        estadoDasRotasDoProjeto(projectId, workspace, 'planejamento'),
      /*
       * As três chamadas passam pelo **ponto único** (`ai.call`), nunca pelo adapter direto — a
       * mesma fronteira do `BriefService`, e `provider` é a rota **já decidida**: deixar o
       * roteamento escolher de novo aqui poderia cair na rota paga que ninguém autorizou.
       */
      gerarTermo: async ({ projectId, workspace, rota, contextPackId, afirmacoesDoBrief }) => {
        const model = modeloDaGeracao('prd', rota, projectId, workspace)
        const texto = await coletarTexto(
          ai.call(
            {
              provider: rota,
              ...(model === undefined ? {} : { model }),
              system: SISTEMA_DO_TERMO,
              prompt: promptDoTermo(afirmacoesDoBrief),
              contextPackId,
              console: { projectId, etapa: 'prd' }
            },
            { userId: userIdAtual(), workspace }
          )
        )

        if (texto === undefined) return {}
        const termo = lerTermoDoModelo(texto)
        return termo === undefined ? {} : { termo }
      },
      gerarDocumentos: async ({ projectId, workspace, rota, contextPackId, ...entrada }) => {
        const model = modeloDaGeracao('prd', rota, projectId, workspace)
        const texto = await coletarTexto(
          ai.call(
            {
              provider: rota,
              ...(model === undefined ? {} : { model }),
              system: SISTEMA_DO_PRD,
              jsonSchema: SCHEMA_DAS_AFIRMACOES,
              prompt: promptDoPrd(entrada),
              contextPackId,
              console: { projectId, etapa: 'prd' }
            },
            { userId: userIdAtual(), workspace }
          )
        )

        if (texto === undefined) return {}
        const afirmacoes = lerDocumentosDoModelo(texto)
        return afirmacoes === undefined ? {} : { afirmacoes }
      },
      detectarContradicoes: async ({
        projectId,
        workspace,
        rota,
        contextPackId,
        afirmacoes,
        decisoes
      }) => {
        const model = modeloDaGeracao('prd', rota, projectId, workspace)
        const texto = await coletarTexto(
          ai.call(
            {
              provider: rota,
              ...(model === undefined ? {} : { model }),
              system: SISTEMA_DAS_CONTRADICOES,
              jsonSchema: SCHEMA_DAS_CONTRADICOES,
              prompt: promptDasContradicoes(afirmacoes, decisoes),
              contextPackId,
              console: { projectId, etapa: 'prd' }
            },
            { userId: userIdAtual(), workspace }
          )
        )

        if (texto === undefined) return {}
        const contradicoes = lerContradicoesDoModelo(texto)
        return contradicoes === undefined ? {} : { contradicoes }
      }
    })

    /*
     * A arquitetura, as decisões, os testes e a revisão gerados por IA (SPEC-Jornada-04).
     *
     * Substitui a composição da M8-F05: os quatro documentos são os mesmos, mas agora nascem do
     * PRD aceito e dos protótipos, com origem por afirmação e âncora no protótipo que desenhou
     * cada fluxo. O gate de anexos daquela fatia permanece **intacto e anterior** a tudo aqui.
     *
     * Recebe o `anexoRepository` — o mesmo do `AnexoService` — porque a revisão é gravada nas
     * **duas** tabelas: o conteúdo verificável em `project_architecture`, e os documentos
     * renderizados em `pacote_arquitetura`, que é onde o gate `PROJECT_PACKAGE` procura o que o
     * PI aprova (critério 5). Gravar só na tabela nova quebraria o gate do pacote.
     *
     * A validação dos protótipos vem do `AnexoService`, que continua dona dela: a leitura
     * semântica do modelo **acrescenta** e nunca substitui a validação determinística.
     */
    const arquitetura = new ArquiteturaService({
      anunciarEtapa,
      repository: new ArquiteturaRepository(storage.db),
      anexos: anexoRepository,
      projects: projectRepository,
      projectService: projects,
      audit: storage.audit,
      userId: userIdAtual,
      prdVigente: (projectId) => prd.carregar(projectId),
      /*
       * A revisão do PRD que a arquitetura cita (critério 3), lida de `pacote_estrutural` — a
       * mesma fonte que a M8-F05 usava. O `PrdService` grava nas duas tabelas com o mesmo hash,
       * então a revisão mais recente ali corresponde à que `prdVigente` devolve.
       */
      pacoteEstruturalId: (projectId) =>
        pacoteRepository.listarPacotes(userIdAtual(), projectId)[0]?.id,
      validarPrototipos: (projectId) => anexos.validar(projectId),
      decisoesDoRefinamento: (projectId) => refinamento.decisoesParaOBrief(projectId),
      montarContexto: montarContextoDoPrompt,
      estadoDasRotas: (projectId, workspace) =>
        estadoDasRotasDoProjeto(projectId, workspace, 'planejamento'),
      /*
       * As duas chamadas passam pelo **ponto único** (`ai.call`), nunca pelo adapter direto, e
       * `provider` é a rota **já decidida** — deixar o roteamento escolher de novo aqui poderia
       * cair na rota paga que ninguém autorizou.
       */
      gerarDocumentos: async ({ projectId, workspace, rota, contextPackId, ...entrada }) => {
        const model = modeloDaGeracao('arquitetura', rota, projectId, workspace)
        const texto = await coletarTexto(
          ai.call(
            {
              provider: rota,
              ...(model === undefined ? {} : { model }),
              system: SISTEMA_DA_ARQUITETURA,
              jsonSchema: SCHEMA_DAS_AFIRMACOES,
              prompt: promptDaArquitetura(entrada),
              contextPackId,
              console: { projectId, etapa: 'arquitetura' }
            },
            { userId: userIdAtual(), workspace }
          )
        )

        if (texto === undefined) return {}
        const afirmacoes = lerArquiteturaDoModelo(texto)
        return afirmacoes === undefined ? {} : { afirmacoes }
      },
      analisarCoerencia: async ({ workspace, rota, contextPackId, requisitos, jornadas }) => {
        const texto = await coletarTexto(
          ai.call(
            {
              provider: rota,
              system: SISTEMA_DA_COERENCIA,
              jsonSchema: SCHEMA_DOS_AJUSTES,
              prompt: promptDaCoerencia({ requisitos, jornadas }),
              contextPackId
            },
            { userId: userIdAtual(), workspace }
          )
        )

        if (texto === undefined) return {}
        const ajustes = lerAjustesDoModelo(texto)
        return ajustes === undefined ? {} : { ajustes }
      }
    })

    /*
     * O roadmap, os MVPs e a SPEC da primeira fatia por IA (SPEC-Jornada-05).
     *
     * Recebe o `roadmapRepository` — o mesmo do `RoadmapService` — porque a revisão é gravada nas
     * **duas** estruturas: o conteúdo verificável com as origens em `project_roadmap`, e a
     * projeção `mvp`/`slice` que o `STATUS.md` renderiza e o MVP-009 lê (critério 7). Gravar só
     * na tabela nova quebraria o índice Fatia ↔ SPEC.
     *
     * A arquitetura entra como leitura porque a origem `arquitetura` referencia as afirmações
     * dela: sem a lista de ids, todo MVP viraria `proposto` e a distinção que o critério 2
     * protege sumiria.
     */
    const roadmapGerado = new RoadmapGeradoService({
      repository: roadmapGeradoRepository,
      projecao: roadmapRepository,
      projects: projectRepository,
      projectService: projects,
      audit: storage.audit,
      userId: userIdAtual,
      anunciarEtapa,
      prdVigente: (projectId) => prd.carregar(projectId),
      pacoteEstruturalId: (projectId) =>
        pacoteRepository.listarPacotes(userIdAtual(), projectId)[0]?.id,
      arquiteturaVigente: (projectId) => arquitetura.carregar(projectId),
      montarContexto: montarContextoDoPrompt,
      estadoDasRotas: (projectId, workspace) =>
        estadoDasRotasDoProjeto(projectId, workspace, 'especificacao'),
      /*
       * As duas chamadas passam pelo **ponto único** (`ai.call`), nunca pelo adapter direto, e
       * `provider` é a rota **já decidida** — deixar o roteamento escolher de novo aqui poderia
       * cair na rota paga que ninguém autorizou.
       */
      gerarMvps: async ({ projectId, workspace, rota, contextPackId, ...entrada }) => {
        const model = modeloDaGeracao('roadmap', rota, projectId, workspace)
        const texto = await coletarTexto(
          ai.call(
            {
              provider: rota,
              ...(model === undefined ? {} : { model }),
              system: SISTEMA_DO_ROADMAP,
              jsonSchema: SCHEMA_DO_ROADMAP,
              prompt: promptDoRoadmap(entrada),
              contextPackId,
              console: { projectId, etapa: 'roadmap' }
            },
            { userId: userIdAtual(), workspace }
          )
        )

        if (texto === undefined) return {}
        const mvps = lerRoadmapDoModelo(texto)
        return mvps === undefined ? {} : { mvps }
      },
      gerarSpec: async ({
        projectId,
        workspace,
        rota,
        contextPackId,
        mvp,
        fatiaId,
        ...entrada
      }) => {
        const fatia = [...mvp.fatias].sort((a, b) => a.numero - b.numero)[0]
        if (fatia === undefined) return {}

        const model = modeloDaGeracao('spec-aceita', rota, projectId, workspace)
        const texto = await coletarTexto(
          ai.call(
            {
              provider: rota,
              ...(model === undefined ? {} : { model }),
              system: SISTEMA_DA_SPEC,
              jsonSchema: SCHEMA_DA_SPEC,
              prompt: promptDaSpec({
                mvp,
                fatia,
                outrasFatias: mvp.fatias.filter((f) => f.id !== fatiaId).map((f) => f.titulo),
                requisitos: entrada.requisitos,
                arquitetura: entrada.arquitetura,
                ...(entrada.correcao === undefined ? {} : { correcao: entrada.correcao })
              }),
              contextPackId,
              console: { projectId, etapa: 'spec-aceita' }
            },
            { userId: userIdAtual(), workspace }
          )
        )

        if (texto === undefined) return {}
        const spec = lerSpecDoModelo(texto, fatiaId)
        return spec === undefined ? {} : { spec }
      }
    })

    // Publicação no GitHub (SPEC-Entrega-01). Recebe o `ConnectorService`, **não** o
    // `GithubAdapter`: o gate de créditos, a policy e a auditoria vivem dentro do `call()`, e um
    // adapter injetado aqui seria o segundo caminho sem gate — o mesmo erro que o `GitRunner`
    // impede do lado do Git. O `token` é só para o push, que o terminal controlado não consegue
    // autenticar por ambiente; o conector resolve o dele por dentro.
    const publicacao = new PublicacaoService({
      projects: projectRepository,
      roadmap: roadmapRepository,
      refs: new ExternalRefRepository(storage.db),
      git: gitRunner,
      connectors,
      audit: storage.audit,
      userId: userIdAtual,
      token: async (userId, workspace) => await githubAuth.tokenParaUso({ userId, workspace })
    })

    // Fila, leases e reconciliação (SPEC-Entrega-02).
    //
    // O `mergeAutonomoLigado` é injetado como **função**, e não como o `MergePolicyService`
    // inteiro: a fila só precisa da resposta, e depender do serviço a acoplaria à auditoria da
    // mudança de política — que é outro assunto, com outro tipo de evento.
    const pipelineRepository = new PipelineRepository(storage.db)
    const leaseRepository = new LeaseRepository(storage.db)
    const mergePolicy = new MergePolicyService({
      repository: new MergePolicyRepository(storage.db),
      audit: storage.audit,
      userId: userIdAtual,
      identidade: () => auth?.usuarioAtual()?.id
    })
    const fila = new FilaService({
      runs: pipelineRepository,
      leases: leaseRepository,
      audit: storage.audit,
      roadmap: (escopo) => roadmapRepository.carregar(escopo),
      aprovacoes: (escopo) => roadmapRepository.listarAprovacoes(escopo),
      revisoesDoGate: (escopo) =>
        roadmap.revisoesDoGate(escopo.projectId, 'SLICE_ENTRY', escopo.workspaceId),
      userId: userIdAtual,
      mergeAutonomoLigado: (projectId) => mergePolicy.autonomoLigado(projectId)
    })
    // Sandbox do executor, proxy e preflight (SPEC-Entrega-03).
    //
    // O `TerminalEngine` do Docker é **outra instância**, com prazo maior: o do usuário tem 30 s,
    // e `docker run` de imagem ainda não baixada leva minutos. É a única diferença entre as
    // duas — a mesma política, a mesma auditoria, a mesma allowlist governam ambas.
    const terminalDocker = new TerminalEngine(
      policy,
      commandAllowlist,
      allowlist,
      runs,
      approvals,
      storage.audit,
      userIdAtual,
      TIMEOUT_DOCKER_MS
    )
    const docker = new DockerRunner(terminalDocker, () => workspaces.atual())

    // A prova e a limpeza de cada run (SPEC-Entrega-06). O mesmo repositório serve aos dois: o
    // ledger grava o desfecho, e a limpeza registra nele a pendência do que não pôde ser removido.
    const executionLedger = new ExecutionLedgerRepository(storage.db)

    /*
     * O coletor de retenção, **instanciado** (SPEC-Fases-03 § Persistência).
     *
     * Ele existia desde a M9-F06 e nunca fora construído em produção: era código testado que
     * nada chamava. A regra dos traces da geração precisa de um lugar para viver, e criar um
     * segundo coletor ao lado de um que já existe é o começo de dois lugares para agendar
     * limpeza. Então esta fatia liga o que estava ali.
     *
     * **Limite conhecido:** a expiração de **anexos** continua sem rodar. Ela precisa do
     * `caminhoDoAnexo`, e o layout do diretório de anexos nunca foi decidido — é escopo da
     * M9-F06, não desta fatia. O `caminhoDoAnexo` abaixo devolve caminho vazio de propósito:
     * `elegiveisParaExpirar` não encontra artefato algum enquanto nada os grava, então o laço
     * não roda; inventar um layout aqui criaria a decisão de produto por omissão que a spec
     * proíbe. Registrado no STATUS.md.
     */
    const retencao = new RetencaoService({
      ledger: executionLedger,
      caminhoDoAnexo: () => '',
      regras: [generationTraces.regraDeRetencao()]
    })

    // A entrega da fatia (SPEC-Entrega-05): construção, revisão, CI e squash merge no mesmo PR.
    //
    // O `ConstrutorService` ganha aqui o consumidor que a M9-F04 dizia faltar — era por não tê-lo
    // que instanciá-lo teria sido código morto. `revisar` devolve lista vazia por enquanto: o
    // revisor é o próprio executor em invocação separada no container, e a M9-F06 é quem o liga;
    // até lá nenhum achado bloqueia, e o gate segue barrando por CI e por regra da origem.
    const entrega = new EntregaService({
      construtor: new ConstrutorService(
        docker,
        pipelineRepository,
        storage.audit,
        userIdAtual,
        () => workspaces.atual()
      ),
      connectors,
      git: gitRunner,
      fila,
      mergePolicy,
      ruleset: new RulesetRepository(storage.db),
      ledger: executionLedger,
      limpeza: new LimpezaService({
        docker,
        git: gitRunner,
        leases: leaseRepository,
        ledger: executionLedger,
        workspaceId: () => workspaces.atual()
      }),
      budget: budgetRepository,
      audit: storage.audit,
      userId: userIdAtual,
      revisar: async () => [],
      token: async (userId, workspace) => await githubAuth.tokenParaUso({ userId, workspace })
    })

    // O proxy é o **único** caminho do container até o modelo (critério 11): o container recebe
    // só a URL, e a credencial da rota fica aqui. Sobe antes do preflight porque é ele que o
    // preflight pergunta se está no ar.
    const executorProxy = new ExecutorProxy({
      ai,
      userId: userIdAtual,
      workspaceId: () => workspaces.atual(),
      rota: () => 'claude-code',
      // O run corrente vem do `EntregaService` (M9-F05), que só é construído abaixo — o proxy
      // precisa subir antes porque é ele que o preflight pergunta se está no ar. A indireção por
      // função resolve o ciclo: quando o executor chama, o serviço já existe.
      //
      // **Não é só correlação de custo:** com `contextPackId` sempre `undefined`, o gate de
      // ContextPack em `call-provider.ts` recusava toda chamada do executor ("Esta geração
      // precisa de um contexto montado"), e a rota não operava em produção. Era a pendência que
      // a M9-F04 declarou e esta fatia fecha.
      contexto: () => {
        const run = entrega?.contextoDoRun()
        return run === undefined ? undefined : { runId: run.runId, tentativa: run.tentativa }
      },
      contextPackId: () => entrega?.contextoDoRun()?.contextPackId
    })
    await executorProxy.iniciar()

    const preflight = new PreflightService({
      git: gitRunner,
      docker,
      leases: leaseRepository,
      audit: storage.audit,
      userId: userIdAtual,
      workspaceId: () => workspaces.atual(),
      proxyNoAr: () => executorProxy.noAr(),
      // A derivação a partir da arquitetura aprovada é da M9-F04, que conhece o pacote do
      // projeto-alvo. Sem ela, a SPEC precisa trazer a seção — e o preflight recusa se não vier,
      // que é o critério 13 se comportando como projetado.
      derivarPaths: () => undefined,
      /*
       * O modelo da fase Construção deste run (SPEC-Fases-05, critérios 1 e 2).
       *
       * **Rota fixa em `assinatura`**, e não uma segunda chamada a `escolherRota`: o executor
       * roda com `rota: () => 'claude-code'` (ver o `ExecutorProxy` acima), então a rota da
       * Construção já está decidida pela composição do boot. Resolvê-la de novo aqui abriria a
       * possibilidade de o preflight congelar o par da rota paga enquanto o proxy chama pela
       * assinatura — as duas discordando sobre o mesmo run, que é o risco que a nota de
       * `modelo-da-fase.ts` registra sobre um segundo `escolherRota`.
       *
       * O `projectId` entra porque o override do projeto vence o workspace (critério 2); é o
       * `resolver` que aplica a herança.
       */
      modeloDaConstrucao: (projectId) =>
        phaseModels.resolver(
          { userId: userIdAtual(), workspace: workspaces.atual() },
          'construcao',
          'assinatura',
          projectId
        ),
      prepararGitMeta
    })

    const reconciliacao = new ReconciliacaoService({
      runs: pipelineRepository,
      leases: leaseRepository,
      audit: storage.audit,
      effectJournal,
      userId: userIdAtual,
      workspaceId: () => workspaces.atual(),
      // O ponto de extensão que a M9-F02 deixou pronto, agora preenchido: container e porta
      // passam a ser consultados antes de um lease expirado cair (critério 4).
      verificadores: [
        verificadorDeContainer(docker, () => app.getAppPath()),
        verificadorDePorta(docker, () => app.getAppPath())
      ]
    })

    // **`reconcileAll` é bloqueante** (decisão cravada da spec): nenhum trabalho novo é adquirido
    // antes de ela terminar. Sem isso, o app pegaria a próxima fatia com um lease órfão ainda de
    // pé — e o WIP=1 valeria para os runs que ele conhece, não para a máquina.
    await reconciliacao.reconcileAll()

    /*
     * A voz (SPEC-Voz-01), primeira entrega.
     *
     * O engine concreto — faster-whisper no sidecar Python — é a **segunda** entrega desta
     * fatia. Aqui ele é o engine ausente: `disponivel()` responde `false`, então a tela mostra
     * "runtime não instalado" com a ação de baixar, que é literalmente o estado da máquina de
     * quem abre o app hoje. Não é dublê de teste disfarçado de produção: é o comportamento
     * honesto enquanto o runtime não existe, e é o caminho do critério 4.
     */
    const voz = new VozService({
      engine: {
        transcribe: () => Promise.reject(new Error('O runtime de voz ainda não foi instalado.')),
        disponivel: async () => false,
        encerrar: async () => undefined
      },
      artefatosFaltando: () => ARTEFATOS_DA_VOZ.map((a) => a.id),
      computeAtual: () => 'cpu-int8'
    })

    registerIpcHandlers({
      voz,
      baixarArtefatoDeVoz: async (id) => {
        const artefato = ARTEFATOS_DA_VOZ.find((a) => a.id === id)
        if (artefato === undefined) {
          return { estado: 'falhou', motivo: 'Artefato desconhecido.' }
        }

        return baixarArtefato(artefato, {
          buscar: async (url) => Buffer.from(await (await fetch(url)).arrayBuffer()),
          gravar: async (destino, dados) => {
            const alvo = join(app.getPath('userData'), destino)
            await mkdir(dirname(alvo), { recursive: true })
            await writeFile(alvo, dados)
          },
          apagar: async (destino) => {
            await rm(join(app.getPath('userData'), destino), { force: true })
          },
          auditar: (evento) =>
            storage.audit.append({
              user_id: userIdAtual(),
              type: evento.type,
              payload: evento.payload
            }),
          // Fail closed: só as URLs pinadas no catálogo passam.
          permitido: (url) => ARTEFATOS_DA_VOZ.some((a) => a.url === url)
        })
      },
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
      roadmapGerado,
      marcos,
      jornada,
      /*
       * O card não tem projeto único: o estado das rotas é do ambiente, e uma medição serve a
       * lista inteira. `SEM_PROJETO` diz isso em vez de esconder um `''` no meio da chamada — e
       * a função o trata como "sem override", caindo na política do workspace.
       *
       * **`planejamento`** é a fase certa aqui: o card responde *"dá para começar?"*, e começar é
       * o Planejamento. Uma lista que perguntasse pela Construção mostraria bloqueio para
       * projetos que ainda nem chegaram lá (SPEC-Fases-06 § Dentro).
       */
      estadoDasRotas: (workspace) =>
        estadoDasRotasDoProjeto(SEM_PROJETO, workspace, 'planejamento'),
      brief,
      prd,
      arquitetura,
      refinamento,
      publicacao,
      mergePolicy,
      fila,
      preflight,
      executionLedger,
      credentials,
      ai,
      budget,
      routing,
      routingRepo,
      phaseModels,
      codex: codexProfile,
      generationTraces,
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

    /*
     * A coleta roda **uma vez, na abertura** (SPEC-Fases-03 § Persistência).
     *
     * Na abertura e não num intervalo: o app é local e de sessão longa, e um timer periódico
     * compactaria durante o uso — trabalho de disco competindo com a geração que o PI está
     * olhando. O que a retenção precisa é rodar de tempos em tempos, e "toda vez que o app
     * abre" é isso sem relógio nenhum a manter.
     *
     * Nunca derruba o boot: uma falha aqui é log, não tela de erro. Retenção que não rodou
     * custa disco; boot que não completou custa o app.
     */
    try {
      retencao.coletar(userIdAtual())
    } catch (erro) {
      log.sistema.warn('Coleta de retenção falhou na abertura', {
        motivo: erro instanceof Error ? erro.message : 'desconhecido'
      })
    }

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
/**
 * Consome um stream de geração e devolve o texto inteiro, ou `undefined` quando a chamada não
 * chegou ao fim.
 *
 * Existe porque as três chamadas da SPEC-Jornada-03 (termo, documentos, contradições) repetem o
 * mesmo laço, e a **distinção que ele preserva é a que importa**: "a chamada falhou" devolve
 * `undefined`, "veio texto que não parseia" devolve a string — e é sobre essa diferença que o
 * `PrdService` decide se vale gastar a rodada de correção.
 */
async function coletarTexto(stream: AsyncIterable<AiStreamEvent>): Promise<string | undefined> {
  let texto = ''

  for await (const evento of stream) {
    if (evento.tipo === 'chunk') {
      texto += evento.texto
      continue
    }

    if (evento.estado !== 'concluido') return undefined
  }

  return texto
}

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
