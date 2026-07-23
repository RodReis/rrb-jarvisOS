# DEVELOPMENT.md — Ordem de execução e status

**Dono: Claude Code.** Atualize este arquivo a cada entrega, junto com `STATUS.md`. Aqui vive o *"onde estou dentro da fatia"* (passos com checkmarks); o *"qual fatia está em qual coluna"* vive nas GitHub Issues / `STATUS.md`. Nenhum fato mora nos dois lugares.

Regra de trabalho: **uma fatia por vez (WIP = 1)**. Só iniciar fatia com spec `aprovada-pi` e issue criada.

**Ordem de execução (MVP-001):** 01 → **06 (logging, infra transversal)** → **04 + 02 (entregues juntas)** → 03 → 05. A Fatia 06 roda logo após a 01 porque 02–05 devem logar desde o início; a 04 vem antes da 02 porque 02/03 consomem seus contratos tipados (decisão de 2026-07-22). As seções abaixo estão em ordem numérica; a 06 aparece após a 01 por ser quando ela executa.

> **04 e 02 saíram no mesmo PR (#28), por decisão do PI de 2026-07-22.** O critério 4 da SPEC-04 exige `AuditEvent` de `workspace-switch`, cujo fluxo nasce na F02 — entregá-las juntas evitou stub provisório que a F02 jogaria fora. A **F03 ficou de fora do bloco** por falta de credenciais (ver a seção dela).

## MVP-001 — Fundação

### Fatia 01 — Bootstrap e estrutura (`docs/spec/spec-fundacao-01-bootstrap.md`)

Status: **entregue** (`proplan:done`, aguardando aceite do PI) — spec `aprovada-pi` (2026-07-21); issue #2; PR [#25](https://github.com/RodReis/rrb-jarvisOS/pull/25) mergeado em 2026-07-22 com CI verde.

- [x] Scaffold Electron + React + TS + Vite via **electron-vite** (Electron 43, Vite 7, React 19, Vitest 4; `engines.node >= 22`)
- [x] Estrutura `src/main` / `src/renderer` / `src/shared` com READMEs
- [x] IPC seguro: contextIsolation on, nodeIntegration off, sandbox on, preload tipado
- [x] Scripts dev/build/lint/test configurados
- [x] Rotina de relatório de testes (ADR-003): gerador+selfcheck portados do proplan, `test-report.config.json`, `reports/TESTS.md`, CI; categorias Regras+Tela(componente) — Banco (F04) e E2E Playwright (F03) entram depois
- [x] Tailwind configurado (v4, via `@tailwindcss/vite`)
- [x] Teste de fumaça: janela abre; renderer sem acesso a Node
- [x] Entrega: PR [#25](https://github.com/RodReis/rrb-jarvisOS/pull/25) (`refs #2`) mergeado em 2026-07-22; docs/ commitados

**Decisões técnicas desta fatia** (nenhuma altera escopo; registradas para não serem re-litigadas):

1. **Vite 7, não 8** — `electron-vite@5` declara peer `vite@^5||^6||^7`. Vite 8 quebraria a resolução; não foi forçado com `--legacy-peer-deps` (mascararia incompatibilidade real).
2. **Preload em CommonJS (`index.cjs`)** — o Electron exige preload *unsandboxed* para ESM (`.mjs`). Como `sandbox: true` é critério de aceite, o preload sai CJS e o main segue ESM nativo. Segurança venceu o formato do módulo.
3. **`@electron-toolkit/utils` removido** — o pacote lê `app.isPackaged` no topo do módulo e quebra no Electron 43. Substituído por `app.isPackaged` e `app.setAppUserModelId` nativos (2 linhas).
4. **`RENDERER_SECURITY` mora em `src/shared/contracts/security.ts`** — é contrato, não comportamento: precisa ser testável sem carregar o Electron. `src/main/window.spec.ts` prova que a janela aplica esses valores, fechando as duas pontas.

> **Ambiente (armadilha conhecida):** a variável `ELECTRON_RUN_AS_NODE=1` está setada no shell de desenvolvimento do PI e faz o binário do Electron rodar como Node puro — `require('electron')` devolve a *string* do caminho e o app falha com `TypeError: Cannot read properties of undefined (reading 'whenReady')`. O sintoma se disfarça de erro de bundle ESM/CJS. Para rodar o app: `env -u ELECTRON_RUN_AS_NODE npm run dev`.

### Fatia 06 — Observabilidade e Logging (`docs/spec/spec-fundacao-06-observabilidade-logging.md`)

Status: **finalizada** — aceita pelo PI em 2026-07-22 (issue **#8** fechada, `proplan:finalizado`); spec `aprovada-pi` (2026-07-21, emendada em 2026-07-22); PR [#27](https://github.com/RodReis/rrb-jarvisOS/pull/27) mergeado. **Rodou após a 01, antes de 02–05** (infra transversal — ADR-005).

- [x] `electron-log` no renderer (captura + IPC) + `winston`/`daily-rotate-file` no main como **escritor único**; ponte roteando renderer→winston
- [x] Registro JSON estruturado (`ts/level/category/direction/workspace/msg/ctx/correlationId/…`) com `msg` em pt-BR e redaction obrigatória
- [x] Retenção por nível zipada e local: info 3d / warn 7d / error 10d (poda dos `.gz` verificada — ver decisão 3 abaixo)
- [x] Categorias `integracao/ai/agent/db/auth/ipc/ui/sistema`; contrato in/out definido mesmo sem fluxo p/ ai/agent/integração
- [x] Regra "todo método loga" aplicada aos fluxos que já existem (`ipc`, `sistema`, `ui`); tag `workspace` (NOA/JARVIS/sistema). `auth` (F03), `db` (F04) e workspace-switch (F02) instrumentam nas próprias fatias — **emenda do PI de 2026-07-22**
- [x] Fronteira log ≠ AuditEvent respeitada (stores separados; AuditEvent nasce na F04); testes de retenção-poda e redaction
- [x] Entrega: PR [#27](https://github.com/RodReis/rrb-jarvisOS/pull/27) (`refs #8`); docs/ commitados; relatório carimbado (Regras 49, Banco 8, Tela 13)

**Decisões técnicas desta fatia** (nenhuma altera escopo; registradas para não serem re-litigadas):

1. **Um arquivo por nível, com filtro de nível exato** — `level: 'info'` num transport do winston significa "info **e tudo mais severo**". Um transport por nível sem filtro colocaria os `error` também no arquivo de info, e eles seriam podados em **3 dias em vez de 10** — a retenção por nível deixaria de valer. O filtro `exactLevel` é o que faz a decisão do PI (info 3d / warn 7d / error 10d) ser verdade no disco.
2. **Redaction em `src/shared`, aplicada nos dois lados** — é regra pura (sem Electron, sem IO), então mora junto do contrato e é testável direto. Roda no renderer (para o segredo não chegar a trafegar no IPC) e de novo no main antes de gravar. Objeto que se declara `sensitivity: credential|secret|personal|financial|health` é redigido **inteiro**: redigir só o campo `sensitivity` deixaria o valor rotulado passar.
3. **O gotcha do `.gz` não se aplica a esta versão** — a spec (§ Observações) alerta que `winston-daily-rotate-file` poderia não podar os `.gz`, porque a poda do `file-stream-rotator` apaga `file.name`, o nome **sem** extensão de compactação. Verificado no código da versão instalada (**5.0.0**): o evento `logRemoved` apaga `params.name + '.gz'`. Há teste que prova isso na versão instalada, em vez de confiar na leitura.
4. **Payload do IPC é validado antes de gravar** — o renderer é fronteira de confiança mesmo sendo nosso código. `parseLogInput` descarta registro que não casa com o contrato (categoria inventada, nível fora da lista) e **não** deixa o renderer forjar `source`. Descartar é deliberado: gravar registro malformado polui a evidência.
5. **Console de dev decidido por `app.isPackaged`, não `NODE_ENV`** — no app empacotado a variável costuma vir vazia, e o console ficaria ligado em produção. Mesma lição da decisão 3 da Fatia 01. O sinal entra como parâmetro de `initLogger`, o que mantém o módulo testável sem carregar o Electron.
6. **`fileParallelism: false` na categoria Banco** — testes de integração tocam disco e o logger é um singleton de processo; em paralelo, um arquivo derruba o outro. Serial é o que torna a categoria determinística.

### Fatia 02 — AppShell e WorkspaceSwitcher (`docs/spec/spec-fundacao-02-appshell-workspaces.md`)

Status: spec `aprovada-pi` (2026-07-21); issue #3 em Backlog. Depende da Fatia 01.

- [x] Layout AppShell (sidebar, header, conteúdo)
- [x] WorkspaceSwitcher NOA ⇄ JARVIS com identidade visual por espaço; ativo ao abrir = **sempre JARVIS OS**
- [x] Isolamento de navegação/estado por workspace com **rota preservada por espaço** (A→B→A restaura A; B nunca vaza) + teste — provado em unidade (`navegacao.spec.ts`) e pela UI real (`AppShell.test.tsx`)
- [x] Tray: fechar no "X" = minimizar; restaurar, menu Abrir/Sair
- [x] **Single-instance lock**: reabrir foca a janela existente (não cria 2ª); ações de janela via IPC tipado
- [x] Instrumenta o logger: troca de espaço emite `info` na categoria `ipc` com o destino em `ctx` (critério 7)
- [x] Entrega: PR [#28](https://github.com/RodReis/rrb-jarvisOS/pull/28) (`refs #3`); docs/ commitados

**Decisões técnicas desta fatia:**

1. **Rota por espaço é um mapa, não uma variável** — uma `rotaAtual` única vazaria de um espaço para o outro, que é o que o critério 1 proíbe. O estado (`workspace → rota`) vive em `navegacao.ts` como função pura, testável sem renderizar; a UI só a consome. Rota que não pertence ao espaço é **ignorada na escrita**, não só na leitura — mesma defesa, do lado de entrada.
2. **Espaço ativo mora no main** — a troca gera `AuditEvent` (ADR-004) e etiqueta o logger (ADR-005), e nenhum dos dois é acessível do renderer. A UI pede a troca e reflete o que o main devolveu; ela não muda o espaço por conta própria.
3. **A troca audita antes de efetivar** — se a gravação do `AuditEvent` falhar, o espaço não muda. Auditoria que pode ser pulada quando o disco falha não é evidência. Há teste derrubando a tabela para provar.
4. **A flag `encerrando`** — sem ela o "Sair" do tray seria interceptado pelo próprio handler de `close` da janela, e o app nunca fecharia (o clássico "não consigo mais sair do programa").
5. **`Tray` em referência de módulo** — sem manter a referência viva, o GC coleta o objeto e o ícone some da bandeja após alguns segundos. Sintoma clássico e difícil de diagnosticar.
6. **Botões de espaço são `radiogroup`** — são opções mutuamente exclusivas; uma barra de botões independentes não anunciaria ao leitor de tela qual está ativa.

### Fatia 03 — Autenticação Google local-first (`docs/spec/spec-fundacao-03-auth-google.md`)

Status: **entregue** — spec `aprovada-pi` (2026-07-21, emendada em 2026-07-22); issue #4; PR [#30](https://github.com/RodReis/rrb-jarvisOS/pull/30). Desbloqueada em 2026-07-22, quando o PI criou o projeto Supabase e o cliente OAuth e preencheu o `.env`. Fecha o MVP-001.

- [x] Projeto Supabase dev na nuvem configurado (ADR-002); env local sem segredo commitado (`.env` no `.gitignore`, verificado)
- [x] Fluxo OAuth **PKCE** no navegador do sistema + retorno via **loopback local** efêmero (`127.0.0.1`, porta do SO, morre após uma requisição)
- [x] Sessão offline válida por **30 dias** antes de exigir reautenticação (ADR-001); testado nos dois limites da janela
- [x] Persistência de sessão no main process **cifrada via `safeStorage`/DPAPI**; o teste lê os bytes do arquivo para provar que o token não está em claro
- [x] Estados: deslogado / autenticando / ativo / erro / sessão-expirada, com mensagens de enum fechado (sem `error.message` cru na UI)
- [x] Relançamento offline reusa sessão sem tocar a rede; logout revoga quando online e **sempre** limpa o local
- [x] AuditEvents de login/logout/login-offline-reuse
- [x] Instrumenta o logger na categoria `auth` (emenda do PI de 2026-07-22) com **redaction comprovada** — teste varre todos os registros atrás de access/refresh token
- [x] Testes do fluxo (unit com Supabase dublado) **+ E2E Playwright-Electron** — a categoria E2E do relatório passa a ter contagem real (ADR-003)
- [x] Entrega: PR [#30](https://github.com/RodReis/rrb-jarvisOS/pull/30) (`refs #4`); docs/ commitados

**Decisões e achados desta fatia:**

1. **O `GOOGLE_OAUTH_CLIENT_SECRET` do `.env` não é usado pelo app** — e não deve ser. No desenho do ADR-002 quem fala com o Google é o Supabase; o secret vive no painel dele (Authentication → Providers → Google). Um secret embarcado em app desktop distribuído não é segredo: qualquer usuário o extrai do binário. Decisão do PI (2026-07-22): manter a variável no `.env` sem uso, em vez de removê-la.
2. **`findMostRecent()` é a única consulta sem escopo de `user_id`** — exceção deliberada, documentada no próprio método. No boot o app precisa descobrir *de quem* é a sessão do cofre, e perguntar isso já sabendo o `user_id` seria circular. O isolamento se mantém porque o login apaga as sessões anteriores: existe no máximo uma linha. A alternativa (decodificar o JWT) faria o app confiar no conteúdo de um token que quem valida é o Supabase.
3. **`userId` virou função em `WorkspaceService` e nos handlers IPC** — a identidade deixou de ser fixa (local antes do login, sessão depois). Capturar a string no boot congelaria o escopo da auditoria no usuário local para sempre.
4. **Teardown do E2E usa `app.exit()`, não `close()` nem `quit()`** — os dois travam, por comportamento correto do produto: o app vive no tray (`window-all-closed` vazio, SPEC-02) e os timers de rotação do `winston-daily-rotate-file` seguram o event loop no `will-quit`. Registrado em `docs/TESTING.md`.

**Correção posterior — [#43](https://github.com/RodReis/rrb-jarvisOS/issues/43) (2026-07-23): o `.env` nunca era lido.**

A fatia foi dada como entregue com o login funcionando, mas o app **não carregava o arquivo `.env`**: `readSupabaseConfig()` lê `process.env` cru e `dotenv` não existia no repo. O login funcionou no dia da entrega porque as variáveis estavam exportadas no shell daquela sessão — o arquivo em disco nunca foi exercitado. Quem clonasse o repo e seguisse o `.env.example` receberia "credenciais ausentes" com o arquivo corretamente preenchido, sem nenhum sinal de que ele fora ignorado.

A lição não é sobre `dotenv`. É que **"funcionou na minha máquina" e "funciona a partir do repo" eram estados indistinguíveis** — nenhum teste cobria o caminho do arquivo, e o comportamento correto de degradação graciosa (sem credencial ⇒ só o login indisponível) mascarava o defeito: o app exibia exatamente a mesma tela de quem nunca configurou nada. Um defeito que se disfarça do estado esperado não aparece sozinho; só aparece quando alguém roda o caminho limpo. Corrigido em `src/main/env.ts` com precedência **ambiente vence arquivo** (o CI segue injetando os próprios valores) e provado no app real com as quatro variáveis removidas do shell.

Junto dele, dois fatos da fatia foram vistos rodando pela primeira vez fora do teste: os tokens gravados cifrados no cofre (DPAPI) e a sessão de 30 dias (`expiresAt` a 30 dias do login, ADR-001 §2).

### Fatia 04 — Modelo de dados mínimo + AuditEvent stub (`docs/spec/spec-fundacao-04-dados-audit.md`)

Status: **entregue** — spec `aprovada-pi` (2026-07-21, emendada em 2026-07-22); issue #5; PR [#28](https://github.com/RodReis/rrb-jarvisOS/pull/28). Sustenta 02 (entregue junto) e 03 (bloqueada).

- [x] Contratos `UserProfile`, `Workspace`, `Session` (metadados — **token não entra no SQLite**), `AuditEvent` em `src/shared/domain`
- [x] Persistência local no main process via **SQLite (`better-sqlite3`)**; migrations que **preservam dado** desde o dia 1 (`user_version`)
- [x] AuditEvent **à prova de adulteração (ADR-004)**: trigger bloqueia UPDATE/DELETE + hash-chain HMAC (`seq`/`prev_hash`/`hash`, chave no `safeStorage`) + `verifyChain()`
- [x] Registro de workspace-switch — **eventos de auth ficam para a F03** (o tipo está no contrato; o fluxo nasce com o login)
- [x] Testes de isolamento por `user_id` e `workspace_id`; teste de forja → `verifyChain` acusa
- [x] Instrumenta o logger: operações de storage emitem `info`/`error` na categoria `db` com `ctx.op`/`ctx.table` (critério 7)
- [x] Entrega: PR [#28](https://github.com/RodReis/rrb-jarvisOS/pull/28) (`refs #5`); docs/ commitados

**Decisões técnicas desta fatia:**

1. **A chave HMAC entra por parâmetro, não é lida do `safeStorage` dentro da cadeia** — é o que mantém o critério 3 (forja ao vivo → `verifyChain` acusa) exercitável em teste sem subir o Electron. O `safeStorage` fica isolado em `audit-key.ts`, que **falha alto** se a cifra do SO não estiver disponível: chave HMAC em claro daria uma garantia que não existe.
2. **`audit-chain.ts` mora em `src/main`, não em `src/shared`** — usa `node:crypto`, e `src/shared` é compilado também para o renderer, que não tem Node. O typecheck pegou isso. O tipo `AuditEvent` fica em shared, onde a UI o consome; a criptografia fica no main, onde pode existir.
3. **Migration roda em transação junto com o bump do `user_version`** — falha no meio volta ao estado anterior em vez de deixar o banco meio-migrado, que é onde "preserva dado" se perderia na prática.
4. **`UNIQUE(user_id, seq)` no schema** — o `seq` monotônico é garantido pelo storage, não só pelo código: duas gravações concorrentes falham em vez de criar dois ramos da cadeia.
5. **Auditoria pela ponte IPC é só leitura** — não existe canal de gravação, e há teste provando. Gravar evento é ato do main disparado por um fluxo real; um canal de escrita deixaria a UI fabricar evidência.
6. **`local-user.ts` nomeia a identidade pré-login** — a auditoria é escopada por `user_id` desde o dia 1 (CONVENTION §2), mas o auth só nasce na F03. Sem nome, esse id viraria string solta pelos call sites — o "hardcode" que o CLAUDE.md proíbe.
7. **`@electron/rebuild` configurado aqui** — a spec dizia que o rebuild do módulo nativo viria da Fatia 01, mas a SPEC-01 não o menciona e nada estava configurado. Sem ele o `better-sqlite3` não carrega no Electron 43 (ABI diferente do Node).

### Fatia 05 — Settings mínimo (`docs/spec/spec-fundacao-05-settings.md`)

Status: **entregue** — spec `aprovada-pi` (2026-07-21); issue #6; PR [#29](https://github.com/RodReis/rrb-jarvisOS/pull/29). Dependia de 01–04, todas entregues.

- [x] Tela Settings acessível nos dois espaços (rota de ambos, não exceção fora do mapa)
- [x] Idioma pt-BR/en-US com troca a quente; infra i18n via **i18next**
- [x] Tema claro/escuro/sistema com persistência por usuário
- [x] Testes de persistência de preferências + isolamento por usuário (critério 3)
- [x] Entrega: PR [#29](https://github.com/RodReis/rrb-jarvisOS/pull/29) (`refs #6`); docs/ commitados

**Decisões técnicas desta fatia:**

1. **Recursos de tradução inline, não carregados por HTTP** — o app é local-first e empacotado; buscar tradução pela rede seria uma dependência gratuita que quebraria offline.
2. **`sistema` é preferência, não valor** — quem resolve para claro/escuro é o main, via `nativeTheme`, porque é ele que enxerga o SO. E resolve **na leitura**: cachear no boot deixaria a UI presa no valor antigo se o usuário trocasse o tema do sistema com o app aberto.
3. **A variante `dark:` aponta para `data-tema`, não para `prefers-color-scheme`** — a escolha do usuário precisa poder **sobrepor** o SO (critério 2). O `@media` cobre só o intervalo antes de o main responder, evitando flash de tela clara para quem usa o sistema no escuro.
4. **Migration 2 é `ALTER TABLE ADD COLUMN`**, não recriação — bancos existentes preservam perfil e cadeia de auditoria; o `DEFAULT` preenche as linhas antigas, permitindo `NOT NULL` sem quebrar quem já tem dado. Verificado no app real (v1 → v2 sobre banco existente) e por teste que simula um banco v1 com auditoria.
5. **Bug corrigido: o `save` do perfil sobrescrevia as preferências.** O main o chama a cada boot com o perfil padrão, então a escolha do usuário sumiria a cada reinício — o oposto do critério 1. Agora o upsert atualiza só a identidade; preferência muda por `savePreferences`, a via explícita.
6. **Settings é rota dos dois espaços, não exceção fora do mapa** — do contrário a regra de isolamento da F02 teria um caso especial, e caso especial é onde vazamento se esconde. Há teste provando que a rota dela também é preservada por espaço.
7. **`setup-tela.ts` mudou para `src/renderer/tests/`** — ele importa o i18n do renderer, e `tests/` na raiz pertence ao `tsconfig.node.json`, que não compila o renderer. O typecheck pegou.

## MVP-002 — Execução local controlada (fundação de execução)

Épico [#9](https://github.com/RodReis/rrb-jarvisOS/issues/9). **As 5 fatias têm spec `aprovada-pi`** (issues #11–#15). Roda **após o MVP-001**. Ordem sugerida dentro do MVP: 01 (ambiente, independente) e 02 (Policy Engine) cedo → 03 (allowlist) → 04 (registro) → 05 (execução simulada, junta tudo).

### Fatia 01 — Supabase local + ambiente de sync (`docs/spec/spec-execucao-local-01-supabase-local.md`)

Status: **finalizada** — aceita pelo PI em 2026-07-22 (issue [#15](https://github.com/RodReis/rrb-jarvisOS/issues/15) fechada, `proplan:finalizado`); spec `aprovada-pi` (2026-07-21); PR [#32](https://github.com/RodReis/rrb-jarvisOS/pull/32) mergeado. **Ambiente, roda independente.** Só o alvo de sync — o sync em si é Corte 3.

- [x] `supabase` CLI: stack local via Docker; `supabase/` versionado (config+migrations+seed); [README](../supabase/README.md) (subir/derrubar, portas); `supabase db reset` reproduzível
- [x] Migrations starter: `user_profile`, `workspace`, `audit_event` com campos de escopo (`user_id`/`workspace_id`)
- [x] **RLS comprovada** com role de aplicação **não-owner** (JWT `authenticated` via PostgREST) — só enxerga o próprio `user_id`/`workspace_id`; provado por mutação (RLS desligada ⇒ 2 testes vermelhos)
- [x] **Nenhum segredo no schema cloud** (sem coluna de token/`Session`) — teste lê as migrations e falha se `access_token`/`refresh_token`/tabela de sessão aparecer
- [x] `audit_event` append-only também no cloud (ADR-004): sem policy de update/delete + trigger, com teste de cada camada
- [x] SQLite segue fonte de verdade; nenhuma escrita da aplicação no Supabase nesta fatia
- [x] Entrega: PR [#32](https://github.com/RodReis/rrb-jarvisOS/pull/32) (`refs #15`); docs/ commitados

**Decisões e achados desta fatia:**

1. **Ausência de policy não devolve erro — devolve zero linhas.** A primeira versão do teste de append-only esperava exceção no UPDATE via PostgREST e falhou. O motivo não é bug: a RLS filtra as linhas *antes* do UPDATE/DELETE, então sem policy do verbo nenhuma linha é visível para ele, o comando afeta 0 linhas e a resposta é 204. O que se afirma passou a ser o **efeito** (a linha continua intacta), que vale nos dois caminhos — inclusive se alguém adicionar a policy depois, quando o trigger é que barra.
2. **O trigger é exercitado pelo owner, não pelo cliente.** O owner do banco *pula* RLS — é justamente por onde a camada 1 não protege (migration, script de manutenção, psql com credencial de serviço). Por isso o teste da segunda camada roda `psql` dentro do container. Sem ele, o trigger seria código nunca executado e a "segunda camada" do ADR-004 valeria como intenção, não garantia.
3. **O nome do container deriva do `project_id`, nunca fixo.** A máquina de desenvolvimento roda outros stacks Supabase em paralelo (`rrb-adv`, `rrb-escola`, `rrb-organize`); um nome chutado apontaria para o banco do projeto errado — e o teste passaria ou falharia por motivo alheio a este repo.
4. **No CI, pular é falha.** Os testes se pulam quando a stack não responde, para não punir quem clona o repo sem Docker. Só que no CI a stack sobe de propósito: se ela não subir, o skip transformaria ausência de prova em verde e o relatório contaria RLS como coberta. O `beforeAll` lança quando `process.env.CI` está setado — verificado nos três estados (com stack, sem stack local, sem stack no CI).
5. **Portas do CLI mantidas (faixa `5432x`).** A política de portas do `CLAUDE.md` remapeia Postgres para `5433` e Redis para `6380`, mas aquilo pertence a outro stack; não há colisão real aqui (verificado com `netstat`). Remapear sem colisão seria configuração a mais para manter.
6. **GRANT explícito na migration — permissão de tabela é camada anterior à RLS.** Os testes passavam na máquina local e falhavam **só no CI**, com `42501 insufficient_privilege`. Não era RLS filtrando: sem `GRANT`, o Postgres recusa a consulta *antes* de avaliar qualquer policy. A diferença é que o `ALTER DEFAULT PRIVILEGES` que a stack do Supabase configura só concede quando a tabela é criada pelo role que detém o default — um banco de desenvolvimento herda isso, um banco recriado do zero não. Localmente o default ainda mascara o grant (a ACL aparece como `arwdDxtm` para todas as roles), então **este caso não reproduz na máquina local**: quem provou a correção foi o CI. Lição operacional: schema que depende de privilégio implícito não é reproduzível — o grant vai na migration.
7. **`--reporter=json` escondia qual teste falhava.** O orquestrador do relatório escrevia só no arquivo JSON, então a falha no CI não aparecia em lugar nenhum do log — a única pista era a divergência de números que a guarda anti-drift acusa depois, que diz *que* houve falha e não *qual*. Custou uma rodada de CI às cegas; `scripts/test-report.mjs` passou a emitir também o reporter de terminal.
8. **`(select auth.uid())` e não `auth.uid()` nas policies** — com o select, o planner avalia uma vez por consulta em vez de uma por linha. Diferença invisível no seed de dois usuários, relevante quando o espelho tiver volume.

### Fatia 02 — Policy Engine mínimo (classificação) (`docs/spec/spec-execucao-local-02-policy-engine.md`)

Status: **entregue** — spec `aprovada-pi` (2026-07-21); issue [#11](https://github.com/RodReis/rrb-jarvisOS/issues/11); PR [#33](https://github.com/RodReis/rrb-jarvisOS/pull/33). **Modo report** — classifica e audita, não bloqueia; enforcement fail-closed liga no MVP-003.

- [x] Núcleo avaliador puro `evaluate(action, context) → { action, tier, outcome, reason }` em `src/shared/policies/` (categoria Regras, sem I/O)
- [x] Taxonomia de risco (baixo/médio/alto) como **seed** (`taxonomy.ts`) espelhando os requisitos § Ações Possíveis — mudar risco = editar dado, teste lê do seed
- [x] Classificação sensível ao contexto: JARVIS + `personal|financial|health` ⇒ `alto`/requires-approval; ação não reconhecida ⇒ `bloqueado` (fail-closed na classificação)
- [x] Toda decisão gera `AuditEvent` encadeado (ADR-004); contexto **redigido** antes de gravar (ADR-005); `verifyChain` passa
- [x] Modo report: `PolicyService.classify` devolve e audita a decisão, **nunca barra** — mesmo `bloqueado` volta ao chamador
- [x] Renderer não avalia: canal `policy:classify` — `evaluate` roda no main, UI só vê a `PolicyDecision` via IPC tipado (critério 7)
- [x] Entrega: PR [#33](https://github.com/RodReis/rrb-jarvisOS/pull/33) (`refs #11`); docs/ commitados

**Decisões técnicas desta fatia:**

1. **Taxonomia é dado, o núcleo não conhece ação por nome.** `evaluate` consulta um `Map` (`RISK_TAXONOMY`) montado a partir de três listas que espelham os requisitos § Ações Possíveis. Um id ausente do mapa é *desconhecido* e cai em `bloqueado` — a via fail-closed. Isso mantém a regra "sem hardcode": ajustar o risco de uma ação é editar `taxonomy.ts`, nunca o avaliador.
2. **"Bloqueado no MVP" não é tier semeável.** Os requisitos têm uma lista "Bloqueado no MVP", mas ela **não** vira entradas com `tier: 'bloqueado'`: a intenção é que essas ações nem existam como id reconhecido. Elas chegam ao engine como desconhecidas e caem em `bloqueado` pela mesma via fail-closed. Semear um id para elas sugeriria que são ações previstas (só que barradas) — não são. Por isso `TaxonomyEntry.tier` é `Exclude<RiskTier, 'bloqueado'>`: o tipo proíbe semear bloqueado.
3. **`outcome` deriva do tier, não mora no seed.** baixo→allow, médio/alto→requires-approval, bloqueado→block. Derivar garante que os dois nunca divirjam — não há linha do seed capaz de dizer `alto`+`allow` por engano.
4. **Precedência: fail-closed > sensibilidade > seed.** Ação desconhecida é bloqueada *antes* de qualquer regra de contexto (não há tier a elevar). A sensibilidade no JARVIS eleva a `alto` sobrepondo o seed. Há teste para cada ramo, inclusive "desconhecida + sensível ⇒ bloqueado" (fail-closed vence).
5. **O contexto é redigido antes de virar `AuditEvent`.** O `detail` da ação (caminho, alvo, payload) passa pelo mesmo `redact` do logging (reuso, não reimplementação) antes de a decisão ser gravada. Auditar o contexto cru transformaria a auditoria — que é permanente e append-only — num vazamento. Teste varre o evento serializado atrás do segredo.
6. **`workspace` inválido no IPC vira `jarvis`, não erro.** O contexto vem do renderer (fronteira de confiança); na dúvida sobre o ambiente, tratar como JARVIS é fail-safe — é o espaço onde a regra de sensibilidade morde. Errar para mais cauteloso, nunca para menos.
7. **A decisão de política é auditada na categoria `agent`, não `ipc`.** É decisão do runtime agente sobre uma ação, não tráfego de canal. A categoria já existia no contrato de logging (F06) sem fluxo que a usasse — esta fatia é o primeiro.

### Fatia 03 — Diretórios permitidos (allowlist) (`docs/spec/spec-execucao-local-03-allowlist-diretorios.md`)

Status: **entregue** — spec `aprovada-pi` (2026-07-21); issue [#12](https://github.com/RodReis/rrb-jarvisOS/issues/12); PR [#35](https://github.com/RodReis/rrb-jarvisOS/pull/35). Depende da Fatia 02. Nesta fatia a allowlist é **dado + checagem**, não gating real de FS (isso é MVP-003).

- [x] Allowlist persistida (SQLite, migration 3 `allowed_directory`), escopada por `user_id`; **default de fábrica = só o diretório do app** (`userData`), invariante — não é linha removível
- [x] `isPathAllowed` **puro** (`src/shared`) com matching recursivo + anti-escape por segmento; **canonicalização com symlink** no main (`allowlist-canon.ts`, `node:fs`) — a divisão mantém a regra testável sem Electron
- [x] Add/remove de diretório gera `AuditEvent` encadeado (ADR-004), tipo `allowlist-change`; idempotente (no-op não audita); `verifyChain` passa
- [x] Integra com o Policy Engine (F02): `pathAllowed:false` no `PolicyContext` **eleva um nível** a partir do seed — o main resolve o path e passa o booleano, o `evaluate` segue puro
- [x] Renderer não lê/edita FS nem a allowlist direto — canais `allowlist:list/add/remove`; checagem e persistência no main
- [x] Entrega: PR [#35](https://github.com/RodReis/rrb-jarvisOS/pull/35) (`refs #12`); docs/ commitados

**Decisões técnicas desta fatia:**

1. **A checagem é dividida em duas metades por causa da fronteira de processo.** `isPathAllowed` é pura (comparação de paths canônicos, `src/shared`, categoria Regras); a canonicalização com symlink usa `node:fs` e vive no main (`allowlist-canon.ts`, categoria Banco). `src/shared` compila também para o renderer, que não tem Node — juntar as duas ali quebraria o typecheck. O main resolve o path real, a função pura decide se está dentro.
2. **Contenção por segmento, não por prefixo de string.** `/home/user/app-data` não pode casar `/home/user/app-data-secreto`. Comparar strings deixaria um diretório vizinho de nome parecido vazar a allowlist; a comparação é feita segmento a segmento.
3. **`realpath` é o que fecha o buraco do symlink.** `path.resolve` elimina `..`/`.` textualmente mas não segue link — um symlink dentro de um diretório permitido apontando pra fora passaria. Só `fs.realpathSync` revela o destino real. Há teste de integração com symlink de verdade provando o barramento (e o caso simétrico: link apontando pra dentro continua permitido).
4. **O default de fábrica é invariante, não linha.** `list()` sempre inclui o `appDir`; ele não é gravado na tabela. Se fosse linha, o usuário poderia removê-lo e ficar sem base permitida nenhuma. As entradas explícitas se somam a ele.
5. **A integração com o F02 passa um booleano, não o path.** Decisão do PI: o `evaluate` continua puro. O main canoniza + checa (I/O) e passa `pathAllowed` já resolvido no `PolicyContext`. A precedência da elevação é **fail-closed > sensibilidade(JARVIS) > path-fora > seed**, e a elevação por path satura em `alto` — `bloqueado` fica reservado ao desconhecido (fail-closed), não a uma ação conhecida que só tocou um path fora.
6. **`allowlist-change` é tipo de auditoria próprio, não `policy-decision`.** Editar a allowlist é mudança de configuração sensível (RF-019), não a classificação de uma ação. Sobrecarregar `policy-decision` confundiria os dois na auditoria.
7. **A migration 3 quebrou o teste de migração v1→v2 — e isso é o teste funcionando.** O teste simula um banco parado na v1 desfazendo o que as migrations posteriores criam; ele só desfazia a coluna `theme` (v2). A v3 (`allowed_directory`) exigiu desfazer também a tabela — cada migration nova precisa ser revertida ali, senão a migração tenta recriar objeto existente. O teste pegou a regressão antes do CI.

### Fatia 04 — Registro de workflows + automações (`docs/spec/spec-execucao-local-04-registro-workflows.md`)

Status: **entregue** — spec `aprovada-pi` (2026-07-21); issue [#13](https://github.com/RodReis/rrb-jarvisOS/issues/13); PR [#36](https://github.com/RodReis/rrb-jarvisOS/pull/36). Depende da Fatia 02. **Só registro/catálogo, sem execução** (executar é a Fatia 05).

- [x] Workflow com **schema pleno RF-006** (etapas seq/paralelo, agenteId?/skillId? nullable, entradas/saídas, critérios de sucesso, `requiresApproval`, status, agenda); nasce `disabled`; escopo `user_id`/`workspace_id`
- [x] Trigger Registry registra `manual|cron|evento|webhook` como dado; **nenhum dispara** (teste: cron não agenda; `lastRun`/`nextRun` ficam nulos)
- [x] Automação RF-007: gatilho, alvo (`workflowId | descriptor`), squadId?/skillId? nullable, estado/retentativa; nasce desabilitada
- [x] CRUD completo (`WorkflowService`/repositórios); **nenhuma execução** ocorre; criar/alterar/toggle **classificado** (F02) + **auditado** (`workflow-change`/`automation-change`, ADR-004); `verifyChain` passa
- [x] Etapas = `ActionDescriptor` cujo `action` é um `ActionId` da taxonomia do Policy Engine — teste prova que a F05 poderá classificar cada etapa
- [x] Contratos em `src/shared/domain/workflows.ts`; renderer via IPC tipado (9 canais); nunca toca o storage
- [x] Entrega: PR [#36](https://github.com/RodReis/rrb-jarvisOS/pull/36) (`refs #13`); docs/ commitados

**Decisões técnicas desta fatia:**

1. **Etapas e triggers são JSON em coluna, não tabelas normalizadas** (decisão do PI). O catálogo não consulta etapa isoladamente nesta fatia — nada roda —, então normalizar (tabelas `workflow_step`/`trigger` com FK, joins na leitura) seria custo sem retorno até a execução real (MVP-003). A forma é validada no contrato TS e re-hidratada na leitura, com parse defensivo (banco corrompido não derruba a listagem).
2. **O elo 04→02→05 é o `ActionId`.** Cada etapa carrega um `ActionDescriptor` cujo `action` é uma chave da taxonomia do Policy Engine (Fatia 02). É isso que permite a Fatia 05 pegar uma etapa e chamar `evaluate(step.action, …)` para classificar e simular. Há teste provando que a ação da etapa-exemplo existe no seed — se a taxonomia e o schema divergissem, o elo quebraria silenciosamente.
3. **A auditoria mora no serviço, não no repositório.** Os repositórios são só persistência (testáveis sem o engine); o `WorkflowService` classifica pela F02 e audita antes de devolver. Cada mutação gera **dois** eventos: o `policy-decision` da classificação e o `workflow-change`/`automation-change` da mudança em si — a auditoria separa "classifiquei a edição" de "a edição aconteceu".
4. **Ativar um workflow muda o status, não executa.** `setWorkflowStatus(id, 'online')` mexe no catálogo; `lastRun` continua nulo. Há teste afirmando isso — é a fronteira entre esta fatia (registro) e a F05 (execução).
5. **Tipos de auditoria próprios** (`workflow-change`, `automation-change`), pela mesma razão de `allowlist-change` na F03: são mudanças de catálogo distintas, e a auditoria deve distingui-las sem parsear o payload.
6. **Nasce sempre `disabled`/desabilitada** — o criador não escolhe o status inicial. Uma definição recém-registrada não está no ar até o usuário ativá-la (critério 1).

### Fatia 05 — Motor de execução simulado (`docs/spec/spec-execucao-local-05-execucao-simulada.md`)

Status: **entregue** — spec `aprovada-pi` (2026-07-21); issue [#14](https://github.com/RodReis/rrb-jarvisOS/issues/14); PR [#37](https://github.com/RodReis/rrb-jarvisOS/pull/37). **Headline do MVP** — junta F02+F03+F04. **Zero efeito colateral** (execução real é MVP-003).

- [x] Motor no main (`SimulationEngine`): lê workflow (F04), percorre etapas por gatilho manual
- [x] Por etapa: checa allowlist se há path (F03) → classifica (F02, report, recebendo `pathAllowed`) → **simula** sem efeito real
- [x] `ExecutionRun` persistido (migration 5) com máquina de estados RF; trace por etapa (ação, decisão, allowlist, resultado, timing)
- [x] Simulação determinística: sucesso por padrão; falha declarável via `params.simulateFailure` (decisão do PI)
- [x] Início/fim + cada etapa geram `AuditEvent` encadeado (`execution-run`/`execution-step`); `verifyChain` passa; run logado com `correlationId`
- [x] **Zero efeito colateral provado**: etapa "gravar arquivo" não cria arquivo; listagem do diretório idêntica antes/depois
- [x] Renderer dispara via IPC tipado (`execution:run`/`execution:list`); motor no main
- [x] Entrega: PR [#37](https://github.com/RodReis/rrb-jarvisOS/pull/37) (`refs #14`); docs/ commitados

**Decisões técnicas desta fatia:**

1. **O invariante é a ausência.** `simulation-engine.ts` **não importa** `node:fs`, `node:child_process` nem nada de rede — por desenho, não por esquecimento. "Simular" é produzir o veredito e a nota que a ação *teria*, nunca executá-la. Dois testes provam pelo efeito: o arquivo alvo não existe depois do run, e a listagem do diretório é idêntica antes/depois.
2. **Falha declarável via `params.simulateFailure`** (decisão do PI), não campo no `WorkflowStep`. Fica no dado do workflow e some naturalmente quando a execução for real (MVP-003), sem deixar campo morto no schema da F04.
3. **A ordem dentro da etapa é allowlist → política.** A F03 roda primeiro porque seu resultado (`pathAllowed`) é **insumo** da classificação da F02 — é o elo 03→02 desta fatia. Inverter perderia a elevação de tier por path fora.
4. **Modo report ponta a ponta:** uma etapa classificada `bloqueado` (ação fora da taxonomia, fail-closed) **não barra** o run — ele conclui. Há teste afirmando isso. Barrar é enforcement, e enforcement é MVP-003.
5. **Falha encerra o run; aprovação não.** Etapa que falha para o run em `falhou` e as seguintes não rodam (teste prova). `requiresApproval` vira **marco** e o run auto-continua — o fluxo de aprovação é MVP-003.
6. **Workflow inexistente ⇒ run `cancelado`, registrado.** Um gatilho para um id que não existe é um fato a auditar, não um erro a engolir: o run nasce, é gravado com `workflowId: null` e estado `cancelado`.
7. **Tipos de auditoria próprios** (`execution-run` para os marcos de início/fim, `execution-step` por etapa) — mesma linha de `allowlist-change`/`workflow-change`: a auditoria distingue sem parsear payload.

## MVP-003 — Design System da Plataforma

Épico [#16](https://github.com/RodReis/rrb-jarvisOS/issues/16). **As 8 fatias têm spec `aprovada-pi`** (issues #17–#24). Base técnica: **Radix + Tailwind v4 + Lucide**. Ordem: F01 → F02 → (F03a, F03b, F05 ‖) → F04a → F04b → F06.

### Fatia 01 — Infra do design system (`docs/spec/spec-design-system-01-infra.md`)

Status: **entregue** — spec `aprovada-pi` (2026-07-21); issue [#17](https://github.com/RodReis/rrb-jarvisOS/issues/17); PR [#38](https://github.com/RodReis/rrb-jarvisOS/pull/38). Abre o MVP-003. **Só esqueleto** — nenhum token, cor ou componente de produto (Fatias 02+).

- [x] Três camadas em `src/design/{tokens,ui,patterns}` com export de exemplo por camada, importadas na ordem permitida (`patterns` → `ui` → `tokens`)
- [x] `tokens` sem React — provado na categoria **Regras** (ambiente `node`), não em jsdom
- [x] `ui/Alternador` encapsula o Radix Switch com **lista fechada de props**; consumidor não importa Radix direto (PRD §24)
- [x] `patterns/LinhaDeAjuste` compõe `ui` + ícone Lucide (import individual); recebe dados só por props tipadas
- [x] **Fronteira via ESLint** (`no-restricted-imports` escopada a `src/design/**`): quebra o `lint` ao importar domínio/renderer/main/Electron/Node/Supabase
- [x] Alias `@design` no renderer, no Vitest e no `tsconfig.web` — main e preload **não** o resolvem
- [x] `README` em `src/design/` (camadas, base técnica, regra de dependência, onde cada teste cai)
- [x] Entrega: PR [#38](https://github.com/RodReis/rrb-jarvisOS/pull/38) (`refs #17`); docs/ commitados

**Decisões técnicas desta fatia:**

1. **A fronteira é lint, não convenção — e o lint é exercitado.** Uma regra `no-restricted-imports` mal escopada (`files:` errado, `group:` incompleto) fica silenciosamente inerte, e o `lint` verde passa a dizer que a fronteira existe quando ela não existe. Por isso `tests/design/fronteira.int-spec.ts` roda o **ESLint real** sobre a config real, nos dois sentidos que o critério 2 pede. Verificado por **mutação**: removendo o bloco da regra, os 6 casos de violação ficam vermelhos.
2. **O teste também guarda o *escopo* da regra, não só sua existência.** Há uma asserção sobre um arquivo do renderer: ele importa `@shared` e isso **tem** de continuar passando. Sem ela, alargar o `files:` por engano (de `src/design/**` para `src/**`) quebraria o app inteiro e o teste da fronteira seguiria verde — falharia o lint em outro lugar, longe da causa.
3. **`tokens` é testado em `node`, não em jsdom.** O critério 3 é "importável sem React"; sob jsdom o teste passaria mesmo se a camada importasse React por engano, porque o ambiente fornece o DOM. O ambiente é a prova, não a asserção — por isso `src/design/**/*.spec.ts` entrou na categoria **Regras** e não na **Tela**.
4. **O wrapper do Radix declara props à mão.** `extends RadixSwitch.SwitchProps` ou um `{...rest}` no `Root` reabririam a superfície inteira do primitivo por herança: o tipo pareceria fechado, mas qualquer prop do Radix passaria em runtime, e trocar de primitivo passaria a quebrar consumidor. Há asserção contra `...rest`/`...props` no corpo do componente — também verificada por mutação.
5. **`@design` não é resolvido por main e preload.** O alias existe só no bloco `renderer` do `electron.vite.config.ts`. É a mesma fronteira do lint, vista do outro lado: um import do DS no main falharia no bundle, não só no lint.
6. **O teste da fronteira caiu na categoria Banco.** Ele escreve arquivos temporários dentro de `src/design/` (a regra é escopada por caminho — o arquivo precisa morar lá para ser avaliado). Toca disco, logo é integração. A régua da categoria é "integração com storage local", como já registrado na F06 do MVP-001.
7. **Achado de processo: o relatório de entrega precisa ser gerado no ambiente do CI.** Custou **duas** rodadas de CI vermelhas nesta fatia, por duas guardas diferentes e a mesma causa de fundo — `npm run test:report` rodado sem as condições que o CI impõe. (a) **Stack parada:** com o Docker desligado o gerador roda até o fim e escreve `Banco 110 pass` em vez de `117` — os 7 testes de RLS se pulam (comportamento correto: não punir quem clona sem Docker) e somem da contagem. (b) **Sem as variáveis `REPORT_*`:** o gerador escreve o "Estado atual" mas **não** a linha de histórico da entrega, e a guarda `--require-entry` barra. Nos dois casos nada falha e nada avisa localmente: o arquivo parece válido. Quem pegou foram as guardas do ADR-003 — que é o que elas existem para fazer, e a prova de que a rotina de relatório não é decorativa. O desperdício não foi a falha, foi descobrir no CI o que dava para ver antes do push. Registrado em `docs/TESTING.md` §7 (*"Gerar o relatório de entrega: reproduza o ambiente do CI"*) com o comando exato, incluindo rodar a guarda idêntica à do CI antes de empurrar.

### Fatia 02 — Foundations + ponte com o protótipo (`docs/spec/spec-design-system-02-foundations.md`)

Status: **entregue** — spec `aprovada-pi` (2026-07-21); issue [#18](https://github.com/RodReis/rrb-jarvisOS/issues/18); PR [#40](https://github.com/RodReis/rrb-jarvisOS/pull/40). Depende da F01. É a fatia da **ponte**: o protótipo entra como valor de token; a implementação segue o PRD (React tipado, WCAG 2.2).

- [x] **71 tokens de tema** (51 `jt` + 20 `nt`) × 2 modos, **extraídos** do protótipo por `scripts/extrair-tokens-prototipo.mjs` (determinístico)
- [x] Tokens-base: raios, espaçamento, sombras, movimento, tipografia, z-index, breakpoints (README §2.5/§3/§6)
- [x] Semânticas `status`/`risco` **fixas** — não invertem, não são retematizáveis (PRD §15)
- [x] Camada de **papéis** traduz `jt16` → `surfaceRaised`; componentes das fatias seguintes nunca veem `jt*`
- [x] Acento por **paleta fechada de 8**, `hexA`, e o **ajuste de tom só para leitura** (decisão do PI): tom preservado na marca, luminância ajustada só quando renderiza texto ilegível
- [x] `ProvedorDeTema`: `uiTheme` por props → CSS variables; o DS **não persiste** preferência
- [x] **Superfícies de marca** (Login/Choice/transição/Toast) não invertem — `SUPERFICIES_DE_MARCA` + `modoEfetivo()`
- [x] Fontes **locais** (Michroma/Rajdhani/Share Tech Mono, 78 KB, subset latin) + `tabular-nums`
- [x] `prefers-reduced-motion` zera a duração **no token**
- [x] Entrega: PR [#40](https://github.com/RodReis/rrb-jarvisOS/pull/40) (`refs #18`); docs/ commitados

**Decisões técnicas desta fatia:**

1. **Extrair, não transcrever.** São 142 valores de cor. Um typo aí não quebra nada — só fica sutilmente errado, que é a pior classe de defeito visual. O script é determinístico (MD5 idêntico entre execuções), e é isso que permite ao teste de paridade **afirmar** que o escuro é o do protótipo em vez de supor. Um `tokenDeTema()` inexistente **lança**: CSS engole `undefined` em silêncio.
2. **Nomes semânticos por cima dos 71 brutos** (decisão do PI). A spec manda fidelidade ao protótipo, cujos tokens têm nome opaco (`jt16`); o PRD §9.1 pede nomes semânticos. Conciliados em camadas: o bruto é dado, o papel é a superfície pública. Só os papéis que o README §2.6 nomeia entraram — inventar papel para 71 tokens seria decidir escopo que é do PI.
3. **A exceção da marca é dado, não convenção.** Bastaria não montar o provider em Login/Choice/Toast, mas isso não é verificável: seria confiar em que ninguém o montaria por engano numa tela que ainda nem existe (F03b/F04a). Declarando a superfície, a marca recebe tokens — sempre os escuros — e o teste afirma sobre o **valor**. Provado por mutação: removendo a exceção, 6 testes ficam vermelhos.
4. **Duas variáveis de acento.** `--jos-cor-acento` preserva o tom escolhido; `--jos-cor-acento-leitura` ajusta só a luminância quando o contraste falha. Uma variável só forçaria escolher entre identidade e legibilidade — a decisão do PI é ter as duas. O ajuste itera em passos pequenos porque a relação entre luminância HSL e contraste WCAG não é linear.
5. **Fontes locais, não CDN.** O README §3 importa do Google Fonts, mas o app é local-first e a CSP do renderer declara `font-src 'self' data:` (critério de aceite da SPEC-Fundacao-01). Um `@import` remoto falharia **em silêncio** e a UI cairia na fonte de sistema. Baixadas e versionadas: 78 KB, subset latin, SIL OFL 1.1.
6. **`reduced-motion` zera a duração no token**, não em cada animação — quem anima lê `--jos-duracao-*`, então anular a variável desliga a árvore toda. Caçar `animation` por componente deixaria passar o próximo que alguém escrever. `0.01ms` e não `0`: duração zero cancela `transitionend` e travaria componente que espera esse evento.
7. **A fronteira da F01 pegou o teste desta fatia.** `node:fs` importado em `src/design/` — o lint barrou. Corrigido importando o JSON como módulo, não abrindo exceção: se a regra cedesse para teste, viraria "vale exceto quando incomoda". A regra da fatia anterior mordendo o autor dela é o melhor sinal de que é real.

### Fatia 03a — Componentes: ações + formulários (`docs/spec/spec-design-system-03a-componentes-acoes-forms.md`)

Status: **entregue** — spec `aprovada-pi` (2026-07-21); issue [#19](https://github.com/RodReis/rrb-jarvisOS/issues/19); PR [#42](https://github.com/RodReis/rrb-jarvisOS/pull/42). Depende da F01 (Radix + fronteira) e da F02 (tokens). Pode andar em paralelo com a 03b.

- [x] **Ações** (PRD §11.1): `Button` (primária/secundária/perigo), `IconButton`, `ButtonGroup`, `Link`
- [x] **Campos** (PRD §11.2): `Field`, `FormMessage`, `Input`, `PasswordInput`, `Textarea`
- [x] **Radix encapsulado**: `Select`, `Checkbox`, `RadioGroup`, `Slider`, `Alternador` (Switch)
- [x] **`Combobox` próprio** — padrão ARIA completo; o Radix não publica um
- [x] `ui/base.ts`: altura única (44px), foco, borda, transição, estado desabilitado
- [x] Estado nunca só por cor — inclusive **entre variantes** (correção do critique)
- [x] Regra de lint do critério 5: componentes consomem só tokens
- [x] **Galeria de prova visual** + 8 asserções num navegador real
- [x] Entrega: PR [#42](https://github.com/RodReis/rrb-jarvisOS/pull/42) (`refs #19`); docs/ commitados

**Decisões técnicas desta fatia:**

1. **A gramática visual foi derivada do protótipo, não inventada.** Só **3 dos 16** componentes têm tela de referência (Input, Button primário e secundário, da tela de login); as outras 41 telas são de exibição. Decisão do PI: extrair o vocabulário do que existe — 44px, raio de card, borda de baixo alfa, label mono UPPERCASE, foco no acento — e concentrá-lo em `ui/base.ts`. Inventar estética a cada arquivo produziria 16 dialetos.
2. **A hierarquia de ação é preenchimento, não matiz.** A primeira versão distinguia as variantes só por cor. Com `#C4C4C4` (default do NOA) ou `#FFFFE3` — ambos na paleta de 8 que o usuário escolhe —, primária, carregando e desabilitado renderizavam como o **mesmo botão cinza**. O sistema aplicava "estado nunca só por cor" dentro de cada componente (check, alça, ponto) e violava a regra uma camada acima. Agora primária é sólida e pesada; perigo, contornada e pesada — peso e preenchimento sobrevivem a qualquer acento.
3. **As semânticas ganharam variante de leitura.** Como texto no modo claro, as cinco falhavam a régua: `err` 2.53:1, `violet` 2.52, `warn` 1.99, `ok` 1.78, `info` 1.54. Foram desenhadas para fundo escuro. A cor de marca segue intacta em borda, ícone e preenchimento; só o texto lê da variante ajustada — o mesmo mecanismo que o acento já usava desde a F02.
4. **`textMuted` corrigido, e fidelidade cedeu à legibilidade.** `#6b7382` media 4.08–4.12:1 no escuro, e o token não é decorativo: carrega placeholders, texto de apoio e **todas as labels** (via `LABEL_MONO`, em `--jos-texto-micro` com uppercase — texto pequeno, sem isenção). `#757d8c` é o desvio mínimo que atinge 4.5:1. É o princípio 1 do PRODUCT.md ("clareza antes de efeito visual") decidindo contra o protótipo.
5. **`Field` devolve os atributos ARIA por render prop.** Cada componente montar o próprio `aria-describedby` é a via para um esquecer. O erro precede a descrição na ordem de leitura: quem acabou de errar precisa ouvir o problema antes da instrução genérica.
6. **`ButtonGroup papel="segmentado"` foi removido, não remendado.** Prometia `role="radiogroup"` sobre filhos `<button>` — o leitor de tela anunciaria um grupo de rádio **sem rádios dentro**, pior que a fileira de botões que a variante tentava corrigir. Um controle segmentado de verdade precisa de estado e navegação por setas; é escopo da F04a, onde há tela que o use. Entregar a casca seria oferecer acessibilidade inexistente.
7. **`Combobox` fecha por `focusout`, não por timer.** A versão inicial usava `setTimeout(…, 120)` para o `mousedown` da opção registrar antes do fechamento: o timer nunca era limpo (disparava após o unmount) e, sob quadro lento, a lista fechava antes do clique. `relatedTarget` responde a pergunta certa — "o foco saiu daqui?" — sem constante para calibrar.
8. **Três camadas de verificação, cada uma pegando o que a anterior não pega.** Os 91 testes de papel acharam o `aria-label` no `Root` do slider em vez do `Thumb` (a faixa ficava anônima). A **prova visual** achou dois defeitos com esses 91 verdes: o CSS dos componentes não estava sendo gerado (o Tailwind v4 varre a partir da `root` do Vite, e `../ui` ficava fora) e o card do NOA estava invertido (`nt16` é cor de **texto** — os índices `jt`/`nt` são independentes, não numerações paralelas). O **`/impeccable critique`** achou os 10 itens de contraste e hierarquia. Cada correção deixou teste que a trava, verificado por mutação.

**Registrado, não silenciado:**

- `RadioGroup` por setas **não é verificável em jsdom** (roving tabindex do Radix depende de foco real). `it.todo` com a razão escrita, em vez de um teste que passa medindo outra coisa — cobre-se no E2E da F04a.
- A galeria cobre **4 de 32** combinações de acento. Os dois defeitos apareceram nos defaults; ampliar a matriz é candidato para a F06.
- **`:active` não existe em nenhum dos 16** — nenhum controle dá feedback de pressão. Anotado para a F06 (hardening).
- Card **[#41](https://github.com/RodReis/rrb-jarvisOS/issues/41)**: o renderer sobe em porta variável, contra o `strictPort` do CLAUDE.md. Achado ao subir o app para inspeção; não misturado na fatia.

### Fatia 03b — Componentes: dados + overlays + feedback (`docs/spec/spec-design-system-03b-componentes-dados-overlays.md`)

Status: **entregue** — spec `aprovada-pi` (2026-07-21); issue [#20](https://github.com/RodReis/rrb-jarvisOS/issues/20); PR [#45](https://github.com/RodReis/rrb-jarvisOS/pull/45). Depende da F01 (Radix + fronteira) e da F02 (tokens). Paralela à 03a.

- [x] **Exibição de dados** (PRD §11.4): `Card`, `Panel`, `Badge`, `Tag`, `Avatar`, `Table`, `Tree`, `Separator`, `Tooltip`, `Progress`, `Meter`, `Skeleton`, `Spinner`, `EmptyState`
- [x] **Overlays** (PRD §11.5, Radix): `Dialog`, `AlertDialog`, `Popover`, `DropdownMenu`, `Drawer`
- [x] **Feedback** (PRD §11.5): `InlineAlert`, `ErrorState`, `LoadingState`
- [x] **Toast unificado** fiel ao protótipo (README §5): 5 simultâneos, 4200 ms, glass + barra lateral + progresso, `stamp` HH:MM:SS, sempre escuro
- [x] **Notificações** (PRD §12.6): `ToastViewport`, `NotificationCenter`, `NotificationItem`, `UnreadIndicator` — lista por props
- [x] Critério 1 — focus-trap, `Escape` e **retorno de foco** provados nos 5 overlays (`overlays.test.tsx`)
- [x] Critério 2 — Toast: variante, pausa em hover **e** foco, máx. 5, dedupe e permanência escura no tema claro (`toast/toast.test.tsx`)
- [x] Critério 3 — `AlertDialog` é o caminho do destrutivo: verbo específico, clique fora inerte, Escape cancela e nunca confirma
- [x] Critério 4 — estado sem cor em `Badge`/`Progress`/`Meter`/`InlineAlert`/`EmptyState`/`ErrorState`/notificações (`dados-feedback.test.tsx`)
- [x] Critérios 5 e 6 — só tokens; fronteira da F01 verde
- [x] Critério 7 — `test` 461 ✓, `lint` ✓, `typecheck` ✓ (**+50 testes**)
- [x] Entrega: PR [#45](https://github.com/RodReis/rrb-jarvisOS/pull/45) (`refs #20`); docs/ commitados

**Decisões técnicas desta fatia:**

1. **O teste achou dois defeitos reais de a11y que a leitura do código não pegou.** Ambos em componentes que *pareciam* corretos e cujo comentário afirmava a garantia que eles não davam.
   - **Retorno de foco em `Dialog`/`AlertDialog`/`Drawer`.** O cabeçalho do arquivo afirmava "o Radix entrega os três de fábrica". Entrega — **quando ele é dono do gatilho**. Estes três são controlados por prop (`aberto`) e não têm `Trigger`: o Radix não tem para onde voltar, e o foco caía no `<body>`. Quem navega por teclado voltava ao topo do documento a cada modal fechado. Corrigido com `useRetornoDeFoco`, que guarda `document.activeElement` na abertura e restaura no fechamento (com guarda `isConnected`, para o caso de o gatilho ter sido removido *pelo próprio* modal).
   - **`Panel` não era uma região.** Um `<section>` sem nome acessível não vira `role="region"` — ele some da lista de marcos do leitor de tela, e o `sr-only` do tom fica órfão no DOM: o texto "erro:" existia, mas não era lido ao pousar no painel. O `sr-only` migrou para dentro do `<h3>`, que agora é referenciado por `aria-labelledby` — o nome da região carrega **tom + título** juntos.
   
   Os dois foram verificados por mutação: removendo `useRetornoDeFoco` e o `aria-labelledby`, 4 testes ficam vermelhos.
2. **O critério 4 não se prova medindo cor — prova-se afirmando o sinal não-cromático.** Uma asserção sobre cor computada em jsdom mediria a string que o próprio componente escreveu. O que sobrevive ao daltonismo, ao alto contraste e ao leitor de tela é **texto e papel ARIA**, e é sobre isso que as asserções falam: o `82%` escrito ao lado do `Meter`, o `"erro:"` no `InlineAlert`, o `"não lida"` no `NotificationItem`, o `aria-valuenow` ausente no `Progress` indeterminado (um `0` seria pior que a ausência — diria "nada foi feito").
3. **O toast escuro é asserção estrutural, pelo mesmo motivo.** O critério pede que ele **não inverta** sob `uiTheme='light'`. Em jsdom a prova possível é que o card referencia `--jos-toast-*` (superfície de marca) e **nunca** `--jos-cor-superficie*`, que inverte. Junto vai a asserção de que o provider de fato pintou `data-modo="light"` — sem ela, o teste passaria mesmo se o `uiTheme` fosse ignorado, medindo o default escuro.
4. **`fireEvent` no teste de Toast, `userEvent` em todo o resto.** Não é preferência: sob `vi.useFakeTimers()` as esperas internas do `userEvent` nunca resolvem, e todo clique estoura o timeout. O alvo ali é o **motor** (fila, timers, dedupe), não a fidelidade da sequência do ponteiro. E os timers falsos são o que permite afirmar sobre o **resto** do timer na pausa — hover aos 4000 ms, avança 10 s, sai, e 200 ms bastam para fechar. Um teste que só verificasse "pausou" não distinguiria pausa de reinício da duração cheia.
5. **A recusa do `userEvent` virou a evidência do clique-fora.** O `AlertDialog` marca o conteúdo de trás com `pointer-events: none` **e** `aria-hidden`. O `userEvent` se recusa a clicar num elemento inerte — essa recusa é a prova de que o clique não chega a lugar nenhum. Forçar por `fireEvent` furaria a barreira e mediria outra coisa. O `aria-hidden` entra na mesma asserção: `getByRole` não acha o botão de fora, só `getByTestId`.
6. **Uma suposição minha sobre o `AlertDialog` estava errada, e o teste corrigiu.** Escrevi que Escape não deveria fechá-lo. O Radix fecha — e está certo: o critério 1 exige "Escape fecha" para *todos* os overlays, e bloquear a tecla deixaria o usuário de teclado preso num diálogo sem saída. A assimetria correta é clique fora (distração) bloqueado, Escape (tecla deliberada) permitido. O que Escape nunca faz é **confirmar**: o teste afirma `onConfirmar` não chamado.
7. **A fronteira da F01 mordeu de novo, e de novo cedeu o import, não a regra.** O teste do Toast importava `../../tokens/provider`; a regra bane `../../*` porque é a forma como um import escaparia de `src/design/`. Trocado pelo alias `@design`, que diz a mesma coisa sem depender da profundidade do arquivo. Mesma decisão da F02.

## Após o MVP-003

Ordem: **MVP-004** ([#10](https://github.com/RodReis/rrb-jarvisOS/issues/10), execução real + terminal) → MVP de providers (Corte 3, com BudgetPolicy). Ordem macro em `docs/LANDSCAPE.md` § Roadmap.

## Registro de entregas

| Data | Fatia | PR | Observação |
|---|---|---|---|
| 2026-07-23 | MVP-003 · F03b Componentes: dados + overlays + feedback (#20) | [#45](https://github.com/RodReis/rrb-jarvisOS/pull/45) | Regras 203 (78.2%), Banco 117 (87.5%), Tela 148 (90.4%) — **+53 testes**. A metade "saída/estrutura" do conjunto essencial: 14 componentes de dados, 5 overlays, 3 de feedback, o Toast unificado e as notificações. A headline é **o que o teste achou e a leitura do código não**: dois defeitos de a11y em componentes cujo próprio comentário afirmava a garantia que eles não davam. O Radix devolve o foco ao gatilho — **quando ele é dono do gatilho**; `Dialog`/`AlertDialog`/`Drawer` são controlados por prop e não têm `Trigger`, então o foco caía no `<body>` e quem navega por teclado voltava ao topo do documento a cada modal fechado. E um `<section>` sem nome acessível não vira `role="region"`: o `sr-only` do tom do `Panel` existia no DOM e nunca era lido. Ambos provados por mutação (4 testes vermelhos sem as correções). A fatia também firmou que **o critério "estado sem cor" não se prova medindo cor** — em jsdom a asserção mediria a string que o próprio componente escreveu; o que sobrevive ao daltonismo e ao leitor de tela é texto e papel ARIA, e é sobre isso que as 53 asserções falam. |
| 2026-07-23 | MVP-003 · F03a Componentes: ações + formulários (#19) | [#42](https://github.com/RodReis/rrb-jarvisOS/pull/42) | Regras 203 (78.2%), Banco 117 (87.5%), Tela 95 (89.6%) — **+85 testes**. Os 16 componentes de ação e formulário. A fatia introduziu **três camadas de verificação**, e cada uma pegou o que a anterior não pegava: os testes de papel acharam o `aria-label` no lugar errado do slider; a **prova visual** achou o CSS não sendo gerado e o card do NOA invertido, **com os 91 testes de papel verdes**; o **`/impeccable critique`** achou 10 itens de contraste e hierarquia — incluindo a ação primária colapsando com a desabilitada em 2 dos 8 acentos da paleta. A lição que fica é sobre método: o rigor de contraste existia só no caminho do acento (a cor que o *usuário* escolhe) e não nos papéis que *nós* escolhemos. Agora são 41 asserções sobre todos os papéis × 2 módulos × 2 modos. |
| 2026-07-23 | MVP-003 · F02 Foundations + ponte com o protótipo (#18) | [#40](https://github.com/RodReis/rrb-jarvisOS/pull/40) | Regras 158 (77.9%), Banco 117 (87.5%), Tela 55 (91.2%) — **+42 testes**. A ponte protótipo→código: 71 tokens × 2 modos **extraídos** (determinístico), não transcritos — 142 valores de cor à mão é onde o typo silencioso mora. Duas provas por mutação: sem a exceção da marca, 6 testes vermelhos; sem a regra de fronteira (F01), 6 vermelhos. As 8 cores da paleta × 2 fundos atingem 4.5:1 — paleta fechada permite afirmar sobre **todas**, não amostrar. Fontes baixadas e versionadas (78 KB) porque a CSP do renderer não aceita CDN e falharia em silêncio. Junto: `PRODUCT.md` (contexto de design via `/impeccable init`, a pedido do PI) documentando as **três camadas** — Desenvolvimento não é espaço de usuário. |
| 2026-07-23 | MVP-003 · F01 Infra do design system (#17) | [#38](https://github.com/RodReis/rrb-jarvisOS/pull/38) | Regras 139 (75.0%), Banco 117 (87.5%), Tela 39 (93.6%) — **+16 testes**. **Abre o MVP-003.** Só esqueleto: três camadas, toolchain e fronteira, sem nenhum token ou componente de produto. O que a fatia realmente entrega é a **fronteira verificável** — `no-restricted-imports` escopada a `src/design/**` que quebra o `lint`, exercitada pelo ESLint real nos dois sentidos e provada por mutação (sem o bloco da regra, 6 casos ficam vermelhos). O teste guarda também o *escopo*: alargar o `files:` por engano quebraria o renderer, então há asserção de que um arquivo fora do DS continua livre para importar `@shared`. `tokens` é testado em `node` e não em jsdom — o ambiente é o que prova "sem React". |
| 2026-07-22 | MVP-001 · F01 Bootstrap e estrutura (#2) | [#25](https://github.com/RodReis/rrb-jarvisOS/pull/25) | CI verde na 1ª execução. Relatório ADR-003 ativo: selfcheck 10/10, guarda anti-drift verificada nos dois sentidos. Regras 14 (85%), Tela 4 (100%), Banco 0 (F04). |
| 2026-07-22 | MVP-001 · F06 Observabilidade e Logging (#8) | [#27](https://github.com/RodReis/rrb-jarvisOS/pull/27) | Regras 49 (87.2%), **Banco 8 (85.5%)**, Tela 13 (97.6%). A categoria **Banco deixa de estar vazia antes da F04**: os testes de integração do logger tocam disco real (arquivo temporário, teardown por teste), que é exatamente o que a categoria mede — o `TESTING.md` §8 previa SQLite como primeiro caso, mas a régua é "integração com storage local", não "SQLite". Verificado também no app real: os três arquivos nascem em `userData/logs` e o registro do renderer chega ao disco. |
| 2026-07-22 | MVP-001 · F04 Dados + AuditEvent (#5) **e** F02 AppShell/workspaces (#3) | [#28](https://github.com/RodReis/rrb-jarvisOS/pull/28) | Regras 78 (86.6%), Banco 32 (89.5%), Tela 16 (98.5%). Duas fatias no mesmo PR por decisão do PI: o critério 4 da SPEC-04 exige `AuditEvent` de `workspace-switch`, cujo fluxo nasce na F02. Carimbo pela issue do primeiro `refs` (#5), como o CI extrai. Verificado no app real: schema v1, 2 triggers ativos, chave de auditoria cifrada por DPAPI no disco. **F03 não entrou** — bloqueada por credenciais (ver a seção da fatia). |
| 2026-07-22 | MVP-001 · F05 Settings mínimo (#6) | [#29](https://github.com/RodReis/rrb-jarvisOS/pull/29) | Regras 83 (84.0%), Banco 45 (89.6%), Tela 22 (95.5%). Fecha o MVP-001 **exceto a F03**. Primeira migration incremental do projeto (v1 → v2) exercitada sobre banco real com dado gravado — o log registrou `Migrations aplicadas {"quantidade":1}` e o perfil sobreviveu. Corrigiu um bug latente da F04: o upsert do perfil sobrescrevia `locale`/`theme` a cada boot. |
| 2026-07-22 | MVP-002 · F05 Motor de execução simulado (#14) | [#37](https://github.com/RodReis/rrb-jarvisOS/pull/37) | Regras 137 (74.8%), Banco 109 (87.5%), Tela 33 (93.5%) — **+16 testes**. **Fecha o MVP-002 (5/5 entregues).** A headline: junta F02 (classifica), F03 (allowlist) e F04 (definições) num motor que percorre etapas **sem tocar recurso real**. O invariante foi provado pelo efeito, não pela intenção: a etapa "gravar arquivo" roda e o arquivo não existe; a listagem do diretório é idêntica antes/depois. Modo report ponta a ponta — etapa `bloqueado` não barra o run. |
| 2026-07-22 | MVP-002 · F04 Registro de workflows + automações (#13) | [#36](https://github.com/RodReis/rrb-jarvisOS/pull/36) | Regras 134 (74.7%), Banco 96 (85.3%), Tela 33 (93.5%) — **+14 testes**. Catálogo RF-006/007 (schema pleno), migration 4 (`workflow`/`automation`, etapas em JSON). Nada executa: ativar muda status, não roda etapa; cron registra sem agendar. Edição classificada (F02) + auditada (`workflow-change`/`automation-change`). Elo 04→02→05 provado: etapa carrega `ActionId` da taxonomia. 9 canais IPC novos — as listas da ponte (preload.spec, E2E) pegaram todos. |
| 2026-07-22 | MVP-002 · F03 Diretórios permitidos (allowlist) (#12) | [#35](https://github.com/RodReis/rrb-jarvisOS/pull/35) | Regras 129 (78.2%), Banco 87 (86.8%), Tela 33 (93.5%) — **+35 testes**. Checagem dividida: `isPathAllowed` pura (Regras) + canonicalização com symlink no main (Banco). Anti-escape provado com symlink real apontando pra fora. Default de fábrica = só o `userData`, invariante. Add/remove auditado (`allowlist-change`). Integração F02: `pathAllowed:false` eleva o tier, `evaluate` segue puro. Junto: **[INFRA] cache do binário do Electron** (commit `c37a5f0`, ~2-3 min a menos no CI) e o card **#34** para separar o E2E em job próprio. |
| 2026-07-22 | MVP-002 · F02 Policy Engine (classificação) (#11) | [#33](https://github.com/RodReis/rrb-jarvisOS/pull/33) | Regras 107 (77.0%), Banco 74 (87.0%), Tela 33 (93.5%) — **+21 testes**. Backbone das fatias 03/05 do MVP-002. Núcleo `evaluate` puro (Regras) + `PolicyService` que audita cada decisão (Banco). Taxonomia como seed dos requisitos § Ações Possíveis — dado, não hardcode. Fail-closed na classificação: desconhecido ⇒ `bloqueado`. Modo report: nada barra (mesmo `bloqueado` volta ao chamador). Canal `policy:classify` provou a fronteira — o E2E e o `preload.spec` que listam a superfície da ponte pegaram o método novo, como esperado. |
| 2026-07-22 | MVP-002 · F01 Supabase local + ambiente de sync (#15) | [#32](https://github.com/RodReis/rrb-jarvisOS/pull/32) | Regras 92 (79.6%), **Banco 68 (87.0%)**, Tela 33 (93.5%). Abre o MVP-002. Os 8 testes novos entram na categoria Banco: RLS real, contra a stack Docker, com JWT de usuário final pelo PostgREST — nunca a conexão do owner, que pularia RLS e faria tudo passar sem provar nada. A prova de que os testes provam algo veio por **mutação**: com `user_profile` sem RLS, dois deles ficam vermelhos. O CI passou a subir a stack (`supabase/setup-cli` + `supabase start`), e o teste **falha em vez de pular** quando `CI` está setado — sem isso, uma stack que não sobe deixaria o CI verde sobre RLS não testada. |
| 2026-07-22 | MVP-001 · F03 Autenticação Google local-first (#4) | [#30](https://github.com/RodReis/rrb-jarvisOS/pull/30) | Regras 92 (79.6%), Banco 60 (87.0%), Tela 33 (93.5%) — **185 testes** contando os 3 E2E. **Fecha o MVP-001 (6/6 entregues).** Desbloqueada no mesmo dia, quando o PI criou as credenciais. A **categoria E2E deixa de contar 0**: o Playwright-Electron sobe o app empacotado e prova, com preload e IPC reais, que o shell não monta sem sessão e que a ponte não expõe caminho até o token. Dois achados de ambiente custaram tempo e ficaram registrados: `ELECTRON_RUN_AS_NODE` herdado do shell faz o Electron subir como Node puro (erro se disfarça de falha de bundle), e `close()`/`quit()` travam o teardown — o app vive no tray e os timers do `winston-daily-rotate-file` seguram o event loop. |
