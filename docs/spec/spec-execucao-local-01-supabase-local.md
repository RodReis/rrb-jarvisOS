# SPEC-Execucao-01 — Supabase local (Docker) + ambiente de sync (dev)

- MVP: `docs/mvp/mvp-002-execucao-local-controlada.md` (Fatia 01)
- Status: **aprovada-pi** (2026-07-21) — escopo do schema resolvido pelo PI (starter + padrão RLS).
- Dependências: MVP-001 entregue. Roda **independente** das outras fatias do MVP-002 (é ambiente). ADR-001 (local-first), ADR-002 (auth no cloud dev).
- Decisões que sustentam esta spec: requisitos § Corte 2 ("Supabase local via Docker para desenvolvimento"); ADR-001 (Supabase é espelho de sync/auditoria, não fonte de verdade); ADR-002 (OAuth em dev usa projeto cloud); decisão SQLite↔Supabase (2026-07-21).

## Objetivo

Subir o **ambiente Supabase local** (Docker, via CLI) como **alvo de sincronização** de dev, com **migrations**, **RLS** e **seeds** — provando o padrão de isolamento no lado Supabase. É **só o ambiente**: o **sync em si** (push/pull, resolução de conflito) é Corte 3. O **SQLite segue fonte de verdade** e **nada da aplicação escreve no Supabase** nesta fatia — o alvo existe, schema-ready, mas ocioso até o sync ser construído.

## Escopo

### Dentro

- **Supabase CLI:** `supabase start` sobe a stack local (Postgres + PostgREST + Studio) via Docker; config, migrations e seed versionados em `supabase/`. Documentado como subir/derrubar e as portas locais (remapear se colidir com outros stacks locais, coerente com a política de portas do `CLAUDE.md`).
- **Migrations starter** (`supabase/migrations`): schema espelhando as entidades **cloud-mirrored da fundação** — **`UserProfile`, `Workspace`, `AuditEvent`** — com os campos de escopo (`user_id`, `workspace_id`).
- **RLS habilitada** nessas tabelas, com políticas por `user_id` (e `workspace_id` quando aplicável): um usuário só enxerga as próprias linhas. A prova usa uma **role de aplicação não-owner** — o Postgres **pula RLS para superuser/owner**, então com a role errada o teste passaria sem provar nada (mesmo cuidado registrado no CI do `rrb-proplan`).
- **Seeds** (`supabase/seed.sql` ou script): dados fake de dev — **sem hardcode/mock no código**, dado via seed (regra do `CLAUDE.md`).
- **Auth continua no projeto cloud de dev** (ADR-002): o Supabase local é o lado de **dados/RLS**, **não** roda o fluxo OAuth de dev.
- **Nunca espelhar segredo:** `Session`/tokens ficam **fora** do schema Supabase — vivem só local (`safeStorage`/SQLite). O schema cloud **não tem coluna de token**.
- **Reprodutibilidade:** `supabase db reset` aplica migrations + seed de forma determinística.

### Fora

- **Lógica de sincronização** (push/pull, resolução de conflito multi-dispositivo) — **Corte 3** (questão aberta 3 do ADR-001).
- **Taxonomia completa do que sincroniza** (workflows, execução, allowlist, etc.) e as decisões de **sensibilidade/E2EE** por campo — **Corte 3**. Quando o sync entrar, colunas sensíveis guardam **ciphertext** (E2EE/AES-256, decisão 2026-07-21); o cloud nunca vê texto claro. Aqui o schema é só o mirror estrutural das entidades da fundação.
- **OAuth/Auth local** — fica no cloud dev (ADR-002).
- **Supabase Cloud de produção** — futuro.

## Critérios de aceite

1. `supabase start` sobe a stack local via Docker; `supabase/` versionado (config + migrations + seed); README documenta subir/derrubar e portas. `supabase db reset` é reproduzível (migrations + seed).
2. Migrations criam o schema starter (`UserProfile`, `Workspace`, `AuditEvent`) com os campos de escopo (`user_id`/`workspace_id`).
3. **RLS ativa e comprovada:** com uma role de aplicação **não-owner** (sujeita a RLS), uma consulta só retorna linhas do próprio `user_id`/`workspace_id`; linha de outro usuário **não** retorna. Teste de isolamento comprova.
4. **Nenhum segredo no schema cloud:** não há coluna de token/`Session`; inspeção/teste confirma.
5. **SQLite segue fonte de verdade;** nenhuma escrita da aplicação no Supabase nesta fatia (o alvo existe, ocioso até o Corte 3).
6. `npm run test` e `npm run lint` passam; se algum int-spec exercitar RLS real, o CI sobe a stack (ADR-003); senão, mock no boundary. Evidência no `reports/TESTS.md`.

## Perguntas resolvidas pelo PI (2026-07-21)

1. **Escopo do schema/migrations:** **starter + padrão RLS** — só as entidades cloud-mirrored da fundação (`UserProfile`, `Workspace`, `AuditEvent`), provando o isolamento. A taxonomia completa do que sincroniza e as decisões de sensibilidade/E2EE ficam pro **Corte 3** (onde o sync é desenhado). Evita schema morto e churn — diferente da Fatia 04, o mirror aqui não tem consumidor até o Corte 3. — decidido.

## Decisões cravadas pelo Cowork (PI pode vetar)

- **`supabase` CLI** (stack local via Docker) como forma de subir o ambiente; auth continua no cloud dev (ADR-002).
- **Sem lógica de sync** (Corte 3); **nunca espelhar segredo/token**; **RLS por `user_id`/`workspace_id`** com role não-owner.
