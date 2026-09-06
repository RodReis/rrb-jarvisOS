# SPEC-Entrega-05 — Revisão, CI e merge

- MVP/Fatia: MVP-009 · M9-F05.
- Issue: [#105](https://github.com/RodReis/rrb-jarvisOS/issues/105).
- Status: **aprovada-pi** (2026-08-29) — política do merge autônomo resolvida pelo PI nesta data. **Emenda 2026-08-30 (PI):** o projeto-alvo sem CI recebe workflow gerado pela pipeline; "sem checks" nunca é verde (ver § Emendas).
- Depende de: M9-F04 e GitHub Adapter M6-F04.

## Objetivo

Validar o delta, executar revisões, corrigir falhas elegíveis e concluir o mesmo PR por squash merge automático sem novo aceite do PI.

## Sequência

Escopo → testes/lint/type/build → code/architecture review → design review quando houver UI → QA/smoke → correção/revalidação → commits automáticos → push → `ensurePullRequest` → checks do head atual → recuperação no mesmo PR → confirmação do SHA → squash merge → confirmação na origem.

## Revisão

`REVIEW.md` é a instrução de maior prioridade fornecida pelo projeto aos revisores. O revisor é o próprio executor, em invocação separada no container (M9-F04 § Decisões); a revisão consome orçamento, não tentativa. Baseline: P0/P1 bloqueiam; P2/P3 são registrados. Relatório anterior é usado para deduplicar e avaliar apenas o delta ainda aberto.

## Git automático

- Commits agrupam mudanças coerentes; correções de QA podem ser atômicas.
- Branch e PR são únicos por fatia/run lógico.
- Se a base avançar, rebase e revalidação são automáticos quando seguros.
- Resolução com alteração de código consome tentativa.
- Squash merge não exige aceite humano adicional **quando o merge autônomo está ligado** — padrão do projeto, decidido pelo PI em 2026-08-29.
- **Kill-switch por projeto:** desligado o merge autônomo, o run termina com o PR aberto e verde, em estado terminal explicável, aguardando o PI. Não é bloqueio nem falha.
- A mudança do kill-switch é ação sensível: gera `AuditEvent` e fica registrada no pacote do projeto.

## CI do projeto-alvo

- O projeto gerado pelo MVP-008 **não nasce com CI**, e `checksAprovam` (M6-F04) **recusa lista vazia** — sem esta seção, nenhum run chegaria a `MERGED`.
- **A pipeline gera `.github/workflows/ci.yml`** no projeto-alvo (decisão do PI, 2026-08-30) a partir dos **comandos de validação declarados no pacote** (`TESTING.md`/`CONVENTION.md` do projeto): os mesmos que o executor roda no container. O arquivo é criado uma vez, **no primeiro run** do projeto, dentro do mesmo PR da fatia, e só é reescrito quando os comandos declarados mudam — nunca por cosmética.
- O conjunto de checks obrigatórios é **lido da origem** (ruleset/proteção da branch-base, M9-F01) e persistido com referência e data no `ExternalRef`. **Sem check configurado ou sem conclusão aceita pela origem no `head SHA` esperado, o gate não passa** — é bloqueio explicável (`BLOCKED_EXTERNAL`, ação: configurar/liberar Actions), nunca verde por ausência. `failure`, `cancelled`, `timed_out`, check ausente e SHA obsoleto não passam.
- Merge queue fica fora do MVP-009: repositório que a exige termina em `AWAITING_MERGE` com a causa registrada.
- **Snapshot do ruleset** (emenda aprovada pelo PI em 2026-08-30): o conjunto obrigatório observado na origem é persistido com referência e data no início do run. Mudança de ruleset ou de check obrigatório **durante** o run força novo snapshot e reconciliação — o gate nunca compara com uma regra que já não vale.

## Critérios de aceite

1. Diff fora da SPEC não chega ao push.
2. P0/P1 aberto impede merge.
3. CI verde pertence ao `head SHA` esperado.
4. Stale SHA impede merge e força reconciliação.
5. Falha corrigível mantém o mesmo PR.
6. `mergeSha` é confirmado na origem.
7. Código do comando zero, sozinho, não prova sucesso.
8. **Kill-switch respeitado:** com merge autônomo desligado, o run para em `AWAITING_MERGE` (M9-F02) sem mergear e sem marcar falha; com ligado, mergeia e confirma na origem. Teste dos dois caminhos.
9. **Projeto sem CI recebe o workflow gerado no primeiro PR**, e o run seguinte o encontra e não o reescreve. Teste.
10. **Sem check configurado não há merge:** lista vazia de checks termina em bloqueio explicável, nunca em `MERGED`. Teste.
11. **Ruleset em movimento:** mudança de ruleset/check obrigatório durante o run força novo snapshot e reconciliação. **Emenda aprovada pelo PI em 2026-09-06:** check obrigatório só satisfaz o gate com `success`; `neutral`/`skipped` não comprovam a validação exigida. Teste.
12. **Merge queue:** repositório que a exige termina com PR verde em `AWAITING_MERGE` e bloqueio externo explicável; a pipeline **não** tenta contorná-la. Teste.
13. **`STATUS.md`, `STATUS-ARQUIVO.md` e o relatório de testes do projeto-alvo entram no mesmo PR, antes do merge** — nunca em commit direto na branch-base depois dele (invariante 10 da CONVENTION §4; Convention do próprio projeto-alvo). A M9-F06 só grava o `ExecutionLedger` local.

## Testes e evidência

Fixtures de review/CI; integração de PR existente, CI failure, stale SHA, rebase e merge já ocorrido; smoke GitHub real. Relatório `SPEC-Entrega-05`.

## Perguntas resolvidas pelo PI (2026-08-29)

1. **Merge autônomo:** **ligado por padrão, com kill-switch por projeto**. É a tese do MVP-009 e já está na ARCHITECTURE ("Git após aprovação é automático; merge não cria aceite adicional") e na invariante 7 da CONVENTION §4. O kill-switch existe para projeto com outros colaboradores, onde entrar na `main` sozinho não é aceitável; nele, o run termina no PR verde aguardando o PI. Descartado opt-in com padrão desligado: transformaria o MVP em "abre PR e espera", que é o que ele existe para superar. — decidido.

## Decisões cravadas pelo Cowork (coerentes com decisões anteriores; PI pode vetar)

- **Merge integra código; não é aceite de fatia.** O aceite do PI continua sendo o fechamento da issue — o mesmo princípio que este repositório aplica a si (CLAUDE.md § Ciclo de vida). O merge autônomo não fecha issue nem aplica rótulo de aceite.
- **`closes #N` é proibido no corpo do PR gerado**; sempre `refs #N`, pelo mesmo motivo.
- **Revisão roda sobre o delta**, com o relatório anterior deduplicando o que já foi resolvido; P0/P1 abertos bloqueiam o merge mesmo com o kill-switch ligado.

## Emendas (2026-08-30) — revisão de furos de spec, decididas pelo PI

1. **CI do projeto-alvo** (seção nova; critérios 9 e 10). Alternativas postas ao PI: gerar o workflow (escolhida), aceitar validação local como equivalente (quebraria a invariante 6 — verde sem corresponder ao `head SHA` na origem), ou nunca mergear sem CI configurado à mão.
2. **Docs do projeto no PR, não pós-merge** (critério 11): a M9-F06 mandava atualizar `STATUS.md` depois de confirmar o merge, o que só seria possível por commit direto na branch-base — contra a Convention gerada e contra a M9-F04 ("no mesmo PR").
3. **Quem revisa** estava implícito; agora aponta para a M9-F04.
