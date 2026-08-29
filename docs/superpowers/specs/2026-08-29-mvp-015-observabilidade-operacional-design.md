# Design — MVP-015: Observabilidade Operacional

- Status: **design aprovado pelo PI** em 2026-08-29.
- Pipeline: V3, depois do MVP-014.
- Implementação: **não autorizada por este documento**.
- Issues: não criadas.
- SPECs: seis fatias aprovadas como decomposição; documentos executáveis ainda serão redigidos e submetidos ao aceite pré-construção.
- Design predecessor: `2026-08-29-pipeline-desenvolvimento-ia-v3-design.md`.

## 1. Resultado esperado

O MVP-015 transforma os estados e evidências produzidos pelos MVPs 008–014 em uma visão operacional local, correlacionada e verificável. O PI consegue responder, sem abrir vários provedores: o que está executando, o que falhou, qual SPEC/PR/deploy foi afetado, quanto uso/custo foi observado, quando a quota reinicia e onde está a evidência.

O produto observa a pipeline; não se torna um segundo orquestrador. Alertas não inventam gates, IA não cria políticas bloqueantes e falha do painel não desfaz nem impede uma operação canônica tecnicamente válida.

## 2. Decisões aprovadas

1. Arquitetura local-first, sem novo SaaS de observabilidade no MVP.
2. SQLite e evidências locais guardam histórico normalizado; APIs/CLIs dos provedores reconciliam o estado externo atual.
3. Logs brutos permanecem no provedor ou no arquivo local. O domínio guarda referência, correlação e trecho sanitizado somente quando necessário.
4. `OperationalSignal` e `Alert` não bloqueiam release. Somente `ReleasePolicy` previamente aprovada no MVP-014 possui essa autoridade.
5. Alertas usam severidade `info | warning | critical`, deduplicação por fingerprint e ciclo `open → acknowledged → resolved`.
6. A central interna é o canal canônico. O Windows notifica somente novo `critical` com o app em segundo plano.
7. Marcos duráveis permanecem pela vida do projeto; amostras frequentes ficam detalhadas por 30 dias e depois viram rollups diários permanentes.
8. Eventos internos chegam imediatamente. Provedores são reconciliados a cada 30 segundos durante atividade, a cada 5 minutos em ociosidade, ao iniciar/retomar e sob demanda.
9. O ledger e a `BudgetPolicy` existentes continuam canônicos. Observabilidade não inventa USD nem soma janelas incompatíveis.
10. O console usa o layout **A — console operacional**: estado atual e exceções primeiro; investigação e timeline correlacionada abaixo.
11. A visão é de um projeto por vez. Portfólio, ranking e orçamento consolidado pertencem ao MVP-018.
12. Persistência usa outbox transacional e projeções assíncronas reconstruíveis.
13. UI e CLI usam o mesmo `ObservabilityQueryService`; renderer nunca consulta SQLite diretamente.
14. O console é read-mostly e não repete run, deploy, rollback ou compensação.
15. Payload usa allowlist anterior à persistência; stdout, prompts, respostas, diffs, arquivos e ambiente brutos são proibidos.

## 3. Dentro e fora do escopo

### Dentro

- runs, attempts, PRs, checks, previews, releases e deploys;
- duração, fila, sucesso/falha, custo, quota e saúde dos adapters;
- timeline `MVP → SPEC → run → PR → deploy → alerta/evidência`;
- outbox, eventos normalizados, projeções, rollups e retenção;
- reconciliação com GitHub, GHCR, Vercel, Railway e executores;
- alertas, reconhecimento, resolução, central interna e notificação crítica do Windows;
- serviço de consulta comum, CLI read-only e console operacional;
- relatório filtrado e evidência por SPEC.

### Fora

- Datadog, Sentry, Grafana Cloud ou outro SaaS novo;
- APM da aplicação publicada, tracing distribuído ou ingestão de logs funcionais do produto;
- webhooks públicos;
- criação automática de gates, bloqueios ou rollback pela observabilidade;
- previsão/classificação por IA, detecção automática de anomalia ou aprendizado com falhas;
- ações de construção, retry de run, deploy, compensação ou edição de políticas;
- visão e prioridade entre projetos, pertencentes ao MVP-018;
- e-mail, Slack, Discord, webhook ou escala de plantão;
- scraping, OCR ou parsing de telas de quota;
- regra de LGPD, consentimento, aceite duplo ou classificação não fornecida pelo PI.

## 4. Arquitetura

