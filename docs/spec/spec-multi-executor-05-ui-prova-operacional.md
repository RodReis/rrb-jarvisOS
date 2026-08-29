# SPEC-Multi-Executor-05 — UI e prova operacional

- MVP: `docs/mvp/mvp-010-multi-executor.md` (Fatia 05) — **fecha o MVP-010**.
- Status: **revisão-pi** — implementação não autorizada.
- Depende de: F04 aprovada e entregue; `DESIGN-SYSTEM.md` e protótipo HTML aprovados antes da construção da UI.

## Objetivo

Dar ao PI controle compreensível dos executores e provar, numa jornada real limitada, construção por um CLI e revisão pelo outro.

## Dentro

- Tela por projeto com preferência, fallback permitido e modos de cobrança.
- Estados Claude/Codex: disponibilidade, autenticação, quota conhecida/desconhecida, execução atual e motivo do bloqueio.
- Ações de autenticar, revalidar health e habilitar/desabilitar créditos com teto explícito.
- Histórico de seleção, uso observado e revisão cruzada sem exibir segredo.
- E2E em repositório exclusivo: um executor escreve, outro revisa, kernel faz Git/PR e preserva evidência.
- Acessibilidade, teclado, foco e componentes públicos do Design System.

## Fora

- Compra de plano/crédito dentro do produto.
- Percentual inventado de quota ou scraping das telas dos fornecedores.
- Squad, concorrência de fatias e execução contínua.
- Deploy.

## Regras

1. `quota_unknown` aparece como desconhecida, não como disponível.
2. Alteração monetária exige ação explícita, teto e resumo do impacto antes de salvar.
3. A UI é projeção do estado durável; refresh/reinício não perde a decisão.
4. A prova real usa limite de tempo/uso e pode ser cancelada sem apagar branch/PR.

## Critérios de aceite

1. PI configura preferência e vê por que cada executor está ou não elegível.
2. Habilitar créditos sem teto é impossível; desabilitado nunca é usado.
3. Nenhum segredo alcança renderer, screenshot ou relatório.
4. Jornada E2E produz delta por um executor e revisão identificada pelo outro.
5. Git e GitHub são executados pelo app, não pelo adapter.
6. Smoke ao vivo, testes de componentes, integração e acessibilidade passam.
7. Evidência registra revisões, executor, modo, head SHA, checks e resultado sem dados voláteis falsos.

## Testes e evidência

- Testing Library e acessibilidade automatizada;
- Playwright da jornada principal e estados de bloqueio;
- smoke real opt-in dos dois CLIs;
- relatório por SPEC em `reports/TESTS.md`.

## Perguntas abertas ao PI

Nenhuma. Aguarda aprovação desta revisão exata e dos artefatos de design exigidos antes da UI.
