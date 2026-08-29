# SPEC-Providers-04 — Multi-provider + roteamento por tarefa (`ProviderRoute`)

- MVP: `docs/mvp/mvp-005-providers-vault-budget.md` (Fatia 04) — **fecha o MVP-005**.
- Status: **aprovada-pi** (2026-07-24) — profundidade do roteamento e inclusão do Claude Code CLI resolvidas pelo PI nesta data.
- **Emenda 2026-08-29 (PI, revisões dos MVPs 008/010):** Claude Code CLI usa rota `subscription_limited` pelo plano Claude MAX: registra uso/quota sem inventar custo USD. Esta fatia também introduz o contrato irmão `CodingExecutorAdapter`; CLI com ferramentas/filesystem não implementa a mesma interface dos providers HTTP. Codex implementará esse contrato somente no MVP-010.
- Dependências: **Fatia 02 entregue** (framework de adapters + ponto único de chamada — os novos providers plugam nele) e **Fatia 03** (BudgetPolicy — o gate vale para qualquer provider no ponto único). **Fatia 01** (Vault — Gemini e outros cloud leem credencial). MVP-002 (Policy Engine, `AuditEvent`). **Independe do MVP-004** (ver nota de reconciliação sobre o CLI).
- Decisões que sustentam esta spec: requisitos RF-011 (providers de IA: Ollama/local; tela com status `online/loading/offline`, modelo ativo, latência, origem local/cloud, troca de modelo; **lógica de roteamento por tarefa, preferência local/offline**), "Claude deve suportar Claude API **e Claude Code CLI**", modelo `ProviderRoute` ("regra de roteamento por tipo de tarefa"); ARCHITECTURE § Provider Adapters e § Resiliência (healthcheck por serviço; roteamento com preferência local/offline); ADR-004 (auditoria); ADR-005 (logging).

## Objetivo

Completar o MVP-005: plugar Google Gemini e Ollama no runtime de providers, introduzir Claude Code como primeiro `CodingExecutorAdapter` e ligar o roteamento por tarefa. Os dois runtimes compartilham política, auditoria, ledger, health e classificação de cobrança, sem forçar contratos incompatíveis numa interface única. Entrega a tela de providers/executores prevista para a fatia.

## Escopo

### Dentro

- **Novos adapters isolados:**
  - **Google Gemini** — adapter **HTTP**; credencial do Vault (F01), origem `cloud`.
  - **Ollama** — adapter **HTTP** para o servidor local (`localhost`), origem `local`, **sem credencial e sem custo** (grátis), latência medida.
  - **Claude Code CLI** — primeiro `CodingExecutorAdapter`: invoca o binário `claude` pinado, sem shell, com argumentos/schema controlados, timeout/kill e eventos normalizados. Na entrega autônoma, roda no container do MVP-009. Não passa pela allowlist do terminal do usuário.
  - Providers e executor compartilham governança, mas o gate USD só vale para rota `api`; a assinatura é `subscription_limited`.
- **Roteamento por tarefa (`ProviderRoute`):** o `request` declara um **`taskType`** de taxonomia semeada (`chat`, `code`, `embedding`, `summarize`, `vision`). Cada alvo é união discriminada `provider | executor`; o dispatcher chama o runtime correspondente, sem esconder ambos atrás da mesma interface. Preferência ordenada, local/offline quando viável, escopo user+workspace e regras editáveis permanecem.
- **Seleção e fallback:** dado o `taskType`, o ponto único escolhe o provider conforme o `ProviderRoute` **e a disponibilidade** (healthcheck) — prefere local/offline quando a rota permite; preferido **offline** → cai para o **próximo da ordem** (fallback), auditado.
- **Healthcheck por provider** (ARCHITECTURE § Resiliência): status `online/loading/offline` derivado de ping/health; provider offline **não é escolhido** pela rota e gera notificação + `AuditEvent` quando bloqueia uma rota.
- **Tela de providers (RF-011):** por provider — status `online/loading/offline`, modelo ativo, latência, origem `local`/`cloud`, botão de **troca de modelo**; mais o **editor das regras de `ProviderRoute`** (`taskType` → preferência ordenada + toggle local/offline). Só com componentes públicos do DS, operável por teclado, foco visível. Renderer vê/edita **via IPC tipado**; **nunca** vê credencial.
- **Auditoria (ADR-004):** seleção de provider por rota, **fallback** e **troca de modelo** geram `AuditEvent` encadeado; `verifyChain` passa.
- **Logging (ADR-005):** categoria `ai`, redaction (sem key, sem conteúdo sensível).
- **Fronteira de processo:** adapters e roteamento rodam no **main**; o renderer dispara/edita via IPC tipado; sem Node/segredo no renderer.