```text
Domínios MVP-008..014 ── transação SQLite ── estado canônico + OutboxEvent
                                                    │
                                                    ▼
                                          OperationalProjector
                                                    │
                  ┌─────────────────────────────────┼─────────────────────────┐
                  ▼                                 ▼                         ▼
          OperationalEvent                  métricas/rollups              Alert Engine
                  ▲                                                           │
                  │                                                           ▼
ExternalReconciler ── GitHub/GHCR/Vercel/Railway/Codex ── observations   Notification Center
                  │
                  └── ReconciliationCursor + ProviderHealthSnapshot

               ObservabilityQueryService
                  ├── IPC snapshot + deltas ── Console React
                  └── consultas paginadas ──── CLI read-only
```

### 4.1 Componentes

- `OperationalEventOutbox`: valida schema/allowlist e grava o evento já sanitizado na mesma transação do estado canônico.
- `OperationalProjector`: revalida schema e atualiza projeções idempotentes; nunca recebe payload bruto para “limpar depois”.
- `ExternalReconciler`: consulta o estado atual dos provedores e registra observações tipadas.
- `MetricRollupService`: consolida amostras frequentes sem apagar marcos duráveis.
- `OperationalAlertEngine`: avalia somente regras determinísticas aprovadas e mantém fingerprints.
- `NotificationDispatcher`: entrega central interna e notificação nativa sem alterar o estado do alerta em caso de falha.
- `ObservabilityQueryService`: única porta de leitura e comandos administrativos do alerta.
- `ObservabilityProjectionStream`: snapshot inicial e deltas versionados para o renderer.

Cada componente possui contrato próprio e não conhece detalhes visuais. Adapters externos normalizam transporte específico; o núcleo não interpreta texto de tela ou stdout arbitrário.

## 5. Dados e correlação

Entidades principais:

- `OutboxEvent`: identidade, tipo/schema, agregado, versão, correlação, causa, payload permitido e estado de entrega.
- `OperationalEvent`: fato imutável observado, origem, `occurredAt`, `observedAt` e referências.
- `ProviderObservation`: resposta tipada de uma reconciliação externa.
- `ProviderHealthSnapshot`: `healthy | degraded | offline | unknown`, motivo, janela e fonte.
- `UsageSnapshot`: provider/perfil, modo de cobrança, janela, usado/restante, `resetAt`, fonte e qualidade.
- `Alert`: fingerprint, regra, severidade, estado, primeira/última ocorrência e contador.
- `AlertOccurrence`: evento/evidência que atualizou ou reabriu o alerta.
- `NotificationDelivery`: canal, alerta, tentativa e resultado.
- `DailyRollup`: dia, dimensão, contadores, duração, custo/uso e qualidade.
- `ReconciliationCursor`: provedor, escopo, cursor/checkpoint, última tentativa e último sucesso.
- `ProjectionCheckpoint`: projetor, última versão aplicada e estado de rebuild.

Correlação usa, quando existirem: `projectId`, `mvpId`, `specId`, `issueNumber`, `runId`, `attemptId`, `prNumber`, `headSha`, `releaseId`, `deploymentId`, `environment`, `correlationId` e `causationId`.

Invariantes:

1. `eventId` e chave idempotente são estáveis na origem; duplicata não duplica projeção.
2. Evento atrasado completa histórico, mas não sobrescreve estado externo mais novo.
3. `occurredAt` descreve a origem; `observedAt` descreve a coleta. Ordenação causal não depende só do relógio.
4. `OperationalEvent`, log e `AuditEvent` são entidades diferentes; nenhum substitui outro.
5. Falha de projeção deixa a outbox pendente e torna a observabilidade `degraded`; não reverte o domínio proprietário.
6. Rebuild descarta somente projeções derivadas e reaplica outbox/estado canônico; auditoria e evidência nunca são removidas.

## 6. Coleta e reconciliação

Eventos internos são gravados na transação do domínio. Provedores externos são consultados:

- a cada 30 segundos durante Preview ou Release ativa;
- a cada 5 minutos em projeto ocioso;
- ao iniciar ou retomar o JARVIS OS;
- sob ação explícita “Atualizar”.

Cada adapter usa cursor quando suportado, idempotência, backoff com jitter e orçamento de tentativas. Duas janelas esperadas sem sucesso produzem `warning`. Falha de consulta nunca produz `healthy`; usa `unknown` ou `degraded` conforme a última evidência conhecida.

