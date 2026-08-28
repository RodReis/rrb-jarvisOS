# SPEC-Planejamento-04 — PRD, Landscape e Convention

- MVP/Fatia: MVP-008 · M8-F04.
- Status: **revisão documental; implementação não autorizada**.
- Depende de: M8-F03 e M6-F05/F06.

## Objetivo

Converter as decisões do wizard em `PRD.md`, `LANDSCAPE.md` e `CONVENTION.md` rastreáveis antes da arquitetura.

## PRD

Define problema, usuários, jornadas, escopo, não objetivos, critérios de sucesso, restrições e questões pendentes. Cada requisito aponta para decisão do PI ou fonte explícita.

## Landscape

Registra cenário competitivo, alternativas gratuitas, abordagens que morreram, diferenciação, fontes/datas, incertezas e gatilhos de revisão. Pesquisa usa Tavily Search+Extract; documentação técnica usa Context7.

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

