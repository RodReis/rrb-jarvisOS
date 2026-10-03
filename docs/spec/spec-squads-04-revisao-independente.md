# SPEC-Squads-04 — Integrador, TESTE → REVIEWER e retrabalho

- MVP: `docs/mvp/mvp-011-squads-limitados.md` (Fatia 04).
- Issue: [#125](https://github.com/RodReis/rrb-jarvisOS/issues/125); épico [#121](https://github.com/RodReis/rrb-jarvisOS/issues/121).
- Status: **aprovada-pi** (2026-10-02) — revisão exata do PR #367 aprovada pelo PI; reescrita em 2026-10-02 pela ADR-006 (decisões 6 e 10).
- Depende de: M11-F03.

## Objetivo

Juntar o trabalho dos escritores com prova de que nada se perdeu, testar antes de revisar e devolver ao DEVELOPER somente o que é novo, dentro do limite de tentativas já aprovado.

## Dentro

- **Agente integrador** com a camada definida no perfil, diferente da do revisor. Ele produz o resultado integrado num worktree de integração; o kernel commita.
- **Manifesto de hunks**: cada hunk de cada escritor aparece no resultado ou consta como descartado com motivo; o kernel confere o manifesto contra os diffs reais.
- Etapa **TESTE**: suíte do projeto sobre o resultado integrado.
- Etapa **REVIEWER**: revisores distintos dos escritores e do integrador; executor cruzado quando elegível. A entrada traz SPEC, `docs/REVIEW.md`, diff, manifesto, resultado dos testes e achados ainda abertos.
- Achado estruturado: assinatura, categoria, severidade, localização, evidência, impacto, correção esperada.
- Deduplicação e ciclo de vida `open`, `accepted`, `fixed`, `dismissed`, `superseded`.
- **Retrabalho:** reprovação em TESTE ou REVIEWER volta ao DEVELOPER com os achados deduplicados, dentro do limite da M9-F04; esgotado o limite, a issue para com motivo para o PI.

## Fora

- Revisor ou integrador fazendo commit, push ou alterando severidade sem justificativa.
- Integração aceita sem manifesto conferido.
- Reabrir achado resolvido sem novo delta material.
- Inventar requisito, LGPD, consentimento, risco ou aceite não fornecido pelo PI.

## Regras

1. Hunk perdido sem registro, suíte vermelha ou revisão sem parecer **param** a integração; não há "aceitar mesmo assim".
2. Relatórios anteriores servem só para avaliar o novo delta e regressões reais.
3. Severidade segue `docs/REVIEW.md`; ausência de regra não autoriza inventar bloqueio.
4. Achado fora da SPEC é observação separada e não bloqueia a issue automaticamente.
5. Só escritores consomem correções aceitas.

## Critérios de aceite

1. Hunk removido de propósito pelo integrador é detectado e para o run.
2. O mesmo problema no mesmo delta gera uma assinatura, não várias falhas.
3. Achado corrigido some ou muda de estado após revalidação objetiva.
4. Revisor e integrador não recebem permissão de Git nem conseguem obtê-la por prompt.
5. Retrabalho respeita o limite da M9-F04 e registra cada volta.
6. Conflito entre revisores sem evidência conclusiva não é resolvido por voto nem pela autoridade do agente.

## Testes e evidência

- manifesto com perda injetada, descarte justificado e integração limpa;
- ciclo TESTE → REVIEWER → DEVELOPER até o limite;
- deduplicação por assinatura.

## Decisões de implementação (PI, 2026-10-03)

Tomadas ao puxar a F04, depois de o Code mapear o código da F03 e achar quatro pontos que a SPEC não fixava. Registradas aqui porque a opção recusada também é decisão.

1. **Como o integrador produz o resultado.** **Decidido:** o kernel faz o merge determinístico (`git merge-tree --write-tree`); o agente integrador, na camada da fase (nota pós-F00b da ADR-006), devolve JSON só para os **blocos em conflito**; o kernel monta a árvore, materializa o worktree de integração e commita. O agente não tem ferramenta nem Git. É o fluxo medido na F00b (6/6, zero hunk perdido). *Recusadas:* agente com Edit/Write livre no worktree de integração (superfície maior, fluxo sem prova real); os dois fluxos atrás de opção do perfil (dobra a superfície de teste sem medição que justifique).
2. **Contagem do retrabalho.** **Decidido:** **por run**, inicial mais duas voltas, pela fonte única `proximaTentativaPermitida` (M9-F04, SPEC-Entrega-04). Revisão não consome tentativa; só a correção que ela dispara. *Recusada:* três tentativas por tarefa DEVELOPER (teto do run passaria de seis voltas e fugiria da M9-F04 literal).
3. **Persistência dos achados.** **Decidido:** tabela nova (migração 49) com repositório próprio e `UNIQUE(run, assinatura)`; o `ExecutionLedger` é resumo do run e não comporta o ciclo de vida. *Recusada:* achados em memória no run com só o resumo no `AuditEvent` (perde o ciclo se o app reiniciar no meio).
4. **Escopo da entrega.** **Decidido:** serviços (integrador, revisor, etapa TESTE, retrabalho, achados) provados com Git e SQLite reais, **ligação do `GerenteDeSlots` ao `FilaService` real** (`aoAdquirir` e `aoCancelarEspera`, pendência da F03) **e smoke opt-in com `claude` e Docker reais** (a F03 empurrou essa prova para cá). Sem IPC nem tela (MVP-028). Sem credencial ou Docker o smoke registra `not_run`, nunca `pass`.

### Adotado pelo Code (a confirmar)

- **O merge é `git merge --no-commit --no-ff` num worktree de integração**, não `merge-tree --write-tree`: o mesmo merge determinístico do kernel, com os blocos em estilo diff3, e o worktree que a SPEC pede. O worktree nasce no commit de um escritor, recebe o do outro e sai **sem `--force`** (`merge --abort` e `worktree remove`); o resultado fica na branch de integração.
- **Quem lê o conflito não confia no texto.** O texto do arquivo é do escritor: uma linha `>>>>>>>` dentro de um lado fecharia o bloco antes da hora e deixaria o resto dos marcadores como texto "resolvido". Estrutura ambígua (marcador solto, marcador dentro de um lado, bloco sem `=======`), conflito em `.gitattributes`, `.gitmodules` ou `.lfsconfig`, e mais de 50 blocos por integração **param o run antes de qualquer chamada ao modelo**.
- **O manifesto confere o diff da base até o commit de integração (`git diff -M -U0`), contando ocorrências e seguindo rename** — não "a linha existe no arquivo", que é o que a F00b mediu. Aquele instrumento reprovava um merge limpo quando a linha removida existia em outro ponto do arquivo, reprovava rename com edição do outro escritor e aprovava um hunk apagado cuja linha já existia noutro lugar. O `prova/manifesto-hunks` ficou como está (instrumento medido); a produção tem `squad-diff` e `squad-manifesto`.
- **Descarte só explica o que está no bloco daquele arquivo.** O integrador que **combina ou reescreve** uma linha precisa declarar o trecho original em `descartes`; o resultado devolve as linhas novas da resolução e o manifesto em texto, com cada descarte, que é a entrada do REVIEWER.
- **Revisor e integrador só em provider sem ferramenta** (`claude-code`, `anthropic`, `gemini`, `ollama`). O `codex exec` não desliga as ferramentas, só restringe o alcance (`--sandbox read-only`); um revisor nele poderia rodar `git log` ou ler fora do worktree. Critério 4 vale por construção, não só por prompt.
- **O veredito é do kernel e é conservador.** Achado só vale em arquivo **do delta**, com trecho (≥ 10 caracteres sem espaço) que o kernel reencontra no commit. `FIX_REQUIRED` sem nenhum bloqueante conferido vira **BLOCKED** (`parecer-sem-evidencia`), e não `PASS`. **Rebaixar** a severidade de um bloqueante já registrado não a muda: vira contestação (BLOCKED por conflito). **Todo** revisor escolhido precisa devolver parecer; um timeout do revisor cruzado não deixa o outro aprovar sozinho.
- **A correção aceita pendente segue** quando a suíte quebra na volta que a aplicava (o escritor continua sabendo que o achado está aceito).
- **A porta `produzir` do ciclo** devolve um commit pronto (o do escritor, ou o da integração). A **composição** — `ExecutorDoSquad` + integrador + ciclo, ligados a IPC e tela — é o MVP-028; em produção, esta fatia liga só o `GerenteDeSlots` ao `FilaService` (`ganchosDosSlots` em `index.ts`).

## Limites declarados

- **A etapa TESTE não rodou em Docker real.** O Docker Desktop desta máquina estava com o engine em erro 500 em 2026-10-03 (`docker info` não respondia; o `docker-egress.int-spec.ts` existente também cai por timeout). O `SuiteNoSandbox` está provado com Preflight e Docker dublês e a decisão (verde só com todo passo verde; `nao-rodou` nunca é verde; falha externa não gasta tentativa) com banco real. **`not_run`**, não `pass`: o smoke com Docker real fica para quando houver engine.
- **O `claude` rodando dentro do container do escritor continua sem prova real**: a imagem do sandbox (`node:22-bookworm`) não traz o binário (bloqueio conhecido da M9-F04).
- **Smoke real com o `claude` CLI (modelo da fase) passou** em 2026-10-03 para o integrador (um bloco em conflito, 2/2 hunks preservados, esquema aceito) e para o revisor (achado P1 com trecho conferido no commit). Opt-in: `JARVIS_SMOKE_FASE=1`.
- **O ciclo não é retomável**: começa sempre na tentativa 1, e a segunda execução do mesmo run esbarra no registro das voltas (`erro-interno`). O registro no banco já guarda o que a retomada precisaria.
- **A revalidação objetiva só vê "trecho removido".** Uma correção que acrescenta uma guarda acima da linha, ou conserta em outro arquivo, mantém o achado `accepted`; o jeito de dizê-lo é contestar, e isso para o run. É o desenho aceito; refinar é decisão futura.
- **A assinatura é categoria + arquivo + trecho.** O mesmo defeito citado com trechos ou categorias diferentes gera duas assinaturas, e as duas voltam ao escritor. O custo aceito pela deduplicação (`REVIEW.md`).
- **`dismissed` e `superseded` não têm produtor nesta fatia.** Quando o `dismiss` existir, ele precisa gravar `deltaDoFechamento`, senão o próximo delta o reabre.
- **A classe da falha da suíte lê o texto da saída** (`classificarFalha`, M9-F04): uma suíte vermelha que mencione `rate limit` ou `403 forbidden` vira `externo` e o ciclo para com `falha-externa` em vez de retrabalhar. A direção é segura (para), mas o escritor controla esse texto.
- **O gate destrutivo do `TerminalEngine` casa `clean` e `reset` por argumento exato**: um arquivo em conflito chamado `reset` ou `clean` faz o `git add` pedir aprovação, e o run para (`resolucao-nao-gravada`). Refinar o padrão é decisão de política.
- **O worktree e a branch `teste-t<n>` que o Preflight cria para a suíte** ficam para a limpeza da M9-F06.
- **Uma falha de `criarWorktree` depois de o worktree nascer** (ao ler o gitdir) devolve `worktree-recusado` sem remover o que nasceu.

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-10-02; decisões de implementação em 2026-10-03. As escolhas da seção "Adotado pelo Code" aguardam confirmação no aceite.