Não há webhook público. A pipeline continua emitindo seus fatos locais imediatamente, enquanto a reconciliação detecta mudanças feitas fora do JARVIS OS.

## 7. Custos e quotas

`CostEvent`, `BudgetLedger` e `BudgetPolicy` dos MVPs anteriores são canônicos. O MVP-015 cria somente projeções e `UsageSnapshot`.

Qualidade da origem:

- `authoritative`: fonte estruturada do provedor;
- `reported`: valor tipado informado pelo executor;
- `estimated`: cálculo já produzido pelo ledger;
- `unknown`: dado não disponível.

Codex pode usar a fonte estruturada `account/rateLimits/read` quando disponível no adapter aprovado. Claude Code permanece `quota_unknown` enquanto não houver fonte estruturada oficialmente suportada. Tela, screenshot, OCR ou texto livre não são fonte de quota.

Janelas diferentes permanecem separadas. Alertas reutilizam limiares do `BudgetPolicy`; observabilidade não cria outro gate nem muda elegibilidade do executor.

## 8. Alertas e notificações

Estados: `open → acknowledged → resolved`. `acknowledged` significa visto pelo PI, não corrigido. Resolução automática exige desaparecimento objetivo da condição. Resolução manual exige justificativa. Nova ocorrência após resolução reabre o mesmo fingerprint e preserva o histórico.

Regras `warning`:

- adapter degradado/offline;
- reconciliação atrasada por duas janelas;
- run sem progresso além do lease/timeout configurado;
- quota no limiar existente da política;
- limpeza de Preview pendente após tolerância;
- diferença conhecida entre custo estimado e real.

Regras `critical`:

- release, deploy ou compensação falhou;
- divergência confirmada de Produção;
- recurso órfão persistiu após retries;
- cadeia de auditoria/evidência falhou na verificação;
- provedor informou bloqueio duro de quota/gasto.

Mudança normal de estado é sinal, não alerta. Tendência histórica é exibida, mas não alerta automaticamente no MVP.

`info` permanece no contrato de severidade para aviso não acionável e regra futura aprovada; o catálogo inicial não cria alerta `info` para cada transição normal.

A central do JARVIS OS recebe todos. O Windows notifica apenas novo `critical` quando o app está em segundo plano. Falha de entrega cria registro próprio e não perde/reabre o alerta.

## 9. Retenção e compactação

- marcos de run/release, transições, deploys, custos consolidados, falhas e compensações: vida do projeto;
- amostras frequentes de saúde/quota: 30 dias em detalhe;
- amostras expiradas: rollup diário permanente antes da remoção;
- alertas e ocorrências: ciclo completo permanente;
- logs brutos: retenção já governada pelo contrato de logging;
- `AuditEvent`, evidência de release e dados ligados a alerta aberto: protegidos de compactação.

A política pode ser ajustada por projeto sem reduzir retroativamente proteções de auditoria/evidência. Compactação é idempotente e deixa contagem/hash de entrada e saída.

## 10. Consulta, UI e ações

O processo principal é o único leitor/escritor SQLite. `ObservabilityQueryService` serve UI e CLI com filtros, paginação por cursor e as mesmas agregações. O renderer recebe snapshot inicial e deltas versionados; salto de versão ou reconexão força novo snapshot.

O console é aberto em um projeto e possui: visão geral, runs, releases, alertas, custos/quotas, adapters e timeline. Saúde global aparece somente quando afeta o projeto. O layout aprovado prioriza estado atual e exceções, seguido por atividade em curso e timeline causal.

Ações permitidas:

- atualizar/reconciliar;
- reconhecer ou resolver alerta com justificativa;
- abrir evidência, relatório, PR, deploy ou provedor;
- copiar IDs/filtros e exportar relatório filtrado;
- testar conectividade do adapter.

Retry de run, deploy, rollback, compensação e edição de política pertencem aos runtimes proprietários. O console apenas abre o fluxo correto com `correlationId`.

A F05 exige `DESIGN-SYSTEM.md` anexado e protótipos HTML aprovados depois do PRD e antes da construção. O mockup de brainstorming que escolheu o layout A não substitui esses artefatos.

## 11. Conteúdo permitido

Payload é validado por allowlist antes da persistência.

Permitido: identificadores, estados, tempos, duração, contadores, custo/quota, códigos de erro normalizados e referências de evidência.

Proibido: credencial, cookie, variável de ambiente, prompt/resposta completos, conteúdo de arquivo, diff, stdout/stderr bruto e corpo HTTP integral.

