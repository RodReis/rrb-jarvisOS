# SPEC-DesignSystem-03b — Componentes: dados + overlays + feedback

- MVP: `docs/mvp/mvp-003-design-system-plataforma.md` (Fatia 03b)
- Status: **aprovada-pi** (2026-07-21) — split 03→03a/03b aprovado; base Radix+Tailwind definida na Fatia 01.
- Dependências: Fatia 02 (tokens/tema) e Fatia 01 (Radix+Tailwind). Pode andar em paralelo com 03a.
- Decisões que sustentam esta spec: PRD §11.4/§11.5 (dados, overlays/feedback), §12.6 (notificações), §13 (toast); protótipo README §5 (Toast) e §2.6 (toasts sempre escuros); base **Radix**; peso leve.

## Objetivo

Entregar os componentes de **exibição de dados**, **overlays** e **feedback** — incluindo o **Toast** unificado (fiel ao protótipo) e a **NotificationCenter**. É a metade "saída/estrutura" do conjunto essencial.

## Escopo

### Dentro

Mesmas regras de a11y da 03a. Overlays sobre **Radix** encapsulado em `ui`.

- **Exibição de dados (PRD §11.4):** Card, Panel, Badge, Tag, Avatar, Table, Tree, Separator, Tooltip, Progress, Meter, Skeleton, Spinner, EmptyState. Números com `tabular-nums`; barras/progress com trilho + fill em token.
- **Overlays (PRD §11.5, Radix):** Popover, DropdownMenu, Dialog, AlertDialog, Drawer — focus-trap, `Escape` fecha sem perda silenciosa, retorno de foco ao gatilho.
- **Feedback (PRD §11.5):** InlineAlert, ErrorState, LoadingState.
- **Toast unificado — fiel ao protótipo (README §5) + a11y (PRD §13):** variantes `success/info/warning/error` (cores/glyphs do protótipo); **máx. 5** simultâneos; auto-dismiss **4200 ms**; container `top:64px right:22px width:360px`; card glass (`blur(14px)`, raio 13px) + barra lateral 3px + **sheen** + **barra de progresso**; `stamp` HH:MM:SS; `×`. **Toasts sempre escuros** mesmo com `uiTheme='light'` (README §2.6). A11y: pausa em hover/foco; `success/info` não interruptivo, `warning/error` prioritário sem mover foco; dedupe. **Ação destrutiva usa AlertDialog, nunca só toast.**
- **Notificações (PRD §12.6):** ToastViewport, NotificationCenter, NotificationItem, UnreadIndicator — recebem a lista por props (persistência é dos dados, SPEC-Fundacao-04).

### Fora

- Ações e formulários — **Fatia 03a**.
- Padrões operacionais compostos (AgentStatus, ApprovalCard, ExecutionCard, LogViewer…) e AppShell — Fatias 04a/04b.
- Mascote/HUD de voz — Fatia 05.

## Critérios de aceite

1. Overlays (Dialog/Popover/DropdownMenu/Drawer) têm focus-trap, `Escape` para fechar e retorno de foco (Testing Library).
2. **Toast**: variante correta; timer pausa em hover/foco; máx. 5; dedupe; **permanece escuro** no `uiTheme='light'` (testes).
3. **AlertDialog** exige verbo específico e é o caminho de ação destrutiva — toast não confirma destrutivo (teste de contrato).
4. Estado (Badge/Progress/InlineAlert/EmptyState/ErrorState) identificável **sem cor** (texto/ícone).
5. Componentes consomem **só tokens** da Fatia 02; Radix não vaza ao consumidor.
6. Fronteira verde (regra ESLint da Fatia 01).
7. `npm run test` e `npm run lint` passam; evidência no `reports/TESTS.md`.

## Perguntas ao PI (pendentes)

Nenhuma — spec `aprovada-pi`. (Máx. de toasts = **5**, fiel ao protótipo — decisão registrada.)
