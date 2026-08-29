# SPEC-Conectores-05 — Tavily Search

- MVP/Fatia: MVP-006 · M6-F05.
- Issue: [#91](https://github.com/RodReis/rrb-jarvisOS/issues/91).
- Status: **aprovada-pi** (2026-08-29) — orçamento em créditos, remoção do critério de roteamento Context7 e escopo de UI resolvidos pelo PI nesta data.
- Depende de: M6-F01, M6-F02 e Vault do MVP-005.

## Objetivo

Pesquisar web geral e mercado pela Tavily Search API, preservando URLs, proveniência, custo e incerteza. Context7 continua obrigatório para documentação técnica suportada.

## Contrato

- Entrada: consulta, profundidade, máximo de resultados, domínios incluídos/excluídos e orçamento.
- Saída: título, URL canônica, domínio, trecho, score quando fornecido, data de coleta, `request_id` e créditos.
- Autenticação Bearer obtida por `CredentialRef`.
- V1 não usa resposta sintetizada como evidência e não chama `/research`.

## Erros

- 401: credencial ausente/incorreta.
- 429: rate limit, sujeito a backoff.
- 432: limite do plano.
- 433: limite PayGo.
- 5xx/timeout: falha externa retentável dentro da política.

## Critérios de aceite

1. Pesquisa retorna resultados normalizados com fonte verificável.
2. `request_id` e créditos entram no ledger.
3. URL é normalizada sem perder a URL original.
4. Resultado sem fonte não sustenta afirmação do `LANDSCAPE.md`.
5. Erro/quota produz `BLOCKED_EXTERNAL`; memória do modelo não preenche resultados.
6. Consumo de créditos passa pelo **ledger de créditos** da SPEC-Conectores-02; estourar o teto barra a próxima pesquisa sem tocar o orçamento de IA.
7. **UI mínima:** a chave Tavily é cadastrada em Settings pelo Vault (`CredentialRef`), com estado `present`/`missing` visível e sem exibir o valor.

## Testes e evidência

Fixtures de sucesso e erros 401/429/432/433; deduplicação de URL; teto de créditos aplicado; smoke real com teto de créditos. Relatório `SPEC-Conectores-05`.

## Referências técnicas verificadas via Context7

- [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)
- [Créditos e planos da API](https://docs.tavily.com/documentation/api-credits)

## Perguntas resolvidas pelo PI (2026-08-29)

1. **Roteamento Context7 antes da Tavily:** **removido dos critérios de aceite desta fatia**; o roteamento por intenção sai desta fatia. **Ajuste na mesma data, na revisão do MVP-008:** o destino final é o **MVP-009**, não o MVP-008 — o app não chama Context7 em momento algum; quem o usa é o **agente construtor** (Claude Code, que já o tem como MCP). O Context7 hoje é MCP consumido pelo Claude Code, não capacidade do app, e uma fatia não pode ter critério de aceite que depende de algo inexistente. A fronteira do MVP-006 ("Context7 atende documentação técnica; Tavily atende mercado e web geral") continua válida, mas descreve **quem consulta o quê na pipeline**, não uma capacidade do aplicativo. — decidido.
2. **Orçamento da pesquisa:** **ledger de créditos separado** (SPEC-Conectores-02), não a `BudgetPolicy` em USD do MVP-005. — decidido.
3. **UI:** **mínima, dentro desta fatia** — cadastro da chave em Settings pelo Vault. Sem fatia dedicada de UI. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **`depth` padrão `basic`**; `advanced` é escolha explícita, porque custa mais créditos.
- **Teto de créditos por run e por dia**, ajustáveis, com padrão conservador — espelha o desenho da `BudgetPolicy` sem se misturar com ela.
- **Credencial Tavily escopada por `user_id` + `workspace_id`**, como toda credencial do MVP-006.
