# Pipeline 04 — Execução automática, recuperação e prova Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Executar a primeira fatia aprovada em worktree isolado, abrir PR, recuperar até duas vezes, observar CI, fazer squash merge automático e provar a jornada real.

**Architecture:** Uma fila SQLite WIP=1 concede lease; o orquestrador usa snapshots imutáveis e serviços injetados; Claude Code passa pelo ponto único do MVP-005; Git e GitHub são reconciliados antes de cada efeito. Recuperação recebe apenas delta e falhas relevantes; merge exige head SHA atual e checks verdes.

**Tech Stack:** Electron main, TypeScript, SQLite, Claude Code Adapter do MVP-005, Git/GitHub adapters do plano 2, Vitest, Playwright.

---

## Pré-requisitos obrigatórios

- Planos 1, 2 e 3 concluídos.
- MVP-005 F01–F04 concluído: Vault, ponto único de provider, BudgetPolicy e Claude Code CLI Adapter.
- CI do repositório-alvo com checks obrigatórios configurados.

A ausência de qualquer pré-requisito termina o preflight com categoria verificável; não autoriza um caminho paralelo que burle provider, orçamento ou GitHub Adapter.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/shared/domain/pipeline-run.ts` | Estados, tentativas, falhas e transições puras. |
| `src/main/pipeline/run-repository.ts` | Runs, attempts, events e lease WIP=1. |
| `src/main/git/worktree-service.ts` | Branch/worktree, diff, commit, push, rebase e limpeza. |
| `src/main/pipeline/provider-port.ts` | Porta estreita para o gateway de providers já existente. |
| `src/main/pipeline/artifact-validator.ts` | Escopo do diff, comandos de teste e documentos obrigatórios. |
| `src/main/pipeline/recovery-controller.ts` | Assinatura, hipótese nova e teto de três tentativas. |
| `src/main/pipeline/pipeline-orchestrator.ts` | Máquina durável de ponta a ponta. |
| `src/main/pipeline/reconciler.ts` | Retomada pós-reinício consultando Git/filesystem/GitHub. |
| `src/renderer/src/projects/ExecutionBoard.tsx` | Fila, tentativa, CI, custo, bloqueio e próxima ação. |
| `e2e/pipeline-first-slice.spec.ts` | Prova local controlada com fixtures e prova real opt-in. |

### Task 1: Máquina de estado e classificação fechada

**Files:**
- Create: `src/shared/domain/pipeline-run.ts`
- Create: `src/shared/domain/pipeline-run.spec.ts`

- [ ] **Step 1: Escrever testes de transição, teto e bloqueios legítimos**

```ts
import { describe, expect, it } from 'vitest'
import { nextRunState, mayRetry, classifyBlocker } from './pipeline-run'

describe('PipelineRun', () => {
  it('não pula de ready para merged', () => {
    expect(() => nextRunState('ready', 'merged')).toThrow('INVALID_RUN_TRANSITION')
  })

  it('permite uma inicial e duas correções', () => {
    expect(mayRetry(1, false)).toBe(true)
    expect(mayRetry(3, false)).toBe(false)
    expect(mayRetry(2, true)).toBe(false)
  })

  it('não transforma requisito ausente em blocker técnico', () => {
    expect(classifyBlocker({ code: 'PRODUCT_OUTSIDE_SPEC' })).toBe('pi-required')
  })
})
```

- [ ] **Step 2: Implementar contratos e transições**

```ts
export type PipelineRunState = 'created' | 'ready' | 'running' | 'validating' | 'pr_ci' | 'merged' | 'blocked' | 'cancelled'
export type BlockerCategory = 'provider' | 'policy' | 'external' | 'infra' | 'budget' | 'stale-revision' | 'conflict' | 'user-work-risk' | 'repeated-failure' | 'pi-required'

const NEXT: Readonly<Record<PipelineRunState, readonly PipelineRunState[]>> = {
  created: ['ready', 'blocked', 'cancelled'], ready: ['running', 'blocked', 'cancelled'],
  running: ['validating', 'blocked', 'cancelled'], validating: ['running', 'pr_ci', 'blocked', 'cancelled'],
  pr_ci: ['running', 'merged', 'blocked', 'cancelled'], merged: [], blocked: [], cancelled: []
}

