# SPEC-Entrega-05 — Revisão, CI e merge

- MVP/Fatia: MVP-009 · M9-F05.
- Issue: [#105](https://github.com/RodReis/rrb-jarvisOS/issues/105).
- Status: **aprovada-pi** (2026-08-29) — política do merge autônomo resolvida pelo PI nesta data.
- Depende de: M9-F04 e GitHub Adapter M6-F04.

## Objetivo

Validar o delta, executar revisões, corrigir falhas elegíveis e concluir o mesmo PR por squash merge automático sem novo aceite do PI.

## Sequência

Escopo → testes/lint/type/build → code/architecture review → design review quando houver UI → QA/smoke → correção/revalidação → commits automáticos → push → `ensurePullRequest` → checks do head atual → recuperação no mesmo PR → confirmação do SHA → squash merge → confirmação na origem.

## Revisão

`REVIEW.md` é a instrução de maior prioridade fornecida pelo projeto aos revisores. Baseline: P0/P1 bloqueiam; P2/P3 são registrados. Relatório anterior é usado para deduplicar e avaliar apenas o delta ainda aberto.

## Git automático

- Commits agrupam mudanças coerentes; correções de QA podem ser atômicas.
- Branch e PR são únicos por fatia/run lógico.
- Se a base avançar, rebase e revalidação são automáticos quando seguros.
- Resolução com alteração de código consome tentativa.
- Squash merge não exige aceite humano adicional **quando o merge autônomo está ligado** — padrão do projeto, decidido pelo PI em 2026-08-29.
- **Kill-switch por projeto:** desligado o merge autônomo, o run termina com o PR aberto e verde, em estado terminal explicável, aguardando o PI. Não é bloqueio nem falha.
- A mudança do kill-switch é ação sensível: gera `AuditEvent` e fica registrada no pacote do projeto.

## Critérios de aceite

1. Diff fora da SPEC não chega ao push.
2. P0/P1 aberto impede merge.
3. CI verde pertence ao `head SHA` esperado.
4. Stale SHA impede merge e força reconciliação.
5. Falha corrigível mantém o mesmo PR.
6. `mergeSha` é confirmado na origem.
7. Código do comando zero, sozinho, não prova sucesso.
8. **Kill-switch respeitado:** com merge autônomo desligado, o run para no PR verde sem mergear e sem marcar falha; com ligado, mergeia e confirma na origem. Teste dos dois caminhos.

## Testes e evidência

Fixtures de review/CI; integração de PR existente, CI failure, stale SHA, rebase e merge já ocorrido; smoke GitHub real. Relatório `SPEC-Entrega-05`.

## Perguntas resolvidas pelo PI (2026-08-29)

1. **Merge autônomo:** **ligado por padrão, com kill-switch por projeto**. É a tese do MVP-009 e já está na ARCHITECTURE ("Git após aprovação é automático; merge não cria aceite adicional") e na invariante 7 da CONVENTION §4. O kill-switch existe para projeto com outros colaboradores, onde entrar na `main` sozinho não é aceitável; nele, o run termina no PR verde aguardando o PI. Descartado opt-in com padrão desligado: transformaria o MVP em "abre PR e espera", que é o que ele existe para superar. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **Merge integra código; não é aceite de fatia.** O aceite do PI continua sendo o fechamento da issue — o mesmo princípio que este repositório aplica a si (CLAUDE.md § Ciclo de vida). O merge autônomo não fecha issue nem aplica rótulo de aceite.
- **`closes #N` é proibido no corpo do PR gerado**; sempre `refs #N`, pelo mesmo motivo.
- **Revisão roda sobre o delta**, com o relatório anterior deduplicando o que já foi resolvido; P0/P1 abertos bloqueiam o merge mesmo com o kill-switch ligado.
