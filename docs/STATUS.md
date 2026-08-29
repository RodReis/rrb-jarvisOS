# STATUS.md — Kanban / Roadmap

Atualizado em: **2026-08-28**. Visão curta do estado corrente e fonte única do índice Fatia ↔ SPEC. Histórico e ressalvas: `docs/STATUS-ARQUIVO.md`. O board GitHub vence em caso de divergência factual.

## Agora

| Coluna | Item | Estado |
|---|---|---|
| Próximo | [#84](https://github.com/RodReis/rrb-jarvisOS/issues/84) · `[FIX]` card de aprovação descreve comando como filesystem | `proplan:next` |
| Backlog | [#107](https://github.com/RodReis/rrb-jarvisOS/issues/107) · `[FIX]` overlays em portal renderizam sem tokens | achado na verificação da M5-F01; atinge **todo overlay do app** |
| Backlog | [#78](https://github.com/RodReis/rrb-jarvisOS/issues/78) · Adapter Claude | aprovado, aguardando fila |
| Backlog | [#79](https://github.com/RodReis/rrb-jarvisOS/issues/79) · BudgetPolicy | aprovado, aguardando fila |
| Backlog | [#80](https://github.com/RodReis/rrb-jarvisOS/issues/80) · Multi-provider | aprovado, aguardando fila |
| Done | [#75](https://github.com/RodReis/rrb-jarvisOS/issues/75) · MVP-004 F02 Terminal | PR [#83](https://github.com/RodReis/rrb-jarvisOS/pull/83), aguardando aceite |
| Done | [#77](https://github.com/RodReis/rrb-jarvisOS/issues/77) · MVP-005 F01 Vault | PR desta entrega, aguardando aceite |
| A Fazer/Em Andamento | — | WIP = 0 |

> **M5-F01 entregue (2026-08-28) — abre o MVP-005.** Os 9 critérios cobertos; **679 testes verdes** (+38: 9 Regras, 20 Banco, 9 Tela). A garantia central é **estrutural**: nenhum tipo que atravessa o IPC tem campo onde o segredo caiba, e não existe método na ponte que o peça. Verificado no app real — o segredo semeado aparece **0 vezes** em `jarvis.db`/`-wal`/`-shm` enquanto `credential_ref` aparece 3 (prova de que a busca funciona); é a prova do **DPAPI real**, já que o teste de integração usa cifra dublada. `verifyAuditChain` → `{ok: true, checked: 95}`. Detalhe em `DEVELOPMENT.md`.
>
> **A verificação achou um defeito do design system, não da fatia** ([#107](https://github.com/RodReis/rrb-jarvisOS/issues/107)): overlays em portal renderizam **sem tokens** — modal transparente e ilegível. O `ProvedorDeTema` injeta as variáveis num `div`, o Radix monta o portal no `body`, fora dela. Atinge os 5 componentes com portal, é anterior a esta fatia. **Terceira repetição do mesmo método no projeto** (depois de #57/#58): jsdom não aplica folha de estilo, então componente visualmente quebrado passa verde.

## MVPs

| MVP | Issue | Estado | Progresso |
|---|---|---|---|
| MVP-001 Fundação | [#1](https://github.com/RodReis/rrb-jarvisOS/issues/1) | fechado/aceito | 6/6 |
| MVP-002 Execução local | [#9](https://github.com/RodReis/rrb-jarvisOS/issues/9) | fechado/aceito | 5/5 |
| MVP-003 Design System | [#16](https://github.com/RodReis/rrb-jarvisOS/issues/16) | fechado/aceito | 8/8 |
| MVP-004 Execução real | [#10](https://github.com/RodReis/rrb-jarvisOS/issues/10) | F01 aceita; F02 aguardando aceite | 1/2 |
| MVP-005 Providers/Vault/Budget | [#76](https://github.com/RodReis/rrb-jarvisOS/issues/76) | F01 entregue, aguardando aceite; três SPECs no Backlog | 1/4 |
| MVP-006 Conectores Essenciais | — | seis SPECs em revisão; sem autorização/issues | — |
| MVP-007 Memória Contextual/RAG | — | slot proposto; não bloqueante | — |
| MVP-008 Planejamento Governado | — | seis SPECs em revisão; sem autorização/issues | — |
| MVP-009 Entrega Autônoma | — | seis SPECs em revisão; sem autorização/issues | — |

## Índice Fatia ↔ SPEC

Não existe catálogo global `SPEC-nnn`. O identificador canônico é o slug abaixo; não inventar números.

| Índice | MVP | Fatia | SPEC |
|---|---|---|---|
| F01–F06 | MVP-001 | Bootstrap · AppShell · Auth · Dados · Settings · Observabilidade | `spec-fundacao-01..06` |
| M2-F01–F05 | MVP-002 | Supabase · Policy · Allowlist · Workflows · Simulação | `spec-execucao-local-01..05` |
| M3-F01–F06 | MVP-003 | Infra · Foundations · Componentes a/b · AppShell a/b · Identidades · Hardening | `spec-design-system-01..06` |
| M4-F01 | MVP-004 | Filesystem allowlisted | `spec-execucao-real-01-filesystem-allowlisted.md` |
| M4-F02 | MVP-004 | Terminal controlado | `spec-execucao-real-02-terminal-controlado.md` |
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

1. PI aceitar ou recusar as duas fatias em **Done**: F02 do MVP-004 (#75) e M5-F01 (#77).
2. Decidir a ordem da fila: os dois `[FIX]` de UI (#84 e #107) antes da M5-F02 (#78), ou o MVP-005 seguindo direto. O **#107 é o mais amplo** — atinge todo overlay do app, não uma tela.
3. Decidir sobre a **UI da allowlist de diretórios** (pendência registrada na F02 do MVP-004): é fatia, precisa de spec — sem ela o usuário não consegue permitir diretório pelo app.
4. Revisar documentalmente as SPECs dos MVPs 006/008/009 já com issues abertas (#86–#106); implementação só após autorização explícita do PI.
5. MVP-007 será detalhado apenas quando entrar no planejamento ativo.

## Roadmap

MVP-001 ✅ → MVP-002 ✅ → MVP-003 ✅ → MVP-004 → MVP-005 → MVP-006 → MVP-008 → MVP-009. MVP-007 é paralelo/não bloqueante.
