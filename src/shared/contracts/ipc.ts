/**
 * Contrato do IPC — a única fronteira entre renderer e main.
 *
 * Regra inviolável (docs/ARCHITECTURE.md § Fronteiras de segurança): o renderer nunca
 * executa comando, nunca lê segredo, nunca acessa Node. Todo canal exposto ao renderer
 * é nomeado aqui; não existe `invoke` genérico. Adicionar capacidade = adicionar um
 * canal nesta lista e um handler correspondente no main.
 */

import type {
  AccentColor,
  AuditEvent,
  AuditEventType,
  Locale,
  ResolvedTheme,
  ThemePreference,
  UserPreferences,
  WorkspaceId
} from '../domain/entities'
import type { AuthSnapshot } from './auth'
import type { LogInput } from './logging'
import type { PolicyContext, PolicyDecision } from '../policies/contracts'
import type {
  Automation,
  AutomationInput,
  Workflow,
  WorkflowInput,
  WorkflowStatus
} from '../domain/workflows'
import type { ExecutionRun } from '../domain/execution'
import type { CommandExecution, CommandSubmission } from '../domain/terminal'
import type { CredentialKey, CredentialStatusView } from '../domain/credentials'
import type { AiCallHandle, AiProvider, AiRequest, AiStreamEvent } from '../domain/ai'
import type { ApprovalDecision, ApprovalRequest } from '../domain/execution'
import type { BudgetLimitsInput, BudgetSnapshot } from '@shared/domain/budget'
import type { ProviderRoute, ProviderStatus, RoutingPolicy } from '@shared/domain/routing'
import type { Fase } from '@shared/domain/fase'
import type { Etapa } from '@shared/domain/jornada'
import type { EventoDaGeracao, GenerationEvent, GenerationTrace } from '@shared/domain/geracao'
import type {
  PhaseModelPolicy,
  ProjectModelOverride,
  RotaComModelo
} from '@shared/domain/modelo-da-fase'
import type { CodexBillingMode, CodexProfileState } from '@shared/domain/codex-profile'
import type {
  ConnectorCapability,
  ConnectorCredentialKey,
  ConnectorCredentialStatusView,
  ConnectorError,
  ConnectorId,
  ConnectorOutcome,
  ConnectorRequest
} from '../domain/connectors'
import type { ConnectorCreditPolicy } from '../domain/connector-governance'
import type { GithubAuthSnapshot, GithubDeviceFlowView } from '../domain/github-auth'
import type {
  MarcoDocumental,
  MarcoOutcome,
  PlanningSession,
  Project,
  ProjectOutcome
} from '../domain/projects'
import type {
  Decision,
  EstadoDoWizard,
  Resposta,
  RespostaOutcome,
  VistaDoWizard
} from '../domain/wizard'
import type { GeracaoDePerguntasOutcome } from '../domain/refinamento'
import type { PacoteEstrutural, PacoteOutcome } from '../domain/pacote-estrutural'
import type { Anexo, AnexoOutcome, TipoDeAnexo } from '../domain/anexos-de-design'
import type { ValidacaoDoPrototipo } from '../domain/validacao-de-prototipo'
import type { PacoteArquitetura } from '../domain/arquitetura'
import type { AlvoDaPublicacao, PublicacaoOutcome } from '../domain/publicacao'
import type { ExecutionLedger } from '../domain/execution-ledger'
import type { PendenciaDeLimpeza } from '../domain/limpeza'
import type { MergePolicyOutcome, PoliticaDeMerge, VistaDaFila } from '../domain/pipeline'
import type { Roadmap } from '../domain/roadmap'
import type { MvpGerado, RoadmapGeradoOutcome, RoadmapRegistrado } from '../domain/roadmap-gerado'
import type { EstadoDaJornada, TransicaoOutcome } from '../domain/jornada'
import type { ResumoDoProjeto } from '../domain/fase'
import type { BriefRegistrado, GeracaoOutcome, PromptDoProjeto } from '../domain/brief'
import type { PrdOutcome, PrdRegistrado } from '../domain/prd'
import type { ArquiteturaGeradaOutcome, ArquiteturaRegistrada } from '../domain/arquitetura-gerada'
import type { ResultadoDaRota } from '../domain/rota-de-geracao'
import type {
  Approval,
  AprovacaoOutcome,
  Gate,
  MudancaDeArtefato,
  RevisaoAprovada
} from '../domain/aprovacoes'
import type { VistaDeMarcos } from '../domain/marcos'
import type {
  ContextPack,
  ContextPackOutcome,
  ExcecaoDeLeituraAmpla,
  FalhaRegistrada,
  OrigemDeContexto
} from '../domain/context-pack'
import type { CapacidadeResolvida } from '../domain/skills'

/** Canais de request/response (renderer → main → renderer). */
import type { DesfechoDaTranscricao, DesfechoDoDownload, ProntidaoDaVoz } from '@shared/domain/voz'

