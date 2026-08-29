# SPEC-Aprendizado-01 — Fundação e ingestão

- MVP/Fatia: MVP-016 · M16-F01.
- Issue: ainda não criada.
- Status: **revisão-pi** (2026-08-29); implementação não autorizada.
- Depende de: MVP-015 concluído.
- Design: `docs/superpowers/specs/2026-08-29-mvp-016-aprendizado-operacional-design.md`.

## Objetivo

Criar a base local, tipada e reconstruível que transforma fatos operacionais já normalizados em `LearningObservation`, com proveniência, backfill, consumo incremental, retenção e cobertura explícita, sem consultar logs brutos nem acoplar o aprendizado às tabelas internas dos domínios proprietários.

## Stack e estrutura

- Node.js `>=22`, TypeScript 5.9, Electron main e `better-sqlite3`.
- `src/shared/domain/learning.ts`: observações, cobertura, estados e invariantes puros.
- `src/shared/contracts/learning.ts`: schemas versionados e allowlists.
- `src/main/learning/learning-evidence-source.ts`: contrato neutro e implementação sobre o serviço de observabilidade.
- `src/main/learning/learning-ingestor.ts`: backfill, incremental, checkpoints e backpressure.
- `src/main/learning/learning-observation-repository.ts`: persistência canônica mínima.
- `src/main/learning/learning-projection-repository.ts`: agregados derivados e rebuild.
- `src/main/learning/learning-retention-service.ts`: proteção, agregação e compactação.
- `src/main/storage/migrations.ts`: tabelas, índices e migrations forward-only.

Contrato mínimo:

```ts
type LearningObservationType =
  | 'run_outcome'
  | 'attempt_outcome'
  | 'failure_seen'
  | 'resolution_applied'
  | 'review_outcome'
  | 'context_usage'
  | 'executor_usage'
  | 'policy_decision'
  | 'release_outcome'

interface LearningObservationEnvelope<TPayload> {
  readonly observationId: string
  readonly schemaVersion: number
  readonly type: LearningObservationType
  readonly projectId: string
  readonly sourceEventId: string
  readonly sourceRevision: string
  readonly correlationId: string
  readonly occurredAt: string
  readonly observedAt: string
  readonly evidenceRef: { readonly id: string; readonly hash: string }
  readonly payload: TPayload
}
```

## Dentro

- `LearningEvidenceSource`, `LearningObservation`, `LearningFeedCheckpoint`, `IngestionCoverage`, `LearningAggregate` e `EvidenceProtection`.
- Adapter de F01 sobre `ObservabilityQueryService`/fontes canônicas existentes; nenhum novo requisito de escrita no MVP-015.
- Feed paginado por projeto, com cursor opaco, revisão da origem e referências de evidência.
- Backfill com `highWatermark` e cursor próprio; incremental usa outro cursor.
- Dedupe por `observationId`, `sourceEventId + schemaVersion` e hash lógico.
- Schemas discriminados e allowlist por tipo/versão; campo desconhecido falha antes do INSERT.
- Tipos iniciais aprovados: run, tentativa, falha, resolução, review, contexto, executor, política e release.
- Proveniência com origem, correlação, tempos, versão, hash e cobertura.
- Checkpoints retomáveis, lotes limitados e backlog visível.
- Registros derivados reconstruíveis e hash lógico do resultado.
- Retenção por valor operacional, proteção de amostra e agregação anterior à compactação.
- Estado `healthy | backfilling | degraded | rebuilding` por projeto.

## Fora

- Calcular fingerprint ou similaridade de falha, pertencentes à M16-F02.
- Criar, resolver ou promover políticas, pertencentes às M16-F03/F04.
- Chamar Claude/Codex, Graphify ou Caveman.
- Montar `ContextPack`, prompt de recuperação ou budget.
- UI, IPC público ou ação do PI.
- Alterar run, tentativa, PR, release ou projeção do MVP-015.
- Sincronizar observações externamente.

## Regras

