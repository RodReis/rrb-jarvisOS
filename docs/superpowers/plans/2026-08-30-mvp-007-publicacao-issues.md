# Plano de publicação — MVP-007: Memória compartilhada

- Estado: planejamento autorizado pelo PI em 2026-08-30; oito fatias organizadas para publicação como `proplan:planejado`.
- Não é SPEC aprovada, plano de execução de código nem aceite do design completo. As pendências abaixo permanecem abertas.
- Base: `docs/superpowers/specs/2026-08-30-mvp-007-memoria-compartilhada-design.md`, decisões parciais registradas até o commit local `574d359`.
- Índice canônico Fatia ↔ SPEC e links de issues: `docs/STATUS.md`. Não criar slugs de SPEC inexistente; estado inicial: a redigir.
- Publicação GitHub autorizada; push de Git, implementação e alteração do `next` não fazem parte desta tarefa.

## Sequência e dependências

Ordem de apresentação/publicação: F01, F02, F03, F04, F05, F06, F07, F08. As dependências abaixo, e não a posição numérica isolada, determinam a ordem técnica.

- F01 → F02 → F03.
- F02 → F04; F03 + F04 → F05 (Graphify opcional).
- F03 → F06; F04 + F06 → F07.
- F05 + F07 → F08 (prova integrada do conjunto).

F03, F06 e F07 não dependem de F05 para funcionar. A dependência de F08 sobre a entrega do adapter serve para testar o conjunto, incluindo sua ausência em runtime; não torna Graphify obrigatório no produto. A pipeline/M16-F05 não recebe dependência deste MVP. Fontes operacionais externas entram apenas quando disponíveis; este plano não torna todos os módulos futuros pré-requisitos.

## Regras de publicação

- Épico com `proplan:mvp`, estado de planejamento explícito no corpo; oito sub-issues com `proplan:planejado` e sem `proplan:backlog`/`proplan:next`.
- Cada issue contém objetivo, escopo derivado, alvos de verificação, pendências, fonte e dependências. Alvos não são critérios de uma SPEC já aprovada.
- Vínculos pai/sub-issue e dependências nativos no GitHub; verificar corpos, labels, contagem e vínculos após publicar.
- Documentação de referência permanece local, sem push; o corpo das issues deve ser autossuficiente e não fingir que um caminho local é um arquivo publicado.
- F07 preserva a exigência de DESIGN-SYSTEM.md e protótipos HTML após o PRD e antes da construção. Nenhum gate novo é introduzido.

## Recortes para especificação

### M7-F01 — Núcleo, identidade e persistência

**Dependências diretas:** nenhuma fatia anterior do MVP-007; reutiliza a fundação local existente.
**Fonte:** seções 2, 7, 8 e 14 do design.

Estabelecer o contrato comum e a memória local compartilhada, distinguindo registro, revisão e evento sem substituir os donos das fontes.

**Escopo derivado:**

- Envelope versionado, escopo de produto/projeto e identidades recordId/sourceRevision/eventId.
- Persistência local existente, proveniência, deduplicação, revisões, contradições e invalidação de conhecimento atual.
- Fronteira entre histórico referenciado, conhecimento derivado e avaliação de lições.

**Alvos de verificação (a detalhar na SPEC):**

- [ ] Reentrega idêntica não duplica; conteúdo divergente na mesma identidade/revisão gera conflito.
- [ ] Eventos fora de ordem não tornam revisão antiga vigente; fontes semelhantes não se fundem apenas pelo texto.
- [ ] Estado durável é recuperável após reinício, sem depender de Graphify.

**Pendências explícitas:**

- Representações concretas, catálogo inicial de tipos, schemas e limites de payload.
- Estrutura de armazenamento, migrações e fronteira transacional; sem serviço externo obrigatório.

### M7-F02 — Fontes iniciais, ingestão e retomada

**Dependências diretas:** M7-F01.
**Fonte:** seções 6, 10, 11 e 14 do design.

Ingerir projetos registrados e conhecimento explícito com carga inicial, alterações posteriores e retomada independente por fonte.

**Escopo derivado:**

- Adaptadores de leitura para documentos/código selecionados, decisões/revisões Git e notas/orientações registradas no produto.
- Referência de corte, progresso próprio, pendências duráveis, reconciliação e cobertura explícita.
- Falhas independentes e retentativas progressivas com consumo limitado; originais permanecem nos donos.

