# SPEC-Fundacao-06 — Observabilidade e Logging

- MVP: `docs/mvp/mvp-001-fundacao.md` (Fatia 06)
- Status: **aprovada-pi** (2026-07-21) — decisões de biblioteca, retenção e escopo resolvidas pelo PI. **Emenda 2026-07-22 (PI):** critério 5 e a nota de escopo corrigidos — a instrumentação de `auth`/`workspace-switch`/`db` migra para as próprias fatias (F03/F02/F04), porque esse código não existe quando o F06 executa. O F06 entrega infra + contrato e instrumenta só o que já existe (`ipc`, `sistema`).
- Dependências: Fatia 01 entregue. **Roda cedo — logo após a 01 e antes de 02–05**, porque é infra transversal: 02–05 devem logar desde o início. Consome `Workspace` (tag) e alinha com `Session`/`AuditEvent` da Fatia 04.
- Decisões que sustentam esta spec: **ADR-005** (observabilidade), ADR-004 (log ≠ AuditEvent), ADR-001 (local-first).

## Objetivo

Instalar a infraestrutura de logging da fundação e a **regra "todo método loga"** (error/warn/info), com mensagem padrão em **pt-BR** e registro estruturado, para monitorar em tempo real o que acontece com a aplicação. Cobre NOA e JARVIS OS. O **monitor visual fica para fatia futura** — aqui entra o encanamento e a convenção.

## Escopo

### Dentro

- **Bibliotecas (ADR-005):**
  - **Renderer (frontend):** `electron-log` — captura logs da UI e os encaminha ao main por IPC (o renderer nunca escreve em disco, regra de segurança da Fatia 01).
  - **Main (backend):** `winston` + `winston-daily-rotate-file` — **escritor único** dos arquivos, dono de rotação/zip/retenção/redaction.
  - **Ponte:** no main, `electron-log` **não escreve arquivo**; seu transport encaminha o registro recebido do renderer para o `winston`. Um só escritor evita dois donos do mesmo arquivo.
- **Níveis:** `error`, `warn`, `info` (e `debug` só em dev, fora dos arquivos de produção).
- **Categorias** (child logger por categoria), com campo `direction: 'in' | 'out'` onde houver fluxo:
  - `integracao` (entrada/saída de conectores externos), `ai` (entrada/saída de provider), `agent` (entrada/saída de agente), `db` (storage local), `auth`, `ipc`, `ui`, `sistema`.
  - **Nota de escopo:** `ai`, `agent` e `integracao` **não têm fluxo na fundação** (estão fora do MVP-001). Aqui define-se o **contrato** dessas categorias (assinatura, formato, redaction) para que, quando os subsistemas existirem, o log de in/out já esteja padronizado. **O que loga de verdade no F06** (fluxos já existentes após a F01): `ipc` e `sistema`. **O que logará quando a fatia nascer**, honrando este mesmo contrato: `auth` (F03), `db` (F04) e a troca de workspace (F02) — cada uma instrumenta o logger na sua própria fatia (ver critério de aceite dedicado em F02/F03/F04).
- **Registro estruturado (JSON no disco)** — um objeto por linha com, no mínimo:
  `ts` (ISO-8601), `level`, `category`, `direction?`, `workspace` (`noa` | `jarvis` | `sistema`), `msg` (pt-BR), `ctx` (objeto estruturado), `correlationId` (para casar in↔out de uma operação), `pid`, `source` (`main` | `renderer`).
- **Padrão de mensagem pt-BR** (`msg`): frase curta, descritiva, **sem stack trace e sem segredo**. O detalhe técnico vai em `ctx` (stack em `ctx.stack`). Exemplos:
  - `auth` — `"Login Google concluído"` · `ctx: { userId, provider: 'google', ms: 842 }`
  - `db` — `"Falha ao gravar sessão no SQLite"` · `ctx: { op: 'insert', table: 'session', stack }`
  - `ai` (futuro) — `"Prompt enviado ao provider"` · `ctx: { modelo, tokens, correlationId }` (conteúdo redigido)
  - `integracao` (futuro) — `"Resposta da API do GitHub recebida"` · `ctx: { status: 200, ms: 342, direction: 'in' }`
- **Retenção por nível, zipada, local** (winston-daily-rotate-file, `zippedArchive: true`, `maxFiles` em dias):
  - `info` → **3 dias** · `warn` → **7 dias** · `error` → **10 dias**.
  - Arquivos em `userData/logs/` (fora do repo). Rotação diária.
