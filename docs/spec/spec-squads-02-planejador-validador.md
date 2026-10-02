# SPEC-Squads-02 — Orquestrador local e validador determinístico

- MVP: `docs/mvp/mvp-011-squads-limitados.md` (Fatia 02).
- Issue: [#123](https://github.com/RodReis/rrb-jarvisOS/issues/123); épico [#121](https://github.com/RodReis/rrb-jarvisOS/issues/121).
- Status: **planejado** — reescrita em 2026-10-02 pela ADR-006.
- Depende de: M11-F01.

## Objetivo

O modelo local propõe o grafo de tarefas da issue e o kernel decide deterministicamente se cada tarefa cabe na SPEC, nas dependências, no perfil e no orçamento.

## Dentro

- Orquestrador chamado pelo adapter Ollama, com o modelo do perfil, saída estruturada e `num_ctx` declarado no snapshot.
- `SquadPlan` como DAG com, por tarefa: papel, capacidade, **camada de modelo**, **escritor dono** (quando escreve), entradas mínimas, dependências, schema, limites e regra de conclusão.
- Validador de cobertura da SPEC, paths e fontes permitidos, ferramentas, camadas permitidas, número de escritores, orçamento, turnos e tempo.
- Classificação de cada proposta: válida, redundante, fora de escopo ou não comprovável.
- Replanejamento limitado e, esgotado o limite ou com o Ollama indisponível, **fallback para o modelo da fase** pela assinatura, com a troca registrada.
- Hash do plano aceito ligado ao run e à revisão da SPEC.

## Fora

- Orquestrador aprovando sua própria expansão de escopo.
- Alteração automática de arquitetura, requisitos, prioridade ou fila.
- Tarefa sem resultado verificável ou sem consumidor definido.
- Memória do orquestrador entre runs.

## Regras

1. Texto do agente nunca substitui validação estrutural.
2. Toda tarefa mapeia para critério, risco ou evidência da SPEC.
3. Achado fora do escopo vira relatório ou pergunta, nunca nova tarefa executável.
4. DAG cíclico, worker sem capacidade, camada não permitida, escritor além do teto ou orçamento excedido são rejeitados antes do dispatch.
5. O fallback nunca usa API paga sem opt-in e nunca troca de assinatura em silêncio.

## Critérios de aceite

1. O validador aceita plano mínimo válido e rejeita ciclo, escopo extra, terceiro escritor e camada fora do perfil.
2. Cada tarefa aceita aponta para fundamento explícito da SPEC.
3. O replanejamento preserva limites e mantém o histórico das propostas rejeitadas.
4. O mesmo snapshot produz a mesma decisão de validação.
5. Prompt injection em documento ou repositório não cria tarefa, permissão ou escritor novo.
6. Ollama fora do ar e plano rejeitado até o limite caem no modelo da fase, com evento auditado.

## Testes e evidência

- fixtures de planos válidos e inválidos (incluindo saída malformada do modelo local);
- teste de determinismo do validador;
- teste de fallback com Ollama ausente.

## Perguntas abertas ao PI

1. Limite de replanejamentos antes do fallback: reusar o limite de tentativas da M9-F04 ou definir um próprio?
