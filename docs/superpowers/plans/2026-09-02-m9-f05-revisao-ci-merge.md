# M9-F05 — Revisão, CI e squash merge automático · Plano de implementação

> **Para executores agênticos:** SUB-SKILL OBRIGATÓRIA — usar `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** Fechar o run de uma fatia validando o delta, revisando, confirmando CI no `head SHA` esperado e concluindo o mesmo PR por squash merge automático, sem novo aceite do PI.

**Arquitetura:** Um orquestrador novo (`EntregaService`) costura peças que já existem — `ConstrutorService` (M9-F04), `GitRunner`/`TerminalEngine` (M9-F01), adapter GitHub (M6-F04), `FilaService.concluir` (M9-F02) e `MergePolicyService` (kill-switch). O que não existe entra como capacidade nova de leitura no adapter (ruleset e merge queue), um gerador de workflow para o projeto-alvo e um snapshot persistido do conjunto obrigatório. O merge nunca é deduzido: é confirmado na origem.

**Stack:** TypeScript, Electron (main), SQLite (`better-sqlite3`), Vitest, Playwright.

**SPEC:** `docs/spec/spec-entrega-05-revisao-ci-merge.md` (`aprovada-pi` 2026-08-29, emendada 2026-08-30). Issue [#105](https://github.com/RodReis/rrb-jarvisOS/issues/105).

## Restrições globais

- **`refs #N` sempre; `closes #N` proibido** no corpo de PR gerado pela pipeline (SPEC § Decisões cravadas). Merge integra código, não é aceite.
- **P0/P1 aberto bloqueia o merge**, inclusive com kill-switch ligado (SPEC § Decisões cravadas).
- **Código de saída zero não prova sucesso** (critério 7): todo desfecho externo é confirmado na origem.
- **Lista vazia de checks nunca aprova** — `checksAprovam` já recusa; a F05 não pode introduzir caminho que contorne isso (critério 10).
- **`AWAITING_MERGE` não é falha nem bloqueio** (M9-F02, emenda 2026-08-30).
- Renderer não acessa Node/segredo; IPC mínimo e tipado (CLAUDE.md § Regras técnicas invioláveis).
- Toda entidade persistida carrega `user_id` e `workspace_id`.
- Documentação (`docs/`) entra na mesma entrega.

---

### Task 1: Ler o conjunto obrigatório de checks na origem (`checks.required-for-branch`)

Hoje o adapter **escreve** proteção (`branch.ensure-protection`) e não a **lê**. O critério 11 exige snapshot do conjunto obrigatório observado na origem, com referência e data — sem leitura, o gate compararia com o que nós escrevemos, não com o que vale.

**Arquivos:**
- Modificar: `src/shared/domain/github-automation.ts` (nova operação em `GITHUB_OPERATIONS`, entrada em `GITHUB_CAPABILITIES`, `RequiredChecksInput`, `RequiredChecksNormalizado`, ramo em `validarEntrada`)
- Modificar: `src/main/connectors/github/github-operations.ts` (implementar `getRequiredChecksForBranch`)
- Modificar: `src/main/connectors/github/github-adapter.ts` (despacho da operação nova)
- Testar: `src/shared/domain/github-automation.spec.ts`, `src/main/connectors/github/github-automacao.int-spec.ts`

**Interfaces:**
- Consome: `GithubRest`, `RepoAlvo`, `ResultadoDeOperacao` (já existentes).
- Produz: `getRequiredChecksForBranch(rest, input: RequiredChecksInput): Promise<ResultadoDeOperacao<RequiredChecksNormalizado>>`, com
  `RequiredChecksNormalizado = { readonly branch: string; readonly contexts: readonly string[]; readonly strict: boolean; readonly protegida: boolean; readonly mergeQueueExigida: boolean }`.
  Operação `getRequiredChecks: 'checks.required-for-branch'`, efeito `read`.

- [ ] **Passo 1: Teste de domínio falhando — a operação é declarada e validada**

Em `src/shared/domain/github-automation.spec.ts`:

```ts
it('declara a leitura do conjunto obrigatório como capacidade de leitura', () => {
  const cap = GITHUB_CAPABILITIES.find((c) => c.operation === GITHUB_OPERATIONS.getRequiredChecks)
  expect(cap).toBeDefined()
  expect(cap?.effect).toBe('read')
})

it('recusa entrada sem branch para checks.required-for-branch', () => {
  expect(validarEntrada(GITHUB_OPERATIONS.getRequiredChecks, { owner: 'o', repo: 'r' })).toBeDefined()
  expect(
    validarEntrada(GITHUB_OPERATIONS.getRequiredChecks, { owner: 'o', repo: 'r', branch: 'main' })
  ).toBeUndefined()
})
```

- [ ] **Passo 2: Rodar e ver falhar**

`npx vitest run src/shared/domain/github-automation.spec.ts`
Esperado: FAIL — `GITHUB_OPERATIONS.getRequiredChecks` é `undefined`.

- [ ] **Passo 3: Declarar a operação, a capacidade e a validação**

Em `src/shared/domain/github-automation.ts`, acrescentar `getRequiredChecks: 'checks.required-for-branch'` a `GITHUB_OPERATIONS`; a capacidade correspondente com `effect: 'read'` em `GITHUB_CAPABILITIES`; e:

```ts
export interface RequiredChecksInput extends RepoAlvo {
  readonly branch: string
}

/**
 * O conjunto obrigatório **lido da origem** (critério 11).
 *
 * `protegida: false` não é "sem exigência": é ausência de regra, e o gate a trata como bloqueio
 * explicável, nunca como verde por omissão (critério 10).
 */
export interface RequiredChecksNormalizado {
  readonly branch: string
  readonly contexts: readonly string[]
  readonly strict: boolean
  readonly protegida: boolean
  /** A origem exige merge queue? Nesse caso a pipeline não tenta contorná-la (critério 12). */
  readonly mergeQueueExigida: boolean
}
```

E o ramo em `validarEntrada` exigindo `owner`, `repo` e `branch` não-vazios, no mesmo formato dos ramos vizinhos.

- [ ] **Passo 4: Rodar e ver passar**

`npx vitest run src/shared/domain/github-automation.spec.ts` — PASS.

- [ ] **Passo 5: Teste de integração falhando — 404 de proteção vira `protegida: false`, não erro**

Em `src/main/connectors/github/github-automacao.int-spec.ts`, com o dublê REST que o arquivo já usa (não criar um segundo):

