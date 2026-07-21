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
  - `Session`: **metadados** da sessão auth local (id, user_id, expiração, last-online-auth). **O token não entra no SQLite** — mora cifrado no `safeStorage`/DPAPI (SPEC-03); o contrato do renderer nunca vê token.
  - `AuditEvent` (stub): `id`, `user_id`, `workspace_id?`, `type`, `payload`, `created_at` + integridade `seq`, `prev_hash`, `hash` — **imutável, append-only e à prova de adulteração (ADR-004)**.
- Campos de escopo em toda entidade persistida: `user_id`; `workspace_id` quando aplicável (conforme `docs/CONVENTION.md`). `visibility`/`sensitivity` ficam adiados — as quatro entidades da fundação são infra, não dado de produto (exceto o segredo da sessão, que é `credential` e por isso vive no `safeStorage`, não no DB).
- Persistência local no main process em **SQLite (`better-sqlite3`)**, com **migrations que preservam dado** desde o dia 1 (runner por `user_version`) — o log de auditoria é evidência e não pode ser zerado por evolução de schema. `better-sqlite3` é nativo → rebuild p/ ABI do Electron (`electron-rebuild`) na Fatia 01. DB no `userData` do app.
- **Auditoria à prova de adulteração (ADR-004):** trigger SQLite bloqueia UPDATE/DELETE na tabela de audit; cada evento entra na hash-chain HMAC (`seq`/`prev_hash`/`hash`, chave no `safeStorage`); `verifyChain(user_id)` re-caminha e recomputa.
- Eventos auditados nesta fase: `login`, `logout`, `login-offline-reuse`, `workspace-switch`.
- Testes de isolamento: entidade do workspace `noa` não retorna em consulta escopada a `jarvis` e vice-versa.

### Fora

- Policy Engine, BudgetPolicy, RLS/Supabase local, sync cloud, entidades de agentes/memória (Workflows, Skills, Memory* etc.).

## Critérios de aceite

1. As quatro entidades tipadas e persistidas localmente; UI consome apenas contratos.
2. `AuditEvent` é append-only **enforçado no storage**: o trigger SQLite rejeita UPDATE/DELETE na tabela de audit e o repositório não expõe alteração/remoção (teste: tentativa de UPDATE/DELETE falha).
3. **Adulteração é detectável:** um `AuditEvent` alterado à força no DB faz `verifyChain(user_id)` acusar a quebra (teste com forja ao vivo → `verifyChain` reporta a primeira linha quebrada).
4. Login, logout e troca de workspace geram `AuditEvent` correto e encadeado (integração com fatias 02/03).
5. Teste de isolamento por `workspace_id` e por `user_id` passa.
6. Renderer não lê o storage direto — só via IPC tipado; nenhum token no contrato do renderer nem no SQLite.
7. `npm run test` e `npm run lint` passam.

## Perguntas resolvidas pelo PI (2026-07-21)

1. Storage local da fundação: **SQLite (`better-sqlite3`) desde já** — evita migração dupla; custo inicial baixo. — aprovado.
2. Visualização dos AuditEvents na UI: **fora** desta fatia — auditar por consulta em dev tools/teste. — aprovado.
3. **Imutabilidade do AuditEvent:** delegada ao Cowork com pesquisa das práticas atuais → **defesa em profundidade (ADR-004)**: trigger SQLite (bloqueia UPDATE/DELETE) + hash-chain HMAC-SHA-256 por usuário (chave no `safeStorage`/DPAPI) + `verifyChain()` verificável em teste. Tamper-evident; âncora externa fica para o sync (Corte 3+). — decidido.
4. **Fronteira token↔DB** (clarificação): o token de sessão **não** entra no SQLite — vive cifrado no `safeStorage` (SPEC-03); a tabela `Session` guarda só metadados não-secretos. — aplicado.
5. **Migrations** (clarificação): SQLite desde o dia 1 com runner de migração que **preserva dado** (`user_version`); auditoria nunca é zerada por evolução de schema. — aplicado.
