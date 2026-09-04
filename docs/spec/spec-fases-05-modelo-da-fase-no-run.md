# SPEC-Fases-05 — Modelo da fase Construção no run

- MVP/Fatia: MVP-026 · M26-F05.
- Issue: [#255](https://github.com/RodReis/rrb-jarvisOS/issues/255); épico [#250](https://github.com/RodReis/rrb-jarvisOS/issues/250).
- Status: **aprovada-pi** (2026-09-04) — perguntas respondidas pelo PI nesta data, antes da redação.
- Depende de: M26-F02 (`modeloDaFase`); M9-F03 (preflight, Docker), M9-F04 (construção, proxy do executor), M9-F06 (`ExecutionLedger`).

## Objetivo

Fazer o run de construção do MVP-009 usar o **modelo escolhido para a fase Construção** — hoje o Claude Code dentro do container usa o default do CLI — e registrar qual foi, por tentativa, no ledger.

## Dentro

- O `ConstrutorService` resolve `modeloDaFase('construcao', rota, override, politica)` **no início do run** e congela o par `{ provider, modelo }` no snapshot da tentativa (mesma postura de "cada run congela seu snapshot" da ARCHITECTURE § MVP-016). Troca de política durante o run não afeta a tentativa em andamento; vale na próxima.
- O modelo chega ao executor pelo caminho que já existe: argumento `--model <id>` do Claude Code no container (o `docker-runner` monta os args; nada vem de entrada do usuário além do id validado contra o catálogo).
- **Preflight (M9-F03)** ganha um item: modelo fora do catálogo do provider da rota → run não começa, com ação concreta. Rota de assinatura indisponível continua sendo o bloqueio já existente (M9-F04, critério 12), não este.
- `ExecutionLedger` (M9-F06) grava `provider` e `modelo` por tentativa; o painel do estado terminal os mostra.
- Rota paga na Construção só com o opt-in por projeto já existente — esta fatia não cria outro.

## Fora

- Escolher **executor** (Claude Code vs Codex) para o run: M10-F04. Esta fatia entrega o caso de um executor com modelo por fase; a M10-F04 estende.
- Modelo diferente por passo do run (código, teste, commit, PR): o run é uma sessão do executor; separar por passo exigiria quebrar o run — fora, por decisão do PI de 2026-09-04.
- Passar o modelo por variável de ambiente: o `ambienteControlado()` do MVP-004 não deixa variável alcançar o subprocess, e o argumento já é o caminho do adapter no host.

## Critérios de aceite

1. Run iniciado com política editada chama o executor com `--model` igual ao modelo da fase Construção — teste do `docker-runner` com args capturados.
2. Override do projeto vence o workspace no run; sem override, usa o workspace.
3. Snapshot da tentativa carrega `{ provider, modelo }`; mudar a política durante o run não altera a tentativa corrente.
4. Preflight recusa modelo fora do catálogo antes de criar container, com ação.
5. `ExecutionLedger` mostra provider e modelo por tentativa; painel terminal os exibe.
6. Nenhuma chamada sai por rota paga sem opt-in do projeto (teste existente da M9-F04 continua passando com o modelo injetado).

## Testes e evidência

Unitários da resolução e do congelamento no snapshot; int-spec do preflight; teste do `docker-runner` com args capturados; smoke real fica **declarado** nos mesmos termos da M9-F04/F06 (imagem do sandbox sem `claude` — limite conhecido). Relatório `SPEC-Fases-05`.

## Perguntas resolvidas pelo PI (2026-09-04)

1. **Neste MVP, fatia própria** — não esperar a M10-F04. — decidido.
2. **Construção = o run inteiro** (código, teste, commit, PR, merge); sem modelo por passo. — decidido.

## Decisões cravadas pelo Cowork (PI pode vetar)

- **Modelo congelado por tentativa.** Um run que mudasse de modelo no meio teria evidência (ledger, console) que não descreve o que rodou.