```ts
it('branch sem proteção devolve protegida:false sem contexts', async () => {
  const rest = restFalso({ 'GET /repos/o/r/branches/main/protection': { status: 404, corpo: {} } })
  const r = await getRequiredChecksForBranch(rest, { owner: 'o', repo: 'r', branch: 'main' })
  expect(r.data.protegida).toBe(false)
  expect(r.data.contexts).toEqual([])
})

it('lê contexts e strict quando a branch está protegida', async () => {
  const rest = restFalso({
    'GET /repos/o/r/branches/main/protection': {
      status: 200,
      corpo: { required_status_checks: { strict: true, contexts: ['ci/test'] } }
    }
  })
  const r = await getRequiredChecksForBranch(rest, { owner: 'o', repo: 'r', branch: 'main' })
  expect(r.data.protegida).toBe(true)
  expect(r.data.contexts).toEqual(['ci/test'])
  expect(r.data.strict).toBe(true)
})
```

- [ ] **Passo 6: Rodar e ver falhar**

`npx vitest run src/main/connectors/github/github-automacao.int-spec.ts` — FAIL (função inexistente).

- [ ] **Passo 7: Implementar `getRequiredChecksForBranch`**

Em `src/main/connectors/github/github-operations.ts`:

```ts
/**
 * `checks.required-for-branch` — o conjunto obrigatório **lido da origem** (critério 11).
 *
 * Ao contrário de `branch.ensure-protection`, que escreve, esta função lê: o gate precisa comparar
 * com a regra que vale na origem, não com a que nós escrevemos num run anterior. Um snapshot
 * tirado da nossa própria escrita não detectaria a mudança que o critério existe para pegar.
 *
 * **404 aqui é ausência de proteção, não ambiguidade** — diferente de `significadoDo404`: o
 * endpoint de proteção responde 404 para branch existente e desprotegida, e é o caso normal de
 * repositório recém-criado. Quem decide o que fazer com `protegida: false` é o gate, que a trata
 * como bloqueio explicável (critério 10).
 */
export async function getRequiredChecksForBranch(
  rest: GithubRest,
  input: RequiredChecksInput
): Promise<ResultadoDeOperacao<RequiredChecksNormalizado>> {
  const resposta = await rest.request(
    'GET',
    `/repos/${input.owner}/${input.repo}/branches/${input.branch}/protection`
  )

  if (resposta.status === 404) {
    return {
      data: {
        branch: input.branch,
        contexts: [],
        strict: false,
        protegida: false,
        mergeQueueExigida: false
      },
      externalRef: { id: `${input.owner}/${input.repo}/protection/${input.branch}` },
      criado: false
    }
  }

  const corpo = exigirOk(resposta).corpo as
    | {
        required_status_checks?: { strict?: unknown; contexts?: unknown }
        required_merge_queue?: unknown
      }
    | undefined

  const rsc = corpo?.required_status_checks
  const contexts = Array.isArray(rsc?.contexts)
    ? rsc.contexts.filter((c): c is string => typeof c === 'string')
    : []

  return {
    data: {
      branch: input.branch,
      contexts,
      strict: rsc?.strict === true,
      protegida: true,
      mergeQueueExigida:
        corpo?.required_merge_queue !== undefined && corpo.required_merge_queue !== null
    },
    externalRef: {
      id: `${input.owner}/${input.repo}/protection/${input.branch}`,
      url: `https://github.com/${input.owner}/${input.repo}/settings/branches`
    },
    criado: false
  }
}
```

Despachar a operação nova em `github-adapter.ts`, no mesmo `switch` das demais.

- [ ] **Passo 8: Rodar e ver passar**

`npx vitest run src/main/connectors/github/github-automacao.int-spec.ts src/shared/domain/github-automation.spec.ts` — PASS.

- [ ] **Passo 9: Commit**

```bash
git add src/shared/domain/github-automation.ts src/shared/domain/github-automation.spec.ts src/main/connectors/github/
git commit -m "feat(github): lê o conjunto obrigatório de checks da origem

refs #105"
```

---

### Task 2: Snapshot do ruleset e reconciliação em movimento

O critério 11 exige que o conjunto obrigatório observado seja **persistido com referência e data no início do run**, e que mudança durante o run force novo snapshot e reconciliação. Sem isso, o gate compararia com uma regra que já não vale.

**Arquivos:**
- Criar: `src/shared/domain/ruleset.ts`
- Criar: `src/shared/domain/ruleset.spec.ts`
- Criar: `src/main/pipeline/ruleset-repository.ts`
- Criar: `src/main/pipeline/ruleset-repository.int-spec.ts`
- Modificar: `src/main/storage/migrations.ts` (migration nova, seguindo a numeração vigente)

**Interfaces:**
- Consome: `RequiredChecksNormalizado` (Task 1).
- Produz:
  - `SnapshotDeRuleset = { readonly runId: string; readonly branch: string; readonly contexts: readonly string[]; readonly strict: boolean; readonly protegida: boolean; readonly mergeQueueExigida: boolean; readonly ref: string; readonly observadoEm: string }`
  - `rulesetMudou(anterior: SnapshotDeRuleset, atual: { contexts; strict; protegida; mergeQueueExigida }): boolean`
  - `RulesetRepository` com `registrar(escopo, snapshot): void`, `ultimo(userId, runId): SnapshotDeRuleset | undefined` e `todos(userId, runId): readonly SnapshotDeRuleset[]`

- [ ] **Passo 1: Teste de domínio falhando**

Em `src/shared/domain/ruleset.spec.ts`:

```ts
it('detecta mudança quando um check obrigatório entra', () => {
  const antes = snapshotDe({ contexts: ['ci/test'] })
  expect(rulesetMudou(antes, { ...normalizadoBase, contexts: ['ci/test', 'ci/lint'] })).toBe(true)
})

it('não vê mudança quando só a ordem dos contexts muda', () => {
  const antes = snapshotDe({ contexts: ['ci/test', 'ci/lint'] })
  expect(rulesetMudou(antes, { ...normalizadoBase, contexts: ['ci/lint', 'ci/test'] })).toBe(false)
})

it('trata perda de proteção durante o run como mudança', () => {
  const antes = snapshotDe({ contexts: ['ci/test'], protegida: true })
  expect(rulesetMudou(antes, { ...normalizadoBase, protegida: false, contexts: [] })).toBe(true)
})

