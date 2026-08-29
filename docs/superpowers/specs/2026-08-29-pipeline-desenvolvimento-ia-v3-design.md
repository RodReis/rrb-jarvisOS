# Design — Pipeline V3: release, operação e aprendizado

- Status: **direção da V3, designs dos MVPs 014–016 e onze SPECs dos MVPs 014–015 aprovados pelo PI** em 2026-08-29.
- Escopo deste documento: fronteira da Pipeline V3 e design detalhado do MVP-014. Os MVPs 015–016 possuem designs complementares próprios.
- Implementação: **não autorizada por este documento**. Cada SPEC continua sujeita ao aceite pré-construção do PI.
- Predecessora: `2026-08-29-pipeline-desenvolvimento-ia-v2-design.md`.

## 1. Resultado da V3

A Pipeline V3 começa onde a V2 termina. A V2 constrói e mergeia o DAG aprovado; a V3 transforma o merge confirmado em Preview, Staging e Produção verificáveis, registra a release e, nas evoluções seguintes, observa a operação, aprende com falhas, reutiliza blueprints e administra vários projetos.

O primeiro incremento é o **MVP-014 — Release e Deploy Governado**. Ele publica frontend na Vercel, backend e PostgreSQL na Railway, usa Docker Compose como ambiente local oficial e GHCR como registro padrão do backend.

Produção é automática depois do merge e dos gates técnicos. Não existe um segundo aceite do PI. O aceite pré-construção da SPEC autoriza construir e, quando o resultado satisfaz os gates, publicar. Fechamento de issue permanece ato administrativo e não bloqueia deploy.

## 2. Roadmap da Pipeline V3

1. **MVP-014 — Release e Deploy Governado.** Preview isolado, Staging persistente, Produção automática, compensações e evidência de release.
2. **MVP-015 — Observabilidade Operacional.** Runs, PRs, deploys, custos, quotas, falhas, saúde dos adapters e timeline por SPEC/MVP.
3. **MVP-016 — Aprendizado Operacional da Pipeline.** Lições e políticas versionadas, memória de falhas, replay/shadow/canário e otimização de contexto/tokens sem substituir o MVP-007 nem reimplementar os mecanismos dos MVPs 008/009.
4. **MVP-017 — Biblioteca de Blueprints.** Padrões de PRD, arquitetura, SPEC, DESIGN-SYSTEM, protótipos e perguntas orientadas com “Decide por mim”.
5. **MVP-018 — Gestão de Portfólio.** Vários projetos, fila global, prioridade do PI, custo/quota por projeto e prontidão de planejamento.

O MVP-014 está detalhado neste documento. O MVP-015 possui design e seis SPECs aprovadas em `2026-08-29-mvp-015-observabilidade-operacional-design.md`. O MVP-016 possui design e seis fatias aprovadas em `2026-08-29-mvp-016-aprendizado-operacional-design.md`; suas SPECs ainda serão redigidas. MVP-017 e MVP-018 mantêm somente direção aprovada.

## 3. Decisões do PI para o MVP-014

1. Docker Compose é o ambiente local oficial.
2. Vercel publica o frontend; Railway publica o backend e hospeda o PostgreSQL como recurso separado.
3. Preview completo e isolado nasce por fatia/PR e é removido ao fechar o PR.
4. Staging é persistente e obrigatório antes de Produção.
5. Merge mais gates aprovados promovem automaticamente para Produção, sem novo aceite do PI.
6. Migrations são forward-only e usam expand/contract. Restore do banco nunca é automático.
7. Releases usam máquina de estados, diário idempotente e compensações; não fingem transação entre provedores.
8. Segredos permanecem nos provedores. A pipeline guarda somente referências e fingerprints.
9. Há uma release ativa por projeto e ambiente. Merges anteriores ao início de Staging podem ser consolidados.
10. Falha de código retorna à V2 em nova branch e PR ligados à mesma SPEC, sem novo aceite de produto.
11. Release bem-sucedida recebe manifesto, changelog, tag e GitHub Release automáticos.
12. GHCR é o registro padrão do backend; Staging e Produção usam o mesmo digest OCI.
13. Adapters de Vercel e Railway são híbridos e CLI-first. Nenhum fallback é silencioso.
14. Produção permanece em estabilização por cinco minutos por padrão, configurável por projeto.

