# MVP-007 — Memória Contextual e RAG

- Status: **direção de memória compartilhada, captura, identidade/correções e persistência/retenção aprovadas pelo PI em 2026-08-30; design em elaboração; sem fatias ou SPECs; implementação não autorizada**.
- Origem: recorte de memória híbrida/RAG anteriormente associado ao Corte 3.
- Relação com a pipeline: **não bloqueia MVP-008, MVP-009 nem MVP-016**; a M16-F05 mantém escopo próprio e integração reutilizável.
- Design em elaboração: `docs/superpowers/specs/2026-08-30-mvp-007-memoria-compartilhada-design.md`.

## Intenção preservada

Recuperar contexto rastreável por mecanismos textuais, vetoriais e/ou de grafo sem obrigar agentes a reler o repositório inteiro. A solução futura deverá respeitar Vault, BudgetPolicy, proveniência e isolamento por projeto.

## Direção aprovada

Um núcleo compartilhado serve JarvisOS e AgentsOS, inclusive o conhecimento sobre o desenvolvimento dos próprios produtos. Separa histórico do que aconteceu, conhecimento sobre relações e aprendizado sustentado por evidência. Os registros originais permanecem nos módulos responsáveis; o grafo é derivado e reconstruível.

Graphify é componente opcional e substituível de conhecimento, não a única memória nem autoridade de validação. Visão global mantém origem por produto/projeto/agente; consultar projetos em conjunto não aplica regras de um no outro. O MVP-016 continua responsável por validar aprendizado operacional da pipeline; outros módulos precisam definir suas evidências de sucesso.

Os menus futuros Agent Memory, Notebook, Mission Control, Command Center, Projects Hub, Kanban, Workflows, Automations, Analytics, Insights, Skills Catalog, Specialties e Teams são consumidores previstos, não memórias independentes nem promessa de implementação imediata. Os anexos apresentados pelo PI são referências de visão, não substitutos do design system e dos protótipos formais das fatias visuais.

## Catálogo de captura aprovado

Captura automática por eventos em quatro grupos: projetos (decisões, revisões, tarefas, commits e artefatos); agentes (objetivo, resultado, validações, falhas e correções); operações (workflows, automações e releases, com estado e consumo observado); conhecimento explícito (Notebook, orientações do PI e conclusões com fontes).

A atualização é incremental e assíncrona, dentro do orçamento existente, sem chamada de modelo obrigatória a cada evento. Os originais ficam nos módulos responsáveis e fontes não integradas aparecem como lacunas de cobertura. Não adotar como padrão captura apenas manual nem coleta indiscriminada de cliques e saídas de terminal. Detalhamento aprovado na seção 6 do design.

## Identidade e correções aprovadas

Identidade usa origem por produto/projeto/fonte e identificador estável, não apenas nome ou caminho. Reentrega do mesmo evento não duplica ocorrência; execuções diferentes continuam distintas. Fontes semelhantes são relacionáveis, mas não fundidas automaticamente por texto.

Correções criam revisões; chegada tardia não sobrescreve informação mais recente por ordem de recepção. Sem evidência de substituição, contradições permanecem explícitas e inferência de agente não substitui decisão do PI. Fonte removida/desatualizada invalida conhecimento dependente como atual. Histórico segue a retenção da seção 8; mecanismo de exclusão física ainda será detalhado. Contrato de identidade aprovado na seção 7 do design.

## Persistência e retenção aprovadas

Usar o armazenamento local existente, sem serviço externo obrigatório; sincronização fica para recorte próprio. Decisões, histórico de correções, lições e referências permanecem durante a vida do projeto, salvo exclusão explícita. Compactar detalhes repetitivos das projeções após 30 dias, preservando marcos, contagens, referências e evidências ainda necessárias, sem mudar a retenção dos originais nos módulos responsáveis.

Grafo e caches são reconstruíveis a partir das fontes disponíveis, sem reativar relações invalidadas ou apagar correções. Reconstrução não substitui backup: fonte perdida gera lacuna, não conteúdo inventado. Grafo indisponível permite fallback às fontes e mecanismos básicos sem bloquear a pipeline. Detalhamento aprovado na seção 8 do design.

## Regra de planejamento

O MVP entra em planejamento ativo, sem mudar a fila de construção. A aprovação da direção não equivale ao aceite de um design completo ou de SPECs ainda inexistentes. Fatias, contratos e critérios serão definidos progressivamente; a numeração permanece exclusivamente no índice de `docs/STATUS.md`.

## Não decidido

- formato técnico dos identificadores/revisões e schemas dos eventos, integrações iniciais, garantias de entrega e representação de cobertura;
- contratos técnicos de armazenamento/compactação/reconstrução, capacidade e exclusão física conforme a política aprovada; sincronização fora deste recorte;
- mecanismo exato de recuperação, eventual necessidade de embeddings e orçamento;
- estratégia de atualização e contrato técnico/versionado do Graphify ou alternativa;
- critérios de validação de lições fora da pipeline;
- fatias, dependências, critérios de aceite e interfaces formais.

Nenhum desses itens em aberto pode ser inferido como requisito aprovado. A integração de Caveman discutida para a F05 não é automaticamente incorporada ao MVP-007.
