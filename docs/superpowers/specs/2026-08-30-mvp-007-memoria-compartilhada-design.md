# Design em elaboração — MVP-007: Memória compartilhada JarvisOS e AgentsOS

- Status: **direção, captura e contrato de identidade/correções aprovados pelo PI em 2026-08-30; detalhamento em elaboração**.
- Esta revisão registra decisões parciais de escopo, captura e identidade/correções; **não é um design completo nem uma SPEC aprovada para construção**.
- Origem: proposta do PI de usar Graphify para memória e aprendizado transversal, acompanhada de quatro capturas dos menus futuros de JarvisOS/AgentsOS; aprovação da divisão entre MVP-007, M16-F05 e MVP-016.
- Documento do MVP: `docs/mvp/mvp-007-memoria-contextual.md`.
- Fatias e SPECs: ainda não definidas. Índice canônico: `docs/STATUS.md`.
- Relação com a execução: planejamento paralelo, não bloqueante para MVP-008, MVP-009 ou MVP-016; fila preservada.

## 1. Objetivo aprovado

Compartilhar memória contextual e conhecimento entre JarvisOS e AgentsOS, abrangendo atividades e artefatos dos módulos que forem integrados, inclusive o desenvolvimento dos próprios produtos. Os consumidores recuperam contexto e relações com origem rastreável, sem manter memórias independentes e conflitantes por menu ou enviar todo o histórico a cada chamada de modelo.

"Memorizar tudo" corresponde ao catálogo inicial aprovado na seção 6, com captura automática por eventos nos módulos integrados. Não constitui promessa de observar automaticamente módulos ainda inexistentes ou agentes externos sem integração. Schemas e garantias de entrega ainda serão detalhados.

## 2. Divisão de responsabilidades aprovada

### Histórico: o que aconteceu

Preservar referências a ações, decisões, execuções, falhas, resultados e artefatos, com autoria, projeto e versão. Os módulos responsáveis continuam donos dos registros originais. O núcleo não substitui Git, registros de execução, documentos aprovados, auditoria ou ledger.

### Conhecimento: como os elementos se relacionam

Conectar projetos, código, documentos, tarefas, agentes, skills e decisões por um núcleo compartilhado. Graphify é um componente opcional e substituível; o grafo é uma representação derivada e reconstruível, não a única cópia do histórico.

Uma visão global mantém a identidade de produto/projeto/agente e as permissões vigentes. Consulta cruzada não transfere automaticamente regras entre projetos nem promove conteúdo de negócio a política global. O contrato concreto de consulta será especificado depois.

### Aprendizado: o que comprovadamente funciona

Uma conclusão de agente não é prova de resultado. Distinguir observação, inferência e lição validada, com referência à evidência e à sua validade. Na pipeline, validação e promoção continuam no MVP-016. Outros módulos deverão definir seus critérios de sucesso; não recebem automaticamente a política experimental da pipeline nem autoridade nova por acessarem a memória.

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
4. **Correção cria revisão:** a revisão anterior fica identificada como substituída, com histórico sujeito à política de retenção ainda a definir. Evento antigo recebido com atraso não sobrescreve automaticamente informação mais recente. Ordem de chegada não é prova de substituição.
5. **Contradição explícita:** sem evidência de substituição, preservar as afirmações e apontar a divergência. Inferência de agente não passa a valer como decisão do PI apenas por ser mais recente ou repetida.
6. **Invalidação pela fonte:** remoção ou desatualização da fonte invalida as relações e conclusões dependentes como conhecimento atual. Não continuar apresentando como vigente uma conclusão cuja sustentação deixou de existir. Esse estado não equivale, por si só, a apagar todo o histórico; retenção e exclusão física terão contrato próprio.

Foram afastados a fusão baseada apenas em nome/texto e o uso indiscriminado da última mensagem recebida como verdade. O contrato preserva as responsabilidades de histórico, conhecimento e validação já aprovadas, sem criar autoridade nova nem bloquear execução da pipeline.

## 8. Decisões ainda abertas

1. Persistência, retenção, reconstrução e eventual sincronização dentro da arquitetura vigente.
2. Formato dos identificadores/revisões, schemas dos eventos, integrações iniciais, garantias de entrega e representação da cobertura, implementando os contratos aprovados nas seções 6 e 7.
3. Recuperação contextual, mecanismo de atualização incremental e alocação do orçamento por operação.
4. Contrato técnico/versionado do Graphify, alternativas e verificação de compatibilidade.
5. Evidências necessárias para lições fora da pipeline.
6. Fatias, ordem, dependências, critérios de aceite e interfaces formais.

As perguntas serão resolvidas uma por vez. Nenhum item aberto vira implementação, gate ou regra inventada pelo agente. Novos registros de decisão devem distinguir proposta de aprovação; design completo e SPECs terão sua revisão escrita no fluxo existente, sem pedir novamente aceite da mesma revisão.

## 9. Evidência e limite desta revisão

Este registro deriva da decisão do PI nesta conversa. A documentação oficial consultada para avaliar viabilidade está no [Graphify](https://github.com/Graphify-Labs/graphify); suporte documentado não prova compatibilidade com a versão instalada nem substitui futuros testes de contrato.

Não houve instalação, execução de Graphify/Caveman, captura de atividade, implementação, mudança de fila, push ou deploy. Esta revisão não aumenta a contagem de SPECs aprovadas.
