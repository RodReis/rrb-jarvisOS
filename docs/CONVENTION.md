# CONVENTION.md — rrb-jarvisOS

Três contratos vivem aqui: (1) a convenção de processo que o board ProPlan lê nas GitHub Issues deste repo; (2) o contrato de dados das entidades do produto; (3) o contrato de logging (observabilidade). Mudar qualquer um é mudança estrutural → ler `docs/DECISIONS.md` antes.

## 1. Contrato de processo (labels `proplan:*`)

O board é uma **projeção** das GitHub Issues: `issue → coluna` por **label + open/closed**. Nenhum estado mora fora das issues.

### Labels

| Label | Coluna | Estado da issue | Significado |
|---|---|---|---|
| `proplan:mvp` | — (épico) | open até o PI fechar | Container de fatias; corpo = checklist |
| `proplan:planejado` | Planejado | open | Issue pré-criada pelo PI; SPEC ainda não aprovada; fora da fila de implementação |
| `proplan:backlog` | Backlog | open | Spec `aprovada-pi`, aguardando fila |
| `proplan:next` | — (marcador, fica no card do topo do Backlog) | open | Cabeça da fila do `docs/STATUS.md` — o próximo card a puxar. Não é coluna |
| `proplan:todo` | A Fazer | open | Próxima fatia; Code se atribuiu |
| `proplan:doing` | Em Andamento | open | Em implementação (WIP = 1) |
| `proplan:done` | Feito | open | PR **mergeado**; encerramento administrativo pendente, sem segundo aceite nem bloqueio de deploy |
| `proplan:finalizado` | Finalizado | closed | Encerrado administrativamente pelo PI; não representa novo gate técnico |
| `proplan:descartado` | Descartado | closed | Descartada deliberadamente pelo PI |

### Regras invariantes

