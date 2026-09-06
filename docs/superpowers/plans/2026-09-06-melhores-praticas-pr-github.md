# Plano de adoção de boas práticas de PR no GitHub

> **Desdobramento solicitado pelo PI:** a rotina deste repositório está no [Guia de PRs para Claude Code](../../GUIA-PRS-CLAUDE-CODE.md); o comportamento genérico proposto para a pipeline está na [SPEC-Pipeline-01 R1](../../spec/spec-pipeline-01-politica-pr-ci.md), em rascunho. As sugestões de configuração remota deste plano não viram imposições universais da pipeline. A M9-F05 continua dona do merge autônomo com kill-switch. Estado de PR abaixo é uma observação datada, não dispensa consulta atual à origem.

> **Para execução por agentes:** executar uma entrega por vez, revisar o delta e validar seus critérios antes de avançar. Este documento é planejamento solicitado pelo PI, não autorização de merge ou de alteração das proteções remotas.

**Objetivo:** reduzir espera e retrabalho nas PRs do jarvisOS sem perder cobertura, rastreabilidade ou validação da combinação integrada.

**Arquitetura:** manter branches curtas, PRs com finalidade única e um gate obrigatório que agrega provas independentes. Medir o ciclo completo antes de introduzir paralelismo adicional; preservar o relatório do ADR-003 e o aceite exclusivo do PI nas issues.

**Tecnologias:** GitHub Pull Requests, GitHub Actions, GitHub CLI, Vitest, Playwright/Electron e Supabase local.

**Estado:** proposta para avaliação do PI, em 2026-09-06. Nenhuma etapa nova executada por este plano.

## 1. Ponto de partida verificado

| Item | Evidência |
|---|---|
| PR #308 | Último job test: 16min33s; duas execuções da suíte, segunda de 5min |
| PR #311 | Aberta, seis checks verdes, SHA `b6e8729b7588f23c2e9bf74d8c3980364d933070`; ainda não integrada |
| Resultado da #311 | test 7min23s; workflow completo 7min33s; redução observada de 55,4% no job test |
| Proteção consultada da main | `gate` obrigatório; atualização da branch não obrigatória (`strict=false`); sem reviews obrigatórios; resolução de conversas não obrigatória |
| Configuração do repositório | Privado, proprietário do tipo User, squash permitido, auto-merge desabilitado |
| Estrutura dos testes | Três projetos Vitest: regras, banco e tela; banco usa `fileParallelism: false` por isolamento de disco e singletons |

A redução da #311 é uma comparação entre duas execuções, não mediana nem garantia de 55% permanente. O percentual de produto concluído não projeta linearmente o tempo do CI. Contam o crescimento da suíte, a inicialização de serviços, a fila de runners e a quantidade de tentativas.

## 2. Métricas e metas propostas

Separar quatro relógios: fila do runner, duração do CI, espera por revisão e espera entre elegibilidade de merge e integração. Medir também tentativas por PR e soma de minutos de jobs; reduzir tempo decorrido pode aumentar custo.

| Indicador | Meta inicial proposta | Como interpretar |
|---|---|---|
| Feedback de lint/typecheck | Até 2 minutos após o job iniciar | Não inclui fila |
| CI completo | Mediana até 8 minutos; p95 até 10 minutos | Metas internas, não limites recomendados pelo GitHub |
| Confiabilidade | Nenhum falso verde nos contrafactuais do gate | Cancelamento/falha nunca pode dispensar prova obrigatória |
| Retrabalho | Registrar tentativas por PR e motivo de reexecução | Separar defeito real, instabilidade e infraestrutura |
| Custo | Registrar soma de duração dos jobs por PR | Não confundir com minutos faturados, que dependem do plano e runner |

Usar inicialmente 20 execuções comparáveis, incluindo as malsucedidas na análise de confiabilidade. Calcular duração dos sucessos separadamente; contar cancelamentos e falhas sem fazê-los parecer runs rápidos. Com amostra pequena, p95 é exploratório. Não misturar PR com E2E e PR sem E2E, nem execução inicial e rerun, sem identificar o grupo.

## 3. Entregas na ordem recomendada

### Entrega 1 — Consolidar a otimização já existente

**Arquivos:** `.github/workflows/ci.yml`, `.github/pull_request_template.md`, `docs/CI-PR.md` e `docs/TESTING.md`, já presentes no branch da PR #311. Não recriar essa implementação a partir da main antiga.

- [ ] Confirmar o diff e os checks do SHA atual da #311.
- [ ] Obter autorização explícita para o merge que foi bloqueado pela revisão automática; este plano não a substitui.
- [ ] Se a base mudou, atualizar o branch e validar novamente a combinação antes de integrar.
- [ ] Integrar a PR e registrar o link na #310; aplicar Feito após merge, sem fechar a issue.

