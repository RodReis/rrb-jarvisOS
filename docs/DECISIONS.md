# DECISIONS.md — Índice de ADRs

**Ler antes de propor qualquer mudança estrutural.** ADRs individuais vivem em `docs/adr/`. Formato: `adr-NNN-slug.md` com Status, Data, Problema, Decisão, Consequências. ADR aceito só sai de vigor por outro ADR que o substitua explicitamente.

## Índice

| ADR | Título | Status | Resumo |
|---|---|---|---|
| [ADR-001](adr/adr-001-arquitetura-local-first.md) | Arquitetura local-first com sync cloud | Aceito | Local é fonte de verdade operacional; Supabase Cloud é espelho de sync/auth/auditoria. Multiusuário por conta, não multi-tenant server-side. Agentes rodam com app ativo (inclusive tray); não sobrevivem a logout/reboot. Corrige decisões #3, #4 e #10 do PRD de design system. RF-020 fora do MVP. |
| [ADR-002](adr/adr-002-supabase-dev-nuvem-oauth.md) | Projeto Supabase de dev na nuvem para OAuth | Aceito | OAuth Google em dev usa projeto Supabase na nuvem (só auth). Supabase local Docker entra na fase de persistência/RLS. |
| [ADR-003](adr/adr-003-relatorio-testes-evidencia.md) | Relatório de evidência de testes gerado por máquina | Aceito (metodologia; código na Fatia 01) | Números só do `--json` dos runners (Vitest/Playwright), nunca à mão. `reports/TESTS.md` incremental append-only, 3 categorias (Banco/Regras/Tela), guarda anti-drift no CI com baseline no git da base do PR + self-check. Cobertura report-only. Adaptado do `rrb-proplan` à stack Electron. Ver `docs/TESTING.md`. |
| [ADR-004](adr/adr-004-auditoria-prova-adulteracao.md) | Auditoria à prova de adulteração | Aceito | `AuditEvent` tamper-evident: trigger SQLite bloqueia UPDATE/DELETE + hash-chain HMAC-SHA-256 por usuário (`seq`/`prev_hash`/`hash`, chave no `safeStorage`/DPAPI) + `verifyChain()` verificável em teste. Tamper-evident, não tamper-proof — âncora externa fica para o sync (Corte 3+). Aplica na SPEC-Fundacao-04. |
| [ADR-005](adr/adr-005-observabilidade-logging.md) | Observabilidade e logging estruturado | Aceito | `electron-log` (renderer, via IPC) + `winston`/`daily-rotate-file` (main, escritor único). JSON estruturado, msg pt-BR, categorias (integração/ai/agent/db/auth/ipc/ui/sistema), tag `workspace`. Retenção por nível (info 3d/warn 7d/error 10d) zipada e local; redaction obrigatória. Log ≠ AuditEvent. Monitor visual e envio à nuvem ficam para depois. Fatia 06, roda cedo. |

## Decisões de processo (não-ADR, registradas aqui)

| Data | Decisão | Decisor |
|---|---|---|
| 2026-07-22 | **Prioridade no board via marcador único `proplan:next`** (Opção A). A ordem completa da fila vive só no `docs/STATUS.md` (fonte única); `next` projeta a cabeça dela no board. Marcador, não coluna — coexiste com `proplan:backlog`, no máximo um aberto. Rejeitada a ordenação ordinal no título/label (viraria segunda fonte da fila → drift). Registrado em CONVENTION §1. | PI |
| 2026-07-22 | **SPEC-Fundacao-06 emendada:** critério 5 e nota de escopo corrigidos — instrumentação de `auth`/`workspace-switch`/`db` migra para F03/F02/F04 (cada uma com critério de aceite de logging dedicado), porque esse código não existe quando o F06 executa. O F06 entrega infra + contrato (CONVENTION §3) e instrumenta só `ipc`/`sistema`. | PI |
| 2026-07-19 | MVP-001 Fundação estruturado como épico com **5 fatias** (uma por spec), substituindo a "fatia única com 5 specs" do plano original | PI |
| 2026-07-19 | `CONVENTION.md` cobre processo (labels `proplan:*`) **e** contrato de dados das entidades | PI |
| 2026-07-18 | Processo de design system formal do PRD **suspenso** para time solo + IA (Tailwind + Radix ad-hoc, tokens mínimos) | PI (via plano de fundação) |
| 2026-07-21 | **Cifra de dados sensíveis.** Local: tokens/segredos em disco via `safeStorage`/**DPAPI** (chave do usuário do SO) — vale já na SPEC-Fundacao-03. Cloud: dados sensíveis sincronizados ao Supabase vão **E2EE, cifrados na máquina com AES-256**; o cloud nunca vê texto claro — aplica quando o sync entrar (Corte 3+). | PI |
| 2026-07-21 | **Papel SQLite ↔ Supabase.** SQLite é o banco **interno embutido** da aplicação — fonte de verdade operacional local (confirma ADR-001/004); isolamento por `user_id`/`workspace_id`. Supabase é o **alvo de sincronização na nuvem** (dev: Supabase local em Docker; RLS vale no lado Supabase). Confirma ADR-001, não altera. Governa a Fatia 01 do MVP-002. | PI |
| 2026-07-21 | **Corte 2 dividido em dois MVPs.** MVP-002 = fundação de execução (Supabase local, permissões/Policy Engine, allowlist, registro de workflows, execução simulada auditada). MVP-003 = terminal + execução real allowlisted + BudgetPolicy. Evita concentrar risco. | PI |

## Questões abertas (herdam do ADR-001; resolver antes das fatias que dependem delas)

1. ~~**BudgetPolicy com BYOK**: estimativa + alerta vs. proxy para bloqueio real.~~ **Resolvida (2026-07-21, PI):** estimativa + alerta com **bloqueio no ponto único de chamada** (adapter recusa novas chamadas ao bater o limite; sem proxy). Registrada no ADR-001 (questão aberta 1). **A BudgetPolicy mora no MVP de providers (Corte 3)**, não no MVP-003 — só há gasto a medir quando os providers existirem.
2. ~~**Duração da sessão offline**: proposta de 30 dias na SPEC-Fundacao-03 — pendente de aprovação do PI.~~ **Resolvida (2026-07-21, PI): 30 dias** (registrada no ADR-001 §Questões abertas 2; aplicada na SPEC-Fundacao-03).
3. **Conflitos de sync multi-dispositivo**: last-write-wins vs. merge por entidade. Bloqueia: sync bidirecional (Corte 3+).
