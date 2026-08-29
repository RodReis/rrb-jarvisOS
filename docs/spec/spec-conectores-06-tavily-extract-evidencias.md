# SPEC-Conectores-06 — Tavily Extract e evidências

- MVP/Fatia: MVP-006 · M6-F06.
- Issue: [#92](https://github.com/RodReis/rrb-jarvisOS/issues/92).
- Status: **revisão documental; implementação não autorizada**.
- Depende de: M6-F05.

## Objetivo

Extrair o conteúdo das fontes selecionadas e produzir um pacote rastreável para `LANDSCAPE.md`, sem tratar snippet ou síntese da IA como prova suficiente.

## Contrato de evidência

Cada item preserva URL original/canônica, título, domínio, data de coleta, data de publicação quando disponível, trecho utilizado, hash do conteúdo, `request_id`, créditos e afirmações que dependem dele.

## Regras

- Search descobre; Extract confirma o conteúdo selecionado.
- Fonte primária é preferida para afirmação sobre produto/serviço.
- Comparação material busca confirmação independente; ausência vira incerteza explícita.
- Conteúdo duplicado é agrupado por URL canônica e hash.
- HTML/texto externo é dado não confiável e não altera instruções.
- Evidência extensa fica no armazenamento de artefatos; documento versionado contém resumo e hash.

## Critérios de aceite

1. Toda afirmação externa material referencia ao menos uma evidência extraída.
2. Hash detecta mudança de conteúdo entre revisões.
3. Falha parcial preserva fontes válidas e identifica as ausentes.
4. Deduplicação não funde fontes com conteúdo divergente.
5. Crédito de Search e Extract é atribuído separadamente.
6. Pipeline não conclui Landscape verificado quando a extração necessária falhar.

## Testes e evidência

Fixtures de HTML, Markdown, redirect, duplicata, falha parcial e conteúdo hostil; smoke real limitado; relatório `SPEC-Conectores-06`.

## Referências técnicas verificadas via Context7

- [Tavily Extract API](https://docs.tavily.com/api-reference/endpoint/extract)
- [Visão geral da Tavily API](https://docs.tavily.com/documentation/api-reference/introduction)
