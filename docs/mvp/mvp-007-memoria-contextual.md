# MVP-007 — Memória Contextual e RAG

- Status: **direção de memória compartilhada aprovada pelo PI em 2026-08-30; design em elaboração; sem fatias ou SPECs; implementação não autorizada**.
- Origem: recorte de memória híbrida/RAG anteriormente associado ao Corte 3.
- Relação com a pipeline: **não bloqueia MVP-008, MVP-009 nem MVP-016**; a M16-F05 mantém escopo próprio e integração reutilizável.
- Design em elaboração: `docs/superpowers/specs/2026-08-30-mvp-007-memoria-compartilhada-design.md`.

## Intenção preservada

Recuperar contexto rastreável por mecanismos textuais, vetoriais e/ou de grafo sem obrigar agentes a reler o repositório inteiro. A solução futura deverá respeitar Vault, BudgetPolicy, proveniência e isolamento por projeto.

## Direção aprovada

Um núcleo compartilhado serve JarvisOS e AgentsOS, inclusive o conhecimento sobre o desenvolvimento dos próprios produtos. Separa histórico do que aconteceu, conhecimento sobre relações e aprendizado sustentado por evidência. Os registros originais permanecem nos módulos responsáveis; o grafo é derivado e reconstruível.

Graphify é componente opcional e substituível de conhecimento, não a única memória nem autoridade de validação. Visão global mantém origem por produto/projeto/agente; consultar projetos em conjunto não aplica regras de um no outro. O MVP-016 continua responsável por validar aprendizado operacional da pipeline; outros módulos precisam definir suas evidências de sucesso.

Os menus futuros Agent Memory, Notebook, Mission Control, Command Center, Projects Hub, Kanban, Workflows, Automations, Analytics, Insights, Skills Catalog, Specialties e Teams são consumidores previstos, não memórias independentes nem promessa de implementação imediata. Os anexos apresentados pelo PI são referências de visão, não substitutos do design system e dos protótipos formais das fatias visuais.

## Regra de planejamento

O MVP entra em planejamento ativo, sem mudar a fila de construção. A aprovação da direção não equivale ao aceite de um design completo ou de SPECs ainda inexistentes. Fatias, contratos e critérios serão definidos progressivamente; a numeração permanece exclusivamente no índice de `docs/STATUS.md`.

## Não decidido

- catálogo inicial de atividades/fontes e gatilhos de captura automática;
- contratos de identidade, versão, relações, correção, exclusão e deduplicação;
- persistência, retenção, reconstrução e eventual sincronização, respeitando a arquitetura vigente;
- mecanismo exato de recuperação, eventual necessidade de embeddings e orçamento;
- estratégia de atualização e contrato técnico/versionado do Graphify ou alternativa;
- critérios de validação de lições fora da pipeline;
- fatias, dependências, critérios de aceite e interfaces formais.

Nenhum desses itens em aberto pode ser inferido como requisito aprovado. A integração de Caveman discutida para a F05 não é automaticamente incorporada ao MVP-007.
