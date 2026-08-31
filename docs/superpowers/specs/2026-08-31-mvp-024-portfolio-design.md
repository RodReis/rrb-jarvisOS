# Design — MVP-024: Gestão de Portfólio

- Status: **rascunho-completo** (2026-08-31); conclusão documental solicitada pelo PI, sem implementação nem aceite automático das novas SPECs.
- Fonte de direção: `2026-08-29-pipeline-desenvolvimento-ia-v3-design.md`, Gestão de Portfólio.
- Predecessores funcionais: MVP-012 e MVP-015; planejamento é lido pelos contratos existentes do MVP-008.
- Migração de nome: a proposta V3 antes chamada MVP-018 recebe MVP-024; o MVP-018 do Command Center conserva número, escopo e issues.

## 1. Problema e decisão proposta

Uma tela com projetos pode sugerir controle, mas seria incorreta se reordenasse cópias da fila ou somasse quotas compartilhadas. Portfólio deve projetar fontes canônicas e enviar intenções ao dono, sem duplicar sua lógica.

Alternativas:

1. **Projeção e fachada de comandos existentes, recomendada.** Mantém scheduler, gates e ledger como autoridades.
2. Segundo scheduler de portfólio. Causaria dupla aquisição e conflito de prioridade; descartado.
3. Painel exclusivamente passivo. Não atende à prioridade explícita do PI; a leitura é passiva, mas os controles usam comandos do scheduler, não decisão do painel.

## 2. Requisitos rastreáveis

| ID | Requisito e origem |
|---|---|
| P-FR01 | Vários projetos e prontidão de planejamento; direção V3/MVP-008 |
| P-FR02 | Fila global e prioridade do PI; direção V3/M12-F01 |
| P-FR03 | Custo/quota por projeto quando atribuível; direção V3/M15-F02 |
| P-FR04 | Explicar espera, capacidade, pausa e retomada; scheduler MVP-012 |
| P-NFR01 | Idempotência, revisão esperada e retomada sem dupla execução; M12 |
| P-NFR02 | Fonte/qualidade/idade explícitas e degradação isolada; M15 |
| P-CON01 | Não criar gate, segunda fila/contabilidade, compra ou regra de domínio |

Limites operacionais abaixo são proposta deste pacote, não mudança silenciosa dos limites do scheduler ou do orçamento aprovado.

## 3. Fronteiras e fontes de verdade

`PortfolioQueryService` combina o catálogo de projetos, o planejamento M8, os snapshots M12 e o serviço de consulta M15. `PortfolioCommandFacade` valida identidade/revisão da intenção e delega ao comando canônico. O scheduler continua único autor de elegibilidade, ordem efetiva, leases e dispatch; BudgetPolicy/Ledger seguem donos de gasto/reserva.

Destinos planejados: `src/shared/domain/portfolio.ts`, `src/shared/contracts/portfolio.ts`, `src/main/portfolio/`, `src/renderer/features/portfolio/`. Persistir somente índices/cursors reconstruíveis e recibos de intenções necessários; sem nova cópia canônica de projetos, fila, aprovações, custos ou quotas.

Releases e aprendizado enriquecem detalhe quando disponíveis, mas não se tornam dependências novas do catálogo. Blueprints, Graphify e MVP-007 não são requisitos.

## 4. Identidade, revisões e prontidão

- Identidade `userId + workspaceId + projectId` vem da sessão/registro autorizado; nome, diretório e URL não são chave.
- Cada consulta retorna `snapshotId`, `observedAt`, fontes com revisão/idade, cobertura e razões. O snapshot composto não finge transação entre fontes.
- Readiness distingue: `planning_incomplete | awaiting_pi | ready | running | paused | waiting_dependency | unavailable`, acompanhado dos motivos canônicos. São projeções de apresentação, não novo gate.
- “Ready” requer fontes obrigatórias atuais e gates da revisão exata; falta de dado é desconhecida, nunca aceite implícito.
- Antes de executar comando, o proprietário revalida estado vivo; a tela não confere autoridade porque estava verde.
- Selecionar/excluir da vista não registra/remove projeto. Arquivamento segue o dono do catálogo; não apaga fontes/execuções.

## 5. Consultas e limites

Listagem padrão de 25 projetos, máximo 100 por página, com cursor opaco que fixa filtro/ordem e revisão do índice. Página de filas tem o mesmo limite; ordenação estável por campos declarados e ID como desempate. Cursor inválido/expirado exige reinício, sem repetir linhas como se completas.

Atualização por eventos existentes e reconciliação limitada; manual “Atualizar” deduplica consulta em curso. Fonte externa é consultada pelo M15, nunca diretamente por cada linha. Padrão de observação do painel: no máximo uma atualização por 5 s com janela ativa, sem polling em janela fechada; isso não aumenta cadência de provedores M15.

Cache de apresentação com TTL de 30 s, máximo 100 snapshots/16 MiB por sessão; respostas trazem idade mesmo em cache. Timeout de composição 2 s entrega parcial tipada com campos indisponíveis; cancelar uma consulta não cancela run. Nenhum valor de cache determina dispatch ou orçamento.