1. `LearningEvidenceSource` expõe fatos normalizados e referências; conteúdo extenso continua no dono canônico.
2. F01 implementa o adapter consumidor. A SPEC não reabre nem modifica contratos já aprovados do MVP-015.
3. Backfill captura `highWatermark`; eventos posteriores usam cursor incremental independente.
4. Aplicação em qualquer ordem converge para o mesmo conjunto lógico de observações.
5. Duplicata idêntica é no-op; mesma identidade com conteúdo diferente é conflito sanitizado.
6. Lacuna, evidência removida ou hash divergente reduz `IngestionCoverage`; nunca gera atributo presumido.
7. Campo desconhecido, texto acima do limite ou tipo incompatível é rejeitado antes da persistência.
8. Prompt/resposta, log, stdout/stderr, diff, arquivo, ambiente bruto, cookie e credencial não cabem no schema.
9. Backfill não bloqueia ingestão nova nem execução da pipeline.
10. Falha do aprendizado não altera checkpoint da origem, domínio proprietário ou estado operacional.
11. Falhas, resoluções, decisões, promoções, reversões e snapshots são duráveis pela vida do projeto.
12. Detalhe de contexto, tokens, duração e tentativas acompanha a janela detalhada da origem; amostra protegida não compacta.
13. Compactação grava agregado determinístico, contagem e hash antes de remover detalhe elegível.
14. Mudança de retenção só vale para dados futuros e não remove decisão canônica.
15. Rebuild apaga somente projeções/agregados derivados e preserva observações canônicas, checkpoints de origem e proteções.

## Comandos de verificação

```text
npm run typecheck
npm run lint
npm test
npm run build
```

## Estratégia de testes

- Unitário dos nove schemas, allowlists, limites, cobertura e política de retenção.
- Integração SQLite com migrations, dois cursores, crash antes/depois do lote e retomada.
- Property test com duplicatas e permutações de backfill/incremental.
- Fixture com evento acima, abaixo e exatamente no `highWatermark`.
- Fixture com evidência ausente, hash divergente, schema futuro e conteúdo proibido.
- Rebuild completo gera o mesmo hash lógico das projeções.
- Compactação preserva amostra protegida e produz agregado reproduzível.
- Contrafactual: remover validação pré-INSERT, idempotência ou separação de cursor precisa quebrar teste.

## Critérios de aceite

1. Um projeto existente inicia backfill e continua ingerindo eventos novos sem lacuna nem duplicação.
2. Reinício em qualquer ponto retoma os dois cursores da última confirmação atômica.
3. A mesma evidência reaplicada cem vezes produz uma observação lógica.
4. Mesma identidade com hash diferente é rejeitada e diagnosticada sem persistir conteúdo bruto.
5. Cada observação aponta para origem, revisão, correlação e hash verificáveis.
6. Os nove tipos aceitam somente seus campos versionados; desconhecido falha antes do INSERT.
7. Evidência ausente ou compactada aparece como cobertura parcial e não impede ingestão válida.
8. Backlog deixa o aprendizado `backfilling`/`degraded`, mas não bloqueia run, merge ou release.
9. Rebuild produz as mesmas projeções e agregados lógicos.
10. Compactação nunca alcança amostra protegida nem registro durável e deixa contagem/hash verificáveis.
11. Logs da F01 não contêm payload, texto livre integral ou referência secreta.
12. Teste prova que F01 não escreve em tabelas/estados proprietários nem exige mudança no MVP-015.

## Limites

- **Sempre:** validar antes de persistir, registrar proveniência/cobertura, confirmar lote e checkpoint atomicamente e manter ingestão idempotente.
- **Consultar a SPEC:** novo tipo/schema, nova fonte, mudança de retenção, checkpoint ou proteção.
- **Nunca:** ler log bruto, copiar artefato extenso, presumir lacuna, bloquear a pipeline ou atualizar domínio proprietário.

## Suposições resolvidas pelo PI (2026-08-29)

1. O feed é contrato único sobre fatos normalizados do MVP-015 e referências aos donos canônicos; não há leitura direta de tabelas internas ou logs brutos.
2. Projeto existente usa backfill com `highWatermark` e cursor separado do incremental; cobertura parcial é explícita.
3. `LearningObservation` é união tipada/versionada com nove tipos iniciais e allowlist anterior à persistência.
4. Retenção separa marcos duráveis de detalhes compactáveis e protege amostras usadas por experimento/política em estabilização.

## Perguntas abertas ao PI

Nenhuma. Documento pronto para revisão exata do PI.
