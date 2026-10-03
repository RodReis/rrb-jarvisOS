# MVP-028 — Quadro de execução e governança dos Squads

- Status: **criado em 2026-10-02 pela partição do MVP-011 ([ADR-006](../adr/adr-006-squads-orquestrados-modelo-local.md), decisão 14); revisão aprovada pelo PI em 2026-10-02 (PR #367). Ampliado em 2026-10-02 com a fatia 03 (painel da tarefa, só visualização), a pedido do PI — SPEC aprovada pelo PI; ordem F01 → F03 → F02.**
- GitHub: épico [#368](https://github.com/RodReis/rrb-jarvisOS/issues/368); F01 [#370](https://github.com/RodReis/rrb-jarvisOS/issues/370); F03 [#378](https://github.com/RodReis/rrb-jarvisOS/issues/378); F02 [#126](https://github.com/RodReis/rrb-jarvisOS/issues/126) (retitulada).
- Depende de: MVP-011 concluído.
- Dono do aceite: PI.

**Dimensionamento:** T-médio (10 pts: 3 fatias + 2 IPC + migração + 3 provas novas + superfície sensível) ·
R-alto (6 pts: irrev. 1, segurança 3, alcance 2, incerteza 0)

Conta por fatia: F01 = 1 + IPC + migração (estágio do run, se não couber no ledger) + prova nova (visual do quadro); F02 = 1 + sensível (Policy Engine/auditoria das aprovações) + prova nova (E2E multi-escritor com crash); F03 = 1 + IPC (assinatura do trace por issue) + prova nova (visual do painel). R-alto exige ADR e prova antes da primeira fatia: a ADR-006 cobre a decisão, e a prova é o MVP-011 concluído (F00 aprovada e núcleo entregue), do qual este MVP depende.

## Tese

O PI escolhe o que roda e vê o estágio real de cada issue, inclusive a espera da PR. Os Squads orquestrados ganham tetos agregados, aprovação do PI para ações críticas, cancelamento em cascata e prova E2E.

## Fatias

| Ordem | Fatia | SPEC | Dependência | Issue |
|---:|---|---|---|---|
| 1 | Quadro de execução, play e PR/MERGE | `spec-execucao-01-quadro-play-pr-merge.md` | MVP-011 | #370 |
| 2 | Painel da tarefa: output dos agentes ao vivo (F03) | `spec-execucao-03-painel-da-tarefa.md` | F01 + M26-F03 | #378 |
| 3 | Tetos, aprovações do PI, cancelamento e E2E (F02) | `spec-execucao-02-tetos-aprovacoes-cancelamento-e2e.md` | F01 + F03 (ordem do PI, 2026-10-02) | #126 |

## Dentro

- quadro local A fazer → DEVELOPER → TESTE → REVIEWER → PR/MERGE → DONE → Finalizado (PI);
- play de uma issue ou de várias do mesmo MVP, um worktree por issue;
- PR/MERGE pelo estado real dos checks (consulta a cada transição e a cada 60 s);
- selo "Aguardando PI" para alteração estrutural de banco e comando destrutivo; deploy registrado;
- tetos agregados, cancelamento em cascata, limpeza e E2E;
- ligar o multi-escritor por padrão ao fim da F02 (ADR-006, decisão 16);
- RF-014.1 (parte de acionamento manual pelo play);
- RF-005.1 (abrir a tarefa para ver logs, artefatos e decisões), na F03;
- painel da tarefa: clicar no card e ver, só para leitura, o output de cada agente ao vivo, o diff, os arquivos, os checks e os testes.

## Fora

- labels novos no GitHub; priorização automática; play entre MVPs diferentes;
- edição de código pelo PI, terminal interativo e Git a partir do painel (o workspace é visualizador);
- RF-014.2 → MVP-013; RF-014.3 → MVP-015.

## Done

1. O quadro mostra o estágio real, inclusive a espera do CI em PR/MERGE, e se reconstrói do ledger.
2. Ação que exige o PI nunca executa sem aprovação registrada.
3. Cancelar o run encerra orquestrador, workers, escritores, integrador e consultas, preservando a evidência.
4. O E2E prova que só o kernel executou Git e que cada escritor tocou só seu worktree.
5. Clicar no card mostra o output de cada agente ao vivo e reconstrói o run encerrado a partir do banco.

## Perguntas abertas ao PI

Nenhuma.
