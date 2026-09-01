# Design em elaboração — MVP-007: Memória compartilhada JarvisOS e AgentsOS

- Status: **direção, captura, identidade/correções, persistência/retenção, recuperação, fontes iniciais, ingestão/retomada, integração opcional do Graphify, validação das lições fora da pipeline e contrato comum dos registros/eventos aprovados pelo PI em 2026-08-30; detalhamento em elaboração**.
- Esta revisão registra decisões parciais de escopo e contratos nas seções abaixo; **não é um design completo nem uma SPEC aprovada para construção**.
- Origem: proposta do PI de usar Graphify para memória e aprendizado transversal, acompanhada de quatro capturas dos menus futuros de JarvisOS/AgentsOS; aprovação da divisão entre MVP-007, M16-F05 e MVP-016.
- Documento do MVP: `docs/mvp/mvp-007-memoria-contextual.md`.
- Fatias: oito recortes de planejamento, com publicação autorizada pelo PI em 2026-08-30; SPECs da F01–F04 aprovadas e F05–F08 a redigir. Permanece a orientação de não implementar agora. Índice canônico: `docs/STATUS.md`.
- Issues do MVP-007: épico [#179](https://github.com/RodReis/rrb-jarvisOS/issues/179); #180–#183 em Backlog após aceite das SPECs e #184–#187 Planejadas, conforme a seção 15. A #164 pertence ao MVP-016 e não substitui esse acompanhamento.
- Relação com a execução: planejamento paralelo, não bloqueante para MVP-008, MVP-009 ou MVP-016; fila preservada.

## 1. Objetivo aprovado

Compartilhar memória contextual e conhecimento entre JarvisOS e AgentsOS, abrangendo atividades e artefatos dos módulos que forem integrados, inclusive o desenvolvimento dos próprios produtos. Os consumidores recuperam contexto e relações com origem rastreável, sem manter memórias independentes e conflitantes por menu ou enviar todo o histórico a cada chamada de modelo.

"Memorizar tudo" corresponde ao catálogo inicial aprovado na seção 6, com captura automática por eventos nos módulos integrados. Não constitui promessa de observar automaticamente módulos ainda inexistentes ou agentes externos sem integração. A política de entrega e retomada consta da seção 11; schemas e mecanismos técnicos ainda serão detalhados.

## 2. Divisão de responsabilidades aprovada

### Histórico: o que aconteceu

Preservar referências a ações, decisões, execuções, falhas, resultados e artefatos, com autoria, projeto e versão. Os módulos responsáveis continuam donos dos registros originais. O núcleo não substitui Git, registros de execução, documentos aprovados, auditoria ou ledger.

### Conhecimento: como os elementos se relacionam

Conectar projetos, código, documentos, tarefas, agentes, skills e decisões por um núcleo compartilhado. Graphify é um componente opcional e substituível; o grafo é uma representação derivada e reconstruível, não a única cópia do histórico.

Uma visão global mantém a identidade de produto/projeto/agente e as permissões vigentes. Consulta cruzada não transfere automaticamente regras entre projetos nem promove conteúdo de negócio a política global. A recuperação segue a seção 9; seu formato técnico será especificado depois.

### Aprendizado: o que comprovadamente funciona

Uma conclusão de agente não é prova de resultado. Distinguir observação, inferência e lição validada, com referência à evidência e à sua validade. Na pipeline, validação e promoção continuam no MVP-016. Outros módulos seguem o modelo aprovado na seção 13 e definem seus critérios de sucesso nas próprias especificações; não recebem automaticamente a política experimental da pipeline nem autoridade nova por acessarem a memória.

## 3. Consumidores previstos nos anexos

| Superfície futura | Uso previsto do núcleo |
|---|---|
| Agent Memory | Explorar relações, histórico, lições, fontes e validade. |
| Notebook | Registrar notas e conhecimento explícito ligado às fontes. |
| Mission Control / Command Center | Recuperar contexto da tarefa e explicar recomendações. |
| Projects Hub / Kanban / Workflows / Automations | Relacionar decisões, execuções, dependências e resultados. |
| Analytics / Insights | Exibir recorrências, tendências e melhorias sustentadas por evidências. |
| Skills Catalog / Specialties / Teams | Consultar resultados e condições de uso das configurações. |

Os anexos representam visão futura, não comprovação de integrações implementadas. Valores, agentes exibidos, menções a Obsidian/llm-wiki e aparência das capturas não selecionam tecnologia nem criam requisitos adicionais. Fatias visuais continuam sujeitas aos artefatos de design já exigidos pelo PI.

## 4. Fronteiras aprovadas

- **MVP-007:** núcleo compartilhado de memória contextual e conhecimento; começa agora seu detalhamento.
- **M16-F05:** estratégias e recomendações assistidas da pipeline, mantendo contrato reutilizável e fallback. Não recebe a construção do núcleo global, dos menus ou da ingestão universal.
- **MVP-016:** aprendizado operacional validado da pipeline, sem depender obrigatoriamente do MVP-007 e sem alterar os contratos aprovados de F01–F04.
- **MVP-018:** a visão de conhecimento cruzado não incorpora automaticamente o console operacional de portfólio, a gestão de capacidade ou sua execução.

O recorte técnico final das estratégias opcionais da F05 continua a ser consolidado em sua própria SPEC; esta aprovação resolve a fronteira, não aprova uma revisão escrita inexistente nem todas as funcionalidades dos pacotes externos.

## 5. Alternativas consideradas

- **Núcleo compartilhado com responsabilidades distintas — escolhido:** evita duplicação entre os produtos e conserva os donos de fatos, conhecimento derivado e validação.
- **Toda a memória global dentro da F05 — não escolhido:** mistura uma plataforma de conhecimento com uma fatia de estratégias da pipeline e amplia suas dependências.
- **Memória separada por produto/menu — não escolhido:** duplica ingestão e favorece históricos e conclusões divergentes.

## 6. Captura automática por eventos (PI, 2026-08-30)

O PI aprovou o seguinte catálogo inicial:

| Grupo | Atividades/fontes a registrar quando integradas |
|---|---|
| Projetos | Decisões, revisões de documentos/código, tarefas, commits e artefatos. |
| Agentes | Objetivo da execução, resultado, validações, falhas e correções. |
| Operações | Execuções de workflows, automações e releases, com estado e consumo observado. |
| Conhecimento explícito | Notas do Notebook, orientações do PI e conclusões vinculadas às fontes. |

A captura é automática por eventos dos módulos integrados, não depende de inserção manual de cada atividade. Os conteúdos originais permanecem nos módulos responsáveis; a memória conecta suas referências. A atualização do conhecimento é incremental e assíncrona, respeitando o orçamento existente, sem exigir uma chamada de modelo a cada evento.

Fonte ainda não integrada aparece como lacuna de cobertura, nunca como "nenhuma atividade". A aprovação do catálogo não significa que as integrações já existam ou que seja possível observar agentes externos sem adapter.

Foram afastadas como padrão a captura apenas manual, que deixa lacunas, e a coleta indiscriminada de cada clique ou saída de terminal, que aumenta ruído e consumo. Isso não elimina os registros canônicos já mantidos pelos módulos nem impede consulta às evidências referenciadas.

## 7. Identidade, proveniência e histórico de correções (PI, 2026-08-30)

O PI aprovou as seguintes regras de domínio:

1. **Identidade pela origem:** produto, projeto, fonte e identificador estável distinguem os registros. Nome ou caminho não bastam; renomear um documento não deve criar outra identidade quando a continuidade é comprovada pela origem. O formato técnico dos identificadores ainda será especificado.
2. **Reentrega não cria ocorrência:** repetição do mesmo evento é reconhecida e não duplica o registro. Execuções distintas permanecem distintas mesmo quando produzem conteúdos ou resultados iguais.
3. **Fontes distintas permanecem rastreáveis:** documento, conversa e execução podem ser relacionados sem apagar suas origens. Similaridade textual, por si só, não autoriza fusão automática de identidades ou afirmações.
4. **Correção cria revisão:** a revisão anterior fica identificada como substituída, com histórico sujeito à política de retenção da seção 8. Evento antigo recebido com atraso não sobrescreve automaticamente informação mais recente. Ordem de chegada não é prova de substituição.
5. **Contradição explícita:** sem evidência de substituição, preservar as afirmações e apontar a divergência. Inferência de agente não passa a valer como decisão do PI apenas por ser mais recente ou repetida.
6. **Invalidação pela fonte:** remoção ou desatualização da fonte invalida as relações e conclusões dependentes como conhecimento atual. Não continuar apresentando como vigente uma conclusão cuja sustentação deixou de existir. Esse estado não equivale, por si só, a apagar todo o histórico; aplica-se a retenção da seção 8, com mecanismo de exclusão física ainda a detalhar.

Foram afastados a fusão baseada apenas em nome/texto e o uso indiscriminado da última mensagem recebida como verdade. O contrato preserva as responsabilidades de histórico, conhecimento e validação já aprovadas, sem criar autoridade nova nem bloquear execução da pipeline.

## 8. Persistência, retenção e reconstrução (PI, 2026-08-30)

O PI aprovou separar memória durável de dados derivados descartáveis:

1. **Persistência local:** usar o armazenamento existente do aplicativo, mantendo os registros originais nos módulos responsáveis. Não introduzir serviço externo obrigatório. Sincronização fica para um recorte próprio; este MVP não redefine a arquitetura local-first vigente.
2. **Memória durável:** decisões, histórico de correções, lições e referências permanecem durante a vida do projeto, salvo exclusão explícita. Informação antiga pode continuar guardada sem ser considerada vigente. Essa regra não copia nem amplia automaticamente a retenção dos originais mantidos por outros módulos.
3. **Detalhes repetitivos:** compactar projeções repetitivas da memória após **30 dias**, preservando marcos, contagens e referências necessárias. Não eliminar decisões, correções ou evidências ainda necessárias. O prazo não expira toda a memória e não muda a retenção dos módulos de origem.
4. **Grafo e caches reconstruíveis:** regenerar a partir dos registros e fontes disponíveis, preservando correções e invalidações. Reconstrução não deve reativar relações invalidadas nem tratar uma versão antiga como atual.
5. **Reconstrução não é backup:** se uma fonte original desapareceu, apresentar a lacuna. Resumo ou hash não reconstituem o conteúdo perdido nem provam que uma reconstrução foi completa.
6. **Falha localizada:** indisponibilidade do grafo permite consultar as fontes e mecanismos básicos existentes, sem paralisar a pipeline. Recuperação continua limitada à disponibilidade real das fontes e ao orçamento vigente.

Foram afastados guardar indiscriminadamente todos os detalhes para sempre e expirar todas as classes de informação pelo mesmo prazo. Os limites e mecanismos técnicos de compactação, armazenamento e exclusão ainda serão detalhados, sem alterar a política acima. Este aceite não executa limpeza, exclusão, backup ou restauração de dados.

## 9. Recuperação seletiva, progressiva e orçamento (PI, 2026-08-30)

O PI aprovou a seguinte política de recuperação:

1. **Tarefa e projeto primeiro:** começar pelo contexto do solicitante. Conhecimento global ou de outros projetos é consultado quando a pergunta ou relações relevantes justificarem, dentro das permissões existentes. A ampliação não cria autoridade para aplicar regras entre projetos.
2. **Busca textual e relações do grafo:** combinar os dois mecanismos sem tornar embeddings obrigatórios neste primeiro recorte. Ausência ou indisponibilidade do grafo mantém a busca básica.
3. **Relevância e validade:** decisões aplicáveis do PI e fontes vigentes não são substituídas por inferências. Contradições relevantes aparecem explicitamente; material antigo pode responder perguntas históricas, identificado como tal.
4. **Trechos rastreáveis:** entregar conteúdo selecionado, fonte, revisão, condição de validade e lacunas. Não carregar automaticamente toda a memória nem transformar um resultado parcial em alegação de completude.
5. **Expansão justificada e limitada:** ampliar somente para resolver uma lacuna concreta, sob limites de consultas, tempo e tokens. Encerrar quando não houver informação nova ou orçamento disponível e declarar a limitação.
6. **Orçamento do solicitante:** trechos e referências enviados contam no consumo; não há orçamento adicional automático. Na pipeline, a memória fornece candidatos e o `ContextPack` permanece responsável pelo pacote final, sem duplicar o seletor ou substituir os limites existentes.

Foram afastados recuperar indiscriminadamente tudo e escolher apenas o texto mais parecido sem considerar decisões e relações. A memória fornece contexto rastreável, não autorização para agir. Formatos das consultas/resultados, ordenação técnica e valores dos limites serão detalhados sem alterar a política aprovada.

## 10. Fontes iniciais e adaptadores de leitura (PI, 2026-08-30)

O PI aprovou três entradas para materializar progressivamente os quatro grupos do catálogo da seção 6:

| Entrada | Recorte aprovado |
|---|---|
| Projetos registrados | Documentos e código selecionados, decisões, revisões Git e referências de artefatos, dentro do escopo permitido. |
| Registros dos módulos | Tarefas, execuções de agentes, validações, falhas, workflows, automações e releases, conforme os módulos responsáveis estiverem disponíveis; cobre os grupos agentes e operações. |
| Conhecimento explícito | Notas e orientações registradas no produto, preservando autoria e fonte. |

Cada fonte entra por um adaptador de leitura que identifica registros e revisões, entrega alterações desde o último ponto processado e informa sua cobertura. A memória mantém seu próprio progresso de ingestão sem modificar os registros originais. A política de entrega e retomada segue a seção 11; seus mecanismos técnicos ainda serão detalhados.

O núcleo deve funcionar inicialmente com projetos/documentos e conhecimento explícito, sem esperar todos os menus futuros. Integrações operacionais entram conforme disponíveis, com ausências visíveis. Isso não declara tais integrações implementadas nem transforma módulos futuros em pré-requisitos do núcleo.

Históricos externos de Claude/Codex, outros agentes, serviços externos e vaults não entram por varredura automática do computador: precisam de integração própria. Essa fronteira trata das fontes externas de conhecimento; não altera o uso do Vault de credenciais pelos runtimes existentes. Graphify organiza o material fornecido e não decide sozinho quais novas fontes acessar.

Foram afastados integrar todos os menus de uma vez, o que criaria dependências de funcionalidades ainda não construídas, e limitar permanentemente a memória a arquivos, o que perderia resultados das operações. Esta aprovação define recorte e fronteiras, sem instalar conectores, importar históricos ou executar varreduras.

## 11. Ingestão, retomada e cobertura por fonte (PI, 2026-08-30)

O PI aprovou o seguinte modelo de continuidade da ingestão:

1. **Carga inicial com referência de corte:** registrar até onde o histórico foi importado e acompanhar as alterações posteriores, evitando perder o intervalo entre histórico e novos eventos. O mecanismo depende das capacidades de cada fonte; ausência de continuidade comprovada deve aparecer na cobertura.
2. **Ponto de retomada por fonte:** persistir resultados e progresso de forma consistente. Após reinício, retomar do último ponto confirmado, sem reconstruir todo o histórico por padrão. Esse progresso pertence à memória, não altera checkpoints nem registros dos módulos de origem.
3. **Reentrega sem duplicação:** reconhecer eventos repetidos pela identidade aprovada na seção 7. Conteúdo divergente sob a mesma identidade/revisão é conflito, não sobrescrita silenciosa; uma nova revisão legítima segue o contrato de correções.
4. **Pendência antes de continuar:** evento problemático exige registro durável de identificação, motivo e referência à fonte para reprocessamento antes de seguir adiante. Não marcá-lo como aplicado nem descartá-lo silenciosamente. Avanço do ponto de leitura não resolve a pendência nem comprova cobertura completa; não exige copiar indefinidamente o conteúdo original para a memória.
5. **Falhas independentes:** indisponibilidade de uma fonte não impede as demais nem bloqueia a pipeline. Retentativas usam espera progressiva e consumo limitado, sem laço infinito. Quantidades, prazos e mecanismo técnico serão definidos nas SPECs dentro do orçamento vigente.
6. **Cobertura explícita:** distinguir carga inicial, atualização, atraso, pendências e fonte indisponível. Se o histórico necessário já tiver expirado na origem, reconciliar o material disponível e declarar a lacuna; nunca afirmar recuperação completa sem evidência.

Foram afastados reconstruir tudo a cada início, pelo custo desnecessário, e ignorar eventos problemáticos, por ocultar perda. A política não promete entrega exatamente uma vez nem recuperação de conteúdo perdido. Preserva as regras de correção, invalidação e retenção das seções 7 e 8; não executa importação ou reprocessamento nesta etapa documental.

## 12. Contrato de integração opcional do Graphify (PI, 2026-08-30)

O PI aprovou o seguinte contrato de fronteira para evitar duas memórias concorrentes:

1. **Adapter substituível:** JarvisOS/AgentsOS mantêm um contrato próprio, com versão compatível verificada. O formato interno do Graphify não define o modelo central da memória; os registros canônicos continuam nos responsáveis já definidos.
2. **Entrada delimitada:** o adapter recebe fontes selecionadas com identidade e revisão. Não amplia acessos nem instala configurações globais automaticamente. A seleção e o progresso das fontes permanecem sob os contratos das seções 10 e 11.
3. **Código, documentos e notas:** extração estrutural local para código e enriquecimento semântico pelos executores autorizados, dentro do orçamento existente, sem migração silenciosa para API paga. O recorte não reduz a memória global a código nem exige chamada de modelo por evento. A compatibilidade concreta entre backend, executor e versão ainda será verificada; este aceite não a presume.
4. **Saída rastreável:** normalizar relações com fonte, revisão e distinção entre extração e inferência. Correções e remoções devem invalidar relações antigas antes de apresentá-las como atuais. O estado do grafo não substitui a validade das fontes ou o histórico de correções do núcleo.
5. **Reflexões como candidatas:** quando utilizados, resultados de `save-result`/`reflect` entram com proveniência e não substituem decisões do PI nem promovem políticas automaticamente. A disponibilidade desses recursos não cria uma segunda fonte canônica de memória nem transforma uma sugestão em lição validada. Validação operacional da pipeline permanece no MVP-016; critérios dos demais módulos ainda serão definidos.
6. **Falha sem paralisação:** ausência ou incompatibilidade mantém a busca básica, sob os limites existentes. Atualizações do adapter exigem testes de compatibilidade; não atualizar silenciosamente. A integração opcional não bloqueia a pipeline nem torna o MVP-007 obrigatório para a F05.
7. **Runtime isolado e versionado (PI, 2026-08-31):** o JarvisOS gerencia uma versão compatível do runtime Graphify, instalada somente por ação explícita. O produto não executa `graphify install`, não depende de instalação global e preserva a busca básica quando o runtime estiver ausente. A CLI global é apenas alternativa de desenvolvimento.

Foi afastado acoplar o núcleo ao formato interno do Graphify: economizaria adaptação inicial, mas dificultaria substituição e controle das correções. Permanecem para as SPECs a assinatura da interface, schemas normalizados, versão concreta compatível, mapeamento de erros e casos de teste. A aprovação do contrato e do modelo de runtime não seleciona automaticamente todos os recursos do pacote, instala o componente ou inicia sua execução.

## 13. Validação das lições fora da pipeline (PI, 2026-08-30)

O PI aprovou separar conclusão de execução de comprovação de que uma estratégia funcionou:

1. **Lição candidata rastreável:** registrar afirmação, contexto, projeto, fontes e resultados observados. Repetir a mesma conclusão não gera novas evidências; reentregas também não aumentam artificialmente a sustentação da lição.
2. **Validação pelo módulo responsável:** usar critérios verificáveis definidos na especificação daquele módulo. A memória registra o resultado; não inventa o que significa sucesso. Concluir uma execução não comprova, por si só, atingir o objetivo da estratégia.
3. **Automação sem aceite duplicado:** critérios objetivos permitem validação automática. Sem critério ou evidência suficiente, a lição continua candidata, sem bloquear desenvolvimento. O modelo não exige aprovação manual de cada lição nem cria novo gate de construção.
4. **Validade limitada ao comprovado:** registrar condições e versões em que funcionou, incluindo falhas e contrapontos. Um sucesso isolado não vira regra universal; o alcance da lição não pode exceder o que as evidências sustentam.
5. **Reavaliação quando necessário:** mudança relevante nas fontes ou evidência contraditória retira a condição de validada vigente até nova avaliação, preservando o histórico. Essa mudança não apaga a avaliação anterior nem implica alterar retrospectivamente registros de execução.
6. **Conhecimento não autoriza ações:** orientação do PI permanece decisão, não comprovação empírica. Lições podem orientar recomendações, mas não concedem novas permissões. A pipeline continua seguindo o MVP-016, sem substituir seus mecanismos de avaliação e promoção por este modelo.

Foram afastados validar tudo manualmente, pelo trabalho recorrente, e aceitar toda conclusão de agente, por acumular falsas certezas. A automação depende dos critérios definidos pelo módulo; ausência deles não impede a captura de observações ou o uso de candidatas identificadas como tal. Permanecem para as SPECs o formato da avaliação, estados e transições, critérios concretos de cada integração e casos de teste. Esta decisão não executa avaliações, promove políticas ou inicia construção.

## 14. Contrato comum dos registros e eventos (PI, 2026-08-30)

O PI aprovou separar o registro, sua revisão e o evento que comunica uma mudança:

1. **Envelope versionado:** `schemaVersion`, tipo, origem e escopo identificam o contrato. Cada adaptador converte sua fonte para esse formato comum, sem exigir mudanças nos módulos produtores.
2. **Identidades separadas:** `recordId` identifica o registro; `sourceRevision`, sua revisão; `eventId`, o evento, preservado nas reentregas. Os IDs ficam vinculados ao produto, escopo e fonte, sem assumir unicidade global de um identificador isolado.
3. **Escopo explícito:** identificar o projeto quando aplicável; conhecimento do produto usa escopo próprio. Não criar projeto fictício nem misturar registros de origens diferentes. O escopo de identificação não amplia permissões de consulta ou execução.
4. **Tempo não determina substituição:** distinguir quando o evento aconteceu de quando foi recebido. Revisões indicam a substituição comprovada; relógios e ordem de chegada não decidem qual informação prevalece. Permanecem as regras de conflito e proveniência da seção 7.
5. **Conteúdo tipado e referenciado:** cada tipo possui campos definidos e referências às fontes. Remoção/desatualização gera invalidação explícita; fonte temporariamente indisponível é problema de cobertura, não exclusão. Invalidação não equivale a uma ordem de exclusão física do histórico.
6. **Compatibilidade verificável:** evento incompatível vira pendência rastreável, sem aplicação fictícia, conforme a seção 11. O progresso de ingestão fica separado da identidade dos registros.

Foi afastado aceitar qualquer objeto livre: facilitaria a primeira integração, mas transferiria ambiguidades para todos os consumidores. O envelope comum preserva diferenças entre fontes sem espalhá-las pelo núcleo. Representações concretas de IDs/escopo, catálogo de tipos/operações, schemas completos, limites e exemplos serão detalhados nas SPECs. Este contrato não migra dados nem reescreve contratos já aprovados do MVP-016.

## 15. Organização das fatias e publicação autorizada (PI, 2026-08-30)

O PI autorizou organizar as fatias por dependência e publicar o épico e suas issues de planejamento. Foram derivados oito recortes dos contratos acima: núcleo/identidade/persistência; fontes/ingestão/retomada; recuperação/orçamento; retenção/reconstrução; adapter opcional do Graphify; memória operacional/lições; Agent Memory/Notebook; resiliência/prova integrada.

O plano de publicação está em `docs/superpowers/plans/2026-08-30-mvp-007-publicacao-issues.md`, com escopo, dependências, alvos de verificação e pendências por fatia. Numeração e associação às SPECs permanecem no índice canônico de `docs/STATUS.md`; F01–F04 estão **aprovadas-pi** e F05–F08 estão **a redigir**.

SPEC da F04: `docs/spec/spec-memoria-04-retencao-reconstrucao.md`, revisão `027f8274dc4e3d39a6fc24ce394ea6b53d70f986`, aprovada explicitamente pelo PI em 2026-08-30, incluindo vinte critérios. Aceite cobre compactação reversível após 30 dias, reconstrução retomável por partição/geração/journal, exclusão escopada com supressão de reingestão, capacidade e agenda. #183 passa a Backlog, dependente apenas de #181; FTS/Graphify são integrações opcionais. Originais, auditoria e ContextPacks congelados ficam com seus donos. O mecanismo inicial da seção 8 está detalhado; F01–F03 permanecem intactas. Não iniciar implementação.

SPEC da F03: `docs/spec/spec-memoria-03-recuperacao-contextual-orcamento.md`, revisão `c3b546a1787961bb0b9bb407cd7213d5b7046b1b`, aprovada explicitamente pelo PI em 2026-08-30. O aceite cobre busca/índice lexical local e relações opcionais, histórico e validade/cobertura explícitos, ranking, sessões/expansões limitadas, parcela de orçamento e integração opcional com ContextPack/envio, incluindo vinte critérios. O detalhamento inicial da seção 9 está resolvido; F01/F02 permanecem intactas. #182 passa a Backlog, dependente de #181, sem iniciar implementação.

SPEC da F02: `docs/spec/spec-memoria-02-fontes-ingestao-retomada.md`, revisão `e4a521c6ad2339b8a6368d183afb46b8c26b5b80`, aprovada explicitamente pelo PI em 2026-08-30. Git selecionado/commitado desde a inscrição e recorte de primeiros pais, reconciliação de decisões existentes, serviço canônico interno de notas sem UI e ingestão retomável com cobertura/limites explícitos. Os vinte critérios estão aprovados; o contrato técnico da F01 não foi alterado. #181 passa a Backlog com dependência #180. Os detalhes de fontes/corte/confirmação/retentativas das seções 10/11 estão resolvidos para essas três entradas, sem iniciar implementação.

SPEC da F01: `docs/spec/spec-memoria-01-nucleo-identidade-persistencia.md`, revisão `83e952fd4e5f22850653bf81cf1d45d6c4377c84`, aprovada explicitamente pelo PI em 2026-08-30. O aceite cobre schemas/limites v1, chaves compostas, revisões com substituição comprovada, conflitos, invalidação e armazenamento no SQLite existente, com vinte critérios. As representações concretas do núcleo nas seções 7/8/14 estão resolvidas por essa SPEC. A #180 passa a Backlog; ingestão, recuperação, manutenção, Graphify, avaliações e UI continuam nas respectivas fatias. Não iniciar implementação nem alterar o `next`.

Graphify permanece uma ramificação opcional: busca básica, memória operacional e interface não dependem dele. A prova final cobre presença e ausência do adapter. Fontes futuras não se tornam requisitos obrigatórios do núcleo; MVP-008, MVP-009, MVP-016 e M16-F05 não recebem bloqueios por este MVP. Agent Memory/Notebook preserva os artefatos visuais exigidos pelo PI, sem incorporar a construção de todos os menus das capturas.

A publicação permite acompanhar o planejamento; não é aprovação de design completo ou de SPEC inexistente, não inicia implementação nem altera o `next` do projeto.

Publicação conferida em 2026-08-30: épico #179, oito sub-issues #180–#187 e dez dependências técnicas. Corpos, títulos, labels e vínculos correspondem ao plano; nenhuma fatia recebeu Backlog ou `next`. As decisões parciais e o plano foram referenciados nas issues pelo commit local `a789c804dfeb09123d9febdb414cfcb23ee2eace`, sem push. O `next` externo passou de #101 para #102 durante a tarefa, sem intervenção desta publicação.

## 16. Decisões ainda abertas

1. Redação, critérios finais e aprovação de F05–F08, começando por M7-F05 (#184). F01–F04 aprovadas pelas revisões exatas acima, sem repetir seus aceites.
2. Integrações futuras além das três entradas iniciais; adapters, recorte do histórico, notas, cobertura, corte, confirmação e retentativas iniciais estão aprovados na F02.
3. Extensões futuras além da manutenção inicial; compactação/reconstrução, capacidade e exclusão escopada da seção 8 estão detalhadas na F04 aprovada. Sincronização permanece fora deste recorte.
4. Extensões futuras além da recuperação inicial; contratos de consulta/resultados, atualização do índice, limites e ponte com ContextPack da seção 9 estão aprovados na F03.
5. Assinaturas, schemas, versão concreta e testes de compatibilidade do adapter conforme o contrato e o modelo de runtime aprovados na seção 12.
6. Formato de avaliação, estados/transições e critérios concretos das integrações para lições fora da pipeline conforme a seção 13.
7. Extensões do catálogo/schemas nas integrações seguintes conforme a seção 14; identidade, envelope, operações e limites do núcleo v1 estão aprovados na F01.

As perguntas serão resolvidas uma por vez. Nenhum item aberto vira implementação, gate ou regra inventada pelo agente. Novos registros de decisão devem distinguir proposta de aprovação; design completo e SPECs terão sua revisão escrita no fluxo existente, sem pedir novamente aceite da mesma revisão.

## 17. Evidência e limite desta revisão

Este registro deriva da decisão do PI nesta conversa. A documentação oficial consultada para avaliar viabilidade está no [Graphify](https://github.com/Graphify-Labs/graphify); suporte documentado não prova compatibilidade com a versão instalada nem substitui futuros testes de contrato.

Não houve instalação, execução de Graphify/Caveman, captura de atividade ou implementação. Em 2026-08-31, o PI aprovou para M7-F05 o runtime isolado/versionado, instalação explícita, ausência de `graphify install` automático, independência da instalação global e fallback para busca básica; a decisão foi registrada na issue #184 e ainda não constitui SPEC aprovada. As issues foram publicadas conforme a seção 15; os aceites posteriores da F01–F04 movem #180–#183 para Backlog e elevam o acervo local a 84 SPECs aprovadas. Aprovação da SPEC não é evidência de entrega.
