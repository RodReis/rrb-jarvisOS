# SPEC-DesignSystem-06 — Adoção & hardening

- MVP: `docs/mvp/mvp-003-design-system-plataforma.md` (Fatia 06)
- Status: **aprovada-pi** (2026-07-21) — todas as perguntas resolvidas pelo PI.
- Dependências: Fatias 03a/03b (componentes), 04a/04b (shell+padrões) e 05 (identidades) entregues. É a fatia de fechamento do MVP.
- Decisões que sustentam esta spec: PRD §21 (DS-4), §23 (métricas), §14 (a11y); protótipo (CHOICE README §1; NOA Hoje `NOA.md §3.1`; HUD `JARVISOS.md §4`); peso leve (a11y por teclado/Testing Library, **sem** baseline Playwright).

## Objetivo

Provar o design system numa **jornada real de 3 telas** que exercita **as duas identidades** e o seletor de acento, e endurecer o que a prova revelar. As telas são compostas **só** com componentes/tokens públicos; estilos locais são removidos; a acessibilidade por teclado é revisada.

## Escopo

### Dentro

- **Jornada de prova — 3 telas do protótipo, só com componentes/tokens públicos:**
  1. **CHOICE (2ª tela)** — os dois cards de identidade (NOA + JARVIS) + o painel **TEMA** com a **paleta fixa de swatches por módulo** (AccentSwatchSelector). Sempre escura (marca). Prova: acento por módulo, mascotes, identidades lado a lado.
  2. **NOA · Hoje** (`NOA.md §3.1`) — saudação, agenda do dia, hábitos (toggle), saúde resumida. Prova a identidade NOA em claro **e** escuro.
  3. **JARVIS · HUD** (`JARVISOS.md §4`) — telemetria (StatCard/Progress) + linhas de sistema. Prova a identidade JARVIS densa em claro **e** escuro.
- **Cobertura das duas identidades + tema:** cada tela interna (NOA Hoje, JARVIS HUD) roda em `uiTheme` claro e escuro; a CHOICE valida o acento fixo por módulo. É prova de composição — **não** a entrega das telas de produto finais (dados por props/mock).
- **Remoção de estilos locais:** varrer o que foi criado e eliminar cor/espaçamento/tipografia fora dos tokens; o que faltar vira token/variante no DS, não override local (PRD §18.3).
- **Revisão de acessibilidade (peso leve):** teclado, ordem de foco previsível, foco visível, `Escape` fecha overlays sem perda silenciosa, estados não só por cor, `prefers-reduced-motion` — por **Testing Library** + roteiro manual de teclado. Sem auditoria automatizada de stories (sem Storybook) e **sem** baseline visual.
- **Fechamento do MVP:** critérios de done do épico verificados; `reports/TESTS.md` consolida evidência das 8 fatias.

### Fora

- Storybook, regressão Playwright, governança de 9 passos, changelog/semver — suspensos.
- As telas de produto **completas e finais** (com dados reais) — Corte 3+.
- Voz real, execução real — Corte 4 / MVP-004.

## Critérios de aceite

1. As 3 telas (CHOICE, NOA Hoje, JARVIS HUD) são compostas **só** com componentes/tokens públicos — nenhum token/estilo paralelo (revisão + lint verde).
2. NOA Hoje e JARVIS HUD funcionam em **claro e escuro** sem reload nem perda de contexto; a CHOICE aplica o acento fixo por módulo (teste).
3. As **duas identidades** aparecem corretas (acento/tom/mascote por módulo) e não vazam entre si (teste alinhado à Fatia 05 / SPEC-Fundacao-02).
4. Navegação **completa por teclado** nas 3 telas; foco visível e ordem previsível; `Escape` fecha overlays (Testing Library + roteiro manual).
5. Nenhum estado essencial comunicado só por cor.
6. Os **critérios de done do MVP-003** estão verdes e evidenciados no `reports/TESTS.md`.
7. `npm run dev`, `npm run test`, `npm run lint` passam.

## Perguntas resolvidas pelo PI (2026-07-21)

1. **Telas da jornada:** **CHOICE + NOA (Hoje) + JARVIS (HUD)** — 3 telas, exercitando as duas identidades e o seletor de acento. — resolvido.
2. **Gate de a11y:** **Testing Library por papel + roteiro manual de teclado** é suficiente para o `done` (sem auditoria automatizada de stories, que não existem — peso leve). — resolvido.

## Perguntas ao PI (pendentes)

Nenhuma — spec `aprovada-pi`.