export const IPC_CHANNELS = {
  /** Metadados do app (nome, versão, ambiente). Sem segredo, sem caminho de disco. */
  appInfo: 'app:info',
  /**
   * Auditoria do usuário corrente (SPEC-04, critério 6). O renderer **não** abre o
   * SQLite: pede por aqui e o main consulta. Só leitura — gravar auditoria é ato do
   * main, disparado por um fluxo real, nunca por pedido da UI.
   */
  auditList: 'audit:list',
  /** Recomputa a cadeia e devolve o veredito (ADR-004, camada 3). */
  auditVerify: 'audit:verify',
  /** Espaço ativo. Ao abrir é sempre JARVIS OS (decisão do PI na SPEC-02). */
  workspaceGet: 'workspace:get',
  /** Troca o espaço ativo; o main audita e loga a transição. */
  workspaceSwitch: 'workspace:switch',
  /** Preferências do usuário corrente + o tema já resolvido (SPEC-05). */
  preferencesGet: 'preferences:get',
  /** Grava idioma e/ou tema. Ação de baixo risco: **não** gera AuditEvent (SPEC-05). */
  preferencesSave: 'preferences:save',
  /** Estado corrente da autenticação. Nunca devolve token (SPEC-03, critério 4). */
  authGet: 'auth:get',
  /**
   * Inicia o login Google. O fluxo abre no **navegador do sistema** e retorna por um
   * servidor loopback local (decisão do PI na SPEC-03) — nunca em webview do Electron,
   * onde o app enxergaria as credenciais digitadas pelo usuário.
   */
  authLogin: 'auth:login',
  /** Revoga a sessão, apaga os tokens e volta para `deslogado` (critério 3). */
  authLogout: 'auth:logout',
  /**
   * Classifica uma ação pelo Policy Engine e devolve a `PolicyDecision` (SPEC-Execucao-02,
   * critério 7). O `evaluate` roda no **main** — o renderer nunca avalia política, só lê o
   * resultado. Modo report: a decisão é auditada, mas nada é barrado nesta fatia.
   */
  policyClassify: 'policy:classify',
  /**
   * Allowlist de diretórios permitidos (SPEC-Execucao-03, critério 5). O renderer **não**
   * lê/edita FS nem a allowlist direto — vê e edita via estes canais; a checagem e a
   * persistência vivem no main. `add`/`remove` auditam (ADR-004).
   */
  allowlistList: 'allowlist:list',
  allowlistAdd: 'allowlist:add',
  allowlistRemove: 'allowlist:remove',
  /**
   * Seletor nativo de pasta (SPEC-ExecucaoReal-03, decisão 2 do PI). O diálogo abre no
   * **main** — o renderer nunca toca o filesystem, nem para escolher um caminho. Escolha
   * confirmada entra na allowlist já canonizada; cancelar não altera nada e não audita.
   */
  allowlistPick: 'allowlist:pick',
  /**
   * O diretório gerido pelo app (`userData`), canônico. Só-leitura: a UI precisa saber
   * **qual** dos paths de `allowlist:list` é o default de fábrica para apresentá-lo como
   * fixo (SPEC-ExecucaoReal-03, critério 4) — o repositório já recusa removê-lo, e sem
   * este canal a tela teria de inferir a identidade dele por posição na lista.
   */
  allowlistAppDir: 'allowlist:app-dir',
  /**
   * Registro de workflows e automações (SPEC-Execucao-04, critério 7). CRUD de **definições**
   * — nada executa. O renderer nunca toca o storage: vê e edita por aqui, e criar/alterar/
   * toggle é classificado (F02) + auditado no main.
   */
  workflowList: 'workflow:list',
  workflowCreate: 'workflow:create',
  workflowUpdate: 'workflow:update',
  workflowSetStatus: 'workflow:set-status',
  workflowRemove: 'workflow:remove',
  automationList: 'automation:list',
  automationCreate: 'automation:create',
  automationSetEnabled: 'automation:set-enabled',
  automationRemove: 'automation:remove',
  /**
   * Execução simulada (SPEC-Execucao-05, critério 7). O renderer **dispara** o run por
   * gatilho manual e lê o `ExecutionRun`/trace; o motor roda no **main**. Zero efeito
   * colateral — nada toca FS, rede, terminal ou provider.
   */
  executionRun: 'execution:run',
  executionRunReal: 'execution:run-real',
  executionList: 'execution:list',
  /*
   * Voz (SPEC-Voz-01). Três canais e nada mais: transcrever um enunciado, perguntar se o
   * runtime está pronto, e mandar baixar o que falta.
   *
   * Nenhum deles carrega processo, caminho de modelo ou comando (critério 3) — com isso na
   * mão, a tela deixaria de falar com uma capacidade e passaria a falar com uma implementação.
   */
  vozTranscrever: 'voz:transcrever',
  vozProntidao: 'voz:prontidao',
  vozBaixarArtefato: 'voz:baixar-artefato',
  approvalList: 'approval:list',
  approvalResolve: 'approval:resolve',
  /**
   * Terminal controlado (SPEC-ExecucaoReal-02). O renderer **submete** binário + argumentos +
   * cwd e lê o resultado; quem executa o processo é o main. O renderer nunca toca
   * `child_process` (ARCHITECTURE § Fronteiras 1) — nem indiretamente: não há canal que aceite
   * uma linha de comando a ser interpretada por shell.
   *
   * A allowlist de **comandos** é conceito novo desta fatia e vive separada da de diretórios:
   * um comando precisa das duas (binário permitido **e** cwd permitido).
   */
  terminalRun: 'terminal:run',
  commandAllowlistList: 'command-allowlist:list',
  commandAllowlistAdd: 'command-allowlist:add',
  commandAllowlistRemove: 'command-allowlist:remove',
  /**
   * Vault de credenciais (SPEC-Providers-01, critério 8). **Nenhum destes canais devolve o
   * valor de uma credencial** — nem existe canal que o peça. O renderer vê `status`, `source`
   * e o nome do provider; o segredo só é decifrado no main, no instante da chamada ao
   * provider (F02).
   *
   * `set` recebe o valor **de ida** (é o usuário digitando a própria chave no Settings), e a
   * assimetria é o desenho: entra e nunca volta. O retorno dos três canais é a lista de
   * status atualizada, para a UI refletir sem novo round-trip.
   */
  credentialList: 'credential:list',
  credentialSet: 'credential:set',
  credentialRemove: 'credential:remove',
  /**
   * Dispara uma chamada de IA (SPEC-Providers-02, critério 8). Devolve só o `AiCallHandle` —
   * o texto chega pelo canal de evento `aiStreamEvent`, casado pelo `id`. O renderer **nunca**
   * vê a credencial: quem a lê do Vault é o ponto único de chamada, no main.
   */
  aiCall: 'ai:call',
  /** Aborta uma chamada em andamento (o usuário fechou a tela ou desistiu). */
  aiCancel: 'ai:cancel',
  /**
   * Orçamento de IA (SPEC-Providers-03, critério 8). O renderer **lê** limites e acumulado e
   * **edita** limites; a decisão do gate e a soma do período são do main. Não há canal que
   * peça "esta chamada cabe?" — quem pergunta é o ponto único, de dentro do main, e um canal
   * assim ofereceria ao renderer uma resposta que ele não usa para nada além de duplicar a
   * decisão que já foi tomada.
   */
  budgetGet: 'budget:get',
  budgetSetLimits: 'budget:set-limits',
  /**
   * Providers e roteamento (SPEC-Providers-04, critérios 5 e 8). O renderer **lê** status e
   * rotas, e **edita** rotas e modelo ativo; quem escolhe o provider de uma chamada é o ponto
   * único, no main. Não há canal que peça a seleção: o renderer não decide quem atende.
   */
  providerStatus: 'provider:status',
  providerModels: 'provider:models',
  providerSetModel: 'provider:set-model',
  /*
   * O perfil isolado do Codex (SPEC-Multi-Executor-02).
   *
   * **Quatro canais, e nenhum deles transporta segredo** — não por disciplina, por construção:
   * quem autentica é o PI, direto no CLI, e o que atravessa aqui é estado (`codex:estado`), um
   * gatilho sem payload (`codex:login`, `codex:logout`) e uma decisão de cobrança
   * (`codex:set-modo`). Não existe canal que aceite token, chave ou senha, porque não existe
   * momento em que o app os tenha (critério 1).
   */
  codexEstado: 'codex:estado',
  codexLogin: 'codex:login',
  codexLogout: 'codex:logout',
  codexSetModo: 'codex:set-modo',
  routingGet: 'routing:get',
  routingSetRoute: 'routing:set-route',
  /**
   * Modelo por fase (SPEC-Fases-02). O renderer le a politica e os overrides, e **edita** os
   * dois; quem resolve a heranca numa geracao e o `PhaseModelService`, no main. Nao ha canal
   * que peca a resolucao: o renderer nao decide qual modelo gera.
   */
  phaseModelGet: 'phase-model:get',
  phaseModelSet: 'phase-model:set',
  phaseModelOverrides: 'phase-model:overrides',
  phaseModelSetOverride: 'phase-model:set-override',
  phaseModelClearOverride: 'phase-model:clear-override',
  /**
   * Console da geração (SPEC-Fases-03 § Superfície). **Só leitura**: o renderer lista as
   * gerações de uma etapa e abre uma delas. Não há canal que escreva evento — quem grava é o
   * ponto único, do lado do main, e um canal de escrita aqui deixaria a tela inventar trilha.
   */
  generationHistory: 'geracao:historico',
  generationEvents: 'geracao:eventos',
  /**
   * Conectores externos (SPEC-Conectores-01, critérios 5 e 6). **Dois canais nomeados, e
   * nenhum genérico**: `connectors:capabilities` lista o que os adapters registrados declaram
   * saber fazer, e `connectors:invoke` executa **uma** dessas operações. Não existe canal que
   * receba endereço — um `connectors:fetch(url)` seria o proxy HTTP genérico que o critério 6
   * proíbe, e a diferença é exatamente esta: o renderer escolhe uma operação de uma lista
   * fechada, nunca um destino de rede.
   */
  connectorsCapabilities: 'connectors:capabilities',
  connectorsInvoke: 'connectors:invoke',
  /**
   * Teto de créditos por conector (SPEC-Conectores-02, critério 8). Leitura e edição — o teto é
   * ajustável, com padrão conservador (spec § decisões cravadas).
   *
   * **Não existe canal que pergunte "esta chamada cabe?"**: a decisão do gate é do main, dentro
   * do ponto único, e um canal aqui daria ao renderer uma resposta que ele só poderia duplicar.
   * Mesma ausência deliberada do gate de orçamento do MVP-005.
   */
  connectorCreditsGet: 'connectors:credits-get',
  connectorCreditsSetLimits: 'connectors:credits-set-limits',
  /**
   * Credenciais de **conector** (SPEC-Conectores-05, critério 7). Trio irmão do de credenciais
   * de IA, e separado dele pela mesma razão que as taxonomias são separadas: cada tela varre a
   * própria lista, e um canal comum obrigaria as duas a filtrar a do outro.
   *
   * A garantia é idêntica e vale reafirmar: **nenhum destes canais devolve o valor**. `set`
   * recebe a chave de ida — é o usuário colando a própria credencial — e ela nunca volta; o
   * retorno dos três é a lista de status, cujo tipo não tem campo onde o segredo caiba.
   */
  connectorCredentialList: 'connectors:credential-list',
  connectorCredentialSet: 'connectors:credential-set',
  connectorCredentialRemove: 'connectors:credential-remove',
  /**
   * Autenticação do GitHub por Device Flow (SPEC-Conectores-03, critério 9).
   *
   * Quatro canais e nenhum que devolva token — a garantia do critério 2 é a **forma dos tipos**:
   * `GithubAuthSnapshot` e `GithubDeviceFlowView` não têm campo onde access ou refresh token
   * caiba, do mesmo jeito que `CredentialStatusView` não tem (M5-F01). Um canal
   * `github:token` não existe, e é por isso que o renderer não o recebe nem por engano.
   *
   * `start` e `await` são separados porque a tela precisa mostrar o código **antes** de a espera
   * começar: um canal único só responderia quando o usuário já tivesse autorizado — e ele nunca
   * saberia o que digitar. `cancel` existe porque o critério 3 exige que o polling termine por
   * vontade do usuário, não só por prazo.
   *
   * O `client_id` **override** entra em `github:set-client-id` e não no vault: ele não é segredo
   * (é público por desenho no Device Flow) e guardá-lo cifrado o faria aparecer na tela de
   * credenciais como se fosse — anunciando um segredo que não existe.
   */
  githubAuthStatus: 'github:auth-status',
  githubAuthStart: 'github:auth-start',
  githubAuthAwait: 'github:auth-await',
  githubAuthCancel: 'github:auth-cancel',
  githubAuthLogout: 'github:auth-logout',
  githubSetClientId: 'github:set-client-id',
  /**
   * Projeto local e planejamento (SPEC-Planejamento-01, critério 8).
   *
   * **Nenhum canal de Git.** A UI não pede `git init` nem `git commit`: ela cria um projeto ou
   * conclui um marco, e o Git é consequência disso no main, pelo terminal controlado. Um canal
   * `project:git-run` seria o segundo caminho de escrita de repositório que a decisão 2 do PI
   * proíbe — e a diferença é exatamente esta: o renderer escolhe um **marco** de uma lista
   * fechada, nunca um comando.
   *
   * `create` e `import` são separados porque as garantias diferem: criar escreve estrutura
   * documental nova; importar promete **não escrever nada** no conteúdo existente. Um canal só
   * com um booleano faria a promessa depender de um parâmetro que a tela poderia errar.
   *
   * `save-answers` é o autosave do wizard: grava no SQLite e **não** commita. É o canal mais
   * chamado da fatia — um por mudança de resposta —, e é por isso que ele não audita nem toca
   * o Git (spec § Regras).
   */
  projectList: 'project:list',
  projectCreate: 'project:create',
  projectImport: 'project:import',
  projectPickDirectory: 'project:pick-directory',
  projectRename: 'project:rename',
  /**
   * Desregistra o projeto. **Não apaga nada do disco** (decisão do PI, 2026-08-29) — e é por
   * isso que o canal não passa pelo fluxo de aprovação: não há efeito destrutivo a aprovar.
   * Um canal que apagasse arquivos seria outro canal, com o gate humano junto.
   */
  projectRemove: 'project:remove',
  projectSession: 'project:session',
  projectSaveAnswers: 'project:save-answers',
  projectCompleteMilestone: 'project:complete-milestone',
  /**
   * O wizard orientado (SPEC-Planejamento-03).
   *
   * **Dois canais, e não um `wizard:next` que devolvesse a pergunta já respondida.** `state` lê
   * (pergunta pendente, histórico) e `answer` escreve — a mesma divisão de `project:session` e
   * `project:save-answers`. Um canal único faria a leitura carregar o efeito colateral de
   * avançar, e a retomada do critério 6 depende justamente de poder **ler sem avançar**.
   *
   * **Não existe canal que aprove gate.** Decisão do wizard registra escolha; aprovar pacote,
   * MVP ou fatia é gate do MVP-008 § Gates, e a invariante 3 do CONVENTION §4 proíbe que a
   * delegação chegue lá. Um `wizard:approve` seria o caminho por onde "Decide por mim"
   * aprovaria o que não pode.
   */
  wizardState: 'wizard:state',
  wizardAnswer: 'wizard:answer',
  /**
   * O pacote estrutural — PRD, Landscape e Convention (SPEC-Planejamento-04).
   *
   * **Nenhum canal que receba texto de documento.** A tela pede a geração e mostra o que voltou;
   * o conteúdo é composto no main a partir das decisões e das evidências. Um canal que aceitasse
   * o conteúdo pronto seria o caminho por onde uma afirmação sem origem entraria — exatamente o
   * que os critérios 1 e 5 existem para impedir.
   *
   * `consulta` é o único texto que atravessa, e é termo de pesquisa, não conteúdo.
   */
  pacoteGerar: 'pacote:gerar',
  pacoteListar: 'pacote:listar',
  /**
   * Anexos de design e arquitetura (SPEC-Planejamento-05).
   *
   * **`anexoEscolher` abre o seletor nativo e não anexa nada.** A separação é deliberada:
   * escolher é tocar o filesystem (mesma razão do `allowlist:pick` e do `project:pick`), e
   * anexar é o ato que conta para o gate — hasheado, auditado, com instante. Um canal só faria
   * "o PI abriu o seletor e desistiu" ser indistinguível de "o PI anexou".
   *
   * **Nenhum canal recebe conteúdo de arquivo.** O renderer manda o *caminho* que o seletor
   * devolveu; quem lê, copia e hasheia é o main. Um canal que aceitasse bytes seria um
   * gravador de disco arbitrário no renderer — a mesma fronteira que os canais do pacote
   * respeitam ao não aceitar texto de documento.
   */
  /**
   * Roadmap e gates de aprovação (SPEC-Planejamento-06).
   *
   * **`roadmap:gerar` e `aprovacao:aprovar` são canais distintos, e a separação é a fatia.**
   * Gerar compõe e propõe; aprovar aceita. Um canal só faria a geração aprovar o que ela mesma
   * propôs — exatamente o que os critérios 3 e 7 impedem.
   *
   * **Nenhum canal recebe conteúdo de documento nem `autor`.** O renderer pede o ato e mostra o
   * que voltou; a identidade de quem aprova vem da sessão no main, nunca do renderer — que
   * poderia mandar qualquer uma.
   */
  roadmapCarregar: 'roadmap:carregar',
  /**
   * O roadmap gerado por IA (SPEC-Jornada-05).
   *
   * **Quatro canais, e a separação entre eles é a fatia.** `gerar-por-ia` propõe os MVPs;
   * `escolher-mvp` registra a escolha do PI no `MVP_ENTRY` e produz a SPEC da primeira fatia;
   * `responder-pergunta` recolhe as decisões que a SPEC deixou abertas; `carregar-gerado` lê. Um
   * canal só faria a geração escolher o que ela mesma propôs — exatamente o que os critérios 3
   * e 4 impedem.
   *
   * **Nenhum canal recebe conteúdo de roadmap, de MVP ou de SPEC.** O renderer manda o *ato* e o
   * *id*; quem produz e valida é o main. Um canal que aceitasse os MVPs prontos seria o caminho
   * por onde um MVP sem origem entraria.
   */
  roadmapGerarPorIa: 'roadmap:gerar-por-ia',
  roadmapCarregarGerado: 'roadmap:carregar-gerado',
  roadmapEscolherMvp: 'roadmap:escolher-mvp',
  roadmapResponderPergunta: 'roadmap:responder-pergunta',
  roadmapElegiveis: 'roadmap:elegiveis',
  aprovacaoListar: 'aprovacao:listar',
  aprovacaoRevisoes: 'aprovacao:revisoes',
  aprovacaoAprovar: 'aprovacao:aprovar',
  aprovacaoSimular: 'aprovacao:simular',
  /**
   * O painel de marcos (SPEC-Fases-04). **Só leitura.**
   *
   * Não existe `marcos:commitar`: o botão "Commitar marco" do painel chama
   * `projectCompleteMilestone`, que é a retomada da M8-F01. Um canal próprio de commit seria o
   * segundo caminho de escrita no Git que a M9-F01 cravou não existir — e o teste do critério 3
   * é literalmente a ausência deste canal.
   */
  marcosVista: 'marcos:vista',
  /**
   * A jornada de planejamento (SPEC-Jornada-01).
   *
   * **Não existe canal que receba uma etapa.** É o critério 1 na forma de contrato: a etapa só
   * se move por evento nomeado, e um `jornada:definir-etapa` seria exatamente a via de edição
   * direta que a spec proíbe. O renderer diz *o que aconteceu*, nunca *onde o projeto está* —
   * decidir isso é do main, que tem os fatos.
   *
   * `estado` lê e `evento` escreve, a mesma divisão de `project:session` e
   * `project:save-answers`. Ler recalcula a etapa a partir das aprovações e dos marcos, mas
   * isso é correção de cache, não avanço: a leitura nunca move a jornada para frente.
   */
  jornadaEstado: 'jornada:estado',
  jornadaEstadoDeVarios: 'jornada:estado-de-varios',
  /**
   * O resumo do card de cada projeto (SPEC-Fases-01, critério 7).
   *
   * Canal próprio, e não um campo a mais em `jornada:estado-de-varios`, porque compõe fatos que
   * aquele não toca: rota e modelo dependem dos adapters de provider. Quem só quer a etapa não
   * deve pagar essa leitura.
   */
  jornadaResumoDeVarios: 'jornada:resumo-de-varios',
  jornadaEvento: 'jornada:evento',
  /**
   * O prompt e o brief refinado (SPEC-Jornada-02).
   *
   * **`brief:rota` existe para a tela poder mostrar o bloqueio antes do clique.** Sem ele, o PI
   * só descobriria que não há rota autorizada depois de pedir a geração — a mesma fricção que o
   * critério 6 evita do lado do custo, repetida do lado da atenção.
   *
   * **Nenhum canal recebe afirmação nem texto de brief.** A tela pede a geração e mostra o que
   * voltou; o conteúdo é produzido no main, validado lá, e só então gravado. Um canal que
   * aceitasse o brief pronto seria o caminho por onde uma afirmação sem origem entraria — o que
   * os critérios 3 e 4 existem para impedir. É a mesma postura dos canais do pacote na M8-F04.
   *
   * `brief:cortar-proposto` recebe **um id**, não a lista do que sobra: mandar a lista faria o
   * renderer decidir o conteúdo final, e um erro dele apagaria afirmação que veio do PI.
   */
  briefSalvarPrompt: 'brief:salvar-prompt',
  briefLerPrompt: 'brief:ler-prompt',
  briefGerar: 'brief:gerar',
  briefCarregar: 'brief:carregar',
  briefRota: 'brief:rota',
  briefCortarProposto: 'brief:cortar-proposto',
  /**
   * O PRD, o Landscape e a Convention gerados (SPEC-Jornada-03).
   *
   * **`prd:propor-termo` e `prd:gerar` são canais separados, e a separação é o critério 3.** O
   * termo é proposto pela IA, exibido e editado pelo PI, e só então confirmado — a pesquisa não
   * roda sem confirmação. Um canal só, que propusesse e buscasse na mesma chamada, faria a
   * chamada à Tavily acontecer antes de o PI ver o que seria buscado.
   *
   * **Nenhum canal recebe afirmação nem texto de documento**, mesma postura dos canais do brief:
   * a tela pede o ato, e o conteúdo é produzido e validado no main. Um canal que aceitasse o PRD
   * pronto seria o caminho por onde uma afirmação sem origem entraria.
   */
  prdProporTermo: 'prd:propor-termo',
  prdGerar: 'prd:gerar',
  prdCarregar: 'prd:carregar',
  prdCortarProposto: 'prd:cortar-proposto',
  arquiteturaGerarPorIa: 'arquitetura:gerar-por-ia',
  arquiteturaCarregar: 'arquitetura:carregar',
  arquiteturaCortarProposto: 'arquitetura:cortar-proposto',
  arquiteturaDescartarAjuste: 'arquitetura:descartar-ajuste',
  /**
   * O refinamento por perguntas geradas (SPEC-Jornada-02, § Refinamento).
   *
   * **`refinamento:responder` não recebe a pergunta, só o id dela.** A pergunta vive no banco
   * desde que foi gerada; aceitar o enunciado de volta deixaria o renderer reescrever o que o
   * PI leu — e a decisão gravada citaria uma pergunta que talvez nunca tenha sido feita.
   *
   * `gerar` e `estado` são canais distintos pela mesma razão que `project:session` e
   * `project:save-answers` são: ler não pode ter o efeito colateral de gerar. Reabrir a tela
   * chama `estado`, e uma geração por abertura custaria uma chamada de modelo a cada F5.
   */
  refinamentoGerar: 'refinamento:gerar',
  refinamentoEstado: 'refinamento:estado',
  refinamentoResponder: 'refinamento:responder',
  refinamentoHistorico: 'refinamento:historico',
  /**
   * SPEC-Entrega-01: publica o repositório e o backlog aprovado no GitHub.
   *
   * **O renderer não manda credencial nem escolhe o que publicar.** Ele pede o ato e informa o
   * alvo; o que sai é o que o PI já aprovou para a fila, lido no main. Um canal que aceitasse a
   * lista de issues deixaria o renderer publicar trabalho que ninguém liberou — e "nenhuma issue
   * futura equivale a autorização de construção" é regra da spec.
   */
  publicacaoPublicar: 'publicacao:publicar',
  /**
   * SPEC-Entrega-02: lê e muda o kill-switch do merge autônomo do projeto.
   *
   * **Só estes dois canais**, e nenhum que transicione run ou adquira slot: quem move a pipeline
   * é o main, a partir do que o PI aprovou no gate. Um canal `transicionar` deixaria o renderer
   * declarar que uma fatia chegou a `MERGED` — o pulo que o critério 5 existe para impedir.
   */
  mergePolicyLer: 'merge-policy:ler',
  mergePolicyDefinir: 'merge-policy:definir',
  /** SPEC-Entrega-02: o estado da fila — runs ativos, concluídas e o que está travado. */
  filaVista: 'fila:vista',
  /**
   * O estado do sandbox do executor (SPEC-Entrega-03). **Só leitura**, como os canais da
   * M9-F02: nada aqui prepara nem derruba container — quem prepara é o preflight, chamado pela
   * pipeline, nunca pelo renderer.
   */
  sandboxEstado: 'sandbox:estado',
  /**
   * A prova de um run encerrado e as pendências de limpeza (SPEC-Entrega-06).
   *
   * **Só leitura, como os canais da M9-F02/F03.** Não existe canal que encerre run, dispare
   * limpeza ou registre aceite: a spec é explícita em que o painel *"não mostra commit/push/PR/
   * merge como botões do PI e não pede aceite final"*, e a forma de garantir isso é não oferecer
   * o canal. O aceite continua sendo ato do PI no board, fora do app.
   */
  ledgerDoRun: 'ledger:do-run',
  limpezaPendencias: 'limpeza:pendencias',
  anexoEscolher: 'anexo:escolher',
  anexoAnexar: 'anexo:anexar',
  anexoListar: 'anexo:listar',
  anexoRemover: 'anexo:remover',
  anexoValidar: 'anexo:validar',
  arquiteturaListar: 'arquitetura:listar',
  /**
   * Contexto, skills e orçamento (SPEC-Planejamento-02).
   *
   * **Nenhum canal que leia arquivo.** A tela não pede "leia `src/foo.ts`": ela indica
   * candidatos por caminho relativo, e quem lê é o main, dentro do diretório do projeto. Um
   * canal `context:read-file` seria um leitor de disco arbitrário no renderer — a mesma
   * fronteira que a tela de Projetos respeita ao não ter canal de Git.
   *
   * `context:build` é o gate: ele devolve o manifesto **ou a recusa**, e é o `packId` dele que
   * a chamada de IA precisa declarar. Não existe canal que gere sem passar por aqui.
   */
  contextBuild: 'context:build',
  contextList: 'context:list',
  contextCapabilities: 'context:capabilities',
  contextFailures: 'context:failures',
  contextResolveFailure: 'context:resolve-failure'
} as const

