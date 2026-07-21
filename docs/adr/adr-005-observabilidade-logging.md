# ADR-005: Observabilidade e logging estruturado

- Status: aceito.
- Data: 21 de julho de 2026.
- Decisor: PI (biblioteca, retenção e escopo); detalhamento técnico pelo Cowork com pesquisa das práticas correntes.
- Relacionado: SPEC-Fundacao-06 (onde entra); ADR-004 (log ≠ AuditEvent); ADR-001 (local-first; nuvem é espelho); ADR-003 (mesma disciplina de evidência/observabilidade verificável).

## Problema

Não há como monitorar em tempo real o que a aplicação faz — falhas de auth, troca de workspace, storage, IPC e, no futuro, entrada/saída de AI, agentes e integrações — sem um logging padronizado. Precisamos de níveis (error/warn/info), mensagem legível em pt-BR, registro estruturado (para um monitor futuro), retenção com compactação local e, acima de tudo, **sem vazar segredo/PII** — porque num app que guarda token e dado pessoal, o próprio log vira superfície de risco. Nada disso existia nas 5 specs da fundação.

## Decisão

**Infra de logging como Fatia 06 da fundação, executada cedo (após a 01), disponível a 02–05.**

1. **Duas bibliotecas, um escritor.**
   - **Renderer:** `electron-log` — captura na UI e encaminha ao main por IPC (o renderer não escreve em disco; regra de segurança da Fatia 01).
   - **Main:** `winston` + `winston-daily-rotate-file` — **escritor único** dos arquivos; dono de rotação, zip, retenção e redaction.
   - A ponte roteia os registros do `electron-log` (renderer) para o `winston` (main). Um só dono do arquivo evita dois escritores concorrentes.
2. **Registro estruturado (JSON)** com `ts`, `level`, `category`, `direction?`, `workspace`, `msg` (pt-BR), `ctx`, `correlationId`, `pid`, `source`. Categorias: `integracao`/`ai`/`agent`/`db`/`auth`/`ipc`/`ui`/`sistema`.
3. **Retenção por nível, zipada, local:** `info` 3 dias, `warn` 7 dias, `error` 10 dias (`zippedArchive`, `maxFiles` em dias), em `userData/logs/`.
4. **Redaction obrigatória:** segredo/token e campos `credential|secret` nunca gravados; `personal|financial|health` mascarados (CONVENTION §2). Log é `sensitivity: internal` no mínimo.
5. **Cobertura NOA + JARVIS** por campo `workspace` (stream único etiquetado), não por diretório separado — o monitor futuro filtra por campo.

## Escopo e fronteiras (o que NÃO é)

- **Log ≠ AuditEvent (ADR-004).** Log é observabilidade: efêmero, rotaciona e é apagado em 3–10 dias, pode ser texto. AuditEvent é evidência: permanente, append-only, hash-chain, em SQLite. Um evento pode gerar os dois, em stores separados; nenhum substitui o outro.
- **Sem monitor visual agora.** A tela de tail/filtros em tempo real é fatia futura; esta ADR entrega o encanamento e o formato que a tornam possível.
- **Sem envio à nuvem agora.** O "winston backend nuvem" fica para a fase de sync (Corte 3+); quando entrar, log sensível vai **E2EE/AES-256**, como as demais escritas ao cloud (decisão de 2026-07-21).
- **Sem APM/tracing/alertas.** Fora da fundação.

## Consequências

- 02–05 logam desde o início (por isso a 06 roda cedo). A regra "todo método loga" vira contrato no `CONVENTION.md` §3.
- Reusa a postura de segurança já decidida: renderer sem FS, redaction, e o mesmo cuidado com segredo do `safeStorage` (SPEC-03).
- Estruturado em JSON ⇒ o monitor futuro e qualquer análise leem por campo; `correlationId` casa in↔out de AI/agente/integração quando existirem.
- Custo: duas libs no bundle (electron-log é zero-dep; winston + rotate são padrão de mercado) e uma ponte IPC a manter.
- Gotcha registrado na spec: confirmar que `maxFiles` poda também os `.gz`, senão a retenção não se cumpre.
