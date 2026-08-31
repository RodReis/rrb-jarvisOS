# SPEC-Observabilidade-04 — Consultas, retenção, rollups e CLI

- MVP/Fatia: MVP-015 · M15-F04.
- Issue: [#159](https://github.com/RodReis/rrb-jarvisOS/issues/159).
- Status: **aprovada-pi** (2026-08-29); issue em `proplan:backlog`; implementação depende da fila.
- Depende de: M15-F03 aprovada e entregue.
- Design: `docs/superpowers/specs/2026-08-29-mvp-015-observabilidade-operacional-design.md`.

## Objetivo

Entregar uma porta única e paginada de leitura para UI/CLI e controlar crescimento local por rollups e compactação idempotente sem remover marcos, alertas, auditoria ou evidência.

## Stack e estrutura

- `src/shared/contracts/observability-query.ts`: filtros, cursores, snapshots e deltas.
- `src/main/observability/observability-query-service.ts`: consultas/agregações canônicas.
- `src/main/observability/projection-stream.ts`: snapshot e deltas versionados.
- `src/main/observability/retention-service.ts`: seleção, rollup, proteção e compactação.
- `src/main/observability/daily-rollup-repository.ts`: agregados permanentes.
- `src/main/observability/observability-cli.ts`: interface read-only sobre o mesmo serviço.

```ts
interface ObservabilityCursor {
  readonly projectionVersion: number
  readonly sortValue: string
  readonly stableId: string
}

interface ObservabilityPage<T> {
  readonly items: readonly T[]
  readonly nextCursor?: ObservabilityCursor
  readonly projectionVersion: number
}
```

## Dentro

- `ObservabilityQueryService`, `DailyRollup` e `ProjectionCheckpoint` de leitura.
- Filtros por projeto, período, MVP, SPEC, run, PR, release, ambiente, provider, estado e severidade.
- Timeline correlacionada e paginação estável por cursor.
- Snapshot de visão geral e deltas por `projectionVersion`.
- Detecção de salto de versão e comando para snapshot completo.
- CLI para overview, timeline, alertas, saúde, uso/custo e referências de evidência.
- Exportação do filtro para relatório estruturado sem payload bruto.
- Retenção: marcos/alertas permanentes; amostras detalhadas por 30 dias; rollup diário antes da remoção.
- Proteção de `AuditEvent`, evidência de release e dados ligados a alerta aberto.
- Compactação com manifesto de entrada/saída, contagem, período e hash.
- Configuração por projeto sem redução retroativa de proteções.

## Fora

- Renderer consultando banco ou recalculando severidade/custo/saúde.
- Construtor de dashboard ou linguagem arbitrária de consulta.
- Comando CLI que inicie run/deploy/rollback/compensação ou altere política.
- Apagar outbox, auditoria, evidência ou alerta aberto.
- Visão multi-projeto/portfólio.

## Regras

1. Main process é o único dono do SQLite.
2. UI e CLI recebem o mesmo resultado para filtro e versão equivalentes.
3. Cursor inválido/obsoleto não retorna página silenciosamente inconsistente; exige novo snapshot.
4. Deltas só são aplicáveis à versão imediatamente anterior.
5. Compactação produz rollup confirmado antes do DELETE das amostras.
6. Retentar compactação com a mesma chave é no-op ou continuação segura.
7. Marcos duráveis não são substituídos por média/rollup.
8. Exportação contém metadados e referências sanitizadas, não log bruto.

## Comandos de verificação

```text
npm run typecheck
npm run lint
npm test
npm run build
```

## Estratégia de testes

- Queries comparadas contra fixture canônica e CLI snapshot.
- Paginação com inserts concorrentes, itens empatados e cursor obsoleto.
- Stream com delta perdido, duplicado e fora de ordem.
- Fake clock atravessa 30 dias e verifica rollup antes da compactação.
- Crash entre rollup/manifesto/delete retoma sem perda ou duplicação.
- Contrafactual: acesso SQLite pelo renderer ou remoção de item protegido precisa falhar.

## Critérios de aceite

1. UI/CLI obtêm overview, timeline, saúde, uso/custo e alertas pelo mesmo serviço.
2. Página repetida com mesmo cursor/versão retorna conjunto estável.
3. Salto de versão exige snapshot e não aplica delta parcial.
4. Consulta nunca carrega todos os eventos para filtrar em memória.
5. Aos 30 dias, amostra elegível possui rollup confirmado antes de ser removida.
6. Marco, alerta, auditoria e evidência protegidos sobrevivem à compactação.
7. Crash em qualquer fronteira da compactação converge sem perda lógica.
8. Exportação preserva filtros, versão, período e referências, sem campo proibido.
9. CLI não expõe comando mutável do orquestrador.
10. Configuração por projeto não consegue desproteger retroativamente evidência obrigatória.

## Limites

- **Sempre:** paginar, versionar snapshot/delta e confirmar rollup antes de remover amostra.
- **Consultar a SPEC:** novo filtro, agregado, prazo ou proteção.
- **Nunca:** ler SQLite no renderer, executar operação proprietária ou apagar fonte protegida.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-08-29.