it('trata merge queue que passa a ser exigida como mudança', () => {
  const antes = snapshotDe({ contexts: ['ci/test'] })
  expect(rulesetMudou(antes, { ...normalizadoBase, mergeQueueExigida: true })).toBe(true)
})
```

`snapshotDe` monta um `SnapshotDeRuleset` com `protegida: true`, `strict: true`, `mergeQueueExigida: false` e sobrescreve com o parcial; `normalizadoBase` tem `contexts: ['ci/test']`, `strict: true`, `protegida: true`, `mergeQueueExigida: false`.

- [ ] **Passo 2: Rodar e ver falhar**

`npx vitest run src/shared/domain/ruleset.spec.ts` — FAIL (módulo inexistente).

- [ ] **Passo 3: Implementar o domínio**

Em `src/shared/domain/ruleset.ts`:

```ts
/**
 * O snapshot do conjunto obrigatório observado na origem (critério 11 da SPEC-Entrega-05).
 *
 * Existe porque o gate não pode comparar com uma regra que já não vale: entre o início do run e o
 * merge, alguém pode acrescentar um check obrigatório, e mergear contra o snapshot velho entraria
 * na branch-base sem a verificação que a origem passou a exigir.
 */
export interface SnapshotDeRuleset {
  readonly runId: string
  readonly branch: string
  readonly contexts: readonly string[]
  readonly strict: boolean
  readonly protegida: boolean
  readonly mergeQueueExigida: boolean
  /** A referência do recurso na origem, para a auditoria apontar o que foi observado. */
  readonly ref: string
  /** ISO-8601. A data é parte do snapshot: "observado quando" é metade do que ele afirma. */
  readonly observadoEm: string
}

/**
 * A regra da origem mudou desde o snapshot?
 *
 * Compara **conjunto**, não lista: a ordem em que o GitHub devolve `contexts` não é contrato, e
 * tratá-la como mudança forçaria reconciliação a cada consulta, transformando o sinal em ruído.
 */
