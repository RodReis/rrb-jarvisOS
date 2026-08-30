# MVP-007 — Memória Contextual e RAG

- Status: **contratos parciais aprovados pelo PI em 2026-08-30; oito fatias Planejadas; F01 com SPEC em rascunho, F02–F08 a redigir; design em elaboração; implementação não autorizada**.
- Origem: recorte de memória híbrida/RAG anteriormente associado ao Corte 3.
- Relação com a pipeline: **não bloqueia MVP-008, MVP-009 nem MVP-016**; a M16-F05 mantém escopo próprio e integração reutilizável.
- Design em elaboração: `docs/superpowers/specs/2026-08-30-mvp-007-memoria-compartilhada-design.md`.
- Issues publicadas: épico [#179](https://github.com/RodReis/rrb-jarvisOS/issues/179) e oito fatias #180–#187 em `proplan:planejado`, com pais/dependências conferidos em 2026-08-30. A #164 trata de memória de falhas do MVP-016, não deste núcleo.
- Plano de publicação: `docs/superpowers/plans/2026-08-30-mvp-007-publicacao-issues.md`; índice e links canônicos em `docs/STATUS.md`.

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

## Recuperação contextual aprovada

Recuperação seletiva e progressiva, começando por tarefa/projeto e ampliando para conhecimento global ou outros projetos quando a pergunta ou relações relevantes justificarem, dentro das permissões existentes. Combinar busca textual e relações do grafo, sem embeddings obrigatórios neste recorte; ausência do grafo mantém a busca básica.

Priorizar relevância e validade, explicitar contradições e identificar material histórico. Entregar trechos com fonte, revisão, validade e lacunas; expandir apenas para resolver lacuna concreta, sob limites de consultas/tempo/tokens, encerrando sem informação nova ou orçamento. O solicitante fornece o orçamento e referências enviadas também contam; na pipeline, a memória fornece candidatos e o `ContextPack` decide o pacote final. Detalhamento aprovado na seção 9 do design.

## Fontes iniciais aprovadas

Três entradas materializam o catálogo: projetos registrados (documentos/código selecionados, decisões, revisões Git e artefatos); registros de módulos (tarefas, agentes e operações conforme disponíveis); conhecimento explícito registrado no produto (notas/orientações com autoria e fonte).

Adaptadores de leitura identificam registros/revisões, entregam alterações desde o último ponto processado e informam cobertura. A memória mantém seu progresso sem alterar originais. Núcleo inicialmente operável com projetos/documentos e conhecimento explícito; integrações operacionais entram progressivamente, sem dependência de todos os menus futuros. Históricos/agentes/serviços/vaults externos exigem integração própria, não varredura automática. Graphify organiza material fornecido sem escolher novas fontes. Detalhamento aprovado na seção 10 do design.

## Ingestão e retomada aprovadas

Carga inicial registra uma referência de corte para acompanhar as alterações posteriores; resultados e progresso próprio são persistidos consistentemente por fonte, permitindo retomada do último ponto confirmado. Reentrega não duplica; conteúdo divergente sob a mesma identidade/revisão gera conflito, sem sobrescrita silenciosa.

Evento problemático vira pendência durável com identificação, motivo e referência para reprocessamento antes de continuar, nunca aplicação fictícia. Falhas de uma fonte não interrompem as outras nem a pipeline; retentativas usam espera progressiva e consumo limitado. Cobertura distingue carga inicial, atualização, atraso, pendências e indisponibilidade. Histórico expirado exige reconciliar o disponível e declarar lacunas, sem prometer recuperação completa. Detalhamento aprovado na seção 11 do design; mecanismos e limites técnicos ainda serão especificados.

## Integração opcional do Graphify aprovada

Adapter substituível sob contrato próprio dos produtos, sem definir o modelo central pelo formato interno do Graphify. Recebe apenas fontes selecionadas com identidade/revisão, sem ampliar acessos ou instalar configurações globais automaticamente. Extração estrutural local de código e enriquecimento semântico de documentos/notas pelos executores autorizados, dentro do orçamento existente, sem migração silenciosa para API paga; compatibilidade concreta ainda será verificada.

Saída normaliza relações com fonte, revisão e distinção entre extração e inferência; correções/remoções invalidam relações antigas antes de apresentá-las como atuais. Resultados de `save-result`/`reflect`, quando usados, são candidatos rastreáveis, não decisões do PI ou promoção automática de políticas. Ausência/incompatibilidade mantém busca básica; atualizações exigem testes de compatibilidade e não são silenciosas. Contrato aprovado na seção 12 do design; assinaturas, schemas e versão concreta ainda serão especificados, sem instalação ou implementação.

## Validação das lições fora da pipeline aprovada

Lição candidata registra afirmação, contexto, projeto, fontes e resultados observados; repetição da conclusão não gera novas evidências. O módulo responsável valida por critérios verificáveis definidos em sua especificação, e a memória registra o resultado sem inventar o significado de sucesso. Critérios objetivos permitem validação automática, sem aceite duplicado; ausência de critério/evidência mantém a candidata e não bloqueia desenvolvimento.

Validade se limita às condições e versões comprovadas, incluindo falhas e contrapontos, sem transformar sucesso isolado em regra universal. Mudança relevante nas fontes ou contradição retira a condição de validada vigente até reavaliação, preservando histórico. Decisão do PI não se confunde com comprovação empírica; lições orientam recomendações sem conceder novas permissões. A pipeline mantém avaliação/promoção no MVP-016. Modelo aprovado na seção 13 do design; formatos, estados e critérios concretos das integrações ainda serão especificados.

## Contrato comum dos registros/eventos aprovado

Envelope versionado com `schemaVersion`, tipo, origem e escopo, convertido pelos adaptadores sem mudar os produtores. `recordId`, `sourceRevision` e `eventId` distinguem registro, revisão e evento; o evento preserva sua identidade nas reentregas e os IDs se vinculam ao produto, escopo e fonte. Projeto explícito quando aplicável; conhecimento do produto possui escopo próprio, sem projeto fictício.

Tempo do acontecimento e da recepção são distintos e não provam substituição entre revisões. Conteúdo tipado referencia fontes; remoção/desatualização gera invalidação explícita, enquanto indisponibilidade temporária é cobertura, não exclusão. Evento incompatível vira pendência rastreável e progresso de ingestão não é identidade do registro. Contrato aprovado na seção 14 do design; representações, catálogo de tipos, schemas completos e limites ainda serão especificados.

## Regra de planejamento

O MVP está em planejamento ativo, sem mudar a fila de construção. O PI autorizou organizar e publicar oito fatias como Planejadas; isso não equivale ao aceite de um design completo ou de SPECs ainda inexistentes. Contratos e critérios serão detalhados nas fatias do plano de publicação; a numeração permanece exclusivamente no índice de `docs/STATUS.md`. Busca básica, memória operacional e interface não dependem da entrega do Graphify.

## Não decidido

A M7-F01 possui proposta escrita em `docs/spec/spec-memoria-01-nucleo-identidade-persistencia.md`: schema v1, identidade composta, revisão/substituição, conflitos, limites, SQLite transacional e vinte critérios de aceite. Esses detalhes aguardam revisão do PI; não estão aprovados por constarem no documento. Sua issue #180 continua Planejada. As pendências abaixo permanecem não aprovadas ou pertencem às fatias seguintes.

- representações concretas de IDs/escopo, catálogo de tipos/operações, schemas completos e limites conforme o contrato comum aprovado;
- representação de cobertura e mecanismos de corte, confirmação, retomada, pendências e retentativas conforme a política aprovada;
- contratos técnicos de armazenamento/compactação/reconstrução, capacidade e exclusão física conforme a política aprovada; sincronização fora deste recorte;
- contratos técnicos de consulta/resultados, atualização incremental e valores dos limites dentro do orçamento do solicitante;
- assinaturas, schemas, versão concreta, execução e testes de compatibilidade do adapter conforme o contrato aprovado;
- formato de avaliação, estados/transições e critérios concretos das integrações para lições fora da pipeline, conforme o modelo aprovado;
- critérios de aceite finais, interfaces formais e aprovação das SPECs das oito fatias planejadas.

Nenhum desses itens em aberto pode ser inferido como requisito aprovado. A integração de Caveman discutida para a F05 não é automaticamente incorporada ao MVP-007.
