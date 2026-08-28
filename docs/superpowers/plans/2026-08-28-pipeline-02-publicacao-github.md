# Pipeline 02 — Bootstrap, DAG e publicação GitHub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar um pacote aprovado em repositório local/remoto, DAG persistido e issues GitHub idempotentes, sem iniciar construção.

**Architecture:** Um executor de processos app-managed oferece argumentos em array e `shell: false`; adapters de Git e GitHub ficam isolados; um publicador usa chaves idempotentes e reconcilia a origem antes de repetir efeitos. SQLite continua fonte do DAG, GitHub é fonte de issue, PR e SHA.

**Tech Stack:** Node.js `child_process`, Git, GitHub CLI `gh`, SQLite, TypeScript, Vitest.

---

## Pré-requisito

Concluir `2026-08-28-pipeline-01-planejamento-aprovacoes.md`. O pacote, cada MVP e cada fatia precisam estar aprovados na revisão correta; este plano não cria outro aceite.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/main/process/managed-process.ts` | Spawn sem shell, timeout, cancelamento e stdout/stderr limitados. |
| `src/main/git/git-adapter.ts` | Init, fetch, branch, worktree e leitura de SHA por argumentos controlados. |
| `src/main/github/github-adapter.ts` | Repositório, issue, relações, PR/check/merge; neste plano usa apenas repo e issue. |
| `src/main/projects/project-bootstrapper.ts` | Criação idempotente do checkout e remoto. |
| `src/shared/domain/dependency-graph.ts` | Validação e ordenação do DAG. |
| `src/main/planning/work-item-repository.ts` | Work items e arestas escopados. |
| `src/main/planning/github-publisher.ts` | Publicação idempotente do MVP/fatia aprovada. |

### Task 1: Executor de processo seguro e observável

**Files:**
- Create: `src/main/process/managed-process.ts`
- Create: `src/main/process/managed-process.int-spec.ts`

- [ ] **Step 1: Escrever teste de argumentos literais, timeout e limite de saída**

```ts
it('não interpreta metacaracteres como shell', async () => {
  const result = await runManaged(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', '$(whoami)'], { cwd: dir, timeoutMs: 2_000, maxOutputBytes: 1_024 })
  expect(result.stdout).toBe('$(whoami)')
  expect(result.exitCode).toBe(0)
})

it('encerra processo que excede o timeout', async () => {
  await expect(runManaged(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: dir, timeoutMs: 50, maxOutputBytes: 1_024 })).rejects.toThrow('PROCESS_TIMEOUT')
})
```

- [ ] **Step 2: Implementar spawn sem shell**

```ts
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

export interface ManagedProcessOptions { readonly cwd: string; readonly timeoutMs: number; readonly maxOutputBytes: number }
export interface ManagedProcessResult { readonly exitCode: number; readonly stdout: string; readonly stderr: string; readonly durationMs: number }

function terminateTree(child: ChildProcessWithoutNullStreams): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { shell: false, windowsHide: true })
    return
  }
  child.kill('SIGTERM')
}

export function runManaged(bin: string, args: readonly string[], options: ManagedProcessOptions): Promise<ManagedProcessResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const child = spawn(bin, [...args], { cwd: options.cwd, shell: false, windowsHide: true })
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    const append = (current: Buffer, chunk: Buffer): Buffer => Buffer.concat([current, chunk]).subarray(0, options.maxOutputBytes)
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
    const timer = setTimeout(() => {
      terminateTree(child)
      reject(new Error('PROCESS_TIMEOUT'))
    }, options.timeoutMs)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code ?? -1, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), durationMs: Date.now() - started })
    })
  })
}
```

- [ ] **Step 3: Rodar integração e commitar**

Run: `npm test -- --project banco src/main/process/managed-process.int-spec.ts`

Expected: PASS no Windows, sem executar `whoami`.

```bash
git add src/main/process/managed-process.ts src/main/process/managed-process.int-spec.ts
git commit -m "feat: adiciona executor de processo app managed"
```

### Task 2: DAG puro e persistência de work items

**Files:**
- Create: `src/shared/domain/dependency-graph.ts`
- Create: `src/shared/domain/dependency-graph.spec.ts`
- Modify: `src/main/storage/migrations.ts`
- Create: `src/main/planning/work-item-repository.ts`
- Create: `src/main/planning/work-item-repository.int-spec.ts`

- [ ] **Step 1: Escrever testes de ciclo, dependência ausente e topo pronto**

```ts
import { describe, expect, it } from 'vitest'
import { validateGraph, readyItems } from './dependency-graph'