export function nextRunState(from: PipelineRunState, to: PipelineRunState): PipelineRunState {
  if (!NEXT[from].includes(to)) throw new Error(`INVALID_RUN_TRANSITION:${from}:${to}`)
  return to
}

export function mayRetry(attemptNumber: number, repeatedWithoutNewHypothesis: boolean): boolean {
  return attemptNumber < 3 && !repeatedWithoutNewHypothesis
}

export function classifyBlocker(input: { readonly code: string }): BlockerCategory {
  if (input.code === 'PRODUCT_OUTSIDE_SPEC') return 'pi-required'
  if (input.code.includes('BUDGET')) return 'budget'
  if (input.code.includes('AUTH') || input.code.includes('QUOTA')) return 'provider'
  if (input.code.includes('POLICY') || input.code.includes('ALLOWLIST')) return 'policy'
  if (input.code.includes('GITHUB') || input.code.includes('CI_')) return 'external'
  if (input.code.includes('STALE')) return 'stale-revision'
  if (input.code.includes('CONFLICT')) return 'conflict'
  if (input.code.includes('USER_WORK')) return 'user-work-risk'
  if (input.code.includes('REPEATED')) return 'repeated-failure'
  return 'infra'
}
```

- [ ] **Step 3: Rodar e commit**

Run: `npm test -- --project regras src/shared/domain/pipeline-run.spec.ts`

Expected: PASS.

```bash
git add src/shared/domain/pipeline-run.ts src/shared/domain/pipeline-run.spec.ts
git commit -m "feat: define maquina de execucao da pipeline"
```

### Task 2: Fila durável, tentativas e WIP=1

**Files:**
- Modify: `src/main/storage/migrations.ts`
- Create: `src/main/pipeline/run-repository.ts`
- Create: `src/main/pipeline/run-repository.int-spec.ts`

- [ ] **Step 1: Escrever teste de lease transacional concorrente**

```ts
it('concede somente um run ativo por projeto', () => {
  expect(repo.acquire('p1', 'r1', now, expires)).toBe(true)
  expect(repo.acquire('p1', 'r2', now, expires)).toBe(false)
})