## 4. Fora do escopo do MVP-014

- provedores adicionais de frontend, backend, banco ou registry;
- cofre próprio de segredos;
- análise histórica de métricas e regressões, pertencente ao MVP-015;
- aprendizagem e compressão de contexto, pertencentes ao MVP-016;
- classificação genérica de saúde, finanças ou documentos como “alto risco”;
- LGPD, consentimento, aceite duplo ou regra jurídica não passada pelo PI;
- restauração automática do PostgreSQL;
- modificação direta de Produção por agente;
- Browser automation como mecanismo de deploy;
- vários writers sobre a mesma release.

## 5. Arquitetura

```text
PR/fatia aprovada ── PreviewCoordinator ── PreviewRun
                              │
                              ├── GhcrArtifactAdapter
                              ├── VercelFrontendAdapter
                              ├── RailwayBackendAdapter
                              └── RailwayDatabaseAdapter

Merge confirmado ── ReleaseQueue ── ReleaseOrchestrator ── ReleaseRun
                                           │
                                           ├── ConfigurationReferenceValidator
                                           ├── ReleaseGateEngine
                                           ├── StabilizationMonitor
                                           ├── ReleaseEvidenceWriter
                                           └── ReleaseCorrectionDispatcher ── Pipeline V2

LocalComposeAdapter ── Docker Compose local
```

### 5.1 Dois fluxos

`PreviewRun` é descartável, pertence a um PR/SPEC e nunca recebe tag de Produção. `ReleaseRun` nasce do merge, pode consolidar SHAs ainda não iniciados e fica imutável ao entrar em Staging.

Local, cada Preview, Staging e Produção possuem configurações e bancos separados. Nenhum ambiente compartilha PostgreSQL com outro.

O núcleo determinístico persiste estados normalizados e não conhece comandos ou payloads específicos dos provedores. Adapters convertem operações externas em resultados tipados. A UI apenas projeta estado; decisões e controles existem primeiro na CLI.

### 5.2 Contratos externos

- `LocalComposeAdapter`: sobe, verifica e encerra o ambiente Docker Compose oficial.
- `ArtifactRegistryAdapter`: publica e resolve imagem OCI por digest e provenance.
- `FrontendDeploymentAdapter`: cria Preview, atribui Staging, promove Produção, consulta e compensa.
- `BackendDeploymentAdapter`: implanta digest, consulta health, reinicia, reconcilia e compensa.
- `DatabaseLifecycleAdapter`: provisiona banco temporário, executa migration, backup e consulta estado.
- `ReleaseGitAdapter`: registra tag, GitHub Release, changelog e vínculos com PR/SPEC.

Vercel e Railway usam modelo híbrido CLI-first: a CLI executa operações suportadas; SDK/API consulta identificadores, estados e efeitos que exigem reconciliação estruturada. O adapter declara o transporte usado. Browser automation não é fallback.

## 6. Dados e invariantes

Entidades principais:

- `PreviewRun`: projeto, SPEC, issue, PR, SHA, ambientes temporários, gates e expiração.
- `ReleaseRun`: `release_id`, projeto, SHA final, SHAs/PRs/SPECs incluídos, release anterior e estado.
- `Artifact`: tipo, URI, digest imutável e provenance.
- `Deployment`: provedor, ambiente, identificador externo, URL, artefato e estado.
- `MigrationExecution`: versão, checksum, ambiente, backup e resultado.
- `GateResult`: gate, evidência, duração e resultado.
- `ConfigurationReference`: nome, ambiente, fingerprint e estado, nunca o valor.
- `CompensationExecution`: falha original, ação e resultado.

Invariantes:

