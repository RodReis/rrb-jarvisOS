# SPEC-Aprendizado-05 — Estratégias e recomendações assistidas

- MVP/Fatia: MVP-016 · M16-F05.
- Issue: [#167](https://github.com/RodReis/rrb-jarvisOS/issues/167).
- Status: **rascunho-completo**; redação técnica concluída para revisão, sem atribuir aceite do PI ainda inexistente.
- Depende de: M16-F04 concluída; predecessor direto [#166](https://github.com/RodReis/rrb-jarvisOS/issues/166).
- Design: `docs/superpowers/specs/2026-08-29-mvp-016-aprendizado-operacional-design.md`.
- Implementação: não iniciada nem autorizada por esta redação. MVP-007 não é dependência.

## Objetivo

Conectar estratégias opcionais de seleção, compressão e cache aos mecanismos existentes e gerar recomendações rastreáveis, determinísticas ou assistidas por Claude/Codex. A F05 propõe configurações e associações; somente os contratos já aprovados de F02/F03/F04 determinam agrupamento, aplicabilidade, experimento e promoção. Economia de tokens não justifica perder regra, condição de validade, evidência ou qualidade.

## Premissas e alternativas resolvidas nesta proposta

- O `ContextSelector`/`ContextPack` do MVP-008 continua escolhendo e materializando o contexto final. A recuperação do MVP-009 continua dona do prompt, tentativas, validações e falhas abertas.
- Recomendação: adapters opcionais e fallback determinístico local. Tornar Graphify obrigatório introduziria dependência desnecessária; permitir texto arbitrário de skill como política executável retiraria a validação do proprietário. Ambas as alternativas ficam fora.
- Compressão é seletiva sobre prosa auxiliar explicitamente elegível; blocos normativos, código, regras, provas e condições permanecem íntegros. Não tentar provar equivalência semântica geral com outra opinião de modelo.
- Cache guarda índices/manifestações de seleção e referências verificáveis; conteúdo extenso continua com seus donos. Hash válido não prova que a fonte continua elegível.
- Graphify/Caveman são exemplos de capacidades, não promessa de uma versão, comando ou API específica. O adapter valida capacidade e versão instaladas; ausência/incompatibilidade é resultado normal. Não instalar nem ativar ferramenta automaticamente.
- Limites operacionais abaixo são proposta versionada desta SPEC, não nova política de gasto ou alterações retroativas dos perfis da F04.

## Dentro e fora

Dentro: contratos neutros de estratégia; catálogo de capacidades; seleção determinística de referência; compressão conservadora; cache verificável; propostas determinísticas e assistência pelos executores existentes; conexão real com `FailureAssociationCandidate` da F02 e candidatas draft da F03; diagnósticos, consumo, retomada e contratos de teste.

Fora: núcleo global de memória/RAG; dependência de MVP-007, embeddings ou banco vetorial; substituir `ContextSelector`, executor, scheduler, recovery ou budget; promover política diretamente; fechar/ocultar falha pela IA; ler repositório integral sem a exceção já existente; copiar prompts/diffs/logs para o aprendizado; ajustar regra de produto, provider, gate, limite financeiro, tentativas, merge ou deploy; UI pública, pertencente à F06.

## Stack e destinos planejados

Reutilizar TypeScript, Electron main, armazenamento SQLite, testes unitários e executores já adotados no projeto, sem novo serviço obrigatório.

- `src/shared/domain/learning.ts` e `src/shared/contracts/learning.ts`: estratégias, proposta, manifesto e resultados tipados/versionados.
- `src/main/learning/context-strategy-catalog.ts`: capacidades, schemas, versões e compatibilidade com mecanismos proprietários.
- `src/main/learning/context-selection-strategy.ts`, `context-compression-strategy.ts` e `context-cache-strategy.ts`: portas neutras e implementações determinísticas de referência.
- `src/main/learning/strategy-adapters/`: adapters opcionais, limitados ao contrato de entrada/saída.
- `src/main/learning/recommendation-generator.ts` e `assisted-recommendation-service.ts`: hipóteses e encaminhamento aos executores existentes.
- `src/main/learning/recommendation-repository.ts`: job, proveniência, resultado mínimo e checkpoint; migrations forward-only no armazenamento existente se necessárias.
- Testes `*.test.ts` próximos aos módulos; fixtures em `tests/fixtures/learning/`.

Destinos são planejamento, não evidência de arquivos implementados. Evitar concentração de todos os adapters em um módulo e alteração estrutural não necessária dos proprietários.

## 1. Contrato neutro e ownership

Cada operação recebe projeto, identidade da solicitação, revisão/hash do snapshot aplicável, manifesto permitido pelo proprietário, limites remanescentes, prazo e cancelamento. O catálogo define `strategyId`, versão de implementação/schema, capacidades, tipos de entrada/saída, dependências relevantes e fallback. Parâmetro desconhecido ou limite superior ao recebido falha antes de invocar o adapter.

```ts
type StrategyOutcome = 'applied' | 'fallback' | 'unavailable' | 'inconclusive'

interface StrategyEvidenceRef {
  readonly id: string
  readonly revision: string
  readonly hash: string
}

interface StrategyExecutionReport {
  readonly requestId: string
  readonly projectId: string
  readonly plannedStrategyId: string
  readonly effectiveStrategyId: string | null
  readonly implementationVersion: string | null
  readonly policySnapshotHash: string
  readonly outcome: StrategyOutcome
  readonly reasonCodes: readonly string[]
  readonly inputManifestHash: string
  readonly outputManifestHash: string | null
  readonly evidence: readonly StrategyEvidenceRef[]
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly tokenMeasurement: 'measured' | 'estimated' | 'unknown'
}
```

O relatório não concede autoridade nem contém código executável. Mesmo com snapshot imutável, disponibilidade física pode exigir fallback previsto. Registrar estratégia planejada e efetiva sem reescrever o snapshot ou buscar uma política recém-promovida durante retry do mesmo run.

F05 registra no catálogo F03 apenas parâmetros que o proprietário já aceita. Um pacote `ContextStrategyPolicy` completo identifica seleção, compressão, cache, ordem, limites internos e fallbacks, com dependências entre essas capacidades. Não aceitar JSON arbitrário nem criar ajuste de gate porque o modelo sugeriu. F03 conserva precedência, grupo acoplado e substituição integral de pacote; F04 conserva prova e promoção.

## 2. Seleção e Graphify opcional

1. O proprietário fornece o recorte inicial: SPEC/tarefa, delta, caminhos/revisões permitidos, relações conhecidas, índice e referências de falhas/decisões pertinentes. O adapter não amplia esse conjunto por iniciativa própria.
2. Estratégia determinística de referência usa manifesto, busca textual/estrutural já disponível e dependências diretas. Mesmas entradas e versões produzem a mesma seleção ordenada e os mesmos motivos; desempate por identidade estável.
3. Adapter de grafo pode sugerir candidatos relacionados dentro do recorte. A relação informa origem, revisão, tipo e grau de certeza; inferência não se torna dependência factual sem validação na fonte.
4. Toda referência retornada é resolvida pelo proprietário e confrontada com fonte/revisão/hash e escopo atuais antes de inclusão. Caminho arbitrário, fonte de outro projeto, versão antiga ou referência não verificável é excluída com motivo, sem leitura do conteúdo correspondente.
5. Grafo ausente, incompatível, incompleto, atrasado, em reconstrução ou com timeout conserva seleção-base. O fallback não espera construir o grafo inteiro e não considera ausência de nó prova de ausência de código relevante.
6. Expansão exige lacuna concreta e a regra/teto já autorizados pelo MVP-008; adapter apenas pede expansão fundamentada. Leitura integral não vira padrão aprendido, nem exceção implícita por falta de grafo.
7. Falhas atuais, regras normativas e evidências obrigatórias não disputam relevância com conveniência do adapter. Itens resolvidos não reaparecem como falha nova; histórico de tentativas permanece consultivo conforme F02.
8. O contrato é reutilizável por outros consumidores sem instalar o núcleo do MVP-007. A eventual memória global fornece candidatos por sua própria porta; ausência desse serviço não muda seleção, testes ou dependências desta fatia.

## 3. Compressão e Caveman opcional

O `ContextPack` classifica blocos em `protected` ou `auxiliary` antes da compressão. Default é protegido; ausência de classificação não autoriza reescrita.

Protegidos: instrução do PI, SPEC/critério, contrato de domínio, ADR aplicável, regra de review, trecho de código/configuração, comando, erro discriminante, número/unidade/limite, condição de aplicabilidade, negação, incerteza, revisão/hash, prova e falha aberta. A F05 não reduz nem resume esses blocos. A materialização final verifica integridade byte a byte dos blocos protegidos ou suas referências resolvidas conforme o contrato do proprietário.

Auxiliares: prosa descritiva não normativa marcada pelo produtor, títulos redundantes e explicações duplicadas cujo original e referências estão disponíveis. Estratégia determinística elimina duplicação exata e formatação redundante; estratégia assistida/skill pode propor redação menor apenas para esses blocos. Identificadores e referências preservados são validados; resultado com instruções novas, campos inesperados, referências perdidas, aumento do tamanho ou schema inválido é rejeitado.

Validação estrutural não prova equivalência semântica de prosa livre. Essa limitação consta do manifesto; promoção da estratégia depende dos experimentos F04. O fallback operacional é o bloco original íntegro, nunca um resumo não verificado. Caso o original não caiba, o `ContextSelector` aplica sua seleção/prioridade e explica exclusões; F05 não corta provas para produzir economia aparente.

Caveman/equivalente, quando disponível, não altera a linguagem do PI, o formato obrigatório de relatórios nem instruções protegidas. A saída enviada efetivamente fica no `ContextPack` do proprietário; o aprendizado guarda referências, hashes e métricas, não uma cópia permanente do prompt.

Contar a representação final completa, inclusive estrutura, referências, avisos e overhead. Mesma função de contagem/estimativa do consumidor; não comparar tokenizador diferente como economia real. Medido, estimado e desconhecido permanecem separados. Ganho bruto e overhead de geração/compressão são reportados separadamente e entram na fórmula predefinida da F04, sem promessa fixa de percentual economizado.

## 4. Cache e invalidação

- Chave inclui projeto, tarefa/recorte, manifesto e revisões de fontes, versão do adapter/schema, configuração/snapshot relevante, critérios de seleção, teto recebido e contador/estimador de tokens. Igualdade de hash também valida metadados normalizados; colisão não reutiliza resultado de outro conteúdo.
- Cache local armazena referências ordenadas, seleção, diagnóstico e hashes. Texto extenso ou saída assistida persistida é referenciada no proprietário canônico; não duplicar no SQLite do aprendizado. Cache nunca é fonte de regra ou prova de resolução.
- Na leitura, revalidar projeto/escopo, fonte disponível, revisões, configuração relevante e elegibilidade atual. TTL não substitui essas verificações. Mudança de regra, correção, invalidação, exclusão ou limite recebido invalida o resultado afetado.
- Limites iniciais: até 256 entradas e 16 MiB de metadados por projeto, TTL máximo de uma hora, política LRU para itens derivados. Cada entrada no máximo 64 KiB. Atingir limite faz evicção do derivado ou miss; nunca remove observação, decisão, política, snapshot ou artefato proprietário.
- Acerto de cache não elimina consulta de cancelamento, quota, permissão ou gasto vigente. Mesmo run conserva snapshot; fato atualizado pode invalidar cache sem reescrever configuração histórica.
- Crash/rebuild/limpeza do cache é seguro: referência ausente/corrompida produz miss diagnosticado, e a base recompõe o recorte disponível. Sem fonte suficiente, marcar lacuna; não recuperar conteúdo perdido pelo hash.

## 5. Recomendações determinísticas e assistidas

O gerador recebe somente observações normalizadas da F01, falhas/resoluções da F02, baseline/aplicabilidade da F03 e avaliações da F04. Critérios determinísticos versionados podem propor redução de expansão sem informação nova, deduplicação exata ou ajuste de cache dentro de parâmetros existentes. Cada proposta informa hipótese, alteração de pacote, baseline/hash, evidências, alcance, métrica a testar e reversão. Padrão observado não prova causalidade nem melhoria.

Assistência conecta Claude/Codex pelos adapters/roteamento já existentes. Não executar CLI diretamente pelo módulo de aprendizado, abrir provider novo, obter credencial, instalar skill ou mudar assinatura para rota paga. Capacidade ausente deixa análise enriquecida pendente/inconclusiva; recomendações determinísticas permanecem disponíveis.

Uma solicitação assistida congela manifesto, revisões, objetivo e schema de saída. Registra executor, modelo quando conhecido, versão, rota, identidade da execução, consumo com sua origem e referências do contexto enviado. O contexto exato continua no `ContextPack` proprietário. Saída é dado não confiável: schema fechado, limites, referências existentes, mesmo projeto, baseline e campos permitidos são validados antes de registrar proposta.

Resultados aceitos:

- `FailureAssociationCandidate`: sugestão consultiva pelos campos já definidos na F02. Não altera fingerprint, não une/separa grupos automaticamente, não resolve ocorrência nem autoriza ocultá-la.
- `PolicyCandidate` em draft: pacote completo válido na F03, nunca `active`. Cada alteração de pacote/referência/aplicabilidade cria revisão/hash novos. F04 exige replay, shadow e canário da revisão exata.
- Explicação limitada ligada a uma hipótese/avaliação: não substitui cálculo determinístico, não conta como evidência de sucesso.

Escopo global local admite apenas padrões generalizados promovidos pelas regras F03/F04. A proposta assistida nasce no projeto; não copiar caminhos, mensagens específicas ou regra de negócio para outro projeto como atalho. Troca de executor/modelo relevante torna aplicabilidade desconhecida ou stale e exige a revalidação existente, não migração automática de provas.

## 6. Orçamento, execução assíncrona e retomada

| Recurso | Limite inicial proposto | Tratamento ao alcançar |
|---|---|---|
| Lote de observações para propor hipótese | 50 itens / 1 MiB normalizado | Checkpoint confirmado; próximo lote, sem leitura integral. |
| Passagem do gerador local | 200 itens / 5 segundos entre operações | Ceder execução e retomar; operação individual também tem prazo. |
| Solicitações assistidas pendentes | 32 por projeto | Coalescer mesma chave/revisão; excedente fica diagnosticado, sem fila ilimitada. |
| Concorrência assistida | Uma por projeto, dentro da capacidade global já disponível | Aguardar no dispatcher proprietário; sem reserva adicional de capacidade. |
| Seleção/cache/compressão local | Prazo máximo de 2 segundos ou remanescente menor | Cancelar adapter e usar fallback; tarefas lentas não bloqueiam o main. |
| Saída assistida | Cinco propostas / 32 KiB de JSON normalizado | Rejeitar excesso, não truncar pacote/prova silenciosamente. |
| Texto explicativo por proposta | 2 KiB UTF-8 | Resultado excessivo inválido; referências ficam estruturadas. |

Chamadas assistidas recebem parcela de tokens/contexto e prazo do proprietário; zero/ausência de parcela não abre chamada. F05 não concede budget nem adiciona gate monetário à assinatura: assinatura registra chamadas/tokens/tempo sem USD inventado; rota paga respeita habilitação e limite existentes. Uso adicional é identificado como aprendizado/experimento, não escondido no run principal.

`requestId + projectId + inputManifestHash + producerVersion + outputSchemaVersion` forma identidade idempotente. Persistir intenção e vínculo à execução antes do despacho; retorno registra resultado mínimo e propostas atomicamente com o checkpoint local. Mesmo pedido repetido devolve o resultado existente. Mesma identidade com conteúdo divergente é conflito.

Se houver crash após despacho, reconciliar a execução proprietária por identidade antes de reenviar. Estado externo desconhecido não vira falha definitiva nem dispara chamada duplicada. F05 não cria loop próprio de retry: retentativas explicitadas pelo proprietário continuam na mesma contabilização e limites; sem suporte verificável de reconciliação, registrar pendência em vez de repetir às cegas.

Antes de persistir resultado, conferir projeto/contexto, cancelamento, revisão da solicitação e baseline. Resposta atrasada de solicitação cancelada/obsoleta é registrada como descartada sem publicar candidata atual. Nova baseline gera nova solicitação, não muda a antiga. Fonte indisponível conserva resultado histórico mas impede usar prova não verificável em promoção.

## 7. Persistência e falhas

Propostas, manifestação mínima dos insumos, decisões de encaminhamento e relatórios de consumo têm proveniência durável conforme F01/F03; projeções, cache e relações inferidas são derivados. Não impor nova retenção a artefatos dos proprietários. Esquemas rejeitam credencial, ambiente bruto, stdout/stderr, prompt, resposta integral, diff e arquivos completos.

Falha de strategy, ferramenta opcional, cache, executor ou armazenamento do aprendizado não bloqueia construção, revisão, merge ou release. O consumidor recebe baseline/fallback e diagnóstico. Falha do armazenamento canônico do próprio run não é mascarada como simples ausência de aprendizado; segue o tratamento do núcleo.

Rebuild restaura índices a partir dos registros permitidos, preservando versões, candidatas, decisões e snapshots. Não reexecuta automaticamente modelo, experimento, ação corretiva ou efeitos Git/deploy para reconstruir derivado. Consumo de reconstrução, quando houver, é distinto de economia de execução.

## Comandos de verificação da implementação futura

```text
npm run typecheck
npm run lint
npm test
npm run build
```

São comandos existentes do projeto, não testes executados por esta redação. A suíte comum não depende de CLI autenticada, Graphify/Caveman instalados ou serviço pago.

## Estratégia de testes

Unidade: catálogo/schema, seleção/ordenação, classes de bloco, integridade de protegidos, limites, contagem completa, identidade e invalidação. Contratos: adapters fake indisponível/incompatível/lento, saída adulterada, grafo stale, cache com hash correto e fonte inválida, orçamento zero. Integração: F02/F03/F04 reais com executores/insumos externos fake; testar candidata draft, avaliação obrigatória e ausência de efeitos. SQLite temporário: intenção/retorno/checkpoint, crash, repetição e reconstrução. Relógio e contadores injetáveis; verificar fronteiras exatas dos limites e fallback sem bloqueio do loop principal.

Contrafactuais devem falhar ao permitir compressão de regra/negação, aceitar referência de outro projeto, tratar economia estimada como medida, ativar candidata pela IA, fechar falha por associação ou reenviar solicitação sem reconciliar. Prova real de adapter é separada, opt-in e limitada à autorização/recursos existentes; ausente é `not_run`, nunca `pass`.

## Critérios de aceite

1. Os três contratos de estratégia validam capacidades, versões, schema e limites; parâmetro desconhecido não chega ao adapter ou ao pacote da F03.
2. Sem Graphify, Caveman, CLI disponível ou MVP-007, seleção-base, cache verificável e recomendações determinísticas continuam operacionais.
3. Seleção idêntica é reproduzível; grafo só sugere referências dentro do recorte e valida fonte/revisão/hash antes de inclusão.
4. Grafo stale/incompleto, timeout, referência externa ou necessidade de expansão produzem fallback/motivo, nunca leitura integral automática.
5. Blocos protegidos preservam conteúdo byte a byte; classificação ausente não permite compressão e regra/prova/negação não é removida para caber.
6. Compressão auxiliar inválida, maior ou sem referência é rejeitada; original íntegro/fallback e limitações semânticas ficam identificados.
7. Representação final e overhead usam contador do consumidor; medido, estimado e desconhecido não são misturados nem anunciados como economia garantida.
8. Cache distingue projeto/recorte/versões/configuração/limites; hash correto com fonte inelegível resulta miss, não contexto atual presumido.
9. Limites de 256 entradas/16 MiB/64 KiB por entrada/uma hora afetam apenas derivados; limpeza/rebuild não remove decisões, fontes ou snapshots.
10. Proposta determinística conserva hipótese, baseline, aplicabilidade, prova e métrica; observação recorrente sozinha não prova causalidade ou melhoria.
11. Assistência usa apenas executor/rota/credencial/capacidade existentes, com contexto proprietário rastreável e saída limitada/validada antes da persistência.
12. Associação assistida não altera fingerprint, agrupamento, resolução ou visibilidade; `PolicyCandidate` entra draft e não pula os estágios da F04.
13. Mudança de conteúdo/base relevante gera nova revisão/solicitação; resposta obsoleta não publica candidata atual nem herda prova incompatível.
14. Padrão específico de projeto não vaza para global/outro projeto; promoção generalizada continua sob F03/F04, sem dependência da memória global.
15. Lotes, fila, concorrência, prazos e saída respeitam os limites; trabalho lento/ausente cede ao fluxo principal com fallback observável.
16. Parcela zero não inicia chamada; assinatura registra uso sem USD inventado, rota paga conserva o limite existente e todo overhead é contabilizado.
17. Cem reaplicações da mesma solicitação mantêm um resultado lógico; crash após despacho reconcilia identidade sem retry cego ou reset de consumo.
18. Cancelamento/troca de contexto invalidam resultados atrasados; fallback efetivo é registrado sem reescrever snapshot do run.
19. Projeções/rebuild e diagnósticos não copiam prompt/log/diff/repositório, não repetem modelo/efeito externo e não mascaram falta de fonte.
20. Testes exercitam integrações F02/F03/F04 reais e adapters simulados, provando ausência de promoção direta, nova autoridade, gasto oculto ou bloqueio da pipeline.

## Limites e revisão

- **Sempre:** escopo restrito, proveniência, saída validada, conteúdo protegido íntegro, consumo explícito e fallback determinístico.
- **Consultar a SPEC:** alteração de autoridade, contrato proprietário, semântica de compressão, escopo global ou limites versionados; ajustes técnicos compatíveis não criam aceite duplicado.
- **Nunca:** promover por opinião, inventar percentual de economia, esconder falha, copiar conteúdo extenso ou transformar ferramenta opcional em dependência obrigatória.

Redação completa, sem questão técnica deixada em aberto nesta revisão. Os limites/contratos propostos ainda não possuem aceite exato do PI; este documento conclui o planejamento da fatia, não sua entrega técnica.
