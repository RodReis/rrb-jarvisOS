# SPEC-Jornada-04 — Arquitetura por IA após os anexos

- MVP/Fatia: MVP-025 · M25-F04.
- Issue: [#241](https://github.com/RodReis/rrb-jarvisOS/issues/241); épico [#237](https://github.com/RodReis/rrb-jarvisOS/issues/237).
- Status: **aprovada-pi** (2026-09-03) — perguntas abertas resolvidas pelo PI nesta data.
- Depende de: M25-F03; M8-F05 (gate de anexos, validação de protótipos, hashes).

## Objetivo

Gerar `ARCHITECTURE.md`, `DECISIONS.md`, `TESTING.md` e `REVIEW.md` a partir do PRD aceito e dos protótipos validados, e fechar o gate `PROJECT_PACKAGE`. O gate de anexos da M8-F05 permanece intacto: **arquitetura não é gerada antes dos anexos completos** (decisão 9 do design, mantida pelo PI em 2026-09-03).

## Etapa Design (mantida)

- `AWAITING_DESIGN_ATTACHMENTS` até `DESIGN-SYSTEM.md`, ao menos um protótipo HTML e assets referenciados — por seletor que copia e hasheia no ato (M8-F05).
- Validação estrutural dos protótipos (links, assets, jornadas, estados) continua determinística e roda antes da geração. Achados viram perguntas ao PI.
- **Novo:** a IA lê os protótipos validados e o PRD e produz uma **análise de coerência** (telas sem requisito, requisitos sem tela, estados ausentes) como lista de `proposto` de ajuste — o PI autoriza cada um; nada é aplicado ao anexo (critério 5 da SPEC-Planejamento-05).

## Geração

- Entrada: PRD/Landscape/Convention na revisão aceita, anexos com hash, análise de coerência, decisões vigentes.
- `ARCHITECTURE.md`: módulos, dados, fronteiras, resiliência — cada módulo/fluxo com origem `prd` (âncora no requisito), `prototipo` (âncora na tela/jornada, com hash do anexo) ou `proposto`.
- `DECISIONS.md`: ADRs das decisões estruturais tomadas no refinamento e no PRD (origem `decisao`) e as propostas pela IA (`proposto`).
- `TESTING.md` e `REVIEW.md`: estratégia de evidência e instruções de revisão do projeto gerado, no formato que o MVP-009 consome.
- Validador de saída: origem obrigatória; **fluxo na arquitetura sem âncora em protótipo é rejeitado** (critério 4 da SPEC-Planejamento-05 vira verificação da saída gerada, não garantia de composição).
- Gate `PROJECT_PACKAGE` (SPEC-Planejamento-06): revisão exata de PRD + Landscape + Convention + anexos + arquitetura + Testing + Review; lista de `proposto`; aceite grava hashes + identidade, commit `arquitetura-aprovada`, etapa `pacote-aceito`.

## Critérios de aceite

1. Geração recusada com `AWAITING_DESIGN_ATTACHMENTS` enquanto faltar anexo (teste dos dois casos da M8-F05 mantido).
2. Todo módulo/fluxo da arquitetura tem origem; fluxo sem âncora em protótipo reprova no validador.
3. Arquitetura referencia a mesma revisão do PRD aceito (`pacote_estrutural_id` da M8-F05 mantido).
4. Ajuste proposto pela IA nunca altera o anexo; só o PI autoriza, com histórico e autoria preservados.
5. `PROJECT_PACKAGE` registra hashes de todos os anexos e saídas.
6. Regenerar após aceite cria revisão nova; a aceita não muda.
7. Rota de assinatura, bloqueio antes de rota paga e ledger, como na F02.

## Testes e evidência

Fixtures de protótipo com tela sem requisito e requisito sem tela; validador de âncora; anexo ausente; Playwright do gate com propostos. Smoke real fora da suíte. Relatório `SPEC-Jornada-04`.

## Perguntas resolvidas pelo PI (2026-09-03)

1. **`DECISIONS.md` gerado registra as decisões do refinamento (origem `decisao`) e as propostas pela IA (`proposto`) como ADRs** — mesmo formato deste repositório, que o MVP-009 e o Code já leem. Descartado registrar só as propostas da IA. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **A validação determinística dos protótipos não é substituída pela análise da IA** — ela roda antes e é o que o gate mede; a IA acrescenta leitura semântica como proposta.
- **`prototipo` é origem de primeira classe**, com hash do anexo: é o que torna "arquitetura não promete fluxo ausente dos protótipos" verificável em texto gerado.
