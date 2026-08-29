# SPEC-Providers-01 — Vault de credenciais (`CredentialRef`)

- MVP: `docs/mvp/mvp-005-providers-vault-budget.md` (Fatia 01) — base de todo o MVP-005.
- Status: **aprovada-pi** (2026-07-24) — modelo de entrada, ator do enforcement e escopo resolvidos pelo PI nesta data.
- Dependências: MVP-001 entregue (a primitiva de cifra `safeStorage`/DPAPI e a disciplina main-only já existem na SPEC-Fundacao-03; `AuditEvent`/hash-chain da SPEC-Fundacao-04; logging da SPEC-Fundacao-06). MVP-002 entregue (Policy Engine classifica a ação de editar credencial). **Independe do MVP-004** (ver Fatia sobre enforcement da edição).
- Decisões que sustentam esta spec: requisitos RF-010 ("credenciais ficam fora da UI e devem ser lidas de ambiente, vault ou provedor seguro"; "a UI deve informar quais variáveis estão ausentes sem exibir segredos"), § "Ações Possíveis" ("alterar credenciais/tokens/.env/vault/secrets" = alto risco), modelo `CredentialRef` ("referência segura a segredo"); ARCHITECTURE § Fronteiras 4-5 ("credencial vive em vault/env, nunca em UI ou log"; "segredos ausentes aparecem como `missing`, sem revelar valor"); decisão de cifra do PI 2026-07-21 (DPAPI local); CONVENTION §2 (`sensitivity: credential|secret`) e §3 (redaction obrigatória); ADR-004 (auditoria); ADR-005 (logging).

## Objetivo

Estabelecer o **cofre de credenciais** da Plataforma: um registro tipado `CredentialRef` sobre a primitiva de cifra já usada no auth (`safeStorage`/DPAPI, só no main), que **guarda segredos cifrados**, os **entrega por referência** (nunca o valor cru para a UI ou o log), reporta **ausência como `missing`** sem revelar valor, e **audita toda mudança**. É a base sobre a qual os adapters (F02), a BudgetPolicy (F03) e os conectores (MVP-006) leem credencial — nenhum deles chama nada sem passar por aqui.

Fronteira dura (ARCHITECTURE § Fronteiras): o **renderer nunca vê o segredo** — só metadados (nome, provider, status `present`/`missing`, escopo) via IPC tipado. O valor cru só existe no main, no momento da chamada do adapter, e nunca é logado (redaction, CONVENTION §3).

## Escopo

### Dentro

- **Entidade `CredentialRef`** (contrato tipado em `src/shared/domain/`), persistida no SQLite, **escopada por `user_id` + `workspace_id`** (`noa`|`jarvis`), `sensitivity: credential`. Campos mínimos: `id`, `user_id`, `workspace_id`, `provider`/`key` (identificador lógico, ex.: `openai`, `anthropic`, `gemini`), `source` (`env`|`vault`), `status` (`present`|`missing`), `created_at`/`updated_at`. **O valor do segredo nunca é campo da entidade** — vive cifrado no cofre, referenciado pelo `id`/`key`.
- **Isolamento por workspace:** NOA e JARVIS OS têm credenciais **próprias** (invariante do LANDSCAPE "alternar sem misturar credenciais"). A mesma `key` lógica (`openai`) pode ter valores distintos por workspace.
- **Duas fontes (modelo env + vault, decisão do PI 2026-07-24):**
  - **`env`** — vars de ambiente (`.env`) como **fonte de bootstrap/fallback**, read-only (como o app já lê a config do Supabase). Uma credencial presente no env aparece como `source: env`, `status: present`, sem nunca expor o valor.
  - **`vault`** — cofre cifrado gerido pela UI de Settings (BYOK): o usuário **adiciona/edita/remove** chaves; o valor é cifrado com `safeStorage`/DPAPI no main e nunca volta em claro para a UI.
  - **Precedência:** o vault (explícito do usuário) tem precedência sobre o env (bootstrap) quando ambos existem para a mesma `key`+escopo. (Cravado pelo Cowork; PI pode vetar.)
- **Cifra:** valor gravado em disco via `safeStorage`/DPAPI (chave do usuário do SO) — **nunca em claro**, nunca no renderer, nunca em `localStorage`. Mesma primitiva da SPEC-Fundacao-03; **os tokens de sessão do auth continuam no seu próprio armazenamento** (ciclo de vida diferente, gerido pelo Supabase) — o Vault não os absorve.
- **Leitura por referência:** um consumidor no main (adapter, F02) pede o segredo por `key`+escopo **no momento da chamada**; o cofre decifra e entrega em memória, no main. O renderer **nunca** recebe o valor.
- **`missing` sem revelar valor:** credencial ausente → `status: missing`; a UI informa **quais** credenciais faltam (por nome/provider) **sem exibir segredo** (RF-010). Nenhum caminho vaza a existência do valor.
- **Enforcement da edição — distinguir o ator (decisão do PI 2026-07-24):**
  - **Usuário** editando/adicionando/removendo a própria credencial no Settings → **auditado, sem aprovação** (ele é o dono). Gera `AuditEvent` encadeado (criação/alteração/remoção), com `key`+escopo, **nunca o valor**.
  - **Agente/runtime** querendo alterar credencial → **alto risco** (requisitos § Alto), classificado pelo Policy Engine → `requires-approval`. O **gate liga quando o fluxo de aprovação do MVP-004 existir**; até lá, **report-only** (classifica + audita, não barra) — o mesmo padrão "report → gate" do Policy Engine e da allowlist. **Isso mantém o MVP-005 independente do MVP-004.**
