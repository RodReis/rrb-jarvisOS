# SPEC-Execucao-05 — Motor de execução em modo simulado

- MVP: `docs/mvp/mvp-002-execucao-local-controlada.md` (Fatia 05) — **headline do MVP-002**.
- Status: **aprovada-pi** (2026-07-21).
- Dependências: MVP-001 entregue (SQLite, `AuditEvent`/hash-chain, logging). **Fatia 02** (classifica cada etapa), **Fatia 03** (checa paths na allowlist), **Fatia 04** (lê as definições de workflow/automação). É a fatia que junta as três.
- Decisões que sustentam esta spec: requisitos RF-006 ("cada execução gera rastreio auditável"; estados de execução), § Corte 2 ("execução simulada... com logs e auditoria"); ADR-004 (auditoria); ADR-005 (logging).

## Objetivo

O **motor de execução em modo simulado**: lê uma definição (Fatia 04), percorre suas etapas **sem tocar recurso real**, **classificando** cada etapa via Policy Engine (Fatia 02) e **checando** paths na allowlist (Fatia 03), e produz um **`ExecutionRun`** rastreável — **auditado** (ADR-004) e **logado** (ADR-005). Prova o caminho seguro de execução ponta a ponta com **zero efeito colateral**. Executar de verdade (tocar FS/terminal/rede/provider) é **MVP-003**.

## Escopo

### Dentro

- **Motor de execução simulada** no main/runtime: recebe um `workflowId` (ou descritor de ação avulso) via **gatilho manual** (Fatia 04) e percorre as etapas conforme o schema (`sequencial | paralelo`).
- **Por etapa:**
  1. **Classifica** via Policy Engine (Fatia 02) — a `Decision` é registrada (**modo report**, não bloqueia);
  2. Se a etapa referencia um path, **checa a allowlist** (Fatia 03) — resultado registrado (**não barra**);
  3. **Simula** a ação — **nenhum efeito real** (nada de FS, rede, terminal ou provider); produz um resultado simulado.
- **`ExecutionRun` persistido** (SQLite, escopo `user_id`/`workspace_id`) com:
  - **Máquina de estados RF:** `planejado → em execução → concluído | falhou | cancelado`. `aguardando aprovação` é **registrado como marco**, mas o run **auto-continua** (não há fluxo de aprovação até o MVP-003).
  - **Trace por etapa:** ação, `Decision` de política, checagem de allowlist, resultado simulado, timing.
- **Simulação determinística:** etapa simula **sucesso por padrão**; uma etapa pode declarar simular **falha**, para exercitar `falhou` e o caminho de retentativa. Sem aleatoriedade.
- **Paralelo** é honrado **semanticamente** (etapas de um grupo paralelo são independentes) — o simulador não exige concorrência real.
- **Auditoria:** início/fim do run e cada etapa significativa geram `AuditEvent` encadeado (ADR-004) — "cada execução gera rastreio auditável" (RF-006).
- **Logging:** o run e as etapas são logados (ADR-005), com um `correlationId` do run casando as entradas.
- **Zero efeito colateral é invariante desta fatia:** nenhum caminho toca FS real, rede, terminal ou provider. Tudo simulado.
- Renderer **dispara** o run via **IPC tipado** (gatilho manual) e vê o `ExecutionRun`/trace via contrato; o motor roda no **main**.

### Fora

- **Execução real** (tocar FS/terminal/rede/provider) — MVP-003, com **enforcement** do Policy Engine e **gating** da allowlist ligados (aqui ambos são report).
- **Fluxo de aprovação humana** (pausar de verdade em `aguardando aprovação` e retomar) — MVP-003; aqui **auto-continua**.
- **Scheduler** (cron/evento/webhook) — Corte 4; aqui **só gatilho manual**.
- **Power Guard, retentativa real, agentes/skills reais** — Corte 3/4.
- **Métricas de custo (Costs)** — Corte 3 (providers; nada custa em simulação).

## Critérios de aceite

1. Dado um workflow (Fatia 04) e gatilho manual, o motor produz um **`ExecutionRun` persistido** com trace por etapa (ação, decisão de política, checagem de allowlist, resultado simulado, timing) e estado final `concluído` no caminho feliz. Escopo `user_id`/`workspace_id`.
2. **Zero efeito colateral:** nenhuma etapa toca FS real, rede, terminal ou provider. Teste: run de workflow com etapa "gravar arquivo" **não** cria arquivo — só registra "simulado".
3. Cada etapa é **classificada** pelo Policy Engine (F02, modo report — não bloqueia) e, se referencia path, **checada** contra a allowlist (F03 — não barra); ambos os resultados aparecem no trace.
4. Estado **`falhou`:** uma etapa marcada para simular falha leva o run a `falhou`, com o trace registrando o ponto; o caminho de retentativa é exercitado (sem execução real).
5. **`aguardando aprovação`:** etapa `requiresApproval` é registrada como marco e o run **auto-continua** (não há fluxo de aprovação até o MVP-003) — verificável no trace.
6. Início/fim do run e etapas geram `AuditEvent` encadeado (ADR-004); `verifyChain` passa. O run é logado (ADR-005) com `correlationId`.
7. Renderer dispara via IPC tipado; o motor roda no main; renderer sem acesso a Node/FS/segredo.
8. `npm run test` e `npm run lint` passam; evidência no `reports/TESTS.md` (Regras + Banco).

## Perguntas resolvidas pelo PI (2026-07-21)

1. **Definição da fatia (confirmada):** execução **simulada, zero efeito colateral, auditada e logada** — a execução real fica no MVP-003. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **`ExecutionRun` persistido** com a máquina de estados RF completa — consistente com o "schema pleno" escolhido na Fatia 04.
- **Simulação determinística:** sucesso por padrão, falha **declarável** para testar `falhou`/retentativa.
- **`aguardando aprovação` auto-continua** na simulação (o fluxo de aprovação é MVP-003).
- **Paralelo** honrado semanticamente, sem exigir concorrência real no simulador.