- chave idempotente: `project_id + environment + release_id + step`;
- um writer possui lease sobre a release;
- Staging e Produção recebem o mesmo digest do backend;
- frontend é promovido sem rebuild;
- SHA e artefatos ficam imutáveis quando Staging começa;
- transição inválida é rejeitada e auditada;
- retry só ocorre depois de reconciliar efeito incerto;
- segredo nunca cabe em request, evento, log, relatório, issue ou persistência do domínio;
- documentação incompleta não reverte nem bloqueia código tecnicamente saudável.

## 7. Estados

Estados gerais do `ReleaseRun`:

`queued → preparing → staging → production → stabilizing → completed`

Terminais alternativos:

`superseded | failed | degraded`

Dentro de Staging e Produção, o diário usa a sequência:

`prepared → database_migrated → backend_healthy → frontend_promoted → smoke_passed`

Retomada continua do último passo confirmado. `degraded` significa que a compensação não restaurou integralmente um estado conhecido. `superseded` preserva a rastreabilidade de SHAs consolidados no candidato mais recente.

## 8. Fluxo de Preview

1. PR da fatia cria ou atualiza um `PreviewRun`.
2. CI publica imagem de Preview no GHCR.
3. Railway cria backend e PostgreSQL temporários.
4. O banco recebe migrations e seed determinístico; Produção nunca é copiada.
5. Vercel cria Preview ligado ao backend temporário.
6. Healthcheck, smoke e testes exigidos pela SPEC são executados.
7. URLs e evidências curtas são vinculadas ao PR.
8. Novos commits atualizam o mesmo Preview.
9. Fechamento do PR destrói recursos temporários e preserva hashes/evidências.

## 9. Fluxo de release

1. Merge confirmado cria ou atualiza candidato ainda não iniciado.
2. A fila consolida SHAs pendentes antes de Staging e serializa por projeto.
3. Configurações e referências obrigatórias são validadas.
4. CI constrói o backend uma vez e publica no GHCR por digest com provenance.
5. Vercel produz um deployment imutável do frontend.
6. Staging aplica migration em seu próprio PostgreSQL, implanta o digest, atribui o frontend e executa health, smoke e E2E essencial.
7. Produção gera backup de seu PostgreSQL separado, aplica migration forward-only, implanta o mesmo digest e promove o mesmo deployment do frontend.
8. A release entra em `stabilizing` por cinco minutos, com healthcheck a cada trinta segundos e smoke essencial.
9. Sucesso gera manifesto, tag, GitHub Release e changelog e libera a próxima release.

Projetos diferentes podem publicar em paralelo. No mesmo projeto e ambiente existe apenas uma release ativa.

## 10. Migrations e banco

Migrations são forward-only. Mudança destrutiva usa duas releases: primeiro expandir/migrar; depois remover. A versão anterior da aplicação deve permanecer compatível com o schema expandido durante a janela de rollback.

Falha de migration antes da troca de tráfego interrompe a promoção. Falha posterior pode compensar frontend e backend, mas não desfaz o banco. Restore exige comando operacional explícito e referência de backup; não é aprovação de produto nem ação automática.

PostgreSQL é um recurso separado do backend. Seu identificador, migration, backup e resultado são registrados separadamente.

## 11. Configuração e segredos

Vercel e Railway permanecem fontes dos segredos. A pipeline guarda nomes esperados, referências, fingerprints e estado `configured | missing | divergent`. Valor secreto nunca é persistido.

Docker Compose usa `.env.local` ignorado pelo Git e `.env.example` somente com nomes. Antes do deploy, o gate compara o contrato de chaves entre Preview, Staging e Produção. Chave ausente bloqueia; diferença permitida de valor não bloqueia. Rotação no provedor invalida o fingerprint anterior.

## 12. Falhas, compensação e cancelamento

Classificação:

- `transient`: até três retries com backoff;
- `configuration`: bloqueia antes do deploy;
- `artifact`: falha sem promoção;
- `migration`: interrompe antes da troca de tráfego;
- `health_or_test`: compensa frontend/backend;
- `unknown`: reconcilia no provedor antes de repetir.

