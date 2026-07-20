# DEVELOPMENT.md — Ordem de execução e status

**Dono: Claude Code.** Atualize este arquivo a cada entrega, junto com `STATUS.md`. Aqui vive o *"onde estou dentro da fatia"* (passos com checkmarks); o *"qual fatia está em qual coluna"* vive nas GitHub Issues / `STATUS.md`. Nenhum fato mora nos dois lugares.

Regra de trabalho: **uma fatia por vez (WIP = 1)**, na ordem abaixo. Só iniciar fatia com spec `aprovada-pi` e issue criada.

## MVP-001 — Fundação

### Fatia 01 — Bootstrap e estrutura (`docs/spec/spec-fundacao-01-bootstrap.md`)

Status: **aguardando aprovação da spec** (2 perguntas abertas ao PI).

- [ ] Scaffold Electron + React + TS + Vite (decisão electron-vite pendente)
- [ ] Estrutura `src/main` / `src/renderer` / `src/shared` com READMEs
- [ ] IPC seguro: contextIsolation on, nodeIntegration off, sandbox on, preload tipado
- [ ] Scripts dev/build/lint/test configurados
- [ ] Tailwind configurado
- [ ] Teste de fumaça: janela abre; renderer sem acesso a Node
- [ ] Entrega: PR com `refs #N`; docs/ commitados

### Fatia 02 — AppShell e WorkspaceSwitcher (`docs/spec/spec-fundacao-02-appshell-workspaces.md`)

Status: aguardando aprovação da spec (2 perguntas abertas). Depende da Fatia 01.

- [ ] Layout AppShell (sidebar, header, conteúdo)
- [ ] WorkspaceSwitcher NOA ⇄ JARVIS com identidade visual por espaço
- [ ] Isolamento de navegação/estado por workspace + teste
- [ ] Tray: minimizar persiste, restaurar, menu Abrir/Sair
- [ ] Entrega: PR `refs #N`; docs/ commitados

### Fatia 03 — Autenticação Google local-first (`docs/spec/spec-fundacao-03-auth-google.md`)

Status: aguardando aprovação da spec (2 perguntas abertas, incl. duração da sessão offline). Depende da Fatia 01; consome contratos da 04.

- [ ] Projeto Supabase dev na nuvem configurado (ADR-002); env local sem segredo commitado
- [ ] Fluxo OAuth no navegador do sistema + retorno (loopback/deep link — decisão pendente)
- [ ] Persistência de sessão no main process; renderer só vê snapshot de perfil
- [ ] Estados: deslogado / autenticando / ativo / erro / sessão-expirada
- [ ] Relançamento offline reusa sessão; logout limpa estado sensível
- [ ] AuditEvents de login/logout/login-offline-reuse
- [ ] Testes do fluxo (unit com mock; e2e feliz se viável)
- [ ] Entrega: PR `refs #N`; docs/ commitados

### Fatia 04 — Modelo de dados mínimo + AuditEvent stub (`docs/spec/spec-fundacao-04-dados-audit.md`)

Status: aguardando aprovação da spec (2 perguntas abertas, incl. SQLite vs JSON). Sustenta 02 e 03 — contratos podem ser detalhados em paralelo à 02.

- [ ] Contratos `UserProfile`, `Workspace`, `Session`, `AuditEvent` em `src/shared`
- [ ] Persistência local no main process (storage: decisão pendente)
- [ ] AuditEvent append-only (sem update/delete)
- [ ] Registro de workspace-switch + eventos de auth
- [ ] Testes de isolamento por `user_id` e `workspace_id`
- [ ] Entrega: PR `refs #N`; docs/ commitados

### Fatia 05 — Settings mínimo (`docs/spec/spec-fundacao-05-settings.md`)

Status: aguardando aprovação da spec (1 pergunta aberta: i18n). Depende de 01–04.

- [ ] Tela Settings acessível nos dois espaços
- [ ] Idioma pt-BR/en-US com troca a quente; infra i18n mínima
- [ ] Tema claro/escuro/sistema com persistência por usuário
- [ ] Testes de persistência de preferências
- [ ] Entrega: PR `refs #N`; docs/ commitados

## Após o MVP-001

Próximo MVP provável: **Execução local controlada** (Supabase local Docker + RLS, Policy Engine, terminal allowlisted, BudgetPolicy) — Cowork especifica quando o PI priorizar. Ordem macro em `docs/LANDSCAPE.md` § Roadmap.

## Registro de entregas

| Data | Fatia | PR | Observação |
|---|---|---|---|
| — | — | — | nenhuma entrega ainda |
