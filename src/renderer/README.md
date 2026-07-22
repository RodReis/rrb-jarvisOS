# `src/renderer` — interface (React)

A UI dos espaços NOA e JARVIS OS. Roda **sandboxed, sem acesso a Node**: sem
`require`, sem `process`, sem `fs`, sem rede direta a segredo.

| Caminho | Papel |
|---|---|
| `index.html` | Documento raiz, com a CSP restritiva |
| `src/main.tsx` | Ponto de entrada do React |
| `src/app/` | Composição da aplicação (AppShell chega na Fatia 02) |
| `src/styles/` | Tailwind e tokens base |

## Regras

- **Toda comunicação com o main passa por `window.jarvis`** — a ponte tipada do
  preload. Se algo não está no contrato, o renderer não faz.
- Componentes consomem os tipos de `src/shared/contracts`, nunca objetos soltos.
- Sem segredo, sem caminho de disco, sem variável de ambiente crua na UI.
- Design system formal é o MVP-003; aqui, Tailwind + Radix ad-hoc.

## Testes

`*.test.tsx` com Vitest + Testing Library em jsdom (categoria *Tela*). O E2E
Playwright-Electron entra na Fatia 03. Ver `docs/TESTING.md`.
