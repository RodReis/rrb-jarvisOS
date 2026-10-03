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
- **A F00b ([#373](https://github.com/RodReis/rrb-jarvisOS/issues/373)) não estava mergeada** quando a F03 foi puxada, por escolha do PI de 2026-10-02. A F03 não depende do resultado da prova do integrador; a F04 sim.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-10-02.
