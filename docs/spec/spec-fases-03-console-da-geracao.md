# SPEC-Fases-03 — Console da geração

- MVP/Fatia: MVP-026 · M26-F03.
- Issue: [#253](https://github.com/RodReis/rrb-jarvisOS/issues/253); épico [#250](https://github.com/RodReis/rrb-jarvisOS/issues/250).
- Status: **aprovada-pi** (2026-09-04) — perguntas respondidas pelo PI nesta data, antes da redação. **Entregue** (PR #263). **Emenda E1** abaixo: `proposta-cowork` (2026-09-05), aguarda `aprovada-pi`.
- Depende de: M26-F02 (modelo por fase); M8-F02 (ponto único, `ContextPack`, ledger); M5-F04 (adapter Claude Code CLI, `generateStream`).

## Objetivo

Mostrar ao PI, **enquanto a IA gera**, o texto que ela produz e as ferramentas que usa — e guardar isso por geração, para que cada documento tenha a trilha de como nasceu.

## Eventos

`GenerationEvent` (domínio, `shared`), fechado:

| tipo | campos | origem |
|---|---|---|
| `texto` | `delta` | texto do modelo, em pedaços |
| `ferramenta-inicio` | `chamadaId`, `nome`, `resumoDoArgumento` | o modelo pediu uma ferramenta |
| `ferramenta-fim` | `chamadaId`, `status` (`ok`/`erro`), `resumoDoResultado`, `tamanhoOriginal` | a ferramenta respondeu |
| `uso` | `tokensEntrada`, `tokensSaida`, `duracaoMs` | fechamento |
| `erro` | `mensagem` | falha da chamada |

- **`resumoDoArgumento`** é dado por ferramenta (`RESUMO_POR_FERRAMENTA`, tabela): `Read` → caminho; `Bash` → comando (redigido pelo mesmo redator do terminal do MVP-004); `WebSearch`/`WebFetch` → termo/URL; desconhecida → primeiros 120 caracteres do JSON. **Nunca** segredo: o redator de auditoria (ADR-004) roda antes de persistir.
- **`resumoDoResultado`**: até 2 KB, com `tamanhoOriginal`. Resultado completo **não é persistido**.

## Adapter

- `ClaudeCodeAdapter.generateStream` passa a rodar `claude --print --model <id> --output-format stream-json --verbose` e a **parsear cada linha** em `GenerationEvent`. O texto final continua sendo montado dos `texto` — o contrato `AdapterChunk` existente é preservado (o console é um consumidor a mais, não um caminho novo).
- Linha que não parseia vira `erro` de parser **sem derrubar a geração**: contrato de terceiro é risco declarado no MVP; o texto continua chegando.
- Adapters `anthropic`, `gemini` e `ollama` emitem só `texto` e `uso` (não há ferramentas nessas rotas hoje). O adapter do Codex (F06) emite o conjunto completo a partir de `codex exec --json`.
- Ferramentas que o CLI executa no `cwd` do projeto continuam sob a política do MVP-004 — esta fatia **não muda permissões**, só as torna visíveis. *(Superado pela Emenda E1 para as fases Planejamento e Especificação — ver abaixo.)*

## Persistência

- `GenerationTrace` (`id`, `project_id`, `workspace_id`, `user_id`, `ledgerEntryId`, `etapa`, `fase`, `provider`, `modelo`, `iniciadoEm`, `terminadoEm`, `status`) + `GenerationTraceEvent` (`traceId`, `seq`, `tipo`, payload). Um trace por chamada do ponto único; **`ledgerEntryId` liga ao registro de uso** — trace sem ledger não existe.
- Escrita em lotes (a cada N eventos ou 250 ms), para não serializar o stream no SQLite.
- Retenção: segue o coletor da M9-F06 (`retencao-service`) com regra própria: eventos de traces com mais de 30 dias podem ser compactados para `uso` + contagem por ferramenta; o trace em si não é apagado enquanto o projeto existir.

## Superfície

- **Painel retrátil na própria etapa**, abaixo/ao lado do documento em geração: fechado por padrão, **abre sozinho quando a geração começa**, e mantém a posição escolhida pelo PI na sessão.
- Ao vivo: texto do modelo em fluxo; cada ferramenta vira uma linha `nome · resumo · status`, com o resultado resumido colapsável. Tokens e duração ao fechar.
- Histórico: a etapa lista as gerações anteriores (data, modelo, status); abrir uma renderiza o trace gravado no mesmo painel. Regeneração não apaga a anterior.
- IPC: um canal de assinatura por `traceId` (push do main para o renderer, tipado); o renderer nunca lê o processo.
- Só componentes do DS; fonte mono para argumento/resultado; leitura por teclado.

## Critérios de aceite

1. Geração pelo Claude Code CLI produz eventos `texto`, `ferramenta-inicio/fim` e `uso` no painel, na ordem em que o CLI os emitiu — fixture de `stream-json` gravado.
2. Todo trace tem `ledgerEntryId`; teste recusa trace órfão.
3. Argumento e resultado persistidos passam pelo redator; fixture com segredo prova a redação.
4. Resultado acima de 2 KB é truncado e `tamanhoOriginal` bate.
5. Linha inválida do CLI gera `erro` de parser e a geração termina com o texto correto.
6. Painel abre ao iniciar, mostra ao vivo e reabre do histórico com o mesmo conteúdo.
7. Adapters sem ferramentas produzem trace válido só com `texto` e `uso`.
8. Escrita em lote não perde evento em cancelamento (`signal`): o trace termina com `status: cancelado` e os eventos até ali.

## Testes e evidência

Unitários do parser (fixtures reais de `stream-json`, inclusive linha corrompida) e do resumo por ferramenta; int-spec da persistência em lote e do cancelamento; Testing Library do painel; Playwright da etapa Refinamento com adapter fake emitindo o conjunto completo. Smoke com o CLI real fora da suíte padrão. Relatório `SPEC-Fases-03`. Gate visual do painel ao vivo e do histórico.

## Perguntas resolvidas pelo PI (2026-09-04)

1. **Persistido por geração**, não só ao vivo. — decidido.
2. **Nome + resumo do argumento + status**; resultado completo colapsável e truncado no persistido. — decidido.
3. **Painel retrátil na própria etapa**, não aba separada. — decidido.

## Decisões cravadas pelo Cowork (PI pode vetar)

- **Trace ligado ao ledger, não solto.** O ledger é o registro de uso que a M8-F02 e a M5-F03 governam; um trace sem ele seria uma segunda contabilidade.
- **Resultado completo não persiste.** Com `Read` de arquivos grandes e `WebFetch`, o banco cresceria por geração; o resumo com tamanho original é o que a tela precisa.
- **Parser falha aberto para o texto e fechado para o console.** O documento é o produto; o console é evidência. Trocar a ordem faria uma mudança de formato do CLI parar a jornada.

---

## Emenda E1 — Isolamento do CLI por fase (2026-09-05)

- Status: **proposta-cowork**, aguarda `aprovada-pi`. Vira **fatia nova** (sub-issue do #250, título `[MVP26][SPEC-Fases-03][F07] Isolamento do CLI por fase`) quando aprovada — não reabre a #253.
- Motivação: teste do PI em 2026-09-05 (refinamento, prompt pequeno) — muito código, muito lixo, nada sobre o prompt. Três causas no código; duas são bugs documentados e já têm card ([#271](https://github.com/RodReis/rrb-jarvisOS/issues/271) `request.system` descartado pelo adapter; [#272](https://github.com/RodReis/rrb-jarvisOS/issues/272) texto de mensagens `user` entrando no documento). A terceira é **decisão de produto**, e é esta emenda.
- Evidência: o smoke da M26-F03 mediu **230.444 tokens de entrada** numa geração de refinamento. O `cwd` do CLI é `process.cwd()` — em dev, o repositório do próprio app: `CLAUDE.md` (184 linhas), `.claude/CLAUDE.md` (378), `rules/`, `hooks/`, `settings.json`, skills e MCPs do ambiente do PI entram no contexto de uma geração sobre **outro** projeto. Sem restrição de ferramentas, o modelo invocou a skill `claude-api` e rodou `Bash` fora do app.

### Decisões do PI já tomadas (2026-09-05)

1. **cwd neutro** para o subprocess, nos dois adapters (`ClaudeCodeAdapter` **e** `CodexAdapter`). Nunca `process.cwd()`.
2. Isolamento por fase: nas fases **Planejamento** e **Especificação** o CLI é um gerador de documento, sem persona de agente e sem ferramentas; na **Construção** o agente é legítimo.

### Regras

**cwd.** Um diretório **vazio, criado por geração** sob `app.getPath('userData')/cli-runs/<traceId>` e removido ao fim (também em cancelamento e timeout). Sem `CLAUDE.md`, sem `.claude/`, sem `AGENTS.md`, sem `.git`. O comentário atual dos adapters ("o diretório do app, nunca o do usuário") está errado nas duas metades: em dev o diretório do app **é** o repo com toda a governança; no app empacotado `process.cwd()` é o que o atalho do Windows decidir.

**Claude Code — fases Planejamento e Especificação** (`claude --print … --output-format stream-json --verbose`, acrescido de):

| flag | efeito (docs do CLI) | por quê |
|---|---|---|
| `--system-prompt <request.system>` | substitui **todo** o system prompt padrão | tira a persona de agente de código; entra o contrato da etapa (`SISTEMA_DAS_PERGUNTAS`, `SISTEMA_DO_BRIEF`, …). Base: #271 |
| `--tools ""` | nenhuma ferramenta disponível (Bash, Read, Skill, WebFetch…) | gerar documento não precisa de ferramenta; sem `Skill`, não há skill despejada |
| `--setting-sources ""` | não carrega settings `user`/`project`/`local` | hooks, permissões e plugins do ambiente do PI não entram na geração. Se a versão instalada rejeitar lista vazia, `user` — e o Code registra a diferença |
| `--strict-mcp-config` (sem `--mcp-config`) | ignora toda configuração de MCP | zero servidores MCP na geração |
| `--no-session-persistence` | não grava sessão em disco | geração não deixa transcript fora do trace |
| `--json-schema <schema da etapa>` | saída JSON validada pelo CLI (print mode) | o contrato deixa de depender só de obediência ao prompt; `lerPerguntasDoModelo` continua como segunda barreira |

**Claude Code — fase Construção.** Não é este adapter: o run da Construção roda no container (M9/M26-F05), com ferramentas legítimas. Lá a regra é `--append-system-prompt` (mantém a persona de agente, acrescenta o contrato) e o console **trunca** resultados (#272). Esta emenda **não altera** o run — só registra a assimetria para o Code não aplicar `--tools ""` onde ele quebraria a construção.

**Codex.** Mesmo cwd neutro. `codex exec` não tem flag de system prompt → `request.system` entra **antes** do prompt no stdin, separado por linha em branco e cabeçalho `INSTRUÇÕES:`/`PEDIDO:`. Flags: `--sandbox read-only` nas fases Planejamento/Especificação; `--skip-git-repo-check` (cwd neutro não é repositório Git e o `codex exec` recusa diretório fora de repo sem esta flag). O Code confirma cada flag em `codex exec --help` da versão instalada.

**Flag inexistente = falha declarada.** Se a versão instalada não aceitar uma flag, a geração falha com mensagem que nomeia a flag e a versão mínima — nunca cai silenciosamente para a invocação sem isolamento. A versão mínima suportada de cada CLI fica registrada em `docs/ARCHITECTURE.md` § Providers.

### Critérios de aceite

1. Teste dos dois adapters com `spawnImpl` capturado: `cwd` ≠ `process.cwd()`, existe, está vazio no spawn e não existe após o `close` (inclusive por `SIGKILL`).
2. Args do Claude Code nas fases Planejamento/Especificação contêm exatamente as flags da tabela, com `request.system` e o schema da etapa; em nenhum caso contêm `--dangerously-skip-permissions`.
3. Fixture de `stream-json` com `tool_use` numa geração de Planejamento → evento `erro` no console ("ferramenta em fase sem ferramentas") e a geração termina; o documento não recebe o texto posterior ao `tool_use`.
4. Smoke real do refinamento com prompt de até 500 caracteres: `tokensEntrada` medido pelo CLI **abaixo de 10.000** (hoje: 230.444). O número entra no relatório da fatia.
5. Codex: args contêm `--sandbox read-only` e `--skip-git-repo-check`; o stdin começa por `request.system` quando definido.
6. Flag rejeitada pelo CLI → `AdapterError` nomeando a flag; teste com `spawnImpl` que devolve o erro do CLI.

### Perguntas abertas ao PI

1. `--json-schema` já nesta fatia, ou fatia própria depois dos FIXes? (Recomendação: nesta — é a barreira que sobra quando o modelo desobedece o prompt.)
2. Diretório dos `cli-runs`: `userData` (por usuário do SO) serve, ou quer dentro do diretório do workspace do JarvisOS?
3. Versão mínima do Claude Code a exigir: a instalada no PI hoje (`claude --version`) ou a primeira que tem `--json-schema`?
