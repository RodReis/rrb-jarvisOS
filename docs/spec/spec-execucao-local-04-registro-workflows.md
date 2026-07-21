# SPEC-Execucao-04 — Registro de workflows + automações manuais

- MVP: `docs/mvp/mvp-002-execucao-local-controlada.md` (Fatia 04)
- Status: **aprovada-pi** (2026-07-21) — profundidade do schema resolvida pelo PI (schema pleno RF-006).
- Dependências: MVP-001 entregue (SQLite, `AuditEvent`/hash-chain, contratos em `src/shared`). Depende da **Fatia 02 (Policy Engine)** — as etapas referenciam a taxonomia de ações; criar/alterar é classificado. **Alimenta a Fatia 05** (execução simulada), que lê estas definições.
- Decisões que sustentam esta spec: requisitos RF-006 (Workflows), RF-007 (Automations), § Corte 2 ("registro de workflows" e "automações manuais"); ADR-004 (auditoria).

## Objetivo

Persistir e gerenciar as **definições** de workflows e automações — **só registro/catálogo, sem execução**. Modela o **schema pleno do RF-006** (etapas sequenciais/paralelas, pausa para aprovação, critérios de sucesso, status, Trigger Registry) desde já, para não migrar o schema quando a execução ficar real. Nenhuma etapa roda nesta fatia: executar é da Fatia 05 (simulado) e do MVP-003 (real).

## Escopo

### Dentro

- **Definição de Workflow (schema pleno RF-006)**, persistida no SQLite, escopada por `user_id`/`workspace_id`:
  - **Etapas ordenadas**; cada etapa = `{ descritor de ação (nome + params, compatível com a taxonomia do Policy Engine — Fatia 02), agenteId?, skillId?, entradas, saídas, critérios de sucesso }`.
  - **Modo de execução** por etapa/grupo: `sequencial | paralelo`.
  - **Pausa para aprovação humana:** flag no ponto/etapa (`requiresApproval`). O **schema** existe; o **fluxo de aprovação** é enforcement (MVP-003).
  - **Status:** `online | offline | paused | failed | disabled` — nasce **`disabled`**.
  - **Agenda, última execução, próxima execução:** campos presentes; ficam nulos até haver execução/scheduler.
- **Trigger Registry (como dado):** registra gatilhos dos tipos `manual | cron | evento | webhook`. Nesta fatia é **só registro** — **nenhum dispara**. O scheduler que aciona cron/evento/webhook é **Corte 4**; **manual** é o único acionável (via Fatia 05, simulado).
- **Definição de Automação (RF-007):** `{ gatilho (manual acionável; cron/evento/webhook como schema), alvo (workflowId | descritor de ação), squadId?/skillId?, estado de execução, próxima execução, registro de falhas/retentativas }` — estrutura presente, sem execução real.
- **Referências a agente/skill/squad são IDs nullable** — essas entidades chegam no Corte 3; aqui **sem FK constraint** (o schema não depende de tabelas do Corte 3). O registro aceita a referência vazia.
- **CRUD completo** de workflows e automações (criar/listar/editar/remover). **Nenhuma execução** ocorre.
- **Auditoria:** criar/alterar/ativar-desativar workflow ou automação é **classificado** pelo Policy Engine (Fatia 02, `médio` risco per requisitos) e gera `AuditEvent` encadeado (ADR-004). **Sem enforcement** (MVP-002).
- **Contratos** em `src/shared/domain` + `src/shared/contracts`; o renderer consome via **IPC tipado**, nunca acessa o storage direto.

### Fora

- **Execução** de qualquer etapa — Fatia 05 (simulada) e MVP-003 (real).
- **Scheduler** que dispara cron/evento/webhook — Corte 4 (o Trigger Registry aqui só **registra**).
- **Power Guard** (RF-006) — Corte 4.
- **Agentes, skills, squads reais** — Corte 3 (aqui, referências nullable).
- **UI de workflow builder** rica — futuro; nesta fatia, CRUD + contrato (tela pode ser mínima).

## Critérios de aceite

1. Workflow persistido com o **schema pleno RF-006**: etapas ordenadas com modo `sequencial|paralelo`, `agenteId?`/`skillId?` nullable, entradas/saídas, critérios de sucesso, flag `requiresApproval`, status, agenda/última/próxima. Nasce `disabled`; escopo `user_id`/`workspace_id`. Teste cobre o round-trip.
2. **Trigger Registry** registra gatilhos `manual|cron|evento|webhook` como dado; **nenhum dispara** nesta fatia (teste: registrar cron não agenda nada).
3. Automação (RF-007) persistida: gatilho (manual acionável; demais como schema), alvo (workflow/ação), `squadId?`/`skillId?` nullable, estrutura de estado/retentativa.
4. **CRUD completo** de workflows e automações; **nenhuma execução** ocorre (teste: criar/ativar workflow não dispara etapa).
5. Criar/alterar/ativar-desativar workflow ou automação é **classificado** pelo Policy Engine (Fatia 02) e gera `AuditEvent` encadeado (ADR-004); `verifyChain` passa.
6. Etapas referenciam **descritores de ação compatíveis com a taxonomia do Policy Engine** — a Fatia 05 conseguirá classificar e simular cada etapa. Teste comprova a compatibilidade.
7. Contratos em `src/shared`; renderer consome via IPC tipado, não acessa storage direto.
8. `npm run test` e `npm run lint` passam; evidência no `reports/TESTS.md` (Regras + Banco).

## Perguntas resolvidas pelo PI (2026-07-21)

1. **Profundidade do schema:** **schema pleno do RF-006 já** (etapas seq/paralelo, pausa-aprovação, critérios de sucesso, Trigger Registry) — evita migração futura, coerente com "adotar o real desde já" (SQLite/i18next). O custo aceito é campos ainda sem carga até a execução ficar real. — decidido.
2. **Escopo do registro** (cravado pelo Cowork): **só catálogo, sem execução**; **só manual acionável** (cron/evento/webhook = schema; disparo é Corte 4); agente/skill/squad como **refs nullable** (Corte 3, sem FK); etapas = **descritores de ação** ligados à taxonomia do Policy Engine (amarra 04→02→05). — aplicado.
