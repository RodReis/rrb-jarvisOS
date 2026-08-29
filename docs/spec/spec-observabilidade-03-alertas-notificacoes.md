# SPEC-Observabilidade-03 — Alertas e notificações

- MVP/Fatia: MVP-015 · M15-F03.
- Issue: ainda não criada.
- Status: **rascunho** (2026-08-29); aguarda aceite pré-construção do PI.
- Depende de: M15-F02 aprovada e entregue.
- Design: `docs/superpowers/specs/2026-08-29-mvp-015-observabilidade-operacional-design.md`.

## Objetivo

Transformar condições objetivas em alertas deduplicados, reconhecíveis e resolvíveis, com central interna canônica e notificação crítica do Windows, sem criar novo gate ou motor de incidentes.

## Stack e estrutura

- `src/shared/domain/operational-alert.ts`: regras, severidades, estados e transições.
- `src/shared/contracts/operational-alert.ts`: comandos e projeções públicas.
- `src/main/observability/alert-engine.ts`: avaliação determinística.
- `src/main/observability/alert-repository.ts`: alertas e ocorrências.
- `src/main/observability/notification-dispatcher.ts`: ports e entregas.
- `src/main/observability/windows-notification-adapter.ts`: adapter Electron/Windows.

```ts
type AlertState = 'open' | 'acknowledged' | 'resolved'
type AlertSeverity = 'info' | 'warning' | 'critical'

interface AlertFingerprintInput {
  readonly projectId: string
  readonly ruleId: string
  readonly resourceType: string
  readonly resourceId: string
  readonly windowId?: string
}
```

## Dentro

- `Alert`, `AlertOccurrence` e `NotificationDelivery`.
- Fingerprint determinístico, contador e primeira/última ocorrência.
- Transições `open → acknowledged → resolved` e reabertura do mesmo alerta.
- Reconhecimento pelo PI sem marcar correção.
- Resolução automática por condição objetiva e manual com justificativa.
- Catálogo aprovado de `warning` e `critical`.
- `info` suportado no contrato, sem regra inicial para transição normal.
- Central interna para todos os alertas.
- Notificação nativa somente para novo `critical` com app em segundo plano.
- Falha de entrega isolada do estado do alerta.
- Comandos auditados e idempotentes.

## Fora

- Bloquear release/run, executar compensação ou mudar política.
- Detecção por IA, ML, regressão estatística ou SLO inventado.
- E-mail, Slack, Discord, webhook, escala ou plantão.
- Popup do Windows para `info`/`warning`.
- Notificar cada recorrência deduplicada.

## Catálogo inicial

`warning`: adapter degradado/offline; reconciliação atrasada por duas janelas; run sem progresso além do lease/timeout; quota no limiar da política; Preview pendente após tolerância; diferença conhecida entre custo estimado/real.

`critical`: release/deploy/compensação falhou; divergência confirmada de Produção; recurso órfão após retries; cadeia de auditoria/evidência inválida; bloqueio duro de quota/gasto informado pelo provedor.

## Regras

1. Mesmo fingerprint atualiza ocorrência; não cria linha ou popup repetido.
2. `acknowledged` significa visto, nunca resolvido.
3. Resolução manual exige autor, horário e justificativa não vazia.
4. Resolução automática exige prova da condição inversa pela mesma regra/fonte compatível.
5. Nova ocorrência após resolução reabre o alerta preservando histórico.
6. `OperationalSignal` normal não gera alerta.
7. Alert engine não chama `ReleasePolicy` nem possui comando mutável do orquestrador.
8. Falha da notificação gera entrega falha e mantém o alerta canônico.

## Comandos de verificação

```text
npm run typecheck
npm run lint
npm test
npm run build
```

## Estratégia de testes

- Tabela completa de regras/severidades e transições válidas/inválidas.
- Mil ocorrências iguais geram um alerta e um primeiro aviso crítico.
- Fake clock cobre reabertura, resolução automática e recorrência.
- Adapter de notificação simula app em foreground/background e falha do SO.
- Contrafactual: reconhecer como resolver, notificar warning no Windows ou bloquear release precisa falhar.

## Critérios de aceite

1. Ocorrências idênticas atualizam contador e última ocorrência sem spam.
2. Fingerprints distintos não colidem entre projeto, regra, recurso ou janela.
3. Reconhecimento preserva alerta aberto e registra PI/horário.
4. Resolução manual sem justificativa é rejeitada.
5. Condição desaparecida resolve automaticamente e registra a evidência inversa.
6. Nova ocorrência reabre o mesmo alerta com histórico intacto.
7. Somente novo `critical` em segundo plano solicita notificação do Windows.
8. Falha do Windows não perde nem altera o alerta.
9. Nenhuma regra inicial excede o catálogo aprovado.
10. Teste prova que observabilidade não bloqueia, repete ou compensa operação.

## Limites

- **Sempre:** deduplicar, preservar ocorrências e separar visto de resolvido.
- **Consultar a SPEC:** nova regra, severidade, canal ou condição de resolução.
- **Nunca:** criar gate, usar IA para severidade, gerar spam ou esconder falha de entrega.

## Perguntas abertas ao PI

Nenhuma pergunta estrutural. Pendente apenas o aceite desta revisão exata antes da construção.