### Fora

- **Conectores não-IA** (Google Workspace, ElevenLabs) — MVP-006.
- **Memória / RAG** — MVP-007. O `taskType: embedding` existe como rota, mas o **consumidor** (indexação/recuperação) é o MVP-007.
- **Voz (STT/TTS)** — Corte 4.
- **Agentes/skills que declaram `taskType` automaticamente** — Corte 3+/4; aqui **o chamador declara** o `taskType` no `request`.
- **Escopo squad/agente do `ProviderRoute`** — Corte 4 (aqui user + workspace).
- **CLI passando pela allowlist de comando do MVP-004** — fora por reconciliação (o CLI é subprocess app-managed; ver nota). Reabrível por veto do PI.

## Critérios de aceite

1. **Runtimes separados, governança comum:** Gemini/Ollama usam `AIProviderRuntime`; Claude Code usa `CodingExecutorRuntime`; ambos herdam política, auditoria, ledger e health sem caminho paralelo sem gate. Teste.
2. **CLI seguro:** binário pinado, sem shell, argumentos/schema e cwd controlados, timeout + kill; governado pelo runtime de executores, não pela allowlist do terminal do usuário. Teste.
3. **Roteamento por tarefa:** `request` com `taskType` seleciona alvo discriminado `provider | executor` conforme a preferência ordenada e chama somente o runtime compatível; regras escopadas user+workspace e editáveis. Teste dos casos.
4. **Fallback:** preferido **offline** → cai para o próximo da ordem, **auditado**. Teste.
5. **Tela de providers:** status/latência/modelo/origem/troca + **editor de rotas**; só com componentes do DS; teclado/foco; renderer **nunca** vê credencial. Teste (Testing Library).
6. **Healthcheck:** status por provider; offline **não é escolhido** e gera notificação + `AuditEvent`. Teste.
7. **Auditoria:** seleção/fallback/troca geram `AuditEvent` encadeado; `verifyChain` passa; log `ai` com redaction.
8. Renderer dispara/edita via IPC tipado; adapters e roteamento no main; sem Node/segredo no renderer.
9. `npm run dev`, `npm run test` e `npm run lint` passam; evidência no `reports/TESTS.md` (Regras + Banco + Tela).

## Perguntas resolvidas pelo PI (2026-07-24)

1. **Profundidade do roteamento:** **roteamento por tarefa completo** — matriz `taskType` → preferência de provider, editável na tela de providers. — decidido (contrário à proposta de esqueleto do Cowork, aceito). Implementável agora via **taxonomia de `taskType` semeada**, com o chamador declarando o tipo no `request`.
2. **Claude Code CLI:** incluído já na F04 como primeiro `CodingExecutorAdapter`, subprocesso app-managed e depois containerizado pelo MVP-009. O contrato separado foi aprovado na arquitetura da Pipeline V2 para evitar tratar execução com filesystem como inferência HTTP.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **Taxonomia de `taskType` semeada** (`chat`/`code`/`embedding`/`summarize`/`vision`), dado versionado e extensível; o chamador declara o tipo no `request`.
- **CLI = `CodingExecutorAdapter` app-managed** (binário pinado, sem shell, args/schema controlados, timeout/kill) com governança compartilhada.
- **Fallback por ordem de preferência + healthcheck** (preferido offline cai para o próximo, auditado).
- **Providers HTTP e executor CLI têm runtimes irmãos**, sem duplicar Vault, auditoria, ledger, health ou política de cobrança.
