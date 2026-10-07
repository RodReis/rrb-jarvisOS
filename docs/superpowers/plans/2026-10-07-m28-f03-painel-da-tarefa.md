# M28-F03 Painel da tarefa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use inline execution to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abrir no quadro um painel somente leitura por issue/run, com plano e tarefas, traces ao vivo e históricos, arquivos/diff snapshots, checks e saída de testes.

**Architecture:** O main permanece dono do escopo e das consultas. Cada chamada de IA segue ligada ao próprio ledger; uma relação SQLite associa run/tarefa aos traces. O kernel captura snapshots textuais aprovados por hash antes da limpeza, respeitando cotas e retenção. IPC tipado entrega apenas vistas escopadas; o renderer não recebe paths absolutos nem capacidade de escrita.

**Tech Stack:** Electron IPC/preload, React/TypeScript, SQLite migrations/transactions, filesystem local de artefatos, GitRunner/SquadGit, Vitest, Playwright Electron.

---

### Task 1: Modelar painel, cota e snapshots no domínio

**Files:** `src/shared/domain/painel-tarefa.ts`, `src/shared/domain/painel-tarefa.spec.ts`, `docs/spec/spec-execucao-03-painel-da-tarefa.md`, `docs/adr/adr-006-squads-orquestrados-modelo-local.md`

- [ ] Definir estados fechados para tarefa, snapshot (`disponivel`, `incompleto`, `expirado`, `ausente`) e tipos de arquivo/diff.
- [ ] Implementar predicados puros de limite 10 MiB por arquivo e 50 MiB por run, contabilizados em UTF-8; excesso omite o item e marca incompleto.
- [ ] Garantir que caminho seja relativo e rejeitar caminho absoluto, `..`, controles, links e conteúdo binário.
- [ ] Registrar no plano os limites aprovados pelo PI e a retenção de 30 dias/5 GB da M9-F06.
- [ ] Executar testes da unidade de domínio e `git diff --check`.
- [ ] Commitar o domínio e documentação em português.

### Task 2: Persistir associação run/tarefa/traces e snapshots

**Files:** `src/main/storage/migrations.ts`, `src/main/pipeline/painel-tarefa-repository.ts`, `src/main/pipeline/painel-tarefa-service.ts`, testes `*.int-spec.ts`, bootstrap de `src/main/index.ts`

- [ ] Criar tabelas escopadas para relação `run_id/tarefa_id/trace_id` e metadados de snapshots (hash, tamanho, path relativo, tipo, estado, timestamps); adicionar índices e unicidade idempotente.
- [ ] Criar serviço de artefatos sob `userData/artifacts/<run>/`, com escrita atômica, SHA-256, resolução contida na raiz, limites e leitura validada por hash.
- [ ] Persistir a associação ao abrir trace usando metadados internos do request; não alterar o payload global `EventoDaGeracao`.
- [ ] Registrar snapshots por tarefa antes de limpeza/remoção de worktree, usando apenas paths provados; diff contra a base declarada; binários apenas metadados.
- [ ] Implementar leitura escopada por user/workspace/project/run e falha explícita para hash divergente, conteúdo expirado ou artefato ausente.
- [ ] Integrar com retenção M9-F06 sem expirar runs ativos/não resolvidos; conservar metadados e hashes.
- [ ] Provar persistência/reabertura, isolamento de escopo, escrita parcial, crash/atomicidade, limite individual/run, hash e path traversal.
- [ ] Executar self-check e validar geração/consistência do relatório requerido.
- [ ] Commitar persistência e serviços.

### Task 3: Expor consultas e assinatura ao vivo pelo IPC mínimo

**Files:** `src/shared/contracts/ipc.ts`, `src/main/ipc/handlers.ts`, `src/main/preload/index.ts`, allowlists E2E/preload e testes de contrato

- [ ] Adicionar métodos de leitura do painel por run e leitura de conteúdo por ID de snapshot; não aceitar path fornecido pelo renderer.
- [ ] Adicionar assinatura de eventos filtrada por run no main/preload; cancelar assinatura ao fechar painel e conferir ownership do webContents.
- [ ] Manter `onGenerationEvent` existente para demais consumidores e preservar isolamento de eventos entre runs.
- [ ] Validar tipos, parâmetros, workspace e associação run/issue no handler; respostas inválidas retornam formas fechadas sem revelar dados de outro run.
- [ ] Atualizar allowlists e ordenação dos métodos IPC/E2E conforme convenção.
- [ ] Provar evento live, cancelamento, replay após reinício, token injetado redigido e isolamento multiworkspace.
- [ ] Executar verificações direcionadas e relatório.
- [ ] Commitar IPC/preload.

### Task 4: Construir painel visual somente leitura no quadro

**Files:** `src/renderer/src/app/PainelDaTarefa.tsx`, `src/renderer/src/app/QuadroDeExecucao.tsx`, testes de tela e prova visual

- [ ] Abrir painel lateral ao clicar em card DEVELOPER, sem navegação para fora do quadro.
- [ ] Renderizar Plano, uma aba por tarefa com traces agrupados por horário, Diff, Arquivos, Checks e Testes.
- [ ] Reutilizar primitivas/design system; aplicar destaque de sintaxe para conteúdo textual sem controle de edição.
- [ ] Mostrar estado do provider/código de erro no card e aba; mostrar horário de último evento e `sem sinal desde HH:MM` quando aplicável.
- [ ] Distinguir arquivo não alterado, binário, snapshot omitido por cota, expirado, ausente e erro de leitura.
- [ ] Implementar loading, erro, conteúdo vazio, run ativo e encerrado; garantir teclado e aria labels.
- [ ] Provar por testes de tela e screenshots em tema claro/escuro; incluir E2E Electron para abrir painel, ler snapshot e confirmar ausência de escrita.
- [ ] Executar verificações direcionadas e relatório.
- [ ] Commitar UI e testes.

### Task 5: Documentar, revisar e entregar #378

**Files:** `docs/DEVELOPMENT.md`, `docs/STATUS.md`, plano e specs; PR `refs #378`

- [ ] Atualizar checklist interno F03 com os critérios demonstrados; manter STATUS coerente com o estado remoto.
- [ ] Revisar diff contra `origin/main` e dependências; validar ausência de segredo, compatibilidade da migration e contratos de retenção.
- [ ] Rodar lint, typecheck, testes relevantes e completos conforme `docs/TESTING.md`; regenerar relatórios apenas dos artefatos válidos.
- [ ] Gerar relatório de revisão segundo `docs/REVIEW.md`, resolver P0/P1 e repetir validações no SHA final.
- [ ] Commitar documentação, fazer push e abrir PR em português com `refs #378`, evidências e limites.
- [ ] Aguardar `gh pr checks <n> --watch`, corrigir falhas, confirmar checks verdes no head atual e fazer squash merge.
- [ ] Confirmar merge SHA/mergedAt, publicar comentário de encerramento com Resumo da implementação, Aprendizado e Imprevistos, e mover #378 para `proplan:done`; não fechar a issue.