Mensagem visível é resumo estruturado e sanitizado. Conta/perfil usa alias ou fingerprint. Campo desconhecido é rejeitado e gera falha de ingestão sanitizada. Evento registra versão de schema e política de sanitização.

## 12. Falhas e recuperação

- outbox/projector: retry idempotente; backlog visível; rebuild das projeções;
- provedor indisponível: backoff, último estado preservado com timestamp e novo estado `unknown/degraded`;
- resposta parcial/incompatível: observação rejeitada, fixture capturada sem payload sensível e adapter degradado;
- evento duplicado/atrasado/fora de ordem: dedupe e ordenação causal;
- armazenamento de projeção indisponível depois do commit canônico: outbox permanece pendente e o projetor retoma sem lacuna;
- falha ao gravar estado + outbox: a transação inteira falha antes de confirmar qualquer efeito local; é falha do armazenamento canônico, não rollback posterior causado pelo painel;
- notificação falhou: alerta permanece canônico;
- renderer desconectou: snapshot completo ao reconectar;
- retenção interrompida: compactação reinicia pela mesma chave sem apagar proteção.

Observabilidade nunca executa compensação nem declara produção saudável sem evidência atual do dono do estado.

## 13. Testes e evidências

- unidade: schemas, sanitização, idempotência, deduplicação, severidade, rollups, retenção e resolução;
- integração SQLite: atomicidade, crash/replay, migrations e rebuild;
- contratos: fixtures de GitHub, GHCR, Vercel, Railway, Codex e executores;
- fault injection: timeout, rate limit, resposta parcial/duplicada/atrasada/fora de ordem, clock skew, disco indisponível e reinício;
- IPC: snapshot, deltas, salto de versão, reconexão e paginação;
- E2E: run → PR → Preview → Release → alerta → reconhecimento → resolução → evidência;
- UI: teclado, foco, leitor de tela, contraste e notificação crítica;
- carga: 100 mil eventos e 10 mil ocorrências; consulta principal `p95 ≤ 500 ms`, console útil em até 2 s e evento interno visível em até 1 s no ambiente de referência registrado;
- smoke externo: opt-in em projetos de prova, nunca Produção.

`reports/TESTS.md` registra ambiente, fixtures, métricas, providers, execução e links/hashes de evidência. Smoke ausente por falta de credencial é `not_run`, nunca `pass`.

## 14. Fatias aprovadas

1. **M15-F01 — Núcleo de eventos, outbox e projeções.** `spec-observabilidade-01-eventos-outbox-projecoes.md`.
2. **M15-F02 — Reconciliação, saúde, custos e quotas.** `spec-observabilidade-02-reconciliacao-saude-custos-quotas.md`.
3. **M15-F03 — Alertas e notificações.** `spec-observabilidade-03-alertas-notificacoes.md`.
4. **M15-F04 — Consultas, retenção, rollups e CLI.** `spec-observabilidade-04-consultas-retencao-cli.md`.
5. **M15-F05 — Console operacional.** `spec-observabilidade-05-console-operacional.md`.
6. **M15-F06 — Resiliência, desempenho e prova E2E.** `spec-observabilidade-06-resiliencia-desempenho-e2e.md`.

As fatias são sequenciais. F01 cria o núcleo reconstruível; F02 prova o mundo externo; F03 transforma condições em alertas; F04 estabiliza leitura e ciclo de dados; F05 entrega a experiência aprovada; F06 prova degradação, carga e jornada completa.

## 15. Critério de encerramento

Para um projeto selecionado, o PI vê estado atual e histórico causal de uma jornada completa, identifica falha e impacto sem consultar todos os provedores, reconhece e resolve alertas, acompanha custo/quota sem dado inventado e alcança a evidência original. Reinício, duplicação, atraso ou indisponibilidade do observador não alteram a operação canônica e convergem sem perder marcos duráveis.

## 16. Gates e autorização

Este design autoriza redigir as seis SPECs do MVP-015. Não autoriza implementação, criação de issues, push, PR, contratação de serviço, smoke externo pago ou mudança na fila.

Cada SPEC precisa de aceite exato do PI antes da construção. A F05 também depende do `DESIGN-SYSTEM.md` e dos protótipos HTML formais aprovados. Não resta questão estrutural aberta; nomes exatos de tipos, migrations e divisão de arquivos pertencem às SPECs sem poder alterar os contratos deste design.