## 6. Prioridade e pausa

O PI com sessão válida pode enviar `setPriority`, `pauseAdmissions` e `resumeAdmissions` por projeto. A fachada usa apenas parâmetros de prioridade e controle aceitos pelo scheduler vigente; não inventa escala concorrente nem converte arrastar cartão em aprovação.

Intenção contém `operationId`, chave idempotente, projeto, comando, revisão canônica esperada e autoria. Mesmo comando/chave retorna recibo original; conteúdo diferente conflita. Concorrência é resolvida por comparação no proprietário; o cliente mostra estado novo e não reaplica intenção obsoleta silenciosamente.

- Prioridade afeta admissões futuras, respeitando fairness, dependências, precedência explícita e gates M12.
- Pausa bloqueia novas admissões; não mata run adquirido nem o remove da contagem.
- Retomar remove somente a pausa; não força aquisição ou ignora quota.
- Run ativo não muda de executor/política por reordenar projeto.
- Não alterar capacidade global, cotas, `next`, SPEC, estado de aprovação ou alocação de orçamento nesta fatia.
- Cancelamento de run continua pelo comando operacional existente, fora deste conjunto de controles; não é sinônimo de pausa.

Dispatch do comando: `accepted → forwarding → applied | rejected | reconciling`. Timeout após envio consulta recibo canônico antes de retry, sem prometer aplicação e sem enviar outro ID. Se o dono não oferece idempotência/consulta de recibo, o contrato é adicionado ao próprio dono na implementação desta fatia, não substituído por retry cego no painel.

## 7. Custos, quotas e capacidade

Custo por projeto vem do ledger sob filtro idêntico de período/moeda/modo. Total confirmado, estimativa, reserva e desconhecido permanecem separados. Não somar moedas nem misturar assinatura em preço por chamada. Períodos são intervalos UTC semiabertos, com timezone só para exibição.

Quota contratada compartilhada permanece por `provider + profileFingerprint + mode + windowId`. Projetos usuários apontam para o mesmo snapshot; não duplicar saldo ao totalizar. Exibir uso atribuível a projeto somente quando a fonte/ledger fornecer essa atribuição; ausência de rateio é “compartilhada/não atribuída”, não zero.

Janelas de 5 h, semanal e créditos não são somadas. Snapshot obsoleto conserva observação/qualidade; falta de fonte do Claude permanece `quota_unknown`. Portfólio não raspa UI nem compra crédito e não muda fallback de executor.

Capacidade e motivo de espera vêm do scheduler: slots, leases, limites por projeto/executor e indisponibilidade. Total potencial não promete início. Falta de medição não cria reserva nem regra de bloqueio; o mecanismo canônico decide conforme sua política existente.

## 8. Falhas e recuperação

Uma fonte lenta degrada somente campos/projetos dependentes. Dados antigos podem ser exibidos como antigos, mas não são utilizados para confirmar comando. Rebuild dos índices reconsulta os donos por páginas e publica nova geração quando íntegra; geração anterior continua explicitamente desatualizada até a troca.

Nenhuma falha da projeção impede a fila, o planejamento ou consultas operacionais originais. Falha do banco canônico segue seu tratamento real; não afirmar que uma projeção mascara perda da fonte. Eventos duplicados/fora de ordem não regridem revisão já vista.

Comando sem confirmação fica pendente de reconciliação, visível pelo mesmo ID, inclusive após reinício. UI fechada não cancela intenção já entregue. Cancelar intenção ainda não enviada é permitido; depois do envio exige reconciliar, não fingir rollback.

## 9. Interface futura

Lista de projetos com próxima fatia, gate pendente, espera, prioridade e atividade; detalhe com origem/idade; visão global da fila; custos e quotas compartilhadas; recibos de controles. Links abrem os consoles canônicos para run, release, aprendizagem e aprovações.

Estado parcial, desconhecido, vazio, offline, conflito e comando em reconciliação são jornadas obrigatórias. F04 depende de DESIGN-SYSTEM e HTML formais do PI; nenhum screenshot antigo ou este texto é declarado anexo aprovado.

## 10. Fatias e encerramento

1. M24-F01, catálogo/prontidão: P-FR01, P-NFR02.
2. M24-F02, prioridade/controles: P-FR02/P-FR04, P-NFR01.
3. M24-F03, custos/quotas: P-FR03/P-FR04, P-NFR02.
4. M24-F04, console/resiliência: jornada integrada, sem novas decisões de produto.

F01 depende de M12-F05 e M15-F04; F02 acrescenta contrato M12-F01 e F03 M15-F02 já existentes. F02/F03 não dependem entre si; F04 depende das duas. Ordem de publicação não cria dependência de Blueprints.

Testes demonstram quatro projetos, fairness preservada, pausa seletiva, retry de comando, ledger conciliado, quota compartilhada contada uma vez e falha isolada de fonte/painel. O planejamento fecha com quatro SPECs; execução mantém aceite de MVP/SPEC na entrada, sem nova aprovação pós-construção.