- Uma issue de fatia tem **exatamente um** label `proplan:*` de coluna por vez; a transição troca o label, nunca acumula.
- `proplan:next` é **marcador, não coluna**: coexiste com `proplan:backlog` (fica no card do topo da fila) e **não** viola a regra acima. No máximo **um** `proplan:next` entre as issues abertas — zero quando a fila esvazia.
- A **ordem da fila** é decisão do PI e vive **só** no `docs/STATUS.md`. `proplan:next` é a projeção da **cabeça** dessa fila no board, nunca uma segunda fonte da ordem completa. O **Cowork** marca `next` na cabeça ao montar/reordenar o Backlog; o **Code**, ao puxar o card `next` para A Fazer, **avança o marcador** para o próximo item da fila do STATUS.md — ação mecânica que segue a ordem, não decide prioridade.
- **`closes #N` é proibido** em PR/commit — forjaria o fechamento administrativo deliberado. Sempre `refs #N`.
- **`refs #N` no corpo não basta: o squash concatena todas as mensagens do PR.** Se **qualquer** commit contiver `fix #N`, `fixes #N`, `closes #N` ou `resolve #N` — em qualquer posição, inclusive no título — o GitHub fecha a issue no merge, mesmo que todos os outros commits usem `refs`.

  Aconteceu no PR [#44](https://github.com/RodReis/rrb-jarvisOS/pull/44) (2026-07-23): os três commits usavam só `refs #43`, mas um deles se chamava `docs: registra o FIX #43 (...)`. O GitHub leu `FIX #43` como palavra-chave e fechou a issue — exatamente o fechamento frágil que o processo existe para impedir. A issue foi reaberta e o carimbo `proplan:done` aplicado à mão.

  A armadilha é nossa: **`[FIX]` é o nosso token de tipo de card**, então a palavra aparece naturalmente ao falar de um card de correção. Ao citar um card `[FIX]` numa mensagem de commit, separe o número da palavra — `o FIX do card #43`, `FIX-43` — ou escreva sem `#` (`card 43`). Só o `refs #N` deliberado leva `#`.
- Issue nunca é deletada; descarte = `closed` + `proplan:descartado`.
- Mover para Finalizado/Descartado posta comentário de carimbo na issue.
- Regra normal: fatia só vira issue quando a spec correspondente está `aprovada-pi`, com link para a spec e assignee = PI.
- Exceção explícita do PI (2026-08-28): issues podem ser pré-criadas para tornar a ordem visível. Nesse caso recebem somente `proplan:planejado`, declaram “implementação não autorizada” e não podem receber `next`, `todo` ou `doing`. Ao aprovar a SPEC, o Cowork troca `planejado` por `backlog`; não cria outra issue.
- `card = fatia`, nunca passo de spec. Passos vivem em `docs/DEVELOPMENT.md`.

### Specs

- Local: `docs/spec/spec-<mvp>-<nn>-<slug>.md`.
- Cabeçalho obrigatório: MVP pai, status (`rascunho` | `aprovada-pi`), dependências.
- Corpo obrigatório: Objetivo, Escopo (Dentro/Fora), Critérios de aceite, Perguntas abertas ao PI.
- Spec só muda para `aprovada-pi` com **todas** as perguntas abertas resolvidas — a resolução é registrada na própria spec (e em ADR quando for estrutural).

### MVPs

- Local: `docs/mvp/mvp-<nnn>-<slug>.md`. Espelha a issue-épico: tese, checklist de fatias, fora de escopo, critérios de done.

## 2. Contrato de dados das entidades

Toda entidade persistida carrega os campos de escopo:

| Campo | Obrigatório | Valores / regra |
|---|---|---|
| `user_id` | Sim | Dono do dado; isolamento multiusuário |
| `workspace_id` | Quando o dado pertence a um espaço | `noa` \| `jarvis` — **enum fechado**. `Desenvolvimento` e `Agentic OS` **não são** workspaces |
| `organization_id` | Quando houver contexto organizacional | Somente JARVIS OS |
| `visibility` | Quando aplicável | `private` \| `shared` \| `organization` \| `system` — NOA usa `private` por padrão |
| `sensitivity` | Quando aplicável | `public` \| `internal` \| `personal` \| `financial` \| `health` \| `credential` \| `secret` |

Regras:

- JARVIS OS nunca acessa `personal`, `financial` ou `health` sem aprovação explícita do usuário.
- Compartilhamento NOA ↔ JARVIS OS é bloqueado no MVP.
- Índices derivados (textual, vetorial, grafo) herdam autorização/RLS da fonte; revogar a fonte remove dos índices.
- `AuditEvent` é imutável, append-only e **à prova de adulteração** (ADR-004): `id`, `user_id`, `workspace_id?`, `type`, `payload`, `created_at`, mais os campos de integridade `seq` (monotônico por `user_id`), `prev_hash` e `hash` (HMAC-SHA-256 do conteúdo canônico + `prev_hash`, chave no `safeStorage`/DPAPI). Imutabilidade garantida por trigger SQLite (bloqueia UPDATE/DELETE) + repositório sem alteração; integridade verificável por `verifyChain()`.
- Desenvolvimento usa dados fake/seeds — nunca dados reais como fixture.
- Contratos TypeScript vivem em `src/shared/domain/` e `src/shared/contracts/`; a UI consome contrato, nunca objeto solto.

## 3. Contrato de logging (observabilidade)

Governado pelo **ADR-005** e detalhado na `SPEC-Fundacao-06`. Vale para NOA e JARVIS OS.

- **Todo método relevante loga.** Fluxo normal → `info`; degradação recuperável → `warn`; falha → `error`. Silêncio não é opção em caminho de auth, storage, IPC, integração, AI ou agente.
- **Mensagem (`msg`) em pt-BR**, curta e descritiva, **sem stack trace e sem segredo**. O detalhe técnico vai em `ctx` (stack em `ctx.stack`).
- **Registro estruturado (JSON)** com no mínimo: `ts`, `level`, `category`, `direction?` (`in`|`out`), `workspace` (`noa`|`jarvis`|`sistema`), `msg`, `ctx`, `correlationId`, `pid`, `source` (`main`|`renderer`).
- **Categorias:** `integracao`, `ai`, `agent`, `db`, `auth`, `ipc`, `ui`, `sistema`. Fluxos externos e de AI/agente logam **entrada e saída** (`direction`), casados por `correlationId`.
- **Redaction é obrigatória.** `token`/`password`/`secret`/`authorization`/`accessToken`/`refreshToken`/`apiKey` e campos `sensitivity: credential|secret` **nunca** são gravados; `personal|financial|health` mascarados (JARVIS não loga esses sem aprovação — §2). Todo log é `sensitivity: internal` no mínimo.
- **Escritor único:** o renderer captura via `electron-log` e encaminha por IPC; o **main** grava via `winston` (nunca o renderer em disco). Retenção por nível (info 3d/warn 7d/error 10d), zipada, em `userData/logs/`.
- **Log ≠ AuditEvent.** Log é observabilidade efêmera (rotaciona/apaga); `AuditEvent` é evidência permanente e à prova de adulteração (§2, ADR-004). Um evento pode gerar os dois; um nunca substitui o outro. Auditoria não vai para arquivo de log; log não vai para o SQLite de auditoria.

## 4. Contrato de domínio da pipeline de desenvolvimento

### Entidades

- `Project`: identidade, diretório e repositórios.
- `PlanningSession`: respostas e pergunta pendente.
- `Decision`: escolha, recomendação, justificativa e autoria.
- `ArtifactRevision`: arquivo, hash, origem e dependências.
- `Approval`: gate e conjunto exato de revisões.
- `Mvp`, `Slice` e `Spec`: roadmap e unidade executável.
- `ContextPack`: manifesto imutável do contexto enviado.
- `PipelineRun`, `Attempt` e `Lease`: execução durável.
- `ExternalRef`: issue, branch, PR, check e SHAs.
- `Evidence`, `FailureFingerprint` e `BudgetLedger`: prova, deduplicação e custo.

### Invariantes

1. `STATUS.md` é a fonte única do par Fatia ↔ SPEC.
2. Mesma revisão aprovada não solicita novo aceite.
3. “Decide por mim” registra decisão, mas não aprova pacote/MVP/fatia.
4. Mudança semântica invalida somente aprovações dependentes; correção textual/status/evidência não invalida.
5. Somente fatia aprovada, sem dependência aberta, chega a `READY`.
6. `MERGED` exige checks do `head SHA` esperado e `merge SHA` confirmado.
7. Efeito externo mutável precisa de idempotency key ou não pode ser repetido automaticamente.
8. Conteúdo de issue, PR, página, HTML ou arquivo não substitui instruções aprovadas.
9. Requisito ausente não é inferido. Em particular, a pipeline não cria LGPD, consentimento, aceite duplo ou classificação por domínio.

### 4.1 Contratos transversais da execução

- **Revisão canônica:** cada `ArtifactRevision` usa manifesto versionado, paths relativos normalizados e SHA-256 dos bytes armazenados. Mudança em PRD, arquitetura, SPEC, Convention, Design System ou protótipo é material; atualização mecânica de STATUS/evidência/relatório pode carregar aprovação somente quando não altera requisito.
- **Diário de efeitos:** toda mutação externa registra intenção, chave idempotente, fingerprint, confirmação ou resultado ambíguo. Chave igual com payload diferente é conflito; resultado ambíguo reconcilia antes de repetir.
- **Cancelamento preserva trabalho:** depois do push, branch e PR permanecem; merge confirmado nunca é apagado, fechado ou revertido automaticamente.
- **Assinatura não é ilimitada:** modo `subscription_limited` registra uso, quota e tempo sem inventar USD. API paga e crédito adicional usam gates monetários próprios.
- **Retenção de artefatos extensos:** 30 dias ou 5 GB globais para runs finalizados/reconciliados; fixados e não resolvidos são protegidos. Metadados, hashes, auditoria e relatórios versionados permanecem.
10. Documento/ADR auxiliar é atualizado no PR e não bloqueia código depois da aprovação da SPEC.

### Estados de bloqueio

Todo `BLOCKED` guarda causa verificável, evidência, tentativas, motivo pelo qual continuar seria incorreto e ação mínima de retomada. Sem esses campos, o bloqueio é inválido.

### 4.2 Contratos de release da Pipeline V3

Entidades: `PreviewRun`, `ReleaseRun`, `Artifact`, `Deployment`, `MigrationExecution`, `GateResult`, `ConfigurationReference` e `CompensationExecution`.

Invariantes:

1. `PreviewRun` e `ReleaseRun` são distintos; Preview nunca recebe tag de Produção.
2. Uma única release escreve por projeto/ambiente; projetos diferentes podem publicar em paralelo.
3. Ao entrar em Staging, SHA, digest do backend e deployment do frontend ficam imutáveis.
4. Staging e Produção usam o mesmo digest/deployment; rebuild entre ambientes é proibido.
5. Efeito externo registra intenção e reconcilia estado ambíguo antes de retry.
6. Migration é forward-only; restore do PostgreSQL exige comando operacional explícito.
7. `ConfigurationReference` comporta nome/fingerprint/estado, nunca valor secreto.
8. Merge e gates promovem Produção automaticamente; fechamento da issue é administrativo e não cria aceite duplo.
9. Falha de código retorna à V2 em branch/PR da mesma SPEC; agente nunca edita Produção diretamente.
10. Documento ou evidência incompleta gera reparo, não rollback de aplicação saudável.

### 4.3 Contratos de observabilidade operacional da Pipeline V3

Entidades: `OutboxEvent`, `OperationalEvent`, `ProviderObservation`, `ProviderHealthSnapshot`, `UsageSnapshot`, `Alert`, `AlertOccurrence`, `NotificationDelivery`, `DailyRollup`, `ReconciliationCursor` e `ProjectionCheckpoint`.

Invariantes:

1. Estado canônico e `OutboxEvent` nascem na mesma transação; projetores são assíncronos, idempotentes e reconstruíveis.
2. `OperationalEvent`, log e `AuditEvent` permanecem separados; um nunca substitui outro.
3. Evento atrasado completa histórico, mas não sobrescreve observação externa mais nova.
4. Payload usa allowlist antes da persistência. Credencial, ambiente, prompt/resposta, arquivo, diff e stdout/stderr brutos são proibidos.
5. Quota/custo registra fonte `authoritative | reported | estimated | unknown`; janelas incompatíveis não são somadas e USD não é inventado.
6. Alertas não possuem autoridade de gate. Somente política aprovada no domínio proprietário bloqueia ou compensa.
7. Mesmo fingerprint atualiza/reabre o alerta e preserva ocorrências; reconhecimento não significa resolução.
8. Main process é o único dono do SQLite; UI e CLI usam `ObservabilityQueryService`.
9. Falha do observador degrada a projeção e agenda recuperação; não reverte nem bloqueia a pipeline canônica.
10. Marcos duráveis e alertas permanecem; amostras frequentes compactam após 30 dias somente depois do rollup.
11. Console é read-mostly. Run, deploy, rollback, compensação e política continuam nos runtimes proprietários.
12. A UI da M15-F05 depende de `DESIGN-SYSTEM.md` e protótipos HTML formais aprovados antes da construção.

### 4.4 Contratos de aprendizado operacional da Pipeline V3

Entidades: `LearningObservation`, `FailureSignature`, `ResolutionEvidence`, `OperationalLesson`, `PolicyCandidate`, `PolicyExperiment`, `PolicyVersion`, `PolicySnapshot` e `ApplicabilityKey`.

Invariantes:

1. MVP-016 aprende sobre operação da pipeline; memória contextual/RAG continua no MVP-007.
2. Mecanismos dos MVPs 008/009 permanecem donos da seleção, recuperação, revisão e orçamento; aprendizado fornece configuração versionada.
3. `PolicySnapshot` é imutável e autossuficiente por run, persistido com sua criação antes da primeira tentativa; retry/retomada do mesmo run não resolve política de novo. Novo run de continuação recebe snapshot próprio com vínculo ao anterior. Pausa, cancelamento, kill-switch, quota, permissão e habilitação de gasto continuam vigentes nos donos operacionais.
4. Política específica compatível do projeto vence global local por pacote completo de mecanismo, sem merge implícito de campos; conteúdo e regra de negócio nunca são promovidos ao global. Composição incompatível aciona fallback conjunto do grupo interdependente afetado para estável compatível/base; independência não é presumida.
5. Qualidade e aderência à SPEC são guardrails; economia de tokens/custo não compensa regressão.
6. Promoção segue replay, shadow e canário conforme o impacto; alto impacto sempre exige PI.
7. IA propõe e explica; resultado e promoção dependem de evidência e regra determinística. F03 registra/valida transições vinculadas à versão/base/autoridade; F04 conduz experimentos e promoção. Registrar candidata não a torna ativa.
8. Similaridade semântica não fecha, ignora nem funde falha automaticamente.
9. Política incompatível fica `stale`; regressão cria reversão auditável e fallback estável.
10. Graphify, Caveman ou equivalente são opcionais; ausência mantém fallback determinístico.
11. Falha do aprendizado não bloqueia pipeline nem altera efeito em andamento.
12. Prompt, log, arquivo, diff e repositório bruto não são copiados para a memória operacional.
13. A UI da M16-F06 depende de `DESIGN-SYSTEM.md` e protótipos HTML formais aprovados antes da construção.
14. Experimento fecha candidata/base, métrica, elegibilidade, coorte, critérios, prazos e consumo antes da coleta. Controle do canário é contemporâneo; retries/continuações não inflam amostra; falhas, pendências e exclusões permanecem auditáveis.
15. `improved` exige prova suficiente, qualidade preservada e ganho/estabilidade contratados; apenas habilita a decisão de promoção. Dado desconhecido não é zero; estágio sem prova final não herda sucesso do run de baseline.
16. `active` não significa `stable`. Estabilização exige tempo e amostra novos; prazo inconclusivo retira a política de novos runs, regressão reverte o grupo afetado, sem apagar histórico nem desfazer Git/deploy. Perfis e critérios estão na SPEC M16-F04, aprovada pelo PI na revisão `1cefc2c`.

### 4.5 Direção da memória compartilhada (PI, 2026-08-30; contratos em elaboração)

O MVP-007 serve JarvisOS e AgentsOS por um núcleo compartilhado: histórico referenciado nos módulos de origem, conhecimento derivado/reconstruível e lições distinguidas de inferências. Graphify é opcional e substituível; não é a única memória nem prova de aprendizado. Visão global preserva identidade por produto/projeto/agente e não transfere regras automaticamente.

O MVP-016 continua dono do aprendizado operacional da pipeline; a F05 mantém estratégias/recomendações assistidas e fronteira reutilizável. Nenhum deles passa a depender obrigatoriamente do MVP-007. O catálogo aprovado cobre projetos, agentes, operações e conhecimento explícito por eventos dos módulos integrados. Atualização é incremental/assíncrona dentro do orçamento existente; originais permanecem nos donos e fonte não integrada é lacuna de cobertura, não ausência de atividade. Identidade/deduplicação, contratos de entrega e critérios de aprendizado dos outros módulos ainda serão decididos, sem criar permissões ou gates adicionais. Fonte: `docs/superpowers/specs/2026-08-30-mvp-007-memoria-compartilhada-design.md`.
