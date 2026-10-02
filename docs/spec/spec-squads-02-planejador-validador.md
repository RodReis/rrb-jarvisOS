# SPEC-Squads-02 — Orquestrador local e validador determinístico

- MVP: `docs/mvp/mvp-011-squads-limitados.md` (Fatia 02).
- Issue: [#123](https://github.com/RodReis/rrb-jarvisOS/issues/123); épico [#121](https://github.com/RodReis/rrb-jarvisOS/issues/121).
- Status: **aprovada-pi** (2026-10-02) — revisão exata do PR #367 aprovada pelo PI; reescrita em 2026-10-02 pela ADR-006.
- Depende de: M11-F01.

## Objetivo

O modelo local propõe o grafo de tarefas da issue e o kernel decide deterministicamente se cada tarefa cabe na SPEC, nas dependências, no perfil e no orçamento.

## Dentro

- Orquestrador chamado com o modelo do perfil — **padrão: modelo da fase; local via adapter Ollama como opção** (Emenda E1) —, saída estruturada e `num_ctx` declarado no snapshot.
- `SquadPlan` como DAG com, por tarefa: papel, capacidade, **camada de modelo**, **escritor dono** (quando escreve), entradas mínimas, dependências, schema, limites e regra de conclusão.
- Validador de cobertura da SPEC, paths e fontes permitidos, ferramentas, camadas permitidas, número de escritores, orçamento, turnos e tempo.
- Classificação de cada proposta: válida, redundante, fora de escopo ou não comprovável.
- Replanejamento limitado **ao limite de tentativas da M9-F04** (decisão do PI, 2026-10-02) e, esgotado o limite ou com o Ollama indisponível, **fallback para o modelo da fase** pela assinatura, com a troca registrada.
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

## Emenda E1 — validador endurecido (PI, 2026-10-02)

Origem: a M11-F00 aceitou planos locais sem nenhum escritor e com caminhos de outra stack ([SPEC-Squads-00 § Emenda E1](spec-squads-00-prova-orquestrador-integrador.md)). O validador passa a rejeitar também:

1. **Plano sem escritor:** nenhuma tarefa com escritor dono.
2. **Path inexistente:** path que não existe na base e não é arquivo novo dentro de um diretório permitido, com extensão já presente na base.
3. **Tarefa de escritor sem path** (já era regra; passa a ter teste próprio).

O orquestrador local só pode ser escolhido no perfil com este validador; a rejeição volta ao orquestrador como feedback, até o limite da M9-F04, e depois cai no modelo da fase.

Critérios de aceite adicionais:

7. O validador rejeita plano sem escritor, path inexistente fora das condições acima e escritor sem path, com fixtures tiradas da M11-F00.

## Perguntas abertas ao PI

Nenhuma. Limite de replanejamento = limite da M9-F04; Emenda E1 decidida pelo PI em 2026-10-02.
