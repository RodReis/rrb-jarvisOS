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

Todo arquivo alterado cria nova `ArtifactRevision`. Carry-forward de aprovação só ocorre pela matriz determinística: atualização mecânica de STATUS, histórico, evidência, relatório ou ADR que apenas registra decisão já aprovada não invalida gate; mudança em PRD, arquitetura, SPEC, Convention, Design System ou protótipo é material e invalida somente dependentes ainda não executados.

O manifesto canônico usa versão de schema, path relativo normalizado com `/`, ordenação ordinal e SHA-256 dos bytes armazenados. O manifesto é serializado em JSON canônico; mudança de encoding/CRLF altera a revisão, mesmo quando a matriz permitir carry-forward auditado.

## Critérios de aceite

1. DAG de MVPs não contém ciclo ou dependência ausente.
2. `STATUS.md` é a única fonte da numeração Fatia ↔ SPEC.
3. MVP futuro permanece proposta até entrar na fila.
4. Aprovação guarda hashes exatos e identidade do PI.
5. Mesma revisão não solicita novo aceite.
6. Mudança estrutural exibe previamente gates invalidados.
7. Nenhum gate aprovado automaticamente por “Decide por mim”.
8. Conclusão cria commit documental automático.
9. Mesmo conjunto de arquivos produz o mesmo manifesto em Windows/Linux; path traversal, colisão por case e ordem distinta são rejeitados ou normalizados deterministicamente.
10. Carry-forward registra revisão anterior, nova revisão e regra de materialidade aplicada; não altera silenciosamente o hash guardado na aprovação original.

## Testes e evidência

Unitários de DAG, hash e matriz de invalidação; Playwright do centro de aprovações; teste de revisão cosmética/material. Relatório `SPEC-Planejamento-06`.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **Identidade do PI na aprovação** = a sessão autenticada local (SPEC-Fundacao-03). A aprovação funciona **offline** dentro da validade de sessão offline já definida lá; sem sessão válida, não há aprovação — o gate falha fechado, nunca "aprova como anônimo".
- **`STATUS.md` gerado espelha o formato deste repositório** (Agora, MVPs, Índice Fatia ↔ SPEC, Próximas ações), porque é o formato que o MVP-009 lê.
- **Commit documental automático ao fechar o pacote** usa o mesmo caminho de Git da M8-F01 — terminal controlado, auditado.
- **Nenhum gate é aprovado por "Decide por mim"** (critério 7 e invariante 3): delegação escolhe, o PI aceita.
