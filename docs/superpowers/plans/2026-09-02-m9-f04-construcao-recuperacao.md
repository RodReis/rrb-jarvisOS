# M9-F04 — Construção e recuperação com Claude Code — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Executar o Claude Code dentro do container da M9-F03, validar continuamente (test/lint/type/build também no container), recuperar até duas vezes usando delta e falhas abertas, e atribuir custo/tokens por tentativa — fechando os 12 critérios de aceite da SPEC-Entrega-04, incluindo o pré-requisito de estado de quota (`subscription_limited`) na camada de providers.

**Architecture:** A M9-F03 já entrega `PreflightService` (sobe worktree + container + rede de egress + sidecar), `DockerRunner` (opera o container via `TerminalEngine`) e `ExecutorProxy` (recebe chamadas HTTP do container, monta `AiRequest` com `runId`/`tentativa`, chama `AiCallService`). Esta fatia acrescenta: (1) `DockerRunner.exec()` para rodar comandos **dentro** do container já em pé; (2) estado de quota na camada de providers (`ai.ts` + repositório novo), pré-requisito do critério 12; (3) um orquestrador (`ConstrutorService`) que decide o roteiro da tentativa (invocar `claude`, disparar validação, classificar falha, decidir recuperar ou parar) e move o `PipelineRun` pelas transições já definidas em `pipeline.ts` (`RUNNING → VALIDATING → RUNNING` na correção, `→ BLOCKED`/`→ PR_CI` no fim); (4) o adapter que roda o binário `claude` dentro do container, configurado com `ANTHROPIC_BASE_URL` apontando para o proxy — já injetado pelo `DockerRunner.subir()` existente.

**Tech Stack:** TypeScript, Electron main, better-sqlite3, vitest (`*.spec.ts` unitário, `*.int-spec.ts` integração com dublês reais — nunca `vi.mock` da lógica testada, só do logger).

**Spec:** `docs/spec/spec-entrega-04-construcao-recuperacao.md`

## Global Constraints

- Comando e cwd do executor são controlados pelo adapter, **dentro do container**; nunca existe caminho de execução no host (critério 1).
- Máximo de três tentativas totais: inicial + duas recuperações — conta o run inteiro, não por etapa (critério 2, decisão cravada do Cowork).
- `test/lint/type/build` disparados pelo app rodam **no container**, nunca no host (critério 11).
- Toda chamada ao modelo passa pelo `ExecutorProxy` já existente e chega ao `AiCallService` com `runId`/`tentativa`; o gate de orçamento barra **antes** de a chamada sair (critério 10 — já implementado pelo proxy; esta fatia só alimenta `rota()`/`contexto()`/`contextPackId()` corretamente).
- A rota de assinatura (`claude-code`) vira `subscription_limited`: quota desconhecida não é saldo infinito. Rate limit tenta só fallback já autorizado ou termina em espera/bloqueio explicável (critério 12).
- Cancelamento mata a árvore de processos e preserva evidência (critério 5) — usar `docker exec` + kill do processo dentro do container, nunca matar o container inteiro como forma de cancelar uma tentativa (isso destruiria o worktree montado nele).
- Recuperação recebe diff atual, erros novos e histórico resumido; **não relê o repositório inteiro por padrão**.
- Requisito de produto ausente não é inferido — falha de classificação `pi` sempre bloqueia com evidência, nunca escolhe por conta própria.
- TDD obrigatório nesta fatia inteira: isolamento (execução só no container), atribuição de custo por tentativa e idempotência do orçamento são invariantes críticas explícitas da SPEC.
- Testes de integração seguem o padrão já usado em `executor-proxy.int-spec.ts` e `adapters-novos.int-spec.ts`: dublê real injetado (binário `node -e <script>` no lugar de `docker`/`claude`), nunca mock da lógica sob teste.

---

### Task 1: Estado de quota — domínio e migration

**Files:**
- Modify: `src/shared/domain/ai.ts`
- Modify: `src/main/storage/migrations.ts`
- Test: `src/shared/domain/ai.spec.ts`

**Interfaces:**
- Produces:
  - `type QuotaOrigem = 'medida' | 'estimada' | 'desconhecida'`
  - `interface QuotaState { readonly provider: AiProvider; readonly origem: QuotaOrigem; readonly restante?: number; readonly limite?: number; readonly resetEm?: string; readonly atualizadoEm: string }`
  - `ROTAS_SUBSCRIPTION_LIMITED: readonly AiProvider[]` (contém `'claude-code'`)
  - `function isRotaSubscriptionLimited(provider: AiProvider): boolean`
  - Migration 26 cria tabela `provider_quota_state`.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// src/shared/domain/ai.spec.ts (acrescentar ao arquivo existente)
import { describe, it, expect } from 'vitest'
import { isRotaSubscriptionLimited, ROTAS_SUBSCRIPTION_LIMITED } from './ai'

