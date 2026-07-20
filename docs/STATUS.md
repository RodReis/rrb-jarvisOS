# STATUS.md — Kanban / Roadmap

Atualizado em: **2026-07-19**. Mantido pelo Code a cada entrega (junto com `DEVELOPMENT.md`). Este arquivo espelha o board das GitHub Issues (`proplan:*`) — se divergirem, as **Issues vencem** e este arquivo deve ser corrigido.

## Board

### Pré-backlog (spec em rascunho — ainda não são issues)

| Fatia | MVP | Spec | Bloqueio |
|---|---|---|---|
| 01 Bootstrap e estrutura | MVP-001 | `spec-fundacao-01-bootstrap.md` | 2 perguntas abertas ao PI |
| 02 AppShell e WorkspaceSwitcher | MVP-001 | `spec-fundacao-02-appshell-workspaces.md` | 2 perguntas abertas ao PI |
| 03 Auth Google local-first | MVP-001 | `spec-fundacao-03-auth-google.md` | 2 perguntas abertas ao PI (incl. duração da sessão offline) |
| 04 Dados mínimos + AuditEvent | MVP-001 | `spec-fundacao-04-dados-audit.md` | 2 perguntas abertas ao PI (incl. SQLite vs JSON) |
| 05 Settings mínimo | MVP-001 | `spec-fundacao-05-settings.md` | 1 pergunta aberta ao PI (i18n) |

### Backlog · A Fazer · Em Andamento · Feito · Finalizado

*(vazios — nenhuma issue de fatia criada ainda; nenhuma spec `aprovada-pi`)*

## MVPs

| MVP | Estado | Fatias fechadas |
|---|---|---|
| MVP-001 Fundação | definido; issue-épico ainda não criada no GitHub | 0 / 5 |

## Próximas ações

1. **PI**: responder as perguntas abertas das specs 01–05 (começar pela 01 — destrava tudo).
2. **Cowork**: ao aprovar cada spec (`aprovada-pi`), criar issue-épico do MVP-001 (se ainda não existir) e a issue-filha da fatia em Backlog.
3. **Code**: iniciar Fatia 01 quando a issue existir; WIP = 1.

## Roadmap macro

MVP-001 Fundação → Execução local controlada → Integrações reais → Voz e automação → Offline/multiplataforma. Detalhe em `docs/LANDSCAPE.md`.
