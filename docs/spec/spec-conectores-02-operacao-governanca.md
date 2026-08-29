# SPEC-Conectores-02 — Operação e governança

- MVP/Fatia: MVP-006 · M6-F02.
- Issue: [#88](https://github.com/RodReis/rrb-jarvisOS/issues/88).
- Status: **revisão documental; implementação não autorizada**.
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
- Logs usam allowlist de campos e redaction; corpo bruto não é persistido por padrão.
- Circuit breaker impede tempestade de chamadas, mas não converte falha em sucesso.

## Critérios de aceite

1. Timeout e cancelamento liberam recursos.
2. 429 retenta dentro do orçamento e do limite configurado.
3. Mutação sem idempotency key nunca é repetida automaticamente.
4. Falha externa retorna causa, evidência e ação.
5. Health não exige revelar credencial.
6. Tokens, chaves e headers sensíveis não aparecem em logs, IPC ou evidências.
7. Uso e custo são atribuídos a projeto, operação e run.

## Testes e evidência

Fixtures para 401/403/429/timeout/5xx; teste de cancelamento, redaction, circuit breaker e auditoria. Relatório `SPEC-Conectores-02`. Chamadas reais apenas em smoke limitado.
