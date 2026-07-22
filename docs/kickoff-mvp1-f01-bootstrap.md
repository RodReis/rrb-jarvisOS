# Kickoff — MVP-001 · Fatia 01 · Bootstrap e estrutura (issue #2)

> Hand-off do planejamento (Cowork) para o **Claude Code**. Cole isto numa sessão do Claude Code no repo `rrb-jarvisOS`. Você (Code) implementa; o Cowork não codifica.

## 1. Leia antes de codar (nesta ordem)
- `CLAUDE.md` (raiz) — papéis, ciclo de vida, regras de Git/board, regras técnicas invioláveis.
- `docs/spec/spec-fundacao-01-bootstrap.md` — **a spec desta fatia** (`aprovada-pi`). É a lei do escopo.
- `docs/ARCHITECTURE.md` — estrutura de pastas (`src/main`, `src/renderer`, `src/shared`) e fronteiras (renderer nunca toca Node/segredo; IPC tipado via preload).
- `docs/TESTING.md` §8/§10 e `docs/DECISIONS.md` (ADR-003) — rotina de relatório de testes anti-drift.
- `docs/mvp/mvp-001-fundacao.md` — o épico e a ordem das fatias.

## 2. Board (suas ações — WIP = 1)
1. Mova **#2** `proplan:backlog` → `proplan:todo` → `proplan:doing` ao iniciar e **atribua-se**. Uma fatia por vez — não mexa nas outras.
2. Branch único da fatia: **`feat/bootstrap`** (nunca commite direto na `main`).
3. **Commite cedo e faça push** do branch a cada passo relevante — inclui os docs de `docs/`. Nunca deixe entrega só no disco local.

## 3. O que entregar (da spec — escopo fechado)
- Scaffold **`electron-vite`** (Electron + React + TypeScript + Vite). `engines`: **Node 22 LTS + Electron estável mais recente**.
- Estrutura: `src/main/` (electron, ipc, runtime), `src/renderer/` (app, components, modules, styles), `src/shared/` (domain, contracts, policies) + README curto por diretório de topo de `src/`.
- **IPC seguro:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; ponte via **preload tipada** com contratos em `src/shared/contracts/`. Sem canal IPC genérico (`invoke` arbitrário).
- Tela inicial placeholder (sem backend real).
- Scripts: `npm run dev` (abre a janela), `build`, `lint` (ESLint + Prettier), `test` (Vitest).
- **Tailwind** adotado já no bootstrap (Radix ad-hoc, sem design system formal — este vem no MVP-003).
- **Rotina de relatório de testes (ADR-003):** `scripts/gen-test-report.ts` + `...selfcheck.ts` (portados verbatim do `rrb-proplan`, repo-agnósticos), `scripts/test-report.mjs`, `test-report.config.json`, `reports/TESTS.md` (seed), `.github/workflows/ci.yml`; scripts `test:report`, `test:report:check`, `test:report:selfcheck`. Categorias wiradas nesta fatia: **Regras de Negócio** e **Tela**; **Banco** (F04) e **E2E Playwright** (F03) nascem com contagem 0.

**Fora desta fatia:** tray (F02), auth (F03), entidades de domínio (F04), tema/idioma (F05), installer/distribuição. Playwright entra na F03.

## 4. Critérios de aceite (o "done" verificável)
1. `npm run dev` abre janela desktop no Windows.
2. `npm run test` e `npm run lint` passam.
3. Renderer não acessa `require`/`process`/APIs Node — **teste automatizado** comprova.
4. Preload expõe **só** a ponte tipada; nenhum canal IPC genérico.
5. Estrutura de pastas conforme acima, com README por diretório de topo de `src/`.
6. `npm run test:report:selfcheck` e `test:report:check` passam no CI; `reports/TESTS.md` gerado com cabeçalho "GERADO — NÃO EDITAR", `## Estado atual` e as 3 categorias, **todos os números vindos do `--json` do Vitest** (zero número à mão). Guarda anti-drift ativa.

## 5. Durante a fatia
- Mantenha o **`docs/DEVELOPMENT.md`** (você é o dono) com o passo-a-passo e checkmarks desta fatia. As Issues respondem "qual fatia em qual coluna"; o `DEVELOPMENT.md` responde "onde estou dentro da fatia".
- Atualize `docs/STATUS.md` ao mover de coluna.
- Pode criticar arquitetura; **não** invente escopo. Spec ambígua → **pergunte ao PI**, nunca assuma.

## 6. Entrega (Git)
- Abra PR com **`refs #2`** no corpo. **NUNCA `closes #2`** — fecharia a issue no merge e forjaria o aceite do PI.
- Com `dev`/`test`/`lint` + CI verdes, faça o **merge na `main`** (modo solo: auto-merge após checks).
- **Só depois do merge**, aplique `proplan:done` → coluna **Feito**, com o link do PR no corpo da issue. **Não** feche a issue, **não** mova para Finalizado — isso é ato exclusivo do PI (aceite).
- Commite os docs de `docs/` junto da entrega. Ao final, rode `/graphify . --update` (incremental).

## 7. Depois da F01 (ordem do MVP-001)
`01 (#2)` → `06 Observabilidade (#8)` → `02/04` → `03` → `05`. Uma por vez, sempre WIP = 1.
