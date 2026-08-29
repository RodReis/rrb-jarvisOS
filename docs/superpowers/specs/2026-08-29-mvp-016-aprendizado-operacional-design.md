# Design — MVP-016: Aprendizado Operacional da Pipeline

- Status: **design e seis fatias aprovados pelo PI** em 2026-08-29.
- Pipeline: V3, depois do MVP-015.
- Implementação: **não autorizada por este documento**.
- Issues: não criadas.
- SPECs: M16-F01 `aprovada-pi`; M16-F02–F06 ainda não redigidas.
- Design predecessor: `2026-08-29-mvp-015-observabilidade-operacional-design.md`.

## 1. Resultado esperado

O MVP-016 aprende com runs concluídos para reduzir recorrência de falhas, retrabalho, contexto e consumo sem criar autoridade de produto. Ele transforma evidências rastreáveis em candidatas de política, prova cada hipótese por replay, shadow e canário e fornece snapshots versionados aos mecanismos já existentes.

O aprendizado não substitui o MVP-007, responsável pela futura memória contextual/RAG do produto. Também não reimplementa `ContextSelector`, `RecoveryController`, roteamento, revisão ou orçamento dos MVPs 008/009. Esses mecanismos permanecem donos da execução; o MVP-016 apenas propõe e resolve configurações versionadas para eles.

## 2. Decisões aprovadas

1. O escopo é aprendizado operacional entre runs, separado da memória de produto do MVP-007.
2. Há duas camadas: específica por projeto e global local. A específica vence; conteúdo e regra de negócio não sobem ao escopo global.
3. Ajustes reversíveis e não semânticos podem ser promovidos automaticamente depois de prova. Escopo, SPEC, gates, tentativas máximas, limites financeiros, provider, merge, deploy e regra de produto exigem PI.
4. Validação segue `replay → shadow → canário → ativa`, com rollback e kill-switch.
5. Qualidade é guardrail obrigatório. Eficiência só é otimizada depois de preservar resultado, escopo, testes, CI e revisão.
6. Falhas usam fingerprint determinístico. Similaridade semântica sugere agrupamento, mas não fecha nem ignora falha automaticamente.
7. Graphify, Caveman e equivalentes são estratégias opcionais atrás de contratos neutros; `rg` + manifesto + seleção determinística permanecem fallback.
8. A memória guarda atributos mínimos, métricas, fingerprints, versões e referências por hash; não copia prompts, logs, diffs ou repositórios inteiros.
9. Cada run recebe `PolicySnapshot` imutável. Política nova nunca altera execução em andamento.
10. O aprendizado é assíncrono e não bloqueante. Indisponibilidade usa a última política estável ou a política-base.
11. A IA pode propor e explicar hipóteses, mas promoção depende de evidência e regras determinísticas.
12. Experimentos usam perfis proporcionais ao impacto; números exatos pertencem às SPECs e ficam versionados.
13. `ApplicabilityKey` invalida lições incompatíveis com tarefa, stack, versões, executor, modelo, ambiente ou política-base.
14. A UI oferece histórico, comparação, rollback e `Decide por mim`, sem ampliar a autoridade concedida.
15. A interface exige `DESIGN-SYSTEM.md` e protótipos HTML formais aprovados antes da construção.

## 3. Dentro e fora do escopo

### Dentro

- ingestão idempotente de evidências dos MVPs 008–015;
- observações, fingerprints, recorrências e resoluções comprovadas;
- lições, candidatas, experimentos, políticas, versões e snapshots;
- escopos por projeto e global local;
- replay, shadow, canário, promoção, estabilização e rollback;
- estratégias substituíveis de seleção, compressão e cache;
- recomendações determinísticas e análise assistida por Claude/Codex;
- console de aprendizado, decisões do PI, CLI e prova E2E.

### Fora

- memória contextual/RAG do MVP-007;
- substituir mecanismos dos MVPs 008/009;
- treinamento ou fine-tuning de modelos;
- sincronização do aprendizado entre usuários ou instalações;
- leitura integral automática do repositório;
- alteração automática de SPEC, regra de produto ou gate material;
- novo provider, executor ou mecanismo de deploy;
- aprendizado como gate obrigatório da pipeline;
- regra de LGPD, consentimento, aceite duplo ou classificação não fornecida pelo PI.

## 4. Arquitetura

```text
Evidências imutáveis dos MVPs 008–015
                  │
                  ▼
          LearningIngestor ── FeatureExtractor ── FailureMemory
                  │                                      │
                  └────────── CandidateGenerator ◄───────┘
                                      │
                                      ▼
                           ExperimentCoordinator
                         replay → shadow → canário
                                      │
                                      ▼
                              PolicyRegistry
                                      │
                                      ▼
                    PolicyResolver → PolicySnapshot
                                      │
                                      ▼
                  mecanismos existentes dos MVPs 008/009
```

### 4.1 Componentes

