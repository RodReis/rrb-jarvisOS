# Kickoff — MVP-001 · Fatia 06 · Observabilidade e Logging (issue #8)

> Hand-off do planejamento (Cowork) para o **Claude Code**. Cole isto numa sessão do Claude Code no repo `rrb-jarvisOS`. Você (Code) implementa; o Cowork não codifica.
>
> **Pré-condição:** só inicie esta fatia com a **F01 Bootstrap (#2) já entregue** (PR mergeado na `main`). É a 2ª da ordem — roda cedo porque 02–05 precisam logar desde o início.

## 1. Leia antes de codar (nesta ordem)
- `CLAUDE.md` (raiz) — papéis, ciclo de vida, regras de Git/board, regras técnicas invioláveis.
- `docs/spec/spec-fundacao-06-observabilidade-logging.md` — **a spec desta fatia** (`aprovada-pi`). Lei do escopo.
- `docs/DECISIONS.md` → **ADR-005** (observabilidade), **ADR-004** (log ≠ AuditEvent), ADR-001 (local-first).
- `docs/CONVENTION.md` — aqui você vai **inscrever** a regra "todo método loga" (§3) e o contrato das categorias.
- `docs/ARCHITECTURE.md` — fronteira: renderer nunca escreve disco; tudo via IPC tipado (da F01).

## 2. Board (suas ações — WIP = 1)
1. Confirme que a F01 (#2) está em **Feito/Finalizado**. Mova **#8** `proplan:backlog` → `proplan:todo` → `proplan:doing` e **atribua-se**. Uma fatia por vez.
2. Branch único: **`feat/observabilidade-logging`** (nunca na `main`).
3. **Commite cedo e faça push** a cada passo — inclui `docs/`. Nunca deixe entrega só no local.

## 3. O que entregar (da spec — escopo fechado)
- **Bibliotecas (ADR-005):**
  - Renderer: **`electron-log`** — captura logs da UI e encaminha ao main por IPC (renderer **não** escreve disco).
  - Main: **`winston` + `winston-daily-rotate-file`** — **escritor único** dos arquivos (rotação/zip/retenção/redaction). O `electron-log` no main **não** escreve arquivo; seu transport repassa ao winston.
- **Níveis:** `error`, `warn`, `info` (+ `debug` só em dev, fora dos arquivos de produção).
- **Categorias** (child logger por categoria) com `direction: 'in'|'out'` onde houver fluxo: `integracao`, `ai`, `agent`, `db`, `auth`, `ipc`, `ui`, `sistema`.
  - **Loga de verdade agora:** `auth`, `db`, `ipc`, `sistema` e a troca de workspace. As categorias `ai`/`agent`/`integracao` **não têm fluxo na fundação** — aqui define-se só o **contrato** (tipo/assinatura/formato/redaction) delas.
- **Registro estruturado (JSON, 1 objeto por linha)** com no mínimo: `ts` (ISO-8601), `level`, `category`, `direction?`, `workspace` (`noa|jarvis|sistema`), `msg` (**pt-BR**), `ctx`, `correlationId`, `pid`, `source` (`main|renderer`).
- **Mensagem pt-BR:** curta, descritiva, **sem stack e sem segredo** (stack vai em `ctx.stack`).
- **Retenção por nível, zipada, local** (`zippedArchive: true`, `maxFiles` em dias) em `userData/logs/`, rotação diária: `info` **3d**, `warn` **7d**, `error` **10d**.
- **Redaction obrigatória** (formato winston antes de escrever): `token`, `password`, `secret`, `authorization`, `accessToken`, `refreshToken`, `apiKey` e campos `sensitivity: credential|secret` **nunca** gravados; `personal|financial|health` mascarados/omitidos (CONVENTION §2). Todo registro carrega `sensitivity: internal` no mínimo.
- **Regra "todo método loga"** aplicada aos fluxos da fundação (auth, workspace-switch, db, ipc, erros): `info` no fluxo normal, `warn` em degradação recuperável, `error` em falha. Inscreva a regra no `CONVENTION.md` §3.
- **Etiqueta por `workspace`:** stream único etiquetado (NOA/JARVIS/sistema); processos sem espaço usam `sistema`.

**Fora desta fatia:** monitor visual/tempo real (tela de logs, tail, filtros); envio à nuvem; métricas/tracing/APM/alertas; **AuditEvent** (é da F04 — log não substitui auditoria).

## 4. Critérios de aceite (o "done" verificável)
1. `error/warn/info` nos dois processos; do renderer o registro chega ao main via IPC (renderer não escreve disco) e é gravado pelo winston (escritor único).
2. Arquivos rotacionam por dia, são **zipados** e respeitam a retenção por nível — teste verifica que arquivo além da janela é podado, **inclusive o `.gz`**.
3. Todo registro é JSON com os campos mínimos e `msg` em pt-BR; `workspace` presente e correto.
4. **Redaction comprovada:** payload com token/segredo/campo `credential|secret` é gravado **sem** o valor (teste: arquivo não contém o token).
5. Regra "todo método loga" aplicada aos fluxos existentes (auth, workspace-switch, db, ipc).
6. **Log ≠ AuditEvent:** um erro pode gerar ambos, mas em stores separados — logs não vão ao SQLite de auditoria e vice-versa.
7. Categorias `ai`/`agent`/`integracao` têm contrato (tipo/assinatura) definido, mesmo sem fluxo.
8. `npm run test` e `npm run lint` passam; a categoria de teste **Banco/Regras** cobre retenção-poda e redaction.

## 5. Gotchas (da spec — não-normativos, mas te salvam)
- `winston-daily-rotate-file` **não descompacta antes de apagar** — confirme que `maxFiles` (em dias) poda também os `.gz`, senão a retenção não se cumpre.
- `correlationId`: gere **um por operação** e propague (é o que casa in↔out no monitor futuro).
- Nível default: `debug` em dev (console pt-BR legível), `info` em produção.

## 6. Durante a fatia
- Mantenha `docs/DEVELOPMENT.md` (você é o dono) com o passo-a-passo/checkmarks. Atualize `docs/STATUS.md` ao mover de coluna. Inscreva a regra "todo método loga" e o contrato das categorias no `docs/CONVENTION.md`.
- Pode criticar arquitetura; **não** invente escopo. Spec ambígua → **pergunte ao PI**.

## 7. Entrega (Git)
- PR com **`refs #8`** no corpo. **NUNCA `closes #8`** (forjaria o aceite do PI).
- Com `dev`/`test`/`lint` + CI verdes, **merge na `main`** (auto-merge após checks).
- **Só depois do merge**, aplique `proplan:done` → **Feito**, com o link do PR na issue. **Não** feche a issue nem mova para Finalizado (ato exclusivo do PI).
- Commite os docs de `docs/` junto. Ao final, `/graphify . --update` (incremental).

## 8. Depois da F06 (ordem do MVP-001)
`01 (#2)` → `06 (#8)` → `02/04` → `03` → `05`. Uma por vez, WIP = 1.