export function rulesetMudou(
  anterior: SnapshotDeRuleset,
  atual: {
    readonly contexts: readonly string[]
    readonly strict: boolean
    readonly protegida: boolean
    readonly mergeQueueExigida: boolean
  }
): boolean {
  if (anterior.protegida !== atual.protegida) return true
  if (anterior.strict !== atual.strict) return true
  if (anterior.mergeQueueExigida !== atual.mergeQueueExigida) return true

  const a = [...anterior.contexts].sort()
  const b = [...atual.contexts].sort()
  return a.length !== b.length || a.some((c, i) => c !== b[i])
}
```

- [ ] **Passo 4: Rodar e ver passar**

`npx vitest run src/shared/domain/ruleset.spec.ts` — PASS.

- [ ] **Passo 5: Migration e repositório**

Acrescentar migration em `src/main/storage/migrations.ts` (usar o próximo número livre; conferir o `user_version` corrente antes de escrever), com escopo obrigatório:

```sql
CREATE TABLE IF NOT EXISTS ruleset_snapshot (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  branch TEXT NOT NULL,
  contexts TEXT NOT NULL,
  strict INTEGER NOT NULL,
  protegida INTEGER NOT NULL,
  merge_queue_exigida INTEGER NOT NULL,
  ref TEXT NOT NULL,
  observado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ruleset_snapshot_run ON ruleset_snapshot(user_id, run_id, observado_em DESC);
```

`src/main/pipeline/ruleset-repository.ts` no mesmo formato dos repositórios vizinhos (`lease-repository.ts`, `merge-policy-repository.ts`): `registrar` insere linha nova (**append-only** — o histórico de snapshots é a evidência da reconciliação, e um `UPDATE` apagaria a prova de que a regra mudou), `ultimo` lê o mais recente por `observado_em`, `todos` devolve a série do run.

- [ ] **Passo 6: Teste de integração do repositório**

Em `src/main/pipeline/ruleset-repository.int-spec.ts`, com o banco real do helper existente:

```ts
it('guarda o snapshot e devolve o mais recente do run', () => {
  repo.registrar(escopo, { ...base, contexts: ['ci/test'], observadoEm: '2026-09-02T10:00:00.000Z' })
  repo.registrar(escopo, {
    ...base,
    contexts: ['ci/test', 'ci/lint'],
    observadoEm: '2026-09-02T10:05:00.000Z'
  })
  expect(repo.ultimo(escopo.userId, base.runId)?.contexts).toEqual(['ci/test', 'ci/lint'])
  expect(repo.todos(escopo.userId, base.runId)).toHaveLength(2)
})

it('não mistura snapshot de outro usuário', () => {
  repo.registrar({ ...escopo, userId: 'outro' }, base)
  expect(repo.ultimo(escopo.userId, base.runId)).toBeUndefined()
})
```

- [ ] **Passo 7: Rodar e ver passar**

`npx vitest run src/main/pipeline/ruleset-repository.int-spec.ts` — PASS.

- [ ] **Passo 8: Commit**

```bash
git add src/shared/domain/ruleset.ts src/shared/domain/ruleset.spec.ts src/main/pipeline/ruleset-repository.ts src/main/pipeline/ruleset-repository.int-spec.ts src/main/storage/migrations.ts
git commit -m "feat(pipeline): snapshot do ruleset da origem, append-only por run

refs #105"
```

---

### Task 3: Gate de merge — o que a origem exige, no `head SHA` esperado

Costura `checksAprovam` (já existente) com o snapshot: decide `pode-mergear`, `aguardando`, `bloqueado-externo` ou `stale`. Função pura — é o que permite provar os critérios 2, 3, 4, 10, 11 e 12 sem rede.

**Arquivos:**
- Criar: `src/shared/domain/gate-de-merge.ts`
- Criar: `src/shared/domain/gate-de-merge.spec.ts`

**Interfaces:**
- Consome: `CheckNormalizado`, `checksAprovam` (`github-automation.ts`), `SnapshotDeRuleset` (Task 2).
- Produz:

```ts
export interface EntradaDoGate {
  readonly headShaEsperado: string
  readonly headShaNaOrigem: string
  readonly checks: readonly CheckNormalizado[]
  readonly snapshot: SnapshotDeRuleset
  readonly achadosAbertos: readonly { readonly severidade: 'P0' | 'P1' | 'P2' | 'P3' }[]
}

export type VeredictoDoGate =
  | { readonly reason: 'pode-mergear' }
  | { readonly reason: 'aguardando'; readonly pendentes: number; readonly mensagem: string }
  | { readonly reason: 'stale'; readonly mensagem: string }
  | { readonly reason: 'bloqueado-externo'; readonly acao: string; readonly mensagem: string }

export function avaliarGateDeMerge(entrada: EntradaDoGate): VeredictoDoGate
```

- [ ] **Passo 1: Testes falhando — um por critério**

Em `src/shared/domain/gate-de-merge.spec.ts`. `base` monta `headShaEsperado: 'aaa'`, `headShaNaOrigem: 'aaa'`, um check `ci/test` verde no `aaa`, snapshot com `protegida: true`, `contexts: ['ci/test']`, `strict: true`, `mergeQueueExigida: false`, e `achadosAbertos: []`.

```ts
it('head divergente na origem é stale e não mergeia (critério 4)', () => {
  expect(avaliarGateDeMerge({ ...base, headShaNaOrigem: 'bbb' }).reason).toBe('stale')
})

it('lista vazia de checks nunca aprova (critério 10)', () => {
  const v = avaliarGateDeMerge({ ...base, checks: [], snapshot: { ...base.snapshot, contexts: [], protegida: false } })
  expect(v.reason).toBe('bloqueado-externo')
  expect(v).toMatchObject({ acao: expect.stringContaining('Actions') })
})

it('check verde de outro SHA não conta (critério 3)', () => {
  const v = avaliarGateDeMerge({
    ...base,
    checks: [{ nome: 'ci/test', headSha: 'antigo', status: 'completed', conclusao: 'success' }]
  })
  expect(v.reason).toBe('bloqueado-externo')
})

it('check obrigatório do snapshot ausente nos checks do head bloqueia (critério 11)', () => {
  const v = avaliarGateDeMerge({
    ...base,
    snapshot: { ...base.snapshot, contexts: ['ci/test', 'ci/lint'] },
    checks: [{ nome: 'ci/test', headSha: 'aaa', status: 'completed', conclusao: 'success' }]
  })
  expect(v.reason).toBe('bloqueado-externo')
  expect(v).toMatchObject({ mensagem: expect.stringContaining('ci/lint') })
})

it('skipped só passa quando não é obrigatório na origem (critério 11)', () => {
  const skipped = { nome: 'ci/lint', headSha: 'aaa', status: 'completed', conclusao: 'skipped' } as const
  const verde = { nome: 'ci/test', headSha: 'aaa', status: 'completed', conclusao: 'success' } as const

  expect(
    avaliarGateDeMerge({
      ...base,
      snapshot: { ...base.snapshot, contexts: ['ci/test'] },
      checks: [verde, skipped]
    }).reason
  ).toBe('pode-mergear')

  expect(
    avaliarGateDeMerge({
      ...base,
      snapshot: { ...base.snapshot, contexts: ['ci/test', 'ci/lint'] },
      checks: [verde, skipped]
    }).reason
  ).toBe('bloqueado-externo')
})

it('merge queue exigida termina em bloqueio externo, não em contorno (critério 12)', () => {
  const v = avaliarGateDeMerge({ ...base, snapshot: { ...base.snapshot, mergeQueueExigida: true } })
  expect(v.reason).toBe('bloqueado-externo')
  expect(v).toMatchObject({ acao: expect.stringContaining('merge queue') })
})

it('branch sem proteção não é verde por ausência (critério 10)', () => {
  const v = avaliarGateDeMerge({
    ...base,
    snapshot: { ...base.snapshot, protegida: false, contexts: [] }
  })
  expect(v.reason).toBe('bloqueado-externo')
})

it('P1 aberto bloqueia mesmo com CI verde (critério 2)', () => {
  expect(avaliarGateDeMerge({ ...base, achadosAbertos: [{ severidade: 'P1' }] }).reason).toBe(
    'bloqueado-externo'
  )
})

it('P2 aberto não bloqueia (REVIEW.md § Severidade baseline)', () => {
  expect(avaliarGateDeMerge({ ...base, achadosAbertos: [{ severidade: 'P2' }] }).reason).toBe(
    'pode-mergear'
  )
})

it('check obrigatório em andamento no head é espera, não bloqueio', () => {
  const v = avaliarGateDeMerge({
    ...base,
    checks: [{ nome: 'ci/test', headSha: 'aaa', status: 'in_progress' }]
  })
  expect(v.reason).toBe('aguardando')
})
```

- [ ] **Passo 2: Rodar e ver falhar**

`npx vitest run src/shared/domain/gate-de-merge.spec.ts` — FAIL (módulo inexistente).

- [ ] **Passo 3: Implementar o gate**

Em `src/shared/domain/gate-de-merge.ts`, na ordem: stale → P0/P1 → merge queue → sem proteção → obrigatórios ausentes → `checksAprovam` → pendentes.

A ordem importa e é deliberada: **stale primeiro** porque head divergente invalida toda avaliação seguinte (os checks pertencem a outro commit); **P0/P1 antes do resto** porque bloqueio de revisão não depende de estado externo; **merge queue antes dos obrigatórios** porque a pipeline não a contorna nem com os checks verdes.

```ts
export function avaliarGateDeMerge(entrada: EntradaDoGate): VeredictoDoGate {
  if (entrada.headShaNaOrigem !== entrada.headShaEsperado) {
    return {
      reason: 'stale',
      mensagem:
        `O head do PR na origem (${entrada.headShaNaOrigem}) não é o esperado ` +
        `(${entrada.headShaEsperado}). Reconciliar antes de mergear.`
    }
  }

  const bloqueantes = entrada.achadosAbertos.filter(
    (a) => a.severidade === 'P0' || a.severidade === 'P1'
  )
  if (bloqueantes.length > 0) {
    return {
      reason: 'bloqueado-externo',
      acao: 'Corrigir os achados P0/P1 e revalidar no mesmo PR.',
      mensagem: `${bloqueantes.length} achado(s) P0/P1 aberto(s) impedem o merge.`
    }
  }

  if (entrada.snapshot.mergeQueueExigida) {
    return {
      reason: 'bloqueado-externo',
      acao: 'Mergear pela merge queue da origem; a pipeline não a contorna.',
      mensagem: 'A branch-base exige merge queue, fora do escopo do MVP-009.'
    }
  }

  if (!entrada.snapshot.protegida || entrada.snapshot.contexts.length === 0) {
    return {
      reason: 'bloqueado-externo',
      acao: 'Configurar/liberar Actions e exigir os checks na proteção da branch-base.',
      mensagem: 'Sem check obrigatório na origem não há verde: ausência de regra não aprova.'
    }
  }

  const doHead = entrada.checks.filter((c) => c.headSha === entrada.headShaEsperado)
  const satisfeitos = new Set(
    doHead.filter((c) => c.status === 'completed' && c.conclusao === 'success').map((c) => c.nome)
  )
  const faltando = entrada.snapshot.contexts.filter((nome) => !satisfeitos.has(nome))

  if (faltando.length > 0) {
    const emAndamento = doHead.filter(
      (c) => faltando.includes(c.nome) && c.status !== 'completed'
    ).length

    if (emAndamento > 0) {
      return {
        reason: 'aguardando',
        pendentes: emAndamento,
        mensagem: `${emAndamento} check(s) obrigatório(s) ainda correndo no head esperado.`
      }
    }

    return {
      reason: 'bloqueado-externo',
      acao: 'Investigar os checks obrigatórios que não concluíram com sucesso.',
      mensagem: `Checks obrigatórios sem sucesso no head esperado: ${faltando.join(', ')}.`
    }
  }

  const agregado = checksAprovam(entrada.checks, entrada.headShaEsperado)
  if (agregado.pendentes > 0) {
    return {
      reason: 'aguardando',
      pendentes: agregado.pendentes,
      mensagem: `${agregado.pendentes} check(s) ainda correndo no head esperado.`
    }
  }

  return { reason: 'pode-mergear' }
}
```

**Nota sobre `skipped`:** `checksAprovam` o considera não-falho, o que continua correto para check **não obrigatório**. A regra do critério 11 — *"só passa quando a própria regra da origem o considerar satisfatório"* — é imposta aqui, pelo conjunto `satisfeitos`, que só admite `success`: um `skipped` de check obrigatório cai em `faltando` e bloqueia. **Não alterar `checksAprovam`**, que tem outros chamadores.

- [ ] **Passo 4: Rodar e ver passar**

`npx vitest run src/shared/domain/gate-de-merge.spec.ts` — PASS (10 testes).

- [ ] **Passo 5: Contrafactual — provar que o gate é o que bloqueia**

Comentar a checagem de `faltando` e rodar de novo: pelo menos os testes de obrigatório ausente e de `skipped` obrigatório devem reprovar. Restaurar. Registrar o número no relatório da entrega.

- [ ] **Passo 6: Commit**

```bash
git add src/shared/domain/gate-de-merge.ts src/shared/domain/gate-de-merge.spec.ts
git commit -m "feat(pipeline): gate de merge sobre o conjunto obrigatório da origem

refs #105"
```

---

### Task 4: Workflow de CI gerado no projeto-alvo

Critério 9. O projeto do MVP-008 não nasce com CI, e sem check configurado nenhum run chega a `MERGED`. O arquivo é criado **uma vez, no primeiro run**, dentro do mesmo PR da fatia, e só reescrito quando os comandos declarados mudam — nunca por cosmética.

**Arquivos:**
- Criar: `src/shared/domain/ci-workflow.ts`
- Criar: `src/shared/domain/ci-workflow.spec.ts`
- Modificar: `src/main/pipeline/construtor-service.ts` (mover `ComandosDeValidacao` e reexportar)

**Interfaces:**
- Consome: nada de tarefas anteriores.
- Produz: `CAMINHO_DO_WORKFLOW`, `NOME_DO_JOB_DE_CI`, `ComandosDeValidacao`, `gerarWorkflowDeCi(comandos): string`, `precisaReescreverWorkflow(atual: string | undefined, comandos): boolean`.

- [ ] **Passo 1: Testes falhando**

Em `src/shared/domain/ci-workflow.spec.ts`:

```ts
const comandos = {
  test: ['npm', 'test'],
  lint: ['npm', 'run', 'lint'],
  typecheck: ['npm', 'run', 'typecheck'],
  build: ['npm', 'run', 'build']
} as const

it('gera workflow com os quatro comandos declarados', () => {
  const yml = gerarWorkflowDeCi(comandos)
  expect(yml).toContain('run: npm test')
  expect(yml).toContain('run: npm run lint')
  expect(yml).toContain('run: npm run typecheck')
  expect(yml).toContain('run: npm run build')
  expect(yml).toContain(`name: ${NOME_DO_JOB_DE_CI}`)
})

it('é determinístico: mesmos comandos geram o mesmo arquivo', () => {
  expect(gerarWorkflowDeCi(comandos)).toBe(gerarWorkflowDeCi({ ...comandos }))
})

it('não reescreve quando o arquivo já corresponde aos comandos', () => {
  expect(precisaReescreverWorkflow(gerarWorkflowDeCi(comandos), comandos)).toBe(false)
})

it('reescreve quando um comando declarado muda', () => {
  const atual = gerarWorkflowDeCi(comandos)
  expect(precisaReescreverWorkflow(atual, { ...comandos, test: ['npm', 'run', 'test:ci'] })).toBe(true)
})

it('cria quando o arquivo não existe', () => {
  expect(precisaReescreverWorkflow(undefined, comandos)).toBe(true)
})

it('não reescreve por diferença cosmética fora dos comandos', () => {
  const atual = `${gerarWorkflowDeCi(comandos)}\n# comentário de alguém\n`
  expect(precisaReescreverWorkflow(atual, comandos)).toBe(false)
})
```

- [ ] **Passo 2: Rodar e ver falhar**

`npx vitest run src/shared/domain/ci-workflow.spec.ts` — FAIL.

- [ ] **Passo 3: Implementar**

Em `src/shared/domain/ci-workflow.ts`:

```ts
export const CAMINHO_DO_WORKFLOW = '.github/workflows/ci.yml'
export const NOME_DO_JOB_DE_CI = 'validacao'

export interface ComandosDeValidacao {
  readonly test: readonly string[]
  readonly lint: readonly string[]
  readonly typecheck: readonly string[]
  readonly build: readonly string[]
}

/**
 * O workflow de CI do projeto-alvo (critério 9).
 *
 * Os comandos são os **declarados no pacote** do projeto — os mesmos que o executor roda no
 * container. Gerar comandos diferentes faria o verde da origem afirmar algo que a validação local
 * nunca verificou, que é exatamente a equivalência que a emenda 1 de 2026-08-30 recusou.
 *
 * O nome do job é fixo e conhecido porque é ele que vira o *context* obrigatório na proteção da
 * branch-base: um nome gerado a cada run produziria um check novo que a proteção não exige.
 */
export function gerarWorkflowDeCi(comandos: ComandosDeValidacao): string {
  const passo = (nome: string, cmd: readonly string[]): string =>
    `      - name: ${nome}\n        run: ${cmd.join(' ')}\n`

  return (
    `name: ${NOME_DO_JOB_DE_CI}\n` +
    `\n` +
    `on:\n` +
    `  pull_request:\n` +
    `  push:\n` +
    `\n` +
    `jobs:\n` +
    `  ${NOME_DO_JOB_DE_CI}:\n` +
    `    runs-on: ubuntu-latest\n` +
    `    steps:\n` +
    `      - uses: actions/checkout@v4\n` +
    `      - uses: actions/setup-node@v4\n` +
    `        with:\n` +
    `          node-version: '22'\n` +
    `      - name: install\n` +
    `        run: npm ci\n` +
    passo('lint', comandos.lint) +
    passo('typecheck', comandos.typecheck) +
    passo('test', comandos.test) +
    passo('build', comandos.build)
  )
}

/**
 * O arquivo precisa ser (re)escrito?
 *
 * Compara **os comandos**, não o texto: um arquivo que alguém comentou ou reindentou continua
 * declarando os mesmos comandos, e reescrevê-lo apagaria a edição de um humano por cosmética —
 * o que a spec proíbe em letra.
 */
export function precisaReescreverWorkflow(
  atual: string | undefined,
  comandos: ComandosDeValidacao
): boolean {
  if (atual === undefined) return true
  return [comandos.lint, comandos.typecheck, comandos.test, comandos.build].some(
    (cmd) => !atual.includes(`run: ${cmd.join(' ')}`)
  )
}
```

`ComandosDeValidacao` mora hoje em `src/main/pipeline/construtor-service.ts`. Movê-la para cá e reexportá-la de lá (`export type { ComandosDeValidacao } from '@shared/domain/ci-workflow'`) — `src/shared` não pode importar de `src/main`, e o typecheck cobra isso. Ajustar os imports que quebrarem.

- [ ] **Passo 4: Rodar e ver passar**

`npx vitest run src/shared/domain/ci-workflow.spec.ts && npm run typecheck` — PASS.

- [ ] **Passo 5: Commit**

```bash
git add src/shared/domain/ci-workflow.ts src/shared/domain/ci-workflow.spec.ts src/main/pipeline/construtor-service.ts
git commit -m "feat(pipeline): gera o workflow de CI do projeto-alvo a partir dos comandos declarados

refs #105"
```

---

### Task 5: `EntregaService` — a orquestração da fatia até o merge

O orquestrador que a fatia entrega. Consome tudo das tarefas anteriores e as peças que já existem.

**Arquivos:**
- Criar: `src/main/pipeline/entrega-service.ts`
- Criar: `src/main/pipeline/entrega-service.int-spec.ts`

**Interfaces:**
- Consome: `ConstrutorService.construir` (M9-F04), `GitRunner` (M9-F01), adapter GitHub via `ConnectorService`, `avaliarGateDeMerge` (Task 3), `RulesetRepository`/`rulesetMudou` (Task 2), `gerarWorkflowDeCi`/`precisaReescreverWorkflow`/`CAMINHO_DO_WORKFLOW` (Task 4), `MergePolicyService.autonomoLigado`, `FilaService.concluir`.
- Produz:

```ts
export interface PedidoDeEntrega {
  readonly runId: string
  readonly projectId: string
  readonly workspaceId: WorkspaceId
  readonly sandbox: SandboxPreparado
  readonly alvo: RepoAlvo & { readonly branchBase: string; readonly branchDaFatia: string }
  readonly issue: number
  readonly promptInicial: string
  readonly comandosDeValidacao: ComandosDeValidacao
  readonly signal?: AbortSignal
}

export interface ResultadoDaEntrega {
  readonly estadoFinal: 'MERGED' | 'AWAITING_MERGE' | 'BLOCKED'
  readonly pullRequest?: number
  readonly mergeSha?: string
  readonly bloqueio?: { readonly causa: string; readonly acao: string; readonly mensagem: string }
}

export class EntregaService {
  entregar(pedido: PedidoDeEntrega): Promise<ResultadoDaEntrega>
}
```

- [ ] **Passo 1: Testes de integração falhando — um por critério de aceite**

Em `src/main/pipeline/entrega-service.int-spec.ts`, com dublê do adapter GitHub (mesmo padrão de `construtor-service.int-spec.ts`) e Git real para o escopo:

```ts
it('kill-switch desligado termina em AWAITING_MERGE sem mergear (critério 8)', async () => {
  policy.definir(projectId, workspaceId, false)
  const r = await service.entregar(pedido)
  expect(r.estadoFinal).toBe('AWAITING_MERGE')
  expect(github.chamadas('pr.squash-merge')).toHaveLength(0)
})

it('kill-switch ligado mergeia e confirma o SHA na origem (critérios 6 e 8)', async () => {
  const r = await service.entregar(pedido)
  expect(r.estadoFinal).toBe('MERGED')
  expect(r.mergeSha).toBe(github.mergeShaConfirmado)
  expect(github.chamadas('pr.merge-state').length).toBeGreaterThan(0)
})

it('merge que responde sem confirmação na origem não vira MERGED (critério 7)', async () => {
  github.responderMergeSemConfirmacao()
  const r = await service.entregar(pedido)
  expect(r.estadoFinal).not.toBe('MERGED')
})

it('projeto sem CI recebe o workflow no primeiro PR e o run seguinte não o reescreve (critério 9)', async () => {
  await service.entregar(pedido)
  const caminho = join(sandbox.worktree, CAMINHO_DO_WORKFLOW)
  expect(existsSync(caminho)).toBe(true)
  const antes = readFileSync(caminho, 'utf8')
  await service.entregar(pedido)
  expect(readFileSync(caminho, 'utf8')).toBe(antes)
})

it('lista vazia de checks termina em bloqueio explicável, nunca em MERGED (critério 10)', async () => {
  github.semChecks()
  const r = await service.entregar(pedido)
  expect(r.estadoFinal).toBe('BLOCKED')
  expect(r.bloqueio?.acao).toContain('Actions')
})

it('ruleset que muda durante o run força novo snapshot e reconciliação (critério 11)', async () => {
  github.mudarRulesetDepoisDoPrimeiroSnapshot(['ci/test', 'ci/lint'])
  const r = await service.entregar(pedido)
  expect(ruleset.todos(userId, pedido.runId).length).toBeGreaterThan(1)
  expect(r.estadoFinal).not.toBe('MERGED')
})

it('merge queue exigida termina em AWAITING_MERGE sem tentar mergear (critério 12)', async () => {
  github.exigirMergeQueue()
  const r = await service.entregar(pedido)
  expect(r.estadoFinal).toBe('AWAITING_MERGE')
  expect(github.chamadas('pr.squash-merge')).toHaveLength(0)
})

it('stale SHA impede o merge e força reconciliação (critério 4)', async () => {
  github.avancarHeadDepoisDoPush()
  const r = await service.entregar(pedido)
  expect(r.estadoFinal).not.toBe('MERGED')
  expect(github.chamadas('pr.squash-merge')).toHaveLength(0)
})

it('falha corrigível mantém o mesmo PR (critério 5)', async () => {
  construtor.falharPrimeiraTentativaComErroCorrigivel()
  await service.entregar(pedido)
  expect(new Set(github.chamadas('pr.ensure').map((c) => c.head)).size).toBe(1)
})

it('diff fora da SPEC não chega ao push (critério 1)', async () => {
  construtor.escreverForaDoEscopo()
  const r = await service.entregar(pedido)
  expect(r.estadoFinal).toBe('BLOCKED')
  expect(git.pushes()).toHaveLength(0)
})

it('P1 aberto impede o merge mesmo com CI verde (critério 2)', async () => {
  revisor.devolverAchado('P1')
  const r = await service.entregar(pedido)
  expect(r.estadoFinal).toBe('BLOCKED')
  expect(github.chamadas('pr.squash-merge')).toHaveLength(0)
})

it('o corpo do PR usa refs e nunca closes (SPEC § Decisões cravadas)', async () => {
  await service.entregar(pedido)
  const corpo = github.chamadas('pr.ensure')[0].body as string
  expect(corpo).toContain('refs #')
  expect(corpo.toLowerCase()).not.toMatch(/\b(closes|fixes|resolves)\s+#/)
})

it('docs do projeto-alvo entram no PR, antes do merge (critério 13)', async () => {
  await service.entregar(pedido)
  expect(git.arquivosDoUltimoPush()).toContain('docs/STATUS.md')
  expect(git.commitsDiretosNaBase()).toHaveLength(0)
})
```

- [ ] **Passo 2: Rodar e ver falhar**

`npx vitest run src/main/pipeline/entrega-service.int-spec.ts` — FAIL (módulo inexistente).

- [ ] **Passo 3: Implementar `EntregaService`**

Em `src/main/pipeline/entrega-service.ts`, a sequência da SPEC § Sequência:

1. **Escopo e workflow.** Ler `CAMINHO_DO_WORKFLOW` do worktree; se `precisaReescreverWorkflow`, escrever `gerarWorkflowDeCi(comandos)` (critério 9).
2. **Construção.** `construtor.construir(...)`; `BLOCKED` termina aqui com o bloqueio do construtor (critérios 1 e 5).
3. **Revisão.** Invocar o revisor no container; P0/P1 aberto vira `achadosAbertos` que o gate bloqueia (critério 2). Correção elegível volta ao passo 2 **no mesmo PR** (critério 5).
4. **Push e PR.** `git.push` do branch da fatia; `ensurePullRequest` com corpo `refs #N` — **nunca** `closes` (§ Decisões cravadas). Docs do projeto-alvo entram nos commits **antes** do push (critério 13).
5. **Snapshot do ruleset.** `getRequiredChecksForBranch` da branch-base → `ruleset.registrar` com data e ref (critério 11).
6. **Head na origem.** `commit.sha-for-ref` do branch da fatia → `headShaNaOrigem`.
7. **Checks.** `checks.for-head` no head esperado.
8. **Gate.** `avaliarGateDeMerge`. `aguardando` → repolling com teto; `stale` → reconciliar (volta ao 4); `bloqueado-externo` → `BLOCKED` com ação.
9. **Reconciliação do ruleset.** Antes de mergear, reler o ruleset; `rulesetMudou` → novo snapshot e volta ao 7 (critério 11).
10. **Kill-switch.** `mergePolicy.autonomoLigado(projectId)` falso → `fila.concluir` (`AWAITING_MERGE`) sem mergear (critério 8). Merge queue exigida também termina aqui (critério 12).
11. **Merge.** `pr.squash-merge` com `expectedHeadSha`.
12. **Confirmação.** `pr.merge-state`; só com `merged: true` e `mergeSha` presente o run vira `MERGED` (critérios 6 e 7). Sem confirmação, `AWAITING_MERGE` com a causa registrada — nunca `MERGED` por código de saída.

Cada efeito externo passa pelo `EffectJournal` (intenção antes do I/O, confirmação depois — regra da #209/PR #227). Ação sensível gera `AuditEvent` antes e depois.

- [ ] **Passo 4: Rodar e ver passar**

`npx vitest run src/main/pipeline/entrega-service.int-spec.ts` — PASS (13 testes).

- [ ] **Passo 5: Commit**

```bash
git add src/main/pipeline/entrega-service.ts src/main/pipeline/entrega-service.int-spec.ts
git commit -m "feat(pipeline): EntregaService orquestra revisão, CI e squash merge

refs #105"
```

---

### Task 6: Ligar ao boot e fechar a correlação `runId`/`tentativa`

A pendência que a M9-F04 declarou: `ConstrutorService` não tem consumidor, e o `ExecutorProxy` recebe `contexto: () => undefined` / `contextPackId: () => undefined`, o que faz o gate de ContextPack em `call-provider.ts` recusar **toda** chamada do executor. A rota não opera em produção até esta tarefa.

**Arquivos:**
- Modificar: `src/main/index.ts` (composição)
- Modificar: `src/main/pipeline/executor-proxy.ts` (se a fonte de run corrente exigir ajuste de contrato)
- Testar: `src/main/pipeline/executor-proxy.int-spec.ts`

**Interfaces:**
- Consome: `EntregaService` (Task 5), `ConstrutorService`, `ExecutorProxy`.
- Produz: `EntregaService.runCorrente(): { runId: string; tentativa: number; contextPackId?: string } | undefined`, que o boot passa ao `ExecutorProxy` no lugar dos `() => undefined`.

- [ ] **Passo 1: Teste falhando — a correlação chega ao proxy**

Em `src/main/pipeline/executor-proxy.int-spec.ts`:

```ts
it('propaga runId e tentativa do run corrente para a chamada de IA', async () => {
  entrega.definirRunCorrente({ runId: 'run-1', tentativa: 2, contextPackId: 'pack-1' })
  await proxy.chamar(pedido)
  expect(ai.ultimaChamada).toMatchObject({
    contextPackId: 'pack-1',
    ctx: { runId: 'run-1', tentativa: 2 }
  })
})

it('sem run corrente, a chamada do executor é recusada em vez de sair sem contexto', async () => {
  entrega.limparRunCorrente()
  await expect(proxy.chamar(pedido)).rejects.toThrow(/contexto/i)
})
```

- [ ] **Passo 2: Rodar e ver falhar**

`npx vitest run src/main/pipeline/executor-proxy.int-spec.ts` — FAIL.

- [ ] **Passo 3: Implementar**

`EntregaService` mantém o run corrente (`runId` e tentativa em curso) e expõe leitura; o boot passa essas funções ao `ExecutorProxy` no lugar dos `() => undefined`. Atualizar o comentário do código que declarava o limite — a afirmação deixa de valer nesta fatia. Corrigir também a nota correspondente em `docs/DEVELOPMENT.md` § Fatia 04.

- [ ] **Passo 4: Rodar e ver passar**

`npx vitest run src/main/pipeline/executor-proxy.int-spec.ts` — PASS.

- [ ] **Passo 5: Commit**

```bash
git add src/main/index.ts src/main/pipeline/executor-proxy.ts src/main/pipeline/executor-proxy.int-spec.ts docs/DEVELOPMENT.md
git commit -m "feat(pipeline): liga o construtor ao boot e fecha a correlação runId/tentativa

refs #105"
```

---

### Task 7: Smoke real e evidência

A lição registrada: dublê responde instantâneo e consistente; serviço real não, e a suíte fica verde sobre um defeito. O smoke do GitHub real é exigido pela SPEC § Testes e evidência.

**Arquivos:**
- Criar: `src/main/pipeline/entrega-service.smoke.int-spec.ts` (opt-in por env, `it.skipIf`, como o da M9-F04)
- Modificar: `docs/DEVELOPMENT.md`, `docs/STATUS.md`
- Regenerar: `reports/TESTS.md` (pelo gerador; nunca à mão)

- [ ] **Passo 1: Escrever o smoke contra repositório descartável**

Cobrir: PR criado com `refs`, workflow gerado disparando check real, gate esperando o check concluir, squash merge e `mergeSha` confirmado na origem. Marcar `not_run` com a razão declarada quando as credenciais não estiverem presentes — `not_run` declarado não é `pass`.

- [ ] **Passo 2: Rodar o piso de validação**

```bash
npm run lint && npm run typecheck && npm test
```

- [ ] **Passo 3: Regenerar o relatório de testes**

Pelo gerador descrito em `docs/TESTING.md`; nunca editar `reports/TESTS.md` à mão.

- [ ] **Passo 4: Atualizar `docs/`**

`docs/DEVELOPMENT.md` (seção da Fatia 05 com o entregue, decisões técnicas e limites declarados), `docs/STATUS.md` (MVP-009 em 5/6) e o registro de entregas.

- [ ] **Passo 5: Commit e PR**

```bash
git add -A
git commit -m "test(pipeline): smoke real da entrega e evidência da M9-F05

refs #105"
git push -u origin feat/m9-f05-revisao-ci-merge
gh pr create --title "[MVP9][SPEC-Entrega-05][F05] Revisão, CI e squash merge automático" --body "…refs #105"
```

Aguardar com `gh pr checks <n> --watch` — nunca afirmar CI verde sem consultar.

---

## Auto-revisão

**Cobertura dos 13 critérios:**

| Critério | Tarefa |
|---|---|
| 1 · diff fora da SPEC não chega ao push | 5 (teste dedicado; `verificarEscopo` da M9-F04) |
| 2 · P0/P1 impede merge | 3 (gate) + 5 (integração) |
| 3 · CI verde pertence ao head SHA | 3 (`satisfeitos` filtra por `headSha`) |
| 4 · stale SHA impede merge | 3 + 5 |
| 5 · falha corrigível mantém o mesmo PR | 5 |
| 6 · `mergeSha` confirmado na origem | 5 (passo 12) |
| 7 · código zero não prova sucesso | 5 (teste do merge sem confirmação) |
| 8 · kill-switch nos dois caminhos | 5 (dois testes) |
| 9 · workflow gerado, não reescrito | 4 + 5 |
| 10 · sem check não há merge | 3 + 5 |
| 11 · ruleset em movimento; `neutral`/`skipped` | 1 + 2 + 3 + 5 |
| 12 · merge queue → `AWAITING_MERGE` | 1 (`mergeQueueExigida`) + 3 + 5 |
| 13 · docs do projeto no mesmo PR | 5 (teste dedicado) |

**Pendência herdada da M9-F04:** correlação `runId`/`tentativa` e ligação do `ConstrutorService` ao boot — Task 6.

## Perguntas para o PI

Não bloqueiam o início (Tasks 1–4 independem delas); pesam na Task 5.

1. **Fail-open do `verificarEscopo`.** A M9-F04 deixou `if (!status.ok) return { ok: true }` pendente de decisão sua. O critério 1 desta fatia (*"diff fora da SPEC não chega ao push"*) depende dele: com o `git status` do container falhando, o escopo não é verificado e o push sai. O fail-closed equivalente bloquearia com causa `externo`. Decisão do PI.
2. **Teto de espera do CI.** A SPEC não fixa quanto tempo o gate aguarda checks pendentes antes de desistir. Proposta: teto configurável com padrão conservador, terminando em `AWAITING_MERGE` (não `BLOCKED`) ao estourar, já que "ainda correndo" não é falha. Confirmar.
3. **Nome do check obrigatório.** O workflow gerado nomeia o job `validacao`, e é esse nome que precisa entrar nos `contexts` da proteção da branch-base para o gate encontrá-lo. Se o projeto-alvo já tiver proteção exigindo outros nomes, a pipeline não os inventa — termina em bloqueio explicável. Confirmar que é o comportamento desejado.