- `LearningIngestor`: consome fatos novos por checkpoint e chave idempotente.
- `FeatureExtractor`: produz métricas, fingerprints e atributos mínimos com proveniência.
- `FailureMemory`: relaciona ocorrências, tentativas, resoluções e recorrências.
- `CandidateGenerator`: cria hipóteses determinísticas ou assistidas por executor.
- `ExperimentCoordinator`: executa os estágios, perfis e guardrails.
- `PolicyRegistry`: mantém candidatas e versões imutáveis.
- `PolicyResolver`: combina política-base, global local e específica do projeto.
- `PolicySnapshot`: congela a configuração efetiva usada por um run.

O processo principal permanece dono do SQLite. O MVP-016 usa tabelas e migrations próprias no armazenamento local; não cria outro banco nem sincronização externa.

## 5. Modelo de domínio

Entidades principais:

- `LearningObservation`: fato derivado de evidência canônica.
- `FailureSignature`: identidade normalizada de uma causa provável.
- `ResolutionEvidence`: ação aplicada e prova posterior de resultado.
- `OperationalLesson`: conclusão rastreável e limitada a um escopo.
- `PolicyCandidate`: hipótese configurável com baseline e reversão.
- `PolicyExperiment`: estágio, amostra, métricas e guardrails.
- `PolicyVersion`: versão promovida, revertida ou aposentada.
- `PolicySnapshot`: composição efetiva congelada por run.
- `ApplicabilityKey`: contrato de compatibilidade da lição/política.

Ciclo da candidata:

```text
draft → replay → shadow → canary → active
   ├──────→ rejected
   ├──────→ inconclusive
   └──────→ expired

active → reverted → retired
```

`inconclusive` não é sucesso nem falha. Reversão cria transição nova e preserva histórico. Candidata incompatível vira `stale` e exige novo replay antes de voltar a participar de decisão automática.

## 6. Escopo e resolução de políticas

Todo registro pertence a `project_id` ou `global_local`. Dados de um projeto não são consultados diretamente por outro. Somente padrões já promovidos, generalizados e sem conteúdo de negócio podem compor a camada global local.

Ordem de resolução:

1. política-base aprovada nos MVPs proprietários;
2. política global local compatível;
3. override específico do projeto;
4. snapshot imutável do run.

Conflito não é combinado silenciosamente. O resolver escolhe uma versão compatível ou mantém a estável. Promoções são serializadas por `scope + mechanism`; concorrência sobre versão-base obsoleta força reavaliação.

## 7. Memória de falhas

O fingerprint determinístico considera categoria, etapa, comando/check, código de erro, provider, arquivo ou região estrutural e mensagem normalizada. Similaridade semântica pode sugerir associação, mas uma associação incerta permanece candidata.

Cada `FailureSignature` mantém ocorrências, condições, soluções tentadas, resolução comprovada e recorrências. Mensagem semelhante com causa raiz diferente cria outra assinatura.

Antes de uma recuperação, o MVP-016 fornece `FailureRecall` mínimo: assinaturas relevantes, ações que falharam, resolução comprovada e condição de recorrência. O `RecoveryController` do MVP-009 continua dono do prompt, do delta e das tentativas.

## 8. Estratégias de contexto e tokens

Contratos neutros:

- `ContextSelectionStrategy`: busca textual, mapa estrutural, grafo ou combinação;
- `ContextCompressionStrategy`: resumo determinístico, Caveman ou equivalente;
- `ContextCacheStrategy`: reutilização por hashes e revisão-base.

Uma `ContextStrategyPolicy` pode configurar fontes iniciais, ordem, expansão, teto de arquivos/bytes/tokens, cache, compressão, deduplicação e fallback. Graphify/Caveman não são dependências rígidas. Ausência ou falha mantém `rg`, manifesto e dependências diretas.

Leitura integral continua exigindo a exceção visível do MVP-008 e nunca pode ser aprendida como padrão automático.

## 9. Avaliação e promoção

Experimentos comparam candidata e baseline sobre execuções elegíveis equivalentes, controlando quando possível tipo de tarefa, tamanho do delta, executor, modelo, provider e gates.

Métricas permanecem separadas:

- guardrails: SPEC, escopo, testes/CI, P0/P1 e resultado final;
- efetividade: sucesso, recorrência, retrabalho, retries e intervenção;
- eficiência: tokens, contexto, chamadas, duração, cache e custo quando existir;
- estabilidade: variância, timeout, rate limit e reversões.

Não existe score composto opaco. O resultado é `improved | regressed | inconclusive`, com as métricas que sustentam a conclusão.

Perfis de baixo, médio e alto impacto definem amostra, janela, melhoria mínima, guardrails e autoridade de promoção. Alto impacto sempre exige PI. Baixo/médio impacto só pode promover automaticamente quando autorizado, com kill-switch e janela de estabilização.

## 10. IA assistente

O núcleo determinístico calcula métricas, elegibilidade, fingerprints, compatibilidade e promoção. Claude/Codex podem propor hipótese, explicação ou configuração candidata.

Toda proposta assistida registra executor, modelo, versão, contexto enviado e evidências usadas. Texto do modelo não prova melhoria. Sem executor disponível, candidatos determinísticos continuam funcionando e a análise enriquecida fica pendente.

