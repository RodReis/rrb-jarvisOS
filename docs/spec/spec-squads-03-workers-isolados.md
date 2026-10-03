# SPEC-Squads-03 — Workers somente-leitura e escritores isolados

- MVP: `docs/mvp/mvp-011-squads-limitados.md` (Fatia 03).
- Issue: [#124](https://github.com/RodReis/rrb-jarvisOS/issues/124); épico [#121](https://github.com/RodReis/rrb-jarvisOS/issues/121).
- Status: **aprovada-pi** (2026-10-02) — revisão exata do PR #367 aprovada pelo PI; reescrita em 2026-10-02 pela ADR-006 (decisão 5 revoga o escritor único no escopo do MVP-011).
- Depende de: M11-F02 e **M12-F01** (pool global de slots).

## Objetivo

Executar tarefas em paralelo com contexto mínimo e acesso compatível com a função: workers somente leitura analisam e testam, e até dois escritores alteram cada um o seu worktree. Git continua sendo exclusivo do kernel.

## Dentro

- Workers e escritores temporários ligados a `run_id`, `squad_id` e tarefa validada.
- **Um worktree por escritor**, derivado da branch da issue, com o write set declarado no plano; cada escritor ocupa um slot do pool.
- O kernel commita o trabalho de cada escritor no seu worktree pelo `GitRunner`; o agente não executa Git.
- `ContextPack` por tarefa, montado com arquivos exatos e busca estrutural/grep.
- Workers somente leitura por padrão; ferramentas explicitamente permitidas por capacidade.
- Saída por schema: conclusão, evidência, confiança, lacunas, assinatura.
- Limites de contexto, ferramentas, turnos, tempo e cancelamento.
- Canal controlado de resultado; sem comunicação lateral não registrada.

## Fora

- Agente executando Git/GitHub ou produzindo efeito externo.
- Escritor alterando worktree de outro escritor ou o worktree da issue.
- Enviar o repositório inteiro por padrão.
- Worker decidir que sua tarefa está fora da SPEC e ampliá-la.

## Regras

1. Falha de um worker ou escritor não autoriza repetição indefinida nem aumento de orçamento.
2. Resultado sem a evidência exigida é incompleto, não sucesso presumido.
3. Arquivo sugerido por agente passa pela mesma validação de path antes da leitura.
4. Conteúdo retornado é dado não confiável até validação do schema e do consumidor.
5. Sem slot livre, o segundo escritor espera; ele nunca roda fora do pool.

## Critérios de aceite

1. Nenhum agente consegue executar Git ou GitHub; workers não alteram worktree.
2. Cada escritor só altera seu próprio worktree, provado por diff por worktree.
3. O ContextPack contém apenas fontes justificadas e registra hashes e revisões.
4. Saída inválida, timeout e cancelamento têm estados terminais auditáveis.
5. Dois escritores e N workers rodam juntos sem compartilhar sessão nem segredo.
6. Com 1 slot livre, o plano de 2 escritores roda em sequência sem erro.

## Testes e evidência

- tentativa de Git e de escrita fora do worktree, ambas bloqueadas;
- isolamento de sessão e segredo entre escritores;
- concorrência com pool cheio.

## Decisões de implementação (PI, 2026-10-02)

Tomadas na implementação da F03, depois de o Code mapear o código e achar três lacunas que a SPEC não resolvia. Registradas aqui porque a opção recusada também é decisão.

1. **Slot por escritor.** O pool tem um item de fila e um slot por `runId`. **Decidido:** cada escritor é um item do pool com id `<runId>:<escritor>`, com lease e fencing token próprios; escritores do mesmo run são irmãos e não precisam da prova de independência entre si. *Recusada:* vários donos por run no pool — quebraria a chave `run_id` da fila, `buscarSlotDoRun` e o token único por slot da M12-F01 (~2 dias, risco de regressão).
2. **Como o escritor altera arquivos.** **Decidido:** agente com ferramentas de edição (Edit/Write/Read/Grep, **sem Bash**) dentro do container do sandbox, com `.git` somente-leitura; o kernel commita e prova o escopo por diff do worktree de cada escritor. *Recusadas:* o agente devolver patch e o kernel aplicar (mais seguro e testável, mas foge do que a SPEC descreve); rodar no host com allowlist de ferramentas (contradiz a decisão de 2026-08-29: o executor autônomo nunca roda no host).
3. **Acesso dos workers.** **Decidido:** só o `ContextPack` montado pelo kernel, no prompt, sem ferramentas (`--tools ""`). Ferramentas de leitura entram depois, por capacidade, se uma medição mostrar necessidade. *Recusada:* Read/Grep/Glob no worktree — abre superfície (symlink, segredo, saída de ferramenta como dado não confiável) e pede uma fase de isolamento nova no adapter.

### Adotado pelo Code (a confirmar)

- **O run não segura slot próprio enquanto o Squad executa.** Quem ocupa slot é o escritor. O primeiro escritor adquirido leva o run de `READY` a `RUNNING`; os seguintes encontram o run já em `RUNNING`. Se o run também segurasse um slot, a capacidade efetiva 1 (paralelismo desligado) nunca deixaria um escritor rodar.
- **Nomes por escritor são injetivos.** `id` e `escritor` aceitam `_` e `-`, e a sanitização de nome de container/branch os funde (`a_b` e `a-b`). Dois escritores cujo nome sanitizado colide são recusados antes de criar worktree.
- **O commit do kernel não executa hook do repositório** e usa identidade fixa do kernel; a remoção do worktree é `worktree remove` **sem `--force`** (o `--force` cai no gate destrutivo do `TerminalEngine`, e isso nunca foi provado com o engine real).
- **O kernel não segue o `.git` do worktree.** O arquivo `.git` do worktree vive no diretório que o agente edita; reescrevê-lo para um gitdir próprio (com hook ou `fsmonitor`) executaria código **no host** na próxima vez que o kernel rodasse Git ali. Provado com Git real (o `pre-commit` do gitdir falso roda no Git puro e não roda no kernel). Todo comando do kernel usa `--git-dir` e `--work-tree` explícitos, com o gitdir lido na criação do worktree, antes de o agente rodar.
- **Link simbólico e caminho começando por `-` não são commitados.** O escritor não cria symlink (pode apontar para fora do worktree), e um caminho como `-f` casaria o gate destrutivo do terminal. Ambos aparecem na prova de diff e o serviço os trata como violação de escopo.
- **O ContextPack da tarefa sai de uma revisão do Git, sem migração.** O kernel lista a árvore do SHA, lê o blob **pelo oid** e entrega o texto ao pack: sem link simbólico (modo 120000 e submódulo ficam de fora), sem janela entre existir e ler, sem leitura do disco do agente. O hash de cada item é o do texto exato enviado (um trecho de busca tem o hash do trecho). A revisão entra no rótulo da tarefa (`squad:<run>/<tarefa>@<sha12>`), que já faz parte do hash do pack, então o pack não ganhou coluna nem migração. *Alternativa não escolhida:* campos próprios de revisão e tarefa no pack (migração 49); fica para quando o quadro do MVP-028 precisar consultar por eles. O que a tarefa pediu e a revisão não tem (caminho inválido, inexistente, binário, grande demais) volta como `descartada`, com o motivo.
- **Busca é literal, só dentro de um escopo de caminhos, e pedida pelo kernel.** Sem escopo a busca varreria o repositório, e leitura ampla é exceção do PI; o termo nunca vem do agente.
- **A `assinatura` do resultado é calculada pelo kernel.** O agente não a envia (chave extra é recusa): ela deduplica o mesmo achado (F04) e um campo livre serviria para esconder um achado repetido ou fabricar um novo.
- **O resultado do agente é dado não confiável, e a evidência só vale se o kernel a confere.** O resultado é o **último** objeto JSON da saída (o prompt traz um exemplo com a forma do resultado, e um eco dele não vence a resposta). `arquivo`, `trecho` e `documento` só valem se citam um caminho do `ContextPack` da tarefa — ou, para o escritor, um arquivo do próprio diff provado; `teste` e `documento` fora do pacote seriam texto livre do agente. `resultado-de-testes@1` exige `arquivo` e `trecho` (o agente não roda teste: o texto que ele chama de "resultado de teste" não é evidência). Sem evidência válida o estado é `incompleta`, nunca `concluida`. Todo `motivo` derivado de texto do agente tem teto de 160 caracteres, e a regra de conclusão do plano entra no pedido numa linha só.
- **Prova de escopo.** Além do write set, o kernel recusa como nome inválido `.gitattributes` e `.gitmodules` (em qualquer pasta), `.gitmeta` do sandbox não conta como trabalho do escritor, e o diff enxerga arquivos ignorados pelo `.gitignore` (um arquivo ignorado também é alteração). A busca do contexto que estoura o teto é descartada com o motivo `busca-truncada`, não devolvida pela metade.
- **Várias tarefas do mesmo escritor rodam em sequência**, cada uma partindo do commit da anterior que concluiu (`baseDoEscritor`); se a anterior não concluiu, a seguinte parte da base original. Escritores diferentes seguem em paralelo, até o que o pool permitir.
- **O proxy do executor roteia por unidade** (`/u/<32 hex>`, uma chave por escritor e tentativa): `workspaceId` e `ContextPack` da unidade, não os do processo; recusa requisição com `Origin`, responde 403 **antes** de ler o corpo e limita o corpo a 8 MiB (413).
- **Fim do run acorda quem esperava slot.** O run que termina tira os itens dos escritores da fila e o `FilaService` avisa (`aoCancelarEspera`) o `GerenteDeSlots`, que resolve a espera como `cancelada` mesmo sem sinal de cancelamento. Um heartbeat que lança é lease perdido, não exceção não tratada; `preparar` do sandbox que lança libera a chave do proxy e o container; `ExecutorDoSquad.executar` nunca rejeita (deixa quem já rodava terminar e marca o resto como `falhou`), e plano com tudo concluído não vira `cancelado` por um sinal tardio.
- **A F00b ([#373](https://github.com/RodReis/rrb-jarvisOS/issues/373)) não estava mergeada** quando a F03 foi puxada, por escolha do PI de 2026-10-02. A F03 não depende do resultado da prova do integrador; a F04 sim.

## Contrato com a F04

A F04 recebe de `ExecutorDoSquad.executar` um `ResultadoDoSquad` (`estado` do plano e uma entrada por tarefa, na ordem do plano, com `estado`, `motivo` e a `execucao` anexada). Do escritor ela lê `commitSha`, `arquivos`, `assinatura` e `resultado`; do worker, `resultado`, `assinatura` e `descartadas`. A `assinatura` é calculada pelo kernel e serve à deduplicação. O integrador (`papel` diferente de `desenvolvedor`) volta do escritor como `papel-nao-suportado`: o fluxo dele (manifesto de hunks) é da F04. O `GerenteDeSlots` só entra em produção quando a F04 ligar `aoAdquirir` e `aoCancelarEspera` ao `FilaService` real.

## Limites declarados

- **Nenhum agente real rodou a F03 ponta a ponta nesta entrega.** Os executores são provados com Git, SQLite e o proxy reais e com agente e Docker dublês; o `claude --print` dentro do container e o Docker do sandbox ficam provados só por teste de unidade (argumentos, encerramento, cancelamento com processo real de dublê). **Não há smoke opt-in desta fatia**; a prova com o CLI real e o Docker reais fica para a F04, que aciona o fluxo completo.
- **Multi-escritor continua desligado** até o MVP-028 (ADR-006, decisão 16); a F03 entrega a mecânica, não a ativação.
- **Cache da árvore do `ContextoDaTarefa`**: a árvore do SHA é listada a cada tarefa. É custo, não corretude; entra quando uma medição mostrar que pesa.
- **Escritor com Bash, rede e segredo** não existem nesta fatia: as ferramentas são Edit/Write/Read/Grep/Glob e o container não tem credencial de Git nem de GitHub.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-10-02.
