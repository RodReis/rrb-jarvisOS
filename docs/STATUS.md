# STATUS.md — Kanban / Roadmap

Planejamento atualizado em: **2026-08-30**; fila operacional preservada do registro de **2026-08-29**, não revalidada nesta redação. Fonte única do índice Fatia ↔ SPEC. Histórico e ressalvas: `docs/STATUS-ARQUIVO.md`. O board GitHub vence em caso de divergência factual.

> **Conferência pontual da publicação do MVP-007 (2026-08-30):** o `next` no GitHub passou de **#101** na consulta inicial para **#102** na consulta final, sem alterações de fila por esta tarefa. A tabela “Agora” abaixo é o retrato histórico de 2026-08-29 e não foi reconciliada com as entregas posteriores; o board remoto vence.

## Agora

| Coluna | Item | Estado |
|---|---|---|
| Próximo | [#110](https://github.com/RodReis/rrb-jarvisOS/issues/110) · M4-F03 UI da allowlist de diretórios | `proplan:next`; `aprovada-pi` 2026-08-29; desbloqueia MVP-004 e M8-F01 |
| Backlog | [#79](https://github.com/RodReis/rrb-jarvisOS/issues/79) · BudgetPolicy | aprovado, aguardando fila |
| Backlog | [#80](https://github.com/RodReis/rrb-jarvisOS/issues/80) · Multi-provider | aprovado, aguardando fila |
| Backlog | [#87–#92](https://github.com/RodReis/rrb-jarvisOS/issues/87) · MVP-006 | seis SPECs `aprovada-pi` (2026-08-29); atrás de #79/#80 na fila |
| Backlog | [#94–#99](https://github.com/RodReis/rrb-jarvisOS/issues/94) · MVP-008 | seis SPECs `aprovada-pi` (2026-08-29); atrás do MVP-006 na fila |
| Backlog | [#101–#106](https://github.com/RodReis/rrb-jarvisOS/issues/101) · MVP-009 | seis SPECs `aprovada-pi` (2026-08-29); fim da fila |
| Backlog | [#116–#120](https://github.com/RodReis/rrb-jarvisOS/issues/116) · MVP-010 | cinco SPECs `aprovada-pi`; depois do MVP-009 |
| Backlog | [#122–#126](https://github.com/RodReis/rrb-jarvisOS/issues/122) · MVP-011 | cinco SPECs `aprovada-pi`; depois do MVP-010 |
| Backlog | [#128–#132](https://github.com/RodReis/rrb-jarvisOS/issues/128) · MVP-012 | cinco SPECs `aprovada-pi`; depois do MVP-011 |
| Backlog | [#134–#138](https://github.com/RodReis/rrb-jarvisOS/issues/134) · MVP-013 | cinco SPECs `aprovada-pi`; depois do MVP-012 |
| Done | [#75](https://github.com/RodReis/rrb-jarvisOS/issues/75) · MVP-004 F02 Terminal | PR [#83](https://github.com/RodReis/rrb-jarvisOS/pull/83), aguardando aceite |
| Done | [#77](https://github.com/RodReis/rrb-jarvisOS/issues/77) · MVP-005 F01 Vault | PR [#108](https://github.com/RodReis/rrb-jarvisOS/pull/108), aguardando aceite |
| Done | [#107](https://github.com/RodReis/rrb-jarvisOS/issues/107) · `[FIX]` overlays em portal sem tokens | PR [#109](https://github.com/RodReis/rrb-jarvisOS/pull/109), aguardando aceite |
| Done | [#78](https://github.com/RodReis/rrb-jarvisOS/issues/78) · MVP-005 F02 Adapter Claude | PR desta entrega, aguardando aceite |
| Done | [#84](https://github.com/RodReis/rrb-jarvisOS/issues/84) · `[FIX]` card de aprovação descreve comando como filesystem | PR [#113](https://github.com/RodReis/rrb-jarvisOS/pull/113), aguardando aceite |
| A Fazer/Em Andamento | — | WIP = 0 |

> **M5-F01 entregue (2026-08-28) — abre o MVP-005.** Os 9 critérios cobertos; **679 testes verdes** (+38: 9 Regras, 20 Banco, 9 Tela). A garantia central é **estrutural**: nenhum tipo que atravessa o IPC tem campo onde o segredo caiba, e não existe método na ponte que o peça. Verificado no app real — o segredo semeado aparece **0 vezes** em `jarvis.db`/`-wal`/`-shm` enquanto `credential_ref` aparece 3 (prova de que a busca funciona); é a prova do **DPAPI real**, já que o teste de integração usa cifra dublada. `verifyAuditChain` → `{ok: true, checked: 95}`. Detalhe em `DEVELOPMENT.md`.
>
> **A verificação achou um defeito do design system, não da fatia** ([#107](https://github.com/RodReis/rrb-jarvisOS/issues/107)): overlays em portal renderizam **sem tokens** — modal transparente e ilegível. O `ProvedorDeTema` injeta as variáveis num `div`, o Radix monta o portal no `body`, fora dela. Atinge os 5 componentes com portal, é anterior a esta fatia. **Terceira repetição do mesmo método no projeto** (depois de #57/#58): jsdom não aplica folha de estilo, então componente visualmente quebrado passa verde.
>
> **#107 entregue (2026-08-28).** Cada `Portal` recebe o nó do provider como `container` — preserva os providers aninhados que a CHOICE e o Settings usam, o que promover os tokens a `:root` quebraria. A verificação no app real achou um **segundo defeito com a mesma causa raiz**, escondido pelo primeiro: o painel herdava a cor de texto do `FundoDaIdentidade`, que o portal não tem, e o título caía no preto do navegador. **684 testes** (+5) e **82 provas de navegador** (+5), todos provados por contrafactual. A régua nova é em duas camadas por necessidade: jsdom só afirma topologia, o valor computado só o navegador mede — que é exatamente o buraco pelo qual este defeito passou.

> **M5-F02 entregue (2026-08-29).** A IA passa a chamar de verdade. O que a fatia entrega de estrutural é o **ponto único de chamada** — a sede do gate de orçamento da F03 (ADR-001 q1); um segundo caminho até um adapter seria um caminho sem gate. O **isolamento do provider virou regra do ESLint** (barra `@anthropic-ai/*` em todo `src/main/` menos o adapter), provada por contrafactual. **732 testes** (+48) e 2 E2E novos; verificado no app real com Electron, com o log do app mostrando `correlationId`, `AuditEvent` e custo medido. A cobertura de Regras caiu para 75.5% por **diluição**, não regressão: `ai.ts` está a 100% ali, e o que cresceu (`preload`, `handlers`) é coberto por Banco e E2E.
>
> **#84 entregue (2026-08-29).** O card da fila descrevia **toda** pendência como filesystem — uma execução de processo aparecia como "Filesystem: comando", sem binário, argumentos ou cwd, e o usuário aprovava às cegas. A correção **não inventa discriminante**: reusa o `operation.kind` que o handler de `approval:resolve` já usava para rotear a decisão entre os dois motores — o dado existia, só a apresentação o ignorava. **735 testes** (+3, todos de Tela), provados por contrafactual, e o ramo de filesystem intacto. Verificado no app real: o card lê "Executar comando: node --force" com o cwd no escopo, e **Aprovar continua executando** (`verifyAuditChain` → `{ok: true, checked: 125}`). O achado que vale registrar é de método: o componente não tinha **nenhum** teste — o defeito não passou por asserção frouxa, passou por ausência de suíte.
>
> **Decisões do PI (2026-08-29):** três modelos na tabela de preço (Opus 5, Sonnet 5, Haiku 4.5) para dar spread à F03 e à F04; **SDK oficial** `@anthropic-ai/sdk` em vez de `fetch` cru; **painel mínimo** de teste no Settings — a tela de providers é F04, explicitamente.

## MVPs

| MVP | Issue | Estado | Progresso |
|---|---|---|---|
| MVP-001 Fundação | [#1](https://github.com/RodReis/rrb-jarvisOS/issues/1) | fechado/aceito | 6/6 |
| MVP-002 Execução local | [#9](https://github.com/RodReis/rrb-jarvisOS/issues/9) | fechado/aceito | 5/5 |
| MVP-003 Design System | [#16](https://github.com/RodReis/rrb-jarvisOS/issues/16) | fechado/aceito | 8/8 |
| MVP-004 Execução real | [#10](https://github.com/RodReis/rrb-jarvisOS/issues/10) | F01 aceita; F02 aguardando aceite; **F03 nova** (`aprovada-pi` 2026-08-29) | 1/3 |
| MVP-005 Providers/Vault/Budget | [#76](https://github.com/RodReis/rrb-jarvisOS/issues/76) | F01 e F02 entregues, aguardando aceite; duas SPECs no Backlog | 2/4 |
| MVP-006 Conectores Essenciais | [#86](https://github.com/RodReis/rrb-jarvisOS/issues/86) | seis SPECs `aprovada-pi` (2026-08-29); fatias no Backlog | 0/6 |
| MVP-007 Memória Contextual/RAG | [#179](https://github.com/RodReis/rrb-jarvisOS/issues/179) | F01 (#180) aprovada/Backlog; F02–F08 Planejadas, a redigir; sem implementação autorizada | 0/8 |
| MVP-008 Planejamento Governado | [#93](https://github.com/RodReis/rrb-jarvisOS/issues/93) | seis SPECs `aprovada-pi` (2026-08-29); fatias no Backlog | 0/6 |
| MVP-009 Entrega Autônoma | [#100](https://github.com/RodReis/rrb-jarvisOS/issues/100) | seis SPECs `aprovada-pi` (2026-08-29); fatias no Backlog | 0/6 |
| MVP-010 Multi-executor Claude + Codex | [#115](https://github.com/RodReis/rrb-jarvisOS/issues/115) | fatias [#116–#120](https://github.com/RodReis/rrb-jarvisOS/issues/116) no Backlog | 0/5 |
| MVP-011 Squads limitados | [#121](https://github.com/RodReis/rrb-jarvisOS/issues/121) | fatias [#122–#126](https://github.com/RodReis/rrb-jarvisOS/issues/122) no Backlog | 0/5 |
| MVP-012 Scheduler concorrente | [#127](https://github.com/RodReis/rrb-jarvisOS/issues/127) | fatias [#128–#132](https://github.com/RodReis/rrb-jarvisOS/issues/128) no Backlog | 0/5 |
| MVP-013 Execução contínua | [#133](https://github.com/RodReis/rrb-jarvisOS/issues/133) | fatias [#134–#138](https://github.com/RodReis/rrb-jarvisOS/issues/134) no Backlog | 0/5 |
| MVP-014 Release e Deploy Governado | [#149](https://github.com/RodReis/rrb-jarvisOS/issues/149) | cinco SPECs `aprovada-pi`; fatias #150–#154 em Backlog | 0/5 |
| MVP-015 Observabilidade Operacional | [#155](https://github.com/RodReis/rrb-jarvisOS/issues/155) | seis SPECs `aprovada-pi`; fatias #156–#161 em Backlog | 0/6 |
| MVP-016 Aprendizado Operacional da Pipeline | [#162](https://github.com/RodReis/rrb-jarvisOS/issues/162) | F01–F04 #163–#166 em Backlog; F05–F06 #167–#168 Planejadas, SPECs a redigir | 0/6 |
| MVP-017 Biblioteca de Blueprints | — | direção aprovada; sem fatias e sem SPEC | — |
| MVP-018 Gestão de Portfólio | — | direção aprovada; sem fatias e sem SPEC | — |

> **MVP-006 aprovado (2026-08-29).** As seis SPECs passaram pelo gate de perguntas abertas e viraram `aprovada-pi`. Sete decisões do PI: runtime de conectores **separado** do ponto único de IA do MVP-005; **ledger de créditos próprio** para conector, independente da `BudgetPolicy` em USD; **GitHub App do projeto** com `client_id` embutido e override em Settings; **emenda do Vault para OAuth** (payload estruturado, `expires_at`, rotação atômica) como escopo da M6-F03, sem reabrir a M5-F01; **roteamento Context7↔Tavily removido** da M6-F05 e transferido ao MVP-008; **UI mínima dentro de cada fatia**, sem fatia dedicada; **evidência extensa no diretório de artefatos do app**. A aprovação **não muda a fila** — a cabeça continua sendo a M5-F02 (#78).

> **MVP-008 aprovado (2026-08-29).** Seis decisões do PI: projeto nasce **sob `userData`** e criar projeto nunca amplia a allowlist; **Git é o `git` do sistema pelo terminal controlado do MVP-004**, sem segundo caminho de escrita fora do enforcement; **importar o próprio `rrb-jarvisOS`** é critério de aceite; a **rota de assinatura (Claude MAX via Claude Code) registra uso sem valor monetário** e a `BudgetPolicy` gateia só rota paga; o app **não chama Context7** — ele é do agente construtor no MVP-009; **anexos de design entram por seletor que copia e hasheia no ato**. Duas dependências duras ficaram registradas: a M8-F01 depende da M4-F02 (#75) e fica limitada ao diretório do app até existir a fatia de UI da allowlist. Emendas em `spec-providers-03` e `spec-providers-04`: rota de assinatura é `subscription_limited`. **A fila não mudou** — a cabeça continua sendo a M5-F02 (#78).

> **Pipeline V2 aprovada e publicada (2026-08-29).** Arquitetura, quatro MVPs e vinte SPECs receberam `aprovada-pi`. Épicos #115/#121/#127/#133 e fatias #116–#120/#122–#126/#128–#132/#134–#138 foram criados com parents e bloqueios nativos na ordem de implementação. Isso adiciona backlog futuro sem furar a fila corrente. A V2 termina no merge do DAG aprovado; deploy permanece fora. Fonte: `docs/superpowers/specs/2026-08-29-pipeline-desenvolvimento-ia-v2-design.md`.

> **Pipeline V3 publicada e em especificação (2026-08-30).** MVP-014 (#149), MVP-015 (#155) e MVP-016 (#162) possuem 17 sub-issues com dependências nativas. Quinze fatias aprovadas estão em Backlog; M16-F05–F06 permanecem Planejadas. Nenhuma nova issue recebeu `next`. Detalhe e reconciliação: `docs/STATUS-ARQUIVO.md`.

> **MVP-016 em especificação (2026-08-30).** M16-F01–F04 (#163–#166) estão `aprovada-pi`, em Backlog; F05–F06 (#167–#168) aguardam redação. A F06 mantém gate visual. Fonte: `docs/superpowers/specs/2026-08-29-mvp-016-aprendizado-operacional-design.md`.

> **MVP-007 publicado e em detalhamento (2026-08-30).** Épico #179 e oito fatias #180–#187. M7-F01 (#180) está `aprovada-pi`, em Backlog, revisão `83e952f`; F02–F08 permanecem Planejadas, a redigir. Próxima SPEC: M7-F02 (#181). Aceite documental não inicia implementação; pipeline não depende da memória. Fonte: `docs/superpowers/specs/2026-08-30-mvp-007-memoria-compartilhada-design.md`.

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
| M7-F01 | MVP-007 | Núcleo, identidade e persistência ([#180](https://github.com/RodReis/rrb-jarvisOS/issues/180)) | `spec-memoria-01-nucleo-identidade-persistencia.md` — aprovada-pi |
| M7-F02 | MVP-007 | Fontes iniciais, ingestão e retomada ([#181](https://github.com/RodReis/rrb-jarvisOS/issues/181)) | a redigir |
| M7-F03 | MVP-007 | Recuperação contextual e orçamento ([#182](https://github.com/RodReis/rrb-jarvisOS/issues/182)) | a redigir |
| M7-F04 | MVP-007 | Retenção e reconstrução da memória ([#183](https://github.com/RodReis/rrb-jarvisOS/issues/183)) | a redigir |
| M7-F05 | MVP-007 | Adapter opcional do Graphify ([#184](https://github.com/RodReis/rrb-jarvisOS/issues/184)) | a redigir |
| M7-F06 | MVP-007 | Memória operacional e validação de lições ([#185](https://github.com/RodReis/rrb-jarvisOS/issues/185)) | a redigir |
| M7-F07 | MVP-007 | Agent Memory e Notebook ([#186](https://github.com/RodReis/rrb-jarvisOS/issues/186)) | a redigir |
| M7-F08 | MVP-007 | Resiliência e prova integrada ([#187](https://github.com/RodReis/rrb-jarvisOS/issues/187)) | a redigir |
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
| M10-F01 | MVP-010 | Runtime de executores ([#116](https://github.com/RodReis/rrb-jarvisOS/issues/116)) | `spec-multi-executor-01-runtime.md` |
| M10-F02 | MVP-010 | Autenticação Codex ([#117](https://github.com/RodReis/rrb-jarvisOS/issues/117)) | `spec-multi-executor-02-autenticacao-codex.md` |
| M10-F03 | MVP-010 | Codex Exec Adapter ([#118](https://github.com/RodReis/rrb-jarvisOS/issues/118)) | `spec-multi-executor-03-codex-exec-adapter.md` |
| M10-F04 | MVP-010 | Roteamento e revisão cruzada ([#119](https://github.com/RodReis/rrb-jarvisOS/issues/119)) | `spec-multi-executor-04-roteamento-revisao-cruzada.md` |
| M10-F05 | MVP-010 | UI e prova operacional ([#120](https://github.com/RodReis/rrb-jarvisOS/issues/120)) | `spec-multi-executor-05-ui-prova-operacional.md` |
| M11-F01 | MVP-011 | Capacidades e perfis ([#122](https://github.com/RodReis/rrb-jarvisOS/issues/122)) | `spec-squads-01-capacidades-perfis.md` |
| M11-F02 | MVP-011 | Planejador e validador ([#123](https://github.com/RodReis/rrb-jarvisOS/issues/123)) | `spec-squads-02-planejador-validador.md` |
| M11-F03 | MVP-011 | Workers isolados ([#124](https://github.com/RodReis/rrb-jarvisOS/issues/124)) | `spec-squads-03-workers-isolados.md` |
| M11-F04 | MVP-011 | Revisão independente ([#125](https://github.com/RodReis/rrb-jarvisOS/issues/125)) | `spec-squads-04-revisao-independente.md` |
| M11-F05 | MVP-011 | Orçamento, cancelamento e E2E ([#126](https://github.com/RodReis/rrb-jarvisOS/issues/126)) | `spec-squads-05-orcamento-cancelamento-e2e.md` |
| M12-F01 | MVP-012 | Pool global e fila ([#128](https://github.com/RodReis/rrb-jarvisOS/issues/128)) | `spec-scheduler-01-pool-fila.md` |
| M12-F02 | MVP-012 | Independência e locks ([#129](https://github.com/RodReis/rrb-jarvisOS/issues/129)) | `spec-scheduler-02-independencia-locks.md` |
| M12-F03 | MVP-012 | Isolamento concorrente ([#130](https://github.com/RodReis/rrb-jarvisOS/issues/130)) | `spec-scheduler-03-isolamento-concorrente.md` |
| M12-F04 | MVP-012 | Merge serializado ([#131](https://github.com/RodReis/rrb-jarvisOS/issues/131)) | `spec-scheduler-04-merge-serializado.md` |
| M12-F05 | MVP-012 | Recuperação e E2E ([#132](https://github.com/RodReis/rrb-jarvisOS/issues/132)) | `spec-scheduler-05-recuperacao-e2e.md` |
| M13-F01 | MVP-013 | Inventário e DAG ([#134](https://github.com/RodReis/rrb-jarvisOS/issues/134)) | `spec-continuo-01-inventario-dag.md` |
| M13-F02 | MVP-013 | Dispatcher e retomada ([#135](https://github.com/RodReis/rrb-jarvisOS/issues/135)) | `spec-continuo-02-dispatcher-retomada.md` |
| M13-F03 | MVP-013 | Controles operacionais ([#136](https://github.com/RodReis/rrb-jarvisOS/issues/136)) | `spec-continuo-03-controles-operacionais.md` |
| M13-F04 | MVP-013 | Projeções e gates ([#137](https://github.com/RodReis/rrb-jarvisOS/issues/137)) | `spec-continuo-04-projecoes-gates.md` |
| M13-F05 | MVP-013 | Jornada multi-MVP ([#138](https://github.com/RodReis/rrb-jarvisOS/issues/138)) | `spec-continuo-05-jornada-multi-mvp.md` |
| M14-F01 | MVP-014 | Núcleo de release e fila ([#150](https://github.com/RodReis/rrb-jarvisOS/issues/150)) | `spec-release-01-nucleo-estados-fila.md` |
| M14-F02 | MVP-014 | Docker, artefatos e configuração ([#151](https://github.com/RodReis/rrb-jarvisOS/issues/151)) | `spec-release-02-compose-artefatos-config.md` |
| M14-F03 | MVP-014 | Preview isolado por PR ([#152](https://github.com/RodReis/rrb-jarvisOS/issues/152)) | `spec-release-03-preview-isolado.md` |
| M14-F04 | MVP-014 | Staging e Produção automática ([#153](https://github.com/RodReis/rrb-jarvisOS/issues/153)) | `spec-release-04-staging-producao.md` |
| M14-F05 | MVP-014 | Compensação, retorno à V2 e E2E ([#154](https://github.com/RodReis/rrb-jarvisOS/issues/154)) | `spec-release-05-recuperacao-e2e.md` |
| M15-F01 | MVP-015 | Núcleo de eventos, outbox e projeções ([#156](https://github.com/RodReis/rrb-jarvisOS/issues/156)) | `spec-observabilidade-01-eventos-outbox-projecoes.md` |
| M15-F02 | MVP-015 | Reconciliação, saúde, custos e quotas ([#157](https://github.com/RodReis/rrb-jarvisOS/issues/157)) | `spec-observabilidade-02-reconciliacao-saude-custos-quotas.md` |
| M15-F03 | MVP-015 | Alertas e notificações ([#158](https://github.com/RodReis/rrb-jarvisOS/issues/158)) | `spec-observabilidade-03-alertas-notificacoes.md` |
| M15-F04 | MVP-015 | Consultas, retenção, rollups e CLI ([#159](https://github.com/RodReis/rrb-jarvisOS/issues/159)) | `spec-observabilidade-04-consultas-retencao-cli.md` |
| M15-F05 | MVP-015 | Console operacional ([#160](https://github.com/RodReis/rrb-jarvisOS/issues/160)) | `spec-observabilidade-05-console-operacional.md` |
| M15-F06 | MVP-015 | Resiliência, desempenho e prova E2E ([#161](https://github.com/RodReis/rrb-jarvisOS/issues/161)) | `spec-observabilidade-06-resiliencia-desempenho-e2e.md` |
| M16-F01 | MVP-016 | Fundação e ingestão ([#163](https://github.com/RodReis/rrb-jarvisOS/issues/163)) | `spec-aprendizado-01-fundacao-ingestao.md` |
| M16-F02 | MVP-016 | Memória de falhas ([#164](https://github.com/RodReis/rrb-jarvisOS/issues/164)) | `spec-aprendizado-02-memoria-falhas.md` |
| M16-F03 | MVP-016 | Registro e resolução de políticas ([#165](https://github.com/RodReis/rrb-jarvisOS/issues/165)) | `spec-aprendizado-03-registro-resolucao-politicas.md` |
| M16-F04 | MVP-016 | Experimentos e promoção ([#166](https://github.com/RodReis/rrb-jarvisOS/issues/166)) | `spec-aprendizado-04-experimentos-promocao.md` |
| M16-F05 | MVP-016 | Estratégias e recomendações assistidas ([#167](https://github.com/RodReis/rrb-jarvisOS/issues/167)) | a redigir |
| M16-F06 | MVP-016 | Interface, resiliência e prova E2E ([#168](https://github.com/RodReis/rrb-jarvisOS/issues/168)) | a redigir |

## Próximas ações

1. PI aceitar ou recusar as **quatro** fatias em **Done**: F02 do MVP-004 (#75), M5-F01 (#77), o `[FIX]` #107 e a M5-F02 (#78).
2. Fila corrente: **#110** (UI da allowlist) é o `next`. Depois dele, a ordem entre #79 (BudgetPolicy) e #80 (Multi-provider) é decisão do PI — as duas têm spec aprovada.
3. A **F03 encaixa no ponto único** que a F02 deixou pronto: a estimativa pré-chamada já é calculada e o `CostEvent` já carrega `estimadoUsd`/`realUsd`. O gate entra entre a estimativa e o disparo do adapter — nenhuma refatoração do ponto de chamada é necessária.
4. **Conferência documental (2026-08-30):** existem 81 SPECs com status `aprovada-pi` no acervo local, incluindo a M16-F04 e a M7-F01. Contagem por cabeçalho normalizado; quinze fatias dos MVPs 014–016 estão em Backlog.
5. MVP-007 publicado: épico #179; M7-F01 (#180) aprovada/Backlog, F02–F08 (#181–#187) Planejadas. Próxima SPEC: M7-F02 (#181), fontes iniciais, ingestão e retomada. Nenhuma implementação iniciada. MVP-017–MVP-018 ainda serão detalhados. O MVP-016 possui design, seis fatias e M16-F01–F04 aprovados; F05–F06 aguardam redação nas #167–#168, que permanecem Planejadas.
6. **M4-F03 (UI da allowlist de diretórios) especificada e aprovada (2026-08-29)** — fechou a última fatia conhecida sem SPEC antes da V3. As cinco SPECs do MVP-014 também foram aprovadas e publicadas nas issues #150–#154.
7. **Docker virou dependência dura do MVP-009** (sandbox do executor). Confirmar que a máquina de execução tem Docker antes daquele MVP entrar na fila.
8. **Pipeline V2 publicada:** épicos #115/#121/#127/#133 e 20 fatias #116–#138, com os intervalos de épicos excluídos, estão no Backlog com sub-issues e dependências nativas. A publicação não altera o `next` atual.
9. **Pipeline V3 publicada:** épicos #149/#155/#162 e 17 fatias, com parents e dependências reconciliados. Próxima SPEC da V3: M16-F05 (#167); fronteira com MVP-007 definida, sem ampliar sua fatia. O detalhamento da memória compartilhada segue em paralelo no planejamento. M15-F05 (#160) e M16-F06 (#168) mantêm `DESIGN-SYSTEM.md` e protótipos HTML antes da construção.

## Roadmap

MVP-001 ✅ → MVP-002 ✅ → MVP-003 ✅ → MVP-004 → MVP-005 → MVP-006 → MVP-008 → MVP-009 → MVP-010 → MVP-011 → MVP-012 → MVP-013 → MVP-014 → MVP-015 → MVP-016. MVP-007 é paralelo/não bloqueante; MVP-014–015 e M16-F01–F04 estão em Backlog, aguardando dependências e fila; M16-F05–F06 estão Planejadas. MVP-017–MVP-018 têm apenas direção aprovada.
