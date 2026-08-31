# SPEC-Memoria-01 — Núcleo, identidade e persistência

- MVP/Fatia: MVP-007 · M7-F01.
- Issue: [#180](https://github.com/RodReis/rrb-jarvisOS/issues/180); épico [#179](https://github.com/RodReis/rrb-jarvisOS/issues/179).
- Status: **aprovada-pi** (2026-08-30); issue em `proplan:backlog`; permanece a orientação de não implementar agora.
- Revisão aprovada: `83e952fd4e5f22850653bf81cf1d45d6c4377c84`, aceite explícito do PI nesta conversa. Atualização abaixo registra somente o aceite, sem alterar o contrato.
- Depende de: fundação local existente; nenhuma fatia anterior do MVP-007.
- Design: `docs/superpowers/specs/2026-08-30-mvp-007-memoria-compartilhada-design.md`, seções 2, 7, 8, 11 e 14.
- Índice canônico: `docs/STATUS.md`.

## Objetivo

Entregar um núcleo local compartilhado que receba registros normalizados, conserve identidade e proveniência, reconheça reentregas, represente correções/conflitos e sobreviva ao reinício. JarvisOS e AgentsOS usam o mesmo núcleo; documentos, Git, execuções, auditoria e decisões originais continuam nos respectivos donos.

Esta fatia entrega serviço interno e persistência testáveis, não coleta automática completa nem uma nova tela. “Memória registrada” não significa informação vigente, evidência comprovada ou lição validada.

## Base e aceite desta revisão

O PI já havia aprovado identidade por origem, separação registro/revisão/evento, substituição comprovada sem ordem de chegada, conflitos explícitos, armazenamento local existente e Graphify opcional. Em 2026-08-30, aprovou a revisão escrita indicada no cabeçalho: schemas v1, chaves compostas, revisões com predecessoras explícitas, limites técnicos, tabelas e os vinte critérios abaixo. As expressões “proposta” e “recomendada” preservadas no corpo registram a redação submetida; seu conteúdo está abrangido por esse aceite.

Alternativas consideradas:

- **SQLite existente + revisões imutáveis e projeção de estado — recomendada:** permite confirmar aplicação e diagnóstico na mesma transação, preservando as convenções locais.
- Arquivos JSON por registro: simples de inspecionar, mas exigiriam protocolo próprio para confirmar conjuntamente revisões, conflitos e deduplicação.
- Banco de grafo como fonte central: acoplaria a memória básica ao componente opcional e não resolveria, por si, precedência ou proveniência.

A escolha recomendada não altera ADR-001, contratos do MVP-016, fila de implementação ou regras de produto. Não introduz classificação de domínio, consentimento, gate jurídico ou aceite duplicado.

## Stack e estrutura

Base inspecionada no worktree de planejamento em 2026-08-30, commit `4c68e06`: Node.js `>=22`, TypeScript `^5.9.3`, Electron main, `better-sqlite3 ^13.0.1` declarado no `package.json`. Nenhuma atualização/instalação é parte desta SPEC.

Reutilizar `src/main/storage/database.ts`: arquivo `userData/jarvis.db`, WAL, foreign keys e conexão injetada. Reutilizar o mecanismo forward-only de `src/main/storage/migrations.ts`; escolher o próximo número disponível **na base de implementação**, sem reservar número agora nem editar migrations publicadas.

Estrutura proposta:

| Arquivo/área                                      | Responsabilidade                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| `src/shared/domain/memory.ts`                     | Tipos, identidade, precedência e estados puros.                       |
| `src/shared/contracts/memory.ts`                  | Validação estrita do envelope v1 e limites.                           |
| `src/main/memory/memory-service.ts`               | Aplicar evento normalizado e consultar registro/histórico/pendências. |
| `src/main/memory/memory-repository.ts`            | Transação, unicidade, revisões, relações e projeção local.            |
| `src/main/storage/migrations.ts`                  | Migração aditiva de tabelas e índices da memória.                     |
| Arquivos `*.spec.ts` e `*.int-spec.ts` adjacentes | Regras puras e integração com arquivo SQLite temporário.              |

Contratos usam `readonly`, uniões discriminadas, nomes explícitos, imports de tipo e estilo TypeScript existente, sem `any` no boundary. Campos SQL seguem `snake_case`; DTOs seguem `camelCase`, com conversão explícita. Não mover Node/SQLite para o renderer.

## Escopo

### Dentro

- Contrato interno de aplicação, leitura exata por identidade, histórico paginado e pendências.
- Identidade composta por dono, workspace, produto de origem, escopo, fonte e registro.
- Registro durável dos eventos aceitos, variantes conflitantes, revisões, provas e relações explícitas.
- Deduplicação, substituição comprovada, invalidação lógica e diagnóstico sem sobrescrita silenciosa.
- Persistência atômica, migração preservadora, recuperação após reinício e provas de falha.

### Fora

- Adapters reais de documentos/Git/Notebook, carga inicial, cursores, retries e cobertura agregada: F02.
- Busca textual/semântica, ranking, expansão de contexto e montagem de ContextPack: F03.
- Compactação após 30 dias, reconstrução integral, quotas de disco e exclusão física: F04.
- Graphify, modelos, embeddings e instalações globais: F05.
- Avaliar/promover lições e definir sucesso dos módulos: F06; aprendizado da pipeline permanece no MVP-016.
- UI, IPC público novo e Notebook completo: F07; prova integrada entre fatias: F08.
- Sincronização, serviços externos obrigatórios, varredura do computador e alteração de registros dos donos.

F01 não cria scheduler, console administrativo ou catálogo universal dos módulos futuros. Testes desta fatia não ficam adiados para F08. DESIGN-SYSTEM.md e protótipos HTML permanecem exigidos na fatia visual, não são condição para redigir este contrato interno.

## Contrato de identidade e escopo

O contexto de execução é fornecido pelo chamador interno autenticado, não inferido do texto recebido:

```ts
interface MemoryContext {
  readonly userId: string
  readonly workspaceId: 'jarvis'
}

type MemoryProductId = 'jarvisos' | 'agentsos'

type MemoryScope =
  { readonly kind: 'project'; readonly projectId: string } | { readonly kind: 'product' }

interface MemorySourceBinding {
  readonly productId: MemoryProductId
  readonly scope: MemoryScope
  readonly sourceId: string
}

interface MemoryRecordKey {
  readonly productId: MemoryProductId
  readonly scope: MemoryScope
  readonly sourceId: string
  readonly recordId: string
}

interface MemoryRevisionRef {
  readonly key: MemoryRecordKey
  readonly sourceRevision: string
}

interface MemorySourceRef {
  readonly sourceId: string
  readonly recordId: string
  readonly sourceRevision: string
  readonly locator: string
}
```

- AgentsOS é produto/origem neste contrato, **não novo WorkspaceId**. `src/shared/domain/entities.ts` continua com `noa | jarvis`; não ampliar o recorte para NOA.
- Toda tabela da memória mantém `user_id` e `workspace_id`. Consulta exige esse contexto; nomes de produto/projeto no payload não concedem acesso.
- Identidade lógica = tupla `[userId, workspaceId, productId, scope.kind, projectId ou "", sourceId, recordId]`. `projectId` vazio é proibido em escopo de projeto; ausência de projeto não cria projeto fictício.
- Identidade de revisão acrescenta `sourceRevision`; identidade de evento usa o mesmo namespace **sem recordId**, acrescentando `eventId`. Um evento de uma fonte não pode mudar de registro numa reentrega.
- IDs são strings opacas, não vazias, sensíveis a maiúsculas; não aparar, converter caixa ou deduplicar por texto. `sourceRevision` não é ordenável por relógio, número presumido ou comparação lexical.
- Guardar componentes em colunas, não concatenar por separador ambíguo. A representação externa da chave é uma tupla JSON versionada; o hash não substitui os componentes.
- Nome, caminho e `locator` são localizadores, não IDs. Renomeação só mantém identidade quando o adapter comprova continuidade; sem prova, são registros distintos com relação explícita, não fusão automática.
- `MemorySourceRef` aponta para evidência na fonte do mesmo produto/escopo do envelope; não exige que essa evidência já esteja importada. Referências entre registros de outros produtos/projetos usam `MemoryRevisionRef` completo e passam pelas permissões existentes do chamador.
- Localizadores não são comandos nem autorização para abrir caminhos/URLs. F01 os conserva como referências; leitura real pertence ao adapter. Segredos do Vault não entram no texto ou no locator.

## Envelope e catálogo v1

```ts
type MemoryContent =
  | {
      readonly kind: 'source_artifact'
      readonly artifactKind: 'document' | 'code' | 'commit' | 'task' | 'artifact'
      readonly title: string
      readonly excerpt: string | null
    }
  | {
      readonly kind: 'explicit_knowledge'
      readonly knowledgeKind: 'note' | 'pi_guidance' | 'decision'
      readonly text: string
      readonly authorRef: string
    }
  | {
      readonly kind: 'observation'
      readonly group: 'agent' | 'operation'
      readonly summary: string
      readonly outcomeRef: MemorySourceRef
    }
  | {
      readonly kind: 'inference'
      readonly claim: string
      readonly producerRef: string
    }

interface MemoryEnvelopeBase {
  readonly schemaVersion: 1
  readonly key: MemoryRecordKey
  readonly eventId: string
  readonly sourceRevision: string
  readonly occurredAt: string | null
  readonly sourceRef: MemorySourceRef
  readonly supersedes: readonly {
    readonly sourceRevision: string
    readonly proofRef: MemorySourceRef
  }[]
}

type MemoryEnvelope =
  | (MemoryEnvelopeBase & {
      readonly type: 'record.upsert'
      readonly payload: MemoryContent
      readonly dependsOn: readonly MemoryRevisionRef[]
      readonly contradicts: readonly MemoryRevisionRef[]
    })
  | (MemoryEnvelopeBase & {
      readonly type: 'record.invalidate'
      readonly payload: {
        readonly reason: 'removed' | 'outdated' | 'retracted'
        readonly explanation: string
      }
    })
```

Sem objetos livres ou campos extras. Invalidação não aceita `dependsOn`/`contradicts`; upsert exige ambos, mesmo vazios. Todos os campos mostrados são obrigatórios; só os explicitamente nuláveis aceitam `null`. Ausência de horário na origem usa `occurredAt: null`, sem inventar data.

`sourceRef` deve coincidir com fonte, registro e revisão do envelope. `observedAt` é gerado no recebimento pelo núcleo e armazenado separadamente; reentregas mantêm `firstObservedAt` e atualizam apenas contagem/`lastObservedAt`. Nenhum desses tempos decide precedência.

`supersedes` vazio declara uma raiz observada, não “revisão mais recente”. Cada entrada referencia uma revisão do **mesmo registro**, diferente da própria, e traz prova da substituição na fonte. O adapter é responsável por comprovar/normalizar essa relação, não o texto de um agente. F01 valida forma, origem e consistência local, sem buscar prova pela rede.

No v1, `observation` registra fato/resumo e referência de resultado, não `success: true` presumido. `inference` exige pelo menos uma dependência. Orientação/decisão do PI só pode vir da fonte que registra essa autoria, não da autodeclaração de um agente. Rótulo `validated_lesson` é incompatível com v1; F06 definirá a avaliação e sua evolução compatível, sem transformá-la em requisito de F01.

`dependsOn` registra revisões que sustentam conteúdo derivado; `contradicts` registra contrapontos explicitamente identificados pela fonte. F01 não descobre contradições por semelhança nem cria arestas por LLM. Relações apontam para revisão exata; sua existência não promove uma inferência a decisão.

### Limites propostos

Todos os tamanhos são bytes UTF-8; violação gera pendência, nunca truncamento silencioso do conteúdo:

| Campo/recurso                                  | Limite v1                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| Cada ID opaco, inclusive authorRef/producerRef | 256 bytes; sem controles U+0000–U+001F ou U+007F.                                  |
| Locator                                        | 2.048 bytes, não vazio.                                                            |
| Title                                          | 512 bytes, não vazio.                                                              |
| Text/claim/summary/explanation/excerpt         | 16.384 bytes por campo; não vazio quando presente.                                 |
| Envelope normalizado completo                  | 65.536 bytes de JSON canônico.                                                     |
| Supersedes                                     | Até 32 revisões distintas.                                                         |
| DependsOn e contradicts                        | Até 32 referências distintas em cada conjunto; sem autorreferência exata.          |
| Página de histórico/pendências                 | 1–100 itens; padrão 50; até 262.144 bytes serializados, com cursor se houver mais. |
| Diagnóstico de entrada incompatível            | Até 4.096 bytes, sem cópia do objeto bruto.                                        |

Datas, quando presentes, são ISO UTC `YYYY-MM-DDTHH:mm:ss.sssZ`, válidas no calendário. Validação percorre apenas a profundidade fixa dos schemas; não aceita JSON recursivo arbitrário. Arrays de relações são conjuntos: duplicatas são incompatíveis e a ordem é normalizada por chave/revisão para hashing.

Conteúdo maior permanece na fonte e o adapter pode fornecer trecho explicitamente selecionado + referência; não cortar silenciosamente para parecer completo. Os limites são de transporte/trabalho por chamada, **não quota de tokens, retenção ou capacidade total**. A política de crescimento/compactação fica em F04.

### Igualdade e colisão

Usar SHA-256 do JSON canônico do domínio: chaves de objetos ordenadas por unidades UTF-16, serialização JSON sem espaços, arrays de relações ordenados como conjuntos; strings preservadas sem normalização Unicode. A implementação deve serializar as chaves nessa ordem, inclusive chaves numéricas, sem depender da reordenação de um objeto JavaScript.

- `eventHash`: envelope inteiro, sem metadados de recepção.
- `revisionHash`: envelope sem `eventId` e `occurredAt`. Inclui tipo, payload, proveniência, dependências, contrapontos e substituições.
- Mesmo eventId + mesmo eventHash: reentrega; nenhum novo fato/evidência.
- Mesmo eventId + hash diferente: conflito de identidade do evento, mesmo que só o horário de origem tenha mudado.
- Eventos diferentes + mesma revisão/hash: registrar eventos distintos ligados à mesma revisão, não duplicar a revisão.
- Mesmo registro/revisão + revisionHash diferente: conservar variantes como conflito. Nenhuma delas ganha por ter chegado primeiro.
- Comparar também o conteúdo canônico quando hashes coincidirem; divergência é conflito de integridade, não igualdade presumida.

Correção legítima precisa de nova revisão, novo evento e prova; alteração do parser que mude o significado do snapshot exige revisão normalizada distinta e rastreável, não reaproveitamento do ID antigo.

## Precedência, conflitos e validade

### Revisões e substituição

Manter o grafo de substituição do registro, separado do grafo opcional de conhecimento. Uma revisão é cabeça quando nenhuma revisão conhecida a substitui. Raízes não relacionadas coexistem; não inferir ordenação.

- Predecessora ausente: persistir a revisão, a relação pendente e o motivo `predecessor_missing`. Ela não pode ser exposta como vigente. Chegada da predecessora reavalia a cadeia afetada na mesma confirmação.
- Duas cabeças: estado `conflict`, sem vencedor automático. Uma correção posterior pode substituir ambas com prova para cada uma, sem apagar o histórico.
- Ciclo de substituição: registrar `revision_cycle` para os membros envolvidos; nenhum membro ou descendente que dependa desse ciclo vira vigente. Resultado deve ser independente de qual aresta chegou por último.
- Colisão de identidade/revisão: preservar variantes e retirar qualquer escolha automática. Uma nova revisão completa pode resolver a divergência com substituição explícita das revisões afetadas e prova da fonte; não exige escolher retrospectivamente uma variante histórica.
- Colisão de eventId envolvendo dois registros afeta ambos e não admite reutilização desse evento como prova de vigência. Reconciliação exige eventos novos e revisões completas com prova; a colisão original permanece consultável.
- Corrigir uma inferência não substitui uma decisão de outra fonte: são identidades distintas. O núcleo não aceita uma relação de substituição cruzando registros.

### Invalidação como revisão

`record.invalidate` produz revisão própria, com `supersedes` não vazio e prova da remoção/desatualização/retração. Quando é a única cabeça resolvida, o registro fica `invalidated`; **não retornar à revisão anterior como atual**.

Reentrega da revisão antiga não reativa conteúdo. Restauração comprovada é novo upsert que substitui explicitamente a revisão de invalidação. Indisponibilidade temporária não gera esse evento: será cobertura em F02. F01 não possui comando de exclusão física.

### Estado consultável

`MemoryRecordView` retorna chave, cabeças, revisão atual quando elegível, motivos e flags, separando:

- `lineage: resolved | pending | conflict`: integridade e continuidade da cadeia. Predecessora ausente, ciclo e colisões não resolvidas aparecem com código e referências.
- `availability: active | invalidated | unresolved`: resultado da cabeça. Só cadeia resolvida de cabeça única permite active/invalidated.
- `support: not_required | current | stale | unknown`: situação das dependências da cabeça.
- `hasContradictions`: contrapontos explícitos; retornar referências, inclusive quando o alvo ainda não chegou.
- `eligibleCurrent`: somente cadeia resolvida, cabeça upsert e suporte current/not_required. Contradição não é apagada nem escolhe vencedor; acompanha todo retorno como contexto obrigatório.

Mais de uma cabeça, ciclo conhecido ou colisão não resolvida resultam em lineage conflict; predecessor ausente ou avaliação limitada resultam em pending. Cabeça única sem esses problemas resulta em resolved. Conflito prevalece sobre pending quando ambos são conhecidos. A resolução por nova revisão não apaga o diagnóstico histórico: a condição deixa de afetar a cabeça atual somente quando a substituição comprovada cobre os ramos/revisões conflitantes.

Dependência só é current se a revisão referenciada for vigente, acessível e elegível no núcleo. Se nunca importada, suporte unknown; se foi substituída/invalidada, stale. Essa regra se aplica transitivamente: um ciclo de sustentação não comprova nada e resulta em unknown. Referência de proveniência externa (`sourceRef`) sozinha não é uma dependência importada nem prova de atualidade externa.

Consultar validade no estado atual do núcleo, sem servir flag de cache obsoleta; invalidar projeção afetada ou recalcular antes de responder. Leituras em snapshot consistente. Trabalho de travessia limitado a 256 revisões por chamada, inclusive aplicação; ao atingir o limite sem concluir, devolver `evaluation_limit`, lineage pending e/ou suporte unknown conforme a avaliação interrompida, nunca current presumido. A revisão recebida permanece durável; não descartar nem percorrer todo o acervo numa chamada. Sem coleta, F01 informa “validade local”; não promete que a origem externa está sincronizada.

Troca relevante de uma dependência exige nova revisão do conteúdo derivado com as referências atualizadas. Material antigo continua acessível explicitamente como histórico; não volta a vigente só porque uma reconstrução recriou seu texto.

## Persistência e transação

Modelo lógico mínimo; nomes de colunas adicionais e índices auxiliares podem seguir a implementação sem alterar os contratos:

| Tabela            | Conteúdo e restrições principais                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory_record`   | Componentes da chave, índice UNIQUE completo e versão da projeção.                                                                                   |
| `memory_event`    | Namespace/eventId, variantes canônicas, hashes, primeira/última recepção e contagem. Variantes conflitantes não sobrescrevem o primeiro evento.      |
| `memory_revision` | Registro/revisão/hash + conteúdo canônico; variantes históricas, eventos de origem e metadados de recepção separados.                                |
| `memory_relation` | Ligações supersedes/depends_on/contradicts com revisões e provas; alvo ainda ausente é representável.                                                |
| `memory_pending`  | Identificador local, chave/evento quando conhecidos, referência de reentrega, código, detalhe limitado, estado open/resolved e vínculo da resolução. |

Todas as tabelas carregam o contexto do dono. Constraints/foreign keys impedem vínculos entre donos; referências ainda não importadas usam componentes de chave, não FK que exija chegada antecipada. Eventos distintos ligados à mesma revisão usam associação explícita, nunca uma lista sobrescrita no payload. Para colisões de hash com conteúdo diferente, usar identidade interna distinta e conservar ambos os conteúdos; não depender apenas de UNIQUE(hash).

`memory_record` é projeção reconstruível; as revisões/eventos aceitos não são editados em lugar. Contadores de recepção e diagnósticos são metadados mutáveis. Não adicionar triggers que impeçam a futura retenção/exclusão explícita da memória; triggers de auditoria existente não são tocados.

Aplicação confirma em uma transação: evento/variante, revisão, relações, atualização da projeção e abertura/resolução de pendências afetadas dentro do limite de avaliação. Projeções além desse limite ficam marcadas para reavaliação por uma geração da memória do par usuário/workspace incrementada atomicamente, incluindo dependências entre produtos/projetos; nenhuma leitura pode tratar geração antiga como validade atual. Não é necessário percorrer todos os derivados na escrita. Commit precede retorno de sucesso. Exceção reverte o conjunto, inclusive contadores. Falha em disco/lock/migração retorna `storage_unavailable`; não retornar sucesso nem pendência “durável” que não foi gravada. Chamador conserva sua posição e tentará depois conforme F02, sem bloquear a pipeline.

Transação é síncrona e não contém rede, processo externo, await, modelo ou leitura da fonte. O mecanismo de transação do driver confirma no retorno e reverte em exceção; não capturar erro SQL dentro dela para continuar como sucesso. Referência consultada via Context7: [API oficial de better-sqlite3](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#transactionfunction). A consulta não substitui os testes com a dependência efetiva.

F01 não confirma cursores de ingestão. F02 poderá gravar seu checkpoint próprio na mesma unidade SQLite de confirmação, usando operação interna que participa da transação, sem commit independente. Confirmar pendência não equivale a aplicar evento; falha de storage impede ambos. Nunca modificar checkpoint ou tabelas de outro domínio.

### Entrada incompatível e reprocessamento

A chamada recebe, além do envelope desconhecido, `binding: MemorySourceBinding` da inscrição interna da fonte e `deliveryRef: MemorySourceRef` normalizado pelo adapter. Binding não vem do texto do evento; produto/escopo/fonte do envelope devem corresponder a ele e a fonte do deliveryRef deve coincidir. Esse identificador de entrega é separado de identidade lógica: permite localizar um evento cujo envelope nem pôde ser validado.

Envelope malformado, schema/tipo futuro, tamanho excedido ou campo desconhecido gera diagnóstico durável sanitizado, usando deliveryRef e códigos `invalid_schema | unsupported_schema | payload_limit`. Não gravar objeto bruto inválido em memory_event/memory_revision. Mesmo diagnóstico e entrega atualizam contagem, não geram infinitas linhas.

Se nem o contexto/deliveryRef for válido, retornar `invalid_delivery_context` sem gravação e **sem autorização de avanço**; F02 precisa registrar a posição da fonte em seu próprio diagnóstico antes de prosseguir. Não inventar IDs para fazer parecer que a cobertura foi confirmada.

Reprocessamento pode resolver pendência por chegada de predecessora ou evento corrigido. Conservar motivo, referência e vínculo do evento que resolveu. Uma reentrega idêntica de evento aceito não conta como evidência nova, mas pode consultar/reavaliar sua pendência; não transforma pendência em sucesso por mera repetição.

## Superfície interna e exemplo

Serviço recebe conexão/contexto injetados e expõe:

- `apply(context, binding, deliveryRef, envelope: unknown)`: retorna `applied | duplicate | pending | conflict` com IDs duráveis, ou `storage_unavailable | invalid_delivery_context` sem confirmação durável. Evento válido mas dependente de predecessor ausente retorna pending. Conteúdo derivado com suporte unknown pode ser aplicado, mas não eligibleCurrent.
- `getRecord(context, key)`: retorna MemoryRecordView ou not_found; referências sem acesso não expõem conteúdo. Retorno limitado a 262.144 bytes, com até 100 referências de cabeças (sem seus payloads); truncamento vem explícito em headsTruncated e não permite alegar cabeça única. Revisões completas são lidas no histórico paginado.
- `listRevisions(context, key, page)` e `listPending(context, sourceScope, page)`: paginação determinística por identificador interno, cursor opaco vinculado ao contexto/filtro, ordem de leitura sem implicar precedência. Retorno informa próximo cursor e limitações.

`applied` significa persistido e incorporado ao estado local, não “verdade comprovada” nem revisão necessariamente vigente. Nenhum método do núcleo executa ação de produto.

Exemplo abreviado de sequência: mesmo registro R, revisões A/B/C e eventos diferentes. Todos os eventos de substituição incluem as provas exigidas pelo schema.

| Chegada                         | Resultado esperado                                       |
| ------------------------------- | -------------------------------------------------------- |
| B substitui A; A ainda ausente  | B durável, predecessor_missing; nenhuma revisão vigente. |
| A chega sem predecessora        | Cadeia resolvida; B vigente, A histórica.                |
| A é reentregue identicamente    | Duplicate; B continua vigente, sem nova evidência.       |
| C substitui A, sem substituir B | Duas cabeças B/C; conflito explícito, sem vencedor.      |
| D substitui B e C com provas    | D vigente; divergência B/C preservada como histórico.    |
| E invalida D                    | Registro invalidated; D não volta a vigente.             |
| F upsert substitui E com prova  | F pode ser vigente; invalidação E permanece histórica.   |

## Critérios de aceite propostos

1. **Schema:** os quatro tipos de conteúdo e duas operações válidos são aceitos; campos desconhecidos, union incorreta, datas inválidas, schema futuro e cada limite excedido geram o resultado documentado, sem aplicação parcial.
2. **Identidade:** mesmo ID isolado em fontes/projetos/produtos distintos não colide; consultas de outro usuário não retornam dados. AgentsOS não adiciona workspace.
3. **Continuidade:** troca apenas de título/caminho mantém registro quando origem prova continuidade; textos iguais de fontes/runs distintos continuam distintos.
4. **Deduplicação:** reentrega aceita não duplica evento lógico, revisão ou evidência; dois eventos legítimos da mesma revisão conservam seus vínculos.
5. **Conflito de evento:** mesmo eventId com conteúdo/registro diferente conserva variantes, denuncia ambas as identidades afetadas e não escolhe pela chegada.
6. **Conflito de revisão:** mesma revisão com hashes distintos, e fixture de hashes iguais com conteúdos distintos, conservam variantes; consulta não apresenta a primeira como verdade.
7. **Precedência:** permutações de A, B→A e duplicatas convergem no mesmo estado lógico; clocks e observedAt diferentes não trocam a cabeça.
8. **Pendência causal:** B antes de A registra pendência durável; chegada de A a resolve atomicamente e mantém vínculo do histórico da pendência.
9. **Ramificações/ciclos:** B→A e C→A dão conflito; D→[B,C] resolve; ciclos permanecem sem vigente em todas as ordens de chegada.
10. **Invalidação:** remoção/retração/desatualização não apagam história nem ressuscitam predecessor; restauração exige nova revisão com prova.
11. **Proveniência:** revisões retornam fonte, localizador e tipo; inferência/observação não aparece como orientação do PI ou lição validada por conversão automática.
12. **Dependências:** revisão substituída/invalidada deixa derivados direta e transitivamente não vigentes; alvo desconhecido, ciclo ou limite de avaliação retorna unknown, nunca current presumido.
13. **Contrapontos:** relações contraditórias permanecem visíveis, mesmo com alvo ausente; o núcleo não funde fontes nem resolve pela similaridade.
14. **Atomicidade:** falhas injetadas após evento, revisão, relações e projeção revertem tudo; reabrir o banco não encontra estado meio aplicado.
15. **Reinício:** banco reaberto preserva identidades, variantes, pending/resolved e histórico; reentrega após commit com resposta perdida não duplica.
16. **Migração:** banco vazio e banco anterior com dados de auditoria/workflows/credenciais recebem evolução preservadora; falha de migration não avança user_version nem deixa tabela parcial.
17. **Diagnóstico:** incompatíveis possuem pendência limitada e reprocessável sem payload bruto; binding divergente é incompatível, deliveryRef/contexto inválido não confirma; falha de storage não mente sobre durabilidade.
18. **Leitura limitada:** páginas respeitam quantidade/bytes/contexto, cursor não cruza filtro/dono e não pula itens por atingir o limite; travessia não excede o limite sem declarar unknown.
19. **Independência:** provas executam sem Graphify, rede, provider, scheduler ou módulos futuros; nenhuma tabela, cursor, auditoria, ledger ou política do dono da fonte é alterada.
20. **Evidência:** registrar resultado real por critério/SPEC/issue conforme TESTING.md; falha conhecida não é omitida nem contagem inventada.

## Estratégia e comandos de verificação

Regras puras em Vitest `*.spec.ts`; banco real temporário em `*.int-spec.ts`. Casos gerados por permutações determinísticas e seeds fixos, sem biblioteca nova obrigatória. Comparar estado lógico, excluindo IDs internos, contagens de recepção e tempos que dependem da entrega. Incluir fixtures de duas contas/produtos, colisões, ramificações, predecessor ausente, falha por ponto da transação, limite de bytes e reabertura do mesmo arquivo.

Após futura implementação, executar no PowerShell:

```text
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run test:report:check
```

Esses comandos não foram executados nesta redação. UI/E2E não é exigência nova desta fatia sem tela; os testes de integração provam serviço + SQLite real. O relatório de produto permanece gerado por máquina, não editado para simular entrega.

## Limites da execução futura

- Sempre preservar registros dos donos, validar fronteiras, limitar trabalho e testar falhas/reentregas.
- Levar ao PI mudança material de escopo/regra/contrato aprovado; não pedir outro aceite da mesma revisão nem bloquear por ADR/documento auxiliar.
- Nunca tratar instruções no conteúdo recuperado como autoridade do sistema, registrar segredos como conhecimento ou iniciar coleta fora das fontes integradas.
- Aprovação desta SPEC resolve seu contrato de planejamento; não revoga a instrução vigente do PI de **não implementar agora**.

## Perguntas abertas ao PI

Nenhuma pergunta pendente nesta fatia. O PI aprovou em 2026-08-30 o contrato v1, o modelo de revisões, os limites técnicos e os vinte critérios da revisão `83e952fd4e5f22850653bf81cf1d45d6c4377c84`. As pendências de F02–F08 permanecem nas respectivas fatias. O aceite não inicia implementação nem autoriza push.