it('preserva três tentativas com snapshots independentes', () => {
  repo.appendAttempt({ runId: 'r1', number: 1, hypothesis: 'implementação inicial', contextHash: 'c1', result: 'failed' })
  repo.appendAttempt({ runId: 'r1', number: 2, hypothesis: 'corrigir teste A', contextHash: 'c2', result: 'succeeded' })
  expect(repo.listAttempts('r1')).toHaveLength(2)
})
```

- [ ] **Step 2: Acrescentar schema append-only**

```sql
CREATE TABLE pipeline_run (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT NOT NULL, work_item_id TEXT NOT NULL,
  spec_hash TEXT NOT NULL, base_sha TEXT NOT NULL, head_sha TEXT, state TEXT NOT NULL,
  provider TEXT NOT NULL, policy_hash TEXT NOT NULL, lease_expires_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_pipeline_run_wip ON pipeline_run(project_id) WHERE state IN ('ready','running','validating','pr_ci');
CREATE TABLE pipeline_attempt (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, number INTEGER NOT NULL, hypothesis TEXT NOT NULL,
  context_hash TEXT NOT NULL, diff_hash TEXT, failure_signature TEXT, result TEXT NOT NULL,
  usage_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(run_id, number)
);
CREATE TABLE pipeline_event (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, ordinal INTEGER NOT NULL, type TEXT NOT NULL,
  payload_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(run_id, ordinal)
);
```

- [ ] **Step 3: Implementar transações de acquire, append e transition**

`acquire` deve inserir/alterar o lease dentro de transação e devolver `false` para violação do índice WIP. `transition` compara estado esperado no `WHERE`; zero linhas alteradas vira `STALE_RUN_STATE`. Tentativa e evento são append-only e numerados no storage.

- [ ] **Step 4: Rodar banco e commit**

Run: `npm test -- --project banco src/main/pipeline/run-repository.int-spec.ts`

Expected: PASS, incluindo disputa entre duas conexões SQLite.

```bash
git add src/main/storage/migrations.ts src/main/pipeline/run-repository.ts src/main/pipeline/run-repository.int-spec.ts
git commit -m "feat: adiciona fila duravel wip um"
```

### Task 3: Worktree isolado e Git automático

**Files:**
- Create: `src/main/git/worktree-service.ts`
- Create: `src/main/git/worktree-service.int-spec.ts`

- [ ] **Step 1: Escrever teste que preserva checkout ativo**

```ts
it('constrói e limpa sem alterar o checkout ativo', async () => {
  const before = await git.head(activeCheckout)
  const lease = await service.create({ projectId: 'p1', sliceId: 's1', repository: activeCheckout, baseRef: 'main' })
  await writeFile(join(lease.path, 'novo.txt'), 'conteúdo')
  await service.commitAndPush(lease, 'feat: entrega fatia s1')
  await service.cleanup(lease)
  expect(await git.head(activeCheckout)).toBe(before)
  expect(existsSync(lease.path)).toBe(false)
})
```

- [ ] **Step 2: Implementar branch e worktree determinísticos**

```ts
export interface WorktreeLease { readonly path: string; readonly branch: string; readonly baseSha: string }

export function branchForSlice(sliceId: string): string {
  const safe = sliceId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '')
  if (!safe) throw new Error('INVALID_SLICE_ID')
  return `codex/${safe}`
}
```

`create` deve fazer fetch, resolver SHA da base, criar branch a partir desse SHA e adicionar worktree fora do checkout ativo. `commitAndPush` valida `git diff --name-only` contra paths permitidos, cria commit e usa `git push --set-upstream origin` com `lease.branch` como argumento separado. `cleanup` remove somente o path exato do lease depois de resolver e confirmar que pertence ao projeto.

- [ ] **Step 3: Rodar integração e commit**

Run: `npm test -- --project banco src/main/git/worktree-service.int-spec.ts`

Expected: PASS em repositório temporário, checkout ativo intacto.

```bash
git add src/main/git/worktree-service.ts src/main/git/worktree-service.int-spec.ts
git commit -m "feat: automatiza git em worktree isolado"
```

### Task 4: Porta do provider e montagem do prompt diferencial

**Files:**
- Create: `src/main/pipeline/provider-port.ts`
- Create: `src/main/pipeline/provider-port.spec.ts`
- Create: `src/main/pipeline/prompt-builder.ts`
- Create: `src/main/pipeline/prompt-builder.spec.ts`

- [ ] **Step 1: Escrever teste que prova uso do gateway existente**

```ts
it('envia taskType code pelo ponto único e preserva usage', async () => {
  gateway.execute.mockResolvedValue({ text: '{"status":"completed"}', usage: { inputTokens: 1200, outputTokens: 200 }, provider: 'claude-code' })
  await expect(port.execute(request)).resolves.toMatchObject({ provider: 'claude-code', usage: { inputTokens: 1200, outputTokens: 200 } })
  expect(gateway.execute).toHaveBeenCalledWith(expect.objectContaining({ taskType: 'code' }))
})
```

- [ ] **Step 2: Definir porta sem acesso direto ao binário Claude**

```ts
export interface PipelineProviderRequest { readonly runId: string; readonly attempt: number; readonly cwd: string; readonly prompt: string; readonly maxTurns: number; readonly outputSchema: Readonly<Record<string, unknown>> }
export interface PipelineProviderResult { readonly provider: string; readonly text: string; readonly usage: { readonly inputTokens: number; readonly outputTokens: number } }
export interface PipelineProviderPort { execute(request: PipelineProviderRequest): Promise<PipelineProviderResult> }
```

A implementação concreta recebe o `ProviderGateway` do MVP-005 e faz o mapeamento completo abaixo. Ela não usa `spawn`, não lê credencial e não contorna BudgetPolicy.

```ts
return gateway.execute({
  requestId: request.runId,
  taskType: 'code',
  providerHint: 'claude-code',
  cwd: request.cwd,
  input: request.prompt,
  maxTurns: request.maxTurns,
  outputSchema: request.outputSchema
})
```

- [ ] **Step 3: Implementar prompt builder diferencial**

O prompt inicial recebe spec aprovada, manifesto de contexto, política/lock e critérios executáveis. Correção recebe somente spec, diff da tentativa, comandos que falharam, trechos limitados, assinaturas anteriores e hipótese nova. O builder rejeita `history` cru e qualquer manifesto acima do `ContextPolicy`.

- [ ] **Step 4: Rodar regras e commit**

Run: `npm test -- --project regras src/main/pipeline/provider-port.spec.ts src/main/pipeline/prompt-builder.spec.ts`

Expected: PASS; teste confirma que relatório antigo não entra sem delta.

```bash
git add src/main/pipeline/provider-port.ts src/main/pipeline/provider-port.spec.ts src/main/pipeline/prompt-builder.ts src/main/pipeline/prompt-builder.spec.ts
git commit -m "feat: conecta pipeline ao gateway de providers"
```

### Task 5: Validação local, assinatura de falha e recuperação

**Files:**
- Create: `src/main/pipeline/artifact-validator.ts`
- Create: `src/main/pipeline/artifact-validator.int-spec.ts`
- Create: `src/main/pipeline/recovery-controller.ts`
- Create: `src/main/pipeline/recovery-controller.spec.ts`

- [ ] **Step 1: Escrever testes de escopo e repetição sem hipótese**

```ts
it('recusa arquivo fora do escopo aprovado', async () => {
  await expect(validator.validate({ cwd, allowedPaths: ['src/feature/**'], commands: ['npm test'] })).rejects.toThrow('DIFF_OUT_OF_SCOPE:README.md')
})

