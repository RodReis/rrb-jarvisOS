# SPEC-Aprendizado-06 — Interface, resiliência e prova E2E

- MVP/Fatia: MVP-016 · M16-F06 — fecha o planejamento técnico do MVP-016.
- Issue: [#168](https://github.com/RodReis/rrb-jarvisOS/issues/168).
- Status: **aprovada-pi** em 2026-08-31, revisão exata `6a6e702a4d6ced5820d3f4c7674d6278f0b2d391`.
- Depende de: M16-F05 concluída; predecessor direto [#167](https://github.com/RodReis/rrb-jarvisOS/issues/167).
- Design: `docs/superpowers/specs/2026-08-29-mvp-016-aprendizado-operacional-design.md`.
- Implementação: não iniciada; o aceite habilita o Backlog, sem alterar `next` ou a fila. Antes da construção da interface, anexar e aprovar `DESIGN-SYSTEM.md` e protótipos HTML formais, conforme requisito do PI já existente.

## Objetivo

Entregar ao PI uma visão verificável de falhas recorrentes, hipóteses, experimentos e políticas, com decisões pontuais e recuperação explicável. Provar que a jornada completa preserva qualidade, idempotência, snapshots e autoridade sob carga, falha e concorrência. A UI não é outro motor de aprendizado e sua indisponibilidade não trava a pipeline.

## Premissas e alternativas resolvidas nesta proposta

- Integrar um console de aprendizado contextual ao MVP-015, reutilizando navegação e seleção de projeto. Não alterar as ações permitidas no console de observabilidade: comandos de aprendizado pertencem à porta desta fatia.
- Recomendação: quatro superfícies fixas — resumo, candidatas, falhas recorrentes e políticas — com detalhe lateral/página conforme o Design System. Dashboard arbitrário ou console separado duplicariam estado e investigação sem requisito aprovado.
- Pop-up aparece somente quando há decisão material já exigida ou ação explícita do PI, com uma pergunta e suas consequências. Não criar confirmação em cada etapa, segundo aceite de execução ou aprovação de fallback técnico.
- A referência visual do produto ajuda a navegação, mas não substitui `DESIGN-SYSTEM.md`/HTML formais. Esta SPEC define comportamento e contrato verificável; não afirma que anexos estejam presentes/aprovados nem entrega UI disfarçada de planejamento.
- Gate visual é requisito de construção fornecido pelo PI; não impede encerrar documentação, organizar issues e revisar o PR de planejamento.

## Dentro e fora

Dentro: projeções paginadas comuns a UI/CLI; ponte tipada; console em pt-BR; consulta/histórico/explicação/exportação mínima; decisões e comandos pelo serviço canônico F03/F04; `Decide por mim`; estados incompletos; reconexão; acessibilidade; concorrência/crash/carga; E2E F01–F05 e evidência final.

Fora: novo mecanismo de promoção, budget, aprovação ou autenticação; trocar provider ou comprar crédito; iniciar/repetir run, Git, merge, deploy ou compensação pelo console; treinamento/fine-tuning; memória/RAG MVP-007; comparação/ranking de projetos; sincronização externa; mostrar payload bruto; implementar produto nesta tarefa documental.

## Stack e destinos planejados

Reutilizar React/TypeScript, Electron IPC/preload/main, componentes do Design System aprovado, SQLite local e ferramentas de teste já existentes. Não adicionar framework visual, serviço externo ou banco.

- `src/shared/contracts/learning-query.ts`: filtros, páginas, snapshots, deltas e resultados de comando.
- `src/main/learning/learning-query-service.ts`: única consulta normalizada para UI/CLI.
- `src/main/learning/learning-command-service.ts`: tradução de intenção para F03/F04, com identidade e revisão esperada.
- `src/main/learning/learning-cli.ts`: consultas read-only pelo mesmo serviço; sem acesso direto ao banco.
- `src/renderer/src/learning/LearningConsole.tsx` e módulos próximos: quatro superfícies, detalhes, estados, histórico e decisão.
- `src/renderer/src/learning/useLearningProjection.ts`: snapshot/delta, cancelamento e troca de projeto.
- Ponte mínima em contratos IPC, preload e handlers existentes; renderer não recebe SQLite nem shell genérico.
- `tests/fixtures/learning/`, `tests/performance/learning-load.ts`, `tests/e2e/learning.e2e.ts`: fixtures, carga e prova integrada futura.
- `reports/SPEC-Aprendizado-06.md` e `reports/TESTS.md`: resultados da implementação futura, sem preencher como PASS durante planejamento.

## 1. Leitura comum e consistente

Consultar apenas o projeto selecionado e políticas globais elegíveis para ele, conforme F03. Global local não expõe dados/paths de outros projetos. Filtros reconhecidos: período, SPEC, run, assinatura/ocorrência, candidata/experimento, mecanismo, estágio, resultado, estabilidade e cobertura. Filtro desconhecido falha no schema, sem linguagem arbitrária de consulta.

```ts
interface LearningQueryContext {
  readonly projectId: string
  readonly requestId: string
  readonly expectedProjectionVersion: number | null
}

interface LearningProjectionPage<T> {
  readonly items: readonly T[]
  readonly projectionVersion: number
  readonly observedAt: string
  readonly coverage: 'complete' | 'partial' | 'unknown'
  readonly nextCursor: string | null
}

type LearningCommandResult =
  | { readonly status: 'applied'; readonly commandId: string; readonly decisionRef: string }
  | { readonly status: 'already_applied'; readonly commandId: string; readonly decisionRef: string }
  | { readonly status: 'conflict' | 'unavailable' | 'rejected'; readonly reasonCode: string }
```

Cursores opacos vinculam projeto, filtros, ordenação, versão de projeção e último identificador; empate usa ID estável. Página padrão 50 itens, máximo 100, resposta normalizada de até 256 KiB. Item excessivo retorna erro/diagnóstico, não truncamento oculto de prova. Consulta não carrega o acervo inteiro para filtrar em memória.

Snapshot informa versão, fonte, idade, cobertura, estado do aprendizado e referências. Delta só aplica à versão imediatamente anterior do mesmo projeto/filtro. Salto, duplicata incompatível, cursor vencido, troca de projeto ou reconexão descarta a cadeia parcial e solicita novo snapshot. Resposta atrasada de projeto anterior nunca aparece como atual. Lista de até 1.000 itens carregados por visão; para navegar além, substituir páginas pelo cursor, sem acumulação ilimitada no renderer.

UI e CLI usam o mesmo resultado normalizado em filtro/versão equivalentes; só formatação difere. Exportação contém filtro, período, revisão, contagens, cobertura e referências sanitizadas. Não exportar prompt, resposta, logs, diffs, segredo ou configuração de outro projeto. Exportação integral é paginada com corte declarado; mudança que invalide o corte interrompe com motivo, sem misturar revisões silenciosamente.

## 2. Quatro superfícies

| Superfície | Informação prioritária | Ações e limites |
|---|---|---|
| Resumo | Saúde/atualização/cobertura, recorrências, experimentos em curso, políticas ativas versus estáveis, consumo conhecido. | Atualizar, filtrar, navegar para detalhes; sem score opaco ou economia inventada. |
| Candidatas | Hipótese, alteração exata, baseline, alcance, aplicabilidade, estágio, amostra, prazo, guardrails, ganho/overhead e decisão necessária. | Inspecionar provas, propor avaliação ou decidir dentro da autoridade existente; draft não é ativa. |
| Falhas recorrentes | Ocorrências atuais, repetição versus recorrência, tentativas, resoluções comprovadas, compatibilidade e sugestões incertas. | Abrir prova/fluxo proprietário; não fechar falha ou aprovar associação sem prova determinística. |
| Políticas | Projeto/global/base, pacote/versão/hash, composição/grupo, transições, estabilidade, alcance em novos runs e recuperação. | Inspecionar snapshot e solicitar reversão/kill-switch pelo serviço proprietário; sem editar snapshot histórico. |

Detalhe explica “o que mudou”, “por que foi sugerido”, “o que a evidência permite concluir”, “onde se aplica” e “como voltar”. Métricas mantêm unidades e distinção medido/estimado/desconhecido; zero requer origem. Economia de assinatura não aparece em USD. Percentual só existe com numerador/denominador verificáveis; baseline zero segue a regra da F04.

Prova ausente/hash divergente permanece visível como lacuna. Histórico de decisão não some porque uma evidência expirou; a UI diferencia decisão registrada de elegibilidade atual para repetir/promover. Associação da IA tem rótulo consultivo e não é apresentada como causa raiz comprovada.

## 3. Decisões do PI, comandos e Decide por mim

Comandos aceitos são intenções tipadas sobre entidades existentes: registrar decisão de candidata/contrato quando já exigida; solicitar início/encerramento de avaliação permitida; pedir reversão de política ou alterar o kill-switch do aprendizado pelo seu dono. F03/F04 verificam autoridade, elegibilidade, base, provas e controles atuais; renderer nunca envia simples `approved: true` como comprovação suficiente.

Uma decisão mostra candidata/contrato e revisão/hash exatos, contexto, recomendação com justificativa/provas, alternativas válidas e consequências. Uma pergunta por vez. A submissão única registra escolha ou delegação limitada e referencia a autoridade existente; a UI não acrescenta nova confirmação para aplicar a mesma decisão. Falta de autoridade mantém a proposta consultiva e explica o requisito já existente, sem inventar um gate.

`Decide por mim` significa escolher entre alternativas já apresentadas e dentro do escopo explicitamente delegado pelo PI. Registrar alternativas/revisões elegíveis, critério/recomendação, escolha efetiva e vínculo da delegação. Se nenhuma alternativa for elegível, retornar motivo em vez de inventar opção. A delegação não aprova SPEC nova, muda regra de produto, aumenta gasto, pula estágio da F04 ou concede autorização permanente.

Cada comando possui `commandId` idempotente, projeto, alvo/revisão esperados, intenção e referência da autoridade/decisão quando exigida. Mesmo ID/payload devolve decisão original; ID igual com payload divergente é conflito. Revalidar controle vivo e base no ponto de confirmação canônica. Tela antiga não sobrescreve revisão nova; conflito atualiza o detalhe e explica a mudança. Revisão materialmente diferente é outra decisão, não aceite repetido da versão antiga.

Falha de transporte após envio deixa estado “resultado a confirmar”; reconcilia por `commandId` antes de reenviar. Não marcar promoção/reversão concluída por clique ou notificação otimista. O resultado confirmado vem do serviço F03/F04; indisponível não significa rejeitado nem sucesso.

Promoções automáticas autorizadas aparecem em trilha separada, com regras/provas, janela de estabilização e reversão. Ativa não significa estável. A UI não pede PI para cada promoção automática já permitida nem assume que uma escolha anterior vale para revisão nova.

Rollback atua na política de novos runs/grupo compatível. Não restaura banco, desfaz Git/deploy nem troca snapshot do run em andamento. Kill-switch permanece controle vivo; pontos seguros/fallback são dos proprietários, com planejado e efetivo distinguidos na tela.

## 4. CLI e fronteira do console

CLI de aprendizado é read-only: resumo, candidatas, falhas, políticas, histórico e exportação paginada. Reutiliza o transporte/serviço local escolhido pelo projeto e schemas da seção 1; não abre SQLite fora do main, aceita SQL arbitrário nem expõe command shell. Nomes finais do executável seguem o empacotamento existente, sem instalar ferramenta adicional nesta fatia.

O MVP-015 permanece read-only para operações proprietárias; adicionar o console de aprendizado não amplia suas ações. Links para execução, revisão ou release abrem seus fluxos existentes, sem efeito automático de iniciar/repetir trabalho. Pular da UI para CLI não contorna decisão, quota ou gate.

## 5. Estados, UX e artefatos visuais

Cobrir loading, vazio inicial, sem resultados pelo filtro, backfill, cobertura parcial, dado desconhecido, evidência perdida, candidata inconclusiva/stale, experimento aguardando capacidade, canário, estabilização, regressão, reversão pendente/falha, executor opcional ausente, cache/grafo indisponível, armazenamento degradado e reconexão.

Cada estado mostra causa conhecida, atualização e ação mínima válida; desconhecido não ganha percentual/verde de sucesso. “Aprendizado indisponível” informa fallback estável/base e não oferece reexecutar pipeline como reparo. Onde o armazenamento canônico do run falhar, mostrar o estado proprietário, sem alegar que o run continua normal.

Texto em pt-BR, estados com texto/ícone além de cor, foco previsível, modais acessíveis por teclado, devolução de foco ao invocador e anúncio de resultado. Não roubar foco com delta. Resumo acessível de tabela/gráfico conserva valores/unidades; animação não é necessária para compreender estado e respeita redução de movimento. Largura reduzida mantém ação/decisão/prova visíveis sem rolagem horizontal obrigatória do conteúdo principal.

Antes da construção, `DESIGN-SYSTEM.md` define componentes/tokens/estados; protótipos HTML formais cobrem as quatro superfícies, detalhe, decisão/`Decide por mim`, estados críticos, desktop/largura reduzida e teclado/foco. Registrar arquivos/hash e aceite visual existente na issue de implementação. Esta SPEC não substitui anexos nem considera os screenshots históricos prova do gate; não é necessário anexá-los para concluir este planejamento.

## 6. Resiliência e concorrência integrada

| Falha injetada | Invariante esperada |
|---|---|
| Crash em ingestão/registro/decisão/alocação/snapshot | Checkpoint/intenção e efeito confirmam conforme seus donos; retomar sem duplicar observação, amostra, comando ou run. |
| Evento duplicado, atrasado, corrigido ou fora de ordem | Mesmo conjunto causal converge; correção preserva histórico e reavalia validade, sem ressuscitar experimento encerrado. |
| Fonte ausente, hash divergente, índice perdido | Cobertura explícita e fallback; rebuild não fabrica prova nem apaga política/snapshot. |
| Assistência, Graphify/Caveman ou cache ausentes/lentos | Estratégia-base e geração determinística continuam; sem chamada/gasto oculto ou promoção sem prova. |
| Duas promoções/reversões e comando obsoleto | Revisão esperada serializa o grupo; resultado original idempotente, sem sobrescrever versão concorrente. |
| Kill-switch/quota/cancelamento durante avaliação | Controle vivo prevalece no ponto canônico; snapshot não é autorização congelada. |
| Perda de delta, renderer reiniciado, troca de projeto | Novo snapshot válido, sem mistura de projetos/revisões e sem repetir comando confirmado. |
| Relógio avançado/retrocedido | Critérios temporais não ganham estabilidade por adivinhação; reconciliação conforme F04. |
| Falha de rollback ou armazenamento | Diagnóstico correto, fallback proprietário quando possível e ausência de falso sucesso; nenhum efeito Git/deploy de compensação. |

Testar desligamento do catálogo com novo run usando estável verificável/base e retomada de run antigo pela cópia própria. Corrupção do snapshot antigo não pode ser “corrigida” aplicando política atual. Retenção/proteção/rebuild concorrentes com experimento mantêm amostras protegidas, versões e decisões conforme F01/F04.

O console não é pré-requisito para ingestão, experimento ou execução normal. A indisponibilidade do aprendizado impede apenas promoção experimental sem prova; pipeline segue o contrato-base. Não chamar isso de sucesso se a própria persistência do run estiver indisponível.

## 7. Volume e medição reproduzível

Fixture local determinística proposta: 100 mil observações, 10 mil ocorrências, mil candidatas, cem experimentos e dez mil snapshots de runs, distribuídos entre projeto selecionado e projeto-sentinela para testar escopo; pelo menos duas composições acopladas e uma independente. Dados sintéticos, seed fixa, sem segredo/rede externa. Preservar os limites operacionais F01–F05; F06 não aumenta capacidade para “passar carga”.

No ambiente de referência documentado: consultas principais paginadas com `p95 ≤ 500 ms`; console útil com resumo/estado em até 2 segundos; alteração já confirmada no serviço refletida em até 1 segundo com conexão local saudável. Esses objetivos herdam a escala do console MVP-015, agora verificada com o conjunto de aprendizado. Não são promessa de tempo de modelo/Internet.

Relatório registra CPU/memória/disco, SO/runtime/versões, commit, seed, contagens, tamanho do banco, estado frio/quente, warm-up e número de repetições. Para consultas, cinco warm-ups e ao menos trinta amostras medidas por operação, mantendo mediana/p95 e máximos. Medição de abertura inclui carregamento necessário, não exclui o custo invisivelmente. Ambiente CI diferente registra diferença; não comparar percentil de máquinas distintas como regressão causal comprovada.

Carga simultânea de ingestão/consulta não pode congelar UI/main nem gerar fila ilimitada; coletar backlog, pico de memória e duração dos lotes, além de latência. Limite violado gera falha reproduzível e investigação localizada, sem otimização arbitrária, remoção de cenário ou aumento silencioso do teto.

## 8. Jornada E2E e evidência de encerramento

Uma prova determinística percorre: run-raiz termina com falha → ação com validação correspondente prova resolução → recorrência compatível preserva história → recomendação vira candidata draft → replay e shadow → canário com controle contemporâneo e amostra/perfil exatos → promoção elegível → novo run recebe snapshot → tempo **e** nova amostra comprovam estabilização → regressão posterior retira exposição → rollback conserva snapshot antigo e fallback do grupo.

Usar relógio controlado para janelas e registros independentes suficientes para amostras F04; não clicar “aprovar tudo”, falsificar avaliações ou repetir o mesmo run como população nova. Instanciar núcleo real F01–F05, main/preload/IPC/renderer reais na prova Electron; simular somente executores/providers/efeitos externos e seus resultados normalizados. Sentinelas falham se replay/shadow/UI tentarem Git, deploy ou gasto real.

Outra jornada cobre evidência insuficiente/inconclusiva, resposta assistida inválida, `Decide por mim` limitado, comando duplicado, revisão conflitante, perda de delta e componentes opcionais ausentes. Confirmar UI/CLI equivalentes e pipeline-base independente do console. Cada correção encontrada na prova recebe teste de regressão e referência à descoberta anterior, conforme `docs/REVIEW.md`.

Smoke real opcional usa projeto/recursos de prova e rota já autorizada; não produção, compra de créditos ou efeitos implícitos. Ausência de credencial/artefato visual/serviço real é `not_run` no cenário correspondente, nunca `pass`. A suíte simulada não vira evidência de integração real do provider. Registrar, quando realizado, executor/modelo/versão/rota, consumo, IDs e hashes sem segredos.

## Comandos de verificação da implementação futura

```text
npm run typecheck
npm run lint
npm test
npm run build
npm run test:prova
npm run test:report
npm run test:report:check
```

Comandos pertencem ao projeto; não foram executados como teste de produto nesta redação. Arquivos de prova planejados devem ser incluídos na configuração de testes correspondente durante implementação, sem criar comando que aponte para suíte vazia. Distinguir teste comum, prova visual local, carga e smoke externo.

## Critérios de aceite

1. UI e CLI consultam o mesmo serviço paginado; mesmo projeto/filtro/versão produz dados equivalentes sem acesso SQLite pelo renderer/CLI.
2. Limites de 50/100 itens, 256 KiB por resposta e mil itens carregados são respeitados; cursor inválido não retorna combinação silenciosamente inconsistente.
3. As quatro superfícies explicam hipótese, baseline, evidência, alcance, estágio, resultado, estabilidade e reversão, com navegação até origem/revisão.
4. Desconhecido, estimativa, zero medido, cobertura parcial e evidência perdida aparecem distintos; assinatura não recebe USD ou economia fictícia.
5. Snapshot/delta com salto, duplicata incompatível, troca de projeto ou reconexão recupera visão coerente e descarta resposta atrasada de outro contexto.
6. Comandos usam schema fechado, identidade, revisão esperada e serviço proprietário; renderer não ativa política por flag nem calcula elegibilidade como fonte canônica.
7. Uma decisão material usa uma pergunta, recomendação, alternativas, consequências e revisão exata; não há aceite duplicado para aplicar a mesma decisão.
8. `Decide por mim` registra escolha/delegação limitada entre alternativas elegíveis; não aprova SPEC, muda regra, aumenta gasto ou pula experimento.
9. Comando repetido retorna resultado original; transporte incerto reconcilia identidade antes do retry e conflito não sobrescreve a versão atual.
10. Promoção automática autorizada é auditável sem pop-up novo; ativa/estável são distintas e rollback mantém política/snapshot histórico e controles vivos.
11. Console/CLI não iniciam run/Git/deploy/compensação, alteram provider/budget ou ampliam ações do console de observabilidade.
12. Loading, vazio, parcial, stale, inconclusivo, indisponível, regressão e falha de reversão possuem causa/idade/próxima ação sem sucesso presumido.
13. Gate visual é comprovado por `DESIGN-SYSTEM.md`/HTML e aceite antes da construção; navegação, foco, teclado, contraste e largura reduzida são testados contra os artefatos, não presumidos nesta SPEC.
14. Crash, evento permutado/corrigido, clock skew e concorrência convergem ou ficam degradados com motivo, sem duplicar run/amostra/decisão nem resetar limites/janelas.
15. Catálogo, cache, grafo e assistência ausentes mantêm fallback-base; perda do snapshot canônico não é mascarada consultando política atual.
16. Retenção/rebuild concorrentes preservam amostras protegidas, políticas, decisões e snapshots; fonte perdida não é inventada como prova.
17. Fixture declarada satisfaz consultas `p95 ≤ 500 ms`, console útil ≤ 2 s e atualização local ≤ 1 s no ambiente registrado, com amostras/warm-up e backlog/memória reportados.
18. E2E usa núcleo F01–F05 e ponte/UI reais, com efeitos externos fake, percorrendo falha/resolução/recorrência, candidata, estágios, promoção, estabilização e reversão sem atalhos de prova.
19. Suíte comum não gasta nem depende de CLI autenticada; smoke real ausente é `not_run`, e testes-sentinela detectam efeitos externos indevidos.
20. Relatório da SPEC e `reports/TESTS.md` vinculam cada critério ao commit/ambiente/prova, distinguem pass/fail/not_run e só declaram MVP entregue após resultados reais, sem tratar planejamento como implementação.

## Limites e revisão

- **Sempre:** contratos canônicos, evidência explícita, decisões idempotentes, estados honestos, teste de falha e revisão sobre o delta/achados anteriores.
- **Consultar a SPEC:** nova ação, autoridade, superfície, contrato, limiar ou cenário de prova; ajuste técnico compatível não exige aceite duplicado.
- **Nunca:** transformar UI em motor paralelo, inventar métrica/aprovação, ocultar falha ou bloquear desenvolvimento pela ausência de aprendizado.

Redação técnica completa e aceita pelo PI na revisão exata registrada no cabeçalho. Os artefatos visuais antes da construção permanecem evidências a obter. Concluir esta SPEC/issue/PR documental não conclui a implementação do MVP-016.
