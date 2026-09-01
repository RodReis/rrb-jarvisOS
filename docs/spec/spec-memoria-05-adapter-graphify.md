# SPEC-Memoria-05 — Adapter opcional do Graphify

- MVP/Fatia: MVP-007 · M7-F05.
- Issue: [#184](https://github.com/RodReis/rrb-jarvisOS/issues/184); épico [#179](https://github.com/RodReis/rrb-jarvisOS/issues/179).
- Status: **aprovada-pi** (2026-09-01); issue em `proplan:backlog`; implementação não iniciada.
- Revisão aprovada: `6f8c7f66c4c582b912f17af462f3f63047ad8382`, aceite explícito do PI nesta conversa. Esta atualização registra somente o aceite, sem alterar o contrato técnico.
- Depende de: M7-F03 (#182), revisão aprovada `c3b546a1787961bb0b9bb407cd7213d5b7046b1b`, e M7-F04 (#183), revisão aprovada `027f8274dc4e3d39a6fc24ce394ea6b53d70f986`.
- Design: `docs/superpowers/specs/2026-08-30-mvp-007-memoria-compartilhada-design.md`, seções 2, 8, 9, 12 e 18.
- Índice canônico: `docs/STATUS.md`.

## Objetivo e limite desta revisão

Integrar Graphify como projeção estrutural local, opcional e substituível para localizar relações em projetos administrados pela pipeline. O grafo fornece candidatos; o arquivo-fonte na revisão atual comprova fatos. Graphify não se torna memória canônica, não substitui a busca básica, não decide acessos e não bloqueia construção.

Cada projeto-alvo mantém seu próprio `graphify-out/` dentro da raiz local. A pipeline cria o primeiro grafo depois da fatia explicitamente marcada como fundação e faz atualização incremental a cada quatro PRs incorporados à branch principal. Entre checkpoints, consultas combinam a última geração válida com o delta do Git.

Alternativas consideradas:

- **Adapter de capacidades com cadência pertencente à pipeline — recomendada:** separa Graphify de Git, fatias e workflow; permite substituição e teste por contrato.
- Adapter controlador de PRs e fundação: reduz chamadas entre componentes, mas acopla uma projeção opcional ao fluxo inteiro de entrega.
- Grafo global entre projetos: facilita busca cruzada, porém mistura contextos, contraria o isolamento local aprovado e cria operação central desnecessária nesta fatia.

Não fazem parte da M7-F05: UI, grafo global, sincronização, memória própria do Graphify, `save-result`, `reflect`, instalação global, `graphify install`, hooks do Graphify, atualização automática de versão, reconstrução total automática, alteração automática de `CLAUDE.md`/`AGENTS.md`, novo provedor pago ou implementação dos menus Agent Memory/Notebook.

## Evidência técnica e baseline de compatibilidade

Documentação oficial consultada em 2026-09-01 pelo Context7 e pelas páginas do projeto:

- distribuição oficial: `graphifyy` (dois `y`); comando: `graphify`; Python 3.10 ou superior;
- release candidata fixada para esta SPEC: `graphifyy==0.9.53`, publicada em 2026-08-30;
- wheel de referência: SHA-256 `900348aa7c41ef31c0581a8c2e0ca9f0b6a81f1e5bc6ef2184cce697e5342e3f`;
- `/graphify <path> --update` e `graphify update <path>` são documentados como atualização incremental;
- `graphify query`, `path` e `explain` consultam `graphify-out/graph.json`; consultas admitem orçamento;
- extração de código é estrutural/local; documentos e mídia podem exigir passagem semântica por modelo;
- `save-result` e `reflect` são comandos independentes, não condição de sucesso de `update`;
- `graphify install` registra skills/instruções nos assistentes e, por isso, fica proibido ao produto.

Fontes: [README oficial](https://github.com/Graphify-Labs/graphify), [distribuição 0.9.53](https://pypi.org/project/graphifyy/0.9.53/).

`0.9.53` é baseline para os testes de contrato, não alegação de compatibilidade já demonstrada. Antes do primeiro uso, o adapter deve provar versão, comandos, esquema de `graph.json`, manifesto, atualização, remoção e consulta. Falha deixa a capacidade `incompatible` e preserva o fallback. Upgrade exige nova versão fixada, lock/hashes e regressão explícita; nunca seguir `latest`.

## Responsabilidades e fronteiras

| Unidade | Responsabilidade |
|---|---|
| `GraphifyProjectionAdapter` | Criar, consultar, atualizar, invalidar e relatar estado por projeto. |
| `GraphifyRuntimeManager` | Provisionar por ação explícita, localizar runtime isolado, conferir versão/lock e executar probe. |
| `GraphifyProcessRunner` | Executar sem PTY/entrada, impor tempo/saída, classificar término e ignorar perguntas finais. |
| `GraphifyCheckpointStore` | Persistir revisão indexada, hashes, versão, estado, geração e contador idempotente de PRs. |
| Política da pipeline | Marcar fundação, observar merges, chamar bootstrap/update e decidir quando consultar. |
| Recuperação F03 | Combinar candidatos Graphify com busca básica, validar fonte/revisão e montar bloco limitado. |
| Manutenção F04 | Aplicar invalidação/expurgo; Graphify implementa sua parte como projeção derivada. |

O adapter não observa GitHub nem escolhe quando o quarto PR ocorreu. A política não interpreta `graph.json`; ela usa somente o contrato do adapter. A busca básica, a memória operacional e a interface não dependem de Graphify.

Estrutura futura proposta, sujeita à conferência da base real antes de implementar:

```text
src/shared/domain/graph-projection.ts          contratos e estados fechados
src/main/memory/graphify/graphify-adapter.ts   implementação do port
src/main/memory/graphify/runtime-manager.ts    runtime isolado e probe
src/main/memory/graphify/process-runner.ts     execução não interativa
src/main/memory/graphify/checkpoint-store.ts   gerações e checkpoints
src/main/memory/graphify/graph-reader.ts       leitura limitada/normalização
```

Não criar IPC/UI nesta fatia. Nomes podem acompanhar convenções reais na implementação, mas as responsabilidades não podem ser fundidas com o adapter de IA ou o conector GitHub.

## Contrato do adapter

Tipos F01/F03 são importados quando aplicáveis; não duplicar suas regras de escopo, revisão, validade ou orçamento.

```ts
type GraphifyProjectionState =
  | 'ready'
  | 'stale'
  | 'updating'
  | 'unavailable'
  | 'incompatible'
  | 'invalid'

interface GraphifyRuntimeIdentity {
  readonly packageName: 'graphifyy'
  readonly version: '0.9.53'
  readonly artifactSha256: string
  readonly adapterProtocolVersion: 1
}

interface GraphifyCheckpoint {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly projectRootFingerprint: string
  readonly defaultBranch: string
  readonly indexedHeadSha: string
  readonly manifestSha256: string
  readonly graphSha256: string
  readonly runtime: GraphifyRuntimeIdentity
  readonly generation: number
  readonly mergedPrsSinceUpdate: number
  readonly state: GraphifyProjectionState
  readonly updatedAt: string
}

interface GraphifyQueryRequest {
  readonly schemaVersion: 1
  readonly requestId: string
  readonly projectId: string
  readonly terms: readonly string[]
  readonly references: readonly string[]
  readonly maxCandidates: number
  readonly maxDepth: number
  readonly maxEstimatedTokens: number
  readonly indexedHeadShaExpected?: string
}

interface GraphifyRelationCandidate {
  readonly candidateId: string
  readonly entity: string
  readonly relation: string
  readonly target: string
  readonly sourcePath: string
  readonly lineStart: number | null
  readonly lineEnd: number | null
  readonly provenance: 'extracted' | 'inferred'
  readonly indexedHeadSha: string
  readonly freshness: 'current' | 'requires_git_delta'
  readonly reason: string
}

interface GraphifyProjectionAdapter {
  probe(projectId: string): Promise<GraphifyProbeResult>
  bootstrap(input: GraphifyMutationRequest): Promise<GraphifyMutationResult>
  update(input: GraphifyMutationRequest): Promise<GraphifyMutationResult>
  query(input: GraphifyQueryRequest): Promise<GraphifyQueryResult>
  invalidate(input: GraphifyInvalidationRequest): Promise<GraphifyInvalidationResult>
}
```

IDs e strings seguem os limites das F01/F03. `terms` admite de 1 a 12 termos; `references`, até 8. Padrões de consulta: 20 candidatos, profundidade 2 e 8.000 tokens estimados. Limites menores concedidos pela política prevalecem. Pedido vazio nunca significa listar o grafo inteiro.

O resultado inclui estado, geração, checkpoint, candidatos, lacunas tipadas e uso: candidatos examinados/devolvidos/descartados, arquivos escolhidos, tokens estimados, expansões, duração e fallback. Campos desconhecidos são `null`, não zero presumido. Texto livre produzido pela ferramenta não atravessa automaticamente ao ContextPack.

## Runtime isolado, instalação e comandos

Instalação é uma ação explícita do operador. O runtime fica no diretório de dados administrado pelo JarvisOS, fora do projeto-alvo e fora do `PATH` como dependência. O instalador usa lock com hashes transitivos e valida o wheel fixado. Não instalar/atualizar Python, Graphify, skills, hooks ou arquivos de assistente silenciosamente.

Comandos lógicos aprovados:

```text
bootstrap: /graphify .
update:    /graphify . --update
query:     consulta limitada sobre graphify-out/graph.json
```

Mapeamentos físicos admitidos pelo probe de `0.9.53`:

```text
<runtime>/graphify update <project-root>
<runtime>/graphify query <question> --budget <n>
<runtime-python> -m graphify ...
```

O adapter escolhe um único mapeamento compatível e o registra. Não alterna para CLI global, backend ou sintaxe diferente durante uma execução. A operação lógica `/graphify` pode ser atendida pelo executor autorizado ou pela CLI headless compatível; em ambos os casos valem o mesmo orçamento, os mesmos artefatos e a mesma validação.

Código pode ser extraído localmente. Passagem semântica sobre documentos só usa executor já autorizado e cobrado pelo plano/política existentes. Ausência desse executor reduz cobertura e fica explícita; não ativa chave/API própria do Graphify nem impede o grafo estrutural.

## Ciclo de vida por projeto-alvo

### Bootstrap

1. A política do projeto aponta explicitamente a fatia de fundação; normalmente F00 ou F01, sem inferir apenas pelo número.
2. Depois do merge e aceite dessa fatia, a pipeline solicita `bootstrap` uma única vez.
3. Projeto importado com fundação existente solicita bootstrap depois da importação e do preflight.
4. Antes da execução, a pipeline acrescenta `graphify-out/` ao `.gitignore` do projeto e comprova que o caminho é ignorado.
5. O executor também exclui `graphify-out/` de descoberta/contexto para não reindexar a saída nem invalidar cache de prompt. Para Claude Code, garantir a entrada em `.claudeignore`; os demais executores aplicam a denylist equivalente no montador de contexto, sem inventar arquivo de configuração não suportado.
6. Somente uma geração integralmente validada recebe checkpoint `ready`.

### Atualização incremental

- Cada PR efetivamente incorporado à branch principal conta uma vez pela chave `(repository, prNumber, mergeSha)`, independentemente de autor, documentação, correção ou automação.
- No quarto merge confirmado após o checkpoint, a política solicita `update`; não solicita novo bootstrap.
- O contador só volta a zero junto da publicação de checkpoint válido. Falha mantém `update_pending`; merges posteriores não perdem a obrigação nem disparam laço ilimitado.
- Pedido explícito pode atualizar antes do quarto PR. Atualização bem-sucedida estabelece novo corte e reinicia o contador.
- Troca de branch sem merge, commit local e PR aberto não contam.

### Consulta antes de explorar

Se `graphify-out/` válido existir, o agente consulta o grafo antes de abrir arquivos para entender arquitetura e fluxos. O grafo localiza; o código-fonte comprova. Entre atualizações, comparar `indexedHeadSha` com o `HEAD` e analisar primeiro o delta do Git. A ausência de grafo usa busca textual restrita, nunca varredura ampla automática.

## Divulgação progressiva e economia de tokens

1. Consultar metadados/relações, sem serializar o grafo completo.
2. Deduplicar candidatos por relação, fonte e intervalo.
3. Selecionar inicialmente até 8 arquivos e apenas os trechos necessários.
4. Conferir alegações exatas no arquivo/revisão atual.
5. Expandir uma etapa por vez, com lacuna e justificativa registradas.
6. Priorizar o delta desde o checkpoint; reutilizar resultados anteriores ainda válidos.
7. Debitar no mesmo orçamento perguntas, respostas, avisos, referências e trechos enviados.
8. Parar quando houver evidência suficiente ou quando a concessão terminar.

Os valores 20 candidatos, 8 arquivos, profundidade 2 e 8.000 tokens são padrões configuráveis, não uma promessa de completude nem teto global. A política de orçamento pode reduzir ou ampliar a concessão. Expansão não cria novo saldo e não pode ser repetida para contornar limites.

Registrar por exploração: revisão indexada, frescor, candidatos descartados, arquivos/trechos carregados, tokens estimados, método de estimativa, expansões, uso de cache e motivo do fallback. Percentual de economia é observação comparativa; não há gate artificial de 84% ou qualquer taxa fixa.

## Execução não interativa

`GraphifyProcessRunner` executa sem PTY, com `stdin` fechado, limite de duração, limite de saída e diretório-alvo canônico. Nunca responde automaticamente a perguntas.

Perguntas, sugestões ou ofertas apresentadas depois da atualização — inclusive sobre o que foi encontrado, salvar resultado ou refletir — são cauda informativa. A pipeline:

- ignora a pergunta e continua o desenvolvimento;
- não cria aprovação, espera humana ou nova tarefa;
- não chama `save-result` nem `reflect`;
- registra apenas `interactive_tail_ignored`, sem copiar a cauda inteira para o contexto;
- encerra o processo após tolerância curta se a pergunta o mantiver aberto.

Exit code zero sozinho não prova sucesso. Geração, manifesto, hashes, revisão e remoções precisam validar. Se o processo for encerrado após a cauda, o resultado só pode ser aceito quando todos os artefatos duráveis já estiverem completos e compatíveis; caso contrário, é falha com fallback.

## Consistência, publicação e concorrência

Há no máximo um writer por projeto. Bootstrap/update usa geração de trabalho isolada; consultas continuam na última geração validada com delta do Git ou usam fallback. Nenhum leitor vê artefato parcial.

Publicação:

1. conferir raiz canônica e lock do projeto;
2. gerar/atualizar em área de trabalho recuperável;
3. validar esquema, manifesto, revisão, hashes e remoções;
4. promover artefatos e checkpoint como uma única troca lógica;
5. liberar lock e manter somente gerações necessárias à recuperação imediata.

Falha antes da promoção descarta a geração parcial. Falha ambígua não avança checkpoint/contador. Reinício reconcilia lock e geração por IDs/hashes; idade do lock não autoriza apagar trabalho de outro processo sem provar ausência do dono.

## Remoção, invalidação e reconstrução

Arquivo removido deve perder seus nós/relações na atualização incremental. Relação de arquivo alterado é substituída pela nova extração; não acumular versões antigas como vigentes. O adapter valida ausência por caminho normalizado e revisão.

Se remoção/expurgo não puder ser comprovado:

- marcar geração `invalid` e parar de consultá-la;
- manter registro/hashes para diagnóstico sem servir seu conteúdo;
- continuar pela busca básica e pelo delta;
- não avançar checkpoint nem declarar cobertura completa.

Reconstrução total é ação explícita e justificada. Não é retry automático de update, resposta a pergunta da CLI nem manutenção periódica. Barreiras de exclusão da F04 prevalecem para impedir que uma reconstrução ressuscite conteúdo excluído.

## Estados, falhas e fallback

| Estado | Uso permitido |
|---|---|
| `ready` | Consultar dentro do checkpoint. |
| `stale` | Consultar e complementar obrigatoriamente pelo delta. |
| `updating` | Consultar última geração válida + delta; nunca a parcial. |
| `unavailable` | Runtime/grafo ausente; usar busca básica. |
| `incompatible` | Versão/comando/esquema recusado; usar busca básica. |
| `invalid` | Não consultar; usar busca básica até ação explícita. |

Erros tipados mínimos: `runtime_missing`, `runtime_version_mismatch`, `command_unsupported`, `manifest_missing`, `schema_incompatible`, `graph_corrupt`, `source_prune_unverified`, `timeout`, `cancelled`, `partial_generation`, `lock_busy` e `budget_exhausted`.

Falha não cria retentativa infinita. A política usa espera limitada e deduplica pelo projeto, operação, revisão e erro. Documento/ADR pendente, Graphify ausente ou pergunta final nunca bloqueiam código. Fallback preserva limites da F03 e relata cobertura reduzida; não declara resultado Graphify vazio como prova de inexistência.

## Estratégia de testes

- **Unitário:** estados, schemas, limites, deduplicação, contador de merges, frescor, orçamento, invalidação e cauda interativa.
- **Contrato simulado:** comandos/artefatos de `0.9.53`, saída desconhecida, timeout, stdin fechado, versão/esquema divergente, remoção e falha parcial.
- **Integração local:** projeto Git temporário, `.gitignore`, bootstrap, quatro merges, delta, lock, geração atômica e reinício.
- **Smoke real opt-in:** runtime fixado em corpus pequeno e determinístico; sem API paga obrigatória. Instalação/provisionamento fica fora da suíte comum.
- **Regressão de tokens:** impede grafo/relatório integral, mede candidatos/fontes/trechos e prova expansão justificada.

Relatório em `docs/test-reports/SPEC-Memoria-05.md`, conforme `docs/TESTING.md`, identifica versão/hashes, ambiente, fixtures, estado inicial/final, comandos lógicos/físicos, consumo, fallback e cenários não executados. Mock não é compatibilidade real; ausência de smoke é `not_run`, nunca aprovação.

## Critérios de aceite

1. [ ] Adapter implementa `probe`, `bootstrap`, `update`, `query` e `invalidate` sem expor o formato Graphify aos consumidores.
2. [ ] Runtime `graphifyy==0.9.53` é isolado, instalado somente por ação explícita e validado por lock/hash; ausência preserva fallback.
3. [ ] Produto não executa `graphify install`, não depende da CLI global e não altera `CLAUDE.md`, `AGENTS.md` ou hooks.
4. [ ] Cada projeto-alvo usa `graphify-out/` próprio, ignorado pelo Git e excluído da descoberta/contexto; Claude Code recebe também `.claudeignore` verificável.
5. [ ] Bootstrap ocorre uma vez após merge/aceite da fatia marcada como fundação, ou após preflight de projeto importado já fundado.
6. [ ] Todo PR incorporado à branch principal conta uma vez; o quarto dispara update incremental e o contador só zera com checkpoint válido.
7. [ ] Atualização usa manifesto/delta e não reconstrói o grafo inteiro automaticamente.
8. [ ] Antes de explorar arquitetura/fluxos, grafo válido é consultado; fonte atual continua sendo a prova final.
9. [ ] Entre checkpoints, consulta combina grafo com delta do Git e nunca apresenta `stale` como `current`.
10. [ ] Consulta inicial limita-se a 20 candidatos, profundidade 2, 8 arquivos e 8.000 tokens, respeitando concessão menor.
11. [ ] Expansão é incremental, justificada, medida e não renova orçamento; grafo/relatórios completos nunca entram no ContextPack.
12. [ ] Resultados preservam fonte/localização/revisão, distinguem `extracted` de `inferred` e são deduplicados.
13. [ ] Uma única atualização escreve por projeto; leitores nunca observam geração parcial e falha preserva a última válida quando seguro.
14. [ ] Pergunta final é ignorada sem resposta/gate; processo não interativo termina ou é encerrado com validação posterior dos artefatos.
15. [ ] `save-result` e `reflect` nunca são chamados; memória/lições continuam nos contratos canônicos da plataforma.
16. [ ] Arquivo removido perde relações; expurgo não comprovado invalida o grafo e impede seu uso.
17. [ ] Reconstrução total exige ação explícita e respeita barreiras de exclusão da F04.
18. [ ] Ausência, incompatibilidade, corrupção, timeout e orçamento esgotado usam busca básica restrita sem bloquear desenvolvimento.
19. [ ] Métricas registram candidatos, arquivos, tokens estimados, expansões, cache/delta e fallback sem prometer percentual fixo.
20. [ ] Testes unitários, contrato, integração e smoke opt-in produzem relatório por SPEC/issue, distinguindo `passed`, `failed` e `not_run`.

## Comandos de verificação da futura entrega

```text
npm run typecheck
npm run lint
npm test
npm run build
npm run test:report:check
```

O smoke Graphify usa runtime/corpus temporários, nunca o checkout de desenvolvimento como prova. O comando exato será registrado pelo probe compatível e no relatório; não instalar dependências para apenas ler esta SPEC.

## Limites de autorização e perguntas abertas

Esta revisão documenta o contrato aprovado em conversa e não instala, executa ou implementa Graphify. O PI aprovou a revisão exata `6f8c7f66c4c582b912f17af462f3f63047ad8382` em 2026-09-01; somente #184 passa de Planejado para Backlog, sem alteração de `next` ou da cadência dos MVPs já aprovados.

Perguntas abertas para esta fatia: nenhuma. Compatibilidade real de `0.9.53` é critério de implementação/teste, não decisão documental pendente. Descoberta de incompatibilidade exige manter fallback e propor mudança de versão em nova revisão, sem escolher silenciosamente outra release.
