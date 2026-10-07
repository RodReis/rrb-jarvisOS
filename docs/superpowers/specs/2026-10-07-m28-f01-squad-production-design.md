# Desenho — Composição de produção do Squad na M28-F01

- **Data:** 2026-10-07
- **Fatia:** M28-F01 / SPEC-Execucao-01 / issue #370
- **Estado:** desenho aprovado pelo PI em conversa em 2026-10-07; implementação autorizada.
- **Base normativa:** `spec-execucao-01-quadro-play-pr-merge.md`, `spec-squads-03-workers-isolados.md`, `spec-squads-04-revisao-independente.md`, ADR-006 e `spec-pipeline-01-politica-pr-ci.md` (Emenda E1).

## Problema e limite

O quadro, o IPC e as validações do Play já existem, mas `QuadroExecucaoService` recebe o executor por uma dependência opcional. O bootstrap ainda não a fornece. O caminho de produção existente (`EncadeadorDeRuns` → `EntregaService` → `ConstrutorService`) executa o fluxo legado, não o Squad da ADR-006. A UI recusar antes de criar um run é o comportamento correto até esta composição existir.

Esta entrega liga a seleção do PI ao Squad real, persiste transições para o quadro reconstruir após reinício e encaminha o commit aprovado pelo ciclo para o fluxo de PR/MERGE monitorado pela F01. O selo “Aguardando PI” e decisões/aprovações auditadas no card permanecem na F02 (#126). A geração do `ci-profile.json` e a escolha de stack Node/Python no app fazem parte desta F01 conforme a decisão do PI; o perfil validado e sua revisão aprovada fornecem os comandos de TESTE.

## Alternativas avaliadas

1. **Compor o Squad agora em F01 (escolhida):** usa os serviços já entregues, completa o adaptador de produção, e preserva o fluxo de Play e a evidência no ledger. Esforço maior nesta fatia, mas entrega RF-014.1 e os critérios positivos da SPEC.
2. **Manter Play recusado e transferir a composição:** conserva a segurança no curto prazo, mas deixa o critério central da F01 sem entrega e exige nova fatia aprovada antes de habilitar Play.
3. **Chamar o encadeador legado como fallback:** reduz trabalho, porém executa outro fluxo e apresenta falsamente uma equipe no quadro. Recusada por violar a integridade da evidência e a ADR-006.

## Arquitetura proposta

### Caminho de execução

O bootstrap compõe um `OrquestradorDeExecucaoDoSquad` injetado em `QuadroExecucaoService.executar`. Ele é o único caminho de produção do Play nesta F01; não chama `EncadeadorDeRuns` nem seu slot global. A validação já feita pelo quadro continua fail-closed antes da criação de qualquer run. Após validar SPEC, issue, MVP, repositório/branch, snapshot do perfil do Squad e `ci-profile.json`, o orquestrador cria o run e registra o estado inicial no ledger/fila. A mesma unidade de execução mantém `runId`, `sliceId`, workspace, revisão base, snapshot de equipe, objetivo, plano validado e sinal de cancelamento correlacionados.

O serviço de planejamento resolve o plano a partir do snapshot da issue e da rota da fase já escolhida no app. O kernel valida o `SquadPlan` e as capacidades antes de executar tarefas. `ContextoDaTarefa` monta `ContextPack` pela revisão Git validada; `ExecutorDoSquad` respeita dependências, workers somente leitura e escritor serial por identidade. Um escritor obtém um slot global próprio com lease e fencing token via `GerenteDeSlots`/`FilaService`, cria seu worktree isolado e usa `ExecutorDeEscritor`. O run não reserva slot. Com capacidade 1, escritores independentes aguardam e são retomados sequencialmente; nunca são executados fora do pool.

`CicloDeRevisao` envolve a produção, TESTE vindo dos comandos do `ci-profile.json` aprovado, e REVIEWER independente conforme SPEC-Squads-04. Somente um commit que completa o ciclo pode avançar para a etapa de entrega/PR. Falha, ausência de prova, dependência bloqueada, conflito, limite de tentativas ou cancelamento para o run com motivo persistido; nenhum desses estados simula sucesso ou avança para PR/MERGE. A integração de um escritor usa diretamente seu commit; se mais de um escritor for habilitado por perfil, a porta de produção aplica o integrador e seu manifesto, conforme SPEC-Squads-04. A F01 mantém um escritor por padrão e não ativa multi-escritor globalmente.

O adaptador da entrega recebe o commit final e usa os serviços existentes de branch, publicação e consulta de PR/checks/merge. A F01 não autoriza um merge sem check verde e política vigente; `DONE` só é escrito após confirmação do merge na origem, e `Finalizado` continua ato do PI. O resultado/tarefas do Squad e cada transição relevante são persistidos no ledger e auditados, para o quadro ser reconstruído depois de reiniciar o app.

### Slots, fencing, cancelamento e recuperação

- Cada escritor ocupa sua própria chave de fila `<runId>:<escritor>` e recebe lease/fencing token; somente o token vigente pode alterar estado ou commitar.
- Espera, aquisição e liberação passam pelos ganchos já ligados ao `FilaService`. Encerramento/cancelamento do run retira escritores pendentes da fila e acorda quem espera.
- O run coordena tarefas, mas não mantém lease de slot enquanto aguarda escritores. Isso evita deadlock com paralelismo igual a 1.
- Cancelamento propaga `AbortSignal`; o kernel aguarda processos e worktrees pararem antes de liberar leases ou recolher recursos. Erro de heartbeat é perda de lease e interrompe escrita/commit.
- Na inicialização, a reconciliação consulta o ledger, fila, leases e worktrees. Execução sem dono não continua silenciosamente: é reconciliada para estado recuperável ou terminal, com auditoria e motivo; retomada só ocorre se a revisão base, o snapshot e o fencing vigente permitirem. O `CicloDeRevisao` atual começa sempre na tentativa 1, portanto este desenho não afirma retomada de uma tentativa parcialmente executada; nesses casos, termina como bloqueado/recuperável e exige novo run governado.

### Imagem e fronteira de credenciais

O sandbox será uma imagem local construída a partir da base Node Debian usada atualmente, substituindo `node:22-bookworm` sem CLI por uma imagem de executor versionada. A versão inicial do Claude Code CLI será **2.1.278**, release oficial consultada para este desenho. O binário Linux x64 deve ser baixado pela URL versionada e sua soma SHA-256 conferida no build contra o manifesto oficial versionado. Para a release fixada, o checksum do manifesto é `5c4735937844e84f8a93306e841a5b0e12252909b07870f789b190468da147ab`; versão e checksum ficam registrados no lock do build. Nunca usar `latest`, instalar em runtime, ou aceitar imagem não construída/verificada localmente. A imagem não contém token.

O container recebe somente `ANTHROPIC_BASE_URL` do proxy de egress já existente. Credenciais continuam no processo host/ExecutorProxy; não entram em ambiente, volume, ContextPack ou ledger. O acesso de rede do executor continua restrito ao proxy, o `.git` permanece protegido, e Claude Code roda em modo não interativo (`--print`) com ferramentas limitadas a Read/Edit/Write/Grep/Glob, sem Bash e sem Git. Erro de download, checksum, CLI ou imagem não habilita fallback no host: para o run com causa visível.

## Contratos e responsabilidades

| Componente | Responsabilidade | Limite |
|---|---|---|
| `QuadroExecucaoService` | Validar seleção e emitir pedido tipado ao adaptador | Sem lógica de container ou execução de agente |
| `OrquestradorDeExecucaoDoSquad` (novo) | Criar run, congelar snapshots, conduzir estados e chamar ciclo/entrega | Sem slot global; não contorna fila, ledger ou policy |
| Planejador + validador do `SquadPlan` | Selecionar plano/rota e validar papéis, orçamento, dependências e escopo | Plano do agente é dado não confiável até validação |
| `ContextoDaTarefa` + `ExecutorDoSquad` | Contexto mínimo, dispatch, dependências e workers/escritores | Sem efeitos Git/GitHub pelo agente |
| `GerenteDeSlots` + `ExecutorDeEscritor` | Lease por escritor, worktree/sandbox isolados e commit pelo kernel | Fencing obrigatório; nenhuma escrita no worktree de outra issue |
| `CicloDeRevisao` | Produção → TESTE → REVIEWER → retrabalho limitado | Não publica ou faz merge |
| Adaptador de entrega | Publicar branch/PR e acompanhar check/merge real | Usa policy e conectores existentes; nunca infere sucesso pelo silêncio |
| Ledger/fila/auditoria | Persistir transições, tentativa, snapshot, commit e motivos | Fonte da projeção; estado em memória é só coordenação |

## Prova e critérios de aceite

1. Teste de bootstrap prova que Play recebe o adaptador real e nunca chama `EncadeadorDeRuns`/`EntregaService` legado como substituto do Squad.
2. Integração no app com uma issue produz Squad visível, worktree do escritor, TESTE antes de REVIEWER e saída de PR/MERGE vinculada ao commit aprovado.
3. Execução de três issues do mesmo MVP cria worktree por issue, mantém dependências não satisfeitas em A fazer, respeita slots e permite a issue independente seguir.
4. Com capacidade 1 e duas escritas concorrentes, a segunda espera; não há deadlock, escrita sem lease ou commit com fencing vencido.
5. Reiniciar durante espera, escrita, TESTE e consulta de PR reconstrói estados do ledger; cancelamento e falha de heartbeat não deixam escritor vivo sem dono.
6. Imagem real executa `claude --version` e chamada não interativa via proxy em smoke controlado; prova confirma checksum no build, ausência de credencial no container e bloqueio de egress fora do proxy.
7. As categorias Regras, Banco e Tela e E2E atualizam evidências por SPEC/issue conforme `docs/TESTING.md`. Recursos reais ausentes são `not_run`, nunca `pass`. Critério de merge/CI exige check real; a F01 não declara sucesso com teste substituto.

## Limites e riscos declarados

- A CLI 2.1.278 é uma dependência externa com versão fixa; atualização será mudança explícita de lock/build e reexecução das provas do sandbox.
- O teste real depende de Docker disponível e credencial de executor configurada no host; sem esses recursos, o smoke real permanece `not_run`, ainda que testes com dublês passem.
- A automação de execução não faz a decisão de aceite do PI; aprovação do card e selo continuam na F02. O fluxo de issue permanece `todo → doing → done`, com encerramento pela regra de governança.
- Recuperação de tentativa interrompida não reusa parcialmente o ciclo não retomável. O resultado seguro é bloquear/reconciliar e exigir novo run, preservando histórico.

## Revisão do desenho

- Não há `TODO`, placeholder ou decisão de produto pendente neste documento.
- A opção escolhida cobre RF-014.1 e critérios de Play sem atribuir à F01 o selo/aprovação da F02.
- O run não possui slot próprio; cada escritor possui slot e worktree exclusivos, evitando o deadlock da capacidade 1.
- O contrato de saída só permite PR depois de commit aprovado por TESTE/REVIEWER e ledger é a fonte do quadro.
- A imagem está fixada em versão e checksum oficial; credenciais permanecem no host.
