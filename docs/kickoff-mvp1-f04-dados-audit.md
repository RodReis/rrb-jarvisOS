# Kickoff — MVP-001 · Fatia 04 · Modelo de dados mínimo + AuditEvent (issue #5)

> Hand-off do planejamento (Cowork) para o **Claude Code**. Cole numa sessão do Claude Code no repo `rrb-jarvisOS`. Você (Code) implementa; o Cowork não codifica.
>
> **Pré-condição:** F01 (#2) e F06 (#8) entregues. **Faça a F04 antes da F02/F03** dentro do par — os contratos daqui (`UserProfile`, `Workspace`, `Session`, `AuditEvent`) alimentam AppShell (02) e Auth (03).

## 1. Leia antes de codar
- `CLAUDE.md` — papéis, ciclo de vida, Git/board, regras técnicas invioláveis.
- `docs/spec/spec-fundacao-04-dados-audit.md` — **a spec** (`aprovada-pi`). Lei do escopo.
- `docs/DECISIONS.md` → **ADR-004** (auditoria à prova de adulteração), ADR-001 (local-first).
- `docs/CONVENTION.md` §2 — campos de escopo obrigatórios (`user_id`, `workspace_id`, `visibility`, `sensitivity`).
- `docs/ARCHITECTURE.md` — `src/shared/domain` e `src/shared/contracts`; renderer só via IPC tipado.

## 2. Board (WIP = 1)
1. Mova **#5** `backlog` → `todo` → `doing` e **atribua-se**.
2. Branch: **`feat/dados-audit`**. Commite e **push cedo** (inclui `docs/`).

## 3. O que entregar (escopo fechado)
- Contratos TS em `src/shared/domain/` + `src/shared/contracts/` (UI consome contrato, nunca objeto solto).
- **Entidades:**
  - `UserProfile`: id, nome, e-mail, idioma (`pt-BR` padrão), preferências mínimas.
  - `Workspace`: **enum fechado** `noa | jarvis` (`Desenvolvimento` e `Agentic OS` **não** são workspaces).
  - `Session`: **metadados** (id, user_id, expiração, last-online-auth). **Token NÃO entra no SQLite** — vive cifrado no `safeStorage`/DPAPI (F03); contrato do renderer nunca vê token.
  - `AuditEvent` (stub): `id`, `user_id`, `workspace_id?`, `type`, `payload`, `created_at` + integridade `seq`/`prev_hash`/`hash` — **imutável, append-only, tamper-evident (ADR-004)**.
- Campo de escopo em toda entidade persistida: `user_id`; `workspace_id` quando aplicável. `visibility`/`sensitivity` adiados (as 4 são infra; o segredo da sessão é `credential` e por isso vive no `safeStorage`, não no DB).
- **Persistência local (main) em SQLite `better-sqlite3`** com **migrations que preservam dado** desde o dia 1 (runner por `user_version`). Nativo → confirmar `electron-rebuild` (ABI Electron) da F01. DB no `userData`.
- **Auditoria à prova de adulteração (ADR-004):** trigger SQLite bloqueia UPDATE/DELETE na tabela de audit; hash-chain HMAC (`seq`/`prev_hash`/`hash`, chave no `safeStorage`); `verifyChain(user_id)` re-caminha e recomputa.
- Eventos auditados: `login`, `logout`, `login-offline-reuse`, `workspace-switch`.
- Logue os fluxos (regra "todo método loga" da F06): `db`, `ipc` etc.

**Fora:** Policy Engine, BudgetPolicy, RLS/Supabase local, sync cloud, entidades de agentes/memória.

## 4. Critérios de aceite
1. As quatro entidades tipadas e persistidas localmente; UI consome só contratos.
2. `AuditEvent` append-only **enforçado no storage**: trigger rejeita UPDATE/DELETE (teste: tentativa falha).
3. **Adulteração detectável:** alterar um `AuditEvent` à força faz `verifyChain(user_id)` acusar a linha quebrada (teste com forja ao vivo).
4. Login/logout/troca de workspace geram `AuditEvent` correto e encadeado (integração com 02/03).
5. Isolamento por `workspace_id` e por `user_id` passa (entidade `noa` não vaza em consulta `jarvis`).
6. Renderer não lê storage direto — só IPC tipado; nenhum token no contrato do renderer nem no SQLite.
7. `npm run test` e `npm run lint` passam.

## 5. Durante / entrega
- Mantenha `docs/DEVELOPMENT.md` (seu) e atualize `docs/STATUS.md` ao mover de coluna. Spec ambígua → **pergunte ao PI**.
- PR com **`refs #5`** (NUNCA `closes`). Com `dev/test/lint` + CI verdes, **merge na `main`**. Só após o merge, `proplan:done` → Feito + link do PR na issue. **Não** feche a issue (aceite é do PI). Commite `docs/`. Ao final, `/graphify . --update`.

## 6. Ordem do MVP-001
`01 (#2)` → `06 (#8)` → **`04 (#5)`** → `02 (#3)` → `03 (#4)` → `05 (#6)`. Uma por vez, WIP = 1.
