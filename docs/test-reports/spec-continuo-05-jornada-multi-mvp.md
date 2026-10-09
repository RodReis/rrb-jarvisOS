# Relatório de prova — SPEC-Contínuo-05 / issue #138

**Estado:** validação automatizada concluída no CI do SHA `83dd9145b105975a96bfb49f28579923704029c8`; relatório agregado regenerado dos artefatos oficiais. Este documento é a evidência versionada por SPEC/issue, conforme `docs/TESTING.md` §11.3.

## Escopo da prova

- Projeto temporário isolado; inventário e executor são fixtures determinísticas.
- O repositório SQLite do dispatcher é real e reaberto durante a jornada.
- Nenhuma chamada real a Claude/Codex, GitHub, criação de PR, merge remoto ou deploy ocorre nos testes comuns.
- O smoke real opt-in de GitHub/CLI permanece `not_run`: `RodReis/rrb-jarvisos-smoke` não foi acessível na consulta desta execução. Não se substituiu o repositório descartável pelo repositório de trabalho.

## Reconstrução da jornada determinística

| Ordem | Fato observado | Evidência durável ou resultado |
|---:|---|---|
| 1 | MVP-012 já está tecnicamente mergeado; a F02 está aprovada na revisão `a…a` (64 caracteres), gate válido e issue aberta em `proplan:todo`. | Fixture de `continuous-dispatcher.jornada.int-spec.ts`; fingerprint do DAG calculado pelo inventário. |
| 2 | O dispatcher grava a intenção; o fake cria `run-1` e perde a confirmação depois do efeito. | Falha injetada: `Confirmação perdida depois da criação do run.` A chamada rejeita após o efeito local simulado. |
| 3 | O processo/repositório é reaberto; a leitura do run ativo leva a `waiting`, sem criar outro run. | Decisão/cursor lidos do SQLite; contador de efeitos permanece em 1. |
| 4 | A origem reconcilia a F02 como `MERGED`; só então a F01 do MVP-013 dependente fica elegível e gera `run-2`. | O DAG atualizado satisfaz a dependência técnica pelo estado mergeado, sem exigir fechamento da issue. |
| 5 | O último nó é reconciliado como mergeado; a próxima reconciliação termina em `drained`. | Dois runs criados ao todo; nenhum duplicado durante retomada. |
| 6 | Outro cenário deixa a F01 sem gate e a F02 independente aprovada. | O dispatcher não cria run para a F01 e inicia somente a F02. |

IDs de run, revisão e estados acima pertencem a fixtures; não representam execução real por executor nem valores de consumo remoto.

## Matriz de critérios

| Critério da SPEC | Prova nesta entrega | Situação |
|---|---|---|
| 1. Atravessar dois MVPs e múltiplas fatias sem reaprovar revisão válida | Jornada com SQLite, reinício, dependência satisfeita por merge e `drained`; revisão aprovada mantida pela fixture. | coberto por integração determinística |
| 2. Duas fatias independentes juntas; merges serializados | Contratos de independência e merge existentes em `fila-independencia.int-spec.ts` e `merge-service.int-spec.ts`; provas foram executadas localmente. A tentativa de `isolamento-concorrente.int-spec.ts` foi interrompida porque o daemon Docker recusou conexão com `dockerDesktopLinuxEngine`. | prova automatizada local sem Docker; smoke de isolamento Docker não executado |
| 3. Reinício e efeito ambíguo sem duplicação | Efeito local criado antes da confirmação perdida; reabertura SQLite; um único `run-1`. | coberto por integração determinística |
| 4. Gate pendente interrompe apenas dependentes | Cenário com gate pendente e ramo independente aprovado. | coberto por integração determinística |
| 5. Cancelamento preserva trabalho remoto e merge confirmado | Coberto pelas provas existentes de `cancelamento-service.int-spec.ts`, incluindo PR convertido para draft, merge em curso não cancelável e run terminal; a suíte focada passou. | coberto por integração simulada de fronteiras |
| 6. Relatório permite reconstruir decisões, revisões, executor, consumo, checks, SHAs e bloqueios | Esta prova determinística reconstrói decisão, revisão e bloqueio, mas seus runs não invocam executor real nem produzem consumo, checks ou SHAs. O ledger e as projeções de F04 já persistem fatos reais desses domínios, porém não foram correlacionados a uma jornada multi-MVP real nesta entrega. | parcial; requisito de relatório fim a fim não comprovado |
| 7. Sem deploy ou fechamento automático de issue | Testes executam apenas dispatcher/SQLite com fixtures; nenhum conector externo está habilitado e nenhuma issue é fechada. | sem efeito externo nos testes executados |

## Comandos e resultados locais

- `npx vitest run --project regras src/main/pipeline/continuous-dispatcher.spec.ts src/main/pipeline/inventario-global.spec.ts` — **15 passaram**.
- `npx vitest run --project banco` com a jornada, repository SQLite, quadro, controles e cancelamento — **44 passaram**.
- `npx vitest run --project banco` com a jornada, merge serializado e independência — **44 passaram**.
- `npm run typecheck` — passou.
- `npm run build` — passou.
- `npm run lint` — passou após correção de formatação do novo teste.
- `npx playwright test tests/e2e/quadro-execucao.e2e.ts` — **1 passou**; prova a ponte Electron/preload real e a recusa de play inválido sem criar run. Não simula jornada multi-MVP.
- `isolamento-concorrente.int-spec.ts` — `not_run`: Docker API recusou conexão (`permission denied`, named pipe `dockerDesktopLinuxEngine`). A execução foi interrompida sem classificar o caso como sucesso.
- Smoke real do GitHub/CLI — `not_run`: repositório de prova exclusivo inacessível.
- `npm test` completo — interrompido após vários minutos sem conclusão; houve testes que criam worktrees e a suíte alcança casos dependentes de infraestrutura não acessível neste ambiente. Nenhum resultado agregado foi declarado.

Os totais acima são saídas observadas dos comandos locais, não contagens editadas em `reports/TESTS.md`. O CI run `37873116955` executou as categorias oficiais no SHA indicado: Regras 2994/2994 (81,1%); Banco 2411/2393, sem falhas e 18 ignorados (84,4%); Tela 806/805, sem falhas e 1 `todo` (74,5%). `changes`, `quality`, `test-regras`, `test-banco`, `test-tela` e `visual` passaram; E2E foi pulado pela seleção de caminhos. O agregado falhou apenas pela divergência entre o relatório versionado e o número de testes de Banco; por isso os arquivos agregados foram regenerados a partir dos artefatos oficiais e a guarda local passou. Esta correção requer uma nova execução do CI antes de declarar a PR verde.

## Evidência ainda pendente

- Nova execução do CI após versionar a correção do relatório agregado.
- Repositório de prova exclusivo e credenciais disponíveis para o smoke real de GitHub/CLI.
- A prova Playwright executada cobre a ponte real do quadro, não a travessia multi-MVP pela UI; a travessia determinística está coberta no serviço SQLite.
- O critério 6 permanece parcial: não foi implementada nem aprovada uma superfície que produza um relatório de jornada real correlacionando dispatcher, executor, consumo, ledger, CI e SHAs. A evidência report-only desta SPEC é versionada, mas não supre esse conteúdo operacional.
