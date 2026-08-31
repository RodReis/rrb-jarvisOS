# MVP-009 — Entrega Autônoma

- Status: **as seis SPECs `aprovada-pi` em 2026-08-29** — revisão de perguntas abertas concluída com o PI; fatias liberadas para o Backlog, no fim da fila.
- GitHub: épico [#100](https://github.com/RodReis/rrb-jarvisOS/issues/100); fatias [#101–#106](https://github.com/RodReis/rrb-jarvisOS/issues/101), estado `proplan:backlog`.
- Depende de: MVP-005, MVP-006 e MVP-008 concluídos.
- Não depende de: MVP-007.
- Resultado: uma fatia aprovada percorre publicação, construção, PR, CI, merge e prova sem aceite duplicado.
- **Pendência herdada do MVP-008, resolvida nesta revisão:** a consulta a documentação técnica (Context7) vive na **M9-F04**, como ferramenta do agente construtor via MCP. O aplicativo não expõe Context7 como conector.

## Tese

Executar somente o que foi aprovado, em worktree isolado, com WIP=1, Git automático, até duas recuperações e reconciliação após reinício. Claude Code é o primeiro executor pelo adapter do MVP-005. O GitHub Adapter do MVP-006 realiza os efeitos remotos.

## Fatias

| Índice | SPEC | Resultado |
|---|---|---|
| M9-F01 | `spec-entrega-01-publicacao-github.md` | Repositório e issues idempotentes |
| M9-F02 | `spec-entrega-02-dag-fila-reconciliacao.md` | DAG, leases e retomada |
| M9-F03 | `spec-entrega-03-worktree-preflight-docker.md` | Isolamento, contexto e recursos |
| M9-F04 | `spec-entrega-04-construcao-recuperacao.md` | Construção e tentativas controladas |
| M9-F05 | `spec-entrega-05-revisao-ci-merge.md` | Revisão, CI e squash merge automático |
| M9-F06 | `spec-entrega-06-evidencia-limpeza-continuidade.md` | Ledger, limpeza e próxima fatia |

## Decisões estruturais do PI (2026-08-29)

| # | Decisão | Onde |
|---|---|---|
| 1 | **O container Docker é o sandbox do executor** — o Claude Code roda nele, com o worktree montado, nunca no host. A allowlist de comandos do MVP-004 continua governando o terminal do usuário | M9-F03, M9-F04 |
| 2 | **Merge autônomo ligado por padrão, com kill-switch por projeto**; desligado, o run termina no PR verde aguardando o PI | M9-F05 |
| 3 | **Context7 é ferramenta do agente construtor** (MCP) na entrada do executor, não conector do app | M9-F04 |

## Decisões estruturais do PI (2026-08-30) — revisão de furos de spec

| # | Decisão | Onde |
|---|---|---|
| 4 | **O executor autentica por proxy no host**: o container recebe só `ANTHROPIC_BASE_URL`; o main injeta a credencial/sessão e registra no ponto único do MVP-005. "Nenhum segredo entra no container" permanece literal. O proxy é escopo da M9-F03 | M9-F03, M9-F04 |
| 5 | **A pipeline gera o CI do projeto-alvo** (`.github/workflows/ci.yml` a partir dos comandos de validação do pacote) no primeiro PR; **sem check configurado nunca é verde** | M9-F05 |
| 6 | **WIP=1 é slot global**, não por projeto; concorrência é o MVP-012 | M9-F02 |
| 7 | A branch `codex/pipeline-v2-design` (MVP-7, 10–16 e emendas) foi **enviada ao remoto** e vai à `main` por PR de docs; as emendas dela ao MVP-009 que contradizem estas decisões (segredo mínimo no container, WIP global já contemplado) são resolvidas por este documento | processo |

**Por que a decisão 4 importa.** A versão anterior das SPECs proibia qualquer segredo no container e, ao mesmo tempo, mandava o Claude Code rodar nele — a assinatura MAX vive em `~/.claude` do host, então o executor não teria como chamar modelo nenhum. O proxy resolve sem furar o critério: o segredo fica no main, e toda chamada passa pelo mesmo gate de orçamento e ledger das outras rotas.

**Por que a decisão 5 importa.** `checksAprovam` da M6-F04 recusa lista vazia por decisão registrada (verde sem verificador é mentira). O projeto gerado pelo MVP-008 não nasce com CI; sem alguém criá-lo, nenhum run chegaria a `MERGED`.

**Por que a decisão 1 importa.** O MVP-004 criou a allowlist de comandos para o app não rodar comando arbitrário. Um agente que constrói software precisa rodar comando arbitrário — a allowlist não pode governá-lo sem inviabilizá-lo. Sem uma fronteira nova, o MVP-009 seria um caminho para executar qualquer coisa na máquina, passando por cima do enforcement que o MVP-004 entregou. O container é essa fronteira.

## Dependências duras registradas

- **Docker é dependência dura do MVP-009.** Ausente ou incapaz de subir ⇒ `BLOCKED_EXTERNAL` com ação; **nunca** há fallback para executar no host.
- Depende do MVP-008 concluído (projeto, pacote aprovado, Git local) e do MVP-006 (GitHub Adapter).

## Invariantes

- Nenhum código é construído sem MVP e SPEC aprovados.
- Checkout ativo do usuário nunca é usado pelo executor.
- Documento ou ADR auxiliar não bloqueia código depois do gate de entrada.
- Requisito de produto não é inventado.
- CI verde precisa corresponder ao `head SHA` mergeado.
- Reinício não duplica commit, issue, PR ou merge.
- Merge técnico não cria outro aceite do PI.
- O executor roda em container; nenhum segredo entra nele (modelo via proxy no host) e ele nunca fala com o GitHub (egress negado, não só instrução).
- Validação disparada pelo app roda no container, nunca no host.
- Kill-switch desligado termina em `AWAITING_MERGE`, não em `BLOCKED`.

## Done do MVP

- Jornada real controlada termina em `MERGED` ou `BLOCKED` explicável.
- Falha corrigível usa o mesmo PR e respeita três tentativas totais.
- Estado externo é confirmado antes de declarar sucesso.
- Evidências, custos e SHAs são registrados.
- Worktree, leases, containers e portas temporários são reconciliados.
