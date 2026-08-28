# SPEC-Entrega-05 — Revisão, CI e merge

- MVP/Fatia: MVP-009 · M9-F05.
- Status: **revisão documental; implementação não autorizada**.
- Depende de: M9-F04 e GitHub Adapter M6-F04.

## Objetivo

Validar o delta, executar revisões, corrigir falhas elegíveis e concluir o mesmo PR por squash merge automático sem novo aceite do PI.

## Sequência

Escopo → testes/lint/type/build → code/architecture review → design review quando houver UI → QA/smoke → correção/revalidação → commits automáticos → push → `ensurePullRequest` → checks do head atual → recuperação no mesmo PR → confirmação do SHA → squash merge → confirmação na origem.

## Revisão

`REVIEW.md` é a instrução de maior prioridade fornecida pelo projeto aos revisores. Baseline: P0/P1 bloqueiam; P2/P3 são registrados. Relatório anterior é usado para deduplicar e avaliar apenas o delta ainda aberto.

## Git automático

- Commits agrupam mudanças coerentes; correções de QA podem ser atômicas.
- Branch e PR são únicos por fatia/run lógico.
- Se a base avançar, rebase e revalidação são automáticos quando seguros.
- Resolução com alteração de código consome tentativa.
- Squash merge não exige aceite humano adicional.

## Critérios de aceite

1. Diff fora da SPEC não chega ao push.
2. P0/P1 aberto impede merge.
3. CI verde pertence ao `head SHA` esperado.
4. Stale SHA impede merge e força reconciliação.
5. Falha corrigível mantém o mesmo PR.
6. `mergeSha` é confirmado na origem.
7. Código do comando zero, sozinho, não prova sucesso.

## Testes e evidência

Fixtures de review/CI; integração de PR existente, CI failure, stale SHA, rebase e merge já ocorrido; smoke GitHub real. Relatório `SPEC-Entrega-05`.

