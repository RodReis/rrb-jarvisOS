# SPEC-Planejamento-06 — Roadmap e aprovações

- MVP/Fatia: MVP-008 · M8-F06.
- Issue: [#99](https://github.com/RodReis/rrb-jarvisOS/issues/99).
- Status: **aprovada-pi** (2026-08-29) — aprovada sem pergunta estrutural aberta; os gates já refletem as invariantes da CONVENTION §4.
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

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **Identidade do PI na aprovação** = a sessão autenticada local (SPEC-Fundacao-03). A aprovação funciona **offline** dentro da validade de sessão offline já definida lá; sem sessão válida, não há aprovação — o gate falha fechado, nunca "aprova como anônimo".
- **`STATUS.md` gerado espelha o formato deste repositório** (Agora, MVPs, Índice Fatia ↔ SPEC, Próximas ações), porque é o formato que o MVP-009 lê.
- **Commit documental automático ao fechar o pacote** usa o mesmo caminho de Git da M8-F01 — terminal controlado, auditado.
- **Nenhum gate é aprovado por "Decide por mim"** (critério 7 e invariante 3): delegação escolhe, o PI aceita.
