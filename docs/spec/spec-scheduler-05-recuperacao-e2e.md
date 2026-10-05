# SPEC-Scheduler-05 — Recuperação e E2E concorrente

- MVP: `docs/mvp/mvp-012-scheduler-concorrente.md` (Fatia 05) — **fecha o MVP-012**.
- Issue: [#132](https://github.com/RodReis/rrb-jarvisOS/issues/132); épico [#127](https://github.com/RodReis/rrb-jarvisOS/issues/127).
- Status: **aprovada-pi** (2026-08-29) — entra no backlog na ordem do MVP; implementação depende da fila.
- Depende de: F04 aprovada e entregue.

## Objetivo

Provar concorrência segura ponta a ponta e fechar recuperação, cancelamento seletivo e limpeza de recursos.

## Dentro

- Supervisor de leases, processos, containers, worktrees, branches, PRs e efeitos ambíguos.
- Retomada/reconciliação por run sem interromper fatia saudável.
- Cancelamento seletivo conforme matriz aprovada, preservando branch/PR remoto.
- Coleta segura de recursos órfãos confirmados e elegíveis.
- E2E com duas fatias independentes, dois PRs, merge serializado, rebase e revalidação.
- Cenário controle com falsa independência voltando para sequencial.

## Fora

- Limpeza remota destrutiva.
- Prosseguir após efeito ambíguo sem consultar fonte real.
- Deploy.

## Regras

1. Recuperação prefere estado observado nas fontes reais a suposição local.
2. Falha/cancelamento de um run não libera locks ou recursos pertencentes ao outro.
3. Artefato de run bloqueado/ambíguo é protegido da retenção.
4. PR após cancelamento fica preservado e draft quando possível.

## Critérios de aceite

1. Duas fatias independentes chegam a PR sem colisão e são mergeadas uma por vez.
2. Segunda fatia rebaseia e revalida sobre a base pós-primeiro merge.
3. Crash em cada fronteira recupera sem run/PR/merge duplicado.
4. Cancelar uma fatia não interrompe a outra nem apaga trabalho remoto.
5. Falsa independência executa sequencialmente e registra a dimensão não provada.
6. Ao final não restam lease, processo, container, porta ou worktree órfãos elegíveis.

## Testes e evidência

- fault injection em aquisição, execução, push, CI e merge;
- Playwright da fila/estado concorrente;
- E2E em repositório exclusivo;
- relatório de recursos e efeitos reconciliados.

## Decisões de implementação (PI, 2026-10-04)

Tomadas na implementação da F05, depois de o Code mapear o que as F01–F04 deixaram. A opção recusada também é decisão. Todas seguiram a recomendação por valor; o custo declarado entrou só como desempate.

1. **A fatia entrega em três PRs encadeadas, todas `refs #132`.** **PR-A** recuperação, supervisor, cancelamento seletivo e rascunho do PR; **PR-B** a ligação de produção (pool → preflight → executor → `EntregaService`); **PR-C** o E2E concorrente e o relatório que fecham os seis critérios. Só a PR-C leva o card a `proplan:done`. *Recusada:* uma PR única — diff grande demais para revisão independente de código e segurança, e contraria "uma finalidade principal" do `GUIA-PRS-CLAUDE-CODE`. Custo: três ciclos de CI.
2. **A ligação de produção entra, com o paralelismo desligado por padrão.** A SPEC-Scheduler-03 empurrou para cá o encadeador (`adquirirSlot` → preflight com `tentativa` → `entregar` com fencing token, heartbeat, `runCorrente` por run, perfil do Codex por run). O paralelismo vira configuração do PI (`pool.configurar`); o E2E o liga só no teste. *Recusadas:* ligar com paralelismo ligado já no primeiro boot (concorrência real antes do aceite e sem GitHub real validado) e provar só no teste, sem chamador de produção (o limite "nenhum chamador de produção" continuaria aberto).
3. **O rascunho do PR é uma operação nova, com degradação.** `pr.convert-to-draft` (mutation GraphQL `convertPullRequestToDraft`, governada, idempotente). Origem que recusa de forma definitiva fica `indisponivel`, registrada, e o cancelamento vale do mesmo jeito; erro remediável ou transitório fica `pendente`, espaçado e com limite de tentativas. *Recusada:* só preservar e marcar (descumpre "draft quando possível" da regra 4 e deixa `convertePrParaRascunho` sem consumidor).
4. **O "Playwright da fila" semeia o SQLite e lê pelos canais de leitura existentes**, com o GitHub falso (`GITHUB_API_ORIGIN`). Não cria canal de escrita nem muda a superfície da ponte; o canal de ato do PI (cancelar, retomar) e a tela são do quadro do MVP-028. *Recusadas:* gancho de teste por variável de ambiente (superfície de produção nova que o E2E de ponte teria de vigiar) e IPC mais tela mínima (adianta fatia sem SPEC).
5. **O perfil do Codex por run é posse exclusiva do perfil (2026-10-05).** O PI mandou o perfil do Codex entrar antes da PR-C e escolheu como: um lease exclusivo (`codex:perfil`) sobre o `CODEX_HOME` da pipeline — o run que usa o Codex o possui enquanto roda e o seguinte espera (concorrência Codex = 1, coerente com a assinatura única). *Recusadas:* **perfil por run com cópia do `auth.json`** (o app passaria a manipular o arquivo da credencial, contrariando o critério 1 da Multi-Executor-02, e o refresh rotativo de cópias concorrentes pode invalidar o login de todas; exigiria ADR) e **esperar o runtime em container do MVP-010** (é o desenho final — mount somente leitura mais camada gravável por run —, mas depende da M10-F01, que não existe; a PR-C não provaria o isolamento do Codex). Custo: concorrência do Codex limitada a 1.
6. **Container sem dono no boot é parado (2026-10-05).** O E2E concorrente mostrou que a queda do app deixa o container do sandbox (`sleep infinity`) de pé e que a recuperação, lendo isso como lentidão, mantinha o run `RUNNING` com o slot preso. O PI escolheu: o run herdado do processo anterior, com lease vencido e container de pé, tem o container parado pelo isolamento (label do run) e o run bloqueado com a ação de retomada. *Recusadas:* bloquear o run e deixar o container (viola o critério 6 e prende capacidade até um ato que só existe no MVP-028) e manter como estava, declarando limite.

## PR-A — recuperação, supervisor, cancelamento seletivo e rascunho

**O que existe.**

- **Núcleo puro** `decidirRecuperacao` (`src/shared/domain/recuperacao.ts`): a regra 1 como função. Quem chama traz o que **observou** (slot, executor, merge, "o dono pode estar neste processo") e a decisão sai só disso: `manter`, `aguardar`, `recolher` ou `bloquear-e-recolher`. Lease expirado sozinho nunca bloqueia: só **expirado + executor provadamente morto + dono que não pode estar neste processo**. `faseDoCancelamento` mapeia estado do run (e se há PR) para a fase da matriz V2 §11.3.
- **`RecuperacaoService`**: `recolher` devolve slot e travas de run **terminal** só depois de o isolamento devolver os recursos e o Docker confirmar o executor morto (container que não parou, ou que o Docker não soube dizer, **segura o slot**); `supervisionar` decide cada run sozinho — a falha de um nunca libera nem toca o que é do outro (regra 2). No boot (`aoSubir`) o run ativo que perdeu o dono vai a `BLOCKED` com os cinco campos e a ação de retomada; na varredura periódica ele **não** bloqueia enquanto ninguém garantir a renovação do lease (ver Limites).
- **Terminal e liberação do slot numa transação só** na `FilaService` (fecha o limite declarado da SPEC-Scheduler-01). `CANCELLED` e `BLOCKED` devolvem o slot pelo gancho `aoEncerrarSemConclusao`, **depois do commit** e nunca dentro de uma transação externa; o gancho nunca lança.
- **`CancelamentoService`**: grava a intenção do rascunho antes de qualquer efeito; a fila pode **recusar** (merge no ar: o merge confirmado não se desfaz) e então nada mais acontece; aceito, interrompe a entrega, o gancho devolve os recursos e o PR vira rascunho. A única operação que sai para a origem é `pr.convert-to-draft`, que recusa PR não aberto. O escopo (projeto, workspace) é do **run**, e o chamador só o confirma.
- **Migration 53 `run_pr`**: o PR que cada run publicou (com `workspace_id`), o estado do rascunho (`pendente` → `convertido`/`indisponivel`/`nao-aberto`/`reaproveitado`), tentativas e espaçamento. A `EntregaService` o registra depois do `pr.ensure`. A reconciliação refaz o rascunho pendente **só de run `CANCELLED`** — inclusive o PR que a entrega em voo publicou depois do cancelamento — e não converte PR que outro run ativo (retomada vinculada) passou a usar.
- **Retenção**: artefato de run ambíguo (merge iniciado sem desfecho, rascunho pendente de run cancelado, pendência de limpeza com menos de 30 dias) é protegido mesmo com o run terminal.
- **Boot e supervisor**: `reconcileAll` chama a recuperação depois do isolamento e do merge, e o app roda a mesma varredura a cada 15 s (só SQLite quando nada expirou; Docker só quando a decisão depende dele, com espera de 60 s por run adiado).

**Como cada critério é provado (parcial — a PR-C fecha 1, 2, 3 e 6 de ponta a ponta).**

| # | Critério | Prova nesta PR |
|---|---|---|
| 3 | Crash recupera sem duplicar | `recuperacao-service.int-spec.ts` (crash entre o terminal e a liberação; run perdido bloqueado e slot devolvido; o saudável não é tocado); `reconciliacao-recuperacao.int-spec.ts` (boot); `cancelamento-service.int-spec.ts` (crash entre o pedido do rascunho e a chamada) |
| 4 | Cancelar uma fatia não interrompe a outra nem apaga trabalho remoto | `cancelamento-service.int-spec.ts` ("a fatia saudável mantém estado, slot e travas, e a origem não é tocada por ela"; só `pr.convert-to-draft` sai; recusa por merge em curso); `github-automacao.int-spec.ts` (PR mergeado ou fechado nunca é convertido) |
| 6 | Sem lease, processo, container, porta ou worktree órfãos | `recuperacao-service.int-spec.ts` (container que não parou ou executor vivo segura o slot; recolher idempotente) — o E2E com Docker real é da PR-C |

**Contrafactuais medidos nesta PR: 15** (cada um reprova o teste certo): sem transação única; sem checar o executor; ignorando pendência de container; sem a chamada de recuperação no boot; sem desfazer o pedido de rascunho recusado; reconciliando run vivo; interrompendo antes de a fila aceitar; sem registrar o PR; ignorando `errors` do GraphQL; ignorando o estado do PR; sem `isDraft` confirmado; sem classificar `RATE_LIMITED`; ignorando a resolução da pendência; sem a proteção por ambiguidade no domínio; aceitando `.` e `..` como nome. As correções das revisões (backoff, dono neste processo, escopo do run, tentativas e espaçamento, PR tardio) nasceram com teste vermelho antes, sem mutação depois.

**Duas revisões independentes (código e segurança) antes da PR.** 0 CRITICAL. Corrigidos com teste vermelho antes: falha de consulta ao container virando "executor morto"; supervisor periódico bloqueando run ativo sem renovação de lease; Docker síncrono martelado a cada volta e falha de um run parando a varredura dos outros; gancho sem `try/catch` e rodando dentro de transação externa; cancelamento aceitando projeto e workspace do chamador; rascunho selado por erro remediável, PR publicado depois do cancelamento sem rascunho, PR reaproveitado por retomada podendo virar rascunho, reconciliação sem espaçamento nem guarda de concorrência; sucesso do GraphQL sem confirmar `isDraft` e rate limit tratado como definitivo; proteção por ambiguidade eterna; `owner`/`repo` sem validação de formato; `run_pr` sem `workspace_id`.

## PR-B — ligação de produção (decisão do PI, 2026-10-05: encadeador como serviço)

**Decisão do PI:** o encadeador entra como **serviço**, acionado só por teste e pelo E2E da PR-C; o gatilho "iniciar run" é do MVP-028. *Recusadas:* despacho automático de run `READY` pelo boot e pelo supervisor (um run `READY` passaria a executar sem ação do PI, e precisaria de gate de segurança próprio) e um canal IPC de "iniciar run" (adianta o MVP-028 sem SPEC). O limite "nenhum chamador de produção" **continua aberto** por escolha.

**O que existe.**

- **`EncadeadorDeRuns`** (`src/main/pipeline/encadeador-de-runs.ts`): `executar(pedido)` percorre slot (`GerenteDeSlots.adquirirRun`, que espera a vez sem sondar o banco) → **heartbeat do slot** → preflight → `EntregaService.entregar` com o fencing token e um `AbortSignal`. O heartbeat nasce na aquisição e só para no desfecho, **inclusive esperando o CI**, quando o run nem container tem; perder o lease (ou não conseguir nem perguntar) aborta a entrega. Preflight recusado vai a `BLOCKED` com os cinco campos e o token. Falha inesperada bloqueia o run com o token e relança. `interromper(runId)` aborta **só** aquele run (a espera pelo slot, a construção e a espera do CI).
- **Contexto por run no proxy.** Cada run registra uma **unidade** (`/u/<chave aleatória>`) com o próprio run, tentativa, ContextPack e workspace, e a libera ao terminar em qualquer caminho. O `EntregaService` guarda o `runCorrente` **por run** (um `Map`); o contexto global do `ExecutorProxy` só responde quando há exatamente um run em curso — com dois, recusa em vez de atribuir custo e manifesto ao run errado.
- **`ConstrutorService` migrado** para transicionar pela `FilaService` com o fencing token (e a fila audita): o dono que perdeu o slot **para de construir**, e o `BLOCKED` da construção dispara a recuperação (antes escrevia o estado direto no repositório, sem token e sem soltar o slot).
- **Tentativa** do run = 1 + os elos de `continuaDe`: cada retomada da mesma fatia tem branch própria (`-t<n>`, SPEC-Scheduler-03).
- **Boot:** `renovacaoGarantida: true` — todo executor que existe (escritor do Squad, encadeador) renova o slot do início ao fim, então a varredura periódica passa a tratar lease vencido de run ativo sem container como run perdido. O gancho `aoEncerrarSemConclusao` agora **interrompe a entrega em voo antes de recolher**, e o `CancelamentoService` recebe `interromper`.
- **Fonte do write set da prova de independência** (`IndependenciaService.fonte`, antes `() => undefined`): o encadeador responde com os paths da SPEC que o run em voo declarou (`pathsDaSpec`), declarados **antes** de pedir o slot, porque é no ciclo do pool que a prova pergunta. Run sem paths declarados não tem write set: a prova fica incompleta e ele segue em sequência (regra 1).
- **O escopo do run é do run**: `workspaceId` do chamador é conferido contra o workspace gravado no run (divergente responde como inexistente), e só run `READY` entra (qualquer outro estado não passa pelo gate da fila e esperaria para sempre). Cada efeito externo da entrega (push, PR, proteção da base) confere antes o sinal de cancelamento; abortada, a entrega bloqueia o run com o token em vez de publicar. A entrega que devolve `BLOCKED` sem transicionar o run (perfil de CI inválido, push ou PR que falham) tem o run levado a `BLOCKED` pelo encadeador, com a causa que ela deu — senão a supervisão o bloquearia depois como "executor perdido", sobrescrevendo a causa real. Falha sem `stderr` (teste que escreve só no stdout) bloqueia com evidência não vazia: a fila recusa bloqueio sem evidência e o run ficaria ativo segurando o slot.
- **O paralelismo segue desligado** (`pool.configurar`; capacidade efetiva 1): o segundo run espera o slot e roda depois, sem erro.

**Como cada critério avança (a PR-C fecha 1, 2, 3 e 6 de ponta a ponta).**

| # | Critério | Prova nesta PR |
|---|---|---|
| 4 | Cancelar uma fatia não interrompe a outra | `encadeador-de-runs.int-spec.ts` (`interromper` aborta só o run alvo e o vizinho segue; interromper quem espera o slot o tira da fila e nada é montado) |
| 3 | Crash recupera sem duplicar | o heartbeat é o que permite à varredura periódica recuperar o run perdido; `perder o lease aborta a entrega` |
| 5 | Sem dono, ninguém escreve | `construtor-service.int-spec.ts` (a fila recusa a transição do dono que perdeu o slot e a construção para); `entrega-service.int-spec.ts` (sinal abortado antes do push: nenhum push, nenhum PR) |

**Contrafactuais medidos nesta PR: 25**, cada um reprova o teste certo (sem heartbeat; lease perdido que não aborta; `interromper` que aborta todos; unidade do proxy não liberada; tentativa sempre 1; preflight recusado que não bloqueia; falha inesperada que não bloqueia; entrega sem token; run que não sai de voo; construtor que ignora a recusa da fila; construtor fora da fila; contexto global compartilhado; entrega que apaga contexto alheio; `adquirirRun` que ignora o sinal; workspace do chamador aceito; qualquer estado entra; abort após a aquisição ignorado; entrega que publica sem checar o sinal; evidência vazia aceita; run não bloqueado após `BLOCKED` da entrega; bloqueio de run terminal; exceção que derruba na primeira; write set não esquecido; write set não declarado; sinal ignorado após publicar). Um contrafactual passou de primeira (bloquear run terminal) porque a fila já o recusa; o teste foi reforçado para afirmar que o encadeador nem tenta.

**Duas revisões independentes (código e segurança) antes da PR.** 0 CRITICAL; 2 HIGH, 6 MEDIUM, 6 LOW (com sobreposição entre as duas). Corrigidos com teste vermelho antes: escopo do run vindo do chamador (workspace), run fora de `READY` esperando para sempre, abort entre a aquisição e o sandbox, efeitos externos da entrega sem checar o sinal, evidência de bloqueio vazia fazendo a fila recusar (run ativo segurando slot), entrega devolvendo `BLOCKED` sem o run sair de ativo, heartbeat abortando na primeira exceção. Declarados nos limites: construção síncrona, `fila.concluir` não conferido, tentativa por ciclo, ledger de cancelado, derivação de `alvo`/`contextPackId` pelo gatilho.

## PR-B2 — posse exclusiva do perfil do Codex (decisão do PI, 2026-10-05)

**O que existe.**

- **`PosseDoPerfilCodex`** (`src/main/pipeline/posse-do-perfil-codex.ts`): `adquirir` (espera a vez, FIFO, cancelável por `AbortSignal`), `renovar` e `liberar` sobre o lease `codex:perfil` (`RECURSO_DO_PERFIL_CODEX`). Devolve só o **caminho** do `CODEX_HOME`: o app nunca lê, copia nem registra o conteúdo do perfil.
- **Mesmo padrão do `MergeLease`:** o lease de **outro** run — vigente ou expirado — nunca é tomado. Expirado é recusa explícita (`requer-reconciliacao`): a reconciliação do boot já o libera quando o run dono terminou (`reconciliarLease`, genérica). O mesmo run pedindo de novo reassume a posse que tem.
- **Ligação:** o `EncadeadorDeRuns` renova a posse a cada batida do slot e a **devolve no `finally`** — cancelar, falhar ou terminar não prende o perfil. `RecuperacaoService`/hook não a liberam: o processo do Codex roda no host e não há sonda de "executor morto" para ele; quem a devolve é o dono, depois de a entrega terminar.
- **Sem chamador de produção:** o `CodexExecAdapter` não tem instância no app. A posse é o ponto onde ele pede a vez quando houver; o `codexHome(referencia)` do adapter já aceita o caminho que ela devolve.

**Como a F03 (Scheduler-03) e a Multi-Executor-02 ficam satisfeitas.** "Sem diretório gravável compartilhado entre runs" vale porque o perfil nunca é usado por dois runs ao mesmo tempo; "sem segundo dono do `CODEX_HOME`" e "o app não vê o segredo" valem porque nada é duplicado nem lido.

**Prova:** `posse-do-perfil-codex.int-spec.ts` (SQLite real: um dono por vez, ordem de chegada, quem chega no instante da liberação não fura a fila, corrida perdida contra outro processo não vira posse, lease expirado de outro não é tomado, só o dono renova e libera, cancelar a espera tira o run da fila, o dono que pede de novo com fila não vazia reassume na hora, falha de gravação do lease é avisada uma vez, `recolherOrfa` só toca dono que terminou e não está em voo) e `encadeador-de-runs.int-spec.ts` (a batida renova a posse; devolve ao terminar com a entrega, com o preflight recusado, com falha e ao cancelar; falha passageira ao devolver é tentada de novo; falha ao renovar ou devolver não derruba o run). **17 contrafactuais medidos**; três sobreviveram à primeira medição (corrida entre `buscar` e `INSERT`, o "fura-fila" no instante da liberação e o despertar imediato de quem espera, que o polling mascarava) e viraram teste.

**Revisão independente de segurança** (0 CRITICAL; 1 HIGH, 3 MEDIUM, 5 LOW). Corrigidos com teste vermelho antes: **deadlock quando o dono pede a posse de novo com fila não vazia** (ele entrava na fila atrás de quem esperava o perfil que ele mesmo segurava); falha de gravação do lease virando espera infinita e silenciosa (agora avisada uma vez); `liberar` que falha prendendo o perfil até o próximo boot (retry no `finally` e `recolherOrfa` no supervisor de 15 s). **Declarados** como limite (abaixo): o `CodexAdapter` de geração fora da posse, e a posse perdida ignorada na batida.

## PR-C — E2E concorrente e recuperação com infra real (decisão do PI, 2026-10-05)

**O que existe.**

- **O mundo concorrente** (`tests/scheduler/mundo-concorrente.ts`): os serviços **reais**, compostos como o `main/index.ts` os compõe — `FilaService`, `PoolService` com a prova de independência, `GerenteDeSlots`, `EncadeadorDeRuns`, `EntregaService`, `ConstrutorService`, `MergeService`, `RecuperacaoService`, `CancelamentoService` e `ReconciliacaoService` — sobre SQLite real com todas as migrations. Dublê só o que fica fora do processo: a origem (`origem-falsa.ts`: um repositório **com estado**, base única que anda a cada squash merge, CI por commit, PRs por branch), o Docker (um registro de container, porta e worktree que o teste confere no fim), o Git e o preflight.
- **A queda de verdade** (`Processo.matar` e `matarEm(ponto)`): o processo congela onde está — nenhum efeito, nenhuma resposta, nenhum heartbeat depois dele —, o relógio avança além da validade dos leases e **outro processo** sobe sobre o mesmo banco, a mesma origem e os mesmos containers (o Docker os mantém de pé). O que se afirma é o **resultado** (nenhum run ativo sem dono, nenhum PR ou merge duplicado, nada órfão), não a chamada de um serviço.
- **Quatro arquivos de prova:** `concorrente.int-spec.ts` (4 testes: dois PRs com merge serializado e rebase, a corrida sem ninguém segurando, falsa independência, cancelamento seletivo), `queda.int-spec.ts` (7 fronteiras × dois runs em voo), `queda-docker.int-spec.ts` (**Docker real**: cancelar um de dois runs, e o boot depois da queda) e `tests/e2e/scheduler-recuperacao.e2e.ts` (**o app Electron real**: boot de verdade, Docker de verdade, três runs semeados no SQLite e lidos pela ponte existente — decisão do PI de 2026-10-04, sem canal de escrita novo).

**Como cada critério é provado.**

| # | Critério | Prova |
|---|---|---|
| 1 | Duas fatias independentes chegam a PR sem colisão e mergeiam uma por vez | `concorrente.int-spec.ts`: dois slots simultâneos com travas e prova de independência; `maxMergesEmVoo` medido **na origem** é 1; um PR por branch; na corrida sem ninguém segurando, nenhum PR entra sobre base que ele não continha (`mergesAtrasados` vazio) |
| 2 | A segunda rebaseia e revalida sobre a base pós-primeiro merge | o mesmo arquivo: um `update-branch`, head novo, CI do commit novo fechado antes do merge; o segundo merge usa o head atualizado |
| 3 | Crash em cada fronteira recupera sem duplicar | `queda.int-spec.ts` (aquisição, construção, push, PR aberto, CI, merge antes e depois do efeito) e `queda-docker.int-spec.ts`; no app real, `scheduler-recuperacao.e2e.ts`. Cada fronteira termina com **uma** entrada por fatia na base e **um** PR por branch |
| 4 | Cancelar uma fatia não interrompe a outra nem apaga trabalho remoto | `concorrente.int-spec.ts` (PR do cancelado vira rascunho e fica; a vizinha mantém estado, slot e token e mergeia) e `queda-docker.int-spec.ts` (container e rede do cancelado somem; os do vizinho seguem de pé) |
| 5 | Falsa independência executa em sequência e registra a dimensão não provada | `concorrente.int-spec.ts`: lockfile comum; a segunda não monta nada enquanto a primeira vive, o motivo estruturado nomeia o recurso, e ela nasce sobre a base nova (nada a rebasear) |
| 6 | Sem lease, processo, container, porta ou worktree órfãos | `orfaos()` vazio ao fim de todo cenário (leases de qualquer tipo, trava do pool, container, porta, worktree, pendência de limpeza) e, com infra real, `docker ps -a` por label nos dois arquivos Docker |

**Três defeitos de produção que o E2E achou — e que 25 testes de PR-A/PR-B verdes escondiam:**

1. **Container sem dono no boot.** O container do sandbox é `sleep infinity` detached: a queda do app **não o para**. A recuperação lia "lease expirado + container de pé" como lentidão e mantinha o run `RUNNING` com o slot preso, para sempre. Provado com o Docker real (o run seguia `RUNNING` depois do boot). **Decisão do PI (2026-10-05):** só no boot (`aoSubir`), esse par é container sem dono — a recuperação o devolve pelo isolamento (label do run) e bloqueia o run com a ação de retomada (`causa: executor-perdido`, evidência dizendo a verdade). A varredura periódica continua `manter` para o run **deste** processo; o run **herdado** do boot (slot com fencing token até o teto fixado quando o `RecuperacaoService` nasce — critério sem estado, que não depende de uma passada do boot que possa ter falhado) é sem dono também depois dele — o reinício em menos de 30 s deixa o lease vigente no boot e vencido na varredura seguinte, e sem isso o container ficaria de pé para sempre (achado da revisão de segurança). *Recusadas:* bloquear o run e deixar o container (viola o critério 6 e prende capacidade até um ato do PI que só existe no MVP-028) e manter como estava e declarar limite (deixa o slot preso após qualquer queda real).
2. **Recursos do run mergeado só voltavam no boot seguinte.** O isolamento reconciliava **antes** do merge: o run que a reconciliação do merge concluía ainda constava como ativo, e o container, a porta e o worktree dele ficavam até o próximo boot. O isolamento agora reconcilia depois do merge e da recuperação (e antes dos leases).
3. **PR atrasado entrava sobre base que o CI dele nunca viu.** A base lida na avaliação e a lida sob o lease concordam quando o vizinho já mergeou (a pipeline a lê a cada volta da espera), então o PR que ficou para trás não era visto; e o merge autônomo roda como o dono (`enforce_admins: false`), de modo que a proteção `strict` da origem também não o barra. `pr.merge-state` ganhou `atrasadoPor` — o `behind_by` da comparação base...head, só em PR aberto, **ausente quando a origem não soube dizer** (nunca vira 0; o motivo vai ao log e o SHA do head é validado antes de entrar no caminho) — e `decidirMerge` o trata como `base-avancou` (atualiza a branch e revalida) e, **ausente, como `observacao-incompleta`: o merge espera** (fail closed; achado HIGH da revisão de segurança: "não sei" não pode virar "em dia" com o dono mergeando sem a proteção `strict`). *Custo declarado:* sem permissão de leitura na comparação, o merge nunca sai.

**Contrafactuais medidos nesta PR: 15**, cada um reprova o teste certo (decisão ignorando `atrasadoPor`; `merge-service` descartando o campo; adapter sempre "em dia"; comparação que falha ou conexão que cai virando 0; comparação em PR fechado; container vivo no boot = manter; boot sem propagar `aoSubir`; isolamento antes do merge; `interromper` abortando todos os runs; merge sem lease de seção crítica; prova de independência sempre verdadeira; merge reconciliado que não conclui o run; run herdado que nunca é herdado; PR atrás da base entrando sem a comparação; `atrasadoPor` ausente lido como "em dia"; SHA do head sem validação). Três não reprovaram na primeira medição e foram investigados: a mutação do boot mantinha uma segunda chamada ao isolamento (mutação fraca, refeita), a da queda de conexão não tinha teste (virou teste) e o cancelamento tinha dois caminhos para `interromper` (a mutação certa é abortar todos). **Um sobreviveu e fica declarado:** ignorar a segunda checagem de independência na aquisição (`pool-service`) não quebra nada, porque `decidirPool` já segura o run — é guarda em profundidade.

**No app Electron real** (`scheduler-recuperacao.e2e.ts`): boot de verdade, Docker de verdade, três runs semeados — A (lease vencido, sem container), B (lease vencido, container `--rm` de pé com as labels do preflight) e C (lease vigente, container de pé). Depois do boot só C segue ativo e ocupa slot (lido por `vistaDaFila` e `vistaDoPool`), nada fica pendente de limpeza, o container de B foi parado e o de C segue de pé; o SQLite, lido com o app fechado, mostra A e B `BLOCKED` com `executor-perdido` e a ação de retomada.

**Revisão independente de segurança** (0 CRITICAL; 1 HIGH, 2 MEDIUM, 3 LOW). Corrigidos com teste vermelho antes: **`atrasadoPor` ausente virando "em dia"** (HIGH, acima); **reinício rápido** deixando o órfão para sempre (herdado por teto de token); evidência do bloqueio afirmando "foi parado" antes da parada (agora "a parada é tentada em seguida"); SHA do head sem validação; varredura de containers de sobra no `afterAll` dos testes com Docker. 
**Revisão independente de código** (0 CRITICAL/HIGH; 3 MEDIUM, 7 LOW). Corrigidos: **`herdados` dependia de uma passada do boot que pode falhar** (virou critério sem estado: teto de fencing token); a **precedência de `decidirMerge` com `atrasadoPor` ausente** não tinha teste e o dublê do merge era mais complacente que o adapter; o teste "a segunda rebaseia" **passava sem o defeito 3** (avaliação antiga já disparava `base-avancou`) — ganhou o caso determinístico em que o CI da segunda só fecha depois do merge da primeira, com contrafactual medido; `baseSha` vazio na mensagem de conflito; `aoSubir` do domínio renomeado para `herdado`; o E2E agora distingue pela evidência o caminho de A (executor morto) e o de B (container sem dono). **Declarados:** a chamada extra de `compare` também ocorre nos caminhos que só leem `merged` (reconciliação de tentativa); o mapeamento PR↔run dos testes segue a ordem de publicação; o estado de B no instante da queda não é determinístico (as invariantes valem para qualquer estado).

**Declarados da revisão de segurança:** container legado achado só por nome (sem inventário) não é parado por `liberarRunEUnidades` e o slot fica preso a cada varredura; a comparação usa `base.ref` do PR, não `alvo.branchBase`.

## Limites declarados (PR-C)

- **O boot só enxerga o Docker se a allowlist permitir.** O terminal do Docker exige o binário `docker` na allowlist de comandos do espaço e o `app.getAppPath()` (cwd das consultas) na allowlist de diretórios — de fábrica só `userData` entra. Sem isso `listarGeridos` devolve "não listou", a recuperação fica cega (fail closed) e o run segue `RUNNING`. O E2E semeia as duas permissões; um app novo precisa delas. **Pergunta ao PI** (abaixo).
- **A origem do E2E concorrente é falsa.** `pr.convert-to-draft` e a comparação `compare/{base}...{head}` não foram validadas contra o GitHub real; o `behind_by` segue a documentação da API. O Docker real aparece em `queda-docker.int-spec.ts` e no E2E do app; o E2E concorrente em si usa um registro de container, porta e worktree.
- **Sem permissão na comparação o merge não sai** (fail closed). Falha transitória só atrasa; falha permanente (token sem leitura de conteúdo) trava o merge autônomo — aparece como `aguardar/origem-indisponivel` e o status vai ao log.
- **Container legado achado só por nome** (run anterior ao inventário, migration 51): a recuperação o lê como vivo, bloqueia o run e não consegue pará-lo; o slot fica preso e a varredura repete.
- **A comparação usa `base.ref` do PR**, não `alvo.branchBase`: PR reapontado para outra base teria o `behind_by` contra a base nova.
- **Proteção contra laço infinito nos testes** (`execArgv` com teto de 4 GB no `vitest.config.ts`) e `dormir` que avança o relógio nos três testes da entrega: um laço de espera com relógio parado só usa microtasks, o timeout do Vitest nunca dispara e o worker chegou a 20 GB.

## Limites declarados (PR-B2)

- **O `CodexAdapter` de geração (provider do ponto único, M26-F06) usa o mesmo `CODEX_HOME` fora da posse.** "Concorrência Codex = 1" vale **entre runs** que pedem a posse, não contra a geração: ela já gravava nesse diretório antes e pode rodar junto com um run Codex. Trazê-la para a posse mexe no caminho de geração de documentos (outra fatia, com decisão do PI sobre quem espera quem).
- **Nada força o executor a usar o caminho que a posse devolveu:** o `CodexExecAdapter` recebe o `CODEX_HOME` por `request.autenticacao.referencia`. Quando for instanciado, a referência deve ser a que a posse devolve.
- **A posse perdida não aborta o run:** a batida ignora o retorno de `renovar` (`false` também é "este run não usa o Codex"), ao contrário do slot, que aborta com `lease-perdido`. Praticamente inalcançável hoje: só a reconciliação do boot remove lease.
- **Lease expirado com o dono vivo** (suspensão do notebook, laço de eventos bloqueado por mais de 30 s) faz quem espera receber `requer-reconciliacao`, ainda que o dono volte a renovar. É fail-closed e correto contra roubo, mas gera uma falha espúria.
- **Reassunção concorrente** do mesmo run (duas chamadas ao mesmo tempo) não é contada: o primeiro `liberar` solta a posse das duas. Seguro hoje (só o encadeador libera, uma vez, no `finally`).

## Limites declarados (PR-B)

- **Nenhum chamador de produção.** O gatilho "iniciar run" é do MVP-028; hoje só teste e E2E acionam o encadeador (decisão do PI).
- **O perfil do Codex por run** entrou na PR-B2 como posse exclusiva (concorrência Codex = 1). Segue **sem chamador de produção**: o `CodexExecAdapter` não tem instância no app.
- **`workspaceId` é conferido; `alvo`, `repositorio`, `raizOperacional` e `contextPackId` vêm do chamador.** O gatilho do MVP-028 deve derivá-los do projeto e do pacote do run; o encadeador não tem fonte para validá-los. `contextPackId` só é conferido como existente pelo gate (sem escopo de workspace).
- **A construção roda com `spawnSync`** (`docker exec` síncrono): durante o `claude --print` e a validação o laço de eventos para, o heartbeat não dispara e o cancelamento só entra depois. É benigno para o lease — `renovarSlot` aceita lease vencido (o `WHERE` só confere o token) e o supervisor só bloqueia com o executor provadamente morto, e o container está vivo —, mas **o heartbeat "do início ao fim" não vale durante a construção** e o cancelamento não a interrompe no meio. A saída estrutural é o executor assíncrono (como o do Squad); fica para fatia própria.
- **Resultado de `fila.concluir` não é conferido na entrega.** Com o fencing exigido, uma recusa por `fencing-invalido` deixa o run em `PR_CI` enquanto a entrega e o ledger dizem `MERGED`/`AWAITING_MERGE`. Só ocorre ao perder o lease com o merge já feito; a reconciliação do merge conclui o run no boot (`aoReconciliarMergeado`).
- **Tentativa por ciclo de correção.** A unidade do proxy fixa a `tentativa` do run (cadeia de `continuaDe`); os três ciclos de correção da construção ficam todos com ela no `CostEvent` (o global antigo a atualizava). É contabilidade, não segurança.
- **O ledger de run cancelado em voo diz `BLOCKED`** (o estado final é derivado do resultado da entrega, não do run) — anterior à PR-B.
- **Itens `esperando` no pool entre boots** não foram verificados: um run enfileirado que ganhasse slot depois de um reinício sem encadeador ficaria `RUNNING` sem dono até a supervisão o bloquear.
- Uma falha isolada da suíte de banco numa rodada ampla não reproduziu em duas reexecuções (Docker Desktop caiu durante a sessão; provável smoke dependente dele).

## Limites declarados (PR-A)

- **A varredura periódica não bloqueia run ativo enquanto ninguém renova o lease.** Hoje só o executor do Squad renova (`squad-slots.ts`); run em CI ou ainda no preflight não tem container e pareceria morto. O boot bloqueia (nenhum dono em memória sobrevive); a periódica passa a bloquear quando a PR-B ligar o heartbeat do início ao fim (`renovacaoGarantida`). *(Resolvido na PR-B: o encadeador renova da aquisição ao desfecho e `renovacaoGarantida` está ligado — ver os limites da PR-B para a fase de construção.)*
- **O cancelamento ainda não tem chamador de produção**: o canal (IPC e tela) é do quadro do MVP-028. Roda a reconciliação do rascunho pendente. `interromper` (o `AbortSignal` da entrega em curso) é ligado pela PR-B *(feito: o encadeador o responde e o gancho de encerramento o chama antes de recolher)*.
- **Decisão do PI (2026-10-04): a matriz de cancelamento preserva o trabalho, não o worktree limpo.** `recolher` devolve os recursos pelo isolamento — worktree **sem `--force`**, então o que tem trabalho não registrado vira pendência e fica; o que é limpo (todo o trabalho já na branch, que nunca sai do Git) é removido. A V2 §11.3 diz "limpar container/worktree **após** snapshot" para o executor ativo, mas a tabela `limpeza.ts` marca `removeRecursos: false` em `durante-execucao` e `depois-do-push`. O PI manteve assim (ver Perguntas abertas).
- **A prova de vida é "existe container gerido com a label do run"** (ou o nome legado). Um sidecar rotulado conta como executor vivo: o supervisor falha para o lado seguro, e o run com executor morto e proxy vivo não é recuperado sozinho.
- **O Docker segue síncrono no processo principal** (`spawnSync`). O backoff por run e a decisão que dispensa a consulta reduzem o custo, mas uma varredura com Docker travado ainda bloqueia o processo por consulta; a saída estrutural é consultar de forma assíncrona. `liberarRun` audita toda chamada com pendência — o backoff evita as repetições, não a primeira.
- **Efeito ambíguo genérico do `EffectJournal` continua só reportado** (`bloqueado` a cada boot): a entrada não guarda o pedido, então não há como repetir ou consultar a origem de forma genérica. Os efeitos desta fatia (merge, rascunho) têm reconciliação própria.
- **`EffectJournal.concluir` sobrescreve incondicionalmente** (comportamento anterior): uma repetição falha do rascunho pode rebaixar `confirmed` a `ambiguous` no diário. Fora do escopo; apontado.
- **`pendencia_de_limpeza` não é resolvida em produção**: a proteção da retenção por ela tem prazo de 30 dias justamente por isso; fechar a pendência quando a reconciliação a resolve é outra fatia.
- **Prefixo de unidade `<run>-`**: seguro enquanto `runId` for UUID; depende desse invariante.
- **`pr.convert-to-draft` não foi validada contra o GitHub real** — só contra o servidor falso (a mutation e o formato dos erros vêm da documentação). Endpoint fixo em `/graphql`: GitHub Enterprise Server (`/api/graphql`) não está coberto.

## Perguntas abertas ao PI

Uma aberta (a 3, da PR-C); as duas que ficaram da implementação foram decididas pelo PI em 2026-10-04, e a opção recusada fica registrada:

1. **Matriz de cancelamento e worktree limpo — mantida como está.** `recolher` devolve os recursos pelo isolamento: worktree **sem `--force`**, então o que tem trabalho não registrado vira pendência e fica; o worktree limpo (trabalho todo na branch, que nunca sai do Git) é removido. *Recusada:* `preservarWorktree` por fase — preservar worktrees limpos é recriável e contraria a regra 6 ("sem worktree órfão").
2. **"Reexecução integral das validações" no merge (herdada da F04) — são os checks obrigatórios (proteção + rulesets) no head novo.** O PI delegou a escolha ("decida por mim"); decidida por valor: o gate os busca por SHA e é a barreira que a origem impõe, a validação local não enxerga o head que o `update-branch` criou na origem, e trazê-lo ao worktree é outra fatia com superfície de Git própria. *Recusada:* reexecutar também a validação local (exige trazer o head novo ao worktree). Se um dia a validação local virar exigência, é fatia nova, não emenda.

3. **(PR-C, aberta) Docker no boot depende da allowlist do usuário.** Num app novo, o `docker` não está na allowlist de comandos nem o `app.getAppPath()` na de diretórios, e a recuperação do boot fica cega (fail closed). Opções: (a) documentar como pré-requisito de configuração (o que vale hoje); (b) o boot passar a consultar o Docker por um terminal interno, fora das allowlists do usuário, limitado às consultas de leitura e à parada por label do inventário. Recomendação por valor: (b) — sem ele a garantia do critério 3 depende de configuração que o usuário não sabe que precisa fazer. Custo: ~1 dia (novo engine interno + ADR de exceção, como a do ADR-007 para `docker network rm`).
