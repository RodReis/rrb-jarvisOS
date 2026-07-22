# SPEC-DesignSystem-01 — Infra do design system

- MVP: `docs/mvp/mvp-003-design-system-plataforma.md` (Fatia 01)
- Status: **aprovada-pi** (2026-07-21) — todas as perguntas resolvidas pelo PI.
- Dependências: MVP-001 entregue (bootstrap Electron+React+TS da SPEC-Fundacao-01; toolchain de teste da SPEC-Fundacao-06). É a base das fatias 02–06 deste MVP.
- Decisões que sustentam esta spec: MVP-003 §Decisões do PI (peso leve solo+IA; DS não conhece domínio/infra; **Radix + Tailwind v4 adotados**); PRD §8 (arquitetura de pacotes) e §8.1 (regras de dependência); LANDSCAPE (Storybook/regressão/governança **suspensos**).

## Objetivo

Criar o **esqueleto do design system** dentro do repo: onde `tokens`, `ui` e `patterns` moram, com **Radix Primitives + Tailwind CSS v4** como base, como se testam, e a **regra de fronteira** que impede o DS de tocar domínio ou infraestrutura. Nada de visual ainda — esta fatia entrega estrutura, toolchain e o contrato de dependência que as demais fatias preenchem.

## Escopo

### Dentro

- **Três camadas como módulos internos** em `src/design/{tokens,ui,patterns}` (não pacotes publicados no npm — peso leve; reuso externo não é meta agora).
- **Base técnica adotada (decisão do PI):**
  - **Tailwind CSS v4** para a camada de estilo, com os **tokens expostos como CSS variables** (a Fatia 02 popula os valores) — o tema/`uiTheme` troca variáveis, não classes.
  - **Radix Primitives** como base headless acessível dos componentes interativos/overlay (Dialog, Popover, Combobox, DropdownMenu, Select, Switch, Slider, RadioGroup…) — focus-trap/ARIA prontos, encapsulados em `ui` (consumidor não importa Radix direto — PRD §24 "Radix exposto").
  - **Lucide React** para iconografia (import individual).
- **Regras de dependência aplicáveis** (PRD §8.1), verificáveis por lint:
  - `tokens` não depende de React.
  - `ui` depende de `tokens` + Radix/Lucide.
  - `patterns` depende de `ui`; recebe dados/estado/callbacks só por props tipadas.
  - **Nenhuma** camada importa módulos de produto (JARVIS/NOA), Supabase, Electron Main, filesystem, providers ou secrets (fronteira do ARCHITECTURE).
- **Toolchain de teste leve:** Vitest + Testing Library (a11y por papel). Sem Storybook, sem Playwright (suspensos — LANDSCAPE / MVP-003 §4).
- **Convenções públicas:** PascalCase componentes, `use*` hooks, export nomeado, props tipadas obrigatórias, sem `any` (alinha ao `.claude/CLAUDE.md`).
- **Fronteira via ESLint:** regra `no-restricted-imports` que **quebra o `lint`** se um arquivo do DS importar caminho proibido (domínio/Supabase/Main). É o guardrail que torna a regra de dependência verificável, não só escrita.

### Fora

- Qualquer token, cor, tipografia ou componente concreto — Fatias 02+.
- Publicação de pacotes / versionamento semântico — suspenso (sem consumidores externos).
- Storybook e regressão visual — fora do MVP.

## Critérios de aceite

1. Existem os três módulos (`tokens`/`ui`/`patterns`) em `src/design/`, com Tailwind v4 + Radix + Lucide configurados e um export de exemplo trivial por camada, importados na ordem permitida (teste Vitest).
2. A **regra ESLint de fronteira** falha o `lint` quando um arquivo do DS importa um caminho proibido (domínio/Supabase/Main) e passa quando não importa (caso de violação + caso limpo).
3. `tokens` compila e é importável **sem React** (teste que importa só `tokens`).
4. Um primitivo Radix é encapsulado em `ui` sem vazar a API do Radix ao consumidor (revisão + teste de superfície pública).
5. `README` curto em `src/design/` documenta camadas, base técnica, regra de dependência e como testar.
6. `npm run test` e `npm run lint` passam; evidência no `reports/TESTS.md`.

## Perguntas resolvidas pelo PI (2026-07-21)

1. **Base técnica:** **Radix + Tailwind v4** (stack cheia do PRD) + Lucide React. — resolvido.
2. **Localização das camadas:** `src/design/{tokens,ui,patterns}` (dentro do renderer), não pacote separado. — resolvido.
3. **Fronteira:** **regra ESLint** (`no-restricted-imports`) que quebra o `lint` — mais barata e no piso de `lint` verde. — resolvido.
