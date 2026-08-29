# SPEC-Entrega-06 — Evidência, limpeza e continuidade

- MVP/Fatia: MVP-009 · M9-F06.
- Issue: [#106](https://github.com/RodReis/rrb-jarvisOS/issues/106).
- Status: **aprovada-pi** (2026-08-29) — aprovada sem pergunta estrutural aberta; a limpeza absorve o container do sandbox decidido na M9-F03.
- Depende de: M9-F05.

## Objetivo

Fechar a execução com prova verificável, atualizar somente documentação material, reconciliar recursos e preparar a próxima fatia para aprovação.

## Saídas

- `ExecutionLedger`: duração, tentativas, tokens, créditos, custo e eventos.
- `ExternalRef`: issue, branch, commits, PR, checks, head/merge SHAs.
- relatório `docs/test-reports/<SPEC-ID>.md`.
- `STATUS.md` curto e `STATUS-ARQUIVO.md` detalhado.
- próxima fatia em `AWAITING_PI`, nunca iniciada automaticamente sem aprovação.

## Limpeza

Confirmar merge (ou PR verde aguardando o PI, com o kill-switch desligado) → verificar que worktree pertence ao lease → remover worktree operacional → **remover o container do executor** → liberar leases/portas/containers temporários → preservar volumes/dados persistentes → registrar resultado. Falha de limpeza não desfaz merge, mas mantém pendência reconciliável.

## Interface

Mostrar resultado, custo, evidência e próxima decisão. Detalhes Git/logs ficam expansíveis. Não mostrar commit/push/PR/merge como botões do PI e não pedir aceite final.

## Critérios de aceite

1. `MERGED` possui head SHA, checks e merge SHA coerentes.
2. Relatório humano referencia artefatos extensos por hash.
3. Documento sem mudança material não recebe edição cosmética.
4. Reinício pós-merge não cria novo PR ou merge.
5. Worktree, **container do executor** e demais recursos temporários são removidos ou ficam com pendência explícita reconciliável.
6. Próxima fatia exige sua própria revisão aprovada.
7. Estado terminal é compreensível sem ler logs técnicos.

## Testes e evidência

Playwright do painel, integração de limpeza parcial/reinício e jornada E2E real completa. O smoke real usa projeto/repositório exclusivos e orçamento limitado. Relatório `SPEC-Entrega-06`.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **A jornada E2E real completa roda em projeto e repositório exclusivos e descartáveis**, fora da suíte padrão — ela cria efeitos externos e consome orçamento, então não pode disparar em todo CI.
- **Relatório em `docs/test-reports/<SPEC-ID>.md` segue o ADR-003**: números só do `--json` dos runners, nunca escritos à mão.
- **Estado terminal com kill-switch desligado é "PR verde aguardando o PI"**, um resultado legítimo — não `BLOCKED`, que é reservado para causa externa ou risco.
- **Volume persistente nunca é apagado pela limpeza automática**, mesmo órfão: vira pendência para o usuário decidir.
