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

## Decisões da revisão de furos do MVP-009 (PI, 2026-08-30)

1. **Executor autentica por proxy no host.** O container do executor não recebe credencial nem sessão; `ANTHROPIC_BASE_URL` aponta para o main, que injeta a rota (assinatura ou API paga) e registra uso no ponto único do MVP-005. Alternativas descartadas: volume dedicado com `CLAUDE_CONFIG_DIR` (segredo dentro do sandbox) e executor no host (reverte a decisão do sandbox).
2. **A pipeline gera o CI do projeto-alvo** no primeiro PR, a partir dos comandos de validação do pacote. Sem check configurado ou sem conclusão aceita pela origem no `head SHA`, não há merge — nunca verde por ausência.
3. **WIP=1 é slot global** no MVP-009. Concorrência entre projetos é o MVP-012.
4. **A branch `codex/pipeline-v2-design`** (33 commits: SPECs do MVP-7 e MVPs 10–16, emendas a SPECs aprovadas e à CONVENTION) foi enviada ao remoto e entra na `main` por PR de docs. As emendas dela que mudam significado de decisão já registrada — em especial redefinir `proplan:finalizado` como "encerramento administrativo" em vez de aceite do PI — **não valem até o PI decidir no PR**; até lá, o CLAUDE.md e a CONVENTION da `main` continuam a regra.
5. **(Proposta do Cowork, não decidida pelo PI — PI pode vetar no PR.)** SPEC só é fonte para o Code quando está na `main`. Revisão "aprovada" em branch local não pushada não é aprovada para efeito de fila — issue que cita spec inexistente no remoto é issue sem spec.

## Decisões sobre a Pipeline V2/V3 e o PR #189 (PI, 2026-08-30)

O PR [#189](https://github.com/RodReis/rrb-jarvisOS/pull/189) traz da branch `codex/pipeline-v2-design` as SPECs dos MVPs 010–016 (e do MVP-007) **junto de emendas a specs já entregues**. As emendas foram decididas item a item:

1. **`proplan:finalizado` continua sendo o aceite do PI — rejeitada a redefinição.** A branch propunha `finalizado` = "encerramento administrativo, não gate técnico" e `done` = "sem bloqueio de deploy". Todo o processo está construído sobre o oposto: só o PI fecha, `closes #N` é proibido, merge técnico não cria aceite (CLAUDE.md § Ciclo de vida; invariante 7 da CONVENTION §4). Mudar isso por emenda de branch paralela desmontaria a garantia sem ADR. O trecho **não entra**; se a separação entre "código integrado" e "produto aceito" voltar, volta como ADR, com CLAUDE.md e CONVENTION alterados no mesmo ato.
2. **`EffectJournal` é escopo da M9-F02, não emenda a spec finalizada.** A branch o acrescentava à `spec-conectores-01` (M6-F01, **finalizada**) e à `spec-conectores-02` (M6-F02, **finalizada**), cujo código não o tem. Emendar spec entregue não faz o código existir — cria spec que mente sobre o entregue. O contrato foi escrito na `spec-entrega-02`, que é quem o consome; o núcleo de conectores o adota quando houver fatia que o implemente lá.
3. **Aceitos os três acréscimos às SPECs do MVP-009** (fatias ainda não construídas, onde emenda é legítima): `subscription_limited` na F04 (quota desconhecida ≠ saldo infinito), snapshot de ruleset e merge queue na F05, cancelamento por fase e retenção 30 dias/5 GB na F06.
4. **As 17 "Decisões da Pipeline V3" e as seções CONVENTION §4.1/§4.2 são do PI**, confirmadas nesta data — entram como estão quando o #189 for reconciliado.

**Regra que estas decisões consolidam:** emenda que exige código novo **não** vai para a spec de fatia finalizada; vai para a fatia que a constrói, ou vira `[FIX]`/fatia própria. Pelo mesmo critério ficaram **fora** as reescritas retroativas de `spec-planejamento-01` (endurecimento do Git no host), `spec-planejamento-06` (manifesto canônico) e `spec-providers-03/04` (`unmetered` → `subscription_limited`): descrevem um sistema que as fatias entregues não construíram. O que elas pedem está registrado como pré-requisito na fatia que precisar — a dependência da rota de assinatura está declarada na `spec-entrega-04`.
