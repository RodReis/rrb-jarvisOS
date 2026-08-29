# SPEC-Conectores-06 — Tavily Extract e evidências

- MVP/Fatia: MVP-006 · M6-F06.
- Issue: [#92](https://github.com/RodReis/rrb-jarvisOS/issues/92).
- Status: **aprovada-pi** (2026-08-29) — local do armazenamento de evidência resolvido pelo PI nesta data.
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
- Evidência extensa fica no **diretório de artefatos gerido pelo app** (`userData/artifacts/<run>/`, já dentro da allowlist de diretórios da SPEC-Execucao-03), referenciada por hash; o documento versionado contém apenas resumo e hash.

## Critérios de aceite

1. Toda afirmação externa material referencia ao menos uma evidência extraída.
2. Hash detecta mudança de conteúdo entre revisões.
3. Falha parcial preserva fontes válidas e identifica as ausentes.
4. Deduplicação não funde fontes com conteúdo divergente.
5. Crédito de Search e Extract é atribuído separadamente, ambos no ledger de créditos da SPEC-Conectores-02.
6. Pipeline não conclui Landscape verificado quando a extração necessária falhar.

## Testes e evidência

Fixtures de HTML, Markdown, redirect, duplicata, falha parcial e conteúdo hostil; smoke real limitado; relatório `SPEC-Conectores-06`.

## Referências técnicas verificadas via Context7

- [Tavily Extract API](https://docs.tavily.com/api-reference/endpoint/extract)
- [Visão geral da Tavily API](https://docs.tavily.com/documentation/api-reference/introduction)

## Perguntas resolvidas pelo PI (2026-08-29)

1. **Onde vive a evidência extensa:** **diretório de artefatos gerido pelo app** (`userData/artifacts/<run>/`), que já está dentro da allowlist de diretórios do MVP-002 e é gravável pelo enforcement do MVP-004. Descartados: blob no SQLite (incha um banco que hoje é leve com HTML extraído) e "dentro do projeto do MVP-008" (criaria dependência do MVP-006 num MVP que ainda não existe). Mover a evidência para dentro do projeto, se desejável, é decisão do MVP-008. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **Dois hashes por item de evidência:** o do `raw_content` extraído (detecta mudança da fonte entre revisões) e o do **trecho citado** (prova que a citação corresponde ao que foi extraído). Um só hash não distingue "a fonte mudou" de "a citação está errada".
- **Retenção do artefato acompanha o `ExecutionRun`** que o gerou; limpeza é escopo do MVP-009 (SPEC-Entrega-06), não desta fatia.
- **Conteúdo externo é dado, nunca instrução** — já está nas Regras; o pacote de evidência não é interpretado como prompt em nenhum ponto do pipeline.
