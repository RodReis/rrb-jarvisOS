# MVP-016 — Aprendizado Operacional da Pipeline

- Status: **design, seis fatias e seis SPECs aprovados pelo PI**; último aceite: F05–F06 na revisão exata `6a6e702a4d6ced5820d3f4c7674d6278f0b2d391`, em 2026-08-31. Implementação depende das dependências e da fila.
- GitHub: épico [#162](https://github.com/RodReis/rrb-jarvisOS/issues/162); F01–F06 [#163–#168](https://github.com/RodReis/rrb-jarvisOS/issues/163) em `proplan:backlog`, sem alterar `next`.
- Depende de: MVP-015 concluído.
- Dono do aceite: PI.
- Design: `docs/superpowers/specs/2026-08-29-mvp-016-aprendizado-operacional-design.md`.

## Tese

Aprender com evidências de runs concluídos para reduzir recorrência, retrabalho, contexto e consumo sem substituir a memória/RAG do MVP-007, duplicar os mecanismos dos MVPs 008/009 ou conceder à IA autoridade de produto.

## Fatias

| Ordem | Fatia | SPEC | Estado |
|---:|---|---|---|
| 1 | Fundação e ingestão ([#163](https://github.com/RodReis/rrb-jarvisOS/issues/163)) | `spec-aprendizado-01-fundacao-ingestao.md` | aprovada-pi |
| 2 | Memória de falhas ([#164](https://github.com/RodReis/rrb-jarvisOS/issues/164)) | `spec-aprendizado-02-memoria-falhas.md` | aprovada-pi |
| 3 | Registro e resolução de políticas ([#165](https://github.com/RodReis/rrb-jarvisOS/issues/165)) | `spec-aprendizado-03-registro-resolucao-politicas.md` | aprovada-pi |
| 4 | Experimentos e promoção ([#166](https://github.com/RodReis/rrb-jarvisOS/issues/166)) | `spec-aprendizado-04-experimentos-promocao.md` | aprovada-pi |
| 5 | Estratégias e recomendações assistidas ([#167](https://github.com/RodReis/rrb-jarvisOS/issues/167)) | `spec-aprendizado-05-estrategias-recomendacoes.md` | aprovada-pi |
| 6 | Interface, resiliência e prova E2E ([#168](https://github.com/RodReis/rrb-jarvisOS/issues/168)) | `spec-aprendizado-06-interface-resiliencia-e2e.md` | aprovada-pi; gate visual antes da construção |

## Dentro

- ingestão rastreável e idempotente;
- fingerprints, recorrência e resolução comprovada;
- políticas específicas por projeto e globais locais;
- snapshots imutáveis por run;
- replay, shadow, canário, promoção e rollback;
- estratégias opcionais Graphify/Caveman com fallback determinístico;
- IA propositora, promoção determinística;
- console, `Decide por mim` e prova E2E.

## Fora

- memória contextual/RAG do MVP-007;
- reimplementar `ContextSelector` ou `RecoveryController`;
- fine-tuning, sincronização externa ou novo provider;
- leitura integral automática do repositório;
- mudança automática de SPEC, regra de produto ou gate material;
- tornar aprendizado um bloqueio da pipeline.

## Done

1. A mesma falha é reconhecida por fingerprint sem esconder causas novas.
2. Candidata atravessa replay, shadow e canário com baseline e guardrails explícitos.
3. Qualidade não piora para economizar tokens, chamadas, tempo ou custo.
4. Cada run preserva o `PolicySnapshot` usado.
5. Política incompatível fica `stale`; regressão provoca rollback rastreável.
6. Falha do aprendizado mantém a última política estável ou a base sem bloquear a pipeline.
7. UI e CLI explicam hipótese, evidência, impacto, decisão e reversão.

## Gate adicional da UI

A M16-F06 só entra em construção depois de anexar e aprovar `DESIGN-SYSTEM.md` e protótipos HTML formais. O desenho aprovado não substitui esses artefatos.
