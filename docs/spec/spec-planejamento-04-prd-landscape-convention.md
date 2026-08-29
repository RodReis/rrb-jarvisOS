# SPEC-Planejamento-04 — PRD, Landscape e Convention

- MVP/Fatia: MVP-008 · M8-F04.
- Issue: [#97](https://github.com/RodReis/rrb-jarvisOS/issues/97).
- Status: **aprovada-pi** (2026-08-29) — papel do Context7 resolvido pelo PI nesta data; demais decisões herdadas da M8-F02.
- Depende de: M8-F03 e M6-F05/F06 (Tavily Search e Extract).

## Objetivo

Converter as decisões do wizard em `PRD.md`, `LANDSCAPE.md` e `CONVENTION.md` rastreáveis antes da arquitetura.

## PRD

Define problema, usuários, jornadas, escopo, não objetivos, critérios de sucesso, restrições e questões pendentes. Cada requisito aponta para decisão do PI ou fonte explícita.

## Landscape

Registra cenário competitivo, alternativas gratuitas, abordagens que morreram, diferenciação, fontes/datas, incertezas e gatilhos de revisão. Pesquisa usa **Tavily Search+Extract**. Documentação técnica **não é consultada aqui** — é assunto do agente construtor no MVP-009 (decisão do PI 2026-08-29).

## Convention

Define entidades, estados, invariantes, vocabulário e regras de negócio realmente informadas. Não importa políticas de outro projeto.

## Fluxo

Gerar rascunho → pesquisar/extrair → vincular afirmações → detectar contradições → perguntar ao PI → revisar → criar commit documental automático.

## Critérios de aceite

1. Todo requisito material possui origem.
2. Toda conclusão externa material possui evidência extraída.
3. Falta de pesquisa necessária gera `BLOCKED_EXTERNAL`, sem preencher por memória do modelo.
4. PRD distingue escopo de não objetivo.
5. Convention não contém regra inventada.
6. Landscape define gatilhos de revisão.
7. Os três documentos formam revisão imutável no Git.

## Testes, evidência e custo

Fixtures de fontes, indisponibilidade, contradição e conteúdo hostil; validação de links/hashes; smoke Tavily com teto de créditos. Relatório `SPEC-Planejamento-04`.

## Perguntas resolvidas pelo PI (2026-08-29)

1. **Context7 nesta fatia:** **não existe**. O `LANDSCAPE.md` é pesquisa de mercado, alternativas e diferenciação — território do Tavily. Consulta a documentação técnica atual acontece na **construção** (MVP-009), pelo Claude Code com Context7 como MCP. Sem conector Context7 no app, sem critério de aceite dependendo dele. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **Toda afirmação material do `LANDSCAPE.md` referencia evidência extraída** (SPEC-Conectores-06), com URL, data, trecho e hash. Snippet de busca não sustenta afirmação sozinho.
- **Falha de pesquisa bloqueia a conclusão** com `BLOCKED_EXTERNAL`; memória do modelo nunca preenche evidência — já é critério, cravado aqui como invariante da fatia.
- **`CONVENTION.md` gerado não importa política de outro projeto**, incluindo deste repositório: só entra regra que o PI informou.
