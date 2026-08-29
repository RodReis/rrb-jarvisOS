# SPEC-Conectores-02 — Operação e governança

- MVP/Fatia: MVP-006 · M6-F02.
- Issue: [#88](https://github.com/RodReis/rrb-jarvisOS/issues/88).
- Status: **aprovada-pi** (2026-08-29) — modelo de orçamento de conector resolvido pelo PI nesta data.
- Depende de: M6-F01 e MVP-005.

## Objetivo

Adicionar ao ponto único de conectores health, timeout, retry, rate limit, custo, auditoria e sanitização de forma reutilizável.

## Não objetivos

- Inventar política de produto.
- Repetir mutação sem idempotência.
- Substituir a BudgetPolicy do MVP-005.

## Regras

- Estados: `READY`, `DEGRADED`, `BLOCKED_EXTERNAL`, `FAILED`.
- Retry somente para leitura ou mutação com chave idempotente; backoff respeita orientação do serviço.
- 401/403, quota esgotada e permissão do usuário não entram em loop.
- `AuditEvent` antes/depois de efeito material; custo/uso entra no ledger.
- **Ledger de crédito de conector, separado e contado em créditos** (não em USD): teto por conector, verificado antes da chamada. Não converte crédito em USD nem soma à `BudgetPolicy` do MVP-005 — os dois orçamentos são independentes e estouram separado.
- Logs usam allowlist de campos e redaction; corpo bruto não é persistido por padrão.
- Circuit breaker impede tempestade de chamadas, mas não converte falha em sucesso.
- Antes de mutação, o runtime persiste `intended` com fingerprint. Depois, grava `confirmed`, `ambiguous` ou `failed`; `ambiguous` consulta a origem antes de qualquer retry.

## Critérios de aceite

1. Timeout e cancelamento liberam recursos.
2. 429 retenta dentro do orçamento e do limite configurado.
3. Mutação sem idempotency key nunca é repetida automaticamente.
4. Falha externa retorna causa, evidência e ação.
5. Health não exige revelar credencial.
6. Tokens, chaves e headers sensíveis não aparecem em logs, IPC ou evidências.
7. Uso e custo são atribuídos a projeto, operação e run (`project_id` nulo até o MVP-008).
8. Estouro do teto de créditos do conector barra a **próxima** chamada com `BLOCKED_EXTERNAL`, sem tocar o orçamento de IA do MVP-005; o inverso também vale.
9. Crash antes/depois de mutação converge por `EffectJournal`; não duplica recurso nem reutiliza chave para payload divergente.

## Testes e evidência

Fixtures para 401/403/429/timeout/5xx; teste de cancelamento, redaction, circuit breaker e auditoria. Relatório `SPEC-Conectores-02`. Chamadas reais apenas em smoke limitado.

## Perguntas resolvidas pelo PI (2026-08-29)

1. **Orçamento de conector versus `BudgetPolicy` do MVP-005:** **ledger de créditos separado, com teto próprio por conector**. A `BudgetPolicy` (SPEC-Providers-03) é em USD e escopada usuário+workspace; a Tavily cobra em créditos e o GitHub não cobra. Converter crédito em USD dependeria do plano contratado e produziria número falso, além de esconder qual orçamento estourou. Os dois ledgers coexistem, cada um com seu gate. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **Corpo bruto de resposta nunca é persistido na V1** — sem opt-in de debug. Menos superfície de vazamento; o que a evidência precisa guardar está na SPEC-Conectores-06.
- **Escopo do ledger:** `user_id` + `workspace_id`; `project_id` opcional/nulo até o MVP-008.
- **Teto de crédito é ajustável, com padrão conservador**, no mesmo espírito do USD 1/dia da `BudgetPolicy`.
