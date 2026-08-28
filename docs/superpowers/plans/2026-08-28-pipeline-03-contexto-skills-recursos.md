# Pipeline 03 — Contexto, skills e recursos locais Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar orçamento de contexto, aquisição progressiva, resolução de skills por capacidade e leases de Docker/portas antes de ligar a execução autônoma.

**Architecture:** Políticas versionadas são carregadas e validadas no main; seletores puros produzem um manifesto de contexto; resolutores registram ferramentas efetivas; leases transacionais impedem colisão de recursos. Graphify e compressão são plugins opcionais com fallback e experimento mensurável.

**Tech Stack:** TypeScript, JSON, SQLite, Node.js filesystem/process, Vitest.

---

## Pré-requisito

Concluir os planos 1 e 2. Este plano não chama provider; ele entrega os guardrails que o plano 4 deve consumir.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `docs/AGENT-POLICY.md` | Política humana aprovada. |
| `skills-policy.json` | Capacidades, aliases, perfil, fallback e restrições. |
| `skills.lock.json` | Resolução efetiva inicial, atualizada por run. |
| `src/shared/domain/context-policy.ts` | Tipos, preflight e estados de orçamento. |
| `src/main/context/context-selector.ts` | Seleção progressiva e cache por hash/SHA. |
| `src/main/skills/skill-resolver.ts` | Capability-first e fallback. |
| `src/main/context/structural-index.ts` | Interface Graphify/`rg`, sem fonte paralela de verdade. |
| `src/main/context/compression-experiment.ts` | A/B de tokens totais, qualidade, retries e tempo. |
| `src/main/resources/resource-lease-repository.ts` | Lease transacional para Compose, porta e volume. |
| `src/main/resources/docker-runtime.ts` | Start/reuse/cleanup/reconcile de stack declarada. |

### Task 1: Política documental e schema executável

**Files:**
- Create: `docs/AGENT-POLICY.md`
- Create: `skills-policy.json`
- Create: `skills.lock.json`
- Create: `src/main/skills/policy-loader.ts`
- Create: `src/main/skills/policy-loader.spec.ts`

- [ ] **Step 1: Escrever teste que recusa divergência e skill sem fallback**

```ts
it('recusa capacidade obrigatória sem alias resolvido nem fallback', () => {
  expect(() => validateSkillsPolicy({ version: 1, profiles: { code: ['review'] }, capabilities: { review: { required: true, aliases: [], fallback: [] } } })).toThrow('SKILL_POLICY_INVALID:review')
})
```

- [ ] **Step 2: Criar `skills-policy.json` válido**

```json
{
  "version": 1,
  "profiles": {
    "code": ["tests", "review"],
    "ui": ["tests", "frontend-design", "visual-critique", "live-smoke"],
    "critical": ["tdd", "deep-review"],
    "library": ["current-docs"],
    "docs": ["docs-validation"],
    "finalization": ["full-verification", "git-finish"]
  },
  "capabilities": {
    "tests": { "required": true, "aliases": ["test-driven-development"], "fallback": ["run-project-tests"] },
    "review": { "required": true, "aliases": ["engineering:code-review", "code-review-and-quality"], "fallback": ["review-diff-against-spec"] },
    "frontend-design": { "required": false, "aliases": ["frontend-design"], "fallback": ["apply-design-system"] },
    "visual-critique": { "required": false, "aliases": ["impeccable", "gstack:design-review"], "fallback": ["visual-checklist"] },
    "live-smoke": { "required": false, "aliases": ["playwright", "gstack:qa"], "fallback": ["manual-live-smoke"] },
    "tdd": { "required": true, "aliases": ["test-driven-development"], "fallback": ["red-green-refactor"] },
    "deep-review": { "required": true, "aliases": ["code-review-and-quality"], "fallback": ["invariant-security-review"] },
    "current-docs": { "required": true, "aliases": ["context7-mcp"], "fallback": ["official-docs-only"] },
    "docs-validation": { "required": true, "aliases": [], "fallback": ["validate-schema-links-hashes"] },
    "full-verification": { "required": true, "aliases": [], "fallback": ["test-build-lint-ci"] },
    "git-finish": { "required": true, "aliases": ["superpowers:finishing-a-development-branch"], "fallback": ["verify-push-pr-merge-cleanup"] }
  }
}
```

