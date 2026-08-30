# STATUS-ARQUIVO.md — Histórico detalhado

Complementa `STATUS.md`. O estado corrente, a numeração Fatia ↔ SPEC e as próximas ações ficam no arquivo curto; decisões, ressalvas e provas históricas ficam aqui.

## Snapshot consolidado até 2026-08-28

Em 2026-08-28 o `STATUS.md` foi reconciliado com o board: registros antigos ainda tratavam #34, #41, #43, #47, #52, #57, #58 e #69 como aguardando aceite, #66 como em andamento e não incluíam #74–#80. O snapshot corrigido registrou 33 issues finalizadas, MVP-004 em fechamento e MVP-005 na cabeça da fila.

## MVP-001 — Fundação

Épico [#1](https://github.com/RodReis/rrb-jarvisOS/issues/1), aceito em 2026-07-22.

| Issue | Fatia | SPEC | PR |
|---|---|---|---|
| [#2](https://github.com/RodReis/rrb-jarvisOS/issues/2) | Bootstrap | `spec-fundacao-01-bootstrap.md` | [#25](https://github.com/RodReis/rrb-jarvisOS/pull/25) |
| [#3](https://github.com/RodReis/rrb-jarvisOS/issues/3) | AppShell/Workspaces | `spec-fundacao-02-appshell-workspaces.md` | [#28](https://github.com/RodReis/rrb-jarvisOS/pull/28) |
| [#4](https://github.com/RodReis/rrb-jarvisOS/issues/4) | Auth Google | `spec-fundacao-03-auth-google.md` | [#30](https://github.com/RodReis/rrb-jarvisOS/pull/30) |
| [#5](https://github.com/RodReis/rrb-jarvisOS/issues/5) | Dados/AuditEvent | `spec-fundacao-04-dados-audit.md` | [#28](https://github.com/RodReis/rrb-jarvisOS/pull/28) |
| [#6](https://github.com/RodReis/rrb-jarvisOS/issues/6) | Settings | `spec-fundacao-05-settings.md` | [#29](https://github.com/RodReis/rrb-jarvisOS/pull/29) |
| [#8](https://github.com/RodReis/rrb-jarvisOS/issues/8) | Observabilidade | `spec-fundacao-06-observabilidade-logging.md` | [#27](https://github.com/RodReis/rrb-jarvisOS/pull/27) |

F04 e F02 saíram juntas porque `workspace-switch` precisava simultaneamente do fluxo e do `AuditEvent`. A F06 recebeu issue #8 porque #7 já estava ocupada.

## MVP-002 — Execução local controlada

Épico [#9](https://github.com/RodReis/rrb-jarvisOS/issues/9), aceito em 2026-07-23.

| Issue | Fatia | SPEC | PR |
|---|---|---|---|
| [#15](https://github.com/RodReis/rrb-jarvisOS/issues/15) | Supabase local | `spec-execucao-local-01-supabase-local.md` | [#32](https://github.com/RodReis/rrb-jarvisOS/pull/32) |
| [#11](https://github.com/RodReis/rrb-jarvisOS/issues/11) | Policy Engine | `spec-execucao-local-02-policy-engine.md` | [#33](https://github.com/RodReis/rrb-jarvisOS/pull/33) |
| [#12](https://github.com/RodReis/rrb-jarvisOS/issues/12) | Allowlist | `spec-execucao-local-03-allowlist-diretorios.md` | [#35](https://github.com/RodReis/rrb-jarvisOS/pull/35) |
| [#13](https://github.com/RodReis/rrb-jarvisOS/issues/13) | Workflows | `spec-execucao-local-04-registro-workflows.md` | [#36](https://github.com/RodReis/rrb-jarvisOS/pull/36) |
| [#14](https://github.com/RodReis/rrb-jarvisOS/issues/14) | Execução simulada | `spec-execucao-local-05-execucao-simulada.md` | [#37](https://github.com/RodReis/rrb-jarvisOS/pull/37) |

A F05 provou o modo report sem efeito real; MVP-004 converteu esse piso em execução allowlisted.

## MVP-003 — Design System

Épico [#16](https://github.com/RodReis/rrb-jarvisOS/issues/16), oito fatias aceitas em 2026-07-23. PRs: [#38](https://github.com/RodReis/rrb-jarvisOS/pull/38), [#40](https://github.com/RodReis/rrb-jarvisOS/pull/40), [#42](https://github.com/RodReis/rrb-jarvisOS/pull/42), [#45](https://github.com/RodReis/rrb-jarvisOS/pull/45), [#46](https://github.com/RodReis/rrb-jarvisOS/pull/46), [#49](https://github.com/RodReis/rrb-jarvisOS/pull/49), [#50](https://github.com/RodReis/rrb-jarvisOS/pull/50) e [#51](https://github.com/RodReis/rrb-jarvisOS/pull/51).

Base: Radix + Tailwind v4 + Lucide. As specs 03/04 foram divididas em a/b. O slot MVP-003 foi redefinido para Design System em 2026-07-21; Execução real passou ao MVP-004 e o documento antigo virou stub superseded.

## MVP-004 — Execução real

- F01 [#74](https://github.com/RodReis/rrb-jarvisOS/issues/74), `spec-execucao-real-01-filesystem-allowlisted.md`: PR [#81](https://github.com/RodReis/rrb-jarvisOS/pull/81), squash `19870a3`, aceita em 2026-08-28.
- F02 [#75](https://github.com/RodReis/rrb-jarvisOS/issues/75), `spec-execucao-real-02-terminal-controlado.md`: PR [#83](https://github.com/RodReis/rrb-jarvisOS/pull/83), entregue e aguardando aceite no snapshot.

A F01 teve quatro checks verdes e critérios comportamentais provados por integração. A fila de aprovação não foi validada renderizada no app real porque a navegação parou no login sem sessão; jsdom não prova CSS/layout. O CI também detectou build E2E desatualizado, Supabase parado, relatório sem carimbo e conflito documental.

## Fatia avulsa CHOICE

Issue [#69](https://github.com/RodReis/rrb-jarvisOS/issues/69), `spec-choice-01-selecao-de-espaco.md`, PR [#70](https://github.com/RodReis/rrb-jarvisOS/pull/70), aceita em 2026-07-24. Entregou `TelaChoice`, acento por `UserProfile` e Settings; rail/WorkspaceSwitcher permaneceram. Nasceu sem MVP pai por decisão explícita do PI.

## FIX e INFRA finalizados

| Issue | Resumo | PR | Aceite |
|---|---|---|---|
| [#43](https://github.com/RodReis/rrb-jarvisOS/issues/43) | leitura do `.env` | [#44](https://github.com/RodReis/rrb-jarvisOS/pull/44) | 2026-07-24 |
| [#47](https://github.com/RodReis/rrb-jarvisOS/issues/47) | `navegacao.spec.ts` fora da suíte | [#48](https://github.com/RodReis/rrb-jarvisOS/pull/48) | 2026-07-24 |
| [#52](https://github.com/RodReis/rrb-jarvisOS/issues/52) | `Meter` escondia rótulo | [#53](https://github.com/RodReis/rrb-jarvisOS/pull/53) | 2026-07-24 |
| [#57](https://github.com/RodReis/rrb-jarvisOS/issues/57) | login não seguia protótipo | [#59](https://github.com/RodReis/rrb-jarvisOS/pull/59) | 2026-07-24 |
| [#58](https://github.com/RodReis/rrb-jarvisOS/issues/58) | Tailwind não varria design | [#59](https://github.com/RodReis/rrb-jarvisOS/pull/59) | 2026-07-24 |
| [#34](https://github.com/RodReis/rrb-jarvisOS/issues/34) | E2E em job próprio | [#71](https://github.com/RodReis/rrb-jarvisOS/pull/71) | 2026-07-25 |
| [#41](https://github.com/RodReis/rrb-jarvisOS/issues/41) | porta variável do renderer | [#73](https://github.com/RodReis/rrb-jarvisOS/pull/73) | 2026-07-25 |
| [#66](https://github.com/RodReis/rrb-jarvisOS/issues/66) | custo do Actions privado | [#72](https://github.com/RodReis/rrb-jarvisOS/pull/72) | 2026-07-25 |
| [#64](https://github.com/RodReis/rrb-jarvisOS/issues/64) | rótulo quebrava botão | [#65](https://github.com/RodReis/rrb-jarvisOS/pull/65) | 2026-08-28 |

O #58 expôs que jsdom não aplica folha de estilo: 562 testes passavam mesmo com o CSS do DS fora do scanning. O #66 foi resolvido na origem ao tornar o repositório público; `concurrency` permaneceu como guarda. O merge do #44 fechou #43 por interpretar “FIX #43” na mensagem squash; a convenção passou a proibir esse padrão em commits.

## Evolução do Corte 3 e pipeline

- 2026-07-24: Corte 3 dividido em MVP-005 Providers/Vault/Budget, MVP-006 Conectores e MVP-007 Memória/RAG.
- 2026-08-28: MVP-006 redefinido como Conectores Essenciais: runtime, GitHub App e Tavily; antigos conectores voltaram ao backlog.
- 2026-08-28: pipeline dividida em MVP-008 Planejamento Governado e MVP-009 Entrega Autônoma; MVP-007 não bloqueia ambos.
- 2026-08-28: seis fatias por MVP executável, GitHub App + Device Flow, Tavily Search+Extract, Context7 técnico, anexos de design pelo PI, Git automático e ausência de aceite duplicado.
- As 18 SPECs foram criadas para revisão documental. Não nasceram issues e não houve autorização de implementação.

### Publicação antecipada das issues (2026-08-28)

Por solicitação explícita do PI, foram criados os épicos [#86](https://github.com/RodReis/rrb-jarvisOS/issues/86), [#93](https://github.com/RodReis/rrb-jarvisOS/issues/93) e [#100](https://github.com/RodReis/rrb-jarvisOS/issues/100), com 18 sub-issues na ordem #87–#92, #94–#99 e #101–#106. O GitHub registra sub-issues e dependências nativas entre fatias/MVPs.

Como as SPECs continuavam em revisão, as fatias receberam `proplan:planejado`, não `proplan:backlog`. Isso preserva a regra de que issue existente não equivale a autorização de implementação. O texto anterior registra o estado antes dessa decisão e permanece como histórico.

### Pipeline V2 especificada (2026-08-29)

O PI aprovou a arquitetura da Pipeline V2, encerrando as decisões estruturais sobre multi-executor Claude/Codex, Squads limitados pela SPEC, duas fatias concorrentes com prova de independência e execução contínua do DAG já autorizado. A V2 termina no merge técnico; deploy e aceite final permanecem fora.

Foram criados os documentos dos MVP-010 a MVP-013 e vinte SPECs, cinco por MVP, todas em `revisão-pi`. A arquitetura aprovada autoriza essa especificação, mas não autoriza implementação nem publicação das issues. Depois do aceite das revisões exatas, as issues devem ser criadas em ordem de implementação, de M10-F01 a M13-F05.

As SPECs preservam os contratos já decididos: um writer por fatia; Git/GitHub no kernel; CLIs autenticados por perfis isolados; nenhuma rota monetária silenciosa; workers sem escrita/Git; fallback sequencial quando independência não é provada; merge serializado; pausa/cancelamento sem apagar trabalho remoto; e nenhum gate, regra ou aceite inventado pelo agente.

Em 2026-08-29, o PI aprovou as vinte revisões exatas. Os estados passaram para `aprovada-pi` e foi autorizada a criação dos quatro épicos e vinte sub-issues na ordem de implementação. A aprovação adiciona backlog futuro; não move nenhuma fatia da V2 para `proplan:next` e não substitui a fila já registrada.

### Publicação das issues da Pipeline V2 (2026-08-29)

Os quatro épicos e vinte fatias foram publicados sem lacuna numérica dentro de cada grupo: MVP-010 [#115](https://github.com/RodReis/rrb-jarvisOS/issues/115), fatias #116–#120; MVP-011 [#121](https://github.com/RodReis/rrb-jarvisOS/issues/121), fatias #122–#126; MVP-012 [#127](https://github.com/RodReis/rrb-jarvisOS/issues/127), fatias #128–#132; MVP-013 [#133](https://github.com/RodReis/rrb-jarvisOS/issues/133), fatias #134–#138.

Cada fatia recebeu `proplan:backlog`, parent nativo e um `blocked by` que preserva a ordem aprovada. Cada épico recebeu `proplan:mvp` e depende do épico anterior; a primeira fatia de cada MVP também aponta para o épico anterior, repetindo o padrão dos MVPs 008/009. A relação remota organiza o backlog, mas não altera o contrato da Pipeline V2: merge confirmado satisfaz dependência técnica mesmo enquanto a issue aguarda fechamento/aceite do PI.

A reconciliação pós-criação consultou as 24 issues diretamente no GitHub e confirmou zero erros de label, parent, estado ou dependência. Nenhuma issue foi marcada `proplan:next` e nenhuma implementação foi iniciada.

### Publicação das issues da Pipeline V3 (2026-08-29)

Por solicitação do PI, foram publicados os três MVPs já desenhados na ordem de implementação: MVP-014, épico [#149](https://github.com/RodReis/rrb-jarvisOS/issues/149) e fatias #150–#154; MVP-015, épico [#155](https://github.com/RodReis/rrb-jarvisOS/issues/155) e fatias #156–#161; MVP-016, épico [#162](https://github.com/RodReis/rrb-jarvisOS/issues/162) e fatias #163–#168.

As onze fatias dos MVPs 014–015 e a M16-F01 possuem SPEC `aprovada-pi` e receberam `proplan:backlog`. As M16-F02–F06 receberam `proplan:planejado`, com declaração explícita de implementação não autorizada até a aprovação da revisão exata da SPEC. A mesma issue será atualizada quando aprovada; não será criada duplicata.

Cada fatia foi vinculada como sub-issue nativa ao seu épico. Cada épico depende do anterior; a primeira fatia depende do épico anterior e as demais formam cadeia sequencial. MVP-014 parte do MVP-013 (#133). O GitHub foi consultado novamente para as 20 issues: zero erro de estado, label, parent, dependência, ordem ou conteúdo. Nenhuma nova issue recebeu `proplan:next`; o avanço paralelo da fila corrente não foi alterado por esta publicação.

Os gates visuais da M15-F05 (#160) e M16-F06 (#168) permanecem: `DESIGN-SYSTEM.md` e protótipos HTML formais aprovados antes da construção. A publicação não inicia código, não dispara executor e não autoriza gasto externo.

### M16-F02 redigida para revisão exata (2026-08-29)

O PI confirmou classificação por etapa/natureza, resolução provada por ocorrência/contexto, normalização conservadora, recall seletivo dentro da parcela do ContextPack e separação entre núcleo determinístico da F02 e assistência real da F05. A SPEC `docs/spec/spec-aprendizado-02-memoria-falhas.md` registra contratos, limites e quinze critérios verificáveis, em `revisão-pi`.

A issue #164 permanece `proplan:planejado`, com predecessor #163 e parent #162; aprovação das decisões não foi confundida com aceite exato da revisão escrita. A conferência dos arquivos em `docs/spec` encontrou 76 cabeçalhos `aprovada-pi`, corrigindo a contagem anterior de 56 no STATUS; a F02 não entra nessa contagem. Não houve implementação, mudança de fila ou chamada de executor.

### M16-F02 aprovada pelo PI (2026-08-29)

O PI aprovou a revisão exata da SPEC no commit `eed7a5d`, preservando seus quinze critérios e limites. O status passa a `aprovada-pi` e a issue #164 passa a `proplan:backlog`, com predecessor #163 e parent #162 preservados. O épico passa a registrar F01–F02 aprovadas; F03–F06 permanecem Planejadas. O acervo local passa a 77 SPECs aprovadas e a Pipeline V3 a treze fatias em Backlog.

O registro do aceite não inicia implementação, não muda `next`, não fecha a issue nem declara entrega técnica. Esta tarefa continua no planejamento; próxima SPEC: M16-F03 (#165), registro e resolução de políticas.

### M16-F03 redigida para revisão exata (2026-08-29)

O PI confirmou cinco decisões: pacote completo por mecanismo, separação entre registro F03 e promoção F04, snapshot por run com controles operacionais vigentes, compatibilidade entre mecanismos com fallback do grupo afetado e persistência autossuficiente junto ao run. A SPEC `docs/spec/spec-aprendizado-03-registro-resolucao-politicas.md` consolida contratos, testes e quinze critérios de aceite, em `revisão-pi`.

A issue #165 permanece `proplan:planejado`, vinculada ao épico #162 e ao predecessor #164. O total de SPECs aprovadas permanece 77; F04–F06 ainda aguardam redação. Não houve implementação, alteração da fila ou chamada de executor.

### M16-F03 aprovada pelo PI (2026-08-29)

O PI aprovou a revisão exata da SPEC no commit `2ea2f1f`, preservando seus quinze critérios e limites. O status passa a `aprovada-pi` e a issue #165 passa a `proplan:backlog`, com predecessor #164 e parent #162 preservados. O épico passa a registrar F01–F03 aprovadas; F04–F06 permanecem Planejadas. O acervo local passa a 78 SPECs aprovadas e a Pipeline V3 a quatorze fatias em Backlog.

O aceite não inicia implementação, não muda `next`, não fecha a issue nem declara entrega técnica. Esta tarefa continua no planejamento; próxima SPEC: M16-F04 (#166), experimentos e promoção.

### M16-F04 redigida para revisão exata (2026-08-30)

O PI confirmou seis blocos: contrato prévio imutável; fronteiras de replay/shadow/canário; controle contemporâneo e alocação reproduzível; perfis iniciais baixo/médio; avaliador determinístico com qualidade anterior à eficiência; e estabilização/rollback com snapshots preservados. A SPEC `docs/spec/spec-aprendizado-04-experimentos-promocao.md` consolida contratos, limites e vinte critérios de aceite, em `revisão-pi`.

Os perfis de canário usam 10/10 e 20/20 unidades mínimas, exposição máxima de 50%/25%, prazo de 14/30 dias e ganho de 5%/10%. Estabilização exige 24h+10 ou 72h+20 novas unidades, com prazo máximo de 14/30 dias. Esses são mínimos operacionais, sem garantia estatística; volume/prova insuficiente produz inconclusão, não trabalho artificial ou bloqueio de desenvolvimento.

A issue #166 permanece `proplan:planejado`, com predecessor #165 e parent #162, até aprovação da revisão exata. A conferência dos cabeçalhos normalizados encontrou 79 SPECs aprovadas: a contagem anterior de 78 omitia `spec-choice-01-selecao-de-espaco.md`, cujo status aprovado está também formatado como código inline. A F04 continua fora da contagem e as fatias da V3 em Backlog continuam quatorze; F05–F06 ainda não foram redigidas. Os registros históricos acima preservam os números que foram informados naquelas ocasiões.

Não houve implementação, chamada de executor, mudança de fila, push ou deploy. A fila operacional do STATUS foi preservada do registro de 2026-08-29, sem apresentá-la como revalidada em 2026-08-30. O próximo marco é a revisão exata da F04; depois segue a especificação da F05.

### M16-F04 aprovada pelo PI (2026-08-30)

O PI aprovou a revisão exata da SPEC no commit `1cefc2c`, preservando requisitos, limites e vinte critérios de aceite. O status passa a `aprovada-pi` e a issue #166 passa a `proplan:backlog`, com predecessor #165 e parent #162 preservados. O épico passa a registrar F01–F04 aprovadas; F05–F06 permanecem Planejadas. A contagem normalizada passa a 80 SPECs aprovadas, com quinze fatias da V3 em Backlog.

O aceite não inicia implementação, não muda `next`, não fecha a issue nem declara testes de código/entrega técnica. Esta tarefa continua no planejamento; próxima SPEC: M16-F05 (#167), estratégias e recomendações assistidas. Fila operacional anterior e demais trabalhos do repositório permanecem intactos; não houve push.

### MVP-007: direção compartilhada aprovada (2026-08-30)

Durante o detalhamento da F05, o PI propôs usar Graphify também como parte da memória e do aprendizado de JarvisOS/AgentsOS e apresentou quatro capturas dos menus futuros. Aprovou um núcleo compartilhado no MVP-007, mantendo histórico nos módulos de origem, conhecimento derivado/reconstruível e validação de aprendizado distinta. Graphify permanece opcional e substituível; visão global conserva origem por produto/projeto/agente e não transfere regras automaticamente.

A decisão foi registrada em `docs/superpowers/specs/2026-08-30-mvp-007-memoria-compartilhada-design.md`. É direção aprovada com detalhamento em elaboração, não design completo ou SPEC para construção. Não existem ainda fatias do MVP-007; catálogo inicial de captura é a próxima decisão. As capturas são referências de visão, não evidência de implementação nem seleção automática de todas as integrações nelas mencionadas.

A F05 permanece focada em estratégias/recomendações assistidas, com fronteira reutilizável. A #167 continua Planejada, com parent #162 e predecessor #166 verificados nesta conferência; a memória compartilhada não vira dependência obrigatória do MVP-016. As SPECs F01–F04 não mudam, a contagem permanece 80 e o índice Fatia ↔ SPEC não recebe números novos. Nenhuma implementação, instalação, chamada de executor, mudança de fila ou push foi realizada.

### MVP-007: catálogo de captura aprovado (2026-08-30)

Depois do registro da direção no commit local `ed3ec5c`, o PI aprovou captura automática por eventos em quatro grupos: projetos; agentes; operações; conhecimento explícito. Conteúdos originais permanecem nos módulos responsáveis; atualização incremental e assíncrona usa o orçamento existente, sem exigir chamada de modelo a cada evento. Fonte não integrada aparece como lacuna de cobertura, não como ausência de atividade.

O detalhamento foi incorporado à seção 6 do design, mantendo como abertas identidade, proveniência, deduplicação, correções, garantias de entrega e demais contratos técnicos. A aprovação não escolhe captura indiscriminada de cliques/saídas de terminal nem depende de registro manual de cada atividade. O registro histórico anterior preserva a situação em que o catálogo ainda era a próxima decisão.

Nenhuma SPEC de fatia foi criada ou aprovada; o total permanece 80. Fila e índice Fatia ↔ SPEC não mudaram; não houve implementação, alteração de issues, captura real, instalação, push ou deploy nesta atualização. Próximo bloco: identidade e tratamento de correções.

### MVP-007: identidade e correções aprovadas (2026-08-30)

Após o catálogo registrado no commit local `2b690a0`, o PI aprovou identidade por origem e identificador estável; deduplicação de reentregas sem fundir execuções distintas; fontes rastreáveis sem fusão por mera similaridade; correções por revisão; contradições explícitas; e invalidação de conhecimento dependente de fonte removida/desatualizada. Ordem de chegada não define verdade nem transforma inferência em decisão do PI.

O contrato foi registrado na seção 7 do design. Formatos técnicos e política de retenção/exclusão física seguem abertos; não houve aprovação de armazenamento, prazos ou sincronização nesta etapa. Os registros históricos acima preservam a sequência das decisões. Próximo bloco: persistência, retenção e reconstrução.

Nenhuma SPEC de fatia foi criada ou aprovada; contagem permanece 80. Fila, índice e SPECs aprovadas não foram alterados; não houve implementação, alteração de issues, captura real, instalação ou push.

### MVP-007: persistência, retenção e reconstrução aprovadas (2026-08-30)

Após identidade/correções no commit local `c411adf`, o PI aprovou armazenamento local existente, memória durável durante a vida do projeto (salvo exclusão explícita) e compactação das projeções repetitivas após 30 dias. Marcos, contagens, referências e evidências necessárias são preservados; a retenção dos registros originais nos módulos responsáveis não é alterada. Guardado não significa vigente.

Grafo/cache são reconstruíveis a partir das fontes disponíveis, preservando correções e invalidações. Reconstrução não é backup e fonte perdida gera lacuna, não conteúdo inventado. Indisponibilidade do grafo permite fallback às fontes e mecanismos básicos sem bloquear a pipeline. Sincronização fica para recorte próprio. A seção 8 do design registra esse aceite; os formatos e mecanismos técnicos seguem abertos. Próximo bloco: recuperação contextual e orçamento.

Esta atualização é exclusivamente documental: nenhuma compactação, exclusão, captura real, instalação, implementação, alteração de issues ou push foi executada. Contagem de 80 SPECs aprovadas, índice e fila permanecem inalterados. Os registros anteriores preservam a sequência das decisões.

### MVP-007: recuperação contextual e orçamento aprovados (2026-08-30)

Após persistência/retenção no commit local `6c1f65e`, o PI aprovou recuperação seletiva/progressiva por tarefa/projeto, com consulta global ou cruzada quando justificada e permitida. Busca textual e relações do grafo são combinadas sem embeddings obrigatórios. Fontes vigentes e decisões aplicáveis não são substituídas por inferências; contradições e material histórico ficam explícitos.

O pacote contém trechos com fonte/revisão, validade e lacunas. Expansão resolve lacuna concreta sob limites de consultas/tempo/tokens e encerra sem informação nova ou orçamento. Trechos e referências enviados contam no orçamento do solicitante; memória fornece candidatos, enquanto `ContextPack` permanece dono do pacote final na pipeline. Contrato registrado na seção 9 do design, sem transformar memória em autorização para agir.

Próxima decisão: fontes iniciais e fronteira de integração. Nenhuma SPEC de fatia foi criada/aprovada, nenhuma issue foi alterada e não houve código, instalação, coleta real ou push. O total de 80 SPECs aprovadas, o índice e a fila permanecem preservados.

### MVP-007: fontes iniciais e integração aprovadas (2026-08-30)

Após recuperação contextual no commit local `4268ad0`, o PI aprovou fontes progressivas por adaptadores de leitura: projetos registrados, registros de módulos disponíveis e conhecimento explícito. O núcleo deve funcionar primeiro com projetos/documentos e conhecimento explícito, sem esperar todos os menus. Os registros dos módulos abrangem agentes e operações, mantendo os quatro grupos do catálogo inicial.

Cada fonte identifica registros/revisões, entrega alterações desde o último ponto processado e informa cobertura. A memória mantém seu progresso sem modificar originais. Históricos externos de Claude/Codex, agentes, serviços e vaults precisam de integração própria, sem varredura automática do computador. Graphify organiza o material fornecido, sem decidir novos acessos. O uso do Vault de credenciais pelos runtimes existentes não foi alterado.

Contrato registrado na seção 10 do design; próxima decisão: entrega e retomada da ingestão. Não houve implementação, importação de históricos, instalação, atualização de issues ou push. Nenhuma SPEC de fatia foi criada/aprovada; contagem de 80, índice e fila preservados.

### MVP-007 — ingestão e retomada aprovadas (2026-08-30)

Após o registro das fontes iniciais no commit local `9be376f`, o PI aprovou carga inicial com referência de corte, persistência consistente dos resultados/progresso e retomada independente por fonte. Reentregas não duplicam; divergências na mesma identidade/revisão são conflitos. Evento problemático vira pendência durável com identificação, motivo e referência antes de continuar, sem marcar aplicação inexistente.

Falhas de uma fonte não impedem outras nem a pipeline; retentativas usam espera progressiva e consumo limitado. Cobertura distingue carga inicial, atualização, atraso, pendências e indisponibilidade. Histórico expirado exige reconciliação do material disponível e declaração de lacunas; a política não promete recuperação completa sem evidência nem entrega exatamente uma vez.

Contrato registrado na seção 11 do design; próxima decisão: contrato técnico opcional do Graphify. Não houve implementação, ingestão, reprocessamento, instalação, atualização de issues ou push. Nenhuma SPEC de fatia foi criada/aprovada; contagem de 80, índice e fila preservados.

### MVP-007 — contrato de integração opcional do Graphify aprovado (2026-08-30)

Após o registro da ingestão/retomada no commit local `d76b632`, o PI aprovou adapter substituível sob contrato próprio, compatibilidade verificada e entrada delimitada por fontes selecionadas com identidade/revisão. Extração estrutural local para código; enriquecimento semântico pelos executores autorizados e dentro do orçamento existente, sem migração silenciosa para API paga. Não ampliar acessos nem instalar configurações globais automaticamente.

Relações normalizadas preservam fonte/revisão, distinguem extração/inferência e deixam de valer como atuais quando afetadas por correções/remoções. Resultados de `save-result`/`reflect`, quando usados, entram como candidatos rastreáveis, não memória canônica paralela, decisão do PI ou promoção automática de políticas. Ausência/incompatibilidade mantém busca básica; atualizações exigem testes de compatibilidade e não são silenciosas.

Contrato registrado na seção 12 do design; assinaturas, schemas, versão concreta e execução ainda serão especificados. Próxima decisão: validação das lições fora da pipeline. Não houve implementação, instalação, execução do Graphify, atualização de issues ou push. Nenhuma SPEC de fatia foi criada/aprovada; contagem de 80, índice e fila preservados.

## Pendências históricas preservadas

- A UI de allowlist ainda exigia decisão de produto: localização, seletor nativo e remoção de `appDir`.
- Login por senha/GitHub exige SPEC própria; não é FIX.
- Adoção de catálogo global `SPEC-nnn` permanece opcional. Até decisão, slugs e índice do `STATUS.md` vencem.
- Conflito de sync multi-dispositivo permanece questão aberta do ADR-001.
