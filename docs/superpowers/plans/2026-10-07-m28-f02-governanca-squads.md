# M28-F02 — governança dos Squads

> Plano de implementação da SPEC-Execucao-02 aprovada. Issue #126.

**Objetivo:** impor tetos agregados, aprovações sensíveis e cancelamento em cascata ao Play; ligar o segundo escritor somente depois desses gates e provar o fluxo completo.

**Arquitetura:** o main é o único dono de política, custo, Git e efeitos externos. O snapshot do run congela limites; um ledger SQLite registra reserva/consumo por unidade e aprovação. O executor consulta o ledger antes de cada dispatch e chamada. O quadro projeta o estado persistido; o renderer só solicita decisão e cancelamento via IPC tipado.

**Stack:** Electron, TypeScript, React, SQLite, Vitest e Playwright.

---

## 1. Tetos e ledger

**Arquivos:** `src/shared/domain/squad-perfil.ts`, `src/shared/domain/squad-plano.ts`, `src/main/squads/squad-orcamento.ts`, migration de SQLite e `src/main/pipeline/pipeline-repository.ts`.

- [ ] Acrescentar limites agregados por Squad, escritor e worker ao perfil validado; recusar valores inválidos e preservar snapshot imutável.
- [ ] Criar reserva atômica e consumo por run/unidade/tentativa, com escopo usuário/workspace/projeto. Repetição do mesmo evento deve ser idempotente.
- [ ] Barrar novo dispatch, chamada e rodada antes de exceder quantidade, tokens, turnos, tempo e USD medido. Registrar consumo local sem USD fictício.
- [ ] Provar cada dimensão com concorrência e relançamento após crash; conferir orçamento do projeto/run.

## 2. Ações sensíveis e aprovação

**Arquivos:** `src/main/policy/`, `src/main/execution/approval-repository.ts`, `src/main/squads/`, `src/main/ipc/handlers.ts` e `src/shared/contracts/ipc.ts`.

- [ ] Classificar alteração estrutural de banco e comando destrutivo antes de executá-los; desconhecido exige PI.
- [ ] Persistir pedido com identidade exata da ação e AuditEvent antes de qualquer efeito; recusa encerra tarefa com motivo.
- [ ] Resolver pelo PI no IPC com verificação de sessão e escopo; aprovação não autoriza ação diferente ou repetição.
- [ ] Registrar deploy na política, sem implementar deploy.

## 3. Cancelamento e recursos

**Arquivos:** `src/main/pipeline/cancelamento-service.ts`, `src/main/squads/squad-orquestrador-de-execucao.ts`, `src/main/squads/squad-executor.ts`, `src/main/squads/squad-sandbox.ts` e inventário.

- [ ] Propagar um AbortSignal pai para orquestrador, workers, escritores, integrador, TESTE, REVIEWER e consultas de PR.
- [ ] Aplicar timeout pai; impedir dispatch e publicação após cancelamento. Resultado tardio não reabre run.
- [ ] Esperar snapshot e reconciliação antes de limpar worktree; preservar diff, manifesto e resultados parciais.
- [ ] Provar cancelamento e crash em cada fronteira, inclusive integração e PR/MERGE, sem efeito remoto extra.

## 4. Multi-escritor e quadro

**Arquivos:** `src/main/index.ts`, `src/main/squads/squad-integrador.ts`, `src/shared/domain/quadro-execucao.ts`, `src/renderer/src/app/QuadroDeExecucao.tsx`.

- [ ] Ligar o `IntegradorService` no caminho de produção e usar seu commit/manifesto validado antes de TESTE e REVIEWER.
- [ ] Habilitar dois escritores por padrão somente com tetos, aprovação e cancelamento efetivos.
- [ ] Projetar selo “Aguardando PI” sem mover coluna; mostrar motivo e decisão auditada no card.
- [ ] Mostrar resumo de tarefas, camadas, escritores, manifesto, consumo, aprovação e motivo terminal.

## 5. Prova e entrega

- [ ] E2E limitado: Play com orquestrador local, dois escritores em worktrees distintos, integrador, TESTE, REVIEWER e PR/MERGE; Git apenas pelo kernel.
- [ ] Executar validações de regras, banco, tela, E2E, `npm run lint`, `npm run typecheck`, relatório e revisão do diff.
- [ ] Atualizar `docs/DEVELOPMENT.md`, `docs/STATUS.md`, evidência de testes e documentos do Cowork presentes no checkout; commit/push e PR com `refs #126`.
- [ ] Confirmar CI do head, merge SHA, comentário de encerramento e `proplan:done`; issue permanece aberta para aceite do PI.
