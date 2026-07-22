# SPEC-DesignSystem-04a — AppShell + navegação

- MVP: `docs/mvp/mvp-003-design-system-plataforma.md` (Fatia 04a)
- Status: **aprovada-pi** (2026-07-21) — split 04→04a/04b aprovado.
- Dependências: Fatias 02 (tokens) e 03a/03b (componentes) entregues. **Re-plataforma** a SPEC-Fundacao-02 (AppShell/WorkspaceSwitcher placeholder) — exige-a entregue.
- Decisões que sustentam esta spec: PRD §11.3 (navegação/estrutura), §16.3 (falha do runtime — resiliência do shell); protótipo README §1 (fluxo/estado) + layout NOA §2 / JARVIS §2 + §2.6 (toggle `uiTheme`); ARCHITECTURE (IPC tipado); ADR-001.

## Objetivo

Compor, com os componentes das Fatias 03a/03b, o **shell de aplicação** e a navegação — substituindo o shell placeholder da fundação por um shell do design system, fiel ao layout do protótipo (rail 60px + sidebar 232px + conteúdo; topbar 52px; rodapé 34px).

## Escopo

### Dentro

- **Navegação/estrutura (PRD §11.3):** AppShell, Sidebar, NavigationGroup, WorkspaceSwitcher, TopBar, Breadcrumb, PageHeader, Tabs, Accordion, CommandBar, CommandPalette.
- **Controles de tema — fiéis ao protótipo:**
  - **Modo claro/escuro:** toggle **sol/lua no `TopBar`** de cada tela interna (`uiTheme` global), README §2.6 — mora no AppShell.
  - **Acento:** é a paleta fixa de swatches da **2ª tela (CHOICE)** — **fora do AppShell interno** (ver SPEC-DesignSystem-02); o AppShell só **consome** o acento ativo. **Não** há `AccentColorPicker` livre no shell.
  - **Densidade:** cortada do MVP (SPEC-02) — sem `DensitySwitcher`.
- **WorkspaceSwitcher** respeita a SPEC-Fundacao-02: identidade visual clara do espaço ativo, **rota preservada por espaço**, `Desenvolvimento` nunca aparece. Aqui ganha a versão com tokens/identidade (integra a Fatia 05).
- **Rail dual do JARVIS:** Command Center ⇄ Agents OS (`railCommand`/`railMission`) e atalho para o outro workspace + Sair — estrutura do protótipo (JARVISOS §2), sem as telas de conteúdo (produto).
- **Resiliência do shell (PRD §16.3):** uma falha no runtime isolado **não derruba o shell** — o shell preserva navegação e contexto visual. (Os componentes de aviso — RuntimeUnavailable/OfflineBanner — são da Fatia 04b; aqui garante-se que o shell sobrevive e continua navegável.)

### Fora

- Padrões operacionais (status, risco/aprovação, execução/custo, logs, providers, notificações) — **Fatia 04b**.
- Telas de produto reais (Command Center com voz, Mission Control, Kanban, 7 telas do NOA) — consumidoras, Corte 3+.
- Mascote/voz — Fatia 05.

## Critérios de aceite

1. AppShell compõe rail + sidebar + topbar + conteúdo com tokens; o toggle sol/lua no TopBar troca `uiTheme` (global) **sem reload**.
2. WorkspaceSwitcher NOA⇄JARVIS mantém as garantias da SPEC-Fundacao-02 (rota por espaço, `Desenvolvimento` oculto, identidade do ativo) — teste.
3. Rail dual do JARVIS alterna Command Center ⇄ Agents OS preservando a estrutura do protótipo (teste de navegação).
4. Simular falha do runtime mantém o shell **vivo e navegável** (teste).
5. Nenhum componente de navegação importa domínio/infra (fronteira verde).
6. `npm run test` e `npm run lint` passam; evidência no `reports/TESTS.md`.

## Perguntas ao PI (pendentes)

Nenhuma — spec `aprovada-pi`.
