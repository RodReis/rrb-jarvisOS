# SPEC-Squads-05 — Quadro de execução, play e PR/MERGE

- MVP: `docs/mvp/mvp-011-squads-limitados.md` (Fatia 05).
- Issue: criada pelo Cowork quando esta SPEC for aprovada; épico [#121](https://github.com/RodReis/rrb-jarvisOS/issues/121).
- Status: **planejado** — redigida em 2026-10-02 pela ADR-006 (decisões 8, 9 e 11).
- Depende de: M11-F04.

## Objetivo

Dar ao PI um quadro de execução do projeto em que ele escolhe o que roda (play) e vê o estágio real de cada issue, inclusive a espera da PR. Isso acaba com a falsa percepção de "ainda em teste".

## Dentro

- **Quadro local do projeto**, como projeção do run, com as colunas **A fazer → DEVELOPER → TESTE → REVIEWER → PR/MERGE → DONE → Finalizado (PI)**.
- **Play** em uma issue ou em várias selecionadas **do mesmo MVP** em "A fazer". Cada issue ganha seu worktree e segue o fluxo.
- Issue com dependência não satisfeita ou sem prova de independência espera em "A fazer" com o motivo visível; não há salto.
- Coluna **PR/MERGE** alimentada pelo estado real dos checks e do merge, consultado pelo kernel a cada transição e periodicamente. O card mostra o check pendente, o tempo de espera e a última consulta.
- **Selo "Aguardando PI"** no card, que fica na coluna atual com o motivo, para alteração estrutural de banco e comando destrutivo. Aprovar ou recusar no próprio card, com `AuditEvent`.
- Card com camada de modelo e escritores ativos, tentativas usadas, achados abertos e link do console da geração (MVP-026).
- RF-014.1: a equipe da issue (agentes, papéis, objetivo, workflow padrão, limite de custo) visível e acionada pelo play.

## Fora

- Labels novos no GitHub; a issue segue `proplan:todo → doing → done` (contrato do `CONVENTION.md`).
- Play de issues de MVPs diferentes num mesmo disparo.
- Mover issue para "Finalizado" (só o PI, como hoje).
- Priorização automática ou reordenação de "A fazer".
- Acionamento por automação (RF-014.2, MVP-013) e performance por equipe (RF-014.3, MVP-015).

## Regras

1. A coluna mostra o estado registrado pelo kernel, nunca o inferido de silêncio de watcher.
2. A consulta de checks que falha aparece como "estado desconhecido desde HH:MM", nunca como "em andamento".
3. O play não cria issue, não move `proplan:next` e não altera a fila do `STATUS.md`.
4. A transição para DONE exige merge confirmado na origem.
5. O renderer recebe o quadro por IPC tipado e mínimo; não executa comando.

## Critérios de aceite

1. Play de uma issue e de três do mesmo MVP cria um worktree por issue e respeita dependências e slots.
2. Uma issue com CI rodando aparece em PR/MERGE, não em TESTE, com o check pendente visível.
3. Falha de consulta ao GitHub aparece como estado desconhecido com horário.
4. Card com ação que exige aprovação fica com o selo e não avança sem decisão do PI; a decisão é auditada.
5. Reabrir o app reconstrói o quadro a partir do ledger, sem estado só em memória.

## Testes e evidência

- testes de projeção (ledger → coluna) por estado, incluindo falha de consulta;
- teste de tela do quadro e do selo;
- E2E do play múltiplo com dependência bloqueando a segunda issue.

## Perguntas abertas ao PI

1. Intervalo da consulta periódica dos checks em PR/MERGE (a proposta é 60 s; a decisão é sua).
