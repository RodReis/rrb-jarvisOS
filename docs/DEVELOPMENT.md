# DEVELOPMENT.md — Ordem de execução e status

**Dono: Claude Code.** Atualize este arquivo a cada entrega, junto com `STATUS.md`. Aqui vive o *"onde estou dentro da fatia"* (passos com checkmarks); o *"qual fatia está em qual coluna"* vive nas GitHub Issues / `STATUS.md`. Nenhum fato mora nos dois lugares.

Regra de trabalho: **uma fatia por vez (WIP = 1)**. Só iniciar fatia com spec `aprovada-pi` e issue criada.

**Ordem de execução:** 01 → **06 (logging, infra transversal)** → **04 + 02 (entregues juntas)** → 03 → 05. A Fatia 06 roda logo após a 01 porque 02–05 devem logar desde o início; a 04 vem antes da 02 porque 02/03 consomem seus contratos tipados (decisão de 2026-07-22). As seções abaixo estão em ordem numérica; a 06 aparece após a 01 por ser quando ela executa.

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

Status: spec `aprovada-pi` (2026-07-21); issue #4 em Backlog. **BLOQUEADA — aguarda o PI.** Depende da Fatia 01; consome contratos da 04 (já entregues).

> **O que falta para desbloquear (só o PI pode fazer):** criar o projeto Supabase de desenvolvimento e o cliente OAuth no Google Cloud, e preencher o `.env` local. O `.env.example` na raiz lista as quatro variáveis e onde obter cada uma. Enquanto isso não existe, os critérios 1 (login real), 2 (relançamento offline), 7 (token cifrado) e 9 (E2E do login) são inverificáveis — não há o que testar sem um provedor de identidade. A infra que a fatia consome (`Session`, `UserProfile`, `AuditEvent`, tipos `login`/`logout`/`login-offline-reuse`) **já está entregue** na F04.

- [ ] Projeto Supabase dev na nuvem configurado (ADR-002); env local sem segredo commitado
- [ ] Fluxo OAuth no navegador do sistema + retorno via **loopback local**
- [ ] Sessão offline válida por **30 dias** antes de exigir reautenticação (ADR-001)
- [ ] Persistência de sessão no main process **cifrada via `safeStorage`/DPAPI** (token nunca em claro no disco); renderer só vê snapshot de perfil
- [ ] Estados: deslogado / autenticando / ativo / erro / sessão-expirada
- [ ] Relançamento offline reusa sessão; logout limpa estado sensível
- [ ] AuditEvents de login/logout/login-offline-reuse
- [ ] Testes do fluxo (unit com mock) **+ E2E Playwright-Electron do login feliz** (firmado — alimenta a categoria E2E do relatório, ADR-003)
- [ ] Entrega: PR `refs #N`; docs/ commitados

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

Status: spec `aprovada-pi` (2026-07-21); issue #6 em Backlog. Depende de 01–04.

- [ ] Tela Settings acessível nos dois espaços
- [ ] Idioma pt-BR/en-US com troca a quente; infra i18n via **i18next**
- [ ] Tema claro/escuro/sistema com persistência por usuário
- [ ] Testes de persistência de preferências
- [ ] Entrega: PR `refs #N`; docs/ commitados

## MVP-002 — Execução local controlada (fundação de execução)

