# Kickoff — MVP-001 · Fatia 02 · AppShell e WorkspaceSwitcher (issue #3)

> Hand-off do planejamento (Cowork) para o **Claude Code**. Cole numa sessão do Claude Code no repo `rrb-jarvisOS`. Você (Code) implementa; o Cowork não codifica.
>
> **Pré-condição:** F01 (#2), F06 (#8) e **F04 (#5) entregues** — esta fatia consome o contrato `Workspace` e audita `workspace-switch` (ambos da F04).

## 1. Leia antes de codar
- `CLAUDE.md` — papéis, ciclo de vida, Git/board, regras invioláveis.
- `docs/spec/spec-fundacao-02-appshell-workspaces.md` — **a spec** (`aprovada-pi`). Lei do escopo.
- `docs/ARCHITECTURE.md` — grid do shell, IPC tipado (renderer não controla janela direto).
- `docs/CONVENTION.md` — `Desenvolvimento` não é workspace de usuário.

## 2. Board (WIP = 1)
1. Mova **#3** `backlog` → `todo` → `doing` e **atribua-se**.
2. Branch: **`feat/appshell-workspaces`**. Push cedo (inclui `docs/`).

## 3. O que entregar (escopo fechado)
- **AppShell:** layout base (sidebar + header + área de conteúdo), estética command center escuro (alto contraste, legível — RNF-007), **sem** design system formal (esse é o MVP-003).
- **WorkspaceSwitcher NOA ⇄ JARVIS OS:**
  - Identidade visual clara do espaço ativo (nome + acento distinto por espaço).
  - Navegação, rota e estado de UI **separados por workspace**, com **rota preservada por espaço**: cada workspace lembra a última tela; voltar restaura. A rota do outro **nunca** aparece na tela do ativo.
  - Conteúdo placeholder **estruturado** (mesmo formato dos contratos reais — sem dados soltos).
  - `Desenvolvimento` **não aparece** como opção.
- Navegação lateral mínima por espaço (itens placeholder).
- **Tray:** ícone persistente; minimizar → some da taskbar, vive no tray; clique restaura; menu "Abrir"/"Sair". Fechar janela = minimizar para tray; "Sair" encerra de verdade.
- **Instância única:** `app.requestSingleInstanceLock()` no main — abrir com uma instância rodando **foca a existente** (restaura do tray se preciso), não abre outra. Ações de janela/tray via IPC tipado da F01.
- Ao abrir, workspace ativo = **sempre JARVIS OS** (determinístico). Logue `workspace-switch` (F06) e audite (F04).

**Fora:** qualquer módulo funcional (Mission Control, Kanban…). Auth (F03): nesta fatia o shell abre direto, sem login. Persistência definitiva do workspace ativo é modelo da F04 (aqui, storage local simples se preciso).

## 4. Critérios de aceite
1. Alternância NOA ⇄ JARVIS funciona; navegação não vaza entre espaços **e a rota é preservada por espaço** (teste A→B→A restaura a rota de A; a de B nunca aparece na tela de A).
2. Espaço ativo identificável visualmente em qualquer tela.
3. Minimizar → tray; app segue rodando; restaurar preserva o estado da sessão.
4. "Sair" no tray encerra o processo por completo.
5. `Desenvolvimento` não é selecionável nem visível.
6. Abrir com instância já rodando **foca a existente** (restaura do tray), não cria segunda.
7. `npm run test` e `npm run lint` passam.

## 5. Durante / entrega
- Mantenha `docs/DEVELOPMENT.md` (seu) e `docs/STATUS.md`. Spec ambígua → **pergunte ao PI**.
- PR com **`refs #3`** (NUNCA `closes`). Verdes → **merge na `main`**. Só após o merge, `proplan:done` → Feito + link do PR. **Não** feche a issue (aceite do PI). Commite `docs/`. `/graphify . --update` ao final.

## 6. Ordem do MVP-001
`01` → `06` → `04` → **`02 (#3)`** → `03 (#4)` → `05 (#6)`. Uma por vez, WIP = 1.
