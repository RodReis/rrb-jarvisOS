# MVP-012 — Scheduler concorrente

- Status: **arquitetura e cinco fatias aprovadas pelo PI** em 2026-08-29; implementação depende da fila.
- GitHub: épico [#127](https://github.com/RodReis/rrb-jarvisOS/issues/127); fatias [#128–#132](https://github.com/RodReis/rrb-jarvisOS/issues/128), estado `proplan:backlog`.
- Depende de: MVP-011 concluído.
- Dono do aceite: PI.
- Design: `docs/superpowers/specs/2026-08-29-pipeline-desenvolvimento-ia-v2-design.md`.

## Tese

Executar até duas fatias independentes em paralelo, com isolamento e prova explícita de que o ganho de tempo não ameaça o trabalho ou a coerência da base.

## Fatias

| Ordem | Fatia | SPEC | Dependência |
|---:|---|---|---|
| 1 | Pool global e fila justa | `spec-scheduler-01-pool-fila.md` | MVP-011 |
| 2 | Independência e locks | `spec-scheduler-02-independencia-locks.md` | F01 |
| 3 | Isolamento concorrente | `spec-scheduler-03-isolamento-concorrente.md` | F02 |
| 4 | Merge serializado | `spec-scheduler-04-merge-serializado.md` | F03 |
| 5 | Recuperação e E2E concorrente | `spec-scheduler-05-recuperacao-e2e.md` | F04 |

## Dentro

- dois slots globais configuráveis;
- no máximo duas fatias por projeto;
- prova de independência, write sets e locks persistidos;
- worktree/container/lease por fatia;
- merge lease, rebase e revalidação;
- fairness, crash e cancelamento seletivo.

## Fora

- paralelismo livre somente porque o DAG não tem aresta;
- mais de duas fatias simultâneas por padrão;
- dois merges concorrentes para a mesma base;
- múltiplos escritores da mesma fatia.

## Done

1. Sem prova de independência, a fila volta para sequencial sem bloquear.
2. Duas fatias independentes não compartilham worktree, container ou lease.
3. Mudança de write set adquire lock antes da escrita.
4. Merge é serializado e a fatia restante revalida a base atual.
5. Crash e cancelamento não deixam lock/recurso órfão nem descartam PR.
