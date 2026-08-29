# SPEC-Scheduler-02 — Independência e locks

- MVP: `docs/mvp/mvp-012-scheduler-concorrente.md` (Fatia 02).
- Issue: [#129](https://github.com/RodReis/rrb-jarvisOS/issues/129); épico [#127](https://github.com/RodReis/rrb-jarvisOS/issues/127).
- Status: **aprovada-pi** (2026-08-29) — entra no backlog na ordem do MVP; implementação depende da fila.
- Depende de: F01 aprovada e entregue.

## Objetivo

Autorizar paralelismo somente quando dependências, write sets e recursos compartilhados provarem ausência de colisão relevante.

## Dentro

- `IndependenceAnalyzer` com dependências diretas/transitivas e conjuntos previstos de escrita.
- Catálogo versionado de recursos exclusivos e áreas globais: migrations, schema público, lockfile, build/config e contrato arquitetural.
- Locks persistidos por path/prefix e recurso lógico, com granularidade conservadora.
- Prova registrada de independência ou motivo de fallback sequencial.
- Expansão transacional do write set antes da primeira escrita no novo alvo.
- Detecção de conflito real e suspensão segura do run que perdeu a disputa.

## Fora

- Usar somente ausência de aresta no DAG.
- Inferência probabilística autorizando conflito.
- Dois runs alterando área global simultaneamente.

## Regras

1. Qualquer dimensão desconhecida torna a prova incompleta e força sequencial.
2. Sobreposição de prefixos ou recurso exclusivo bloqueia coexistência.
3. Novo path observado sem lock não pode ser escrito até aquisição confirmada.
4. Mudança estrutural invalida a prova dos descendentes afetados.

## Critérios de aceite

1. Fatias sem dependência mas com lockfile comum não executam juntas.
2. Write sets disjuntos e sem recurso global podem adquirir slots simultâneos.
3. Expansão conflitante pausa antes de alterar o novo path.
4. Reexecução com mesmo snapshot produz a mesma prova e fingerprint.
5. Locks sobrevivem a reinício e só são liberados após reconciliação do owner.

## Testes e evidência

- property tests de DAG/prefixos/recursos;
- fixtures de migration, lockfile e contrato global;
- corrida de expansão de write set;
- registro da prova usada pelo scheduler.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.
