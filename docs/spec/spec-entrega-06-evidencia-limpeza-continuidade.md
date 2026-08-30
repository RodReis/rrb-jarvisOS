# SPEC-Entrega-06 — Evidência, limpeza e continuidade

- MVP/Fatia: MVP-009 · M9-F06.
- Issue: [#106](https://github.com/RodReis/rrb-jarvisOS/issues/106).
- Status: **aprovada-pi** (2026-08-29) — aprovada sem pergunta estrutural aberta; a limpeza absorve o container do sandbox decidido na M9-F03. **Emenda 2026-08-30:** docs do projeto-alvo saem desta fatia e entram no PR (M9-F05 critério 11); relatório em `reports/`, não em `docs/`; terminal `AWAITING_MERGE` (ver § Emendas).
- Depende de: M9-F05.

## Objetivo

Fechar a execução com prova verificável, atualizar somente documentação material, reconciliar recursos e preparar a próxima fatia para aprovação.

## Saídas

- `ExecutionLedger`: duração, tentativas, tokens, créditos, custo e eventos.
- `ExternalRef`: issue, branch, commits, PR, checks, head/merge SHAs.
- relatório de testes do projeto-alvo em `reports/TESTS.md` (gerado do `--json` dos runners, ADR-003/TESTING §4 — **nunca sob `docs/`**), **commitado no PR pela M9-F05**; esta fatia só o referencia por hash no `ExecutionLedger`.
- `STATUS.md` curto e `STATUS-ARQUIVO.md` detalhado — **também escritos no PR pela M9-F05 (critério 11)**; esta fatia verifica que a versão mergeada corresponde ao run e não escreve na branch-base.
- próxima fatia em `AWAITING_PI` (gate `SLICE_ENTRY`, M9-F02), nunca iniciada automaticamente sem aprovação.

## Limpeza

Confirmar `MERGED` (ou `AWAITING_MERGE`, com o kill-switch desligado) → verificar que worktree pertence ao lease → remover worktree operacional → **remover o container do executor** → liberar leases/portas/containers temporários → preservar volumes/dados persistentes → registrar resultado. Falha de limpeza não desfaz merge, mas mantém pendência reconciliável.

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
- **Estado terminal com kill-switch desligado é `AWAITING_MERGE`** (M9-F02), um resultado legítimo — não `BLOCKED`, que é reservado para causa externa ou risco.
- **Volume persistente nunca é apagado pela limpeza automática**, mesmo órfão: vira pendência para o usuário decidir.

## Emendas (2026-08-30) — revisão de furos de spec

1. **`STATUS.md`/relatório pós-merge era commit direto na branch-base** do projeto-alvo — contra a Convention gerada, contra a M9-F04 e contra a invariante 10. Movido para o PR (M9-F05 critério 11); esta fatia deixa de escrever na branch-base.
2. **`docs/test-reports/<SPEC-ID>.md` contradizia o TESTING.md** deste repositório (`reports/TESTS.md`, gerado, nunca em `docs/`) e o ADR-003 que a própria spec cita. Corrigido.
3. Nome do terminal alinhado à M9-F02.