Épico [#9](https://github.com/RodReis/rrb-jarvisOS/issues/9). **As 5 fatias têm spec `aprovada-pi`** (issues #11–#15). Roda **após o MVP-001**. Ordem sugerida dentro do MVP: 01 (ambiente, independente) e 02 (Policy Engine) cedo → 03 (allowlist) → 04 (registro) → 05 (execução simulada, junta tudo).

### Fatia 01 — Supabase local + ambiente de sync (`docs/spec/spec-execucao-local-01-supabase-local.md`)

Status: spec `aprovada-pi` (2026-07-21); issue [#15](https://github.com/RodReis/rrb-jarvisOS/issues/15) em Backlog. **Ambiente, roda independente.** Só o alvo de sync — o sync em si é Corte 3.

- [ ] `supabase` CLI: stack local via Docker; `supabase/` versionado (config+migrations+seed); README (subir/derrubar, portas); `supabase db reset` reproduzível
- [ ] Migrations starter: `UserProfile`, `Workspace`, `AuditEvent` com campos de escopo
- [ ] **RLS comprovada** com role de aplicação **não-owner** (só enxerga o próprio user_id/workspace_id)
- [ ] **Nenhum segredo no schema cloud** (sem coluna de token/`Session`); SQLite segue fonte de verdade; nada escreve no Supabase ainda
- [ ] Entrega: PR `refs #N`; docs/ commitados

### Fatia 02 — Policy Engine mínimo (classificação) (`docs/spec/spec-execucao-local-02-policy-engine.md`)

Status: spec `aprovada-pi` (2026-07-21); issue [#11](https://github.com/RodReis/rrb-jarvisOS/issues/11) em Backlog. **Modo report** — classifica e audita, não bloqueia; enforcement fail-closed liga no MVP-003.

- [ ] Núcleo avaliador puro `evaluate(action, context) → { tier, outcome, reason }` em `src/shared/policies/`
- [ ] Taxonomia de risco (baixo/médio/alto/bloqueado) como **seed** a partir dos requisitos — sem hardcode
- [ ] Classificação sensível ao contexto (JARVIS + personal/financial/health ⇒ alto); não reconhecida ⇒ `bloqueado`
- [ ] Toda decisão gera `AuditEvent` encadeado (ADR-004); `verifyChain` passa
- [ ] Modo report: runtime recebe a decisão e **não bloqueia**; UI só vê resultado via IPC tipado
- [ ] Entrega: PR `refs #N`; docs/ commitados

### Fatia 03 — Diretórios permitidos (allowlist) (`docs/spec/spec-execucao-local-03-allowlist-diretorios.md`)

Status: spec `aprovada-pi` (2026-07-21); issue [#12](https://github.com/RodReis/rrb-jarvisOS/issues/12) em Backlog. Depende da Fatia 02. Nesta fatia a allowlist é **dado + checagem**, não gating real de FS (isso é MVP-003).

- [ ] Allowlist persistida (SQLite), escopada por `user_id`; **default = só o diretório do app** (`userData`)
- [ ] `isPathAllowed` com canonicalização (`..`/symlink) + matching recursivo; path que resolve pra fora ⇒ `false`
- [ ] Add/remove de diretório gera `AuditEvent` encadeado (ADR-004)
- [ ] Integra com o Policy Engine (F02): path fora do permitido eleva o tier
- [ ] Renderer não lê/edita FS nem a allowlist direto — só IPC tipado; checagem no main
- [ ] Entrega: PR `refs #N`; docs/ commitados

### Fatia 04 — Registro de workflows + automações (`docs/spec/spec-execucao-local-04-registro-workflows.md`)

Status: spec `aprovada-pi` (2026-07-21); issue [#13](https://github.com/RodReis/rrb-jarvisOS/issues/13) em Backlog. Depende da Fatia 02. **Só registro/catálogo, sem execução** (executar é a Fatia 05).

- [ ] Workflow com **schema pleno RF-006** (etapas seq/paralelo, agenteId?/skillId? nullable, entradas/saídas, critérios de sucesso, `requiresApproval`, status, agenda); nasce `disabled`
- [ ] Trigger Registry registra `manual|cron|evento|webhook` como dado; **nenhum dispara** (só manual acionável, via F05)
- [ ] Automação RF-007: gatilho (manual acionável; demais schema), alvo, squadId?/skillId? nullable, estado/retentativa
- [ ] CRUD completo; **nenhuma execução** ocorre; criar/alterar/ativar-desativar auditado (ADR-004) + classificado (F02)
- [ ] Etapas = descritores de ação compatíveis com a taxonomia do Policy Engine (p/ a F05 classificar/simular)
- [ ] Entrega: PR `refs #N`; docs/ commitados

### Fatia 05 — Motor de execução simulado (`docs/spec/spec-execucao-local-05-execucao-simulada.md`)

Status: spec `aprovada-pi` (2026-07-21); issue [#14](https://github.com/RodReis/rrb-jarvisOS/issues/14) em Backlog. **Headline do MVP** — junta F02+F03+F04. **Zero efeito colateral** (execução real é MVP-003).

- [ ] Motor no main: lê workflow (F04), percorre etapas (seq/paralelo) por gatilho manual
- [ ] Por etapa: classifica (F02, report) → checa allowlist se há path (F03) → **simula** sem efeito real
- [ ] `ExecutionRun` persistido com máquina de estados RF (`planejado→em execução→concluído|falhou|cancelado`; `aguardando aprovação` auto-continua) + trace por etapa
- [ ] Simulação determinística (sucesso por padrão; falha declarável p/ testar `falhou`/retentativa)
- [ ] Início/fim + etapas geram `AuditEvent` encadeado (ADR-004, `verifyChain` passa); run logado (ADR-005) com `correlationId`
- [ ] **Zero efeito colateral** (teste: etapa "gravar arquivo" não cria arquivo); renderer dispara via IPC tipado
- [ ] Entrega: PR `refs #N`; docs/ commitados

## Após o MVP-002

Ordem: MVP-002 (fundação de execução) → **MVP-003** ([#10](https://github.com/RodReis/rrb-jarvisOS/issues/10), execução real + terminal) → MVP de providers (Corte 3, com BudgetPolicy). Ordem macro em `docs/LANDSCAPE.md` § Roadmap.

## Registro de entregas

| Data | Fatia | PR | Observação |
|---|---|---|---|
| 2026-07-22 | MVP-001 · F01 Bootstrap e estrutura (#2) | [#25](https://github.com/RodReis/rrb-jarvisOS/pull/25) | CI verde na 1ª execução. Relatório ADR-003 ativo: selfcheck 10/10, guarda anti-drift verificada nos dois sentidos. Regras 14 (85%), Tela 4 (100%), Banco 0 (F04). |
| 2026-07-22 | MVP-001 · F06 Observabilidade e Logging (#8) | [#27](https://github.com/RodReis/rrb-jarvisOS/pull/27) | Regras 49 (87.2%), **Banco 8 (85.5%)**, Tela 13 (97.6%). A categoria **Banco deixa de estar vazia antes da F04**: os testes de integração do logger tocam disco real (arquivo temporário, teardown por teste), que é exatamente o que a categoria mede — o `TESTING.md` §8 previa SQLite como primeiro caso, mas a régua é "integração com storage local", não "SQLite". Verificado também no app real: os três arquivos nascem em `userData/logs` e o registro do renderer chega ao disco. |
