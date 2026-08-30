# SPEC-Aprendizado-04 — Experimentos e promoção

- MVP/Fatia: MVP-016 · M16-F04.
- Issue: [#166](https://github.com/RodReis/rrb-jarvisOS/issues/166).
- Status: **aprovada-pi** (2026-08-30); revisão exata do commit `1cefc2c` aprovada, sem alteração dos requisitos.
- GitHub: `proplan:backlog`; implementação depende das dependências e da fila. Esta tarefa permanece em planejamento.
- Depende de: M16-F03 concluída; predecessor [#165](https://github.com/RodReis/rrb-jarvisOS/issues/165).
- Design: `docs/superpowers/specs/2026-08-29-mvp-016-aprendizado-operacional-design.md`.

## Objetivo

Avaliar candidatas por replay, shadow e canário com critérios definidos antes da coleta, produzir decisões determinísticas de promoção e distinguir política ativa de política estabilizada. Economia não compensa regressão de qualidade. Evidência insuficiente, indisponibilidade do aprendizado ou espera por capacidade não impedem o desenvolvimento normal.

## Premissas e fronteiras herdadas

- F01 fornece observações normalizadas e proteção de amostra; F02 fornece falhas/resoluções com prova; F03 é dona do registro, resolução, composição e snapshot persistido com o run.
- MVPs 008/009/012/013 continuam donos de contexto, executor, recuperação, limites, fila, controles e efeitos. F04 conecta contratos; não cria outro executor, scheduler ou caminho de Git/deploy.
- Impacto é técnico e ligado à configuração alterada, não à categoria de negócio do produto. Não introduzir classificação por saúde/finanças, regra jurídica, consentimento ou aceite duplicado.
- São mantidos escopo, precedência de projeto sobre global local e autoridade já aprovados. Alto impacto exige PI; baixo/médio só permitem promoção automática de ajustes autorizados, reversíveis e não semânticos.
- F04 entrega o núcleo real do experimento e suas integrações mínimas, com mecanismos/observações simulados nos testes. Algoritmos opcionais de contexto e sugestões reais de Claude/Codex permanecem na F05; interface na F06.

## Stack e estrutura

- Stack existente no checkout: Node.js `>=22`, TypeScript 5.9, Electron main, `better-sqlite3` e Vitest; sem novo banco, serviço estatístico, provider ou dependência obrigatória.
- `src/shared/domain/learning.ts` e `src/shared/contracts/learning.ts`: contratos versionados de experimento, perfis, alocação, avaliação e estabilização.
- `src/main/learning/policy-experiment-repository.ts`: contrato imutável, coortes, alocações, amostras por referência e diário durável.
- `src/main/learning/policy-experiment-coordinator.ts`: estágios, esperas, exclusividade, prazos e reconciliação.
- `src/main/learning/policy-experiment-assignment.ts`: elegibilidade, distribuição reproduzível e integração com a criação canônica do run/snapshot da F03.
- `src/main/learning/policy-experiment-evaluator.ts`: métricas, completude, guardrails, estabilidade e resultado determinístico.
- `src/main/learning/policy-promotion-service.ts`: produtor real de `PolicyTransitionDecision`, estabilização, reversão e integração com o registro da F03.
- Reutilizar catálogo, compatibilidade, resolver e snapshot da F03, evidências/retenção da F01 e contratos de controles dos donos operacionais.
- `src/main/storage/migrations.ts`: migrations forward-only no SQLite existente. Testes junto aos módulos e integração em SQLite temporário.
- Esses caminhos são destinos planejados, não declaração de código entregue. O plano poderá dividir módulos sem alterar ownership ou contratos.

Exemplo de contrato com configuração tipada, decisão auditável e sem código arbitrário recebido como regra:

```ts
type ExperimentResult = 'improved' | 'regressed' | 'inconclusive'
type ExperimentStage = 'replay' | 'shadow' | 'canary'

interface EvaluationEvidenceRef {
  readonly id: string
  readonly revision: number
  readonly hash: string
}

interface ExperimentEvaluation {
  readonly evaluationId: string
  readonly experimentId: string
  readonly stage: ExperimentStage
  readonly contractHash: string
  readonly candidateRevisionHash: string
  readonly evaluatedBaseHash: string
  readonly sampleManifestHash: string
  readonly rulesVersion: string
  readonly result: ExperimentResult
  readonly reasonCodes: readonly string[]
  readonly evidence: readonly EvaluationEvidenceRef[]
}
```

O contrato completo valida schemas, unidades e limites. Razões e fórmulas vêm de um catálogo versionado; não aceitar scripts, `eval`, expressões executáveis ou opinião de IA como avaliador.

## Dentro

- Contrato imutável por experimento e perfis operacionais versionados.
- Replay sem efeito externo, shadow separado da execução efetiva e canário em runs novos elegíveis.
- Controle contemporâneo, alocação prévia reproduzível, coorte identificável e contabilização sem inflação por retries.
- Avaliador determinístico, integração real com decisões condicionais da F03, estabilização, rollback e kill-switch pelo proprietário.
- Reconciliação após crash, retenção de provas, diagnósticos e testes de falha sem gasto externo obrigatório.

## Fora

- Promover por opinião, contagem de amostra isolada, score composto ou economia obtida removendo testes/escopo.
- Implementar Graphify/Caveman, geração assistida, novo algoritmo de seleção/compressão/cache ou memória/RAG do MVP-007.
- Criar UI, pop-ups ou IPC público do console; esses consumidores entram na F06.
- Aumentar tentativas, capacidade, limite financeiro ou permissões; mudar provider/rota monetária automaticamente.
- Duplicar trabalhos reais para preencher amostra, refazer commit/PR/merge/deploy ou desfazer efeitos externos por rollback de política.
- Copiar prompts, logs, diffs ou repositórios para armazenamento do aprendizado; iniciar código nesta tarefa de especificação.

## 1. Contrato fechado antes da coleta

Cada `PolicyExperiment` referencia um contrato imutável com:

1. Identidade/revisão/hash da candidata, baseline exata, escopo, mecanismos e grupo acoplado; `ApplicabilityKey`, dependências relevantes e autoridade aplicável.
2. Perfil de impacto/revisão, hipótese e uma única métrica principal; métricas auxiliares de qualidade, efetividade, eficiência e estabilidade permanecem separadas.
3. Fórmula registrada, unidade, direção de melhoria, agregação, estratos/pesos, ganho mínimo, limites de regressão e tolerâncias. Estabilidade exige verificações e limites numéricos explícitos, não o texto livre “resultado estável”.
4. Guardrails derivados da SPEC e dos validadores/revisores proprietários; provas exigidas, identificação de falhas preexistentes e regra de atribuição. Não criar gates de produto adicionais.
5. Cobertura de replay/shadow, critérios de entrada/saída por estágio, evidências necessárias e referências aos insumos existentes.
6. Elegibilidade, unidade independente, regra/seed de distribuição, limites de exposição, recrutamento, amostra mínima, tratamento de cancelamentos/esperas/exclusões e fechamento da coorte.
7. Prazo de cada estágio, ponto de avaliação, consumo máximo dentro da parcela já alocada, critérios de parada, estabilização e composição de recuperação verificável.

Nenhuma etapa começa com regra obrigatória ausente, agregação ambígua ou limite superior ao autorizado pelo dono do recurso. Isso deixa o experimento pendente e não bloqueia o run normal. Perfis são reutilizáveis; o contrato resolvido de cada experimento continua exato e autossuficiente.

Mudança de candidata, baseline relevante, elegibilidade, fórmula, perfil, tolerância ou ponto de corte exige nova revisão/novo experimento. Não ajustar critérios depois de observar resultados, transportar provas incompatíveis ou reinterpretar uma avaliação histórica. A IA pode sugerir a próxima hipótese; o núcleo valida o contrato.

## 2. Estágios e força da evidência

| Estágio | O que executa/prova | O que não prova/faz |
|---|---|---|
| Replay | Reaplica decisões de mecanismos sobre insumos históricos disponíveis, íntegros e verificáveis; prova compatibilidade e reprodução dos casos cobertos. | Não reconstrói insumo perdido por adivinhação; não prova qualidade final contrafactual nem repete efeitos externos. |
| Shadow | Calcula a alternativa enquanto a baseline dirige o run real; compara configuração/seleção e consumo medido ou estimado, identificando a origem. | Não aplica a alternativa aos efeitos do run; resultado da baseline não é resultado da candidata. |
| Canário | Aplica a candidata ao grupo designado de novos runs elegíveis, com baseline contemporânea nos controles e snapshots identificados. | Não troca configuração de run já iniciado nem cria execução artificial para completar amostra. |

Reutilizar os contratos dos mecanismos: replay/shadow recebem insumos e devolvem decisões/métricas sem capacidade de escrever Git/GitHub/deploy. Artefatos originais podem ser lidos por referências permitidas e verificação de hash durante a avaliação; o aprendizado não cria cópia bruta permanente. Ausência de insumo suficiente encerra a prova como inconclusiva, sem fingir reprodução.

Replay/shadow só avançam quando cumprem a cobertura e os guardrails próprios do estágio. “Apto ao próximo estágio” não é `improved` da qualidade final. Repetir o mesmo caso não aumenta cobertura independente. Estimativa não é uso medido; misturá-los sem regra explícita invalida a comparação.

Qualquer chamada adicional de executor passa pela rota já autorizada, orçamento/quotas e capacidade existentes, com consumo identificado como experimental. F04 não embute CLI ou chamada direta de provider. A espera é do experimento; a execução normal não depende de concluir o shadow. F05 fornecerá as estratégias/assistência reais que necessitem desses contratos.

## 3. Canário, controle e unidade de amostra

- A unidade independente é a tarefa/run-raiz elegível identificada antes do resultado. Retry, retomada e continuação vinculada compõem a mesma unidade estatística, com consumo acumulado, nunca novas amostras independentes.
- A alocação candidata/controle acontece antes da primeira tentativa e é persistida com a criação canônica do run e seu snapshot, sem segundo registro canônico concorrente. Repetir a criação retorna a mesma alocação/snapshot.
- Usar algoritmo de distribuição aleatória reproduzível com versão/seed persistidas, estratificado pelas condições relevantes definidas no contrato. Registrar ordem de elegibilidade, contadores e exclusões; nem IA nem resultado escolhem o braço.
- O teto de exposição vale sobre as unidades novas admitidas na população elegível do experimento, não sobre todos os projetos. A reserva candidata deve respeitar a razão máxima por contagem confirmada; concorrência e reinício não ultrapassam o teto. Uma simples probabilidade/hash de 25% não garante teto de 25%.
- Recrutamento e ponto de fechamento são definidos por contagem de alocações ou janela, nunca por quantos resultados favoráveis já apareceram. Conservar todos os membros da coorte, inclusive controles além do mínimo; não selecionar retrospectivamente os melhores pares.
- Comparar condições equivalentes de tarefa, tamanho, stack, executor/modelo, ambiente e composição relevante. A quantidade de controles pode superar a de candidatas; não comparar somas brutas de grupos com tamanhos diferentes.
- Falhas, cancelamentos, esperas, timeout e intervenções permanecem no manifesto e nas métricas previstas. Exclusões somente pelas regras anteriores ao resultado, com motivo e contagem visíveis nos dois braços. Problema de infraestrutura não é automaticamente falha da candidata nem autorização para apagar amostra desfavorável.
- Runs pendentes não desaparecem ao encerrar recrutamento. Avaliação final aguarda os desfechos/evidências contratados da coorte fechada dentro do prazo; pendência ou perda que impeça comparação conclusiva leva a `inconclusive`.
- Mesmo run mantém braço e snapshot em retries/reinícios. Uma continuação que o domínio define como novo run recebe snapshot novo da F03 e vínculo ao original; não é realocada como nova amostra. Mudança de política/controle vigente torna a trajetória mista explicitamente identificada, nunca atribuída inteira à candidata ou apagada silenciosamente.
- Histórico auxilia replay e contexto, mas não substitui sozinho o controle contemporâneo da prova real. Baseline histórica não é promovida artificialmente para conduzir controles incompatíveis com o estado atual.

## 4. Perfis iniciais aprovados

Valores de canário, mínimos operacionais sem promessa de significância estatística:

| Perfil técnico | Mínimo candidata / controle | Exposição máxima candidata | Prazo máximo do canário | Ganho mínimo principal |
|---|---:|---:|---:|---:|
| Baixo impacto | 10 / 10 | 50% | 14 dias | 5% |
| Médio impacto | 20 / 20 | 25% | 30 dias | 10% |

- Contagem é de unidades independentes avaliáveis segundo o contrato, sem contabilizar só sucessos. A população alocada inteira permanece no relatório.
- Exposição máxima não é meta de ocupação. No perfil médio, obter 20 candidatas a 25% exige pelo menos 80 alocações elegíveis, não apenas 40. Não gerar trabalho para atingir esse volume; prazo sem prova suficiente é inconclusivo.
- Replay/shadow exigem cobertura dos cenários do contrato, não uma contagem genérica que possa ser preenchida repetindo casos. Seus prazos e consumo também precisam estar fechados antes da execução.
- Alto impacto não herda promoção automática nem números presumidos de baixo/médio; usa contrato explícito e decisão do PI conforme a autoridade já existente. Mudança material continua exigindo PI mesmo que seja rotulada como baixo impacto.
- Modificar um perfil cria versão para experimentos futuros. Redução de amostra, extensão de prazo, troca de métrica ou de tolerância no meio do experimento não é “ajuste operacional”.
- Limites de uso/consumo continuam sendo os do proprietário. Rotas de assinatura registram tokens/chamadas/tempo sem inventar custo monetário; rota paga somente se já habilitada.

## 5. Avaliação determinística

Ordem: verificar integridade/aplicabilidade e cobertura das provas; aplicar guardrails de qualidade; verificar completude/comparabilidade, efetividade e estabilidade; só então avaliar ganho de eficiência. Uma regressão conclusiva documentada pode interromper exposição antes da amostra mínima; falta de outras provas não apaga esse achado.

| Resultado | Condição |
|---|---|
| `improved` | Evidência suficiente/comparável, qualidade preservada, critérios de estabilidade atendidos e ganho principal no mínimo do perfil. |
| `regressed` | Regressão demonstrada pelas regras contratadas, inclusive violação comprovada de guardrail, ainda que haja economia. |
| `inconclusive` | Sem regressão conclusiva, mas amostra/prova insuficiente, incompatibilidade de comparação, instabilidade ou ganho sem magnitude suficiente. |

Regras obrigatórias:

1. Agregadores e comparadores são implementações nomeadas/versionadas e testadas. Configuração define unidades, direção, tolerâncias, estratos/pesos e valores finitos válidos; não é código executável enviado ao kernel.
2. Para uma métrica não negativa em que menos é melhor, ganho relativo é `100 * (baseline - candidata) / baseline`; em que mais é melhor, `100 * (candidata - baseline) / baseline`. Aplicar às agregações comparáveis previstas, sem arredondar a apresentação para decidir o limiar.
3. Baseline zero exige regra absoluta previamente declarada com unidade/limiar; sem ela, inconclusivo. Ausência de dado não vale zero; consumo conhecido como zero precisa de origem verificável.
4. Exemplo suportado para tokens: custo por tarefa concluída com sucesso soma o consumo conhecido de **todas** as unidades alocadas, inclusive falhas/cancelamentos e suas tentativas/continuações, e divide pelos sucessos comprovados. Sem sucesso ou consumo necessário desconhecido, não há ganho demonstrado. Taxa de sucesso e demais guardrails são avaliados separadamente; o exemplo não força todo experimento a escolher tokens como principal.
5. Estratos e pesos são fixados previamente, com cobertura mínima declarada. Não recompor pesos depois dos resultados para ocultar subgrupo regressivo ou vantagem causada por tarefas mais fáceis. Guardrails continuam verificáveis por condição relevante.
6. Métricas estimadas e medidas, custo monetário e uso de assinatura, overhead experimental e consumo da execução efetiva são discriminados. Chamada extra não desaparece da contabilização para apresentar “economia líquida”; a fórmula declara que componentes compara.
7. Falha preexistente, incidente comum ou mera correlação não prova causalidade. Validadores e referências sustentam a atribuição; incerteza relevante impede promoção, não cria conclusão inventada nem regra de produto.
8. O ponto de avaliação de promoção é único e previamente definido para a coorte fechada. Não consultar vários cortes e escolher o melhor. Monitoramento antecipado só interrompe por regressão comprovada, limites ou controles operacionais.
9. Mesmos dados normalizados, contrato e versão de regra produzem mesmo resultado/razões. Registrar manifesto, inclusões/exclusões, contagens, métricas, qualidade de origem, revisões/hashes e data de corte. IA explica o resultado, não o substitui.
10. `improved` dá elegibilidade à promoção, não publicação direta. Cobertura operacional mínima não é garantia estatística; relatório não anuncia confiança ou significância que o método não calculou.

## 6. Promoção e estabilização

F04 produz `PolicyTransitionDecision` com identidade idempotente, versão/revisão/hash exatos, base/composição relevante, avaliação e provas, versão das regras, autoridade e revisão ativa esperada. F03 verifica e confirma atomicamente diário e ponteiro ativo. Mudança concorrente da base relevante exige reavaliação, não sobrescrita; mudança comprovadamente independente não invalida só por alterar o hash completo.

Uma candidata percorre `draft → replay → shadow → canary → active`. Resultado, motivo de encerramento e marca de estabilidade são atributos distintos: expiração/inconclusão não equivalem a regressão; `active` não equivale a `stable`. Estágio aprovado para avançar não permite pular canário ou dispensar a autoridade aplicável.

Após promoção, o resolver normal pode aplicar a política a todos os novos runs elegíveis do escopo avaliado, respeitando precedência de projeto e compatibilidade. A divisão experimental candidata/controle termina; o alcance não passa a novos contextos não avaliados. A versão/composição estável anterior continua registrada como recuperação.

| Perfil | Tempo mínimo após promoção | Novas unidades independentes avaliáveis | Prazo máximo de estabilização |
|---|---:|---:|---:|
| Baixo impacto | 24 horas | 10 | 14 dias |
| Médio impacto | 72 horas | 20 | 30 dias |

- Exigir tempo **e** amostra, com critérios operacionais contratados preservados. Contar somente unidades admitidas após a promoção; retries, continuações e a amostra do canário não viram novas unidades.
- Essa fase verifica estabilidade operacional; a comparação contemporânea de ganho continua sendo a prova do canário. Não anunciar nova melhoria causal por comparar a fase ativa sem controle com um histórico conveniente.
- O ponto de fechamento e as regras sobre pendências são predefinidos, como no canário. Sem guardrails necessários verificáveis, não marcar estável por mero decurso de tempo.
- Cumpridas as condições, emitir decisão idempotente de estabilização e marcar a versão `stable`. Ser a mais recente não basta.
- Prazo máximo sem prova suficiente: registrar estabilização inconclusiva e devolver novos runs à composição estável ainda compatível ou à base. Preservar a prova original do canário, sem reinterpretá-la como regressão.
- Uma promoção em estabilização por escopo/grupo acoplado. Outra candidata que altere esse grupo aguarda; mecanismos comprovadamente independentes podem avançar sem disputar os mesmos contratos. Runs normais não aguardam o experimento.
- Alto impacto usa estabilização explicitada no contrato aprovado pelo PI, sem inventar perfil numérico ou aprovação repetida. A autorização original é referenciada na transição.

## 7. Rollback, kill-switch e efeitos em andamento

1. Regressão comprovada no canário encerra novas alocações candidatas e mantém baseline/estável compatível. Após promoção, regressão comprovada emite reversão para novos runs. Não esperar o fim da janela para retirar exposição regressiva.
2. Reverter o grupo interdependente atingido, preservando mecanismos independentes quando a compatibilidade de fronteira permitir, conforme F03. Nunca montar combinação inédita apenas escolhendo “a versão anterior” de cada mecanismo.
3. Alvo de recuperação é a última composição estável ainda elegível; sem ela, usar a base. Uma versão revertida, aposentada, `stale` ou desconhecida não é recuperação válida.
4. Registrar motivo, revisão esperada, composição alvo, prova e transição nova. Repetição retorna a decisão original; não reativa a candidata nem retrocede uma versão mais nova publicada legitimamente. Conflito de revisão reconcilia o estado atual.
5. Snapshot histórico permanece imutável. Um run já iniciado não troca silenciosamente de política porque houve promoção/reversão. Kill-switch é controle vivo do proprietário: impede novas aplicações em pontos seguros e permite o fallback operacional já previsto, registrando a configuração efetivamente usada sem apagar a planejada.
6. Efeito externo em andamento não é desfeito por aprendizado: sem apagar branch, refazer PR, repetir merge, restaurar banco ou cancelar deploy. A operação segue seus controles/reconciliação existentes.
7. Falha técnica de rollback gera ocorrência crítica e degrada resolução para a base pelo caminho proprietário. Não declarar reversão persistida quando a confirmação falhou; manter diagnóstico e reconciliar. Falha do armazenamento canônico segue a recuperação do núcleo, não é mascarada como disponibilidade normal.
8. Expiração, cancelamento ou inconclusão não causam reativação automática pela chegada tardia de dados. Nova tentativa exige nova avaliação/experimento compatível e a autoridade já aplicável; não reutiliza a decisão terminal como novo comando.

## 8. Persistência, concorrência e recuperação

- Contrato, seed, alocação, snapshot referenciado, avaliações, decisões, transições e marcas de estabilidade são duráveis; índices e agregados derivados são reconstruíveis. Não criar fonte paralela de verdade para o run.
- Reservar alocação/cota experimental e associar snapshot de forma atômica com a criação canônica do run. Crash antes da confirmação não deixa reserva órfã consumindo exposição; crash depois retorna a alocação existente, sem duplicar unidade/efeito.
- Coordenador usa revisão esperada, exclusividade durável e reconciliação por identidade. Reiniciar não repete experimento, não inicia segundo canário para o grupo ocupado, não reseta limites e não depende de timer apenas em memória.
- Prazos começam no início persistido do estágio, não no cadastro da hipótese. Espera por quota/indisponibilidade após esse início consome a janela; reinício não zera o relógio. Usar instantes persistidos e relógio injetável; salto/retrocesso detectado torna a conclusão temporal pendente de reconciliação, nunca acelera `stable` por adivinhação.
- Antes de promover, confirmar que evidências, autoridade, base e aplicação continuam válidas. Cancelamento/kill-switch concorrente não pode perder para uma decisão calculada anteriormente: revalidar o controle vigente no ponto de confirmação.
- Observações atrasadas/corrigidas geram avaliação nova e vínculo à anterior, sem reescrever a prova que sustentou decisão histórica. Evidência que invalide promoção ativa aciona reavaliação/reversão pelas regras; não ignorá-la porque a decisão já foi emitida.
- F01 protege amostra referenciada enquanto experimento/estabilização estiver ativo; liberação é reconciliável e não remove versões, decisões ou snapshots. Preservar manifesto, métricas/proveniência normalizadas e hashes necessários à auditoria. Não prometer replay de artefato bruto expirado em seu proprietário.
- Catálogo/avaliador indisponível: suspender somente novas aplicações experimentais/promoções sem prova; novos runs usam estável verificável/base e runs existentes mantêm o snapshot e controles vigentes. Fonte ausente/hash divergente nunca vira sucesso.

## Comandos de verificação da implementação

```text
npm run typecheck
npm run lint
npm test
npm run build
```

São comandos do projeto para a implementação futura, não resultados de teste desta redação documental. Não exigir CLI autenticada, serviço pago ou E2E visual na suíte comum da F04.

## Estratégia de testes

- Vitest com relógio e seed fixos: schema, perfis, fórmulas, agregação, cobertura, elegibilidade, cutoff e resultados nas fronteiras exatas de ganho/tempo/amostra.
- Fixtures com tarefas desbalanceadas, baseline zero, desconhecido versus zero medido, falhas mais baratas, cancelamentos, continuações, pendências e custos de chamadas extras.
- Testar alteração dos estratos/pesos, exclusão pós-resultado e escolha retrospectiva de melhor corte como entradas rejeitadas; baseline histórica sozinha não aprova canário.
- Integração SQLite: criação run/alocação/snapshot atômica, teto de exposição sob concorrência, journal idempotente, promoção com revisão esperada, estabilização e rollback do grupo acoplado.
- Crash antes/depois de cada confirmação, duplicação/atraso/correção de evento, quota, kill-switch, relógio alterado, perda de evidência, rebuild e falha do registro.
- Replay/shadow com mecanismos simulados e sentinelas de efeitos: qualquer tentativa de commit/PR/merge/deploy falha o teste; executor fake contabiliza chamadas e limites.
- Integração com os contratos reais de F01/F03 e donos de run/controles; não substituir a implementação de promoção da F04 por um produtor fake. São simulados apenas os mecanismos externos/insumos da prova.
- Contrafactuais: promover por amostra isolada, economizar omitindo falhas, contar retry como amostra, estabilizar só por tempo, sobrescrever snapshot ou reativar por replay da decisão precisam quebrar teste.
- Relatório por SPEC/issue conforme `docs/TESTING.md`, com versão das regras, seed, contratos, contagens e hashes. Prova integrada visual permanece F06.

## Critérios de aceite

1. Contrato completo é congelado antes da coleta; alteração de perfil/candidata/base/regra/coorte cria revisão nova, sem reinterpretar prova anterior.
2. Replay só utiliza insumos íntegros disponíveis; perda de artefato é inconclusiva e replay/shadow não repetem efeitos Git/deploy nem atribuem resultado da baseline à candidata.
3. Shadow separa medido de estimado e usa apenas capacidade/rota/consumo autorizados; sua espera/falha não bloqueia execução normal.
4. Alocação prévia reproduzível é persistida com run/snapshot; cem repetições da criação e reinício não mudam braço nem duplicam amostra/reserva.
5. Teto de 50%/25% é respeitado por contagem confirmada sob concorrência; não é apenas probabilidade nominal. Retries/continuações não ampliam a população independente.
6. Canário exige controle contemporâneo comparável e conserva a coorte completa; falhas, cancelamentos, pendências e exclusões têm tratamento predefinido e auditável.
7. Perfis baixo/médio aplicam 10/10 e 20/20, 14/30 dias e ganho mínimo 5%/10%; limiar isolado não garante melhoria, e falta de volume não cria jobs artificiais.
8. Mesmos dados/contrato/regras geram o mesmo resultado; guardrail violado não é compensado por tokens, score ou explicação de IA.
9. Baseline zero sem comparação absoluta declarada, consumo necessário desconhecido ou instabilidade sem prova de regressão resultam inconclusivos; zero medido permanece distinguível.
10. Consumo inclui tentativas e desfechos falhos; comparação normaliza grupos/estratos como contratado e não seleciona sucessos, pesos ou cortes favoráveis depois dos resultados.
11. `improved` só produz promoção com provas e autoridade válidas pela F03; base obsoleta, controle revogado ou decisão concorrente não sobrescrevem estado atual.
12. Promoção aplica apenas a novos runs elegíveis, preserva precedência/escopo e mantém ativa diferente de estável; snapshots antigos permanecem iguais.
13. Estabilização exige simultaneamente 24h+10 novas unidades no baixo ou 72h+20 no médio; prazo máximo de 14/30 dias sem prova retira a política para novos runs como inconclusiva, sem classificá-la falsamente como regressiva.
14. Enquanto houver estabilização, candidata do mesmo escopo/grupo aguarda sem bloquear runs; grupo comprovadamente independente continua elegível.
15. Regressão comprovada interrompe exposição/aciona rollback do grupo afetado, usando estável elegível/base e preservando independentes; decisão repetida não reativa versão nem desfaz Git/deploy.
16. Kill-switch/pausa/quota continuam vigentes, inclusive em snapshot antigo; fallback efetivo é registrado sem reescrever o histórico ou reiniciar tentativas.
17. Crash, falha de rollback, clock skew e perda de evidência são reconciliados sem falso sucesso, reset de janela ou duplicação; catálogo indisponível mantém fallback não bloqueante.
18. Retenção/rebuild preservam provas canônicas, avaliações e snapshots; correção tardia registra nova avaliação sem apagar a decisão anterior nem reativar automaticamente experimento encerrado.
19. Alto impacto e alterações materiais respeitam a autoridade do PI já prevista; não existe regra de domínio/jurídica nova, aceite duplicado ou ampliação silenciosa de gasto/escopo.
20. Testes provam núcleo e integração F04/F03 reais usando insumos/mecanismos simulados, sem antecipar estratégias/assistência F05, UI F06 ou executar efeitos externos reais na suíte comum.

## Limites

- **Sempre:** critérios prévios, evidência proporcional ao estágio, qualidade antes de eficiência, estado durável e transições condicionais/auditáveis.
- **Consultar a SPEC:** mudanças de unidade de amostra, exposição, perfis, autoridade, composição ou semântica de promoção/rollback; ajuste técnico compatível segue o plano sem aceite duplicado.
- **Nunca:** inventar prova, ocultar consumo/falha, trocar grupo após resultado, fazer aprendizado bloquear código ou permitir que um experimento altere regras dos donos operacionais.

## Decisões confirmadas pelo PI

Detalhamento confirmado em 2026-08-29–2026-08-30:

1. Contrato imutável por experimento antes da medição, com candidata/base, métrica principal, guardrails, amostra, janela e limites.
2. Replay prova reprodução disponível; shadow calcula alternativa sem conduzir efeitos; canário fornece prova real, sem duplicar Git/deploy ou ampliar orçamento.
3. Controle contemporâneo e distribuição prévia reproduzível; preservar falhas/pendências e não inflar amostra com retries/continuações.
4. Perfis iniciais baixo/médio com amostras, exposição, prazos e ganho mínimo versionados; mínimos operacionais sem garantia estatística.
5. Avaliador determinístico de qualidade antes de eficiência, com resultado auditável e elegibilidade distinta de publicação.
6. Ativa distinta de estável; tempo e nova amostra na estabilização, retirada por inconclusão, rollback do grupo afetado e snapshots preservados; sem empilhar candidatas acopladas.

## Revisão pelo PI

Revisão exata do commit `1cefc2c` aprovada pelo PI em 2026-08-30, sem alteração dos requisitos ou dos vinte critérios de aceite. A issue #166 passa a `proplan:backlog`, com parent #162 e predecessor #165 preservados. O aceite não inicia implementação nesta tarefa, não altera a fila corrente nem adiciona segundo aceite de execução. A tarefa segue no planejamento da M16-F05 (#167).
