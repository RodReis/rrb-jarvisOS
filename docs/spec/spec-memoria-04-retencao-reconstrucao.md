# SPEC-Memoria-04 — Retenção e reconstrução da memória

- MVP/Fatia: MVP-007 · M7-F04.
- Issue: [#183](https://github.com/RodReis/rrb-jarvisOS/issues/183); épico [#179](https://github.com/RodReis/rrb-jarvisOS/issues/179).
- Status: **rascunho** para revisão do PI; issue em `proplan:planejado`; implementação não autorizada.
- Depende de: M7-F02 (#181), revisão `e4a521c6ad2339b8a6368d183afb46b8c26b5b80`; preserva M7-F01, revisão `83e952fd4e5f22850653bf81cf1d45d6c4377c84`.
- Compatibilidade, não dependência: M7-F03 (#182), revisão `c3b546a1787961bb0b9bb407cd7213d5b7046b1b`.
- Design: `docs/superpowers/specs/2026-08-30-mvp-007-memoria-compartilhada-design.md`, seções 7, 8 e 11.
- Índice canônico: `docs/STATUS.md`.

## Objetivo e limite do aceite

Administrar a retenção local da memória sem confundir três operações: compactar detalhes, reconstruir derivados e excluir conteúdo por comando explícito. Preservar decisões, correções, lições, referências, cobertura e retomada. Uma reconstrução não é restauração de backup nem comprovação de que a fonte continua disponível.

A política de duração do design já foi aprovada: memória durável durante a vida do projeto, salvo exclusão explícita; detalhes repetitivos compactáveis após 30 dias; fontes originais continuam com seus donos. Os mecanismos, limites e vinte critérios abaixo são **propostas desta revisão**, ainda sem aceite. Não alterar os textos técnicos aprovados das F01–F03.

Alternativas consideradas:

- **Compactação sem perda + gerações reconstruíveis + exclusão escopada — recomendada:** mantém a prova original e permite retomar manutenção interrompida; exige contabilizar trabalho e impedir reingestão do que foi excluído.
- Expiração uniforme após 30 dias: contradiz a retenção de decisões/correções e elimina evidência necessária.
- Reescrever a memória como resumos por modelo: reduz texto, mas pode perder ressalvas, autoria e relações; não é compactação reversível.
- Apagar o índice ativo e reconstruir tudo numa transação: torna falhas e grandes acervos indisponibilidade prolongada; não oferece retomada por lote.

Sem UI, sincronização, backup, restauração de banco, instalação de Graphify, migração de serviço, chamada de modelo, novos gates jurídicos ou aprovação por lote. F07 continua responsável pela interface e seus artefatos visuais.

## Evidência e integração futura

Inspeção somente de leitura em 2026-08-30:

- Worktree documental em `2f39389`: F01–F03 aprovadas; F04 ainda inexistente.
- Checkout principal observado em `0799c8a`: `src/main/storage/database.ts` abre o SQLite existente com WAL e chaves estrangeiras; `src/main/storage/migrations.ts` usa migrações incrementais.
- A auditoria existente possui triggers de imutabilidade; não removê-los. ContextPack e decisões têm donos próprios; manutenção da memória não transfere essa propriedade.
- F02 já evita duplicar payload do núcleo em `memory_source_delivery`. Não presumir economia grande onde a redundância não existe.
- Consultado Context7 para SQLite; complementado com documentação oficial para limitações operacionais. Isso não comprova a versão/capacidades do binário instalado nem execução de manutenção.

Estrutura proposta:

| Área | Responsabilidade |
|---|---|
| `src/shared/domain/memory-maintenance.ts` | Comandos, alvos, estados, resultados e limites versionados. |
| `src/shared/contracts/memory-maintenance.ts` | Validação estrita e serialização determinística dos pedidos. |
| `src/main/memory/memory-maintenance-service.ts` | Planejamento interno, idempotência, agendamento e retomada. |
| `src/main/memory/memory-maintenance-worker.ts` | Preparação/compressão/validação limitada fora do event loop do main. |
| `src/main/memory/memory-maintenance-repository.ts` | Jobs, cursores, gerações, barreiras e publicação transacional. |
| `src/main/memory/memory-retention-admission.ts` | Política de leitura/ingestão diante de exclusão explícita. |
| Repositórios F01/F02 e registro de derivados | Participação transacional e adaptações internas, sem mudar seus envelopes públicos. |
| `src/main/storage/migrations.ts` | Migrações aditivas no próximo número livre, conferido na implementação. |

Serviço interno nesta fatia, sem novo IPC/endpoint. F04 deve funcionar com F01/F02 e adapter de teste; não importar implementação nem tipos exclusivos da F03/F05 como pré-requisito. Integrações opcionais são registradas quando disponíveis. Conferir a base real antes de implementar, sem copiar código antigo do worktree documental.

## Classes e propriedade dos dados

| Classe | Política proposta |
|---|---|
| Envelopes, revisões, decisões, correções, invalidações e lições aceitas | Duráveis; nenhum TTL automático. Preservar variantes em conflito, autoria, hashes, supersedes e prova causal. |
| Identidades, referências, aliases, lacunas e pendências abertas | Duráveis enquanto sustentam identidade, validade, cobertura ou retomada; não descartar por idade. |
| Detalhes repetitivos de projeções e diagnósticos encerrados | Elegíveis à compactação reversível após 30 dias; preservar representação lógica e vínculos. |
| Índices de busca, grafo, caches e gerações abandonadas | Derivados descartáveis somente com substituto válido ou fallback explícito; respeitar leitores e barreiras. |
| Notas/orientações canônicas (`knowledge_*`), decisões do produto e fontes Git | Continuam com seus donos; não entram na exclusão/compactação da projeção de memória. |
| ContextPack congelado, auditoria e conteúdo já entregue ao executor | Evidência histórica de outros donos; não reescrever nem apagar por esta fatia. |

Classificação é por schema/owner registrado, não por inferência do texto. Categoria desconhecida é preservada e contabilizada como não elegível, sem virar regra de produto. Não inventar retenção para uma fonte futura.

A vida do projeto não implica ler todo o acervo em cada tarefa. Redução de tokens depende da recuperação/orçamento da F03; esta fatia não promete percentual de economia.

## Contratos de comandos e resultados

Reutilizar `MemoryContext`, `MemoryProductId`, `MemoryScope`, `MemorySourceBinding` e `MemoryRecordKey` da F01. Contexto vem do chamador interno validado; filtros de produto/projeto não concedem acesso.

```ts
type MemoryMaintenanceTarget =
  | { readonly kind: 'records'; readonly keys: readonly MemoryRecordKey[] }
  | { readonly kind: 'source'; readonly binding: MemorySourceBinding }
  | {
      readonly kind: 'scope'
      readonly productId: MemoryProductId
      readonly scope: MemoryScope
    }

type MemoryMaintenanceCommand =
  | {
      readonly schemaVersion: 1
      readonly requestId: string
      readonly kind: 'compact'
      readonly target: MemoryMaintenanceTarget
    }
  | {
      readonly schemaVersion: 1
      readonly requestId: string
      readonly kind: 'rebuild'
      readonly target: Extract<MemoryMaintenanceTarget, { readonly kind: 'scope' }>
      readonly projectionIds: readonly string[]
    }
  | {
      readonly schemaVersion: 1
      readonly requestId: string
      readonly kind: 'forget'
      readonly target: MemoryMaintenanceTarget
    }

type MemoryMaintenancePhase =
  | 'queued' | 'running' | 'paused'
  | 'completed' | 'completed_with_gaps' | 'failed' | 'cancelled'

type MemoryMaintenancePauseReason =
  | 'capacity' | 'storage_busy' | 'storage_unavailable'
  | 'adapter_unavailable' | 'source_gap' | 'budget'
  | 'scope_changed' | 'manual'
```

- `submit(context, command)` devolve `accepted(jobId)`, `existing(jobId)`, `invalid_request`, `idempotency_conflict` ou `storage_unavailable`. Uma aceitação não declara trabalho concluído.
- `getJob(context, jobId)` e `listJobs(context, cursor, limit)` expõem metadados, contadores e resultados por projeção; não devolvem payloads, SQL, credenciais ou caminhos arbitrários.
- `pause/resume` verificam contexto e versão do job. `cancel` só cancela compactação/reconstrução; após barreira de exclusão, pausar não desfaz conteúdo já removido.
- `allowReingestion(context, requestId, forgetJobId)` é intenção explícita separada para voltar a capturar, somente após terminar a remoção física administrada pelo job. Não restaura dados; novas leituras seguem F02.
- IDs seguem validação da F01. Pedido com chaves: 1–100 chaves únicas, no mesmo produto/escopo; fonte/escopo são exatos, sem glob, SQL ou alvo implícito “todos os usuários”.
- `projectionIds`: 1–16 IDs do catálogo interno. ID desconhecido é pedido inválido; adapter conhecido mas indisponível produz resultado explícito, não sucesso.
- Rebuild v1 exige um alvo scope completo. Records/source valem para compact/forget; não ampliar silenciosamente um pedido parcial. Geração ativa é particionada por contexto/produto/escopo/projeção: trocar uma partição nunca descarta dados das demais.
- RequestId é único por contexto; guardar bytes canônicos do comando e hash. Repetição igual devolve o mesmo job; hash igual com bytes diferentes é conflito, não deduplicação.
- Paginação: 1–100 jobs, cursor opaco escopado e versionado; página de até 256 KiB. Contadores maiores que inteiro seguro são decimais serializados, nunca arredondados.
- A resolução do alvo e os limites ficam no job. O comando `forget` é a própria intenção explícita; não adicionar segunda confirmação nem autorização por lote. Chamador não pode converter sugestão automática em exclusão.

Resultado inclui `phase`, motivo de pausa/erro quando aplicável, `target`, versões, cursores, contagens de examinados/compactados/preservados/removidos, bytes lógicos antes/depois e resultados por projeção. Tamanho real do DB/WAL e espaço livre são métricas separadas, com `unknown` quando indisponíveis.

Para exclusão: distinguir `hidden`, `localRowsPurged`, `derivedPurged` e `residualOwners`. Originais, auditoria, packs congelados e metadados mínimos de supressão aparecem nos limites do resultado. Nenhum estado significa apagamento seguro do disco ou recolhimento do que já foi enviado.

## Compactação reversível após 30 dias

Elegibilidade usa `lastMaterialChangeAt` local da projeção/diagnóstico encerrado, não `occurredAt` informado pela fonte nem data do commit Git. Reentrega idêntica só atualiza contadores; alteração material reinicia a idade. Relógio regressivo/futuro/inconclusivo adia o lote e registra diagnóstico; não antecipa exclusão.

Whitelist inicial:

1. Campos de detalhe/normalização repetitivos de entregas F02 **já confirmadas e encerradas**, quando armazenados separadamente do payload F01.
2. Detalhes repetitivos de tentativas encerradas do próprio serviço de manutenção, mantendo resultado final e contadores.
3. Blocos repetidos exatos desses campos podem compartilhar armazenamento dentro do mesmo contexto/produto/escopo, com igualdade de bytes verificada.

Ficam fora: envelopes/revisões F01, texto canônico `knowledge_*`, checkpoints/cursores, manifesto/aliases que sustentam retomada, pending/conflict, cortes em processamento, prova de origem, referências e contadores necessários. Detalhe ainda requerido por normalização pendente ou leitor ativo é protegido. Não usar resumo gerado nem agregação que altere a reconstrução lógica.

Proposta de representação: stub por entrega/diagnóstico conserva identidade, posição, resultado, referências e `detailRef`; `memory_compacted_detail` guarda bloco comprimido, codec/version, comprimento original, checksum e contador de referências. Leitura interna F02 resolve inline ou bloco de forma transparente; não muda contrato lógico nem copia o payload do núcleo.

Usar codec local `deflate-raw-v1` pela biblioteca padrão, sem dependência de modelo. Cada bloco contém até 50 itens/1 MiB descomprimido, com offsets/comprimentos validados; leitor descomprime com teto de 1 MiB e rejeita inconsistência. Hash sozinho não autoriza deduplicação. Compressão fora da transação; reler versão, referências/proteções e elegibilidade no commit.

Antes de trocar inline por stub: descomprimir, comparar bytes e relações; na mesma transação persistir bloco/stubs e avançar cursor. Falha mantém o original. Se bloco + stubs não forem menores, manter inline e contar `no_gain`; acervo sem repetição pode ter economia zero. Não aumentar memória de uma chamada carregando todos os blocos.

Recompactação é idempotente. Exclusão posterior de um item compartilhado exige recompor o bloco sem os bytes excluídos para os demais itens, verificá-lo e remover a cópia antiga; deixar texto excluído dentro de bloco compartilhado não conta como purga concluída. Corrupção gera lacuna localizada; não substituir conteúdo por vazio nem descartar prova sem cópia íntegra.

## Jobs, persistência e retomada

Tabelas propostas, sempre com contexto e chaves completas:

| Tabela | Conteúdo mínimo |
|---|---|
| `memory_maintenance_job` | Request canônico, estado/versão, alvo, orçamento, prioridade, cursores e resultado. |
| `memory_maintenance_item` | Manifesto paginado do trabalho, referência estável, versão examinada, resultado e proteção. |
| `memory_maintenance_generation` | Projeção/versão, estado active/building/retired e fronteira aplicada. |
| `memory_maintenance_change` | Sequência local não reciclável, chave afetada, tipo e epoch; sem cópia de texto. |
| `memory_compacted_detail` | Blocos reversíveis e referências descritos acima. |
| `memory_forget_barrier` | Alvo exato, job, epoch, ativa/revogada e metadados mínimos; sem conteúdo excluído. |

Não congelar número de migration nesta SPEC. Identidade de job/item/change deve ser explícita e estável; não depender de ROWID implícito. Sequência do journal é própria, não cursor F02, versão da origem ou geração F01.

Um coordenador de manutenção do aplicativo, com um job ativo por contexto. Sem lock distribuído. Lotes intercalam com trabalho do usuário/ingestão; preparação em worker, confirmação curta no writer existente. Forget preempta rebuild/compact entre lotes, sem esperar terminar a varredura inteira. Não manter transação de escrita ou leitura SQLite aberta entre lotes, chamada de fonte, compressão ou await.

Registrar item + resultado + checkpoint do job atomicamente. Crash antes do commit repete o lote; depois do commit relê progresso sem reaplicar operação. Ao reiniciar, invalidar leases em processo morto e retomar só trabalhos cujo contexto/versão ainda sejam válidos. Logout/mudança de escopo cancela processamento em memória; não empresta job ao usuário seguinte.

Fila e journal não são duplicação integral do histórico. Consolidar chaves repetidas apenas quando consumidores já confirmaram a fronteira e a prova de retomada permanece; nunca aparar eventos ainda necessários a um rebuild ativo. Excesso de capacidade pausa a reconstrução e libera sua inscrição antes de descartar seu shadow; não compromete ingestão para sustentar o job.

## Reconstrução, concorrência e publicação

Reconstruir projeções registradas a partir do núcleo ainda retido; atualizar conteúdo da fonte é trabalho de F02. Esta operação não faz nova captura Git, não altera seleção/cursor, não grava notas e não reexecuta ações do produto.

Fluxo proposto:

1. Em transação curta, registrar job, geração shadow e fronteira `H` do journal. A partir daí, alterações canônicas relevantes alimentam esse journal na mesma transação F01/F02 que as confirma. Sem chamada de fonte/modelo dentro dela.
2. Enumerar chaves canônicas com cursor estável e manifesto paginado. Construir o shadow fora da visão ativa. Leitura por lote é consistente; **não fingir snapshot histórico único** entre conexões/transações.
3. Para cada chave, recalcular segundo F01: preservar variantes, supersedes, invalidation, pending/conflict e support. Um limite de validade continua retornando unknown, nunca current por conveniência.
4. Reprocessar idempotentemente chaves alteradas após `H` até alcançar a fronteira atual. Inserção atrás do cursor e remoção entram no journal. Ler novamente o estado canônico, não aplicar texto do evento como verdade nova.
5. Validar contagens contabilizadas, identidade/contexto, referências, versões, integridade da projeção e lacunas. Preparar publicação fora da transação.
6. Publicar por compare-and-set curto: fronteira consumida igual à atual, epoch de exclusão compatível, versão de schema/adapter válida e validação correspondente à geração. Mudança entre preparo e commit volta a catch-up; não suspender ingestão indefinidamente para conseguir publicar.
7. Trocar o ponteiro ativo atomicamente. Consultas novas usam a geração publicada; antiga fica retired até acabar seu uso, salvo exclusão explícita. Limpeza posterior é limitada e retomável.

O shadow contém a partição inteira solicitada, não apenas linhas alteradas. Índice físico compartilhado pode armazenar várias partições, mas a troca precisa preservar integralmente as outras; adapter sem publicação particionada recebe unsupported. Teste mantém uma segunda partição populada durante todo o rebuild.

Captura do journal passa a ser responsabilidade transacional interna comum dos escritores registrados, inclusive mudança de pendência/validade ou exclusão. Instalar esse mecanismo antes de iniciar o primeiro job; mutações do núcleo não podem atravessar um caminho sem captura enquanto houver consumidor ativo. Caso contrário, recusar publicação por cobertura insuficiente.

Para `memory_record`, separar identidade estável de estado projetado: não eliminar/recriar a linha que sustenta FKs. Gerar estado auxiliar por generation/key e resolver pela geração ativa, ou copiar estado validado por mecanismo equivalente com publicação atômica. Não aceitar uma “troca” que sobrescreva parte do estado ativo em vários commits. Incrementar a geração de validade F01 na publicação; seus leitores continuam com os mesmos resultados e limites.

Alteração depois da publicação é processada pelo fluxo incremental registrado; o journal não substitui o dirty queue da F03. Integração da F03 coordena checkpoint de bootstrap/dirty queue e geração ativa, sem duplicar evento ou declarar índice atualizado prematuramente. Dados de índice nunca dispensam a validação canônica.

Se a versão válida anterior ainda existe, ela permanece consultável com validade/cobertura atuais até a troca. Se não existe ou está corrompida, declarar indisponibilidade da projeção e usar consultas básicas limitadas dos serviços disponíveis. Não prometer busca FTS equivalente sem índice.

Lacuna preservada pode produzir `completed_with_gaps`, com referências/motivo e cobertura incompleta. Erro de integridade da projeção impede publicação. Fonte perdida não é recuperada a partir de hash, resumo ou grafo; a manutenção não elimina gaps F02 nem anuncia disponibilidade da origem sem uma leitura legítima.

## Exclusão explícita e não ressurreição

`forget` remove a memória consultável pertencente ao alvo, incluindo todas as suas revisões/variantes. Não aceitar exclusão de “uma revisão por hash” nesta versão. O alvo source/scope abrange registros presentes e suprime novas entradas desse mesmo alvo até intenção explícita de reingestão; alvo records suprime somente as chaves exatas. Isso fica visível no resultado.

1. Validar/alcançar o alvo dentro do contexto e persistir job + barreira durável antes de qualquer remoção. Na mesma transação incrementar epoch de exclusão e geração F01, invalidando resultados preparados.
2. Com barreira ativa, leituras públicas do serviço não retornam payload nem revisões dessas chaves, inclusive em histórico. `getRecord` devolve not_found; diagnóstico de manutenção, não o envelope F01, explica a supressão ao chamador autorizado.
3. Cancelar preparações/leases afetados. Antes de devolver consulta ou montar **novo** envio, checar epoch no ponto de entrega; se mudou, revalidar ou omitir o trecho. Nada recolhe texto já entregue ao usuário/executor.
4. Enumerar e purgar em lotes: índices/caches e blocos com conteúdo, metadados de projeção contendo texto, eventos/revisões/payloads pertencentes ao alvo. Preservar apenas identidade mínima, tombstones, referências necessárias e resultado sem cópia do conteúdo.
5. Relações emitidas pelo alvo são removidas. Relações/revisões duráveis de registros fora do alvo não são apagadas em cascata: referências ao excluído ficam sem suporte atual, com diagnóstico. Não fabricar predecessor, promover versão antiga nem reativar inferência apoiada nele.
6. Confirmar purga por store/adapter e contabilizar resíduos. Só declarar `localRowsPurged` após verificar ausência de conteúdo no núcleo, inline e blocos; `derivedPurged` exige verificação dos derivados registrados que guardavam esse conteúdo.
7. Barreiras permanecem após conclusão. Crash/falha/pausa nunca reabre leitura ou captura. Falha parcial expõe progresso e retoma o mesmo job.

A checagem final de epoch e a entrega/enfileiramento ocorrem no mesmo trecho serializado, sem await intermediário; trabalho assíncrono preparado antes volta a validar. Dados enviados antes desse ponto não podem ser recolhidos. Store administrado pelo job com resíduo mantém a purga paused/failed, não completed_with_gaps; esse último estado vale para reconstrução com lacuna de fonte, não como atalho para exclusão incompleta. Resíduos de donos explicitamente fora do alvo são informados sem fingir autorização para apagá-los.

Remoção não emite falso `record.invalidate` afirmando que o original foi removido. Linhas mínimas de identidade podem permanecer para FKs e prova de exclusão; envelopes/textos não. Auditoria existente e suas triggers permanecem intactas.

### Admissão de ingestão

Proposta aditiva F04: uma fachada comum consulta barreiras **na mesma transação** de admissão/confirmação F02. Havendo supressão, não chama `F01.apply` nem grava o conteúdo; registra exclusão intencional com alvo/job/posição confiável e confirma apenas esse prefixo. É resultado da fachada, não novo membro inventado na união fechada de `F01.apply`.

A exclusão intencional é cobertura filtrada, não applied, duplicate, erro de normalização ou fonte completa sem ressalva. Expor contagem/referência da regra ativa. Para alvo de registro sem identidade normalizada confiável, manter o tratamento F02 de pendência/posição inválida; não atribuir chave pelo texto para avançar. Para fonte/escopo, binding confiável permite classificar a exclusão antes de ler payload.

Todos os escritores do módulo, inclusive integrações futuras, entram por essa fachada. Testar atomicidade contra exclusão concorrente; rechecagem somente antes de abrir a transação não basta. F02 continua responsável por cursores e releituras; não alterá-los durante purga para esconder pendências.

`allowReingestion` revoga somente a barreira referida, por CAS e com novo epoch; barreiras sobrepostas permanecem. Depois disso F02 realiza nova reconciliação/carga delimitada com nova geração de captura, sem reciclar posições do feed canônico nem apagar lacunas históricas. Pode reencontrar conteúdo antigo ainda existente na fonte: não é memória recuperada nem novo fato/autoria. Sem fonte, registrar gap. Serviço não dispara reingestão porque “percebeu que falta memória”.

## Derivados opcionais e contexto congelado

Registro interno de manutenção informa `projectionId`, versão, owner, capacidades de rebuild/purge, referências armazenadas, disponibilidade e checkpoints. Persistir catálogo de stores que já receberam dados: desinstalar/desabilitar um adapter não pode fazer seus resíduos desaparecerem do relatório.

Contrato mínimo do adapter: enumerar/preparar lote, validar geração, publicar via mecanismo atômico suportado, purgar alvo idempotentemente e verificar ausência de conteúdo. Sem callbacks externos dentro da transação SQLite. Erro/unsupported aparece por store; adapter ausente sem dados prévios é not_applicable, não pré-requisito.

- FTS5 da F03, quando presente: sincronizar external-content e índice durante purga. Remover tokens enquanto o conteúdo anterior ainda está disponível; não apagar apenas a tabela de conteúdo e deixar termos órfãos. Verificar integridade. [Documentação FTS5](https://sqlite.org/fts5.html#external_content_tables).
- Shadow do FTS deve ser populado por lotes, com vínculo de conteúdo estável e coerente. Não usar um comando monolítico de rebuild como se tivesse checkpoint por item.
- Graphify F05: este contrato não escolhe pacote/versão/backend nem inventa capacidade de apagar seus stores. Se não houver verificação de purge, manter barreira de leitura e resultado incompleto/residual; concluir contrato na F05 antes de anunciar remoção daquele store.
- Sessões/caches da F03 invalidam por epoch/versão; suporte básico da F04 não depende da existência dessas sessões. Adapter atrasado não pode publicar shadow que reintroduza conteúdo excluído.
- ContextPack já congelado conserva bytes/hashes. Antes de **novo envio**, a integração F03 verifica a barreira e compõe outro pack/omite o bloco opcional quando necessário. Não “corrigir” retrospectivamente o pack antigo.
- Originais e evidências históricas de outros donos continuam acessíveis pelos respectivos contratos. “Excluir da memória” não significa “apagar todas as cópias do produto”.

## Capacidade, agenda e falhas

Defaults técnicos propostos, versionados no serviço; não novas regras de negócio:

| Parâmetro | Valor/comportamento inicial |
|---|---|
| Agenda de compactação | Primeira verificação após inicialização e depois a cada 24 h, enquanto app/contexto ativos; elegibilidade continua 30 dias. Sem daemon após fechar o app. |
| Concorrência | Um worker de manutenção; jobs alternados por contexto. Prioridade: forget, rebuild, compact. |
| Lote | Até 50 itens e 1 MiB de material; um item acima do teto vira diagnóstico, não truncamento. |
| Turno | Até 200 itens ou 5 s entre operações, o que chegar antes; checkpoint e devolução de controle. Não é promessa de limite de tempo para toda operação SQLite. |
| Espaço de shadow por job | Teto inicial de 256 MiB; estimar/reservar antes e conferir em cada lote. Se insuficiente, pausar, não publicar parcial silenciosamente. |
| Reserva de disco para construir shadow | Livre conhecido de pelo menos max(512 MiB, 2 × estimativa do shadow); desconhecido pausa build com motivo explícito. Estimativa declarada, não medição exata. |
| Derivados descartáveis | Meta de 256 MiB por contexto; limpar retired sem leitores e caches descartáveis primeiro. Índice ativo só descartado com fallback declarado; nunca fatos duráveis para cumprir meta. |
| Retentativa transitória | 5 s, 30 s e 120 s; depois paused. Retomar por mudança verificável ou comando; sem loop ocupado. |
| Falha permanente | Schema/codec incompatível, corrupção ou identidade inválida não são repetidos sem mudança; preservar prova e progresso. |

O orçamento de shadow é local ao job, enquanto concorrência e reserva impedem duas estimativas gastarem o mesmo espaço. Conteúdo de journal/manifesto/gerações integra a estimativa; aumento real além da reserva pausa e permite descartar shadow depois de cancelar sua inscrição. Compactação/purga precisam de pequena margem transacional: tentar lotes limitados, tratar disk-full como storage_unavailable e manter barreira; nunca garantir exclusão se nem o commit cabe.

Não há descarte automático de memória durável por quota. Medir separadamente bytes lógicos canônicos, compactados e derivados; tamanho físico do `jarvis.db`/WAL inclui outros domínios, não atribuir tudo a este MVP. `unknown` não vira zero. Orçamento/pausa da manutenção não desabilita fontes ou pipeline; falha real do banco mantém o contrato storage_unavailable e o checkpoint F02 anterior.

Exclusão SQL normalmente libera páginas para reutilização, sem reduzir automaticamente o arquivo. VACUUM atua sobre o banco inteiro e requer espaço adicional. Esta fatia **não executa VACUUM automático**, troca de arquivo, secure-delete global ou alteração da política de auto-vacuum do SQLite compartilhado. [Documentação VACUUM](https://sqlite.org/lang_vacuum.html).

Leitores podem atrasar checkpoints WAL; não manter snapshots longos de manutenção e nunca apagar manualmente arquivos WAL/SHM. Não prometer sanitização de SSD, backups ou bytes já enviados. [Documentação WAL](https://sqlite.org/wal.html).

Falha no grafo/índice não encerra aplicativo ou pipeline. Se o banco compartilhado inteiro falhar, não declarar que memória básica continua funcionando nesse mesmo banco: comunicar indisponibilidade e manter caminhos independentes já existentes.

## Critérios de aceite propostos

1. **Fronteira:** F04 funciona com F01/F02 sem F03/Graphify; nenhuma chamada de modelo, captura nova, escrita em fonte, IPC/UI ou mudança de fila é necessária.
2. **Retenção:** relógio controlado prova que 29 dias não compactam; após 30 dias só campos elegíveis mudam representação, preservando decisões, correções, lições, referências e pendências.
3. **Compactação íntegra:** round-trip verifica bytes, posições, hashes e contagens; colisão não deduplica diferentes, no_gain não aumenta dados, limite de descompressão/corrupção não retorna texto falso.
4. **Compactação atômica:** falha antes/depois do commit mantém inline ou bloco íntegro e cursor coerente; reexecução não duplica fatos nem muda checkpoint F02.
5. **Comandos:** validação rejeita alvo ambíguo/outro contexto, limites excedidos e adapter desconhecido; request igual é idempotente, bytes diferentes com mesmo ID são conflito.
6. **Retomada:** jobs persistem cursor/versão e retomam após crash sem usar lease antigo; logout descarta resposta atrasada e não cruza usuários.
7. **Reconstrução básica:** shadow preserva identidades/FKs, variantes, correções, invalidações e limites F01; não troca eventos, notas, autores ou cursores F02.
8. **Concorrência:** inserção atrás do cursor, revisão/invalidation e mudança de pendência durante build entram no journal; CAS não publica fronteira ultrapassada nem geração parcialmente copiada, e outra partição permanece íntegra.
9. **Falha de rebuild:** crash antes/depois da troca mantém uma geração ativa coerente; readers usam geração válida ou indisponibilidade explícita, nunca shadow parcial.
10. **Lacunas:** fonte ausente/corrupção/prova incompleta permanecem visíveis; completed_with_gaps não vira cobertura completa e hash/resumo não restaura original.
11. **Barreira imediata:** forget persiste epoch antes da purga; consultas em andamento/history/novo envio revalidam e não devolvem o alvo após o ponto de entrega protegido.
12. **Supressão:** reentrega F02 não repovoa o alvo; posição confiável confirma exclusão intencional atomicamente, identidade desconhecida não autoriza avanço nem altera F01.apply.
13. **Exclusão física local:** remove conteúdo canônico/inline/derivado e recompõe blocos compartilhados; preserva outros registros, metadados mínimos e referências externas sem suporte atual.
14. **Exclusão interrompida:** crash/disk-full/adapter indisponível mantém barreira e progresso; resultado distingue localRowsPurged, derivedPurged e resíduos, sem sucesso total fictício.
15. **Reingestão explícita:** somente allowReingestion após purga administrada revoga a barreira indicada; regras sobrepostas continuam, nova captura preserva lacunas e não inventa fonte.
16. **Donos preservados:** snapshots de notas canônicas, decisões, auditoria/triggers e ContextPacks permanecem iguais; pack novo exclui trecho esquecido, pack antigo mantém bytes/hashes.
17. **Adapters:** store conhecido ausente/unsupported com dados prévios permanece residual; fake adapter prova retentativa/purga/cutover; quando FTS existe, prova integridade e ausência de tokens órfãos.
18. **Capacidade:** baixo espaço, tamanho desconhecido ou teto de shadow pausam só trabalho afetado; limpeza não remove duráveis e nenhum VACUUM/troca de DB/delete de WAL é executado.
19. **Agenda e custo:** lotes/turnos/retentativas obedecem limites, cedem execução à atividade normal e param ao fechar contexto; nenhuma promessa de economia é inferida de bytes comprimidos.
20. **Relatório:** evidência por job/critério distingue validação documental, testes reais, bytes lógicos/físicos, cobertura e resíduos; nenhum teste passa apenas por exit code ou contagem de linhas.

## Estratégia de prova e revisão

Implementação futura: unitários com relógio/falhas controlados e testes de integração em SQLite **temporário**, nunca no banco real do usuário. Fixtures com cadeias de revisão/invalidation, conflito, pending, reentrega, bloco compartilhado, referência cruzada, fonte desaparecida e mudanças durante cutover. Testar crash antes/depois de cada fronteira transacional e igualdade dos registros dos donos.

F04 prova protocolo de derivados com adapter fake; FTS real, se F03 já integrada, acrescenta prova de external-content/purga. Caso F03 ainda não exista, registrar cenário de integração como pendente da composição, sem criar dependência técnica retroativa. A F05 e a F08 provam os stores Graphify reais e o conjunto; ausência de biblioteca não é sucesso de uma limpeza nela.

Na revisão, seguir `docs/REVIEW.md`: delta desta SPEC e interfaces diretamente afetadas, preservando relatórios anteriores. Pontos críticos identificados e tratados nesta redação: confundir 30 dias com TTL; confundir rebuild com backup; reingestão após exclusão; exclusão parcial em bloco compartilhado; sombra publicada após mudança; prometer eliminação de cópias em packs/outros donos; fazer F04 depender de F03.

Esta entrega é documental. Não houve execução de manutenção, exclusão de dados, implementação, teste de produto, instalação, push ou deploy. Testes e medições acima são critérios futuros, não evidência de funcionamento já obtida.

## Pergunta de revisão

Aprovar a revisão escrita desta SPEC, incluindo os vinte critérios e os limites propostos, para mover **somente M7-F04 (#183)** de Planejado para Backlog? A aprovação não inicia implementação, não altera o next e não reabre as revisões aprovadas de F01–F03.
