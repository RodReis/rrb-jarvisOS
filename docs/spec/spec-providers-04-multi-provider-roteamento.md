# SPEC-Providers-04 — Multi-provider + roteamento por tarefa (`ProviderRoute`)

- MVP: `docs/mvp/mvp-005-providers-vault-budget.md` (Fatia 04) — **fecha o MVP-005**.
- Status: **aprovada-pi** (2026-07-24) — profundidade do roteamento e inclusão do Claude Code CLI resolvidas pelo PI nesta data.
- Dependências: **Fatia 02 entregue** (framework de adapters + ponto único de chamada — os novos providers plugam nele) e **Fatia 03** (BudgetPolicy — o gate vale para qualquer provider no ponto único). **Fatia 01** (Vault — Gemini e outros cloud leem credencial). MVP-002 (Policy Engine, `AuditEvent`). **Independe do MVP-004** (ver nota de reconciliação sobre o CLI).
- Decisões que sustentam esta spec: requisitos RF-011 (providers de IA: Ollama/local; tela com status `online/loading/offline`, modelo ativo, latência, origem local/cloud, troca de modelo; **lógica de roteamento por tarefa, preferência local/offline**), "Claude deve suportar Claude API **e Claude Code CLI**", modelo `ProviderRoute` ("regra de roteamento por tipo de tarefa"); ARCHITECTURE § Provider Adapters e § Resiliência (healthcheck por serviço; roteamento com preferência local/offline); ADR-004 (auditoria); ADR-005 (logging).

## Objetivo

Completar o MVP-005: **plugar os demais providers** no framework da F02 — Google Gemini e Ollama (adapters HTTP) e Claude Code CLI (subprocess app-managed) — e ligar o **roteamento por tarefa** (`ProviderRoute`). **Todos** passam pelo **mesmo ponto único de chamada** (F02), herdando classificação de política, `CostEvent`, `AuditEvent` e o **gate da BudgetPolicy** (F03) — **nada burla o ponto único**. Entrega a **tela de providers** (RF-011).

## Escopo

### Dentro

- **Novos adapters, mesma interface da F02 (isolados):**
  - **Google Gemini** — adapter **HTTP**; credencial do Vault (F01), origem `cloud`.
  - **Ollama** — adapter **HTTP** para o servidor local (`localhost`), origem `local`, **sem credencial e sem custo** (grátis), latência medida.
  - **Claude Code CLI** — adapter **subprocess app-managed**: invoca o binário `claude` **pinado**, **sem shell** (sem interpolação de string), args controlados, cwd controlado, **timeout + kill**.
    > **Nota de reconciliação (Cowork).** O CLI é chamado **pelo app como sua própria dependência**, não é comando arbitrário do usuário — por isso é governado pelo **framework de adapters** (ponto único + BudgetPolicy + `AuditEvent` + timeout/kill), **não** pela allowlist de comando do MVP-004 (que governa o terminal **do usuário**). Isso mantém a F04 **independente do MVP-004** sem abrir buraco: o subprocess é fixo e app-controlado, não uma superfície de comando livre. *(O PI pode vetar e exigir que o CLI passe pela allowlist do MVP-004 — o que tornaria a F04 dependente dele.)*
  - Todos passam pelo **ponto único de chamada** (F02) → herdam política, `CostEvent`, `AuditEvent` e o **gate da BudgetPolicy** (F03).
- **Roteamento por tarefa (`ProviderRoute`):** o `request` declara um **`taskType`** de **taxonomia semeada** (`chat`, `code`, `embedding`, `summarize`, `vision` — dado versionado, extensível); `ProviderRoute` mapeia `taskType` → **preferência ordenada** de provider/modelo, com **preferência por local/offline quando viável** (RF-011). Escopado por **user + workspace** (espelha F01/F03). Regras **editáveis** (dado, não hardcode).
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

1. **Todos pelo ponto único:** Gemini (HTTP), Ollama (HTTP local) e Claude Code CLI (subprocess app-managed) rodam pelo **mesmo ponto único** da F02, herdando `CostEvent`, `AuditEvent` e o **gate da BudgetPolicy**; nenhum burla o ponto único. Teste.
2. **CLI seguro:** binário **pinado**, **sem shell**, args controlados, cwd controlado, **timeout + kill**; governado pelo framework de adapters (não pela allowlist do MVP-004). Teste comprova sem-shell e timeout/kill.
3. **Roteamento por tarefa:** `request` com `taskType` seleciona o provider conforme a preferência ordenada do `ProviderRoute`, com preferência local/offline; regras escopadas user+workspace, **editáveis** (dado). Teste dos casos.
4. **Fallback:** preferido **offline** → cai para o próximo da ordem, **auditado**. Teste.
5. **Tela de providers:** status/latência/modelo/origem/troca + **editor de rotas**; só com componentes do DS; teclado/foco; renderer **nunca** vê credencial. Teste (Testing Library).
6. **Healthcheck:** status por provider; offline **não é escolhido** e gera notificação + `AuditEvent`. Teste.
7. **Auditoria:** seleção/fallback/troca geram `AuditEvent` encadeado; `verifyChain` passa; log `ai` com redaction.
8. Renderer dispara/edita via IPC tipado; adapters e roteamento no main; sem Node/segredo no renderer.
9. `npm run dev`, `npm run test` e `npm run lint` passam; evidência no `reports/TESTS.md` (Regras + Banco + Tela).

## Perguntas resolvidas pelo PI (2026-07-24)

1. **Profundidade do roteamento:** **roteamento por tarefa completo** — matriz `taskType` → preferência de provider, editável na tela de providers. — decidido (contrário à proposta de esqueleto do Cowork, aceito). Implementável agora via **taxonomia de `taskType` semeada**, com o chamador declarando o tipo no `request`.
2. **Claude Code CLI:** **incluído já na F04.** — decidido. **Reconciliação registrada pelo Cowork:** o CLI entra como **subprocess app-managed** (binário pinado, sem shell, timeout/kill), governado pelo **framework de adapters**, **não** pela allowlist de comando do MVP-004 — mantendo a F04 independente sem abrir superfície de comando livre. PI ciente; pode vetar exigindo o gate do MVP-004.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **Taxonomia de `taskType` semeada** (`chat`/`code`/`embedding`/`summarize`/`vision`), dado versionado e extensível; o chamador declara o tipo no `request`.
- **CLI = subprocess app-managed** (binário pinado, sem shell, args controlados, timeout/kill) pelo ponto único — reconciliação acima.
- **Fallback por ordem de preferência + healthcheck** (preferido offline cai para o próximo, auditado).
- **Providers HTTP (Gemini, Ollama) + subprocess (CLI)** todos pelo ponto único, herdando o gate da F03 — nenhum caminho paralelo de chamada.