it('bloqueia assinatura repetida sem hipótese nova', () => {
  expect(controller.next({ attempt: 2, signature: 'test:a', previousSignatures: ['test:a'], hypothesis: 'mesma hipótese', previousHypotheses: ['mesma hipótese'] })).toEqual({ action: 'block', code: 'REPEATED_FAILURE' })
})
```

- [ ] **Step 2: Implementar assinatura normalizada**

```ts
import { createHash } from 'node:crypto'

export function failureSignature(category: string, target: string, excerpt: string): string {
  const normalized = excerpt.replaceAll(/\d+/g, '#').replaceAll(/\\/g, '/').trim().slice(0, 2_000)
  return createHash('sha256').update(`${category}\n${target}\n${normalized}`).digest('hex')
}
```

- [ ] **Step 3: Implementar validator e decisão de retry**

O validator executa somente comandos declarados pela spec e política, pelo executor app-managed; coleta exit code e trechos limitados; verifica diff, documentos e arquivos de debug; devolve relatório estruturado. Recovery permite tentativa 2/3 somente com assinatura corrigível e hipótese nova; provider/auth/quota/policy/path/budget não consomem correção de código.

- [ ] **Step 4: Rodar e commit**

Run: `npm test -- --project regras src/main/pipeline/recovery-controller.spec.ts`

Expected: PASS.

Run: `npm test -- --project banco src/main/pipeline/artifact-validator.int-spec.ts`

Expected: PASS.

```bash
git add src/main/pipeline/artifact-validator.ts src/main/pipeline/artifact-validator.int-spec.ts src/main/pipeline/recovery-controller.ts src/main/pipeline/recovery-controller.spec.ts
git commit -m "feat: valida escopo e recupera falhas elegiveis"
```

### Task 6: Orquestrador, PR, CI e merge automático

**Files:**
- Create: `src/main/pipeline/pipeline-orchestrator.ts`
- Create: `src/main/pipeline/pipeline-orchestrator.int-spec.ts`
- Extend: `src/main/github/github-adapter.ts`
- Extend: `src/main/github/github-adapter.spec.ts`

- [ ] **Step 1: Estender o contrato GitHub para PR/check/merge**

```ts
ensurePullRequest(input: { readonly owner: string; readonly repo: string; readonly branch: string; readonly base: string; readonly title: string; readonly body: string }): Promise<{ readonly number: number; readonly url: string; readonly headSha: string }>
watchRequiredChecks(input: { readonly owner: string; readonly repo: string; readonly pullRequest: number; readonly headSha: string; readonly timeoutMs: number }): Promise<{ readonly conclusion: 'success' | 'failure' | 'timeout'; readonly checks: readonly { readonly name: string; readonly conclusion: string }[] }>
squashMerge(input: { readonly owner: string; readonly repo: string; readonly pullRequest: number; readonly expectedHeadSha: string }): Promise<{ readonly mergeSha: string }>
```

- [ ] **Step 2: Escrever teste do happy path e SHA obsoleto**

```ts
it('mergeia somente checks verdes do head atual', async () => {
  github.ensurePullRequest.mockResolvedValue({ number: 10, url: 'https://example/pr/10', headSha: 'head1' })
  github.watchRequiredChecks.mockResolvedValue({ conclusion: 'success', checks: [{ name: 'gate', conclusion: 'success' }] })
  github.squashMerge.mockResolvedValue({ mergeSha: 'merge1' })
  await expect(orchestrator.run('r1')).resolves.toMatchObject({ state: 'merged', mergeSha: 'merge1' })
  expect(github.squashMerge).toHaveBeenCalledWith(expect.objectContaining({ expectedHeadSha: 'head1' }))
})
```

- [ ] **Step 3: Implementar a sequência durável**

O orquestrador executa: preflight de revisão/política/skills/contexto; acquire WIP; create worktree; tentativa provider; validação; commit/push; ensure PR; watch checks; recuperação no mesmo PR; confirmar head SHA; squash merge; confirmar merge na origem; liberar worktree/leases; registrar ledger. Cada fronteira grava evento antes/depois. Nenhuma transição para `merged` ocorre só porque um comando saiu com zero.

- [ ] **Step 4: Rodar integração com fixtures**

Run: `npm test -- --project banco src/main/pipeline/pipeline-orchestrator.int-spec.ts`

Expected: PASS para merge, CI failure corrigida na tentativa 2, teto na tentativa 3 e stale SHA bloqueado.

- [ ] **Step 5: Commit**

```bash
git add src/main/github/github-adapter.ts src/main/github/github-adapter.spec.ts src/main/pipeline/pipeline-orchestrator.ts src/main/pipeline/pipeline-orchestrator.int-spec.ts
git commit -m "feat: orquestra pr ci recuperacao e merge"
```

### Task 7: Reconciler pós-reinício

**Files:**
- Create: `src/main/pipeline/reconciler.ts`
- Create: `src/main/pipeline/reconciler.int-spec.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Escrever teste de evento inconclusivo sem duplicação**

