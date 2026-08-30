# DECISIONS.md — Índice de ADRs

**Ler antes de propor qualquer mudança estrutural.** ADRs individuais vivem em `docs/adr/`. Formato: `adr-NNN-slug.md` com Status, Data, Problema, Decisão, Consequências. ADR aceito só sai de vigor por outro ADR que o substitua explicitamente.

## Índice

| ADR | Título | Status | Resumo |
|---|---|---|---|
| [ADR-001](adr/adr-001-arquitetura-local-first.md) | Arquitetura local-first com sync cloud | Aceito | Local é fonte de verdade operacional; Supabase Cloud é espelho de sync/auth/auditoria. Multiusuário por conta, não multi-tenant server-side. Agentes rodam com app ativo (inclusive tray); não sobrevivem a logout/reboot. Corrige decisões #3, #4 e #10 do PRD de design system. RF-020 fora do MVP. |
| [ADR-002](adr/adr-002-supabase-dev-nuvem-oauth.md) | Projeto Supabase de dev na nuvem para OAuth | Aceito | OAuth Google em dev usa projeto Supabase na nuvem (só auth). Supabase local Docker entra na fase de persistência/RLS. |
| [ADR-003](adr/adr-003-relatorio-testes-evidencia.md) | Relatório de evidência de testes gerado por máquina | Aceito (metodologia; código na Fatia 01) | Números só do `--json` dos runners (Vitest/Playwright), nunca à mão. `reports/TESTS.md` incremental append-only, 3 categorias (Banco/Regras/Tela), guarda anti-drift no CI com baseline no git da base do PR + self-check. Cobertura report-only. Adaptado do `rrb-proplan` à stack Electron. Ver `docs/TESTING.md`. |
| [ADR-004](adr/adr-004-auditoria-prova-adulteracao.md) | Auditoria à prova de adulteração | Aceito | `AuditEvent` tamper-evident: trigger SQLite bloqueia UPDATE/DELETE + hash-chain HMAC-SHA-256 por usuário (`seq`/`prev_hash`/`hash`, chave no `safeStorage`/DPAPI) + `verifyChain()` verificável em teste. Tamper-evident, não tamper-proof — âncora externa fica para o sync (Corte 3+). Aplica na SPEC-Fundacao-04. |
| [ADR-005](adr/adr-005-observabilidade-logging.md) | Observabilidade e logging estruturado | Aceito | `electron-log` (renderer, via IPC) + `winston`/`daily-rotate-file` (main, escritor único). JSON estruturado, msg pt-BR, categorias (integração/ai/agent/db/auth/ipc/ui/sistema), tag `workspace`. Retenção por nível (info 3d/warn 7d/error 10d) zipada e local; redaction obrigatória. Log ≠ AuditEvent. Monitor visual e envio à nuvem ficam para depois. Fatia 06, roda cedo. |

## Decisões de processo (não-ADR, registradas aqui)

