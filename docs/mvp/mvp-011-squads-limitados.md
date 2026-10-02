# MVP-011 — Squads orquestrados pela SPEC

- Status: **reescrito em 2026-10-02 pelas decisões do PI ([ADR-006](../adr/adr-006-squads-orquestrados-modelo-local.md)); aguarda o "aprovado" do PI.** A versão aprovada em 2026-08-29 (escritor único, cinco fatias) fica substituída quando o PI aprovar esta revisão. **Partido em dois MVPs** (ADR-006, decisão 14): este é o núcleo; quadro de execução e governança são o [MVP-028](mvp-028-quadro-execucao-squads.md).
- GitHub: épico [#121](https://github.com/RodReis/rrb-jarvisOS/issues/121); fatias #122–#125 (voltam a `proplan:planejado` na aprovação da ADR-006); F00 ganha issue nova na aprovação da sua SPEC; #126 passa ao MVP-028.
- Depende de: MVP-010 concluído. **M12-F01 (pool global) entra antes da M11-F03** (ADR-006, decisão 13).
- Dono do aceite: PI.
- Design: `docs/superpowers/specs/2026-08-29-pipeline-desenvolvimento-ia-v2-design.md` §7, emendado pela ADR-006.

**Dimensionamento:** T-grande (14 pts: 5 fatias + ADR + 3 migrações + 3 superfícies sensíveis + 2 provas novas) ·
R-crítico (9 pts: irrev. 1, segurança 3, alcance 3, incerteza 2)

Conta por fatia: F00 = 1 + prova nova; F01 = 1 + ADR + migração + sensível; F02 = 1 + sensível; F03 = 1 + migração + sensível; F04 = 1 + prova nova + migração. As migrações de F03 e F04 só contam se o estado de escritor e de achados não couber no `ExecutionLedger` atual; a confirmação é do Code na F01.

- R-crítico obriga ADR e prova antes da primeira fatia: ADR-006 e a M11-F00, com os critérios numéricos fixados pelo PI.
- T-grande pede ordem explícita e checkpoint intermediário: o checkpoint é o resultado da F00 (aprovado ou reprovado pelo critério) antes da F01.

## Tese

Um orquestrador local e barato quebra cada issue em tarefas e escolhe a camada de modelo de cada uma; o kernel valida tudo antes de despachar. Até dois escritores trabalham em worktrees isolados, e um integrador junta o trabalho com prova de que nada se perdeu. TESTE precede REVIEWER, e o retrabalho volta ao DEVELOPER dentro de limite. A autoridade sobre produto, fila, Git e merge nunca vai para um agente.

## Fatias

| Ordem | Fatia | SPEC | Dependência | Issue |
|---:|---|---|---|---|
| 0 | Prova do orquestrador local e do integrador | `spec-squads-00-prova-orquestrador-integrador.md` | MVP-010 | nova |
| 1 | Capacidades, perfis e camadas de modelo | `spec-squads-01-capacidades-perfis.md` | F00 aprovada pelo critério | #122 |
| 2 | Orquestrador local e validador determinístico | `spec-squads-02-planejador-validador.md` | F01 | #123 |
| 3 | Workers somente-leitura e escritores isolados | `spec-squads-03-workers-isolados.md` | F02 + **M12-F01** | #124 |
| 4 | Integrador, TESTE → REVIEWER e retrabalho | `spec-squads-04-revisao-independente.md` | F03 | #125 |

## Dentro

- orquestrador local via adapter Ollama, propondo `SquadPlan` validado pelo kernel, com fallback para o modelo da fase;
- perfis por tipo de fatia com capacidades, camadas de modelo, escritores, integrador e ações que pedem aprovação;
- até 2 escritores por issue em worktrees próprios; workers somente leitura; limites e cancelamento por worker (F03);
- integrador com manifesto de hunks, suíte verde e revisão independente;
- retrabalho TESTE/REVIEWER → DEVELOPER no limite da M9-F04;
- RF-014.1 (parte de equipe: agentes, papéis, objetivo, workflow padrão, limites de custo).

## Fora

- quadro de execução, play, coluna PR/MERGE, selo "Aguardando PI", tetos agregados, cancelamento em cascata e E2E → **MVP-028**;
- framework de agente externo embutido (Hermes Agent ou similar);
- agente fazendo Git/GitHub, merge, alteração de SPEC, prioridade, fila ou gate;
- vários escritores no **mesmo** worktree; duas implementações concorrentes da mesma fatia;
- memória própria do orquestrador entre runs (MVP-016);
- deploy (fora da V2);
- RF-014.2 → MVP-013; RF-014.3 → MVP-015.

## Done

1. A SPEC limita todas as tarefas geradas; o plano do orquestrador nunca é executado sem validação.
2. Somente o kernel executa Git; cada escritor altera apenas seu worktree.
3. O integrador não perde hunk sem registro; faltou prova, o run para.
4. Capacidade obrigatória usa implementação ou fallback aprovado.
5. Achados repetidos não voltam como falhas novas.

## Perguntas abertas ao PI

1. Conjunto de referência da M11-F00 (SPEC-Squads-00).
2. Entre a entrega deste MVP e a do MVP-028 (sem tetos agregados nem selo de aprovação), o multi-escritor fica ligado ou desligado por padrão?
