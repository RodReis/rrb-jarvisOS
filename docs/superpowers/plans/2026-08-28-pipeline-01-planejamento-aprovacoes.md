# Pipeline 01 — Planejamento e aprovações Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar Project Hub, Wizard A, geração rastreável dos artefatos versionados e os três gates de aprovação sem qualquer execução de código ou Git automático ainda.

**Architecture:** Contratos puros vivem em `src/shared`; SQLite guarda sessões, revisões e aprovações imutáveis; o main valida e grava artefatos; o renderer usa apenas IPC tipado. Aprovação referencia hash exato e a mesma revisão nunca pede aceite duas vezes.

**Tech Stack:** Electron 43, React 19, TypeScript 5.9, better-sqlite3, Vitest, Testing Library, design system existente.

---

## Dependências e sequência do programa

Este é o primeiro de quatro planos:

1. este plano — planejamento e aprovações;
2. `2026-08-28-pipeline-02-publicacao-github.md`;
3. `2026-08-28-pipeline-03-contexto-skills-recursos.md`;
4. `2026-08-28-pipeline-04-execucao-recuperacao-prova.md`.

Este plano consome o MVP-005 F04 já concluído para gerar documentos pelo Claude Code Adapter, sempre pelo ponto único de provider e BudgetPolicy. Não iniciar o plano 4 antes de o plano 2 fornecer o GitHub Adapter.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/shared/domain/projects.ts` | Tipos e máquinas de estado de projeto, planejamento, artefato, work item e aprovação. |
| `src/shared/domain/projects.spec.ts` | Invariantes puras de revisão, gate e transição. |
| `src/shared/contracts/project-brief.ts` | Forma canônica dos dez blocos do Wizard A e validação sem dependência do renderer. |
| `src/shared/contracts/project-brief.spec.ts` | Conclusão, decisão delegada e lacunas do wizard. |
| `src/main/storage/migrations.ts` | Migration append-only das tabelas de planejamento. |
| `src/main/planning/project-repository.ts` | Persistência escopada de projeto e sessão. |
| `src/main/planning/artifact-repository.ts` | Revisões imutáveis, paths e hashes. |
| `src/main/planning/approval-repository.ts` | Aceite único por alvo/revisão e invalidação dependente. |
| `src/main/planning/planning-service.ts` | Orquestra respostas, geração, anexos e gates. |
| `src/main/planning/planning-generator.ts` | Gera PRD, arquitetura, MVP e spec com rastreabilidade ao brief aprovado. |
| `src/main/planning/artifact-store.ts` | Escrita allowlisted e hash SHA-256 de documentos e HTML. |
| `src/shared/contracts/ipc.ts` | Canais e métodos públicos do planejamento. |
| `src/main/ipc/handlers.ts` | Validação da fronteira e chamadas do serviço. |
| `src/main/preload/index.ts` | Ponte nomeada, sem Node ou path arbitrário no renderer. |
| `src/renderer/src/projects/ProjectHub.tsx` | Lista e criação de projeto. |
| `src/renderer/src/projects/ProjectWizard.tsx` | Pop-up, uma pergunta por vez, recomendação e `Decida por mim`. |
| `src/renderer/src/projects/ApprovalGate.tsx` | Revisão e aprovação do pacote, MVP e fatia. |

### Task 1: Contratos de projeto, revisão e aprovação

**Files:**
- Create: `src/shared/domain/projects.ts`
- Create: `src/shared/domain/projects.spec.ts`

- [ ] **Step 1: Escrever o teste que trava aceite único e revisão exata**

```ts
import { describe, expect, it } from 'vitest'
import { approvalKey, canRunSlice, type Approval, type WorkItem } from './projects'

