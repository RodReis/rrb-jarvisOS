# STATUS.md — Kanban / Roadmap

Atualizado em: **2026-08-29**. Visão curta do estado corrente e fonte única do índice Fatia ↔ SPEC. Histórico e ressalvas: `docs/STATUS-ARQUIVO.md`. O board GitHub vence em caso de divergência factual.

## Agora

| Coluna | Item | Estado |
|---|---|---|
| Próximo | [#78](https://github.com/RodReis/rrb-jarvisOS/issues/78) · M5-F02 Adapter Claude | `proplan:next` |
| Backlog | [#110](https://github.com/RodReis/rrb-jarvisOS/issues/110) · M4-F03 UI da allowlist de diretórios | `aprovada-pi` 2026-08-29; desbloqueia MVP-004 e M8-F01 |
| Backlog | [#84](https://github.com/RodReis/rrb-jarvisOS/issues/84) · `[FIX]` card de aprovação descreve comando como filesystem | despriorizado pelo PI em favor do #107 |
| Backlog | [#79](https://github.com/RodReis/rrb-jarvisOS/issues/79) · BudgetPolicy | aprovado, aguardando fila |
| Backlog | [#80](https://github.com/RodReis/rrb-jarvisOS/issues/80) · Multi-provider | aprovado, aguardando fila |
| Backlog | [#87–#92](https://github.com/RodReis/rrb-jarvisOS/issues/87) · MVP-006 | seis SPECs `aprovada-pi` (2026-08-29); atrás de #79/#80 na fila |
| Backlog | [#94–#99](https://github.com/RodReis/rrb-jarvisOS/issues/94) · MVP-008 | seis SPECs `aprovada-pi` (2026-08-29); atrás do MVP-006 na fila |
| Backlog | [#101–#106](https://github.com/RodReis/rrb-jarvisOS/issues/101) · MVP-009 | seis SPECs `aprovada-pi` (2026-08-29); fim da fila |
| Done | [#75](https://github.com/RodReis/rrb-jarvisOS/issues/75) · MVP-004 F02 Terminal | PR [#83](https://github.com/RodReis/rrb-jarvisOS/pull/83), aguardando aceite |
| Done | [#77](https://github.com/RodReis/rrb-jarvisOS/issues/77) · MVP-005 F01 Vault | PR [#108](https://github.com/RodReis/rrb-jarvisOS/pull/108), aguardando aceite |
| Done | [#107](https://github.com/RodReis/rrb-jarvisOS/issues/107) · `[FIX]` overlays em portal sem tokens | PR desta entrega, aguardando aceite |
| A Fazer/Em Andamento | — | WIP = 0 |

> **M5-F01 entregue (2026-08-28) — abre o MVP-005.** Os 9 critérios cobertos; **679 testes verdes** (+38: 9 Regras, 20 Banco, 9 Tela). A garantia central é **estrutural**: nenhum tipo que atravessa o IPC tem campo onde o segredo caiba, e não existe método na ponte que o peça. Verificado no app real — o segredo semeado aparece **0 vezes** em `jarvis.db`/`-wal`/`-shm` enquanto `credential_ref` aparece 3 (prova de que a busca funciona); é a prova do **DPAPI real**, já que o teste de integração usa cifra dublada. `verifyAuditChain` → `{ok: true, checked: 95}`. Detalhe em `DEVELOPMENT.md`.
>
> **A verificação achou um defeito do design system, não da fatia** ([#107](https://github.com/RodReis/rrb-jarvisOS/issues/107)): overlays em portal renderizam **sem tokens** — modal transparente e ilegível. O `ProvedorDeTema` injeta as variáveis num `div`, o Radix monta o portal no `body`, fora dela. Atinge os 5 componentes com portal, é anterior a esta fatia. **Terceira repetição do mesmo método no projeto** (depois de #57/#58): jsdom não aplica folha de estilo, então componente visualmente quebrado passa verde.
>
> **#107 entregue (2026-08-28).** Cada `Portal` recebe o nó do provider como `container` — preserva os providers aninhados que a CHOICE e o Settings usam, o que promover os tokens a `:root` quebraria. A verificação no app real achou um **segundo defeito com a mesma causa raiz**, escondido pelo primeiro: o painel herdava a cor de texto do `FundoDaIdentidade`, que o portal não tem, e o título caía no preto do navegador. **684 testes** (+5) e **82 provas de navegador** (+5), todos provados por contrafactual. A régua nova é em duas camadas por necessidade: jsdom só afirma topologia, o valor computado só o navegador mede — que é exatamente o buraco pelo qual este defeito passou.

## MVPs

| MVP | Issue | Estado | Progresso |
|---|---|---|---|
| MVP-001 Fundação | [#1](https://github.com/RodReis/rrb-jarvisOS/issues/1) | fechado/aceito | 6/6 |
| MVP-002 Execução local | [#9](https://github.com/RodReis/rrb-jarvisOS/issues/9) | fechado/aceito | 5/5 |
| MVP-003 Design System | [#16](https://github.com/RodReis/rrb-jarvisOS/issues/16) | fechado/aceito | 8/8 |
| MVP-004 Execução real | [#10](https://github.com/RodReis/rrb-jarvisOS/issues/10) | F01 aceita; F02 aguardando aceite; **F03 nova** (`aprovada-pi` 2026-08-29) | 1/3 |
| MVP-005 Providers/Vault/Budget | [#76](https://github.com/RodReis/rrb-jarvisOS/issues/76) | F01 entregue, aguardando aceite; três SPECs no Backlog | 1/4 |
| MVP-006 Conectores Essenciais | [#86](https://github.com/RodReis/rrb-jarvisOS/issues/86) | seis SPECs `aprovada-pi` (2026-08-29); fatias no Backlog | 0/6 |
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

1. PI aceitar ou recusar as três fatias em **Done**: F02 do MVP-004 (#75), M5-F01 (#77) e o `[FIX]` #107.
2. Ordem da fila **decidida pelo PI (2026-08-28)**: #107 primeiro (entregue), depois a M5-F02 (#78). O #84 volta ao Backlog e reentra depois.
3. **MVP-006, MVP-008 e MVP-009 revisados e aprovados (2026-08-29)** — dezesseis decisões estruturais do PI registradas nas SPECs e nos docs dos épicos; #87–#92, #94–#99 e #101–#106 migraram para `proplan:backlog`. **Todas as SPECs do projeto estão `aprovada-pi`.**
4. MVP-007 será detalhado apenas quando entrar no planejamento ativo — hoje não tem fatia nem SPEC, então não há o que aprovar.
5. **M4-F03 (UI da allowlist de diretórios) especificada e aprovada (2026-08-29)** — fecha a última fatia conhecida sem SPEC. Desbloqueia uso real do terminal/filesystem pelo app e tira o limite da M8-F01. Não existe mais fatia conhecida sem spec.
6. **Docker virou dependência dura do MVP-009** (sandbox do executor). Confirmar que a máquina de execução tem Docker antes daquele MVP entrar na fila.

## Roadmap

MVP-001 ✅ → MVP-002 ✅ → MVP-003 ✅ → MVP-004 → MVP-005 → MVP-006 → MVP-008 → MVP-009. MVP-007 é paralelo/não bloqueante.
