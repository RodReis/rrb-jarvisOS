# DECISIONS.md — Índice de ADRs

**Ler antes de propor qualquer mudança estrutural.** ADRs individuais vivem em `docs/adr/`. Formato: `adr-NNN-slug.md` com Status, Data, Problema, Decisão, Consequências. ADR aceito só sai de vigor por outro ADR que o substitua explicitamente.

## Índice

| ADR | Título | Status | Resumo |
|---|---|---|---|
| [ADR-001](adr/adr-001-arquitetura-local-first.md) | Arquitetura local-first com sync cloud | Aceito | Local é fonte de verdade operacional; Supabase Cloud é espelho de sync/auth/auditoria. Multiusuário por conta, não multi-tenant server-side. Agentes rodam com app ativo (inclusive tray); não sobrevivem a logout/reboot. Corrige decisões #3, #4 e #10 do PRD de design system. RF-020 fora do MVP. |
| [ADR-002](adr/adr-002-supabase-dev-nuvem-oauth.md) | Projeto Supabase de dev na nuvem para OAuth | Aceito | OAuth Google em dev usa projeto Supabase na nuvem (só auth). Supabase local Docker entra na fase de persistência/RLS. |
| [ADR-003](adr/adr-003-relatorio-testes-evidencia.md) | Relatório de evidência de testes gerado por máquina | Aceito (metodologia; código na Fatia 01) | Números só do `--json` dos runners (Vitest/Playwright), nunca à mão. `reports/TESTS.md` incremental append-only, 3 categorias (Banco/Regras/Tela), guarda anti-drift no CI com baseline no git da base do PR + self-check. Cobertura report-only. Adaptado do `rrb-proplan` à stack Electron. Ver `docs/TESTING.md`. |

## Decisões de processo (não-ADR, registradas aqui)

| Data | Decisão | Decisor |
|---|---|---|
| 2026-07-19 | MVP-001 Fundação estruturado como épico com **5 fatias** (uma por spec), substituindo a "fatia única com 5 specs" do plano original | PI |
| 2026-07-19 | `CONVENTION.md` cobre processo (labels `proplan:*`) **e** contrato de dados das entidades | PI |
| 2026-07-18 | Processo de design system formal do PRD **suspenso** para time solo + IA (Tailwind + Radix ad-hoc, tokens mínimos) | PI (via plano de fundação) |

## Questões abertas (herdam do ADR-001; resolver antes das fatias que dependem delas)

1. **BudgetPolicy com BYOK**: estimativa + alerta vs. proxy para bloqueio real. Bloqueia: Corte 3 (providers reais).
2. **Duração da sessão offline**: proposta de 30 dias na SPEC-Fundacao-03 — pendente de aprovação do PI. Bloqueia: aprovação da SPEC-03.
3. **Conflitos de sync multi-dispositivo**: last-write-wins vs. merge por entidade. Bloqueia: sync bidirecional (Corte 3+).
