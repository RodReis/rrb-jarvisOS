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

## Perguntas abertas ao PI

Nenhuma. Revisão exata aprovada pelo PI em 2026-10-02.