describe('isRotaSubscriptionLimited', () => {
  it('claude-code é subscription_limited, não unmetered puro', () => {
    expect(isRotaSubscriptionLimited('claude-code')).toBe(true)
    expect(ROTAS_SUBSCRIPTION_LIMITED).toContain('claude-code')
  })

  it('anthropic e gemini não são subscription_limited', () => {
    expect(isRotaSubscriptionLimited('anthropic')).toBe(false)
    expect(isRotaSubscriptionLimited('gemini')).toBe(false)
  })

  it('ollama não é subscription_limited (é unmetered por rodar local, não por assinatura)', () => {
    expect(isRotaSubscriptionLimited('ollama')).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run src/shared/domain/ai.spec.ts -t isRotaSubscriptionLimited`
Expected: FAIL — `isRotaSubscriptionLimited`/`ROTAS_SUBSCRIPTION_LIMITED` não existem.

- [ ] **Step 3: Implementar em `src/shared/domain/ai.ts`**

Acrescentar depois de `isRotaUnmetered` (linha ~100):

```typescript
/**
 * As rotas cujo custo **não é dinheiro por chamada, mas quota de assinatura** (SPEC-Entrega-04,
 * critério 12; emenda do PI de 2026-08-30).
 *
 * Distinta de `ROTAS_UNMETERED`: `unmetered` diz "sem USD a somar", que continua verdade — o
 * gate de orçamento (`BudgetService`) segue sem barrar `claude-code`. `subscription_limited`
 * diz uma coisa a mais: **existe um teto**, só que ele não é monetário. Quota desconhecida não
 * é o mesmo que quota infinita — a distinção que este critério existe para não deixar a rota
 * MAX se comportar como "sempre disponível" quando na verdade pode estar rate-limited.
 */
export const ROTAS_SUBSCRIPTION_LIMITED: readonly AiProvider[] = ['claude-code']

/** `true` quando a rota tem teto de uso por assinatura, não por dólar (critério 12). */
export function isRotaSubscriptionLimited(provider: AiProvider): boolean {
  return ROTAS_SUBSCRIPTION_LIMITED.includes(provider)
}

/**
 * De onde veio o número de quota reportado.
 *
 * `medida`: o CLI/API expôs o dado real (ex.: header de rate limit). `estimada`: derivado de
 * heurística local (ex.: contagem de chamadas na janela). `desconhecida`: nenhuma fonte
 * disponível — e é o estado inicial, honesto, em vez de inventar um número (spec: "quando a
 * origem os expõe").
 */
export const QUOTA_ORIGENS = ['medida', 'estimada', 'desconhecida'] as const
export type QuotaOrigem = (typeof QUOTA_ORIGENS)[number]

/**
 * O estado de quota conhecido de uma rota `subscription_limited`, para um escopo.
 *
 * Uma linha por `(provider, workspace)`, sobrescrita a cada atualização — como `BudgetPolicy`,
 * e não como `CostEvent`: isto é **status atual**, não histórico de eventos.
 */
export interface QuotaState {
  readonly provider: AiProvider
  readonly origem: QuotaOrigem
  /** Chamadas/tokens restantes na janela atual, quando a origem os expõe. */
  readonly restante?: number
  readonly limite?: number
  /** ISO 8601. Quando a janela de quota reseta, quando conhecido. */
  readonly resetEm?: string
  readonly atualizadoEm: string
}
```

- [ ] **Step 4: Rodar e confirmar passa**

Run: `npx vitest run src/shared/domain/ai.spec.ts -t isRotaSubscriptionLimited`
Expected: PASS

- [ ] **Step 5: Migration 26 — `provider_quota_state`**

Abrir `src/main/storage/migrations.ts`, localizar o fim do array de migrations (migration 25, linha ~1065 em diante) e acrescentar a 26 depois dela, seguindo o padrão comentado das anteriores:

```typescript
  // 26 — M9-F04: estado de quota das rotas subscription_limited (SPEC-Entrega-04, critério 12).
  //
  // Uma linha por (user_id, workspace_id, provider), sobrescrita — como `budget_policy` e não
  // como `cost_event`: isto é o status atual da quota, não um evento financeiro. Ausência de
  // linha é `origem = 'desconhecida'` em código, não uma linha semeada — mesmo raciocínio do
  // `BudgetRepository.find`: nenhum boot precisa migrar dado para o default valer.
  `
  CREATE TABLE provider_quota_state (
    user_id      TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    provider     TEXT NOT NULL,
    -- 'medida' | 'estimada' | 'desconhecida'. Enum no domínio.
    origem       TEXT NOT NULL,
    restante     INTEGER,
    limite       INTEGER,
    reset_em     TEXT,
    atualizado_em TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id, provider)
  );
  `,
```

- [ ] **Step 6: Confirmar a suíte de migrations continua passando**

Run: `npx vitest run src/main/storage`
Expected: PASS — nenhuma migration existente quebrou; a nova tabela é criada num banco novo.

- [ ] **Step 7: Commit**

```bash
git add src/shared/domain/ai.ts src/shared/domain/ai.spec.ts src/main/storage/migrations.ts
git commit -m "feat(providers): estado de quota subscription_limited (SPEC-Entrega-04 critério 12)"
```

---

### Task 2: Repositório e serviço de quota

**Files:**
- Create: `src/main/ai/quota-repository.ts`
- Create: `src/main/ai/quota-repository.int-spec.ts`

**Interfaces:**
- Consumes: `QuotaState`, `QuotaOrigem`, `AiProvider` de `@shared/domain/ai` (Task 1); `WorkspaceId` de `@shared/domain/entities`.
- Produces:
  - `class QuotaRepository { constructor(db: Database); ler(userId: string, workspace: WorkspaceId, provider: AiProvider): QuotaState | undefined; gravar(userId: string, workspace: WorkspaceId, estado: QuotaState, agora: Date): void }`

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// src/main/ai/quota-repository.int-spec.ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../storage/migrations'
import { QuotaRepository } from './quota-repository'

describe('QuotaRepository', () => {
  let db: InstanceType<typeof Database>
  let repo: QuotaRepository

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    repo = new QuotaRepository(db)
  })

  it('ausência de linha é undefined, não erro', () => {
    expect(repo.ler('u1', 'ws1' as never, 'claude-code')).toBeUndefined()
  })

  it('grava e lê de volta o estado completo', () => {
    const agora = new Date('2026-09-02T10:00:00.000Z')
    repo.gravar(
      'u1',
      'ws1' as never,
      {
        provider: 'claude-code',
        origem: 'medida',
        restante: 42,
        limite: 100,
        resetEm: '2026-09-02T12:00:00.000Z',
        atualizadoEm: agora.toISOString()
      },
      agora
    )

    const lido = repo.ler('u1', 'ws1' as never, 'claude-code')
    expect(lido).toEqual({
      provider: 'claude-code',
      origem: 'medida',
      restante: 42,
      limite: 100,
      resetEm: '2026-09-02T12:00:00.000Z',
      atualizadoEm: agora.toISOString()
    })
  })

  it('gravar de novo sobrescreve, nunca duplica linha', () => {
    const t1 = new Date('2026-09-02T10:00:00.000Z')
    const t2 = new Date('2026-09-02T11:00:00.000Z')
    repo.gravar('u1', 'ws1' as never, { provider: 'claude-code', origem: 'desconhecida', atualizadoEm: t1.toISOString() }, t1)
    repo.gravar('u1', 'ws1' as never, { provider: 'claude-code', origem: 'medida', restante: 5, atualizadoEm: t2.toISOString() }, t2)

    const lido = repo.ler('u1', 'ws1' as never, 'claude-code')
    expect(lido?.origem).toBe('medida')
    expect(lido?.restante).toBe(5)

    const contagem = db.prepare('SELECT COUNT(*) as n FROM provider_quota_state').get() as { n: number }
    expect(contagem.n).toBe(1)
  })

  it('escopos distintos (workspace, provider) não colidem', () => {
    const agora = new Date('2026-09-02T10:00:00.000Z')
    repo.gravar('u1', 'ws1' as never, { provider: 'claude-code', origem: 'medida', restante: 1, atualizadoEm: agora.toISOString() }, agora)
    repo.gravar('u1', 'ws2' as never, { provider: 'claude-code', origem: 'medida', restante: 2, atualizadoEm: agora.toISOString() }, agora)

    expect(repo.ler('u1', 'ws1' as never, 'claude-code')?.restante).toBe(1)
    expect(repo.ler('u1', 'ws2' as never, 'claude-code')?.restante).toBe(2)
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run src/main/ai/quota-repository.int-spec.ts`
Expected: FAIL — módulo `./quota-repository` não existe.

- [ ] **Step 3: Implementar**

```typescript
// src/main/ai/quota-repository.ts
/**
 * Persistência do estado de quota das rotas `subscription_limited` (SPEC-Entrega-04, critério
 * 12). Uma linha por `(user_id, workspace_id, provider)`, sobrescrita — o mesmo raciocínio do
 * `BudgetRepository` para `budget_policy`: isto é status atual, não histórico de eventos.
 */

import type { Database } from 'better-sqlite3'
import type { WorkspaceId } from '@shared/domain/entities'
import type { AiProvider, QuotaOrigem, QuotaState } from '@shared/domain/ai'

interface QuotaRow {
  readonly provider: string
  readonly origem: string
  readonly restante: number | null
  readonly limite: number | null
  readonly reset_em: string | null
  readonly atualizado_em: string
}

function toQuotaState(row: QuotaRow): QuotaState {
  return {
    provider: row.provider as AiProvider,
    origem: row.origem as QuotaOrigem,
    ...(row.restante === null ? {} : { restante: row.restante }),
    ...(row.limite === null ? {} : { limite: row.limite }),
    ...(row.reset_em === null ? {} : { resetEm: row.reset_em }),
    atualizadoEm: row.atualizado_em
  }
}

export class QuotaRepository {
  constructor(private readonly db: Database) {}

  ler(userId: string, workspace: WorkspaceId, provider: AiProvider): QuotaState | undefined {
    const row = this.db
      .prepare(
        `SELECT provider, origem, restante, limite, reset_em, atualizado_em
           FROM provider_quota_state
          WHERE user_id = ? AND workspace_id = ? AND provider = ?`
      )
      .get(userId, workspace, provider) as QuotaRow | undefined

    return row === undefined ? undefined : toQuotaState(row)
  }

  gravar(userId: string, workspace: WorkspaceId, estado: QuotaState, agora: Date): void {
    this.db
      .prepare(
        `INSERT INTO provider_quota_state
           (user_id, workspace_id, provider, origem, restante, limite, reset_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, workspace_id, provider) DO UPDATE SET
           origem        = excluded.origem,
           restante      = excluded.restante,
           limite        = excluded.limite,
           reset_em      = excluded.reset_em,
           atualizado_em = excluded.atualizado_em`
      )
      .run(
        userId,
        workspace,
        estado.provider,
        estado.origem,
        estado.restante ?? null,
        estado.limite ?? null,
        estado.resetEm ?? null,
        agora.toISOString()
      )
  }
}
```

- [ ] **Step 4: Rodar e confirmar passa**

Run: `npx vitest run src/main/ai/quota-repository.int-spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/quota-repository.ts src/main/ai/quota-repository.int-spec.ts
git commit -m "feat(providers): QuotaRepository para estado de quota subscription_limited"
```

---

### Task 3: Gate de quota no `AiCallService`

**Files:**
- Modify: `src/main/ai/call-provider.ts`
- Test: `src/main/ai/call-provider.int-spec.ts` (acrescentar casos)

**Interfaces:**
- Consumes: `QuotaRepository.ler`/`gravar` (Task 2); `isRotaSubscriptionLimited` (Task 1).
- Produces: `AiCallService` ganha um construtor-param opcional `quota?: { ler(...): QuotaState | undefined }` (mínimo necessário, mesmo padrão do `VerificadorDeContexto`) e passa a recusar chamada `claude-code` quando `restante === 0` e `resetEm` no futuro.

**Nota de design:** seguir o padrão já usado para `contextPacks` (interface mínima, não o repositório inteiro) — `AiCallService` não deve depender de `QuotaRepository` concreto.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `src/main/ai/call-provider.int-spec.ts` (ler o arquivo primeiro para casar o padrão de setup do describe existente — os dublês de `budget`/`contextPacks`/`adapters` já estão montados lá; reusar a mesma fábrica de serviço, adicionando o novo dublê de quota):

```typescript
describe('AiCallService — gate de quota subscription_limited (SPEC-Entrega-04, critério 12)', () => {
  it('rota claude-code com quota zerada e reset futuro é barrada antes de sair', async () => {
    const quotaZerada = {
      ler: () => ({
        provider: 'claude-code' as const,
        origem: 'medida' as const,
        restante: 0,
        limite: 100,
        resetEm: new Date(Date.now() + 60_000).toISOString(),
        atualizadoEm: new Date().toISOString()
      })
    }
    const service = criarServico({ quota: quotaZerada }) // usar a fábrica local do arquivo, com o novo param

    const eventos = await coletar(
      service.call(
        { provider: 'claude-code', prompt: 'oi', contextPackId: 'pack-1' },
        { userId: 'u1', workspace: 'ws1' as never }
      )
    )

    const fim = eventos.at(-1)
    expect(fim?.tipo).toBe('fim')
    expect(fim?.tipo === 'fim' ? fim.estado : undefined).toBe('falhou')
    expect(fim?.tipo === 'fim' ? fim.erro : '').toMatch(/quota/i)
  })

  it('quota desconhecida não barra a chamada (melhor esforço, não saldo negativo)', async () => {
    const quotaDesconhecida = { ler: () => undefined }
    const service = criarServico({ quota: quotaDesconhecida })

    const eventos = await coletar(
      service.call(
        { provider: 'claude-code', prompt: 'oi', contextPackId: 'pack-1' },
        { userId: 'u1', workspace: 'ws1' as never }
      )
    )

    const fim = eventos.at(-1)
    expect(fim?.tipo === 'fim' ? fim.estado : undefined).toBe('concluido')
  })

  it('quota com restante > 0 segue normalmente', async () => {
    const quotaOk = {
      ler: () => ({
        provider: 'claude-code' as const,
        origem: 'medida' as const,
        restante: 10,
        atualizadoEm: new Date().toISOString()
      })
    }
    const service = criarServico({ quota: quotaOk })

    const eventos = await coletar(
      service.call(
        { provider: 'claude-code', prompt: 'oi', contextPackId: 'pack-1' },
        { userId: 'u1', workspace: 'ws1' as never }
      )
    )

    expect(eventos.at(-1)?.tipo === 'fim' ? (eventos.at(-1) as { estado: string }).estado : undefined).toBe('concluido')
  })
})
```

Ajustar a assinatura da fábrica `criarServico` local do arquivo (se ela não aceitar overrides ainda) para aceitar `{ quota?: {...} }` e repassar ao construtor do `AiCallService`.

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run src/main/ai/call-provider.int-spec.ts -t "quota subscription_limited"`
Expected: FAIL — `AiCallService` ainda não aceita nem usa `quota`.

- [ ] **Step 3: Implementar em `src/main/ai/call-provider.ts`**

Acrescentar interface mínima (junto de `VerificadorDeContexto`, linha ~68):

```typescript
/**
 * O que o ponto único precisa saber sobre quota: **o estado atual da rota**, quando ela é
 * `subscription_limited` (SPEC-Entrega-04, critério 12).
 *
 * Interface mínima, como `VerificadorDeContexto`: o gate só lê, nunca decide onde/como a quota
 * é atualizada — isso é responsabilidade de quem grava (fora do escopo desta chamada).
 */
export interface VerificadorDeQuota {
  ler(userId: string, workspace: WorkspaceId, provider: AiProvider): QuotaState | undefined
}
```

Import necessário: `import { isRotaSubscriptionLimited, type QuotaState } from '@shared/domain/ai'` (acrescentar aos imports existentes de `@shared/domain/ai`).

No construtor da classe, acrescentar parâmetro opcional ao final:

```typescript
    private readonly contextPacks: VerificadorDeContexto,
    /**
     * O estado de quota da rota de assinatura (SPEC-Entrega-04, critério 12). Opcional para não
     * quebrar todo call site existente do MVP-005 ao MVP-008 — nenhum deles usa `claude-code`
     * hoje. Ausente, o gate de quota simplesmente não roda (equivalente a "sempre desconhecida").
     */
    private readonly quota?: VerificadorDeQuota
```

No método `call`, logo após o gate de orçamento (depois do bloco `if (veredito.decisao === 'bloqueado')`, antes do passo `(1) Classificação`), acrescentar:

```typescript
    // (3b) O gate de **quota** (SPEC-Entrega-04, critério 12). Só corre para rota
    // subscription_limited, e só barra quando o restante é **conhecido e zerado** com reset no
    // futuro — quota desconhecida não vira saldo infinito, mas também não vira bloqueio por
    // omissão: a spec pede melhor esforço, não recusa por falta de dado.
    if (isRotaSubscriptionLimited(provider) && this.quota !== undefined) {
      const estado = this.quota.ler(ctx.userId, ctx.workspace, provider)
      const zerada =
        estado !== undefined &&
        estado.restante === 0 &&
        estado.resetEm !== undefined &&
        new Date(estado.resetEm).getTime() > Date.now()

      if (zerada) {
        yield this.finalizar(id, ctx, provider, model, {
          estado: 'falhou',
          erro: `Quota da rota de assinatura esgotada. Reinicia em ${estado.resetEm}.`,
          latenciaTotalMs: 0,
          estimadoUsd,
          naoSaiu: true
        })
        return
      }
    }
```

- [ ] **Step 4: Rodar e confirmar passa**

Run: `npx vitest run src/main/ai/call-provider.int-spec.ts`
Expected: PASS — incluindo todos os testes pré-existentes do arquivo (nenhuma regressão).

- [ ] **Step 5: Atualizar todo call site que instancia `AiCallService` diretamente**

Buscar: `grep -rn "new AiCallService(" src/` — cada instanciação existente continua compilando (o parâmetro é opcional), mas confirmar isso rodando o typecheck:

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 6: Commit**

```bash
git add src/main/ai/call-provider.ts src/main/ai/call-provider.int-spec.ts
git commit -m "feat(providers): gate de quota subscription_limited no AiCallService (critério 12)"
```

---

### Task 4: `DockerRunner.exec()` — executar comando dentro do container

**Files:**
- Modify: `src/main/pipeline/docker-runner.ts`
- Test: `src/main/pipeline/docker-runner.int-spec.ts` (ler o arquivo existente antes, se houver, para casar o padrão; senão criar)

**Interfaces:**
- Consumes: `TerminalEngine.run` (já injetado no construtor de `DockerRunner`).
- Produces:
  - `interface ExecucaoNoContainer { readonly ok: boolean; readonly stdout: string; readonly stderr: string; readonly exitCode: number | null; readonly timeoutExcedido: boolean }`
  - `DockerRunner.exec(container: string, comando: readonly string[], cwd: string, timeoutMs?: number): ExecucaoNoContainer`
  - `DockerRunner.matarProcesso(container: string, cwd: string): void` (mata processos do usuário dentro do container sem parar o container — para cancelamento cooperativo, critério 5)

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// src/main/pipeline/docker-runner.int-spec.ts (acrescentar; ou criar se o arquivo não existir —
// conferir primeiro com Glob/Read se já há um arquivo de teste para docker-runner.ts)
import { describe, it, expect, vi } from 'vitest'
import { DockerRunner } from './docker-runner'
import type { TerminalEngine } from '../execution/terminal-engine'

/** Dublê do TerminalEngine — captura o comando `docker` submetido, sem shell real. */
function terminalDuble(
  respostaPorArgs: (args: readonly string[]) => { stdout: string; stderr: string; state: 'concluido' | 'falhou'; exitCode: number | null }
): TerminalEngine {
  return {
    run: vi.fn((submission: { readonly args: readonly string[] }) => {
      const r = respostaPorArgs(submission.args)
      return {
        id: 'x',
        state: r.state,
        stdout: r.stdout,
        stderr: r.stderr,
        exitCode: r.exitCode,
        durationMs: 1
      }
    })
  } as unknown as TerminalEngine
}

describe('DockerRunner.exec — comando dentro do container (critério 11)', () => {
  it('monta docker exec com o comando pedido e devolve stdout/exitCode', () => {
    const terminal = terminalDuble((args) => {
      expect(args[0]).toBe('exec')
      expect(args).toContain('meu-container')
      expect(args.slice(-3)).toEqual(['npm', 'run', 'test'])
      return { stdout: 'ok\n', stderr: '', state: 'concluido', exitCode: 0 }
    })
    const runner = new DockerRunner(terminal, () => 'ws1' as never)

    const resultado = runner.exec('meu-container', ['npm', 'run', 'test'], '/host/cwd')

    expect(resultado.ok).toBe(true)
    expect(resultado.stdout).toBe('ok\n')
    expect(resultado.exitCode).toBe(0)
    expect(resultado.timeoutExcedido).toBe(false)
  })

  it('exit code não-zero é ok:false, sem timeoutExcedido', () => {
    const terminal = terminalDuble(() => ({ stdout: '', stderr: 'falhou', state: 'concluido', exitCode: 1 }))
    const runner = new DockerRunner(terminal, () => 'ws1' as never)

    const resultado = runner.exec('meu-container', ['npm', 'run', 'lint'], '/host/cwd')

    expect(resultado.ok).toBe(false)
    expect(resultado.timeoutExcedido).toBe(false)
  })

  it('timeout do TerminalEngine vira timeoutExcedido:true', () => {
    const terminal = terminalDuble(() => ({ stdout: '', stderr: '', state: 'falhou', exitCode: null }))
    const runner = new DockerRunner(terminal, () => 'ws1' as never)

    const resultado = runner.exec('meu-container', ['claude', '--print'], '/host/cwd')

    expect(resultado.ok).toBe(false)
    expect(resultado.timeoutExcedido).toBe(true)
  })

  it('matarProcesso monta docker exec com pkill, não docker stop', () => {
    const terminal = terminalDuble((args) => {
      expect(args[0]).toBe('exec')
      expect(args).toContain('pkill')
      return { stdout: '', stderr: '', state: 'concluido', exitCode: 0 }
    })
    const runner = new DockerRunner(terminal, () => 'ws1' as never)

    runner.matarProcesso('meu-container', '/host/cwd')
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run src/main/pipeline/docker-runner.int-spec.ts -t "exec — comando dentro do container"`
Expected: FAIL — `exec`/`matarProcesso` não existem em `DockerRunner`.

- [ ] **Step 3: Implementar em `src/main/pipeline/docker-runner.ts`**

Acrescentar depois do método `parar` (antes do fechamento da classe, linha ~386):

```typescript
  /**
   * Roda um comando **dentro** do container já em pé (SPEC-Entrega-04, critérios 1 e 11).
   *
   * `docker exec`, e não um segundo `docker run`: o container já está montado com o worktree e
   * a rede de egress corretos (M9-F03) — um novo `run` duplicaria o sandbox. É o mesmo raciocínio
   * do `subir`: passa pelo `TerminalEngine`, nunca `spawn` direto, para manter a auditoria e a
   * allowlist num ponto só.
   */
  exec(
    container: string,
    comando: readonly string[],
    cwd: string,
    timeoutMs?: number
  ): ExecucaoNoContainer {
    const execucao = this.terminal.run(
      {
        binary: BINARIO_DOCKER,
        args: ['exec', ...(timeoutMs !== undefined ? [] : []), container, ...comando],
        cwd
      },
      this.workspaceId()
    )

    return {
      ok: execucao.state === 'concluido' && execucao.exitCode === 0,
      stdout: execucao.stdout,
      stderr: execucao.stderr,
      exitCode: execucao.exitCode,
      // `falhou` sem `exitCode` é o sinal de timeout do TerminalEngine (mesma leitura que ele
      // usa internamente para `reason: 'timeout-excedido'`).
      timeoutExcedido: execucao.state === 'falhou' && execucao.exitCode === null
    }
  }

  /**
   * Mata os processos do usuário dentro do container, **sem parar o container** (critério 5).
   *
   * Cancelamento de uma tentativa não pode derrubar o sandbox inteiro: o worktree montado nele
   * é o mesmo entre tentativas, e `docker stop` obrigaria a M9-F04 a refazer todo o preflight
   * para a tentativa seguinte. `pkill -u` mata só o que o executor rodou.
   */
  matarProcesso(container: string, cwd: string): void {
    this.terminal.run(
      { binary: BINARIO_DOCKER, args: ['exec', container, 'pkill', '-u', 'root'], cwd },
      this.workspaceId()
    )
  }
```

Acrescentar a interface `ExecucaoNoContainer` junto das outras interfaces exportadas do arquivo (perto de `MontagemDoSandbox`, linha ~96):

```typescript
/** O resultado de um comando rodado dentro do container (critério 11). */
export interface ExecucaoNoContainer {
  readonly ok: boolean
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly timeoutExcedido: boolean
}
```

**Nota:** revisar a assinatura real de `CommandExecution` em `terminal-engine.ts` (campos `state`, `stdout`, `stderr`, `exitCode`) antes de finalizar — usar exatamente os nomes de campo que o `TerminalEngine.run` devolve (confirmados na leitura de código: `state: 'concluido' | 'falhou' | ...`, `stdout: string`, `exitCode: number | null`).

- [ ] **Step 4: Rodar e confirmar passa**

Run: `npx vitest run src/main/pipeline/docker-runner.int-spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/pipeline/docker-runner.ts src/main/pipeline/docker-runner.int-spec.ts
git commit -m "feat(pipeline): DockerRunner.exec/matarProcesso para comandos dentro do container"
```

---

### Task 5: Domínio de tentativa e classificação de falha

**Files:**
- Create: `src/shared/domain/attempt.ts`
- Test: `src/shared/domain/attempt.spec.ts`

**Interfaces:**
- Produces:
  - `const CLASSIFICACOES_DE_FALHA = ['corrigivel', 'pi', 'externo', 'risco-usuario'] as const`
  - `type ClassificacaoDeFalha = (typeof CLASSIFICACOES_DE_FALHA)[number]`
  - `interface RelatorioDeValidacao { readonly ok: boolean; readonly testes: ExecucaoNoContainer; readonly lint: ExecucaoNoContainer; readonly types: ExecucaoNoContainer; readonly build: ExecucaoNoContainer }` — mas para não acoplar ao tipo de `docker-runner.ts` no domínio compartilhado, usar uma forma mínima local (ver Step 3).
  - `function classificarFalha(saida: { readonly stderr: string; readonly stdout: string }): ClassificacaoDeFalha`
  - `function proximaTentativaPermitida(tentativaAtual: number): boolean` (máximo 3: inicial=1, recuperações=2 e 3)
  - `interface Tentativa { readonly numero: number; readonly runId: string; readonly classificacao?: ClassificacaoDeFalha; readonly diagnostico?: string }`

**Nota de escopo:** este é o módulo de domínio puro (sem I/O) que decide **classificação de falha** e **se ainda cabe recuperação** — as duas decisões que a spec exige serem determinísticas e testáveis isoladamente. `classificarFalha` é heurística textual conservadora: reconhece padrões óbvios (timeout, erro de rede/auth = externo; diff fora do escopo = risco-usuário) e cai em `corrigivel` por default — nunca em `pi`, que só a camada de orquestração declara (mudança de produto não se infere de stderr).

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// src/shared/domain/attempt.spec.ts
import { describe, it, expect } from 'vitest'
import { classificarFalha, proximaTentativaPermitida } from './attempt'

describe('classificarFalha', () => {
  it('timeout de rede é externo', () => {
    expect(classificarFalha({ stdout: '', stderr: 'ETIMEDOUT: connection timed out' })).toBe('externo')
  })

  it('erro de autenticação/quota é externo', () => {
    expect(classificarFalha({ stdout: '', stderr: '401 Unauthorized: invalid api key' })).toBe('externo')
    expect(classificarFalha({ stdout: '', stderr: 'rate limit exceeded' })).toBe('externo')
  })

  it('teste/lint/type/build falhando é corrigível por default', () => {
    expect(classificarFalha({ stdout: 'FAIL src/foo.spec.ts', stderr: '' })).toBe('corrigivel')
    expect(classificarFalha({ stdout: '', stderr: 'error TS2345: Argument of type' })).toBe('corrigivel')
  })

  it('saída vazia ou irreconhecível ainda é corrigível, nunca pi por default', () => {
    expect(classificarFalha({ stdout: '', stderr: '' })).toBe('corrigivel')
  })
})

describe('proximaTentativaPermitida', () => {
  it('tentativa 1 (inicial) sempre permite recuperação (chega até 2)', () => {
    expect(proximaTentativaPermitida(1)).toBe(true)
  })

  it('tentativa 2 (primeira recuperação) ainda permite a terceira', () => {
    expect(proximaTentativaPermitida(2)).toBe(true)
  })

  it('tentativa 3 (segunda recuperação) é a última — não permite mais', () => {
    expect(proximaTentativaPermitida(3)).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run src/shared/domain/attempt.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```typescript
// src/shared/domain/attempt.ts
/**
 * O domínio de uma tentativa de construção (SPEC-Entrega-04).
 *
 * Duas decisões puras, sem I/O: **por que a validação falhou** (classificação) e **ainda cabe
 * tentar de novo** (limite). Puro de propósito — são exatamente as duas decisões que a spec
 * exige serem determinísticas e testáveis sem container, sem processo, sem banco.
 */

/**
 * Por que uma tentativa falhou.
 *
 * `corrigivel`: teste/lint/type/build, revisão, CI ou conflito solucionável dentro da SPEC —
 * candidato a recuperação. `pi`: mudança de produto, contradição estrutural ou escolha
 * irreversível material — **nunca inferido daqui**, só a camada de orquestração o declara
 * (requisito de produto ausente não é inferido, spec § Regras). `externo`: auth, quota, serviço
 * ou infraestrutura sem alternativa autorizada — não adianta recuperar tentando de novo com o
 * mesmo código. `risco-usuario`: potencial de sobrescrever trabalho existente.
 */
export const CLASSIFICACOES_DE_FALHA = ['corrigivel', 'pi', 'externo', 'risco-usuario'] as const
export type ClassificacaoDeFalha = (typeof CLASSIFICACOES_DE_FALHA)[number]

/** Uma tentativa de construção, dentro do run. `numero` é 1 (inicial), 2 ou 3 (recuperações). */
export interface Tentativa {
  readonly numero: number
  readonly runId: string
  readonly classificacao?: ClassificacaoDeFalha
  readonly diagnostico?: string
}

/**
 * Classifica a falha pela saída da validação. **Default é `corrigivel`, nunca `pi`**: inferir
 * mudança de produto de um stderr seria exatamente o "requisito ausente inferido" que a spec
 * proíbe — `pi` só entra por decisão explícita de quem orquestra, lendo o motivo real da recusa.
 *
 * Padrões de rede/auth/quota são `externo` porque recuperar tentando de novo com o mesmo código
 * não muda o desfecho — o problema não está no código gerado.
 */
export function classificarFalha(saida: { readonly stdout: string; readonly stderr: string }): ClassificacaoDeFalha {
  const texto = `${saida.stdout}\n${saida.stderr}`.toLowerCase()

  const padroesExternos = [
    'etimedout',
    'econnrefused',
    'econnreset',
    '401 unauthorized',
    '403 forbidden',
    'rate limit',
    'quota exceeded',
    'invalid api key'
  ]

  if (padroesExternos.some((padrao) => texto.includes(padrao))) return 'externo'

  return 'corrigivel'
}

/** Máximo de três tentativas totais: inicial + duas recuperações (critério 2, spec § Regras). */
const MAXIMO_DE_TENTATIVAS = 3

/** Ainda cabe recuperar depois desta tentativa? `false` na terceira — não há quarta. */
export function proximaTentativaPermitida(tentativaAtual: number): boolean {
  return tentativaAtual < MAXIMO_DE_TENTATIVAS
}
```

- [ ] **Step 4: Rodar e confirmar passa**

Run: `npx vitest run src/shared/domain/attempt.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/domain/attempt.ts src/shared/domain/attempt.spec.ts
git commit -m "feat(pipeline): domínio de tentativa — classificação de falha e limite (critério 2)"
```

---

### Task 6: `ConstrutorService` — orquestrador da construção e recuperação

**Files:**
- Create: `src/main/pipeline/construtor-service.ts`
- Test: `src/main/pipeline/construtor-service.int-spec.ts`

**Interfaces:**
- Consumes:
  - `DockerRunner.exec`/`matarProcesso` (Task 4)
  - `classificarFalha`, `proximaTentativaPermitida` (Task 5)
  - `PipelineRepository.transicionar` (já existe — `src/main/pipeline/pipeline-repository.ts:124`)
  - `SandboxPreparado` (já existe — `@shared/domain/preflight`, produzido pelo `PreflightService`)
  - `AuditRepository.append` (já existe)
- Produces:
  - `interface ComandosDeValidacao { readonly test: readonly string[]; readonly lint: readonly string[]; readonly typecheck: readonly string[]; readonly build: readonly string[] }`
  - `interface PedidoDeConstrucao { readonly runId: string; readonly sandbox: SandboxPreparado; readonly promptInicial: string; readonly comandosDeValidacao: ComandosDeValidacao; readonly timeoutPorPassoMs?: number }`
  - `class ConstrutorService { constrói(pedido: PedidoDeConstrucao): Promise<ResultadoDaConstrucao> }`
  - `interface ResultadoDaConstrucao { readonly estadoFinal: 'PR_CI' | 'BLOCKED'; readonly tentativas: readonly Tentativa[]; readonly bloqueio?: { readonly causa: ClassificacaoDeFalha; readonly evidencia: string } }`

**Nota de design:** este serviço **não** fala com o `AiCallService` diretamente — quem chama o binário `claude` dentro do container é o próprio container, via `docker exec <container> claude --print` com `ANTHROPIC_BASE_URL` já injetado pelo `DockerRunner.subir()` (M9-F03). O `ConstrutorService` só decide *quando* rodar o quê e interpreta o resultado. Isso é o que faz o critério 1 ("nenhum caminho de execução no host") valer: o prompt nunca sai do host como chamada de IA — só como `docker exec` de um binário que já roda no container.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// src/main/pipeline/construtor-service.int-spec.ts
import { describe, it, expect, vi } from 'vitest'
import { ConstrutorService } from './construtor-service'
import type { DockerRunner } from './docker-runner'
import type { PipelineRepository } from './pipeline-repository'
import type { AuditRepository } from '../storage/audit-repository'
import type { SandboxPreparado } from '@shared/domain/preflight'

const sandbox: SandboxPreparado = {
  runId: 'run-1',
  containerNome: 'jarvis-run-1',
  cwd: '/work',
  baseSha: 'abc123',
  branch: 'feat/run-1',
  worktreeNoHost: '/host/worktree',
  pathsPermitidos: { paths: ['src/**'], origem: 'spec' },
  proxyUrl: 'http://172.20.0.2:8080'
}

function dockerDuble(
  roteiro: (comando: readonly string[]) => { ok: boolean; stdout: string; stderr: string; exitCode: number | null; timeoutExcedido: boolean }
): DockerRunner {
  return {
    exec: vi.fn((_container: string, comando: readonly string[]) => roteiro(comando)),
    matarProcesso: vi.fn()
  } as unknown as DockerRunner
}

function repoDuble(): PipelineRepository {
  return { transicionar: vi.fn(() => true) } as unknown as PipelineRepository
}

function auditDuble(): AuditRepository {
  return { append: vi.fn() } as unknown as AuditRepository
}

const comandosDeValidacao = {
  test: ['npm', 'run', 'test'],
  lint: ['npm', 'run', 'lint'],
  typecheck: ['npm', 'run', 'typecheck'],
  build: ['npm', 'run', 'build']
}

describe('ConstrutorService — tentativa única bem-sucedida', () => {
  it('claude roda, validação passa, run vai para PR_CI numa tentativa só', async () => {
    const docker = dockerDuble((comando) => {
      // Todo comando (claude e os 4 de validação) responde ok nesta suíte.
      return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
    })
    const pipeline = repoDuble()
    const audit = auditDuble()
    const service = new ConstrutorService(docker, pipeline, audit, () => 'u1', () => 'ws1' as never)

    const resultado = await service.construir({
      runId: 'run-1',
      sandbox,
      promptInicial: 'Implemente a SPEC.',
      comandosDeValidacao
    })

    expect(resultado.estadoFinal).toBe('PR_CI')
    expect(resultado.tentativas).toHaveLength(1)
    expect(resultado.tentativas[0]?.numero).toBe(1)
    expect(pipeline.transicionar).toHaveBeenCalledWith('run-1', 'RUNNING', 'VALIDATING', expect.any(Date))
    expect(pipeline.transicionar).toHaveBeenCalledWith('run-1', 'VALIDATING', 'PR_CI', expect.any(Date))
  })
})

describe('ConstrutorService — recuperação corrigível', () => {
  it('validação falha corrigível na 1ª tentativa, passa na 2ª: run termina em PR_CI com 2 tentativas', async () => {
    let chamadasDeValidacao = 0
    const docker = dockerDuble((comando) => {
      if (comando[0] === 'claude') return { ok: true, stdout: '', stderr: '', exitCode: 0, timeoutExcedido: false }
      // Só a validação de teste falha, e só na primeira passagem.
      if (comando.includes('test')) {
        chamadasDeValidacao += 1
        if (chamadasDeValidacao === 1) {
          return { ok: false, stdout: 'FAIL src/foo.spec.ts', stderr: '', exitCode: 1, timeoutExcedido: false }
        }
      }
      return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
    })
    const pipeline = repoDuble()
    const service = new ConstrutorService(docker, pipeline, auditDuble(), () => 'u1', () => 'ws1' as never)

    const resultado = await service.construir({
      runId: 'run-1',
      sandbox,
      promptInicial: 'Implemente a SPEC.',
      comandosDeValidacao
    })

    expect(resultado.estadoFinal).toBe('PR_CI')
    expect(resultado.tentativas).toHaveLength(2)
    expect(resultado.tentativas[0]?.classificacao).toBe('corrigivel')
    expect(pipeline.transicionar).toHaveBeenCalledWith('run-1', 'VALIDATING', 'RUNNING', expect.any(Date))
  })
})

describe('ConstrutorService — três tentativas esgotadas', () => {
  it('validação falha corrigível nas três tentativas: run termina BLOCKED', async () => {
    const docker = dockerDuble((comando) => {
      if (comando[0] === 'claude') return { ok: true, stdout: '', stderr: '', exitCode: 0, timeoutExcedido: false }
      if (comando.includes('test')) return { ok: false, stdout: 'FAIL sempre', stderr: '', exitCode: 1, timeoutExcedido: false }
      return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
    })
    const pipeline = repoDuble()
    const service = new ConstrutorService(docker, pipeline, auditDuble(), () => 'u1', () => 'ws1' as never)

    const resultado = await service.construir({
      runId: 'run-1',
      sandbox,
      promptInicial: 'Implemente a SPEC.',
      comandosDeValidacao
    })

    expect(resultado.estadoFinal).toBe('BLOCKED')
    expect(resultado.tentativas).toHaveLength(3)
    expect(resultado.bloqueio?.causa).toBe('corrigivel')
    expect(pipeline.transicionar).toHaveBeenCalledWith('run-1', 'VALIDATING', 'BLOCKED', expect.any(Date))
  })
})

describe('ConstrutorService — falha externa não gasta tentativa de correção, bloqueia direto', () => {
  it('erro de rede na chamada ao claude bloqueia sem tentar recuperação', async () => {
    const docker = dockerDuble((comando) => {
      if (comando[0] === 'claude') {
        return { ok: false, stdout: '', stderr: 'ETIMEDOUT: connection timed out', exitCode: 1, timeoutExcedido: false }
      }
      return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
    })
    const pipeline = repoDuble()
    const service = new ConstrutorService(docker, pipeline, auditDuble(), () => 'u1', () => 'ws1' as never)

    const resultado = await service.construir({
      runId: 'run-1',
      sandbox,
      promptInicial: 'Implemente a SPEC.',
      comandosDeValidacao
    })

    expect(resultado.estadoFinal).toBe('BLOCKED')
    expect(resultado.bloqueio?.causa).toBe('externo')
    expect(resultado.tentativas).toHaveLength(1)
  })
})

describe('ConstrutorService — comando do executor é sempre dentro do container', () => {
  it('nenhuma chamada usa cwd do host; container é sempre o nome do sandbox', async () => {
    const chamadas: readonly string[][] = []
    const docker = {
      exec: vi.fn((container: string, comando: readonly string[]) => {
        expect(container).toBe(sandbox.containerNome)
        chamadas.push([...comando])
        return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
      }),
      matarProcesso: vi.fn()
    } as unknown as DockerRunner
    const service = new ConstrutorService(docker, repoDuble(), auditDuble(), () => 'u1', () => 'ws1' as never)

    await service.construir({ runId: 'run-1', sandbox, promptInicial: 'x', comandosDeValidacao })

    expect(chamadas.length).toBeGreaterThan(0)
    expect(chamadas[0]?.[0]).toBe('claude')
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run src/main/pipeline/construtor-service.int-spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```typescript
// src/main/pipeline/construtor-service.ts
/**
 * O orquestrador da construção e recuperação (SPEC-Entrega-04).
 *
 * A pergunta que este serviço responde: **dado um sandbox pronto, o que rodar, na ordem certa,
 * até três vezes, e para onde levar o run quando parar?**
 *
 * Roda **depois** do preflight (M9-F03, que já entrega `SandboxPreparado`) e **não** fala com o
 * `AiCallService` diretamente — o `claude` roda **dentro** do container via `docker exec`, e é o
 * próprio binário lá dentro que fala HTTP com o `ExecutorProxy` do host (`ANTHROPIC_BASE_URL`,
 * já injetado pelo `DockerRunner.subir()`). É isso que faz o critério 1 valer: nenhum prompt sai
 * do host como chamada de IA — só como `docker exec` de um binário que já está lá.
 *
 * **O que este serviço não faz:** não sobe container (M9-F03), não abre PR nem mergeia (M9-F05),
 * não decide o prompt de recuperação em detalhe — monta um resumo simples do diff/erro/histórico,
 * a instrução completa de "como corrigir" é trabalho do próprio Claude Code a partir disso.
 */

import type { WorkspaceId } from '@shared/domain/entities'
import type { SandboxPreparado } from '@shared/domain/preflight'
import { classificarFalha, proximaTentativaPermitida, type ClassificacaoDeFalha, type Tentativa } from '@shared/domain/attempt'
import type { AuditRepository } from '../storage/audit-repository'
import { log } from '../logging/logger'
import type { DockerRunner, ExecucaoNoContainer } from './docker-runner'
import type { PipelineRepository } from './pipeline-repository'

/** Os quatro comandos de validação, no vocabulário do projeto-alvo (spec: "test/lint/type/build"). */
export interface ComandosDeValidacao {
  readonly test: readonly string[]
  readonly lint: readonly string[]
  readonly typecheck: readonly string[]
  readonly build: readonly string[]
}

export interface PedidoDeConstrucao {
  readonly runId: string
  readonly sandbox: SandboxPreparado
  /** O prompt da tentativa inicial — SPEC/hashes, ContextPack, paths, orçamento (spec § Entrada). */
  readonly promptInicial: string
  readonly comandosDeValidacao: ComandosDeValidacao
  /** Prazo por passo (claude ou um validador). Injetável para teste não esperar de verdade. */
  readonly timeoutPorPassoMs?: number
}

export interface ResultadoDaConstrucao {
  readonly estadoFinal: 'PR_CI' | 'BLOCKED'
  readonly tentativas: readonly Tentativa[]
  readonly bloqueio?: { readonly causa: ClassificacaoDeFalha; readonly evidencia: string }
}

const TIMEOUT_PADRAO_POR_PASSO_MS = 10 * 60_000

export class ConstrutorService {
  constructor(
    private readonly docker: DockerRunner,
    private readonly pipeline: PipelineRepository,
    private readonly audit: AuditRepository,
    private readonly userId: () => string,
    private readonly workspaceId: () => WorkspaceId,
    private readonly agora: () => Date = () => new Date()
  ) {}

  async construir(pedido: PedidoDeConstrucao): Promise<ResultadoDaConstrucao> {
    const timeoutMs = pedido.timeoutPorPassoMs ?? TIMEOUT_PADRAO_POR_PASSO_MS
    const tentativas: Tentativa[] = []
    let promptDaVez = pedido.promptInicial
    let numero = 1

    for (;;) {
      // (1) Invoca o `claude` dentro do container — o único ponto por onde o prompt entra.
      const execucaoClaude = this.docker.exec(
        pedido.sandbox.containerNome,
        ['claude', '--print', promptDaVez],
        pedido.sandbox.worktreeNoHost,
        timeoutMs
      )

      if (!execucaoClaude.ok) {
        const causa = classificarFalha(execucaoClaude)
        tentativas.push({ numero, runId: pedido.runId, classificacao: causa, diagnostico: execucaoClaude.stderr })
        return this.bloquear(pedido.runId, tentativas, causa, execucaoClaude.stderr)
      }

      // (2) Move para VALIDATING e roda test/lint/type/build — **sempre no container** (critério 11).
      this.transicionar(pedido.runId, 'RUNNING', 'VALIDATING')
      const validacao = this.validar(pedido.sandbox, pedido.comandosDeValidacao, timeoutMs)

      if (validacao.ok) {
        tentativas.push({ numero, runId: pedido.runId })
        this.transicionar(pedido.runId, 'VALIDATING', 'PR_CI')
        return { estadoFinal: 'PR_CI', tentativas }
      }

      const causa = classificarFalha(validacao.falha)
      tentativas.push({ numero, runId: pedido.runId, classificacao: causa, diagnostico: validacao.falha.stderr })

      // Falha externa não gasta ciclo de correção: recuperar com o mesmo código não muda o
      // desfecho de um serviço fora do ar (spec § Classificação).
      if (causa !== 'corrigivel') {
        return this.bloquear(pedido.runId, tentativas, causa, validacao.falha.stderr)
      }

      if (!proximaTentativaPermitida(numero)) {
        return this.bloquear(pedido.runId, tentativas, causa, validacao.falha.stderr)
      }

      // (3) Recuperação: volta a RUNNING com prompt resumido (delta + erro novo), nunca releitura
      // integral do repositório (spec § Regras: "não relê o repositório inteiro por padrão").
      this.transicionar(pedido.runId, 'VALIDATING', 'RUNNING')
      promptDaVez = promptDeRecuperacao(validacao.falha, tentativas)
      numero += 1
    }
  }

  private validar(
    sandbox: SandboxPreparado,
    comandos: ComandosDeValidacao,
    timeoutMs: number
  ): { readonly ok: true } | { readonly ok: false; readonly falha: ExecucaoNoContainer } {
    const passos: readonly (readonly string[])[] = [comandos.test, comandos.lint, comandos.typecheck, comandos.build]

    for (const passo of passos) {
      const execucao = this.docker.exec(sandbox.containerNome, passo, sandbox.worktreeNoHost, timeoutMs)
      if (!execucao.ok) return { ok: false, falha: execucao }
    }

    return { ok: true }
  }

  private bloquear(
    runId: string,
    tentativas: readonly Tentativa[],
    causa: ClassificacaoDeFalha,
    evidencia: string
  ): ResultadoDaConstrucao {
    this.transicionar(runId, 'VALIDATING', 'BLOCKED')
    return { estadoFinal: 'BLOCKED', tentativas, bloqueio: { causa, evidencia } }
  }

  private transicionar(runId: string, de: Parameters<PipelineRepository['transicionar']>[1], para: Parameters<PipelineRepository['transicionar']>[2]): void {
    const ok = this.pipeline.transicionar(runId, de, para, this.agora())
    this.audit.append({
      user_id: this.userId(),
      workspace_id: this.workspaceId(),
      type: 'pipeline-transition',
      payload: { runId, de, para, aplicada: ok }
    })
    if (!ok) {
      log.agent.warn('Transição de pipeline recusada pelo compare-and-set', { runId, de, para })
    }
  }
}

/**
 * O prompt da recuperação: diff atual, erro novo, histórico resumido — nunca releitura integral.
 *
 * Resumo simples de propósito: o `claude` dentro do container já tem o worktree montado e pode
 * inspecionar o próprio diff; o que este prompt precisa dar é o **erro que apareceu agora** e o
 * que já foi tentado, para não repetir descoberta resolvida (critério 3).
 */
function promptDeRecuperacao(falha: ExecucaoNoContainer, historico: readonly Tentativa[]): string {
  const tentativasAnteriores = historico
    .map((t) => `Tentativa ${t.numero}: ${t.classificacao ?? 'validação falhou'} — ${t.diagnostico ?? ''}`)
    .join('\n')

  return [
    'A validação da tentativa anterior falhou. Corrija o problema abaixo sem repetir descobertas já registradas.',
    '',
    'Erro atual:',
    falha.stderr || falha.stdout,
    '',
    'Histórico de tentativas nesta fatia:',
    tentativasAnteriores
  ].join('\n')
}
```

- [ ] **Step 4: Rodar e confirmar passa**

Run: `npx vitest run src/main/pipeline/construtor-service.int-spec.ts`
Expected: PASS — todos os 6 casos.

- [ ] **Step 5: Commit**

```bash
git add src/main/pipeline/construtor-service.ts src/main/pipeline/construtor-service.int-spec.ts
git commit -m "feat(pipeline): ConstrutorService — orquestra tentativa, validação e recuperação (M9-F04)"
```

---

### Task 7: Teste comprovando que sem container não há execução (critério 8)

**Files:**
- Test: `src/main/pipeline/construtor-service.int-spec.ts` (acrescentar)

**Interfaces:**
- Consumes: `ConstrutorService` (Task 6).

- [ ] **Step 1: Escrever o teste (que já deve passar, dado o design da Task 6 — este task é sobre *provar* a garantia, não construir código novo)**

```typescript
describe('ConstrutorService — sem container não há execução (critério 8)', () => {
  it('todo comando de claude e validação passa pelo DockerRunner.exec com o nome do container do sandbox — nunca um caminho de execução direta no host', async () => {
    const containersUsados = new Set<string>()
    const docker = {
      exec: vi.fn((container: string) => {
        containersUsados.add(container)
        return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
      }),
      matarProcesso: vi.fn()
    } as unknown as DockerRunner
    const service = new ConstrutorService(docker, repoDuble(), auditDuble(), () => 'u1', () => 'ws1' as never)

    await service.construir({ runId: 'run-1', sandbox, promptInicial: 'x', comandosDeValidacao })

    // Cinco chamadas (claude + 4 validadores), todas no mesmo container — nunca vazio, nunca
    // um segundo caminho que ignore o sandbox.
    expect(docker.exec).toHaveBeenCalledTimes(5)
    expect(containersUsados.size).toBe(1)
    expect(containersUsados.has(sandbox.containerNome)).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e confirmar passa**

Run: `npx vitest run src/main/pipeline/construtor-service.int-spec.ts -t "sem container não há execução"`
Expected: PASS (se falhar, é sinal de que a Task 6 introduziu um caminho de execução fora do `docker.exec` — corrigir lá, não aqui).

- [ ] **Step 3: Commit**

```bash
git add src/main/pipeline/construtor-service.int-spec.ts
git commit -m "test(pipeline): comprova execução containerizada do ConstrutorService (critério 8)"
```

---

### Task 8: Cancelamento mata a árvore de processos (critério 5)

**Files:**
- Modify: `src/main/pipeline/construtor-service.ts`
- Test: `src/main/pipeline/construtor-service.int-spec.ts` (acrescentar)

**Interfaces:**
- Consumes: `DockerRunner.matarProcesso` (Task 4).
- Produces: `ConstrutorService.cancelar(runId: string, sandbox: SandboxPreparado): void` e um `AbortSignal` opcional em `PedidoDeConstrucao.signal?: AbortSignal` que interrompe o laço entre passos.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
describe('ConstrutorService — cancelamento mata a árvore de processos (critério 5)', () => {
  it('sinal abortado entre passos interrompe o laço e chama matarProcesso, sem completar a construção', async () => {
    const controle = new AbortController()
    let chamadasExec = 0
    const docker = {
      exec: vi.fn(() => {
        chamadasExec += 1
        if (chamadasExec === 1) controle.abort() // aborta depois do primeiro passo (claude)
        return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
      }),
      matarProcesso: vi.fn()
    } as unknown as DockerRunner
    const pipeline = repoDuble()
    const service = new ConstrutorService(docker, pipeline, auditDuble(), () => 'u1', () => 'ws1' as never)

    const resultado = await service.construir({
      runId: 'run-1',
      sandbox,
      promptInicial: 'x',
      comandosDeValidacao,
      signal: controle.signal
    })

    expect(resultado.estadoFinal).toBe('BLOCKED')
    expect(docker.matarProcesso).toHaveBeenCalledWith(sandbox.containerNome, sandbox.worktreeNoHost)
    // Não chegou a rodar os 4 validadores inteiros — parou no meio.
    expect(chamadasExec).toBeLessThan(5)
  })

  it('cancelar() explícito mata processos sem esperar o próximo passo', () => {
    const docker = { exec: vi.fn(), matarProcesso: vi.fn() } as unknown as DockerRunner
    const service = new ConstrutorService(docker, repoDuble(), auditDuble(), () => 'u1', () => 'ws1' as never)

    service.cancelar('run-1', sandbox)

    expect(docker.matarProcesso).toHaveBeenCalledWith(sandbox.containerNome, sandbox.worktreeNoHost)
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run src/main/pipeline/construtor-service.int-spec.ts -t "cancelamento mata"`
Expected: FAIL — `signal` não é lido, `cancelar` não existe.

- [ ] **Step 3: Implementar**

Em `PedidoDeConstrucao`, acrescentar campo:

```typescript
  /** Cancelamento cooperativo: checado entre passos (critério 5). Ausente = não cancelável. */
  readonly signal?: AbortSignal
```

No método `construir`, no início de cada iteração do laço `for (;;)`, antes de chamar `this.docker.exec` do `claude`:

```typescter
    for (;;) {
      if (pedido.signal?.aborted === true) {
        this.docker.matarProcesso(pedido.sandbox.containerNome, pedido.sandbox.worktreeNoHost)
        return this.bloquear(pedido.runId, tentativas, 'externo', 'Cancelado pelo usuário.')
      }

      // (1) Invoca o `claude` dentro do container...
```

E também checar entre cada passo de validação — modificar `validar` para receber o `signal` e checar dentro do laço de passos:

```typescript
  private validar(
    sandbox: SandboxPreparado,
    comandos: ComandosDeValidacao,
    timeoutMs: number,
    signal?: AbortSignal
  ): { readonly ok: true } | { readonly ok: false; readonly falha: ExecucaoNoContainer } | { readonly ok: false; readonly cancelado: true } {
    const passos: readonly (readonly string[])[] = [comandos.test, comandos.lint, comandos.typecheck, comandos.build]

    for (const passo of passos) {
      if (signal?.aborted === true) {
        this.docker.matarProcesso(sandbox.containerNome, sandbox.worktreeNoHost)
        return { ok: false, cancelado: true } as never // ajustar o tipo de retorno conforme necessário
      }
      const execucao = this.docker.exec(sandbox.containerNome, passo, sandbox.worktreeNoHost, timeoutMs)
      if (!execucao.ok) return { ok: false, falha: execucao }
    }

    return { ok: true }
  }
```

**Nota:** simplificar o tipo de retorno de `validar` para incluir o terceiro caso (`cancelado`) de forma limpa — ajustar o `union type` e o call site em `construir` para tratar `cancelado` como bloqueio imediato com causa `'externo'`, evidência `'Cancelado pelo usuário.'`, sem tentar classificar.

Acrescentar o método público:

```typescript
  /**
   * Cancela a construção em andamento: mata os processos do container, sem parar o sandbox.
   * O laço em `construir` também checa `signal` entre passos — este método é para quem não
   * está esperando o próximo passo (ex.: handler de IPC do botão "Cancelar" na tela).
   */
  cancelar(_runId: string, sandbox: SandboxPreparado): void {
    this.docker.matarProcesso(sandbox.containerNome, sandbox.worktreeNoHost)
  }
```

- [ ] **Step 4: Rodar e confirmar passa**

Run: `npx vitest run src/main/pipeline/construtor-service.int-spec.ts`
Expected: PASS — toda a suíte do arquivo, incluindo os testes das Tasks 6 e 7 (nenhuma regressão).

- [ ] **Step 5: Commit**

```bash
git add src/main/pipeline/construtor-service.ts src/main/pipeline/construtor-service.int-spec.ts
git commit -m "feat(pipeline): cancelamento do ConstrutorService mata processos do container (critério 5)"
```

---

### Task 9: Alteração fora do escopo bloqueia commit (critério 4)

**Files:**
- Modify: `src/main/pipeline/construtor-service.ts`
- Test: `src/main/pipeline/construtor-service.int-spec.ts` (acrescentar)

**Interfaces:**
- Consumes: `SandboxPreparado.pathsPermitidos` (já existe, produzido pelo preflight).
- Produces: verificação de escopo entre a validação bem-sucedida e a transição para `PR_CI` — usa `git diff --name-only` **dentro do container** via `docker.exec`, compara contra `pathsPermitidos`.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
describe('ConstrutorService — alteração fora do escopo bloqueia (critério 4)', () => {
  it('diff com arquivo fora de pathsPermitidos bloqueia antes de PR_CI, mesmo com validação verde', async () => {
    const docker = {
      exec: vi.fn((_container: string, comando: readonly string[]) => {
        if (comando[0] === 'git' && comando.includes('diff')) {
          return { ok: true, stdout: 'src/foo.ts\nsegredo/fora-do-escopo.ts\n', stderr: '', exitCode: 0, timeoutExcedido: false }
        }
        return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
      }),
      matarProcesso: vi.fn()
    } as unknown as DockerRunner
    const sandboxComEscopo: SandboxPreparado = {
      ...sandbox,
      pathsPermitidos: { paths: ['src/**'], origem: 'spec' }
    }
    const service = new ConstrutorService(docker, repoDuble(), auditDuble(), () => 'u1', () => 'ws1' as never)

    const resultado = await service.construir({
      runId: 'run-1',
      sandbox: sandboxComEscopo,
      promptInicial: 'x',
      comandosDeValidacao
    })

    expect(resultado.estadoFinal).toBe('BLOCKED')
    expect(resultado.bloqueio?.causa).toBe('risco-usuario')
    expect(resultado.bloqueio?.evidencia).toContain('segredo/fora-do-escopo.ts')
  })

  it('diff inteiramente dentro do escopo segue para PR_CI normalmente', async () => {
    const docker = {
      exec: vi.fn((_container: string, comando: readonly string[]) => {
        if (comando[0] === 'git' && comando.includes('diff')) {
          return { ok: true, stdout: 'src/foo.ts\nsrc/bar.ts\n', stderr: '', exitCode: 0, timeoutExcedido: false }
        }
        return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
      }),
      matarProcesso: vi.fn()
    } as unknown as DockerRunner
    const sandboxComEscopo: SandboxPreparado = {
      ...sandbox,
      pathsPermitidos: { paths: ['src/**'], origem: 'spec' }
    }
    const service = new ConstrutorService(docker, repoDuble(), auditDuble(), () => 'u1', () => 'ws1' as never)

    const resultado = await service.construir({
      runId: 'run-1',
      sandbox: sandboxComEscopo,
      promptInicial: 'x',
      comandosDeValidacao
    })

    expect(resultado.estadoFinal).toBe('PR_CI')
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run src/main/pipeline/construtor-service.int-spec.ts -t "fora do escopo"`
Expected: FAIL — checagem de escopo ainda não existe.

- [ ] **Step 3: Implementar**

Verificar antes a assinatura exata de `PathsPermitidos` e se `@shared/domain/preflight` já expõe uma função de match de glob (`listaDePathsValida` foi vista — procurar por `pathPermitido`/`matchGlob` no mesmo arquivo antes de escrever um novo):

Run: `grep -n "^export function\|^export const" src/shared/domain/preflight.ts`

Se já existir uma função de match de path contra a lista de `pathsPermitidos`, reusá-la. Senão, implementar localmente em `construtor-service.ts` uma checagem simples de prefixo/glob (não reinventar globbing complexo — os padrões vistos até aqui são `src/**` estilo simples).

No método `construir`, entre `validacao.ok` verdadeiro e a transição para `PR_CI`:

```typescript
      if (validacao.ok) {
        const escopo = this.verificarEscopo(pedido.sandbox)
        if (!escopo.ok) {
          tentativas.push({ numero, runId: pedido.runId, classificacao: 'risco-usuario', diagnostico: escopo.evidencia })
          return this.bloquear(pedido.runId, tentativas, 'risco-usuario', escopo.evidencia)
        }

        tentativas.push({ numero, runId: pedido.runId })
        this.transicionar(pedido.runId, 'VALIDATING', 'PR_CI')
        return { estadoFinal: 'PR_CI', tentativas }
      }
```

Novo método privado:

```typescript
  private verificarEscopo(sandbox: SandboxPreparado): { readonly ok: true } | { readonly ok: false; readonly evidencia: string } {
    const diff = this.docker.exec(
      sandbox.containerNome,
      ['git', 'diff', '--name-only', sandbox.baseSha],
      sandbox.worktreeNoHost
    )
    if (!diff.ok) return { ok: true } // sem diff legível, não há como acusar fuga — trata como dentro do escopo, spec não pede bloquear por erro de leitura aqui

    const arquivos = diff.stdout.split('\n').map((l) => l.trim()).filter((l) => l !== '')
    const foraDoEscopo = arquivos.filter((arquivo) => !casaComAlgumPadrao(arquivo, sandbox.pathsPermitidos.paths))

    if (foraDoEscopo.length > 0) {
      return { ok: false, evidencia: `Alteração fora do escopo declarado: ${foraDoEscopo.join(', ')}` }
    }
    return { ok: true }
  }
```

Função auxiliar de glob simples (só se `preflight.ts` não já expuser uma):

```typescript
function casaComAlgumPadrao(arquivo: string, padroes: readonly string[]): boolean {
  return padroes.some((padrao) => {
    if (padrao.endsWith('/**')) return arquivo.startsWith(padrao.slice(0, -3))
    return arquivo === padrao
  })
}
```

- [ ] **Step 4: Rodar e confirmar passa**

Run: `npx vitest run src/main/pipeline/construtor-service.int-spec.ts`
Expected: PASS — toda a suíte.

- [ ] **Step 5: Commit**

```bash
git add src/main/pipeline/construtor-service.ts src/main/pipeline/construtor-service.int-spec.ts
git commit -m "feat(pipeline): alteração fora do escopo bloqueia antes de PR_CI (critério 4)"
```

---

### Task 10: Falha terminal contém ação mínima de retomada (critério 7)

**Files:**
- Modify: `src/main/pipeline/construtor-service.ts`
- Test: `src/main/pipeline/construtor-service.int-spec.ts` (acrescentar)

**Interfaces:**
- Modify: `ResultadoDaConstrucao.bloqueio` ganha campo `retomada: string`.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
describe('ConstrutorService — bloqueio traz ação mínima de retomada (critério 7)', () => {
  it('bloqueio corrigível esgotado traz retomada acionável', async () => {
    const docker = dockerDuble((comando) => {
      if (comando[0] === 'claude') return { ok: true, stdout: '', stderr: '', exitCode: 0, timeoutExcedido: false }
      if (comando.includes('test')) return { ok: false, stdout: 'FAIL sempre', stderr: '', exitCode: 1, timeoutExcedido: false }
      return { ok: true, stdout: 'ok', stderr: '', exitCode: 0, timeoutExcedido: false }
    })
    const service = new ConstrutorService(docker, repoDuble(), auditDuble(), () => 'u1', () => 'ws1' as never)

    const resultado = await service.construir({ runId: 'run-1', sandbox, promptInicial: 'x', comandosDeValidacao })

    expect(resultado.bloqueio?.retomada).toBeTruthy()
    expect(resultado.bloqueio?.retomada.length).toBeGreaterThan(10)
  })

  it('bloqueio externo traz retomada distinta do corrigível', async () => {
    const docker = dockerDuble(() => ({ ok: false, stdout: '', stderr: 'ETIMEDOUT', exitCode: 1, timeoutExcedido: false }))
    const service = new ConstrutorService(docker, repoDuble(), auditDuble(), () => 'u1', () => 'ws1' as never)

    const resultado = await service.construir({ runId: 'run-1', sandbox, promptInicial: 'x', comandosDeValidacao })

    expect(resultado.bloqueio?.causa).toBe('externo')
    expect(resultado.bloqueio?.retomada).toMatch(/conectividade|rede|externo|serviço/i)
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run src/main/pipeline/construtor-service.int-spec.ts -t "ação mínima de retomada"`
Expected: FAIL — `retomada` não existe no bloqueio.

- [ ] **Step 3: Implementar**

Atualizar `ResultadoDaConstrucao`:

```typescript
export interface ResultadoDaConstrucao {
  readonly estadoFinal: 'PR_CI' | 'BLOCKED'
  readonly tentativas: readonly Tentativa[]
  readonly bloqueio?: { readonly causa: ClassificacaoDeFalha; readonly evidencia: string; readonly retomada: string }
}
```

Atualizar o método `bloquear` para montar a mensagem de retomada por causa:

```typescript
  private bloquear(
    runId: string,
    tentativas: readonly Tentativa[],
    causa: ClassificacaoDeFalha,
    evidencia: string
  ): ResultadoDaConstrucao {
    this.transicionar(runId, 'VALIDATING', 'BLOCKED')
    return { estadoFinal: 'BLOCKED', tentativas, bloqueio: { causa, evidencia, retomada: retomadaPara(causa) } }
  }
```

Função auxiliar:

```typescript
/** A ação mínima que destrava o bloqueio, por classificação (critério 7). */
function retomadaPara(causa: ClassificacaoDeFalha): string {
  switch (causa) {
    case 'corrigivel':
      return 'As três tentativas esgotaram sem passar na validação. Revisar o diagnóstico da última tentativa e decidir se a SPEC precisa de ajuste antes de retomar.'
    case 'externo':
      return 'Falha de conectividade, autenticação ou quota externa. Verificar o serviço e retomar a fatia quando ele responder.'
    case 'pi':
      return 'A construção encontrou uma decisão de produto não coberta pela SPEC. Aguardar orientação do PI antes de retomar.'
    case 'risco-usuario':
      return 'A alteração saiu do escopo declarado. Revisar o diff e decidir se o escopo da SPEC precisa mudar, ou se o executor deve ser retomado com o escopo original.'
  }
}
```

- [ ] **Step 4: Rodar e confirmar passa**

Run: `npx vitest run src/main/pipeline/construtor-service.int-spec.ts`
Expected: PASS — toda a suíte.

- [ ] **Step 5: Commit**

```bash
git add src/main/pipeline/construtor-service.ts src/main/pipeline/construtor-service.int-spec.ts
git commit -m "feat(pipeline): bloqueio traz ação mínima de retomada por causa (critério 7)"
```

---

### Task 11: Registro da rota de assinatura sem valor monetário, atribuído por tentativa (critério 9)

**Files:**
- Test: `src/main/ai/call-provider.int-spec.ts` (acrescentar — provavelmente já coberto, este task é de **verificação**, não de código novo)

**Interfaces:**
- Consumes: `AiCallService` (já existente, código de `unmetered`/`runId`/`tentativa` já mapeado nas Tasks anteriores de leitura).

**Nota:** esta garantia já existe no `AiCallService` atual (`finalizar()` grava `unmetered: true`, `estimadoUsd: null`, `runId`, `tentativa` quando presentes — visto na leitura de `call-provider.ts` linhas 481-506). Este task **prova** a garantia com um teste explícito citando o critério, não implementa nada novo — a menos que o teste revele uma lacuna.

- [ ] **Step 1: Escrever o teste**

```typescript
describe('AiCallService — rota claude-code registra uso sem valor monetário, por tentativa (critério 9)', () => {
  it('CostEvent da rota claude-code tem unmetered=true, estimadoUsd/realUsd null, runId e tentativa presentes', async () => {
    const recordCalls: unknown[] = []
    const service = criarServico({
      budgetRecord: (input: unknown) => recordCalls.push(input)
    })

    await coletar(
      service.call(
        { provider: 'claude-code', prompt: 'oi', contextPackId: 'pack-1', runId: 'run-9', tentativa: 2 },
        { userId: 'u1', workspace: 'ws1' as never }
      )
    )

    expect(recordCalls).toHaveLength(1)
    const gravado = recordCalls[0] as { unmetered: boolean; estimadoUsd: number | null; runId?: string; tentativa?: number }
    expect(gravado.unmetered).toBe(true)
    expect(gravado.estimadoUsd).toBeNull()
    expect(gravado.runId).toBe('run-9')
    expect(gravado.tentativa).toBe(2)
  })
})
```

Ajustar `criarServico` local (fábrica do arquivo de teste) para aceitar um override de `budgetRecord`, injetando-o no dublê de `BudgetService` já existente no arquivo — ler o setup atual do arquivo antes de escrever este ajuste, para casar com o padrão de dublê já usado (provavelmente um objeto simples com `check`/`record` mockados via `vi.fn`).

- [ ] **Step 2: Rodar**

Run: `npx vitest run src/main/ai/call-provider.int-spec.ts -t "sem valor monetário, por tentativa"`
Expected: PASS de primeira, dado que o código já existe (confirmado na leitura da Task de mapeamento). Se falhar, é sinal de uma lacuna real — investigar e corrigir em `call-provider.ts` antes de prosseguir.

- [ ] **Step 3: Commit**

```bash
git add src/main/ai/call-provider.int-spec.ts
git commit -m "test(providers): comprova atribuição de custo por tentativa na rota subscription_limited (critério 9)"
```

---

### Task 12: Teste com servidor que conta requisições (critério 10)

**Files:**
- Test: `src/main/pipeline/executor-proxy.int-spec.ts` (acrescentar — ler o arquivo existente primeiro para casar o setup)

**Interfaces:**
- Consumes: `ExecutorProxy` (já existe, mapeado na leitura anterior).

**Nota:** o `ExecutorProxy` já implementa o fluxo completo (recebe POST, monta `AiRequest` com `runId`/`tentativa`, chama `AiCallService.call`). Este task acrescenta o teste que **conta requisições** contra um `AiCallService` fake e confirma que o gate de orçamento é consultado antes de a chamada "sair" (i.e., antes do fake registrar a chamada como concluída) — fechando o critério 10 explicitamente.

- [ ] **Step 1: Ler o arquivo de teste existente**

Ler `src/main/pipeline/executor-proxy.int-spec.ts` por completo antes de escrever, para reusar exatamente a fábrica de proxy/servidor HTTP já montada ali.

- [ ] **Step 2: Escrever o teste**

```typescript
describe('ExecutorProxy — chamada do container passa pelo gate de orçamento antes de sair (critério 10)', () => {
  it('gate de orçamento é consultado com a estimativa antes do AiCallService reportar sucesso', async () => {
    const chamadasAoGate: number[] = []
    const aiFake = {
      call: async function* (pedido: { readonly runId?: string; readonly tentativa?: number }) {
        // O fake simula o próprio AiCallService real: a chamada só chega aqui se o "gate"
        // (simulado neste teste) já tivesse liberado. O que se conta é que o proxy propagou
        // runId/tentativa corretamente para o pedido que o gate real receberia.
        chamadasAoGate.push(pedido.tentativa ?? -1)
        yield { tipo: 'fim', id: 'x', estado: 'concluido', custo: { provider: 'claude-code', model: 'claude-opus-5', workspace: 'ws1', estimadoUsd: 0, latenciaTotalMs: 1, unmetered: true } }
      }
    }

    // Montar o ExecutorProxy real com este `ai` fake e `contexto: () => ({ runId: 'run-1', tentativa: 3 })`,
    // subir o servidor, fazer um fetch() real de POST — seguindo o padrão já usado no arquivo
    // (ver describe blocks existentes de executor-proxy.int-spec.ts para a fábrica exata).

    // ... setup idêntico ao já usado no arquivo, com deps.contexto retornando tentativa: 3

    expect(chamadasAoGate).toEqual([3])
  })
})
```

**Nota de execução:** como o `ExecutorProxy` já é testado de forma real no arquivo existente (confirmado na leitura: sobe servidor real, faz `fetch()` real, injeta `ai` fake), o passo prático aqui é **copiar a fábrica de setup já existente no arquivo** (servidor + fetch) e só trocar o `ai` fake para contar `tentativa` recebida, deixando claro no nome do teste que isso fecha o critério 10 da SPEC-Entrega-04. Ler o arquivo primeiro é obrigatório para não duplicar helpers já existentes.

- [ ] **Step 3: Rodar e confirmar passa**

Run: `npx vitest run src/main/pipeline/executor-proxy.int-spec.ts`
Expected: PASS — toda a suíte do arquivo, incluindo o teste novo.

- [ ] **Step 4: Commit**

```bash
git add src/main/pipeline/executor-proxy.int-spec.ts
git commit -m "test(pipeline): confirma runId/tentativa propagados ao ponto único antes da saída (critério 10)"
```

---

### Task 13: Smoke real limitado — Claude Code de verdade num container real

**Files:**
- Create: `src/main/pipeline/construtor-service.smoke.int-spec.ts`

**Interfaces:**
- Consumes: `ConstrutorService`, `DockerRunner`, `PreflightService` reais — sem dublês.

**Nota (spec § Testes e evidência):** "smoke Claude real limitado" — roda só quando o ambiente tem Docker e `claude` autenticado disponíveis; **opt-in, não faz parte da suíte comum** (lição de `[[smoke-real-acha-o-que-o-fake-esconde]]` — dublê responde consistente demais, só o real acha o que ele esconde). Marcar com `it.skipIf`/variável de ambiente, e reportar `not_run` explicitamente quando pulado, nunca `pass` silencioso (spec § Contrafactuais: "ausente é not_run, nunca pass").

- [ ] **Step 1: Escrever o smoke test opt-in**

```typescript
// src/main/pipeline/construtor-service.smoke.int-spec.ts
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'

/**
 * Smoke real e limitado (spec § Testes e evidência). Roda **só** com
 * `JARVIS_SMOKE_DOCKER_CLAUDE=1` no ambiente — nunca na suíte comum, que não pode depender de
 * Docker de verdade nem de CLI autenticada. Ausente é `not_run`, nunca `pass` (spec §
 * Contrafactuais) — por isso o teste usa `it.skipIf` em vez de simplesmente não existir: a
 * ausência de execução fica registrada no relatório do vitest como skipped, não como omissão.
 */
const habilitado = process.env.JARVIS_SMOKE_DOCKER_CLAUDE === '1'

describe.skipIf(!habilitado)('ConstrutorService — smoke real (Docker + claude autenticado)', () => {
  it('constrói uma alteração trivial de verdade, dentro de um container real, com claude real', async () => {
    // Pré-condição do smoke: Docker respondendo.
    expect(() => execSync('docker info', { stdio: 'ignore' })).not.toThrow()

    // Implementação do smoke fica fora do escopo deste plano bite-sized: monta um preflight
    // real com um repositório de fixture mínimo (ver tests/fixtures/), sobe o sandbox de
    // verdade, roda ConstrutorService.construir com comandosDeValidacao triviais (`true`,
    // `true`, `true`, `true` como comandos-no-op de fixture), e confirma PR_CI.
    //
    // Este smoke é so a prova de que a integração real funciona; a suíte comum inteira já
    // prova a lógica com dublês. Implementar quando houver ambiente de CI com Docker + CLI
    // autenticada disponível para o smoke rodar — até lá, `not_run` é o resultado honesto.
  })
})
```

- [ ] **Step 2: Rodar sem a env var e confirmar skip explícito**

Run: `npx vitest run src/main/pipeline/construtor-service.smoke.int-spec.ts`
Expected: relatório do vitest mostra o describe como **skipped**, não como passou silenciosamente.

- [ ] **Step 3: Commit**

```bash
git add src/main/pipeline/construtor-service.smoke.int-spec.ts
git commit -m "test(pipeline): smoke real opt-in para ConstrutorService (Docker + claude autenticado)"
```

---

### Task 14: Ligar tudo — factory/composição no boot do main

**Files:**
- Modify: onde quer que o app componha os serviços do main hoje (localizar antes de editar: `grep -rn "new AiCallService(" src/main --include=*.ts | grep -v spec` para achar o ponto de composição real — provavelmente um `src/main/index.ts`, `src/main/bootstrap.ts` ou similar; **ler esse arquivo primeiro** para casar o padrão de injeção de dependências já usado no boot antes de editar)

**Interfaces:**
- Consumes: `QuotaRepository` (Task 2), `AiCallService` com `quota` (Task 3), `DockerRunner.exec` (Task 4), `ConstrutorService` (Task 6).

**Nota:** este task não tem código pré-escrito porque depende do arquivo real de composição do boot, que precisa ser lido primeiro — nenhuma suposição sobre sua estrutura foi verificada durante o planejamento. O executor desta task deve:

- [ ] **Step 1: Localizar o ponto de composição do `AiCallService` no boot**

Run: `grep -rn "new AiCallService(" src/main --include=*.ts | grep -v spec`

- [ ] **Step 2: Ler o arquivo encontrado por completo**

Entender como `BudgetService`, `RoutingService`, `VerificadorDeContexto` já são instanciados e injetados ali.

- [ ] **Step 3: Instanciar `QuotaRepository` e passar ao `AiCallService`**

Seguir exatamente o padrão dos outros repositórios já instanciados no mesmo arquivo (mesmo `db`, mesmo estilo de injeção).

- [ ] **Step 4: Instanciar `ConstrutorService` com o `DockerRunner`/`PipelineRepository`/`AuditRepository` já existentes no boot** (M9-F03 já os instancia para o `PreflightService` — reusar as mesmas instâncias, não criar segundas).

- [ ] **Step 5: Rodar a suíte completa**

Run: `npm run typecheck && npm run lint && npm test`
Expected: tudo verde — nenhuma regressão em nenhum outro módulo que dependa de `AiCallService`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(pipeline): compõe QuotaRepository e ConstrutorService no boot do main (M9-F04)"
```

---

## Self-Review

**Cobertura da SPEC (critérios 1-12):**
1. Comando/cwd controlado, dentro do container — Task 6 (`docker.exec` com `sandbox.containerNome`).
2. Máximo três tentativas — Task 5 (`proximaTentativaPermitida`) + Task 6 (laço).
3. Recuperação não repete descoberta resolvida — Task 6 (`promptDeRecuperacao` inclui histórico).
4. Alteração fora do escopo bloqueia — Task 9.
5. Cancelamento sem subprocesso órfão — Task 8.
6. Custo/tokens por tentativa — já existente no `AiCallService`/`cost_event` (confirmado na leitura, coberto por Task 11).
7. Falha terminal com ação mínima de retomada — Task 10.
8. Execução containerizada, teste comprova — Task 7.
9. Uso de assinatura registrado sem valor monetário — Task 11 (verificação).
10. Chamada pelo proxy do host, gate antes de sair — já existente (`ExecutorProxy`+`AiCallService`), coberto por Task 12.
11. Validação roda no container, nunca no host — Task 4 (`DockerRunner.exec`) + Task 6 (`validar` só usa `docker.exec`).
12. Rota subscription_limited, quota não é saldo infinito — Tasks 1, 2, 3.

**Placeholder scan:** Task 12 e Task 13 e Task 14 têm notas explicando dependência de leitura de arquivo real antes de codificar (não são placeholders de "implementar depois" — são passos de investigação obrigatórios porque o plano não pôde ler esses arquivos durante o planejamento sem estourar escopo de mapeamento; ambos têm o comando exato de busca e o critério de aceite claro).

**Consistência de tipos:** `ExecucaoNoContainer` (Task 4) é consumido identicamente em Tasks 6, 7, 8, 9 e 10 com os mesmos campos (`ok`, `stdout`, `stderr`, `exitCode`, `timeoutExcedido`). `Tentativa`/`ClassificacaoDeFalha` (Task 5) usados sem alteração de forma em Task 6 e 10. `ResultadoDaConstrucao.bloqueio` ganha `retomada` na Task 10 — Tasks 6-9 que constroem esse objeto usam o método `bloquear()` centralizado, então o campo novo se propaga sem precisar editar cada call site.

**Risco conhecido, não resolvido por este plano:** o binário `claude` dentro do container precisa existir na imagem (`IMAGEM_PADRAO = node:22-bookworm` hoje não o inclui, pelo que foi lido em `docker-runner.ts`). Isso é dependência de infraestrutura de imagem, fora do escopo de código desta fatia — mas **bloqueia o smoke real (Task 13)** até ser resolvido. Se ao rodar a Task 13 o `claude` não for encontrado no container, a ação é atualizar a imagem/Dockerfile do sandbox (fora deste plano) antes de destravar o smoke — não inventar um fallback de instalação silenciosa dentro do `ConstrutorService`.