**Aceite:** seis checks verdes no estado integrado, suíte executada uma vez, prova visual e E2E mantidos e nenhuma proteção removida. A evidência da #311 já confirma o primeiro benchmark; repetir apenas se houver mudança relevante ou necessidade de validar base atualizada.

### Entrega 2 — Padronizar autoria e revisão

**Arquivos:** `.github/pull_request_template.md`, `docs/CI-PR.md` e `docs/REVIEW.md`.

- [ ] Usar uma finalidade por PR, mantendo código, testes e documentação necessários à mesma mudança juntos.
- [ ] Dividir mudanças independentes antes de codificar; evitar fatiar artificialmente uma mudança atômica para cumprir número de linhas.
- [ ] Usar Draft enquanto a solução ainda não está pronta para revisão; Draft não será usado para dispensar CI.
- [ ] Preencher problema, antes/depois, `refs #N`, SPEC aplicável, validação, limites e arquivos centrais da revisão.
- [ ] Fazer autorrevisão do diff antes de pedir revisão. Corrigir achados em lotes coerentes e fazer push ao concluir cada correção verificável.
- [ ] Revisar o delta e suas dependências diretas, registrar achados por gravidade e evitar reabrir achados resolvidos sem nova evidência.
- [ ] Separar aprovação técnica de aceite de produto: o PI continua responsável pelo aceite e fechamento da issue.

**Aceite:** três PRs consecutivas com finalidade identificável, rastreabilidade e evidência suficiente para revisão sem consultar a conversa do agente. Não adotar limite rígido de linhas nem exigir um segundo humano inexistente no fluxo solo.

**Conteúdo mínimo da descrição:** “Problema: [gatilho concreto]. Resultado: [comportamento verificável]. Rastreabilidade: refs #N e SPEC aplicável. Validação: comandos, resultados e limites. Revisão: pontos que merecem atenção.” Os campos são preenchidos com fatos da entrega; nenhum PASS presumido.

### Entrega 3 — Garantir integração sobre estado validado

**Superfície:** proteção da main/configurações de merge no GitHub; `docs/CI-PR.md` e `docs/REVIEW.md` para registrar a política.

- [ ] Capturar a configuração anterior para permitir reversão precisa.
- [ ] Propor habilitar a exigência de branch atualizada antes de merge, preservando o `gate` obrigatório e seu emissor.
- [ ] Propor exigir resolução das conversas de revisão; conversa resolvida precisa ter correção ou justificativa técnica, não apenas clique automático.
- [ ] Confirmar disponibilidade do auto-merge no plano da conta. Se disponível e autorizado, habilitar squash automático após requisitos cumpridos.
- [ ] Continuar com merge acompanhado pelo agente quando auto-merge nativo não estiver disponível; não contornar restrições de aprovação.
- [ ] Manter reviews humanos obrigatórios fora da configuração inicial solo. Reavaliar quando houver outro mantenedor capaz de revisar.

**Aceite:** prova controlada de que check vermelho bloqueia merge, mudança no head invalida o verde anterior e avanço da base exige validação atualizada. Auto-merge, se adotado, não ignora nenhum desses requisitos. Autorização de alterar configurações é decisão separada da aprovação conceitual deste plano.

**Trade-off:** exigir base atualizada pode gerar CI adicional quando a main avança. É custo de validar a integração, não desperdício equivalente à suíte duplicada. Coordenar a ordem de integração para evitar atualizações sucessivas desnecessárias.

### Entrega 4 — Medir e tratar instabilidade

**Arquivos:** registrar análise em `docs/CI-PR.md`; consultar `scripts/test-report.mjs`, `scripts/gen-test-report.mjs` e a issue #232 antes de propor correção de worker. Não misturar a correção da #232 com a otimização já validada na #311.

- [ ] Extrair dos runs os horários, resultados e durações por job/etapa; vincular run, tentativa, PR, head SHA e base validada.
- [ ] Classificar falhas entre aplicação, teste instável, infraestrutura e falta de permissão/ambiente local.
- [ ] Comparar contagens e cobertura com o relatório canônico, não apenas código de saída.
- [ ] Investigar workers encerrados pela issue existente #232; não criar duplicata nem aceitar arquivos de teste desaparecidos sob verde.
- [ ] Reexecutar só jobs que falharam quando a causa for transitória e o estado validado permanecer o mesmo. Correção de código exige nova validação do novo estado.

**Consulta inicial, somente leitura:**

```powershell
gh run list --repo RodReis/rrb-jarvisOS --workflow ci.yml --limit 30 --json databaseId,event,headSha,createdAt,startedAt,updatedAt,status,conclusion
gh pr checks 311 --repo RodReis/rrb-jarvisOS
```

**Aceite:** baseline com grupos comparáveis, tempos de fila e execução separados, falhas contabilizadas e nenhuma alegação de melhora baseada apenas no run mais rápido. A análise é sob demanda neste plano; não criar automação recorrente sem solicitação.

