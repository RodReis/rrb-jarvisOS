# SPEC-Conectores-01 — Núcleo de conectores

- MVP/Fatia: MVP-006 · M6-F01.
- Status: **revisão documental; implementação não autorizada**.
- Dependências: MVP-005 (Vault e tipos de auditoria).

## Objetivo

Definir um contrato único de capacidades externas sem criar um proxy HTTP genérico. Cada adapter declara o que sabe fazer, valida sua entrada e retorna resultado ou erro normalizado.

## Não objetivos

- Implementar GitHub ou Tavily.
- Orquestrar planejamento ou execução.
- Expor credenciais ao renderer.

## Contratos

- `ConnectorId`, `ConnectorCapability` e versão do contrato.
- `ConnectorRequest`: operação, correlação, idempotency key, timeout e `CredentialRef`.
- `ConnectorResult`: dado normalizado, proveniência, uso e referências externas.
- `ConnectorError`: código estável, retentabilidade, evidência segura e ação de retomada.
- Registro explícito de adapters; nenhuma resolução arbitrária por URL.

## Fluxo

Resolver adapter → validar capacidade/entrada → obter referência de credencial → delegar à governança da F02 → executar → normalizar → registrar resultado.

## Critérios de aceite

1. Capability desconhecida falha antes de qualquer I/O.
2. Request inválida não chega ao adapter.
3. Resultado não carrega segredo ou objeto nativo do SDK.
4. Erros equivalentes de adapters diferentes podem ser tratados pelo orquestrador.
5. Renderer acessa somente IPC tipado e capacidades permitidas.
6. Não existe endpoint de proxy HTTP genérico.

## Testes e evidência

Unitários de validação/registro; contract fixture de adapter fake; teste de serialização IPC; relatório em `docs/test-reports/SPEC-Conectores-01.md`. Custo externo esperado: zero.