Falha local expira o lease e permite retomada. Compensação incompleta gera `degraded`. A fila pausa apenas o projeto afetado.

Falha de código, teste, health ou migration gera correção na V2 em nova branch/PR ligada à mesma SPEC, com os relatórios anteriores no contexto. Não há novo aceite quando a correção não altera escopo.

Cancelamento antes de Staging limpa recursos temporários. Durante Staging, conclui e reconcilia a operação remota corrente antes de parar. Durante Produção, converte-se em compensação segura. Depois da promoção, converte-se em rollback para um `release_id`. Efeitos e evidências nunca são apagados cegamente.

## 13. Identidade e evidência de release

Cada Produção saudável recebe `release_id` imutável. O manifesto registra SHA, artefatos, deployment IDs, migrations, gates, SPECs, issues, timestamps e release anterior.

O padrão de tag é `release-YYYYMMDD-HHMM-<shortsha>`. SemVer só é usado quando o projeto declara sua política; a IA não deduz `major`, `minor` ou `patch`. Tag e GitHub Release só nascem depois da estabilização. Rollback referencia `release_id`, não “versão anterior”.

## 14. Testes e evidências

Camadas obrigatórias:

- testes unitários de estados, transições, leases, idempotência, consolidação e redaction;
- contract tests para adapters com sucesso, timeout, autenticação inválida, resposta parcial e estado desconhecido;
- integração local com Docker Compose e PostgreSQL real;
- injeção de falha após efeito remoto, em migration, healthcheck, promoção e reinício do Jarvis;
- E2E em projeto de prova real com Vercel, Railway e GHCR;
- Playwright para smoke funcional nas URLs de Preview, Staging e Produção.

A evidência curta fica na issue/SPEC. Detalhe fica em `docs/TESTING.md` e no histórico correspondente. Falha de documentação gera reparo, não bloqueio técnico.

## 15. Fatias do MVP-014

1. **M14-F01 — Núcleo de release e fila.** Entidades, estados, diário, leases, consolidação, CLI e adapters fake. SPEC: `spec-release-01-nucleo-estados-fila.md`.
2. **M14-F02 — Docker, artefatos e configuração.** Docker Compose, migrations locais, GHCR, provenance e referências. SPEC: `spec-release-02-compose-artefatos-config.md`.
3. **M14-F03 — Preview isolado por PR.** Vercel, Railway, PostgreSQL temporário, gates e limpeza. SPEC: `spec-release-03-preview-isolado.md`.
4. **M14-F04 — Staging e Produção automática.** Ambiente persistente, backup, migration, promoção e estabilização. SPEC: `spec-release-04-staging-producao.md`.
5. **M14-F05 — Compensação, retorno à V2 e E2E.** Retry, reconciliação, rollback de aplicação, cancelamento, manifesto e prova real. SPEC: `spec-release-05-recuperacao-e2e.md`.

As fatias são sequenciais. A F01 prova o núcleo, a F02 prova o caminho local, a F03 entrega Preview, a F04 entrega publicação e a F05 prova recuperação.

## 16. Critério de encerramento do MVP-014

Uma fatia mergeada percorre Preview, Staging e Produção sem novo aceite, usa o mesmo backend e frontend já validados, estabiliza, gera identidade de release e retoma com segurança depois de falhas. Uma falha comprovada compensa aplicações ou retorna à V2 sem alterar Produção diretamente nem repetir diagnóstico já encerrado.

## 17. Gates e autorização

Este design autoriza as cinco SPECs do MVP-014 e remete o MVP-015 ao seu design complementar aprovado. Não autoriza implementação, criação de issues, gasto novo, push ou PR. Cada SPEC precisa de aceite pré-construção do PI antes de entrar no backlog executável.

Não resta questão estrutural aberta para o design do MVP-014. Nomes exatos de tipos, schemas IPC, migrations locais e divisão interna de arquivos pertencem às SPECs e não podem alterar os contratos acima.
