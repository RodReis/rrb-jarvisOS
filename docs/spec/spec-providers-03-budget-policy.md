# SPEC-Providers-03 — BudgetPolicy (gate de custo no ponto único)

- MVP: `docs/mvp/mvp-005-providers-vault-budget.md` (Fatia 03).
- Status: **aprovada-pi** (2026-07-24) — comportamento de estouro no stream, escopo e forma do bloqueio resolvidos pelo PI nesta data.
- Dependências: **Fatia 02 entregue** (ponto único de chamada + `CostEvent` report-only — a F03 é o gate que se encaixa nele). **Fatia 01** (Vault, escopo user+workspace). MVP-002 (Policy Engine classifica "gastar acima do orçamento"; `AuditEvent`). **Independe do MVP-004** (ver nota de reconciliação sobre o override).
- Decisões que sustentam esta spec: **ADR-001 questão 1 resolvida** ("estimativa + alerta com **bloqueio no ponto único de chamada** do adapter; **sem proxy**"); requisitos § MVP Corte 2/3 ("BudgetPolicy com limites separados de USD 1/dia e USD 1/mês, ajustáveis"), § "Ações Possíveis" ("gastar acima do orçamento configurado" = **alto risco**), critério "BudgetPolicy impede gasto acima dos limites", modelo `BudgetPolicy` ("orçamento diário/mensal por usuário, espaço, squad ou agente") e `CostEvent`; ARCHITECTURE § Resiliência ("BudgetPolicy padrão USD 1/dia e USD 1/mês verificada **antes** de qualquer chamada paga; **com BYOK é estimativa + alerta, não bloqueio garantido**"); ADR-004 (auditoria); ADR-005 (logging).

## Objetivo

Encaixar o **gate de custo** no **ponto único de chamada** da F02: antes de cada chamada, **estimar**; ao aproximar do limite, **alertar**; ao excedê-lo, **barrar**. Vira o `CostEvent` de **report** (F02) para **enforcement**. Limites separados **diário** e **mensal**, escopados por **usuário + workspace**, padrão USD 1 cada, ajustáveis. É a peça que fecha a tese do MVP-005 — "IA real com custo sob controle".

**Honestidade do modelo (ARCHITECTURE):** com **BYOK** o bloqueio é **por estimativa pré-chamada** — o custo real só se conhece no fim (F02). Logo o gate é **melhor esforço**: reduz o risco de estouro, não o zera. A spec declara isso; não promete cerca perfeita.

## Escopo

### Dentro

- **Entidade `BudgetPolicy`** (contrato tipado, SQLite), escopada por **`user_id` + `workspace_id`** (`sensitivity: internal`): `dailyLimit`, `monthlyLimit` (padrão **USD 1** cada, **ajustáveis**), `alertThreshold` (padrão **0.8**), `currency` (`USD`). NOA e JARVIS têm orçamentos próprios (espelha o escopo da credencial na F01).
- **Total corrente:** soma dos **`CostEvent` reais** (F02) no período — dia corrente e mês corrente contados **separadamente**, por escopo.
- **Gate no ponto único (F02):** antes de cada chamada, o ponto único consulta a `BudgetPolicy` e decide sobre `(gasto real acumulado no período) + (estimativa desta chamada)`:
  1. **abaixo do limiar de alerta** → segue;
  2. **cruza o limiar de alerta** (default 80%) → segue, mas emite **alerta** (notificação + `AuditEvent`) — o "estimativa + alerta" do ADR-001;
  3. **excederia o limite** → é "gastar acima do orçamento" = **alto risco** → **`requires-approval`** (override por aprovação — decisão do PI). **Nota de reconciliação:** para manter a F03 entregável **sem** o MVP-004, o override é o **alvo** e o **piso é bloqueio duro** — enquanto o fluxo de aprovação do MVP-004 não existe, `requires-approval` **resolve como recusa** (a chamada é barrada). Quando o MVP-004 chegar, o usuário passa a poder **aprovar o excedente**. Mesmo padrão da F01 (edição de credencial por agente). *(O PI pode vetar e, em vez disso, tornar a F03 dependente do MVP-004 entregue.)*
