# Design — MVP-023: Biblioteca de Blueprints

- Status: **design e quatro SPECs aprovados pelo PI** em 2026-08-31, revisão exata `6a6e702a4d6ced5820d3f4c7674d6278f0b2d391`.
- Fonte de direção: `2026-08-29-pipeline-desenvolvimento-ia-v3-design.md`, Biblioteca de Blueprints.
- Predecessor funcional: MVP-008. Nenhuma dependência dura do MVP-007, MVP-016 ou MVP-024.
- Implementação: não iniciada; aprovações pré-construção preservadas.
- Migração de nome: a proposta V3 antes chamada MVP-017 recebe MVP-023, preservando MVP-017–022 já numerados em main.

## 1. Problema e decisão proposta

Copiar documentos manualmente perde proveniência e tende a carregar decisões de outro produto como se fossem atuais. A biblioteca deve economizar preparação sem tornar template uma especificação aprovada.

Alternativas examinadas:

1. **Cópia versionada para rascunho, recomendada.** Reproduz a origem, permite editar o projeto e utiliza o wizard e os gates já existentes.
2. Herança dinâmica de templates. Evitaria cópias, mas mudanças globais alterariam projetos/gates sem revisão; descartada neste MVP.
3. Marketplace remoto com instaladores. Acrescentaria distribuição, execução e dependências sem requisito; fora da V3 planejada.

## 2. Requisitos rastreáveis

| ID | Requisito e origem |
|---|---|
| B-FR01 | Reutilizar PRD, arquitetura, SPEC, DESIGN-SYSTEM, HTML e perguntas; direção V3 |
| B-FR02 | Instância editável, origem/revisão congelada; integridade documental M8-F06 |
| B-FR03 | Perguntas uma a uma, recomendação e delegação rastreável; M8-F03 |
| B-FR04 | Design após PRD por ato explícito de anexo; M8-F05 |
| B-FR05 | Aprovação não é herdada; somente gates dependentes são invalidados; M8-F06 |
| B-NFR01 | Retomada/idempotência, preservação de trabalho local; Git automático M8-F01 |
| B-NFR02 | Operação local e custo limitado; controle de contexto do MVP-008 |
| B-CON01 | Sem código/instalação, novo provider, regras jurídicas ou autoridade extra de IA |

As SPECs detalham estes requisitos; os limites numéricos são proposta técnica deste pacote, não decisões históricas atribuídas ao PI.

## 3. Fronteiras

`BlueprintCatalog` guarda revisões locais imutáveis; `BlueprintValidator` valida manifesto/schema; `BlueprintInstantiationService` cria um plano de cópia; `BlueprintProjectPort` integra com os donos de projeto, documentos e wizard do MVP-008. O main executa as operações; CLI e renderer são clientes tipados do mesmo serviço.

O catálogo não grava diretamente tabelas do wizard, não cria approval records, não faz Git por novo caminho e não altera `PolicySnapshot`. A indisponibilidade da biblioteca não afeta projetos instanciados nem o fluxo de planejamento sem blueprint.

Destinos planejados: `src/shared/domain/blueprints.ts`, `src/shared/contracts/blueprints.ts`, `src/main/blueprints/`, `src/renderer/features/blueprints/` e testes locais. Persistência usa o armazenamento existente; desenho físico fica na implementação aprovada, sem criar serviço ou banco dedicado.

## 4. Identidade e revisão

- `BlueprintId` identifica família local; `BlueprintRevisionId` identifica conteúdo imutável.
- Manifesto v1 declara nome, propósito, revisão, compatibilidade do contrato de planejamento, artefatos, variáveis tipadas e perguntas aplicáveis.
- Artefato contém papel, path relativo normalizado, SHA-256 dos bytes, tamanho e tipo. Identidade completa não é somente hash.
- Hash lógico usa JSON canônico, ordem ordinal e bytes dos artefatos. Datas/nomes de importação não mudam conteúdo lógico.
- Novo conteúdo gera revisão; descontinuação retira da seleção padrão sem alterar instâncias. Importação igual retorna revisão existente; mesma identidade de revisão com bytes diferentes é conflito.
- Sem `approved`, comandos de terminal, hooks, credenciais ou permissões executáveis no schema. Texto de template é dado, não instrução superior à SPEC.

## 5. Importação e limites propostos

Importação local por diretório explicitamente selecionado, copiado pelo caminho de filesystem permitido. Sem busca automática em home/repositórios e sem download de URLs.

Padrão por pacote: 200 arquivos, 32 MiB totais, 2 MiB por texto e 8 MiB por asset; enumeração e cópia em lotes de 25 arquivos/4 MiB. Roles aceitos são documentos Markdown, perguntas JSON, protótipos HTML e assets tipados já suportados no fluxo de anexos. Arquivos executáveis e roles desconhecidos são rejeitados. Asset de até 8 MiB usa streaming em blocos de no máximo 4 MiB; checkpoint confirma somente arquivo com hash final verificado. Interrupção refaz apenas o arquivo incompleto no staging, sem reduzir o limite de asset ao tamanho do lote.

