# SPEC-Observabilidade-01 — Núcleo de eventos, outbox e projeções

- MVP/Fatia: MVP-015 · M15-F01.
- Issue: ainda não criada.
- Status: **rascunho** (2026-08-29); aguarda aceite pré-construção do PI.
- Depende de: MVP-014 concluído.
- Design: `docs/superpowers/specs/2026-08-29-mvp-015-observabilidade-operacional-design.md`.

## Objetivo

Criar o núcleo local-first que registra fatos operacionais junto do estado canônico, projeta timeline/métricas de forma idempotente e reconstrói as projeções depois de crash sem misturar log, auditoria ou payload bruto.

## Stack e estrutura

- Node.js `>=22`, TypeScript 5.9, Electron main e `better-sqlite3`.
- `src/shared/domain/observability.ts`: eventos, checkpoints, estados e invariantes puros.
- `src/shared/contracts/observability.ts`: schemas versionados e consultas básicas.
- `src/main/observability/outbox-repository.ts`: gravação/claim/confirmação da outbox.
- `src/main/observability/operational-projector.ts`: aplicação idempotente e rebuild.
- `src/main/observability/projection-repository.ts`: eventos e projeções derivadas.
- `src/main/storage/migrations.ts`: tabelas, índices e migrations forward-only.

Contrato mínimo:

```ts
interface OperationalEventEnvelope<TType extends string, TPayload> {
  readonly eventId: string
  readonly schemaVersion: number
  readonly type: TType
  readonly projectId: string
  readonly aggregateId: string
  readonly aggregateVersion: number
  readonly idempotencyKey: string
  readonly correlationId: string
  readonly causationId?: string
  readonly occurredAt: string
  readonly payload: TPayload
}
```

## Dentro

- `OutboxEvent`, `OperationalEvent` e `ProjectionCheckpoint`.
- API transacional para domínio gravar estado + evento já validado/sanitizado.
- Allowlist por tipo e versão; campo desconhecido é rejeitado antes do INSERT.
- Claim com lease, retry idempotente, confirmação e quarentena sanitizada de schema incompatível.
- Dedupe por `eventId` e `idempotencyKey`; conflito de payload é erro explícito.
- Ordenação por versão do agregado, com `occurredAt` e `observedAt` separados.
- Projeções mínimas de timeline e contadores por projeto/MVP/SPEC/run.
- Rebuild que apaga somente projeções derivadas e reaplica fontes canônicas.
- Estado próprio `healthy | degraded | rebuilding` da observabilidade.
- Instrumentação estruturada sem copiar payload do evento para log.

## Fora

- Consultar GitHub ou provedores.
- Calcular saúde externa, custo/quota ou alertas.
- UI, notificação, retenção definitiva ou rollup diário.
- Alterar estados dos domínios proprietários.

## Regras

1. Outbox e estado canônico pertencem à mesma transação SQLite.
2. Payload entra sanitizado; projector nunca “limpa depois”.
3. Falha do projector mantém evento pendente e não reverte commit canônico.
4. Evento duplicado com mesmo conteúdo é no-op; conteúdo diferente com a mesma chave é conflito.
5. Evento atrasado pode completar a timeline, mas não regredir versão atual do agregado.
6. `OperationalEvent`, log e `AuditEvent` têm storage e finalidade distintos.
7. Rebuild preserva auditoria, evidência, outbox e estados canônicos.
8. Nenhum campo aceita segredo, prompt/resposta, arquivo, diff, ambiente ou stdout/stderr bruto.

## Comandos de verificação

```text
npm run typecheck
npm run lint
npm test
npm run build
```

## Estratégia de testes

- Unitário dos schemas, allowlists, versões, fingerprints e ordenação causal.
- Integração SQLite com crash antes/depois do claim e antes/depois da confirmação.
- Property test com duplicatas, lacunas e permutações da mesma sequência.
- Migration sobe banco antigo, projeta, reabre e reconstrói com o mesmo hash lógico.
- Contrafactual: remover dedupe, atomicidade ou validação pré-INSERT precisa quebrar teste.

## Critérios de aceite

1. Uma transação confirmada contém estado canônico e outbox; falha não deixa apenas um dos dois.
2. Reinício processa pendências sem duplicar projeções.
3. Mesmo evento reaplicado cem vezes produz uma ocorrência lógica.
4. Mesma chave com payload diferente é rejeitada e diagnosticada sem persistir o payload proibido.
5. Evento fora de ordem não regride estado atual e continua visível na timeline pelo tempo original.
6. Campo proibido ou desconhecido falha antes da persistência.
7. Rebuild completo produz os mesmos contadores, timeline e checkpoints.
8. Backlog/quarentena deixa a observabilidade `degraded` com causa e ação mínima.
9. Falha do projector não altera release, run, PR ou outro agregado proprietário.
10. Testes provam que logs e `AuditEvent` não são usados como substitutos da outbox.

## Limites

- **Sempre:** validar antes de persistir, usar transação e tornar replay idempotente.
- **Consultar a SPEC:** novo tipo/schema, mudança de checkpoint ou política de rebuild.
- **Nunca:** persistir payload bruto, atualizar domínio proprietário ou apagar fonte canônica.

## Perguntas abertas ao PI

Nenhuma pergunta estrutural. Pendente apenas o aceite desta revisão exata antes da construção.
