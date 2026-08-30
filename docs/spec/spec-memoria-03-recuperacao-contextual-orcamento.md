# SPEC-Memoria-03 — Recuperação contextual e orçamento

- MVP/Fatia: MVP-007 · M7-F03.
- Issue: [#182](https://github.com/RodReis/rrb-jarvisOS/issues/182); épico [#179](https://github.com/RodReis/rrb-jarvisOS/issues/179).
- Status: **rascunho** — revisão escrita para o PI; implementação não autorizada.
- Depende de: M7-F02 (#181), revisão aprovada `e4a521c6ad2339b8a6368d183afb46b8c26b5b80`; preserva M7-F01, revisão `83e952fd4e5f22850653bf81cf1d45d6c4377c84`.
- Design: `docs/superpowers/specs/2026-08-30-mvp-007-memoria-compartilhada-design.md`, seções 2, 8, 9 e 12.
- Índice canônico: `docs/STATUS.md`.

## Objetivo e escolhas propostas

Recuperar trechos úteis para uma tarefa, com identidade/revisão, validade local, cobertura da fonte e contrapontos. JarvisOS e AgentsOS consomem o mesmo serviço. A memória fornece candidatos; não responde pela autoridade de uma decisão, não decide ações e não monta um segundo ContextPack.

Política já aprovada: tarefa/projeto primeiro, expansão justificada, consulta histórica explícita, relações opcionais, fontes rastreáveis e orçamento do solicitante. Esta revisão propõe os schemas, busca local, ordenação, paginação, limites, integração e vinte critérios. As escolhas concretas abaixo aguardam aceite; não modificam os contratos aprovados de F01/F02.

Alternativas consideradas:

- **Busca textual local + relações opcionais — recomendada:** índice reconstruível no SQLite existente; validade e cobertura verificadas nos contratos F01/F02. Permite provar funcionamento sem modelo ou Graphify.
- Varrer todos os textos a cada pergunta: reduz preparação inicial, mas o custo cresce com o acervo e compete com o aplicativo.
- Embeddings/reranking por modelo obrigatórios: podem melhorar correspondência semântica, mas adicionam backend, atualização e custo antes de provar a recuperação básica. Não fazem parte desta fatia.

Premissas explícitas: sem busca web, sincronização, instalação de Graphify ou novo orçamento financeiro. Busca lexical não promete entender sinônimos, responder qualquer pergunta ou economizar uma porcentagem fixa de tokens.

## Evidência e pontos de integração

Inspeção somente de leitura em 2026-08-30:

- Worktree documental em `8df5990`: F01/F02 aprovadas; M7-F03 ainda inexistente.
- Checkout principal observado em `0799c8a`: `src/shared/domain/context-pack.ts`, `src/main/context/context-service.ts`, `context-repository.ts` e `src/main/ai/call-provider.ts`.
- `ContextService.montar` recebe candidatos por caminho relativo e lê arquivos. `ContextItem` não representa uma revisão de memória; não inventar caminho para encaixá-la.
- `ContextPack` é manifesto imutável. `tokensDosItens` estima bytes/4; o ponto de chamada usa outra estimativa por caracteres. Nenhuma dessas aproximações é medição real nem cota superior garantida para todo texto/modelo.
- `AiCallService` verifica a existência do pack, mas recebe o prompt separadamente. Só acrescentar uma referência ao manifesto **não prova** que o trecho foi enviado.
- Stack declarada: Node >=22, TypeScript ^5.9.3, better-sqlite3 ^13.0.1; Electron main e SQLite local existentes. Não instalar/atualizar dependências nesta redação.

A implementação futura deve conferir a base real sem copiar arquivos antigos deste worktree sobre código mais recente. Integrações propostas são aditivas e opcionais: sem memória, os caminhos existentes permanecem funcionais.

Estrutura proposta:

| Área | Responsabilidade |
|---|---|
| `src/shared/domain/memory-retrieval.ts` | DTOs, ranking, limites e serialização determinística. |
| `src/shared/contracts/memory-retrieval.ts` | Validação estrita, sem campos livres ou SQL recebido. |
| `src/main/memory/memory-search-index.ts` | Projeção lexical e progresso de indexação. |
| `src/main/memory/memory-retrieval-service.ts` | Sessão, candidatos, expansão, validade/cobertura e orçamento. |
| `src/main/memory/memory-search-worker.ts` | Consultas limitadas em conexão própria fora do event loop do main. |
| `src/main/memory/memory-context-bridge.ts` | Ponte interna para seleção/congelamento no ContextPack. |
| `src/main/context/*`, domínio de contexto e ponto de chamada | Extensão opcional do manifesto, persistência e uso do bloco exato. |
| `src/main/storage/migrations.ts` | Tabelas/índices derivados e anexo do pack; próximo número livre na implementação. |

Nomes de campos seguem TypeScript com readonly e uniões discriminadas; SQL usa snake_case. Reutilizar tipos/regras F01/F02, sem reimplementar precedência ou inventar campo no envelope v1. Serviço interno: não criar endpoint/IPC/UI nesta fatia.

## Escopo e identidade da consulta

Contexto autenticado é o `MemoryContext` aprovado da F01. Produto/projeto são filtros, não autorização. Uma instância interna valida acesso antes de consultar ou retornar referências. O texto da pergunta, um locator ou uma aresta não concede acesso.

```ts
interface MemoryTarget {
  readonly productId: MemoryProductId
  readonly scope: MemoryScope
}

interface MemoryRetrievalRequest {
  readonly schemaVersion: 1
  readonly requestId: string
  readonly taskRef: string
  readonly focus: MemoryTarget
  readonly terms: readonly string[]
  readonly references: readonly MemoryRevisionRef[]
  readonly mode: 'current' | 'history'
}

interface MemoryRetrievalBudget {
  readonly allocationId: string
  readonly maxEstimatedTokens: number
  readonly maxBytes: number
  readonly maxQueries: number
  readonly maxDurationMs: number
}

type MemoryExpansion =
  | {
      readonly kind: 'scope'
      readonly gapId: string
      readonly target: MemoryTarget
      readonly reason: string
      readonly cause:
        | { readonly kind: 'explicit_task' }
        | { readonly kind: 'relation'; readonly from: MemoryRevisionRef }
    }
  | {
      readonly kind: 'excerpt'
      readonly gapId: string
      readonly ref: MemoryRevisionRef
      readonly variantId: string
      readonly fromByte: number
      readonly maxBytes: number
      readonly reason: string
    }
  | {
      readonly kind: 'relation'
      readonly gapId: string
      readonly from: MemoryRevisionRef
      readonly reason: string
    }
```

Tipos F01 são importados; não redefinir `MemoryScope` ou `MemoryRevisionRef`. IDs seguem limites F01. taskRef/reason até 512 bytes UTF-8; termos 1–64 bytes cada, até 12 termos distintos. Deve existir pelo menos um termo ou referência; busca vazia não vira “listar todo o acervo”. Até 8 referências exatas por pedido. Números inteiros finitos, sem negativos; limites do quadro abaixo são validados antes de trabalho.

- Foco de projeto consulta somente esse produto/projeto inicialmente; foco de produto consulta conhecimento daquele produto, sem reunir todos os projetos.
- Conhecimento do produto e outros projetos/produtos entram por expansão explícita e registrada. No máximo três alvos adicionais, validados pelo contexto do chamador.
- O orquestrador existente pode justificar a expansão; não se exige aprovação humana por consulta. A justificativa deve apontar uma lacuna retornada, tarefa explícita ou relação comprovada; não basta texto “pode ajudar”.
- Relação sugerida pelo grafo ainda passa por existência, revisão, escopo e validade do núcleo. Ela não transfere regra do projeto A para B.
- `history` permite material substituído/invalidado e variantes identificadas como históricas. Não é consulta “estado exato em uma data”: relógios não provam precedência. Revisões explícitas permitem consulta histórica exata; intervalos por data causal não são inventados.

## Busca básica e índice derivado

Proposta: FTS5 do SQLite, `unicode61`, sem stemming/embeddings obrigatórios. Indexar somente título e texto já normalizados/selecionados da memória, até os limites da F01; não ler o disco inteiro para alimentar a busca. Texto armazenado não é reescrito pela normalização do índice.

FTS5 possui gramática própria de consulta e ranking BM25; o ranking padrão mais relevante é ordenado em sentido crescente. Por isso, parâmetros SQL sozinhos não tornam literal a expressão MATCH. Gerar internamente expressões de termos entre aspas, escapando aspas; nunca aceitar operadores, nomes de colunas ou SQL livres do solicitante. Usar `unicode61` tanto na indexação quanto na interpretação lexical. [Documentação oficial FTS5](https://sqlite.org/fts5.html).

Sem caracteres pesquisáveis após tokenização, retornar consulta inválida, não MATCH global. OR entre termos literais amplia correspondência dentro do escopo já filtrado; não altera escopo. Não adicionar stemming português, prefixo, busca aproximada ou tradução silenciosamente.

Modelo derivado:

- `memory_search_document`: identidade interna de variante, chave/revisão, título/texto indexável e versão do extrator.
- `memory_search_fts`: índice FTS5 external-content sobre essa projeção; chaves/escopos ficam em colunas normais e índices B-tree, não em texto de busca.
- `memory_search_dirty`: fila local durável de variantes novas; `memory_search_state`: versão, progresso e estado ready/building/lagging/unavailable/unsupported.
- Captura mínima da variante nova participa da transação de gravação já existente, por hook/trigger interno sobre a tabela da memória. Não acoplar o commit da F01 à execução do FTS nem escrever filas dos donos das fontes. Falha ao persistir a fila é falha transacional real, não confirmação fictícia.
- Projeção, atualização correspondente do FTS e confirmação da fila são uma transação própria; falha não remove a pendência. Usar o protocolo documentado de atualização de external-content, incluindo conteúdo anterior ao remover/atualizar; a tabela externa sozinha não atualiza o índice.
- Bootstrap percorre variantes por chave interna estável em lotes, com corte e continuação persistidos; eventos novos ficam na fila. Sem varredura integral no caminho da consulta. Colisão de hash não funde variantes.
- F03 entrega criação, bootstrap e atualização incremental necessários à busca. Política de retenção, manutenção, compactação e rebuild administrativo completo permanece F04.
- Índice pode atrasar sem bloquear ingestão/produto. Uma revisão ausente do índice reduz descoberta e aparece como index_lag; índice atrasado nunca torna uma revisão antiga vigente.
- Resultados do índice sempre reencontram a revisão canônica e consultam validade/cobertura; referências a dados excluídos não devolvem o texto residual do índice. A F04 deverá purgar os derivados ao excluir fisicamente.
- Detectar disponibilidade FTS5 no runtime efetivo. Ausência/incompatibilidade retorna busca textual unsupported, preservando leitura exata F01 e pipeline; não carregar extensão externa nem instalar pacote automaticamente. Tabelas normais/versões usam migração aditiva; criação do índice virtual é inicialização transacional da capacidade derivada e não pode impedir abertura do banco principal quando FTS5 faltar. Entrega da busca exige teste no binário efetivo, não basta citar a documentação.

A geração F01 serve para invalidar validade em cache, não é “último rowid indexado”. Progresso lexical e cobertura F02 são dimensões independentes. Não reconstruir todo o índice a cada mudança de geração ou a cada pergunta.

## Descoberta, ordenação e validade

1. Ler referências explícitas do pedido, mantendo distinção de variante se existir conflito.
2. Consultar lexicalmente o foco; filtrar contexto/produto/projeto **antes do limite de candidatos**. Não buscar os melhores de todos os usuários e filtrar depois.
3. Manter vias limitadas separadas para conhecimento explícito de autoria do PI e para os demais resultados, impedindo que muitas inferências escondam todo o conjunto de decisões. A autoria vem da fonte, nunca da alegação no texto.
4. Validar candidatos com F01 e cobertura F02 em snapshot consistente. Captura de geração/versões acompanha o resultado.
5. Ordenar candidatos elegíveis pela tupla: foco antes de ampliação; referência solicitada antes de descoberta; orientação/decisão aplicável do PI antes de fatos/notas/observações e, por último, inferências; BM25 dentro da mesma classe; desempate por tupla canônica da chave/revisão/variante. Data de chegada não escolhe verdade.
6. Pertencer ao projeto não torna toda orientação aplicável: precisa também corresponder aos termos, a uma referência da tarefa ou a vínculo explícito. A memória declara o motivo, não executa resolução semântica por modelo.
7. Duplicatas por identidade/revisão/variante/intervalo são eliminadas. Textos iguais em origens diferentes preservam ambas as proveniências; não contar cópias como provas independentes.

O ranking é determinístico para o mesmo recorte, versões e estado observado. Não promete top-k perfeito de um acervo quando a busca foi interrompida ou o índice está atrasado. Cada rodada pode descobrir até 100 referências, mas a sessão inteira admite no máximo 16 candidatas distintas para avaliação; vias do PI e demais reservam até 50 referências cada, cedendo a parcela ociosa. Referências explícitas ocupam a primeira parte dessas 16 vagas. Saturação declara candidate_limit.

Cada avaliação da F01 respeita o limite aprovado de 256 revisões visitadas. Até 32 avaliações por sessão, incluindo revalidações das no máximo 16 candidatas distintas, portanto no máximo 8.192 visitas; orçamento/tempo menor interrompe antes. Relações do grafo opcional não aumentam essa verba. Reutilizar avaliação somente quando geração F01 e versões F02 conferirem; se mudaram e não há saldo para reavaliar, declarar stale_snapshot, nunca current presumido.

### Validade local não é sincronização

O resultado conserva lineage, availability, support, eligibleCurrent, contradições e motivos da F01, além de estado/corte/seleção/lag/gaps da F02:

| Situação | Apresentação |
|---|---|
| Revisão eligibleCurrent e fonte alcançou referência observada | vigente localmente; atualizada até a referência observada, nunca “sempre atual”. |
| Revisão eligibleCurrent e fonte atrasada, inativa, indisponível ou sem cobertura conhecida | último estado local conhecido; cobertura incerta/atrasada explícita. |
| Revisão substituída ou invalidada | histórica; no modo current apenas aviso da mudança/indisponibilidade relevante, sem oferecer o texto antigo como regra vigente. |
| Cadeia pendente, conflito ou suporte unknown/stale | não resolvida; nunca orientação vigente. |
| Fonte não integrada ou item não indexado | lacuna de cobertura, não prova de que a informação não existe. |

Contradição não escolhe um vencedor. Cada candidato constitui um **grupo indivisível**: trecho + identidade/revisão + validade + cobertura + avisos de contrapontos. Incluir até oito referências de contrapontos e indicação explícita de restantes/desconhecidos; se conteúdo adicional não couber, preservar aviso/referência, não apresentar concordância fictícia. Variante conflitante recebe identificador interno além de sourceRevision/hash; igualdade de hash sozinha não seleciona variante.

Se nem o aviso obrigatório couber no orçamento, omitir o texto inteiro daquele grupo e informar limitação no bloco geral. Histórico conserva estado histórico e lacunas mesmo quando ranqueado primeiro por solicitação explícita.

## Contrato de resposta e sessão

Serviço interno proposto: `start(context, request, budget, signal)`, `page(context, cursor)`, `expand(context, sessionId, requestId, expansion, signal)` e `prepareContext(context, sessionId, candidateIds)`.

Resposta discriminada:

- kind: results, empty, limited, cancelled ou unavailable.
- sessionId nullable, requestId, snapshotRef, versões do recuperador/extrator, sequência da revisão da sessão.
- candidates: até o limite da página; cada candidato tem id estável na sessão, ref F01, variantId, trecho e intervalo UTF-8, hash do trecho, sourceRef, estado F01, projeção de cobertura F02, motivo lexical/exato/relação e grupo de contrapontos.
- gaps: códigos tipados no máximo 16, com referências acessíveis e contagens; excesso identificado, sem apagar a existência de lacunas. Códigos: index_lag, source_lag, source_unavailable, source_gap, source_not_integrated, unresolved, content_unavailable, candidate_limit, byte_limit, token_limit, query_limit, time_limit, graph_unavailable, scope_not_expanded, stale_snapshot, no_new_information.
- usage: limites concedidos, consultas iniciadas, tempo decorrido, bytes e tokens estimados do bloco serializado, método de estimativa; tokens reais null nesta etapa.
- nextCursor nullable, hasMore, truncated e motivo de encerramento. erro de entrada/cursor é retorno tipado invalid_request/invalid_cursor, não empty.

Arrays/campos seguem schema fechado, sem payload livre. Campos sem referência/contagem comprovada usam null, não zero presumido. `empty` significa nenhum resultado no recorte observado com busca concluída; ainda carrega a cobertura. Índice indisponível sem leitura útil é unavailable; limite atingido é limited, mesmo sem candidatos. Nenhum dos estados significa ausência universal de fatos.

Este DTO é controle interno para consumidores do produto, não resposta livre a ferramenta de modelo. Somente modelBlock previamente medido pode atravessar para o executor; se um consumidor precisar enviar outros campos, deve serializá-los e debitá-los no mesmo saldo antes. Prévia, referência ou aviso não é uma rota gratuita de contexto. Com concessão zero, não preparar texto para envio, embora a interface local possa consultar metadados dentro dos limites de trabalho.

Sessão é resultado limitado, não snapshot SQL aberto entre cliques. Materializar IDs/ordem e projeções limitadas em memória; guardar generation F01, versões de cobertura/seleção e index generation. Cursor opaco vincula contexto, filtro, sessão, revisão da sessão e posição; até 2 KiB. Sessão expira em cinco minutos, no logout ou reinício, com até 32 sessões/8 MiB totais por aplicativo e sem evicção silenciosa de sessão em uso.

Página não executa nova busca ou renova a verba. Repetir cursor devolve a mesma página quando as versões ainda conferem. Se estado relevante mudou, retornar stale_snapshot e preservar orçamento consumido, sem misturar snapshots ou reapresentar conteúdo como vigente. F01 pode invalidar conservadoramente pelo contador usuário/workspace; não há promessa de estabilidade durante ingestão contínua.

Uma expansão produz nova revisão limitada da sessão; invalida seus cursores anteriores e atualiza a lista sem duplicar grupos. Não renovar prazo/verba indefinidamente; o prazo é contado desde start. Reiniciar com novo start exige concessão do chamador, não é mecanismo automático de contornar limite.

## Expansão progressiva e contrato de relações

Expansão precisa apontar gapId ainda relevante e motivo. Não faz busca cega automática em todos os projetos. Até duas expansões dentro da concessão original; não aumentar maxEstimatedTokens, consultas ou deadline. O serviço pode pedir mais contexto ao orquestrador, mas não criar uma nova concessão.

- Escopo: somente alvo declarado/validado; texto pode continuar igual, mas o ganho precisa vir de nova origem/revisão.
- Relação: percorrer até dois saltos e 32 arestas no total da sessão, com conjunto de visitados; ciclos, duplicatas e mesmo conteúdo não renovam trabalho.
- Trecho: primeiro ampliar o intervalo da projeção já armazenada. Leitura adicional na fonte usa uma porta `readExactExcerpt` vinculada ao adapter F02, revisão/variante exatas, intervalo e seleção original, com bytes/deadline/cancelamento. Intervalos são [fromByte, toByte) em UTF-8, alinhados a caracteres e marcados como relativos à projeção ou à fonte; o retorno informa o intervalo efetivo. Sem mapeamento confiável, não converter offset da projeção em offset do original. Até duas leituras; não mover checkpoint, iniciar ingestão ou registrar revisão por simples consulta.
- No Git, resolver commit/blob fixos e usar captura interna fiel/terminal controlado previsto na F02; nunca HEAD móvel ou caminho arbitrário. Até 1 MiB lido e até 8 KiB retornado por ampliação, respeitando o saldo. Notas/decisões usam o dono e ID de revisão, sem reler todo o histórico.
- Capacidade ausente, origem expirada ou divergência da revisão/hash vira content_unavailable/stale_snapshot; manter a evidência conhecida como parcial, não fabricar conteúdo.
- Ausência de novo par revisão/variante/intervalo ou nova referência útil encerra com no_new_information. A repetição não conta como aprendizado.

Porta opcional `MemoryRelationsReader` recebe contexto, raízes exatas, alvos permitidos, deadline e saldo de arestas; devolve available/unavailable/unsupported e relações normalizadas. Cada relação contém from/to como MemoryRevisionRef, tipo estrutural ou inferida, origem e referências de sustentação. Payloads não são comandos, links não abrem recursos e relações inferidas continuam inferidas.

F03 entrega contrato validado, implementação nula e dublê de teste, mais leitura das relações explícitas F01. F05 implementará Graphify/versionamento/backend. Quando ausente, manter busca lexical/relações F01; não repetir chamada de grafo em cada candidato nem usar dinheiro/modelo como fallback. Relação inválida/fora de escopo não injeta candidato; diagnóstico limitado.

## Orçamento, cancelamento e execução local

Não há limite financeiro novo. `MemoryRetrievalBudget` é parcela concedida pelo solicitante do saldo da tarefa/etapa, após reservar contexto obrigatório e saída. A F03 não usa o teto inteiro do ContextPack como se estivesse livre.

| Recurso | Default/teto proposto |
|---|---|
| Tokens da memória | Concessão obrigatória; sem concessão = 0. Até 4.000 estimados por sessão e nunca acima do saldo do chamador. |
| Bytes de conteúdo + metadados serializados para modelo | Até 64 KiB ou maxBytes menor; trecho por candidato até 4 KiB, ampliação até 8 KiB. |
| Resultados | Até 12 grupos por sessão; página até 6. Grupos extras não entram só porque há nextCursor. |
| Consultas lexicais | Até 4 comandos MATCH por sessão; os dois da rodada inicial com termos já contam. Pedido somente por referência não executa MATCH. Consultas de referência e avaliações têm os limites separados acima. |
| Expansão | Até 2 passos; até 3 alvos adicionais; até 32 arestas/2 saltos; até 2 leituras exatas de fonte. |
| Duração | Até 2.000 ms acumulados de trabalho ativo/fila; expansão usa o saldo, e TTL absoluto de 5 min limita espera entre chamadas. |
| Worker | Um worker de leitura, conexão readonly própria, uma consulta ativa; fila até 8 pedidos, espera incluída no deadline do pedido. |
| Projeção lexical | Lotes até 50 variantes/1 MiB, cedendo entre lotes; um lote ativo, sem monopolizar o main. |
| Metadados/sessões | Transporte até 128 KiB por página, cursor 2 KiB, sessão 256 KiB e total 8 MiB. Limites de modelo continuam menores. |

Não usar um simples LIMIT como prova de tempo de CPU. Consulta SQLite síncrona não roda no event loop do main. O supervisor encerra a espera no deadline, descarta respostas atrasadas e solicita término do worker; não iniciar outro enquanto o anterior não terminar. Término de código nativo pode demorar: informar indisponibilidade do worker nesse intervalo, sem multiplicar workers ou prometer interrupção instantânea. Leituras externas usam min(saldo de tempo, limite F02/terminal). Logout/cancelamento invalida sessão e resposta em voo.

Worker usa comandos tipados predefinidos, não recebe SQL livre. Consulta e avaliação de validade reutilizam as regras F01 e leituras F02 na mesma conexão/snapshot; não duplicar algoritmo de precedência nem devolver apenas score para o main decidir vigência. Operações de escrita da F01 permanecem no dono. Cada worker mantém sua conexão; timeout de lock não é timeout de consulta. Suporte documentado a worker e semântica de timeout foram consultados em Context7: [threads do driver](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/threads.md), [API do driver](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md). Empacotamento Electron/native binding e cancelamento devem ser provados no runtime real da implementação.

Medir duração com relógio monotônico: cada operação recebe deadline = início da operação + saldo de tempo ativo; fila e espera por fonte entram no débito, intervalo ocioso entre page/expand não. Contadores são reservados atomicamente antes do despacho. Uma resposta descartada por timeout não devolve a consulta/tempo já gastos nem dispara retry automático. Consulta exata ou revalidação também consome tempo, mesmo sem MATCH.

Índice é atualizado em trabalho local limitado, fora da consulta; falha não dispara rebuild sincrônico nem retry infinito. Não exigir que o índice esteja integralmente pronto para retornar a parte disponível com cobertura explícita. Consultas exatas ainda disponíveis não ficam artificialmente dependentes do FTS.

### Medição e consumo

Serializador único gera `modelBlock` com trechos, referências, limites/validade/cobertura e avisos efetivamente selecionados. Medir UTF-8 **depois** de serializar e escapar; medir só o texto bruto subestima JSON/identificadores. Dados locais de diagnóstico não entram automaticamente no prompt.

O medidor é injetado pelo consumidor e identificado por método/versão/modelo quando aplicável. Fallback local reutiliza a razão bytes/4 do contexto existente e se chama **estimativa**, não contagem real ou garantia da janela. Não chamar API para contar tokens. Se faltar medidor/saldo, retornar candidatos de controle sem enviar texto ao modelo; o chamador decide a próxima ação dentro de seus limites.

Todas as páginas/expansões compartilham a mesma concessão; reservar saldo antes de operação, inclusive concorrente. Reentrega idêntica do requestId não repete busca nem renova budget; mesmo ID com entrada divergente retorna invalid_request. O registro allocationId pertence ao chamador e é escopado à tarefa/contexto; sessões concorrentes não podem receber cada uma o saldo completo. A ponte reserva/libera a parcela em um único coordenador local do ContextPack; não criar segundo ledger financeiro.

A seleção final mede o bloco completo, não soma estimativas individuais com arredondamentos diferentes. Ao reduzir, retirar grupos inteiros ou reduzir trechos com faixa/parcialidade explícitas; nunca retirar aviso para caber texto enganoso. Se nem envelope mínimo couber, modelBlock vazio e diagnóstico só local. Reenvio real ao modelo custa novamente mesmo quando o resultado veio de cache; o consumo real é contabilizado no executor/provider existente, sem dupla cobrança pela recuperação local.

## Integração concreta com ContextPack e chamada

Proposta aditiva necessária, ainda não aprovada nesta SPEC:

1. Introduzir ponte interna opcional de candidatos de memória; `ContextService.montar` e IPC de caminhos existentes continuam aceitando o contrato atual. Não permitir que o renderer envie um texto alegando ser memória validada.
2. `montarComMemoria` recebe pedido de contexto e handle de sessão interno. O ContextPack escolhe IDs/grupos conforme tarefa e saldo; a F03 não substitui a escolha de arquivos, regras e falhas abertas.
3. `prepareContext` revalida referências, F01 e F02, transforma IDs selecionados num bloco fechado e calcula hash/bytes/estimativa. Aplicar detector de segredos existente ao bloco; não colocá-lo em regras/instrução de sistema. Inspeção de conteúdo não cria política jurídica nova.
4. Acrescentar anexo tipado `memoria` ao manifesto somente quando houver seleção: versão do formato, bytes exatos de modelBlock, hash, identidades/revisões/variantes/intervalos, cobertura e método/estimativa. Não converter em ContextItem com caminho fictício nem rotular inferência como decisao-aprovada.
5. Persistir o bloco congelado junto ao pack em transação do dono, com tabela filha opcional `context_pack_memory`. Bloco é evidência limitada do enviado, não nova fonte canônica de conhecimento. Validação/segredo/storage falhos não deixam pack parcialmente gravado. Pode existir pack com memória e sem arquivo, desde que tenha bloco útil e contexto da tarefa; pack realmente vazio continua recusado.
6. Manter leitura/hashes de packs antigos idênticos. Packs com memória usam domínio de hash versionado que cobre também seu anexo/bytes; não reescrever hashes existentes. Corrigir fonte depois não altera o pack congelado.
7. No caminho de envio existente, recuperar o anexo pelo pack, revalidar sua elegibilidade para uma **nova** chamada e compor o prompt final com os bytes congelados, exatamente uma vez, antes da estimativa e do gate existentes. Não reler HEAD/arquivo no meio para “atualizar” o bloco e não depender apenas de a referência do pack existir.
8. Medir prompt final, instrução de sistema, wrappers e reserva de saída dentro do teto da etapa; registrar método estimado. Comparar bloco final com hash/bytes do manifesto. A montagem e o envio reutilizam o mesmo medidor para a parcela de memória; não fingir que bytes e caracteres são a mesma unidade. Não ampliar ou recalibrar globalmente os ledgers de outros fluxos nesta fatia.
9. Se o estado mudar entre seleção e envio, não usar anexo antigo como vigente: recompor uma vez dentro do saldo ou prosseguir sem a memória opcional, produzindo outro pack e diagnóstico. Não editar o anterior, aumentar orçamento ou pedir novo aceite do PI por consulta. Se nem o contexto obrigatório couber, prevalece a recusa do gate já existente.
10. Falha/ausência de memória conserva fluxo sem memória; nunca ignora uma recusa do detector de segredos ou do orçamento do pack para reapresentar o mesmo conteúdo por outra rota. Contexto rejeitado não é ausência técnica do serviço.

A evidência de integração precisa comparar o **prompt recebido por um adapter dublê no ponto de chamada** com o bloco/manifesto, testar o teto e o uso sem memória. Testar só criação de DTOs não prova envio. Não implementar gerador de respostas próprio, alterar política paga/assinatura, aceitar instruções contidas nas fontes ou promover lições.

## Critérios de aceite propostos

1. **Contrato/escopo:** schema e limites rejeitam consulta inválida; foco/identidade são validados antes da leitura; outro usuário/escopo não vaza texto ou referências.
2. **Lexical real:** SQLite efetivo encontra textos UTF-8 selecionados sem Graphify/modelo/rede; aspas, operadores aparentes e termos sem tokens não executam gramática arbitrária.
3. **Índice incremental:** bootstrap/novas variantes, crash após projeção e antes do checkpoint, duplicata e reinício convergem; falha de FTS não vira perda de ingestão.
4. **Cobertura lexical:** índice atrasado/unsupported/indisponível aparece distinto de resultado vazio; consultas exatas não exigem índice completo.
5. **Ranking:** mesma entrada/estado ordena igual; referência solicitada e decisão aplicável do PI não são substituídas por inferência; saturação de candidatos fica explícita.
6. **Vigência:** revisão invalidada/substituída nunca reaparece como atual; F01 pending/conflict/stale/unknown não ganha elegibilidade por score ou cache.
7. **Cobertura da fonte:** lag, inatividade, reconciliação e gap histórico da F02 acompanham o resultado; caught_up_to_observed não afirma sincronização absoluta.
8. **Contradições:** grupos conservam contrapontos/variantes; corte por orçamento não remove avisos para deixar só uma conclusão aparentemente consensual.
9. **Histórico:** revisões exatas e variantes permanecem identificáveis; clocks não decidem precedência e modo histórico não torna conteúdo antigo vigente.
10. **Paginação:** cursor vincula contexto/filtro/sessão; repetição é idempotente, expiração/mudança de geração retorna stale_snapshot, sem misturar páginas ou renovar verba.
11. **Expansão de escopo:** lacuna/motivo/alvo são obrigatórios; no máximo os alvos autorizados, sem transferência automática de regras entre projetos.
12. **Expansão de conteúdo:** leitura fixa revisão/intervalo, respeita bytes/tempo/seleção e não move ingestão; material perdido/incompatível vira lacuna, não reconstrução fictícia.
13. **Relações opcionais:** adapter nulo mantém busca; ciclos, duplicatas, referência inexistente e aresta fora de escopo são limitados; inferência não ganha autoridade.
14. **Parada:** sem novidade, tempo, consultas ou saldo encerram sem loop; máximos valem sobre sessão inteira e alocações concorrentes não duplicam o saldo.
15. **Medição:** fixtures com acentos, emoji, escapes, referências longas e avisos contam os bytes serializados; estimativa e consumo real não são confundidos.
16. **Worker/cancelamento:** consulta lenta/lock/crash não congela main; deadline descarta retorno tardio e não gera multiplicação de workers; logout impede entrega.
17. **Ponte real:** ContextService seleciona candidatos internos e congela conteúdo/revisão sem caminho fictício; transação falha não deixa pack/anexo parcial.
18. **Manifesto e envio:** bytes/hash do anexo correspondem ao prompt no adapter dublê; mudanças antes de nova chamada recompoem ou removem memória opcional sem editar pack antigo.
19. **Compatibilidade:** packs antigos mantêm hash/leitura; caminho sem memória e gates existentes continuam válidos; nenhum token/valor monetário/aceite adicional é inventado.
20. **Evidência:** relatório por critério mostra limites e falhas reais, resultados no SQLite/runtime efetivo e zero chamadas pagas nas suítes; nenhuma busca incompleta é reportada como cobertura total.

## Estratégia e comandos de verificação

Regras puras em `*.spec.ts`: schema, autorização por contexto existente, ranking, grouping, limites/serialização, estimativas e budgets concorrentes. Banco real temporário em `*.int-spec.ts`: F01/F02 → projeção FTS → recuperação → ContextService → persistência, com falhas injetadas e reabertura.

Fixtures: dois usuários, JarvisOS/AgentsOS, dois projetos e escopo de produto; decisões de PI/agente; revisões em conflito, fonte atrasada, índice atrasado, texto maior que trecho, emoji/acentos/aspas, cadeia e grafo cíclicos. Benchmark controlado com 10.000 variantes sem ampliar lote/resultado; registrar máquina, volume e duração observada, sem inventar SLA universal. Para cancelamento, usar consulta deliberadamente lenta em banco temporário e afirmar responsividade/cancelamento, não apenas código de saída.

Prova do worker empacotado no Electron, sem UI nova; teste de envio usa adapter dublê pelo ponto único, sem credenciais/rede. F07 mantém DESIGN-SYSTEM.md e protótipos HTML depois do PRD. Testes desta fatia não ficam adiados para F08.

Comandos futuros no PowerShell:

```text
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run test:report:check
```

Contagens vêm do runner e relatórios gerados conforme TESTING.md; revisão usa REVIEW.md e delta/falhas anteriores. **Nesta redação só houve inspeção e validação documental**: nenhum desses testes prova produto implementado agora.

## Limites e revisão do PI

F04: retenção/rebuild/limpeza; F05: implementação Graphify; F06: avaliação de lições; F07: UI/Notebook; F08: prova integrada. Não criar embeddings, web search, autoaprendizado/promotor, nova política financeira, fluxo de consentimento ou segundo seletor de ContextPack.

Submeter esta revisão exata ao PI, especialmente busca lexical local, expansão limitada, tratamento explícito de cobertura, parcela de orçamento e ponte opcional com manifesto/envio. A proposta não vira aprovada por ter sido escrita. Aprovação documental futura não revoga a instrução de **não implementar agora**.
