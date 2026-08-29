# DEVELOPMENT.md — Ordem de execução e status

**Dono: Claude Code.** Atualize este arquivo a cada entrega, junto com `STATUS.md`. Aqui vive o *"onde estou dentro da fatia"* (passos com checkmarks); o *"qual fatia está em qual coluna"* vive nas GitHub Issues / `STATUS.md`. Nenhum fato mora nos dois lugares.

Regra de trabalho: **uma fatia por vez (WIP = 1)**. Só iniciar fatia com spec `aprovada-pi` e issue criada.

**Ordem de execução (MVP-001):** 01 → **06 (logging, infra transversal)** → **04 + 02 (entregues juntas)** → 03 → 05. A Fatia 06 roda logo após a 01 porque 02–05 devem logar desde o início; a 04 vem antes da 02 porque 02/03 consomem seus contratos tipados (decisão de 2026-07-22). As seções abaixo estão em ordem numérica; a 06 aparece após a 01 por ser quando ela executa.

> **04 e 02 saíram no mesmo PR (#28), por decisão do PI de 2026-07-22.** O critério 4 da SPEC-04 exige `AuditEvent` de `workspace-switch`, cujo fluxo nasce na F02 — entregá-las juntas evitou stub provisório que a F02 jogaria fora. A **F03 ficou de fora do bloco** por falta de credenciais (ver a seção dela).

## MVP-001 — Fundação

### Fatia 01 — Bootstrap e estrutura (`docs/spec/spec-fundacao-01-bootstrap.md`)

Status: **finalizado** (aceito pelo PI) — spec `aprovada-pi` (2026-07-21); issue #2; PR [#25](https://github.com/RodReis/rrb-jarvisOS/pull/25) mergeado em 2026-07-22 com CI verde.

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
- Card **[#41](https://github.com/RodReis/rrb-jarvisOS/issues/41)**: o renderer subia em porta variável, contra o `strictPort` do CLAUDE.md. Achado ao subir o app para inspeção; não misturado na fatia. **Corrigido em 2026-07-24** (PR [#73](https://github.com/RodReis/rrb-jarvisOS/pull/73)): `server: { host: '127.0.0.1', port: 5180, strictPort: true }` no `renderer` de `electron.vite.config.ts`, provado no app real (5180 fixa; falha ruidosa se ocupada).

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

### Fatia 05 — Identidades NOA e JARVIS (`docs/spec/spec-design-system-05-identidades.md`)

Status: **entregue** — spec `aprovada-pi` (2026-07-21); issue [#23](https://github.com/RodReis/rrb-jarvisOS/issues/23); PR [#46](https://github.com/RodReis/rrb-jarvisOS/pull/46). Depende da F02 (tokens/tema/acento). Era a paralela da F03b.

- [x] **Contrato de identidade** (`tokens/identidade.ts`): tom, acento padrão, mascote, nome e `vozPadrao` por módulo, como dado
- [x] **Glow radial do JARVIS** (critério 4): `--jos-atmosfera` + `FundoDaIdentidade` que a pinta; no NOA lê `none`
- [x] **VoiceMascot** (critérios 6 e 7): um componente para as duas identidades, anéis/glow/bob/boca/olhos, tile sempre escuro
- [x] **Sem motor de voz**: `falando`/`ouvindo` são reflexo por prop; no NOA são **recusados**, não só omitidos
- [x] Critérios 1–3 e 5 — mesmo componente nos dois módulos, acento sem vazamento, par escuro/claro, `uiTheme` global, semânticas idênticas
- [x] **Galeria de identidades** + 11 asserções em navegador real (as duas colunas lado a lado)
- [x] `test` 500 ✓, `lint` ✓, `typecheck` ✓, prova visual 40 ✓ (**+21 testes**)
- [x] Entrega: PR [#46](https://github.com/RodReis/rrb-jarvisOS/pull/46) (`refs #23`); docs/ commitados

**Decisões técnicas desta fatia:**

1. **A F02 já tinha entregue metade da identidade — o delta era menor do que a spec sugere.** `papeis()` (fundos por módulo e modo), `bordaRgb()` (hairlines) e `ACENTO_PADRAO` já carregavam o par escuro/claro e o acento de fábrica; `uiTheme` já era global e `data-modulo` já ia ao DOM. O que faltava era **atmosfera, mascote e tom** — e testes que afirmassem os critérios *como identidade*, não como tema. Reescrever o que existia para "ficar tudo junto na fatia" seria refatorar o que não quebrou; o `identidade.ts` **acrescenta** e não duplica.
2. **O teste do critério 5 achou um defeito de contraste real.** A variante de leitura das semânticas era ajustada contra `p.surface` — a superfície do **módulo ativo**. Como os fundos claros diferem (`#f5f6f8` no JARVIS, `#f2f4f2` no NOA) e o ajuste para no primeiro passo que cruza 4.5:1, a mesma semântica rendia cores diferentes nos dois espaços. Só o `violet` divergia, porque as outras quatro têm folga — e não era cosmético: o `#7a4ff5` do JARVIS media **4.45:1 sobre o fundo do NOA**, abaixo da régua. Uma semântica "compartilhada" legível em apenas um dos espaços não está compartilhada. Corrigido com `fundoDeReferencia()`, que ajusta contra o **mais exigente** dos dois fundos — o valor que serve ao pior caso serve aos dois, e sobra nos dois lados (violet: 5.10 / 4.98). Provado por mutação: voltando a `p.surface`, 2 testes ficam vermelhos.
3. **A igualdade sozinha não provava nada, e por isso há duas asserções.** "As duas identidades produzem a mesma cor" passaria com duas cores igualmente ilegíveis. A asserção que fecha o critério é a segunda: a cor de leitura atinge 4.5:1 **sobre os fundos das duas identidades**. Foi a diferença entre detectar o sintoma (valores divergentes) e o defeito (um deles reprovado).
4. **A prova visual achou um buraco que os 21 testes verdes não pegaram.** As nove asserções de navegador falharam achando **zero** elementos: `FundoDaIdentidade` aceitava só `children`/`className`, e o `data-prova-identidade` da galeria era descartado em silêncio. O componente de teste estava certo; o de produção é que não repassava o atributo. Corrigido na raiz (prop declarada na lista fechada, no padrão de `PropsDeComposicao` da F03a) em vez de contornar no seletor — contornar teria deixado o DS sem forma de recortar identidade para inspeção.
5. **Três critérios só são verificáveis no navegador, e não por preferência de ferramenta.** Em jsdom, `background-image` devolve a string que o componente escreveu: um `var(--jos-atmosfera)` apontando para variável inexistente passaria no teste de componente e pintaria nada. `getComputedStyle` resolve a variável — se ela não existe, vem `none` e a asserção quebra. O mesmo vale para `mix-blend-mode` (critério 7), que nenhum DOM virtual compõe, e para comparar a **cor pintada** das semânticas nos dois espaços (critério 5), que é a comparação que o olho do usuário faz.
6. **O guardrail anti-duplicação virou asserção, não recomendação.** Há um teste que varre a superfície de exportação do DS e falha se algum componente tiver `noa` ou `jarvis` no nome. Sem ele, "não duplicar componente" seria uma promessa no comentário — e a fatia seguinte (F04a) é justamente a que teria a tentação de criar um `AppShellJarvis`.
7. **Os assets do mascote moram dentro do DS, e isso corrigiu um atalho da F02.** O primeiro impulso foi pô-los em `src/renderer/assets/`, ao lado das fontes. O ESLint barrou: a regra de fronteira da F01 bane `**/src/renderer/*`. As fontes escapam porque são alcançadas por `url()` no CSS, que o ESLint não inspeciona — mas a razão da regra vale igual. O mascote **é** parte do design system, não algo que ele busca no renderer; copiar o arquivo para `src/design/assets/` custa 2 MB no repo e mantém a camada fechada.

**Registrado, não silenciado:**

- **Os mascotes estão muito maiores que o uso**: `jarvis-cabeca.jpg` é 2048×2048 (824 KB) e `noa-cabeca.png` é 1024×1024 (1,2 MB), para renderizar num círculo de ~120px. Redimensionar exige ferramenta de imagem e é otimização, não critério de aceite — candidato para a F06 (hardening).
- **`falaAutomatica` não foi implementada.** A spec a chama de "prop reservada" e o motor de voz é Corte 4. Uma prop que não faz nada seria pior que a ausência: sugeriria comportamento que não existe.
- A galeria de identidades cobre **1 de 8** acentos da paleta (o default de cada módulo), mais um segundo acento na asserção do glow. Ampliar a matriz é o mesmo candidato da F03a para a F06.

### Fatia 04a — AppShell + navegação (`docs/spec/spec-design-system-04a-appshell-navegacao.md`)

Status: **entregue** — spec `aprovada-pi` (2026-07-21); issue [#21](https://github.com/RodReis/rrb-jarvisOS/issues/21); PR [#49](https://github.com/RodReis/rrb-jarvisOS/pull/49). **Re-plataforma** a SPEC-Fundacao-02. Depende das F02, F03a/F03b e integra a F05.

- [x] **Grid do protótipo** (`60px 232px 1fr` / `52px 1fr 34px`), idêntico nos dois espaços
- [x] `AppShell`, `Rail`, `Sidebar`, `NavigationGroup`, `WorkspaceSwitcher`, `TopBar`, `ShellFooter` em `@design/patterns`
- [x] **Rail dual do JARVIS** (Command Center ⇄ Agents OS) com sub-módulo derivado da rota
- [x] **Toggle sol/lua** no TopBar — `uiTheme` global, sem reload, persistido pela via do Settings
- [x] Critério 2 — as garantias da SPEC-Fundacao-02 preservadas: **os 15 testes daquela fatia passam sem uma linha alterada**
- [x] Critério 4 — falha do runtime mantém o shell vivo e navegável
- [x] Critério 5 — fronteira verde; o DS não sabe o que é workspace
- [x] **Prova visual do shell** — as medidas do grid **renderizadas** (`boundingBox`), +10 asserções
- [x] `test` 522 ✓, `lint` ✓, `typecheck` ✓, prova visual 50 ✓
- [x] Entrega: PR [#49](https://github.com/RodReis/rrb-jarvisOS/pull/49) (`refs #21`); docs/ commitados

**Decisões técnicas desta fatia:**

1. **A prova de que foi re-plataforma, e não reescrita, são os testes que *não* mudaram.** Os 15 testes da SPEC-Fundacao-02 passam sem uma linha alterada. Isso não é conveniência: se algum tivesse precisado de ajuste, o que mudou não teria sido só a pele — teria sido o contrato, e aí a fatia estaria quebrando a fundação em vez de re-vesti-la. A divisão que sustenta isso é rígida: o DS desenha e não sabe o que é workspace; o renderer sabe o que é workspace e não desenha.
2. **O sub-módulo do JARVIS é derivado da rota, nunca guardado.** Um `useState('command')` ao lado da rota seriam duas fontes para a mesma verdade — e elas divergem no primeiro caminho que atualiza uma sem a outra: o rail acende Command Center enquanto a sidebar mostra a navegação do Agents OS. `subModuloDaRota(rotaAtiva)` é a única fonte. Provado por mutação: fixando o sub-módulo, o teste do critério 3 fica vermelho.
3. **`Agentic OS` não virou um quarto espaço por acidente.** O CLAUDE.md é explícito, e a tentação era real: `SubModuloJarvis` ao lado de `WorkspaceId` teria sido a modelagem "natural". Ele vive como **dimensão da navegação do JARVIS**, e há teste afirmando que o rail dual não aparece no NOA.
4. **O toggle de tema persiste pela via do Settings.** Estado local aqui faria o toggle da topbar e o seletor de Settings discordarem assim que o usuário usasse os dois — são dois controles da mesma preferência (SPEC-Fundacao-05). E o que se aplica é o `resolvedTheme` do main, não a preferência crua: `theme: 'sistema'` não diz se pinta claro ou escuro, e ler o valor cru deixaria o shell escuro com o sistema em claro. Também provado por mutação.
5. **O acordo entre rotas e sub-módulos virou asserção.** `ROTAS_POR_WORKSPACE.jarvis` e `ROTAS_POR_SUB_MODULO` têm de cobrir exatamente o mesmo conjunto; acrescentar uma rota sem colocá-la num sub-módulo a deixaria **órfã** — visível na sidebar de nenhum dos dois rails, sem nada falhar. Dois testes fecham os dois sentidos da relação.
6. **Um bug de três MVPs apareceu de raspão, e virou card próprio.** O teste novo do rail dual não rodava; a investigação mostrou que **`navegacao.spec.ts` nunca havia rodado** — o `include` da categoria Regras não alcançava `src/renderer`, e 75 linhas cobrindo o isolamento de rota por espaço estavam fora de toda categoria desde o PR #28. Corrigido no card **[#47](https://github.com/RodReis/rrb-jarvisOS/issues/47)** / PR [#48](https://github.com/RodReis/rrb-jarvisOS/pull/48), em branch próprio, **sem misturar na fatia**. A lição ficou no `TESTING.md` §2: um teste que não roda é indistinguível de um que não existe — e é pior, porque o relatório sugere cobertura que não há.
7. **A prova visual mede o grid, que é o que jsdom não vê.** `width: 60px` em jsdom é a string que o componente escreveu: um rail colapsado por um `flex` mal resolvido passaria em todos os testes de papel. `boundingBox` mede o renderizado. Junto vai a asserção de que as regiões **não se sobrepõem** — o defeito clássico de shell (conteúdo passando por baixo da sidebar), invisível para qualquer asserção de ARIA.
8. **`main.tsx` trocou a cadeia de ternários por mapa.** Com quatro galerias o encadeamento já tinha três níveis, e o próximo `else if` seria onde o default se perde de vista. Galeria desconhecida agora **lança** em vez de cair no default — mesma disciplina que a `cena` já tinha: sem isso a captura teria o nome de uma galeria e o conteúdo de outra.

**Registrado, não silenciado:**

- **Seis componentes da spec §Escopo ficaram de fora**: `Breadcrumb`, `PageHeader`, `Tabs`, `Accordion`, `CommandBar` e `CommandPalette`. Nenhum é exigido pelos critérios de aceite, e sem tela de produto que os use (Corte 3+) seriam casca — pior que ausência num componente de navegação, porque sugere um caminho que não leva a lugar nenhum. A F04b/F06 decide com tela real na mão.
- O `WorkspaceSwitcher` mora na sidebar, não na topbar. O protótipo põe o atalho para o outro espaço **no rodapé do rail** (JARVISOS §2) — que também existe aqui. Manter o radiogroup na sidebar preserva as quatro asserções da fundação sem duplicar o controle; unificá-los é decisão de produto, não minha.
- O rail do NOA está vazio de itens próprios (só mascote + rodapé). O protótipo o usa para atalhos de view (NOA §2), e essas views são Corte 3+.

### Fatia 04b — Padrões operacionais (`docs/spec/spec-design-system-04b-padroes-operacionais.md`)

Status: **entregue** — spec `aprovada-pi` (2026-07-21); issue [#22](https://github.com/RodReis/rrb-jarvisOS/issues/22); PR [#50](https://github.com/RodReis/rrb-jarvisOS/pull/50). Depende das F03b e F04a.

- [x] **Status** (critério 4): `SyncStatus` com os 5 estados do PRD §12.4; `StatusOperacional` para agente/serviço/provider/conector/execução
- [x] **Risco e aprovação** (critério 1): `RiskIndicator`, `SensitiveActionSummary`, `ApprovalDialog` — impacto, solicitante, risco e custo **antes** da confirmação
- [x] **Redaction de texto** (critério 3): `redigir.ts` + `LogViewer` que a aplica sempre
- [x] **BYOK** (critério 2): `ProviderSetup` com a mensagem literal do PRD §12.5, `MaskedCredentialSummary`, `RemoveCredentialDialog`
- [x] **Diagnóstico** (critério 5): `RuntimeUnavailable` com cópia **redigida** e reinício condicional
- [x] Critério 6 — tudo por props; fronteira verde
- [x] **Galeria de operacionais** + 14 asserções em navegador real (contraste computado e segredo ausente)
- [x] `test` 552 ✓, `lint` ✓, `typecheck` ✓, prova visual 64 ✓ (**+30 testes**)
- [x] Entrega: PR [#50](https://github.com/RodReis/rrb-jarvisOS/pull/50) (`refs #22`); docs/ commitados

**Decisões técnicas desta fatia:**

1. **A redaction de texto é camada nova, não cópia da que existe.** O `redact()` de `src/shared/contracts/logging-redaction.ts` opera sobre **objeto estruturado** — apaga o valor de chaves sensíveis em qualquer profundidade. O `LogViewer` recebe **linha já formatada**, e um `Authorization: Bearer sk-abc…` no meio de uma mensagem é string, não chave: passa intacto por aquela função. Confirmei lendo a implementação antes de escrever a minha. A fronteira da F01 (o DS não importa `@shared`) não foi obstáculo a contornar — foi o que manteve `redigir.ts` puro e sem contexto de domínio.
2. **O teste achou um bug na minha própria regex, e era do tipo pior.** A regra de cabeçalho parava em `Bearer` e deixava o token logo depois: `Authorization: [redigido] xyz98765`. Um vazamento que **parece limpo** é pior que nenhum saneamento — quem revisa o log vê o marcador e para de procurar. Corrigido fazendo o esquema (`Bearer`/`Basic`/`Token`) entrar no trecho consumido. Pego pelo teste "mais de um segredo na mesma linha", que eu escrevi sem esperar que falhasse.
3. **Os limites da redaction estão escritos como teste, não como ressalva em comentário.** Três casos documentam o que ela **não** pega: segredo sem nome, prefixo ou forma; valor quebrado em várias linhas; campo em idioma não previsto. Nenhum é bug a corrigir com mais regex — um segredo sem forma reconhecível é indistinguível de um id qualquer, e a regra que o pegasse apagaria metade do log. O que fecha o buraco é o `redact()` do main, na escrita. Uma regex de segurança sem os seus limites escritos vira promessa falsa.
4. **No BYOK, quem recusa a chave é o tipo.** `CredencialMascarada` não tem campo onde ela caiba — nem opcional, porque opcional é o que alguém preenche "só neste caso". A chave crua existe apenas entre a digitação e o submit, e é limpa **antes** de qualquer `await`: um `setChave('')` depois da validação de rede a deixaria viva no estado React durante toda a chamada, visível em devtools. E `autoComplete="off"` porque o gerenciador de senhas do navegador é exatamente o "storage do renderer" que o PRD §15 proíbe.
5. **`StatusOperacional` é um componente para os seis nomes da spec.** `AgentStatus`, `ServiceStatus`, `ProviderStatus`, `ConnectorStatus`, `ExecutionStatus` seriam cinco cópias do mesmo `texto + ícone + cor`; o que muda entre eles é o **rótulo**, que vem por prop. Mesma disciplina anti-duplicação da F05, aplicada a nomes em vez de identidades.
6. **`inativo` não virou um quinto tom semântico.** `TomSemantico` tem quatro valores e não inclui neutro, o que está certo: as semânticas comunicam *estado do sistema*, e "desligado" não é um estado semântico — é a falta de um. Mapeia para `undefined`, e o leitor de tela ouve "inativo" em vez de um tom inventado que se espalharia pelo DS inteiro para servir um caso.
7. **A prova visual mede o contraste de quem carrega a informação mais crítica.** Risco e sync leem justamente as semânticas que a F03a mediu falhando 4.5:1 como texto no modo claro. Um risco alto ilegível é pior que um sem estilo: ele *parece* informação. E o critério 3 ganha ali a prova mais forte — nenhum segredo no `innerText` **nem no HTML cru**, o que cobre `title`, `aria-label` e `value`, que o texto renderizado não vê.
8. **As cenas da galeria passaram a ser validadas por galeria.** A lista era global desde a F03b; com `aprovacao`/`remocao` entrando, uma lista única aceitaria `toasts` na galeria de operacionais e devolveria a cena estática com o nome de outra — o mesmo tipo de mentira silenciosa que a validação existe para impedir.

**Registrado, não silenciado:**

- **Treze componentes da spec §Escopo ficaram de fora**: `ExecutionCard`/`ExecutionRow`/`ExecutionTimeline`, `CostMeter`/`BudgetStatus`/`DurationIndicator`, `ApprovalRequestCard`, `RejectionReason`, `AuditEvent` visual, `RetryAction` isolado e os quatro `*Status` cobertos por `StatusOperacional`. Nenhum é exigido pelos critérios de aceite. Custo e orçamento são visuais com dado mock por decisão do PI (Corte 3) e, sem tela que os consuma, seriam casca — mesma razão da F04a.
- O `ApprovalDialog` estendeu o `AlertDialog` da F03b com `children` opcional, em vez de criar um segundo diálogo em `patterns`. Duas implementações do contrato do destrutivo divergiriam, e a que divergisse seria a usada em produção.

### Fatia 06 — Adoção & hardening (`docs/spec/spec-design-system-06-adocao-hardening.md`)

Status: **entregue** — spec `aprovada-pi` (2026-07-21); issue [#24](https://github.com/RodReis/rrb-jarvisOS/issues/24); PR [#51](https://github.com/RodReis/rrb-jarvisOS/pull/51). **Fecha o MVP-003.**

- [x] **Jornada de 3 telas** só com componentes/tokens públicos: CHOICE, NOA Hoje, JARVIS HUD
- [x] `AccentSwatchSelector` — a paleta fixa por módulo, que vive na CHOICE (a F04a a deixou fora do shell de propósito)
- [x] Critério 2 — telas internas em claro **e** escuro; CHOICE aplica o acento por módulo
- [x] Critério 3 — as duas identidades corretas e sem vazamento; o acento escolhido **chega** à tela interna
- [x] Critério 4 — navegação completa por teclado, foco visível medido em navegador real
- [x] Critério 5 — nenhum estado essencial só por cor
- [x] **Hardening**: 5 usos de `focus-visible:ring` eliminados; assets 2043 KB → 77 KB
- [x] `test` 568 ✓, `lint` ✓, `typecheck` ✓, `build` ✓, prova visual 77 ✓ (**+16 testes**)
- [x] Entrega: PR [#51](https://github.com/RodReis/rrb-jarvisOS/pull/51) (`refs #24`); docs/ commitados

**Decisões técnicas desta fatia:**

1. **Três defeitos, e os três invisíveis para teste de papel.** Esta fatia justificou o nome "hardening" pelo que a captura revelou, não pelo que eu planejei consertar:
   - **A camada `patterns` estava sem CSS utilitário.** O `@source '../patterns'` faltava no `prova.css` — a camada nasceu na F04a, *depois* daquele bloco, e ninguém a acrescentou. Os swatches, declarados `size-7` (28px), renderizavam a **2px**. `getByRole('radio')` acha um botão de 2px tão bem quanto um de 28px, então nenhuma asserção de papel jamais acusaria. É o mesmo defeito que motivou o bloco na F03a, repetido numa camada nova — a lição é que `@source` é uma lista que precisa **crescer junto com as camadas**, e agora há teste que a trava.
   - **O `vite.prova.config.ts` não declarava o alias `@design`**, que os outros **três** configs já tinham. A troca de `../../` pelo alias — exigida pela fronteira da F01, que barrou os imports das telas em `prova/jornada/` — quebrou a galeria inteira: 76 provas falharam de uma vez. E `test`/`lint`/`typecheck` seguiram **verdes o tempo todo**, porque cada ferramenta tem o seu próprio mapa de alias e três deles concordavam. Três gates locais verdes com o app quebrado.
   - **Um dialeto de foco que eu mesmo introduzi**: 5 usos de `focus-visible:ring` nas F04a/F06, contra a constante `FOCO` que o DS tem desde a F03a. Pego pela prova visual do anel de foco. A correção não foi contornar o teste — foi eliminar o estilo paralelo, que é literalmente o que o critério 1 desta fatia manda fazer.
2. **A jornada prova o que tela isolada não provaria.** Três capturas estáticas mostrariam três telas bonitas; o que o percurso verifica é a **costura**: o acento escolhido na CHOICE chega ao provider da tela interna, e escolher no NOA não move o JARVIS. Um setter por módulo (em vez de um objeto compartilhado) é a garantia estrutural disso.
3. **A dívida da F05 foi quitada, não herdada.** Os mascotes eram 2048²/1024² e somavam 2 MB — três vezes o bundle de JS — para renderizar num círculo de no máximo 160px. Reduzidos a 512px (cobre 2× retina do maior uso). O PNG do NOA **não tinha canal alfa** — o recorte é feito por `mask-image` no CSS —, então o formato sem perdas não comprava nada: 304 KB viraram 32 KB. Total: **2043 KB → 77 KB (−96%)**.
4. **A CHOICE não entra na matriz claro/escuro, e isso é conteúdo do teste.** Ela é superfície de marca (F02): não *tem* modo claro. Capturá-la duas vezes produziria dois arquivos idênticos com nomes diferentes — uma mentira silenciosa sobre cobertura. Em vez disso há uma asserção de que ela **permanece escura** sob `modo=light`, que é o conceito da F02 sobrevivendo à composição real.
5. **O critério 1 não ganhou teste próprio, de propósito.** Quem prova "só componentes públicos" é o **lint**: a regra do critério 5 da F03a barra cor e medida literais em `src/design`, e a fronteira da F01 barra import de fora. Um teste que "verificasse composição" mediria o que eu escrevi, não o que a regra impõe — e passaria feliz enquanto eu escrevesse `<div style={{color:'red'}}>`.
6. **O swatch selecionado não é marcado por cor.** Ele **é** uma cor: destacá-lo com outra competiria com o próprio valor que mostra. A seleção vive em `aria-checked` (leitor de tela) e em escala + borda clara (daltonismo).

**Registrado, não silenciado:**

- O `it.todo` do `RadioGroup` por setas (F03a) **continua aberto**: roving tabindex do Radix não é verificável em jsdom. O teste de teclado da jornada cobre `Tab` e `Enter`/espaço nos swatches e checkboxes, mas não navegação por setas dentro de um `radiogroup` do Radix. Candidato ao E2E de uma fatia futura.
- O roteiro **manual** de teclado que a spec menciona (§Escopo) não foi executado por mim — só o automatizado. É verificação do PI no aceite.
- A jornada usa dados mock por props, como a spec determina: é prova de composição, não a entrega das telas de produto (Corte 3+).

## MVP-003 — aceito e fechado

**Aceito pelo PI em 2026-07-23.** As 8 fatias (#17–#24) estão `closed` + `proplan:finalizado`; o épico **[#16](https://github.com/RodReis/rrb-jarvisOS/issues/16)** foi fechado. O corte inteiro saiu em um dia.

O que o MVP-003 deixa: **569 testes** (Regras 230 · Banco 132 · Tela 211, cobertura 92%) e **77 provas visuais** em navegador real. A tese que o motivou — *base única, duas identidades* — está provada na jornada da F06: NOA e JARVIS lado a lado na CHOICE, saídos dos mesmos componentes, diferentes só por token.

**A lição de método do corte** foi sobre camadas de verificação, e ela se repetiu em quase toda fatia: os testes de papel provam contrato, a **prova visual em navegador prova pintura**, e as duas não se substituem. O que só a captura pegou, com os testes verdes: o CSS que não era gerado (F03a), o card do NOA invertido (F03a), o `data-attribute` descartado em silêncio (F05), o alias que quebrou a galeria inteira com `test`/`lint`/`typecheck` verdes (F06), a camada `patterns` sem CSS utilitário desde a F04a (F06) e o `Meter` que escondia o rótulo (#52, achado ao revisar a captura **para o aceite**).

Três `[FIX]` nasceram durante o corte e foram aceitos à parte: **#43**, **#47** e **#52** — todos `proplan:finalizado`.

## Após o MVP-003

Ordem: **MVP-004** ([#10](https://github.com/RodReis/rrb-jarvisOS/issues/10), execução real + terminal) → MVP de providers (Corte 3, com BudgetPolicy). Ordem macro em `docs/LANDSCAPE.md` § Roadmap.

### [INFRA] #34 — Separar o E2E em job de CI próprio, condicional por paths (entregue, 2026-07-24 · PR #71)

Card de infra (sem spec — fonte: decisão do PI de 2026-07-22 + ADR-003). O E2E Playwright-Electron dominava o tempo de CI (build + xvfb + keyring + boot do Electron, ~15 min) e rodava **em todo PR**, mesmo quando o PR não tocava a fronteira que o E2E prova. Passos:

- [x] **Orquestrador** (`scripts/test-report.mjs`): tirei `npm run build` + `playwright test`. O relatório não depende mais do app empacotado; geração local caiu de ~min para ~16s.
- [x] **Config** (`test-report.config.json`): a categoria "Tela" perdeu o `playwrightJson` — passou a contar **só o vitest-componente**. Estado atual: Tela 215 (era 218 com os 3 do E2E somados). `readPlaywrightJson` fica no gerador (repo-agnóstico), sem chamador, apontado no comentário.
- [x] **`ci.yml`**: três jobs. `test` (relatório, sem E2E), `e2e` (todos os steps de ambiente — binário, setuid, keyring, build, xvfb — só quando o PR toca a fronteira) e `gate` (required check único que agrega `test` + `e2e`). Um job `changes` faz `git diff` contra a base e casa `src/main/preload/**`, `src/main/index.ts`, `src/main/window.ts`, `tests/e2e/**`, `playwright.config.ts` — sem action de terceiros (`paths:` no evento cancelaria o workflow inteiro).
- [x] **`docs/TESTING.md`**: §2/§3/§3.1/§6/§9 atualizadas — "Tela" no relatório = componente; E2E é check à parte condicional.
- [x] **Ao mergear:** required check trocado de `test` → `gate` na branch protection (feito pelo PI — é ação de admin, o classificador me bloqueou de mexer na proteção da `main`). Ordem seguida: trocar primeiro (gate já verde no #71, não bloqueou), mergear depois.

**A decisão de projeto que fecha a garantia do card** ("o E2E completo tem de rodar no caminho para a `main`, a condicional nunca esconde regressão"): o `gate` é required em vez do `e2e`. Um required check **pulado** por `if:` fica *pending eterno* no GitHub e bloqueia o merge — a armadilha clássica de condicionar job por paths. O `gate` sempre roda (`if: always()`), lê `needs.e2e.result` e aceita `skipped` (PR não toca a fronteira) ou `success`, barrando em `failure`. Assim o E2E condicional nunca trava o merge, e um E2E que falha de verdade ainda derruba o gate.

### [INFRA] #66 — Custo do GitHub Actions / `concurrency` no CI (2026-07-24 · PR #72)

Card criado pelo Code quando o orçamento de Actions chegou a $3,30/$5,00 (repo privado ⇒ Actions cobrado). **Resolvido na origem pelo PI**, que tornou o repo **público** (Actions grátis e ilimitado) após a auditoria de segurança do próprio card (`.env` nunca commitado, nenhuma chave real no histórico). O card ficou aberto como guarda — *"se voltar a privado, o custo volta"*.

Das opções técnicas do card, duas já haviam saído — **separar o E2E por paths** foi o #34; **validar local antes do push** é disciplina, não código. Sobrou **`concurrency`**, entregue aqui:

- [x] **`ci.yml`**: bloco `concurrency` com `group: ci-${{ github.ref }}` + `cancel-in-progress: true`. Push novo no mesmo PR cancela a execução anterior — três pushes seguidos não deixam três suítes (~7 min cada) rodando em paralelo quando só a última conta. A `main` não passa por aqui (o workflow só dispara em `pull_request`), então não há risco de cancelar o CI de um merge. Runner efêmero: cancelar não deixa Supabase nem processo órfão.
- [x] **`docs/TESTING.md` §6**: `concurrency` documentado na descrição dos disparos.

Efeito mensurável do #34 + #66 juntos: o PR fora da fronteira roda `test` (~4 min) e pula o `e2e` (~15 min); pushes repetidos param de empilhar. O custo de Actions cai mesmo se o repo voltar a privado.

## MVP-004 — Execução real ([#10](https://github.com/RodReis/rrb-jarvisOS/issues/10))

O corte em que o **modo report vira enforcement**: a decisão do Policy Engine deixa de ser só
rastro e passa a impedir ou pausar operações de verdade. Três fatias — a F01 liga o filesystem,
a F02 liga o terminal, e as duas compartilham a mesma espinha: Policy Engine em enforcement +
`AuditEvent` antes/depois + aprovação humana numa fila só. A **F03 nasceu da verificação da
F02**: o enforcement funcionava, mas o usuário não tinha tela para permitir um diretório — e
sem isso o terminal recusava todo cwd. Ela não muda enforcement nenhum; entrega o acesso a ele.

### Fatia 01 — Execução real de filesystem allowlisted (`docs/spec/spec-execucao-real-01-filesystem-allowlisted.md`)

Status: **entregue** — spec `aprovada-pi`; issue [#74](https://github.com/RodReis/rrb-jarvisOS/issues/74); PR [#81](https://github.com/RodReis/rrb-jarvisOS/pull/81) (squash `19870a3`). Constrói a espinha que a F02 consome: `RealFileSystemEngine`, `ApprovalRepository`, migration 7 (`approval_request`) e o painel de aprovações pendentes.

### Fatia 02 — Terminal controlado (command-runner allowlisted) (`docs/spec/spec-execucao-real-02-terminal-controlado.md`)

Status: **entregue** — spec `aprovada-pi` (2026-07-24); issue [#75](https://github.com/RodReis/rrb-jarvisOS/issues/75). Depende da F01 entregue. Modelo **command-runner** (submete → valida → executa → devolve saída), **não** PTY — decisão do PI de 2026-07-24.

- [x] **Allowlist de comandos** (conceito novo — o MVP-002 só tinha allowlist de *diretórios*): migration 8 (`allowed_command`), escopada por `user_id` **e** `workspace_id`, **default vazio**. Editar a lista é `permissions.change` (alto risco), classificado + auditado (`allowlist-change`)
- [x] **Denylist de padrões destrutivos** em `src/shared/policies/destructive-commands.ts` — dado versionado, não hardcode; eleva a `requires-approval` e pausa pelo fluxo da F01, na **mesma** fila de `ApprovalRequest`
- [x] **cwd** validado contra a allowlist de diretórios (`isPathAllowed` + canonicalização); **elevação** (`sudo`/`runas`/`pkexec`/…) barrada **antes** da allowlist e não contornável por ela
- [x] **Executor** com `spawnSync`, `shell: false`, cwd explícito, **timeout obrigatório com kill** (`SIGKILL`), env em **lista de permissão** e saída redigida + truncada antes de virar evidência
- [x] **Auditoria** `terminal-command` antes/depois — **inclusive nas recusas** — com comando, cwd, saída, erro, duração e exit code (RF-016); `verifyChain` passa
- [x] **IPC tipado** (`terminal:run` + 3 canais de allowlist) com binário e argumentos **separados**; `approval:resolve` passa a **rotear pelo motor que criou o pedido**
- [x] **Painel** na rota nova `terminal` (sub-módulo `command` do JARVIS), só com componentes públicos do DS (`LogViewer`, `StatusOperacional`), operável por teclado
- [x] **27 testes novos** — 18 de integração (Banco) provando **por efeito**, 9 de tela

**Decisões do PI (2026-08-28), ambas registradas no código:**

1. **Submissão em campos separados**, não linha tokenizada. Não é escolha de UI — é a barreira. Com `shell: false` e campos separados, `;`, `&&`, `|` e `$()` **nunca chegam a ser metacaracteres**: um `;` num argumento é o caractere literal que o processo recebe. A alternativa (campo único + tokenizador no main + rejeição de metacaracteres) trocaria uma garantia estrutural por uma lista de rejeição que precisa estar completa para funcionar.

2. **Allowlist satisfeita libera a execução** — o precedente que a F01 abriu para `fs.write-allowed`. O seed do MVP-002 classifica `terminal.run-allowlisted` como **médio**, e médio deriva `requires-approval`; ao pé da letra, `git status` num binário que o usuário permitiu explicitamente abriria pedido de aprovação, e **as duas barreiras colapsariam numa só** (o gate humano seria idêntico com ou sem allowlist). O argumento que sustenta a liberação: *permitir o binário já foi a aprovação* — ato de alto risco, classificado e auditado. A taxonomia **não** foi reescrita: ela segue dizendo que a ação é médio risco; o que a fatia afirma é que as barreiras dela cobriram esse risco. Destrutivo continua pausando.

**O que os testes acharam e a leitura não pegaria:**

- **A aprovação não pode sobrepor a allowlist vigente.** Aprovar autoriza *aquele comando*; não congela o mundo. Entre a criação do pedido e a decisão o usuário pode revogar o binário — e o `resolveApproval` **re-valida as duas barreiras** antes de executar. Sem isso, aprovar viraria exceção permanente à política, que é o oposto do que o gate existe para fazer. Há teste que revoga no meio do caminho e exige que a execução seja barrada.
- **O `process.env` do main não pode chegar ao processo filho.** A allowlist de binários não protege contra isso: o binário é legítimo, o que vazaria é o ambiente (chaves de API, tokens do vault). O env entregue é **lista de permissão** — só o que um processo comum precisa para rodar. Teste semeia um segredo no env do app e exige que o filho leia "ausente".
- **A redação vem antes do truncamento.** Truncar primeiro poderia cortar um token ao meio e deixar o pedaço escapar da redação, que casa padrões inteiros — o segredo vazaria *justamente por ter sido cortado*.
- **Exit code ≠ 0 é falha do comando, não do terminal.** Um `npm test` que reprova é desfecho normal; tratá-lo como erro de infraestrutura confundiria a UI. Os dois casos têm `reason` distinto e evento de auditoria distinto.
- **A migration nova precisou ser desfeita no teste v1→v2.** O `storage.int-spec.ts` recua o schema derrubando o que cada migration cria; sem derrubar `allowed_command`, a migração tentava recriar a tabela. O próprio comentário do teste avisa disso — a suíte cobrou.

### Verificação no app real (2026-08-28) — e o login que a destravou

A ressalva de UI que a F01 abriu e a F02 herdou (*"a fila de aprovação nunca foi vista renderizada"*) só existia porque **o login não funcionava**. Investigado com o log do app, e a causa eram **duas configurações**, nenhuma delas código:

1. **O projeto Supabase estava pausado** (`INACTIVE`). Um projeto pausado não atende `/auth/v1/authorize`.
2. **`http://127.0.0.1:*` não estava na allowlist de Redirect URLs.** O Supabase descartava o `redirect_to` e caía no Site URL (`localhost:3000`, o default de fábrica); o servidor loopback nunca recebia o código e o fluxo morria no timeout de 5 min.

O log conta a história inteira, e é o que fecha o diagnóstico sem chute:

```
23:32:30  Servidor de retorno iniciado {porta: 64525}
23:32:30  Fluxo aberto no navegador
23:37:30  (5 min depois) Tempo esgotado aguardando o retorno do login   ← antes
...
23:56:03  Servidor de retorno iniciado {porta: 53952}
23:56:08  Tokens gravados cifrados no cofre
23:56:08  Login concluído                                              ← depois: 5s
```

**O console do Google estava correto o tempo todo** — ele só devolve para o Supabase (`/auth/v1/callback`), nunca para o app; quem precisa aceitar `127.0.0.1:<porta>` é a allowlist do Supabase. A porta é efêmera (`loopback-server.ts`), daí o wildcard: na doc do Supabase os separadores de glob são `.` e `/`, então `*` cobre a porta.

**Método que vale registrar:** o primeiro teste que usei para provar a allowlist (`callback` com `state` inventado) era **inconclusivo** — com state inválido o Supabase aborta antes de resolver o `redirect_to` e cai no Site URL de qualquer jeito, o que parece exatamente igual a "allowlist recusou". Só o teste com `state` legítimo (obtido de um `/authorize` real) distingue os dois.

Com o login de pé, a verificação rodou no app real (Electron com debug remoto, efeitos no disco). Os 8 critérios de comportamento confirmados: binário barrado **não** cria arquivo; permitido cria; `node --version` devolve `v24.15.0` na tela; destrutivo pausa e só executa depois do Aprovar; Negar não executa; `sudo` barrado **mesmo allowlistado**; erro com exit 3 e stderr; timeout matando em 30s exatos. `verifyAuditChain` → `{ok: true, checked: 77}`. **A fila de aprovações renderiza**, fechando também a ressalva da F01.

E, como no MVP-003, **a verificação no app real achou o que a suíte verde não acha** — dois defeitos:

- **O card de aprovação descreve comando de terminal como filesystem** (issue **#84**). `AprovacoesPendentes.tsx:27` monta `Filesystem: ${operation}` fixo e lê só `path`/`targetPath`; a F02 grava `kind: 'comando'` com `binary`/`args`/`cwd`, que o componente ignora. O usuário aprova uma execução de processo **sem ver qual comando é** — contra a SPEC-DS-04b §21 ("exibem ação… antes da confirmação") e o contrato `AcaoSensivel` ("em linguagem de usuário"). É `[FIX]`: o certo já está escrito. **Corrigido em 2026-08-29** (PR desta entrega): o resumo ramifica pelo mesmo `kind` que o handler de `approval:resolve` já usa para rotear. Ver o registro abaixo.
- **A allowlist de *diretórios* não tem UI nenhuma.** Os canais existem na ponte desde o MVP-002 e **nenhuma tela os usa** (zero referência a `addAllowedDirectory` em `src/renderer`). Pelo app o usuário não consegue permitir um diretório — e sem isso o terminal não executa nada, porque o cwd sempre cai fora. Precisei usar a ponte direto para concluir a verificação. **Não** é `[FIX]`: não há parágrafo definindo onde essa tela mora nem como se comporta ⇒ é fatia, com spec e aval do PI. **Virou a M4-F03, entregue em 2026-08-29** — seção abaixo.

**Registrado, não silenciado:**
- **Argumento com espaço não é suportado.** A divisão dos argumentos é por espaço, sem aspas nem escape — deliberado: um parser mais esperto se aproxima de ser um mini-shell no renderer, que é o que a fatia evita. Quando aparecer uso real, vira campo de lista, não sintaxe.
- **Granularidade por subcomando** (permitir `git status` mas não `git push`) segue fora, como a spec determina: a 1ª barreira é por binário, e o refino fica para quando houver caso concreto.

### Fatia 03 — UI da allowlist de diretórios (`docs/spec/spec-execucao-real-03-ui-allowlist-diretorios.md`)

Status: **entregue** — spec `aprovada-pi` (2026-08-29); issue [#110](https://github.com/RodReis/rrb-jarvisOS/issues/110). Fecha o buraco que a verificação da F02 achou: a tela que faltava para o usuário permitir um diretório **pelo aplicativo**.

- [x] **Seção "Diretórios permitidos" em Settings**, nos dois espaços — a allowlist governa filesystem (F01) *e* terminal (F02), é capacidade compartilhada (decisão 1 do PI)
- [x] **Seletor nativo de pasta** (decisão 2 do PI): `dialog.showOpenDialog` com `properties: ['openDirectory']`, aberto **no main**; cancelar não altera nada e não audita
- [x] **Listar e remover** pelos canais que já existiam desde o MVP-002 — contrato antigo intacto
- [x] **`appDir` apresentado como fixo**, com a linha que diz **por quê** — o repositório já recusava removê-lo, a tela passa a mostrar a regra em vez de deixar o botão prometer o que não acontece
- [x] **Estados vazio / carregando / erro** pelos componentes da SPEC-DS-04b (`EmptyState`, `LoadingState`, `ErrorState`), i18n nos dois idiomas
- [x] **13 testes novos** (4 de Regras nos handlers, 9 de Tela) + **1 E2E** da jornada real

**A fatia adicionou dois canais, não um — e vale registrar por quê.** A spec previa **um** canal novo (o do seletor). Ao implementar o critério 4 apareceu o que a spec não tinha: `listAllowedDirectories` devolve `readonly string[]`, strings sem marcação, e o `appDir` **nunca atravessava o IPC identificado** — a tela não tinha como saber qual dos paths é o fixo. As três saídas eram mudar o retorno de `list` (a spec proíbe explicitamente), inferir por posição no renderer (acopla a UI à ordem de inserção do `Set` no repositório e põe lógica de path na tela, contra a regra "a tela nunca canoniza nem valida path"), ou **um segundo canal só-leitura**. O PI decidiu pelo canal (`allowlist:app-dir`): o que a spec realmente protege é o **contrato antigo**, e ele fica intacto.

**O que a fatia deliberadamente não faz:** o `AllowlistRepository` não mudou uma linha de comportamento — ganhou só um getter do `appDir` que já estava injetado. Nenhum `AuditEvent` novo, nenhuma classificação nova, nenhum toque em `isPathAllowed`. Adicionar e remover auditam porque **já auditavam** desde o MVP-002; o critério 5 estava coberto antes de a fatia começar.

**Duas guardas de superfície cobraram os métodos novos** — `preload.spec.ts` e o E2E de login —, e as duas foram atualizadas **enumerando um a um**, como na F01 e na F02 do MVP-005. É o terceiro caso do mesmo padrão: a lista fechada é o que faz um método futuro que devolvesse handle de arquivo quebrar o teste em vez de passar despercebido.

**O E2E prova a jornada; o seletor nativo fica fora dele.** `dialog.showOpenDialog` é janela do sistema operacional, fora do alcance do Playwright — automatizá-la mediria o gerenciador de arquivos do SO. O recorte é o mesmo do `login.e2e.ts` com a tela do Google: o E2E prova que a pasta **recusada** por `cwd-fora-da-allowlist` passa a ser aceita depois de permitida, e o que o diálogo faz depois da escolha (canonizar, adicionar) é provado no handler com o `dialog` dublado.

**Contrafactuais** (a régua adotada depois de #57/#58): `appDir` marcado como removível, erro técnico vazando para a tela no lugar da mensagem de produto, e a tela ignorando o path que o main devolveu — os três reprovam o teste correspondente.

**Verificação no app real (2026-08-29), com a sessão logada.** A seção foi medida renderizada, no Electron com debug remoto — a régua que faltava, e a que pegou os defeitos de #57/#58, #107 e #84. Os valores computados confirmam o que jsdom não mede: texto em `rgb(238,241,245)` sobre o fundo do tema (os tokens resolvem — não é o caso do #107), a `Tag` do `appDir` em 12px com borda a 24% de opacidade, os botões de remover na variante perigo (`rgb(255,107,129)`), altura de controle 44px, **sem overflow horizontal** com paths longos, e o anel de foco de 3px alcançável por teclado. Remover **pela tela** (não pela ponte) tira o item da lista, o `appDir` não tem botão de remover, e `verifyAuditChain` → `{ok: true, checked: 129}`.

**E a verificação achou algo que só a tela poderia mostrar** — não um defeito desta fatia, mas o que a ausência dela escondia: a allowlist tinha **duas entradas-lixo** gravadas por uso manual da ponte durante as verificações anteriores — uma terminando em `\rrb-jarvisOS\jarvis`, outra em `\rrb-jarvisOS\DesenvProjetos rb-jarvisOS`. Elas existem porque `canonicalize` chama `resolve(path)`, que **relativiza contra o cwd** um path não-absoluto — comportamento documentado do MVP-002, e o handler aceita qualquer string por desenho ("a checagem downstream barra o que resolver pra fora"). O ponto que interessa é que **o seletor nativo torna isso impossível**: `dialog.showOpenDialog` só devolve caminho absoluto real. É exatamente a decisão 2 do PI — *"num campo onde errar significa permitir a pasta errada, digitação livre é risco sem contrapartida"* —, e a tela agora **expõe** o que antes era invisível: até existir UI, ninguém tinha como ver o que estava permitido.
rb-jarvisOS\jarvis`, outra em `
rb-jarvisOS\DesenvProjetos rb-jarvisOS`. Elas existem porque `canonicalize` chama `resolve(path)`, que **relativiza contra o cwd** um path não-absoluto — comportamento documentado do MVP-002, e o handler aceita qualquer string por desenho ("a checagem downstream barra o que resolver pra fora"). O ponto que interessa é que **o seletor nativo torna isso impossível**: `dialog.showOpenDialog` só devolve caminho absoluto real. É exatamente a decisão 2 do PI — *"num campo onde errar significa permitir a pasta errada, digitação livre é risco sem contrapartida"* —, e a tela agora **expõe** o que antes era invisível: até existir UI, ninguém tinha como ver o que estava permitido.
rb-jarvisOS\jarvis` e `…
rb-jarvisOS\DesenvProjetos rb-jarvisOS`). Elas existem porque `canonicalize` chama `resolve(path)`, que **relativiza contra o cwd** um path não-absoluto — comportamento documentado do MVP-002, e o handler aceita qualquer string por desenho ("a checagem downstream barra o que resolver pra fora"). O ponto que interessa é que **o seletor nativo torna isso impossível**: `dialog.showOpenDialog` só devolve caminho absoluto real. É exatamente a decisão 2 do PI — *"num campo onde errar significa permitir a pasta errada, digitação livre é risco sem contrapartida"* —, e a tela agora **expõe** o que antes era invisível: até existir UI, ninguém tinha como ver o que estava permitido.

**Um defeito que a revisão pegou e a suíte de 9 testes não pegava.** A primeira versão renderizava o `ErrorState` como **irmão** do conteúdo, e não no lugar dele. Falhando a carga, o `catch` deixava `diretorios` em `[]` e `appDir` em `null`; `semEscolhaDoUsuario` dava **false** (`0 !== 1`) e a tela caía no ramo da lista — o usuário via o aviso "não foi possível ler" **junto de uma lista vazia com o botão de permitir**. Duas mentiras de uma vez: "você não tem nenhuma pasta permitida" quando o certo é "não sabemos quais são", e uma ação oferecida sobre estado desconhecido. O teste de erro que existia passava porque só afirmava o **texto** do alerta, nunca o que estava ao lado dele. A correção separa os dois erros pela distinção que o próprio DS documenta: falha de **carga** substitui o conteúdo (`ErrorState`), falha de **ação** é faixa sobre o conteúdo que continua correto (`InlineAlert`). Mais dois testes, um para cada lado, e o contrafactual reprova o novo com o defeito de volta. A lição repete a das fatias anteriores em outra forma: **asserção de texto não é asserção de estado** — o alerta certo pode conviver com a tela errada.

## MVP-005 — Providers de IA + Vault + BudgetPolicy ([#76](https://github.com/RodReis/rrb-jarvisOS/issues/76))

O corte em que o app passa a **falar com provider de IA**. Independe do MVP-004: providers são
caminho de execução distinto (rede/adapter, não FS/terminal). A ordem interna é dura — nada chama
provider sem credencial (F01), e nada gasta sem gate de custo (F03).

### Fatia 01 — Vault de credenciais (`CredentialRef`) (`docs/spec/spec-providers-01-vault-credenciais.md`)

Status: **entregue** — spec `aprovada-pi` (2026-07-24); issue [#77](https://github.com/RodReis/rrb-jarvisOS/issues/77). Base de todo o MVP-005: adapters (F02), BudgetPolicy (F03) e conectores (MVP-006) leem credencial por aqui.

- [x] **`CredentialRef` sem campo de valor** (`src/shared/domain/credentials.ts`) — a garantia é o **tipo**, não a disciplina de quem escreve o código. Mesmo recurso que o DS já usava em `CredencialMascarada` (SPEC-DS-04b)
- [x] **Migration 9** (`credential_ref`): `secret` **BLOB** cifrado pelo `safeStorage`/DPAPI, `UNIQUE (user_id, workspace_id, key)`. Sem colunas `source`/`status` — as duas são **derivadas** em runtime
- [x] **Precedência vault > env**; `.env` como bootstrap read-only, com namespace próprio (`JARVIS_CREDENTIAL_<KEY>`)
- [x] **`missing` sobre o enum de chaves conhecidas**, não sobre a tabela — faltar é a ausência de algo *esperado*
- [x] **Ator distinguido**: usuário no Settings audita **sem** classificar; agente classifica `secrets.change` (alto/`requires-approval`) e segue **report-only**
- [x] **`credential-change`** como tipo próprio de `AuditEvent`; payload traz `key`/escopo/ator/operação e **nunca** o valor
- [x] **3 canais IPC** de metadados; a guarda de nome do preload passou a **enumerar** os três métodos permitidos em vez de aceitar o padrão `/credential/`
- [x] **Seção de credenciais no Settings** sobre os componentes que o DS já tinha (`ProviderSetup`, `RemoveCredentialDialog`, `MENSAGEM_BYOK`)
- [x] **38 testes novos** — 9 de contrato (Regras), 20 de integração (Banco), 9 de tela

**Decisões de desenho que valem registro:**

1. **O valor cifrado mora numa coluna do SQLite, não num arquivo próprio.** O `token-vault.ts` guarda *um* segredo e por isso um arquivo basta; aqui são *muitos*, endereçados por usuário + espaço + chave. O que não muda é a primitiva: os bytes gravados são o retorno de `encryptString`. E **BLOB, não TEXT** — gravar o `Buffer` como texto o faria passar por decodificação UTF-8 que corrompe bytes que não formam caractere válido; o ciclo grava→lê→decifra só fecha com BLOB.

2. **`source` e `status` são derivados, não persistidos.** Linha na tabela = `vault`; ausente ali e presente no env = `env`; ausente nos dois = `missing`. Persisti-los criaria uma segunda fonte da verdade que envelhece sozinha quando o `.env` muda entre dois boots.

3. **O ator é fixado no call site do IPC, nunca parâmetro do renderer.** O handler grava sempre `usuario` porque o que chega por aquele canal veio da UI. Um campo `actor` no contrato seria a forma de o agente se declarar usuário e escapar da classificação de alto risco — a distinção do critério 5 só vale enquanto quem a decide é o main.

4. **`envDisponivel` na view existe para a UI ser honesta sobre a remoção.** Com env presente, apagar a chave do vault **não** deixa a credencial ausente: ela volta para `source: 'env'`. Sem esse campo a tela prometeria uma remoção que o sistema não faz — e o botão de remover, por isso, nem aparece quando a origem é o env (o env é read-only por desenho; editá-lo seria o app mexer em arquivo de configuração do usuário por trás dele).

**A guarda de segurança que ficou mais estrita, não mais frouxa.** `preload.spec.ts` e o E2E afirmavam que **nenhum** método da ponte casa `/token|secret|credential|session/`. Três métodos legítimos com `credential` no nome quebraram os dois. A saída fácil seria afrouxar o padrão; a escolhida foi **enumerar os três** e exigir lista vazia no resto — um `getCredential` amanhã não entra na lista e fica vermelho, com o app rodando de verdade.

**Provado por mutação** (três, todas vermelhas antes da correção): inverter a precedência para env > vault; ignorar o ator e classificar sempre; auditar remoção que é no-op.

### Verificação no app real (2026-08-28)

Rodou com o app de pé (Electron + debug remoto, sessão real), e os critérios foram confirmados **pelo efeito**:

- **Escopo (crit. 1):** `openai` gravada com valores distintos em `noa` e `jarvis`; cada espaço lê o seu.
- **Cifra (crit. 2):** o segredo semeado (`sk-verificacao-…`) aparece **0 vezes** em `jarvis.db`, `-wal` e `-shm`. Que a busca funciona está provado no contraponto: `credential_ref` aparece **3 vezes** no WAL. Esta é a prova do DPAPI **real** — o teste de integração usa cifra dublada, que prova o *caminho*, não o algoritmo.
- **Fontes e `missing` (crit. 3 e 4):** as três chaves listadas por nome de provider, ausentes como `missing`, gravada como `source: vault`.
- **Auditoria (crit. 6):** 4 eventos `credential-change`, payload `{op, key, actor}` sem valor; `verifyAuditChain` → `{ok: true, checked: 95}`.
- **Fronteira (crit. 8):** a ponte real expõe só `listCredentials`/`setCredential`/`removeCredential`; a busca por método que devolva valor (`get*credential`, `reveal`, `secret`) volta **vazia**. O campo é `type="password"` com `autoComplete="off"`, e a chave digitada **sai do DOM** no submit.
- **Tela:** a seção renderiza com o DS aplicado, e a mensagem obrigatória do PRD §12.5 aparece **literal, antes do campo**.

**E a verificação achou um defeito que a suíte verde não acha — pela terceira vez no projeto:**

- **Overlays em portal renderizam sem tokens** (issue **[#107](https://github.com/RodReis/rrb-jarvisOS/issues/107)**). O `AlertDialog` de remoção aparece **transparente e ilegível**: sem fundo, sem raio, sem sombra, **sem `z-index`**. Causa medida por CDP: os tokens `--jos-*` não vivem em `:root` — o `ProvedorDeTema` os injeta como `style` inline num `<div data-jos-appshell>`, e o Radix monta o portal no `<body>`, **fora** dessa subárvore; `var(--jos-cor-superficie-elevada)` resolve para vazio. Atinge os **cinco** componentes que usam portal (`Dialog`, `AlertDialog`, `Popover`, `DropdownMenu`, `Drawer`), é anterior a esta fatia e independe dela. É `[FIX]`: o certo está escrito na SPEC-DS-03b crit. 5 (*"componentes consomem só tokens da Fatia 02"*). Nenhuma asserção de estilo em `overlays.test.tsx` — o mesmo modo de falha do #58 e do #57. **Corrigido em 2026-08-28** (PR desta entrega): o provider expõe o próprio nó por contexto e cada `Portal` o recebe como `container`. Ver o registro abaixo.

**Registrado, não silenciado:**
- **Sem rotação/expiração de segredo**, como a spec determina — adicionar/editar/remover basta na F01.
- **`execucoesAfetadas={0}` é literal, não calculado**: nesta fatia nada consome credencial ainda (os adapters chegam na F02). O contrato do DS exige o número inclusive quando é zero; quando a F02 existir, é ali que o número real entra.
- **O env não tem escopo por workspace** — um `.env` não tem espaço de usuário, então a mesma variável serve os dois. Quem quiser valores distintos por espaço usa o vault, que é onde o escopo existe.

### Fatia 03 — BudgetPolicy: gate de custo no ponto único (`docs/spec/spec-providers-03-budget-policy.md`)

Status: **entregue** — spec `aprovada-pi` (2026-07-24); issue [#79](https://github.com/RodReis/rrb-jarvisOS/issues/79). Depende da F02 (o ponto único e o `CostEvent`) e da F01 (escopo user+workspace). Fecha a tese do MVP-005: "IA real com custo sob controle".

- [x] **Entidade `BudgetPolicy`** escopada por `user_id` + `workspace_id`, `dailyLimit`/`monthlyLimit` **separados** (padrão USD 1 cada, ajustáveis), `alertThreshold` 0,8. **Migration 10** (`budget_policy` + `cost_event`)
- [x] **`cost_event` como tabela nova** — a F02 emitia o `CostEvent` só como payload de `audit_event`, e payload de auditoria não se consulta por período. Derivar orçamento de dentro da cadeia append-only acoplaria o gate ao formato do log
- [x] **Decisão pura** em `@shared/domain/budget` (`avaliarOrcamento`): **bloqueio antes de alerta**, **dia antes de mês**. Testável sobre o número, sem banco, relógio nem auditoria
- [x] **Gate no ponto único**, entre a estimativa e o disparo do adapter — e **antes** da auditoria de requisição: barrar depois de o `AuditEvent` dizer "requisitei" registraria uma requisição que nunca houve
- [x] **Piso de bloqueio duro** (decisão do PI de 2026-08-29): o MVP-004 está entregue, mas sua fila de aprovação é acoplada a `run_id`/`step_id` de workflow, que chamada de IA não tem. O override por aprovação continua sendo o alvo, numa fatia futura que generalize a fila
- [x] **Dois tipos de `AuditEvent`**: `budget-decision` (o veredito) e `budget-change` (o usuário editando o limite) — sob um tipo só, "quantas vezes o orçamento barrou" exigiria parsear o payload para descartar as edições
- [x] **Os três desfechos são auditados**, não só o bloqueio: "o orçamento nunca barrou" e "o gate nunca rodou" são fatos diferentes
- [x] **UI mínima no Settings** (`OrcamentoDoWorkspace`): limites editáveis, acumulado por período em `Meter` com as faixas casadas ao limiar, alerta derivado ao cruzá-lo. Só componentes públicos do DS
- [x] **2 canais IPC** (`budget:get`, `budget:set-limits`), e **nenhum** que pergunte "esta chamada cabe?" — a decisão é do main, e um canal assim daria ao renderer uma resposta que ele só duplicaria
- [x] **73 testes novos** (29 Regras, 22 Banco, 15 Tela, mais 7 na suíte do ponto único) e **3 E2E**; total **824**

#### O que o teste pegou e a leitura não

- **O bloqueio registrava `CostEvent` de uma chamada que nunca saiu.** O caminho barrado passa por `finalizar`, e o `finalizar` registra o custo. O comentário que eu havia escrito ali dizia o oposto do que o código fazia — "não registra porque a chamada não saiu" — e teria passado numa revisão de leitura. Quem pegou foi a asserção que **conta linhas** de `cost_event`, não a que lê a mensagem. Corrigido com a marca `naoSaiu` nos dois desfechos que não chegam ao provider (barrado e sem credencial), em vez de um `if` no call site: são dois caminhos, e o segundo seria esquecido.
- **Texto duplicado na tela.** O `Meter` já renderiza `formatar(valor)` num rótulo próprio, de largura fixa; a minha linha renderizava o mesmo par ao lado. O teste falhou com "found multiple elements" — que é a tela dizendo, por baixo, que mostrava a mesma informação duas vezes. O `formatar` passou a devolver só o gasto (que é o que cabe no `w-14`) e o par "gasto de limite" ficou na linha acima, com o `aria-valuetext` carregando os dois.
- **A cobertura apontou um guard sem teste.** Regras caiu para 71,0% e a inspeção mostrou `isBudgetLimitsInput` com 0 chamadas — o guard da fronteira do IPC, justamente o que recusa payload malformado. Doze testes depois, 71,5%. A queda restante é **diluição**: `budget-service.ts` e `budget-repository.ts` estão a **100%** em Banco, onde precisam de SQLite real.

#### Verificação no app real (2026-08-29)

Três E2E com Electron, `ANTHROPIC_BASE_URL` apontando para um servidor SSE local — o adapter e o SDK são os de produção, muda só para onde ligam. O servidor **conta as requisições recebidas**, que é o que torna o critério 2 verificável por efeito e não por mensagem:

- **A chamada barrada não chega ao provider:** com o orçamento zerado pela ponte real, o servidor local registra **zero** requisições, o `fim` volta `falhou` com a mensagem do orçamento, e `getBudget` mostra acumulado **US$ 0,00** — o bloqueio não registra gasto.
- **Estouro no meio do stream (critério 4):** com US$ 1,00/dia e um `usage` que custa US$ 3,00, a primeira chamada **conclui** (dois chunks, `estado: 'concluido'`, `realUsd` 3,00), o gasto entra na soma, e a **segunda** é barrada sem tocar o provider — o contador segue em 1.
- **Auditoria:** `verifyAuditChain` → `ok`, com `budget-change` e `budget-decision` na cadeia. O log do app mostrou a sequência: `budget-change` (seq 1) → `budget-decision` (seq 2) → `Chamada barrada pelo orçamento {periodo: "dia", limiteUsd: 0, projetadoUsd: 0.10243}` → `ai-call` (seq 3).

**Lição de método que vale registrar** — o contrafactual quase mentiu duas vezes:

1. **`npm run build` roda `typecheck` antes.** O primeiro contrafactual (`if (false)`) não compilava, o build abortava, e o Playwright rodava contra o **bundle anterior**, intacto: "3 passed" sem ter provado nada. O contrafactual precisou virar uma condição que compila (`&& globalThis.X === true`) para de fato exercitar o app sem o gate.
2. **Auditar `decisao: 'bloqueado'` não prova enforcement.** O terceiro E2E passava com e sem o gate, porque o serviço decide de qualquer forma — quem barra é o ponto único, e em report-only ele produziria exatamente o mesmo `AuditEvent`. O que separa os dois é a **ausência da fase `requisicao`**: ela só é auditada depois do gate, então uma chamada barrada tem `conclusao` e nada mais. Com a asserção corrigida, os três caem sem o bloqueio.

#### Incidente de processo: a fatia entrou na `main` sem PR (2026-08-29)

**O que aconteceu.** Os três commits da F03 foram para a `main` em vez do `feat/budget-policy` e o push os levou para a `origin/main`. O branch foi criado corretamente no início (`git checkout -b feat/budget-policy`, confirmado por `git branch --show-current`), mas em algum ponto o HEAD voltou para `main` — e eu não reverifiquei antes de nenhum dos três commits. O erro só apareceu quando `gh pr create` respondeu *"head branch main is the same as base branch main"*.

**O que isso custou, concretamente.** O CI dispara em `pull_request`; nenhuma execução rodou sobre estes commits. O código está na `main` **sem ter passado pelo `gate`** — que é exatamente a garantia que "um branch por fatia" existe para preservar. O conteúdo é o mesmo que teria ido pelo PR (824 testes e 3 E2E verdes localmente, docs incluídas), mas "verde na minha máquina" não é o que o processo pede.

**Por que não foi desfeito.** `git branch -f` devolveu os commits ao branch da fatia e a `main` local voltou a `18eed62`, mas o force-push para a `origin/main` foi **rejeitado**: a proteção tem `allow_force_pushes: false`. Desligar a proteção para consertar um erro de processo trocaria uma garantia real por conveniência. **Decisão do PI (2026-08-29):** aceitar o estado, abrir um PR de verificação para o CI rodar sobre o código, e registrar aqui.

**Duas consequências que só apareceram na F04.** O job `e2e` que não rodou levou junto a **terceira guarda de superfície** — o `login.e2e.ts` também enumera a ponte, e ficou sem os dois métodos de orçamento até o CI da F04 a cobrar. E o `test` que rodou no PR de verificação rodou **sem os `REPORT_*`**, então a F03 **não tem linha no histórico do `reports/TESTS.md`**. Carimbá-la retroativamente registraria os números da F04 sob a issue da F03 — número inventado é pior que ausência —, então a lacuna fica registrada aqui em vez de preenchida com dado falso.

**O que o PR de verificação alcançou, e o que não alcançou.** O PR [#140](https://github.com/RodReis/rrb-jarvisOS/pull/140) fez o `gate` e o `test` rodarem sobre a árvore que contém a F03 — **824 testes verdes no CI**, não só na minha máquina. O que ele **não** alcançou é o job `e2e`: ele é condicional por paths (`src/main/preload/**`, `src/main/index.ts`, `tests/e2e/**` — card #34), e o PR de verificação toca só `docs/`. A F03 mexeu nos três, então o `e2e` **teria** rodado num PR normal e não rodou em nenhum. Os 3 E2E foram executados localmente e provados por contrafactual, mas essa é a lacuna que o commit direto deixou e que este PR não fecha.

**A guarda que faltava.** Confirmar o branch **uma vez, no início** não basta: o custo do erro é assimétrico (segundos para checar, proteção de branch para desfazer). O `git branch --show-current` tem de vir **junto do commit**, não antes da primeira edição.

#### Limites registrados, não silenciados

- **A prova de valor computado ficou pendente.** As 15 asserções de Tela rodam em jsdom, que não aplica folha de estilo: a cor da barra ao cruzar o limiar, a altura de 44px dos campos e o anel de foco por teclado **não foram medidos**. O caminho normal — abrir o app e navegar até Settings — exige sessão, e sem a stack Supabase no ar o app fica no login; a galeria de prova do DS hospeda componentes do design system, não telas de app com ponte. **Decisão do PI (2026-08-29): entregar assim e registrar.** É o mesmo tipo de buraco pelo qual passaram o #57, o #58 e o #107.
- **O `alertThreshold` não é editável pela tela.** A spec pede os limites; o limiar tem default configurável no contrato e é preservado a cada salvamento, em vez de silenciosamente reduzido ao padrão.
- **Escopo squad/agente fica para o Corte 4**, como a spec determina. Modelar as colunas agora seria criar escopo que nada preenche.
- **Bloqueio é melhor esforço, e a tela diz isso.** Com BYOK o custo real só existe depois do stream; o gate decide sobre estimativa. A frase está no painel, não só na spec — o usuário não pode ler "orçamento" como cerca perfeita.

### Fatia 04 — Multi-provider + roteamento por tarefa (`docs/spec/spec-providers-04-multi-provider-roteamento.md`)

Status: **entregue** — spec `aprovada-pi` (2026-07-24); issue [#80](https://github.com/RodReis/rrb-jarvisOS/issues/80). **Fecha o MVP-005.** Depende da F02 (framework de adapters + ponto único), da F03 (o gate vale para qualquer provider) e da F01 (Vault, para o Gemini).

- [x] **Três adapters novos, mesma interface `AiAdapter`** — e o ponto de chamada **não mudou** por causa deles, que é o critério 1 da F02 valendo na prática
  - **Gemini** (HTTP, `fetch` cru e não SDK): não há dependência do Google no projeto, e o que o SDK da Anthropic dava de graça (parser de SSE, erros tipados) aqui cabe em poucas linhas. Chave no header `x-goog-api-key`, **nunca** na query — query vaza para log de proxy
  - **Ollama** (HTTP local, NDJSON): sem credencial, sem custo. Reporta erro **dentro do corpo com status 200** (modelo não baixado), o que sem ramo próprio terminaria "com sucesso" e texto vazio
  - **Claude Code CLI** (subprocess app-managed): binário pinado, `shell: false`, prompt por **stdin**, cwd controlado, timeout + `SIGKILL`, `env` em lista de permissão
- [x] **`ambienteControlado()` foi exportado do terminal do MVP-004** em vez de copiado: duas listas de permissão divergiriam, e a que divergisse seria a que vaza. A lição da M4-F02 (`process.env` do main não alcança o filho) vale igual para um binário que o app invoca como dependência sua
- [x] **`ProviderRoute` com decisão pura** (`selecionarProvider`): `taskType` → preferência ordenada, com preferência local e fallback. Testável sobre o número, sem healthcheck nem banco
- [x] **Migration 11**: `provider_route` (uma linha **por tipo**, não JSON com as cinco) e `active_model` (escopo é por provider, não por tarefa)
- [x] **Healthcheck com cache de 30s**, e sonda **por provider**: cada um responde a uma pergunta diferente — os locais têm ping próprio, os de nuvem estão indisponíveis para *este* usuário quando falta credencial
- [x] **Dois tipos de `AuditEvent`**: `provider-selection` (o veredito, com o **motivo**) e `routing-change` (edição de rota ou troca de modelo)
- [x] **Tela de providers** no Settings: status + editor das cinco rotas, reordenação por botão (teclado), troca de modelo
- [x] **5 canais IPC**, e **nenhum** que peça a seleção — o renderer não decide quem atende
- [x] **71 testes novos** (32 Regras, 50 Banco, 21 Tela) e **6 E2E**; total **929**

#### Decisões que valem registro

1. **`AdapterRequest.apiKey` virou opcional, e isso abriria um buraco.** Ollama e `claude-code` não têm credencial — mas com `undefined` aceito, marcar um provider **pago** como sem-credencial passaria em silêncio e a chamada sairia sem chave. Duas guardas novas fecham: *só rota `unmetered` pode dispensar credencial* e *toda rota unmetered custa exatamente zero*. A segunda impede um preço pequeno de se esconder atrás da isenção.
2. **`AiCallHandle.provider`/`model` viraram opcionais.** Com roteamento, quem atende só se sabe **depois** da seleção, que acontece dentro do serviço — e o handler devolve o handle antes. Afirmar um provider ali seria prever a escolha, e a previsão erraria em todo fallback. O provider realmente usado chega no `CostEvent` do evento `fim`, onde é fato medido.
3. **Provider explícito vence o roteamento.** O único chamador que informa provider é o painel de teste do Settings, cujo ponto é falar com um provider específico; roteá-lo o tornaria incapaz de testar o que testa.
4. **Zero na tabela de preço tem dois sentidos, e os dois são honestos.** No Ollama é preço (roda na máquina do usuário); no `claude-code` é "não se converte em USD" (assinatura). Converter uso de assinatura em dólar estimado foi **descartado pelo PI**: seria número inventado, e o gate barraria com base nele.
5. **`vision` não lista o Ollama.** O modelo local padrão não atende, e listar um provider que falharia seria um fallback que não funciona.

#### O que o teste pegou e a leitura não

- **Duas guardas herdadas cobraram a mudança, como devem.** `preload.spec.ts` (superfície da ponte, lista **enumerada** — quarto caso do mesmo padrão) e a simulação de schema v1 do `storage.int-spec.ts`, que derruba as tabelas das migrations posteriores e não conhecia as novas.
- **O mock da ponte no `AppShell.test.tsx` estava incompleto e a suíte passava assim mesmo** — a tela caía no `catch` e mostrava o estado de erro. Verde, mas os testes exercitariam um Settings que não é o que o usuário vê. Os cinco métodos entraram no mock.
- **`react-hooks/set-state-in-effect`** acusou um `setState` no `.catch()` encadeado do efeito, e a regra está certa: o catch de uma promessa já resolvida roda antes de o efeito terminar, disparando renderização em cascata.
- **`hasPointerCapture` faltava no setup do jsdom.** O Radix `Select` a consulta ao **abrir** a lista — por isso a lacuna só apareceu agora, quando um teste precisou abrir o seletor em vez de só renderizá-lo. O stub devolve `false` (nada capturado), não `true`: `true` faria o Radix acreditar numa captura inexistente.

#### Verificação no app real (2026-08-29)

Seis E2E com Electron, no **pior cenário** — sem credencial de nuvem e sem Ollama rodando:

- **A ponte expõe os cinco canais e nenhum que decida:** a busca por `selectProvider`/`routeFor` volta vazia, assim como a por `reveal`/`secret` (guarda herdada da F01).
- **O status cobre os quatro providers** com origem e custo corretos, e todos têm modelo ativo mesmo sem troca.
- **As cinco rotas existem e são editáveis**, e editar uma **não apaga as outras**.
- **Rota sem ninguém disponível recusa a chamada** em vez de gastar às cegas — o caminho novo (`callAi` com `taskType` e **sem** `provider`).
- **`provider-selection` e `routing-change` entram na cadeia**, com o veredito `indisponivel` registrado; `verifyAuditChain` → `ok`.
- **Troca de modelo persiste e modelo inválido é recusado** — o log do app mostrou `Troca de modelo recusada: fora da tabela de preço {provider: "anthropic", modelo: "gpt-5"}`.

**A armadilha da F03 reapareceu, e foi reconhecida na hora:** o primeiro `npx playwright` rodou contra o **bundle antigo**, porque o `npm run build` abortou no typecheck (duas variáveis não usadas no meu próprio spec). Os seis "falharam" por um motivo que não era o código. É o segundo registro do mesmo padrão — `npm run build` roda `typecheck` antes, e um build que aborta deixa o E2E medindo a versão anterior.

#### Limites registrados, não silenciados

- **A prova de valor computado da tela ficou pendente**, pela mesma razão da F03: sem a stack Supabase no ar o app fica no login e Settings não é alcançável pela UI. As 21 asserções de Tela rodam em jsdom.
- **Os adapters de nuvem não foram exercitados contra a API real** — nem poderiam, sem chave e sem gastar. O que os testes provam é o **protocolo** (servidor SSE/NDJSON local) e o tratamento de erro; a conversa com a Anthropic real já tinha sido verificada na F02.
- **O `claude-code` foi testado com `node` como binário dublê.** O que se prova são as garantias do subprocess (sem shell, stdin, timeout, kill, env isolado), que são minhas; o protocolo do CLI é dele, e depende de o binário estar instalado.
- **Escopo squad/agente do `ProviderRoute` fica para o Corte 4**, como a spec determina.
- **O chamador declara o `taskType`.** Agentes que o declarem sozinhos são Corte 3+/4 (spec § Fora).

## MVP-006 — Conectores Essenciais ([#86](https://github.com/RodReis/rrb-jarvisOS/issues/86))

Seis fatias, todas com spec `aprovada-pi` (2026-08-29). Ordem:
`M6-F01 → M6-F02 → (M6-F03 → M6-F04) + (M6-F05 → M6-F06)`.

### Fatia 01 — Núcleo de conectores (`docs/spec/spec-conectores-01-nucleo.md`)

Status: **entregue** — spec `aprovada-pi` (2026-08-29); issue [#87](https://github.com/RodReis/rrb-jarvisOS/issues/87). **Abre o MVP-006.** Depende do MVP-005 (Vault e tipos de auditoria).

- [x] **`src/shared/domain/connectors.ts`** — `ConnectorId`, `ConnectorCapability`, versão de contrato, `ConnectorRequest`, `ConnectorResult`, `ConnectorError` (código estável, retentabilidade, evidência e ação de retomada) e `ConnectorOutcome` como união discriminada por `ok`
- [x] **`validarConnectorRequest` é função pura** — e é isso que torna o critério 1 afirmável: "falha antes de qualquer I/O" é fato sobre uma função que não toca rede, disco nem cofre, não promessa sobre a implementação
- [x] **Interface `ConnectorAdapter`** com três métodos (declarar capacidades, validar input, executar). O molde é o `AiAdapter` da M5-F02 — o que fez o multi-provider da M5-F04 caber sem mexer no ponto de chamada
- [x] **`ConnectorRegistry`**: registro explícito, resolução por `ConnectorId` de lista fechada, e recusa da segunda inscrição do mesmo conector. **Nenhuma resolução por URL** (critério 6)
- [x] **`ConnectorService`, o ponto único** — resolve → valida envelope → valida input pelo adapter → **só então** o cofre → classifica (`api.external-call`) → audita → executa → audita. É a sede da governança que a F02 instala
- [x] **Dois canais IPC nomeados** (`connectors:capabilities`, `connectors:invoke`) e **nenhum** que receba endereço
- [x] **`connector-call` como tipo próprio de `AuditEvent`**, dois eventos por chamada (`requisicao`/`conclusao`) — mesma razão de `ai-call`: chamada que morre no meio precisa deixar rastro
- [x] **39 testes novos** (24 Regras, 15 Banco); total **968**. Quatro provados por contrafactual

#### Decisões que valem registro

1. **Duas perguntas foram ao PI antes de uma linha de código, e as duas mudaram o que foi construído.** (a) O critério 5 pede "renderer acessa somente IPC tipado", mas a F01 não tem adapter concreto — decisão: **canais tipados + listagem de capacidades, sem tela**. (b) O `ConnectorRequest` carrega `CredentialRef`, mas `CREDENTIAL_KEYS` é enum fechado de IA e a emenda do Vault está cravada na M6-F03 — decisão: **conjunto próprio de chaves de conector**.
2. **`ConnectorCredentialKey` é separado de `CredentialKey`, e a separação tem consequência visível.** Acrescentar `github`/`tavily` ao enum de IA faria a tela de credenciais do Settings anunciar duas credenciais ausentes que ninguém consegue usar até a F03 — uma promessa que o app não cumpre. A M5-F01 fica fechada e a emenda (payload estruturado, `expires_at`, rotação atômica) permanece onde o PI a cravou.
3. **O cofre é o mesmo; o que é separado é a taxonomia.** `credential_ref.key` sempre foi texto e o `UNIQUE (user_id, workspace_id, key)` já endereça qualquer chave lógica — o repositório passou a aceitar `VaultKey` (as duas famílias). Um segundo cofre duplicaria cifra, migration e cuidado com o segredo em troca de nada.
4. **A regra da idempotência mora no contrato, não na governança da F02.** Uma mutação sem chave é um pedido que ninguém pode repetir com segurança, e a F02 não teria como consertar isso depois — só como recusar-se a retentar, o que já é tarde. Recusar na entrada é o que mantém o critério 3 de lá viável.
5. **`input` e `data` são `unknown` de propósito.** A forma do payload pertence à operação; tipá-los obrigaria o núcleo a saber o que um `issues.create` recebe — exatamente o acoplamento que a fatia existe para não ter.
6. **O registro nasce vazio, e isso é a entrega.** Pedir por um conector conhecido mas não registrado devolve `connector-nao-registrado`; os adapters concretos entram na F03–F06 sem tocar contrato nem ponto de chamada.

#### O que o teste pegou e a leitura não

- **A primeira versão da asserção de ordem não provava ordem.** Os testes de "recusa antes de I/O" afirmavam `segredos.pedidas === []`, mas os pedidos não traziam credencial — então a lista ficaria vazia **mesmo** numa implementação que consultasse o cofre antes de validar. O contrafactual expôs isso: movida a busca de credencial para antes da validação, só **um** teste reprovou. Com credencial no pedido, reprovam dois. Uma asserção que passa com e sem o defeito não é asserção.
- **`AuditRepository.list(userId, workspaceId?)`** — passei `100` como segundo argumento supondo um limite, e o filtro por espaço engoliu tudo em silêncio: os eventos vinham vazios e o teste dizia "não auditou". O erro era do teste, não do código.
- **A guarda de superfície do preload cobrou os dois métodos novos**, como nas quatro fatias anteriores. Enumerados um a um, não por padrão `/connector/` — um padrão aceitaria um `connectorFetch` futuro, que é justamente o que a guarda existe para barrar.

#### Contrafactuais (cada guarda revertida, e o teste que reprovou)

| Guarda revertida | Testes que reprovam |
|---|---|
| Cofre consultado **antes** da validação | 2 (capacidade desconhecida; credencial ausente) |
| Regra de idempotência desligada | 3 (2 Regras, 1 Banco) |
| Mensagem da exceção do SDK repassada crua | 1 (a que verifica que `tvly-segredo` não vaza) |
| Canal `connectors:fetch` acrescentado ao contrato | 1 (o critério 6 no preload) |

#### Limites registrados, não silenciados

- **Nenhum adapter concreto existe**, por escopo: GitHub é F03/F04, Tavily é F05/F06. O que os testes exercitam é um **contract fixture** — dois adapters falsos que satisfazem a interface real. É o que a spec pede, e é a prova do critério 4: se `ConnectorAdapter` exigisse algo que só o GitHub tem, o arquivo de teste não compilaria.
- **Sem verificação no app real**, e é consequência do escopo: não há conector registrado para exercitar pela tela, e nenhuma tela nova foi entregue (decisão do PI). O que atravessa o IPC é provado pela guarda do preload e pelo teste de serialização; a prova em Electron chega com o primeiro adapter concreto, na F03.
- **Governança é da F02** — health, timeout, retry, rate limit, circuit breaker, ledger de créditos e sanitização de evidência. O `ConnectorUsage` mede créditos e ninguém os soma ainda; o gate é lá.
- **`project_id` fica fora dos contratos** até o MVP-008, onde projeto nasce. Um campo opcional que ninguém preenche por dois MVPs é campo que se aprende a ignorar.
- **O relatório por SPEC** sai pelo `reports/TESTS.md` gerado no CI (ADR-003), não em `docs/test-reports/` — o caminho que a spec cita nunca existiu no projeto, e criar um segundo lugar para o mesmo número é como os dois passam a divergir.

### Fatia 02 — Operação e governança (`docs/spec/spec-conectores-02-operacao-governanca.md`)

Status: **entregue** — spec `aprovada-pi` (2026-08-29); issue [#88](https://github.com/RodReis/rrb-jarvisOS/issues/88). Depende da F01 (o ponto único) e do MVP-005 (Vault, auditoria).

- [x] **`connector-governance.ts`, tudo função pura** — `ESTADO_DO_ERRO` (tabela, não `switch` espalhado), `decidirRetry`, `calcularEspera`, `contaContraOBreaker`, `proximoCircuito` e `avaliarCreditos`
- [x] **Migration 12**: `connector_credit_policy` + `credit_event` — ledger em **créditos**, separado do `cost_event` em USD (decisão do PI)
- [x] **`CreditRepository`/`CreditService`**: teto por `user_id`+`workspace_id`+**conector**, recorte de período por prefixo ISO, auditoria dos dois desfechos
- [x] **Governança no ponto único**: circuito → gate de créditos → cofre → auditoria → execução com timeout, `AbortSignal` e retry. **Nada do caminho da F01 foi refatorado** — só instrumentado, que é o critério 1 dela valendo
- [x] **Dois canais IPC** para o teto; **nenhum** pergunta se a chamada cabe
- [x] **Dois tipos de `AuditEvent`**: `connector-credit-decision` (o veredito) e `connector-credit-change` (a edição), pela mesma razão que separa `budget-decision` de `budget-change`
- [x] **57 testes novos** (39 Regras, 18 Banco); total **1025**. Seis contrafactuais, **dois deles reprovaram a suíte em vez do código**

#### Decisões que valem registro

1. **Duas perguntas ao PI antes de codificar.** (a) Os estados `READY`/`DEGRADED`/`BLOCKED_EXTERNAL`/`FAILED` são **do desfecho de uma chamada**, não status de painel — é assim que as F03/F05 já os usam, e `health()` entra como método **opcional** do adapter. (b) O "smoke real" da spec vira **servidor HTTP local que conta requisições**, já que não há adapter concreto até a F03.
2. **`health()` não recebe nada — nem `ConnectorExecution`, nem segredo.** O critério 5 ("health não exige revelar credencial") vira **assinatura**, não disciplina: um health que precisasse da credencial para responder seria um health que a revela, e a única forma de impedir isso é o parâmetro não existir.
3. **A ordem das recusas do `decidirRetry` é a política inteira.** Repetibilidade vence código terminal vence orçamento de tentativas — e a primeira é a mais forte de propósito: `codigo-terminal` depende de uma lista que cresce, `nao-repetivel` vale para **todo** código, inclusive os que ainda não existem.
4. **`CODIGOS_SEM_RETRY` lista quem *não* pode, não quem pode.** Um `ConnectorErrorCode` novo cai no caso conservador em vez de virar retry por omissão. Errar para o lado de não repetir é o lado barato: a chamada perdida o usuário refaz; a repetida contra um 401 vira bloqueio de conta.
5. **O breaker não conta o que é problema nosso.** Credencial recusada, permissão negada e o **nosso** teto de créditos não abrem o circuito — contá-los transformaria um erro de configuração num apagão do conector inteiro. Cancelamento também não: o usuário desistir não é o serviço falhar.
6. **`avaliarCreditos` tem dois caminhos, não três.** O orçamento em USD alerta porque o usuário decide se aceita gastar mais; crédito de conector é cota comprada — ou cabe, ou não cabe. Um alerta pediria uma decisão que ele não tem como tomar no meio da chamada.
7. **Custo zero sempre passa, mesmo com o teto estourado.** O GitHub não cobra; barrar uma chamada gratuita porque uma paga esgotou a cota seria cobrar por algo que não custa.
8. **O bloqueio por crédito não gera `connector-call/conclusao`.** O fato já mora em `connector-credit-decision`, com os números. Repeti-lo faria "quantas chamadas concluíram" contar chamadas que nunca saíram — o defeito que a M5-F03 pegou no `cost_event`.

#### O que o teste pegou e a leitura não

- **O `Retry-After` não era obedecido, e o critério 2 pede que seja.** O adapter guardava o cabeçalho em `evidencia` (string) e o serviço nunca o lia: o backoff caía na curva exponencial. Virou campo próprio e **número** (`ConnectorError.retryAfterMs`) — uma orientação que só existe como texto na mensagem é uma orientação que ninguém obedece.
- **Dois contrafactuais não derrubaram nada, e o defeito era da suíte.** (a) Inverter a ordem das recusas do `decidirRetry` passava despercebido, porque nenhum teste cobria o caso em que **as duas** se aplicam — que é justamente onde a ordem importa; dois testes novos. (b) A guarda de repetibilidade dentro do serviço é **inalcançável** com a validação da F01 no lugar; ficou registrada como tal no comentário, em vez de fingir uma redundância que nenhum contrafactual alcança.
- **A migração v1 do `storage.int-spec` cobrou as duas tabelas novas**, como cobrou na M5-F04. Terceiro caso do mesmo padrão.
- **As duas guardas de superfície foram atualizadas juntas desta vez** — na F01 eu só tinha visto a do preload, e o E2E de login me pegou no CI.

#### Contrafactuais (cada guarda revertida, e o teste que reprovou)

| Guarda revertida | Testes que reprovam |
|---|---|
| Ordem das recusas do `decidirRetry` invertida | 1 (só o caso em que as duas se aplicam) |
| Gate de créditos em report-only | 3 (Banco) |
| Validação de idempotência da F01 desligada | 4 (2 Regras, 2 Banco — inclusive o do servidor que conta) |
| Circuit breaker desligado | 1 (o contador do servidor se move) |
| `AbortSignal` não repassado ao adapter | 2 (timeout não aborta a conexão) |
| Guarda de repetibilidade do serviço removida | **0 — inalcançável; registrada, não maquiada** |

#### Limites registrados, não silenciados

- **O adapter das provas é HTTP de verdade, mas não é um conector de produção.** `fetch`, `AbortSignal` e status reais (401/403/429/500/timeout) contra um servidor local que **conta requisições** — é o que separa "o mock não foi chamado" de "a requisição não saiu". GitHub é a F03, Tavily a F05; o smoke contra serviço externo real fica para lá.
- **Sem verificação no app real**, pelo mesmo motivo da F01: não há conector registrado para exercitar pela tela, e nenhuma tela nova foi entregue.
- **`health()` não tem chamador ainda.** O método existe no contrato e o critério 5 é garantido pela assinatura; quem o consome é a F03, que terá um serviço a sondar.
- **`project_id` existe na coluna e é sempre nulo** até o MVP-008 (critério 7). A coluna entrou agora para a fatia que a preencher não precisar de migration.
- **O teto de créditos não tem tela.** Os canais existem e são testados; a UI mínima chega com o conector que a torna útil.

### Fatia 03 — GitHub App e autenticação (`docs/spec/spec-conectores-03-github-app-autenticacao.md`)

Status: **entregue** — spec `aprovada-pi` (2026-08-29); issue [#89](https://github.com/RodReis/rrb-jarvisOS/issues/89). Depende da F01 (ponto único), da F02 (governança) e do Vault do MVP-005.

- [x] **`src/shared/domain/github-auth.ts`** — as decisões puras do Device Flow: interpretar a resposta do GitHub, calcular o próximo intervalo, ler grant e payload, decidir se o token precisa de renovação. `DecisaoDePolling` é **união fechada de três desfechos**, e é a forma do tipo que garante o critério 3: só `esperar` continua o laço
- [x] **Emenda ao Vault (critério 8)** — `upsertPayload`/`readPayload`/`expiresAt` no `CredentialRepository`, migration 13 acrescentando `credential_ref.expires_at`. Payload cifrado **estruturado** (access + refresh + expirações) numa escrita só; **rotação atômica** por `INSERT … ON CONFLICT DO UPDATE`
- [x] **`GithubAuthService`** — abre o fluxo, faz o polling com `slow_down` acumulativo, grava no cofre, **renova antes do uso** e desconecta. Quatro saídas do polling: sucesso, cancelamento (`AbortSignal`), expiração (prazo **e** `expired_token`) e erro normalizado
- [x] **`GithubAdapter`** — o **primeiro adapter concreto** do MVP-006: declara `auth.identify`, traduz status HTTP no vocabulário da F01 e implementa `health()` sobre endpoint público (`/zen`), sem credencial
- [x] **`connector-auth` como tipo próprio de `AuditEvent`** — distinto de `credential-change`: aquele é o usuário editando o cofre, este é o protocolo rodando (`inicio`/`autorizado`/`renovado`/`cancelado`/`logout`/`falhou`)
- [x] **Seis canais IPC tipados** (`github:auth-status|auth-start|auth-await|auth-cancel|auth-logout|set-client-id`) — **nenhum devolve token**
- [x] **Migration 14** — `user_profile.github_client_id`, o override do `client_id`. **Fora do vault** de propósito: o `client_id` é público por desenho no Device Flow, e cifrá-lo o anunciaria como segredo que não é
- [x] **UI mínima no Settings** (`ConectorGitHub.tsx`) — código, URL, prazo em minutos, progresso do polling, cancelamento e estado do conector; nenhum campo exibe token
- [x] **Regras 451 (70.1%), Banco 349 (88.8%), Tela 316 (89.2%) — 1115 testes** (+90), mais **7 E2E** no Electron real. Cinco provados por contrafactual

#### Decisões que valem registro

1. **Duas perguntas foram ao PI antes de codificar, e as duas mudaram o construído.** (a) A GitHub App do projeto **não existe** — decisão: `GITHUB_CLIENT_ID_EMBUTIDO` fica **vazio** e o override em Configurações é o caminho que funciona hoje; inventar um identificador produziria um app que falha na primeira chamada com erro do GitHub em vez de dizer o que falta. (b) O override mora em **`user_profile`**, não em tabela nova de config de conector — uma coluna para um campo, como `theme` e `accent_*` entraram.
2. **O override do `client_id` é coluna do perfil, mas não é `UserPreferences`.** Métodos próprios no repositório (`findGithubClientId`/`saveGithubClientId`) em vez de acrescentar campo ao tipo: `UserPreferences` é o contrato de idioma, tema e acento — o que a tela de aparência edita e o que o `PreferencesSnapshot` leva ao renderer a cada boot. Um `client_id` ali viajaria junto de toda leitura de preferência e apareceria em `savePreferences` como se fosse escolha de interface.
3. **`ConnectorSecretSource.resolve` passou a aceitar `Promise`.** A F01 o tipava síncrono porque ler o cofre é disco local; o GitHub trouxe o caso que não cabe nisso — "renovar antes do uso" (critério 5) é chamada de rede, e ela precisa acontecer **no instante do uso**. As alternativas eram piores: renovar por timer gastaria refresh em token que ninguém vai usar, e renovar dentro do adapter faria cada adapter futuro reimplementar a decisão. Fonte síncrona continua válida — `await` sobre não-Promise é o próprio valor.
4. **O GitHub tem caminho próprio no `resolve` do bootstrap.** Seu segredo é o **payload OAuth**, e entregá-lo cru ao adapter mandaria o JSON inteiro no header `Authorization`. `tokenParaUso` decifra, renova quando está vencendo e devolve só o access token; os demais conectores seguem lendo o valor único, que é o formato deles.
5. **`expires_at` fica fora da cifra, e isso não afrouxa nada.** A decisão "preciso renovar antes de usar?" é tomada muitas vezes — a tela de Configurações a faz a cada render —, e tomá-la exigindo o DPAPI faria toda consulta de estado destravar o segredo para ler um relógio. O prazo **não é segredo**: dizer "este token vence dia 3" não ajuda ninguém a usá-lo. O segredo continua inteiro dentro do BLOB.
6. **Logout remove; não finge revogar.** O GitHub **não expõe endpoint para uma App revogar seu próprio user token sem client secret** — o `DELETE /applications/{client_id}/token` exige autenticação básica com o secret, que este desktop não tem e não deve ter. "Revoga ou remove conforme a capacidade disponível" (critério 6) se resolve pela remoção local; fingir uma revogação que não aconteceu seria pior que não a oferecer.
7. **`GITHUB_OAUTH_ORIGIN` existe para o E2E, e restringe a origem por construção.** É variável do **processo main**, o mesmo grau de confiança do `.env` que já guarda credencial — não é o proxy genérico que a F01 (critério 6) proíbe, cuja diferença é *quem escolhe*: ali seria o renderer mandando endereço pelo IPC. O `new URL(…).origin` descarta caminho, query e fragmento, então o override troca o **servidor**, nunca a rota.

#### O que os testes pegaram e a leitura não pegaria

1. **O contrafactual achou uma lacuna real de cobertura, não um acerto.** Apagar a credencial no ramo de "refresh recusado" **passou** na primeira tentativa: os testes só exercitavam o refresh que falha por **rede** (exceção, caminho do `catch`), nunca o que falha porque o GitHub **respondeu** recusando (`novo === undefined`). O teste que faltava foi escrito, e só então o contrafactual reprovou. Sem ele, uma regressão que zerasse o cofre nesse ramo passaria com a suíte verde.
2. **O teste da superfície da ponte pegou os canais novos antes da tela.** `preload.spec.ts` compara a lista **inteira** de métodos expostos; acrescentar seis sem atualizá-la reprovou na hora — o critério de aceite 4 da fundação funcionando como guarda, não como cerimônia.
3. **O mock incompleto do `AppShell.test.tsx` reapareceu — mesmo defeito da M5-F04.** O painel novo consulta a ponte ao montar, e sem o método no dublê o Settings dos testes cairia num painel em estado de erro. Sete testes reprovaram; a lição já estava registrada e o registro serviu.
4. **O teste da migração v1→v2 é o guarda de toda migration nova.** `duplicate column name: github_client_id` apareceu porque o teste desfaz cada migration para recuar o schema — e cada coluna nova precisa entrar na lista. O `expires_at` não precisou: some junto com o `DROP TABLE credential_ref`.
5. **O typecheck do `build` pegou o que o Vitest não pegou.** `adapter.custoEstimado` acessado na **classe** concreta não compila (o método é opcional na *interface*, e a classe não o declara) — o Vitest transpila sem checar tipos e passou verde. A asserção foi corrigida para consultar pela interface, que é o lado de quem consome o adapter.
6. **O lint de React recusou três padrões e o terceiro melhorou o desenho.** `setState` síncrono em corpo de efeito, `ref` escrito durante o render (era código morto, nunca lido) e `Date.now()` lido no render (impuro). O relógio da contagem regressiva virou `useState` com inicializador preguiçoso, e o carimbo passou a ser gerado **dentro** do callback do intervalo — o efeito ficou sem `setState` síncrono e a contagem continua andando.

#### Limites registrados, não silenciados

- **Não há smoke contra a API real do GitHub**, e não poderia haver: a GitHub App do projeto ainda não foi registrada (decisão do PI). O que o E2E prova é o **protocolo inteiro** contra um servidor local que conta requisições — a mesma técnica da F02, e a que separa "o mock não foi chamado" de "a requisição não saiu".
- **`GITHUB_CLIENT_ID_EMBUTIDO` está vazio.** O critério 7 pede que o embutido funcione sem configuração; hoje só o override funciona. Um teste trava a constante em `''` — quando o `client_id` real for embutido, ele reprova e cobra a atualização, que é o ponto.
- **`auth.identify` é a única capacidade declarada.** Repositório, issue e PR são a M6-F04; declará-las agora criaria capacidades que a UI lista e ninguém atende.
- **A prova de valor computado da tela segue pendente**, pelo mesmo motivo das fatias anteriores: sem a stack Supabase no ar o app fica no login e Settings não é alcançável pela UI. O E2E exercita a ponte real e o cofre real, não os pixels.
- **O ledger de créditos não conta nada para o GitHub**, e está certo: ele não cobra, e `custoEstimado` ausente **é** zero pela decisão da F01.

## Registro de entregas

| Data | Fatia | PR | Observação |
|---|---|---|---|
| 2026-08-29 | MVP-006 · F03 GitHub App e autenticação ([#89](https://github.com/RodReis/rrb-jarvisOS/issues/89)) | (PR desta entrega) | Regras 451 (70.1%), Banco 349 (88.8%), Tela 316 (89.2%) — **1115 testes** (+90) e **7 E2E** no Electron real. O desktop passa a autenticar no GitHub por Device Flow, **sem client secret e sem private key** — o refresh de um token nascido do device flow também não os exige, e é isso que sustenta o critério 1 no desktop. **A emenda ao Vault entrou onde o PI a cravou**, sem reabrir a M5-F01: payload cifrado **estruturado** (access + refresh + expirações) numa escrita só, `expires_at` em coluna própria para ser consultável **sem decifrar**, e rotação atômica por `INSERT … ON CONFLICT DO UPDATE` — as três partes só fazem sentido juntas, e gravá-las em três linhas faria "atômica" depender de três escritas darem certo. **`expires_at` fora da cifra não afrouxa nada**: a tela pergunta "vence quando?" a cada render, e responder decifrando faria toda consulta de estado destravar o DPAPI para ler um relógio. **Duas perguntas foram ao PI antes de codificar:** a GitHub App do projeto não existe, então `GITHUB_CLIENT_ID_EMBUTIDO` fica **vazio** e o override em Configurações é o caminho que funciona hoje; e esse override mora em `user_profile`, **fora do vault** — o `client_id` é público por desenho no Device Flow, e cifrá-lo o anunciaria como segredo que não é. **`ConnectorSecretSource.resolve` passou a aceitar `Promise`**, e essa é a mudança que a F01 não podia antecipar: "renovar antes do uso" é chamada de rede e precisa acontecer **no instante do uso**; renovar por timer gastaria refresh em token que ninguém vai usar, e renovar no adapter faria cada adapter futuro reimplementar a decisão. **O GitHub tem caminho próprio no bootstrap** porque seu segredo é o payload OAuth — entregá-lo cru mandaria o JSON inteiro no header `Authorization`. **Logout remove e não finge revogar:** o GitHub não expõe endpoint para uma App revogar o próprio user token sem client secret, e fingir uma revogação que não aconteceu seria pior que não a oferecer. **O contrafactual achou uma lacuna de cobertura, não um acerto** — apagar a credencial no ramo de "refresh recusado pelo GitHub" **passou** na primeira tentativa, porque os testes só exercitavam o refresh que falha por **rede** (o `catch`), nunca o que falha porque o serviço **respondeu** recusando; o teste que faltava foi escrito e só então o contrafactual reprovou. **O typecheck do `build` pegou o que o Vitest não pegou** (`custoEstimado` acessado na classe concreta não compila; o Vitest transpila sem checar tipos e passou verde), e **o mock incompleto do `AppShell.test.tsx` reapareceu** — mesmo defeito da M5-F04, sete testes reprovando. **Verificado no app real** com servidor HTTP local que **conta requisições**: o fluxo completa em **exatamente dois pollings** (o `authorization_pending` e o que traz o token — um só significaria desistência, três que não parou), nenhuma requisição carrega `client_secret`, nada do que volta pela ponte contém access ou refresh token, `connector-auth` entra na cadeia sem código nem token no payload e `verifyAuditChain` → `ok`. Provado por contrafactual **no app real**: embarcado um `client_secret`, o E2E reprova. **Limites:** sem smoke contra a API real do GitHub (a App não existe — o E2E prova o protocolo inteiro, não a conversa com o serviço); `auth.identify` é a única capacidade declarada (repositório e issue são a F04); e a prova de valor computado da tela segue pendente pelo mesmo motivo das fatias anteriores. |
| 2026-08-29 | MVP-005 · F04 Multi-provider + roteamento ([#80](https://github.com/RodReis/rrb-jarvisOS/issues/80)) | (PR desta entrega) | Regras 339 (70.6%), Banco 289 (88.5%), Tela 301 (90.2%) — **929 testes** (+71), mais **6 E2E**. **Fecha o MVP-005.** Três adapters novos pela **mesma interface** da F02 — e o ponto de chamada não mudou por causa deles, que é o critério 1 valendo na prática. **Gemini com `fetch` cru e não SDK**: não há dependência do Google no projeto, e o que o SDK da Anthropic dava de graça cabe aqui em poucas linhas; a chave vai no header, **nunca** na query, que vaza para log de proxy. **Ollama** reporta erro **dentro do corpo com status 200** (modelo não baixado) — sem ramo próprio, a chamada terminaria "com sucesso" e texto vazio. **Claude Code CLI** é subprocess app-managed com binário pinado, `shell: false`, prompt por **stdin** (tira do caminho qualquer dependência de escape), timeout + `SIGKILL` e `env` em lista de permissão — e o `ambienteControlado()` do terminal do MVP-004 foi **exportado em vez de copiado**: duas listas divergiriam, e a que divergisse seria a que vaza. **A mudança mais arriscada foi tornar `apiKey` opcional**, porque abriria um buraco: com `undefined` aceito, marcar um provider **pago** como sem-credencial passaria em silêncio. Duas guardas novas fecham — só rota `unmetered` dispensa credencial, e toda rota unmetered custa **exatamente** zero (a segunda impede um preço pequeno de se esconder atrás da isenção). **`AiCallHandle.provider` virou opcional** porque o handler devolve o handle **antes** da seleção: afirmar um provider ali seria prever a escolha, e a previsão erraria em todo fallback. **O teste pegou o que a leitura não pegaria:** o mock da ponte no `AppShell.test.tsx` estava incompleto e **a suíte passava assim mesmo** — a tela caía no `catch` e mostrava erro; verde, mas os testes exercitariam um Settings que não é o que o usuário vê. E `hasPointerCapture` faltava no setup do jsdom: o Radix `Select` só a consulta ao **abrir** a lista, então a lacuna esperou até um teste precisar abrir o seletor em vez de só renderizá-lo. **Verificado no app real no pior cenário** (sem credencial e sem Ollama): o status cobre os quatro, a rota sem ninguém disponível **recusa a chamada** em vez de gastar às cegas, `provider-selection`/`routing-change` entram na cadeia e `verifyAuditChain` → `ok`; o log mostrou `Troca de modelo recusada: fora da tabela de preço`. Provados por contrafactual — sem o filtro de disponibilidade, 2 dos 6 caem. **A armadilha da F03 reapareceu e foi reconhecida na hora:** o primeiro `npx playwright` rodou contra o **bundle antigo** porque o `npm run build` abortou no typecheck (duas variáveis não usadas no meu próprio spec). Segundo registro do mesmo padrão. **Limites:** a prova de valor computado da tela segue pendente (sem Supabase no ar, Settings não é alcançável pela UI); os adapters de nuvem foram exercitados contra **protocolo**, não contra a API real; o `claude-code` usou `node` como binário dublê — o que se prova são as garantias do subprocess, que são minhas. |
| 2026-08-29 | MVP-005 · F03 BudgetPolicy ([#79](https://github.com/RodReis/rrb-jarvisOS/issues/79)) | (PR desta entrega) | Regras 305 (71.5%), Banco 239 (88.6%), Tela 280 (91.8%) — **824 testes** (+73), mais **3 E2E**. **Fecha a tese do MVP-005**: o `CostEvent` que a F02 media vira enforcement. O gate encaixa exatamente onde a F02 o preparou — entre a estimativa e o disparo do adapter —, e **antes** da auditoria de requisição: barrar depois de o `AuditEvent` dizer "requisitei" registraria uma requisição que nunca houve. **`cost_event` precisou ser tabela nova**: a F02 emitia o custo só como payload de `audit_event`, e payload de cadeia append-only não se consulta por período — derivar orçamento de dentro dela acoplaria o gate ao formato do log. **Dois tipos de auditoria e não um** (`budget-decision` para o veredito, `budget-change` para a edição de limite), pela mesma razão que separa `allowlist-change` de `policy-decision`: sob um tipo só, "quantas vezes o orçamento barrou" exigiria parsear payload. **Piso de bloqueio duro por decisão do PI** — o MVP-004 está entregue, mas sua fila de aprovação é acoplada a `run_id`/`step_id` de workflow, que chamada de IA não tem; o override segue como alvo de fatia futura. **O teste pegou um defeito que a leitura teria deixado passar**: o caminho barrado passava por `finalizar` e **registrava `CostEvent` de uma chamada que nunca saiu** — o comentário que eu havia escrito ali afirmava o contrário do que o código fazia. Quem pegou foi a asserção que **conta linhas** de `cost_event`, não a que lê a mensagem. E o teste de Tela pegou **texto duplicado**: o `Meter` já renderiza o valor formatado num rótulo próprio, e a minha linha mostrava o mesmo par ao lado — "found multiple elements" foi a tela dizendo que exibia a mesma informação duas vezes. **O contrafactual quase mentiu duas vezes, e isso é a lição de método da fatia.** (1) `npm run build` roda `typecheck` antes: o primeiro contrafactual não compilava, o build abortava e o Playwright rodava contra o **bundle anterior** — "3 passed" sem ter provado nada; precisou virar uma condição que compila. (2) Auditar `decisao: 'bloqueado'` **não prova enforcement**, porque o serviço decide igual em report-only e quem barra é o ponto único; o que separa os dois é a **ausência da fase `requisicao`**. Com as asserções corrigidas, os três E2E caem sem o gate. **Verificado no app real** com servidor SSE local que **conta requisições** — é o que torna o critério 2 verificável por efeito: a chamada barrada registra **zero** no provider e **US$ 0,00** de gasto; o estouro no meio do stream deixa a primeira concluir (`realUsd` 3,00) e barra a **segunda** com o contador ainda em 1. **A cobertura apontou um guard sem teste** — `isBudgetLimitsInput`, o da fronteira do IPC, com 0 chamadas; 12 testes depois, 71,5%. O resto da queda é diluição: `budget-service` e `budget-repository` estão a **100%** em Banco. **Limite registrado, não silenciado:** a prova de **valor computado** da tela (cor da barra no limiar, 44px, anel de foco) ficou pendente — sem a stack Supabase no ar o app fica no login e Settings não é alcançável pela UI, e a galeria de prova hospeda componentes do DS, não telas com ponte. Decisão do PI: entregar assim e registrar. |
| 2026-08-29 | MVP-004 · [FIX] Card de aprovação descreve comando como filesystem ([#84](https://github.com/RodReis/rrb-jarvisOS/issues/84)) | [#113](https://github.com/RodReis/rrb-jarvisOS/pull/113) | Regras 272 (75.5%), Banco 209 (88.2%), **Tela 254 (91.3%)** — **+3 testes de Tela**. A fila é compartilhada entre F01 e F02 **de propósito** — o usuário tem um lugar só para ver o que espera por ele —, mas o card descrevia **toda** pendência como filesystem: uma execução de processo aparecia como "Filesystem: comando", sem binário, sem argumentos e sem cwd. O usuário aprovava às cegas, que é exatamente a confirmação genérica que a SPEC-DS-04b §21 proíbe. A correção **não inventa discriminante**: usa o mesmo `operation.kind` que o handler de `approval:resolve` já usava para rotear a decisão entre os dois motores — o dado que distingue os casos já existia e só a camada de apresentação o ignorava. O ramo de filesystem fica **intacto**. Os 3 testes são provados por **contrafactual**: revertido o fix, os 2 do ramo de comando reprovam e o de filesystem segue verde (não-regressão). **Verificado no app real** (Electron com debug remoto): `node --force` no cwd permitido pausa e o card lê "Executar comando: node --force" com escopo "node --force (em C:\Desenv\Projetos\rrb-jarvisOS)"; **Aprovar continua executando** — a fila esvazia e `verifyAuditChain` → `{ok: true, checked: 125}`. O componente não tinha **nenhum** teste até aqui: o defeito não passou por uma asserção frouxa, passou por ausência de suíte. |
| 2026-08-29 | MVP-005 · F02 Adapter Claude + streaming ([#78](https://github.com/RodReis/rrb-jarvisOS/issues/78)) | (PR desta entrega) | Regras 272 (75.5%), Banco 209 (88.2%), Tela 251 (91.2%) — **+48 testes**, mais 2 E2E. **A fatia que liga a IA de verdade.** O que ela entrega de estrutural é o **ponto único de chamada**: a sede onde a F03 vai instalar o gate de orçamento (ADR-001 q1). Não é organização de código — um segundo caminho até um adapter seria um caminho que não passa pelo gate, e o orçamento deixaria de ser garantia para virar convenção. Por isso a estimativa de custo é calculada **antes** de a chamada sair, mesmo sem consumidor hoje: é onde a F03 encaixa a decisão. **O isolamento do provider é verificável, não prometido**: uma regra do ESLint barra `@anthropic-ai/*` em todo `src/main/` exceto o arquivo do adapter — provada por contrafactual nos três cenários (barra em outro módulo, barra até dentro de `src/main/ai/`, permite no adapter). Escrever a regra custou um susto que virou lição: a primeira versão usava `files: ['src/**']` e, no flat config do ESLint, **apagou** o `no-restricted-imports` da fronteira do design system — quem pegou foi `tests/design/fronteira.int-spec.ts`, com 6 vermelhos. Um bloco posterior substitui a regra homônima do anterior; escopo largo em regra de fronteira é como se desfaz outra fronteira sem perceber. **Os testes vão em três camadas porque cada uma prova o que a anterior não prova**: Regras mede a conta de custo (pura); Banco exercita o ponto único contra SQLite real **e o adapter contra um servidor HTTP local com SSE escrito à mão** — servidor e não `vi.mock` do SDK, porque mock provaria que o meu mock funciona, e o que precisa de prova é o parser de streaming, que eu não escrevi; Tela prova o texto montado chunk a chunk. **A verificação no app real** (E2E com Electron, `ANTHROPIC_BASE_URL` apontando para servidor local — variável que o próprio SDK lê, então o adapter de produção fala HTTP+SSE de verdade) mostrou o caminho inteiro no log do app: `correlationId` casando entrada e saída, `AuditEvent` gravado, custo real US$ 0,000635 = 42×$5/1M + 17×$25/1M. **A cobertura de Regras caiu de 78.8% para 75.5% e isso não é regressão**: `ai.ts` está a **100%** ali; a queda é diluição — `preload/index.ts` e `handlers.ts` cresceram com os três métodos novos, e quem os cobre é Banco e o E2E, não Regras. Um defeito real que o teste da Tela pegou: `formatarUsd` usava duas casas acima de US$ 0,01, transformando US$ 0,0175 em "US$ 0,02" — perda de precisão exatamente na faixa em que quase toda chamada cai. Duas guardas de fronteira (`preload.spec` e o E2E de login) pegaram os métodos novos, e as duas foram atualizadas **enumerando um a um**: um padrão `/ai/` aceitaria um método futuro que devolvesse credencial. |
| 2026-08-28 | MVP-003 · [FIX] Overlays em portal sem tokens ([#107](https://github.com/RodReis/rrb-jarvisOS/issues/107)) | (PR desta entrega) | **684 testes verdes** (+5) e **82 provas de navegador** (+5). O `ProvedorDeTema` injeta os tokens como `style` inline num `div`; o Radix montava o portal no `<body>`, fora dessa subárvore, e todo `var(--jos-*)` resolvia para vazio — os **cinco** overlays saíam transparentes, sem raio, sem sombra e sem `z-index`. A saída foi **passar o nó do provider como `container` do `Portal`** (contexto `useContainerDeOverlay`), e não promover os tokens a `:root`: a segunda quebraria o invariante de **providers aninhados** — dois módulos com acentos distintos na mesma tela, que a CHOICE e o Settings usam hoje. **A verificação no app real achou um segundo defeito com a mesma causa raiz**, que o primeiro escondia: o painel nunca declarou `color`, contando com a herança do `FundoDaIdentidade` — que o portal não tem —, então o título caía no **preto padrão do navegador** sobre superfície escura. Enquanto o painel também era transparente, ninguém via qual dos dois falhava. Os quatro painéis passam a declarar `text-[var(--jos-cor-texto)]`. Os testes vão em **duas camadas, por necessidade**: jsdom não aplica folha de estilo nem resolve `var()` (foi por isso que 679 verdes conviveram com 5 overlays quebrados), então lá só a **topologia** é afirmável — o nó portado é descendente do provider; a medida do valor computado fica no navegador. Todos provados por **contrafactual**: removido o `container`, os 5 de jsdom e os 4 de navegador reprovam; removida a cor, o contraste reprova. Junto, um **teste sensível a tempo** veio à tona: `o Drawer encosta na borda direita` media a posição durante o `entrar-direita` (x oscilando 1201/1239 antes de assentar em 864) e só não falhava porque o portal no `body` montava um tick antes — agora espera as animações terminarem. |
| 2026-08-28 | MVP-005 · F01 Vault de credenciais (#77) | (PR desta entrega) | **679 testes verdes** (+38: 9 Regras, 20 Banco, 9 Tela). **Abre o MVP-005.** O que a fatia realmente entrega é uma garantia **estrutural**, não uma disciplina: o valor do segredo não vaza porque **nenhum tipo que atravessa o IPC tem campo onde ele caiba** — e não existe método na ponte que o peça. Reusa a primitiva de cifra do cofre de tokens (`safeStorage`/DPAPI, main-only), mas guarda muitos segredos endereçados por usuário+espaço+chave, e por isso o valor cifrado mora numa coluna BLOB do SQLite em vez de num arquivo. `source`/`status` são **derivados** em runtime, não colunas: persisti-los criaria uma segunda verdade que envelhece quando o `.env` muda entre dois boots. A decisão do PI sobre o **ator** virou código no lugar certo — o handler IPC fixa `usuario` em vez de aceitar o ator como parâmetro, senão o campo seria a forma de o agente se declarar usuário e escapar do alto risco. A **UI saiu de graça**: `ProviderSetup`, `RemoveCredentialDialog` e a `MENSAGEM_BYOK` nasceram na SPEC-DS-04b **para esta tela** e nunca haviam sido usados. Duas guardas ficaram **mais estritas** ao invés de afrouxar: `preload.spec` e o E2E agora enumeram os três métodos de credencial permitidos em vez de aceitar o padrão `/credential/`. Verificado no app real com efeito no disco — o segredo aparece **0 vezes** nos arquivos do banco enquanto `credential_ref` aparece 3 (a busca funciona), `verifyAuditChain` → `{ok: true, checked: 95}`. E a verificação achou, **pela terceira vez no projeto**, o que a suíte verde não acha: os overlays em portal renderizam **sem tokens** (transparentes, ilegíveis) porque o `ProvedorDeTema` injeta as variáveis num `div` e o Radix monta o modal no `body`, fora dela — defeito do DS anterior a esta fatia, atinge 5 componentes, virou [#107](https://github.com/RodReis/rrb-jarvisOS/issues/107). |
| 2026-08-28 | MVP-004 · F02 Terminal controlado (#75) | [#83](https://github.com/RodReis/rrb-jarvisOS/pull/83) | **639 testes verdes** (+27: 18 Banco, 9 Tela). O segundo caminho de execução real, atrás de **duas barreiras** que respondem perguntas diferentes: a allowlist de binários barra o desconhecido, a denylist de padrões destrutivos pausa o uso perigoso do permitido. As três checagens que bloqueiam (elevação, binário, cwd) vêm antes da que pausa (denylist), e a ordem é a política inteira — elevação é checada **antes** da allowlist justamente para que allowlistar `sudo` não destrave o que a ARCHITECTURE proíbe. Duas decisões do PI sustentam a fatia: **campos separados** em vez de linha tokenizada (com `shell: false`, metacaractere deixa de existir em vez de ser rejeitado por lista) e **allowlist satisfeita libera** (precedente da F01 para `fs.write-allowed`) — sem a segunda, `git status` pediria aprovação e as duas barreiras colapsariam numa só. A fila de aprovação é **compartilhada com a F01** de propósito (um lugar só para o usuário ver o que espera por ele), e por isso o `approval:resolve` passou a rotear pelo `kind` do payload: sem isso, aprovar um comando cairia no motor de filesystem e falharia em silêncio. Três coisas que só o teste pegou: a aprovação **não** pode sobrepor uma allowlist revogada no meio do caminho (re-validação no `resolveApproval`); o `process.env` do main **não** pode alcançar o processo filho (env em lista de permissão — a allowlist de binários não protege contra vazamento de ambiente, porque o binário é legítimo); e a redação tem de vir **antes** do truncamento, senão um token cortado ao meio escapa do padrão que o redigiria. |
| 2026-07-24 | [INFRA] Separar o E2E em job de CI próprio, condicional por paths (#34) | [#71](https://github.com/RodReis/rrb-jarvisOS/pull/71) | Regras 231 (78.8%), Banco 137 (85.7%), **Tela 215 (92.8%)** — a Tela caiu de 218 porque o E2E (3 testes) saiu da soma do relatório. O E2E, que rodava em todo PR (~15 min: build + xvfb + keyring), virou **job próprio condicional por paths** — só roda quando o PR toca a fronteira preload/IPC/janela. A decisão de projeto que fecha a garantia do card ("o E2E completo tem de rodar no caminho para a `main`"): o **required check é o `gate`, não o `e2e`** — um required pulado por `if:` fica *pending eterno* e trava o merge; o `gate` sempre roda e aceita `e2e=skipped`, barrando só em `failure`. **Este próprio PR** é a primeira prova: não toca a fronteira → `e2e` skipped, `gate` verde. Pós-merge: trocar o required check `test`→`gate` na branch protection (só admin). Sem spec (infra); fonte: PI (2026-07-22) + ADR-003. |
| 2026-07-24 | CHOICE · seleção de espaço + acento (#69) — **PR 2/2 (acento persistido)** | [#70](https://github.com/RodReis/rrb-jarvisOS/pull/70) | Fecha os critérios 4, 5 e 8: o acento **persiste** por usuário e é editável nos **dois** lugares (CHOICE e Settings), com o mesmo `AccentSwatchSelector`. Migration 6 (`accent_noa`/`accent_jarvis` no `UserProfile`), **DEFAULT NULL** e não o hex — `null` diz "não escolheu", e quem resolve para o default de fábrica é o `PreferencesService` em runtime, mantendo a fonte única do valor no TS (e desacoplando esta fatia da mudança de `ACENTO_PADRAO.jarvis` que corre em paralelo). A paleta ganha uma **segunda cópia** no `@shared` (`ACCENT_PALETTE`), porque o main precisa validar a cor gravada e a regra de fronteira da F01 proíbe importar o DS — um teste no renderer (`acento-sincronia.spec.ts`) trava as duas listas em sincronia. O `SessaoAtiva` deixou de ter estado local do acento: lê o snapshot resolvido do main, e escolher grava pela mesma via do tema. **575 testes** (+8 do acento). |
| 2026-07-24 | CHOICE · seleção de espaço + acento (#69) — **PR 1/2 (jornada)** | [#70](https://github.com/RodReis/rrb-jarvisOS/pull/70) | A tela CHOICE do protótipo trazida para o app: `login → CHOICE → shell`. Reusa a atmosfera de marca do login (extraída para `AtmosferaDeMarca`, sem duplicar), dois cards de identidade com anel + glow no acento, painel TEMA flutuante (8 swatches por módulo + seletor de tema como prévia) e o overlay de transição. Verificado no browser contra o protótipo: o acento pinta o card ao vivo (anel, glow, tagline), NOA e JARVIS isolados. **A opção A da spec encolheu a fatia**: o rail fica **intacto** (a CHOICE é porta de entrada, não de troca) — a SPEC-Fundacao-02 não muda, e `navegacao.spec.ts` não migra. Mas 24 testes que montam `<App/>` passaram a atravessar a CHOICE (helper `entrarPelaChoice` compartilhado); as asserções de shell ficam idênticas, só muda o caminho. Um teste afirmava a regra revogada ("abre sempre no JARVIS") e virou "abre na CHOICE" — autorizado pela emenda. 567 testes verdes (+6 da CHOICE, −1 da regra revogada). |
| 2026-07-24 | MVP-001 · [FIX] Tela de login fiel ao protótipo (#57) **e** MVP-003 · [FIX] Tailwind não varria `src/design` (#58) | [#59](https://github.com/RodReis/rrb-jarvisOS/pull/59) | 562 testes + 3 E2E verdes, sem asserção afrouxada. A tela de login era o **último lugar do app onde o MVP-003 não tinha chegado**: o placeholder da F03 (66 linhas, botão `sky-600`, card cinza) sobreviveu ao design system inteiro, apesar de o protótipo ter o markup completo, `SUPERFICIES_DE_MARCA` já prever `'login'` e o `Button` documentar `larguraTotal` como *"o 'ACESSAR' do login"*. O DS foi construído para esta tela e nunca foi aplicado nela. **E a lição de método do MVP-003 se repetiu inteira**: com os 562 testes verdes, a captura do app real mostrou quatro defeitos — a tela parando em 538px numa janela de 820px (o `div` do provider colapsa e `h-full` herda o valor errado), o botão sólido no acento tomando a tela, o mascote a 160px onde o protótipo pede 112px, e o texto do botão **quase preto sobre fundo escuro**. Esse último abriu o **#58**: o Tailwind v4 detecta sources a partir da pasta do CSS de entrada, e sem `@source` o `src/design/` inteiro estava fora do scanning — `text-[var(--jos-cor-texto)]` (37 usos), `disabled:opacity-45`, `mix-blend-screen` e os anéis do `VoiceMascot` nunca entraram no bundle. CSS 22,9 KB → **56,8 KB**. Diagnosticado por CDP (`CSS.getMatchedStylesForNode`), que mostrou o `button { color: inherit }` do reset como única regra de cor casando. É o **mesmo defeito da F06** (`@source '../patterns'` faltando no `prova.css`), agora na outra ponta: lá era a galeria, aqui era o app. Junto: `carbono.jpg` 1020 KB → 155 KB (o precedente de otimização da F06). |
| 2026-07-23 | MVP-003 · F06 Adoção & hardening (#24) | [#51](https://github.com/RodReis/rrb-jarvisOS/pull/51) | Regras 230 (78.9%), Banco 132 (85.5%), Tela 210 (92.0%) — **+16 testes**. **Fecha o MVP-003 (8/8 entregues).** A jornada de 3 telas prova a tese do corte: CHOICE com as duas identidades lado a lado, NOA Hoje e JARVIS HUD nos dois modos, tudo com componentes públicos. E o hardening justificou o nome — **três defeitos que nenhum teste de papel pegaria**: o `@source '../patterns'` faltava no `prova.css` desde a F04a, deixando a camada sem CSS utilitário (os swatches `size-7` renderizavam a **2px**); o `vite.prova.config.ts` não declarava o alias `@design` que os outros três configs tinham, e a galeria inteira quebrou com `test`/`lint`/`typecheck` **verdes** — cada ferramenta tem seu próprio mapa de alias; e cinco `focus-visible:ring` que eu mesmo introduzi contra a constante `FOCO` do DS. Junto, a dívida da F05 quitada: assets de **2043 KB → 77 KB** (−96%). |
| 2026-07-23 | MVP-003 · F04b Padrões operacionais (#22) | [#50](https://github.com/RodReis/rrb-jarvisOS/pull/50) | Regras 230 (78.9%), Banco 132 (85.5%), Tela 194 (91.2%) — **+30 testes**. A fatia da **fronteira dura**: risco e aprovação aqui são UI; quem decide é o Policy Engine no main. A headline é a redaction de texto — camada **nova**, não cópia do `redact()` do shared, que opera sobre objeto estruturado e deixa passar `Bearer sk-abc` no meio de uma string. E o próprio teste achou um bug na regex, do tipo pior: a regra parava em `Bearer` e produzia `Authorization: [redigido] xyz98765` — um vazamento que *parece limpo*, e por isso passa por revisão. A suíte documenta **os limites** em três testes: uma regex de segurança sem os seus limites escritos vira promessa falsa. No BYOK, quem recusa a chave é o **tipo** — `CredencialMascarada` não tem campo onde ela caiba. |
| 2026-07-23 | MVP-003 · F04a AppShell + navegação (#21) | [#49](https://github.com/RodReis/rrb-jarvisOS/pull/49) | Regras 217 (78.3%), Banco 132 (85.5%), Tela 177 (91.0%) — **+13 testes**. **Re-plataforma** o shell da fundação, e a prova de que foi troca de pele e não de contrato são os testes que *não* mudaram: os 15 da SPEC-Fundacao-02 passam **sem uma linha alterada**. O grid do protótipo (`60px 232px 1fr`) é idêntico nos dois espaços — a base única aparecendo na maior peça do sistema. Duas decisões travadas por mutação: o sub-módulo do JARVIS é **derivado da rota** (estado próprio faria o rail acender um lado e a sidebar mostrar o outro) e o toggle de tema persiste pela via do Settings lendo o `resolvedTheme` do main, não a preferência crua. E a fatia esbarrou num **bug de três MVPs**: `navegacao.spec.ts` nunca havia rodado — 75 linhas do isolamento de rota fora de toda categoria desde o PR #28. Virou card próprio ([#47](https://github.com/RodReis/rrb-jarvisOS/issues/47) / PR [#48](https://github.com/RodReis/rrb-jarvisOS/pull/48)), sem misturar na fatia. |
| 2026-07-23 | MVP-001 · [FIX] `include` de Regras não alcançava `src/renderer` (#47) | [#48](https://github.com/RodReis/rrb-jarvisOS/pull/48) | Regras **203 → 212** (+9). Os testes estavam corretos; nunca tinham sido executados. Achado durante a F04a: o teste novo do rail dual não rodava, e a investigação mostrou que os antigos também não. A `docs/TESTING.md` §2 repetia a omissão na tabela das categorias (dizia `src/shared` e `src/main`) — corrigida junto, com a lição registrada: *a categoria é definida pelo que o teste prova (a extensão), não pela pasta onde ele mora*. |
| 2026-07-23 | MVP-003 · F05 Identidades NOA e JARVIS (#23) | [#46](https://github.com/RodReis/rrb-jarvisOS/pull/46) | Regras 203 (77.5%), Banco 132 (85.5%), Tela 169 (90.7%) — **+21 testes**. A tese "base única, 2 identidades" vira código verificável: o delta inteiro entre NOA e JARVIS é **dado** (`tokens/identidade.ts`), e há teste que varre a superfície de exportação do DS e falha se algum componente ganhar `noa`/`jarvis` no nome. A headline é um **defeito de contraste que o critério 5 achou**: a variante de leitura das semânticas era ajustada contra a superfície do *módulo ativo*, então a mesma semântica rendia cores diferentes nos dois espaços — e o `violet` do JARVIS media **4.45:1 sobre o fundo do NOA**, abaixo da régua. Uma semântica compartilhada legível em só um dos espaços não está compartilhada. O conserto (`fundoDeReferencia`, o mais exigente dos dois fundos) tem duas asserções de propósito: a igualdade sozinha passaria com duas cores igualmente ilegíveis. E de novo a **prova visual pegou o que os testes verdes não pegaram** — nove asserções falharam achando zero elementos, porque `FundoDaIdentidade` descartava o `data-prova-identidade` em silêncio; corrigido na raiz, não no seletor. |
| 2026-07-23 | MVP-003 · F03b Componentes: dados + overlays + feedback (#20) | [#45](https://github.com/RodReis/rrb-jarvisOS/pull/45) | Regras 203 (78.2%), Banco 132 (85.5%), Tela 148 (90.4%) — **+53 testes** (os 15 de Banco vieram da `main`, do FIX #43).  A metade "saída/estrutura" do conjunto essencial: 14 componentes de dados, 5 overlays, 3 de feedback, o Toast unificado e as notificações. A headline é **o que o teste achou e a leitura do código não**: dois defeitos de a11y em componentes cujo próprio comentário afirmava a garantia que eles não davam. O Radix devolve o foco ao gatilho — **quando ele é dono do gatilho**; `Dialog`/`AlertDialog`/`Drawer` são controlados por prop e não têm `Trigger`, então o foco caía no `<body>` e quem navega por teclado voltava ao topo do documento a cada modal fechado. E um `<section>` sem nome acessível não vira `role="region"`: o `sr-only` do tom do `Panel` existia no DOM e nunca era lido. Ambos provados por mutação (4 testes vermelhos sem as correções). A fatia também firmou que **o critério "estado sem cor" não se prova medindo cor** — em jsdom a asserção mediria a string que o próprio componente escreveu; o que sobrevive ao daltonismo e ao leitor de tela é texto e papel ARIA, e é sobre isso que as 53 asserções falam. |
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
