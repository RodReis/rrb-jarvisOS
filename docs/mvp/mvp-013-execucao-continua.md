# MVP-013 — Execução contínua do roadmap

- Status: **arquitetura aprovada pelo PI** em 2026-08-29; fatias em revisão.
- Depende de: MVP-012 concluído.
- Dono do aceite: PI.
- Design: `docs/superpowers/specs/2026-08-29-pipeline-desenvolvimento-ia-v2-design.md`.

## Tese

Consumir continuamente todo o DAG já autorizado, atravessando fatias e MVPs sem novo aceite da mesma revisão e parando exatamente no primeiro gate ainda não aprovado.

## Fatias

| Ordem | Fatia | SPEC | Dependência |
|---:|---|---|---|
| 1 | Inventário e DAG global | `spec-continuo-01-inventario-dag.md` | MVP-012 |
| 2 | Dispatcher e retomada | `spec-continuo-02-dispatcher-retomada.md` | F01 |
| 3 | Controles operacionais | `spec-continuo-03-controles-operacionais.md` | F02 |
| 4 | Projeções e próximo gate | `spec-continuo-04-projecoes-gates.md` | F03 |
| 5 | Jornada multi-MVP | `spec-continuo-05-jornada-multi-mvp.md` | F04 |

## Dentro

- inventário local/GitHub e DAG entre MVPs;
- seleção contínua de trabalho aprovado;
- retomada após reinício e merge;
- pausa, cancelamento, quotas, orçamento e kill-switches;
- projeção em GitHub/STATUS sem fechar issue;
- relatório final do DAG autorizado.

## Fora

- aprovação automática de MVP ou SPEC;
- fechamento automático de issue do PI;
- deploy, staging, produção e rollback de ambiente;
- mudança autônoma da prioridade do STATUS.

## Done

1. Merge confirmado satisfaz dependência técnica sem fechar issue.
2. A fila avança até o próximo gate não aprovado ou bloqueio verificável.
3. Reinício não duplica run, PR ou merge.
4. Pausa/cancelamento/kill-switch preservam o contrato aprovado.
5. Jornada real atravessa mais de um MVP e termina com relatório completo.
