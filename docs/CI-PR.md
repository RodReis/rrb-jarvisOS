# Tempo e qualidade das PRs

## Diagnóstico de 2026-09-06

Fonte: [última execução da PR #308](https://github.com/RodReis/rrb-jarvisOS/actions/runs/34045544271).

| Etapa | Duração observada |
|---|---:|
| Job test | 16min33s |
| Instalação npm | 16s |
| Lint + typecheck | 55s |
| Instalação Chromium + prova visual | 2min28s |
| Subida do Supabase | 2min16s |
| Suíte + guarda anti-drift | 5min26s |
| Segunda suíte para exigir histórico | 5min |
| E2E completo, em paralelo | 2min56s |

O caminho crítico é o job test. A segunda chamada do orquestrador executava todos os runners
novamente apenas para acrescentar `--require-entry`, embora o gerador aceite essa flag junto
com `--check`. Lint e prova visual atrasavam a subida do banco sem depender dela.

## Mudança implementada

- Uma execução da suíte, preservando cobertura, anti-drift, append-only e carimbo condicional.
- Jobs independentes de qualidade e prova visual, agregados pelo mesmo `gate` obrigatório.
- Categorias do relatório (`regras`, `banco`, `tela`) preparadas para rodar em paralelo, com
  agregação posterior dos JSONs e coberturas do ADR-003.
- Falha no filtro bloqueia o gate; alteração no workflow também exercita o E2E.
- Limites de tempo explícitos por job, cache npm e cancelamento de pushes antigos preservados.
- Supabase CLI fixado em `v2.116.0`; não usar `version: latest`, porque a resolução dinâmica
  consulta releases no GitHub e pode falhar por rate limit antes de qualquer teste rodar.
- Template de PR com problema, rastreabilidade, evidência e limites.

Estimativa feita na #311, baseada nesta execução: caminho crítico próximo de 8 minutos, contra
16min33s. **Superada pela medição da #312**, registrada logo abaixo — fica como registro do que
se projetou, não como número vigente.
É uma projeção, não um benchmark: fila, downloads, runner e crescimento da suíte variam.
A paralelização adiciona duas instalações npm curtas; a remoção da segunda suíte elimina
cerca de cinco minutos de runner observados. Não se usa cache de resultados de teste.

Nova medição da #312, após rebase sobre a #311 e paralelização das categorias: workflow
completo em 4min56s. `test-regras` passou em 54s, `test-tela` em 3min22s,
`test-banco` em 4min34s, `test` agregado em 11s e `gate` em 3s. O caminho crítico
restante é o banco/Supabase, não mais a soma das três categorias Vitest.

## Rotina de PR

1. Uma finalidade por PR, mantendo código, testes e documentação necessários juntos.
2. Antes do push de revisão, executar as verificações pertinentes e conferir o diff.
3. Informar `refs #N`, comportamento antes/depois e limitações reais; evitar narrativas longas
   de tentativas abandonadas na descrição.
4. Aguardar o gate do SHA atual, pelo watcher oficial do GitHub; integrar conforme o contrato
   Git do projeto, sem nova aprovação do mesmo escopo. Aceite da issue permanece com o PI.
5. Comparar duração total, fila e etapas em PRs equivalentes. Acompanhar mediana e p95 de um
   conjunto de execuções; uma única amostra não comprova estabilidade nem escalabilidade.

Não reduzir cobertura, desabilitar RLS ou pular toda a suíte em PR documental para atingir
uma meta de tempo. Separação das categorias só vale com nova medição e preservação da
agregação de evidências do ADR-003: os números continuam vindo dos JSONs dos runners, não
de texto digitado no workflow.

## Referências oficiais consultadas

- [PRs pequenas, focadas e com contexto](https://docs.github.com/en/pull-requests/concepts/helping-others-review-your-changes).
- [Jobs e dependências](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs).
- [Checks obrigatórios e jobs pulados](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).
- [Cache de dependências](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching).
- [Padronização de PRs e templates](https://docs.github.com/en/pull-requests/reference/managing-and-standardizing-pull-requests).
