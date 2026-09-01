# SPEC-Scheduler-04 — Merge serializado

- MVP: `docs/mvp/mvp-012-scheduler-concorrente.md` (Fatia 04).
- Issue: [#131](https://github.com/RodReis/rrb-jarvisOS/issues/131); épico [#127](https://github.com/RodReis/rrb-jarvisOS/issues/127).
- Status: **aprovada-pi** (2026-08-29) — entra no backlog na ordem do MVP; implementação depende da fila.
- Depende de: F03 aprovada e entregue.

## Objetivo

Permitir PRs concorrentes, mas serializar integração na mesma base e revalidar a fatia remanescente contra o estado recém-mergeado.

## Dentro

- `MergeLease` exclusivo por repositório/branch-base com fencing token.
- Reconciliação de PR, head SHA, regras vigentes e checks obrigatórios antes do merge.
- Após um merge, atualização/rebase controlado da fatia remanescente.
- Reexecução integral das validações exigidas e nova revisão do delta material.
- Atualização do manifesto, head SHA e prova de independência.
- Conflito ou mudança estrutural devolve o run a estado seguro, sem correção cega.

## Fora

- Dois merges simultâneos na mesma base.
- Considerar checks do SHA anterior como válidos.
- Merge queue na versão em que não estiver explicitamente suportada.
- Reverter merge confirmado automaticamente.

## Regras

1. PR verde não garante merge se base/head/regras mudaram.
2. Só o dono atual do `MergeLease` confirma o efeito no `EffectJournal`.
3. Rebase nunca roda hooks, filters, drivers ou comandos controláveis pelo repositório.
4. Conflito que exige decisão de produto/arquitetura para no gate adequado.

## Critérios de aceite

1. Somente um run por base entra na seção crítica de merge.
2. Segundo PR atualiza sua base e perde todos os checks obsoletos.
3. Revalidação usa o novo head SHA e regras observadas da branch-base.
4. Crash após chamada de merge reconcilia GitHub antes de repetir.
5. Merge confirmado permanece `MERGED` mesmo após cancelamento tardio.

## Testes e evidência

- corrida de dois PRs verdes;
- mudança de base/ruleset entre check e merge;
- crash antes/durante/depois do efeito;
- conflito de rebase e revalidação completa.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.
