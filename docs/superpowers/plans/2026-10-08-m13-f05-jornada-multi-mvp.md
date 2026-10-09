# Plano — M13-F05 Jornada multi-MVP (#138)

## Objetivo

Entregar a prova integrada do MVP-013: a pipeline deve atravessar o DAG aprovado, sem nova aprovação da mesma revisão, e parar em estado `drained` ou em bloqueios explicáveis. Não executar deploy, não fechar issue e não ampliar permissões da jornada.

## Base e limites

- SPEC aprovada: [`docs/spec/spec-continuo-05-jornada-multi-mvp.md`](../../spec/spec-continuo-05-jornada-multi-mvp.md).
- Contrato transversal: `docs/superpowers/specs/2026-08-29-pipeline-desenvolvimento-ia-v2-design.md`.
- Relatório identificável por SPEC/issue segue `docs/TESTING.md` §11.3; relatório agregado `reports/TESTS.md` continua gerado pelo CI.
- Smokes reais de GitHub/CLI são opt-in e só podem usar repositório de prova exclusivo; suíte comum usa adapters fake.
- Destino de produto para o relatório final permanece pendente de decisão do PI. Até lá, não decidir entre painel permanente e artefato da jornada/CI.

## Passos

1. Mapear critérios para os contratos e componentes já entregues por F01–F04; identificar lacunas que impedem provar critérios sem simular sucesso.
2. Construir a fixture de jornada multi-MVP usando inventário/DAG aprovados, gates, duas fatias independentes, dependências e revisão pendente.
3. Provar concorrência limitada a duas fatias independentes e serialização dos merges; após reinício, reconciliar intenção/efeito/confirmação sem duplicar run, branch, PR, gasto ou merge.
4. Injetar gate não aprovado e falhas em fronteiras duráveis; confirmar parada somente do ramo dependente, continuidade independente, bloqueio explicável e cancelamento que preserva efeitos remotos e merge confirmado.
5. Produzir evidência que reconstrua decisões e revisões, executores, consumo, checks, SHAs, bloqueios e nós fora do autorizado. Resolver o destino de apresentação com o PI antes de qualquer tela/contrato persistente adicional.
6. Rodar build, lint, testes pertinentes por categoria, E2E da jornada e guardas de relatório; marcar smoke externo como `not_run` se o repositório de prova/credenciais permanecer indisponível.
7. Atualizar docs/DEVELOPMENT.md, docs/STATUS.md, doc de relatório por SPEC/issue e evidência gerada; revisar diff e criar PR `refs #138`, sem `closes #138`.

## Critérios de conclusão

- Os sete critérios da SPEC têm prova nomeada, incluindo dois MVPs e múltiplas fatias, idempotência após reinício, gate seletivo, cancelamento, relatório final reconstruível e ausência de deploy/fechamento automático.
- CI verde no SHA da PR; relatório gerado/validado pelas ferramentas do projeto.
- Após merge confirmado: comentário na issue com Resumo da implementação, Aprendizado e Imprevistos; aplicar `proplan:done`, mantendo a issue aberta para aceite do PI.

## Riscos e decisão pendente

- A SPEC deixa o meio de apresentação do relatório em aberto. O painel agrega valor operacional, mas exige contrato de consulta/histórico e superfície UI; artefato versionado integra com a evidência de QA existente. Não escolher uma dessas alternativas sem resposta do PI.
- O smoke real previsto depende de acesso a repositório exclusivo. Até agora a consulta a `RodReis/rrb-jarvisos-smoke` retornou 404; não criar repositório nem apontar para o repo de trabalho sem autorização/acesso adequado.