/**
 * Canais só de ida (renderer → main), sem resposta.
 *
 * Separados dos de request/response porque o main os registra com `ipcMain.on`, não
 * `ipcMain.handle` — e porque o teste que prova "um handler por canal do contrato" precisa
 * distinguir os dois grupos para não acusar falso positivo.
 */
export const IPC_SEND_CHANNELS = {
  /**
   * Registro de log vindo do renderer. O renderer nunca escreve em disco (ADR-005): ele
   * captura e encaminha; quem grava é o winston do main, escritor único.
   */
  log: 'log:record',
  /** Minimiza para o tray. Ação de janela vive no main; o renderer só pede (SPEC-02). */
  windowMinimizeToTray: 'window:minimizar-tray'
} as const

/**
 * Canais de push (main → renderer). O renderer assina; não pede.
 *
 * Existe porque o login não é request/response: o usuário sai para o navegador e volta
 * minutos depois, e a sessão pode expirar sozinha durante o uso. Sem push, a UI teria de
 * ficar consultando `auth:get` em intervalo — polling que gasta e ainda chega atrasado.
 */
export const IPC_EVENT_CHANNELS = {
  /** Novo `AuthSnapshot` a cada transição de estado. Nunca carrega token. */
  authChanged: 'auth:changed',
  /**
   * Um evento por chunk de uma chamada de IA, mais o `fim` (SPEC-Providers-02, critério 2).
   *
   * Canal de **evento** e não retorno do `invoke`: o ponto do streaming é o texto aparecer
   * enquanto chega. Um `invoke` que resolvesse com a resposta inteira entregaria o mesmo
   * conteúdo depois de o usuário ter esperado por ele em silêncio.
   */
  aiStreamEvent: 'ai:stream-event',
  /**
   * Um evento do **console da geração** (SPEC-Fases-03 § Superfície).
   *
   * Canal único com `traceId` no payload, e não um canal por geração: `IpcEventChannel` é uma
   * união fechada de literais, e um nome montado em runtime (`geracao:trace:<id>`) sairia do
   * tipo e do teste de contrato que exige um handler por canal declarado. A "assinatura por
   * `traceId`" que a spec pede é o `onGenerationEvent(traceId, …)` do preload, que filtra —
   * mesmo padrão já provado pelo `aiStreamEvent`.
   *
   * Separado do `aiStreamEvent` porque o conteúdo é outro: lá vai o texto que vira o documento,
   * aqui vão as ferramentas e o uso. Um canal só obrigaria cada consumidor a filtrar o que não
   * lhe diz respeito.
   */
  generationEvent: 'geracao:evento'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

export type IpcSendChannel = (typeof IPC_SEND_CHANNELS)[keyof typeof IPC_SEND_CHANNELS]

export type IpcEventChannel = (typeof IPC_EVENT_CHANNELS)[keyof typeof IPC_EVENT_CHANNELS]

/** Informação pública do app exposta ao renderer. */
export interface AppInfo {
  readonly name: string
  readonly version: string
  readonly electronVersion: string
  /** `development` ou `production` — nunca variáveis de ambiente cruas. */
  readonly environment: 'development' | 'production'
}

/**
 * Veredito da verificação da cadeia de auditoria, na forma que o renderer vê.
 *
 * Espelha o `ChainVerification` do main sem importá-lo: aquele módulo usa `node:crypto`
 * e não pode ser compilado para o renderer. Duplicar a *forma* aqui é o preço de manter
 * a fronteira; o teste de contrato prova que as duas não divergem.
 */
export type AuditVerification =
  | { readonly ok: true; readonly checked: number }
  | {
      readonly ok: false
      readonly checked: number
      readonly brokenAt: number
      readonly reason: 'hash-invalido' | 'prev-hash-nao-encadeia' | 'seq-fora-de-ordem'
      readonly detail: string
    }

/** Resultado de uma troca de espaço, já auditada pelo main. */
export interface WorkspaceSwitchResult {
  readonly workspace: WorkspaceId
  /** `seq` do `AuditEvent` gerado — deixa a UI provar que a troca foi registrada. */
  readonly auditSeq: number
}

/**
 * Preferências do usuário, com o tema **já resolvido** pelo main.
 *
 * `theme` é a preferência (`claro`/`escuro`/`sistema`); `resolvedTheme` é o que pintar
 * agora. A resolução acontece no main porque é ele quem enxerga o `nativeTheme` do SO —
 * o renderer não deve consultar o sistema por conta própria.
 *
 * `accentNoa`/`accentJarvis` vêm **já resolvidos**: nunca `null` aqui. Onde o `UserProfile` guarda
 * `null` ("não escolheu"), o main aplica o `ACENTO_PADRAO` do DS antes de mandar — o renderer
 * recebe sempre uma cor pintável, sem precisar conhecer o valor de fábrica.
 */
export interface PreferencesSnapshot {
  readonly locale: Locale
  readonly theme: ThemePreference
  readonly resolvedTheme: ResolvedTheme
  readonly accentNoa: AccentColor
  readonly accentJarvis: AccentColor
}

/**
 * A ponte exposta em `window.jarvis`. É o contrato completo: o que não está aqui,
 * o renderer não alcança.
 */
export interface JarvisBridge {
  getAppInfo(): Promise<AppInfo>
  /** Encaminha um registro de log ao main, que grava. Não devolve nada de propósito. */
  sendLog(record: LogInput): void
  /** Auditoria do usuário corrente. Leitura apenas — a UI nunca grava evento. */
  listAuditEvents(type?: AuditEventType): Promise<readonly AuditEvent[]>
  verifyAuditChain(): Promise<AuditVerification>
  getWorkspace(): Promise<WorkspaceId>
  switchWorkspace(workspace: WorkspaceId): Promise<WorkspaceSwitchResult>
  getPreferences(): Promise<PreferencesSnapshot>
  /** Grava e devolve o estado resultante, já com o tema resolvido. */
  savePreferences(preferences: UserPreferences): Promise<PreferencesSnapshot>

  /** Estado corrente da auth. Só estado e perfil — token não atravessa a ponte. */
  getAuth(): Promise<AuthSnapshot>
  /** Dispara o login; o resultado chega pelo `onAuthChanged`, não pelo retorno. */
  login(): Promise<AuthSnapshot>
  logout(): Promise<AuthSnapshot>
  /**
   * Assina as transições de auth. Devolve a função que cancela a assinatura — sem ela o
   * listener sobreviveria ao componente que o registrou e vazaria a cada remontagem.
   */
  onAuthChanged(listener: (snapshot: AuthSnapshot) => void): () => void

  /** Pede ao main para minimizar a janela para o tray. */
  minimizeToTray(): void

  /**
   * Classifica uma ação pelo Policy Engine (SPEC-Execucao-02, critério 7). O `evaluate`
   * roda no main; a UI só lê a `PolicyDecision`. Nesta fatia a decisão é auditada e
   * devolvida, **nunca** barra a execução (modo report).
   */
  classifyAction(action: string, context: PolicyContext): Promise<PolicyDecision>

  /**
   * Allowlist de diretórios (SPEC-Execucao-03, critério 5). O renderer vê e edita a lista
   * por aqui; a checagem de FS e a persistência ficam no main. `add`/`remove` auditam.
   * Devolvem a lista atualizada de paths canônicos permitidos.
   */
  listAllowedDirectories(): Promise<readonly string[]>
  addAllowedDirectory(path: string): Promise<readonly string[]>
  removeAllowedDirectory(path: string): Promise<readonly string[]>

  /**
   * Abre o seletor nativo de pasta no main e adiciona a escolha à allowlist
   * (SPEC-ExecucaoReal-03, critérios 2 e 3). Devolve a lista atualizada — igual à de
   * `listAllowedDirectories`, e **inalterada** quando o usuário cancela o diálogo.
   */
  pickAllowedDirectory(): Promise<readonly string[]>

  /**
   * O diretório gerido pelo app, canônico. A tela o compara com os itens da lista para
   * marcar o fixo; não é um path que o renderer possa usar para tocar o FS.
   */
  getAppDirectory(): Promise<string>

  /**
   * Registro de workflows e automações (SPEC-Execucao-04, critério 7). CRUD de definições;
   * nada executa. `create`/`update`/`setStatus`/`setEnabled`/`remove` classificam (F02) e
   * auditam no main. O `WorkflowInput`/`AutomationInput` da UI não traz `user_id` — o main o
   * resolve pela sessão corrente.
   */
  listWorkflows(workspace: WorkspaceId): Promise<readonly Workflow[]>
  createWorkflow(input: Omit<WorkflowInput, 'user_id'>): Promise<Workflow>
  updateWorkflow(
    id: string,
    patch: Partial<Pick<Workflow, 'name' | 'steps' | 'triggers' | 'schedule'>>
  ): Promise<Workflow | undefined>
  setWorkflowStatus(id: string, status: WorkflowStatus): Promise<Workflow | undefined>
  removeWorkflow(id: string, workspace: WorkspaceId): Promise<boolean>

  listAutomations(workspace: WorkspaceId): Promise<readonly Automation[]>
  createAutomation(input: Omit<AutomationInput, 'user_id'>): Promise<Automation>
  setAutomationEnabled(id: string, enabled: boolean): Promise<Automation | undefined>
  removeAutomation(id: string, workspace: WorkspaceId): Promise<boolean>

  /**
   * Dispara um workflow em **modo simulado** (SPEC-Execucao-05) e devolve o `ExecutionRun`
   * com o trace por etapa. Gatilho manual — nada é agendado. **Zero efeito colateral:** o
   * motor não toca FS, rede, terminal nem provider.
   */
  runWorkflowSimulated(workflowId: string, workspace: WorkspaceId): Promise<ExecutionRun>
  /** Dispara um workflow em modo real de filesystem, com enforcement e aprovação. */
  runWorkflowReal(workflowId: string, workspace: WorkspaceId): Promise<ExecutionRun>
  listExecutionRuns(workspace: WorkspaceId): Promise<readonly ExecutionRun[]>
  listPendingApprovals(workspace: WorkspaceId): Promise<readonly ApprovalRequest[]>

  /*
   * Voz (SPEC-Voz-01, critério 3). O renderer captura com `getUserMedia` — Web API — e manda o
   * PCM; o que volta é texto ou desfecho nomeado, nunca caminho de modelo nem comando.
   */
  transcreverAudio(pcm: Int16Array, workspace: WorkspaceId): Promise<DesfechoDaTranscricao>
  prontidaoDaVoz(): Promise<ProntidaoDaVoz>
  baixarArtefatoDeVoz(id: string): Promise<DesfechoDoDownload>
  /**
   * Resolve uma aprovação pendente. O retorno varia com o que estava pausado: uma etapa de
   * filesystem devolve o `ExecutionRun` retomado (F01); um comando devolve o
   * `CommandExecution` (F02). A fila é uma só — o painel de aprovações não distingue —, mas
   * o desfecho é do tipo do motor que executou.
   */
  resolveApproval(
    id: string,
    decision: ApprovalDecision
  ): Promise<ExecutionRun | CommandExecution | undefined>

  /**
   * Submete um comando ao terminal controlado (SPEC-ExecucaoReal-02) e devolve o resultado.
   *
   * **Binário e argumentos separados, nunca uma linha.** A assinatura é a garantia de
   * segurança: não existindo um campo "linha de comando", não há o que um shell interprete —
   * `;`, `&&` e `$()` chegam ao processo como texto literal de argumento. Uma API que
   * aceitasse a linha inteira reintroduziria a superfície que esta forma fecha.
   *
   * Nunca rejeita por política: uma recusa volta como `CommandExecution` com `state`
   * `bloqueado` e o `reason` correspondente — é desfecho a exibir, não erro a tratar.
   */
  runCommand(submission: CommandSubmission, workspace: WorkspaceId): Promise<CommandExecution>

  /**
   * Allowlist de **comandos** (1ª barreira). Escopada por espaço: o que o JARVIS pode
   * executar não é o que o NOA pode. `add`/`remove` são ações de **alto risco**, classificadas
   * e auditadas no main. Devolvem a lista atualizada, para a UI refletir sem novo round-trip.
   */
  listAllowedCommands(workspace: WorkspaceId): Promise<readonly string[]>
  addAllowedCommand(binary: string, workspace: WorkspaceId): Promise<readonly string[]>
  removeAllowedCommand(binary: string, workspace: WorkspaceId): Promise<readonly string[]>

  /**
   * Vault de credenciais (SPEC-Providers-01). **Não há método aqui que devolva o valor de uma
   * credencial** — e essa ausência é o critério 2, não um esquecimento: o renderer não tem
   * como pedir o segredo porque a ponte não tem forma de entregá-lo.
   *
   * `listCredentials` devolve **todas** as chaves conhecidas, inclusive as ausentes
   * (`status: missing`) — é o que permite a UI dizer o que falta sem exibir segredo (RF-010).
   *
   * `setCredential` recebe o valor de ida: o usuário digita a chave dele no Settings, ela
   * atravessa a ponte uma vez e é cifrada no main. Escopo por espaço: a mesma chave lógica
   * tem valores próprios no NOA e no JARVIS.
   */
  listCredentials(workspace: WorkspaceId): Promise<readonly CredentialStatusView[]>
  setCredential(
    key: CredentialKey,
    value: string,
    workspace: WorkspaceId
  ): Promise<readonly CredentialStatusView[]>
  removeCredential(
    key: CredentialKey,
    workspace: WorkspaceId
  ): Promise<readonly CredentialStatusView[]>

  /**
   * Dispara uma chamada de IA e devolve o handle (SPEC-Providers-02, critério 8).
   *
   * A resposta **não** vem por aqui: chega em chunks por `onAiStreamEvent`, casados pelo `id`
   * do handle. O renderer monta o texto incrementalmente e nunca toca a credencial.
   */
  callAi(request: AiRequest, workspace: WorkspaceId): Promise<AiCallHandle>
  /** Aborta uma chamada em andamento. No-op se ela já terminou. */
  cancelAi(id: string): Promise<void>
  /** Assina os eventos de stream. Devolve a função que cancela a assinatura. */
  onAiStreamEvent(listener: (evento: AiStreamEvent) => void): () => void

  /**
   * Assina o console da geração (SPEC-Fases-03 § Superfície).
   *
   * O payload traz o `traceId`, e é ele que separa uma geração da seguinte. Passar um `traceId`
   * como filtro no preload **não funcionaria para a geração ao vivo**: o renderer dispara a
   * geração por `invoke`, que só resolve no fim, então no instante em que o painel precisa
   * assinar o id ainda não existe do lado de cá. Quem descobre a geração corrente é o painel,
   * pelo primeiro evento que chega.
   *
   * Devolve a função que cancela a assinatura.
   */
  onGenerationEvent(listener: (payload: EventoDaGeracao) => void): () => void
  /** As gerações anteriores de uma etapa, da mais recente para a mais antiga (critério 6). */
  generationHistory(
    projectId: string,
    etapa: Etapa,
    workspace: WorkspaceId
  ): Promise<readonly GenerationTrace[]>
  /** Os eventos gravados de uma geração — o que reabre o painel a partir do histórico. */
  generationEvents(traceId: string, workspace: WorkspaceId): Promise<readonly GenerationEvent[]>

  /**
   * Orçamento do escopo: limites e acumulado do dia e do mês (SPEC-Providers-03, critério 8).
   *
   * Leitura apenas — a soma é feita no main, sobre os `CostEvent` gravados. O renderer não
   * recalcula: um segundo cálculo divergiria do que o gate usa, e o número na tela deixaria de
   * ser o número que barra.
   */
  getBudget(workspace: WorkspaceId): Promise<BudgetSnapshot>
  /**
   * Edita os limites e devolve o estado resultante, já com o acumulado — como `savePreferences`.
   * Entrada inválida (limite negativo, limiar fora de 0–1) é **recusada no main**.
   */
  setBudgetLimits(limites: BudgetLimitsInput, workspace: WorkspaceId): Promise<BudgetSnapshot>

  /**
   * Status por provider: estado, modelo ativo, origem e latência (SPEC-Providers-04, crit. 5).
   *
   * O healthcheck roda no main, com cache curto — o renderer não sonda nada. Uma tela que
   * pingasse providers por conta própria manteria uma segunda noção de "quem está de pé", e a
   * dela discordaria da que roteia.
   */
  getProviderStatus(workspace: WorkspaceId): Promise<readonly ProviderStatus[]>
  /** Os modelos que um provider oferece — o que o seletor de troca lista. */
  getProviderModels(provider: AiProvider): Promise<readonly string[]>
  /** Troca o modelo ativo. `false` quando o modelo não existe na tabela de preço. */
  setProviderModel(provider: AiProvider, modelo: string, workspace: WorkspaceId): Promise<boolean>
  /** As regras de roteamento do escopo, com as padrão preenchendo o que nunca foi editado. */
  getRouting(workspace: WorkspaceId): Promise<RoutingPolicy>
  /** Edita a rota de um tipo de tarefa e devolve o conjunto resultante. */
  setRoute(rota: ProviderRoute, workspace: WorkspaceId): Promise<RoutingPolicy>

  /**
   * O perfil isolado do Codex (SPEC-Multi-Executor-02, critérios 1, 4, 5 e 6).
   *
   * `estadoDoCodex` devolve saúde, referência opaca ao perfil e modo vigente — nunca conteúdo do
   * perfil. `entrarNoCodex` dispara o login por dispositivo e devolve a **instrução** que o PI
   * segue no navegador (o código e a URL, já redigidos), não uma credencial.
   */
  estadoDoCodex(): Promise<CodexProfileState>
  entrarNoCodex(): Promise<{ readonly ok: boolean; readonly instrucao: string }>
  sairDoCodex(): Promise<boolean>
  /**
   * Troca o modo de cobrança — **decisão do PI, auditada** (regra 4).
   *
   * `habilitado` é parâmetro explícito e não estado guardado: subir para um modo que gasta
   * dinheiro exige que o chamador declare a autorização na própria chamada. `undefined` de volta
   * é a recusa (regra 3: rate limit de assinatura não autoriza créditos nem API).
   */
  setModoDoCodex(modo: CodexBillingMode, habilitado: boolean): Promise<CodexBillingMode | undefined>

  /**
   * O modelo de cada fase no workspace, com o padrao preenchendo o que nunca foi editado
   * (SPEC-Fases-02, criterio 2).
   */
  getPhaseModels(workspace: WorkspaceId): Promise<PhaseModelPolicy>
  /**
   * Troca o modelo de uma fase no workspace e devolve a politica resultante.
   *
   * `undefined` quando o par nao existe no catalogo daquele provider — e nenhuma chamada sai
   * (criterio 4). Devolver `undefined` em vez de lancar mantem a tela mostrando a politica que
   * continua valendo.
   */
  setPhaseModel(
    fase: Fase,
    rota: RotaComModelo,
    provider: AiProvider,
    modelo: string,
    workspace: WorkspaceId
  ): Promise<PhaseModelPolicy | undefined>
  /** Os overrides de um projeto — o que a tela marca como divergente do workspace. */
  getPhaseModelOverrides(
    projectId: string,
    workspace: WorkspaceId
  ): Promise<readonly ProjectModelOverride[]>
  /** Grava o override do projeto. `undefined` quando o par nao existe no catalogo. */
  setPhaseModelOverride(
    override: ProjectModelOverride,
    workspace: WorkspaceId
  ): Promise<ProjectModelOverride | undefined>
  /** "Voltar ao padrao do workspace". `false` quando nao havia override a remover. */
  clearPhaseModelOverride(
    projectId: string,
    fase: Fase,
    rota: RotaComModelo,
    workspace: WorkspaceId
  ): Promise<boolean>

  /**
   * Conectores externos (SPEC-Conectores-01, critério 5).
   *
   * `listConnectorCapabilities` devolve **metadado** — operação, efeito e descrição —, que é o
   * que faz "capacidades permitidas" ser uma lista concreta em vez do resultado de tentar. Sem
   * ela, a UI descobriria o que pode pedir sendo recusada.
   *
   * `callConnector` executa **uma** dessas operações. Não há método que receba URL, host ou
   * cabeçalho: o renderer nomeia a operação, e quem sabe qual endereço isso vira é o adapter,
   * no main (critério 6).
   *
   * **Não há método que devolva credencial de conector** — e, como no vault de IA, a ausência é
   * o critério, não esquecimento: o `ConnectorOutcome` não tem campo onde um token caiba, e a
   * ponte não tem forma de pedir um.
   */
  listConnectorCapabilities(): Promise<readonly ConnectorCapability[]>
  callConnector(request: ConnectorRequest, workspace: WorkspaceId): Promise<ConnectorOutcome>

  /**
   * Teto de créditos de um conector, com o consumo do dia e do mês (SPEC-Conectores-02).
   *
   * Leitura apenas — a soma é feita no main, sobre os `credit_event` gravados, como no
   * `getBudget` do MVP-005. O renderer não recalcula: um segundo cálculo divergiria do que o
   * gate usa, e o número na tela deixaria de ser o número que barra.
   *
   * **Ledger distinto do orçamento em USD**: `getBudget` responde sobre chamadas de IA, este
   * responde sobre conectores, e os dois estouram separado (decisão do PI de 2026-08-29).
   */
  getConnectorCredits(connector: ConnectorId, workspace: WorkspaceId): Promise<ConnectorCreditView>
  /** Edita o teto e devolve o estado resultante, já com o consumo — como `setBudgetLimits`. */
  setConnectorCreditLimits(
    connector: ConnectorId,
    limites: ConnectorCreditLimitsInput,
    workspace: WorkspaceId
  ): Promise<ConnectorCreditView>

  /**
   * Credenciais de conector (SPEC-Conectores-05, critério 7).
   *
   * Mesma garantia estrutural do trio de credenciais de IA, e pelo mesmo mecanismo: **não há
   * método aqui que devolva o valor**. `ConnectorCredentialStatusView` não tem campo onde o
   * segredo caiba, e não existe um `getConnectorCredential()`.
   *
   * `setConnectorCredential` recusa a chave gerida por Device Flow (o GitHub): gravar um texto
   * colado por cima do par access/refresh quebraria o refresh em silêncio.
   */
  listConnectorCredentials(
    workspace: WorkspaceId
  ): Promise<readonly ConnectorCredentialStatusView[]>
  setConnectorCredential(
    key: ConnectorCredentialKey,
    value: string,
    workspace: WorkspaceId
  ): Promise<readonly ConnectorCredentialStatusView[]>
  removeConnectorCredential(
    key: ConnectorCredentialKey,
    workspace: WorkspaceId
  ): Promise<readonly ConnectorCredentialStatusView[]>

  /**
   * Autenticação do GitHub por Device Flow (SPEC-Conectores-03).
   *
   * **Nenhum destes métodos devolve token.** A garantia é a assinatura: `GithubAuthSnapshot` e
   * `GithubDeviceFlowView` não têm campo onde access ou refresh token caiba, e não existe um
   * `getGithubToken()`. É a mesma ausência deliberada do valor de credencial na M5-F01.
   */
  getGithubAuthStatus(workspace: WorkspaceId): Promise<GithubAuthSnapshot>
  /**
   * Abre o fluxo e devolve o código a mostrar. Separado do `await` porque a tela precisa exibir
   * o código **antes** de a espera começar.
   */
  startGithubAuth(workspace: WorkspaceId): Promise<GithubDeviceFlowView | ConnectorError>
  /** Espera a autorização. Resolve em sucesso, cancelamento, expiração ou erro normalizado. */
  awaitGithubAuth(workspace: WorkspaceId): Promise<GithubAuthSnapshot | ConnectorError>
  /** Cancela o fluxo em andamento — a saída por vontade do usuário que o critério 3 exige. */
  cancelGithubAuth(workspace: WorkspaceId): Promise<void>
  /** Remove a credencial local e limpa o estado (critério 6). */
  logoutGithub(workspace: WorkspaceId): Promise<GithubAuthSnapshot>
  /**
   * Grava o override do `client_id` (critério 7). Texto vazio limpa e volta ao embutido.
   *
   * Não passa pelo vault de propósito: o `client_id` é público por desenho no Device Flow, e
   * guardá-lo cifrado o anunciaria como segredo que ele não é.
   */
  setGithubClientId(clientId: string, workspace: WorkspaceId): Promise<GithubAuthSnapshot>

  /**
   * Projeto local e planejamento (SPEC-Planejamento-01).
   *
   * `createProject`/`importProject` devolvem `ProjectOutcome` — **inclusive nas recusas**. A
   * colisão não é exceção a capturar: é desfecho que a tela mostra com a opção de retomar.
   * Rejeitar a promise faria "já existe um projeto com esse nome" chegar à UI como falha
   * técnica, indistinguível de um disco cheio.
   */
  listProjects(workspace: WorkspaceId): Promise<readonly Project[]>
  createProject(
    nome: string,
    workspace: WorkspaceId,
    diretorioBase?: string
  ): Promise<ProjectOutcome>
  importProject(
    diretorio: string,
    workspace: WorkspaceId,
    nomeSugerido?: string
  ): Promise<ProjectOutcome>
  /**
   * Seletor nativo de pasta para importar. Abre no **main**, como o da allowlist: o renderer
   * nunca toca o filesystem, nem para escolher um caminho. Cancelar devolve string vazia.
   */
  pickProjectDirectory(): Promise<string>
  /** Renomeia o projeto — só o nome de exibição; slug e diretório não se movem. */
  renameProject(projectId: string, nome: string, workspace: WorkspaceId): Promise<ProjectOutcome>
  /** Desregistra o projeto. Os arquivos e o histórico Git permanecem no disco. */
  removeProject(projectId: string, workspace: WorkspaceId): Promise<boolean>
  /** A sessão de planejamento do projeto, criada na primeira leitura. */
  getPlanningSession(projectId: string, workspace: WorkspaceId): Promise<PlanningSession | null>
  /** Autosave do wizard. Não commita: resposta é estado de trabalho, não revisão documental. */
  savePlanningAnswers(
    projectId: string,
    etapa: string,
    respostas: Readonly<Record<string, unknown>>,
    workspace: WorkspaceId
  ): Promise<PlanningSession | null>
  /**
   * Conclui um marco: o **único** gatilho de commit. `commitado: false` não rejeita — o
   * critério 5 exige que a falha preserve os dados e ofereça retomada.
   */
  completeMilestone(
    projectId: string,
    marco: MarcoDocumental,
    workspace: WorkspaceId
  ): Promise<MarcoOutcome | null>
  /**
   * O estado do wizard: a pergunta pendente (ou a conclusão) e o histórico de decisões.
   *
   * **Lê sem avançar.** É o que torna a retomada do critério 6 estrutural: reabrir a tela
   * pergunta ao main onde parou, e a resposta vem do histórico gravado — não de estado que
   * morreu junto com a janela.
   */
  getWizardState(projectId: string, workspace: WorkspaceId): Promise<VistaDoWizard | null>
  /**
   * Registra uma resposta do PI, ou a delegação ao agente.
   *
   * Devolve `RespostaOutcome` **inclusive nas recusas**, como `createProject`: "esta resposta
   * muda decisões já tomadas" não é falha técnica, é o desfecho que a tela mostra junto com a
   * decisão anterior (critério 5). Rejeitar a promise faria a contradição chegar
   * indistinguível de um disco cheio — e o PI não teria o que aceitar.
   */
  answerWizard(
    projectId: string,
    resposta: Resposta,
    workspace: WorkspaceId
  ): Promise<RespostaOutcome>
  /**
   * Gera o pacote estrutural e commita o marco `prd-aprovado`.
   *
   * Devolve `PacoteOutcome` **inclusive nas recusas**, como `createProject`: "a pesquisa não
   * saiu" não é falha técnica, é o desfecho que o PI lê com a ação de retomada junto — e
   * rejeitar a promise faria o bloqueio chegar indistinguível de um disco cheio.
   */
  gerarPacote(projectId: string, consulta: string, workspace: WorkspaceId): Promise<PacoteOutcome>
  /** Os pacotes já gerados do projeto, do mais recente ao mais antigo. */
  listarPacotes(projectId: string): Promise<readonly PacoteEstrutural[]>
  /**
   * Abre o seletor nativo e devolve o caminho escolhido — string vazia se o PI cancelou.
   *
   * **Escolher não é anexar.** Este canal só devolve um caminho; o ato que conta para o gate é
   * `anexarDesign`, que copia, hasheia e audita. Fundir os dois faria "abriu e desistiu" ficar
   * indistinguível de "anexou".
   */
  /** O roadmap gravado do projeto — a projeção que o `STATUS.md` e os gates leem. */
  carregarRoadmap(projectId: string, workspace: WorkspaceId): Promise<Roadmap>
  /**
   * Gera o roadmap por IA: propõe os MVPs, valida o DAG e escreve STATUS, histórico e os
   * documentos dos MVPs (SPEC-Jornada-05).
   *
   * Devolve o desfecho **inclusive nas recusas**: "falta o PRD ou a arquitetura", "nenhuma rota
   * autorizada" e "o roadmap proposto não passou no validador" são desfechos que o PI lê com o
   * que fazer a respeito, não erros técnicos.
   */
  gerarRoadmapPorIa(projectId: string, workspace: WorkspaceId): Promise<RoadmapGeradoOutcome>
  /** A revisão vigente do roadmap gerado, ou `null` enquanto nenhuma foi gerada. */
  carregarRoadmapGerado(
    projectId: string,
    workspace: WorkspaceId
  ): Promise<RoadmapRegistrado | null>
  /**
   * Os MVPs que o PI pode escolher no `MVP_ENTRY` — só os sem dependência pendente (critério 3).
   *
   * Existe como leitura própria porque a tela precisa dela **antes** do gate: oferecer a lista
   * inteira e recusar depois faria o PI escolher um MVP bloqueado para descobrir que não podia.
   */
  mvpsElegiveis(projectId: string, workspace: WorkspaceId): Promise<readonly MvpGerado[]>
  /**
   * Registra qual MVP entra na fila e gera a SPEC da primeira fatia dele (critérios 3 e 5).
   *
   * **Escolher não é aprovar.** Este canal grava a escolha e produz o objeto que o gate vai
   * aprovar; o `Approval` continua vindo de `aprovacao:aprovar`, e fundir os dois faria a
   * escolha aprovar a si mesma.
   */
  escolherMvpDoRoadmap(
    projectId: string,
    mvpId: string,
    workspace: WorkspaceId
  ): Promise<RoadmapGeradoOutcome>
  /**
   * Responde uma pergunta aberta da SPEC gerada (critério 4).
   *
   * **Não recebe a pergunta, só o id dela e a resposta.** O enunciado vive na revisão desde que
   * foi gerado; aceitá-lo de volta deixaria o renderer reescrever o que o modelo perguntou.
   */
  responderPerguntaDaSpec(
    projectId: string,
    perguntaId: string,
    resposta: string,
    workspace: WorkspaceId
  ): Promise<RoadmapGeradoOutcome>
  /**
   * O estado da jornada do projeto: etapa atual, CTA único e a trilha (SPEC-Jornada-01).
   *
   * Ler **recalcula** a etapa a partir dos fatos e corrige a coluna quando ela discorda
   * (critério 2). Isso é conserto de cache, não avanço — a leitura nunca move a jornada para
   * frente, e é por isso que ela pode acontecer a cada abertura da tela.
   */
  estadoDaJornada(projectId: string, workspace: WorkspaceId): Promise<EstadoDaJornada | null>
  /** O estado da jornada de vários projetos — o que a lista de Projetos consome (critério 3). */
  jornadaDeVarios(
    projectIds: readonly string[],
    workspace: WorkspaceId
  ): Promise<readonly EstadoDaJornada[]>
  /**
   * O resumo de cada card da tela Projetos (SPEC-Fases-01, critério 7).
   *
   * Uma leitura por card, com os quatro blocos já compostos: fase e etapa, gates e data, rota e
   * modelo, e o bloqueio quando existe. O renderer não recompõe fato nenhum — buscar cada peça
   * no seu canal permitiria que a rota do card discordasse da rota do selo (critério 4).
   */
  resumoDeVarios(
    projectIds: readonly string[],
    workspace: WorkspaceId
  ): Promise<readonly ResumoDoProjeto[]>
  /**
   * Aplica um evento nomeado à jornada — a **única** via de escrita (critério 1).
   *
   * Devolve `TransicaoOutcome` inclusive nas recusas: "este evento sai de outra etapa" é
   * desfecho que a tela mostra, não falha técnica. Rejeitar a promise faria a recusa legítima
   * chegar à UI como erro.
   */
  aplicarEventoDaJornada(
    projectId: string,
    evento: string,
    workspace: WorkspaceId
  ): Promise<TransicaoOutcome | null>
  /**
   * Salva o prompt do PI (SPEC-Jornada-02, critério 1). Prompt vazio devolve `null` em vez de
   * rejeitar: "não escreveu nada ainda" é estado, não falha.
   */
  salvarPromptDoProjeto(
    projectId: string,
    texto: string,
    workspace: WorkspaceId
  ): Promise<PromptDoProjeto | null>
  /** O prompt vigente. As revisões anteriores continuam no banco. */
  lerPromptDoProjeto(projectId: string, workspace: WorkspaceId): Promise<PromptDoProjeto | null>
  /**
   * Gera o brief. Devolve `GeracaoOutcome` **inclusive nas recusas**: "nenhuma rota autorizada"
   * é desfecho que o PI lê com a ação nomeada, não falha técnica.
   */
  gerarBrief(projectId: string, workspace: WorkspaceId): Promise<GeracaoOutcome>
  /** O brief vigente, ou `null` enquanto nenhum foi gerado. */
  carregarBrief(projectId: string, workspace: WorkspaceId): Promise<BriefRegistrado | null>
  /**
   * A rota que seria usada agora, **sem gerar nada**. É o que permite à tela mostrar o bloqueio
   * antes do clique, em vez de depois da tentativa.
   */
  rotaDaGeracao(projectId: string, workspace: WorkspaceId): Promise<ResultadoDaRota>
  /**
   * Corta um `proposto` no gate (critério 5). Recebe **um id**, não a lista do que sobra:
   * mandar a lista faria o renderer decidir o conteúdo final, e um erro dele apagaria
   * afirmação que veio do PI.
   */
  cortarPropostoDoBrief(
    projectId: string,
    afirmacaoId: string,
    workspace: WorkspaceId
  ): Promise<BriefRegistrado | null>
  /**
   * Propõe o termo de pesquisa de mercado a partir do brief aceito (SPEC-Jornada-03, critério 3).
   *
   * Devolve `null` quando não há brief aceito, quando a rota está bloqueada ou quando a chamada
   * falhou: a tela cai no campo vazio e o PI escreve o dele. **Propor não pesquisa** — a busca
   * só acontece em `gerarPrd`, com o termo que o PI confirmou.
   */
  proporTermoDePesquisa(projectId: string, workspace: WorkspaceId): Promise<string | null>
  /**
   * Gera o PRD, o Landscape e a Convention. Devolve o desfecho **inclusive nas recusas**.
   *
   * `termo` vazio é escolha legítima: nenhuma busca acontece e o Landscape declara a lacuna,
   * enquanto PRD e Convention seguem (decisão do PI, 2026-09-03).
   */
  gerarPrd(projectId: string, termo: string, workspace: WorkspaceId): Promise<PrdOutcome>
  /** A revisão vigente, ou `null` enquanto nenhuma foi gerada. */
  carregarPrd(projectId: string, workspace: WorkspaceId): Promise<PrdRegistrado | null>
  /** Corta um `proposto` no gate. Recebe **um id**, como no brief e pela mesma razão. */
  cortarPropostoDoPrd(
    projectId: string,
    afirmacaoId: string,
    workspace: WorkspaceId
  ): Promise<PrdRegistrado | null>
  /**
   * Gera a arquitetura, as decisões, os testes e a revisão por IA (SPEC-Jornada-04).
   *
   * Devolve o desfecho **inclusive nas recusas**: "faltam anexos", "os protótipos têm problema" e
   * "nenhuma rota autorizada" são desfechos que o PI lê com o que fazer a respeito, não erros
   * técnicos. O gate de anexos da M8-F05 é conferido antes de qualquer chamada ao modelo.
   */
  gerarArquiteturaPorIa(
    projectId: string,
    workspace: WorkspaceId
  ): Promise<ArquiteturaGeradaOutcome>
  /** A revisão vigente da arquitetura, ou `null` enquanto nenhuma foi gerada. */
  carregarArquitetura(
    projectId: string,
    workspace: WorkspaceId
  ): Promise<ArquiteturaRegistrada | null>
  /** Corta um `proposto` no gate. Recebe **um id**, como no PRD e pela mesma razão. */
  cortarPropostoDaArquitetura(
    projectId: string,
    afirmacaoId: string,
    workspace: WorkspaceId
  ): Promise<ArquiteturaRegistrada | null>
  /**
   * Descarta um ajuste da análise de coerência (SPEC-Jornada-04, critério 4).
   *
   * **Descartar é a única operação sobre um ajuste.** Autorizar um deles é um ato do PI sobre o
   * protótipo — reabrir, redesenhar, reanexar —, e nenhum canal aqui escreve no anexo.
   */
  descartarAjusteDaArquitetura(
    projectId: string,
    ajusteId: string,
    workspace: WorkspaceId
  ): Promise<ArquiteturaRegistrada | null>
  /**
   * Gera as perguntas de refinamento para os blocos ainda sem resposta.
   *
   * Devolve o desfecho **inclusive nas recusas**: "nenhuma rota autorizada" e "nada a
   * perguntar" são respostas legítimas que a tela mostra, não falhas técnicas.
   */
  gerarPerguntasDeRefinamento(
    projectId: string,
    workspace: WorkspaceId
  ): Promise<GeracaoDePerguntasOutcome>
  /** A pergunta pendente, a conclusão ou o bloqueio — calculado do banco a cada chamada. */
  estadoDoRefinamento(projectId: string, workspace: WorkspaceId): Promise<EstadoDoWizard | null>
  /** Registra a resposta do PI (ou a delegação). Contradição volta sem gravar. */
  responderRefinamento(
    projectId: string,
    resposta: Resposta,
    workspace: WorkspaceId
  ): Promise<RespostaOutcome>
  /** O histórico completo, com as substituídas — a trilha de quem decidiu o quê. */
  historicoDoRefinamento(projectId: string, workspace: WorkspaceId): Promise<readonly Decision[]>
  publicarNoGitHub(
    projectId: string,
    alvo: AlvoDaPublicacao,
    workspace: WorkspaceId
  ): Promise<PublicacaoOutcome>
  /** O estado da fila de execução (SPEC-Entrega-02). Só leitura: o renderer não move a pipeline. */
  vistaDaFila(projectId: string, workspace: WorkspaceId): Promise<VistaDaFila>
  /**
   * O estado do sandbox do executor (SPEC-Entrega-03). Só leitura — a preparação é da pipeline.
   */
  estadoDoSandbox(): Promise<{ readonly dockerNoAr: boolean; readonly proxyNoAr: boolean }>
  /**
   * A prova de um run encerrado (SPEC-Entrega-06). `undefined` enquanto o run não terminou.
   *
   * Só leitura: o ledger é escrito pelo `EntregaService` ao encerrar, nunca pelo renderer — uma
   * via de escrita deixaria a UI fabricar evidência, o mesmo motivo pelo qual a auditoria da
   * M1-F04 também é só leitura pela ponte.
   */
  ledgerDoRun(runId: string): Promise<ExecutionLedger | undefined>
  /** O que a limpeza não conseguiu remover e segue reconciliável (SPEC-Entrega-06, critério 5). */
  pendenciasDeLimpeza(): Promise<readonly PendenciaDeLimpeza[]>
  /** O kill-switch do merge autônomo do projeto (SPEC-Entrega-02/05). Ausência = ligado. */
  lerPoliticaDeMerge(projectId: string, workspace: WorkspaceId): Promise<PoliticaDeMerge>
  /**
   * Liga ou desliga o merge autônomo.
   *
   * **A identidade não atravessa a ponte**, como em `aprovarGate`: ela vem da sessão autenticada
   * no main. É ação sensível e gera `AuditEvent` — quem mudou é parte do que o evento registra,
   * e deixar o renderer declarar isso tornaria o registro inútil.
   */
  definirPoliticaDeMerge(
    projectId: string,
    autonomo: boolean,
    workspace: WorkspaceId
  ): Promise<MergePolicyOutcome>
  /** As aprovações registradas, da mais recente à mais antiga. */
  listarAprovacoes(projectId: string, workspace: WorkspaceId): Promise<readonly Approval[]>
  /** As revisões que este gate aprova hoje — os hashes exatos (critério 4). */
  revisoesDoGate(
    projectId: string,
    gate: Gate,
    workspace: WorkspaceId
  ): Promise<readonly RevisaoAprovada[]>
  /**
   * Aprova um gate.
   *
   * **A identidade não atravessa a ponte:** ela vem da sessão autenticada no main. Um parâmetro
   * de identidade deixaria o renderer declarar quem aprovou, e o critério 4 pergunta exatamente
   * isso.
   */
  aprovarGate(projectId: string, gate: Gate, workspace: WorkspaceId): Promise<AprovacaoOutcome>
  /** Quais gates uma mudança invalidaria — **antes** de aplicá-la (critério 6). Consulta pura. */
  simularMudanca(
    projectId: string,
    mudancas: readonly MudancaDeArtefato[],
    workspace: WorkspaceId
  ): Promise<readonly Gate[]>
  /**
   * O painel de marcos: o que está versionado e o estado do repositório (SPEC-Fases-04).
   *
   * Uma leitura por chamada — a tela decide quando repetir ("Verificar de novo"), e não a cada
   * render. Não há contraparte de escrita: commitar é `concluirMarco`.
   */
  marcosDoProjeto(projectId: string, workspace: WorkspaceId): Promise<VistaDeMarcos>
  escolherAnexo(tipo: TipoDeAnexo): Promise<string>
  /**
   * O ato de anexar: copia o arquivo para dentro do projeto e hasheia no instante.
   *
   * Devolve `AnexoOutcome` **inclusive nas recusas**, como `createProject`: "este arquivo não é
   * um `.html`" não é falha técnica, é desfecho que a tela mostra com o que fazer.
   */
  anexarDesign(
    projectId: string,
    tipo: TipoDeAnexo,
    origem: string,
    workspace: WorkspaceId
  ): Promise<AnexoOutcome>
  /** Os anexos do projeto, do mais antigo ao mais recente. */
  listarAnexos(projectId: string): Promise<readonly Anexo[]>
  /** Desregistra o anexo. **Não apaga o arquivo do disco** — destrutivo não é efeito colateral. */
  removerAnexo(projectId: string, caminho: string, workspace: WorkspaceId): Promise<boolean>
  /**
   * Valida os protótipos anexados e devolve os achados (pergunta + recomendação).
   *
   * A tela chama isto **antes** de o PI pedir a arquitetura: descobrir que um asset está
   * quebrado só na hora de gerar faria o PI ir e voltar sem necessidade.
   */
  validarPrototipos(projectId: string): Promise<readonly ValidacaoDoPrototipo[]>
  /** Os pacotes de arquitetura já gerados, do mais recente ao mais antigo. */
  listarArquiteturas(projectId: string): Promise<readonly PacoteArquitetura[]>
  /**
   * Monta o `ContextPack` — o gate do critério 1 (SPEC-Planejamento-02).
   *
   * Devolve `ContextPackOutcome` **inclusive nas recusas**, como `createProject`: "este arquivo
   * parece ter credencial" não é falha técnica, é desfecho que a tela mostra com o que fazer a
   * respeito. Rejeitar a promise faria a recusa chegar indistinguível de um disco cheio.
   */
  buildContextPack(pedido: ContextPackRequest, workspace: WorkspaceId): Promise<ContextPackOutcome>
  /** Os packs já montados do projeto, do mais recente ao mais antigo. */
  listContextPacks(projectId: string): Promise<readonly ContextPack[]>
  /**
   * Como cada capacidade é atendida nesta execução — por skill ou pelo procedimento direto
   * (critério 5). A tela mostra os dois meios igualmente: "direto" não é degradação.
   */
  listCapabilities(): Promise<readonly CapacidadeResolvida[]>
  /** As falhas do projeto, abertas e resolvidas. Só as abertas entram no próximo pack. */
  listFailures(projectId: string): Promise<readonly FalhaRegistrada[]>
  /** Marca a falha como resolvida — a partir daqui ela não volta ao contexto (critério 4). */
  resolveFailure(projectId: string, fingerprint: string, workspace: WorkspaceId): Promise<boolean>
}

/**
 * O pedido de montagem, como o renderer o envia.
 *
 * Espelha o `PedidoDeContexto` do main **sem** o que o renderer não pode decidir: não há campo
 * de conteúdo, só caminhos relativos. Quem lê o arquivo é o main, dentro do diretório do
 * projeto — o renderer indica o que quer, nunca entrega o que leu.
 */
export interface ContextPackRequest {
  readonly projectId: string
  readonly tarefa: string
  readonly etapa: string
  readonly candidatos: readonly {
    readonly caminho: string
    readonly origem: OrigemDeContexto
    readonly motivo: string
    readonly linhas?: { readonly de: number; readonly ate: number }
  }[]
  readonly regras?: readonly string[]
  readonly resumoAnterior?: string
  readonly rota: AiProvider
  readonly excecaoDeLeituraAmpla?: ExcecaoDeLeituraAmpla
  readonly tetoDeTokens?: number
  readonly motivoDaExpansao?: string
  readonly packAnterior?: string
}

/** Teto + consumo, como a tela os lê. */
export interface ConnectorCreditView {
  readonly policy: ConnectorCreditPolicy
  readonly consumido: { readonly dia: number; readonly mes: number }
}

/** O que a tela envia ao editar o teto. */
export interface ConnectorCreditLimitsInput {
  readonly dailyLimit: number
  readonly monthlyLimit: number
}

/** Nome da propriedade exposta via contextBridge no renderer. */
export const BRIDGE_KEY = 'jarvis' as const
