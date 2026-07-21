# MVP-001 — Fundação

- Tipo: épico (`proplan:mvp`). Container de fatias — **sem spec própria**.
- Status: **issue-épico criada** ([#1](https://github.com/RodReis/rrb-jarvisOS/issues/1)); **6 specs** `aprovada-pi` (2026-07-21) e **6 fatias-filhas em Backlog** (#2–#6 e **#8** — a 06 saiu como #8 porque o #7 já estava ocupado).
- Base: `docs/adr/adr-001-arquitetura-local-first.md`, `docs/plan/plano-especificacao-fundacao.md`.
- Dono do aceite: PI. O MVP só fecha quando **todas** as fatias abaixo forem fechadas pelo PI.

## Tese

Entregar o esqueleto real e verificável: um desktop app que abre, autentica de verdade (Google), separa NOA e JARVIS OS, e persiste em tray. Sem mocks de login, sem agente ainda. Valida bootstrap, IPC seguro, auth local-first e a fronteira de workspaces — as fundações de que todo o resto depende.

## Checklist de fatias previstas

Cada item vira issue-filha **somente** quando sua spec estiver `aprovada-pi`. As 6 aprovadas em 2026-07-21; todas as issues-filhas criadas (#2–#6 e #8).

- [ ] **Fatia 01 — Bootstrap e estrutura** (#2) → `docs/spec/spec-fundacao-01-bootstrap.md`
- [ ] **Fatia 02 — AppShell e WorkspaceSwitcher** (#3) → `docs/spec/spec-fundacao-02-appshell-workspaces.md`
- [ ] **Fatia 03 — Autenticação Google local-first** (#4) → `docs/spec/spec-fundacao-03-auth-google.md`
- [ ] **Fatia 04 — Modelo de dados mínimo + AuditEvent stub** (#5) → `docs/spec/spec-fundacao-04-dados-audit.md`
- [ ] **Fatia 05 — Settings mínimo** (#6) → `docs/spec/spec-fundacao-05-settings.md`
- [ ] **Fatia 06 — Observabilidade e Logging** (#8) → `docs/spec/spec-fundacao-06-observabilidade-logging.md`

## Ordem e dependências

01 → **06 (logging, infra transversal — roda cedo)** → 02 e 04 podem detalhar em paralelo → 03 depende de 01 → 05 por último. 04 sustenta 02 e 03. A 06 vem logo após a 01 porque 02–05 devem logar desde o início.

> Fatia 06 criada no board como **[#8](https://github.com/RodReis/rrb-jarvisOS/issues/8)** (Backlog, `proplan:backlog`, assignee PI, sub-issue do épico #1). Saiu #8 porque o número 7 já estava ocupado.

## Fora deste MVP (explicitamente adiado)

Execução de agentes, terminal, harnesses, Policy Engine completo, BudgetPolicy, providers de IA, conectores reais, Agent Memory/RAG/grafo, voz, SEO Content, Video Director, Email Outreach, Kanban, Workflows, Automations, sync bidirecional Supabase, design system formal (Storybook/matriz de regressão/WCAG-por-story).

## Critérios de done do MVP

- App Electron abre janela em Windows e persiste em tray ao minimizar.
- Login Google real; relançamento offline reusa a sessão; logout limpa estado sensível.
- Alternância NOA ⇄ JARVIS OS sem vazamento de navegação/estado; `Desenvolvimento` não aparece como workspace de usuário.
- Login, logout e troca de workspace geram `AuditEvent`.
- Renderer sem acesso a Node/segredos; IPC tipado e mínimo.
- `npm run dev`, `npm run test`, `npm run lint` passam.
