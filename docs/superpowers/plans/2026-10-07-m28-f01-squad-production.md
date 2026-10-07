# Composição de produção do Squad na M28-F01 — Plano de implementação

> Execução inline nesta sessão: o ambiente não permite delegação multiagente. Seguir as tarefas em ordem, com testes de regressão antes de cada implementação e commits pequenos no branch da PR #408.

**Objetivo:** Fazer o Play de F01 executar o Squad real aprovado, registrar sua equipe/etapas no ledger, proteger escritores por slot/worktree e encaminhar somente commit aprovado por TESTE/REVIEWER para PR/MERGE.

**Arquitetura:** Um orquestrador de execução do Squad será injetado no callback de Play e coordenará validação, plano, ciclo de revisão, fila/ledger e entrega. O run não segura slot; cada escritor usa GerenteDeSlots e sua própria sandbox. O board consulta o snapshot persistido da equipe e o estado do run, sem inferir sucesso pelo silêncio.

**Stack:** Electron + React + TypeScript, SQLite local, Vitest, Playwright, Docker local e Claude Code CLI 2.1.278 com SHA-256 oficial fixado no build.

---

## Mapa de arquivos

- src/main/pipeline/quadro-execucao-service.ts: fronteira do Play, cria run e entrega pedido tipado ao adaptador.
- src/main/squads/squad-orquestrador-de-execucao.ts (novo): coordena planning, ciclo, transições e entrega por run.
- src/main/index.ts: compõe planner, ContextPack, workers/escritores, teste, reviewer, slots e orquestrador real.
- src/shared/domain/pipeline.ts, src/main/storage/migrations.ts, src/main/pipeline/pipeline-repository.ts: persistem snapshot verificado e resumo de progresso do Squad no registro já escopado do run.
- src/main/pipeline/docker-runner.ts, src/main/squads/squad-sandbox.ts, src/main/squads/squad-agente-container.ts: imagem local com CLI pinada, sem segredo, executada pelo proxy existente.
- src/shared/domain/quadro-execucao.ts, src/renderer/src/app/QuadroDeExecucao.tsx: exposição da equipe e dos papéis no card a partir do snapshot persistido.
- src/main/squads/squad-orquestrador-de-execucao.int-spec.ts (novo), src/main/pipeline/quadro-execucao-service.int-spec.ts, src/renderer/src/app/QuadroDeExecucao.test.tsx (novo) e tests/e2e/quadro-execucao.e2e.ts: provas de contrato, persistência, UI e Play real.
- docker/squad-executor/Dockerfile e scripts/build-squad-executor-image.mjs (novos): build local reproduzível da imagem e verificação de versão/checksum.
- docs/DEVELOPMENT.md, docs/STATUS.md, docs/superpowers/plans/2026-10-07-m28-f01-squad-production.md, reports/TESTS.md: estado/evidência gerados segundo o contrato do repo.

## Tarefa 1 — Persistir snapshot e progresso visível do Squad

**Arquivos:** src/shared/domain/pipeline.ts; src/main/storage/migrations.ts; src/main/pipeline/pipeline-repository.ts e seu teste de integração; src/shared/domain/quadro-execucao.ts e seus testes.

1. Acrescentar teste de migração/repositório: criar run, gravar snapshot de equipe validado, recarregar run e verificar igualdade por valor e escopo (user_id, workspace_id, project_id). Verificar que snapshot malformado ou de outro run é recusado.
2. Executar npm exec vitest run src/main/pipeline/pipeline-repository.int-spec.ts e confirmar falha pela ausência do campo/contrato.
3. Acrescentar migração SQLite aditiva para squad_snapshot (JSON versionado) e squad_progress (resumo tipado das tarefas/etapa), ambos nulos para runs legados; atualizar PipelineRun, criar, buscar e atualização condicional com fencing token vigente.
4. Exigir que a validação do snapshot confira schema, hash e resolução; o estado de progresso contém apenas tarefaId, papel, estado, motivo limitado e referência de commit, nunca prompt, credencial ou saída bruta do agente.
5. Rodar o teste de integração do repositório e os testes de quadro; confirmar legado nulo continua sendo projetado sem equipe e todos os campos seguem escopados.
6. Commit: feat: persiste snapshot do Squad no run.

