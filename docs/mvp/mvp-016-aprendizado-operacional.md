# MVP-016 — Aprendizado Operacional da Pipeline

- Status: **design e seis fatias aprovados pelo PI** em 2026-08-29; SPECs ainda não redigidas; implementação não autorizada.
- GitHub: épico e issues ainda não criados.
- Depende de: MVP-015 concluído.
- Dono do aceite: PI.
- Design: `docs/superpowers/specs/2026-08-29-mvp-016-aprendizado-operacional-design.md`.

## Tese

Aprender com evidências de runs concluídos para reduzir recorrência, retrabalho, contexto e consumo sem substituir a memória/RAG do MVP-007, duplicar os mecanismos dos MVPs 008/009 ou conceder à IA autoridade de produto.

## Fatias

| Ordem | Fatia | SPEC | Estado |
|---:|---|---|---|
| 1 | Fundação e ingestão | a redigir | design aprovado |
| 2 | Memória de falhas | a redigir | design aprovado |
| 3 | Registro e resolução de políticas | a redigir | design aprovado |
| 4 | Experimentos e promoção | a redigir | design aprovado |
| 5 | Estratégias e recomendações assistidas | a redigir | design aprovado |
| 6 | Interface, resiliência e prova E2E | a redigir | design aprovado; gate visual antes da construção |

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
