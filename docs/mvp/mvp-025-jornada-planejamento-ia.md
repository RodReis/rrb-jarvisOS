# MVP-025 — Jornada de planejamento por IA

- Status: **aprovado pelo PI (2026-09-03)** — cinco SPECs `aprovada-pi` na mesma data, com todas as perguntas abertas resolvidas.
- GitHub: épico [#237](https://github.com/RodReis/rrb-jarvisOS/issues/237); fatias [#238](https://github.com/RodReis/rrb-jarvisOS/issues/238) (`proplan:next`), [#239](https://github.com/RodReis/rrb-jarvisOS/issues/239), [#240](https://github.com/RodReis/rrb-jarvisOS/issues/240), [#241](https://github.com/RodReis/rrb-jarvisOS/issues/241), [#242](https://github.com/RodReis/rrb-jarvisOS/issues/242) em `proplan:backlog`, assignee PI.
- Depende de: MVP-008 (entregue), MVP-005 (rota de assinatura, M5-F04) e MVP-006 (Tavily, M6-F05/F06).
- Fila: **logo após o MVP-009 fechar, antes do MVP-022 e do Command Center (MVP-017)** — decisão do PI de 2026-09-03. Sem fluxo de planejamento usável, o resto do Agentic OS não tem porta de entrada.
- Corrige: o fluxo inicial entregue pelo MVP-008. Não reabre o aceite do MVP-008 — as fatias dele continuam válidas como infraestrutura (Git local, `Decision`, anexos por ato, gates por hash); o que muda é **o que entra** nessa infraestrutura e **como o PI a percorre**.

## Por que este MVP existe

O PI testou o app em 2026-09-03 e o fluxo não é o desenhado em `docs/superpowers/specs/2026-08-28-pipeline-desenvolvimento-ia-design.md` (§8 e §9). Três causas, nenhuma delas do Code isolado:

1. **Não existe prompt.** O design ancora tudo no *prompt do projeto* e num `ProjectBriefSchema` de dez blocos obrigatórios. A SPEC-Planejamento-03 definiu só o **contrato da pergunta**, não o catálogo; o Code implementou cinco perguntas genéricas (escopo, público, superfície, pesquisa, origem do design). Em nenhum momento o PI diz o que o projeto é.
2. **Não existe geração.** As fatias M8-F03–F06 foram entregues com "nenhuma chamada de IA" — PRD, Landscape, Convention, arquitetura e roadmap são **compostos** das respostas e das evidências. A garantia estrutural ("não existe origem *modelo*") foi uma decisão do Code registrada no `STATUS-ARQUIVO.md`, aceita no fechamento do MVP-008 sem que a jornada montada tivesse sido vista (a verificação visual ficou "do PI" em todas as fatias).
3. **A tela é a soma das fatias.** O painel "Contexto do projeto" acumula o formulário de `ContextPack` (mecanismo interno sem consumidor), o pacote estrutural, os anexos e o roadmap, todos visíveis ao mesmo tempo, sem etapa atual. O design §6.1 previa Project Hub → Wizard A → Approval Gate → Execution Board.

## Fluxo-alvo (decisão do PI, 2026-09-03)

```
Prompt → Refinamento (IA pergunta) → aceite do brief
      → PRD + Landscape + Convention (IA gera) → aceite do PRD
      → Anexar DESIGN-SYSTEM.md e protótipos → Arquitetura (IA gera) → aceite do pacote
      → Roadmap, MVPs e SPEC (IA gera) → aceite do MVP → aceite da SPEC → construção (MVP-009)
```

## Decisões estruturais do PI (2026-09-03)

| # | Decisão | Onde |
|---|---|---|
| 1 | **Toda geração é por IA** — brief, PRD/Landscape/Convention, arquitetura, roadmap e SPEC. Reverte o "compor em vez de gerar" da M8-F04. Cada afirmação carrega **origem** (`prompt`, `decisao`, `evidencia`, `proposto`); o que a IA inferiu vem marcado como `proposto` e o PI aceita ou corta no gate | F02–F05 |
| 2 | **Três aceites antes da construção**: `BRIEF_ACCEPTED`, `PRD_ACCEPTED` e `PROJECT_PACKAGE` (arquitetura + anexos). Muda a decisão 2 do design de 2026-08-28 (aceite único do pacote). Não é aceite duplo: são revisões distintas de artefatos distintos | F02, F03, F04 |
| 3 | Landscape e Convention saem **junto do PRD**; **arquitetura só depois dos anexos** — decisão 9 do design e critério 1 da SPEC-Planejamento-05 mantidos | F03, F04 |
| 4 | O prompt é a **primeira etapa da jornada, depois de criar o projeto** (criar continua só com nome; vale para projeto importado) | F01, F02 |
| 5 | **Rota de assinatura (Claude MAX via Claude Code CLI, M5-F04) é a rota da geração** — uso registrado sem valor monetário, `BudgetPolicy` não barra (decisão 4 do MVP-008). Rota paga só por opt-in explícito do PI por projeto | todas |
| 6 | **Projeto sem brief volta para a etapa Prompt**; decisões já gravadas ficam na trilha (`decision` é append-only) e são reaproveitadas quando a pergunta coincidir | F01 |
| 7 | **O projeto tem estado visível**: o card mostra a etapa atual e um único próximo passo. "Contexto do projeto" deixa de ser tela; o `ContextPack` vira mecanismo interno, consultável como manifesto no histórico | F01 |

## Fatias

| Índice | SPEC | Resultado | Depende de |
|---|---|---|---|
| M25-F01 ([#238](https://github.com/RodReis/rrb-jarvisOS/issues/238)) | `spec-jornada-01-estado-e-jornada-unica.md` | Máquina de etapas do projeto, card com estado e próximo passo, `ContextPack` interno, migração dos projetos existentes. Sem IA | M8-F01–F06 |
| M25-F02 ([#239](https://github.com/RodReis/rrb-jarvisOS/issues/239)) | `spec-jornada-02-prompt-e-brief-por-ia.md` | Etapa Prompt; perguntas geradas pela IA sobre os dez blocos do `ProjectBriefSchema`; `BRIEF.md` com origem; gate `BRIEF_ACCEPTED` | F01, M5-F04 |
| M25-F03 ([#240](https://github.com/RodReis/rrb-jarvisOS/issues/240)) | `spec-jornada-03-prd-landscape-convention-por-ia.md` | PRD, Landscape e Convention gerados do brief aceito + evidência Tavily; itens `proposto` à parte; gate `PRD_ACCEPTED` | F02, M6-F05/F06 |
| M25-F04 ([#241](https://github.com/RodReis/rrb-jarvisOS/issues/241)) | `spec-jornada-04-arquitetura-por-ia.md` | Arquitetura, DECISIONS, TESTING e REVIEW gerados após anexos validados; `PROJECT_PACKAGE` | F03, M8-F05 |
| M25-F05 ([#242](https://github.com/RodReis/rrb-jarvisOS/issues/242)) | `spec-jornada-05-roadmap-mvp-spec-por-ia.md` | DAG de MVPs, MVP e SPEC gerados; validador de DAG mantido; `MVP_ENTRY`/`SLICE_ENTRY` | F04, M8-F06 |

## Invariantes deste MVP

- **Geração passa pelo ponto único** com `ContextPack` e orçamento (M8-F02, M5-F03). Não existe segundo caminho de chamada de modelo.
- **Nenhuma afirmação sem origem.** `proposto` é origem legítima **desde que marcada** — o que não pode existir é afirmação sem marca ou `proposto` escondido em prosa. O PI vê a lista de propostos separada antes de cada aceite.
- **Invariante 9 da CONVENTION continua valendo para texto gerado**: um validador de saída recusa requisito legal, regulatório, de consentimento, aceite duplo ou classificação de domínio que não conste do prompt ou de decisão do PI. O gerador não é confiado nisso; a saída é verificada.
- **Afirmação de mercado continua exigindo evidência extraída** (SPEC-Conectores-06). A IA sintetiza; não fabrica fonte.
- **Nenhum gate é aprovado por "Decide por mim"** nem por geração. Aprovar exige sessão autenticada (SPEC-Planejamento-06).
- **Mudança semântica a montante invalida só os gates dependentes** (matriz da SPEC-Planejamento-06, estendida aos dois gates novos).

## Done do MVP

- Um projeto novo vai do prompt à SPEC aprovada **por uma única superfície**, sempre com um próximo passo evidente.
- Todos os documentos gerados têm origem por afirmação; os `proposto` foram aceitos ou cortados pelo PI.
- Nenhuma chamada de modelo saiu por rota paga sem opt-in; o ledger registra o uso da rota de assinatura.
- `projeto1` (criado antes deste MVP) retoma na etapa Prompt sem perder as decisões gravadas.

## Riscos registrados

- **MVP-023 (Blueprints) referencia o wizard da M8-F03** (`M23-F02` alimenta "perguntas candidatas" no wizard existente). A F02 troca o catálogo fixo por perguntas geradas — a SPEC-Blueprints-02 precisará de emenda quando o MVP-023 entrar na fila. Registrado aqui, não resolvido aqui.
- O design de 2026-08-28 recebe **emenda** nas decisões 2 (aceites) e no §8 (passo 3 vira duas etapas com aceite; passo 4 ganha aceite). A emenda é registrada em `docs/DECISIONS.md` na publicação deste MVP.
