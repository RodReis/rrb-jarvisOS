# SPEC-Memoria-06 — Memória operacional e validação de lições

- MVP/Fatia: MVP-007 · M7-F06.
- Issue: [#185](https://github.com/RodReis/rrb-jarvisOS/issues/185); épico [#179](https://github.com/RodReis/rrb-jarvisOS/issues/179).
- Status: **em revisão pelo PI**; issue permanece em `proplan:planejado`; implementação não autorizada.
- Revisão submetida: será preenchida após versionar este documento. O aceite deve citar o hash exato.
- Depende de: M7-F03 (#182), revisão aprovada `c3b546a1787961bb0b9bb407cd7213d5b7046b1b`; preserva os contratos aprovados de M7-F01/F02.
- Compatibilidade: M7-F04 (#183), revisão aprovada `027f8274dc4e3d39a6fc24ce394ea6b53d70f986`, rege retenção/exclusão; M7-F05 (#184) é opcional e não constitui dependência.
- Design: `docs/superpowers/specs/2026-08-30-mvp-007-memoria-compartilhada-design.md`, seções 13, 14 e 19.
- Índice canônico: `docs/STATUS.md`.

## Objetivo e limite desta revisão

Transformar resultados operacionais verificáveis em lições consultáveis sem permitir que a memória, um modelo ou a conclusão textual declare sucesso por conta própria. O módulo de origem define o significado de sucesso em critérios versionados; a F06 coordena evidências, avaliações e estados derivados; a F03 recupera apenas o que estiver validado e aplicável.

A V1 integra dois resultados já representáveis: execução comparada a uma expectativa vinculada antes do resultado e entrega de projeto comparada aos gates registrados. Outras fontes ficam com cobertura explícita até oferecerem resultado canônico e avaliador próprio. A pipeline continua avaliando e promovendo seu aprendizado no MVP-016.

Alternativas consideradas:

- **Ledger imutável de evidências e avaliações + avaliadores por módulo — selecionada:** preserva prova, histórico e responsabilidade de domínio sem motor genérico.
- Motor central de regras: concentraria significado de sucesso na memória, duplicando regras dos módulos e criando linguagem prematura.
- Registro mutável com validação manual: perderia a trilha causal, exigiria aceite repetido e não atenderia à automação aprovada.

Não fazem parte desta fatia: interface visual, IPC público, linguagem genérica de regras, embeddings, chamada de modelo, generalização automática entre projetos, promoção de política da pipeline, Graphify obrigatório, validação por quantidade de repetições, prova de impacto/causalidade de produto ou novo gate de aprovação humana.

## Fronteiras e fluxo

```text
resultado canônico do módulo
  -> adapter normaliza candidato/evidência
  -> inbox transacional persiste intenção
  -> coordenador local agenda avaliação idempotente
  -> avaliador versionado do módulo aplica critérios
  -> ledger grava avaliação imutável
  -> estado atual da lição é derivado
  -> F03 recupera somente lição validada e aplicável
```

| Unidade | Responsabilidade |
|---|---|
| Módulo de origem | Definir `lessonKey`, resultado canônico, critérios e dimensões materiais. |
| Adapter do módulo | Normalizar referências e cobertura; não interpretar sucesso. |
| `OperationalLessonService` | Receber candidato/evidência, validar envelope, deduplicar e consultar estado. |
| `LessonEvaluationCoordinator` | Manter inbox/fila, escalonar, retomar e reprocessar. |
| Avaliador versionado | Produzir resultados determinísticos por critério. |
| Repositório F06 | Persistir ledger, jobs, capacidades e projeção do estado atual. |
| Recuperação F03 | Aplicar estado, projeto, validade e dimensões materiais à consulta. |
| Manutenção F04 | Aplicar retenção, exclusão e barreiras sem ressuscitar conteúdo. |

Estrutura futura sugerida, a conferir contra a base real antes da implementação:

```text
src/shared/domain/operational-lessons.ts
src/shared/contracts/operational-lessons.ts
src/main/memory/lessons/operational-lesson-service.ts
src/main/memory/lessons/evaluation-coordinator.ts
src/main/memory/lessons/evaluation-repository.ts
src/main/memory/lessons/evaluators/execution-expected-outcome.ts
src/main/memory/lessons/evaluators/project-delivery-gate.ts
```

Nomes podem acompanhar as convenções reais do código. As responsabilidades não podem ser fundidas com Graphify, com o seletor da F03 ou com a promoção de políticas do MVP-016.

## Identidade, revisão e escopo

A identidade lógica é composta por `moduleId + lessonKey + projectId`. `revision` identifica mudança material da afirmação ou de suas condições. Reentrega do mesmo evento é idempotente; não existe união semântica automática por similaridade textual.

Na V1, somente uma lição com `projectId` igual ao projeto de origem pode chegar a `validated`. Uma hipótese de produto ou entre projetos pode ser armazenada como `candidate`, mas exige avaliador futuro específico para validação. Observar a mesma hipótese em vários projetos não a generaliza automaticamente.

```ts
type LessonState = 'candidate' | 'validated' | 'needs_revalidation'
type EvaluationOutcome = 'supported' | 'insufficient' | 'contradicted'

interface OperationalLessonKey {
  readonly schemaVersion: 1
  readonly moduleId: string
  readonly lessonKey: string
  readonly projectId: string
  readonly revision: number
}

interface LessonCandidate {
  readonly key: OperationalLessonKey
  readonly claim: string
  readonly conditions: Readonly<Record<string, string>>
  readonly evaluatorId: string
  readonly evaluatorVersion: string
  readonly requiredCriterionIds: readonly string[]
  readonly createdFromEventId: string
  readonly createdAt: string
}
```

O módulo declara dimensões materiais em schema versionado, como ambiente, ferramenta, versão, executor ou provider. Campo obrigatório ausente produz aplicabilidade `unknown`, nunca compatibilidade presumida. Somente mudança em dimensão declarada material exige revalidação.

## Evidência e critérios

Cada ocorrência canônica gera no máximo uma evidência por critério/revisão. Reentregar, reescrever ou resumir o mesmo resultado não aumenta suporte. Quantidade e diversidade mínimas pertencem ao avaliador; a memória não cria score global de confiança.

```ts
interface LessonEvidenceRecord {
  readonly schemaVersion: 1
  readonly evidenceId: string
  readonly lesson: OperationalLessonKey
  readonly criterionId: string
  readonly canonicalResultRef: string
  readonly sourceRevision: string
  readonly observedOutcome: string
  readonly normalizedSummary: string
  readonly contentSha256: string
  readonly materialDimensions: Readonly<Record<string, string>>
  readonly occurredAt: string
  readonly recordedAt: string
}
```

O original permanece no módulo de origem. A F06 congela referência canônica, revisão/SHA, critério, resultado observado, hash e resumo mínimo. Aceite do PI pode provar que uma revisão foi autorizada, mas não que uma estratégia funcionou empiricamente.

Conclusão causal construída depois de observar um resultado pode criar candidata, mas não usar o mesmo resultado retrospectivamente selecionado para validá-la. A validação exige nova execução/replay com critério vinculado antes do resultado. Critério já existente — como expectativa de execução, SPEC, check obrigatório ou saída esperada — pode avaliar o resultado observado.

## Avaliação e estados derivados

Cada `EvaluationRecord` é imutável e contém resultados por critério. Não há estado público `partially_validated`: suporte parcial permanece como diagnóstico.

| Condição | Estado derivado |
|---|---|
| Falta evidência ou algum critério obrigatório é `insufficient` | `candidate` |
| Todos os critérios obrigatórios são `supported` e aplicáveis | `validated` |
| Contradição relevante, mudança material, prova perdida ou avaliador incompatível | `needs_revalidation` |

Contradição retira imediatamente a condição vigente de validada; não valida automaticamente a afirmação oposta. Reavaliação ocorre de forma assíncrona e não bloqueia desenvolvimento. Histórico e motivo continuam consultáveis.

```ts
interface CriterionResult {
  readonly criterionId: string
  readonly outcome: EvaluationOutcome
  readonly evidenceIds: readonly string[]
  readonly reasonCode: string
  readonly diagnostic: string
}

interface LessonEvaluationRecord {
  readonly evaluationId: string
  readonly lesson: OperationalLessonKey
  readonly evaluatorId: string
  readonly evaluatorVersion: string
  readonly evidenceWatermark: string
  readonly outcome: EvaluationOutcome
  readonly criterionResults: readonly CriterionResult[]
  readonly evaluatedAt: string
}
```

Nova versão do avaliador preserva avaliações antigas. Ela deve declarar compatibilidade comprovada com a versão anterior; aceitar o mesmo schema não basta. Sem declaração, as lições afetadas passam a `needs_revalidation` e recebem nova intenção de avaliação.

## Avaliadores iniciais

### `execution_expected_outcome`

- Consome expectativa vinculada ao `ExecutionRun` antes da conclusão.
- Compara estado final, código de saída e referências de resultado.
- Execução concluída isoladamente não comprova que o resultado esperado ocorreu.
- Nova tentativa é ocorrência distinta; retry/redelivery da mesma tentativa não é nova prova.

### `project_delivery_gate`

- Verifica SPEC e revisão autorizadas, PR e SHA, checks obrigatórios, merge e SHA final.
- Aceite do PI é evidência de decisão sobre a revisão exata.
- CI verde e merge comprovam passagem pelos gates declarados, não impacto, causalidade ou sucesso estratégico do produto.
- Documento/ADR ausente não cria bloqueio adicional além dos gates que o projeto já definiu.

Não há interpretador de expressão ou regra fornecida como texto. Cada avaliador usa contrato fechado, fixtures e versão própria.

## Cobertura explícita

Cada módulo/avaliador publica capacidade versionada:

```ts
type EvaluatorAvailability = 'available' | 'unavailable' | 'unsupported' | 'stale'

interface EvaluatorCapability {
  readonly moduleId: string
  readonly evaluatorId: string
  readonly evaluatorVersion: string
  readonly availability: EvaluatorAvailability
  readonly reasonCode: string
  readonly lastCheckedAt: string
  readonly evidenceWatermark: string | null
}
```

`unsupported` informa que a integração não existe para aquele resultado; `unavailable`, que uma capacidade suportada não está acessível; `stale`, que o watermark não cobre o estado atual. Nenhum deles significa “não existem lições” ou cobertura completa.

## Fila, atomicidade e retomada

A F06 reutiliza o coordenador local aprovado na F02, com filas separadas de ingestão e avaliação compartilhando round-robin, limites, retomada e backoff. Na V1 há no máximo uma operação externa por vez; os avaliadores iniciais são locais e determinísticos.

1. Candidato/evidência e `EvaluationIntent` são persistidos na mesma transação SQLite.
2. Avaliação, resultados por critério, estado derivado e conclusão do job são persistidos juntos.
3. Nenhum I/O do avaliador ocorre dentro da transação.
4. Reinicialização reconcilia intents sem job concluído e jobs interrompidos.
5. A chave idempotente combina candidato/revisão, versão do avaliador e watermark da evidência.

Eventos repetidos são consolidados. O processamento faz tentativa inicial e até quatro retentativas em 5 segundos, 30 segundos, 2 minutos e 10 minutos. Depois, pausa. Reinicialização ou novo evento idêntico não zera tentativas. Erro permanente de schema/critério pausa imediatamente.

Falha técnica é separada de `insufficient` e `contradicted`. Reprocessamento interno exige `lessonId`, revisão, motivo e solicitante, e somente cria novo job por nova evidência, mudança material, nova versão do avaliador ou comando explícito auditável. Não há UI/IPC nesta fatia.

## Limites operacionais

Por passagem de avaliação:

- até 32 critérios obrigatórios;
- até 100 referências de evidência;
- até 64 KiB de entrada normalizada;
- até 16 KiB de diagnóstico/resultado;
- até 50 jobs ou 5 segundos por turno do coordenador.

Excesso é paginado e continua pendente. Truncamento nunca pode ser interpretado como avaliação completa. Texto livre é limitado e sanitizado nos contratos; o avaliador não recebe arquivo, grafo, log ou repositório inteiro por conveniência. Nenhuma chamada de modelo é realizada.

## Recuperação e aplicabilidade

A consulta normal da F03 prioriza somente `validated` no mesmo `projectId`, com avaliador compatível, evidência verificável e dimensões materiais compatíveis. Aplicabilidade `unknown` não entra como compatível.

`candidate` e `needs_revalidation` aparecem apenas em consultas explícitas de hipótese, histórico ou diagnóstico e carregam rótulo/razão. O estado da lição não concede acesso, execução, merge ou qualquer permissão.

Se evidência necessária for removida, expirada no dono ou não puder ser verificada, a lição passa a `needs_revalidation`. Permanecem IDs, hashes, avaliação e motivo conforme a F04; conteúdo excluído não é copiado de volta nem ressuscitado por reconstrução.

## Testes e evidência de entrega

- **Unitário:** identidade/revisão, estados, aplicabilidade, deduplicação, compatibilidade de avaliador, cobertura e limites.
- **Contrato:** fixtures determinísticas dos dois avaliadores, schemas inválidos, critérios ausentes e versões incompatíveis.
- **Integração SQLite:** inbox/outbox, atomicidade, concorrência, crash/replay, paginação, pausa e reprocessamento.
- **Integração F02/F03/F04:** fila compartilhada, consulta filtrada, perda/exclusão de evidência e barreira contra reativação.
- **Regressão:** candidato, desconhecido, stale, falha técnica ou evidência retrospectiva nunca aparecem como validados.
- **Contrafactual:** remover deduplicação, atomicidade, filtro por projeto ou filtro de estado deve reprovar teste direcionado.

Executar lint, typecheck, testes focados, suíte completa e build. Relatório em `docs/test-reports/SPEC-Memoria-06.md` informa revisão, fixtures, contagens, limites exercitados, falhas, contrafactuais e cenários não executados. Não há Playwright, protótipo ou revisão visual porque a F06 não cria interface. Graphify e serviços pagos não participam da prova.

## Critérios de aceite

1. [ ] Identidade combina módulo, chave estável e projeto; mudança material cria revisão e reentrega não duplica.
2. [ ] Somente lição do projeto de origem pode ser `validated` na V1; hipótese entre projetos permanece candidata.
3. [ ] Adapter normaliza resultado e cobertura sem declarar sucesso; módulo é dono dos critérios versionados.
4. [ ] Evidência referencia resultado canônico distinto, critério, revisão/SHA, resumo mínimo e hash verificável.
5. [ ] Repetição, reformulação ou redelivery da mesma ocorrência não aumenta suporte.
6. [ ] Avaliações e resultados por critério são imutáveis; estado atual é uma projeção derivada.
7. [ ] Todos os critérios obrigatórios suportados produzem `validated`; suporte incompleto mantém `candidate`.
8. [ ] Contradição, mudança material, perda de prova ou incompatibilidade produz `needs_revalidation` sem validar a tese oposta.
9. [ ] Não existe estado público `partially_validated`; diagnóstico por critério permanece disponível.
10. [ ] `execution_expected_outcome` só usa expectativa vinculada antes do resultado e distingue tentativa de redelivery.
11. [ ] `project_delivery_gate` prova autorização/checks/merge, sem promover isso a impacto ou causalidade de produto.
12. [ ] Aceite do PI prova decisão para a revisão exata, não sucesso empírico nem aceite duplicado.
13. [ ] Afirmação causal retrospectiva exige nova execução/replay com critério pré-vinculado para ser validada.
14. [ ] Capacidade por módulo/avaliador expõe estado, versão, motivo, verificação e watermark; silêncio não vira ausência de lições.
15. [ ] Persistência transacional não perde intenção nem publica avaliação/estado parcial após crash.
16. [ ] Jobs são idempotentes, limitados, retomáveis e pausam conforme a política; falha técnica não vira resultado semântico.
17. [ ] Reprocessamento é interno e auditável, sem UI, e não reinicia automaticamente falha permanente.
18. [ ] F03 serve normalmente somente lição validada, aplicável e comprovável; demais estados exigem consulta explícita e rótulo.
19. [ ] Exclusão/perda de evidência invalida a condição atual, preserva histórico mínimo e nunca restaura conteúdo excluído.
20. [ ] Testes focados, integrações, contrafactuais, suíte completa, lint, typecheck e build passam com relatório reproduzível.

## Fora de escopo e continuidade

M7-F07 cria Agent Memory/Notebook e os artefatos visuais exigidos. M7-F08 prova resiliência integrada. Novos avaliadores para workflows, automações, releases, impacto de produto ou generalização entre projetos exigem SPEC própria; ausência deles não bloqueia desenvolvimento.

O aceite desta SPEC autoriza mover a #185 de Planejado para Backlog, sem iniciar implementação e sem alterar o `next`. A implementação futura deve conferir o schema/migrations e os contratos concretos existentes no HEAD, sem copiar estrutura hipotética sobre a base.
