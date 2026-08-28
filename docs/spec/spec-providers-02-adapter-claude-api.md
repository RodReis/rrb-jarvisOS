# SPEC-Providers-02 — Framework de adapters + primeiro provider (Claude API, streaming)

- MVP: `docs/mvp/mvp-005-providers-vault-budget.md` (Fatia 02).
- Status: **aprovada-pi** (2026-07-24) — primeiro provider e modelo de streaming resolvidos pelo PI nesta data.
- Dependências: **Fatia 01 entregue** (Vault de credenciais — o adapter lê a `key` do provider por referência, no main). MVP-002 entregue (Policy Engine classifica "chamada externa"; `AuditEvent`; logging). MVP-001 entregue (contratos, IPC tipado). **Independe do MVP-004.**
- Decisões que sustentam esta spec: requisitos RF-011 (providers de IA; status/latência/modelo; roteamento por tarefa — o roteamento em si é a F04), § "Ações Possíveis" ("fazer chamada para API externa" = médio), modelo `CostEvent` ("evento financeiro de execução"); ARCHITECTURE § Provider Adapters ("BudgetPolicy **antes** da chamada; custo/latência medidos"), § Fronteiras ("toda integração externa passa por adapter; credencial vive em vault/env, nunca em UI ou log"), § Resiliência (timeout obrigatório); CONVENTION §3 (log categoria `ai`, entrada/saída, redaction); ADR-004 (auditoria); ADR-005 (logging).

## Objetivo

Estabelecer o **framework de adapters de IA isolados** e o **ponto único de chamada** — a função central no runtime/main por onde **toda** chamada a provider de IA passa. É aqui que a **F03 (BudgetPolicy)** vai encaixar o gate de orçamento; nesta fatia o ponto **mede e audita, não bloqueia por custo** (report-only). Prova o caminho ponta a ponta com um provider real, **Claude API** (Anthropic Messages), em **streaming**: a resposta chega em chunks ao renderer, com custo e latência medidos e auditados.

Fronteira dura (ARCHITECTURE § Fronteiras): a **credencial vive no Vault** (F01) e só é lida no main, no momento da chamada; o **renderer nunca vê a key** — dispara a chamada e recebe os chunks via IPC tipado. Nada de segredo ou prompt sensível em log (redaction, CONVENTION §3).

## Escopo

### Dentro

- **Interface de adapter tipada e isolada** (`src/shared/contracts` + implementação no main): um contrato `AiAdapter` com algo como `generateStream(request, ctx) → AsyncIterable<Chunk>`, onde o stream emite **chunks de texto** e, ao fim, entrega **`usage`** (tokens de entrada/saída) e **latência**. Isolada por provider (ARCHITECTURE: "novos providers por adaptadores isolados") — o núcleo **não conhece Anthropic diretamente**, só a interface. Novo provider = novo adapter, sem tocar o ponto de chamada.
- **Primeiro provider — Claude API** (Anthropic Messages API, streaming): o adapter lê a credencial do **Vault (F01)** por `key`+escopo, no main, no momento da chamada. Monta a requisição, consome o stream do provider e repassa os chunks.
- **Ponto único de chamada** (`callProvider`/`runInference`) no runtime/main: **toda** chamada de IA funila por ele. Nesta fatia ele:
  1. **classifica** pela política (Policy Engine) — "chamada para API externa" = **médio** (report — não bloqueia, o enforcement de custo é a F03);
  2. **estima** o custo pré-chamada (contagem de tokens × **tabela de preço semeada** por modelo);
  3. dispara o adapter e **faz streaming** da resposta;
  4. ao fim, calcula o **custo real** a partir do `usage` e emite **`CostEvent`** (**report-only** — não bloqueia).
  É o único lugar onde a F03 vai inserir o gate; por isso tem de ser único.