**Alvos de verificação (a detalhar na SPEC):**

- [ ] Reinício e reentrega convergem sem duplicação ou lacuna silenciosa entre histórico e novos eventos.
- [ ] Evento incompatível vira pendência antes de continuar; fonte indisponível não é tratada como exclusão.
- [ ] Histórico expirado produz lacuna explícita; uma fonte em falha não impede as demais.

**Pendências explícitas:**

- Capacidades dos primeiros adaptadores, cursores/corte, confirmação e contrato de cobertura.
- Limites de lote, retentativas e reprocessamento; não importar históricos externos por varredura.

### M7-F03 — Recuperação contextual e orçamento

**Dependências diretas:** M7-F02.
**Fonte:** seções 2, 8, 9 e 12 do design.

Entregar contexto textual rastreável e limitado por tarefa/projeto, com contrato para relações opcionais e consumidores compartilhados.

**Escopo derivado:**

- Busca básica, validade, contradições, consultas históricas e ampliação global/cruzada justificada.
- Trechos com fonte/revisão e lacunas; expansão progressiva dentro do orçamento do solicitante.
- Fornecimento de candidatos ao ContextPack, que mantém composição final; contrato de consulta de grafo sem exigir Graphify.

**Alvos de verificação (a detalhar na SPEC):**

- [ ] Busca funciona sem grafo e não apresenta fonte invalidada como vigente.
- [ ] Consulta não mistura escopos indevidamente nem substitui decisão aplicável do PI por inferência.
- [ ] Expansão para sem informação nova ou orçamento; conteúdo/referências enviados entram na contabilização.

**Pendências explícitas:**

- Schemas de consulta/resultado, ordenação, paginação e limites de consulta/tempo/tokens.
- Assinaturas de integração com consumidores existentes; não duplicar o seletor do ContextPack.

### M7-F04 — Retenção e reconstrução da memória

**Dependências diretas:** M7-F02.
**Fonte:** seções 7, 8 e 11 do design.

Gerenciar dados duráveis e projeções compactáveis, reconstruindo derivados sem perder correções ou simular recuperação de fontes ausentes.

**Escopo derivado:**

- Manter decisões, correções, lições e referências durante a vida do projeto, salvo exclusão explícita.
- Compactar detalhes repetitivos das projeções após 30 dias, preservando marcos, contagens, referências e evidências necessárias.
- Reconstruir índices/caches a partir do disponível e definir mecanismo de exclusão física conforme a política aprovada, sem mudar retenção dos donos.

**Alvos de verificação (a detalhar na SPEC):**

- [ ] Compactação não remove decisões, correções ou evidências necessárias.
- [ ] Reconstrução não reativa conhecimento invalidado; perda da fonte permanece visível como lacuna.
- [ ] Interrupção durante manutenção permite retomada consistente, sem apagar os originais.

**Pendências explícitas:**

- Mecanismos de compactação/rebuild, capacidade, agendamento e exclusão física.
- Proteção de referências/evidências durante manutenção e consulta; sincronização fora deste recorte.

### M7-F05 — Adapter opcional do Graphify

**Dependências diretas:** M7-F03, M7-F04.
**Fonte:** seções 2, 8, 9 e 12 do design.

Integrar Graphify como produtor substituível de relações derivadas, sem torná-lo a memória canônica ou dependência da busca básica.

**Escopo derivado:**

- Entrada delimitada por fonte/revisão; contrato próprio e saída normalizada com proveniência e extração/inferência.
- Extração estrutural local de código e enriquecimento semântico pelos executores autorizados, dentro do orçamento vigente.
- Atualização/invalidação de relações, fallback e testes de compatibilidade de versão; reflexões, quando usadas, permanecem candidatas.

**Alvos de verificação (a detalhar na SPEC):**

- [ ] Ausência, incompatibilidade e falha do componente preservam a busca básica.
- [ ] Correção/remoção de fonte invalida relações antigas como atuais; reconstrução não ressuscita versões inválidas.
- [ ] Não há acesso ampliado, configuração global automática, API paga silenciosa ou promoção automática de políticas.

**Pendências explícitas:**

- Versão concreta, interface, backend/executor compatível, mecanismo de execução e schemas normalizados.
- Decidir o uso inicial de save-result/reflect e fixtures de compatibilidade, sem presumir suporte já testado.

