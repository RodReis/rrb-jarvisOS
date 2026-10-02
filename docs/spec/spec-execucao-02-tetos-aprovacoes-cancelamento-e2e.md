# SPEC-Execucao-02 — Tetos, aprovações do PI, cancelamento e E2E

- MVP: `docs/mvp/mvp-028-quadro-execucao-squads.md` (Fatia 02).
- Issue: [#126](https://github.com/RodReis/rrb-jarvisOS/issues/126) (antes M11-F05 "Orçamento, cancelamento e E2E"; retitulada e religada ao épico [#368](https://github.com/RodReis/rrb-jarvisOS/issues/368) em 2026-10-02).
- Status: **aprovada-pi** (2026-10-02) — revisão exata do PR #367 aprovada pelo PI; reescrita em 2026-10-02 pela ADR-006; substitui `spec-squads-05-orcamento-cancelamento-e2e.md`; era a M11-F06 antes da partição.
- Depende de: M28-F01.

## Objetivo

Fechar a governança operacional dos Squads orquestrados e provar, numa issue real, que orquestrador, dois escritores e integrador entregam sem custo aberto, sem trabalho órfão, sem Git fora do kernel e sem ação crítica sem o PI.

## Dentro

- Tetos por Squad, escritor e worker: quantidade, tokens/contexto observado, chamadas, turnos, tempo e custo monetário quando aplicável.
- Reserva e consumo agregados ao orçamento do run e do projeto; uso do orquestrador local registrado como uso local, sem USD.
- **Aprovação do PI** antes de alteração estrutural de banco e de comando destrutivo, detectados pelo Policy Engine (fail closed) antes da execução. Deploy fica registrado na mesma política para quando entrar no escopo.
- Cancelamento em cascata: orquestrador, workers, escritores, integrador e consultas de PR; timeout pai; coleta de resultados parciais.
- Limpeza de worktrees temporários só após snapshot e reconciliação, sem apagar diff nem evidência.
- Resumo por issue: tarefas, camadas, consumo, falhas, achados, aprovações.
- E2E com orquestrador local, dois escritores, integrador, TESTE, REVIEWER e PR/MERGE numa fatia aprovada.

## Fora

- Aumento automático de teto para concluir tarefa.
- Cobrança por crédito ou API não habilitada.
- Squad persistente após o fim do run.
- Merge por agente.

## Regras

1. Exceder qualquer teto impede novo dispatch e preserva os resultados já obtidos.
2. Cancelar o run cancela todos os descendentes; resultado tardio não reabre o Squad.
3. Custo de assinatura sem preço por chamada registra uso/quota, não USD fictício.
4. Ação classificada como "exige PI" e não reconhecida com certeza é tratada como exigindo PI (fail closed).
5. Recursos só são limpos após snapshot e reconciliação.

## Critérios de aceite

1. O teto impede criação ou chamada adicional antes do excesso.
2. O cancelamento encerra tudo e não deixa processo, container ou worktree órfão.
3. Migração e comando destrutivo não executam sem aprovação registrada; a recusa encerra a tarefa com motivo.
4. A auditoria reconstrói plano, camadas, escritores, manifesto, consumo, aprovações e motivo terminal.
5. O E2E comprova que só o kernel executou Git e que cada escritor tocou só seu worktree.
6. Testes de crash e cancelamento não perdem evidência nem criam efeito remoto.

## Testes e evidência

- testes de teto em cada dimensão;
- crash e cancelamento em cada fronteira (inclusive durante a integração e em PR/MERGE);
- política de aprovação com migração e `rm` simulados;
- E2E real limitado com snapshot de permissões e diffs por worktree;
- relatório de custo e contexto antes e depois.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-10-02.
