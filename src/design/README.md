# `src/design` — Design System da plataforma

Base visual única com duas identidades (NOA e JARVIS OS). Módulos internos do renderer —
**não** são pacotes publicados: reuso externo não é meta (MVP-003 §Decisões do PI, peso
leve solo+IA).

Esta fatia (SPEC-DesignSystem-01) entrega **estrutura, toolchain e fronteira**. Não há
token, cor ou componente de produto ainda — isso é das Fatias 02+.

## Camadas

| Camada | Papel | Pode depender de |
|---|---|---|
| `tokens` | Valores de design como CSS variables. **Sem React.** | nada |
| `ui` | Componentes de base, sem domínio | `tokens` + Radix + Lucide |
| `patterns` | Composições recorrentes | `ui` |

A seta aponta só para baixo: `patterns` → `ui` → `tokens`. Nenhuma camada volta.

## Base técnica

- **Tailwind CSS v4** — estilo. Os tokens são CSS variables, então trocar de tema troca
  **variável**, não classe.
- **Radix Primitives** — base headless acessível (focus-trap e ARIA prontos). Fica
  **encapsulado** em `ui`: o consumidor importa de `@design/ui`, nunca de
  `@radix-ui/*` direto (PRD §24). Wrapper com lista fechada de props — sem
  `extends SwitchProps`, sem `{...rest}`: senão a API do Radix vira contrato público do DS
  e trocar de primitivo quebra todo consumidor.
- **Lucide React** — ícones, importados individualmente.

## Regra de dependência (fronteira)

Nenhuma camada importa **domínio** (`@shared/*`, `@renderer/*`), **main process**,
**Electron/Node**, **Supabase**, filesystem, providers ou secrets. Dados, estado e
callbacks entram **só por props tipadas**.

Isso não é convenção escrita — é `no-restricted-imports` escopada a `src/design/**` em
`eslint.config.js`, e **quebra o `lint`**. `tests/design/fronteira.int-spec.ts` roda o
ESLint real nos dois sentidos (viola → vermelho; limpo → verde) e guarda o escopo: a regra
não pode vazar para o renderer, onde importar `@shared` é o desenho correto.

## Como testar

Sem Storybook e sem Playwright para o DS (suspensos — LANDSCAPE / MVP-003 §4).

```bash
npm run test          # tudo
npm run lint          # inclui a fronteira
```

Onde cada teste do DS cai, nas categorias do ADR-003:

| Arquivo | Categoria | Por quê |
|---|---|---|
| `tokens/tokens.spec.ts` | Regras | ambiente `node` — é o que **prova** "sem React" |
| `camadas.test.tsx` | Tela | componente em jsdom, a11y por papel (`role`) |
| `tests/design/fronteira.int-spec.ts` | Banco | escreve arquivo temporário para rodar o ESLint real |

## Convenções

- Componentes `PascalCase`, hooks `use*`, **export nomeado** (sem `default`).
- Props tipadas obrigatórias; `any` é erro de lint.
- A a11y se verifica por papel, não por classe CSS.