## Tarefa 2 — Construir a imagem local segura do escritor

**Arquivos:** docker/squad-executor/Dockerfile; scripts/build-squad-executor-image.mjs; src/main/pipeline/docker-runner.ts; src/main/squads/squad-sandbox.ts; src/main/squads/squad-agente-container.ts; testes dessas unidades.

1. Escrever teste que exige versão 2.1.278, digest Linux x64 5c4735937844e84f8a93306e841a5b0e12252909b07870f789b190468da147ab, imagem local versionada e rejeita latest/tag ausente.
2. Rodar os testes de sandbox/agente/imagem e confirmar a falha por continuar usando node:22-bookworm sem claude.
3. Criar Dockerfile derivado da base Node Debian existente; baixar o binário apenas da URL da versão fixa; comparar SHA-256 com o lock versionado; falhar o build em qualquer divergência. O script de build chama Docker por processo com argumentos separados, registra o resultado e nunca executa agente no host.
4. Injetar a imagem fixa na montagem do escritor. Container recebe somente ANTHROPIC_BASE_URL; preservar volumes, egress via proxy, .git somente leitura e ferramentas sem Bash/Git/GitHub.
5. Provar argumentos do CLI --print, cancelamento e ausência de segredo com testes unitários. Se Docker não existir, marcar apenas smoke físico como not_run, sem fallback no host.
6. Rodar smoke físico quando Docker estiver disponível: build, docker run ... claude --version e comparação exata com 2.1.278; confirmar digest do binário e testar saída de rede restrita.
7. Commit: build: fixa imagem local do executor Squad.

## Tarefa 3 — Compor Play → planejamento → execução → TESTE/REVIEWER → entrega

**Arquivos:** src/main/squads/squad-orquestrador-de-execucao.ts (novo); src/main/index.ts; src/main/pipeline/quadro-execucao-service.ts; testes de integração do orquestrador/quadro.

1. Escrever testes de integração com repositório SQLite e portas controladas para: Play cria exatamente um run por issue; perfil default PERFIL_PADRAO é congelado com rota de fase; snapshot aprovado é persistido antes do primeiro dispatch; serviço recusa run sem snapshot, perfil inelegível ou comandos de CI aprovados.
2. Testar transições em ordem: PLANNED → AWAITING_PI → READY → RUNNING → VALIDATING → REVIEWING → PR_CI; run não usa EncadeadorDeRuns e não adquire slot global.
3. Implementar adaptador do perfil padrão usando criarSnapshotDoSquad, fase já resolvida pelo PhaseModelService, leitura da SPEC aprovada e base/paths já validados no Play. Converter critérios/riscos da SPEC em SpecParaOPrompt; recusar quando não houver perfil, modelo, orçamento ou entradas verificáveis.
4. Montar os geradores pelo PhaseModelService/ExecutorProxy existente; ligar ContextoDaTarefa, ExecutorDoSquad, ExecutorDeWorker, ExecutorDeEscritor, EtapaDeTeste, RevisorService e CicloDeRevisao. Uma porta de produção mantém um escritor por padrão e entrega commit de kernel; nunca chama a entrega legado antes do REVIEWER aprovar.
5. Ligar o GerenteDeSlots ao escritor pela chave <runId>:<escritor> com lease, heartbeat, fencing e cancelamento. Provar capacidade 1 sem deadlock, tentativa com fencing vencido recusada, cancelamento remove quem aguarda e processo terminado antes de liberar o lease.
6. Adaptar a saída aprovada para os serviços existentes de entrega/PR e atualizar o run para PR_CI só com PR confirmado para o mesmo commit; reusar consultas atuais de check/MERGE. Se produzir, teste, revisão, publicação ou conexão falhar, gravar BLOCKED com causa/motivo e ação de retomada.
7. ExecutorDoSquad já retorna estados por tarefa; projetar resumo redigido em squad_progress, sem texto do agente, e ligar atualizações persistidas à etapa do quadro. Erro inesperado não pode deixar run ativo sem dono.
8. Testar no bootstrap que o callback de Play aponta para o orquestrador novo e que nenhum caminho chama EncadeadorDeRuns/EntregaService legado como substituto. Testes direcionados: npx vitest run src/main/squads/squad-orquestrador-de-execucao.int-spec.ts src/main/pipeline/quadro-execucao-service.int-spec.ts.
9. Commit: feat: liga Play ao ciclo real do Squad.

