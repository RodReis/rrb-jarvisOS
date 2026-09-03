# SPEC-Jornada-05 — Roadmap, MVPs e SPEC por IA

- MVP/Fatia: MVP-025 · M25-F05.
- Issue: [#242](https://github.com/RodReis/rrb-jarvisOS/issues/242); épico [#237](https://github.com/RodReis/rrb-jarvisOS/issues/237).
- Status: **aprovada-pi** (2026-09-03) — perguntas abertas resolvidas pelo PI nesta data.
- Depende de: M25-F04; M8-F06 (validador de DAG, gates `MVP_ENTRY`/`SLICE_ENTRY`, `STATUS.md` gerado).

## Objetivo

Gerar o roadmap completo (MVPs e dependências), o documento do primeiro MVP e a SPEC executável da primeira fatia a partir do pacote aceito, e conduzir os aceites `MVP_ENTRY` e `SLICE_ENTRY`. Substitui a composição "um MVP por jornada" da M8-F06; mantém o validador de DAG, o `STATUS.md` como fonte única do índice e a separação gerar/aprovar.

## Geração

1. **Roadmap**: a IA propõe MVPs com tese, resultado, dependências e fatias previstas (checklist), a partir de PRD, arquitetura e decisão de escopo (`fatia-vertical`/`fundacao-ampla` continua sendo a decisão do PI que orienta a estratégia). Cada MVP com origem `prd`/`arquitetura`/`proposto`.
2. **Validador de DAG** (M8-F06): ciclo ou dependência ausente reprova antes de gravar; a IA recebe o erro e regenera até o limite de tentativas do orçamento, senão bloqueia com diagnóstico.
3. `STATUS.md` e `STATUS-ARQUIVO.md` gerados no formato deste repositório (M8-F06); `STATUS.md` é a única fonte da numeração Fatia ↔ SPEC.
4. **Gate `MVP_ENTRY`**: o PI escolhe **qual** MVP entra na fila entre os elegíveis (sem dependência pendente) — não mais o primeiro da ordem topológica. Aceite grava a revisão do documento do MVP.
5. **SPEC da primeira fatia**: gerada com objetivo, fluxo, regras, critérios de aceite executáveis e testes, no formato de `docs/spec/` deste repositório; nasce `rascunho` com **perguntas abertas geradas** — o PI responde no mesmo contrato de pergunta (M8-F03) e só então a SPEC pode ser aceita.
6. **Gate `SLICE_ENTRY`**: aceite grava a revisão exata da SPEC; etapa `spec-aceita`; commit documental. A partir daqui o MVP-009 assume (issue, branch, construção).

## Regras

- Só a próxima fatia recebe SPEC detalhada; as demais existem como checklist do MVP (Done do MVP-008 mantido).
- MVP futuro é proposta até entrar na fila; regenerar o roadmap depois de um `MVP_ENTRY` não altera o MVP aceito nem invalida fatias já em construção.
- Nenhum gate aprovado por geração ou "Decide por mim" (critério 7 da SPEC-Planejamento-06).
- Rota de assinatura, bloqueio antes de rota paga e ledger, como na F02.

## Critérios de aceite

1. DAG gerado passa no validador; DAG inválido não é gravado e o diagnóstico é exibido.
2. Todo MVP e toda fatia prevista têm origem; `proposto` listado no gate.
3. `MVP_ENTRY` oferece só MVPs elegíveis e grava a escolha do PI com identidade.
4. SPEC gerada nasce `rascunho` com perguntas abertas; aceite recusado enquanto houver pergunta sem resposta.
5. `STATUS.md` gerado é a única fonte do índice Fatia ↔ SPEC (teste da M8-F06 mantido).
6. Regenerar após `MVP_ENTRY` preserva o MVP aceito e suas fatias.
7. `SLICE_ENTRY` produz a entrada que o MVP-009 consome sem adaptação manual.

## Testes e evidência

Unitários de DAG (válido, ciclo, dependência ausente, regeneração); fixtures de pacote; Playwright dos dois gates com escolha de MVP e perguntas da SPEC. Smoke real fora da suíte, encadeado com o smoke do MVP-009 quando o PI autorizar. Relatório `SPEC-Jornada-05`.

## Perguntas resolvidas pelo PI (2026-09-03)

1. **No `MVP_ENTRY` o PI escolhe qual MVP entra na fila, entre os elegíveis** (sem dependência pendente). Substitui o automático da M8-F06 (primeiro da ordem topológica), que existia porque a spec não definia a escolha. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **A IA regenera contra o validador de DAG, não o substitui.** Grafo é verificável por máquina; confiar no texto seria abrir mão de uma garantia que já existe.
- **Perguntas abertas da SPEC gerada são obrigatórias**: uma SPEC sem pergunta sugeriria que não há nada a decidir — a regra deste repositório (Cowork apresenta perguntas antes de `aprovada-pi`) vale para o projeto gerado.
