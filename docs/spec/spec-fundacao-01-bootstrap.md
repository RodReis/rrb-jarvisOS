# SPEC-Fundacao-01 — Bootstrap e estrutura

- MVP: `docs/mvp/mvp-001-fundacao.md` (Fatia 01)
- Status: **rascunho** — vira `aprovada-pi` quando as perguntas abertas estiverem resolvidas.
- Dependências: nenhuma (primeira fatia do projeto).

## Objetivo

Fixar a base técnica: app Electron + React + TypeScript + Vite que abre uma janela em Windows, com IPC seguro configurado e pipeline de dev/build/lint/test funcionando. Nada de feature — só o esqueleto verificável.

## Escopo

### Dentro

- Projeto Electron + React + TypeScript com Vite.
- Estrutura de pastas conforme `docs/ARCHITECTURE.md`:
  - `src/main/` (electron, ipc, runtime), `src/renderer/` (app, components, modules, styles), `src/shared/` (domain, contracts, policies).
- IPC seguro: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` no renderer; ponte via preload **tipada** (contratos em `src/shared/contracts/`).
- Scripts: `npm run dev` (abre o app), `npm run build`, `npm run lint` (ESLint + Prettier), `npm run test` (Vitest).
- Teste mínimo de fumaça: janela abre, preload expõe apenas a API tipada.
- Tela inicial renderiza sem backend real (placeholder).

### Fora

- Tray (Fatia 02). Auth (Fatia 03). Qualquer entidade de domínio (Fatia 04). Tema/idioma (Fatia 05). Empacotamento/distribuição (installer) — só `dev` e `build` local.

## Critérios de aceite

1. `npm run dev` abre janela desktop em Windows.
2. `npm run test` e `npm run lint` passam.
3. Renderer não acessa `require`, `process` ou APIs Node — teste automatizado comprova.
4. Preload expõe somente a ponte tipada; nenhum canal IPC genérico (`invoke` arbitrário) exposto.
5. Estrutura de pastas conforme acima, com README curto por diretório de topo de `src/`.

## Decisões fixadas

- Estilo: **Tailwind** adotado desde o bootstrap (decisão do plano de fundação — Tailwind + Radix ad-hoc, sem design system formal).
- Testes UI/e2e (Playwright) ficam **fora** desta fatia; entram quando houver fluxo real para testar (Fatia 03).

## Perguntas abertas ao PI

1. Electron via `electron-vite` (template integrado, menos config manual) ou config Vite manual + electron-builder? Proposta do Cowork: `electron-vite`.
2. Versão mínima de Node/Electron a fixar no `engines`? Proposta: Node 22 LTS + Electron mais recente estável.
