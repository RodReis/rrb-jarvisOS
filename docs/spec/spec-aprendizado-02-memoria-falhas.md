# SPEC-Aprendizado-02 — Memória de falhas

- MVP/Fatia: MVP-016 · M16-F02.
- Issue: [#164](https://github.com/RodReis/rrb-jarvisOS/issues/164).
- Status: **revisão-pi** (2026-08-29); issue permanece `proplan:planejado`; implementação não autorizada.
- Depende de: M16-F01 concluída, após MVP-015; predecessor [#163](https://github.com/RodReis/rrb-jarvisOS/issues/163).
- Design: `docs/superpowers/specs/2026-08-29-mvp-016-aprendizado-operacional-design.md`.

## Objetivo

Relacionar padrões de falha, ocorrências, ações tentadas, provas de resolução e recorrências do mesmo projeto. Fornecer contexto mínimo e rastreável à recuperação existente, sem confundir mensagem semelhante com causa raiz, ocultar falha nova ou transformar memória em gate.

## Stack e estrutura

- Node.js `>=22`, TypeScript 5.9, Electron main, `better-sqlite3` e Vitest, sem nova dependência obrigatória.
- `src/shared/domain/learning.ts`: ampliar os tipos da F01 com identidade, ocorrência, resolução, aplicabilidade e recall.
- `src/shared/contracts/learning.ts`: schemas versionados de entrada, sugestão e consulta.
- `src/main/learning/failure-classifier.ts`: mapeamento versionado de etapa e natureza.
- `src/main/learning/failure-fingerprint.ts`: normalização conservadora e identidade determinística.
- `src/main/learning/failure-memory.ts`: aplicação das observações, correlações e recorrência.
- `src/main/learning/failure-memory-repository.ts`: persistência e reconstrução dos índices derivados.
- `src/main/learning/failure-recall-service.ts`: consulta seletiva, compatibilidade e manifesto de seleção.
- `src/main/storage/migrations.ts`: migrations forward-only no SQLite existente.
- Testes `*.test.ts` junto aos módulos, com fixtures sanitizadas e integração SQLite temporária.

Exemplo do contrato de retorno, seguindo tipos explícitos, propriedades imutáveis e ausência de efeitos nos classificadores:

```ts
type RecallCompatibility = 'compatible' | 'stale' | 'unknown'

interface FailureRecallItem {
  readonly occurrenceId: string
  readonly signatureId: string | null
  readonly compatibility: RecallCompatibility
  readonly applicability: readonly {
    readonly dimension: string
    readonly value: string | null
  }[]
  readonly summary: string
  readonly attemptedActions: readonly {
    readonly actionRef: string
    readonly outcome: 'verified_success' | 'failed' | 'inconclusive'
  }[]
  readonly evidenceRefs: readonly {
    readonly id: string
    readonly hash: string
  }[]
}
```

## Dentro

- Classificação em dois eixos, fingerprint versionado, ocorrências e identidade conservadora.
- Correlação de ações e validações posteriores, com prova por ocorrência/contexto.
- Recorrência, separação fundamentada de causas e histórico preservado.
- `FailureAssociationCandidate` como contrato de sugestão, testado com produtor simulado.
- `FailureRecall` determinístico por projeto, dentro da parcela de contexto recebida do consumidor.
- Consumo idempotente das observações da F01, cobertura e referências verificáveis.

## Fora

- Executar Claude/Codex, embeddings, banco vetorial ou análise semântica real: integração assistida pertence à F05.
- Depender da memória/RAG do MVP-007 ou ler logs, prompts, diffs e repositório integral.
- Gerar correção, executar ação/teste, montar prompt ou controlar retries do MVP-009.
- Promover política, compartilhar padrão global local ou alterar `PolicySnapshot`: F03/F04 e seus contratos.
- Criar budget paralelo, aumentar a parcela recebida do `ContextPack` ou relaxar teste/review/gate.
- UI/IPC público, pop-up, decisão nova de produto ou mudança de fila.

## Contratos de domínio

### Classificação

Etapa e natureza são eixos independentes. Etapa reconhece `planning`, `preflight`, `construction`, `review`, `ci`, `merge`, `preview`, `release`, `observability` e `unknown`. Natureza reconhece `code`, `configuration`, `environment`, `authentication`, `quota`, `scope`, `policy`, `external` e `unknown`.

O mapeamento preserva o código original do domínio e sua origem. Severidade e transitoriedade são atributos separados, herdados de evidência normalizada; ausência permanece desconhecida. A versão do classificador acompanha o resultado. Classificação não cria prioridade, gate, bloqueio ou política de acesso.

### Identidade e ocorrência

- `FailureSignature`: padrão observado, versão de normalização, fingerprint e atributos discriminantes; **não é prova de causa raiz comum**.
- `FailureOccurrence`: identidade derivada da observação de falha, projeto, assinatura quando disponível, run/tentativa/operação, revisão, ambiente, tempos e referências da F01.
- Entradas do fingerprint: etapa, natureza, identidade do check/comando, código semântico, teste/regra, arquivo relativo ou símbolo afetado, mensagem normalizada e valores esperados/obtidos quando fornecidos pela origem. Provider entra quando discriminante para a falha; sua ausência não é inventada.
- Normalizar somente elementos identificados como voláteis: timestamp, ID de run, raiz de diretório temporário e deslocamento de linha. Não remover números arbitrários, símbolo, teste, regra, código de erro ou valores esperados/obtidos por expressão genérica.
- SHA e ambiente pertencem à ocorrência/aplicabilidade, não fragmentam a assinatura só porque houve commit. Mudança de condição relevante pode tornar a solução histórica incompatível mesmo com assinatura igual.
- Serialização canônica e hash incluem versão e presença/ausência dos campos. Comparam-se também os atributos normalizados: hash igual com atributos distintos é conflito, não equivalência.
- Sem identidade suficiente além de mensagem genérica, registrar ocorrência sem assinatura conclusiva; desconhecido nunca atua como curinga para agrupar.
- Os valores vêm exclusivamente dos campos permitidos/sanitizados pela F01. Não buscar conteúdo bruto para completar ou calcular fingerprint; truncamento que elimina discriminante produz identidade inconclusiva.
- Evidência estruturada de causas distintas separa os grupos de ocorrências sob assinaturas derivadas, preservando assinatura original, vínculo e motivo. Sugestão semântica isolada não executa essa separação nem une grupos. Reclassificação gera nova versão, sem reescrever prova histórica. Ocorrência futura sem discriminante da causa não é atribuída arbitrariamente a um dos grupos; permanece com relação inconclusiva ao padrão original.

### Ação, resolução e recorrência

`ResolutionEvidence` liga ocorrência-alvo, ação tentada, condição/revisão de aplicação e validação posterior, com referências e hashes de origem. O resultado da ação é `verified_success`, `failed` ou `inconclusive`.

1. `resolution_applied` registra uma tentativa de resolver, não sucesso automático.
2. Resolução comprovada exige resultado conclusivo da validação que falhou ou da operação afetada, associado à ocorrência e às condições após a ação. A revisão da validação corresponde à revisão avaliada depois da ação; não precisa repetir o SHA da falha anterior.
3. Commit, merge, texto da IA, ausência de novas ocorrências, validação removida, `skipped` e `not_run` não comprovam sucesso.
4. Resultado de outro check, revisão anterior à ação ou ambiente não correspondente não fecha a ocorrência. Ordem de chegada e timestamp isolado não provam causalidade; usar correlação/revisão da fonte. Ambiguidade permanece inconclusiva.
5. Resultado negativo explicitamente vinculado registra ação malsucedida. Provas conflitantes sem ordenação causal suficiente ficam inconclusivas e preservam ambos os lados.
6. Resolução pertence à ocorrência/contexto. Assinatura não recebe um estado global que suprime ocorrências novas.
7. Nova ocorrência compatível depois de resolução comprovada registra recorrência, sem apagar a resolução anterior. Duplicata da mesma observação não conta como recorrência. Falha sem resolução prévia é repetição, não reincidência após sucesso.
8. Se faltar prova causal para ordenar falha e resolução, mostrar repetição com relação temporal desconhecida, sem inventar recorrência.
9. F02 consome evidências dos donos das operações; não dispara revalidação nem altera seus resultados.

### Sugestão assistida, somente contrato nesta fatia

`FailureAssociationCandidate` contém identidade, projeto, ocorrências/assinaturas referenciadas, relação proposta, justificativa limitada, origem/produtor/versão, evidências por ID/hash e incerteza declarada. Origem assistida também identifica executor/modelo; F02 não os invoca.

Validar schema, projeto e referências antes de aceitar a candidata. Sugestão é associação consultiva separada do matching determinístico, nunca prova de igualdade, resolução ou autorização para omitir falha. F05 conectará geração real pelos executores existentes; testes da F02 usam produtor simulado. Ausência de sugestão mantém todas as funções determinísticas operacionais.

### Aplicabilidade e FailureRecall

Consulta recebe projeto, ocorrências atuais, condições da tarefa e parcela já alocada pelo consumidor (`maxItems`, `maxTokens` e contador/estimador de tokens usado pelo `ContextPack`). Não decide budget, executor ou limites de tentativa.

`ApplicabilityKey` registra dimensões relevantes e seus valores: tarefa/mecanismo, stack/versões, executor/modelo/provider quando influentes, ambiente e política-base. Dimensão relevante incompatível resulta em `stale`; ausente ou não verificável resulta em `unknown`. Campo irrelevante explicitamente marcado não invalida compatibilidade. Não tratar desconhecido como compatível.

Ordem determinística:

1. ocorrências atuais, inclusive sem assinatura conclusiva, para não mascarar falha presente;
2. resoluções comprovadas de assinaturas compatíveis do mesmo projeto;
3. histórico pertinente de ações malsucedidas/inconclusivas do mesmo padrão compatível.

Dentro de cada grupo, ordenar por tempo do fato mais recente e desempatar por identidade estável. Deduplicar pela ocorrência/ação, não somente pela assinatura. Associações incertas e lições incompatíveis aparecem no diagnóstico de exclusões, não como solução automaticamente aplicável.

Essas exclusões de aplicabilidade afetam lições/soluções históricas, não apagam a ocorrência atual: ela pode entrar como fato conhecido com identidade/cobertura desconhecida, sem alegar solução verificada. A parcela recebida continua limitando sua inclusão; eventual exclusão por capacidade precisa ser diagnosticável.

Cada item inclui resumo mínimo, ações tentadas, resultado, condições de aplicabilidade e provas por referência. Resumo determinístico usa somente campos permitidos. Uma ação antes malsucedida pode ser tentada novamente sob condições diferentes; o histórico não cria proibição permanente.

Contabilizar a representação completa destinada ao contexto, inclusive estrutura e referências. Selecionar apenas itens íntegros que cabem nos dois limites; não cortar a condição de aplicabilidade nem a prova para encaixar. Registrar exclusões com ID e motivo (`item_limit`, `token_limit`, `stale`, `unknown`, `uncertain_association` ou `evidence_unavailable`) em manifesto diagnóstico paginado, fora do payload do prompt. Se o consumidor enviar parte do manifesto ao modelo, ela consome a mesma parcela alocada. Zero de capacidade retorna payload vazio e motivo, sem esconder o diagnóstico fora do prompt.

O serviço fornece contexto consultivo; o `RecoveryController` continua dono do delta, do prompt e das tentativas. Recall vazio/degradado não impede recuperação pela lógica-base e não autoriza pular teste, revisão ou gate.

## Persistência, replay e falhas

- Consumo assíncrono sobre `LearningObservation` da F01; sem acesso às tabelas internas de outros MVPs.
- Observações/evidências duráveis da F01 continuam fonte. Índices, classificações e relações calculadas da F02 são derivados e reconstruíveis; registros de candidatas recebidas e de separação fundamentada preservam proveniência para replay.
- Confirmar aplicação e checkpoint da projeção atomicamente. Mesma observação reaplicada não duplica assinatura, ocorrência, ação, resolução ou contagem.
- Evidência que chega antes da falha fica pendente de vínculo e é reconciliada quando a origem chega. Crash e permutações convergem para o mesmo estado lógico e histórico causal, sem depender da ordem de entrega.
- Rebuild preserva fatos/candidatas recebidas, versões e referências; recalcula somente derivados. Atualização do normalizador usa versão explícita e vínculo entre índices, não reinterpreta silenciosamente fingerprint antigo.
- Evidência removida/hash divergente mantém registro histórico, reduz cobertura e impede usá-la como prova verificada no recall enquanto insuficiente; não transforma sucesso histórico em nova falha.
- Retenção segue F01: falhas e resoluções duráveis, sem duplicar artefatos extensos ou criar nova janela nesta fatia.
- Serviço indisponível retorna recall vazio/degradado; não escreve em estados de run, tentativa, PR ou release e não bloqueia o fluxo-base.

## Comandos de verificação da implementação

```text
npm run typecheck
npm run lint
npm test
npm run build
```

## Estratégia de testes

- Unitários em Vitest para classificação, normalização, identidade, prova de resolução, compatibilidade e seleção.
- Fixtures de mensagens semelhantes com valores/símbolos distintos e de mudança apenas volátil; cobertura de cada discriminante e cada exclusão.
- Integração SQLite para migrations, unicidade, checkpoint, vínculo tardio, crash e rebuild.
- Testes de propriedades por permutações/duplicatas das mesmas observações; relógio e contador de tokens controlados.
- Contratos com produtor semântico simulado e consumidor de recall, sem CLI autenticada, serviço pago ou banco vetorial.
- Contrafactuais: remover checagem de causalidade, separar prova da condição, normalizar valor semântico ou tornar ausência compatível precisa quebrar teste.
- Evidência por critério na issue/PR; não exigir E2E visual nesta fatia sem UI.

## Critérios de aceite

1. Etapa e natureza são independentes; código original, versão do mapeamento, severidade e transitoriedade preservam origem/desconhecido sem criar gate.
2. Mudar timestamp, run, raiz temporária ou linha mantém fingerprint; mudar teste/regra/símbolo/código ou valor semântico discriminante diferencia o padrão.
3. Mudança isolada de SHA não cria assinatura; mudança de ambiente relevante pode invalidar recall de solução mesmo com a mesma assinatura.
4. Mensagem genérica sem discriminante produz ocorrência inconclusiva, nunca fusão automática; conflito entre hash e atributos é diagnosticado.
5. Causas distintas comprovadas permitem separar ocorrências com vínculo histórico; sugestão assistida sozinha não muda agrupamento, resolução ou visibilidade da falha.
6. Ação só fica `verified_success` com prova conclusiva da validação/operação correspondente após a ação, na revisão/ambiente correlacionados.
7. Commit, merge, IA, silêncio, check removido/pulado ou resultado de outro contexto não resolvem ocorrência.
8. Resolução de uma ocorrência não fecha as demais; reaparência compatível posterior registra recorrência e preserva prova anterior; ordem causal desconhecida não é inventada.
9. A mesma observação reaplicada cem vezes mantém uma ocorrência lógica; entrega permutada com vínculo tardio e crash gera o mesmo resultado lógico após replay.
10. Recall consulta somente o projeto solicitado, prioriza falha atual e solução comprovada compatível, retornando ação, resultado, condições e provas.
11. Dados incompatíveis, incertos ou sem prova suficiente não viram solução aplicável e possuem motivo rastreável; ação antes falha não vira veto permanente.
12. Payload completo nunca ultrapassa `maxItems`/`maxTokens` recebidos, inclusive no limite zero; exclusões são diagnosticáveis sem segunda alocação de tokens ou perda silenciosa de condição/prova.
13. Rebuild preserva fatos e versões; prova perdida reduz cobertura/uso atual sem apagar histórico nem fabricar falha nova.
14. Com produtor semântico ausente, memória e recall determinísticos continuam funcionais; com memória indisponível, recuperação-base continua sem alterar gates ou estado proprietário.
15. Nenhuma chamada de executor, leitura de log/diff/repositório integral, publicação global, execução de teste ou alteração de budget ocorre pela F02.

## Limites

- **Sempre:** consumir fatos permitidos da F01, preservar desconhecido e proveniência, tornar matching/seleção determinísticos e manter evidência por ocorrência.
- **Consultar a SPEC:** mudança semântica de identidade, prova, aplicabilidade, contratos ou limite de responsabilidade; ajustes técnicos compatíveis seguem o plano, sem aceite duplicado.
- **Nunca:** usar IA/commit como prova, esconder ocorrência por histórico, aumentar budget, proibir retry para sempre, mudar gate ou bloquear pipeline pelo aprendizado.

## Decisões confirmadas pelo PI (2026-08-29)

1. Classificação por etapa e natureza, com severidade e transitoriedade separadas.
2. Resolução provada pela validação/operação afetada e limitada à ocorrência/contexto.
3. Normalização conservadora: padrão observado não prova causa raiz.
4. Recall consultivo e seletivo, usando parcela do `ContextPack`, sem orçamento paralelo nem veto permanente de ação.
5. F02 entrega núcleo determinístico e contrato de candidata; F05 integra sugestão semântica real, sem dependência de MVP-007.

## Revisão pelo PI

As decisões acima estão confirmadas. Esta revisão escrita aguarda aceite exato; a issue #164 continua Planejada e nenhum código está autorizado por este documento.
