# MVP-008 — Planejamento Governado

- Status: **finalizado e aceito pelo PI** (2026-08-31).
- GitHub: épico [#93](https://github.com/RodReis/rrb-jarvisOS/issues/93) fechado; seis fatias [#94–#99](https://github.com/RodReis/rrb-jarvisOS/issues/94) fechadas com `proplan:finalizado`.
- Depende de: MVP-005 e MVP-006.
- Não depende de: MVP-007.
- Resultado: projeto local, documentação estrutural aprovada, roadmap completo e próxima SPEC pronta para aprovação.
- **Pendência herdada do MVP-006, resolvida nesta revisão:** o roteamento Context7↔Tavily **não é escopo deste MVP**. O aplicativo não chama Context7 em momento algum; a pesquisa daqui é de mercado/web pelo Tavily, e documentação técnica é consultada na **construção** (MVP-009), pelo Claude Code que já tem Context7 como MCP.

## Tese

Transformar um prompt de projeto em um pacote versionado e verificável sem antecipar a implementação. O PI responde uma pergunta por vez, recebe recomendação e pode delegar escolhas reversíveis com “Decide por mim”. O Git local é automático; publicação remota pertence ao MVP-009.

## Gates

1. Anexos obrigatórios de design após o PRD.
2. Aprovação única do pacote estrutural por revisão.
3. Aprovação do MVP que entrará em construção.
4. Aprovação da fatia/SPEC que será executada.

A mesma revisão não volta ao PI. Mudanças invalidam somente gates dependentes.

## Decisões estruturais do PI (2026-08-29)

| # | Decisão | Onde |
|---|---|---|
| 1 | Projeto nasce **sob `userData`**; diretório externo exige opt-in na allowlist. Criar projeto nunca amplia permissão | M8-F01 |
| 2 | Git é o **`git` do sistema pelo terminal controlado do MVP-004**, não biblioteca embarcada — sem segundo caminho de escrita fora do enforcement | M8-F01 |
| 3 | Importar o **próprio `rrb-jarvisOS`** é critério de aceite da importação | M8-F01 |
| 4 | **Rota de assinatura (Claude MAX/Claude Code) registra uso sem valor monetário**; a `BudgetPolicy` gateia só rota paga | M8-F02 |
| 5 | O app **não chama Context7**; ele é do agente construtor no MVP-009 | M8-F02, M8-F04 |
| 6 | Anexos de design entram por **seletor de arquivos que copia e hasheia no ato** | M8-F05 |

Emendas geradas por estas decisões: `spec-providers-03-budget-policy.md` e `spec-providers-04-multi-provider-roteamento.md` (rota de assinatura é `unmetered`).

## Dependências duras registradas

- **M8-F01 depende da M4-F02** (#75, terminal controlado) por causa da decisão 2.
- A limitação temporária da M8-F01 ao diretório do app foi removida após a entrega da UI da allowlist de diretórios na M4-F03 ([#110](https://github.com/RodReis/rrb-jarvisOS/issues/110)).

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