Validar caminho antes e durante a cópia: sem absoluto, traversal, drive/ADS, dispositivo reservado, colisão por case ou escape por link/reparse point. Raiz selecionada não amplia allowlist. Mudar limites exige configuração explícita compatível com o orçamento local, não varredura ilimitada.

Erro deixa importação como incompleta, invisível à seleção; conteúdo anterior continua intacto. Cancelamento para em fronteira de lote e limpeza só considera staging da operação, identificado no diário.

## 6. Instanciação e wizard

Selecionar revisão fixa e informar projeto/alvo pelo MVP-008 produz `BlueprintInstancePlan` com variáveis, artefatos previstos e resumo de conflitos. A primeira aplicação materializa somente rascunhos. Não escolhe `latest` novamente no meio do fluxo.

- Mesma chave de operação e mesmos argumentos retorna a mesma instância; argumentos divergentes são conflito.
- Não sobrescrever destino preexistente diferente; leitura de revisão esperada e hash precede escrita.
- Variáveis são dados tipados, substituição determinística por papel, sem eval, shell ou expressões arbitrárias.
- Perguntas compatíveis entram como candidatas no grafo do M8-F03; pergunta já respondida não se repete sem mudança material.
- “Decide por mim” deixa autoria da IA, justificativa e revisão; nunca preenche aprovação do PI.
- Ajuda de IA utiliza ContextPack/orçamento do M8-F02; selecionar/copiar template não chama modelo.
- Cópia, persistência e commit não são uma transação fictícia: diário por passo e reconciliação retomam efeitos já confirmados pelo dono de cada operação.

## 7. Anexos e evolução

`DESIGN-SYSTEM.md`, HTML e assets da revisão ficam como **candidatos**. Após o PRD, o PI usa o seletor M8-F05 para anexar a cópia desejada ao projeto. A mera instanciação não cria `AuditEvent` de anexo e não satisfaz o gate.

Atualização de um blueprint não propaga automaticamente. O PI pode comparar revisão de origem, revisão candidata e rascunho atual. Campos/artefatos não editados podem entrar no plano; conflitos de edição recebem decisão explícita, sem perda do conteúdo local. A aplicação cria revisão nova; os donos M8-F05/F06 calculam impacto e carry-forward, sem aprovação copiada.

Projetos já aprovados não são bloqueados por novo template disponível, descontinuação ou falha da biblioteca. Mudanças opcionais ficam em rascunho até seguirem o fluxo canônico.

## 8. Estados e contratos operacionais

Importação: `staging → validated → registered`, alternativos `cancelled | failed`.
Instanciação/evolução: `planned → applying → reconciling → completed`, alternativos `conflict | cancelled | failed`.

O diário grava ID, revisão/hash, projeto, comandos internos e resultados normalizados, sem conteúdo duplicado completo. Uma operação em estado incerto reconcilia pelo ID no dono antes de repetir. Cancelamento depois de um efeito preserva o efeito e relata conclusão parcial; não reseta Git nem apaga o projeto.

Uma mutação ativa por instância, comparação de revisão esperada e fencing do dono. Reinício retoma o mesmo diário. CLI/IPC retorna `operationId` e estado; não depende de janela aberta.

## 9. Interface futura

Catálogo com propósito, revisão e compatibilidade; detalhe com arquivos/variáveis; assistente de instanciação; histórico de origem; comparação de evolução; acesso ao seletor de anexos existente. Estados vazio, carregando, incompatível, conflito, indisponível e operação parcial são requisitos.

Sem criar nova estética neste documento. F04 depende de DESIGN-SYSTEM e HTML formais anexados pelo PI antes da construção visual; o módulo funciona por comandos/serviço sem depender do renderer.

## 10. Fatias, testes e encerramento

- M23-F01: identidade, validação e catálogo — B-FR01/B-FR02, B-NFR02.
- M23-F02: instância e wizard — B-FR02/B-FR03, B-NFR01/B-NFR02.
- M23-F03: anexos/evolução — B-FR04/B-FR05, B-NFR01.
- M23-F04: UI e prova integrada — todos, sem ampliar escopo.

Testes: contratos e hashes, fixtures Windows de paths, SQLite temporário, filesystem temporário, crash entre etapas, duplicação/replay, comparação de aprovação antes/depois e Playwright na jornada visual. Sem rede ou CLI paga para provar cópia.

O planejamento fecha com estas quatro SPECs e suas issues, todas com aceite exato. A construção continua sujeita à fila, sem aceite duplo nem regra jurídica nova. Não há questão estrutural omitida; os anexos visuais são entrega do PI antes da fatia de UI, não artefato fictício deste documento.