- [ ] **Step 3: Criar lock inicial vazio, mas válido**

```json
{
  "policyVersion": 1,
  "resolvedAt": null,
  "runId": null,
  "capabilities": []
}
```

- [ ] **Step 4: Escrever `AGENT-POLICY.md` sem acrescentar requisito de produto**

O documento deve cobrir: três gates existentes; mesma revisão aceita uma vez; Git automático após aprovação da fatia; matriz de bloqueios da seção 13.1 da spec; orçamento e aquisição progressiva; perfis de skills; Docker/leases; proibição de inventar requisito não fornecido pelo PI. Ele deve apontar `skills-policy.json` como contrato executável.

O loader valida o JSON com esta regra mínima antes de qualquer run:

```ts
export interface SkillRule {
  readonly required: boolean
  readonly aliases: readonly string[]
  readonly fallback: readonly string[]
}

export interface SkillsPolicy {
  readonly version: number
  readonly profiles: Readonly<Record<string, readonly string[]>>
  readonly capabilities: Readonly<Record<string, SkillRule>>
}

export function validateSkillsPolicy(policy: SkillsPolicy): SkillsPolicy {
  for (const [capability, rule] of Object.entries(policy.capabilities)) {
    if (rule.required && rule.aliases.length === 0 && rule.fallback.length === 0) {
      throw new Error(`SKILL_POLICY_INVALID:${capability}`)
    }
  }
  for (const capabilities of Object.values(policy.profiles)) {
    for (const capability of capabilities) {
      if (!policy.capabilities[capability]) throw new Error(`UNKNOWN_CAPABILITY:${capability}`)
    }
  }
  return policy
}
```

- [ ] **Step 5: Rodar regra e commit**

Run: `npm test -- --project regras src/main/skills/policy-loader.spec.ts`

Expected: PASS.

```bash
git add docs/AGENT-POLICY.md skills-policy.json skills.lock.json src/main/skills/policy-loader.ts src/main/skills/policy-loader.spec.ts
git commit -m "feat: define politica executavel de agentes"
```

### Task 2: ContextPolicy e preflight de orçamento

**Files:**
- Create: `src/shared/domain/context-policy.ts`
- Create: `src/shared/domain/context-policy.spec.ts`
- Modify: `src/main/storage/migrations.ts`
- Create: `src/main/context/context-ledger-repository.ts`
- Create: `src/main/context/context-ledger-repository.int-spec.ts`

- [ ] **Step 1: Escrever teste dos estados allow, compact e block**

```ts
import { describe, expect, it } from 'vitest'
import { evaluateContextBudget } from './context-policy'

const policy = { maxInputTokens: 20_000, maxOutputTokens: 4_000, maxTurns: 12, maxFiles: 40, maxBytes: 500_000, maxExpansions: 8, warningThreshold: 0.8, wholeRepoAllowed: false } as const

describe('ContextPolicy', () => {
  it('compacta no limiar e bloqueia no teto', () => {
    expect(evaluateContextBudget(policy, { inputTokens: 16_000, outputTokens: 0, turns: 1, files: 4, bytes: 10_000, expansions: 1 })).toBe('compact')
    expect(evaluateContextBudget(policy, { inputTokens: 20_001, outputTokens: 0, turns: 1, files: 4, bytes: 10_000, expansions: 1 })).toBe('block')
  })
})
```

- [ ] **Step 2: Implementar avaliação considerando toda a entrada**

```ts
export interface ContextPolicy { readonly maxInputTokens: number; readonly maxOutputTokens: number; readonly maxTurns: number; readonly maxFiles: number; readonly maxBytes: number; readonly maxExpansions: number; readonly warningThreshold: number; readonly wholeRepoAllowed: boolean }
export interface ContextUsage { readonly inputTokens: number; readonly outputTokens: number; readonly turns: number; readonly files: number; readonly bytes: number; readonly expansions: number }
export type ContextBudgetDecision = 'allow' | 'compact' | 'block'

export function evaluateContextBudget(policy: ContextPolicy, usage: ContextUsage): ContextBudgetDecision {
  const ratios = [usage.inputTokens / policy.maxInputTokens, usage.outputTokens / policy.maxOutputTokens, usage.turns / policy.maxTurns, usage.files / policy.maxFiles, usage.bytes / policy.maxBytes, usage.expansions / policy.maxExpansions]
  const maximum = Math.max(...ratios)
  if (maximum >= 1) return 'block'
  return maximum >= policy.warningThreshold ? 'compact' : 'allow'
}
```