- **Auditoria (ADR-004):** toda mudança de credencial gera `AuditEvent` encadeado; `verifyChain` passa. O payload traz `key`, `provider`, escopo, ator e ação — **jamais o segredo**.
- **Logging (ADR-005):** operações do vault logam na categoria `integracao`/`sistema` com **redaction comprovada** — `sensitivity: credential` nunca é gravado (CONVENTION §3).
- **Fronteira de processo:** o cofre roda no **main**; o renderer gerencia (adiciona/edita/remove/lista status) **via IPC tipado**, recebendo só metadados, nunca o valor.

### Fora

- **Adapters de provider e chamada real** — Fatia 02 (o vault só guarda e entrega; quem chama é o adapter).
- **BudgetPolicy / CostEvent** — Fatia 03.
- **Rotação/expiração automática de segredo** — **fora**: adicionar/editar/remover basta nesta fatia; rotação é futuro. **Emenda 2026-08-29 (PI):** o "futuro" tem dono — o suporte a **payload cifrado estruturado** (access token + refresh token + `expires_at`), a `expires_at` como **metadado consultável sem decifrar** e à **rotação atômica** é escopo da **M6-F03** (`spec-conectores-03-github-app-autenticacao.md`), exigido pelo OAuth Device Flow do GitHub. A M5-F01 (#77) **não é reaberta**. **Cumprida em 2026-08-29** pela M6-F03 ([#89](https://github.com/RodReis/rrb-jarvisOS/issues/89)): `credential_ref.expires_at` (migration 13) e `upsertPayload`/`readPayload`/`expiresAt` no `CredentialRepository`. A rotação é atômica porque é **uma** escrita — `INSERT … ON CONFLICT DO UPDATE` sobre o `UNIQUE` existente —, e o `expires_at` fica **fora da cifra** de propósito: prazo não é segredo, e responder "vence quando?" pelo DPAPI faria toda consulta de estado destravar o cofre para ler um relógio.
- **Sync do cofre ao cloud (E2EE AES-256)** — diferido (ADR-001 q3; sync bidirecional só depois da decisão de conflito). O vault é **local** nesta fatia.
- **Credenciais OAuth de conectores externos** (Google Workspace etc.) — o mecanismo do `CredentialRef` serve a eles, mas os conectores em si são MVP-006.
- **Fluxo de aprovação humana** (a UI de aprovar) — MVP-004; aqui a edição por agente é só classificada/auditada.

## Critérios de aceite

1. `CredentialRef` persistido no SQLite, escopado por `user_id` + `workspace_id`, `sensitivity: credential`; o **valor do segredo nunca é campo da entidade**. Teste: a mesma `key` (`openai`) tem valores distintos em `noa` e `jarvis` sem se misturar.
2. **Valor cifrado em disco** (`safeStorage`/DPAPI); verificável: o armazenamento não contém o segredo em claro. O renderer nunca recebe o valor — só metadados via IPC tipado (teste).
3. **Duas fontes:** credencial no `.env` aparece `source: env, status: present`; credencial adicionada pela UI aparece `source: vault`; quando ambas existem para a mesma `key`+escopo, **o vault tem precedência**. Teste dos três casos.
4. **`missing` sem revelar valor:** credencial ausente → `status: missing`; a UI lista o que falta por nome/provider sem exibir segredo (RF-010). Teste.
5. **Ator distinguido:** usuário editando no Settings → auditado, **sem aprovação**; agente/runtime alterando credencial → classificado **alto/`requires-approval`** e auditado, **report-only** (não barra — gate é MVP-004). Teste dos dois caminhos.
6. **Auditoria:** criar/editar/remover credencial gera `AuditEvent` encadeado com `key`/escopo/ator/ação e **nunca o valor**; `verifyChain` passa. Teste.
7. **Redaction no log:** operações do vault não gravam o segredo em log (`sensitivity: credential`), comprovado por teste (CONVENTION §3).
8. Renderer gerencia via IPC tipado; o cofre roda no main; renderer sem Node/FS/segredo.
9. `npm run dev`, `npm run test` e `npm run lint` passam; evidência no `reports/TESTS.md` (Regras + Banco + Tela).

## Perguntas resolvidas pelo PI (2026-07-24)

1. **Modelo de entrada:** **env + vault gerenciado** — vars de ambiente como bootstrap/fallback read-only + vault cifrado editável pela UI de Settings (BYOK). — decidido.
2. **Enforcement da edição:** **distinguir o ator** — usuário no Settings = auditado sem aprovação; agente/runtime = alto risco, `requires-approval`, com **gate ligado só quando o fluxo do MVP-004 existir** (report-only até lá). MVP-005 segue **independente do MVP-004**. — decidido.
3. **Escopo do `CredentialRef`:** **por `user_id` + `workspace_id`** (NOA e JARVIS com credenciais próprias; respeita "alternar sem misturar credenciais"). — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **Mesma primitiva de cifra** da SPEC-Fundacao-03 (`safeStorage`/DPAPI, main-only); `CredentialRef` é registro tipado **distinto** sobre ela; **tokens de sessão do auth ficam no seu próprio armazenamento** (ciclo de vida do Supabase).
- **Precedência vault > env** para a mesma `key`+escopo (o explícito do usuário vence o bootstrap).
- **Sem rotação/expiração de segredo** na F01 (adicionar/editar/remover basta; rotação é futuro).
- **Report-only na edição por agente** até o fluxo de aprovação do MVP-004 existir — mantém a independência entre os MVPs e segue o padrão "report → gate" já usado no projeto.
