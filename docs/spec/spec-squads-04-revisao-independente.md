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

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-10-02; decisões de implementação em 2026-10-03.
