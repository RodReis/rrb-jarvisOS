# SPEC-Aprendizado-03 — Registro e resolução de políticas

- MVP/Fatia: MVP-016 · M16-F03.
- Issue: [#165](https://github.com/RodReis/rrb-jarvisOS/issues/165).
- Status: **aprovada-pi** (2026-08-29); issue em `proplan:backlog`; implementação depende das dependências e da fila.
- Depende de: M16-F02 concluída; predecessor [#164](https://github.com/RodReis/rrb-jarvisOS/issues/164).
- Design: `docs/superpowers/specs/2026-08-29-mvp-016-aprendizado-operacional-design.md`.

## Objetivo

Registrar candidatas e versões de políticas por projeto/global local, selecionar configurações compatíveis sem mistura silenciosa e congelar um snapshot autossuficiente por run. O registro valida e persiste decisões de promoção; não executa experimentos nem cria autoridade para promover.

## Stack e estrutura

- Node.js `>=22`, TypeScript 5.9, Electron main, `better-sqlite3` e Vitest existentes; sem novo banco ou dependência obrigatória.
- `src/shared/domain/learning.ts`: ampliar o domínio da F01/F02 com candidatas, versões, decisões e snapshots.
- `src/shared/contracts/learning.ts`: schemas versionados de registro, resolução e persistência.
- `src/main/learning/policy-mechanism-catalog.ts`: contratos tipados, validadores e dependências dos mecanismos conhecidos.
- `src/main/learning/policy-registry.ts` e `policy-repository.ts`: candidatas, versões imutáveis, diário de transições e revisões ativas.
- `src/main/learning/policy-resolver.ts` e `policy-compatibility.ts`: precedência, aplicabilidade, composição e fallback determinísticos.
- `src/main/learning/policy-snapshot.ts`: materialização, serialização canônica e hash.
- `src/main/learning/run-policy-snapshot-port.ts`: integração com a criação/retomada canônica de runs dos MVPs 009/013; o dono do run mantém a transação e os efeitos.
- `src/main/storage/migrations.ts`: migrations forward-only para o registro e snapshot vinculado ao run, no SQLite existente.
- Testes unitários junto aos módulos e integração SQLite temporária seguindo o padrão do projeto. Os caminhos acima são destinos planejados, não declaração de código já existente.

Exemplo de contrato, com tipos explícitos, configuração validada e sem campos executáveis:

```ts
type PolicyOrigin = 'base' | 'global_local' | 'project'

interface FrozenPolicyPackage<TConfig> {
  readonly mechanismId: string
  readonly schemaVersion: number
  readonly versionId: string
  readonly origin: PolicyOrigin
  readonly config: TConfig
  readonly configHash: string
}

interface PolicySnapshot<TPackages> {
  readonly snapshotId: string
  readonly projectId: string
  readonly runId: string
  readonly schemaVersion: number
  readonly baseConfigHash: string
  readonly packages: TPackages
  readonly compositionHash: string
  readonly createdAt: string
}
```

Na implementação, `TPackages` representa a coleção tipada pelo catálogo, não um JSON arbitrário aceito sem validação. Imutabilidade é exigida também na persistência, não apenas por `readonly`.

## Dentro

- `PolicyCandidate`, `PolicyVersion`, `PolicyTransitionDecision`, `PolicyResolution` e `PolicySnapshot`.
- Pacotes completos e versionados por mecanismo, com catálogo e validação de schema.
- Escopos `project` e `global_local`, precedência, elegibilidade e proveniência.
- Aplicação idempotente/condicional de decisões de promoção/reversão recebidas pelo contrato da F04.
- Compatibilidade entre mecanismos, fallback do grupo afetado e diagnóstico por escolha/exclusão.
- Snapshot persistido com o run, reutilizado em retries/retomadas, sem dependência de consulta ao catálogo.
- Integração mínima com o dono do run para gravar/ler o snapshot; índices de aprendizado reconstruíveis.

## Fora

- Executar replay, shadow, canário, calcular perfis/amostras ou decidir melhoria: F04.
- Gerar hipóteses assistidas, chamar Claude/Codex ou implementar estratégias Graphify/Caveman: F05.
- UI, pop-ups e IPC público do console: F06.
- Reimplementar scheduler, dispatcher, executor, recuperação, orçamento, Git ou deploy.
- Alterar automaticamente SPEC, escopo, gates, tentativas máximas, limite financeiro, provider ou regra de produto.
- Sincronização externa, memória/RAG do MVP-007, leitura integral de repositório ou cópia de artefatos brutos.

## 1. Pacote, catálogo e versionamento

1. Um pacote descreve a configuração completa de um mecanismo. Overrides substituem esse pacote, nunca fazem merge implícito de campos com a versão global/base.
2. O catálogo declara `mechanismId`, versão do schema, validador, capacidades/contratos de entrada e saída, dependências relevantes e fonte da configuração-base. Só parâmetros que o mecanismo proprietário já permite são aceitos.
3. Seleção, compressão e cache são exemplos previstos no design. F03 define o contrato do catálogo e testa mecanismos simulados; não antecipa os algoritmos/integrações da F05 nem inventa campos configuráveis para mecanismos existentes.
4. Campo desconhecido, mecanismo/schema não reconhecido, pacote incompleto ou parâmetro fora dos limites do proprietário impede registrar/aplicar aquele pacote. O run pode usar fallback; isso não cria gate de produto.
5. `PolicyCandidate` registra identidade, revisão, escopo, mecanismo, pacote/hash, configuração-base avaliada, aplicabilidade, dependências, origem, hipótese e referências de evidência. Texto livre é limitado; prompt, log, diff, código executável e credencial não são conteúdo de política.
6. Alterar configuração, escopo, aplicabilidade ou dependência cria nova revisão com hash e vínculo à anterior. Provas da revisão anterior não migram automaticamente.
7. `PolicyVersion` preserva o conteúdo exato de uma revisão promovida e sua proveniência. Conteúdo é imutável; promoção, estabilização, reversão e aposentadoria são registros novos no diário, não reescrita da versão.
8. Chave idempotente repetida com mesmo conteúdo é no-op; mesma chave com conteúdo diferente é conflito. Versão mais recente por timestamp não ganha autoridade por isso.

## 2. Registro não é promoção

O contrato `PolicyTransitionDecision` contém ID/chave idempotente, origem, transição pretendida, versão/revisão/hash exatos, escopo/mecanismo, revisão ativa esperada, hash da base/composição avaliada, referências de provas, versão das regras de avaliação e referência da autoridade aplicável.

- F04 produz decisões a partir de experimentos e das regras aprovadas. F03 verifica vínculo, integridade, origem e autoridade pelo contrato interno, e persiste a transição. Um campo recebido como `approved: true`, texto de IA ou pedido direto de mudar status não basta.
- A autoridade continua a do design: ajustes reversíveis/não semânticos dentro do permitido podem promover automaticamente com prova; mudanças materiais seguem a decisão do PI já exigida. F03 não acrescenta aceite duplicado nem amplia essa autoridade.
- A verificação da referência exige que a prova pertença à versão e à base avaliadas; uma referência qualquer, ausente ou de outra revisão não torna a candidata elegível.
- Atualização da base ou dos mecanismos dos quais a prova depende torna essa decisão obsoleta e exige reavaliação na F04. Até lá, o resolver preserva a alternativa estável/base elegível. A prova identifica esse conjunto relevante; mudança em mecanismo comprovadamente independente não invalida a amostra apenas por alterar o hash da composição completa.
- Persistência da decisão, nova revisão ativa e histórico é atômica. Promoções são serializadas por `scope + mechanism`, comparando a revisão ativa esperada. Conflito não sobrescreve o vencedor: retorna necessidade de reavaliação.
- Reaplicação de decisão já confirmada devolve o resultado registrado, mesmo se a revisão ativa já avançou; não reaplica o efeito nem retrocede o ponteiro. Só decisões ainda não aplicadas enfrentam a comparação da revisão esperada.
- Snapshot obtém uma leitura coerente das revisões envolvidas; não mistura metades de atualizações concorrentes. A compatibilidade da composição ainda precisa ser validada.
- F03 testa transições com produtor/verificador de provas simulados, restritos ao teste. Sem a integração real da F04, candidatas não são promovidas em operação; na ausência de versão elegível, a configuração-base continua disponível.
- O ciclo `draft → replay → shadow → canary → active`, com resultados rejeitado/inconclusivo/expirado e reversão/aposentadoria, permanece coordenado pela F04. F03 guarda o histórico e impede publicação direta de rascunho como ativo. F03 não define novo atalho nem duração de estabilização.
- Runs comuns só recebem versões promovidas elegíveis ou a base. Seleção experimental para shadow/canário é responsabilidade da F04 e não nasce implicitamente da precedência do resolver.

## 3. Escopos e escolha por mecanismo

Consultar apenas políticas específicas do projeto solicitado e padrões `global_local` já promovidos/generalizados. Política de outro projeto nunca é fallback. No escopo global, o pacote não contém paths, dados ou regras de negócio específicos da origem; evidência detalhada continua com seu dono, não vai no snapshot de outro projeto.

O identificador de escopo inclui o tipo e, para `project`, o `projectId`. Cada par escopo/mecanismo mantém uma revisão ativa designada pelo registro; não escolher entre candidatos concorrentes por timestamp ou ordem de consulta.

Ordem de escolha: projeto, global local, base. Em cada escopo aprendido, tentar a revisão ativa compatível e, se indisponível/inaplicável, a última estável ainda elegível daquele escopo antes de descer para o seguinte. A precedência vale para pacotes inteiros. Uma versão `stale`, revertida, aposentada ou com aplicabilidade desconhecida não vence por estar em escopo mais específico.

O fallback para última estável usa somente versão/composição registrada como estável, ainda elegível no contexto atual; não ressuscita uma versão revertida nem confunde “última publicada” com “estável”. Se não houver alternativa comprovadamente utilizável, usa a base. A marca de estabilidade vem do ciclo da F04, não de um tempo inventado pela F03.

Cada escolha produz motivo rastreável: origem, versão/hash, requisitos avaliados e rejeições por incompatibilidade, desconhecido, versão não ativa, prova insuficiente, conflito ou catálogo indisponível. O diagnóstico não contém configuração bruta de outro projeto.

## 4. Aplicabilidade e composição entre mecanismos

Reutilizar as dimensões da F02: tarefa/mecanismo, stack/versões relevantes, executor/modelo/provider quando influentes, ambiente e hashes das políticas-base. Dado relevante ausente é `unknown`, incompatível é `stale`; nenhum dos dois habilita aplicação aprendida automática. A avaliação é por contexto, sem invalidar usos históricos em contextos diferentes.

1. Pacotes declaram dependências relevantes e versões/contratos que exigem dos outros mecanismos. A declaração é validada contra o catálogo; omitir uma dependência conhecida não prova independência.
2. Após a seleção por precedência, validar entradas/saídas e dependências da composição inteira antes de congelar o snapshot. Compatibilidade de schema, sozinha, não substitui a evidência exigida pela F04 para mecanismos acoplados.
3. Falha em uma relação identifica o grupo interdependente atingido, incluindo os consumidores transitivos afetados. O grupo volta junto à última composição estável compatível ou ao conjunto-base; não escolhe versões soltas para formar uma combinação inédita.
4. Mecanismos comprovadamente independentes podem manter suas escolhas. Após o fallback, revalidar também as relações na fronteira do grupo; conflito remanescente expande o grupo afetado até obter composição válida/base. Não executar busca ilimitada de combinações.
5. Mesmas entradas, revisões e contexto produzem os mesmos pacotes, diagnóstico e hash lógico. Ordenar mecanismos/razões canonicamente; tempo de consulta não é critério oculto de desempate.
6. F04 avalia combinações realmente acopladas, não o produto cartesiano de todos os mecanismos. F03 valida o contrato/elegibilidade dessas combinações sem executar experimentos.
7. Incompatibilidade do aprendizado gera fallback e explicação, não pausa para PI nem bloqueio da construção. Limites do mecanismo proprietário permanecem vigentes.

## 5. Snapshot por run e controles vigentes

- Congelar na criação efetiva do run, antes da primeira tentativa. A existência da issue ou sua posição no backlog não congela política; não mudar a semântica do dispatcher para antecipar criação de runs.
- Snapshot autossuficiente contém projeto/run, versão do schema, configurações efetivas completas, versões/origens/hashes, revisão coerente do registro quando disponível, base/aplicabilidade/dependências avaliadas, escolhas/fallbacks e hash da composição. Datas/IDs operacionais não entram no hash lógico da composição.
- Retentativas de criação usam a identidade/chave idempotente do run. Se já existir, retornar exatamente o snapshot gravado; nunca recalcular e sobrescrever porque uma política foi promovida entre as chamadas.
- Retry, pausa/retomada e reinício do **mesmo run** preservam snapshot e contagem de tentativas. Promoção/reversão posterior não altera esse registro.
- Continuação definida pelo domínio como **novo run** recebe novo snapshot e mantém `continuationOf`/vínculo equivalente ao anterior. Não converter retry em novo run para escapar de limite ou duplicar efeito.
- Pausa, cancelamento, kill-switches, quotas, permissões e habilitação de gasto continuam sendo consultados nos mecanismos proprietários. Snapshot não congela saldo/autoridade nem autoriza ignorar uma desativação posterior.
- Snapshot fixa configuração, não disponibilidade física de estratégia ou serviço. Fallback operacional já previsto no contrato pode ocorrer e deve ser registrado como resultado efetivo da tentativa, sem reescrever snapshot nem trocar silenciosamente por política recém-promovida.

## 6. Persistência e indisponibilidade

O dono do run grava o snapshot completo na mesma transação da criação do run, no SQLite existente; a F03 fornece o contrato/adapter e integra esse ponto. Não criar um segundo banco, nem duas cópias canônicas independentes: a cópia vinculada ao run é a fonte para sua execução e retomada; índices no aprendizado apontam para ela.

- Catálogo/registro de aprendizado indisponível: novos runs recebem uma composição estável compatível já disponível e verificável localmente ou a base fornecida pelos mecanismos proprietários, registrando origem e degradação. Não esperar a recuperação do catálogo nem usar cache sem condição de elegibilidade verificável.
- Run existente lê sua própria cópia persistida, sem resolver políticas de novo. Indisponibilidade do índice de aprendizado não impede essa leitura.
- Persistência do run e snapshot confirma tudo ou nada. Falha do armazenamento canônico não é sucesso e segue a recuperação já existente do núcleo; não confundir indisponibilidade do catálogo com perda do banco que sustenta toda execução.
- Snapshot ausente/corrompido em run existente não é reconstruído pela política atual e apresentado como original. A reconciliação usa evidência/cópia íntegra do próprio run; ausência irrecuperável segue o tratamento existente de estado inconsistente do núcleo, sem decisão de produto nova.
- Políticas/versões/decisões são canônicas e duráveis; índices de resolução são derivados e reconstruíveis. Retenção do aprendizado não remove snapshot do histórico do run nem muda seus hashes.
- Rebuild preserva decisões, versões e snapshots. Schemas antigos permanecem legíveis; evolução cria nova versão e não reinterpreta silenciosamente configuração histórica.

## Comandos de verificação da implementação

```text
npm run typecheck
npm run lint
npm test
npm run build
```

## Estratégia de testes

- Vitest unitário para catálogo, revisão, hashes, precedência, compatibilidade, grupos afetados e composição.
- Fixtures de três mecanismos: dois acoplados e um independente; incluir dependência transitiva, ausente, omitida e incompatível após fallback.
- Integração SQLite para migrations, unicidade, promoção concorrente, diário atômico e criação conjunta de run/snapshot.
- Crash antes/depois de cada confirmação; replay de comandos duplicados e disputa entre criação do run e promoção.
- Produtor de decisões/provas simulado: prova ausente, hash divergente, base obsoleta, revisão errada e autoridade insuficiente; sem CLI autenticada ou serviço pago.
- Retomada com catálogo desligado, nova política publicada, perda de índice, snapshot corrompido e schema histórico.
- Contrafactuais: permitir merge de campos, aceitar mera flag de aprovação, recalcular snapshot no retry ou congelar kill-switch precisa quebrar teste.
- Evidência por critério na issue/PR. Não exigir E2E visual nesta fatia sem UI; jornada integrada permanece na F06.

## Critérios de aceite

1. Pacote incompleto/desconhecido é rejeitado; override substitui o pacote inteiro, sem herança silenciosa de campos.
2. Mudança de conteúdo/aplicabilidade gera revisão/hash novos; versão anterior e suas provas permanecem imutáveis.
3. Salvar candidata ou enviar mera flag/texto de aprovação não a ativa; transição exige versão, prova, origem e autoridade verificadas.
4. Decisão de promoção sobre base/revisão obsoleta não sobrescreve a ativa e fica para reavaliação pela F04.
5. Cem reaplicações da mesma decisão produzem uma transição lógica; duas promoções concorrentes sobre a mesma revisão não se sobrescrevem silenciosamente.
6. Projeto compatível vence global compatível; outro projeto nunca fornece fallback nem expõe conteúdo pelo snapshot/diagnóstico.
7. `stale`, desconhecido, revertido ou aposentado não se torna elegível por precedência, idade ou ausência do catálogo.
8. Dois mecanismos individualmente válidos mas incompatíveis entre si acionam fallback conjunto; o independente é preservado quando comprovado, inclusive após revalidar a fronteira.
9. Mesmas entradas produzem mesma composição/hash lógico e razões de escolha; não há busca ilimitada ou exigência de testar todas as combinações.
10. Run e snapshot autossuficiente são persistidos atomicamente antes da tentativa; crash/repetição não cria run duplicado nem snapshot parcial.
11. Retry/retomada do mesmo run, mesmo após promoção ou reinício, retorna o snapshot original sem consulta ao catálogo; continuação com novo run mantém vínculo e recebe novo snapshot.
12. Pausa, cancelamento, quota, permissão e desativação de gasto seguem vigentes; snapshot antigo não contorna os controles nem reinicia tentativas.
13. Catálogo desligado permite novo run com composição estável verificável/base e permite retomar run pelo snapshot próprio; falta de prova não é presumida.
14. Retenção/rebuild do aprendizado preserva configurações e hashes históricos; corrupção não é mascarada recalculando a política original.
15. F03 prova registro/resolução com produtor da F04 simulado, sem promover candidatas reais por atalho, executar experimento, chamar executor ou alterar regra de produto.

## Limites

- **Sempre:** validar pacote/proveniência, preservar versões e aplicar transições condicionalmente; congelar e persistir configuração completa por run.
- **Consultar a SPEC:** mudança de precedência, autoridade, identidade, compatibilidade, semântica de snapshot ou divisão entre fatias; ajuste técnico compatível segue o plano, sem aceite duplicado.
- **Nunca:** fundir campos silenciosamente, promover por opinião, consultar outro projeto como fallback, congelar controles operacionais, recalcular histórico ou transformar falha do catálogo em gate da pipeline.

## Decisões confirmadas pelo PI (2026-08-29)

1. Versão completa e tipada por mecanismo; projeto substitui global quando compatível, sem mistura silenciosa.
2. F03 registra/valida transições; F04 conduz experimentos e promoção com provas vinculadas à revisão/base.
3. Snapshot único na criação efetiva do run, preservado em retries/retomadas, com controles operacionais vigentes.
4. Compatibilidade entre mecanismos e fallback conjunto somente do grupo interdependente afetado.
5. Snapshot autossuficiente no registro durável do run; catálogo indisponível usa estável verificável/base para novos runs; continuação como novo run preserva vínculo e recebe novo snapshot.

## Revisão pelo PI

Revisão exata do commit `2ea2f1f` aprovada pelo PI em 2026-08-29, sem alteração dos requisitos. A issue #165 passa a Backlog, preservando o predecessor #164 e a fila corrente. O aceite não inicia implementação nesta tarefa, que permanece em planejamento.
