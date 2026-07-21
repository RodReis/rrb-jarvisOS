# ADR-003: Relatório de evidência de testes gerado por máquina e verificado no CI

- Status: aceito (metodologia); implementação e wiring na Fatia 01.
- Data: 21 de julho de 2026.
- Decisor: PI.
- Relacionado: ADR-001 (local-first); `docs/TESTING.md` (metodologia detalhada); SPEC-Fundacao-01 (Bootstrap, onde o código é implementado); SPEC-Fundacao-04 (decisão SQLite vs JSON, que finaliza o setup da categoria "Banco").

## Problema

Precisamos de uma régua contra **fechamento frágil** aplicada ao nosso próprio processo de testes: declarar "está tudo verde" sem prova real. Um número de teste escrito à mão num markdown é uma *afirmação*, não *evidência*. Sem um mecanismo que force os números a virem da máquina e sobreviverem a uma reexecução independente, o relatório de testes vira narração — exatamente o que o projeto existe para impedir em outros contextos (aceite do PI, PR mergeado).

A metodologia foi provada no repo irmão `rrb-proplan`, mas a stack de lá (monorepo pnpm com `apps/api` NestJS + Jest + Postgres/RLS e `apps/web` Vitest/Playwright) **não é a do jarvis** (app Electron: Vite + Vitest + Playwright + SQLite, estrutura `src/main`/`src/renderer`/`src/shared`). Copiar o tooling verbatim traria uma arquitetura de testes que o jarvis não tem.

## Decisão

Adotar a rotina de **relatório de evidência de testes** descrita em `docs/TESTING.md`, adaptada à stack Electron:

1. **Evidência de máquina, nunca narrada.** Todo número (quantidade, pass, falha, cobertura) vem da saída `--json` dos runners (**Vitest** e **Playwright**); nada é digitado à mão.
2. **Arquivo-registro incremental** em `reports/TESTS.md` (fora de `docs/`), gerado por `scripts/gen-test-report.ts`. Cabeçalho "GERADO — NÃO EDITAR". Seção `## Estado atual` regenerada + `## Histórico por entrega` **append-only**.
3. **Três categorias** por entrega (3 linhas): **Banco** (persistência local/SQLite via int-spec), **Regras de Negócio** (domínio puro em `src/shared`/`src/main`), **Tela** (componente Vitest + E2E Playwright-Electron).
4. **Guarda anti-drift no CI** (`--check`) com duas provas independentes: números (contra execução limpa) e histórico (append-only por continência, com baseline no **blob do git da base do PR**, nunca no próprio arquivo). Um **self-check** (`test:report:selfcheck`) prova o gerador antes, para que um bug nele não desligue a guarda em silêncio.
5. **Cobertura report-only** — publicada, não barra merge. O CI não usa `closes #N` nem toca no aceite (que segue sendo ato deliberado do PI); só torna a evidência infalsificável.

**Peças imutáveis** (`gen-test-report.ts`, `gen-test-report.selfcheck.ts`) portam verbatim do proplan por serem repo-agnósticas. **Peças por stack** (`test-report.config.json`, `scripts/test-report.mjs`, `.github/workflows/ci.yml`) são reescritas para Vitest+Playwright+Electron.

## Consequências

- O código (gerador, orquestrador, config, CI, `reports/`) é entregue **na Fatia 01 (Bootstrap)**, junto do passo "scripts dev/build/lint/test configurados" — não há `package.json`/runners antes disso. Instalá-lo antes furaria o gate WIP=1 do processo. Comando `npm run test:report` — a **SPEC-Fundacao-01 fixou npm** (não pnpm; sem monorepo, o `pnpm --filter` do proplan não se aplica).
- **As categorias entram por fatia.** Fatia 01: **Regras de Negócio** (+ **Tela** componente via Vitest). **Tela/E2E** (Playwright-Electron) na **Fatia 03** (a SPEC-01 deixa Playwright fora do bootstrap). **Banco** (SQLite) na **Fatia 04**. Categorias ainda não wiradas nascem com contagem 0 — o relatório tolera, não invalida.
- O setup concreto da categoria **Banco** (arquivo temp, migrations de teste) só finaliza quando a **SPEC-Fundacao-04** decidir SQLite vs JSON. A metodologia independe dessa escolha; enquanto não há storage, a categoria pode nascer com contagem 0 sem invalidar o relatório.
- O CI **não sobe Postgres** por padrão (diferente do proplan): "Banco" é storage local. Se a fase de persistência exigir Postgres real, o serviço entra no workflow depois.
- Playwright-Electron no CI Linux exige `xvfb-run` (o app abre janela) — relevante a partir da Fatia 03.
- `reports/TESTS.md` fica **fora de `docs/`**, para não mascarar o sinal de documentação humana defasada nem poluir o histórico de `docs/`.
- Reutilização: em projetos futuros, copia-se o gerador + self-check (imutáveis), reescreve-se o orquestrador para a stack e ajusta-se o config.
