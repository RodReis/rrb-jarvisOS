# SPEC-Fundacao-02 — AppShell e WorkspaceSwitcher

- MVP: `docs/mvp/mvp-001-fundacao.md` (Fatia 02)
- Status: **aprovada-pi** (2026-07-21) — todas as perguntas abertas resolvidas pelo PI.
- Dependências: Fatia 01 entregue. Contratos de dados da Fatia 04 podem ser detalhados em paralelo (esta spec consome `Workspace`).

## Objetivo

Shell visual do app com sidebar, área de conteúdo e alternância NOA ⇄ JARVIS OS com isolamento real de navegação e estado. Tray persistente: o app continua ativo minimizado.

## Escopo

### Dentro

- **AppShell**: layout base (sidebar + header + área de conteúdo), estética command center escuro (alto contraste, legível — RNF-007), sem design system formal.
- **WorkspaceSwitcher** NOA ⇄ JARVIS OS:
  - Identidade visual clara do espaço ativo (nome + acento de cor distinto por espaço).
  - Navegação, rota e estado de UI **separados por workspace** — trocar de espaço não preserva a rota do outro espaço na tela.
  - Conteúdo placeholder estruturado (mesmo formato dos contratos reais — sem dados soltos).
  - `Desenvolvimento` **não aparece** como opção de workspace.
- Navegação lateral mínima por espaço (itens placeholder; lista completa de módulos fica para fatias futuras).
- **Tray**: ícone persistente; minimizar → some da taskbar e vive no tray; clique restaura; menu do tray com "Abrir" e "Sair". Fechar janela = minimizar para tray (comportamento padrão); "Sair" encerra de verdade.

### Fora

- Qualquer módulo funcional (Mission Control, Kanban etc.). Persistência do workspace ativo entre sessões usa storage local simples — o modelo definitivo é da Fatia 04. Auth (Fatia 03): nesta fatia o shell abre direto, sem login.

## Critérios de aceite

1. Alternância NOA ⇄ JARVIS OS funciona; navegação de um espaço não vaza no outro (teste automatizado: rota ativa do espaço A não aparece após trocar para B).
2. Espaço ativo é identificável visualmente em qualquer tela.
3. Minimizar leva ao tray; app segue rodando; restaurar preserva o estado da sessão.
4. "Sair" no tray encerra o processo por completo.
5. `Desenvolvimento` não é selecionável nem visível como workspace.
6. `npm run test` e `npm run lint` passam.

## Perguntas resolvidas pelo PI (2026-07-21)

1. Workspace ativo ao abrir: **sempre JARVIS OS** (comportamento determinístico; ignora último estado). — aprovado.
2. Fechar no "X" da janela: **minimizar para tray** (comportamento padrão, sem prompt). — aprovado.