```ts
it('descobre PR já criado antes de repetir create', async () => {
  repo.seedRun({ id: 'r1', state: 'validating', headSha: 'h1' })
  github.findPullRequestByHead.mockResolvedValue({ number: 11, url: 'https://example/pr/11', headSha: 'h1' })
  await reconciler.reconcile('r1')
  expect(github.ensurePullRequest).not.toHaveBeenCalled()
  expect(repo.get('r1')?.state).toBe('pr_ci')
})
```

- [ ] **Step 2: Implementar consulta por fonte real**

Para cada run não terminal, consultar: lease e path reais; branch e HEAD Git; PR por head; checks do head; merge na origem. Só então completar ou compensar o evento inconclusivo. Worktree ausente com commit remoto preservado é recriável; divergência que arrisque trabalho existente vira `user-work-risk`.

- [ ] **Step 3: Executar no boot antes de liberar fila**

Em `main/index.ts`, montar o reconciler depois de storage/adapters e chamar `await reconcileAll()` antes de o scheduler adquirir novo run. Falha de uma execução não impede reconciliar as demais; cada falha fica registrada e o run permanece bloqueado ou retomável.

- [ ] **Step 4: Rodar e commit**

Run: `npm test -- --project banco src/main/pipeline/reconciler.int-spec.ts`

Expected: PASS para commit, PR e merge inconclusivos.

```bash
git add src/main/pipeline/reconciler.ts src/main/pipeline/reconciler.int-spec.ts src/main/index.ts
git commit -m "feat: reconcilia pipeline apos reinicio"
```

### Task 8: IPC e Execution Board

**Files:**
- Modify: `src/shared/contracts/ipc.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/main/ipc/handlers.spec.ts`
- Modify: `src/main/preload/index.ts`
- Modify: `src/main/preload/preload.spec.ts`
- Create: `src/renderer/src/projects/ExecutionBoard.tsx`
- Create: `src/renderer/src/projects/ExecutionBoard.test.tsx`
- Modify: `src/renderer/src/projects/ProjectHub.tsx`