- **Redaction obrigatória** (formato winston aplicado antes de escrever): campos `token`, `password`, `secret`, `authorization`, `accessToken`, `refreshToken`, `apiKey` e qualquer campo marcado `sensitivity: credential | secret` **nunca** são gravados; `personal | financial | health` são mascarados/omitidos (JARVIS não loga esses sem aprovação — CONVENTION §2). Todo registro carrega `sensitivity: internal` no mínimo.
- **Regra "todo método loga"** aplicada ao código da fundação: caminhos de auth, troca de workspace, storage/DB, IPC e erros emitem `info` no fluxo normal, `warn` em degradação recuperável e `error` em falha. A regra vira contrato no `docs/CONVENTION.md` §3.
- **Cobertura NOA e JARVIS OS:** stream único de logs **etiquetado** por `workspace` (o monitor futuro filtra por campo). `Desenvolvimento` não é workspace de usuário; processos sem espaço usam `workspace: 'sistema'`.

### Fora

- **Monitor visual / tempo real** (tela de logs, tail ao vivo, filtros) — fatia futura, depois da fundação.
- **Envio de logs à nuvem** — winston "backend nuvem" fica para a fase de sync (Corte 3+); quando entrar, dado sensível vai **E2EE/AES-256** (decisão de 2026-07-21 no `DECISIONS.md`), como os demais.
- **Métricas/tracing (APM), alertas, correlação distribuída** — não nesta fatia.
- **AuditEvent** — é da Fatia 04 (evidência permanente, hash-chain). Log **não** substitui auditoria (ver critério 6).

## Critérios de aceite

1. `error`, `warn` e `info` disponíveis nos dois processos; do renderer, o registro chega ao main via IPC (renderer não escreve disco) e é gravado pelo winston (escritor único).
2. Arquivos rotacionam por dia, são **zipados** e respeitam a retenção por nível: `info` 3d, `warn` 7d, `error` 10d (teste verifica que arquivo além da janela é podado — inclusive o `.gz`).
3. Todo registro é JSON estruturado com os campos mínimos e `msg` em **pt-BR**; `workspace` presente e correto (NOA/JARVIS/sistema).
4. **Redaction comprovada:** um registro contendo token/segredo/campo `credential|secret` é gravado **sem** o valor sensível (teste com payload contendo token → arquivo não contém o token).
5. A regra "todo método loga" está **registrada como contrato** em `docs/CONVENTION.md` §3 e **aplicada aos fluxos que já existem quando o F06 executa** (`ipc`, `sistema`) — cada um emite `info`/`warn`/`error` conforme o caso. `auth` (F03), `workspace-switch` (F02) e `db` (F04) **instrumentam o logger nas suas próprias fatias** (critério de aceite dedicado em cada uma), porque esse código ainda não existe no momento do F06.
6. **Log ≠ AuditEvent:** um erro relevante pode gerar *ambos*, mas em stores separados — logs não vão pro SQLite de auditoria e AuditEvent não vai pros arquivos de log.
7. As categorias `ai`/`agent`/`integracao` têm contrato (tipo/assinatura) definido, mesmo sem fluxo ainda.
8. `npm run test` e `npm run lint` passam; a categoria de teste **Banco/Regras** cobre retenção-poda e redaction.

## Perguntas resolvidas pelo PI (2026-07-21)

1. **Bibliotecas:** `electron-log` no renderer (captura + IPC) e `winston` + `winston-daily-rotate-file` no main como **escritor único** (rotação/zip/retenção). — aprovado.
2. **Retenção:** **por nível** — info 3d, warn 7d, error 10d, zipado e local. — aprovado.
3. **Escopo:** **nova Fatia 06**, executada **cedo (após a 01)**, porque 02–05 dependem do logger. — aprovado.

## Observações de implementação (para o Code, não-normativas)

- `winston-daily-rotate-file` **não descompacta antes de apagar**; confirmar que `maxFiles` em dias poda também os `.gz` — senão a retenção não se cumpre de fato (gotcha conhecido).
- `correlationId` é o que permite casar `in`↔`out` (ai/agent/integração) no monitor futuro — gerar um por operação e propagar.
- Nível default: `debug` em dev (console pt-BR legível), `info` em produção (arquivos).
