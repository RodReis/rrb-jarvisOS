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