## 11. Persistência e reconstrução

Registros canônicos: políticas, versões, decisões do PI, promoções, reversões e snapshots. Registros derivados reconstruíveis: observações, agregados, similaridades, métricas e índices de falhas. Artefatos extensos permanecem em seus donos e são referenciados por identificador, hash e localização permitida.

Crash durante ingestão retoma por checkpoint sem duplicação. Projeções podem ser reconstruídas. Evidência perdida impede nova promoção automática quando a prova remanescente for insuficiente, mas não apaga o histórico.

`ApplicabilityKey` inclui tarefa, mecanismo, stack/versões relevantes, executor/modelo/provider quando influentes, ambiente e hashes das políticas-base. Incompatibilidade marca `stale`; compatibilidade parcial reduz confiança e exige o perfil de revalidação definido na SPEC.

## 12. Interface e decisões

O console integrado ao MVP-015 possui quatro superfícies: resumo, candidatas, falhas recorrentes e políticas. Comparações explicam o que mudou, por quê, alcance, evidência, resultado e reversão.

Decisões materiais usam pop-up com uma pergunta por vez, recomendação, alternativas válidas, consequências, evidência e `Decide por mim`. A ação escolhe dentro da autoridade concedida; não contorna aprovação obrigatória.

Promoções automáticas aparecem em trilha separada, com estabilização e rollback imediato. Estados vazios, evidência insuficiente/perdida, candidata inconclusiva e aprendizado indisponível possuem próxima ação explícita.

A M16-F06 só entra em construção depois de anexar e aprovar `DESIGN-SYSTEM.md` e protótipos HTML formais. O protótipo cobre desktop, largura reduzida, teclado/foco e falhas.

## 13. Falhas e recuperação

- ingestão interrompida retoma do checkpoint;
- evidência ausente/hash divergente invalida somente a amostra;
- executor indisponível remove apenas análise assistida;
- conflito mantém a política estável;
- incompatibilidade produz `stale`;
- regressão no canário interrompe alcance e restaura versão anterior;
- falha de rollback gera ocorrência crítica e fallback para política-base;
- dados insuficientes produzem `inconclusive`;
- indisponibilidade geral usa última política estável ou base e não bloqueia a pipeline.

Política promovida só vale para novos runs. Efeito em andamento nunca é cancelado apenas porque o aprendizado publicou outra versão.

## 14. Testes e evidências

- unidade: fingerprints, aplicabilidade, resolução hierárquica, guardrails e estados;
- property tests: idempotência, deduplicação e ordenação de eventos;
- integração SQLite: migrations, checkpoints, concorrência e rebuild;
- replay: fixtures históricas determinísticas;
- diferenciais: baseline versus candidata;
- fault injection: crash, evidência corrompida, executor ausente e rollback;
- contratos: estratégias opcionais e fallback;
- Playwright: recomendação, `Decide por mim`, promoção, regressão e reversão;
- E2E: run → falha → resolução → candidata → canário → política ativa.

Suítes comuns não dependem de serviço pago nem CLI autenticada. Provas reais são separadas e registram executor, modelo, ambiente, consumo e hashes.

## 15. Fatias aprovadas

1. **M16-F01 — Fundação e ingestão.** Contratos, migrations, checkpoints, observações, proveniência e rebuild.
2. **M16-F02 — Memória de falhas.** Fingerprints, similaridade assistida, recorrência, resoluções e aplicabilidade.
3. **M16-F03 — Registro e resolução de políticas.** Candidatas, versões, escopos, conflitos e snapshots.
4. **M16-F04 — Experimentos e promoção.** Replay, shadow, canário, perfis, guardrails, estabilização e rollback.
5. **M16-F05 — Estratégias e recomendações assistidas.** Seleção, compressão, cache, Graphify/Caveman opcionais e Claude/Codex propositores.
6. **M16-F06 — Interface, resiliência e prova E2E.** Console, pop-ups, `Decide por mim`, concorrência, carga, fault injection e jornada completa.

As fatias são sequenciais. A F01 cria a base rastreável; F02 prova a memória; F03 congela decisões; F04 prova melhoria; F05 conecta atuadores opcionais; F06 entrega a experiência e a prova integrada.

## 16. Critério de encerramento

Para um projeto selecionado, uma falha recorrente é reconhecida sem esconder causa nova, uma hipótese vira candidata rastreável, atravessa replay/shadow/canário, melhora resultado sem violar guardrails, entra em novos runs por snapshot e pode ser revertida. Falha ou indisponibilidade do aprendizado não bloqueia a pipeline nem altera run em andamento.

## 17. Gates e autorização

O PI aprovou o design e as seis fatias. Isso autoriza redigir as seis SPECs para revisão, mas não autoriza implementação, criação de issues, gasto, smoke externo, push ou PR.

A implementação de cada fatia depende do aceite exato da respectiva SPEC e da fila. A M16-F06 também depende de `DESIGN-SYSTEM.md` e protótipos HTML formais aprovados. Números dos perfis, schemas IPC, migrations e divisão interna de arquivos pertencem às SPECs sem poder alterar este design.
