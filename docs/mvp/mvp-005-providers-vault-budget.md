# MVP-005 — Providers de IA + Vault + BudgetPolicy (Corte 3, parte 1)

- Tipo: épico (`proplan:mvp`). Container de fatias — **sem spec própria**.
- Status: **finalizado e aceito pelo PI** (2026-08-31). Épico [#76](https://github.com/RodReis/rrb-jarvisOS/issues/76) fechado com quatro fatias entregues.
- Base: `docs/iniciais/requisitos-agent-os.md` § Corte 3 ("Integrações reais"), RF-010 (conectores/credenciais), RF-011 (providers de IA), § "Ações Possíveis" (conectar provider = médio; alterar credenciais = alto); ADR-001 (local-first; **questão 1 resolvida: BudgetPolicy = estimativa + alerta com bloqueio no ponto único de chamada do adapter**); decisão de cifra do PI 2026-07-21 (DPAPI local / E2EE AES-256 na nuvem); ADR-004 (auditoria); ADR-005 (logging).
- Depende de: **MVP-002 entregue** (Policy Engine, `AuditEvent`, allowlist). Satisfaz a ordem da ARCHITECTURE: "`AuditEvent` antes de providers reais" e "BudgetPolicy antes de qualquer chamada paga". **Independe do MVP-004** (execução real de FS/terminal): providers são um caminho de execução distinto (rede/adapter), gateado por Policy Engine + BudgetPolicy, não pelo FS/terminal. Pode ser **especificado em spec-ahead** agora (mesmo padrão do MVP-003).
- Dono do aceite: PI. Só fecha quando todas as fatias-filhas fecharem.

## Tese

Ligar a **IA real com custo sob controle**. Até aqui o sistema classifica, audita e (no MVP-004) executa FS/terminal — mas **não chama nenhum modelo**. Este MVP entrega a espinha das integrações de IA: um **cofre de credenciais** cifrado, um **framework de adapters isolados** com **ponto único de chamada**, a **BudgetPolicy** que estima/alerta/bloqueia nesse ponto, e o **roteamento multi-provider** por tarefa. É a fundação sobre a qual conectores externos (MVP-006) e memória/RAG (MVP-007) vão consumir modelos.

Fronteira dura (herdada da ARCHITECTURE § Fronteiras e RNF): **credencial vive em vault/env, nunca em UI ou log**; segredo ausente aparece como `missing` sem revelar valor; **toda chamada externa passa por adapter**; custo e latência são medidos. O renderer nunca lê segredo nem chama provider — só vê status e dispara via IPC tipado.

## Checklist de fatias entregues

As quatro fatias foram entregues e aceitas pelo PI:

- [x] **Fatia 01 — Vault de credenciais (`CredentialRef`):** [#77](https://github.com/RodReis/rrb-jarvisOS/issues/77), `spec-providers-01-vault-credenciais.md`.
- [x] **Fatia 02 — Framework de adapters + primeiro provider real:** [#78](https://github.com/RodReis/rrb-jarvisOS/issues/78), `spec-providers-02-adapter-claude-api.md`.
- [x] **Fatia 03 — BudgetPolicy (enforcement no ponto único):** [#79](https://github.com/RodReis/rrb-jarvisOS/issues/79), `spec-providers-03-budget-policy.md`.
- [x] **Fatia 04 — Multi-provider + roteamento (`ProviderRoute`):** [#80](https://github.com/RodReis/rrb-jarvisOS/issues/80), `spec-providers-04-multi-provider-roteamento.md`.

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
