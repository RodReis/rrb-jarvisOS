# MVP-009 — Entrega Autônoma

- Status: **desenho aprovado pelo PI em 2026-08-28; SPECs em revisão documental; implementação não autorizada**.
- Depende de: MVP-005, MVP-006 e MVP-008 concluídos.
- Não depende de: MVP-007.
- Resultado: uma fatia aprovada percorre publicação, construção, PR, CI, merge e prova sem aceite duplicado.

## Tese

Executar somente o que foi aprovado, em worktree isolado, com WIP=1, Git automático, até duas recuperações e reconciliação após reinício. Claude Code é o primeiro executor pelo adapter do MVP-005. O GitHub Adapter do MVP-006 realiza os efeitos remotos.

## Fatias

| Índice | SPEC | Resultado |
|---|---|---|
| M9-F01 | `spec-entrega-01-publicacao-github.md` | Repositório e issues idempotentes |
| M9-F02 | `spec-entrega-02-dag-fila-reconciliacao.md` | DAG, leases e retomada |
| M9-F03 | `spec-entrega-03-worktree-preflight-docker.md` | Isolamento, contexto e recursos |
| M9-F04 | `spec-entrega-04-construcao-recuperacao.md` | Construção e tentativas controladas |
| M9-F05 | `spec-entrega-05-revisao-ci-merge.md` | Revisão, CI e squash merge automático |
| M9-F06 | `spec-entrega-06-evidencia-limpeza-continuidade.md` | Ledger, limpeza e próxima fatia |

## Invariantes

- Nenhum código é construído sem MVP e SPEC aprovados.
- Checkout ativo do usuário nunca é usado pelo executor.
- Documento ou ADR auxiliar não bloqueia código depois do gate de entrada.
- Requisito de produto não é inventado.
- CI verde precisa corresponder ao `head SHA` mergeado.
- Reinício não duplica commit, issue, PR ou merge.
- Merge técnico não cria outro aceite do PI.

## Done do MVP

- Jornada real controlada termina em `MERGED` ou `BLOCKED` explicável.
- Falha corrigível usa o mesmo PR e respeita três tentativas totais.
- Estado externo é confirmado antes de declarar sucesso.
- Evidências, custos e SHAs são registrados.
- Worktree, leases, containers e portas temporários são reconciliados.

