# MVP-004 — Execução real (terminal + execução allowlisted)

> **Renumerado de MVP-003 → MVP-004 em 2026-07-21** (decisão do PI): o slot MVP-003 passou a ser o **Design System da Plataforma** (`docs/mvp/mvp-003-design-system-plataforma.md`). O conteúdo, a tese e as fatias abaixo são os mesmos do antigo MVP-003; muda só o número. **Pendência de board:** a issue-épico #10 precisa ser renumerada para refletir MVP-004 (ver STATUS.md).

- Tipo: épico (`proplan:mvp`). Container de fatias — **sem spec própria**.
- Status: **definido** (2026-07-21) — 2ª metade do Corte 2 (split aprovado pelo PI). Épico criado ([#10](https://github.com/RodReis/rrb-jarvisOS/issues/10) — renumeração pendente); fatias lazy. **BudgetPolicy movida para o MVP de providers (Corte 3)** — decisão do PI 2026-07-21.
- Base: `docs/iniciais/requisitos-agent-os.md` § Corte 2; ADR-001 (local-first), ADR-004 (auditoria), ADR-005 (logging).
- Depende de: **MVP-002 entregue** (Policy Engine, allowlist, execução simulada auditada). Sem essa base, não há guardrail para ligar a execução real. Independe do MVP-003 (Design System): o terminal reusa componentes do DS quando existirem, mas a carga de segurança é backend.
- Dono do aceite: PI. Só fecha quando todas as fatias-filhas fecharem.

## Tese

Ligar a **execução real com guardrails**. O motor sai do modo simulado (MVP-002) e passa a tocar recurso real — mas **nada roda sem permissão, allowlist e auditoria**. Entra o terminal controlado no Desktop. É a metade **de risco** do Corte 2, deliberadamente separada da fundação de execução para não concentrar terminal + execução real num único épico.

## Checklist de fatias previstas

Cada item vira issue-filha **somente** quando sua spec estiver `aprovada-pi` (lazy). Ainda sem spec:

- [ ] **Fatia 01 — Execução real allowlisted:** o motor do MVP-002 passa a executar de verdade **dentro da allowlist + Policy Engine**, fail-closed, auditado (ADR-004) e logado (ADR-005). Toda execução real gera `AuditEvent` antes e depois.
- [ ] **Fatia 02 — Terminal controlado no Desktop:** terminal dentro das permissões e da allowlist; comando fora do permitido é bloqueado; sessão auditada e logada.

> **BudgetPolicy saiu deste MVP.** Ela só mede **gasto com providers de IA**, que só existem no Corte 3; construí-la aqui seria o guarda antes de existir o que guardar. Foi movida para o **MVP de providers (Corte 3)**. O modelo já está decidido (ADR-001, questão 1): **estimativa + alerta com bloqueio no ponto único de chamada** do adapter — não proxy.

## Ordem e dependências

MVP-002 entregue → 01 (execução real) → 02 (terminal, consumidor do motor real).

## Fora deste MVP (→ Corte 3+)

- Providers de IA configuráveis, conectores reais, vault de credenciais, métricas reais de custo.
- Memória híbrida + RAG, sync bidirecional.
- Voz, crons, squads, Power Guard (Corte 4).

## Critérios de done do MVP

- Execução real só ocorre **dentro da allowlist e do Policy Engine** (fail-closed); tentativa fora é bloqueada e auditada.
- Toda execução real gera `AuditEvent` (antes/depois) e logs (ADR-005).
- Terminal controlado: comando permitido roda; comando fora do allowlist/permissões é barrado, com evidência.
- `npm run dev`, `npm run test`, `npm run lint` passam; evidência no `reports/TESTS.md`.
