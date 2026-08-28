# MVP-005 — Providers de IA + Vault + BudgetPolicy (Corte 3, parte 1)

- Tipo: épico (`proplan:mvp`). Container de fatias — **sem spec própria**.
- Status: **definido** (2026-07-24) — 1ª parte do **Corte 3 (Integrações reais)**, que o PI decidiu **partir em três MVPs** (2026-07-24): **MVP-005 Providers+Vault+Budget → MVP-006 Conectores externos → MVP-007 Memória híbrida+RAG**. Mesma lógica do split do Corte 2 (evitar concentrar risco num épico gigante).
- Base: `docs/iniciais/requisitos-agent-os.md` § Corte 3 ("Integrações reais"), RF-010 (conectores/credenciais), RF-011 (providers de IA), § "Ações Possíveis" (conectar provider = médio; alterar credenciais = alto); ADR-001 (local-first; **questão 1 resolvida: BudgetPolicy = estimativa + alerta com bloqueio no ponto único de chamada do adapter**); decisão de cifra do PI 2026-07-21 (DPAPI local / E2EE AES-256 na nuvem); ADR-004 (auditoria); ADR-005 (logging).
- Depende de: **MVP-002 entregue** (Policy Engine, `AuditEvent`, allowlist). Satisfaz a ordem da ARCHITECTURE: "`AuditEvent` antes de providers reais" e "BudgetPolicy antes de qualquer chamada paga". **Independe do MVP-004** (execução real de FS/terminal): providers são um caminho de execução distinto (rede/adapter), gateado por Policy Engine + BudgetPolicy, não pelo FS/terminal. Pode ser **especificado em spec-ahead** agora (mesmo padrão do MVP-003).
- Dono do aceite: PI. Só fecha quando todas as fatias-filhas fecharem.

## Tese

Ligar a **IA real com custo sob controle**. Até aqui o sistema classifica, audita e (no MVP-004) executa FS/terminal — mas **não chama nenhum modelo**. Este MVP entrega a espinha das integrações de IA: um **cofre de credenciais** cifrado, um **framework de adapters isolados** com **ponto único de chamada**, a **BudgetPolicy** que estima/alerta/bloqueia nesse ponto, e o **roteamento multi-provider** por tarefa. É a fundação sobre a qual conectores externos (MVP-006) e memória/RAG (MVP-007) vão consumir modelos.

Fronteira dura (herdada da ARCHITECTURE § Fronteiras e RNF): **credencial vive em vault/env, nunca em UI ou log**; segredo ausente aparece como `missing` sem revelar valor; **toda chamada externa passa por adapter**; custo e latência são medidos. O renderer nunca lê segredo nem chama provider — só vê status e dispara via IPC tipado.

## Checklist de fatias previstas

Cada item vira issue-filha **somente** quando sua spec estiver `aprovada-pi` (lazy). Ainda sem spec — a divisão abaixo é a proposta do Cowork, refinável quando cada spec for escrita:

- [ ] **Fatia 01 — Vault de credenciais (`CredentialRef`):** armazenamento cifrado local (DPAPI/`safeStorage`, decisão de cifra do PI 2026-07-21), leitura **por referência** (nunca o valor cru na UI/log), segredo ausente = `missing` sem revelar valor, **fonte env + vault** (BYOK), **escopo por usuário+workspace**, edição pelo **usuário** = auditada sem aprovação e por **agente** = alto risco report-only (gate no MVP-004). Base de tudo: nenhum adapter chama sem credencial. **Spec `aprovada-pi`:** `spec-providers-01-vault-credenciais.md`.
- [ ] **Fatia 02 — Framework de adapters + primeiro provider real:** interface de adapter **isolada** (ARCHITECTURE: "novos providers por adaptadores isolados"), **ponto único de chamada**, `AuditEvent` antes/depois, **medição de custo/latência** (`CostEvent`, **report-only** nesta fatia). Provider: **Claude API** (Anthropic Messages), **em streaming** (chunks ao renderer; custo no fim via `usage`) — decisões do PI 2026-07-24. **Spec `aprovada-pi`:** `spec-providers-02-adapter-claude-api.md`.
- [ ] **Fatia 03 — BudgetPolicy (enforcement no ponto único):** estimativa + alerta (limiar default 80%) + **bloqueio ao bater o limite** no ponto único da F02 (ADR-001 q1: adapter recusa novas chamadas; **sem proxy**); limites separados dia/mês, escopo **usuário+workspace** (squad/agente no Corte 4), padrão USD 1 cada, ajustáveis; estouro no stream **deixa terminar e barra a próxima**; ao exceder = override por aprovação com **piso de bloqueio duro** até o MVP-004; **BYOK = melhor esforço** (bloqueio por estimativa). Decisões do PI 2026-07-24. **Spec `aprovada-pi`:** `spec-providers-03-budget-policy.md`.
- [ ] **Fatia 04 — Multi-provider + roteamento (`ProviderRoute`):** Gemini + Ollama (adapters HTTP) + **Claude Code CLI** (subprocess app-managed, governado pelo framework de adapters — não pela allowlist do MVP-004), **roteamento por tarefa completo** (`taskType` semeado → preferência ordenada, com local/offline), fallback + healthcheck, tela de providers (status/latência/modelo/origem/troca + editor de rotas). Todos pelo ponto único da F02 (herdam o gate da F03). Decisões do PI 2026-07-24. **Spec `aprovada-pi`:** `spec-providers-04-multi-provider-roteamento.md`.

## Ordem e dependências

MVP-002 entregue → **01 (vault)** → **02 (adapter + 1º provider, custo report-only)** → **03 (BudgetPolicy, gate no ponto único)** → **04 (multi-provider + roteamento)**. O vault vem primeiro porque nenhum adapter chama sem credencial; o BudgetPolicy vem depois do ponto único existir para poder gatear nele.

## Fora deste MVP (→ MVP-006 / MVP-007 / Corte 4)

- **Conectores externos não-IA** (Google Workspace, ElevenLabs como TTS, Supabase sync, Obsidian MCP) — **MVP-006**. (ElevenLabs entra como conector de voz; o motor de voz é Corte 4.)
- **Memória híbrida + RAG** (ingestão, índices textual/vetorial/grafo, recuperação rastreável) — **MVP-007**.
- **Sync bidirecional local↔Supabase** — **diferido**: a estratégia de conflito multi-dispositivo é questão aberta do ADR-001 (q3, não resolvida); a ARCHITECTURE proíbe implementar sync antes de decidir. O MVP-007 especifica a memória **local** primeiro.
- **Voz real (STT/TTS)** — Corte 4.
- **Scheduler/cron, squads com aprovação, Power Guard** — Corte 4.
- **OAuth completo de todos os conectores** — fora do escopo inicial (requisitos § Fora do Escopo).

## Critérios de done do MVP

- Credencial vive cifrada no vault (DPAPI local); nunca aparece em UI ou log; ausente = `missing` sem revelar valor. Editar credencial é auditado (alto risco).
- Ao menos um provider real chama de verdade via adapter isolado, com `AuditEvent` antes/depois e `CostEvent` medido; o renderer não lê segredo nem chama provider (só via IPC tipado).
- BudgetPolicy **bloqueia** no ponto único ao bater o limite dia/mês; tentativa de gasto acima do orçamento é barrada e auditada (ADR-001 q1).
- Roteamento por tarefa seleciona provider com preferência local/offline quando viável; a tela de providers mostra status/latência/modelo sem expor segredo.
- `npm run dev`, `npm run test`, `npm run lint` passam; evidência no `reports/TESTS.md`.
