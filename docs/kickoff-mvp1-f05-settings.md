# Kickoff — MVP-001 · Fatia 05 · Settings mínimo (issue #6)

> Hand-off do planejamento (Cowork) para o **Claude Code**. Cole numa sessão do Claude Code no repo `rrb-jarvisOS`. Você (Code) implementa; o Cowork não codifica.
>
> **Pré-condição:** F01–F04 entregues (persiste preferências no `UserProfile` da F04). **Fecha o MVP-001.**

## 1. Leia antes de codar
- `CLAUDE.md` — papéis, ciclo de vida, Git/board, regras invioláveis.
- `docs/spec/spec-fundacao-05-settings.md` — **a spec** (`aprovada-pi`). Lei do escopo.
- `docs/CONVENTION.md` — preferências por usuário; troca de preferência **não** é evento de auditoria.

## 2. Board (WIP = 1)
1. Mova **#6** `backlog` → `todo` → `doing` e **atribua-se**.
2. Branch: **`feat/settings`**. Push cedo (inclui `docs/`).

## 3. O que entregar (escopo fechado)
- Tela **Settings** acessível nos dois workspaces (capacidade compartilhada; preferências salvas **por usuário**).
- **Idioma:** `pt-BR` (padrão) e `en-US`. Troca aplica na UI **sem reiniciar**. i18n via **`i18next`** (chaves para o shell e telas existentes — **não** traduzir docs internos).
- **Tema:** claro/escuro seguindo o SO por padrão, com override manual (`claro | escuro | sistema`).
- Persistência no `UserProfile` local (F04). Ação de **baixo risco**: **não** exige aprovação e **não** gera `AuditEvent` (auditoria da fundação fica em auth + workspace-switch). Logue como evento comum se quiser (F06), sem auditar.

**Fora:** notificações, autosave, efeitos sonoros, AI Engine, Identity/Soul, seleção de modelo (RF-023 completo é MVP futuro); preferências por workspace (por ora, só por usuário).

## 4. Critérios de aceite
1. Trocar idioma atualiza a UI **imediatamente** e persiste entre sessões.
2. Tema segue o SO por padrão; override manual persiste entre sessões.
3. Preferências **por usuário**: logout/login de outro usuário não herda as do anterior.
4. `npm run test` e `npm run lint` passam.

## 5. Durante / entrega
- Mantenha `docs/DEVELOPMENT.md` (seu) e `docs/STATUS.md`. Spec ambígua → **pergunte ao PI**.
- PR com **`refs #6`** (NUNCA `closes`). Verdes → **merge na `main`**. Só após o merge, `proplan:done` → Feito + link do PR. **Não** feche a issue (aceite do PI). Commite `docs/`. `/graphify . --update` ao final.

## 6. Fecho do MVP-001
Com a F05 aceita pelo PI e **todas** as filhas fechadas, o PI fecha o épico **MVP-001 (#1)**. Ordem cumprida: `01 → 06 → 04 → 02 → 03 → 05`.