describe('DependencyGraph', () => {
  it('recusa ciclo', () => {
    expect(validateGraph([{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }], new Set(['a', 'b']))).toEqual({ ok: false, reason: 'cycle' })
  })

  it('devolve somente item aprovado com dependências concluídas', () => {
    expect(readyItems([{ id: 'a', approved: true, state: 'merged' }, { id: 'b', approved: true, state: 'planned' }], [{ from: 'a', to: 'b' }])).toEqual(['b'])
  })
})
```

- [ ] **Step 2: Implementar validação e seleção determinística**

```ts
export interface DependencyEdge { readonly from: string; readonly to: string }
export interface GraphItem { readonly id: string; readonly approved: boolean; readonly state: 'planned' | 'ready' | 'running' | 'merged' | 'blocked' }

export function validateGraph(edges: readonly DependencyEdge[], ids: ReadonlySet<string>): { readonly ok: true } | { readonly ok: false; readonly reason: 'missing-node' | 'cycle' } {
  if (edges.some((edge) => !ids.has(edge.from) || !ids.has(edge.to))) return { ok: false, reason: 'missing-node' }
  const incoming = new Map([...ids].map((id) => [id, 0]))
  for (const edge of edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
  const queue = [...incoming].filter(([, count]) => count === 0).map(([id]) => id)
  let visited = 0
  while (queue.length > 0) {
    const id = queue.shift() as string
    visited += 1
    for (const edge of edges.filter((candidate) => candidate.from === id)) {
      const next = (incoming.get(edge.to) ?? 1) - 1
      incoming.set(edge.to, next)
      if (next === 0) queue.push(edge.to)
    }
  }
  return visited === ids.size ? { ok: true } : { ok: false, reason: 'cycle' }
}

export function readyItems(items: readonly GraphItem[], edges: readonly DependencyEdge[]): readonly string[] {
  const merged = new Set(items.filter((item) => item.state === 'merged').map((item) => item.id))
  return items.filter((item) => item.approved && item.state === 'planned' && edges.filter((edge) => edge.to === item.id).every((edge) => merged.has(edge.from))).map((item) => item.id).sort()
}
```

- [ ] **Step 3: Criar tabelas e repositório transacional**

Acrescentar ao fim das migrations `work_item` e `dependency_edge`, ambas com `user_id`, `project_id`; usar `UNIQUE(project_id, kind, ordinal)` para o índice canônico e `UNIQUE(project_id, from_id, to_id)` para arestas. O repositório deve substituir o grafo dentro de uma transação somente depois de `validateGraph` retornar `{ ok: true }`.

- [ ] **Step 4: Rodar regras, banco e commit**

Run: `npm test -- --project regras src/shared/domain/dependency-graph.spec.ts`

Expected: PASS.

Run: `npm test -- --project banco src/main/planning/work-item-repository.int-spec.ts`

Expected: PASS e rollback completo para grafo cíclico.

```bash
git add src/shared/domain/dependency-graph.ts src/shared/domain/dependency-graph.spec.ts src/main/storage/migrations.ts src/main/planning/work-item-repository.ts src/main/planning/work-item-repository.int-spec.ts
git commit -m "feat: persiste dag validado de mvps e fatias"
```

### Task 3: GitAdapter e bootstrap local idempotente

**Files:**
- Create: `src/main/git/git-adapter.ts`
- Create: `src/main/git/git-adapter.int-spec.ts`
- Create: `src/main/projects/project-bootstrapper.ts`
- Create: `src/main/projects/project-bootstrapper.int-spec.ts`

- [ ] **Step 1: Escrever teste de init repetível e preservação de diretório existente**

```ts
it('não reinicializa nem apaga arquivos ao repetir bootstrap', async () => {
  await bootstrapper.ensureLocal(project)
  await writeFile(join(project.directory, 'arquivo-do-usuario.txt'), 'preservar')
  await bootstrapper.ensureLocal(project)
  expect(await readFile(join(project.directory, 'arquivo-do-usuario.txt'), 'utf8')).toBe('preservar')
  expect(await git.head(project.directory)).toMatch(/^[0-9a-f]{40}$/)
})
```

- [ ] **Step 2: Implementar adapter com argumentos controlados**

```ts
export class GitAdapter {
  constructor(private readonly run = runManaged) {}

  async init(cwd: string): Promise<void> {
    const result = await this.run('git', ['init', '--initial-branch=main'], { cwd, timeoutMs: 30_000, maxOutputBytes: 64_000 })
    if (result.exitCode !== 0) throw new Error(`GIT_INIT_FAILED:${result.stderr}`)
  }

  async head(cwd: string): Promise<string> {
    const result = await this.run('git', ['rev-parse', 'HEAD'], { cwd, timeoutMs: 10_000, maxOutputBytes: 4_096 })
    if (result.exitCode !== 0) throw new Error(`GIT_HEAD_FAILED:${result.stderr}`)
    return result.stdout.trim()
  }
}
```

- [ ] **Step 3: Implementar bootstrapper fail-safe**

Criar o diretório somente se o pai estiver dentro da allowlist; se `.git` existir, apenas verificar o remoto e o HEAD; se o diretório tiver conteúdo e não for Git, terminar em `BLOCKED_PATH_NOT_EMPTY`; para repositório novo, gravar os templates do pacote aprovado, `git add`, commit inicial e registrar o SHA. A lista exata de operações do adapter é:

```ts
export interface ProjectBootstrapper {
  ensureLocal(project: Project): Promise<{ readonly baseSha: string; readonly created: boolean }>
  ensureRemote(project: Project): Promise<{ readonly remoteUrl: string; readonly pushedSha: string }>
}
```

- [ ] **Step 4: Rodar integração e commit**

Run: `npm test -- --project banco src/main/git/git-adapter.int-spec.ts src/main/projects/project-bootstrapper.int-spec.ts`

Expected: PASS sem tocar o checkout deste repositório.

```bash
git add src/main/git/git-adapter.ts src/main/git/git-adapter.int-spec.ts src/main/projects/project-bootstrapper.ts src/main/projects/project-bootstrapper.int-spec.ts
git commit -m "feat: cria bootstrap git local idempotente"
```

### Task 4: GitHubAdapter com reconciliação e idempotência

**Files:**
- Create: `src/main/github/github-adapter.ts`
- Create: `src/main/github/github-adapter.spec.ts`
- Create: `src/main/github/github-fixtures.ts`

- [ ] **Step 1: Escrever teste de consulta antes do efeito**

```ts
it('reutiliza issue marcada com a mesma chave externa', async () => {
  gh.enqueue({ stdout: JSON.stringify([{ number: 42, title: 'Fatia 01', body: '<!-- jarvis-work-item:s1 -->' }]), stderr: '', exitCode: 0, durationMs: 1 })
  const issue = await adapter.ensureIssue({ owner: 'RodReis', repo: 'produto', workItemId: 's1', title: 'Fatia 01', body: 'Escopo aprovado' })
  expect(issue.number).toBe(42)
  expect(gh.calls.filter((call) => call.args.includes('create'))).toHaveLength(0)
})
```

- [ ] **Step 2: Implementar o contrato do adapter**

```ts
export interface GitHubIssueRef { readonly number: number; readonly url: string }
export interface EnsureIssueInput { readonly owner: string; readonly repo: string; readonly workItemId: string; readonly title: string; readonly body: string }

export interface GitHubAdapter {
  ensureRepository(input: { readonly owner: string; readonly repo: string; readonly visibility: 'private' | 'public'; readonly localPath: string }): Promise<{ readonly url: string }>
  ensureIssue(input: EnsureIssueInput): Promise<GitHubIssueRef>
  linkDependency(input: { readonly owner: string; readonly repo: string; readonly issue: number; readonly blockedBy: number }): Promise<void>
  getHead(input: { readonly owner: string; readonly repo: string; readonly ref: string }): Promise<string>
}
```

- [ ] **Step 3: Implementar via `gh` sem shell**

Usar `gh repo view owner/repo --json url`, seguido de `gh repo create owner/repo --source localPath --private|--public --remote origin --push` somente quando a consulta devolver not-found. Para issues, procurar `<!-- jarvis-work-item:<id> -->` antes de `gh issue create`; parsear apenas JSON; redigir stdout/stderr antes de logar.

- [ ] **Step 4: Rodar fixtures e commit**

Run: `npm test -- --project regras src/main/github/github-adapter.spec.ts`

Expected: PASS sem rede.

```bash
git add src/main/github/github-adapter.ts src/main/github/github-adapter.spec.ts src/main/github/github-fixtures.ts
git commit -m "feat: adiciona adapter github idempotente"
```

### Task 5: Publicação do pacote aprovado

**Files:**
- Create: `src/main/planning/github-publisher.ts`
- Create: `src/main/planning/github-publisher.int-spec.ts`
- Modify: `src/main/storage/migrations.ts`

- [ ] **Step 1: Escrever teste de retomada após efeito externo inconclusivo**

O teste grava um `external_ref` sem URL, simula que a issue já existe no GitHub e confirma que `publish()` reconcilia a mesma issue, completa a referência e não cria outra.

- [ ] **Step 2: Criar tabela `external_ref`**

```sql
CREATE TABLE external_ref (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT NOT NULL,
  work_item_id TEXT, kind TEXT NOT NULL, external_id TEXT NOT NULL,
  url TEXT, base_sha TEXT, head_sha TEXT, merge_sha TEXT, updated_at TEXT NOT NULL,
  UNIQUE(project_id, kind, external_id)
);
```

- [ ] **Step 3: Implementar publicação em ordem**

`GithubPublisher.publish(projectId)` deve: confirmar hash aprovado do pacote; garantir remoto; publicar issue do MVP; publicar issues das fatias; persistir referências; publicar relações do DAG; consultar tudo novamente e devolver snapshot reconciliado. Qualquer hash divergente encerra com `BLOCKED_STALE_REVISION` antes de efeito novo.

- [ ] **Step 4: Rodar banco, suite e commit**

Run: `npm test -- --project banco src/main/planning/github-publisher.int-spec.ts`

Expected: PASS, incluindo retomada sem duplicidade.

Run: `npm test`

Expected: todas as categorias PASS.

```bash
git add src/main/storage/migrations.ts src/main/planning/github-publisher.ts src/main/planning/github-publisher.int-spec.ts
git commit -m "feat: publica dag aprovado no github"
```

### Task 6: Evidência do plano 2

**Files:**
- Modify: `docs/TESTING.md`
- Modify: `reports/TESTS.md`
- Modify: `docs/STATUS.md`
- Modify: `docs/DEVELOPMENT.md`

- [ ] **Step 1: Executar validação completa**

Run: `npm run build`

Expected: exit code 0.

Run: `npm run lint`

Expected: exit code 0.

Run: `npm run test:report && npm run test:report:check`

Expected: relatório atual e verificado.

- [ ] **Step 2: Registrar evidência e commit**

```bash
git add docs/TESTING.md reports/TESTS.md docs/STATUS.md docs/DEVELOPMENT.md
git commit -m "docs: registra prova de publicacao github"
```