## Tarefa 4 — Exibir equipe e testar jornada positiva

**Arquivos:** src/shared/domain/quadro-execucao.ts; src/renderer/src/app/QuadroDeExecucao.tsx; src/renderer/src/app/QuadroDeExecucao.test.tsx; tests/e2e/quadro-execucao.e2e.ts.

1. Adicionar teste de componente com snapshot persistido: card informa o papel/modelo de orquestrador, workers, escritor e reviewer, objetivo derivado da SPEC, workflow fixo e estado da tarefa; ausência de snapshot em run legado não inventa equipe.
2. Executar teste de tela e confirmar falha antes de implementar a representação de equipe no cartão.
3. Expor no DTO somente informação segura do snapshot; renderizar participantes/papéis, modelo resolvido, objetivo e workflow DEVELOPER→TESTE→REVIEWER→PR/MERGE com estados acessíveis e consistentes com o design system.
4. Expandir E2E do Play para uma issue e para três issues de um MVP: worktree separado por run, dependência não satisfeita parada em A fazer, issue independente segue, escritor serial respeita slots e revisão aprovada é a única que abre PR. Verificar check real do mesmo SHA e MERGED apenas após confirmação da origem.
5. Rodar E2E negativo atual além dos dois fluxos positivos. Recurso externo ausente gera not_run documentado; nunca resultado verde simulado.
6. Commit: test: prova Play positivo com o Squad.

## Tarefa 5 — Verificar e documentar a entrega

**Arquivos:** docs/DEVELOPMENT.md; docs/STATUS.md; docs/superpowers/plans/2026-10-07-m28-f01-squad-production.md; reports/.arquivos-por-categoria.json; reports/TESTS.md.

1. Rodar verificações direcionadas; em seguida npm run typecheck, npm run lint, npm test, build e E2E aplicáveis. Gerar relatório a partir dos runners/artefatos, nunca editar contagens à mão.
2. Atualizar DEVELOPMENT e STATUS para diferenciar testes unitários/integrados, E2E físico not_run, CI e SHA. Preservar proplan:doing até o merge; não fechar #370.
3. Revisar todo o diff contra o SHA correto e docs/REVIEW.md; validar ausência de comandos/segredos no container, git diff --check, relatório --check --no-run --require-entry e self-check de relatório.
4. Push de cada commit ao branch da PR #408. Aguardar gh pr checks 408 --watch no SHA final. Corrigir falhas antes de tornar a PR pronta.
5. A descrição da PR deve registrar antes/depois, evidências, limites not_run e refs #370; nunca closes #370. Merge somente com checks verdes; depois publicar comentário de encerramento e mover para proplan:done. O aceite/fechamento permanece do PI.

## Revisão do plano

- Cobertura: Play unitário e produção, persistência, equipe visível, slots/fencing, cancelamento/recuperação, container/proxy, TESTE/REVIEWER, PR/MERGE real, E2E e documentação.
- Os caminhos listados foram confirmados no commit base e1240fc; novos arquivos aparecem explicitamente como (novo).
- Nenhum estado de sucesso é inferido de silêncio; qualquer etapa que não prove resultado termina bloqueada.
- O plano não troca a F02 de lugar nem habilita multi-escritor por padrão.