- **Estouro no meio do stream (decisão do PI):** se o custo real cruza o limite **durante** um stream (a estimativa foi baixa), a chamada em andamento **termina** — os tokens já gerados não voltam, e matar o stream custaria igual entregando resposta quebrada; o gasto real é registrado (`CostEvent`) e a **próxima** chamada é barrada pelo gate. **Não mata o stream.**
- **Auditoria (ADR-004):** cada decisão do gate (`allow` / `alert` / `block`-ou-`requires-approval`) gera `AuditEvent` encadeado; estourar o orçamento é evento auditado; `verifyChain` passa.
- **Logging (ADR-005):** categoria `ai`/`sistema` com os números (limite, acumulado, estimativa) — sem segredo, redaction (CONVENTION §3).
- **UI mínima:** em Settings, os limites (dia/mês, editáveis) e o **gasto acumulado no período**; um alerta/notificação ao cruzar o limiar; só com componentes públicos do DS (padrões de execução/custo da SPEC-DS-04b), operável por teclado. Renderer edita/vê **via IPC tipado**.
- **Fronteira de processo:** o gate e a `BudgetPolicy` rodam no **main**; o renderer edita limites e vê o acumulado via IPC tipado, sem tocar o cálculo.

### Fora

- **Multi-provider / roteamento** — F04. O gate vale para **qualquer** provider que passe pelo ponto único; não depende de haver mais de um.
- **Escopo squad / agente** do modelo `BudgetPolicy` — quando squads/agentes existirem (Corte 4). Aqui só **usuário + workspace**.
- **O fluxo/UI de aprovação em si** — MVP-004. Aqui o override é o **alvo**; o piso é bloqueio duro até lá (nota de reconciliação acima).
- **Dashboards/analytics de custo agregado** (RF-018: métricas por período/agente/squad) — futuro.
- **Bloqueio garantido com BYOK** — inatingível por desenho (custo real é pós-chamada); o gate é melhor esforço.

## Critérios de aceite

1. `BudgetPolicy` persistida, escopada por `user_id` + `workspace_id`, limites **dia/mês separados**, padrão **USD 1** cada, **ajustáveis**; `alertThreshold` default 0.8. Teste.
2. **Gate no ponto único** decide os três caminhos: abaixo do alerta → segue; cruza o alerta → segue + alerta (notificação + `AuditEvent`); excederia → `requires-approval` que, **sem o fluxo do MVP-004, resolve como recusa** (chamada barrada). Teste dos três.
3. **Total corrente** = soma dos `CostEvent` reais do período por escopo; **dia e mês contam separado**. Teste.
4. **Estouro no stream:** a chamada corrente **termina**, o gasto real é registrado, a **próxima** é barrada. Teste comprova que o stream não é morto no meio.
5. **BYOK melhor esforço:** o bloqueio é por estimativa pré-chamada; teste comprova o gate pré-chamada e a spec documenta que o real pode divergir.
6. Toda decisão do gate gera `AuditEvent` encadeado; estourar = auditado; `verifyChain` passa.
7. **UI mínima** (Settings: limites editáveis + acumulado + alerta) só com componentes do DS, operável por teclado, foco visível.
8. Renderer edita/vê via IPC tipado; o gate e o cálculo rodam no main; sem Node/segredo no renderer.
9. `npm run dev`, `npm run test` e `npm run lint` passam; evidência no `reports/TESTS.md` (Regras + Banco + Tela).

## Perguntas resolvidas pelo PI (2026-07-24)

1. **Estouro no meio do stream:** a chamada em andamento **termina**; o gasto real é registrado e a **próxima** é barrada. Não mata o stream. — decidido.
2. **Escopo do orçamento:** **usuário + workspace** agora; squad/agente quando existirem (Corte 4). — decidido.
3. **Forma do bloqueio ao estourar:** **bloqueio com override por aprovação** ("gastar acima" = alto risco). — decidido. **Reconciliação registrada pelo Cowork** (para não amarrar a F03 ao MVP-004): o override é o alvo, com **piso de bloqueio duro** até o fluxo de aprovação do MVP-004 existir. PI ciente; pode vetar tornando a F03 dependente do MVP-004.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **Total corrente pelos `CostEvent` reais** (F02) + **estimativa desta chamada** para a checagem pré.
- **Limiar de alerta configurável, default 80%** (o "alerta" do ADR-001).
- **Piso de bloqueio duro até o MVP-004** para o override-por-aprovação — mantém a F03 shippable e independente, seguindo o padrão "report → gate" e a F01.
- **O gate vale para qualquer provider** no ponto único (multi-provider é F04); a BudgetPolicy não conhece provider concreto.
- **BYOK = melhor esforço** declarado (ARCHITECTURE), não bloqueio garantido.