- [ ] **Step 3: Persistir eventos de seleção e exceção whole-repo**

Criar `context_event` append-only com `run_id`, `attempt_id`, `base_sha`, `phase`, `decision`, contadores, `selected_json`, `reason`, `created_at`. O repositório não expõe update/delete; leitura sempre usa `run_id`.

- [ ] **Step 4: Rodar e commit**

Run: `npm test -- --project regras src/shared/domain/context-policy.spec.ts`

Expected: PASS.

Run: `npm test -- --project banco src/main/context/context-ledger-repository.int-spec.ts`

Expected: PASS, incluindo append-only.

```bash
git add src/shared/domain/context-policy.ts src/shared/domain/context-policy.spec.ts src/main/storage/migrations.ts src/main/context/context-ledger-repository.ts src/main/context/context-ledger-repository.int-spec.ts
git commit -m "feat: aplica orcamento de contexto por tentativa"
```

### Task 3: Aquisição progressiva e cache por SHA

**Files:**
- Create: `src/main/context/context-selector.ts`
- Create: `src/main/context/context-selector.int-spec.ts`
- Create: `src/main/context/file-hash-cache.ts`

- [ ] **Step 1: Escrever teste da ordem e da proibição de whole repo**

```ts
it('seleciona spec e diff antes de expandir dependências', async () => {
  const result = await selector.select({ runId: 'r1', baseSha: 'abc', specPaths: ['docs/spec/s1.md'], changedPaths: ['src/a.ts'], failingPaths: ['src/a.spec.ts'], requestWholeRepo: false })
  expect(result.entries.map((entry) => entry.reason)).toEqual(['approved-spec', 'changed-file', 'failing-test'])
})

it('nega repositório inteiro sem exceção', async () => {
  await expect(selector.select({ runId: 'r1', baseSha: 'abc', specPaths: [], changedPaths: [], failingPaths: [], requestWholeRepo: true })).rejects.toThrow('WHOLE_REPO_DENIED')
})
```

- [ ] **Step 2: Implementar manifesto de seleção**

```ts
export type ContextReason = 'approved-spec' | 'changed-file' | 'failing-test' | 'direct-dependency' | 'structural-query'
export interface ContextEntry { readonly path: string; readonly sha256: string; readonly bytes: number; readonly reason: ContextReason }
export interface ContextManifest { readonly runId: string; readonly baseSha: string; readonly entries: readonly ContextEntry[]; readonly estimatedTokens: number }
```

O selector deve canonizar e deduplicar paths; rejeitar arquivo fora do checkout; ler na ordem definida; parar no limiar; estimar tokens por contagem conservadora de `Math.ceil(bytes / 3)`; registrar cada expansão no ledger; reutilizar conteúdo somente quando `baseSha + path + sha256` coincidir.

- [ ] **Step 3: Rodar integração e commit**

Run: `npm test -- --project banco src/main/context/context-selector.int-spec.ts`

Expected: PASS e nenhum arquivo fora do diretório temporário lido.

```bash
git add src/main/context/context-selector.ts src/main/context/context-selector.int-spec.ts src/main/context/file-hash-cache.ts
git commit -m "feat: seleciona contexto progressivo por sha"
```

### Task 4: SkillResolver por capacidade

**Files:**
- Create: `src/main/skills/skill-resolver.ts`
- Create: `src/main/skills/skill-resolver.spec.ts`

- [ ] **Step 1: Escrever testes de alias, fallback e conjunto mínimo**

```ts
it('resolve o primeiro alias disponível', () => {
  expect(resolveCapability('review', policy, new Set(['code-review-and-quality']))).toMatchObject({ mode: 'skill', name: 'code-review-and-quality' })
})

it('usa fallback quando o nome não existe', () => {
  expect(resolveCapability('git-finish', policy, new Set())).toMatchObject({ mode: 'fallback', name: 'verify-push-pr-merge-cleanup' })
})
```

