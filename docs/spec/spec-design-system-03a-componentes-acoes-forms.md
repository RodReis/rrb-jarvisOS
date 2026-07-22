# SPEC-DesignSystem-03a — Componentes: ações + formulários

- MVP: `docs/mvp/mvp-003-design-system-plataforma.md` (Fatia 03a)
- Status: **aprovada-pi** (2026-07-21) — split 03→03a/03b aprovado; base Radix+Tailwind definida na Fatia 01.
- Dependências: Fatia 02 entregue (tokens/tema) e Fatia 01 (Radix+Tailwind+fronteira). Pode andar em paralelo com 03b.
- Decisões que sustentam esta spec: PRD §11.1/§11.2 (ações, formulários), §14 (a11y); protótipo (componentes reutilizáveis NOA §5 / JARVIS §6); base **Radix** (Fatia 01); peso leve (sem Storybook).

## Objetivo

Entregar os componentes de **ação** e **formulário** — React tipados, acessíveis, alimentados pelos tokens da Fatia 02 e pelas primitivas Radix da Fatia 01. São a metade "entrada de dados" do conjunto essencial.

## Escopo

### Dentro

Cada componente: props tipadas (sem `any`); estados default/hover/focus/active/disabled/error quando aplicável; operação por teclado; nome/papel/estado corretos; estado **nunca só por cor** (PRD §14). Overlays/estado complexo vêm de Radix encapsulado em `ui`.

- **Ações (PRD §11.1):** Button, IconButton, ButtonGroup, Link. Variantes coerentes com os tokens (`action-primary/secondary/danger`); ação primária usa o acento; ação destrutiva usa `status-error`.
- **Formulários (PRD §11.2):** Field, Label, Input, PasswordInput, Textarea, Select, Combobox, Checkbox, RadioGroup, Switch, Slider, FormMessage.
  - `Select`, `Combobox`, `RadioGroup`, `Switch`, `Slider` sobre **Radix** (teclado/ARIA prontos).
  - `PasswordInput`: sem cópia acidental em superfícies de resumo (PRD §15); toggle de visibilidade acessível.
  - `FormMessage`: erro identifica problema **e** próxima ação (PRD §14), com texto + ícone (não só cor).

### Fora

- Card, Table, Tooltip, Progress, overlays (Dialog/Popover/DropdownMenu/Drawer), Toast, estados (Empty/Error/Loading) — **Fatia 03b**.
- Padrões operacionais e AppShell — Fatias 04a/04b.
- `ApiKeyField` (campo de chave BYOK) — é padrão operacional, Fatia 04b.

## Critérios de aceite

1. Cada componente é operável por **teclado** e expõe papel/estado corretos (Testing Library por papel).
2. Todo componente com estado usa **texto/ícone além de cor** (teste sem cor).
3. Componentes Radix (`Select`/`Combobox`/`RadioGroup`/`Switch`/`Slider`) não vazam a API do Radix ao consumidor (superfície pública própria).
4. `FormMessage` de erro traz problema + próxima ação (teste de conteúdo).
5. Componentes consomem **só tokens** da Fatia 02 (nenhum valor de cor/espaçamento fora dos tokens) — lint/revisão.
6. Fronteira verde: nenhum import de domínio/infra (regra ESLint da Fatia 01).
7. `npm run test` e `npm run lint` passam; evidência no `reports/TESTS.md`.

## Perguntas ao PI (pendentes)

Nenhuma — spec `aprovada-pi`.
