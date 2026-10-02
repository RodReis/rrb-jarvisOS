# SPEC-Squads-00 — Prova do orquestrador local e do integrador

- MVP: `docs/mvp/mvp-011-squads-limitados.md` (Fatia 00).
- Issue: [#369](https://github.com/RodReis/rrb-jarvisOS/issues/369); épico [#121](https://github.com/RodReis/rrb-jarvisOS/issues/121).
- Status: **aprovada-pi** (2026-10-02) — revisão exata do PR #367 aprovada pelo PI; redigida em 2026-10-02 (ADR-006, decisão 12); critérios fixados pelo PI em 2026-10-02.
- Depende de: MVP-010 concluído.

## Objetivo

Provar com medição, antes da primeira fatia de produto, as duas incertezas que fazem o MVP-011 ser R-crítico: um modelo local de 8B gerando planos válidos e um agente integrador juntando o trabalho de dois escritores sem perder código.

## Dentro

- Conjunto de referência de **fatias já entregues** (SPEC aprovada, diff mergeado, testes conhecidos) do próprio jarvisOS.
- Execução de `hermes3:8b` e `qwen3:8b` via adapter Ollama, gerando `SquadPlan` no schema da F02 para cada fatia de referência.
- Execução do mesmo conjunto pelo modelo da fase (fallback), como linha de base.
- Medição: % de planos aceitos pelo validador, motivos de rejeição, latência, uso de VRAM e de contexto (`num_ctx` efetivo) na máquina do PI.
- Conjunto de **merges históricos com conflito**, reconstruídos como dois escritores, integrados pelas camadas candidatas a integrador.
- Medição do integrador: hunks preservados, descartados com motivo e perdidos sem registro; suíte verde; achados do revisor.
- Relatório versionado com os números brutos e a recomendação do modelo padrão.

## Fora

- Escolher o modelo padrão sem atingir o critério.
- Ajustar o validador para fazer um modelo passar.
- Qualquer efeito remoto (PR, push, issue).

## Critérios numéricos (PI, 2026-10-02)

- **Orquestrador local:** vira padrão somente com **≥ 80%** de planos aceitos pelo validador no conjunto de referência.
- **Integrador:** **zero** hunk perdido sem registro **e 100%** de suítes verdes após a integração no conjunto de merges com conflito.

## Regras

1. O validador usado na prova é o da F02 em forma mínima, congelado por hash antes da medição.
2. O orquestrador local só vira padrão se atingir o critério; abaixo dele, o padrão é o modelo da fase e o local fica como opção.
3. Um único hunk perdido sem registro reprova o integrador avaliado, qualquer que seja o restante.
4. A medição roda no hardware real do PI e declara o hardware no relatório.

## Critérios de aceite

1. O relatório traz, por modelo, os números de cada fatia de referência, e não só a média.
2. O critério do PI aparece no relatório como aprovado ou reprovado, com o número.
3. O manifesto de hunks detecta perda injetada de propósito (teste negativo).
4. A medição é reproduzível pelo snapshot (modelos, prompts, validador, conjunto).

## Testes e evidência

- harness de benchmark com fixtures das fatias de referência;
- teste negativo do manifesto (hunk removido de propósito);
- relatório bruto em `reports/` conforme `TESTING.md`.

## Conjunto de referência (PI, 2026-10-02)

Fatias **mergeadas do MVP-009, do MVP-010 e do MVP-026**. A lista exata (issue, SHA do merge, SPEC) é fixada no snapshot da medição antes de rodar.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-10-02.