### Entrega 5 — Paralelizar categorias, somente se as métricas justificarem

**Arquivos candidatos:** `.github/workflows/ci.yml`, `scripts/test-report.mjs`, `test-report.config.json` e `docs/TESTING.md`. Manter a geração de relatório centralizada; não somar percentuais de cobertura.

- [ ] Abrir esta entrega apenas se a mediana/p95 ultrapassar a meta ou a suíte voltar a dominar o ciclo.
- [ ] Experimentar primeiro jobs por categoria já existente: regras, banco e tela. Supabase sobe apenas no job banco; manter a serialização interna de banco.
- [ ] Fazer cada job produzir JSON e cobertura no caminho definido por `test-report.config.json`.
- [ ] Agregar apenas artefatos da mesma execução/tentativa e do mesmo SHA. Exigir todas as categorias esperadas e rejeitar artefato ausente, incompleto ou de execução anterior.
- [ ] Executar o gerador central sem repetir os runners, com `--check` e carimbo condicional preservados.
- [ ] Comparar tempo total e soma de minutos de jobs antes de adotar. Sharding dentro de tela só será avaliado se separar categorias não bastar.

**Experimentos por categoria:**

```powershell
npx vitest run --project regras --coverage --coverage.reporter=json-summary --coverage.reportsDirectory=coverage/regras --reporter=json --outputFile=reports/.raw/regras.json
npx vitest run --project banco --coverage --coverage.reporter=json-summary --coverage.reportsDirectory=coverage/banco --reporter=json --outputFile=reports/.raw/banco.json
npx vitest run --project tela --coverage --coverage.reporter=json-summary --coverage.reportsDirectory=coverage/tela --reporter=json --outputFile=reports/.raw/tela-vitest.json
```

Esses comandos são experimentos de planejamento; banco exige o ambiente real previsto em `docs/TESTING.md`. O YAML e os testes de transporte/agregação de artefatos pertencem ao plano técnico desta entrega condicional, a ser fechado após a medição, não à #311.

**Aceite:** mesmos testes, resultados e cobertura por categoria; os contrafactuais de job falho, cancelado, categoria ausente e SHA incorreto bloqueiam o gate. Adotar somente com ganho medido e custo explicitado.

## 4. Práticas que não entram agora

- **Merge queue:** documentação consultada restringe disponibilidade a repositórios de organizações nas modalidades indicadas; o atual é privado de usuário. Reavaliar somente se mudar a modalidade, houver elegibilidade e volume concorrente que justifique. Exigiria também suporte a `merge_group` e metadados sem dependência exclusiva de `pull_request`.
- **CI reduzido para documentação:** não dispensar a suíte inteira enquanto o ADR-003 exigir reexecução. Uma eventual política de seleção por impacto exige contrato explícito e fallback que rode tudo quando a classificação falhar.
- **Runners maiores/self-hosted:** sem contratação ou migração antes de medir o gargalo remanescente e o custo operacional.
- **Retries para ficar verde:** repetição sem diagnóstico esconde instabilidade.
- **Cache de resultados de teste:** não reutilizar PASS de outro SHA. Preservar cache de dependências com invalidação adequada.
- **Atualização ampla de actions/dependências:** manutenção em PR própria; não misturar migração de versões com o benchmark de velocidade.
- **CODEOWNERS bloqueante:** só quando houver responsáveis reais disponíveis; não criar aprovador fictício.

## 5. Sequência de execução e aprovação

Recomendação: consolidar a #311; padronizar revisão; decidir proteção/auto-merge; medir; só então avaliar paralelismo adicional. Uma issue canônica por entrega autorizada, sem criar issues de cada passo e sem inventar novas fatias de produto.

Este plano não concede autorização ao merge bloqueado nem altera o status da #310. A aprovação necessária para integrar a #311 permanece explícita. A execução futura deve registrar resultado, testes e limites na PR correspondente, preservar alterações locais do usuário e nunca fazer commit direto na main.

## 6. Fontes oficiais consultadas em 2026-09-06

- [PRs pequenas, contexto e autorrevisão](https://docs.github.com/en/pull-requests/concepts/helping-others-review-your-changes).
- [Padronização de PRs, templates e proteções](https://docs.github.com/en/pull-requests/reference/managing-and-standardizing-pull-requests).
- [Checks obrigatórios, SHA atual e jobs pulados](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).
- [Sintaxe de jobs e dependências](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
- [Concorrência de workflows](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency).
- [Matrix e limites de paralelismo](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations).
- [Disponibilidade e operação de merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue).
- Evidência do projeto: [run da #308](https://github.com/RodReis/rrb-jarvisOS/actions/runs/34045544271), [run da #311](https://github.com/RodReis/rrb-jarvisOS/actions/runs/34046954735) e [issue #310](https://github.com/RodReis/rrb-jarvisOS/issues/310).
