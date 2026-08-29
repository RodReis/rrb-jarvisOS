# SPEC-Squads-02 — Planejador e validador determinístico

- MVP: `docs/mvp/mvp-011-squads-limitados.md` (Fatia 02).
- Status: **aprovada-pi** (2026-08-29) — entra no backlog na ordem do MVP; implementação depende da fila.
- Depende de: F01 aprovada e entregue.

## Objetivo

Permitir que um planejador proponha tarefas internas, mas fazer o kernel decidir deterministicamente se cada tarefa cabe na SPEC, nas dependências e no orçamento.

## Dentro

- `SquadPlan` como DAG interno com função, capacidade, entradas mínimas, dependências, schema, limites e regra de conclusão.
- Validador de cobertura da SPEC, paths/fontes permitidos, ferramentas, orçamento, número de workers, turnos e tempo.
- Classificação de proposta válida, redundante, fora de escopo ou não comprovável.
- Correção/replanejamento limitado sem ampliar autoridade.
- Hash do plano aceito ligado ao run e à revisão da SPEC.

## Fora

- Planejador aprovando sua própria expansão de escopo.
- Alteração automática de arquitetura, requisitos ou prioridade.
- Tarefa sem resultado verificável ou sem consumidor definido.

## Regras

1. Texto do agente nunca substitui validação estrutural.
2. Toda tarefa deve mapear para critério, risco ou evidência da SPEC.
3. Achado fora do escopo vira relatório/pergunta, não nova tarefa executável.
4. DAG cíclico, worker sem capacidade ou orçamento excedido é rejeitado antes do dispatch.

## Critérios de aceite

1. Validador aceita plano mínimo válido e rejeita ciclo, escopo extra e segundo writer.
2. Cada tarefa aceita aponta para fundamento explícito da SPEC.
3. Replanejamento preserva limites e mantém histórico das propostas rejeitadas.
4. Mesmo snapshot produz a mesma decisão de validação.
5. Prompt injection em documento/repositório não cria tarefa ou permissão nova.

## Testes e evidência

- property tests do DAG interno;
- fixtures de expansão de escopo e prompt injection;
- trilha de propostas, rejeições e plano final.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.