| Data | Decisão | Decisor |
|---|---|---|
| 2026-07-22 | **Prioridade no board via marcador único `proplan:next`** (Opção A). A ordem completa da fila vive só no `docs/STATUS.md` (fonte única); `next` projeta a cabeça dela no board. Marcador, não coluna — coexiste com `proplan:backlog`, no máximo um aberto. Rejeitada a ordenação ordinal no título/label (viraria segunda fonte da fila → drift). Registrado em CONVENTION §1. | PI |
| 2026-07-22 | **SPEC-Fundacao-06 emendada:** critério 5 e nota de escopo corrigidos — instrumentação de `auth`/`workspace-switch`/`db` migra para F03/F02/F04 (cada uma com critério de aceite de logging dedicado), porque esse código não existe quando o F06 executa. O F06 entrega infra + contrato (CONVENTION §3) e instrumenta só `ipc`/`sistema`. | PI |
| 2026-07-22 | **Ordem F04 antes de F02 no MVP-001** (fila `01 → 06 → 04 → 02 → 03 → 05`). PI delegou a decisão ao Cowork; rationale: F02/F03 consomem os contratos tipados da F04 (`Workspace`/`Session`/`AuditEvent`), logo F04 primeiro evita codar contra tipo provisório. `proplan:next` aplicado à #5. A ordem completa vive no `docs/STATUS.md`. | PI (delegado) |
| 2026-07-19 | MVP-001 Fundação estruturado como épico com **5 fatias** (uma por spec), substituindo a "fatia única com 5 specs" do plano original | PI |
| 2026-07-19 | `CONVENTION.md` cobre processo (labels `proplan:*`) **e** contrato de dados das entidades | PI |
| 2026-07-18 | Processo de design system formal do PRD **suspenso** para time solo + IA (Tailwind + Radix ad-hoc, tokens mínimos) | PI (via plano de fundação) |
| 2026-07-21 | **Cifra de dados sensíveis.** Local: tokens/segredos em disco via `safeStorage`/**DPAPI** (chave do usuário do SO) — vale já na SPEC-Fundacao-03. Cloud: dados sensíveis sincronizados ao Supabase vão **E2EE, cifrados na máquina com AES-256**; o cloud nunca vê texto claro — aplica quando o sync entrar (Corte 3+). | PI |
| 2026-07-21 | **Papel SQLite ↔ Supabase.** SQLite é o banco **interno embutido** da aplicação — fonte de verdade operacional local (confirma ADR-001/004); isolamento por `user_id`/`workspace_id`. Supabase é o **alvo de sincronização na nuvem** (dev: Supabase local em Docker; RLS vale no lado Supabase). Confirma ADR-001, não altera. Governa a Fatia 01 do MVP-002. | PI |
| 2026-07-21 | **Corte 2 dividido em dois MVPs.** MVP-002 = fundação de execução (Supabase local, permissões/Policy Engine, allowlist, registro de workflows, execução simulada auditada). MVP-003 = terminal + execução real allowlisted + BudgetPolicy. Evita concentrar risco. | PI |

## Questões abertas (herdam do ADR-001; resolver antes das fatias que dependem delas)

1. ~~**BudgetPolicy com BYOK**: estimativa + alerta vs. proxy para bloqueio real.~~ **Resolvida (2026-07-21, PI):** estimativa + alerta com **bloqueio no ponto único de chamada** (adapter recusa novas chamadas ao bater o limite; sem proxy). Registrada no ADR-001 (questão aberta 1). **A BudgetPolicy mora no MVP de providers (Corte 3)**, não no MVP-003 — só há gasto a medir quando os providers existirem.
2. ~~**Duração da sessão offline**: proposta de 30 dias na SPEC-Fundacao-03 — pendente de aprovação do PI.~~ **Resolvida (2026-07-21, PI): 30 dias** (registrada no ADR-001 §Questões abertas 2; aplicada na SPEC-Fundacao-03).
3. **Conflitos de sync multi-dispositivo**: last-write-wins vs. merge por entidade. Bloqueia: sync bidirecional (Corte 3+).

## Decisões da pipeline de desenvolvimento (PI, 2026-08-28)

1. A pipeline foi dividida em **MVP-006 Conectores Essenciais**, **MVP-008 Planejamento Governado** e **MVP-009 Entrega Autônoma**. O MVP-007 Memória/RAG não bloqueia os dois últimos.
2. Cada MVP executável novo possui seis fatias; as SPECs permanecem em revisão documental até aprovação explícita para construção.
3. O MVP-006 é dono do framework de conectores, GitHub Adapter e ResearchAdapter. Conectores antigos voltam ao backlog sem numeração.
4. GitHub usa **GitHub App + OAuth Device Flow**, com user/refresh tokens no Vault; não usa `gh` como dependência de runtime nem private key no desktop.
5. ResearchAdapter V1 usa **Tavily Search + Extract**. `/research` fica adiado. Context7 é obrigatório para documentação técnica suportada.
6. MVP-008 cria diretório, SQLite e Git local; respostas autosalvam sem commit, e marcos documentais recebem commit automático. Remote/push/issues pertencem ao MVP-009.
7. O PI anexa obrigatoriamente `DESIGN-SYSTEM.md`, protótipos HTML e assets depois do PRD. A IA analisa e propõe ajustes; não substitui o anexo.
8. O PI aprova uma vez o pacote estrutural por revisão e aprova cada MVP/fatia antes da construção. A mesma revisão não pede aceite novamente; merge técnico é automático.
9. MVP-009 usa worktree isolado, WIP=1 e no máximo três tentativas totais. Reinício reconcilia antes de repetir efeito.
10. Documentação/ADR auxiliar não bloqueia código depois do gate. A pipeline não inventa LGPD, consentimento, aceite duplo, classificação de domínio ou requisito não fornecido pelo PI.
11. Por solicitação explícita do PI, os épicos e as 18 fatias dos MVPs 006/008/009 foram pré-criados no GitHub em ordem. Fatias com SPEC em revisão usam `proplan:planejado`, ficam fora da fila e não autorizam implementação; ao aprovar, a mesma issue migra para `proplan:backlog`.

## Decisões da Pipeline V3 (PI, 2026-08-29)

1. A V3 sucede o merge técnico da V2 e cobre release, operação e aprendizado nos MVPs 014–018.
2. O MVP-014 usa Docker Compose local, GHCR, Vercel para frontend e Railway para backend/PostgreSQL separado.
3. Cada PR/fatia recebe Preview full-stack isolado; Staging é persistente; Produção é automática após merge e gates, sem segundo aceite.
4. O núcleo determinístico trabalha com estados, diário idempotente, leases e compensações; provedores ficam atrás de adapters híbridos e CLI-first.
5. Migrations são forward-only/expand-contract. Backup precede Produção e restore nunca é automático.
6. Segredos permanecem nos provedores; a pipeline persiste somente referências e fingerprints.
7. Uma release ativa por projeto/ambiente; merges anteriores a Staging podem ser consolidados, preservando SHAs `superseded`.
8. Staging e Produção recebem o mesmo digest OCI do GHCR e o mesmo deployment imutável da Vercel.
9. Estabilização padrão é cinco minutos. Somente depois nascem tag, GitHub Release e changelog.
10. Falha de código retorna à V2 em nova branch/PR ligada à mesma SPEC, sem alteração direta de Produção e sem novo aceite quando o escopo não muda.
11. Fechamento de issue é administrativo; não bloqueia deploy nem constitui aceite de produto adicional.
12. O MVP-015 é local-first, sem SaaS novo: outbox transacional, projeções reconstruíveis e reconciliação estruturada alimentam UI/CLI pelo mesmo serviço.
13. Observabilidade emite sinais/alertas, mas não cria gates nem executa retry de run, deploy, rollback ou compensação. Falha do observador não bloqueia a pipeline.
14. Alertas usam fingerprint e ciclo `open → acknowledged → resolved`; central interna é canônica e Windows notifica somente novo `critical` em segundo plano.
15. Custos/quotas projetam o ledger existente e declaram qualidade da origem; scraping/OCR de tela e valor inventado são proibidos.
16. Marcos duráveis permanecem; amostras frequentes compactam após 30 dias em rollups diários permanentes.
17. O console aprovado é por projeto e read-mostly. Visão cruzada/portfólio pertence ao MVP-018.
18. O MVP-015 foi decomposto em seis fatias e suas seis SPECs receberam aceite exato do PI. Épico #155 e fatias #156–#161 publicados em backlog; a F05 mantém gate visual.
19. O MVP-016 aprende entre runs e não substitui o MVP-007 nem reimplementa seleção, recuperação, revisão ou orçamento dos MVPs 008/009.
20. Aprendizado usa camada específica por projeto e global local; a específica vence e conteúdo/regra de negócio não sobe ao global.
21. Cada run congela `PolicySnapshot`. Promoção segue replay, shadow e canário; qualidade é guardrail anterior à eficiência.
22. Baixo/médio impacto autorizado pode promover automaticamente com kill-switch e rollback. Escopo, SPEC, gates, tentativas máximas, limite financeiro, provider, merge, deploy e regra de produto exigem PI.
23. Falha usa fingerprint determinístico; similaridade semântica somente sugere associação. Claude/Codex propõem e explicam, mas não promovem por opinião.
24. Graphify, Caveman e equivalentes são estratégias opcionais com fallback determinístico. Whole-repo continua exigindo exceção do MVP-008.
25. `ApplicabilityKey` torna lição incompatível `stale`; indisponibilidade usa política estável/base e não bloqueia a pipeline.
26. O MVP-016 foi decomposto em seis fatias aprovadas. M16-F01–F04 receberam `aprovada-pi`; F05–F06 aguardam redação. Épico #162 publicado; #163–#166 em backlog e #167–#168 planejadas. A F06 mantém gate visual. MVP-017–MVP-018 mantêm somente direção aprovada.
27. Por solicitação do PI, foram publicados os MVPs 014–016 na ordem: épicos #149/#155/#162 e 17 fatias. Na publicação, doze fatias com SPEC aprovada receberam `proplan:backlog`; cinco ainda sem SPEC receberam `proplan:planejado`. Parents, dependências e ordem nativos foram reconciliados; nenhuma nova issue recebeu `proplan:next`.
28. M16-F02: etapa e natureza separadas; fingerprint identifica padrão, não causa raiz; resolução exige prova da validação/operação após a ação por ocorrência/contexto. Recall é consultivo dentro da parcela do ContextPack; sugestão semântica real pertence à F05. Revisão exata do commit `eed7a5d` aprovada em 2026-08-29; #164 passa a backlog sem alterar dependências ou iniciar construção.
29. M16-F03: pacote completo por mecanismo; registro separado da promoção F04; composição compatível com fallback do grupo afetado; snapshot autossuficiente persistido com o run e preservado nas retomadas, sem congelar controles operacionais. Revisão exata do commit `2ea2f1f` aprovada em 2026-08-29; #165 passa a backlog sem alterar dependências ou iniciar construção.
30. M16-F04: PI confirmou contrato prévio imutável, limites de replay/shadow/canário, controle contemporâneo e alocação reproduzível, perfis iniciais baixo/médio, avaliador determinístico e estabilização/rollback. Ativa não equivale a estável; tempo e amostra são cumulativos, snapshot permanece imutável e inconclusão não bloqueia desenvolvimento. Os números versionados estão em `docs/spec/spec-aprendizado-04-experimentos-promocao.md`. Revisão exata do commit `1cefc2c` aprovada em 2026-08-30; #166 passa a backlog sem alterar dependências ou iniciar construção.

## Memória compartilhada JarvisOS / AgentsOS (PI, 2026-08-30)

1. O MVP-007 entra em detalhamento como núcleo compartilhado de memória contextual e conhecimento dos dois produtos, incluindo seu próprio desenvolvimento. Direção aprovada não equivale a design completo, fatias ou SPECs aprovadas para construção.
2. Histórico mantém fatos nos módulos de origem; conhecimento usa grafo derivado/reconstruível; aprendizado distingue inferência de resultado validado. Graphify é componente opcional e substituível, não a única memória nem autoridade de validação.
3. Visão global conserva origem por produto/projeto/agente e não aplica automaticamente regras de um projeto a outro. Menus previstos são consumidores do núcleo, não memórias independentes.
4. M16-F05 mantém escopo focado e integração reutilizável; MVP-016 mantém validação operacional já aprovada e não depende obrigatoriamente do MVP-007. A validação de lições dos demais módulos ainda será especificada; catálogo inicial de captura fechado na decisão 6.
5. A direção fica em `docs/superpowers/specs/2026-08-30-mvp-007-memoria-compartilhada-design.md`. Não altera fila, aprovações de F01–F04, contagem de SPECs ou gates existentes. Não autoriza implementação, instalação, gasto, push ou deploy.
6. PI aprovou captura automática por eventos em quatro grupos: projetos, agentes, operações e conhecimento explícito. Atualização incremental/assíncrona respeita orçamento existente, sem chamada de modelo obrigatória por evento; originais permanecem nos donos. Fonte não integrada é lacuna de cobertura, nunca "nenhuma atividade". Captura apenas manual e coleta indiscriminada de cliques/saídas de terminal não são o padrão. Identidade, deduplicação e correções foram fechadas na decisão 7.
7. PI aprovou identidade pela origem e identificador estável, deduplicação de reentrega sem fundir execuções diferentes, proveniência entre fontes e correções por revisão. Ordem de chegada não prova substituição; contradições permanecem explícitas e inferência de agente não substitui decisão do PI. Fonte removida/desatualizada invalida conhecimento dependente como atual. Detalhamento na seção 7 do design; retenção fechada na decisão 8, mecanismos de exclusão física e formatos técnicos ainda abertos.
8. PI aprovou armazenamento local existente, memória durável durante a vida do projeto (salvo exclusão explícita) e compactação de detalhes repetitivos das projeções após 30 dias. Preservar marcos, contagens, referências e evidências necessárias; não mudar retenção dos donos. Grafo/cache são reconstruíveis com fontes disponíveis e sem reativar conhecimento invalidado; reconstrução não é backup. Falha do grafo usa fontes/mecanismos básicos sem bloquear pipeline. Sincronização fica para recorte próprio. Contrato na seção 8 do design; nenhum dado é apagado nesta etapa documental.
9. PI aprovou recuperação seletiva/progressiva: tarefa/projeto primeiro, consulta global/cruzada justificada e permitida; busca textual+grafo sem embeddings obrigatórios; relevância, validade, contradições e material histórico explícitos. Retorno de trechos com fonte/revisão, validade e lacunas. Expansão somente para lacuna concreta, limitada por consultas/tempo/tokens, sem nova informação ou orçamento encerra. Referências enviadas contam no orçamento do solicitante; memória fornece candidatos ao `ContextPack`, não orçamento extra nem autoridade. Contrato na seção 9 do design.
