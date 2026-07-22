# Kickoff — MVP-001 · Fatia 03 · Autenticação Google local-first (issue #4)

> Hand-off do planejamento (Cowork) para o **Claude Code**. Cole numa sessão do Claude Code no repo `rrb-jarvisOS`. Você (Code) implementa; o Cowork não codifica.
>
> **Pré-condição:** F01 (#2), F06 (#8) e **F04 (#5) entregues** — consome `UserProfile`/`Session`/`AuditEvent`. É a fatia que **liga o Playwright-Electron** (fluxo feliz de login vira E2E real).

## 1. Leia antes de codar
- `CLAUDE.md` — papéis, ciclo de vida, Git/board, regras invioláveis.
- `docs/spec/spec-fundacao-03-auth-google.md` — **a spec** (`aprovada-pi`). Lei do escopo.
- `docs/DECISIONS.md` → **ADR-002** (OAuth dev via Supabase de desenvolvimento na nuvem), ADR-001 (local-first; sessão offline **30 dias**).
- `docs/ARCHITECTURE.md` — token só no main; renderer nunca vê token; IPC tipado.

## 2. Board (WIP = 1)
1. Mova **#4** `backlog` → `todo` → `doing` e **atribua-se**.
2. Branch: **`feat/auth-google`**. Push cedo (inclui `docs/`).

## 3. O que entregar (escopo fechado)
- Fluxo **OAuth Google via Supabase Auth** (projeto de **desenvolvimento na nuvem** — ADR-002). Abre no **navegador do sistema** (nunca webview do Electron); retorna por **servidor loopback local temporário**.
- **Persistência local da sessão no main**, nunca no renderer, nunca `localStorage`. Cifrada com **`safeStorage` (DPAPI/Windows)** — refresh token **nunca em claro** no disco.
- Estados de auth explícitos na UI: `deslogado`, `autenticando`, `ativo`, `erro`, `sessao-expirada`.
- **Relançamento offline:** sessão cacheada válida (≤ 30 dias) → entra direto; expirada + offline → `sessao-expirada` com aviso e opção de reautenticar quando online.
- **Logout:** revoga sessão (quando online), apaga tokens locais, limpa estado do renderer, volta a `deslogado`.
- Perfil mínimo no login: nome, e-mail, idioma `pt-BR`.
- `AuditEvent` de `login`, `logout`, `login-offline-reuse` (via F04). Logue as transições (F06, categoria `auth`, sem segredo).

**Fora:** sync de dados com o cloud (só auth aqui); multi-conta simultânea; outros provedores OAuth; refresh silencioso agressivo.

## 4. Critérios de aceite
1. Login Google completa e o app mostra nome/e-mail.
2. Relançar **sem internet** com sessão válida → entra sem novo login.
3. Logout limpa tokens e estado sensível do renderer (teste).
4. Renderer nunca vê tokens — só um snapshot mínimo de perfil via IPC tipado.
5. Cada transição de auth gera `AuditEvent` com timestamp e user_id.
6. Estados de erro com mensagem clara (**sem stack na UI**).
7. Tokens em disco **cifrados** (`safeStorage`/DPAPI) — teste: arquivo de sessão não contém o token em claro.
8. `npm run test` e `npm run lint` passam; fluxo principal com teste (mock do Supabase nos unitários) **e fluxo feliz de login por E2E Playwright-Electron** — a categoria E2E do `reports/TESTS.md` passa a ter contagem real (ADR-003).

## 5. Durante / entrega
- Mantenha `docs/DEVELOPMENT.md` (seu) e `docs/STATUS.md`. Spec ambígua → **pergunte ao PI**.
- PR com **`refs #4`** (NUNCA `closes`). Verdes → **merge na `main`**. Só após o merge, `proplan:done` → Feito + link do PR. **Não** feche a issue (aceite do PI). Commite `docs/`. `/graphify . --update` ao final.

## 6. Ordem do MVP-001
`01` → `06` → `04` → `02` → **`03 (#4)`** → `05 (#6)`. Uma por vez, WIP = 1.
