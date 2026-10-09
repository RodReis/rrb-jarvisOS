/**
 * Migrations do SQLite local, versionadas por `PRAGMA user_version`.
 *
 * Regra que governa este arquivo (SPEC-Fundacao-04): **migration preserva dado**. O log de
 * auditoria é evidência; zerá-lo por evolução de schema destruiria exatamente aquilo que o
 * ADR-004 existe para proteger. Portanto: só se acrescenta migration ao fim do array —
 * nunca se edita nem se reordena uma já publicada, porque bancos existentes já a aplicaram
 * e não a rodariam de novo.
 */

import type { Database } from 'better-sqlite3'

/** Uma migration é SQL puro; o índice no array + 1 é o `user_version` que ela produz. */
const MIGRATIONS: readonly string[] = [
  // 1 — entidades mínimas da fundação + auditoria tamper-evident.
  `
  CREATE TABLE user_profile (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL,
    locale      TEXT NOT NULL DEFAULT 'pt-BR'
  );

  -- Metadados da sessão. O token NÃO entra aqui: mora cifrado no safeStorage (SPEC-03).
  CREATE TABLE session (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    expires_at          TEXT NOT NULL,
    last_online_auth_at TEXT NOT NULL,
    created_at          TEXT NOT NULL
  );
  CREATE INDEX idx_session_user ON session(user_id);

  CREATE TABLE audit_event (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    workspace_id TEXT,
    type         TEXT NOT NULL,
    payload      TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    seq          INTEGER NOT NULL,
    prev_hash    TEXT NOT NULL,
    hash         TEXT NOT NULL,
    -- Garante no storage que o seq é monotônico por usuário: uma segunda gravação
    -- concorrente com o mesmo seq falha aqui em vez de criar dois ramos da cadeia.
    UNIQUE (user_id, seq)
  );
  CREATE INDEX idx_audit_user_seq ON audit_event(user_id, seq);

  -- ADR-004, camada 1: PREVENIR na camada de storage. A via de escrita só faz INSERT;
  -- estes triggers fazem qualquer UPDATE/DELETE abortar, inclusive vindo de fora do app
  -- (um cliente SQLite qualquer). Sem eles, "imutável" seria só uma promessa da API.
  CREATE TRIGGER audit_event_sem_update
    BEFORE UPDATE ON audit_event
  BEGIN
    SELECT RAISE(ABORT, 'audit_event é append-only: UPDATE bloqueado (ADR-004)');
  END;

  CREATE TRIGGER audit_event_sem_delete
    BEFORE DELETE ON audit_event
  BEGIN
    SELECT RAISE(ABORT, 'audit_event é append-only: DELETE bloqueado (ADR-004)');
  END;
  `,

  // 2 — preferência de tema (SPEC-Fundacao-05).
  //
  // `ALTER TABLE ADD COLUMN`, e não recriar a tabela: bancos já existentes preservam o
  // perfil e — mais importante — a cadeia de auditoria intacta. O DEFAULT preenche as
  // linhas antigas, então `theme` pode ser NOT NULL sem quebrar quem já tem dado.
  `
  ALTER TABLE user_profile ADD COLUMN theme TEXT NOT NULL DEFAULT 'sistema';
  `,

  // 3 — allowlist de diretórios permitidos (SPEC-Execucao-03).
  //
  // `path` guarda o diretório **canônico** (o main canoniza antes de gravar). Escopo por
  // `user_id` (CONVENTION §2): a allowlist de um usuário nunca é a de outro. `UNIQUE
  // (user_id, path)` torna "adicionar duas vezes o mesmo diretório" um no-op no storage,
  // não uma segunda linha — a allowlist é um conjunto, não uma lista.
  `
  CREATE TABLE allowed_directory (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    path       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, path)
  );
  CREATE INDEX idx_allowed_dir_user ON allowed_directory(user_id);
  `,

  // 4 — registro de workflows e automações (SPEC-Execucao-04, RF-006/RF-007).
  //
  // `steps`/`triggers`/`target` são JSON numa coluna, não tabelas normalizadas: por decisão
  // do PI, o catálogo não consulta etapa isoladamente nesta fatia (nada roda), então
  // normalizar seria custo sem retorno até a execução real (MVP-003). A validação da forma
  // vive no contrato TS, aplicada na leitura. Escopo `user_id`/`workspace_id` (CONVENTION §2).
  `
  CREATE TABLE workflow (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    name         TEXT NOT NULL,
    status       TEXT NOT NULL,
    steps        TEXT NOT NULL,   -- JSON: WorkflowStep[]
    triggers     TEXT NOT NULL,   -- JSON: Trigger[]
    schedule     TEXT,
    last_run     TEXT,
    next_run     TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  CREATE INDEX idx_workflow_user ON workflow(user_id, workspace_id);

  CREATE TABLE automation (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    name         TEXT NOT NULL,
    trigger      TEXT NOT NULL,   -- JSON: Trigger
    target       TEXT NOT NULL,   -- JSON: { workflowId } | { descriptor }
    squad_id     TEXT,
    skill_id     TEXT,
    enabled      INTEGER NOT NULL DEFAULT 0,   -- SQLite não tem boolean: 0/1
    last_run     TEXT,
    next_run     TEXT,
    retry_count  INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  CREATE INDEX idx_automation_user ON automation(user_id, workspace_id);
  `,

  // 5 — execução simulada (SPEC-Execucao-05, RF-006).
  //
  // `execution_run` é o rastro de percorrer um workflow em modo simulado. `trace` é JSON
  // (mesma decisão do workflow: o run não é consultado por etapa isolada). Escopo
  // `user_id`/`workspace_id`. `workflow_id` pode ser NULL — um run pode vir de um descritor
  // de ação avulso, não só de um workflow.
  `
  CREATE TABLE execution_run (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL,
    workspace_id   TEXT NOT NULL,
    workflow_id    TEXT,
    state          TEXT NOT NULL,
    trace          TEXT NOT NULL,   -- JSON: StepTrace[]
    correlation_id TEXT NOT NULL,
    started_at     TEXT NOT NULL,
    finished_at    TEXT NOT NULL,
    created_at     TEXT NOT NULL
  );
  CREATE INDEX idx_execution_run_user ON execution_run(user_id, workspace_id);
  `,

  // 6 — acento por módulo, escolhido na CHOICE (SPEC-CHOICE-01, critério 4).
  //
  // Duas colunas nuláveis, uma por módulo. **DEFAULT NULL, não o hex de fábrica**: NULL diz
  // "o usuário ainda não escolheu", e quem resolve para `ACENTO_PADRAO` é o serviço, em runtime.
  // Gravar o hex aqui duplicaria o valor de fábrica no schema — e no dia em que o default do
  // JARVIS mudar (já está mudando), as linhas antigas ficariam presas no valor velho enquanto o
  // código usaria o novo. NULL mantém a fonte única do default no TS, não no SQL.
  //
  // Por módulo, e não uma coluna só: NOA e JARVIS têm acento independente (SPEC-DS-05), e escolher
  // num não pode mover o outro. Sem `AuditEvent` — é preferência de baixo risco, igual a
  // tema/idioma (SPEC-Fundacao-05); entrar num espaço continua auditando (`workspace-switch`).
  `
  ALTER TABLE user_profile ADD COLUMN accent_noa    TEXT;
  ALTER TABLE user_profile ADD COLUMN accent_jarvis TEXT;
  `,

  // 7 — aprovação humana real (SPEC-ExecucaoReal-01).
  //
  // A aprovação é o ponto em que o modo real deixa de auto-continuar. O payload da operação
  // fica em JSON para permitir retomar a etapa após decisão humana sem normalizar cada tipo
  // de ação de filesystem em tabela própria neste MVP.
  `
  CREATE TABLE approval_request (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL,
    workspace_id   TEXT NOT NULL,
    run_id         TEXT NOT NULL,
    step_id        TEXT NOT NULL,
    action         TEXT NOT NULL,
    status         TEXT NOT NULL,
    risk           TEXT NOT NULL,
    reason         TEXT NOT NULL,
    operation      TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    resolved_at    TEXT,
    resolved_by    TEXT
  );
  CREATE INDEX idx_approval_request_user_status
    ON approval_request(user_id, workspace_id, status, created_at);
  `,

  // 8 — allowlist de **comandos** (SPEC-ExecucaoReal-02, 1ª barreira).
  //
  // Conceito novo: o MVP-002 só tinha allowlist de *diretórios*. As duas coexistem e são
  // checadas juntas — um comando precisa de binário permitido **e** cwd permitido.
  //
  // `binary` guarda o nome **canônico** (minúsculas, sem diretório, sem `.exe`): o main
  // canoniza antes de gravar, pela mesma razão que a allowlist de diretórios grava o path
  // canônico. Sem isso, `GIT.EXE` e `git` seriam entradas distintas e a lista vazaria por
  // variação de escrita.
  //
  // Escopo por `user_id` **e** `workspace_id` (CONVENTION §2), diferente de
  // `allowed_directory`, que é só por usuário: o que o JARVIS OS pode rodar não é o que o
  // NOA pode. Diretório permitido é sobre onde os arquivos do usuário estão; comando
  // permitido é sobre o que aquele espaço tem autoridade para executar — e a spec pede
  // escopo por workspace explicitamente.
  //
  // **Sem default de fábrica.** A tabela nasce vazia e nada é semeado: o terminal não roda
  // nada até o usuário permitir explicitamente (spec § Dentro). É o oposto de
  // `allowed_directory`, cujo `appDir` é invariante por construção — ali havia um diretório
  // que o app precisa alcançar para funcionar; aqui não há comando nenhum que o app precise.
  `
  CREATE TABLE allowed_command (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    binary       TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    UNIQUE (user_id, workspace_id, binary)
  );
  CREATE INDEX idx_allowed_command_user ON allowed_command(user_id, workspace_id);
  `,

  // 9 — vault de credenciais (SPEC-Providers-01).
  //
  // **`secret` guarda o valor cifrado pelo `safeStorage`/DPAPI, nunca em claro.** É a única
  // coluna do banco que carrega segredo, e por isso carrega também a regra: quem lê esta
  // tabela fora do `SecretVault` está lendo bytes cifrados que não sabe decifrar. O
  // `CredentialRef` que atravessa o IPC **não tem campo para este valor** — a coluna existe
  // no storage, o tipo não a expõe.
  //
  // BLOB e não TEXT: `safeStorage.encryptString` devolve `Buffer`, e gravá-lo como texto o
  // faria passar por uma decodificação UTF-8 que corrompe bytes que não formam caractere
  // válido. O ciclo grava→lê→decifra só fecha com BLOB.
  //
  // Escopo por `user_id` **e** `workspace_id`, com `UNIQUE` incluindo a `key`: é o que faz a
  // mesma `openai` ter valores distintos em `noa` e `jarvis` sem se misturar (critério 1). O
  // `UNIQUE` também torna "gravar de novo" um UPDATE da linha existente, não uma segunda
  // credencial para a mesma chave — o vault é um mapa, não um histórico.
  //
  // Sem coluna `source`/`status`: as duas são **derivadas** em runtime (linha presente aqui =
  // `vault`; ausente aqui e presente no env = `env`; ausente nos dois = `missing`).
  // Persisti-las criaria uma segunda fonte da verdade que envelhece sozinha quando o `.env`
  // muda entre dois boots.
  `
  CREATE TABLE credential_ref (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    key          TEXT NOT NULL,
    secret       BLOB NOT NULL,   -- cifrado pelo safeStorage/DPAPI; nunca em claro
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    UNIQUE (user_id, workspace_id, key)
  );
  CREATE INDEX idx_credential_ref_user ON credential_ref(user_id, workspace_id);
  `,

  // 10 — orçamento e custo de IA (SPEC-Providers-03).
  //
  // Duas tabelas porque são dois fatos de natureza diferente: `budget_policy` é **configuração
  // mutável** (o usuário edita o limite), `cost_event` é **registro do que aconteceu**. Somar
  // gasto exige a segunda; a F02 emitia o `CostEvent` só como payload de auditoria, e payload
  // de auditoria não se consulta por período — a tabela `audit_event` é append-only justamente
  // para não ser reinterpretada, e derivar orçamento de dentro dela acoplaria o gate ao
  // formato do log.
  //
  // Escopo `user_id` + `workspace_id` nas duas (CONVENTION §2), com `UNIQUE` na policy: o
  // orçamento é um por escopo, então "salvar de novo" é UPDATE da linha, não segunda política.
  // Ausência de linha **não** é ausência de orçamento — é o padrão de `orcamentoPadrao`
  // (USD 1/USD 1/0,8) valendo. Semear a linha no primeiro boot criaria a pergunta "e o
  // usuário que existe desde antes desta migration?"; o default em código não a tem.
  //
  // `created_at` no `cost_event` guarda o **ISO UTC** do fim da chamada, e é por ele que o
  // período é recortado. Dia e mês contam separado (critério 3), então o índice cobre
  // `(user_id, workspace_id, created_at)` — a consulta é sempre "este escopo, esta janela".
  //
  // `real_usd` é NULLable de propósito: a chamada que falhou antes de o provider reportar
  // `usage` não tem custo medido. Somar tratando ausente como zero seria dizer que não custou;
  // deixar NULL diz que **não se sabe**, e o `SUM` do SQLite ignora NULL em vez de inventar.
  `
  CREATE TABLE budget_policy (
    user_id         TEXT NOT NULL,
    workspace_id    TEXT NOT NULL,
    daily_limit     REAL NOT NULL,
    monthly_limit   REAL NOT NULL,
    alert_threshold REAL NOT NULL,
    currency        TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id)
  );

  CREATE TABLE cost_event (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    call_id      TEXT NOT NULL,
    provider     TEXT NOT NULL,
    model        TEXT NOT NULL,
    estimado_usd REAL NOT NULL,
    real_usd     REAL,            -- NULL = custo não medido (a chamada não chegou ao usage)
    created_at   TEXT NOT NULL    -- ISO UTC; é por ele que o período é recortado
  );
  CREATE INDEX idx_cost_event_escopo ON cost_event(user_id, workspace_id, created_at);
  `,

  // 11 — roteamento por tarefa e modelo ativo (SPEC-Providers-04).
  //
  // `provider_route` guarda **uma linha por tipo de tarefa**, e não um JSON com as cinco: a
  // tela edita uma rota de cada vez, e uma coluna JSON faria salvar `chat` reescrever o
  // documento inteiro — perdendo a edição concorrente de outro tipo. A PK composta
  // `(user_id, workspace_id, task_type)` é o que torna cada rota independente.
  //
  // `preferencia` é JSON numa coluna porque é uma **lista ordenada** e a ordem é o dado: uma
  // tabela filha com coluna de posição responderia à mesma pergunta com duas tabelas e um
  // JOIN, para um array de no máximo quatro itens que nunca é consultado por elemento.
  //
  // `active_model` mora em tabela separada, e não como coluna de `provider_route`, porque o
  // escopo é outro: modelo é **por provider**, rota é **por tipo de tarefa**. Juntar faria o
  // mesmo modelo do Gemini ser gravado cinco vezes, uma por rota que o menciona — e as cinco
  // divergiriam na primeira troca.
  //
  // Ausência de linha nas duas é o **padrão valendo** (`ROTEAMENTO_PADRAO`, `MODELO_PADRAO`),
  // não erro: o app roteia desde o primeiro boot, sem semear linha por usuário.
  `
  CREATE TABLE provider_route (
    user_id       TEXT NOT NULL,
    workspace_id  TEXT NOT NULL,
    task_type     TEXT NOT NULL,
    preferencia   TEXT NOT NULL,   -- JSON: AiProvider[], **ordenado** (a ordem é o dado)
    preferir_local INTEGER NOT NULL,
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, task_type)
  );

  CREATE TABLE active_model (
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    provider     TEXT NOT NULL,
    model        TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, provider)
  );
  `,

  // 12 — ledger de créditos de conector (SPEC-Conectores-02, critério 8).
  //
  // **Tabelas próprias, não colunas em `budget_policy`/`cost_event`.** A decisão do PI
  // (2026-08-29) é que os dois orçamentos são independentes: a `BudgetPolicy` do MVP-005 conta
  // **USD** por usuário+espaço; este conta **créditos** por usuário+espaço+**conector**. Somar
  // os dois exigiria converter crédito em dólar, o que depende do plano contratado e produziria
  // número falso — e esconderia qual dos dois orçamentos estourou.
  //
  // O `connector` entra na PK porque o teto é **por conector**: a Tavily esgotar a cota não
  // pode barrar o GitHub, que nem cobra. Sem ele na chave, um teto só governaria todos.
  //
  // `credit_event.creditos` é NOT NULL e não NULLable como o `real_usd` do `cost_event`, e a
  // diferença é real: lá o custo pode ser desconhecido (a chamada morreu antes de o provider
  // reportar `usage`); aqui o adapter declara o consumo, e uma chamada que não consumiu
  // consumiu **zero** — que é um fato, não uma ausência.
  //
  // Ausência de linha em `connector_credit_policy` é o **padrão valendo**
  // (`tetoDeCreditosPadrao`), como em `budget_policy`: o app tem teto desde o primeiro boot,
  // sem semear linha por usuário.
  `
  CREATE TABLE connector_credit_policy (
    user_id       TEXT NOT NULL,
    workspace_id  TEXT NOT NULL,
    connector     TEXT NOT NULL,
    daily_limit   REAL NOT NULL,
    monthly_limit REAL NOT NULL,
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, connector)
  );

  CREATE TABLE credit_event (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    workspace_id  TEXT NOT NULL,
    connector     TEXT NOT NULL,
    operation     TEXT NOT NULL,
    -- O correlationId da chamada: casa o consumo com a auditoria e o log.
    correlation_id TEXT NOT NULL,
    -- Créditos consumidos. Zero é fato (o GitHub não cobra), não ausência.
    creditos      REAL NOT NULL,
    -- project_id entra no MVP-008, onde projeto nasce (spec § decisões cravadas). Nulo até lá,
    -- e a coluna existe agora para o critério 7 não exigir migration na fatia que a preencher.
    project_id    TEXT,
    created_at    TEXT NOT NULL   -- ISO UTC; é por ele que o período é recortado
  );
  CREATE INDEX idx_credit_event_escopo
    ON credit_event(user_id, workspace_id, connector, created_at);
  `,

  // 13 — `expires_at` no vault: a emenda do OAuth (SPEC-Conectores-03, critério 8).
  //
  // A M5-F01 guardava **um valor** por chave, e a SPEC-Providers-01 declarava rotação como
  // "futuro". O Device Flow traz o futuro: access token, refresh token e prazo, que só fazem
  // sentido juntos. O material secreto continua numa coluna só — cifrado como **payload
  // estruturado** —, e o que esta migration acrescenta é o único pedaço que precisa ser lido
  // **sem decifrar**.
  //
  // Por que `expires_at` fora da cifra, e por que isso não afrouxa nada: a decisão "preciso
  // renovar antes de usar?" é tomada muitas vezes, e tomá-la exigindo o DPAPI faria toda
  // consulta de estado (a tela de Configurações, inclusive) destravar o segredo para ler um
  // relógio. O prazo **não é segredo** — dizer "este token vence dia 3" não ajuda ninguém a
  // usá-lo. O segredo continua inteiro dentro do BLOB.
  //
  // NULLable porque a maioria das credenciais não expira: chave de API de provider de IA
  // (M5-F01) não tem prazo, e a GitHub App só emite expiração quando a configuração dela liga
  // expiração de user token. NULL diz "não expira"; uma data inventada diria que expira.
  //
  // `ALTER TABLE ADD COLUMN` e não recriação: a tabela pode já ter credenciais gravadas, e
  // recriá-la exigiria copiar segredo cifrado entre tabelas — mais chances de perder material
  // que o dono não consegue reemitir. Coluna nova entra vazia e as linhas antigas seguem
  // válidas, que é o comportamento correto (elas de fato não expiram).
  `
  ALTER TABLE credential_ref ADD COLUMN expires_at TEXT;
  `,

  // 14 — override do `client_id` da GitHub App (SPEC-Conectores-03, critério 7).
  //
  // **Fora do vault, e essa é a decisão que importa.** O `client_id` de uma GitHub App é público
  // por desenho no Device Flow — é ele que vai na URL que o usuário abre no navegador. Guardá-lo
  // cifrado o faria aparecer na tela de credenciais como se fosse segredo, anunciando um risco
  // que não existe e ensinando o usuário a tratar como sigiloso algo que ele vai colar de uma
  // página pública. O que **nunca** entra em lugar nenhum é private key ou client secret.
  //
  // Em `user_profile` e não numa tabela de config nova (decisão do PI, 2026-08-29): é uma coluna
  // para um campo, do mesmo jeito que `theme` e `accent_*` entraram, e uma tabela `connector_config`
  // com uma linha por usuário seria a estrutura de amanhã pagando o custo hoje. Quando a M6-F05
  // trouxer configuração de conector de verdade, a tabela nasce com o que ela precisa.
  //
  // Por usuário e não por espaço: a GitHub App pertence a quem autentica, e o NOA — onde a
  // credencial simplesmente aparece `missing` (spec § decisões cravadas) — não teria por que ter
  // um `client_id` diferente do JARVIS OS. NULL = usar o embutido.
  `
  ALTER TABLE user_profile ADD COLUMN github_client_id TEXT;
  `,

  // 15 — projeto local e sessão de planejamento (SPEC-Planejamento-01).
  //
  // **Duas tabelas, e a divisão entre elas é a decisão da fatia** (spec § Regras): `project` é
  // o que existe no disco — identidade estável que sobrevive a reinício; `planning_session` é o
  // que está em progresso — rascunho autosalvo que **não vira commit**. Uma tabela só faria o
  // estado de trabalho compartilhar o ciclo de vida da identidade, e retomar depois de um
  // reinício (critério 1) dependeria de distinguir na leitura o que a coluna não separa.
  //
  // `UNIQUE (user_id, workspace_id, slug)` é o que sustenta o critério 3: a colisão é detectada
  // **antes** de qualquer escrita em disco, por consulta, não por erro de `mkdir` no meio da
  // criação. Detectar por exceção de FS deixaria diretório parcial para trás — exatamente o que
  // o critério proíbe.
  //
  // `diretorio` também é UNIQUE por usuário: dois projetos apontando para o mesmo diretório
  // dariam dois donos ao mesmo repositório Git, e o commit de marco de um sobrescreveria o
  // histórico documental do outro. Vale para importação, onde o slug pode diferir e o
  // diretório não.
  //
  // `respostas` como TEXT com JSON e não colunas: as perguntas do wizard vêm das fatias
  // seguintes (M8-F03 em diante), e uma coluna por resposta exigiria migration a cada pergunta
  // nova. É estado de trabalho opaco — o SQLite guarda, não interpreta.
  //
  // `ultimo_marco` NULLable porque nenhum marco atingido é o estado inicial correto: uma string
  // vazia diria "marco de nome vazio", e um default `estrutura-inicial` afirmaria um commit que
  // ainda não aconteceu — e o critério 5 depende justamente de saber que ele não aconteceu.
  `
  CREATE TABLE project (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    workspace_id  TEXT NOT NULL,
    nome          TEXT NOT NULL,
    slug          TEXT NOT NULL,
    -- Canônico (symlink resolvido), como tudo que a allowlist compara.
    diretorio     TEXT NOT NULL,
    -- 'criado' | 'importado'. Guardado porque as garantias dos dois diferem.
    origem        TEXT NOT NULL,
    -- 1 quando o repositório Git já existia: o app nunca reinicializa repo existente.
    git_preexistente INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    UNIQUE (user_id, workspace_id, slug),
    UNIQUE (user_id, diretorio)
  );
  CREATE INDEX idx_project_escopo ON project(user_id, workspace_id, created_at);

  CREATE TABLE planning_session (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    workspace_id  TEXT NOT NULL,
    -- Uma sessão por projeto: retomar reabre a mesma, nunca cria outra.
    project_id    TEXT NOT NULL UNIQUE,
    etapa         TEXT NOT NULL,
    -- JSON das respostas do wizard. Opaco para esta fatia.
    respostas     TEXT NOT NULL,
    -- Último marco commitado; NULL enquanto nenhum foi atingido.
    ultimo_marco  TEXT,
    updated_at    TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );
  `,

  // 16 — ContextPack, itens do manifesto, falhas deduplicadas e uso não-monetário
  // (SPEC-Planejamento-02).
  //
  // **`context_pack` é append-only por desenho, não por convenção.** Não há `UPDATE` em lugar
  // nenhum do repositório: expandir contexto insere **outro** pack, com `pack_anterior`
  // apontando para este. Um manifesto editável descreveria um contexto que talvez não tenha
  // sido o enviado, e o critério 2 ("reproduzir quais revisões foram enviadas") passaria a
  // depender de ninguém ter mexido depois.
  //
  // `hash` é UNIQUE: dois packs com o mesmo conteúdo canônico **são** o mesmo pack, e é isso
  // que torna verificável o invariante 2 do CONVENTION §4 (mesma revisão aprovada não pede
  // aceite novo) sem comparar campo a campo.
  //
  // `context_item` em tabela filha, e não JSON numa coluna, porque o item **é consultado por
  // elemento**: "esta geração viu esta revisão deste arquivo?" é a pergunta do critério 2, e
  // respondê-la sobre um JSON exigiria varrer todos os packs e desserializar cada um.
  //
  // `excecao_*` NULLable em conjunto: ou os quatro campos existem (há exceção registrada) ou
  // nenhum existe. Um booleano `whole_repo` registraria que aconteceu sem registrar por que e
  // sob que teto — e o critério 3 pede a exceção **visível**, não o fato.
  //
  // `failure_fingerprint` tem PK composta `(user_id, project_id, fingerprint)`: o fingerprint
  // é derivado do conteúdo normalizado da falha, então a mesma falha em dois projetos colide
  // de propósito — e não pode. `resolvida` é o que sustenta o critério 4: falha resolvida não
  // volta ao prompt, e `ocorrencias` é o contador que distingue "voltou" de "nunca saiu".
  `
  CREATE TABLE context_pack (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    workspace_id  TEXT NOT NULL,
    project_id    TEXT NOT NULL,
    tarefa        TEXT NOT NULL,
    -- JSON: regras de domínio e falhas abertas, como texto já resolvido no momento do envio.
    regras        TEXT NOT NULL,
    falhas        TEXT NOT NULL,
    resumo_anterior TEXT,
    -- Orçamento da etapa. estimado_usd NULL = rota de assinatura (não se converte em USD).
    etapa         TEXT NOT NULL,
    unmetered     INTEGER NOT NULL,
    teto_de_tokens INTEGER NOT NULL,
    tokens_estimados INTEGER NOT NULL,
    estimado_usd  REAL,
    motivo_da_expansao TEXT,
    -- Exceção de leitura ampla: os quatro juntos, ou nenhum.
    excecao_motivo TEXT,
    excecao_teto_bytes INTEGER,
    excecao_autorizado_por TEXT,
    excecao_autorizado_em TEXT,
    rota          TEXT NOT NULL,
    pack_anterior TEXT,
    hash          TEXT NOT NULL UNIQUE,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX idx_context_pack_projeto ON context_pack(user_id, project_id, created_at);

  CREATE TABLE context_item (
    pack_id   TEXT NOT NULL,
    caminho   TEXT NOT NULL,
    hash      TEXT NOT NULL,
    origem    TEXT NOT NULL,
    bytes     INTEGER NOT NULL,
    -- NULL nos dois = arquivo inteiro; preenchidos = trecho, como a busca estrutural devolve.
    linha_de  INTEGER,
    linha_ate INTEGER,
    motivo    TEXT NOT NULL,
    ordem     INTEGER NOT NULL,
    PRIMARY KEY (pack_id, ordem)
  );
  CREATE INDEX idx_context_item_revisao ON context_item(hash);

  CREATE TABLE failure_fingerprint (
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    project_id   TEXT NOT NULL,
    fingerprint  TEXT NOT NULL,
    resumo       TEXT NOT NULL,
    ocorrencias  INTEGER NOT NULL,
    -- 1 = resolvida; resolvida não volta ao contexto (critério 4).
    resolvida    INTEGER NOT NULL DEFAULT 0,
    primeira_em  TEXT NOT NULL,
    ultima_em    TEXT NOT NULL,
    PRIMARY KEY (user_id, project_id, fingerprint)
  );
  `,

  // 17 — uso não-monetário no ledger de custo (SPEC-Planejamento-02, critério 1a).
  //
  // **Um ledger só, e não dois.** A mesma chamada existindo em `cost_event` e num
  // `planning_ledger` paralelo daria duas verdades sobre ela, e a primeira divergência entre
  // as duas seria descoberta por quem auditasse o gasto do mês.
  //
  // `unmetered` é coluna e não dedução do `provider`: a rota que não se converte em USD é um
  // **fato da linha**, e deduzi-lo consultando `ROTAS_UNMETERED` faria as linhas antigas
  // mudarem de significado no dia em que a lista mudar. O `estimado_usd` da rota de assinatura
  // fica NULL pela mesma razão que `real_usd` já é NULLable: zero afirmaria "custou nada",
  // NULL diz "não se converte em USD" (emenda do PI de 2026-08-29).
  //
  // Tokens e tempo entram como colunas porque são **o que a rota de assinatura registra** no
  // lugar do dinheiro (spec § Orçamento: "chamadas, tokens e tempo"). Sem eles, a linha da rota
  // de assinatura seria uma linha com todos os números vazios — indistinguível de erro.
  //
  // `project_id` fecha a pendência anotada no MVP-006: a coluna existia em `credit_event`
  // esperando o MVP-008, e é esta fatia que passa a ter projeto para preencher.
  //
  // **A tabela é recriada, e não só estendida**, por uma razão que o teste encontrou: a v10
  // criou `estimado_usd` como NOT NULL, e a rota de assinatura precisa gravar NULL ali. SQLite
  // não afrouxa NOT NULL por `ALTER`, então o caminho é o oficial (criar → copiar → trocar).
  // Alternativa recusada: gravar zero na rota de assinatura para caber no NOT NULL — que é
  // exatamente a mentira que o critério 1a existe para impedir ("custou nada" no lugar de "não
  // se converte em USD").
  //
  // O `INSERT ... SELECT` preserva as linhas existentes, incluindo os ids: a migration não pode
  // perder o ledger, que é o insumo do gate (SPEC-Fundacao-04: migration preserva dado). Elas
  // entram com `unmetered = 0` porque é o que eram — chamadas em rota paga, todas.
  `
  CREATE TABLE cost_event_novo (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    call_id      TEXT NOT NULL,
    provider     TEXT NOT NULL,
    model        TEXT NOT NULL,
    -- NULL = rota de assinatura: não se converte em USD (emenda do PI de 2026-08-29).
    estimado_usd REAL,
    real_usd     REAL,
    created_at   TEXT NOT NULL,
    unmetered    INTEGER NOT NULL DEFAULT 0,
    -- O que a rota de assinatura registra no lugar do dinheiro.
    tokens_entrada    INTEGER,
    tokens_saida      INTEGER,
    latencia_total_ms INTEGER,
    project_id        TEXT,
    context_pack_id   TEXT
  );

  INSERT INTO cost_event_novo
    (id, user_id, workspace_id, call_id, provider, model, estimado_usd, real_usd, created_at)
  SELECT id, user_id, workspace_id, call_id, provider, model, estimado_usd, real_usd, created_at
    FROM cost_event;

  DROP TABLE cost_event;
  ALTER TABLE cost_event_novo RENAME TO cost_event;
  CREATE INDEX idx_cost_event_escopo ON cost_event(user_id, workspace_id, created_at);
  `,

  // 18 — Decisões do wizard orientado (SPEC-Planejamento-03).
  //
  // **`decision` é append-only por desenho, não por convenção.** Não há `UPDATE` no repositório:
  // revisar uma resposta **insere** outra linha com `substituiu` apontando para a anterior. Um
  // `UPDATE` faria o critério 5 ("contradição nunca é corrigida silenciosamente") depender de
  // ninguém ter sobrescrito — e a decisão anterior, que a tela precisa **mostrar** ao propor a
  // substituição, já não existiria para ser mostrada.
  //
  // **Por que não guardar isto no `planning_session.respostas`.** O JSON daquela tabela é o
  // rascunho: ele sobrescreve, e é isso que se quer dele. O que ele não consegue guardar é
  // **autoria por decisão** — e sem ela a invariante 3 do CONVENTION §4 ("Decide por mim
  // registra decisão, mas não aprova gate") vira convenção verbal: nada no dado distinguiria a
  // escolha do PI da escolha delegada ao agente. `autor` é coluna justamente para que o gate
  // possa perguntar ao banco, não à memória de quem escreveu o código.
  //
  // `recomendacao` e `justificativa` são gravadas **mesmo quando o PI recusa a recomendação**:
  // a trilha precisa registrar o que foi recomendado para que a decisão contrária seja legível
  // depois. Guardar só a escolha esconderia metade do que aconteceu.
  //
  // `substituiu` referencia `decision(id)` sem `ON DELETE CASCADE` de propósito — linha de
  // trilha não é apagada em cascata; apagar a anterior arrancaria o elo que torna a
  // substituição auditável.
  `
  CREATE TABLE decision (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL,
    workspace_id   TEXT NOT NULL,
    project_id     TEXT NOT NULL,
    pergunta_id    TEXT NOT NULL,
    etapa          TEXT NOT NULL,
    -- Id da opção escolhida; NULL quando a resposta veio como texto livre.
    escolha        TEXT,
    texto          TEXT,
    -- O que fora recomendado no momento da decisão, mesmo que o PI tenha recusado.
    recomendacao   TEXT NOT NULL,
    justificativa  TEXT NOT NULL,
    -- 'pi' | 'agente'. Só 'pi' aprova gate (CONVENTION §4, invariante 3).
    autor          TEXT NOT NULL,
    motivo         TEXT NOT NULL,
    -- Decisão que esta substituiu, quando houve contradição resolvida pelo PI.
    substituiu     TEXT REFERENCES decision(id),
    created_at     TEXT NOT NULL
  );
  -- A consulta do wizard é sempre "as decisões deste projeto, na ordem em que foram tomadas":
  -- o histórico append-only só é reconstruível por ordem de inserção.
  CREATE INDEX idx_decision_projeto ON decision(user_id, project_id, created_at);
  `,

  // 19 — Evidência extraída e pacote estrutural (SPEC-Planejamento-04).
  //
  // **Por que persistir a evidência, e não só citá-la no `LANDSCAPE.md`.** O critério 7 pede
  // que os três documentos formem revisão imutável, e o 2 exige evidência extraída por
  // conclusão material. Sem a linha no banco, reabrir o projeto perde a prova: `conteudoMudou`
  // (M6-F06) precisa do `hash_conteudo` guardado para dizer que a fonte mudou desde a coleta, e
  // re-extrair para descobrir isso gastaria crédito para responder o que já sabíamos.
  //
  // `hash_conteudo` **não** é UNIQUE, ao contrário do `hash` do `context_pack`. Duas coletas da
  // mesma URL em datas diferentes com o mesmo conteúdo são dois fatos — "em 10/03 ainda dizia
  // isto" é exatamente o que um gatilho de revisão precisa afirmar. O que dedupe dentro de uma
  // coleta é `deduplicar()`, no momento da extração; o histórico entre coletas fica.
  //
  // `conteudo` guarda o texto extraído inteiro, e não só o trecho: `conteudoMudou` compara o
  // hash do conteúdo **atual** com o guardado, e `trechoConfere` precisa provar que a citação
  // saiu daquele conteúdo. Guardar só o trecho tornaria as duas verificações impossíveis.
  `
  CREATE TABLE evidence (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL,
    workspace_id   TEXT NOT NULL,
    project_id     TEXT NOT NULL,
    -- URL canônica (dedupe) e a original (reproduz a chamada) — as duas, como na M6-F05.
    url            TEXT NOT NULL,
    url_original   TEXT NOT NULL,
    dominio        TEXT NOT NULL,
    titulo         TEXT,
    publicado_em   TEXT,
    coletado_em    TEXT NOT NULL,
    conteudo       TEXT NOT NULL,
    -- Detecta que a fonte mudou entre revisões.
    hash_conteudo  TEXT NOT NULL,
    -- Prova que a citação corresponde ao extraído. NULL quando não houve trecho citado.
    trecho         TEXT,
    hash_trecho    TEXT,
    request_id     TEXT,
    created_at     TEXT NOT NULL
  );
  CREATE INDEX idx_evidence_projeto ON evidence(user_id, project_id, created_at);
  CREATE INDEX idx_evidence_url ON evidence(user_id, project_id, url);

  -- O pacote estrutural: os três documentos como uma revisão só.
  --
  -- **Append-only, como o "context_pack".** Regerar não edita: insere outro pacote. Um "UPDATE"
  -- faria o "hash" descrever um conteúdo que talvez não seja o que virou commit, e o invariante
  -- 2 do CONVENTION §4 (mesma revisão não pede aceite de novo) passaria a depender de ninguém
  -- ter mexido depois.
  --
  -- "hash" é UNIQUE: dois pacotes com o mesmo conteúdo canônico **são** a mesma revisão — é o
  -- que permite à M8-F06 reconhecer que nada mudou e não pedir aceite outra vez.
  --
  -- "commit_hash" nasce NULL e é preenchido quando o marco vira commit. Nulo não é falha: o
  -- pacote existe antes de ser commitado, e a M8-F01 já estabeleceu que falha de commit
  -- preserva os dados e oferece retomada.
  CREATE TABLE pacote_estrutural (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL,
    workspace_id   TEXT NOT NULL,
    project_id     TEXT NOT NULL,
    -- JSON dos três documentos: caminho, conteúdo, hash e afirmações com origem.
    documentos     TEXT NOT NULL,
    hash           TEXT NOT NULL UNIQUE,
    commit_hash    TEXT,
    created_at     TEXT NOT NULL
  );
  CREATE INDEX idx_pacote_projeto ON pacote_estrutural(user_id, project_id, created_at);
  `,

  // SPEC-Planejamento-05: os anexos de design do PI e o pacote de arquitetura.
  //
  // "anexado_em" não é um "created_at" com outro nome, e a distinção é o gate inteiro: a decisão
  // do PI (2026-08-29) é que o anexo entra por **seletor que copia e hasheia no ato**, e é esse
  // instante que faz o arquivo contar. Um arquivo largado no diretório do projeto por fora não
  // gera linha aqui e **não** satisfaz o gate (critério 7) — não há varredura de pasta que o
  // encontre, de propósito: varrer tornaria ambíguo o instante em que o anexo passa a valer.
  //
  // "hash" é do conteúdo **copiado**, calculado no ato. É ele que o pacote de arquitetura cita
  // (critério 6: o pacote registra os hashes de todos os anexos e saídas).
  //
  // "origem" guarda o caminho externo escolhido — auditoria, não ponteiro. O projeto guarda a
  // cópia, e o original pode sumir sem que o anexo deixe de valer.
  //
  // Sem UNIQUE em "hash": anexar o mesmo arquivo duas vezes são **dois atos**, e o segundo é um
  // fato tanto quanto o primeiro. O que precisa ser único é o destino — daí o índice em
  // (user_id, project_id, caminho), que faz reanexar substituir a linha em vez de duplicá-la.
  `
  CREATE TABLE design_attachment (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    project_id   TEXT NOT NULL,
    tipo         TEXT NOT NULL,
    -- Caminho relativo à raiz do projeto: onde a cópia ficou.
    caminho      TEXT NOT NULL,
    -- O caminho externo de onde o PI tirou o arquivo. Auditoria.
    origem       TEXT NOT NULL,
    hash         TEXT NOT NULL,
    bytes        INTEGER NOT NULL,
    -- O instante do ato. É ele que faz o anexo contar para o gate.
    anexado_em   TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_anexo_destino ON design_attachment(user_id, project_id, caminho);
  CREATE INDEX idx_anexo_projeto ON design_attachment(user_id, project_id, anexado_em);

  -- O pacote de arquitetura: ARCHITECTURE, DECISIONS, TESTING e REVIEW como uma revisão só.
  --
  -- Tabela própria, e não mais linhas em "pacote_estrutural", porque as duas revisões respondem
  -- perguntas diferentes e fecham em marcos diferentes ("prd-aprovado" e "arquitetura-aprovada").
  -- Sob uma tabela só, "qual PRD esta arquitetura assume?" viraria uma busca por data em vez de
  -- uma coluna — e o critério 3 (design e arquitetura referenciam a mesma revisão do PRD) é
  -- exatamente essa pergunta.
  --
  -- "pacote_estrutural_id" é o que torna o critério 3 estrutural: a arquitetura aponta para a
  -- revisão do PRD que ela assume, e não para "o PRD mais recente" — que mudaria sob os pés dela.
  --
  -- Append-only pela terceira vez, pela mesma razão: regerar insere, e "hash" UNIQUE reconhece
  -- quando o conteúdo é o mesmo.
  CREATE TABLE pacote_arquitetura (
    id                   TEXT PRIMARY KEY,
    user_id              TEXT NOT NULL,
    workspace_id         TEXT NOT NULL,
    project_id           TEXT NOT NULL,
    -- A revisão do PRD que esta arquitetura assume (critério 3).
    pacote_estrutural_id TEXT NOT NULL,
    -- JSON dos quatro documentos: caminho, conteúdo, hash e afirmações com origem.
    documentos           TEXT NOT NULL,
    -- JSON dos hashes dos anexos que estavam no gate quando a arquitetura saiu (critério 6).
    anexos               TEXT NOT NULL,
    hash                 TEXT NOT NULL UNIQUE,
    commit_hash          TEXT,
    created_at           TEXT NOT NULL
  );
  CREATE INDEX idx_arquitetura_projeto ON pacote_arquitetura(user_id, project_id, created_at);
  `,

  // SPEC-Planejamento-06: o roadmap do projeto gerado e as aprovações por revisão.
  //
  // "mvp" e "slice" guardam o roadmap **composto** das decisões e das jornadas — cada linha
  // carrega "origem_tipo" e o par que a identifica, pela mesma razão da M8-F04: não existe
  // origem "modelo", e uma linha sem origem seria um MVP que ninguém decidiu.
  //
  // "estado" separa "proposto" de "na-fila", que é o critério 3: MVP futuro permanece proposta
  // até entrar na fila, e a transição é o gate MVP_ENTRY — um ato do PI, nunca consequência de
  // gerar o roadmap. Com um campo só, "planejado" e "aprovado para execução" seriam a mesma
  // coisa.
  //
  // "depende_de" é JSON de ids: um MVP pode depender de dois, e achatar isso em coluna única
  // obrigaria a inventar uma ordem entre dependências que o PI não decidiu.
  `
  CREATE TABLE mvp (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    project_id   TEXT NOT NULL,
    numero       INTEGER NOT NULL,
    titulo       TEXT NOT NULL,
    tese         TEXT NOT NULL,
    -- 'proposto' | 'na-fila' | 'concluido'. O default é o critério 3.
    estado       TEXT NOT NULL DEFAULT 'proposto',
    -- JSON com os ids dos MVPs de que este depende.
    depende_de   TEXT NOT NULL DEFAULT '[]',
    -- A origem da composição: 'decisao' ou 'evidencia'. Nunca 'modelo'.
    origem_tipo  TEXT NOT NULL,
    origem_ref   TEXT NOT NULL,
    origem_chave TEXT NOT NULL,
    created_at   TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_mvp_numero ON mvp(user_id, project_id, numero);
  CREATE INDEX idx_mvp_projeto ON mvp(user_id, project_id, numero);

  -- A fatia: a unidade executável. "spec_slug" é o par que a invariante 1 protege — o STATUS.md
  -- gerado é a fonte única de Fatia ↔ SPEC, e este campo é o que ele escreve. Nenhuma outra
  -- estrutura o guarda em paralelo, porque duas fontes divergiriam no dia em que uma mudasse.
  --
  -- "detalhada" marca a única fatia com SPEC executável (§ Saídas): detalhar o roadmap inteiro
  -- produziria specs para fatias cujo contexto ainda vai mudar, e o custo não é o texto
  -- desperdiçado — é o PI aprovando o que não vai valer.
  CREATE TABLE slice (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    project_id   TEXT NOT NULL,
    mvp_id       TEXT NOT NULL,
    numero       INTEGER NOT NULL,
    titulo       TEXT NOT NULL,
    spec_slug    TEXT NOT NULL,
    detalhada    INTEGER NOT NULL DEFAULT 0,
    origem_tipo  TEXT NOT NULL,
    origem_ref   TEXT NOT NULL,
    origem_chave TEXT NOT NULL,
    created_at   TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_slice_numero ON slice(user_id, project_id, mvp_id, numero);
  CREATE INDEX idx_slice_mvp ON slice(user_id, project_id, mvp_id, numero);

  -- A aprovação de um gate, com o conjunto **exato** de revisões (critério 4).
  --
  -- "revisoes" é JSON de {artefato, hash}: é por ele que o critério 5 decide se a revisão é a
  -- mesma. Guardar um "aprovado_em" e comparar datas responderia "algo aconteceu depois", que
  -- não é a pergunta — o conteúdo pode ter voltado a ser o que era.
  --
  -- "identidade" é o usuário autenticado que aprovou (decisão cravada da spec): sem sessão
  -- válida não há aprovação, e o gate falha fechado em vez de aprovar como anônimo.
  --
  -- Não há coluna "autor": o tipo do domínio admite só 'pi', e uma coluna que aceitasse
  -- 'agente' seria o caminho por onde a delegação aprovaria gate — exatamente o que o critério
  -- 7 e a invariante 3 proíbem. A ausência é a garantia.
  --
  -- Append-only, como os pacotes: reaprovar insere outra linha. Um UPDATE faria "o que o PI
  -- aprovou" depender de ninguém ter mexido depois.
  CREATE TABLE approval (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    project_id   TEXT NOT NULL,
    gate         TEXT NOT NULL,
    -- JSON: [{ artefato, hash }]. O conjunto exato aprovado.
    revisoes     TEXT NOT NULL,
    identidade   TEXT NOT NULL,
    created_at   TEXT NOT NULL
  );
  CREATE INDEX idx_approval_gate ON approval(user_id, project_id, gate, created_at);
  `,

  // 22 — referências externas da publicação (SPEC-Entrega-01, emenda 6 de 2026-08-30).
  //
  // O que o app publicou no GitHub, e onde. Sem esta tabela, cada fatia seguinte teria de
  // **redescobrir na origem** o que a M9-F01 acabou de criar: a M9-F05 precisa do número da
  // issue para escrever `refs #N`, e a reconciliação da M9-F02 precisa dos SHAs. Redescobrir
  // é uma chamada de rede a mais por fatia e uma resposta que pode ter mudado no intervalo.
  //
  // `alvo` + `chave_externa` é o par que identifica o recurso: `alvo` diz **o que é**
  // (repositório, issue, branch), `chave_externa` diz **qual** — a mesma chave determinística
  // que o corpo da issue carrega. O `UNIQUE` sobre eles é o que faz republicar atualizar em
  // vez de acumular linhas, e é a metade local da idempotência que o `ensure*` garante do
  // lado do GitHub.
  //
  // `limitacao` guarda o que **não** foi possível fazer (emenda 2): proteção de branch recusada
  // por plano da conta é limitação registrada, não falha da publicação. Guardá-la aqui, junto
  // do recurso, é o que permite a M9-F05 ler "esta branch não tem proteção" sem perguntar de
  // novo à origem — e sem confundir "não protegida" com "ainda não publicada".
  `
  CREATE TABLE external_ref (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    workspace_id  TEXT NOT NULL,
    project_id    TEXT NOT NULL,
    -- 'repositorio' | 'issue' | 'branch'. Enum no domínio; TEXT aqui, como o resto do schema.
    alvo          TEXT NOT NULL,
    chave_externa TEXT NOT NULL,
    -- O id do recurso na origem: owner/repo, o número da issue, o nome da branch.
    ref_id        TEXT NOT NULL,
    url           TEXT,
    -- O SHA publicado, quando o recurso tem um (branch). NULL para issue.
    sha           TEXT,
    -- O que não foi possível configurar, e por quê. NULL quando não há limitação.
    limitacao     TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_external_ref_chave
    ON external_ref(user_id, project_id, alvo, chave_externa);
  `,

  // 23 — execução durável: runs, leases e o kill-switch do merge (SPEC-Entrega-02).
  //
  // Três tabelas, e cada uma existe por um critério distinto.
  //
  // `pipeline_run` é o estado da execução de uma fatia. Ele **não mora em `slice`** porque uma
  // fatia pode ter mais de um run: bloqueio resolvido cria continuação vinculada
  // (`continua_de`), e guardar o estado na fatia sobrescreveria a história que o critério 4
  // precisa reconstituir. `bloqueio` é JSON com os cinco campos da CONVENTION §4 — NULL fora de
  // `BLOCKED`, e o serviço recusa `BLOCKED` sem eles (critério 6).
  //
  // `lease` é a posse durável de um recurso. **O slot global de WIP é uma linha como as
  // outras**, com `recurso = 'wip:global'` e `project_id` NULL (emenda 1 de 2026-08-30):
  // modelá-lo à parte criaria uma segunda regra de expiração, e a esquecida seria a que trava a
  // máquina. O `UNIQUE` sobre `(user_id, recurso)` é o que faz o WIP=1 valer no banco e não só
  // no código — duas transações concorrentes não conseguem inserir o mesmo recurso, mesmo que a
  // checagem em memória de ambas tenha visto o slot livre.
  //
  // `expira_em` e `heartbeat_em` são epoch ms (INTEGER), não texto ISO: a comparação de
  // expiração é aritmética e roda em toda aquisição, e comparar string de data no SQLite
  // convidaria a um bug de fuso no dia em que alguém gravasse com offset.
  //
  // `project_merge_policy` é o kill-switch por projeto (decisão do PI, 2026-08-30). Linha só
  // existe quando alguém **desligou** o merge — a ausência é o default ligado, que é a tese do
  // MVP-009. Um default gravado em toda criação de projeto significaria migrar linhas no dia em
  // que o default mudasse; a ausência não precisa migrar.
  `
  CREATE TABLE pipeline_run (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    project_id   TEXT NOT NULL,
    slice_id     TEXT NOT NULL,
    -- 'PLANNED' | 'AWAITING_PI' | 'READY' | 'RUNNING' | 'VALIDATING' | 'PR_CI'
    -- | 'MERGED' | 'AWAITING_MERGE' | 'BLOCKED' | 'CANCELLED'. Enum no domínio.
    estado       TEXT NOT NULL,
    -- O run de que este é continuação, quando houver. NULL no primeiro run da fatia.
    continua_de  TEXT,
    -- JSON com os cinco campos do BloqueioExterno. NULL fora de 'BLOCKED'.
    bloqueio     TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  CREATE INDEX idx_pipeline_run_fatia
    ON pipeline_run(user_id, project_id, slice_id, created_at);
  CREATE INDEX idx_pipeline_run_estado ON pipeline_run(user_id, estado);

  CREATE TABLE lease (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    -- O id do run que detém o recurso. Não existe lease sem proprietário.
    proprietario  TEXT NOT NULL,
    -- 'wip:global', um worktree, uma porta, um container.
    recurso       TEXT NOT NULL,
    -- NULL no slot global de WIP: ele é da máquina, não de um projeto.
    project_id    TEXT,
    heartbeat_em  INTEGER NOT NULL,
    expira_em     INTEGER NOT NULL,
    created_at    TEXT NOT NULL
  );
  -- O WIP=1 vale no banco, não só no código: duas transações não inserem o mesmo recurso.
  CREATE UNIQUE INDEX idx_lease_recurso ON lease(user_id, recurso);

  CREATE TABLE project_merge_policy (
    project_id   TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    -- 0 = kill-switch acionado (merge autônomo desligado). Linha ausente = ligado.
    autonomo     INTEGER NOT NULL,
    -- Quem desligou/religou e quando: a mudança é ação sensível (M9-F05).
    identidade   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (user_id, project_id)
  );
  `,

  // 24 — M9-F03: paths permitidos do run e correlação de custo com run/tentativa.
  //
  // `context_pack_path` é tabela filha com `ordem` (o modelo de `context_item`) e não JSON numa
  // coluna: a lista é consultada por path quando o critério 6 mede fuga de escopo, e um JSON
  // obrigaria a ler e parsear o pack inteiro para responder "este arquivo estava autorizado?".
  //
  // `run_id`/`tentativa` em `cost_event` são a emenda 7 de 2026-08-31: o critério 11 exige custo
  // atribuído ao run e à tentativa, e correlacionar por `context_pack_id` deixaria a atribuição
  // indireta e a tentativa sem representação nenhuma. Nulos porque toda chamada de IA anterior a
  // esta fatia — e toda chamada fora de pipeline — não tem run.
  `
  CREATE TABLE context_pack_path (
    pack_id       TEXT NOT NULL,
    -- Prefixo relativo à raiz do worktree.
    caminho       TEXT NOT NULL,
    -- 'spec' (a SPEC declarou) | 'derivada' (o preflight inferiu da arquitetura aprovada).
    origem        TEXT NOT NULL,
    justificativa TEXT NOT NULL,
    ordem         INTEGER NOT NULL,
    PRIMARY KEY (pack_id, ordem)
  );

  ALTER TABLE cost_event ADD COLUMN run_id TEXT;
  ALTER TABLE cost_event ADD COLUMN tentativa INTEGER;
  CREATE INDEX idx_cost_event_run ON cost_event(user_id, run_id);
  `,

  // 25 — EffectJournal: intenção antes do I/O, confirmação depois (SPEC-Entrega-02, § Diário de
  // efeitos; issue #209).
  //
  // `chave_idempotente` é o `idempotencyKey` do request, ou o `correlation_id` quando ausente
  // (leitura, que não tem chave repetível) — a mesma uniformidade que já existia no par de
  // auditoria `fase: 'requisicao'`/`'conclusao'`. `UNIQUE(user_id, chave_idempotente)` é o que
  // faz "chave igual, payload diferente" um conflito detectável **antes** do I/O: o segundo
  // `INSERT` para a mesma chave falha aqui, não depois de uma segunda chamada de rede.
  //
  // `fingerprint` é o hash de `connector:operation` + `input` normalizado. É o que distingue
  // "mesma intenção, repetida com segurança" (mesma chave, mesmo fingerprint — completa sem
  // repetir I/O) de "conflito" (mesma chave, fingerprint diferente — falha antes de sair).
  //
  // Sem `ON CONFLICT DO UPDATE`, pela mesma razão do `lease`: sobrescrever silenciosamente uma
  // intenção existente esconderia o conflito que o critério 3 pede para falhar alto. Quem decide
  // o que fazer com o conflito é o serviço, a partir da violação do `UNIQUE`.
  //
  // `estado` nasce `'pendente'` no INSERT da intenção; a conclusão faz UPDATE para
  // `'confirmed'` | `'ambiguous'` | `'failed'`, com `external_ref_id` quando houver referência.
  // Não é append-only como `audit_event`: esta tabela guarda **o estado atual de uma intenção**,
  // não uma trilha — é a reconciliação, lendo por `estado = 'pendente'`, que decide o que fazer
  // com o que não chegou a confirmar.
  `
  CREATE TABLE effect_journal (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL,
    workspace_id      TEXT NOT NULL,
    chave_idempotente TEXT NOT NULL,
    fingerprint       TEXT NOT NULL,
    -- 'connector:operation'.
    alvo              TEXT NOT NULL,
    correlation_id    TEXT NOT NULL,
    -- 'pendente' | 'confirmed' | 'ambiguous' | 'failed'. Enum no domínio.
    estado            TEXT NOT NULL,
    external_ref_id   TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_effect_journal_chave ON effect_journal(user_id, chave_idempotente);
  CREATE INDEX idx_effect_journal_estado ON effect_journal(user_id, estado);
  `,

  // 26 — M9-F04: estado de quota das rotas subscription_limited (SPEC-Entrega-04, critério 12).
  //
  // Uma linha por (user_id, workspace_id, provider), sobrescrita — como `budget_policy` e não
  // como `cost_event`: isto é o status atual da quota, não um evento financeiro. Ausência de
  // linha é `origem = 'desconhecida'` em código, não uma linha semeada — mesmo raciocínio do
  // `BudgetRepository.find`: nenhum boot precisa migrar dado para o default valer.
  `
  CREATE TABLE provider_quota_state (
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    provider     TEXT NOT NULL,
    -- 'medida' | 'estimada' | 'desconhecida'. Enum no domínio.
    origem       TEXT NOT NULL,
    restante     INTEGER,
    limite       INTEGER,
    reset_em     TEXT,
    atualizado_em TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, provider)
  );
  `,

  // 27 — M9-F05: snapshot do conjunto obrigatório observado na origem (SPEC-Entrega-05, crit. 11).
  //
  // **Append-only**, ao contrário de `project_merge_policy`: cada observação é uma linha nova.
  // Sobrescrever daria o estado corrente e apagaria a prova de que a regra mudou no meio do run —
  // e é essa prova que a reconciliação do critério 11 existe para produzir. Por isso não há chave
  // primária composta que force upsert: a identidade da linha é a observação, não o run.
  //
  // `contexts` é JSON num TEXT porque a lista é lida e escrita inteira, nunca consultada por
  // elemento; uma tabela filha só para isso daria join sem pergunta que o justifique.
  `
  CREATE TABLE ruleset_snapshot (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    workspace_id        TEXT NOT NULL,
    project_id          TEXT NOT NULL,
    run_id              TEXT NOT NULL,
    branch              TEXT NOT NULL,
    -- JSON: array de strings com os contexts exigidos.
    contexts            TEXT NOT NULL,
    strict              INTEGER NOT NULL,
    protegida           INTEGER NOT NULL,
    merge_queue_exigida INTEGER NOT NULL,
    ref                 TEXT NOT NULL,
    observado_em        TEXT NOT NULL
  );
  CREATE INDEX idx_ruleset_snapshot_run ON ruleset_snapshot(user_id, run_id, observado_em);
  `,
  // 28 — ExecutionLedger (SPEC-Entrega-06, critérios 1 e 2). A prova de que um run aconteceu.
  //
  // `UNIQUE(user_id, run_id)`: a prova é **uma** por run. Ao contrário de `external_ref`, que
  // guarda onde o recurso está (um fato que muda) e por isso faz upsert, este guarda o que
  // aconteceu — e regravar apagaria a evidência. Retomada cria run novo (`continuaDe`), nunca
  // reescreve o anterior. O `UNIQUE` põe a regra no banco em vez de confiar no chamador.
  `
  CREATE TABLE execution_ledger (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    project_id    TEXT NOT NULL,
    run_id        TEXT NOT NULL,
    estado_final  TEXT NOT NULL,
    duracao_ms    INTEGER NOT NULL,
    tentativas    INTEGER NOT NULL,
    tokens        INTEGER NOT NULL,
    creditos      REAL NOT NULL,
    custo_usd     REAL NOT NULL,
    eventos       TEXT NOT NULL,
    head_sha      TEXT,
    merge_sha     TEXT,
    checks        TEXT NOT NULL,
    artefatos     TEXT NOT NULL,
    encerrado_em  TEXT NOT NULL,
    UNIQUE(user_id, run_id)
  );
  CREATE INDEX idx_execution_ledger_run ON execution_ledger(user_id, run_id);
  `,
  // 29 — retenção e pendência de limpeza (SPEC-Entrega-06, critérios 5 e 9).
  //
  // `expirado_em` em vez de DELETE: expirar tira o **anexo pesado**, não a prova. Hash, bytes e
  // data continuam na linha, porque é o hash que o ledger referencia — apagar a linha deixaria
  // uma referência versionada apontando para o nada, que é o que o critério 9 proíbe.
  `
  CREATE TABLE artefato_retido (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    run_id        TEXT NOT NULL,
    hash          TEXT NOT NULL,
    bytes         INTEGER NOT NULL,
    criado_em     TEXT NOT NULL,
    fixado        INTEGER NOT NULL,
    estado_do_run TEXT NOT NULL,
    expirado_em   TEXT
  );
  CREATE INDEX idx_artefato_retido_user ON artefato_retido(user_id, criado_em);

  CREATE TABLE pendencia_de_limpeza (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    run_id        TEXT NOT NULL,
    recurso       TEXT NOT NULL,
    identificador TEXT NOT NULL,
    motivo        TEXT NOT NULL,
    em            TEXT NOT NULL,
    resolvida_em  TEXT
  );
  CREATE INDEX idx_pendencia_limpeza_user ON pendencia_de_limpeza(user_id, em);
  `,

  // 30 — a etapa da jornada de planejamento (SPEC-Jornada-01, critérios 1, 2 e 6).
  //
  // **Coluna nova, e não reaproveitamento da `etapa` existente.** Aquela guarda a etapa do
  // *wizard* (`inicio`, `contexto`) — qual grupo de perguntas o catálogo preenche —, que é
  // outro conceito: não é posição numa trilha. Reusá-la faria o wizard e a jornada disputarem
  // um campo só, e o primeiro a escrever apagaria a leitura do outro.
  //
  // **`DEFAULT 'prompt'` é a migração inteira** (critério 6). Projeto existente não tem brief
  // nem origem de modelo, então nenhum evento da jornada consta e a etapa derivada dele é
  // `prompt` de qualquer forma — o default coincide com o cálculo, e não há dado a converter.
  // Nada é apagado: as respostas do wizard e as decisões gravadas continuam onde estão.
  //
  // A coluna é **cache**, não fonte de verdade: quando ela discorda do que as aprovações e os
  // marcos sustentam, o serviço recalcula e audita o desvio (critério 2).
  `
  ALTER TABLE planning_session ADD COLUMN etapa_da_jornada TEXT NOT NULL DEFAULT 'prompt';

  -- O motivo da última regressão por invalidação de gate (critério 7). NULL enquanto nenhuma
  -- aconteceu: a tela só mostra o motivo quando há um, e uma string vazia obrigaria todo call
  -- site a distinguir "não regrediu" de "regrediu sem motivo".
  ALTER TABLE planning_session ADD COLUMN motivo_da_regressao TEXT;
  `,

  // 31 — o prompt do PI e o brief refinado (SPEC-Jornada-02).
  //
  // **Duas tabelas, e a separação é o critério 1.** O prompt é o que o PI escreveu: texto dele,
  // que vira revisão `PROMPT.md` no Git. O brief é o que a IA produziu a partir dele. Guardá-los
  // juntos faria "o que o PI disse" e "o que o modelo inferiu" compartilharem uma linha — e é
  // exatamente essa distinção que a origem por afirmação existe para manter.
  //
  // **Append-only nas duas, como `pacote_estrutural`.** Não há `UPDATE`: editar o prompt insere
  // outra linha, e regenerar o brief insere outro. O critério 4 pede reproduzir *qual* revisão
  // o PI aceitou, e uma linha editável descreveria um brief que talvez não seja o que ele leu.
  //
  // `afirmacoes` e `pendencias` em JSON pelo mesmo motivo que os documentos do pacote: são lidos
  // e escritos sempre inteiros, junto com o brief, e nunca consultados por campo. Uma tabela por
  // afirmação só pagaria a junção se alguém quisesse buscar afirmação isolada — ninguém quer.
  `
  CREATE TABLE project_prompt (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    workspace_id  TEXT NOT NULL,
    project_id    TEXT NOT NULL,
    texto         TEXT NOT NULL,
    -- Hash do conteúdo: é por ele que a revisão é citada e que a invalidação de gate compara.
    hash          TEXT NOT NULL,
    -- Commit do marco documental, quando houve. NULL enquanto o prompt não virou revisão.
    commit_hash   TEXT,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX idx_project_prompt ON project_prompt(user_id, project_id, created_at);

  CREATE TABLE project_brief (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    workspace_id  TEXT NOT NULL,
    project_id    TEXT NOT NULL,
    -- O prompt que originou este brief. Sem ele, um brief seria texto sem procedência.
    prompt_id     TEXT NOT NULL,
    -- JSON das afirmações, cada uma com bloco, texto e origem obrigatória.
    afirmacoes    TEXT NOT NULL,
    -- JSON das pendências declaradas; material bloqueia o aceite.
    pendencias    TEXT NOT NULL,
    hash          TEXT NOT NULL UNIQUE,
    commit_hash   TEXT,
    -- O ContextPack que gerou este brief (SPEC-Planejamento-02): é o manifesto do que foi
    -- enviado ao modelo, e o critério 7 exige poder reproduzi-lo. (Sem crase no comentário: a
    -- migration é template literal, e um backtick aqui fecharia a string — o mesmo defeito que
    -- a M8-F04 registrou.)
    context_pack_id TEXT,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX idx_project_brief ON project_brief(user_id, project_id, created_at);
  `,

  // 32 — as perguntas de refinamento geradas por IA (SPEC-Jornada-02, § Refinamento).
  //
  // **Por que não é o `decision` sozinho.** `decision` guarda a *resposta*; ele não guarda a
  // *pergunta* quando ela não vem de um catálogo fixo em código. A M8-F03 podia deixar a
  // pergunta implícita porque `CATALOGO_DO_CONTEXTO` é código versionado — reabrir o wizard
  // relia o mesmo array. Aqui a pergunta é gerada por projeto, a partir do prompt daquele
  // projeto: sem persisti-la, reabrir o projeto no meio do refinamento perderia o enunciado, as
  // opções e a justificativa que o PI estava lendo.
  //
  // **Append-only, a quinta vez com esta postura.** Regenerar recalcula os blocos ainda vazios
  // e insere as perguntas que faltam; nunca edita uma já feita — se o PI já a respondeu, ela
  // não deveria mudar de baixo dele.
  //
  // `opcoes` em JSON: são sempre lidas e escritas inteiras junto com a pergunta, nunca uma
  // opção isolada — mesma razão de `afirmacoes` em `project_brief`.
  `
  CREATE TABLE pergunta_gerada (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    workspace_id  TEXT NOT NULL,
    project_id    TEXT NOT NULL,
    -- O brief cuja lacuna esta pergunta preenche.
    bloco         TEXT NOT NULL,
    -- Por que o modelo está perguntando isto — mostrado ao PI como justificativa (design §9.1).
    por_que       TEXT NOT NULL,
    titulo        TEXT NOT NULL,
    enunciado     TEXT NOT NULL,
    -- JSON de OpcaoDaPergunta[]: id, rótulo e impacto por opção.
    opcoes        TEXT NOT NULL,
    recomendada   TEXT NOT NULL,
    justificativa TEXT NOT NULL,
    aceita_texto_livre INTEGER NOT NULL,
    delegavel     INTEGER NOT NULL,
    -- 'pendente' até o PI responder; então vira 'respondida'. Uma pergunta 'respondida' não
    -- volta a ser oferecida, mesmo que o refinamento seja retomado.
    estado        TEXT NOT NULL DEFAULT 'pendente',
    created_at    TEXT NOT NULL
  );
  CREATE INDEX idx_pergunta_gerada_projeto ON pergunta_gerada(user_id, project_id, created_at);
  `,

  // 33 — o PRD, o Landscape e a Convention gerados por IA (SPEC-Jornada-03).
  //
  // **Tabela própria, e não mais linhas em "pacote_estrutural".** As duas respondem perguntas
  // diferentes: aquela guarda documentos *compostos*, com origem em duas variantes (decisão e
  // evidência); esta guarda documentos *gerados*, com quatro origens e âncora no brief. Enfiar
  // as quatro origens no JSON da tabela antiga faria toda leitura dela ter de adivinhar qual
  // formato está lendo — e a M8-F05 lê aquela tabela para amarrar a revisão do PRD que a
  // arquitetura assume. O serviço grava nas duas: aqui o conteúdo verificável, lá a revisão
  // que a arquitetura cita, com o mesmo hash ligando as duas.
  //
  // **Append-only, a sexta vez com esta postura.** Regenerar insere outra linha; o hash UNIQUE
  // reconhece quando o conteúdo é o mesmo. Regenerar depois do aceite cria revisão nova e
  // reabre o gate — nunca substitui a aceita (regra da spec, § Regras).
  //
  // "brief_hash" é a revisão do brief que originou estes documentos, e não o id: o aceite é por
  // revisão exata, e um id apontaria para uma linha cujo conteúdo o PI não necessariamente leu.
  `
  CREATE TABLE project_prd (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    workspace_id    TEXT NOT NULL,
    project_id      TEXT NOT NULL,
    brief_hash      TEXT NOT NULL,
    -- JSON das afirmacoes, cada uma com documento, secao, texto e origem obrigatoria.
    afirmacoes      TEXT NOT NULL,
    -- JSON das contradicoes detectadas; nao vazia bloqueia o aceite (criterio 6).
    contradicoes    TEXT NOT NULL,
    -- JSON do BloqueioExterno quando a pesquisa nao saiu. NULL quando o Landscape foi gerado.
    bloqueio        TEXT,
    hash            TEXT NOT NULL UNIQUE,
    commit_hash     TEXT,
    context_pack_id TEXT,
    created_at      TEXT NOT NULL
  );
  CREATE INDEX idx_project_prd ON project_prd(user_id, project_id, created_at);
  `,

  // 34 — a arquitetura, as decisões, os testes e a revisão gerados por IA (SPEC-Jornada-04).
  //
  // **Tabela própria, e não mais colunas em "pacote_arquitetura"**, pela mesma razão que a 33
  // separou "project_prd" de "pacote_estrutural": aquela guarda os quatro documentos
  // *compostos* das decisões do wizard, esta guarda os *gerados*, com quatro origens e âncora no
  // protótipo. O que a M8-F05 gravava lá continua sendo lido por quem já lia — o gate
  // "PROJECT_PACKAGE" monta as revisões a partir de "pacote_arquitetura" —, e o serviço grava
  // nas duas com o mesmo hash ligando-as.
  //
  // "anexos" é o congelamento do gate no instante da geração (critério 5): os hashes de todos os
  // anexos, como estavam. É o que permite ao validador dizer, depois, que uma âncora aponta para
  // conteúdo que mudou — sem essa cópia, "o protótipo que sustentou este fluxo" seria sempre o
  // arquivo de agora, e a âncora envelheceria em silêncio.
  //
  // "ajustes" guarda a análise de coerência (critério 4). Eles vivem na revisão, e não numa
  // tabela de sugestões, porque são fato *sobre aquela revisão*: regerar produz outra análise,
  // e misturar as duas faria o PI autorizar um ajuste que já não descreve o que está no disco.
  //
  // Append-only, a sétima vez com esta postura. Regenerar insere outra linha; o hash UNIQUE
  // reconhece quando o conteúdo é o mesmo. Regenerar depois do aceite cria revisão nova e
  // reabre o gate — nunca substitui a aceita (critério 6).
  `
  CREATE TABLE project_architecture (
    id                   TEXT PRIMARY KEY,
    user_id              TEXT NOT NULL,
    workspace_id         TEXT NOT NULL,
    project_id           TEXT NOT NULL,
    -- A revisao do PRD que esta arquitetura assume (criterio 3).
    pacote_estrutural_id TEXT NOT NULL,
    -- JSON das afirmacoes, cada uma com documento, secao, texto e origem obrigatoria.
    afirmacoes           TEXT NOT NULL,
    -- JSON dos ajustes propostos pela analise de coerencia; nunca aplicados ao anexo.
    ajustes              TEXT NOT NULL,
    -- JSON dos anexos com hash, como estavam quando a arquitetura saiu (criterio 5).
    anexos               TEXT NOT NULL,
    hash                 TEXT NOT NULL UNIQUE,
    commit_hash          TEXT,
    context_pack_id      TEXT,
    created_at           TEXT NOT NULL
  );
  CREATE INDEX idx_project_architecture ON project_architecture(user_id, project_id, created_at);
  `,

  // 35 — O roadmap gerado por IA (SPEC-Jornada-05).
  //
  // Tabela nova ao lado de `mvp` e `slice`, e não uma coluna neles, porque elas guardam coisas
  // diferentes: `mvp`/`slice` são a projeção que o `STATUS.md` e o MVP-009 leem, e esta guarda a
  // **revisão verificável** — as origens por MVP e por fatia, a SPEC gerada com as perguntas
  // abertas, e as duas revisões que a geração assumiu. Sem a tabela própria, a origem por item
  // teria de caber numa coluna de `mvp`, e a revisão deixaria de ser uma unidade com hash.
  //
  // "mvp_escolhido" guarda o `MVP_ENTRY` (critério 3): é a escolha do PI entre os elegíveis, e é
  // o que congela o MVP aceito na regeneração (critério 6). Nulo até ele escolher — a geração
  // não escolhe nada.
  //
  // Append-only, a oitava vez com esta postura. Regenerar insere outra linha; o hash UNIQUE
  // reconhece quando o conteúdo é o mesmo. As duas escritas posteriores (`mvp_escolhido` e
  // `commit_hash`) não tocam conteúdo nem hash.
  `
  CREATE TABLE project_roadmap (
    id                   TEXT PRIMARY KEY,
    user_id              TEXT NOT NULL,
    workspace_id         TEXT NOT NULL,
    project_id           TEXT NOT NULL,
    -- A revisao do PRD que este roadmap assume.
    pacote_estrutural_id TEXT NOT NULL,
    -- A revisao da arquitetura que este roadmap assume.
    arquitetura_id       TEXT NOT NULL,
    -- JSON dos MVPs, cada um com origem obrigatoria e o checklist de fatias.
    mvps                 TEXT NOT NULL,
    -- JSON da SPEC da primeira fatia do MVP escolhido; nulo antes do MVP_ENTRY.
    spec                 TEXT,
    -- O MVP que o PI escolheu no MVP_ENTRY; nulo enquanto ele nao escolheu.
    mvp_escolhido        TEXT,
    hash                 TEXT NOT NULL UNIQUE,
    commit_hash          TEXT,
    context_pack_id      TEXT,
    created_at           TEXT NOT NULL
  );
  CREATE INDEX idx_project_roadmap ON project_roadmap(user_id, project_id, created_at);
  `,

  // 36 - modelo por fase, no workspace e no projeto (SPEC-Fases-02).
  //
  // `phase_model_policy` guarda **uma linha por (fase, rota)**, e nao um JSON com as seis: e a
  // mesma razao que fez `provider_route` ser uma linha por tipo de tarefa. A tela edita um combo
  // de cada vez, e uma coluna JSON faria salvar o Planejamento reescrever o documento inteiro,
  // perdendo a edicao concorrente da Construcao. A PK `(user_id, workspace_id, fase, rota)` e o
  // que torna cada combo independente.
  //
  // **Rota na chave, e nao um par so por fase**: a rota de assinatura oferece
  // `claude-fable-5-1`, que a rota paga nao tem (decisao 4 do MVP-026). Sob um par unico, a
  // escolha da assinatura vazaria para a rota paga e so falharia em runtime, depois da chamada
  // sair - exatamente o que o catalogo resolve estaticamente.
  //
  // `project_model_override` mora em tabela separada porque o escopo e outro: a politica e do
  // **workspace** (`user_id` + `workspace_id`), o override e do **projeto**. Juntar faria a
  // heranca virar coluna anulavel na mesma linha, e "sem override" (herda) deixaria de ser
  // distinguivel de "override apagado". Ausencia de linha e o que significa herdar.
  //
  // Ausencia de linha nas duas e o **padrao valendo** (`POLITICA_DE_MODELO_PADRAO`), nao erro: o
  // app gera desde o primeiro boot, sem semear linha por usuario.
  `
  CREATE TABLE phase_model_policy (
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    fase         TEXT NOT NULL,
    -- 'assinatura' | 'paga'. Rota bloqueada nao gera, entao nao tem modelo a escolher.
    rota         TEXT NOT NULL,
    provider     TEXT NOT NULL,
    model        TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, fase, rota)
  );

  CREATE TABLE project_model_override (
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    project_id   TEXT NOT NULL,
    fase         TEXT NOT NULL,
    rota         TEXT NOT NULL,
    provider     TEXT NOT NULL,
    model        TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, project_id, fase, rota)
  );
  `,

  // 37 - o console da geracao: a trilha de como cada documento nasceu (SPEC-Fases-03).
  //
  // Duas tabelas porque as cardinalidades sao outras: um trace por chamada do ponto unico, e
  // dezenas a milhares de eventos dentro dele. Guardar os eventos como JSON numa coluna do trace
  // obrigaria a reescrever o documento inteiro a cada lote durante o stream - o oposto do que a
  // escrita em lote existe para evitar.
  //
  // **`ledger_entry_id` e NOT NULL** (criterio 2). E o `call_id` do ponto unico - o mesmo
  // identificador que ja correlaciona `cost_event`, auditoria e log (decisao do PI, 2026-09-04).
  // Anulavel, a coluna permitiria o trace orfao que a spec proibe: uma segunda contabilidade de
  // uso, paralela ao ledger e divergindo dele em silencio. Nao ha FK declarada (o banco quase nao
  // as usa) - quem garante a ligacao e o servico, e o teste que recusa trace sem ela.
  //
  // **`etapa` e `fase` moram aqui e nao em `cost_event`**: o ponto unico nao sabe em que etapa da
  // jornada esta - quem sabe e o call site (`src/main/index.ts`). Duplicar a coluna no ledger
  // faria o gasto e a trilha discordarem no dia em que so um dos dois fosse preenchido.
  //
  // `seq` ordena os eventos dentro do trace: a ordem em que o CLI os emitiu e o que o criterio 1
  // exige mostrar, e `created_at` nao serve - a escrita em lote grava varios eventos no mesmo
  // milissegundo, e o `rowid` seria ordem de insercao, nao ordem do stream.
  //
  // `payload` e JSON do resto do `GenerationEvent`, sem os campos que ja sao coluna. Coluna por
  // campo seria uma tabela larga e esparsa: `delta` so existe em `texto`, `chamada_id` so nas
  // ferramentas, `tokens_*` so no `uso`. A uniao e discriminada no dominio; aqui ela e uma
  // coluna de tipo mais um documento.
  `
  CREATE TABLE generation_trace (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    workspace_id    TEXT NOT NULL,
    project_id      TEXT NOT NULL,
    -- O call_id do ponto unico. Trace sem ledger nao existe (criterio 2).
    ledger_entry_id TEXT NOT NULL,
    etapa           TEXT NOT NULL,
    fase            TEXT NOT NULL,
    provider        TEXT NOT NULL,
    model           TEXT NOT NULL,
    iniciado_em     TEXT NOT NULL,
    -- Nulo enquanto a geracao corre. Preenchido no fechamento, com o status.
    terminado_em    TEXT,
    -- 'concluido' | 'falhou' | 'cancelado'.
    status          TEXT NOT NULL
  );

  -- O historico da etapa: as geracoes de um projeto, da mais recente para a mais antiga.
  CREATE INDEX idx_generation_trace_etapa
    ON generation_trace(user_id, project_id, etapa, iniciado_em DESC);

  CREATE TABLE generation_trace_event (
    trace_id   TEXT NOT NULL,
    -- A ordem em que o CLI emitiu. Parte da PK: dois eventos no mesmo trace nunca compartilham.
    seq        INTEGER NOT NULL,
    -- 'texto' | 'ferramenta-inicio' | 'ferramenta-fim' | 'uso' | 'erro'.
    tipo       TEXT NOT NULL,
    payload    TEXT NOT NULL,
    PRIMARY KEY (trace_id, seq)
  );
  `,

  // 38 - provider e modelo do run no ledger (SPEC-Fases-05, criterio 5).
  //
  // Coluna no `execution_ledger`, e nao tabela nova: o par e **um por run** - congelado pelo
  // preflight antes do container subir, e o mesmo nas tres tentativas por decisao da fatia
  // (criterio 3). Uma tabela por tentativa modelaria uma variacao que o congelamento existe para
  // impedir, e a primeira leitura teria de explicar por que as linhas sao sempre iguais.
  //
  // **Anulaveis, ao contrario de `ledger_entry_id` na 37.** Nao e a mesma situacao: aqui ha runs
  // ja gravados por versoes anteriores desta coluna, e `NOT NULL` sem default os tornaria
  // ilegiveis. Nulo aqui significa "run anterior a esta fatia", um fato historico honesto - e
  // nao o orfao que a 37 proibia, porque nenhum run novo passa sem o par (o preflight nao libera
  // sandbox sem ele).
  `
  ALTER TABLE execution_ledger ADD COLUMN provider TEXT;
  ALTER TABLE execution_ledger ADD COLUMN modelo TEXT;
  `,

  // 39 - correlacao com a execucao de CI no ledger (SPEC-Pipeline-01, secao 8).
  //
  // Uma coluna JSON e nao dez colunas: os campos sao **um bloco opcional inteiro** - ou a
  // execucao de CI foi observada, ou nao foi. Dez colunas anulaveis permitiriam estados que nao
  // existem (tested SHA sem run id), e a primeira leitura teria de explicar quais combinacoes
  // sao possiveis. Mesma razao de `checks` e `artefatos` ja serem JSON aqui.
  //
  // Anulavel, como provider/modelo na 38 e pela mesma razao: ha runs gravados antes desta fatia,
  // e `NOT NULL` sem default os tornaria ilegiveis. Nulo significa "run anterior a esta fatia" -
  // e, dentro do bloco, campo ausente significa **nao observado**, nunca zero (criterio 17).
  `
  ALTER TABLE execution_ledger ADD COLUMN correlacao_ci TEXT;
  `,

  // 40 - as preferencias de voz (SPEC-Voz-01, criterio 6).
  //
  // Em `user_profile` e nao numa tabela `voice_config`, pelo mesmo argumento da 14: sao quatro
  // colunas para quatro campos escalares, do jeito que `theme`, `accent_*` e `github_client_id`
  // entraram. Uma tabela com uma linha por usuario seria a estrutura de amanha paga hoje.
  //
  // Todas anulaveis, e nulo significa **usar o default de fabrica** - nunca "vazio". E o mesmo
  // desenho de `accent_noa`: o servico resolve o nulo na leitura, entao o renderer sempre recebe
  // valor pintavel e nao precisa conhecer o padrao. Um `NOT NULL DEFAULT 'small'` cravaria a
  // escolha de hoje em toda linha ja gravada, e mudar o default de fabrica amanha nao alcancaria
  // ninguem.
  //
  // `voz_timeout_ms` e coluna e nao constante porque a spec o pos em Settings: ele existe para
  // proteger o **toggle esquecido** da hotkey, e quanto tempo e demais depende de como a pessoa
  // fala, nao de como o app foi compilado.
  `
  ALTER TABLE user_profile ADD COLUMN voz_modelo     TEXT;
  ALTER TABLE user_profile ADD COLUMN voz_idioma     TEXT;
  ALTER TABLE user_profile ADD COLUMN voz_hotkey     TEXT;
  ALTER TABLE user_profile ADD COLUMN voz_timeout_ms INTEGER;
  `,

  // 41 - a voz da fala (SPEC-Voz-02, criterio 5).
  //
  // Uma coluna a mais em `user_profile`, pela mesma razao da 40: e um campo escalar de
  // preferencia, e a alternativa seria uma tabela com uma linha por usuario para guardar um id.
  //
  // Anulavel pelo mesmo desenho: nulo significa **usar o default de fabrica**, resolvido na
  // leitura. Aqui isso pesa mais que nas outras quatro, porque a spec diz que o default e
  // escolhido pelo PI **ouvindo** - cravar `NOT NULL DEFAULT` numa das vozes agora seria decidir
  // por ele, e mudar depois nao alcancaria nenhuma linha ja gravada.
  `
  ALTER TABLE user_profile ADD COLUMN voz_da_fala TEXT;
  `,

  // 42 - o contexto pode nao vir de um projeto (SPEC-Voz-03, emenda E1).
  //
  // A conversa por voz pergunta sobre o **app** - a fila, os aceites pendentes -, nao sobre um
  // projeto. O manifesto dela traz persona, snapshot e historico: texto que o app escreveu sobre
  // si mesmo, sem arquivo em disco e sem projeto a que pertencer.
  //
  // **Recriacao da tabela, e nao ALTER.** O SQLite nao tem `DROP NOT NULL`: a unica forma de
  // afrouxar a coluna e criar a tabela nova, copiar as linhas e trocar. E a operacao mais
  // delicada do arquivo, por isso ela roda dentro da transacao da migration (ver `migrate`) e
  // copia **coluna a coluna**, nomeadas - um `INSERT ... SELECT *` dependeria da ordem das
  // colunas e quebraria silenciosamente no dia em que alguem acrescentasse uma.
  //
  // O indice e recriado porque ele morre com a tabela antiga. `project_id` continua nele: as
  // consultas por projeto sao a maioria, e um pack do app simplesmente nao aparece nelas - que e
  // o comportamento certo, porque ele nao pertence a projeto nenhum.
  `
  CREATE TABLE context_pack_novo (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    workspace_id  TEXT NOT NULL,
    -- NULL = contexto do proprio app, sem projeto (E1). Ausencia e afirmacao, nao lacuna.
    project_id    TEXT,
    tarefa        TEXT NOT NULL,
    regras        TEXT NOT NULL,
    falhas        TEXT NOT NULL,
    resumo_anterior TEXT,
    etapa         TEXT NOT NULL,
    unmetered     INTEGER NOT NULL,
    teto_de_tokens INTEGER NOT NULL,
    tokens_estimados INTEGER NOT NULL,
    estimado_usd  REAL,
    motivo_da_expansao TEXT,
    excecao_motivo TEXT,
    excecao_teto_bytes INTEGER,
    excecao_autorizado_por TEXT,
    excecao_autorizado_em TEXT,
    rota          TEXT NOT NULL,
    pack_anterior TEXT,
    hash          TEXT NOT NULL UNIQUE,
    created_at    TEXT NOT NULL
  );

  INSERT INTO context_pack_novo
    (id, user_id, workspace_id, project_id, tarefa, regras, falhas, resumo_anterior,
     etapa, unmetered, teto_de_tokens, tokens_estimados, estimado_usd, motivo_da_expansao,
     excecao_motivo, excecao_teto_bytes, excecao_autorizado_por, excecao_autorizado_em,
     rota, pack_anterior, hash, created_at)
  SELECT
     id, user_id, workspace_id, project_id, tarefa, regras, falhas, resumo_anterior,
     etapa, unmetered, teto_de_tokens, tokens_estimados, estimado_usd, motivo_da_expansao,
     excecao_motivo, excecao_teto_bytes, excecao_autorizado_por, excecao_autorizado_em,
     rota, pack_anterior, hash, created_at
  FROM context_pack;

  DROP TABLE context_pack;
  ALTER TABLE context_pack_novo RENAME TO context_pack;
  CREATE INDEX idx_context_pack_projeto ON context_pack(user_id, project_id, created_at);
  `,

  // 43 - a persona da conversa por voz (SPEC-Voz-03, criterio 5).
  //
  // **Tabela propria, e nao coluna em `user_profile`** - ao contrario das preferencias de voz das
  // migrations 40 e 41. O motivo nao e preferencia: `user_profile` e escopado so a `user_id`, e a
  // persona e do par **usuario + espaco** (regra inviolavel do CLAUDE.md). O JARVIS OS tem a dele;
  // a da NOA e conteudo futuro, sem mudanca de schema.
  //
  // Uma linha por escopo, com `texto_livre` guardando **so** a parte editavel. O bloco fixo de
  // sistema - respostas curtas, pt-BR, sem markdown - **nao mora aqui**: ele e do produto, nao do
  // usuario, e persisti-lo permitiria que uma edicao no banco o removesse. Esvaziar o texto livre
  // deixa o bloco fixo valendo, que e o que o criterio 5 exige.
  //
  // Ausencia de linha = persona de fabrica valendo, nunca erro; nada e semeado no boot.
  `
  CREATE TABLE persona (
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    texto_livre  TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id)
  );
  `,

  // 44 - a janela de historico da conversa (SPEC-Voz-03, criterio 7).
  //
  // **Coluna em `user_profile`, e nao tabela** - ao contrario da persona da migration 43. A
  // diferenca e o escopo: a persona e do par usuario+espaco porque cada espaco tem a sua; quantas
  // trocas entram no contexto e preferencia do **usuario**, igual as das migrations 40 e 41, e
  // nao muda ao trocar de espaco.
  //
  // `NULL` = usar o default de fabrica (dez trocas, cravado na spec), como toda preferencia de
  // voz. Semear o numero aqui obrigaria uma migration nova para mudar o default de fabrica.
  `
  ALTER TABLE user_profile ADD COLUMN conversa_janela INTEGER;
  `,

  // 45 - dispositivos escolhidos pelo usuario (SPEC-Voz-05).
  // NULL preserva a decisão explícita no primeiro uso: app não escolhe o default calado.
  `
  ALTER TABLE user_profile ADD COLUMN voz_entrada_id TEXT;
  ALTER TABLE user_profile ADD COLUMN voz_saida_id   TEXT;
  `,

  // 46 - nomes dos dispositivos escolhidos, para avisos compreensíveis quando o id desaparecer.
  `
  ALTER TABLE user_profile ADD COLUMN voz_entrada_rotulo TEXT;
  ALTER TABLE user_profile ADD COLUMN voz_saida_rotulo   TEXT;
  `,

  // 47 - preferencia de executor por projeto (SPEC-Multi-Executor-05).
  //
  // Projeto, e nao workspace: o PI pode querer um projeto construindo por Codex e outro por
  // Claude sem mudar a politica global. Ausencia de linha = padrao seguro (Claude primeiro,
  // Codex como fallback, sem teto pago), resolvido no servico.
  `
  CREATE TABLE project_executor_policy (
    user_id            TEXT NOT NULL,
    workspace_id       TEXT NOT NULL,
    project_id         TEXT NOT NULL,
    executores         TEXT NOT NULL, -- JSON: ExecutorDeCodigo[], ordenado
    fallback_permitido INTEGER NOT NULL,
    teto_usd           REAL,
    updated_at         TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, project_id)
  );
  `,

  // 48 - o pool de execucao (SPEC-Scheduler-01).
  //
  // O slot global unico da V1 (`wip:global`) vira um pool: cada slot e um lease em
  // `wip:slot:<n>`, entao o `UNIQUE(user_id, recurso)` continua sendo a garantia de "nunca mais
  // escritores que o limite" — nao existe recurso `wip:slot:9` para ser adquirido.
  //
  // `fencing_token` e **monotonico por usuario e nunca reutilizado** (`pool_sequencia` sobrevive
  // a liberacao e a reconciliacao): e o que faz um dono antigo, que perdeu o lease e voltou, nao
  // conseguir confirmar progresso — o token que ele guarda ja nao e o do lease vigente. Nulo nos
  // leases que nao sao de slot (worktree, container): fencing e do pool.
  //
  // A fila e persistida porque a posicao e o motivo de espera precisam sobreviver ao reinicio sem
  // duplicar run (`run_id` e a chave). `pool_vez` guarda quando cada projeto foi servido, que e o
  // que alterna entre projetos. `pool_decisao` e o historico das decisoes — a fonte das metricas
  // de ocupacao, espera e decisoes do scheduler.
  `
  ALTER TABLE lease ADD COLUMN fencing_token INTEGER;

  CREATE TABLE pool_config (
    user_id    TEXT PRIMARY KEY,
    config     TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE pool_fila (
    run_id         TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL,
    workspace_id   TEXT NOT NULL,
    project_id     TEXT NOT NULL,
    slice_id       TEXT NOT NULL,
    prioridade     INTEGER NOT NULL,
    enfileirado_em INTEGER NOT NULL,
    executor       TEXT,
    classe         TEXT,
    estado         TEXT NOT NULL CHECK (estado IN ('esperando', 'adquirido', 'cancelado')),
    -- JSON do MotivoDeEspera atual. NULL quando nao esta esperando.
    motivo         TEXT,
    atualizado_em  INTEGER NOT NULL
  );
  CREATE INDEX idx_pool_fila_espera ON pool_fila(user_id, estado, enfileirado_em);

  CREATE TABLE pool_vez (
    user_id    TEXT NOT NULL,
    project_id TEXT NOT NULL,
    servido_em INTEGER NOT NULL,
    PRIMARY KEY (user_id, project_id)
  );

  CREATE TABLE pool_sequencia (
    user_id TEXT PRIMARY KEY,
    ultimo  INTEGER NOT NULL
  );

  CREATE TABLE pool_decisao (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    run_id     TEXT NOT NULL,
    project_id TEXT NOT NULL,
    decisao    TEXT NOT NULL CHECK (decisao IN ('adquirido', 'liberado', 'reconciliado', 'cancelado')),
    -- So em 'adquirido': quanto o run esperou na fila, em ms.
    espera_ms  INTEGER,
    em         INTEGER NOT NULL
  );
  CREATE INDEX idx_pool_decisao_em ON pool_decisao(user_id, em);
  `,

  // 49 - os achados da revisao independente e as voltas do retrabalho (SPEC-Squads-04).
  //
  // O `ExecutionLedger` e o resumo do run e nao comporta o ciclo de vida de um achado (decisao do
  // PI de 2026-10-03). `UNIQUE(run_id, assinatura)` e a garantia de "o mesmo problema e uma
  // assinatura so": e o indice, nao um `if` do servico, que impede dois registros do mesmo achado.
  // A assinatura e calculada pelo kernel — nunca vem do agente.
  //
  // `squad_retrabalho` registra **cada volta** ao DEVELOPER (criterio 5): quem reprovou, por que e
  // quais assinaturas voltaram. E append-only na pratica: a chave inclui a tentativa.
  `
  CREATE TABLE squad_achado (
    run_id                  TEXT NOT NULL,
    assinatura              TEXT NOT NULL,
    user_id                 TEXT NOT NULL,
    workspace_id            TEXT NOT NULL,
    estado                  TEXT NOT NULL
      CHECK (estado IN ('open', 'accepted', 'fixed', 'dismissed', 'superseded')),
    severidade              TEXT NOT NULL CHECK (severidade IN ('P0', 'P1', 'P2', 'P3')),
    categoria               TEXT NOT NULL,
    titulo                  TEXT NOT NULL,
    arquivo                 TEXT NOT NULL,
    trecho                  TEXT NOT NULL,
    impacto                 TEXT NOT NULL,
    correcao                TEXT NOT NULL,
    fora_da_spec            INTEGER NOT NULL CHECK (fora_da_spec IN (0, 1)),
    justificativa_severidade TEXT,
    -- JSON: string[]
    visto_por               TEXT NOT NULL,
    contestado_por          TEXT NOT NULL,
    delta_primeira_vista    TEXT NOT NULL,
    delta_ultima_vista      TEXT NOT NULL,
    delta_fechamento        TEXT,
    motivo_estado           TEXT,
    reaberturas             INTEGER NOT NULL DEFAULT 0,
    atualizado_em           TEXT NOT NULL,
    PRIMARY KEY (run_id, assinatura)
  );
  CREATE INDEX idx_squad_achado_estado ON squad_achado(user_id, run_id, estado);

  CREATE TABLE squad_retrabalho (
    run_id       TEXT NOT NULL,
    tentativa    INTEGER NOT NULL CHECK (tentativa >= 1),
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    origem       TEXT NOT NULL CHECK (origem IN ('teste', 'revisao')),
    decisao      TEXT NOT NULL CHECK (decisao IN ('voltar', 'parar')),
    motivo       TEXT,
    -- JSON: string[] das assinaturas que voltaram ao escritor
    assinaturas  TEXT NOT NULL,
    em           TEXT NOT NULL,
    PRIMARY KEY (run_id, tentativa, origem)
  );
  `,

  // 50 - independencia e locks do pool (SPEC-Scheduler-02).
  //
  // `pool_lock` e o write set **persistido** dos runs que detem slot: uma linha por caminho
  // (prefixo por segmento) e por recurso logico (lockfile, migrations...). Vive enquanto o lease do
  // slot do dono existir — a liberacao e a reconciliacao do dono sao quem a encerra, e um lease
  // expirado continua segurando (critério 5: so apos a reconciliacao). O UNIQUE cobre a chave exata
  // por projeto: a sobreposicao de prefixos e verificada no servico, dentro da transacao, e o UNIQUE
  // e a segunda barreira do recurso exclusivo — dois runs nao seguram o mesmo lockfile nem por bug.
  //
  // `pool_escopo` diz se o write set do run era **conhecido** quando ele adquiriu o slot. Linha com
  // `conhecido = 0` e o fail closed da regra 1: o run ocupa slot sem ter provado nada, e ninguem
  // roda ao lado dele.
  //
  // `pool_prova` guarda a prova usada pelo scheduler (entrada hasheada, razoes, quem estava ativo) e
  // `invalidada_em` marca a que perdeu validade por mudanca estrutural (regra 4) sem apagar o
  // registro. `pool_expansao` e o historico de cada pedido de expansao do write set, aceito ou nao.
  `
  CREATE TABLE pool_escopo (
    run_id          TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    project_id      TEXT NOT NULL,
    conhecido       INTEGER NOT NULL CHECK (conhecido IN (0, 1)),
    catalogo_versao INTEGER NOT NULL,
    registrado_em   INTEGER NOT NULL
  );
  CREATE INDEX idx_pool_escopo_projeto ON pool_escopo(user_id, project_id);

  CREATE TABLE pool_lock (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL,
    run_id       TEXT NOT NULL,
    project_id   TEXT NOT NULL,
    tipo         TEXT NOT NULL CHECK (tipo IN ('caminho', 'recurso')),
    chave        TEXT NOT NULL,
    adquirido_em INTEGER NOT NULL,
    origem       TEXT NOT NULL CHECK (origem IN ('inicial', 'expansao'))
  );
  CREATE UNIQUE INDEX idx_pool_lock_chave ON pool_lock(user_id, project_id, tipo, chave);
  CREATE INDEX idx_pool_lock_run ON pool_lock(user_id, run_id);

  CREATE TABLE pool_prova (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT NOT NULL,
    run_id          TEXT NOT NULL,
    project_id      TEXT NOT NULL,
    independente    INTEGER NOT NULL CHECK (independente IN (0, 1)),
    fingerprint     TEXT NOT NULL,
    catalogo_versao INTEGER NOT NULL,
    -- JSON: Razao[]
    razoes          TEXT NOT NULL,
    -- JSON: string[] dos runs ativos contra os quais a prova valeu
    contra          TEXT NOT NULL,
    em              INTEGER NOT NULL,
    invalidada_em   INTEGER
  );
  CREATE INDEX idx_pool_prova_run ON pool_prova(user_id, run_id);

  CREATE TABLE pool_expansao (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    run_id     TEXT NOT NULL,
    project_id TEXT NOT NULL,
    -- JSON: string[] dos caminhos pedidos
    caminhos   TEXT NOT NULL,
    resultado  TEXT NOT NULL CHECK (resultado IN ('adquirida', 'conflito')),
    -- JSON: ConflitoDeTrava[]
    conflitos  TEXT NOT NULL,
    em         INTEGER NOT NULL,
    -- Quando a aquisicao do slot acabou. O conflito so vale enquanto a aquisicao dura: o mesmo
    -- run_id volta a ser adquirido na nova tentativa do escritor.
    encerrada_em INTEGER
  );
  CREATE INDEX idx_pool_expansao_run ON pool_expansao(user_id, run_id);
  `,

  // 51 - inventario duravel de recursos por run (SPEC-Scheduler-03).
  //
  // Uma linha por recurso que um run cria (worktree, branch, container, rede, sidecar, porta,
  // perfil). E gravada **antes** de criar (`planejado`) e confirmada depois (`criado`): um crash
  // entre os dois deixa `planejado`, e a reconciliacao olha o disco/Docker antes de decidir. Sem
  // isso o unico registro era o lease, que so cobria worktree e container — rede e sidecar nunca
  // eram encontrados depois de um crash.
  //
  // O UNIQUE e **parcial** (`estado <> 'removido'`): dois runs nao registram o mesmo identificador
  // ao mesmo tempo (a colisao de nome/branch/porta e recusada pelo banco), mas o nome de um recurso
  // removido volta a ser usavel — o recurso recriado e um registro novo, nunca o antigo revivido.
  //
  // `labels` e o JSON das labels Docker do recurso: e o que a reconciliacao compara para provar que
  // o que o Docker lista e deste run e nao de outro processo.
  `
  CREATE TABLE recurso_run (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT NOT NULL,
    run_id        TEXT NOT NULL,
    project_id    TEXT NOT NULL,
    tipo          TEXT NOT NULL CHECK (tipo IN
      ('worktree', 'branch', 'container', 'rede', 'sidecar', 'porta', 'perfil')),
    identificador TEXT NOT NULL,
    estado        TEXT NOT NULL CHECK (estado IN ('planejado', 'criado', 'parado', 'removido')),
    -- JSON: Record<string, string>
    labels        TEXT NOT NULL,
    -- JSON: Record<string, string> — o que a reconciliacao precisa para agir e que nao e label
    -- Docker (ex.: o repositorio de um worktree, que e o cwd do git worktree remove)
    detalhes      TEXT NOT NULL DEFAULT '{}',
    criado_em     INTEGER NOT NULL,
    atualizado_em INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX idx_recurso_run_ident
    ON recurso_run(user_id, tipo, identificador) WHERE estado <> 'removido';
  CREATE INDEX idx_recurso_run_run ON recurso_run(user_id, run_id);
  `,

  // 52 - tentativas de merge sob o MergeLease (SPEC-Scheduler-04).
  //
  // Uma linha por tentativa de mergear um PR, gravada **antes** de a chamada sair (`iniciada`) e
  // confirmada depois (`confirmada`, com o commit de merge). E o que torna verificaveis os dois
  // criterios que o lease sozinho nao cobre: o crash entre a chamada e a confirmacao deixa
  // `iniciada`, e a reconciliacao consulta o GitHub antes de repetir; e o cancelamento tardio nao
  // desfaz um merge confirmado, porque o cancelamento olha esta tabela antes de vencer.
  //
  // O lease em si **nao tem tabela propria**: e uma linha de `lease` com recurso `merge:<repo>:<base>`
  // e fencing token, como os slots do pool. Esta tabela guarda o que o lease nao guarda — qual PR,
  // qual head e o que aconteceu.
  //
  // Dois UNIQUE parciais fazem a serializacao valer no banco, nao so no codigo:
  //  - `idx_merge_tentativa_exclusiva`: no maximo UMA tentativa `iniciada` por repositorio e base.
  //    Um crash deixa a linha de pe, e enquanto a reconciliacao nao a resolver ninguem mais mergeia
  //    naquela base — nao se sabe se o merge aconteceu, e mergear em cima do desconhecido e o que
  //    o criterio 4 proibe;
  //  - `idx_merge_tentativa_efeito`: uma tentativa viva por run, PR e head. `abandonada` sai do
  //    indice, entao um head que nao mergeou pode ser tentado de novo.
  //
  // `fencing_token` e o do lease no momento da tentativa; so quem o apresenta confirma.
  `
  CREATE TABLE merge_tentativa (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT NOT NULL,
    run_id        TEXT NOT NULL,
    workspace_id  TEXT NOT NULL,
    project_id    TEXT NOT NULL,
    recurso       TEXT NOT NULL,
    pull_request  INTEGER NOT NULL,
    head_sha      TEXT NOT NULL,
    fencing_token INTEGER NOT NULL,
    estado        TEXT NOT NULL CHECK (estado IN ('iniciada', 'confirmada', 'abandonada')),
    -- O commit de merge na origem. NULL ate a confirmacao.
    merge_sha     TEXT,
    iniciada_em   INTEGER NOT NULL,
    concluida_em  INTEGER
  );
  CREATE UNIQUE INDEX idx_merge_tentativa_exclusiva
    ON merge_tentativa(user_id, recurso) WHERE estado = 'iniciada';
  CREATE UNIQUE INDEX idx_merge_tentativa_efeito
    ON merge_tentativa(user_id, run_id, pull_request, head_sha) WHERE estado <> 'abandonada';
  CREATE INDEX idx_merge_tentativa_run ON merge_tentativa(user_id, run_id);
  `,

  // 53 - o PR que cada run publicou (SPEC-Scheduler-05).
  //
  // O run nao lembrava o proprio PR: o numero morava na memoria da entrega e, no fim, no ledger do
  // run encerrado. Cancelar um run com o trabalho ja no remoto precisa achar o PR para convertê-lo
  // em rascunho, e a conversao precisa sobreviver a um crash entre o cancelamento e a chamada.
  //
  // `rascunho` e a intencao gravada **antes** da chamada (`pendente`) e o resultado depois — o mesmo
  // padrao do diario de efeitos. NULL = ninguem pediu rascunho. Uma linha por run: um run publica
  // um PR so; a retomada e um run novo, com a linha dela.
  `
  CREATE TABLE run_pr (
    user_id      TEXT NOT NULL,
    run_id       TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    owner        TEXT NOT NULL,
    repo         TEXT NOT NULL,
    pull_request INTEGER NOT NULL CHECK (pull_request > 0),
    branch       TEXT NOT NULL,
    -- 'reaproveitado': outro run ativo (retomada vinculada) passou a usar o mesmo PR; converte-lo
    -- em rascunho no meio da entrega do outro seria o oposto do cancelamento seletivo.
    rascunho     TEXT CHECK (rascunho IN
                   ('pendente', 'convertido', 'indisponivel', 'nao-aberto', 'reaproveitado')),
    -- Tentativas de chamar a origem e quando foi a ultima: a reconciliacao espaca e desiste, em
    -- vez de repetir a cada volta uma origem que esta fora do ar.
    tentativas   INTEGER NOT NULL DEFAULT 0,
    tentou_em    INTEGER,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (user_id, run_id)
  );
  CREATE INDEX idx_run_pr_pendente ON run_pr(user_id) WHERE rascunho = 'pendente';
  CREATE INDEX idx_run_pr_pr ON run_pr(user_id, owner, repo, pull_request);
  `,

  // 54 - snapshot e progresso sem conteúdo do agente no run do quadro (M28-F01).
  // Nulos em runs legados; JSON do snapshot é verificado pelo hash antes de projetar.
  `
  ALTER TABLE pipeline_run ADD COLUMN squad_snapshot TEXT;
  ALTER TABLE pipeline_run ADD COLUMN squad_progress TEXT;
  `,

  // 55 - limite máximo calculado antes do Play e exibido no cartão do quadro (M28-F01).
  `
  ALTER TABLE pipeline_run ADD COLUMN squad_cost_limit_usd REAL;
  ALTER TABLE pipeline_run ADD COLUMN squad_cost_measured INTEGER CHECK (squad_cost_measured IN (0, 1));
  `,

  // 56 - associação escopada dos traces de IA às tarefas do Squad (M28-F03).
  `
  CREATE TABLE squad_task_trace (
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    trace_id TEXT NOT NULL REFERENCES generation_trace(id) ON DELETE CASCADE,
    iniciado_em TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, run_id, task_id, trace_id)
  );
  CREATE INDEX idx_squad_task_trace_run
    ON squad_task_trace(user_id, workspace_id, project_id, run_id, task_id, iniciado_em);
  `,

  // 57 - snapshots hash-verified por tarefa, sujeitos às cotas/retenção da M28-F03.
  `
  CREATE TABLE squad_task_snapshot (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    bytes INTEGER NOT NULL CHECK (bytes >= 0),
    kind TEXT NOT NULL CHECK (kind IN ('texto','binario','removido','diff')),
    state TEXT NOT NULL CHECK (state IN ('disponivel','incompleto','expirado','ausente')),
    content BLOB,
    created_at TEXT NOT NULL,
    expired_at TEXT,
    UNIQUE (user_id, workspace_id, run_id, task_id, path)
  );
  CREATE INDEX idx_squad_task_snapshot_run
    ON squad_task_snapshot(user_id, workspace_id, project_id, run_id, task_id, path);
  `,
  // 58 - plano aprovado do Squad fica associado ao run para consulta read-only do painel.
  `
  ALTER TABLE pipeline_run ADD COLUMN squad_plan TEXT;
  `,
  // 59 - tetos do plano e reservas duráveis por tarefa/tentativa (M28-F02).
  `
  ALTER TABLE pipeline_run ADD COLUMN squad_budget_limits TEXT;

  CREATE TABLE squad_budget_reservation (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    writer_id TEXT,
    role TEXT NOT NULL,
    layer TEXT NOT NULL,
    attempt INTEGER NOT NULL CHECK (attempt > 0),
    state TEXT NOT NULL CHECK (state IN ('reserved','consumed','indeterminate','released','overrun')),
    reserved_tasks INTEGER NOT NULL,
    reserved_writers INTEGER NOT NULL,
    reserved_workers INTEGER NOT NULL,
    reserved_calls INTEGER NOT NULL,
    reserved_tokens_in INTEGER NOT NULL,
    reserved_tokens_out INTEGER NOT NULL,
    reserved_turns INTEGER NOT NULL,
    reserved_duration_ms INTEGER NOT NULL,
    reserved_usd REAL NOT NULL,
    actual_tasks INTEGER,
    actual_writers INTEGER,
    actual_workers INTEGER,
    actual_calls INTEGER,
    actual_tokens_in INTEGER,
    actual_tokens_out INTEGER,
    actual_turns INTEGER,
    actual_duration_ms INTEGER,
    actual_usd REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, workspace_id, run_id, task_id, attempt)
  );
  CREATE INDEX idx_squad_budget_run
    ON squad_budget_reservation(user_id, workspace_id, project_id, run_id, state);
  CREATE INDEX idx_squad_budget_project
    ON squad_budget_reservation(user_id, workspace_id, project_id, state);
  `,
  // Inventário reconciliado da SPEC-Contínuo-01. Snapshot é derivado das fontes e reconstruível;
  // preservar o último estado permite retomar após reinício sem tratar o SQLite como autoridade remota.
  `
  CREATE TABLE dag_inventory_snapshot (
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    -- Fingerprint semântico do DAG, usado para comparar revisões de decisão.
    fingerprint TEXT NOT NULL,
    payload TEXT NOT NULL,
    -- Integridade do snapshot serializado inteiro, incluindo revisões das fontes e ordem.
    payload_hash TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, project_id)
  );
  CREATE INDEX idx_dag_inventory_fingerprint
    ON dag_inventory_snapshot(user_id, workspace_id, fingerprint);
  `,

  // 61 — decisões idempotentes do dispatcher contínuo e correlação durável com o run.
  `
  ALTER TABLE pipeline_run ADD COLUMN dispatch_key TEXT;
  CREATE UNIQUE INDEX idx_pipeline_run_dispatch_key
    ON pipeline_run(user_id, workspace_id, project_id, dispatch_key)
    WHERE dispatch_key IS NOT NULL;

  CREATE TABLE continuous_dispatch_cursor (
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    dag_fingerprint TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, project_id)
  );

  CREATE TABLE continuous_dispatch_decision (
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    dag_fingerprint TEXT NOT NULL,
    node_id TEXT,
    run_id TEXT,
    state TEXT NOT NULL CHECK (state IN ('dispatched','waiting','blocked','drained')),
    cause TEXT,
    retry_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, project_id, idempotency_key)
  );
  CREATE INDEX idx_continuous_dispatch_run
    ON continuous_dispatch_decision(user_id, workspace_id, run_id);
  `,
  // 62 — controles operacionais da execução contínua (SPEC-Contínuo-03).
  `
  CREATE TABLE pipeline_control_policy (
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    scope_project_id TEXT NOT NULL DEFAULT '',
    chave TEXT NOT NULL CHECK (chave IN ('pausa','execucao','gasto','push','criacao-pr','merge')),
    valor INTEGER NOT NULL CHECK (valor IN (0,1)),
    actor TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, scope_project_id, chave)
  );

  CREATE TABLE pipeline_control_scope_command (
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    scope_project_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    resultado TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, scope_project_id, idempotency_key)
  );
  `,
  // 63 — núcleo persistido de Preview/Release e lanes de ambiente (MVP-014/F01).
  `
  CREATE TABLE release_run (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL CHECK (workspace_id IN ('noa','jarvis')),
    project_id TEXT NOT NULL,
    sha TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued','preparing','staging','production','stabilizing','completed','superseded','failed','degraded')),
    stage_started_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, workspace_id, project_id, id)
  );
  CREATE INDEX idx_release_run_project ON release_run(user_id, workspace_id, project_id, created_at);
  CREATE UNIQUE INDEX idx_release_run_sha
    ON release_run(user_id, workspace_id, project_id, sha);
  CREATE UNIQUE INDEX idx_release_run_candidate
    ON release_run(user_id, workspace_id, project_id)
    WHERE status IN ('queued','preparing') AND stage_started_at IS NULL;
  CREATE TRIGGER release_run_status_transition
  BEFORE UPDATE OF status ON release_run
  WHEN NOT (
    (OLD.status='queued' AND NEW.status IN ('preparing','superseded','failed')) OR
    (OLD.status='preparing' AND NEW.status IN ('staging','superseded','failed','degraded')) OR
    (OLD.status='staging' AND NEW.status IN ('production','failed','degraded')) OR
    (OLD.status='production' AND NEW.status IN ('stabilizing','failed','degraded')) OR
    (OLD.status='stabilizing' AND NEW.status IN ('completed','failed','degraded'))
  )
  BEGIN SELECT RAISE(ABORT, 'transição de release inválida'); END;
  CREATE TRIGGER release_run_freeze_after_staging
  BEFORE UPDATE OF sha,stage_started_at ON release_run
  WHEN OLD.stage_started_at IS NOT NULL AND
    (NEW.sha IS NOT OLD.sha OR NEW.stage_started_at IS NOT OLD.stage_started_at)
  BEGIN SELECT RAISE(ABORT, 'candidate congelado após início de Staging'); END;

  CREATE TABLE release_candidate (
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL CHECK (workspace_id IN ('noa','jarvis')),
    project_id TEXT NOT NULL,
    release_id TEXT NOT NULL REFERENCES release_run(id),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, project_id)
  );

  CREATE TABLE release_environment_lane (
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL CHECK (workspace_id IN ('noa','jarvis')),
    project_id TEXT NOT NULL,
    environment TEXT NOT NULL CHECK (environment IN ('staging','production')),
    active_release_id TEXT REFERENCES release_run(id),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, project_id, environment)
  );

  CREATE TABLE release_lease (
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL CHECK (workspace_id IN ('noa','jarvis')),
    project_id TEXT NOT NULL,
    environment TEXT NOT NULL CHECK (environment IN ('staging','production')),
    lease_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
    expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, project_id, environment)
  );

  CREATE TABLE release_step (
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL CHECK (workspace_id IN ('noa','jarvis')),
    project_id TEXT NOT NULL,
    release_id TEXT NOT NULL REFERENCES release_run(id),
    environment TEXT NOT NULL CHECK (environment IN ('staging','production')),
    step TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('intended','confirmed','ambiguous','failed')),
    attempt INTEGER NOT NULL CHECK (attempt > 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, project_id, release_id, environment, step),
    UNIQUE (user_id, workspace_id, project_id, environment, idempotency_key)
  );
  CREATE INDEX idx_release_step_state ON release_step(user_id, workspace_id, project_id, release_id, state);
  CREATE TRIGGER release_run_diary_gate
  BEFORE UPDATE OF status ON release_run
  WHEN
    (NEW.status='staging' AND NOT EXISTS (
      SELECT 1 FROM release_step s WHERE s.user_id=OLD.user_id AND s.workspace_id=OLD.workspace_id
        AND s.project_id=OLD.project_id AND s.release_id=OLD.id AND s.environment='staging'
        AND s.step='prepared' AND s.state='confirmed'
    )) OR
    (NEW.status='production' AND (
      SELECT COUNT(*) FROM release_step s WHERE s.user_id=OLD.user_id AND s.workspace_id=OLD.workspace_id
        AND s.project_id=OLD.project_id AND s.release_id=OLD.id AND s.environment='staging'
        AND s.state='confirmed' AND s.step IN ('prepared','database_migrated','backend_healthy','frontend_promoted','smoke_passed')
    ) < 5) OR
    (NEW.status='stabilizing' AND (
      SELECT COUNT(*) FROM release_step s WHERE s.user_id=OLD.user_id AND s.workspace_id=OLD.workspace_id
        AND s.project_id=OLD.project_id AND s.release_id=OLD.id AND s.environment='production'
        AND s.state='confirmed' AND s.step IN ('prepared','database_migrated','backend_healthy','frontend_promoted','smoke_passed')
    ) < 5) OR
    (NEW.status IN ('completed','superseded','failed','degraded') AND EXISTS (
      SELECT 1 FROM release_step s WHERE s.user_id=OLD.user_id AND s.workspace_id=OLD.workspace_id
        AND s.project_id=OLD.project_id AND s.release_id=OLD.id AND s.state IN ('intended','ambiguous')
    ))
  BEGIN SELECT RAISE(ABORT, 'diário de release incompleto ou não reconciliado'); END;
  CREATE TRIGGER release_step_identity_immutable
  BEFORE UPDATE OF user_id,workspace_id,project_id,release_id,environment,step,idempotency_key,payload_hash ON release_step
  WHEN NEW.user_id IS NOT OLD.user_id OR NEW.workspace_id IS NOT OLD.workspace_id OR
    NEW.project_id IS NOT OLD.project_id OR NEW.release_id IS NOT OLD.release_id OR
    NEW.environment IS NOT OLD.environment OR NEW.step IS NOT OLD.step OR
    NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.payload_hash IS NOT OLD.payload_hash
  BEGIN SELECT RAISE(ABORT, 'identidade idempotente do passo é imutável'); END;

  CREATE TABLE release_event (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL CHECK (workspace_id IN ('noa','jarvis')),
    project_id TEXT NOT NULL,
    release_id TEXT NOT NULL REFERENCES release_run(id),
    environment TEXT CHECK (environment IS NULL OR environment IN ('staging','production')),
    kind TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    reason TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_release_event_timeline ON release_event(user_id, workspace_id, project_id, release_id, created_at, id);
  CREATE TRIGGER release_event_append_only_update BEFORE UPDATE ON release_event
  BEGIN SELECT RAISE(ABORT, 'release_event é append-only'); END;
  CREATE TRIGGER release_event_append_only_delete BEFORE DELETE ON release_event
  BEGIN SELECT RAISE(ABORT, 'release_event é append-only'); END;

  CREATE TABLE preview_run (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL CHECK (workspace_id IN ('noa','jarvis')),
    project_id TEXT NOT NULL,
    pull_request INTEGER NOT NULL CHECK (pull_request > 0),
    head_sha TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued','preparing','ready','failed','removed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, workspace_id, project_id, pull_request, head_sha)
  );
  CREATE TABLE preview_event (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL CHECK (workspace_id IN ('noa','jarvis')),
    project_id TEXT NOT NULL,
    preview_id TEXT NOT NULL REFERENCES preview_run(id),
    kind TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_preview_event_timeline
    ON preview_event(user_id,workspace_id,project_id,preview_id,created_at,id);
  CREATE TRIGGER preview_event_append_only_update BEFORE UPDATE ON preview_event
  BEGIN SELECT RAISE(ABORT, 'preview_event é append-only'); END;
  CREATE TRIGGER preview_event_append_only_delete BEFORE DELETE ON preview_event
  BEGIN SELECT RAISE(ABORT, 'preview_event é append-only'); END;

  CREATE TABLE release_artifact (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL CHECK (workspace_id IN ('noa','jarvis')),
    project_id TEXT NOT NULL,
    release_id TEXT NOT NULL REFERENCES release_run(id),
    kind TEXT NOT NULL CHECK (kind IN ('backend-image','frontend-bundle','migration-bundle')),
    digest TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, workspace_id, project_id, release_id, kind, digest)
  );
  CREATE TRIGGER release_artifact_immutable_update BEFORE UPDATE ON release_artifact
  BEGIN SELECT RAISE(ABORT, 'artifact de release é imutável'); END;
  CREATE TRIGGER release_artifact_immutable_delete BEFORE DELETE ON release_artifact
  BEGIN SELECT RAISE(ABORT, 'artifact de release é imutável'); END;

  CREATE TABLE release_deployment (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL CHECK (workspace_id IN ('noa','jarvis')),
    project_id TEXT NOT NULL,
    release_id TEXT NOT NULL REFERENCES release_run(id),
    environment TEXT NOT NULL CHECK (environment IN ('staging','production')),
    artifact_digest TEXT NOT NULL,
    external_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, workspace_id, project_id, environment, external_id)
  );
  CREATE TRIGGER release_deployment_immutable_update BEFORE UPDATE ON release_deployment
  BEGIN SELECT RAISE(ABORT, 'deployment de release é imutável'); END;
  CREATE TRIGGER release_deployment_immutable_delete BEFORE DELETE ON release_deployment
  BEGIN SELECT RAISE(ABORT, 'deployment de release é imutável'); END;

  CREATE TABLE release_migration_execution (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL CHECK (workspace_id IN ('noa','jarvis')),
    project_id TEXT NOT NULL,
    release_id TEXT NOT NULL REFERENCES release_run(id),
    environment TEXT NOT NULL CHECK (environment IN ('staging','production')),
    migration_id TEXT NOT NULL,
    checksum TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('intended','confirmed','ambiguous','failed')),
    created_at TEXT NOT NULL,
    UNIQUE (user_id, workspace_id, project_id, release_id, environment, migration_id)
  );

  CREATE TABLE release_gate_result (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL CHECK (workspace_id IN ('noa','jarvis')),
    project_id TEXT NOT NULL,
    release_id TEXT NOT NULL REFERENCES release_run(id),
    environment TEXT NOT NULL CHECK (environment IN ('staging','production')),
    gate TEXT NOT NULL,
    result TEXT NOT NULL CHECK (result IN ('passed','blocked','unknown')),
    reason TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE release_configuration_reference (
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL CHECK (workspace_id IN ('noa','jarvis')),
    project_id TEXT NOT NULL,
    release_id TEXT NOT NULL REFERENCES release_run(id),
    environment TEXT NOT NULL CHECK (environment IN ('staging','production')),
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, project_id, release_id, environment, name)
  );

  CREATE TABLE release_compensation (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL CHECK (workspace_id IN ('noa','jarvis')),
    project_id TEXT NOT NULL,
    release_id TEXT NOT NULL REFERENCES release_run(id),
    environment TEXT NOT NULL CHECK (environment IN ('staging','production')),
    action TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('intended','confirmed','ambiguous','failed')),
    created_at TEXT NOT NULL
  );
  `,
  // SPEC-Release-02: preparação local. As tabelas de artefato e de referência de configuração
  // da F01 não tinham escritor, então estão vazias: o artefato ganha uri e provenance por
  // ALTER; a referência é recriada com fingerprint/estado e os quatro ambientes (local e
  // preview também têm contrato de chaves). O diário é append-only.
  `
  ALTER TABLE release_artifact ADD COLUMN uri TEXT;
  ALTER TABLE release_artifact ADD COLUMN provenance TEXT;

  CREATE TABLE release_configuration_reference_v2 (
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL CHECK (workspace_id IN ('noa','jarvis')),
    project_id TEXT NOT NULL,
    release_id TEXT NOT NULL REFERENCES release_run(id),
    environment TEXT NOT NULL CHECK (environment IN ('local','preview','staging','production')),
    name TEXT NOT NULL,
    fingerprint TEXT,
    state TEXT NOT NULL CHECK (state IN ('configured','missing','divergent')),
    PRIMARY KEY (user_id, workspace_id, project_id, release_id, environment, name)
  );
  INSERT INTO release_configuration_reference_v2
    SELECT user_id, workspace_id, project_id, release_id, environment, name, version, 'configured'
    FROM release_configuration_reference;
  DROP TABLE release_configuration_reference;
  ALTER TABLE release_configuration_reference_v2 RENAME TO release_configuration_reference;

  CREATE TABLE release_local_effect (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL CHECK (workspace_id IN ('noa','jarvis')),
    project_id TEXT NOT NULL,
    release_id TEXT NOT NULL REFERENCES release_run(id),
    kind TEXT NOT NULL CHECK (kind IN ('compose','migration','artifact','configuration')),
    phase TEXT NOT NULL CHECK (phase IN ('intended','confirmed','failed')),
    external_ref TEXT,
    digest TEXT,
    transport TEXT NOT NULL,
    evidence_hash TEXT,
    reason TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_release_local_effect_timeline
    ON release_local_effect(user_id,workspace_id,project_id,release_id,created_at,id);
  CREATE TRIGGER release_local_effect_append_only_update BEFORE UPDATE ON release_local_effect
  BEGIN SELECT RAISE(ABORT, 'release_local_effect é append-only'); END;
  CREATE TRIGGER release_local_effect_append_only_delete BEFORE DELETE ON release_local_effect
  BEGIN SELECT RAISE(ABORT, 'release_local_effect é append-only'); END;
  `
]

/** Versão de schema que o código atual espera. */
export const SCHEMA_VERSION = MIGRATIONS.length

/**
 * Aplica as migrations pendentes e devolve quantas rodaram.
 *
 * Cada migration roda dentro de uma transação junto com o bump do `user_version`: se o SQL
 * falhar no meio, o banco volta ao estado anterior em vez de ficar meio-migrado — que é o
 * cenário em que "preserva dado" se perde na prática.
 */
export function migrate(db: Database): number {
  const current = db.pragma('user_version', { simple: true }) as number

  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Banco na versão ${current}, mais novo que a versão ${SCHEMA_VERSION} suportada por este código. ` +
        'Abrir assim arriscaria corromper dado gravado por uma versão posterior do app.'
    )
  }

  let applied = 0
  for (let version = current; version < SCHEMA_VERSION; version += 1) {
    const sql = MIGRATIONS[version]
    if (!sql) continue

    // `pragma user_version` não aceita bind parameter; o valor é um índice de array
    // controlado por nós, nunca entrada externa.
    db.transaction(() => {
      db.exec(sql)
      db.pragma(`user_version = ${version + 1}`)
    })()

    applied += 1
  }

  return applied
}
