# SPEC-Conectores-05 — Tavily Search

- MVP/Fatia: MVP-006 · M6-F05.
- Status: **revisão documental; implementação não autorizada**.
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
6. Context7 é roteado antes de Tavily quando a intenção for documentação técnica.

## Testes e evidência

Fixtures de sucesso e erros 401/429/432/433; deduplicação de URL; roteamento Context7/Tavily; smoke real com teto de créditos. Relatório `SPEC-Conectores-05`.

## Referências técnicas verificadas via Context7

- [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)
- [Créditos e planos da API](https://docs.tavily.com/documentation/api-credits)
