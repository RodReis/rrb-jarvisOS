# SPEC-Scheduler-05 — Recuperação e E2E concorrente

- MVP: `docs/mvp/mvp-012-scheduler-concorrente.md` (Fatia 05) — **fecha o MVP-012**.
- Status: **aprovada-pi** (2026-08-29) — entra no backlog na ordem do MVP; implementação depende da fila.
- Depende de: F04 aprovada e entregue.

## Objetivo

Provar concorrência segura ponta a ponta e fechar recuperação, cancelamento seletivo e limpeza de recursos.

## Dentro

- Supervisor de leases, processos, containers, worktrees, branches, PRs e efeitos ambíguos.
- Retomada/reconciliação por run sem interromper fatia saudável.
- Cancelamento seletivo conforme matriz aprovada, preservando branch/PR remoto.
- Coleta segura de recursos órfãos confirmados e elegíveis.
- E2E com duas fatias independentes, dois PRs, merge serializado, rebase e revalidação.
- Cenário controle com falsa independência voltando para sequencial.

## Fora

- Limpeza remota destrutiva.
- Prosseguir após efeito ambíguo sem consultar fonte real.
- Deploy.

## Regras

1. Recuperação prefere estado observado nas fontes reais a suposição local.
2. Falha/cancelamento de um run não libera locks ou recursos pertencentes ao outro.
3. Artefato de run bloqueado/ambíguo é protegido da retenção.
4. PR após cancelamento fica preservado e draft quando possível.

## Critérios de aceite

1. Duas fatias independentes chegam a PR sem colisão e são mergeadas uma por vez.
2. Segunda fatia rebaseia e revalida sobre a base pós-primeiro merge.
3. Crash em cada fronteira recupera sem run/PR/merge duplicado.
4. Cancelar uma fatia não interrompe a outra nem apaga trabalho remoto.
5. Falsa independência executa sequencialmente e registra a dimensão não provada.
6. Ao final não restam lease, processo, container, porta ou worktree órfãos elegíveis.

## Testes e evidência

- fault injection em aquisição, execução, push, CI e merge;
- Playwright da fila/estado concorrente;
- E2E em repositório exclusivo;
- relatório de recursos e efeitos reconciliados.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.
