# SPEC-Memoria-02 — Fontes iniciais, ingestão e retomada

- MVP/Fatia: MVP-007 · M7-F02.
- Issue: [#181](https://github.com/RodReis/rrb-jarvisOS/issues/181); épico [#179](https://github.com/RodReis/rrb-jarvisOS/issues/179).
- Status: **aprovada-pi** (2026-08-30); issue em `proplan:backlog`; permanece a orientação de não implementar agora.
- Revisão aprovada: `e4a521c6ad2339b8a6368d183afb46b8c26b5b80`, aceite explícito do PI nesta conversa. Atualização abaixo registra somente o aceite, sem alterar o contrato.
- Depende de: M7-F01 ([#180](https://github.com/RodReis/rrb-jarvisOS/issues/180)), revisão aprovada `83e952fd4e5f22850653bf81cf1d45d6c4377c84`.
- Design: `docs/superpowers/specs/2026-08-30-mvp-007-memoria-compartilhada-design.md`, seções 6, 10, 11 e 14.
- Índice canônico: `docs/STATUS.md`.

## Objetivo

Alimentar o núcleo aprovado com documentos/código selecionados de projetos registrados, decisões do produto e notas/orientações explícitas. Cada fonte tem progresso durável próprio, cobertura identificada e falhas independentes. Reiniciar não perde confirmação nem exige importar novamente todo o material já confirmado.

O produto mostra o que foi efetivamente coberto, até qual referência e com quais lacunas. “Cursor avançou” não significa “tudo aplicado”; “fonte consultada” não significa “todos os eventos da origem capturados”.

## Base e aceite desta revisão

O PI aprovou fontes progressivas, carga inicial com referência de corte, retomada por fonte, pendência durável antes de continuar e consumo limitado. F01 já define envelopes, identidade, revisões, validade e aplicação transacional; esta fatia **não altera** esse contrato.

Em 2026-08-30, o PI aprovou a revisão escrita `e4a521c6ad2339b8a6368d183afb46b8c26b5b80`: primeiros adapters, serviço interno mínimo de notas, recorte do histórico, cursores, cobertura, limites, scheduler, provas e vinte critérios. As expressões “proposta” e “recomendada” preservadas no corpo registram a redação submetida; seu conteúdo está abrangido por esse aceite.

Alternativas:

- **Adapters com capacidades declaradas — recomendada:** Git oferece cortes por commit; notas próprias oferecem feed durável; decisões existentes usam reconciliação paginada. Permite começar sem fingir que todas as fontes têm o mesmo histórico.
- Exigir outbox nova em cada módulo: daria feed uniforme, mas mudaria produtores e criaria dependências desnecessárias.
- Apenas observar filesystem: simples para alterações visíveis, mas não comprova todas as revisões, remoções ou continuidade durante desligamento.

O início do histórico **Git** é o snapshot do commit selecionado na inscrição, seguido da linha de primeiros pais da referência acompanhada. Não importar automaticamente toda a ancestralidade nem todos os branches. Decisões existentes são reconciliadas enquanto retidas pelo dono; notas do serviço desta fatia têm histórico próprio desde sua criação.

## Evidência do repositório e estrutura

Inspeção em 2026-08-30:

- Worktree documental em `9e897f9`: F01 aprovada; serviços do MVP-007 ainda não implementados.
- Checkout principal observado em `0799c8a`: `src/shared/domain/projects.ts`, `src/main/projects/project-repository.ts`, `decision-repository.ts` e `git-runner.ts` já existem. A inspeção não altera esse checkout.
- `Project.id` é a identidade do projeto; nome/slug/diretório não substituem o ID.
- Decisões possuem ID imutável, autor e `substituiu`; não há feed paginado durável no método `listar` inspecionado.
- Não foi encontrado serviço canônico de Notebook nas áreas inspecionadas; não pressupor API de notas inexistente.
- GitRunner usa o terminal controlado. Seu resultado atual é texto redigido/limitado: não pode ser presumido como transporte fiel de blobs ou nomes de arquivos.

Stack preservada: Electron main, Node.js >=22, TypeScript e SQLite/better-sqlite3 existentes. Sem novo serviço externo, dependência de Graphify, modelo ou biblioteca Git obrigatória.

| Área proposta | Responsabilidade |
|---|---|
| `src/shared/domain/memory-ingestion.ts` | Inscrição, capacidades, cursores, cobertura e resultados. |
| `src/shared/contracts/memory-ingestion.ts` | Schemas e limites de entrada/saída. |
| `src/main/memory/sources/` | Adapters Git, decisões e conhecimento explícito. |
| `src/main/memory/memory-ingestion-service.ts` | Ciclos, confirmação, reprocessamento e consulta de cobertura. |
| `src/main/memory/memory-source-repository.ts` | Inscrições, cortes, checkpoints, manifesto e pendências de transporte. |
| `src/main/knowledge/` | Fonte canônica mínima de notas/orientações, separada das projeções da memória. |
| `src/main/projects/` e terminal controlado | Extensões de leitura paginada/captura estruturada, preservando contratos públicos existentes. |
| `src/main/storage/migrations.ts` | Migrações aditivas, no próximo número disponível da base de implementação. |

Tipos `readonly`, uniões discriminadas, validação de `unknown`, nomes explícitos e SQL com parâmetros. Seguir estilo existente; renderer não acessa banco/Node. Esta lista define responsabilidades, não impõe criar módulos artificiais sem necessidade.

## Escopo

### Dentro

- Inscrever fontes vinculadas a projetos já registrados ou ao escopo de produto da F01.
- Git local somente leitura: documentos/código selecionados, referência do commit e artefatos referenciados.
- Leitura das decisões existentes, preservando autoria, substituições e histórico disponível.
- Serviço interno de notas/orientações e seu adapter, sem tela; futuro Notebook usa a mesma fonte.
- Carga inicial, atualização, confirmação transacional com F01, retomada, pendências e cobertura.
- Ciclo automático enquanto o app estiver ativo; sem um pedido manual por evento.

### Fora

- Criar/importar projetos novamente, duplicar ProjectRepository ou modificar produtores de execução/decisões.
- Alterações não commitadas do checkout, todas as branches, todo o histórico Git anterior à inscrição, coleta de cliques/stdout ou varredura do computador.
- Históricos externos de Claude/Codex, Obsidian/vaults, serviços remotos e todos os módulos futuros.
- Busca/ranking/contexto F03; retenção/compactação/rebuild integral F04; Graphify F05; validação das lições F06; UI/Notebook visual F07; prova integrada F08.
- Sincronização, deploy, execução de ações de negócio, alterações de políticas ou critérios de sucesso.

Projetos/decisões usam seus donos quando disponíveis. A fonte de notas em escopo de produto funciona sem projeto e sem construir outros menus. Não adicionar bloqueios do MVP-007 à pipeline nem exigir MVP-008 inteiro para que essa fonte opere. Se um adapter não estiver disponível, sua cobertura informa isso; não substituir o dono por tabelas duplicadas.

## Inscrição e seleção

A inscrição reutiliza `MemoryContext` e `MemorySourceBinding` da F01. Seu `sourceId` é UUID persistido por instância de fonte; não derivar do nome de menu ou do caminho.

```ts
type MemorySourceKind = 'project_git' | 'project_decisions' | 'explicit_knowledge'

interface SourceSelection {
  readonly paths: readonly string[]
  readonly gitRef: string | null
}

interface MemorySourceRegistration {
  readonly registrationId: string
  readonly binding: MemorySourceBinding
  readonly kind: MemorySourceKind
  readonly selection: SourceSelection
  readonly selectionVersion: number
  readonly enabled: boolean
}
```

Tipos da F01 são importados, não redefinidos. `selectionVersion` é inteiro positivo do catálogo local; não é identidade/revisão de conteúdo.

- Git exige escopo de projeto, referência local explícita e lista de caminhos relativos de arquivos/diretórios. Na primeira inscrição, propor a branch local atual; resolvê-la para nome completo e não seguir troca posterior de HEAD silenciosamente. Detached HEAD permanece snapshot fixo.
- Decisões exigem projeto; notas aceitam projeto ou produto. Nestes dois casos, `paths=[]` e `gitRef=null`.
- Seleção inicial sugerida para Git: arquivos canônicos de documentação que existam, como ARCHITECTURE/DECISIONS/CONVENTION/STATUS/LANDSCAPE/TESTING/REVIEW e PRD. Diretórios de SPECs, código e protótipos entram quando incluídos na seleção do projeto; não adotar raiz inteira como default.
- Caminhos literais, não expressões de shell; normalizar separadores e rejeitar absoluto, travessia `..`, ambiguidade de encoding, controles e escape da raiz permitida. Não seguir symlink/submodule para outra árvore.
- Excluir .git interno, dependências/build/cache e fontes de credenciais da leitura de conteúdo. Exceção de seleção não amplia permissões vigentes.
- Registro de projeto, autorização e existência da fonte são verificados no uso; não copiar ACLs como permissões eternas da memória.
- Reinscrição idempotente da mesma instância reutiliza IDs. Mudança da seleção abre nova versão de corte e reavalia apenas o escopo afetado; não apaga histórico nem renumera registros existentes.
- Desabilitar inscrição cancela trabalho pendente, não exclui dados. Cobertura fica inactive e não pode sustentar alegação de atualização. Reabilitar retoma a posição quando válida; caso contrário, reconcilia com lacuna explícita.

Fonte removida do cadastro ou acesso revogado não significa arquivo deletado: marcar unavailable/inactive, impedir nova leitura e não inferir remoção em massa do conteúdo original.

## Adapters iniciais e proveniência

| Fonte | Registro/revisão normalizados | Cobertura oferecida |
|---|---|---|
| Git do projeto | ID persistido do artefato no manifesto; revisão por transição de commit e versão do normalizador. Commit como artefato próprio por OID. | Snapshot inicial + evolução da referência local pela linha de primeiros pais após o corte, enquanto objetos estiverem disponíveis. |
| Decisões do projeto | ID da raiz comprovada da cadeia `substituiu`; revisão = ID da decisão + versão do normalizador. | Reconciliação paginada de decisões retidas, sem alegar feed transacional completo do produtor. |
| Notas/orientações | ID canônico da entrada; revisão canônica imutável + versão do normalizador. | Feed durável desde a criação no serviço desta fatia, por sequência local. |

O normalizador v1 tem versão explícita. `eventId` é hash determinístico da tupla fonte, registro, revisão e operação; não inclui tempo de leitura, posição do cursor ou tentativa. `sourceRevision` distingue transições mesmo quando conteúdo volta a ser igual. Para Git, uma transição inclui geração de acompanhamento, OID do commit e versão do normalizador; sua identificação é persistida antes de produzir eventos e reaproveitada no reinício. Rewind/reconciliação não reutilizam a revisão de uma geração anterior com novos predecessores. Os resultados permanecem nos limites da F01 e usam seus hashes, erros e regra de deduplicação.

`sourceRef` do envelope identifica a chave/revisão normalizada exigida pela F01; seu locator aponta ao objeto canônico exato (commit/blob, ID de decisão ou revisão da nota). A referência nativa e o comprovante de normalização ficam ligados no manifesto. Não colocar o ID de uma decisão filha no campo recordId se a chave normalizada usa o ID da raiz.

### Git: corte, identidade e leitura

1. Fixar OID completo do commit e tree antes de começar; validar formato de objeto suportado pelo Git local, sem presumir sempre SHA-1. Importar somente seleção nesse corte.
2. Persistir manifesto paginado de caminhos, modos, OIDs e IDs lógicos. Atribuição de ID acontece uma vez e é retomável; página repetida não sorteia novo ID. Arquivos iguais em caminhos distintos continuam registros distintos.
3. Mesmo caminho em commits consecutivos da linha acompanhada conserva o ID enquanto não houver remoção. Isso é continuidade do item observado no manifesto, não identidade calculada pelo path. Remoção confirmada fecha essa ocorrência; recriação posterior recebe novo ID.
4. Renomeação não se prova por semelhança ou blob igual. Com relação explícita de continuidade fornecida pelo dono, manter ID e atualizar locator; sem essa prova, registrar saída/entrada distintas, sem fundir. Não é necessário criar UI de associação nesta fatia.
5. Cada mudança de conteúdo, locator ou modo aceita produz revisão nova que substitui a anterior observada, com referência do commit como prova. Eventos originais usam horário do commit; ausência de data válida usa null, conforme F01.
6. Com novos commits, materializar de forma retomável a cadeia de primeiros pais entre corte confirmado e novo OID fixo, depois aplicar da mais antiga para a mais nova. Não saltar commits para caber numa página. Commit merge é observado pelo seu estado final em relação ao primeiro pai; históricos internos de branches mescladas ficam explicitamente fora.
7. Não existe predecessor “perdido” anterior ao baseline: a primeira revisão importada é raiz declarada do histórico coberto. Depois do baseline, lacuna não vira raiz nova silenciosa.
8. Ancestor indisponível, clone raso que perdeu continuidade, reescrita, rewind ou referência trocada geram history_gap. Não interpretar falha de comando como “não é ancestral”. Suspender a afirmação de continuidade e reconciliar um novo snapshot, preservando o intervalo perdido.
9. Reconciliação após quebra abre nova geração de acompanhamento, conserva registros/aliases cuja continuidade for demonstrável e mantém os outros separados. Registros antigos ficam fora da cobertura atual; invalidações locais de projeção usam reason outdated com prova da quebra, não alegação de remoção da fonte.
10. Remoção só é emitida após enumerar completamente a seleção correspondente num corte válido e comparar com manifesto confirmado. Interrupção, limite, permissão, ref ausente ou erro de leitura nunca viram tombstones.

Conclusão de um novo corte/reconciliação confirma sua cobertura somente depois de contabilizar todos os itens, incluindo pendências e invalidações. Enquanto isso, o corte anterior permanece referência histórica e phase/lag indicam atualização. Não marcar o novo snapshot completo no início e executar as invalidações depois. Ao mudar a seleção, caminho retirado é exclusão do recorte, não prova de remoção no Git.

Usar leitura de objetos, sem checkout, commit, reset, fetch ou push. `ls-tree` permite consultar uma árvore fixada e delimitar nomes; `cat-file` permite ler objetos sem habilitar filtros de conteúdo. [Documentação de ls-tree](https://git-scm.com/docs/git-ls-tree), [documentação de cat-file](https://git-scm.com/docs/git-cat-file).

A inspeção de ancestralidade diferencia resultado negativo de erro; a linha de primeiros pais é um recorte de histórico, não todas as branches. [Documentação de merge-base](https://git-scm.com/docs/git-merge-base), [documentação de rev-list](https://git-scm.com/docs/git-rev-list).

Git deve continuar passando pelo terminal controlado e pelo endurecimento existente. F02 acrescenta captura interna limitada para os comandos de leitura de objetos: bytes/estrutura fiéis para o adapter; resultado público e auditoria continuam redigidos, sem blobs brutos no log. Não mudar silenciosamente `GitOutcome.saida` ou usar stdout redigido/truncado como fonte fiel. Não criar executor genérico paralelo nem desativar Policy Engine/timeout. Captura incompatível é erro da fonte, não sucesso.

Para conteúdo textual, aceitar UTF-8 válido, sem executar HTML/scripts. Persistir trecho selecionado de até 16 KiB em limite de caractere, indicando no manifesto intervalo, tamanho original, OID e se é parcial. Binário, symlink, submodule e arquivo além do limite de leitura ficam apenas como referência com motivo, sem baixar LFS ou seguir dependência. Não enviar conteúdo a modelo. F03 poderá ampliar contexto na fonte dentro de seu próprio orçamento.

### Decisões existentes: reconciliação sem outbox inventada

Adapter chama porta de leitura do domínio de projetos. Implementar extensão **somente de consulta** para listar páginas por chave estável e ler decisão por ID; não chamar `listar` de todo o projeto e depois cortar em memória. Não acessar tabelas do dono por SQL espalhado no módulo de memória.

A fonte inspecionada não tem sequência durável pública. Portanto o modo inicial é reconciliation:

- No início da passagem, registrar limite superior por ID do conjunto observado, filtro e horário como referência de corte; paginação keyset por ID, sem usar created_at para precedência.
- Novas decisões com ID atrás do cursor serão vistas na passagem seguinte; à frente, podem entrar nesta. Esse recorte não é snapshot transacional histórico. Uma passagem concluída só atesta que a faixa foi percorrida, não ausência de mudanças concorrentes.
- Repetir passagens limitadas e resumíveis enquanto o app estiver ativo. Apenas IDs/revisões ainda não vistos demandam nova normalização; referências já confirmadas não duplicam fatos.
- IDs já vistos não desaparecem da memória só por estarem ausentes numa consulta posterior; ausência sem evidência do dono é lacuna, não delete.
- Resolver `substituiu` por consultas pontuais limitadas e aliases persistidos até encontrar a raiz. Predecessor ausente/ciclo vira pendência de normalização; não inventar raiz pelo texto ou pela pergunta.
- Revisões subsequentes usam a mesma raiz e `supersedes` com a referência da substituição. Uma decisão sem relação comprovada continua registro separado.
- `autor=agente`, inclusive “Decide por mim”, não vira autoria do PI. Preservar autor/motivo e referência do original; texto importado é resumo determinístico da escolha/texto, com metadados da projeção, não inferência gerada.
- Não presumir retenção eterna do produtor. Se material esperado não puder mais ser consultado, registrar gap e conservar referências/pendências.

Este adapter entrega convergência sobre registros ainda retidos e reencontráveis, não exactly-once de todas as mutações externas. O serviço do projeto continua dono das decisões.

### Fonte mínima de conhecimento explícito

Criar `KnowledgeEntryService` interno como dono canônico das notas/orientações; memória apenas consome seu feed. F07 acrescentará UI sobre esse serviço, sem segunda tabela de notas. A criação desse serviço integra esta proposta porque a fonte ainda não existe nas áreas inspecionadas.

Comandos internos `create`, `revise` e `retract`, todos com contexto F01 e `requestId` estável. Entrada contém escopo/produto, kind note ou pi_guidance e texto não vazio de até 16 KiB. Autor vem do contexto de autoria fornecido pelo produto; pi_guidance exige autoria do PI, não string enviada por agente. Não adicionar aprovação manual por nota.

- Entrada tem UUID estável; cada revisão tem UUID próprio e predecessora explícita.
- Revisar/retrair exige `expectedRevision`; divergência retorna conflito, sem sobrescrever.
- Mesmo requestId + mesma entrada normalizada devolve o resultado anterior; conteúdo divergente com mesmo requestId é conflito.
- Em uma transação do dono: revisão, estado atual, deduplicação do comando e item de feed com sequência monotônica. Falha não deixa nota sem evento nem evento sem nota.
- Feed contém referência da revisão, não segunda cópia do texto. IDs/seq sobrevivem ao reinício; reentrega não aumenta evidências. Sequência monotônica não é reciclada nem inferida de horário ou rowid instável; é alocada pelo dono na mesma transação.
- Corte inicial H = sequência confirmada do feed; consumir até H e depois >H. Sem nota existente, H=0 é corte válido.
- Retração gera revisão e evento, normalizado como record.invalidate/retracted; não apaga fisicamente.
- F02 não compacta fonte/feed. F04 especificará retenção; eventual expiração externa deve ser detectável, nunca assumir continuidade.
- Notas em escopo de produto podem ser registradas e ingeridas sem ProjectRepository; em escopo de projeto, o projeto deve existir.

A confirmação da nota e a ingestão na memória são transações distintas: a primeira confirma o produto; falha da memória mantém nota e feed, permitindo retomada. Não bloquear registro de nota pela indisponibilidade do indexador.

## Contrato de leitura dos adapters

```ts
type SourceConsistency = 'snapshot_then_changes' | 'reconciliation'

interface SourceCut {
  readonly cutId: string
  readonly consistency: SourceConsistency
  readonly baselineRef: string
  readonly historyStartRef: string | null
}

interface SourceDelivery {
  readonly position: string
  readonly deliveryRef: MemorySourceRef | null
  readonly value: unknown
}

interface SourcePage {
  readonly cutId: string
  readonly fromPosition: string | null
  readonly deliveries: readonly SourceDelivery[]
  readonly nextPosition: string | null
  readonly complete: boolean
}

type SourceResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly code: 'unavailable' | 'cursor_expired' | 'unsupported' | 'retryable'
      readonly reason: string
    }

interface MemoryReadSource {
  openCut(registration: MemorySourceRegistration): Promise<SourceResult<SourceCut>>
  readPage(cut: SourceCut, position: string | null): Promise<SourceResult<SourcePage>>
  reread(cutId: string, position: string): Promise<SourceResult<SourceDelivery>>
}
```

Assinaturas recebem contexto/autorização e limites pelo construtor da instância, sem objetos globais mutáveis. `value` desconhecido da entrega atravessa validação estrita antes de chamar F01; nunca aceitar objeto arbitrário como envelope válido. Resultado de erro é discriminado como unavailable, cursor_expired, unsupported ou retryable, com reason sanitizado de até 1 KiB, não página vazia de sucesso. Exceção inesperada vira falha da operação, não confirmação.

- Posições são opacas ao orquestrador e vinculadas a inscrição, versão da seleção, versão do adapter, geração e corte. Não são timestamps nem IDs de revisão.
- A página tem posições individuais para confirmar prefixo. `fromPosition` precisa coincidir com o checkpoint solicitado. `nextPosition` representa a fronteira percorrida, inclusive itens excluídos pelo filtro; pode existir em página final. Nunca assumir que null significa posição zero de uma fonte já processada. Página incompatível, cursor repetido sem progresso (salvo fim confirmado da faixa) ou mesma posição com conteúdo divergente vira diagnóstico de protocolo; não avançar silenciosamente.
- `complete=true` só encerra a faixa/corte especificado. Não afirma completude universal da origem. Página final vazia só avança até o corte com prova do adapter de que não há item aplicável naquele intervalo; a confirmação dessa fronteira é transacional. Não saltar até nextPosition quando um item anterior não teve aplicação ou pendência durável.
- Para geração Git em descoberta, o trabalho da cadeia/manifesto possui posição persistida própria; não precisa caber inteiro na resposta de openCut. Leitura só publica entregas do trecho cuja ordem foi comprovada. Paginação do manifesto é local: não presumir cursor nativo em ls-tree; percorrer subárvores fixas e preservar posição no resultado limitado. Árvore individual que exceda o transporte vira limitação explícita, não enumeração completa.
- `reread` usa referência original, sem deslocar o cursor principal. Se a fonte perdeu o material, retorna lacuna, não evento reconstruído por resumo.
- Metadados do trecho ficam em tabela da projeção do adapter, vinculada à chave/revisão/evento, sem acrescentar campos livres ao envelope fechado da F01.

## Confirmação, reinício e pendências

Leitura de arquivo/Git/serviço ocorre **fora** da transação. Confirmar cada prefixo processado numa transação SQLite: aplicação interna da F01 + metadados da projeção + manifesto/aliases afetados + pendência, quando necessária + checkpoint próprio da fonte. Usar a participação transacional prevista na F01, não commit independente seguido de cursor.

Um coordenador ativo por inscrição, identificado por geração de execução. O serviço single-instance do app serializa a inscrição; confirmação verifica versão anterior do checkpoint (compare-and-set) e token da geração. Resposta atrasada de ciclo cancelado não pode confirmar. Fontes diferentes podem alternar trabalho; não introduzir infraestrutura distribuída.

| Resultado do item | Pode confirmar posição? | O que deve ficar durável |
|---|---|---|
| applied ou duplicate da F01 | Sim | Referência da aplicação e checkpoint; duplicate não é nova evidência. |
| pending/conflict da F01 | Sim | Pendência/conflito do núcleo + vínculo da posição + checkpoint. |
| Envelope/deliveryRef inválido ou normalização falha | Somente com posição confiável | Diagnóstico de transporte contendo inscrição/corte/posição, motivo e referência disponível, sem inventar recordId. |
| Posição da fonte inválida, página não verificável ou falha de storage | Não | Preservar checkpoint anterior; diagnóstico, se puder ser persistido, não autoriza avanço. |

Uma pendência de transporte vinculada à posição é diferente de uma pendência do domínio F01: não duplicar o mesmo diagnóstico como dois erros independentes. Manter referência quando ambos forem necessários. Pendência significa material não resolvido, mesmo quando o cursor de leitura já passou.

- Crash antes do commit: reentrega do prefixo, sem estado parcial.
- Crash após commit/antes da resposta: reler checkpoint e deduplicar, sem reaplicar nota ou inventar evento.
- Reinício: retomar corte, posição, manifesto parcial e nextAttemptAt confirmados. Não abandonar carga inicial porque HEAD mudou; alterações posteriores entram depois do corte em andamento.
- Carga inicial encerrada não apaga pendências. Atualizações novas podem prosseguir enquanto itens problemáticos aguardam correção.
- Reprocessamento consulta material original por posição; correção legítima pode exigir novo evento/revisão conforme F01. Resolver diagnóstico apenas com prova de aplicação ou substituição, preservando vínculo/histórico. Normalização que só atingiu limite de trabalho mantém continuação e é retomada automaticamente; não classificá-la como erro permanente nem exigir decisão manual. Se o material da origem está corrompido/incompatível, não repetir sem mudança verificável.
- Resposta antiga após desabilitar/mudar seleção/logout é descartada antes da transação; nunca cruza usuários ou reaproveita inscrição revogada.

Tabelas adicionais propostas: `memory_source_registration`, `memory_source_cut`, `memory_source_checkpoint`, `memory_source_manifest`, `memory_source_alias`, `memory_source_delivery` e `memory_source_pending`. `memory_source_delivery` liga posição a resultado/metadados sem duplicar payload do núcleo. O dono de notas usa `knowledge_entry`, `knowledge_revision`, `knowledge_request` e `knowledge_change`. Todas são escopadas; migrações aditivas preservam as tabelas dos outros donos.

## Cobertura e estados

Não compactar tudo num único semáforo. Consulta interna `getCoverage(context, registrationId)` retorna:

- lifecycle: active ou inactive.
- phase: initial_loading, updating ou idle.
- health: available, retry_wait, unavailable ou unsupported.
- consistency: snapshot_then_changes ou reconciliation.
- cutId, baselineRef, historyStartRef, confirmedPosition e latestObservedRef.
- lastProbeAt, lastConfirmedAt, nextAttemptAt e contagem de falhas consecutivas.
- pendingCount, conflictCount, histórico de gaps abertos/resolvidos e exclusões/referências sem conteúdo.
- lag: behind, caught_up_to_observed ou unknown. Quantidade exata de atraso é nullable, nunca zero inventado.
- selectionVersion, adapterVersion e indicação de trecho/cobertura parcial.

caught_up_to_observed exige atingir a referência observada no último probe, sem significar atualidade absoluta. Decisões em reconciliation não podem declarar igualdade com um feed inexistente. Fonte com pendingCount >0 ou history_gap não recebe alegação de cobertura completa, mesmo que não haja atraso conhecido.

Gap contém código, intervalo/referências conhecidas, detectedAt, explicação e evidência de eventual resolução. Histórico expirado permanece gap histórico mesmo após reconciliar o estado atual. Se não houver referência inicial/final comprovada, campos são null; não criar fronteiras fictícias.

Remoção/revisão comprovada alimenta invalidação da F01. Erros temporários afetam cobertura; não geram exclusão. F03 deve consultar cobertura junto da validade local da F01 para não apresentar dado de fonte atrasada/inativa como sincronizado. Esta fatia entrega esse contrato e seus testes; não implementa o recuperador da F03.

## Limites e agendamento propostos

Defaults versionados; limites menores do runtime existente continuam valendo. São limites de trabalho local, não autorização para gastar tokens.

| Recurso | Default/teto da F02 |
|---|---|
| Seletores por inscrição Git | Até 64 caminhos literais; cada um até 1.024 bytes UTF-8. |
| Página entregue | Até 50 itens e 1 MiB serializado; cada envelope respeita 64 KiB da F01. |
| Turno de uma fonte | Até 200 itens ou 5 s de trabalho entre operações; ceder quando atingir primeiro. |
| Operação externa individual | Até 10 s, ou teto inferior do terminal existente; cancelamento obrigatório. |
| Descoberta por passo Git | Até 100 commits ou 1.000 entradas de árvore; persistir continuação. |
| Arquivo para extração textual | Até 1 MiB lido, trecho persistido até 16 KiB; maior vira referência + motivo. |
| Transporte Git por operação | Até 2 MiB; excedente é erro explícito, nunca parse de saída cortada. |
| Resolução de cadeia de decisões | Até 100 consultas pontuais por turno; continuar com aliases/checkpoint. |
| Cursor/baseline opaco | Até 4 KiB; IDs e references do envelope seguem os limites da F01. |
| Diagnóstico | Até 4 KiB, sanitizado; sem stdout/blob/payload inválido bruto. |
| Atualização sem evento de despertar | A cada 60 s enquanto ativo; sinais locais antecipam probe com coalescência de 2 s. |
| Falha transitória | Tentativa inicial + até 4 retries com 5 s, 30 s, 2 min e 10 min. |
| Após esgotar retries | health unavailable; probe de recuperação no máximo a cada 30 min ou sinal verificável de mudança da fonte. |

Um único ciclo global alterna inscrições elegíveis em round-robin; não esperar uma fonte concluir todo o backfill para atender outra. Dentro da inscrição, reservar até metade do turno para continuações/reprocessamentos elegíveis, cedendo a parcela sem trabalho à ingestão nova; um item problemático não ocupa todos os turnos. Não iniciar duas operações externas ao mesmo tempo nesta versão. Uma chamada em andamento pode exceder a fatia de 5 s até seu timeout, mas não dispara outra se o turno já acabou.

Interromper no logout/encerramento; sobreviver em dados, não em processo após app fechado. Quando a operação suportar cancelamento, sinalizar e terminar subprocesso conforme executor existente. Falha permanente de schema/protocolo não ganha retries cegos: manter pendência até mudar material/adapter ou pedido explícito de reprocessamento. O scheduler não reinicia budgets a cada boot; tentativas/nextAttemptAt são duráveis.

Wakeup repetido não zera contador nem fura backoff. Probe bem-sucedido e página confirmada com progresso reiniciam a sequência de falhas. Disco cheio/lock impede confirmação de qualquer fonte naquele banco, mas não cancela produto/pipeline; suspender ingestão e declarar indisponibilidade sem loop agressivo.

A operação que não puder ser concluída dentro dos limites registra a limitação, preserva continuação quando possível e não a converte em conjunto vazio. Não aumentar a seleção, limite financeiro ou chamada de modelo para “resolver” atraso.

## Critérios de aceite propostos

1. **Inscrição:** uma fonte é escopada/idempotente e retoma IDs; projeto renomeado não cria nova memória, e trocar usuário/seleção invalida respostas antigas.
2. **Seleção:** somente caminhos registrados são examinados para conteúdo; travessia, symlink/submodule, arquivo excluído e encoding incompatível não ampliam acesso.
3. **Corte Git:** commit novo durante carga inicial não muda o corte em andamento; após concluí-lo, alterações posteriores são processadas sem salto silencioso.
4. **Histórico declarado:** baseline não alega importar passado anterior; merge preserva o recorte first-parent e evidencia branches não cobertas.
5. **Manifesto:** mesmas páginas/reinícios não criam novos IDs; arquivos iguais distintos não se fundem; rename sem prova e delete/recreate mantêm ocorrências distintas.
6. **Git fiel/controlado:** caminho de execução continua no terminal controlado; captura interna não usa texto redigido/truncado como bytes originais e não publica blobs no log/renderer.
7. **Quebra de continuidade:** ref reescrita, clone raso, objeto ausente e erro de comando geram resultados distintos, gap e reconciliação sem ressuscitar histórico como atual.
8. **Remoção:** só conjunto completamente enumerado e prova de mudança geram invalidação; erro parcial, limite e permissão nunca removem em massa.
9. **Decisões:** adapter pagina no dono, preserva autor/substituiu e reencontra inserção atrás do cursor na passagem seguinte; não presume ordem causal pelo horário.
10. **Cadeia incompleta:** predecessor/ciclo em decisão vira pendência sem raiz fabricada; retomada resolve aliases e vínculos com evidência.
11. **Nota canônica:** create/revise/retract operam sem UI, com CAS e idempotência; falha reverte nota/feed/request juntos; autoria de PI não é autoatribuída por agente.
12. **Notas e corte:** feed confirma H e consome >H sem perder evento produzido durante carga; falha da memória não perde nem bloqueia a gravação canônica.
13. **Atomicidade:** falha entre aplicação F01, metadados, pendência e checkpoint reverte o prefixo inteiro; outro domínio não tem seu cursor modificado.
14. **Resposta perdida:** crash após commit e reentrega preservam resultado único, aliases, contagem lógica e referência da posição confirmada.
15. **Incompatibilidade:** envelope/deliveryRef inválido só permite avanço com posição confiável e diagnóstico durável; cursor/página inválidos nunca confirmam.
16. **Pendência:** cursor avançado não limpa diagnóstico nem anuncia cobertura completa; reread não muda cursor principal e expiração permanece lacuna.
17. **Cobertura:** phase/health/lag/pending/gap são distinguíveis; unknown não vira zero e reconciliation não vira feed completo.
18. **Limites:** bytes, itens, tempo, cadeia e saída são medidos; nada truncado é aceito como completo; tarefas grandes cedem sem perder continuação.
19. **Retomada/fairness:** fonte lenta/inválida não monopoliza ciclo; retries e nextAttemptAt sobrevivem a boot e wakeups não furam backoff.
20. **Independência e evidência:** Git/decisões/notas são provados com fontes reais temporárias e falhas injetadas; nenhuma chamada de modelo/Graphify/rede é exigida e todas as limitações do recorte aparecem no relatório.

## Estratégia de testes e verificação futura

Unitários Vitest em `*.spec.ts`: seleção, páginas, normalizadores, hashes/IDs, estados, CAS lógico, backoff e relógio falso. Integração `*.int-spec.ts`: SQLite temporário, Git local temporário com commits/merge/rewind e fonte canônica de notas real. Mocks apenas nas falhas/boundaries; não substituir todas as fontes por arrays e chamar isso de ingestão implementada.

Fixtures: dois usuários, dois projetos, produto sem projeto, arquivos iguais em locais distintos, rename, delete/recreate, mudanças enquanto backfill corre, inserção de decisão atrás do cursor, cadeia ausente/cíclica, byte multibyte no limite, saída truncada, posição inválida, crash por etapa e restart com backoff. Para fluxo de decisões, usar porta real do dono com consulta paginada; comparar o que o adapter afirma cobrir com o material efetivamente disponível.

Git da fixture passa pelo mesmo caminho controlado da aplicação, sem alterar allowlist/configuração global do usuário. Provar ausência de hooks/filtros/textconv e de efeitos remotos. Toda limpeza restrita a diretórios temporários criados pelo teste. Tabelas e dados anteriores preservados na migration.

Comandos após futura implementação:

```text
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run test:report:check
```

Números de testes vêm do runner, conforme TESTING.md; revisão usa REVIEW.md e histórico de falhas, sem repetir achados resolvidos como novos. Esta redação não executou esses testes e não é prova de ingestão funcionando.

## Limites da execução futura

- Sempre preservar donos, confirmações, escopo e referências; validar o delta e suas dependências diretas.
- Alteração material do contrato aprovado da F01 ou das regras do produto volta ao PI; documentos auxiliares não criam novo aceite por evento.
- Nunca usar conteúdo recuperado como instrução de sistema, importar históricos externos sem integração ou marcar lacuna como sucesso.
- DESIGN-SYSTEM.md e protótipos permanecem na fatia visual. Esta SPEC é interna e não cria UI provisória.
- Aprovação desta SPEC não revoga a instrução de **não implementar agora**.

## Perguntas abertas ao PI

Nenhuma pergunta pendente nesta fatia. O PI aprovou em 2026-08-30 o recorte Git commitado a partir da inscrição, a reconciliação das decisões existentes, o serviço interno mínimo de notas, os limites/retentativas e os vinte critérios da revisão `e4a521c6ad2339b8a6368d183afb46b8c26b5b80`. F03–F08 continuam nas respectivas fatias. O aceite não inicia implementação nem autoriza push.