### M7-F06 — Memória operacional e validação de lições

**Dependências diretas:** M7-F03.
**Fonte:** seções 2, 6, 7, 10 e 13 do design.

Conectar registros dos módulos disponíveis e registrar avaliações de lições com evidência, sem transferir à memória a autoridade de definir sucesso.

**Escopo derivado:**

- Adaptadores progressivos para tarefas, execuções de agentes e operações dos módulos disponíveis; ausências são cobertura explícita.
- Candidatas com afirmação, contexto, fontes/resultados; avaliação pelo módulo segundo critérios de sua especificação.
- Validade por condições/versões, falhas e contrapontos, reavaliação e histórico; pipeline mantém validação/promoção no MVP-016.

**Alvos de verificação (a detalhar na SPEC):**

- [ ] Repetir uma conclusão não aumenta evidência e terminar execução não prova sucesso da estratégia.
- [ ] Sem critério/evidência suficiente, permanece candidata e desenvolvimento continua.
- [ ] Mudança relevante ou contradição retira validade vigente; decisão do PI não se confunde com prova empírica.

**Pendências explícitas:**

- Primeiros módulos concretos integrados, capacidades e contrato de avaliação/estados.
- Critérios verificáveis de cada integração; não criar todos os menus futuros nem depender de Graphify.

### M7-F07 — Agent Memory e Notebook

**Dependências diretas:** M7-F04, M7-F06.
**Fonte:** seções 3, 7, 9, 10 e 13 do design.

Expor consulta da memória e registro de conhecimento explícito nas superfícies Agent Memory e Notebook, usando o núcleo compartilhado.

**Escopo derivado:**

- Busca, histórico, fontes/revisões, validade, contradições, lições e cobertura; visão de relações quando o adapter estiver disponível.
- Notas/orientações com autoria, fonte e revisões pelo módulo responsável, reaproveitando a ingestão já construída.
- Estados sem grafo, sem dados, com pendências e fontes indisponíveis; não construir todos os demais menus dos anexos.

**Alvos de verificação (a detalhar na SPEC):**

- [ ] Consulta e notas funcionam sem Graphify e não criam uma memória paralela por produto/menu.
- [ ] Usuário distingue candidata de validada, histórico de vigente e falta de cobertura de ausência de atividade.
- [ ] Fluxos visuais verificados no aplicativo/navegador real, incluindo estados de erro e indisponibilidade.

**Pendências explícitas:**

- PRD/recorte visual, DESIGN-SYSTEM.md e protótipos HTML antes da construção, conforme exigência já aprovada.
- Fluxos, componentes, navegação e testes de interação; anexos do PI não substituem os artefatos formais.

### M7-F08 — Resiliência e prova integrada

**Dependências diretas:** M7-F05, M7-F07.
**Fonte:** seções 6 a 14 do design.

Demonstrar a jornada integrada da memória compartilhada e seus limites, sem prometer cobertura universal ou economia de tokens não medida.

**Escopo derivado:**

- Cenários integrados de captura, consulta, correção, invalidação, manutenção e reavaliação.
- Falhas/reinício, reentregas, fontes ausentes, orçamento esgotado e adapter opcional indisponível.
- Evidência por cenário, cobertura e consumo observado; testes de cada fatia continuam obrigatórios em sua própria entrega.

**Alvos de verificação (a detalhar na SPEC):**

- [ ] Dois consumidores consultam o mesmo núcleo sem duplicar fatos ou transferir autoridade entre escopos.
- [ ] Falhas parciais não bloqueiam pipeline; consulta básica permanece sem Graphify.
- [ ] Relatório diferencia cenários realmente verificados, fixtures e integrações não disponíveis; nenhuma alegação de recuperação completa sem prova.

**Pendências explícitas:**

- Matriz de cenários, fixtures, limiares de capacidade/desempenho e estratégia de prova real versus simulada.
- Consolidar contratos finais e pendências das SPECs anteriores; não ampliar escopo para sincronização ou todos os menus.

## Limites de autorização

Criar este acompanhamento não muda contratos aprovados da pipeline, não aprova novas SPECs e não inicia a fila do MVP-007. Aprovação da organização/publicação foi dada pelo PI; escolhas técnicas ainda abertas serão resolvidas nas respectivas SPECs antes da construção, sem novo aceite duplicado da mesma revisão.
