# MVP-008 — Planejamento Governado

- Status: **desenho aprovado pelo PI em 2026-08-28; SPECs em revisão documental; implementação não autorizada**.
- GitHub: épico [#93](https://github.com/RodReis/rrb-jarvisOS/issues/93); fatias [#94–#99](https://github.com/RodReis/rrb-jarvisOS/issues/94), estado `proplan:planejado`.
- Depende de: MVP-005 e MVP-006.
- Não depende de: MVP-007.
- Resultado: projeto local, documentação estrutural aprovada, roadmap completo e próxima SPEC pronta para aprovação.

## Tese

Transformar um prompt de projeto em um pacote versionado e verificável sem antecipar a implementação. O PI responde uma pergunta por vez, recebe recomendação e pode delegar escolhas reversíveis com “Decide por mim”. O Git local é automático; publicação remota pertence ao MVP-009.

## Gates

1. Anexos obrigatórios de design após o PRD.
2. Aprovação única do pacote estrutural por revisão.
3. Aprovação do MVP que entrará em construção.
4. Aprovação da fatia/SPEC que será executada.

A mesma revisão não volta ao PI. Mudanças invalidam somente gates dependentes.

## Fatias

| Índice | SPEC | Resultado |
|---|---|---|
| M8-F01 | `spec-planejamento-01-projeto-git-local.md` | Diretório, SQLite e Git local |
| M8-F02 | `spec-planejamento-02-contexto-skills-orcamento.md` | ContextPack e orçamento antes da IA |
| M8-F03 | `spec-planejamento-03-wizard-orientado.md` | Perguntas, recomendação e retomada |
| M8-F04 | `spec-planejamento-04-prd-landscape-convention.md` | PRD, pesquisa e domínio |
| M8-F05 | `spec-planejamento-05-anexos-design-arquitetura.md` | Anexos do PI, validação e arquitetura |
| M8-F06 | `spec-planejamento-06-roadmap-aprovacoes.md` | Roadmap, índice e gates por revisão |

## Done do MVP

- Wizard retoma sem perda e não inventa requisitos.
- Context7 e ResearchAdapter têm papéis separados e verificáveis.
- PRD, Landscape e Convention são versionados.
- PI anexa `DESIGN-SYSTEM.md`, HTML e assets; IA apenas analisa e propõe ajustes.
- Pacote estrutural aprovado referencia hashes exatos.
- Roadmap completo existe; somente a próxima fatia recebe detalhamento executável.
- Commits documentais são automáticos por marco.
