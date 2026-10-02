# MVP-011 — Squads orquestrados pela SPEC

- Status: **reescrito em 2026-10-02 pelas decisões do PI ([ADR-006](../adr/adr-006-squads-orquestrados-modelo-local.md)); aguarda o "aprovado" do PI.** A versão aprovada em 2026-08-29 (escritor único, cinco fatias) fica substituída quando o PI aprovar esta revisão.
- GitHub: épico [#121](https://github.com/RodReis/rrb-jarvisOS/issues/121); fatias [#122–#126](https://github.com/RodReis/rrb-jarvisOS/issues/122) existentes (voltam a `proplan:planejado` quando a ADR-006 for aprovada); F00 e F05 ganham issue nova quando suas SPECs forem aprovadas.
- Depende de: MVP-010 concluído. **M12-F01 (pool global) entra antes da M11-F03** (ADR-006, decisão 13).
- Dono do aceite: PI.
- Design: `docs/superpowers/specs/2026-08-29-pipeline-desenvolvimento-ia-v2-design.md` §7, emendado pela ADR-006.

**Dimensionamento:** T-enorme (20 pts: 7 fatias + ADR + 3 migrações + 4 superfícies sensíveis + IPC + 4 provas novas) ·
R-crítico (9 pts: irrev. 1, segurança 3, alcance 3, incerteza 2)

Conta por fatia: F00 = 1 + prova nova; F01 = 1 + ADR + migração + sensível; F02 = 1 + sensível; F03 = 1 + migração + sensível; F04 = 1 + prova nova + migração; F05 = 1 + IPC + prova nova (visual do quadro); F06 = 1 + sensível + prova nova (E2E multi-escritor com crash). As migrações de F04 e F05 só contam se a persistência de achados e de estágio não couber no `ExecutionLedger` atual; a confirmação é do Code na F01.

- **T-enorme obriga decisão registrada do PI antes da primeira fatia**: partir em dois MVPs ou registrar por que não (pergunta 1 abaixo).
- **R-crítico obriga ADR e prova antes da primeira fatia**: ADR-006 e a M11-F00.

## Tese

Um orquestrador local e barato quebra cada issue em tarefas e escolhe a camada de modelo de cada uma. O kernel valida tudo antes de despachar. Até dois escritores trabalham em worktrees isolados e um integrador junta o trabalho com prova de que nada se perdeu. O PI acompanha cada issue num quadro de execução, das colunas DEVELOPER, TESTE e REVIEWER até PR/MERGE, e a autoridade sobre produto, fila, Git e merge nunca vai para um agente.

## Fatias

| Ordem | Fatia | SPEC | Dependência | Issue |
|---:|---|---|---|---|
| 0 | Prova do orquestrador local e do integrador | `spec-squads-00-prova-orquestrador-integrador.md` | MVP-010 | nova |
| 1 | Capacidades, perfis e camadas de modelo | `spec-squads-01-capacidades-perfis.md` | F00 aprovada pelo critério | #122 |
| 2 | Orquestrador local e validador determinístico | `spec-squads-02-planejador-validador.md` | F01 | #123 |
| 3 | Workers somente-leitura e escritores isolados | `spec-squads-03-workers-isolados.md` | F02 + **M12-F01** | #124 |
| 4 | Integrador, TESTE → REVIEWER e retrabalho | `spec-squads-04-revisao-independente.md` | F03 | #125 |
| 5 | Quadro de execução, play e PR/MERGE | `spec-squads-05-quadro-play-pr-merge.md` | F04 | nova |
| 6 | Tetos, aprovações do PI, cancelamento e E2E | `spec-squads-06-tetos-aprovacoes-cancelamento-e2e.md` | F05 | #126 |

## Dentro

- orquestrador local via adapter Ollama, propondo `SquadPlan` validado pelo kernel, com fallback para o modelo da fase;
- perfis por tipo de fatia com capacidades, camadas de modelo, escritores, integrador e ações que pedem aprovação;
- até 2 escritores por issue em worktrees próprios; workers somente leitura;
- integrador com manifesto de hunks, suíte verde e revisão independente;
- quadro local A fazer → DEVELOPER → TESTE → REVIEWER → PR/MERGE → DONE → Finalizado (PI);
- play de uma issue ou de várias do mesmo MVP, com um worktree por issue;
- selo "Aguardando PI" para alteração estrutural de banco e comando destrutivo;
- tetos, cancelamento em cascata e E2E;
- RF-014.1: equipe com agentes, papéis, objetivo, workflow padrão, limites de custo e acionamento manual.

## Fora

- framework de agente externo embutido (Hermes Agent ou similar);
- agente fazendo Git/GitHub, merge, alteração de SPEC, prioridade, fila ou gate;
- vários escritores no **mesmo** worktree; duas implementações concorrentes da mesma fatia;
- memória própria do orquestrador entre runs (é do MVP-016);
- deploy (fora da V2; a regra de aprovação fica registrada para quando entrar);
- RF-014.2 (acionamento por automação) → MVP-013; RF-014.3 (performance por equipe) → MVP-015.

## Done

1. A SPEC limita todas as tarefas geradas; o plano do orquestrador nunca é executado sem validação.
2. Somente o kernel executa Git; cada escritor altera apenas seu worktree.
3. O integrador não perde hunk sem registro; faltou prova, o run para.
4. Capacidade obrigatória usa implementação ou fallback aprovado.
5. Achados repetidos não voltam como falhas novas.
6. O quadro mostra o estágio real, inclusive a espera do CI em PR/MERGE.
7. Ação que exige o PI nunca executa sem aprovação registrada.
8. Cancelar o run encerra todos os workers e escritores e preserva a evidência.

## Perguntas abertas ao PI

1. **T-enorme (20 pts):** partir em dois MVPs, por exemplo F00–F04 (núcleo) e F05–F06 (quadro, play e governança) num MVP novo, ou manter um só e registrar o motivo?
2. Os critérios numéricos da M11-F00 estão na SPEC-Squads-00.
3. Pendências da ADR-006 para o MVP-012 e o MVP-013: tratar na próxima rodada.
