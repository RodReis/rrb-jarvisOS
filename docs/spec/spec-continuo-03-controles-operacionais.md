# SPEC-Contínuo-03 — Controles operacionais

- MVP: `docs/mvp/mvp-013-execucao-continua.md` (Fatia 03).
- Status: **revisão-pi** — implementação não autorizada.
- Depende de: F02 aprovada e entregue.

## Objetivo

Controlar uma execução longa com pausa, retomada, cancelamento, quotas, orçamento e kill-switches sem ampliar a autoridade da pipeline.

## Dentro

- Pausa global/projeto: impede novas aquisições e leva runs ativos à fronteira segura configurada.
- Retomada explícita após reconciliação.
- Cancelamento por DAG/MVP/fatia conforme matriz de fase, em cascata apenas para descendentes vinculados.
- Kill-switches separados para execução, gasto monetário, push, criação de PR e merge.
- Reação a quota, health, teto e mudança de política durante a jornada.
- Estado/efeito de cada comando idempotente e auditável.

## Fora

- Reverter merge confirmado automaticamente.
- Apagar branch/PR remoto ao cancelar.
- Autorizar gasto só porque existe orçamento residual.
- Inventar bloqueio documental, jurídico, LGPD, consentimento ou aceite duplo não definido pelo PI.

## Regras

1. Pausa não equivale a cancelamento e não perde posição/fila.
2. Kill-switch de merge termina em PR verde aguardando o PI.
3. Orçamento monetário é necessário, mas nunca substitui habilitação explícita da rota paga.
4. Comando repetido usa a mesma chave/fingerprint e não duplica efeito.

## Critérios de aceite

1. Pausa impede novo dispatch e estabiliza runs no limite seguro previsto.
2. Retomada continua do estado reconciliado sem refazer efeito confirmado.
3. Cancelamento pós-push preserva branch/PR e usa draft quando possível.
4. Kill-switch de merge não impede concluir código, push, PR e CI autorizados.
5. Desabilitar gasto durante run impede próxima chamada monetária sem falsificar custo já ocorrido.
6. Todos os controles sobrevivem a reinício e mostram alcance/estado atual.

## Testes e evidência

- matriz fase × pausa/cancelamento/kill-switch;
- comandos duplicados e crash durante controle;
- quota/teto/health mudando durante execução;
- auditoria e projeção da fronteira segura.

## Perguntas abertas ao PI

Nenhuma. Aguarda aprovação desta revisão exata.