- [ ] **Step 2: Implementar resolução determinística**

```ts
import type { SkillsPolicy } from './policy-loader'

export type SkillResolution =
  | { readonly capability: string; readonly mode: 'skill'; readonly name: string }
  | { readonly capability: string; readonly mode: 'fallback'; readonly name: string }

export function resolveCapability(capability: string, policy: SkillsPolicy, available: ReadonlySet<string>): SkillResolution {
  const rule = policy.capabilities[capability]
  if (!rule) throw new Error(`UNKNOWN_CAPABILITY:${capability}`)
  const alias = rule.aliases.find((candidate) => available.has(candidate))
  if (alias) return { capability, mode: 'skill', name: alias }
  const fallback = rule.fallback[0]
  if (fallback) return { capability, mode: 'fallback', name: fallback }
  throw new Error(`CAPABILITY_UNAVAILABLE:${capability}`)
}
```

- [ ] **Step 3: Gravar lock atômico e auditável**

O resolver deve montar todas as capacidades do perfil, eliminar aliases repetidos que cubrem a mesma capacidade, acrescentar origem/versão/hash quando for skill externa, gravar o lock em arquivo temporário e renomear para `skills.lock.json`. Um run persiste uma cópia do lock no ledger; outro run não altera sua cópia histórica.

- [ ] **Step 4: Rodar e commit**

Run: `npm test -- --project regras src/main/skills/skill-resolver.spec.ts`

Expected: PASS.

```bash
git add src/main/skills/skill-resolver.ts src/main/skills/skill-resolver.spec.ts
git commit -m "feat: resolve skills por capacidade e fallback"
```

### Task 5: Graphify opcional e fallback `rg`

**Files:**
- Create: `src/main/context/structural-index.ts`
- Create: `src/main/context/structural-index.spec.ts`

- [ ] **Step 1: Escrever teste de índice obsoleto e fallback**

```ts
it('descarta índice de outro SHA e consulta rg', async () => {
  graphify.query.mockResolvedValue({ baseSha: 'velho', paths: ['src/errado.ts'] })
  rg.query.mockResolvedValue(['src/correto.ts'])
  await expect(index.query({ baseSha: 'novo', term: 'PlanningService' })).resolves.toEqual({ source: 'rg', paths: ['src/correto.ts'] })
})
```

- [ ] **Step 2: Implementar interface sem modo estrito**

```ts
export interface StructuralQuery { readonly baseSha: string; readonly term: string }
export interface StructuralResult { readonly source: 'graphify' | 'rg'; readonly paths: readonly string[] }
export interface StructuralBackend { query(input: StructuralQuery): Promise<{ readonly baseSha: string; readonly paths: readonly string[] }> }
```

Usar Graphify somente quando habilitado e acima do limiar configurado; nunca bloquear primeira leitura; aceitar resultado apenas se `result.baseSha === input.baseSha`; manter `graphify-out` fora do contexto automático; cair para `rg --files`/`rg -l` em ausência, erro ou obsolescência.

- [ ] **Step 3: Rodar e commit**

Run: `npm test -- --project regras src/main/context/structural-index.spec.ts`

Expected: PASS.

```bash
git add src/main/context/structural-index.ts src/main/context/structural-index.spec.ts
git commit -m "feat: adiciona indice estrutural opcional"
```

### Task 6: Experimento de compressão honesto

**Files:**
- Create: `src/main/context/compression-experiment.ts`
- Create: `src/main/context/compression-experiment.spec.ts`

- [ ] **Step 1: Escrever teste que rejeita economia aparente com mais tokens totais**

```ts
it('rejeita variante que reduz saída mas aumenta total do provider', () => {
  expect(decideCompression({ control: { inputTokens: 1000, outputTokens: 300, retries: 0, quality: 1, durationMs: 1000 }, candidate: { inputTokens: 1400, outputTokens: 100, retries: 0, quality: 1, durationMs: 900 } })).toBe('reject')
})
```

- [ ] **Step 2: Implementar gate A/B**

