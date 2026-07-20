# SPEC-Fundacao-03 — Autenticação Google local-first

- MVP: `docs/mvp/mvp-001-fundacao.md` (Fatia 03)
- Status: **rascunho** — vira `aprovada-pi` quando as perguntas abertas estiverem resolvidas.
- Dependências: Fatia 01 entregue. Consome contratos da Fatia 04 (`UserProfile`, `Session`, `AuditEvent`).
- Decisões que sustentam esta spec: ADR-001 (local-first) e **ADR-002** (OAuth dev via projeto Supabase de desenvolvimento na nuvem).

## Objetivo

Login Google real via Supabase Auth, com sessão persistida localmente para uso offline em relançamentos. Primeiro login exige internet; depois o app opera com sessão cacheada. Logout limpa estado sensível.

## Escopo

### Dentro

- Fluxo OAuth Google via Supabase Auth (projeto de **desenvolvimento na nuvem** — ADR-002). O fluxo abre no navegador do sistema (nunca em webview do Electron) e retorna via deep link/loopback.
- Persistência local da sessão (tokens) em armazenamento do **main process** — nunca no renderer, nunca em `localStorage`.
- Estados de auth explícitos na UI: `deslogado`, `autenticando`, `ativo`, `erro`, `sessao-expirada`.
- Relançamento offline: sessão cacheada válida → entra direto; expirada e offline → modo `sessao-expirada` com aviso e opção de reautenticar quando online.
- Logout: revoga sessão (quando online), apaga tokens locais, limpa estado do renderer, volta para `deslogado`.
- Perfil mínimo carregado no login: nome, e-mail, idioma padrão `pt-BR`.
- `AuditEvent` de `login`, `logout` e `login-offline-reuse` (via stub da Fatia 04).

### Fora

- Sync de dados com o cloud (só auth nesta fatia). Multi-conta simultânea. Outros provedores OAuth. Refresh silencioso agressivo — regra simples primeiro.

## Critérios de aceite

1. Login Google completa e o app mostra nome/e-mail do usuário.
2. Relançar o app **sem internet** com sessão válida → usuário entra sem novo login.
3. Logout limpa tokens e estado sensível do renderer (verificável em teste).
4. Renderer nunca vê tokens — apenas um snapshot mínimo de perfil via IPC tipado.
5. Cada transição de auth gera `AuditEvent` com timestamp e user_id.
6. Estados de erro têm mensagem clara (sem stack trace na UI).
7. `npm run test` e `npm run lint` passam; fluxo principal coberto por teste (mock do Supabase nos unitários; e2e feliz com Playwright se viável nesta fatia).

## Perguntas abertas ao PI (bloqueiam aprovação)

1. **Duração da sessão offline** (questão aberta 2 do ADR-001): quanto tempo o app aceita operar com sessão cacheada sem conseguir revalidar online? Proposta do Cowork: 30 dias, depois exige reautenticação.
2. Retorno do OAuth: deep link (`jarvisos://auth`) ou servidor loopback local temporário? Proposta: loopback (mais confiável no Windows em dev).
