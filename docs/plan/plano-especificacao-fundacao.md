# Plano de Especificação: Fatia Fundação

> **Atualização 2026-07-19 (decisão do PI):** a Fundação foi reestruturada como **MVP-001 (épico) com 5 fatias** — uma por spec — em vez de fatia única. Ver `docs/mvp/mvp-001-fundacao.md` e `docs/spec/spec-fundacao-01..05`. A questão do Supabase para OAuth foi resolvida no **ADR-002** (projeto dev na nuvem). Este plano permanece como registro do racional de escopo.

- Status: em planejamento.
- Data: 18 de julho de 2026.
- Base de decisão: `docs/adr-001-arquitetura-local-first.md`.
- Objetivo deste doc: definir o que a primeira fatia entrega, quais specs escrever,
  em que ordem, e quando ela está pronta. Não é a spec — é o plano para escrevê-la.

## Tese da fatia

Entregar o esqueleto real e verificável: um desktop app que abre, autentica de
verdade (Google), separa NOA e JARVIS OS, e persiste em tray. Sem mocks de login,
sem agente ainda. Isso valida bootstrap, IPC seguro, auth local-first e a fronteira
de workspaces — as fundações de que todo o resto depende.

Escopo fechado deliberadamente. Fora daqui é a próxima fatia, não este release.

## Escopo

### Dentro

- Bootstrap Electron + React + TypeScript + Vite (Fase 0 do plano).
- IPC seguro: `contextIsolation` ligado, `nodeIntegration` desligado, ponte via preload
  tipada. Renderer nunca acessa Node nem segredo direto.
- Janela desktop + ícone de tray persistente (app continua ativo minimizado; encerra em
  logout/quit).
- AppShell mínimo: layout, sidebar, área de conteúdo.
- WorkspaceSwitcher NOA ⇄ JARVIS OS: navegação, dados e estado visual separados por
  espaço (mesmo que o conteúdo ainda seja placeholder estruturado).
- Autenticação Google via Supabase Auth: login, persistência de sessão para uso offline,
  logout. Primeiro login online; relançamentos usam sessão cacheada.
- Perfil de usuário mínimo: nome, e-mail, idioma padrão `pt-BR`.
- Modelo de dados mínimo local: `UserProfile`, `Workspace`, `Session`, `AuditEvent` (stub).
- AuditEvent stub: registrar login, logout e troca de workspace. Estabelece o padrão de
  auditoria cedo, sem construir o Policy Engine completo.
- Settings mínimo: idioma e tema (claro/escuro via preferência do SO).

### Fora (próximas fatias, explicitamente adiado)

- Qualquer execução de agente, terminal, harnesses.
- Policy Engine completo, BudgetPolicy, providers de IA, conectores reais.
- Agent Memory / RAG / grafo de conceitos (a peça mais pesada — não começa aqui).
- Voz, SEO Content, Video Director, Email Outreach, Kanban, Workflows, Automations.
- Supabase Cloud sync bidirecional (nesta fatia, auth + escrita local; sync completo depois).
- Design system formal: sem Storybook, sem matriz de regressão visual, sem WCAG-por-story.

### Corte de processo para solo + IA

O processo de DS do PRD (Storybook como catálogo, Vitest+Testing Library+Playwright em
matriz claro/escuro × densidade × cor extrema × 7 estados, WCAG AA em toda story,
versionamento semântico com guia de migração, fluxo de governança de 9 passos) fica
**suspenso**. Nesta fatia: Tailwind + Radix ad-hoc, tokens mínimos num arquivo, testes
só nos caminhos de auth e troca de workspace. O design system formal volta se e quando
houver time para mantê-lo.

## Specs a produzir (ordem)

1. **SPEC-Fundacao-01 — Bootstrap e estrutura.** Stack fixada, estrutura de pastas
   (`src/main`, `src/renderer`, `src/shared`), scripts `dev/build/lint/test`, config de
   IPC seguro. Critério: app abre janela em Windows, teste e lint passam.
2. **SPEC-Fundacao-02 — AppShell e WorkspaceSwitcher.** Layout, sidebar, troca NOA/JARVIS,
   isolamento de navegação por espaço. Contratos de navegação (mesmo formato dos dados reais).
3. **SPEC-Fundacao-03 — Autenticação Google local-first.** Fluxo OAuth via Supabase Auth,
   persistência e reuso offline de sessão, logout, estados (deslogado, autenticando, ativo,
   erro, sessão expirada). Resolve questão aberta 2 do ADR.
4. **SPEC-Fundacao-04 — Modelo de dados mínimo + AuditEvent stub.** Entidades locais,
   campos de escopo (`user_id`, `workspace_id`), registro de eventos de auth e troca de espaço.
5. **SPEC-Fundacao-05 — Settings mínimo.** Idioma `pt-BR` padrão, tema claro/escuro por SO.

Escrever na ordem. 01 e 02 podem ser detalhados em paralelo depois que a estrutura estiver
fixada; 03 depende de 01; 04 sustenta 02 e 03.

## Critérios de done da fatia

- App Electron abre janela em Windows e persiste em tray ao minimizar.
- Usuário faz login com Google; ao relançar offline, a sessão é reusada.
- Logout encerra a sessão e limpa o estado sensível do renderer.
- Alternância NOA ⇄ JARVIS OS funciona; navegação de um espaço não vaza no outro.
- `Desenvolvimento` não aparece como workspace de usuário.
- Login, logout e troca de workspace geram `AuditEvent`.
- Renderer não tem acesso a Node nem lê segredo; IPC é tipado e mínimo.
- `npm run dev`, `npm run test`, `npm run lint` passam.

## Dependências e riscos desta fatia

- OAuth Google exige configurar credenciais no Supabase (local dev vs. projeto real).
  Decidir se o dev usa Supabase local Docker com provider Google configurado ou um projeto
  Supabase de desenvolvimento na nuvem.
- Sessão offline: definir duração antes de exigir reautenticação (questão aberta 2 do ADR).
- Risco de recair no escopo grande: qualquer item da lista "Fora" que aparecer nesta fatia
  deve ser recusado e mandado para a próxima.

## Pendências de higiene do repositório

- Os 4 documentos originais estão duplicados idênticos em `/` e `/docs/`. O plano aponta
  `docs/` como fonte de verdade. Recomendo apagar as cópias da raiz para evitar edições
  divergentes. (Não fiz isso ainda — confirma que pode.)

## Próximo passo

Escrever `SPEC-Fundacao-01`. Antes, uma decisão trava: Supabase local Docker com Google
provider, ou projeto Supabase de dev na nuvem para o OAuth?
