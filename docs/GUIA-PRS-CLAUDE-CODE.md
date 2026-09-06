# Guia de PRs para o Claude Code — rrb-jarvisOS

**Natureza:** orientação operacional deste repositório, solicitada pelo PI em 2026-09-06. Não é uma nova fatia de produto. Complementa `CLAUDE.md`, `TESTING.md` e `REVIEW.md`; não substitui SPECs nem altera permissões ou proteção remota.

## 1. O que executar como rotina

1. Confirmar branch, diff local, issue canônica, SPEC aplicável e base remota. Preservar mudanças de outros trabalhos; não usar `git add -A` em checkout misto.
2. Manter uma finalidade por PR. Código, testes e documentação necessários à mesma entrega ficam juntos. Mudanças independentes ficam em PRs separadas; não separar uma mudança atômica só para reduzir linhas.
3. Fazer commits coerentes e push para preservar o trabalho. Agrupar correções relacionadas antes de iniciar outra rodada de revisão; não acumular grandes alterações sem checkpoint remoto.
4. Rodar lint, typecheck, testes e as provas condicionais de `TESTING.md`. Com relatório alterado, gerar a evidência no ambiente correto e preservar o histórico. Falha de worker ou ausência de infraestrutura nunca vira PASS local.
5. Fazer autorrevisão do diff completo contra a base, inclusive arquivos já commitados. Aplicar `REVIEW.md`: achados verificáveis, revisão do delta, P0/P1 bloqueantes e deduplicação de achados anteriores.
6. Preencher a PR com problema, comportamento antes/depois, `refs #N`, SPEC quando aplicável, validação executada e limitações. Usar o template disponível; descrição deve explicar o resultado final, sem narrar todas as tentativas.
7. Conferir checks na origem para o SHA atual. Para acompanhar, usar `gh pr checks <numero> --watch`, conforme `CLAUDE.md`; silêncio, lista vazia ou processo ainda aberto não significam sucesso.
8. Corrigir no mesmo branch/PR. Novo head ou avanço da base exige reconciliar o que foi validado, seguindo a política vigente; não transportar um PASS antigo para código novo.
9. Integrar por squash quando as condições e autorizações vigentes permitirem. Se houver bloqueio externo ou de permissão, preservar o PR e informar a causa; não contornar o bloqueio nem confundi-lo com defeito de código.
10. Confirmar `mergedAt`/`mergeSha` na origem antes de declarar integrado. Aplicar Feito após merge; fechamento e Finalizado são atos do PI. Documentação da entrega entra no PR; não fazer commit direto na main para registrar o merge.

## 2. O que medir ao investigar demora

Separar tempo de fila de runner, preparação do ambiente, execução de testes, espera por revisão e espera pelo merge. Registrar tentativas por PR e soma dos tempos dos jobs, pois paralelismo pode reduzir espera e aumentar consumo.

Comparar execuções equivalentes e informar quantidade de amostras. Não excluir falhas/cancelamentos da análise de confiabilidade; não tratá-los como sucessos rápidos. Separar PR com E2E, sem E2E e rerun. Metas de 2 minutos para feedback inicial, mediana de CI de 8 minutos e p95 de 10 minutos são propostas locais do plano anterior, não obrigações universais nem garantias do GitHub.

Diagnóstico concreto da #308: o job test durou 16min33s e reexecutou a suíte por 5 minutos somente para exigir carimbo. A #311 combinou as guardas e paralelizou qualidade/prova visual; o job test medido caiu para 7min23s, e o workflow completo para 7min33s. É uma amostra, não projeção proporcional ao percentual de produto concluído.

## 3. O que não é decisão livre do agente

- Alterar rulesets, exigência de reviews, auto-merge nativo ou atualização obrigatória da branch: exige escopo e autorização próprios. Não são consequências automáticas deste guia.
- Remover cobertura, RLS, anti-drift, append-only ou testes para atingir uma meta de minutos.
- Usar `[skip ci]`, cache de PASS ou reruns cegos como solução de desempenho.
- Reescrever um workflow humano ou mudar comandos de validação sem preservar seu contrato.
- Exigir outro aprovador humano por conveniência quando o fluxo é solo, ou pedir novo aceite de produto que já foi dado.
- Introduzir sharding, migrar runners ou contratar infraestrutura sem evidência e recorte de implementação próprios.

## 4. O que merece SPEC

| Mudança | Tratamento |
|---|---|
| Descrição da PR, autorrevisão, comunicação de evidência e organização do diff | Este guia e contratos existentes |
| Otimização concreta do workflow deste repositório | Entrega de infraestrutura com diff, testes e medição; a #311 cobre o primeiro caso |
| Pipeline gerar CI para outras stacks, controlar dependências e guardar evidência por projeto | [SPEC-Pipeline-01](spec/spec-pipeline-01-politica-pr-ci.md), proposta de funcionalidade |
| Alterar requisito de produto, política de aceitação ou escopo de uma fatia | SPEC/emenda aprovada pelo PI antes de implementar |

## 5. Estado e rastreabilidade

Consulta de 2026-09-06: #311 com seis checks verdes, head `b6e8729b7588f23c2e9bf74d8c3980364d933070`, mas resposta remota `state=OPEN`, `mergedAt=null`, `mergeCommit=null`. O PI a descreveu como finalizada; operacionalmente, diferenciar implementação validada de merge confirmado. Reconsultar a origem antes de agir; este registro não pretende congelar o estado futuro.

O host Windows do PI usa Node 24.15.0. O contrato vigente passa a Node 24 LTS para desenvolvimento e CI. Isso não fixa o patch do Node embutido no Electron: o Electron carrega seu próprio runtime e `electron-rebuild` recompila `better-sqlite3` para o ABI correspondente.

A recomendação de merge autônomo da pipeline não depende da opção de auto-merge nativo do GitHub. O serviço pode acompanhar e integrar pelo adapter, respeitando os gates e o kill-switch já aprovados na SPEC-Entrega-05.

Referências: [práticas de autoria e autorrevisão do GitHub](https://docs.github.com/en/pull-requests/concepts/helping-others-review-your-changes), [checks obrigatórios](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks), [execução da #311](https://github.com/RodReis/rrb-jarvisOS/actions/runs/34046954735) e [issue #310](https://github.com/RodReis/rrb-jarvisOS/issues/310).
