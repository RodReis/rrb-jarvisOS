# MVP-011 — Squads limitados pela SPEC

- Status: **arquitetura e cinco fatias aprovadas pelo PI** em 2026-08-29; implementação depende da fila.
- Depende de: MVP-010 concluído.
- Dono do aceite: PI.
- Design: `docs/superpowers/specs/2026-08-29-pipeline-desenvolvimento-ia-v2-design.md`.

## Tese

Criar Squads temporários por fatia sem entregar a agentes autoridade sobre produto, fila, Git ou merge. O executor principal permanece o único escritor.

## Fatias

| Ordem | Fatia | SPEC | Dependência |
|---:|---|---|---|
| 1 | Registro de capacidades e perfis | `spec-squads-01-capacidades-perfis.md` | MVP-010 |
| 2 | Planejador e validador determinístico | `spec-squads-02-planejador-validador.md` | F01 |
| 3 | Workers isolados | `spec-squads-03-workers-isolados.md` | F02 |
| 4 | Revisão independente | `spec-squads-04-revisao-independente.md` | F03 |
| 5 | Orçamento, cancelamento e E2E | `spec-squads-05-orcamento-cancelamento-e2e.md` | F04 |

## Dentro

- perfis de capacidade por tipo de fatia;
- grafo interno de tarefas validado pelo kernel;
- workers com contexto mínimo e resultado estruturado;
- revisão independente e deduplicação de achados;
- tetos de agentes, tokens, tempo e turnos;
- cancelamento em cascata e prova de escritor único.

## Fora

- Agents/Squads genéricos do JARVIS OS;
- vários escritores no mesmo worktree;
- subagente fazendo Git/GitHub;
- alteração automática de SPEC, prioridade ou gate.

## Done

1. A SPEC limita todas as tarefas geradas.
2. Somente o executor principal altera o worktree.
3. Capacidade obrigatória usa implementação ou fallback aprovado.
4. Achados repetidos não voltam ao contexto como falhas novas.
5. Cancelar o run encerra todos os workers e preserva evidência.
