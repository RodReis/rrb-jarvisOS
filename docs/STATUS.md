# STATUS.md — Kanban / Roadmap

Atualizado em: **2026-07-21**. Mantido pelo Code a cada entrega (junto com `DEVELOPMENT.md`). Este arquivo espelha o board das GitHub Issues (`proplan:*`) — se divergirem, as **Issues vencem** e este arquivo deve ser corrigido.

## Board

### Backlog (`proplan:backlog` — spec `aprovada-pi`, aguardando fila)

| Issue | Fatia | MVP | Spec | Índice |
|---|---|---|---|---|
| [#2](https://github.com/RodReis/rrb-jarvisOS/issues/2) | 01 Bootstrap e estrutura | MVP-001 (#1) | `spec-fundacao-01-bootstrap.md` | F01 |
| [#3](https://github.com/RodReis/rrb-jarvisOS/issues/3) | 02 AppShell e WorkspaceSwitcher | MVP-001 (#1) | `spec-fundacao-02-appshell-workspaces.md` | F02 |
| [#4](https://github.com/RodReis/rrb-jarvisOS/issues/4) | 03 Auth Google local-first | MVP-001 (#1) | `spec-fundacao-03-auth-google.md` | F03 |
| [#5](https://github.com/RodReis/rrb-jarvisOS/issues/5) | 04 Dados mínimos + AuditEvent | MVP-001 (#1) | `spec-fundacao-04-dados-audit.md` | F04 |
| [#6](https://github.com/RodReis/rrb-jarvisOS/issues/6) | 05 Settings mínimo | MVP-001 (#1) | `spec-fundacao-05-settings.md` | F05 |
| [#8](https://github.com/RodReis/rrb-jarvisOS/issues/8) | 06 Observabilidade e Logging | MVP-001 (#1) | `spec-fundacao-06-observabilidade-logging.md` | F06 |
| [#11](https://github.com/RodReis/rrb-jarvisOS/issues/11) | 02 Policy Engine mínimo (classificação) | MVP-002 (#9) | `spec-execucao-local-02-policy-engine.md` | M2-F02 |
| [#12](https://github.com/RodReis/rrb-jarvisOS/issues/12) | 03 Diretórios permitidos (allowlist) | MVP-002 (#9) | `spec-execucao-local-03-allowlist-diretorios.md` | M2-F03 |
| [#13](https://github.com/RodReis/rrb-jarvisOS/issues/13) | 04 Registro de workflows + automações | MVP-002 (#9) | `spec-execucao-local-04-registro-workflows.md` | M2-F04 |
| [#14](https://github.com/RodReis/rrb-jarvisOS/issues/14) | 05 Motor de execução simulado | MVP-002 (#9) | `spec-execucao-local-05-execucao-simulada.md` | M2-F05 |
| [#15](https://github.com/RodReis/rrb-jarvisOS/issues/15) | 01 Supabase local + ambiente de sync | MVP-002 (#9) | `spec-execucao-local-01-supabase-local.md` | M2-F01 |

> A Fatia 06 saiu como **#8** (o número 7 já estava ocupado). Sub-issue do épico #1; label `proplan:backlog`, assignee PI.

### A Fazer · Em Andamento · Feito · Finalizado

*(vazios — nenhuma fatia iniciada ainda)*

### Índice Fatia ↔ SPEC (fonte única do par MVP↔SPEC↔Fatia)

Não há catálogo numérico `SPEC-nnn` para o MVP-001: as specs são identificadas por slug (`SPEC-Fundacao-01..06`) e mapeiam 1:1 para a fatia (F01↔spec-01, …, F06↔spec-06). Por isso os títulos das issues usam `[MVP1][Fnn]` sem token `[SPEC-nnn]` (regra de ouro: não inventar número). **Pendência ao PI:** decidir se o projeto adota numeração `SPEC-nnn` — se sim, atribuir os números aqui e ajustar os títulos.

## MVPs

| MVP | Issue | Estado | Fatias fechadas |
|---|---|---|---|
| MVP-001 Fundação | [#1](https://github.com/RodReis/rrb-jarvisOS/issues/1) | épico criado (`proplan:mvp`); 6 fatias-filhas em Backlog (#2–#6, #8) | 0 / 6 |
| MVP-002 Execução local controlada (fundação) | [#9](https://github.com/RodReis/rrb-jarvisOS/issues/9) | épico criado; 5 fatias previstas, **lazy** (sem spec ainda) | 0 / 5 |
| MVP-003 Execução real (terminal + execução allowlisted) | [#10](https://github.com/RodReis/rrb-jarvisOS/issues/10) | épico criado; 2 fatias previstas, **lazy** | 0 / 2 |
| MVP-providers (Corte 3) | — | planejado; incluirá **BudgetPolicy** (modelo decidido no ADR-001 #1) + providers/conectores/RAG | — |

## Próximas ações

1. **Code**: mover a Fatia 01 (#2) para A Fazer → Em Andamento e iniciar; WIP = 1. Ordem de execução: 01 → 06 (#8) → 02/04 → 03 → 05.
2. **PI**: (opcional) decidir a adoção de numeração `SPEC-nnn`.
3. **PI**: aceitar cada fatia (fechar issue + `proplan:finalizado`) só após PR mergeado.

## Roadmap macro

MVP-001 Fundação → Execução local controlada → Integrações reais → Voz e automação → Offline/multiplataforma. Detalhe em `docs/LANDSCAPE.md`.