```ts
export interface ExperimentSample { readonly inputTokens: number; readonly outputTokens: number; readonly retries: number; readonly quality: number; readonly durationMs: number }
export function decideCompression(input: { readonly control: ExperimentSample; readonly candidate: ExperimentSample }): 'adopt' | 'reject' {
  const totalControl = input.control.inputTokens + input.control.outputTokens
  const totalCandidate = input.candidate.inputTokens + input.candidate.outputTokens
  return totalCandidate < totalControl && input.candidate.quality >= input.control.quality && input.candidate.retries <= input.control.retries ? 'adopt' : 'reject'
}
```

- [ ] **Step 3: Restringir o experimento**

Aceitar apenas `status`, `commit-message` e `review-summary`; exigir telemetria própria desativada, versão/hash fixado e amostra pareada. Arquitetura, segurança técnica, invariantes e regras de negócio retornam `COMPRESSION_NOT_ALLOWED`.

- [ ] **Step 4: Rodar e commit**

Run: `npm test -- --project regras src/main/context/compression-experiment.spec.ts`

Expected: PASS.

```bash
git add src/main/context/compression-experiment.ts src/main/context/compression-experiment.spec.ts
git commit -m "feat: mede compressao por tokens totais"
```

### Task 7: Leases Docker, portas e reconciliação

**Files:**
- Modify: `src/main/storage/migrations.ts`
- Create: `src/main/resources/resource-lease-repository.ts`
- Create: `src/main/resources/resource-lease-repository.int-spec.ts`
- Create: `src/main/resources/docker-runtime.ts`
- Create: `src/main/resources/docker-runtime.spec.ts`

- [ ] **Step 1: Escrever testes de colisão, reuso e limpeza**

```ts
it('não entrega a mesma porta a dois projetos ativos', () => {
  expect(repo.acquire({ projectId: 'p1', runId: 'r1', kind: 'port', preferred: '54001' }).value).toBe('54001')
  expect(repo.acquire({ projectId: 'p2', runId: 'r2', kind: 'port', preferred: '54001' }).value).not.toBe('54001')
})

it('reutiliza stack saudável do mesmo projeto', async () => {
  runtime.inspect.mockResolvedValue({ healthy: true })
  await manager.ensureStack(project, run)
  expect(runtime.up).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Criar schema de lease**

```sql
CREATE TABLE resource_lease (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT NOT NULL,
  kind TEXT NOT NULL, value TEXT NOT NULL, persistent INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(kind, value)
);
```

- [ ] **Step 3: Implementar política de ciclo de vida**

Compose project name deve ser `jarvis-<projectId normalizado>`; portas vêm de intervalo configurado, são testadas e reservadas dentro da transação; stack saudável do mesmo projeto é reutilizada; recurso temporário vira `released` no terminal do run; volumes persistentes nunca são removidos automaticamente; reconciler libera apenas leases expirados cujos recursos reais não estejam em uso.

- [ ] **Step 4: Rodar banco, regras e commit**

Run: `npm test -- --project banco src/main/resources/resource-lease-repository.int-spec.ts`

Expected: PASS.

Run: `npm test -- --project regras src/main/resources/docker-runtime.spec.ts`

Expected: PASS sem Docker real.

```bash
git add src/main/storage/migrations.ts src/main/resources/resource-lease-repository.ts src/main/resources/resource-lease-repository.int-spec.ts src/main/resources/docker-runtime.ts src/main/resources/docker-runtime.spec.ts
git commit -m "feat: gerencia leases docker e portas"
```

### Task 8: Validação integrada da política

**Files:**
- Modify: `docs/TESTING.md`
- Modify: `reports/TESTS.md`
- Modify: `docs/STATUS.md`
- Modify: `docs/DEVELOPMENT.md`

- [ ] **Step 1: Executar validação completa**

Run: `npm test`

Expected: PASS.

Run: `npm run build && npm run lint`

Expected: exit code 0.

Run: `npm run test:report && npm run test:report:check`

Expected: relatório atual e válido.

- [ ] **Step 2: Registrar evidência e commit**

```bash
git add docs/TESTING.md reports/TESTS.md docs/STATUS.md docs/DEVELOPMENT.md
git commit -m "docs: registra guardrails de contexto e recursos"
```