describe('gates da pipeline', () => {
  const approvals: readonly Approval[] = [
    { id: 'a1', target: 'project-package', targetId: 'p1', revisionHash: 'pkg-1', decidedBy: 'pi', decidedAt: '2026-08-28T12:00:00.000Z' },
    { id: 'a2', target: 'mvp', targetId: 'm1', revisionHash: 'mvp-1', decidedBy: 'pi', decidedAt: '2026-08-28T12:01:00.000Z' },
    { id: 'a3', target: 'slice', targetId: 's1', revisionHash: 'slice-1', decidedBy: 'pi', decidedAt: '2026-08-28T12:02:00.000Z' }
  ]

  it('gera uma chave estável por alvo e revisão', () => {
    expect(approvalKey(approvals[2])).toBe('slice:s1:slice-1')
  })

  it('libera somente a revisão aprovada com dependências concluídas', () => {
    const slice: WorkItem = { id: 's1', projectId: 'p1', mvpId: 'm1', kind: 'slice', projectPackageRevisionHash: 'pkg-1', mvpRevisionHash: 'mvp-1', revisionHash: 'slice-1', state: 'awaiting_pi', dependencyIds: [] }
    expect(canRunSlice(slice, approvals, new Set())).toBe(true)
    expect(canRunSlice({ ...slice, revisionHash: 'slice-2' }, approvals, new Set())).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar a falha inicial**

Run: `npm test -- --project regras src/shared/domain/projects.spec.ts`

Expected: FAIL com módulo `./projects` inexistente.

- [ ] **Step 3: Implementar o contrato mínimo completo**

```ts
export type ProjectState = 'draft' | 'refining' | 'review' | 'awaiting_pi' | 'approved' | 'archived'
export type WorkItemState = 'planned' | 'awaiting_pi' | 'ready' | 'running' | 'pr_ci' | 'merged' | 'blocked'
export type ApprovalTarget = 'project-package' | 'mvp' | 'slice'

export interface Project {
  readonly id: string
  readonly userId: string
  readonly workspaceId: 'jarvis'
  readonly name: string
  readonly directory: string
  readonly repositoryOwner: string
  readonly repositoryName: string
  readonly visibility: 'private' | 'public'
  readonly state: ProjectState
  readonly createdAt: string
  readonly updatedAt: string
}

export interface Approval {
  readonly id: string
  readonly target: ApprovalTarget
  readonly targetId: string
  readonly revisionHash: string
  readonly decidedBy: 'pi'
  readonly decidedAt: string
}

export interface WorkItem {
  readonly id: string
  readonly projectId: string
  readonly mvpId: string
  readonly kind: 'mvp' | 'slice'
  readonly projectPackageRevisionHash: string
  readonly mvpRevisionHash: string
  readonly revisionHash: string
  readonly state: WorkItemState
  readonly dependencyIds: readonly string[]
}

export function approvalKey(input: Pick<Approval, 'target' | 'targetId' | 'revisionHash'>): string {
  return `${input.target}:${input.targetId}:${input.revisionHash}`
}

export function canRunSlice(item: WorkItem, approvals: readonly Approval[], completed: ReadonlySet<string>): boolean {
  if (item.kind !== 'slice') return false
  const required = [
    approvalKey({ target: 'project-package', targetId: item.projectId, revisionHash: item.projectPackageRevisionHash }),
    approvalKey({ target: 'mvp', targetId: item.mvpId, revisionHash: item.mvpRevisionHash }),
    approvalKey({ target: 'slice', targetId: item.id, revisionHash: item.revisionHash })
  ]
  const approved = new Set(approvals.map(approvalKey))
  return required.every((key) => approved.has(key)) && item.dependencyIds.every((id) => completed.has(id))
}
```

- [ ] **Step 4: Rodar teste, typecheck e commit**

Run: `npm test -- --project regras src/shared/domain/projects.spec.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit code 0.

```bash
git add src/shared/domain/projects.ts src/shared/domain/projects.spec.ts
git commit -m "feat: define contratos de projetos e aprovacoes"
```

### Task 2: ProjectBriefSchema e decisões delegadas

**Files:**
- Create: `src/shared/contracts/project-brief.ts`
- Create: `src/shared/contracts/project-brief.spec.ts`

- [ ] **Step 1: Escrever testes para os dez blocos, recomendação e delegação explícita**

```ts
import { describe, expect, it } from 'vitest'
import { REQUIRED_BRIEF_BLOCKS, validateProjectBrief, type ProjectBrief } from './project-brief'

describe('ProjectBriefSchema', () => {
  it('não finaliza enquanto faltar bloco obrigatório', () => {
    expect(validateProjectBrief({ answers: {}, delegatedDecisions: [] }).missing).toEqual(REQUIRED_BRIEF_BLOCKS)
  })

  it('aceita decisão da IA somente com origem e justificativa', () => {
    const answers = Object.fromEntries(REQUIRED_BRIEF_BLOCKS.map((block) => [block, 'definido']))
    const brief: ProjectBrief = { answers, delegatedDecisions: [{ questionId: 'stack', option: 'react', decisionSource: 'ai_delegated', rationale: 'Compatível com a base existente.', confidence: 0.9 }] }
    expect(validateProjectBrief(brief)).toEqual({ ok: true, missing: [], invalidDelegations: [] })
  })
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm test -- --project regras src/shared/contracts/project-brief.spec.ts`

Expected: FAIL com módulo inexistente.

- [ ] **Step 3: Implementar schema e validação pura**

```ts
export const REQUIRED_BRIEF_BLOCKS = ['identity', 'problem', 'scope', 'journeys', 'domain', 'integrations', 'stack', 'nonFunctional', 'gitProviderBudget', 'risks'] as const
export type BriefBlock = (typeof REQUIRED_BRIEF_BLOCKS)[number]

export interface DelegatedDecision {
  readonly questionId: string
  readonly option: string
  readonly decisionSource: 'ai_delegated'
  readonly rationale: string
  readonly confidence: number
}

export interface ProjectBrief {
  readonly answers: Readonly<Partial<Record<BriefBlock, string>>>
  readonly delegatedDecisions: readonly DelegatedDecision[]
}

export function validateProjectBrief(brief: ProjectBrief): { readonly ok: boolean; readonly missing: readonly BriefBlock[]; readonly invalidDelegations: readonly string[] } {
  const missing = REQUIRED_BRIEF_BLOCKS.filter((block) => !brief.answers[block]?.trim())
  const invalidDelegations = brief.delegatedDecisions.filter((item) => !item.rationale.trim() || item.confidence < 0 || item.confidence > 1).map((item) => item.questionId)
  return { ok: missing.length === 0 && invalidDelegations.length === 0, missing, invalidDelegations }
}
```

- [ ] **Step 4: Rodar os testes e commitar**

Run: `npm test -- --project regras src/shared/contracts/project-brief.spec.ts`

Expected: PASS.

```bash
git add src/shared/contracts/project-brief.ts src/shared/contracts/project-brief.spec.ts
git commit -m "feat: valida brief e decisoes delegadas"
```

### Task 3: Persistência imutável do planejamento

**Files:**
- Modify: `src/main/storage/migrations.ts`
- Modify: `src/main/storage/storage.int-spec.ts`
- Create: `src/main/planning/project-repository.ts`
- Create: `src/main/planning/planning-repository.int-spec.ts`

- [ ] **Step 1: Acrescentar teste de migration e unicidade do aceite**

```ts
it('impede aceite duplicado da mesma revisão', () => {
  const insert = db.prepare(`INSERT INTO project_approval (id, user_id, project_id, target, target_id, revision_hash, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  insert.run('a1', 'u1', 'p1', 'slice', 's1', 'sha1', 'pi', '2026-08-28T12:00:00.000Z')
  expect(() => insert.run('a2', 'u1', 'p1', 'slice', 's1', 'sha1', 'pi', '2026-08-28T12:01:00.000Z')).toThrow()
})
```

- [ ] **Step 2: Acrescentar ao fim de `MIGRATIONS` a migration de planejamento**

```sql
CREATE TABLE project (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  name TEXT NOT NULL, directory TEXT NOT NULL, repository_owner TEXT NOT NULL,
  repository_name TEXT NOT NULL, visibility TEXT NOT NULL, state TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(user_id, directory), UNIQUE(repository_owner, repository_name)
);
CREATE TABLE planning_session (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT NOT NULL,
  revision INTEGER NOT NULL, state TEXT NOT NULL, brief_json TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(project_id, revision), FOREIGN KEY(project_id) REFERENCES project(id)
);
CREATE TABLE artifact_bundle (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT NOT NULL,
  revision INTEGER NOT NULL, bundle_hash TEXT NOT NULL, manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL, UNIQUE(project_id, revision), UNIQUE(project_id, bundle_hash),
  FOREIGN KEY(project_id) REFERENCES project(id)
);
CREATE TABLE project_approval (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT NOT NULL,
  target TEXT NOT NULL, target_id TEXT NOT NULL, revision_hash TEXT NOT NULL,
  decided_by TEXT NOT NULL, decided_at TEXT NOT NULL,
  UNIQUE(project_id, target, target_id, revision_hash),
  FOREIGN KEY(project_id) REFERENCES project(id)
);
```

- [ ] **Step 3: Implementar repositório com todas as consultas escopadas por usuário**

```ts
import type { Database } from 'better-sqlite3'
import type { Project } from '@shared/domain/projects'

export class ProjectRepository {
  constructor(private readonly db: Database) {}

  save(project: Project): Project {
    this.db.prepare(`INSERT INTO project (id,user_id,workspace_id,name,directory,repository_owner,repository_name,visibility,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(project.id, project.userId, project.workspaceId, project.name, project.directory, project.repositoryOwner, project.repositoryName, project.visibility, project.state, project.createdAt, project.updatedAt)
    return project
  }

  list(userId: string): readonly Project[] {
    return (this.db.prepare('SELECT * FROM project WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as readonly Record<string, string>[]).map((row) => ({ id: row.id, userId: row.user_id, workspaceId: 'jarvis', name: row.name, directory: row.directory, repositoryOwner: row.repository_owner, repositoryName: row.repository_name, visibility: row.visibility as Project['visibility'], state: row.state as Project['state'], createdAt: row.created_at, updatedAt: row.updated_at }))
  }
}
```

- [ ] **Step 4: Rodar banco, regras e typecheck**

Run: `npm test -- --project banco src/main/storage/storage.int-spec.ts src/main/planning/planning-repository.int-spec.ts`

Expected: PASS, incluindo unicidade do aceite.

Run: `npm run typecheck`

Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/migrations.ts src/main/storage/storage.int-spec.ts src/main/planning/project-repository.ts src/main/planning/planning-repository.int-spec.ts
git commit -m "feat: persiste planejamento e aprovacoes imutaveis"
```

### Task 4: Artefatos, anexos obrigatórios e hashes

**Files:**
- Create: `src/main/planning/artifact-store.ts`
- Create: `src/main/planning/artifact-store.int-spec.ts`
- Create: `src/main/planning/planning-service.ts`
- Create: `src/main/planning/planning-service.spec.ts`

- [ ] **Step 1: Escrever testes para path seguro, design obrigatório e hash estável**

```ts
it('recusa pacote sem DESIGN-SYSTEM.md e protótipo HTML', async () => {
  await expect(service.finalizePackage('p1')).rejects.toThrow('Anexe DESIGN-SYSTEM.md e ao menos um protótipo HTML.')
})

it('produz o mesmo hash para o mesmo manifesto ordenado', () => {
  expect(hashManifest([{ path: 'docs/PRD.md', sha256: 'a' }, { path: 'docs/ARCHITECTURE.md', sha256: 'b' }])).toBe(hashManifest([{ path: 'docs/ARCHITECTURE.md', sha256: 'b' }, { path: 'docs/PRD.md', sha256: 'a' }]))
})
```

- [ ] **Step 2: Implementar hash canônico e escrita sob o diretório do projeto**

```ts
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

export interface ManifestEntry { readonly path: string; readonly sha256: string }

export function hashManifest(entries: readonly ManifestEntry[]): string {
  const canonical = [...entries].sort((a, b) => a.path.localeCompare(b.path)).map((entry) => `${entry.path}:${entry.sha256}`).join('\n')
  return createHash('sha256').update(canonical).digest('hex')
}

export async function writeArtifact(root: string, path: string, content: string): Promise<ManifestEntry> {
  const target = resolve(root, path)
  const inside = relative(resolve(root), target)
  if (inside.startsWith('..') || inside === '') throw new Error('Artefato fora do diretório do projeto.')
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, 'utf8')
  return { path: inside.replaceAll('\\', '/'), sha256: createHash('sha256').update(content).digest('hex') }
}
```

- [ ] **Step 3: Implementar `PlanningService.finalizePackage`**

O método deve consultar o manifesto persistido, exigir exatamente `docs/design/DESIGN-SYSTEM.md`, pelo menos um `.html` sob `docs/design/`, `docs/PRD.md` e `docs/ARCHITECTURE.md`, calcular `bundleHash`, persistir uma nova revisão imutável e devolver `{ bundleId, revision, bundleHash }`. Não classificar domínio nem acrescentar requisito ausente do brief aprovado.

- [ ] **Step 4: Rodar testes e commitar**

Run: `npm test -- --project regras src/main/planning/planning-service.spec.ts`

Expected: PASS.

Run: `npm test -- --project banco src/main/planning/artifact-store.int-spec.ts`

Expected: PASS, inclusive tentativa de `../` recusada.

```bash
git add src/main/planning/artifact-store.ts src/main/planning/artifact-store.int-spec.ts src/main/planning/planning-service.ts src/main/planning/planning-service.spec.ts
git commit -m "feat: versiona artefatos e anexos de design"
```

### Task 5: Gerador rastreável de PRD, arquitetura, MVP e spec

**Files:**
- Create: `src/main/planning/planning-generator.ts`
- Create: `src/main/planning/planning-generator.spec.ts`
- Modify: `src/main/planning/planning-service.ts`
- Modify: `src/main/planning/planning-service.spec.ts`

- [ ] **Step 1: Escrever teste que rejeita requisito sem origem no brief**

```ts
it('rejeita requisito inventado pelo provider', async () => {
  provider.generate.mockResolvedValue({
    document: '# PRD\n- Exigir aprovação final do merge',
    requirements: [{ id: 'r1', text: 'Exigir aprovação final do merge', sourceQuestionIds: [] }],
    usage: { inputTokens: 900, outputTokens: 300 }
  })
  await expect(generator.generatePrd(completeBrief)).rejects.toThrow('UNGROUNDED_REQUIREMENT:r1')
})

it('aceita requisito ligado a resposta ou decisão delegada', async () => {
  provider.generate.mockResolvedValue({
    document: '# PRD\n- Git automático',
    requirements: [{ id: 'r1', text: 'Git automático', sourceQuestionIds: ['gitProviderBudget'] }],
    usage: { inputTokens: 900, outputTokens: 300 }
  })
  await expect(generator.generatePrd(completeBrief)).resolves.toMatchObject({ document: expect.stringContaining('Git automático') })
})
```

- [ ] **Step 2: Definir a porta estreita para o gateway do MVP-005**

```ts
export interface GeneratedRequirement {
  readonly id: string
  readonly text: string
  readonly sourceQuestionIds: readonly string[]
}

export interface PlanningGenerationResult {
  readonly document: string
  readonly requirements: readonly GeneratedRequirement[]
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number }
}

export interface PlanningProviderPort {
  generate(input: {
    readonly requestId: string
    readonly taskType: 'summarize' | 'code'
    readonly providerHint: 'claude-code'
    readonly prompt: string
    readonly maxTurns: number
    readonly outputSchema: Readonly<Record<string, unknown>>
  }): Promise<PlanningGenerationResult>
}
```

- [ ] **Step 3: Implementar geração em quatro fases com entrada limitada**

`generatePrd` recebe somente o brief completo; `generateArchitecture` recebe brief, hash/conteúdo do PRD e manifesto dos anexos; `generateMvp` recebe o pacote aprovado; `generateSlice` recebe somente o MVP escolhido e suas dependências. Cada requisito devolvido precisa ter `sourceQuestionIds` existentes no brief ou a geração falha. Cada chamada fixa `providerHint: 'claude-code'`, passa pelo gateway, registra usage e nunca lê o repositório inteiro.

- [ ] **Step 4: Integrar ao PlanningService sem aceite duplicado**

Após o brief completo, gerar e gravar `docs/PRD.md`; depois dos anexos, gerar `docs/ARCHITECTURE.md` e finalizar o pacote; somente após aprovação do pacote gerar proposta de MVP; somente após aprovação do MVP gerar primeira spec. Repetir a operação com o mesmo hash devolve o artefato existente.

- [ ] **Step 5: Rodar e commit**

Run: `npm test -- --project regras src/main/planning/planning-generator.spec.ts src/main/planning/planning-service.spec.ts`

Expected: PASS, incluindo requisito sem origem recusado.

```bash
git add src/main/planning/planning-generator.ts src/main/planning/planning-generator.spec.ts src/main/planning/planning-service.ts src/main/planning/planning-service.spec.ts
git commit -m "feat: gera planejamento rastreavel pelo provider"
```

### Task 6: IPC tipado do Project Hub e dos gates

**Files:**
- Modify: `src/shared/contracts/ipc.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/main/ipc/handlers.spec.ts`
- Modify: `src/main/preload/index.ts`
- Modify: `src/main/preload/preload.spec.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Escrever testes de contrato para os novos canais**

Adicionar expectativas para estes canais nomeados: `project:list`, `project:create`, `planning:get`, `planning:answer`, `planning:delegate`, `planning:attach`, `planning:finalize`, `approval:approve`. O teste deve provar um handler por canal e que `approval:approve` rejeita `target`, `targetId` ou `revisionHash` vazios.

- [ ] **Step 2: Acrescentar os métodos públicos à ponte**

```ts
export interface CreateProjectInput {
  readonly name: string
  readonly directory: string
  readonly repositoryOwner: string
  readonly repositoryName: string
  readonly visibility: 'private' | 'public'
}

export interface PlanningSnapshot {
  readonly projectId: string
  readonly revision: number
  readonly brief: ProjectBrief
  readonly currentQuestionId: string | null
  readonly canFinalize: boolean
  readonly missingBlocks: readonly BriefBlock[]
}

export interface ArtifactAttachmentInput {
  readonly fileName: string
  readonly mediaType: 'text/markdown' | 'text/html'
  readonly content: string
}

export interface ArtifactBundleSnapshot {
  readonly bundleId: string
  readonly revision: number
  readonly bundleHash: string
  readonly entries: readonly { readonly path: string; readonly sha256: string }[]
}

export interface ApprovalInput {
  readonly projectId: string
  readonly target: ApprovalTarget
  readonly targetId: string
  readonly revisionHash: string
}

listProjects(): Promise<readonly Project[]>
createProject(input: CreateProjectInput): Promise<Project>
getPlanning(projectId: string): Promise<PlanningSnapshot>
answerPlanning(projectId: string, questionId: string, answer: string): Promise<PlanningSnapshot>
delegatePlanningDecision(projectId: string, questionId: string): Promise<PlanningSnapshot>
attachPlanningArtifact(projectId: string, input: ArtifactAttachmentInput): Promise<ArtifactBundleSnapshot>
finalizePlanning(projectId: string): Promise<ArtifactBundleSnapshot>
approvePlanning(input: ApprovalInput): Promise<Approval>
```

- [ ] **Step 3: Implementar handlers validando strings, enums e escopo no main**

Nenhum handler aceita path de destino vindo do renderer. `attachPlanningArtifact` recebe conteúdo e nome lógico; o main escolhe o destino sob o diretório registrado do projeto. `approvePlanning` resolve `decidedBy: 'pi'` no main e devolve o aceite existente quando a chave alvo/revisão já estiver gravada.

- [ ] **Step 4: Rodar contratos e commitar**

Run: `npm test -- --project regras src/main/ipc/handlers.spec.ts src/main/preload/preload.spec.ts`

Expected: PASS, sem canal genérico.

```bash
git add src/shared/contracts/ipc.ts src/main/ipc/handlers.ts src/main/ipc/handlers.spec.ts src/main/preload/index.ts src/main/preload/preload.spec.ts src/main/index.ts
git commit -m "feat: expoe planejamento por ipc tipado"
```

### Task 7: Project Hub, Wizard A e Approval Gate

**Files:**
- Create: `src/renderer/src/projects/ProjectHub.tsx`
- Create: `src/renderer/src/projects/ProjectHub.test.tsx`
- Create: `src/renderer/src/projects/ProjectWizard.tsx`
- Create: `src/renderer/src/projects/ProjectWizard.test.tsx`
- Create: `src/renderer/src/projects/ApprovalGate.tsx`
- Modify: `src/renderer/src/app/AppShell.tsx`
- Modify: `src/renderer/src/workspace/navegacao.ts`
- Modify: `src/renderer/src/i18n/recursos.ts`

- [ ] **Step 1: Escrever testes de tela da jornada aprovada**

```tsx
it('mostra uma pergunta, recomendação e Decida por mim', async () => {
  render(<ProjectWizard projectId="p1" />)
  expect(await screen.findByRole('dialog', { name: /planejamento do projeto/i })).toBeVisible()
  expect(screen.getByText(/recomendação/i)).toBeVisible()
  expect(screen.getByRole('button', { name: /decida por mim/i })).toBeEnabled()
})

it('não oferece segundo aceite para a mesma revisão', async () => {
  render(<ApprovalGate snapshot={{ target: 'slice', targetId: 's1', revisionHash: 'sha1', approved: true }} />)
  expect(screen.queryByRole('button', { name: /aprovar/i })).not.toBeInTheDocument()
  expect(screen.getByText(/revisão aprovada/i)).toBeVisible()
})
```

- [ ] **Step 2: Implementar o pop-up com componentes públicos do design system**

`ProjectWizard` deve usar `Dialog`, `Button`, `Progress` e controles já exportados em `@design/ui`; salvar após cada resposta; bloquear `Finalizar planejamento` enquanto `snapshot.canFinalize` for falso; mostrar as decisões delegadas na revisão final. Não criar pergunta sobre requisito que não esteja no schema ou que não tenha sido pedida pelo PI.

- [ ] **Step 3: Integrar rota `projetos` no JARVIS OS**

Adicionar `projetos` à navegação do Command Center, renderizar `ProjectHub` em `AppShell` e manter o conteúdo inacessível no workspace NOA. O Project Hub deve mostrar nome, estado derivado e próxima ação derivada, sem coluna de aceite final de PR.

- [ ] **Step 4: Rodar tela, build e lint**

Run: `npm test -- --project tela src/renderer/src/projects/ProjectHub.test.tsx src/renderer/src/projects/ProjectWizard.test.tsx`

Expected: PASS.

Run: `npm run build`

Expected: exit code 0.

Run: `npm run lint`

Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/projects src/renderer/src/app/AppShell.tsx src/renderer/src/workspace/navegacao.ts src/renderer/src/i18n/recursos.ts
git commit -m "feat: entrega project hub wizard e gates"
```

### Task 8: Evidência e encerramento do plano 1

**Files:**
- Modify: `docs/TESTING.md`
- Modify: `reports/TESTS.md`
- Modify: `docs/STATUS.md`
- Modify: `docs/DEVELOPMENT.md`

- [ ] **Step 1: Executar a suíte completa aplicável**

Run: `npm test`

Expected: todas as categorias PASS.

Run: `npm run build`

Expected: exit code 0.

Run: `npm run lint`

Expected: exit code 0.

- [ ] **Step 2: Gerar e verificar o relatório**

Run: `npm run test:report`

Expected: `reports/TESTS.md` atualizado.

Run: `npm run test:report:check`

Expected: exit code 0.

- [ ] **Step 3: Atualizar somente fatos materiais e commitar**

Registrar a fatia e sua evidência no índice Fatia ↔ SPEC de `STATUS.md`; manter prosa detalhada em `DEVELOPMENT.md`; não criar aceite adicional.

```bash
git add docs/TESTING.md reports/TESTS.md docs/STATUS.md docs/DEVELOPMENT.md
git commit -m "docs: registra evidencia do planejamento da pipeline"
```
