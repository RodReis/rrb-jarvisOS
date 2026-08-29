# STATUS.md — Kanban / Roadmap

Atualizado em: **2026-08-28**. Visão curta do estado corrente e fonte única do índice Fatia ↔ SPEC. Histórico e ressalvas: `docs/STATUS-ARQUIVO.md`. O board GitHub vence em caso de divergência factual.

## Agora

| Coluna | Item | Estado |
|---|---|---|
| Próximo | [#77](https://github.com/RodReis/rrb-jarvisOS/issues/77) · MVP-005 F01 Vault | `proplan:next` |
| Backlog | [#78](https://github.com/RodReis/rrb-jarvisOS/issues/78) · Adapter Claude | aprovado, aguardando fila |
| Backlog | [#79](https://github.com/RodReis/rrb-jarvisOS/issues/79) · BudgetPolicy | aprovado, aguardando fila |
| Backlog | [#80](https://github.com/RodReis/rrb-jarvisOS/issues/80) · Multi-provider | aprovado, aguardando fila |
| Done | [#75](https://github.com/RodReis/rrb-jarvisOS/issues/75) · MVP-004 F02 Terminal | PR [#83](https://github.com/RodReis/rrb-jarvisOS/pull/83), aguardando aceite |
| A Fazer/Em Andamento | — | WIP = 0 |

## MVPs

| MVP | Issue | Estado | Progresso |
|---|---|---|---|
| MVP-001 Fundação | [#1](https://github.com/RodReis/rrb-jarvisOS/issues/1) | fechado/aceito | 6/6 |
| MVP-002 Execução local | [#9](https://github.com/RodReis/rrb-jarvisOS/issues/9) | fechado/aceito | 5/5 |
| MVP-003 Design System | [#16](https://github.com/RodReis/rrb-jarvisOS/issues/16) | fechado/aceito | 8/8 |
| MVP-004 Execução real | [#10](https://github.com/RodReis/rrb-jarvisOS/issues/10) | F01 aceita; F02 aguardando aceite | 1/2 |
| MVP-005 Providers/Vault/Budget | [#76](https://github.com/RodReis/rrb-jarvisOS/issues/76) | quatro SPECs aprovadas; Backlog | 0/4 |
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

1. PI aceitar ou recusar a F02 do MVP-004 (#75).
2. Fila técnica permanece na M5-F01 (#77); esta sessão não autoriza sua implementação.
3. Revisar documentalmente as 18 SPECs dos MVPs 006/008/009; issues só nascem após aprovação explícita da respectiva SPEC.
4. MVP-007 será detalhado apenas quando entrar no planejamento ativo.

## Roadmap

MVP-001 ✅ → MVP-002 ✅ → MVP-003 ✅ → MVP-004 → MVP-005 → MVP-006 → MVP-008 → MVP-009. MVP-007 é paralelo/não bloqueante.
