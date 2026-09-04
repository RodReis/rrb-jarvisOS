# STATUS.md — Kanban / Roadmap

Atualizado em: **2026-09-04**. Fonte única do índice Fatia ↔ SPEC. Estado remoto conferido nesta revisão: as **cinco fatias do MVP-025 (#238 a #242) estão `proplan:finalizado`** — aceitas pelo PI em 2026-09-03; o fechamento do épico #237 é ato dele. Nasce o **MVP-026 — Fases, modelo por fase e console da geração** (épico [#250](https://github.com/RodReis/rrb-jarvisOS/issues/250)), decidido pelo PI em 2026-09-04 após usar o app: fase no card, modelo por fase (Fable 5.1 / Sol / Opus 5 / gpt-5.5), console da geração com ferramentas, marcos Git verificados antes da Construção e Codex como provider do ponto único. **Em andamento: [#251](https://github.com/RodReis/rrb-jarvisOS/issues/251) (M26-F01, `proplan:doing`); cabeça da fila: [#252](https://github.com/RodReis/rrb-jarvisOS/issues/252) (M26-F02, `proplan:next`)**, antes do MVP-022 e do Command Center; a M10-F02 ([#117](https://github.com/RodReis/rrb-jarvisOS/issues/117)) sobe para imediatamente antes da M26-F06. Histórico detalhado em `docs/STATUS-ARQUIVO.md`; o board vence divergência factual.

## Agora

| Coluna | Item | Estado |
|---|---|---|
| Em Andamento | [#251](https://github.com/RodReis/rrb-jarvisOS/issues/251) · M26-F01 Fase do projeto e card completo | SPEC `aprovada-pi` (2026-09-04). Os sete critérios implementados: fase derivada da etapa (`Record` completo, teste de completude), card com os quatro blocos numa leitura só, trilha agrupada nas três fases. `PROVIDER_DA_ROTA` promovido ao domínio (cinco cópias removidas) para o card e o selo terem fonte única. **Gate visual pendente — aceite do PI.** Limite achado e não corrigido aqui: aceite documental não deixa evidência que `etapaDerivada` enxergue, então nenhum projeto real passa de `prd-aceito` — é da M25-F01, vira `[FIX]` |
| Backlog · **next** | [#252](https://github.com/RodReis/rrb-jarvisOS/issues/252) · M26-F02 Catálogo e modelo por fase | SPEC `aprovada-pi` (2026-09-04). `claude-fable-5-1` só na assinatura; `qwen3:8b`; default por fase no workspace + override por projeto; jornada consome `modeloDaFase` |
| Backlog | [#253](https://github.com/RodReis/rrb-jarvisOS/issues/253) · M26-F03 Console da geração | SPEC `aprovada-pi` (2026-09-04). Trace persistido por geração, `stream-json`, painel retrátil na etapa |
| Backlog | [#254](https://github.com/RodReis/rrb-jarvisOS/issues/254) · M26-F04 Marcos Git e gate da construção | SPEC `aprovada-pi` (2026-09-04). Painel de marcos + bloqueio no `SLICE_ENTRY` |
| Backlog | [#255](https://github.com/RodReis/rrb-jarvisOS/issues/255) · M26-F05 Modelo da fase no run | SPEC `aprovada-pi` (2026-09-04). `--model` da fase Construção no Claude Code do container; ledger |
| Backlog | [#256](https://github.com/RodReis/rrb-jarvisOS/issues/256) · M26-F06 Codex no ponto único | SPEC `aprovada-pi` (2026-09-04). Provider `codex` pela assinatura do Codex; depende de [#117](https://github.com/RodReis/rrb-jarvisOS/issues/117) (M10-F02, **emendada**: dependência da M10-F01 só para o mount no container) |
| Finalizado | [#238](https://github.com/RodReis/rrb-jarvisOS/issues/238) a [#242](https://github.com/RodReis/rrb-jarvisOS/issues/242) · M25-F01–F05 | **aceite do PI registrado em 2026-09-03**; as cinco em `proplan:finalizado`. Fechamento do épico [#237](https://github.com/RodReis/rrb-jarvisOS/issues/237) é ato do PI. Detalhe das entregas em `docs/STATUS-ARQUIVO.md` |
| Feito | [#106](https://github.com/RodReis/rrb-jarvisOS/issues/106) · M9-F06 Evidência, limpeza e continuidade | **a última fatia do MVP-009**, entregue no PR #236 (`2ac721d`); o PI declarou o MVP-009 finalizado em 2026-09-03 — aceite formal e fechamento de #100 são atos dele. SPEC `aprovada-pi` (2026-08-29, emendada em 2026-08-30). Entrega o `ExecutionLedger`, o `LimpezaService`, o coletor de retenção e o painel do estado terminal. **Decisão do PI em 2026-09-02:** o container passa a nascer com `--rm` (parar já remove, sem `docker rm` na allowlist de destrutivos), e a jornada E2E real completa **não roda** nesta entrega — o limite fica declarado |
| Finalizado | [#105](https://github.com/RodReis/rrb-jarvisOS/issues/105) · M9-F05 Revisão, CI e squash merge automático | **aceite do PI registrado**; entregue no PR #235 (`6bade77`). SPEC `aprovada-pi` (2026-08-29, emendada em 2026-08-30). Fechou a pendência da M9-F04: o `ConstrutorService` ganhou consumidor e a rota do executor passou a operar. **Três decisões do PI em 2026-09-02** (ver § Decisões do PI na M9-F05) |
| Finalizado | [#104](https://github.com/RodReis/rrb-jarvisOS/issues/104) · M9-F04 Construção/recuperação | **aceite do PI registrado em 2026-09-02**; entregue no PR #231 (`9005423`), CI verde. **Limites declarados:** correlação `runId`/`tentativa` do proxy fica para a M9-F05 (rota do executor não operacional em produção até lá); smoke real em `not_run` porque a imagem do sandbox não traz o binário `claude`; cancelamento cooperativo com latência até o timeout do passo. **Pendência do PI:** fail-open do `verificarEscopo` quando o `git status` do container falha |
| Feito | [#209](https://github.com/RodReis/rrb-jarvisOS/issues/209) · correção do EffectJournal | entregue no PR #227 (`66623b8`); `proplan:done`, aguardando aceite do PI |
| Backlog | [#232](https://github.com/RodReis/rrb-jarvisOS/issues/232) · `[INFRA][FIX]` worker morto no pool do Vitest | criado em 2026-09-02 na entrega da M9-F04: execução perde arquivo inteiro e ainda relata verde, o que é fechamento frágil produzido pela infra (`docs/TESTING.md` §1). Não entra na fila por si — o PI decide quando |
| Finalizado | [#222](https://github.com/RodReis/rrb-jarvisOS/issues/222) · restrição de egress do container | aceite do PI registrado; entregue no PR #228 |
| Feito | [#103](https://github.com/RodReis/rrb-jarvisOS/issues/103) · M9-F03 Worktree, preflight e Docker | entregue no PR #211; emendas e evidência preservadas |
| Finalizado | #99, #101 e #102 | aceite do PI registrado; M9-F02 integrada pelo PR #208 |
| Backlog | M7-F01–F06 (#180–#185), MVPs 010–015 e M16-F01–F04 | SPECs aprovadas; publicação documental não muda fila |
| Backlog | M16-F05/F06 (#167/#168), MVP-023 e MVP-024 | dez SPECs `aprovada-pi` em 2026-08-31; aceite não altera `next` nem inicia construção fora da fila |
| Planejado | M7-F07–F08 (#186–#187) a redigir | Fora do fechamento da V3; redação não autoriza construção |
| Roadmap preservado | Command Center (MVP-017–021) e Shell (MVP-022) | decisões e issues da main preservadas; não renumerados |

## MVPs

| MVP | Issue | Estado | Progresso |
|---|---|---|---|
| MVP-001 Fundação | [#1](https://github.com/RodReis/rrb-jarvisOS/issues/1) | fechado/aceito | 6/6 |
| MVP-002 Execução local | [#9](https://github.com/RodReis/rrb-jarvisOS/issues/9) | fechado/aceito | 5/5 |
| MVP-003 Design System | [#16](https://github.com/RodReis/rrb-jarvisOS/issues/16) | fechado/aceito | 8/8 |
| MVP-004 Execução real | [#10](https://github.com/RodReis/rrb-jarvisOS/issues/10) | fechado/aceito pelo PI em 2026-08-31 | 3/3 |
| MVP-005 Providers/Vault/Budget | [#76](https://github.com/RodReis/rrb-jarvisOS/issues/76) | fechado/aceito pelo PI em 2026-08-31 | 4/4 |
| MVP-006 Conectores Essenciais | [#86](https://github.com/RodReis/rrb-jarvisOS/issues/86) | fechado/aceito pelo PI em 2026-08-31 | 6/6 |
| MVP-007 Memória compartilhada | [#179](https://github.com/RodReis/rrb-jarvisOS/issues/179) | F01–F06 aprovadas/Backlog; F07–F08 Planejadas, fora do fechamento V3 | 0/8 |
| MVP-008 Planejamento Governado | [#93](https://github.com/RodReis/rrb-jarvisOS/issues/93) | fechado/aceito pelo PI em 2026-08-31 | 6/6 |
| MVP-009 Entrega Autônoma | [#100](https://github.com/RodReis/rrb-jarvisOS/issues/100) | seis SPECs `aprovada-pi` (2026-08-29), **emendadas pelo PI em 2026-08-30 e 2026-08-31**; F01–F05 aceitas, F06 entregue no PR #236. **PI declarou o MVP finalizado em 2026-09-03**; fechamento de #100 é ato dele | 6/6 |
| MVP-010 Multi-executor Claude + Codex | [#115](https://github.com/RodReis/rrb-jarvisOS/issues/115) | fatias [#116–#120](https://github.com/RodReis/rrb-jarvisOS/issues/116) no Backlog; **M10-F02 ([#117](https://github.com/RodReis/rrb-jarvisOS/issues/117)) puxada para antes da M26-F06** (decisão do PI, 2026-09-04) | 0/5 |
| MVP-011 Squads limitados | [#121](https://github.com/RodReis/rrb-jarvisOS/issues/121) | fatias [#122–#126](https://github.com/RodReis/rrb-jarvisOS/issues/122) no Backlog | 0/5 |
| MVP-012 Scheduler concorrente | [#127](https://github.com/RodReis/rrb-jarvisOS/issues/127) | fatias [#128–#132](https://github.com/RodReis/rrb-jarvisOS/issues/128) no Backlog | 0/5 |
| MVP-013 Execução contínua | [#133](https://github.com/RodReis/rrb-jarvisOS/issues/133) | fatias [#134–#138](https://github.com/RodReis/rrb-jarvisOS/issues/134) no Backlog | 0/5 |
| MVP-014 Release e Deploy Governado | [#149](https://github.com/RodReis/rrb-jarvisOS/issues/149) | cinco SPECs `aprovada-pi`; fatias #150–#154 em Backlog | 0/5 |
| MVP-015 Observabilidade Operacional | [#155](https://github.com/RodReis/rrb-jarvisOS/issues/155) | seis SPECs `aprovada-pi`; fatias #156–#161 em Backlog | 0/6 |
| MVP-016 Aprendizado Operacional da Pipeline | [#162](https://github.com/RodReis/rrb-jarvisOS/issues/162) | seis SPECs `aprovada-pi`; #163–#168 em Backlog | 0/6 |
| MVP-017 a MVP-021 (Command Center) | [#193](https://github.com/RodReis/rrb-jarvisOS/issues/193) · [#194](https://github.com/RodReis/rrb-jarvisOS/issues/194) · [#195](https://github.com/RodReis/rrb-jarvisOS/issues/195) · [#196](https://github.com/RodReis/rrb-jarvisOS/issues/196) · [#197](https://github.com/RodReis/rrb-jarvisOS/issues/197) | 5 épicos criados em 2026-08-30, aprovados pelo PI na mesma data (HA removido; voz local Whisper+Piper): voz+persona+mascote, escuta contínua, briefing/proatividade, integrações Gmail/Agenda/Spotify, visão Frigate. Fatias lazy; SPECs da M17-F01 (#200), M17-F02 (#202) e M17-F03 `aprovada-pi` (2026-08-30), demais sem SPEC; docs em `docs/mvp/mvp-017…021` | 0/18 |
| MVP-022 Shell de produto | [#205](https://github.com/RodReis/rrb-jarvisOS/issues/205) | menu do JARVIS/Agents OS projetado do registro de módulos; **SPEC da F01 `aprovada-pi` (2026-08-30)**, oito decisões do PI; entra depois do MVP-026 | 0/1 |
| MVP-023 Biblioteca de Blueprints | [#212](https://github.com/RodReis/rrb-jarvisOS/issues/212) | quatro SPECs `aprovada-pi`; #214–#217 em Backlog | 0/4 |
| MVP-024 Gestão de Portfólio | [#213](https://github.com/RodReis/rrb-jarvisOS/issues/213) | quatro SPECs `aprovada-pi`; #218–#221 em Backlog | 0/4 |
| MVP-025 Jornada de planejamento por IA | [#237](https://github.com/RodReis/rrb-jarvisOS/issues/237) | corrige o fluxo inicial do MVP-008. **M25-F01 a F05 aceitas pelo PI em 2026-09-03** (`proplan:finalizado`); fechamento do épico é ato dele; doc em `docs/mvp/mvp-025-jornada-planejamento-ia.md` | 5/5 |
| MVP-026 Fases, modelo por fase e console da geração | [#250](https://github.com/RodReis/rrb-jarvisOS/issues/250) | criado em 2026-09-04; corrige a superfície do MVP-025 (fase no card, modelo por fase, console com ferramentas, marcos Git antes da Construção, Codex no ponto único). seis SPECs `aprovada-pi`; doc em `docs/mvp/mvp-026-fases-modelos-e-console.md` | 0/6 |

## Índice Fatia ↔ SPEC

Não existe catálogo global `SPEC-nnn`. O slug identifica a SPEC; os números abaixo não são reaproveitados. Uma SPEC `rascunho-completo` ainda não autoriza construção.

| Índice | MVP | Fatia | SPEC |
|---|---|---|---|
| F01–F06 | MVP-001 | Bootstrap · AppShell · Auth · Dados · Settings · Observabilidade | `spec-fundacao-01..06` |
| M2-F01–F05 | MVP-002 | Supabase · Policy · Allowlist · Workflows · Simulação | `spec-execucao-local-01..05` |
| M3-F01–F06 | MVP-003 | Infra · Foundations · Componentes a/b · AppShell a/b · Identidades · Hardening | `spec-design-system-01..06` |
| M4-F01 | MVP-004 | Filesystem allowlisted | `spec-execucao-real-01-filesystem-allowlisted.md` |
| M4-F02 | MVP-004 | Terminal controlado | `spec-execucao-real-02-terminal-controlado.md` |
| M4-F03 | MVP-004 | UI da allowlist de diretórios ([#110](https://github.com/RodReis/rrb-jarvisOS/issues/110)) | `spec-execucao-real-03-ui-allowlist-diretorios.md` |
| M5-F01 | MVP-005 | Vault | `spec-providers-01-vault-credenciais.md` |
| M5-F02 | MVP-005 | Adapter Claude | `spec-providers-02-adapter-claude-api.md` |
| M5-F03 | MVP-005 | BudgetPolicy | `spec-providers-03-budget-policy.md` |
| M5-F04 | MVP-005 | Multi-provider | `spec-providers-04-multi-provider-roteamento.md` |
| M6-F01 | MVP-006 | Núcleo de conectores | `spec-conectores-01-nucleo.md` |
| M6-F02 | MVP-006 | Operação e governança | `spec-conectores-02-operacao-governanca.md` |
| M6-F03 | MVP-006 | GitHub App/autenticação | `spec-conectores-03-github-app-autenticacao.md` |
| M6-F04 | MVP-006 | Automação GitHub | `spec-conectores-04-github-automacao.md` |
| M6-F05 | MVP-006 | Tavily Search | `spec-conectores-05-tavily-search.md` |
| M6-F06 | MVP-006 | Tavily Extract/evidências | `spec-conectores-06-tavily-extract-evidencias.md` |
| M7-F01 | MVP-007 | Núcleo, identidade e persistência ([#180](https://github.com/RodReis/rrb-jarvisOS/issues/180)) | `spec-memoria-01-nucleo-identidade-persistencia.md` — aprovada-pi |
| M7-F02 | MVP-007 | Fontes iniciais, ingestão e retomada ([#181](https://github.com/RodReis/rrb-jarvisOS/issues/181)) | `spec-memoria-02-fontes-ingestao-retomada.md` — aprovada-pi |
| M7-F03 | MVP-007 | Recuperação contextual e orçamento ([#182](https://github.com/RodReis/rrb-jarvisOS/issues/182)) | `spec-memoria-03-recuperacao-contextual-orcamento.md` — aprovada-pi |
| M7-F04 | MVP-007 | Retenção e reconstrução da memória ([#183](https://github.com/RodReis/rrb-jarvisOS/issues/183)) | `spec-memoria-04-retencao-reconstrucao.md` — aprovada-pi |
| M7-F05 | MVP-007 | Adapter opcional do Graphify ([#184](https://github.com/RodReis/rrb-jarvisOS/issues/184)) | `spec-memoria-05-adapter-graphify.md` — aprovada-pi |
| M7-F06 | MVP-007 | Memória operacional e validação de lições ([#185](https://github.com/RodReis/rrb-jarvisOS/issues/185)) | `spec-memoria-06-validacao-licoes-operacionais.md` — aprovada-pi |
| M7-F07 | MVP-007 | Agent Memory e Notebook ([#186](https://github.com/RodReis/rrb-jarvisOS/issues/186)) | a redigir |
| M7-F08 | MVP-007 | Resiliência e prova integrada ([#187](https://github.com/RodReis/rrb-jarvisOS/issues/187)) | a redigir |
| M8-F01 | MVP-008 | Projeto e Git local | `spec-planejamento-01-projeto-git-local.md` |
| M8-F02 | MVP-008 | Contexto, skills e orçamento | `spec-planejamento-02-contexto-skills-orcamento.md` |
| M8-F03 | MVP-008 | Wizard orientado | `spec-planejamento-03-wizard-orientado.md` |
| M8-F04 | MVP-008 | PRD/Landscape/Convention | `spec-planejamento-04-prd-landscape-convention.md` |
| M8-F05 | MVP-008 | Anexos/design/arquitetura | `spec-planejamento-05-anexos-design-arquitetura.md` |
| M8-F06 | MVP-008 | Roadmap e aprovações | `spec-planejamento-06-roadmap-aprovacoes.md` |
| M9-F01 | MVP-009 | Publicação GitHub | `spec-entrega-01-publicacao-github.md` |
| M9-F02 | MVP-009 | DAG/fila/reconciliação | `spec-entrega-02-dag-fila-reconciliacao.md` |
| M9-F03 | MVP-009 | Worktree/preflight/Docker | `spec-entrega-03-worktree-preflight-docker.md` |
| M9-F04 | MVP-009 | Construção/recuperação | `spec-entrega-04-construcao-recuperacao.md` |
| M9-F05 | MVP-009 | Revisão/CI/merge | `spec-entrega-05-revisao-ci-merge.md` |
| M9-F06 | MVP-009 | Evidência/limpeza | `spec-entrega-06-evidencia-limpeza-continuidade.md` |
| M10-F01 | MVP-010 | Runtime de executores ([#116](https://github.com/RodReis/rrb-jarvisOS/issues/116)) | `spec-multi-executor-01-runtime.md` |
| M10-F02 | MVP-010 | Autenticação Codex ([#117](https://github.com/RodReis/rrb-jarvisOS/issues/117)) | `spec-multi-executor-02-autenticacao-codex.md` — aprovada-pi; **emendada em 2026-09-04** (dependência da F01 só para o mount; sobe para antes da M26-F06) |
| M10-F03 | MVP-010 | Codex Exec Adapter ([#118](https://github.com/RodReis/rrb-jarvisOS/issues/118)) | `spec-multi-executor-03-codex-exec-adapter.md` |
| M10-F04 | MVP-010 | Roteamento e revisão cruzada ([#119](https://github.com/RodReis/rrb-jarvisOS/issues/119)) | `spec-multi-executor-04-roteamento-revisao-cruzada.md` |
| M10-F05 | MVP-010 | UI e prova operacional ([#120](https://github.com/RodReis/rrb-jarvisOS/issues/120)) | `spec-multi-executor-05-ui-prova-operacional.md` |
| M11-F01 | MVP-011 | Capacidades e perfis ([#122](https://github.com/RodReis/rrb-jarvisOS/issues/122)) | `spec-squads-01-capacidades-perfis.md` |
| M11-F02 | MVP-011 | Planejador e validador ([#123](https://github.com/RodReis/rrb-jarvisOS/issues/123)) | `spec-squads-02-planejador-validador.md` |
| M11-F03 | MVP-011 | Workers isolados ([#124](https://github.com/RodReis/rrb-jarvisOS/issues/124)) | `spec-squads-03-workers-isolados.md` |
| M11-F04 | MVP-011 | Revisão independente ([#125](https://github.com/RodReis/rrb-jarvisOS/issues/125)) | `spec-squads-04-revisao-independente.md` |
| M11-F05 | MVP-011 | Orçamento, cancelamento e E2E ([#126](https://github.com/RodReis/rrb-jarvisOS/issues/126)) | `spec-squads-05-orcamento-cancelamento-e2e.md` |
| M12-F01 | MVP-012 | Pool global e fila ([#128](https://github.com/RodReis/rrb-jarvisOS/issues/128)) | `spec-scheduler-01-pool-fila.md` |
| M12-F02 | MVP-012 | Independência e locks ([#129](https://github.com/RodReis/rrb-jarvisOS/issues/129)) | `spec-scheduler-02-independencia-locks.md` |
| M12-F03 | MVP-012 | Isolamento concorrente ([#130](https://github.com/RodReis/rrb-jarvisOS/issues/130)) | `spec-scheduler-03-isolamento-concorrente.md` |
| M12-F04 | MVP-012 | Merge serializado ([#131](https://github.com/RodReis/rrb-jarvisOS/issues/131)) | `spec-scheduler-04-merge-serializado.md` |
| M12-F05 | MVP-012 | Recuperação e E2E ([#132](https://github.com/RodReis/rrb-jarvisOS/issues/132)) | `spec-scheduler-05-recuperacao-e2e.md` |
| M13-F01 | MVP-013 | Inventário e DAG ([#134](https://github.com/RodReis/rrb-jarvisOS/issues/134)) | `spec-continuo-01-inventario-dag.md` |
| M13-F02 | MVP-013 | Dispatcher e retomada ([#135](https://github.com/RodReis/rrb-jarvisOS/issues/135)) | `spec-continuo-02-dispatcher-retomada.md` |
| M13-F03 | MVP-013 | Controles operacionais ([#136](https://github.com/RodReis/rrb-jarvisOS/issues/136)) | `spec-continuo-03-controles-operacionais.md` |
| M13-F04 | MVP-013 | Projeções e gates ([#137](https://github.com/RodReis/rrb-jarvisOS/issues/137)) | `spec-continuo-04-projecoes-gates.md` |
| M13-F05 | MVP-013 | Jornada multi-MVP ([#138](https://github.com/RodReis/rrb-jarvisOS/issues/138)) | `spec-continuo-05-jornada-multi-mvp.md` |
| M14-F01 | MVP-014 | Núcleo de release e fila ([#150](https://github.com/RodReis/rrb-jarvisOS/issues/150)) | `spec-release-01-nucleo-estados-fila.md` |
| M14-F02 | MVP-014 | Docker, artefatos e configuração ([#151](https://github.com/RodReis/rrb-jarvisOS/issues/151)) | `spec-release-02-compose-artefatos-config.md` |
| M14-F03 | MVP-014 | Preview isolado por PR ([#152](https://github.com/RodReis/rrb-jarvisOS/issues/152)) | `spec-release-03-preview-isolado.md` |
| M14-F04 | MVP-014 | Staging e Produção automática ([#153](https://github.com/RodReis/rrb-jarvisOS/issues/153)) | `spec-release-04-staging-producao.md` |
| M14-F05 | MVP-014 | Compensação, retorno à V2 e E2E ([#154](https://github.com/RodReis/rrb-jarvisOS/issues/154)) | `spec-release-05-recuperacao-e2e.md` |
| M15-F01 | MVP-015 | Núcleo de eventos, outbox e projeções ([#156](https://github.com/RodReis/rrb-jarvisOS/issues/156)) | `spec-observabilidade-01-eventos-outbox-projecoes.md` |
| M15-F02 | MVP-015 | Reconciliação, saúde, custos e quotas ([#157](https://github.com/RodReis/rrb-jarvisOS/issues/157)) | `spec-observabilidade-02-reconciliacao-saude-custos-quotas.md` |
| M15-F03 | MVP-015 | Alertas e notificações ([#158](https://github.com/RodReis/rrb-jarvisOS/issues/158)) | `spec-observabilidade-03-alertas-notificacoes.md` |
| M15-F04 | MVP-015 | Consultas, retenção, rollups e CLI ([#159](https://github.com/RodReis/rrb-jarvisOS/issues/159)) | `spec-observabilidade-04-consultas-retencao-cli.md` |
| M15-F05 | MVP-015 | Console operacional ([#160](https://github.com/RodReis/rrb-jarvisOS/issues/160)) | `spec-observabilidade-05-console-operacional.md` |
| M15-F06 | MVP-015 | Resiliência, desempenho e prova E2E ([#161](https://github.com/RodReis/rrb-jarvisOS/issues/161)) | `spec-observabilidade-06-resiliencia-desempenho-e2e.md` |
| M16-F01 | MVP-016 | Fundação e ingestão ([#163](https://github.com/RodReis/rrb-jarvisOS/issues/163)) | `spec-aprendizado-01-fundacao-ingestao.md` |
| M16-F02 | MVP-016 | Memória de falhas ([#164](https://github.com/RodReis/rrb-jarvisOS/issues/164)) | `spec-aprendizado-02-memoria-falhas.md` |
| M16-F03 | MVP-016 | Registro e resolução de políticas ([#165](https://github.com/RodReis/rrb-jarvisOS/issues/165)) | `spec-aprendizado-03-registro-resolucao-politicas.md` |
| M16-F04 | MVP-016 | Experimentos e promoção ([#166](https://github.com/RodReis/rrb-jarvisOS/issues/166)) | `spec-aprendizado-04-experimentos-promocao.md` |
| M16-F05 | MVP-016 | Estratégias e recomendações assistidas ([#167](https://github.com/RodReis/rrb-jarvisOS/issues/167)) | `spec-aprendizado-05-estrategias-recomendacoes.md` — aprovada-pi |
| M16-F06 | MVP-016 | Interface, resiliência e prova E2E ([#168](https://github.com/RodReis/rrb-jarvisOS/issues/168)) | `spec-aprendizado-06-interface-resiliencia-e2e.md` — aprovada-pi; gate visual antes da construção |
| M17-F01 | MVP-017 | STT local + push-to-talk | `spec-voz-01-stt-local-push-to-talk.md` |
| M17-F02 | MVP-017 | TTS Piper + timeline de visemes | `spec-voz-02-tts-piper-fonemas.md` |
| M17-F03 | MVP-017 | Persona JARVIS no ponto único | `spec-voz-03-persona-ponto-unico.md` |
| M22-F01 | MVP-022 | Menu JARVIS OS / Agents OS | `spec-shell-01-menu-jarvis-agents-os.md` |

| M23-F01 | MVP-023 | Catálogo e revisões de Blueprints ([#214](https://github.com/RodReis/rrb-jarvisOS/issues/214)) | `spec-blueprints-01-catalogo-revisoes.md` — aprovada-pi |
| M23-F02 | MVP-023 | Instanciação e wizard orientado ([#215](https://github.com/RodReis/rrb-jarvisOS/issues/215)) | `spec-blueprints-02-instanciacao-wizard.md` — aprovada-pi |
| M23-F03 | MVP-023 | Anexos, compatibilidade e evolução ([#216](https://github.com/RodReis/rrb-jarvisOS/issues/216)) | `spec-blueprints-03-anexos-compatibilidade.md` — aprovada-pi |
| M23-F04 | MVP-023 | Interface e prova integrada de Blueprints ([#217](https://github.com/RodReis/rrb-jarvisOS/issues/217)) | `spec-blueprints-04-interface-resiliencia-e2e.md` — aprovada-pi; gate visual antes da construção |
| M24-F01 | MVP-024 | Catálogo e prontidão do portfólio ([#218](https://github.com/RodReis/rrb-jarvisOS/issues/218)) | `spec-portfolio-01-catalogo-prontidao.md` — aprovada-pi |
| M24-F02 | MVP-024 | Prioridade e controles canônicos ([#219](https://github.com/RodReis/rrb-jarvisOS/issues/219)) | `spec-portfolio-02-prioridade-controles.md` — aprovada-pi |
| M24-F03 | MVP-024 | Custos, quotas e capacidade do portfólio ([#220](https://github.com/RodReis/rrb-jarvisOS/issues/220)) | `spec-portfolio-03-custos-quotas.md` — aprovada-pi |
| M24-F04 | MVP-024 | Console de portfólio e prova integrada ([#221](https://github.com/RodReis/rrb-jarvisOS/issues/221)) | `spec-portfolio-04-console-resiliencia-e2e.md` — aprovada-pi; gate visual antes da construção |
| M25-F01 | MVP-025 | Estado do projeto e jornada única ([#238](https://github.com/RodReis/rrb-jarvisOS/issues/238)) | `spec-jornada-01-estado-e-jornada-unica.md` — aprovada-pi; **entregue** (gate visual cumprido em 2026-09-03) |
| M25-F02 | MVP-025 | Prompt e brief refinado por IA ([#239](https://github.com/RodReis/rrb-jarvisOS/issues/239)) | `spec-jornada-02-prompt-e-brief-por-ia.md` — aprovada-pi; **entregue** (gate visual cumprido em 2026-09-03) |
| M25-F03 | MVP-025 | PRD, Landscape e Convention por IA ([#240](https://github.com/RodReis/rrb-jarvisOS/issues/240)) | `spec-jornada-03-prd-landscape-convention-por-ia.md` — aprovada-pi; **entregue** |
| M25-F04 | MVP-025 | Arquitetura por IA após os anexos ([#241](https://github.com/RodReis/rrb-jarvisOS/issues/241)) | `spec-jornada-04-arquitetura-por-ia.md` — aprovada-pi; **entregue** |
| M25-F05 | MVP-025 | Roadmap, MVPs e SPEC por IA ([#242](https://github.com/RodReis/rrb-jarvisOS/issues/242)) | `spec-jornada-05-roadmap-mvp-spec-por-ia.md` — aprovada-pi; **entregue** |
| M26-F01 | MVP-026 | Fase do projeto e card completo ([#251](https://github.com/RodReis/rrb-jarvisOS/issues/251)) | `spec-fases-01-fase-e-card-do-projeto.md` — aprovada-pi; **em andamento**; gate visual antes de fechar |
| M26-F02 | MVP-026 | Catálogo de modelos e modelo por fase ([#252](https://github.com/RodReis/rrb-jarvisOS/issues/252)) | `spec-fases-02-catalogo-e-modelo-por-fase.md` — aprovada-pi |
| M26-F03 | MVP-026 | Console da geração ([#253](https://github.com/RodReis/rrb-jarvisOS/issues/253)) | `spec-fases-03-console-da-geracao.md` — aprovada-pi |
| M26-F04 | MVP-026 | Marcos Git visíveis e gate da construção ([#254](https://github.com/RodReis/rrb-jarvisOS/issues/254)) | `spec-fases-04-marcos-git-e-gate-da-construcao.md` — aprovada-pi |
| M26-F05 | MVP-026 | Modelo da fase Construção no run ([#255](https://github.com/RodReis/rrb-jarvisOS/issues/255)) | `spec-fases-05-modelo-da-fase-no-run.md` — aprovada-pi |
| M26-F06 | MVP-026 | Codex como provider do ponto único ([#256](https://github.com/RodReis/rrb-jarvisOS/issues/256)) | `spec-fases-06-codex-no-ponto-unico.md` — aprovada-pi; depende da M10-F02 |

## Decisões do PI no MVP-026 (2026-09-04)

Levantadas depois de o PI usar o app com o MVP-025 aceito. Detalhe em `docs/mvp/mvp-026-fases-modelos-e-console.md`; emenda em `docs/DECISIONS.md`.

1. **Três fases derivadas da etapa** — Planejamento (`prompt`…`pacote-aceito`), Especificação (`roadmap`…`spec-aceita`), Construção (`construcao`). Descartado fase por gate.
2. **Modelo por fase: default no workspace + override por projeto**, auditados. Planejamento/Especificação = Fable 5.1 ou Sol (`gpt-5.6-sol`); Construção = Opus 5 ou `gpt-5.5`. **Fable 5.1 só pela rota de assinatura, nunca pela API.**
3. **Codex vira provider do ponto único** (assinatura do Codex) para Planejamento/Especificação; **M10-F02 sobe na fila**, imediatamente antes da M26-F06. Codex como executor da Construção continua M10-F03/F04.
4. **Modelo da fase Construção chega ao run do MVP-009** em fatia própria (M26-F05); sem modelo por passo do run.
5. **Card:** fase + etapa, gates aceitos (n/5) + data, rota + modelo, pendência/bloqueio.
6. **Console da geração persistido por geração**, ferramentas em nome + resumo + status, painel retrátil na própria etapa.
7. **Marcos Git:** painel na tela do projeto **e** bloqueio no `SLICE_ENTRY` (marco sem commit, blob divergente ou worktree sujo).
8. **Fila:** MVP-026 antes do MVP-022 e do Command Center; [#251](https://github.com/RodReis/rrb-jarvisOS/issues/251) recebe `proplan:next`.
9. "Roteamento por tipo de tarefa" (SPEC-Providers-04) **não é removido** — vira "Avançado"; a jornada não o consome, MVP-007/017/021 consumirão.
10. Ids confirmados: `claude-fable-5-1`; `qwen3:8b`; `gpt-5.6-sol`, `gpt-5.5`, `gpt-5.4` (Codex CLI 0.149.0).
11. **SPEC-Multi-Executor-02 emendada:** a dependência da M10-F01 vale só para o mount no container; a parte de host entra antes da M26-F06. Descartado puxar a M10-F01 e descartado a F06 criar o perfil sozinha.

## Decisões do PI no MVP-025 (2026-09-03)

Levantadas depois de o PI testar o app (`projeto1`) e constatar que o fluxo inicial não era o desenhado em 2026-08-28. Detalhe e causa em `docs/mvp/mvp-025-jornada-planejamento-ia.md`; emenda ao design em `docs/DECISIONS.md`.

1. **Toda geração do planejamento é por IA** (brief, PRD/Landscape/Convention, arquitetura, roadmap e SPEC), com origem por afirmação e `proposto` marcado e cortado item a item pelo PI. Reverte o "compor em vez de gerar" da M8-F04.
2. **Três aceites antes da construção:** `BRIEF_ACCEPTED`, `PRD_ACCEPTED` e `PROJECT_PACKAGE`. Landscape e Convention saem com o PRD; arquitetura só depois dos anexos (decisão 9 do design mantida).
3. **Prompt é a primeira etapa após criar o projeto**; projeto sem brief (inclusive `projeto1`) volta para ela sem perder decisões gravadas.
4. **Rota de assinatura (Claude MAX via Claude Code CLI) é a rota da geração**, sem valor monetário no ledger; rota paga só por opt-in explícito, nunca fallback.
5. **Fila:** logo após o MVP-009 fechar, antes do MVP-022 e do Command Center. **As cinco fatias foram entregues e aceitas em 2026-09-03.**
6. Projeto aberto tem **rota própria**; blocos 1 e 9 do `ProjectBriefSchema` pré-preenchidos; PRD aceitável sem pesquisa de mercado (Landscape pendente e visível); termo de pesquisa proposto pela IA e confirmado pelo PI; `DECISIONS.md` gerado registra decisões do PI e propostas da IA como ADRs; no `MVP_ENTRY` o PI escolhe entre os MVPs elegíveis.

## Decisões do PI na M9-F06 (2026-09-02)

Dois pontos abertos foram levantados **antes** de codificar e decididos pelo PI. Os dois mudavam o trabalho, então nenhum foi assumido.

1. **O container do executor passa a nascer com `--rm`.** O critério 5 da SPEC-Entrega-06 exige remover o container, mas `docker rm|rmi|prune|down` casa a política de destrutivos do MVP-004 e abriria `ApprovalRequest` — travando a limpeza automática num gate humano, que é o oposto do desenvolvimento autônomo que esta fatia entrega. Com a flag na criação, `docker stop` já remove, sem tocar a allowlist. As alternativas oferecidas eram liberar `docker rm` (rejeitada: reintroduz o gate humano) e apenas parar, deixando pendência (rejeitada: containers parados acumulariam até alguém limpar à mão). Antes de aplicar, foi verificado que nada na M9-F03 lê logs do container depois que ele para.

2. **A jornada E2E real completa não roda nesta entrega.** A spec a pede em projeto e repositório exclusivos e descartáveis, com orçamento limitado e fora da suíte padrão — o que exige autorização e um repositório do PI. O limite fica **declarado** no `docs/DEVELOPMENT.md`, na mesma postura que a M9-F01 adotou para o smoke real do push autenticado. Marcar como feito o que não rodou seria o fechamento frágil que o processo existe para impedir.

## Decisões do PI na M9-F05 (2026-09-02)

Três pontos abertos foram levantados durante a construção e **decididos pelo PI**, que delegou a escolha ao Code pedindo "o melhor para o desenvolvimento autônomo com agents". Registradas aqui porque mudam comportamento e não podem virar escolha silenciosa de implementação.

1. **`verificarEscopo` passa a falhar fechado, com causa `externo`.** O fail-open (`if (!status.ok) return { ok: true }`) ficou pendente na M9-F04 e colide com o critério 1 desta fatia — com o `git status` do container falhando, o escopo não é verificado e o push sai. **Não é escopo novo:** a `ARCHITECTURE.md` § Segurança já decide *"fail closed: ação não reconhecida pela política é bloqueada, não permitida"*, e um `git status` que não responde é exatamente isso. A causa é `externo`, não `risco-usuario`: a distinção governa a retomada — `risco-usuario` diz que o agente escreveu fora do escopo, `externo` diz que a ferramenta falhou, e rotular errado mandaria procurar um arquivo indevido que não existe. Em desenvolvimento autônomo, fail-open significa um container degradado publicando sem ninguém ter verificado o escopo.

2. **Teto de espera do CI: configurável por projeto, padrão 30 minutos, terminando em `AWAITING_MERGE`.** A SPEC não fixa quanto o gate aguarda checks pendentes. Estourar o teto não é falha do código — é CI mais lenta que o esperado —, e `BLOCKED` ensinaria a ler bloqueio como ruído, pela mesma razão que a M9-F02 recusou `BLOCKED` para o kill-switch desligado. O PR fica verde ou pendente e o run termina explicável, o que mantém a fila girando: com WIP=1 global, um run preso esperando CI eterna trava todos os outros.

3. **O check obrigatório é `validacao`, e a pipeline o exige na proteção no mesmo run em que gera o workflow.** Correção ao plano original, que previa terminar em bloqueio quando a proteção não exigisse o nome gerado: a M9-F01 já escreve a proteção via `branch.ensure-protection`, que aceita `checksExigidos`. Então a pipeline não inventa nome nem depende de alguém ter configurado à mão — ela declara `validacao` como obrigatório junto com o workflow, fechando os critérios 9 e 10 sem intervenção humana, que é o requisito do desenvolvimento autônomo. Contexts que o projeto já exija **somam**, não são substituídos, e o gate espera por todos.

## Próximas ações

1. **Em andamento: [#251](https://github.com/RodReis/rrb-jarvisOS/issues/251) (M26-F01)**, `proplan:doing` desde 2026-09-04; a cabeça da fila avançou para [#252](https://github.com/RodReis/rrb-jarvisOS/issues/252) (M26-F02, `proplan:next`). Ordem do MVP-026: F01 → F02 → F03 → F04 → F05 → M10-F02 ([#117](https://github.com/RodReis/rrb-jarvisOS/issues/117)) → F06 ([#256](https://github.com/RodReis/rrb-jarvisOS/issues/256)). Todas em Backlog. MVP-025: filhas `proplan:finalizado`; fechamento do épico #237 é ato do PI. MVP-022 e Command Center vêm depois do MVP-026.
2. **Risco registrado:** a SPEC-Blueprints-02 (M23-F02) referencia o wizard da M8-F03, que a M25-F02 substitui por perguntas geradas — emenda a fazer quando o MVP-023 entrar na fila.
3. **#106 (M9-F06) entregue por PR — a última fatia do MVP-009.** Aceite formal do PI pendente na issue. **#105 (M9-F05) foi aceita em 2026-09-02** e entregue no PR #235. Os limites declarados da F06 estão no `docs/DEVELOPMENT.md` § Fatia 06 — o principal é a jornada E2E real completa, que **não rodou** por decisão do PI e continua exigindo repositório descartável e orçamento autorizado.
4. Conservar #167/#168 e #214–#221 em Backlog após o aceite exato de 2026-08-31, sem promover qualquer uma a `next` por esta atualização. #232 (`[INFRA][FIX]` do pool de testes) também nasce em Backlog, sem entrar na fila por conta própria.
5. Antes das fatias visuais, anexar `DESIGN-SYSTEM.md` e HTML pelo fluxo já aprovado; texto de SPEC/template não substitui anexo do PI.
6. M7-F05/F06 estão aprovadas/Backlog e M7-F07–F08 continuam a redigir; as fatias do Command Center seguem seus planejamentos próprios. Nenhuma delas bloqueia concluir a documentação V3.
7. O relatório de fechamento do PR #189 documenta reconciliação, ordem técnica, issues e validação. Aprovações prévias são preservadas, não repetidas.

## Roadmap

Base entregue → MVP-009 (finalizado) → MVP-025 (aceito) → **MVP-026 Fases, modelo por fase e console** (com a M10-F02 antes da M26-F06) → Shell MVP-022 → Command Center MVP-017 → MVP-018/MVP-019 → MVP-020 → MVP-021 (decisão do PI de 2026-09-04: o MVP-026 passa na frente do Shell e do Command Center). MVP-010–016 seguem a prioridade já definida pelo PI, sem ultrapassar essa sequência por causa deste PR.

V3: MVP-014 → MVP-015 → MVP-016; MVP-023 Blueprints depende de MVP-008; MVP-024 Portfólio depende de MVP-012/MVP-015. Ordem de apresentação 014, 015, 016, 023, 024 não cria dependência técnica entre Blueprints e Portfólio. MVP-007 permanece paralelo/não bloqueante.
