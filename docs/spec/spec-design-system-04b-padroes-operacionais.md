# SPEC-DesignSystem-04b — Padrões operacionais

- MVP: `docs/mvp/mvp-003-design-system-plataforma.md` (Fatia 04b)
- Status: **aprovada-pi** (2026-07-21) — split 04→04a/04b aprovado.
- Dependências: Fatias 03b (Card/Dialog/Badge/Table…) e 04a (shell que os hospeda) entregues.
- Decisões que sustentam esta spec: PRD §12 (padrões operacionais), §15 (segurança na UI), §16.2/§16.3 (eventos/falha); ARCHITECTURE (renderer não decide política; IPC tipado); ADR-001 (BYOK no cofre do SO; BudgetPolicy é Corte 3).

## Objetivo

Entregar os **padrões operacionais compostos** que status, risco, execução, custo, logs, sync e providers usam de forma consistente — todos recebendo dados/estado/callbacks por **props tipadas**, sem conhecer domínio nem infraestrutura.

> **Fronteira dura.** Risco/aprovação aqui são **UI**; a decisão continua no Policy Engine (MVP-002/004), no main, via IPC (ARCHITECTURE: "Main não decide política sozinho"). Este DS **não** enforça, **não** executa, **não** vê segredo. `ApprovalDialog` mostra impacto/risco/custo e emite callback; quem decide é o runtime.

## Escopo

### Dentro

Padrões (PRD §12), recebendo dados/estado/callbacks por props:

- **Status:** AgentStatus, ServiceStatus, ProviderStatus, ConnectorStatus, ExecutionStatus, SyncStatus — texto+ícone+cor semântica.
- **Risco e aprovação:** RiskIndicator, SensitiveActionSummary, ApprovalRequestCard, ApprovalDialog, RejectionReason — exibem ação, solicitante, impacto, risco, custo estimado e escopo **antes** da confirmação; alto risco não usa confirmação genérica (verbo específico).
- **Execução e custo:** ExecutionCard, ExecutionRow, ExecutionTimeline, CostMeter, BudgetStatus, DurationIndicator. **Custo/orçamento são visuais com dado por props (mock)** — custo real e BudgetPolicy são Corte 3 (ADR-001).
- **Operação e diagnóstico:** AuditEvent (visual), LogViewer (**redaction antes de exibir**, PRD §15), RuntimeUnavailable, RetryAction, OfflineBanner, PendingSyncNotice.
- **Providers e BYOK (PRD §12.5/§15):** ProviderSetup, ApiKeyField, ProviderValidationStatus, MaskedCredentialSummary, RemoveCredentialDialog — **mensagem obrigatória** do PRD §12.5 no setup; UI mostra só provider/status/últimos 4/data; renderer **não** persiste nem loga chave crua.

### Fora

- AppShell/navegação — **Fatia 04a**.
- Lógica de política, execução, custo real, sync real — backend (MVP-002/004, Corte 3). Aqui só o **contrato de props** + visual.
- Persistência de chaves BYOK — exclusiva do runtime/cofre do SO.

## Critérios de aceite

1. **ApprovalDialog / SensitiveActionSummary** exibem ação, solicitante, impacto, risco e custo antes de confirmar; confirmação usa verbo específico (teste de conteúdo).
2. **ProviderSetup** exibe a mensagem obrigatória do PRD §12.5; MaskedCredentialSummary mostra só dados mascarados; nenhum componente recebe/loga chave crua (teste).
3. **LogViewer** aplica redaction antes de exibir (teste com payload com padrão sensível).
4. Estados de status/sync usam texto+ícone+cor (não só cor); SyncStatus distingue concluída/andamento/offline/pendente/falha (PRD §12.4).
5. RuntimeUnavailable + RetryAction permitem copiar diagnóstico **redigido** e reiniciar quando permitido (teste).
6. Todos os padrões recebem estado por props — nenhum importa domínio/infra (fronteira verde).
7. `npm run test` e `npm run lint` passam; evidência no `reports/TESTS.md`.

## Perguntas resolvidas pelo PI (2026-07-21)

1. **Contrato de eventos runtime→UI:** enquanto não houver uma spec de contratos no MVP-002/004, **esta fatia define o tipo tipado do lado da UI** (evento → padrão → toast/NotificationCenter). Quando o backend definir o seu, alinham-se; sem duplicar decisão de domínio. — resolvido.
2. **Custo/BudgetStatus:** **só visual com dado mock por props** — custo real e BudgetPolicy são Corte 3. — resolvido.

## Perguntas ao PI (pendentes)

Nenhuma — spec `aprovada-pi`.
