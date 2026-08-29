# SPEC-Squads-05 — Orçamento, cancelamento e E2E

- MVP: `docs/mvp/mvp-011-squads-limitados.md` (Fatia 05) — **fecha o MVP-011**.
- Status: **aprovada-pi** (2026-08-29) — entra no backlog na ordem do MVP; implementação depende da fila.
- Depende de: F04 aprovada e entregue.

## Objetivo

Fechar a governança operacional dos Squads e provar numa fatia real que especialistas ajudam sem criar segundo escritor, custo aberto ou trabalho órfão.

## Dentro

- Tetos por Squad e worker: quantidade, tokens/contexto observado, chamadas, turnos, tempo e custo monetário quando aplicável.
- Reserva e consumo agregados ao orçamento do run/projeto.
- Cancelamento em cascata, timeout pai, encerramento de workers e coleta de resultados parciais.
- Limpeza de recursos temporários sem apagar diff/evidência do writer.
- Painel/resumo de tarefas, capacidades, consumo, falhas e achados.
- E2E com análise, teste e revisão concorrentes em fatia aprovada.

## Fora

- Aumento automático de teto para concluir tarefa.
- Cobrança por crédito/API não habilitada.
- Squad persistente após o fim do run.
- Vários writers ou merge por worker.

## Regras

1. Exceder qualquer teto impede novo dispatch e preserva resultados já obtidos.
2. Cancelar o run cancela todos os descendentes; resultado tardio não reabre o Squad.
3. Custo de assinatura sem preço por chamada registra uso/quota, não USD fictício.
4. Recursos só são limpos após snapshot e reconciliação dos workers.

## Critérios de aceite

1. Teto impede criação/chamada adicional antes do excesso.
2. Cancelamento encerra todos os workers e não deixa processo/container órfão.
3. Auditoria reconstrói plano, workers, consumo, resultados e motivo terminal.
4. E2E comprova que somente o writer alterou o worktree.
5. Achados repetidos são deduplicados e somente deltas necessários voltam ao writer.
6. Testes de crash/cancelamento não perdem evidência nem criam efeito remoto.

## Testes e evidência

- testes de teto em cada dimensão;
- crash/cancelamento em cada fronteira;
- E2E real limitado com snapshot de permissões e diff;
- relatório de custo/contexto antes e depois.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.
