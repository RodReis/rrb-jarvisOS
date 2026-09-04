# SPEC-Fases-03 — Console da geração

- MVP/Fatia: MVP-026 · M26-F03.
- Issue: [#253](https://github.com/RodReis/rrb-jarvisOS/issues/253); épico [#250](https://github.com/RodReis/rrb-jarvisOS/issues/250).
- Status: **aprovada-pi** (2026-09-04) — perguntas respondidas pelo PI nesta data, antes da redação.
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
- Ferramentas que o CLI executa no `cwd` do projeto continuam sob a política do MVP-004 — esta fatia **não muda permissões**, só as torna visíveis.

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
