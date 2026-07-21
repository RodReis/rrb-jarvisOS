# SPEC-Fundacao-04 — Modelo de dados mínimo + AuditEvent stub

- MVP: `docs/mvp/mvp-001-fundacao.md` (Fatia 04)
- Status: **aprovada-pi** (2026-07-21) — todas as perguntas abertas resolvidas pelo PI.
- Dependências: Fatia 01 entregue. Sustenta as fatias 02 e 03.

## Objetivo

Tipar e persistir localmente as quatro entidades mínimas da fundação — `UserProfile`, `Workspace`, `Session`, `AuditEvent` (stub) — com os campos de escopo obrigatórios do `docs/CONVENTION.md`, estabelecendo o padrão de auditoria cedo, sem construir o Policy Engine.

## Escopo

### Dentro

- Contratos TypeScript em `src/shared/domain/` + `src/shared/contracts/` (UI consome contrato, nunca objeto solto).
- Entidades:
  - `UserProfile`: id, nome, e-mail, idioma (`pt-BR` padrão), preferências mínimas.
  - `Workspace`: `noa` | `jarvis` — **enum fechado**; `Desenvolvimento` e `Agentic OS` não são workspaces.
  - `Session`: referência da sessão auth local (sem token no contrato do renderer).
  - `AuditEvent` (stub): `id`, `user_id`, `workspace_id?`, `type`, `payload`, `created_at` — **imutável, append-only**.
- Campos de escopo em toda entidade persistida: `user_id`; `workspace_id` quando aplicável (conforme `docs/CONVENTION.md`).
- Persistência local no main process (storage simples; SQLite/Supabase local ficam para o MVP de persistência).
- Eventos auditados nesta fase: `login`, `logout`, `login-offline-reuse`, `workspace-switch`.
- Testes de isolamento: entidade do workspace `noa` não retorna em consulta escopada a `jarvis` e vice-versa.

### Fora

- Policy Engine, BudgetPolicy, RLS/Supabase local, sync cloud, entidades de agentes/memória (Workflows, Skills, Memory* etc.).

## Critérios de aceite

1. As quatro entidades tipadas e persistidas localmente; UI consome apenas contratos.
2. `AuditEvent` é append-only: não existe API de update/delete.
3. Login, logout e troca de workspace geram `AuditEvent` correto (integração com fatias 02/03).
4. Teste de isolamento por `workspace_id` e por `user_id` passa.
5. Renderer não lê o storage direto — só via IPC tipado.
6. `npm run test` e `npm run lint` passam.

## Perguntas resolvidas pelo PI (2026-07-21)

1. Storage local da fundação: **SQLite (`better-sqlite3`) desde já** — evita migração dupla; custo inicial baixo. — aprovado.
2. Visualização dos AuditEvents na UI: **fora** desta fatia — auditar por consulta em dev tools/teste. — aprovado.
