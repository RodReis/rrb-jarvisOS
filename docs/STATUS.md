# STATUS.md — Kanban / Roadmap

Atualizado em: **2026-08-29**. Visão curta do estado corrente e fonte única do índice Fatia ↔ SPEC. Histórico e ressalvas: `docs/STATUS-ARQUIVO.md`. O board GitHub vence em caso de divergência factual.

## Agora

| Coluna | Item | Estado |
|---|---|---|
| Em Andamento | [#87](https://github.com/RodReis/rrb-jarvisOS/issues/87) · MVP-006 F01 Núcleo de conectores | `proplan:doing`; **abre o MVP-006** |
| Próximo | [#88](https://github.com/RodReis/rrb-jarvisOS/issues/88) · MVP-006 F02 Operação e governança | `proplan:next`; cabeça da fila |
| Backlog | [#89–#92](https://github.com/RodReis/rrb-jarvisOS/issues/89) · MVP-006 | quatro SPECs `aprovada-pi` (2026-08-29); atrás da #88 na fila |
| Backlog | [#94–#99](https://github.com/RodReis/rrb-jarvisOS/issues/94) · MVP-008 | seis SPECs `aprovada-pi` (2026-08-29); atrás do MVP-006 na fila |
| Backlog | [#101–#106](https://github.com/RodReis/rrb-jarvisOS/issues/101) · MVP-009 | seis SPECs `aprovada-pi` (2026-08-29); fim da fila |
| Finalizado | [#75](https://github.com/RodReis/rrb-jarvisOS/issues/75) · MVP-004 F02 Terminal | aceito pelo PI (2026-08-29), PR [#83](https://github.com/RodReis/rrb-jarvisOS/pull/83) |
| Finalizado | [#77](https://github.com/RodReis/rrb-jarvisOS/issues/77) · MVP-005 F01 Vault | aceito pelo PI (2026-08-29), PR [#108](https://github.com/RodReis/rrb-jarvisOS/pull/108) |
| Finalizado | [#107](https://github.com/RodReis/rrb-jarvisOS/issues/107) · `[FIX]` overlays em portal sem tokens | aceito pelo PI (2026-08-29), PR [#109](https://github.com/RodReis/rrb-jarvisOS/pull/109) |
| Finalizado | [#78](https://github.com/RodReis/rrb-jarvisOS/issues/78) · MVP-005 F02 Adapter Claude | aceito pelo PI (2026-08-29), PR [#112](https://github.com/RodReis/rrb-jarvisOS/pull/112) |
| Finalizado | [#84](https://github.com/RodReis/rrb-jarvisOS/issues/84) · `[FIX]` card de aprovação descreve comando como filesystem | aceito pelo PI (2026-08-29), PR [#113](https://github.com/RodReis/rrb-jarvisOS/pull/113) |
| Finalizado | [#110](https://github.com/RodReis/rrb-jarvisOS/issues/110) · M4-F03 UI da allowlist de diretórios | aceito pelo PI (2026-08-29), PR [#114](https://github.com/RodReis/rrb-jarvisOS/pull/114) |
| A Fazer/Em Andamento | — | WIP = 0 |

> **M6-F01 entregue (2026-08-29) — abre o MVP-006.** O contrato único de capacidades externas, sem proxy HTTP genérico: cada adapter declara o que sabe fazer, valida sua entrada e devolve resultado ou erro **normalizado**. O que a fatia entrega de estrutural é o **ponto único de conectores** — a sede da governança que a F02 instala (health, retry, rate limit, ledger de créditos), pela mesma lógica que fez o `AiCallService` ser a sede do gate de orçamento. **Runtime separado do ponto único de IA** por decisão do PI: os dois compartilham Vault, auditoria encadeada e ledger, e nada mais. **968 testes** (+39: 24 Regras, 15 Banco), quatro provados por contrafactual. **Duas perguntas foram ao PI antes de codificar**, e as duas mudaram o construído: a F01 entrega canais tipados + listagem de capacidades (sem tela), e as chaves de credencial de conector viram **conjunto próprio** — acrescentá-las ao enum de IA faria o Settings anunciar credenciais ausentes que ninguém consegue usar até a F03. O cofre, esse, é o **mesmo**: `credential_ref.key` sempre foi texto, e o que é separado é a taxonomia, não o armazenamento. **O contrafactual pegou uma asserção que não provava o que dizia:** os testes de "recusa antes de I/O" afirmavam que o cofre não fora consultado, mas os pedidos não traziam credencial — a lista ficaria vazia mesmo com o defeito. Com credencial no pedido, reprovam dois em vez de um. **Limite registrado:** nenhum adapter concreto existe (GitHub é F03/F04, Tavily é F05/F06), então não há verificação no app real — o que os testes exercitam é o *contract fixture* que a spec pede, e a prova em Electron chega com o primeiro adapter.
>
> **M5-F01 entregue (2026-08-28) — abre o MVP-005.** Os 9 critérios cobertos; **679 testes verdes** (+38: 9 Regras, 20 Banco, 9 Tela). A garantia central é **estrutural**: nenhum tipo que atravessa o IPC tem campo onde o segredo caiba, e não existe método na ponte que o peça. Verificado no app real — o segredo semeado aparece **0 vezes** em `jarvis.db`/`-wal`/`-shm` enquanto `credential_ref` aparece 3 (prova de que a busca funciona); é a prova do **DPAPI real**, já que o teste de integração usa cifra dublada. `verifyAuditChain` → `{ok: true, checked: 95}`. Detalhe em `DEVELOPMENT.md`.
>
> **A verificação achou um defeito do design system, não da fatia** ([#107](https://github.com/RodReis/rrb-jarvisOS/issues/107)): overlays em portal renderizam **sem tokens** — modal transparente e ilegível. O `ProvedorDeTema` injeta as variáveis num `div`, o Radix monta o portal no `body`, fora dela. Atinge os 5 componentes com portal, é anterior a esta fatia. **Terceira repetição do mesmo método no projeto** (depois de #57/#58): jsdom não aplica folha de estilo, então componente visualmente quebrado passa verde.
>
> **#107 entregue (2026-08-28).** Cada `Portal` recebe o nó do provider como `container` — preserva os providers aninhados que a CHOICE e o Settings usam, o que promover os tokens a `:root` quebraria. A verificação no app real achou um **segundo defeito com a mesma causa raiz**, escondido pelo primeiro: o painel herdava a cor de texto do `FundoDaIdentidade`, que o portal não tem, e o título caía no preto do navegador. **684 testes** (+5) e **82 provas de navegador** (+5), todos provados por contrafactual. A régua nova é em duas camadas por necessidade: jsdom só afirma topologia, o valor computado só o navegador mede — que é exatamente o buraco pelo qual este defeito passou.

> **M5-F02 entregue (2026-08-29).** A IA passa a chamar de verdade. O que a fatia entrega de estrutural é o **ponto único de chamada** — a sede do gate de orçamento da F03 (ADR-001 q1); um segundo caminho até um adapter seria um caminho sem gate. O **isolamento do provider virou regra do ESLint** (barra `@anthropic-ai/*` em todo `src/main/` menos o adapter), provada por contrafactual. **732 testes** (+48) e 2 E2E novos; verificado no app real com Electron, com o log do app mostrando `correlationId`, `AuditEvent` e custo medido. A cobertura de Regras caiu para 75.5% por **diluição**, não regressão: `ai.ts` está a 100% ali, e o que cresceu (`preload`, `handlers`) é coberto por Banco e E2E.
>
> **#84 entregue (2026-08-29).** O card da fila descrevia **toda** pendência como filesystem — uma execução de processo aparecia como "Filesystem: comando", sem binário, argumentos ou cwd, e o usuário aprovava às cegas. A correção **não inventa discriminante**: reusa o `operation.kind` que o handler de `approval:resolve` já usava para rotear a decisão entre os dois motores — o dado existia, só a apresentação o ignorava. **735 testes** (+3, todos de Tela), provados por contrafactual, e o ramo de filesystem intacto. Verificado no app real: o card lê "Executar comando: node --force" com o cwd no escopo, e **Aprovar continua executando** (`verifyAuditChain` → `{ok: true, checked: 125}`). O achado que vale registrar é de método: o componente não tinha **nenhum** teste — o defeito não passou por asserção frouxa, passou por ausência de suíte.
>
> **M4-F03 entregue (2026-08-29).** A tela que faltava desde o MVP-002: os canais da allowlist de diretórios existiam na ponte e **nenhuma tela os usava**, então pelo aplicativo ninguém conseguia permitir uma pasta — e sem isso o terminal recusava todo cwd. A fatia **não toca enforcement**; entrega o acesso a ele. **Adicionou dois canais IPC, não um** como a spec previa: o critério 4 pede marcar o `appDir` como fixo, mas `listAllowedDirectories` devolve strings sem marcação e o `appDir` nunca atravessava o IPC identificado — as alternativas eram mudar um contrato que a spec proíbe mudar, ou inferir a identidade por posição no renderer (acoplando a UI à ordem de inserção do `Set` no repositório). **Decisão do PI: canal só-leitura `allowlist:app-dir`.** **750 testes** (+15: 4 Regras, 11 Tela) e **+1 E2E**; quatro provados por contrafactual. **A revisão do próprio código achou um defeito que os 9 primeiros testes não pegavam:** o `ErrorState` era irmão do conteúdo em vez de substituí-lo, e falhando a carga o usuário via o aviso **junto de uma lista vazia com o botão de permitir** — "você não tem nenhuma pasta" quando o certo é "não sabemos quais são". O teste de erro passava porque afirmava só o **texto** do alerta, nunca o que estava ao lado dele. **Verificado no app real pela ponte real:** a pasta recusada por `cwd-fora-da-allowlist` passa a executar `node --version` → `v24.15.0` depois de permitida, o `appDir` resiste à remoção e `verifyAuditChain` → `{ok: true, checked: 10}`. **Verificada renderizada, com a sessão logada:** os valores computados confirmam o que jsdom não mede — tokens do tema resolvidos, `Tag` do `appDir` distinta dos botões de perigo, altura de controle 44px, **sem overflow horizontal** com paths longos, anel de foco de 3px por teclado. Remover **pela tela** tira o item; o `appDir` não tem botão; `verifyAuditChain` → `{ok: true, checked: 129}`. **E a tela expôs o que a ausência dela escondia:** duas entradas-lixo gravadas por uso manual da ponte nas verificações anteriores — resíduo do `resolve()` sobre path não-absoluto, que o seletor nativo torna impossível.
>
> **M5-F03 entregue (2026-08-29).** O `CostEvent` que a F02 media vira **enforcement**: antes de cada chamada, o ponto único compara (gasto real acumulado no período) + (estimativa desta chamada) contra os limites do escopo, e a chamada que estouraria **não sai**. O gate encaixa exatamente onde a F02 o preparou, e **antes** da auditoria de requisição — barrar depois de o `AuditEvent` dizer "requisitei" registraria uma requisição que nunca houve. **`cost_event` precisou ser tabela nova:** a F02 emitia o custo só como payload de `audit_event`, e payload de cadeia append-only não se consulta por período. **Piso de bloqueio duro por decisão do PI** — o MVP-004 está entregue, mas sua fila de aprovação é acoplada a `run_id`/`step_id` de workflow, que chamada de IA não tem; o override por aprovação segue como alvo de fatia futura. **824 testes** (+73) e **3 E2E**. **O teste pegou o que a leitura teria deixado passar:** o caminho barrado passava por `finalizar` e **registrava `CostEvent` de uma chamada que nunca saiu** — e o comentário que eu havia escrito ali afirmava o contrário do que o código fazia; quem pegou foi a asserção que **conta linhas**, não a que lê a mensagem. **E o contrafactual quase mentiu duas vezes**, que é a lição de método da fatia: (1) `npm run build` roda `typecheck` antes, então um contrafactual que não compila aborta o build e o Playwright roda contra o **bundle anterior** — "3 passed" sem ter provado nada; (2) auditar `decisao: 'bloqueado'` **não prova enforcement**, porque o serviço decide igual em report-only e quem barra é o ponto único — o que separa os dois é a **ausência da fase `requisicao`**. **Verificado no app real** com servidor SSE local que **conta requisições**: a chamada barrada registra **zero** no provider e US$ 0,00 de gasto; o estouro no meio do stream deixa a primeira concluir e barra a **segunda** com o contador ainda em 1; `verifyAuditChain` → `ok`. **Limite registrado:** a prova de **valor computado** da tela (cor da barra no limiar, 44px, anel de foco) ficou pendente — sem a stack Supabase no ar o app fica no login e Settings não é alcançável pela UI. Decisão do PI: entregar assim e registrar.
>
> **M5-F04 entregue (2026-08-29) — o MVP-005 fecha.** Três adapters novos (Gemini HTTP, Ollama HTTP local, Claude Code CLI subprocess) pela **mesma interface** da F02, e o ponto de chamada **não mudou** por causa deles — o critério 1 valendo na prática. Todos herdam classificação, `CostEvent`, `AuditEvent` e o **gate de orçamento da F03**: nada burla o ponto único. O `ProviderRoute` decide quem atende cada tipo de tarefa, com preferência local e **fallback auditado**. **929 testes** (+71) e **6 E2E**. **A mudança mais arriscada foi tornar `apiKey` opcional** — Ollama e `claude-code` não têm credencial, mas com `undefined` aceito, marcar um provider **pago** como sem-credencial passaria em silêncio; duas guardas novas fecham (só rota `unmetered` dispensa credencial, e toda rota unmetered custa **exatamente** zero). **O `AiCallHandle` deixou de afirmar o que não sabia:** o handler devolve o handle antes da seleção, então prever o provider erraria em todo fallback — o realmente usado chega no `CostEvent`. **O teste pegou o que a leitura não pegaria:** o mock da ponte no `AppShell.test.tsx` estava incompleto e **a suíte passava assim mesmo**, com a tela em estado de erro — verde, mas não é o Settings que o usuário vê. **Verificado no app real no pior cenário** (sem credencial e sem Ollama): a rota sem ninguém disponível **recusa a chamada** em vez de gastar às cegas, e `verifyAuditChain` → `ok`. **A armadilha da F03 reapareceu e foi reconhecida na hora** — `npm run build` roda `typecheck` antes, e um build que aborta deixa o Playwright medindo o bundle anterior.
>
> **Decisões do PI (2026-08-29):** três modelos na tabela de preço (Opus 5, Sonnet 5, Haiku 4.5) para dar spread à F03 e à F04; **SDK oficial** `@anthropic-ai/sdk` em vez de `fetch` cru; **painel mínimo** de teste no Settings — a tela de providers é F04, explicitamente.

## MVPs

| MVP | Issue | Estado | Progresso |
|---|---|---|---|
| MVP-001 Fundação | [#1](https://github.com/RodReis/rrb-jarvisOS/issues/1) | fechado/aceito | 6/6 |
| MVP-002 Execução local | [#9](https://github.com/RodReis/rrb-jarvisOS/issues/9) | fechado/aceito | 5/5 |
| MVP-003 Design System | [#16](https://github.com/RodReis/rrb-jarvisOS/issues/16) | fechado/aceito | 8/8 |
| MVP-004 Execução real | [#10](https://github.com/RodReis/rrb-jarvisOS/issues/10) | **três fatias finalizadas**; o épico aguarda o fechamento do PI | 3/3 |
| MVP-005 Providers/Vault/Budget | [#76](https://github.com/RodReis/rrb-jarvisOS/issues/76) | F01 e F02 finalizadas; **F03 e F04 entregues**, aguardando aceite | 4/4 |
| MVP-006 Conectores Essenciais | [#86](https://github.com/RodReis/rrb-jarvisOS/issues/86) | **F01 em andamento**; cinco fatias no Backlog | 0/6 |
| MVP-007 Memória Contextual/RAG | — | slot proposto; **sem fatias e sem SPEC** — nada a aprovar até entrar em planejamento ativo | — |
| MVP-008 Planejamento Governado | [#93](https://github.com/RodReis/rrb-jarvisOS/issues/93) | seis SPECs `aprovada-pi` (2026-08-29); fatias no Backlog | 0/6 |
| MVP-009 Entrega Autônoma | [#100](https://github.com/RodReis/rrb-jarvisOS/issues/100) | seis SPECs `aprovada-pi` (2026-08-29); fatias no Backlog | 0/6 |

> **MVP-006 aprovado (2026-08-29).** As seis SPECs passaram pelo gate de perguntas abertas e viraram `aprovada-pi`. Sete decisões do PI: runtime de conectores **separado** do ponto único de IA do MVP-005; **ledger de créditos próprio** para conector, independente da `BudgetPolicy` em USD; **GitHub App do projeto** com `client_id` embutido e override em Settings; **emenda do Vault para OAuth** (payload estruturado, `expires_at`, rotação atômica) como escopo da M6-F03, sem reabrir a M5-F01; **roteamento Context7↔Tavily removido** da M6-F05 e transferido ao MVP-008; **UI mínima dentro de cada fatia**, sem fatia dedicada; **evidência extensa no diretório de artefatos do app**. A aprovação **não muda a fila** — a cabeça continua sendo a M5-F02 (#78).

> **MVP-008 aprovado (2026-08-29).** Seis decisões do PI: projeto nasce **sob `userData`** e criar projeto nunca amplia a allowlist; **Git é o `git` do sistema pelo terminal controlado do MVP-004**, sem segundo caminho de escrita fora do enforcement; **importar o próprio `rrb-jarvisOS`** é critério de aceite; a **rota de assinatura (Claude MAX via Claude Code) registra uso sem valor monetário** e a `BudgetPolicy` gateia só rota paga; o app **não chama Context7** — ele é do agente construtor no MVP-009; **anexos de design entram por seletor que copia e hasheia no ato**. Duas dependências duras ficaram registradas: a M8-F01 depende da M4-F02 (#75) e fica limitada ao diretório do app até existir a fatia de UI da allowlist. Emendas em `spec-providers-03` e `spec-providers-04`: rota de assinatura é `unmetered`. **A fila não mudou** — a cabeça continua sendo a M5-F02 (#78).

> **MVP-009 aprovado (2026-08-29).** Três decisões do PI: **o container Docker é o sandbox do executor** — o Claude Code roda nele com o worktree montado, nunca no host; **merge autônomo ligado por padrão com kill-switch por projeto**, e desligado o run termina no PR verde aguardando o PI; **Context7 é ferramenta do agente construtor** na M9-F04, fechando a pendência herdada do MVP-008. A decisão do container fecha um buraco real: o MVP-004 proibiu comando arbitrário, mas um agente que constrói software precisa exatamente disso — sem fronteira nova, o MVP-009 passaria por cima do enforcement que o MVP-004 entregou. **Docker passa a ser dependência dura**, sem fallback para o host.

## Índice Fatia ↔ SPEC

Não existe catálogo global `SPEC-nnn`. O identificador canônico é o slug abaixo; não inventar números.

| Índice | MVP | Fatia | SPEC |
|---|---|---|---|
| F01–F06 | MVP-001 | Bootstrap · AppShell · Auth · Dados · Settings · Observabilidade | `spec-fundacao-01..06` |
| M2-F01–F05 | MVP-002 | Supabase · Policy · Allowlist · Workflows · Simulação | `spec-execucao-local-01..05` |
| M3-F01–F06 | MVP-003 | Infra · Foundations · Componentes a/b · AppShell a/b · Identidades · Hardening | `spec-design-system-01..06` |
| M4-F01 | MVP-004 | Filesystem allowlisted | `spec-execucao-real-01-filesystem-allowlisted.md` |
| M4-F02 | MVP-004 | Terminal controlado | `spec-execucao-real-02-terminal-controlado.md` |
| M4-F03 | MVP-004 | UI da allowlist de diretórios ([#110](https://github.com/RodReis/rrb-jarvisOS/issues/110)) | `spec-execucao-real-03-ui-allowlist-diretorios.md` |
| M5-F01 | MVP-005 | Vault | `spec-providers-01-vault-credenciais.md` |
| M5-F02 | MVP-005 | Adapter Claude | `spec-providers-02-adapter-claude-api.md` |
| M5-F03 | MVP-005 | BudgetPolicy | `spec-providers-03-budget-policy.md` |
| M5-F04 | MVP-005 | Multi-provider | `spec-providers-04-multi-provider-roteamento.md` |
| M6-F01 | MVP-006 | Núcleo de conectores | `spec-conectores-01-nucleo.md` |
| M6-F02 | MVP-006 | Operação e governança | `spec-conectores-02-operacao-governanca.md` |
| M6-F03 | MVP-006 | GitHub App/autenticação | `spec-conectores-03-github-app-autenticacao.md` |
| M6-F04 | MVP-006 | Automação GitHub | `spec-conectores-04-github-automacao.md` |
| M6-F05 | MVP-006 | Tavily Search | `spec-conectores-05-tavily-search.md` |
| M6-F06 | MVP-006 | Tavily Extract/evidências | `spec-conectores-06-tavily-extract-evidencias.md` |
| M8-F01 | MVP-008 | Projeto e Git local | `spec-planejamento-01-projeto-git-local.md` |
| M8-F02 | MVP-008 | Contexto, skills e orçamento | `spec-planejamento-02-contexto-skills-orcamento.md` |
| M8-F03 | MVP-008 | Wizard orientado | `spec-planejamento-03-wizard-orientado.md` |
| M8-F04 | MVP-008 | PRD/Landscape/Convention | `spec-planejamento-04-prd-landscape-convention.md` |
| M8-F05 | MVP-008 | Anexos/design/arquitetura | `spec-planejamento-05-anexos-design-arquitetura.md` |
| M8-F06 | MVP-008 | Roadmap e aprovações | `spec-planejamento-06-roadmap-aprovacoes.md` |
| M9-F01 | MVP-009 | Publicação GitHub | `spec-entrega-01-publicacao-github.md` |
| M9-F02 | MVP-009 | DAG/fila/reconciliação | `spec-entrega-02-dag-fila-reconciliacao.md` |
| M9-F03 | MVP-009 | Worktree/preflight/Docker | `spec-entrega-03-worktree-preflight-docker.md` |
| M9-F04 | MVP-009 | Construção/recuperação | `spec-entrega-04-construcao-recuperacao.md` |
| M9-F05 | MVP-009 | Revisão/CI/merge | `spec-entrega-05-revisao-ci-merge.md` |
| M9-F06 | MVP-009 | Evidência/limpeza | `spec-entrega-06-evidencia-limpeza-continuidade.md` |

## Próximas ações

1. **O MVP-005 fechou**: as quatro fatias foram entregues, e #79/#80 seguem aguardando o aceite do PI junto do épico [#76](https://github.com/RodReis/rrb-jarvisOS/issues/76).
2. **O MVP-004 ([#10](https://github.com/RodReis/rrb-jarvisOS/issues/10)) tem as três fatias finalizadas** e só falta o PI fechar o épico.
3. **A M6-F02 herda a sede pronta**: o `ConnectorService` da F01 é o ponto único onde health, retry, rate limit, circuit breaker e o ledger de créditos entram — nenhuma refatoração do caminho de chamada é necessária, do mesmo modo que a M5-F03 encaixou no ponto único da M5-F02.
4. **MVP-006, MVP-008 e MVP-009 revisados e aprovados (2026-08-29)** — dezesseis decisões estruturais do PI registradas nas SPECs e nos docs dos épicos; #87–#92, #94–#99 e #101–#106 migraram para `proplan:backlog`. **Todas as 24 SPECs do projeto estão `aprovada-pi`.**
5. MVP-007 será detalhado apenas quando entrar no planejamento ativo — hoje não tem fatia nem SPEC, então não há o que aprovar.
6. **A M4-F03 fechou a última fatia conhecida sem SPEC** e foi entregue no mesmo dia: não existe mais fatia conhecida sem spec, e o uso real do terminal/filesystem pelo app deixou de depender da ponte — a M8-F01 perde o limite de criar projeto só dentro do diretório do app.
7. **Docker virou dependência dura do MVP-009** (sandbox do executor). Confirmar que a máquina de execução tem Docker antes daquele MVP entrar na fila.

## Roadmap

MVP-001 ✅ → MVP-002 ✅ → MVP-003 ✅ → MVP-004 → MVP-005 → MVP-006 → MVP-008 → MVP-009. MVP-007 é paralelo/não bloqueante.
