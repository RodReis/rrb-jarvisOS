# SPEC-Contínuo-02 — Dispatcher e retomada

- MVP: `docs/mvp/mvp-013-execucao-continua.md` (Fatia 02).
- Issue: [#135](https://github.com/RodReis/rrb-jarvisOS/issues/135); épico [#133](https://github.com/RodReis/rrb-jarvisOS/issues/133).
- Status: **aprovada-pi** (2026-08-29) — entra no backlog na ordem do MVP; implementação depende da fila.
- Depende de: F01 aprovada e entregue.

## Objetivo

Selecionar continuamente o próximo nó elegível do DAG e atravessar merges, reinícios e esperas sem nova aprovação da mesma revisão nem duplicação de efeitos.

## Dentro

- `ContinuousDispatcher` orientado por eventos e varredura reconciliadora periódica.
- Seleção entre nós elegíveis respeitando prioridade aprovada, dependências, fairness, capacidade e independência.
- Avanço após merge confirmado e liberação de novos descendentes.
- Estado durável de cursor, decisão, run vinculado, espera e bloqueio.
- Retomada após reinício consultando leases, `EffectJournal`, Git e GitHub.
- Espera durável por quota com reset oficial conhecido; reavaliação sem busy loop.

## Fora

- Criar aprovação ausente ou escolher requisito pelo PI.
- Redispatch imediato de falha sem política/tentativa disponível.
- Deploy após o merge.

## Regras

1. Evento é sinal para reconciliar; não é confirmação suficiente de efeito externo.
2. Cada decisão de dispatch usa fingerprint do DAG e chave idempotente.
3. Nó ativo/mergeado não recebe outro run incompatível.
4. Ao encontrar o primeiro gate não aprovado, somente seus descendentes dependentes param; outros ramos aprovados podem avançar.

## Critérios de aceite

1. Após merge, próximo nó elegível inicia sem nova ação do PI.
2. Reinício entre quaisquer estados não duplica run, branch, PR ou merge.
3. Dois ramos elegíveis usam o scheduler do MVP-012 sem ultrapassar limites.
4. Quota com reset conhecido entra em espera durável e reavalia no tempo registrado.
5. Sem trabalho elegível, o dispatcher informa `drained`, `waiting` ou `blocked` com causa verificável.

## Testes e evidência

- relógio/eventos controlados;
- reinício em cada transição;
- DAG com ramos aprovados e gate pendente;
- trilha completa das decisões de dispatch.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.
