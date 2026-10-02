# MVP-028 — Quadro de execução e governança dos Squads

- Status: **criado em 2026-10-02 pela partição do MVP-011 ([ADR-006](../adr/adr-006-squads-orquestrados-modelo-local.md), decisão 14); aguarda o "aprovado" do PI.**
- GitHub: épico criado pelo Cowork na aprovação; F01 ganha issue nova; F02 reaproveita [#126](https://github.com/RodReis/rrb-jarvisOS/issues/126) (retitulada).
- Depende de: MVP-011 concluído.
- Dono do aceite: PI.

**Dimensionamento:** T-médio (7 pts: 2 fatias + IPC + migração + 2 provas novas + superfície sensível) ·
R-alto (6 pts: irrev. 1, segurança 3, alcance 2, incerteza 0)

Conta por fatia: F01 = 1 + IPC + migração (estágio do run, se não couber no ledger) + prova nova (visual do quadro); F02 = 1 + sensível (Policy Engine/auditoria das aprovações) + prova nova (E2E multi-escritor com crash). R-alto exige ADR e prova antes da primeira fatia: a ADR-006 cobre a decisão, e a prova é o MVP-011 concluído (F00 aprovada e núcleo entregue), do qual este MVP depende.

## Tese

O PI escolhe o que roda e vê o estágio real de cada issue, inclusive a espera da PR. Os Squads orquestrados ganham tetos agregados, aprovação do PI para ações críticas, cancelamento em cascata e prova E2E.

## Fatias

| Ordem | Fatia | SPEC | Dependência | Issue |
|---:|---|---|---|---|
| 1 | Quadro de execução, play e PR/MERGE | `spec-execucao-01-quadro-play-pr-merge.md` | MVP-011 | nova |
| 2 | Tetos, aprovações do PI, cancelamento e E2E | `spec-execucao-02-tetos-aprovacoes-cancelamento-e2e.md` | F01 | #126 |

## Dentro

- quadro local A fazer → DEVELOPER → TESTE → REVIEWER → PR/MERGE → DONE → Finalizado (PI);
- play de uma issue ou de várias do mesmo MVP, um worktree por issue;
- PR/MERGE pelo estado real dos checks (consulta a cada transição e a cada 60 s);
- selo "Aguardando PI" para alteração estrutural de banco e comando destrutivo; deploy registrado;
- tetos agregados, cancelamento em cascata, limpeza e E2E;
- RF-014.1 (parte de acionamento manual pelo play).

## Fora

- labels novos no GitHub; priorização automática; play entre MVPs diferentes;
- RF-014.2 → MVP-013; RF-014.3 → MVP-015.

## Done

1. O quadro mostra o estágio real, inclusive a espera do CI em PR/MERGE, e se reconstrói do ledger.
2. Ação que exige o PI nunca executa sem aprovação registrada.
3. Cancelar o run encerra orquestrador, workers, escritores, integrador e consultas, preservando a evidência.
4. O E2E prova que só o kernel executou Git e que cada escritor tocou só seu worktree.

## Perguntas abertas ao PI

Nenhuma além da aprovação desta revisão.
