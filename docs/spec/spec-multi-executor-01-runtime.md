# SPEC-Multi-Executor-01 — Contrato comum e runtime de executores

- MVP: `docs/mvp/mvp-010-multi-executor.md` (Fatia 01).
- Status: **aprovada-pi** (2026-08-29) — entra no backlog na ordem do MVP; implementação depende da fila.
- Depende de: MVP-009 concluído e `CodingExecutorAdapter` introduzido na V1.

## Objetivo

Estabilizar a fronteira entre o kernel e qualquer CLI executor de código. O kernel governa escopo, política, orçamento, efeitos e Git; o adapter traduz apenas execução, eventos, uso, sessão e cancelamento.

## Dentro

- `CodingExecutorRuntime` separado de `AIProviderRuntime` e `ConnectorRuntime`.
- Request normalizado com IDs do run/attempt, executor/modelo/modo de cobrança, revisões aprovadas, `ContextPack`, worktree/container, paths, validações, limites, schema de saída e referência opaca de autenticação.
- Eventos normalizados `started`, `progress`, `tool_used`, `path_changed`, `usage` e terminais.
- Resultado estruturado com status, resumo, paths alterados, validações, evidências, uso, sessão retomável e assinatura de falha.
- Máquina de estados durável, cancelamento idempotente, timeout e health por executor.
- Contract test reutilizável por qualquer adapter.

## Fora

- Parser ou autenticação específicos do Codex; F02/F03.
- Seleção entre executores e revisão cruzada; F04.
- Git remoto, PR, merge, decisão de escopo ou aprovação dentro do adapter.

## Regras

1. Só o kernel abre uma tentativa; evento atrasado não reabre estado terminal.
2. `attempt_id` e chave idempotente impedem duplicação após crash/retry.
3. `path_changed` informa observação; autorização de escrita continua externa ao CLI.
4. Evento desconhecido é preservado como diagnóstico, sem alterar estado por inferência.
5. Segredos e conteúdo bruto sensível passam pela política de redaction antes de log/evidência.

## Critérios de aceite

1. Adapter fake percorre sucesso, falha, timeout, cancelamento e retomada no mesmo contract test.
2. Eventos duplicados, fora de ordem e após terminal não corrompem o estado.
3. Cancelar duas vezes produz um único efeito e termina a árvore do processo.
4. O runtime rejeita modo de cobrança, revisão ou schema incompatível antes de iniciar o CLI.
5. O adapter não recebe credencial GitHub/Vault/projeto e não expõe autenticação ao renderer.
6. Uso e falhas são auditáveis sem depender do formato interno do fornecedor.

## Testes e evidência

- unitários da máquina de estados e redaction;
- contract tests de adapters;
- fixtures de evento parcial/desconhecido/duplicado;
- relatório por SPEC em `reports/TESTS.md`.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.