- [ ] **Step 1: Escrever teste de UI para merged e blocked**

```tsx
it('mostra causa e próxima ação quando bloqueado', async () => {
  window.jarvis.getPipelineRun = vi.fn().mockResolvedValue({ id: 'r1', state: 'blocked', attempt: 2, blocker: { category: 'budget', message: 'Orçamento de contexto esgotado.', nextAction: 'Ajustar o limite do projeto.' }, events: [] })
  render(<ExecutionBoard runId="r1" />)
  expect(await screen.findByText('Orçamento de contexto esgotado.')).toBeVisible()
  expect(screen.getByText('Ajustar o limite do projeto.')).toBeVisible()
})
```

- [ ] **Step 2: Acrescentar métodos mínimos à ponte**

```ts
startFirstApprovedSlice(projectId: string): Promise<PipelineRunSnapshot>
getPipelineRun(runId: string): Promise<PipelineRunSnapshot>
listPipelineRuns(projectId: string): Promise<readonly PipelineRunSnapshot[]>
cancelPipelineRun(runId: string): Promise<PipelineRunSnapshot>
```

- [ ] **Step 3: Implementar board sem controle manual de Git**

Mostrar fase, tentativa, comandos/checks, tokens, custo, branch, PR, head SHA, bloqueio e próxima ação. A UI não oferece botões de commit/push/PR/merge e não pede aceite final; permite somente iniciar a primeira fatia aprovada e cancelar run ativo.

- [ ] **Step 4: Rodar contratos/tela e commit**

Run: `npm test -- --project regras src/main/ipc/handlers.spec.ts src/main/preload/preload.spec.ts`

Expected: PASS.

Run: `npm test -- --project tela src/renderer/src/projects/ExecutionBoard.test.tsx`

Expected: PASS.

```bash
git add src/shared/contracts/ipc.ts src/main/ipc/handlers.ts src/main/ipc/handlers.spec.ts src/main/preload/index.ts src/main/preload/preload.spec.ts src/renderer/src/projects/ExecutionBoard.tsx src/renderer/src/projects/ExecutionBoard.test.tsx src/renderer/src/projects/ProjectHub.tsx
git commit -m "feat: exibe execucao automatica da primeira fatia"
```

### Task 9: Prova operacional com Playwright e fixtures reais opt-in

**Files:**
- Create: `e2e/pipeline-first-slice.spec.ts`
- Create: `tests/fixtures/pipeline/template/package.json`
- Create: `tests/fixtures/pipeline/template/src/soma.ts`
- Create: `tests/fixtures/pipeline/template/src/soma.spec.ts`
- Modify: `playwright.config.ts`

- [ ] **Step 1: Criar fixture mínima com falha corrigível**

```json
{
  "name": "pipeline-fixture",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run" },
  "devDependencies": { "vitest": "^4.1.10" }
}
```

```ts
export function soma(a: number, b: number): number {
  return a - b
}
```

```ts
import { expect, it } from 'vitest'
import { soma } from './soma'

it('soma dois números', () => {
  expect(soma(2, 3)).toBe(5)
})
```

- [ ] **Step 2: Implementar E2E determinístico com adapters fake**

O teste deve dirigir: criar projeto; responder/delegar wizard; anexar design; aprovar pacote/MVP/fatia uma vez; publicar DAG fake; iniciar run; simular correção na tentativa 2; confirmar estado `merged`; reabrir app e confirmar que não houve novo PR/merge.

- [ ] **Step 3: Adicionar prova real protegida por opt-in**

Quando `JARVIS_PIPELINE_REAL=1`, usar owner/repo de teste e Claude Code reais, exigir preflight de auth/quota e criar nome remoto com `runId`. Sem a variável, o teste real fica `skip`, não falha. A limpeza remove worktree e recursos temporários; não apaga repositório remoto automaticamente.

- [ ] **Step 4: Rodar smoke e commit**

Run: `npm run test:prova -- e2e/pipeline-first-slice.spec.ts`

Expected: fixture determinística PASS e prova real SKIP sem opt-in.