- **Streaming ao renderer:** a resposta chega em chunks; o renderer **assina um canal IPC tipado de stream** (um evento por chunk) e monta o texto incrementalmente, vendo estado `streaming | concluído | falhou`. O renderer **nunca** recebe a credencial.
- **Custo e latência:** **estimativa pré-chamada** (tokens × tabela de preço por modelo, dado semeado em `src/shared/`, não hardcode) — o insumo que a F03 usará para o gate; **custo real pós-stream** a partir do `usage` retornado pelo provider (a Anthropic devolve os tokens de entrada/saída no fim do stream). Latência medida (até o 1º chunk e total). Tudo vira **`CostEvent`** (report-only aqui).
- **Auditoria (ADR-004):** `AuditEvent` **antes** (requisição: provider, modelo, escopo, estimativa) e **depois** (conclusão: `usage` real, custo, latência, status), encadeado, **sem prompt sensível nem segredo** no payload (redação). `verifyChain` passa.
- **Logging (ADR-005):** categoria **`ai`**, com **entrada e saída** casadas por `correlationId` (CONVENTION §3: fluxos de AI logam os dois lados), redaction comprovada (sem key, sem conteúdo sensível).
- **Resiliência (ARCHITECTURE § Resiliência):** **timeout obrigatório**; erro/timeout do provider ou **stream interrompido** → estado `falhou`, `AuditEvent` na falha, sem quebrar o app.
- **Fronteira de processo:** o adapter e o ponto de chamada rodam no **main**; o renderer dispara e recebe o stream **via IPC tipado**; sem Node/segredo no renderer.

### Fora

- **BudgetPolicy / gate de custo** — **Fatia 03**. Aqui `CostEvent` é **report-only**; o ponto de chamada não bloqueia por orçamento.
- **Multi-provider e roteamento (`ProviderRoute`)** — **Fatia 04** (OpenAI, Gemini, Ollama, seleção por tarefa, tela de providers).
- **Claude Code CLI** (modo subprocess do Claude) — **Fatia 04**: é outra natureza (processo, não HTTP), consome o terminal/execução.
- **Conectores não-IA** (Google Workspace, ElevenLabs) — MVP-006.
- **Histórico de conversa / memória / RAG** — MVP-007. Nesta fatia a chamada é **stateless**: o contexto que o provider recebe é o que o chamador montar no `request`.
- **Voz (STT/TTS)** — Corte 4.

## Critérios de aceite

1. **Adapter isolado:** o ponto de chamada não conhece Anthropic diretamente — só a interface `AiAdapter`. Teste: um adapter fake satisfaz a interface e roda pelo mesmo ponto de chamada.
2. **Claude API em streaming:** a chamada real devolve a resposta em **chunks** ao renderer via canal IPC tipado; o renderer monta o texto incrementalmente e **nunca recebe a credencial** (lida do Vault no main). Teste com mock do provider nos unitários; um caminho real exercitável.
3. **Ponto único de chamada:** toda chamada de IA passa por ele; é **classificado** pela política (médio, chamada externa) e **auditado**, mas **não bloqueia por custo** (report-only). Teste comprova que o ponto é único e que a chamada segue mesmo com `CostEvent` alto.
4. **Custo/latência:** estimativa pré-chamada pela tabela de preço semeada **e** custo real pós-stream a partir do `usage`; **`CostEvent`** gerado (report-only); latência medida. Teste dos dois números.
5. **Auditoria:** `AuditEvent` antes e depois (requisição/conclusão), encadeado, **sem prompt sensível nem segredo**; `verifyChain` passa. Teste.
6. **Log `ai`** com entrada/saída casadas por `correlationId` e **redaction comprovada** (sem key, sem conteúdo sensível). Teste.
7. **Resiliência:** timeout/erro do provider ou stream interrompido → `falhou` + `AuditEvent`, sem quebrar o app. Teste.
8. Renderer dispara/recebe via IPC tipado; adapter e ponto de chamada no main; sem Node/segredo no renderer.
9. `npm run dev`, `npm run test` e `npm run lint` passam; evidência no `reports/TESTS.md` (Regras + Banco + Tela).

## Perguntas resolvidas pelo PI (2026-07-24)

1. **Primeiro provider:** **Claude API** (Anthropic Messages) — o modelo da casa prova o caminho adapter+custo+auditoria. — decidido.
2. **Streaming já na F02:** a resposta chega em **chunks** ao renderer; o **custo é contabilizado ao fim do stream** a partir do `usage`. — decidido (contrário à proposta report/response-only do Cowork, aceito).

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **Interface `generateStream(request, ctx)`** emitindo chunks + `usage`/latência no fim; isolada por provider; o núcleo não conhece o provider concreto.
- **Ponto único de chamada** como sede do futuro gate de orçamento (F03) — aqui report-only, já com classificação de política e auditoria.
- **Tabela de preço semeada** por modelo (dado versionado, não hardcode): estimativa pré + custo real do `usage` pós.
- **Chamada stateless** nesta fatia — histórico/memória é MVP-007; o contexto vem no `request`.
- **CLI, Ollama e roteamento** ficam na F04; **BudgetPolicy** na F03 (o `CostEvent` aqui é report-only, espelhando o padrão "report → gate").
