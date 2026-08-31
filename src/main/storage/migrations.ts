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