```bash
git add e2e/pipeline-first-slice.spec.ts tests/fixtures/pipeline playwright.config.ts
git commit -m "test: prova primeira fatia automatica ponta a ponta"
```

### Task 10: Revisão final, relatório e documentação sem deriva

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DECISIONS.md`
- Modify: `docs/CONVENTION.md`
- Modify: `docs/STATUS.md`
- Create: `docs/STATUS-ARQUIVO.md`
- Modify: `docs/LANDSCAPE.md`
- Modify: `docs/TESTING.md`
- Create: `docs/REVIEW.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `reports/TESTS.md`

- [ ] **Step 1: Executar validação local completa**

Run: `npm test`

Expected: PASS.

Run: `npm run build`

Expected: exit code 0.

Run: `npm run lint`

Expected: exit code 0.

Run: `npm run test:report && npm run test:report:check`

Expected: relatório atual e válido.

- [ ] **Step 2: Revisar o diff contra a spec e `docs/REVIEW.md`**

Confirmar: nenhum requisito inventado; nenhum aceite final; nenhum acesso ao provider fora do gateway; nenhum whole-repo sem exceção; SHA do check igual ao merge; no máximo três tentativas; recursos temporários reconciliados; documentação atualizada somente onde houve mudança material.

- [ ] **Step 3: Commit documental final**

```bash
git add docs/ARCHITECTURE.md docs/DECISIONS.md docs/CONVENTION.md docs/STATUS.md docs/STATUS-ARQUIVO.md docs/LANDSCAPE.md docs/TESTING.md docs/REVIEW.md docs/DEVELOPMENT.md reports/TESTS.md
git commit -m "docs: encerra primeira jornada automatica da pipeline"
```

- [ ] **Step 4: Push, PR, CI e merge automático**

Run: `$pipelineBranch = git branch --show-current; git push --set-upstream origin $pipelineBranch`

Expected: push aceito.

Run: `$pipelinePr = gh pr view --json number --jq .number; gh pr checks $pipelinePr --watch`

Expected: todos os checks obrigatórios verdes para o head SHA atual.

O próprio orquestrador confirma o SHA e executa squash merge; não solicitar novo aceite do PI.

## Matriz final de cobertura da especificação

| Seção da spec aprovada | Plano/tarefa que implementa |
|---|---|
| §2 decisões e §3 jornada/terminal | P1 T5–T8; P4 T6–T10 |
| §4 fora de escopo | Preflight de todos os planos; revisão final P4 T10 |
| §6 arquitetura renderer/main/adapters/storage | P1 T1–T7; P2 T1–T5; P4 T2–T8 |
| §7 fontes de verdade | P1 T3–T5; P2 T4–T5; P4 T6–T7 |
| §8 fluxo V1 | P1 T1–T8; P2 T1–T6; P3 T1–T8; P4 T1–T10 |
| §9 Wizard A e `Decida por mim` | P1 T2, T5 e T7 |
| §10 artefatos e antideriva | P1 T4–T5 e T8; P3 T1; P4 T10 |
| §11 dados, estados e invariantes | P1 T1–T3; P2 T2 e T5; P4 T1–T2 |
| §12 Git automático | P2 T1–T4; P4 T3 e T6 |
| §13 recuperação, autoridade e bloqueios | P3 T1–T2; P4 T1, T5–T7 |
| §13.2 Docker e portas | P3 T7 |
| §14 segurança operacional | P1 T4/T6; P2 T1/T3/T4; P4 T3–T7 |
| §15 observabilidade, custo e contexto | P3 T1–T6; P4 T2/T4/T6 |
| §15.3 Graphify | P3 T5 |
| §15.4 compressão | P3 T6 |
| §15.5 skills | P3 T1/T4 |
| §15.6 limite de requisitos | P1 T5; P3 T1; P4 T1/T10 |
| §16 testes e §17 aceite | P1 T8; P2 T6; P3 T8; P4 T9–T10 |
| §18 dependências do roadmap | Pré-requisitos declarados no início de cada plano |

Gaps deliberados: execução de todas as fatias, scheduler genérico, deploy, ingestão de repositório existente e exclusão de remoto permanecem fora da V1, exatamente como a seção 4 da spec.
