# MVP-026 — Fases, modelo por fase e console da geração

- Status: **aprovado pelo PI (2026-09-04)** — seis SPECs `aprovada-pi` na mesma data; todas as perguntas abertas respondidas pelo PI (a última, da F06, com a emenda à SPEC-Multi-Executor-02).
- GitHub: épico [#250](https://github.com/RodReis/rrb-jarvisOS/issues/250); fatias [#251](https://github.com/RodReis/rrb-jarvisOS/issues/251) (`proplan:next`), [#252](https://github.com/RodReis/rrb-jarvisOS/issues/252), [#253](https://github.com/RodReis/rrb-jarvisOS/issues/253), [#254](https://github.com/RodReis/rrb-jarvisOS/issues/254), [#255](https://github.com/RodReis/rrb-jarvisOS/issues/255) em `proplan:backlog`, [#256](https://github.com/RodReis/rrb-jarvisOS/issues/256) em `proplan:backlog`, assignee PI.
- Depende de: MVP-025 (aceito em 2026-09-03), MVP-009 (finalizado), M5-F04 (multi-provider), M10-F02 (autenticação Codex — **puxada para a frente da fila** por este MVP; só a F06 depende dela).
- Fila: **cabeça da fila, antes do MVP-022 (Shell) e do Command Center** — decisão do PI de 2026-09-04.
- Corrige: a superfície do MVP-025. Não reabre o aceite do MVP-025 — a máquina de etapas, os gates e a geração com origem continuam válidos; o que muda é **como o PI vê o projeto** (fase, card, console) e **qual modelo gera em cada fase**.

## Por que este MVP existe

O PI usou o app depois do MVP-025 e apontou quatro faltas:

1. **O card não diz em que fase o projeto está.** A M25-F01 entregou etapa + CTA, mas "Criado" no card é a *origem* (criado/importado), não a fase. Planejamento, Especificação e Construção não existem como conceito em lugar nenhum.
2. **O modelo não é escolhido onde a decisão importa.** A geração da jornada usa `escolherRota()` (assinatura = Claude Code CLI, paga = API Anthropic) e o modelo ativo do provider no workspace. A aba "Roteamento por tipo de tarefa" (SPEC-Providers-04: chat/code/embedding/summarize/vision) **não é consumida pela jornada** — verificado no código em 2026-09-04. O PI quer escolher o modelo **por fase** (Planejamento, Especificação, Construção), e quer Fable 5.1 e os modelos do Codex nessas escolhas.
3. **A IA trabalha às cegas.** O adapter roda `claude --print --model <id>` e a tela mostra "carregando" até o fim. O PI não vê o que a IA produz durante o refino nem que ferramentas ela usou. Quando o resultado vem, não há como saber como ele nasceu.
4. **Os documentos precisam estar versionados antes da construção — e isso precisa ser visível.** Os commits documentais por marco já existem (M8-F01, SPEC-Jornada-02..05), mas a tela não os mostra e nada barra a entrada na construção com marco sem commit ou worktree sujo.

## Decisões do PI (2026-09-04)

| # | Decisão | Onde |
|---|---|---|
| 1 | **Três fases, derivadas da etapa** (dado, não estado novo): Planejamento = `prompt` → `pacote-aceito` (8 etapas); Especificação = `roadmap`, `mvp-aceito`, `spec-aceita`; Construção = `construcao` | F01 |
| 2 | **Modelo por fase: default no workspace + override por projeto**, ambos auditados. Não há escolha por etapa nem por geração — o selo antes do botão continua dizendo rota e modelo | F02 |
| 3 | **Combos por fase:** Planejamento e Especificação = Fable 5.1 (`claude-fable-5-1`) ou Sol (`gpt-5.6-sol`, Codex); Construção = Opus 5 (`claude-opus-5`) ou `gpt-5.5` (Codex). O catálogo é dado versionado; outros modelos do catálogo continuam selecionáveis onde o provider os atende | F02 |
| 4 | **Fable 5.1 só pela rota de assinatura (Claude Code CLI). Nunca pela API paga** — não entra na tabela do provider `anthropic` | F02 |
| 5 | **Codex vira provider do ponto único** para Planejamento e Especificação, pela **assinatura do Codex** (M10-F02). Modo `api` do Codex fica atrás do mesmo opt-in por projeto da rota paga da Anthropic. Codex como *executor* de Construção continua sendo M10-F03/F04 | F06 |
| 6 | **O modelo da fase Construção chega ao run do MVP-009** (Claude Code no container) e fica no ledger. Hoje o container usa o default do CLI | F05 |
| 7 | **Card do projeto mostra:** fase + etapa atual (com progresso), gates aceitos (n/5) e data do último evento, rota + modelo da fase atual, pendência/bloqueio da próxima ação | F01 |
| 8 | **Console da geração persistido por geração**, com texto do modelo e ferramentas em **nome + resumo do argumento + status** (resultado completo colapsável, truncado no persistido); **painel retrátil na própria etapa**, que abre sozinho quando a geração começa | F03 |
| 9 | **Painel de marcos Git na tela do projeto + bloqueio no gate da SPEC:** entrada na Construção é barrada, com ação concreta, se houver marco sem commit ou worktree sujo | F04 |
| 10 | **Fila:** antes do MVP-022 e do Command Center. M10-F02 sobe junto, imediatamente antes da F06 | todas |
| 11 | "Roteamento por tipo de tarefa" **não é removido**: vira seção "Avançado" de Settings. Seus consumidores reais são MVP-007 (embedding/resumo), MVP-017 (conversa de voz) e MVP-021 (visão) | F02 |

## Identificadores confirmados pelo PI (2026-09-04)

| Provider | Modelo | Id | Rota |
|---|---|---|---|
| Claude Code CLI | Fable 5.1 | `claude-fable-5-1` | assinatura, unmetered |
| Claude Code CLI | Opus 5 / Sonnet 5 | `claude-opus-5` / `claude-sonnet-5` | assinatura, unmetered (já no catálogo) |
| Anthropic (API) | Opus 5 / Sonnet 5 | idem | paga, opt-in por projeto (já no catálogo) — **sem Fable** |
| Codex CLI 0.149.0 | Sol / 5.5 / 5.4 | `gpt-5.6-sol` / `gpt-5.5` / `gpt-5.4` | assinatura do Codex (F06); id canônico, sem alias `gpt-5.6` |
| Ollama | Qwen3 8B | `qwen3:8b` | local, unmetered (tag do `ollama list`; blob sha256 não é identificador) |

## Fatias

| Índice | SPEC | Resultado | Depende de |
|---|---|---|---|
| M26-F01 ([#251](https://github.com/RodReis/rrb-jarvisOS/issues/251)) | `spec-fases-01-fase-e-card-do-projeto.md` | Fase derivada da etapa; card com fase, etapa, gates, data, rota+modelo e pendência; trilha agrupada por fase. Sem IA | M25-F01 |
| M26-F02 ([#252](https://github.com/RodReis/rrb-jarvisOS/issues/252)) | `spec-fases-02-catalogo-e-modelo-por-fase.md` | Catálogo com Fable 5.1 e `qwen3:8b`; Fable só na rota de assinatura; `PhaseModelPolicy` (workspace) + override por projeto; jornada consome; Roteamento por tarefa vira Avançado | F01, M5-F04 |
| M26-F03 ([#253](https://github.com/RodReis/rrb-jarvisOS/issues/253)) | `spec-fases-03-console-da-geracao.md` | `GenerationTrace` persistido por geração (texto, ferramentas, tokens, duração); adapter Claude Code em `stream-json`; painel retrátil na etapa, ao vivo e reabrível | F02, M8-F02 |
| M26-F04 ([#254](https://github.com/RodReis/rrb-jarvisOS/issues/254)) | `spec-fases-04-marcos-git-e-gate-da-construcao.md` | Painel de marcos com hash por documento; verificação determinística no `SLICE_ENTRY`: marco sem commit ou worktree sujo bloqueia com ação | F01, M8-F01 |
| M26-F05 ([#255](https://github.com/RodReis/rrb-jarvisOS/issues/255)) | `spec-fases-05-modelo-da-fase-no-run.md` | Modelo da fase Construção passado ao Claude Code no container e gravado no `ExecutionLedger`; preflight recusa modelo fora do catálogo | F02, M9-F03/F04/F06 |
| M26-F06 ([#256](https://github.com/RodReis/rrb-jarvisOS/issues/256)) | `spec-fases-06-codex-no-ponto-unico.md` | Provider `codex` no `AI_PROVIDERS` (assinatura), `gpt-5.6-sol`/`gpt-5.5`/`gpt-5.4` no catálogo, eventos de `codex exec --json` no console, opt-in para modo `api` | F02, F03, **M10-F02** |

Ordem de execução: F01 → F02 → F03 → F04 → F05 → **M10-F02** → F06.

## Invariantes deste MVP

- **Fase é derivada.** `fase = FASE_DA_ETAPA[etapa]`; nenhuma coluna nova, nenhuma transição nova. Quem muda a fase é a máquina da M25-F01.
- **Escolha de modelo é dado escopado** (`user_id` + `workspace_id`, e `project_id` no override), editável pela ponte IPC tipada, com `AuditEvent` a cada troca (ADR-004). Nunca hardcode: o combo lê o catálogo, e o catálogo filtra pelo que a rota atende.
- **Um modelo não pode sair por rota que não o atende.** Fable pela API paga não é opção que falha — é opção que não existe no catálogo daquela rota. Vale igual para Codex em modo `api` sem opt-in.
- **A rota de assinatura continua obrigatória e a paga continua opt-in** (decisão 4 do MVP-025). Com duas assinaturas (Claude MAX, Codex), a regra vale para as duas; nenhuma cai na outra nem em API por conta própria.
- **Console é evidência, não decoração.** Cada geração registrada no ledger tem um `GenerationTrace`; o painel só renderiza o que está gravado. Resultado de ferramenta é truncado no persistido, com o tamanho original declarado.
- **Nenhum gate é aprovado com documento fora do Git.** A verificação do `SLICE_ENTRY` é determinística (hash da revisão aceita = blob no commit do marco) e roda antes do aceite, não depois.
- **Geração passa pelo ponto único** com `ContextPack` e orçamento (M8-F02, M5-F03). O provider `codex` entra por adapter, como os quatro existentes — não abre segundo caminho.

## Done do MVP

- O card de cada projeto diz a fase, a etapa, quantos gates foram aceitos, quando se moveu pela última vez, por qual rota e modelo a próxima geração sai e, se estiver bloqueado, por quê.
- O PI muda o modelo de uma fase em Settings ou no projeto e a próxima geração daquela fase sai pelo modelo escolhido, com a troca na auditoria.
- Durante uma geração, o painel mostra o texto e as ferramentas conforme acontecem; depois, a mesma trilha reabre do histórico.
- A entrada na Construção com marco sem commit é barrada com a ação concreta; com tudo versionado, o run do MVP-009 usa o modelo da fase Construção e o ledger registra qual foi.
- Com a assinatura do Codex conectada, `gpt-5.6-sol` gera brief/PRD/arquitetura/roadmap pelo mesmo ponto único, com console e origem por afirmação iguais aos do Claude.

## Riscos registrados

- **`--output-format stream-json` do Claude Code CLI e `codex exec --json` são contratos de terceiros.** O parser fica atrás de um `GenerationEvent` próprio; mudança de formato quebra o console, não a geração — o texto final continua vindo pelo caminho de hoje.
- **Codex no ponto único depende da M10-F02**, cuja SPEC foi escrita pensando no executor de construção (container). **Emendada pelo PI em 2026-09-04:** a dependência da M10-F01 vale só para o mount no container; a parte de host entra antes da F06, e a M10-F02 sobe na fila.
- **VRAM:** `qwen3:8b` (5,2 GB) na RTX 5060 de 8 GB convive mal com outros modelos locais carregados. Já registrado na SPEC-Voz-03; este MVP só o inclui no catálogo.
- **SPEC-Multi-Executor-04 (M10-F04)** prevê "preferência ordenada de executor por projeto e tipo de tarefa" para a Construção. A F05 entrega o caso de um executor (Claude Code) com modelo por fase; a M10-F04 estende para escolher executor. Sem colisão: a F05 não decide executor.
