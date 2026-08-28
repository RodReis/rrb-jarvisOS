# SPEC-Planejamento-06 — Roadmap e aprovações

- MVP/Fatia: MVP-008 · M8-F06.
- Status: **revisão documental; implementação não autorizada**.
- Depende de: M8-F05.

## Objetivo

Gerar o roadmap completo, detalhar somente a próxima fatia e registrar gates por hashes sem aceite duplicado.

## Saídas

- `STATUS.md` curto com Kanban/roadmap e índice Fatia ↔ SPEC.
- `STATUS-ARQUIVO.md` com histórico longo.
- documentos de MVP propostos e dependências.
- SPEC executável somente da próxima fatia.
- pacote de aprovação com revisões e impacto.

## Gates

- `PROJECT_PACKAGE`: PRD, Landscape, Convention, Design System, protótipos, arquitetura, Testing e Review.
- `MVP_ENTRY`: revisão do MVP que entra na fila.
- `SLICE_ENTRY`: revisão da SPEC executada.

Correção textual, STATUS, evidência e ADR registrando decisão já tomada não invalidam gates. Mudança semântica invalida somente dependentes ainda não executados.

## Critérios de aceite

1. DAG de MVPs não contém ciclo ou dependência ausente.
2. `STATUS.md` é a única fonte da numeração Fatia ↔ SPEC.
3. MVP futuro permanece proposta até entrar na fila.
4. Aprovação guarda hashes exatos e identidade do PI.
5. Mesma revisão não solicita novo aceite.
6. Mudança estrutural exibe previamente gates invalidados.
7. Nenhum gate aprovado automaticamente por “Decide por mim”.
8. Conclusão cria commit documental automático.

## Testes e evidência

Unitários de DAG, hash e matriz de invalidação; Playwright do centro de aprovações; teste de revisão cosmética/material. Relatório `SPEC-Planejamento-06`.

