# SPEC-Conectores-01 — Núcleo de conectores

- MVP/Fatia: MVP-006 · M6-F01.
- Issue: [#87](https://github.com/RodReis/rrb-jarvisOS/issues/87).
- Status: **aprovada-pi** (2026-08-29) — decisão estrutural da fronteira com o MVP-005 resolvida pelo PI nesta data.
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

## Perguntas resolvidas pelo PI (2026-08-29)

1. **Fronteira com o ponto único de chamada de IA (SPEC-Providers-02):** **dois runtimes separados**. O runtime de conectores (`ConnectorRequest`/`ConnectorResult`) é paralelo ao ponto único de IA (`callProvider`) e **não passa por ele**; compartilham apenas o Vault (SPEC-Providers-01), o `AuditEvent` encadeado (ADR-004) e o ledger de uso. Motivo: os contratos são incompatíveis — stream de chunks com `usage` ao fim versus mutação idempotente com `ExternalRef` — e unificá-los produziria uma abstração genérica que serviria mal aos dois. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **Escopo de toda entidade desta fatia:** `user_id` + `workspace_id`, espelhando o `CredentialRef` da SPEC-Providers-01. O `project_id` citado na SPEC-Conectores-02 é **opcional/nulo** até o MVP-008 — projeto só nasce lá.
- **Nenhum contrato desta fatia conhece provider concreto:** GitHub e Tavily entram como adapters registrados (F03–F06), sem alterar o registro nem o `ConnectorRequest`.
- **O runtime separado não duplica governança:** health, retry, custo, auditoria e sanitização vivem na F02, uma vez só, para todos os adapters.
