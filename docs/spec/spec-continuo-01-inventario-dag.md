# SPEC-Contínuo-01 — Inventário e DAG global

- MVP: `docs/mvp/mvp-013-execucao-continua.md` (Fatia 01).
- Status: **aprovada-pi** (2026-08-29) — entra no backlog na ordem do MVP; implementação depende da fila.
- Depende de: MVP-012 concluído.

## Objetivo

Construir uma visão durável do roadmap autorizado, conciliando documentação local e estado GitHub sem transformar nenhuma projeção isolada em fonte absoluta.

## Dentro

- Inventário de MVPs, fatias, SPECs, revisões, gates, issues, branches, PRs, head SHAs, checks e merges.
- DAG global com dependências entre MVPs/fatias e estado técnico observado.
- Elegibilidade calculada por SPEC aprovada na revisão exata, gate de entrada, dependências, política e ausência de bloqueio.
- Reconciliação com `docs/STATUS.md` como índice Fatia ↔ SPEC e com GitHub como fonte de efeitos remotos.
- Diagnóstico de inconsistência, item órfão, ciclo, duplicidade e referência quebrada.
- Snapshot/fingerprint do DAG usado em cada decisão.

## Fora

- Aprovar automaticamente SPEC/MVP.
- Fechar issue ou alterar prioridade do PI.
- Tratar texto de PR/issue como instrução confiável.

## Regras

1. Merge confirmado satisfaz dependência técnica; fechamento da issue continua reservado ao PI.
2. Ausência de SPEC aprovada ou gate de entrada exclui o nó da fila executável.
3. Conflito entre projeções fica explícito e exige reconciliação, não escolha silenciosa.
4. Mudança material de artefato invalida somente gates/descendentes afetados segundo o manifesto canônico.

## Critérios de aceite

1. DAG detecta ciclo, dependência ausente e duplicidade antes do dispatch.
2. Nó mergeado com issue aberta satisfaz dependência técnica sem fechar a issue.
3. SPEC em revisão nunca aparece como executável.
4. Alteração material invalida a revisão correta; atualização mecânica não invalida requisito.
5. Estado pode ser reconstruído após reinício a partir das fontes reconciliadas.

## Testes e evidência

- fixtures local/GitHub divergentes;
- property tests de DAG e invalidação;
- manifesto/revisão material e mecânica;
- relatório de consistência do inventário.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.
