# M9-F06 — Evidência, limpeza e continuidade — Plano de implementação

> **Para executores agênticos:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa. Os passos usam checkbox (`- [ ]`) para rastreio.

**Objetivo:** fechar a execução de um run com prova verificável (`ExecutionLedger`), limpeza reconciliável de recursos temporários, coletor de retenção de artefatos e um painel que explica o estado terminal sem log técnico.

**Arquitetura:** três camadas, na mesma divisão que as fatias anteriores do MVP-009 usam. O domínio puro (`src/shared/domain/`) decide *o que* conta como ledger completo, *o que* a limpeza precisa preservar por fase e *o que* é elegível para expirar — sem tocar disco, Docker ou banco. O main (`src/main/pipeline/`) executa: repositório SQLite do ledger, `LimpezaService` sobre `DockerRunner`/`GitRunner`/`LeaseRepository` e o coletor de retenção. A fronteira IPC ganha dois canais só de leitura, e o painel React os consome.

**Stack:** TypeScript, Electron, better-sqlite3, Vitest, Playwright-Electron, React.

**Spec:** `docs/spec/spec-entrega-06-evidencia-limpeza-continuidade.md` (`aprovada-pi` 2026-08-29, emendada 2026-08-30).

**Issue:** [#106](https://github.com/RodReis/rrb-jarvisOS/issues/106) — sub-issue do épico [#100](https://github.com/RodReis/rrb-jarvisOS/issues/100). Depende de M9-F05 (#105, finalizada).

## Restrições globais

- **Branch:** `feat/m9-f06-evidencia-limpeza-continuidade`. Nunca commit direto na `main`.
- **PR:** corpo com `refs #106`. **Nunca `closes #106`** — fecharia a issue no merge e forjaria o aceite do PI.
- **Idioma:** documentação, specs, commits e comentários em pt-BR; código e identificadores em inglês. Mensagens de UI em pt-BR via i18n.
- **Renderer nunca acessa Node, segredo ou comando.** IPC mínimo e tipado via preload; os dois canais novos são **só leitura**.
- **Toda entidade persistida carrega escopo:** `user_id` obrigatório; `project_id` e `workspace_id` quando aplicável (CONVENTION §2).
- **`docker stop`, nunca `docker rm` via `TerminalEngine`.** `rm|rmi|prune|down` casa a política de destrutivos do MVP-004 e abriria `ApprovalRequest`, travando a limpeza num gate humano. A remoção desta fatia usa a via decidida na Task 5.
- **Relatório de testes:** `reports/TESTS.md`, gerado do `--json` dos runners (ADR-003, `docs/TESTING.md` §4). **Nunca sob `docs/`**, nunca editado à mão.
- **Retenção:** expiração em **30 dias** ou cota global de **5 GB**, removendo primeiro o elegível mais antigo. Item fixado e run ativo/bloqueado/pendente **não** expiram.
- **Teto de espera do CI:** `TETO_DE_ESPERA_PADRAO_MS = 30 * 60 * 1000` (já em `entrega-service.ts`).
- **Piso de validação:** `npm run lint`, `npm run typecheck`, `npm test` verdes.
- **Estados terminais existentes** (`src/shared/domain/pipeline.ts`): `MERGED`, `AWAITING_MERGE`, `BLOCKED`, `CANCELLED`. Esta fatia **não** adiciona estado novo.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/shared/domain/execution-ledger.ts` (criar) | O contrato do ledger: duração, tentativas, tokens, créditos, custo, eventos e a evidência por hash. Puro. |
| `src/shared/domain/limpeza.ts` (criar) | O que a limpeza preserva **por fase de cancelamento** e o que é pendência reconciliável. Puro. |
| `src/shared/domain/retencao.ts` (criar) | A política de expiração: idade, cota, fixação e proteção de run não resolvido. Puro. |
| `src/main/storage/migrations.ts` (modificar) | Migration 28 (`execution_ledger`) e 29 (`artefato_retido`). |
| `src/main/pipeline/execution-ledger-repository.ts` (criar) | Persistência do ledger, escopada por `user_id`. |
| `src/main/pipeline/limpeza-service.ts` (criar) | Executa a limpeza: worktree, container, rede, sidecar, leases e portas. Registra pendência quando falha. |
| `src/main/pipeline/retencao-service.ts` (criar) | O coletor: aplica `retencao.ts` sobre `artefato_retido` e apaga o anexo pesado. |
| `src/main/pipeline/entrega-service.ts` (modificar) | Encerramento: grava o ledger e chama a limpeza ao terminar (qualquer terminal). |
| `src/shared/contracts/ipc.ts` (modificar) | Canais `ledger:do-run` e `limpeza:pendencias`, só leitura. |
| `src/main/ipc/handlers.ts` (modificar) | Handlers dos dois canais. |
| `src/main/preload/index.ts` (modificar) | Exposição dos dois métodos na ponte. |
| `src/renderer/.../PainelDeEntrega.tsx` (criar) | O painel: resultado, custo, evidência e próxima decisão; Git/logs expansíveis. |

---

### Task 1: O contrato do `ExecutionLedger`

**Arquivos:**
- Criar: `src/shared/domain/execution-ledger.ts`
- Teste: `src/shared/domain/execution-ledger.spec.ts`

**Interfaces:**
- Consome: `EstadoDoRun` de `./pipeline`.
- Produz: `interface ExecutionLedger`, `interface ArtefatoReferenciado`, `function ledgerCompleto(l: ExecutionLedger): boolean`, `function resumoDoLedger(l: ExecutionLedger): ResumoDoLedger`.

O ledger é o **critério 1 e 2**: `MERGED` só é coerente com head SHA, checks e merge SHA presentes; e todo artefato extenso entra por **hash**, nunca por conteúdo inline. `ledgerCompleto` é o predicado que torna a incoerência inexprimível em vez de improvável.

- [ ] **Passo 1: escrever o teste que falha**

```ts
import { describe, expect, it } from 'vitest'
import { ledgerCompleto, resumoDoLedger } from './execution-ledger'
import type { ExecutionLedger } from './execution-ledger'

const base: ExecutionLedger = {
  runId: 'run-1',
  userId: 'user-1',
  projectId: 'proj-1',
  estadoFinal: 'MERGED',
  duracaoMs: 1000,
  tentativas: 1,
  tokens: 100,
  creditos: 2,
  custoUsd: 0.5,
  eventos: [{ em: '2026-09-02T00:00:00.000Z', o_que: 'run-iniciado' }],
  headSha: 'a'.repeat(40),
  mergeSha: 'b'.repeat(40),
  checks: [{ nome: 'validacao', conclusao: 'success' }],
  artefatos: [],
  encerradoEm: '2026-09-02T00:10:00.000Z'
}

describe('ledgerCompleto', () => {
  it('aceita MERGED com head, merge e checks coerentes', () => {
    expect(ledgerCompleto(base)).toBe(true)
  })

  it('recusa MERGED sem merge SHA — o critério 1 não admite merge deduzido', () => {
    expect(ledgerCompleto({ ...base, mergeSha: undefined })).toBe(false)
  })

  it('recusa MERGED sem check algum: merge sem verificação não é coerente', () => {
    expect(ledgerCompleto({ ...base, checks: [] })).toBe(false)
  })

  it('aceita AWAITING_MERGE sem merge SHA — é terminal legítimo, não falha', () => {
    const esperando: ExecutionLedger = {
      ...base,
      estadoFinal: 'AWAITING_MERGE',
      mergeSha: undefined
    }
    expect(ledgerCompleto(esperando)).toBe(true)
  })

  it('recusa artefato sem hash: prova referenciada por caminho some quando o arquivo sai', () => {
    const semHash = {
      ...base,
      artefatos: [{ nome: 'reports/TESTS.md', hash: '', bytes: 10 }]
    }
    expect(ledgerCompleto(semHash)).toBe(false)
  })
})

describe('resumoDoLedger', () => {
  it('devolve o que a tela mostra sem log técnico', () => {
    const resumo = resumoDoLedger(base)
    expect(resumo.estadoFinal).toBe('MERGED')
    expect(resumo.custoUsd).toBe(0.5)
    expect(resumo.duracaoMs).toBe(1000)
    expect(resumo.artefatos).toHaveLength(0)
  })
})
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx vitest run src/shared/domain/execution-ledger.spec.ts`
Esperado: FAIL — o módulo não existe.

- [ ] **Passo 3: implementar o mínimo**

```ts
/**
 * A prova de que um run aconteceu (SPEC-Entrega-06, critérios 1 e 2).
 *
 * **Artefato entra por hash, nunca inline.** O relatório de testes e os logs do container são
 * grandes e mudam a cada run; embuti-los no ledger faria a evidência crescer sem limite e
 * duplicaria o que já está versionado no PR. O hash é o que liga o ledger ao artefato sem
 * copiá-lo — e é o que permite a retenção apagar o anexo pesado (Task 3) sem apagar a prova.
 *
 * **O que este arquivo não faz:** não lê banco, não calcula hash, não decide quando encerrar.
 */
import type { EstadoDoRun } from './pipeline'

/** Um artefato extenso, referenciado — nunca embutido. */
export interface ArtefatoReferenciado {
  readonly nome: string
  /** SHA-256 em hex. Vazio é inválido: sem hash a referência não prova nada. */
  readonly hash: string
  readonly bytes: number
}

export interface EventoDoLedger {
  readonly em: string
  readonly o_que: string
}

export interface CheckDoLedger {
  readonly nome: string
  readonly conclusao: string
}

export interface ExecutionLedger {
  readonly runId: string
  readonly userId: string
  readonly projectId: string
  readonly estadoFinal: EstadoDoRun
  readonly duracaoMs: number
  readonly tentativas: number
  readonly tokens: number
  readonly creditos: number
  readonly custoUsd: number
  readonly eventos: readonly EventoDoLedger[]
  readonly headSha?: string
  readonly mergeSha?: string
  readonly checks: readonly CheckDoLedger[]
  readonly artefatos: readonly ArtefatoReferenciado[]
  readonly encerradoEm: string
}

export interface ResumoDoLedger {
  readonly estadoFinal: EstadoDoRun
  readonly duracaoMs: number
  readonly custoUsd: number
  readonly tentativas: number
  readonly artefatos: readonly ArtefatoReferenciado[]
}

/**
 * O ledger é coerente com o estado que declara?
 *
 * `MERGED` exige head, merge e ao menos um check: é o critério 1. `AWAITING_MERGE` não exige
 * merge SHA — é terminal legítimo do kill-switch desligado, não uma falha (M9-F02).
 */
export function ledgerCompleto(ledger: ExecutionLedger): boolean {
  if (ledger.artefatos.some((a) => a.hash.trim() === '')) return false

  if (ledger.estadoFinal === 'MERGED') {
    return (
      typeof ledger.headSha === 'string' &&
      ledger.headSha !== '' &&
      typeof ledger.mergeSha === 'string' &&
      ledger.mergeSha !== '' &&
      ledger.checks.length > 0
    )
  }

  return true
}

/** O que a tela mostra. Detalhe técnico fica no ledger inteiro, atrás de um expansor. */
export function resumoDoLedger(ledger: ExecutionLedger): ResumoDoLedger {
  return {
    estadoFinal: ledger.estadoFinal,
    duracaoMs: ledger.duracaoMs,
    custoUsd: ledger.custoUsd,
    tentativas: ledger.tentativas,
    artefatos: ledger.artefatos
  }
}
```

- [ ] **Passo 4: rodar e ver passar**

Run: `npx vitest run src/shared/domain/execution-ledger.spec.ts`
Esperado: PASS.

- [ ] **Passo 5: commit**

```bash
git add src/shared/domain/execution-ledger.ts src/shared/domain/execution-ledger.spec.ts
git commit -m "feat(entrega): contrato do ExecutionLedger com artefato por hash

refs #106"
```

---

### Task 2: A política de limpeza por fase de cancelamento

**Arquivos:**
- Criar: `src/shared/domain/limpeza.ts`
- Teste: `src/shared/domain/limpeza.spec.ts`

**Interfaces:**
- Produz: `const FASES_DE_CANCELAMENTO`, `type FaseDeCancelamento`, `interface PlanoDeLimpeza`, `function planoDeLimpeza(fase: FaseDeCancelamento): PlanoDeLimpeza`, `const RECURSOS_LIMPAVEIS`.

Este é o **critério 8**: cancelar depois do push preserva PR e branch; depois do merge não muda o resultado. A spec crava *"nunca apaga branch ou PR, e nunca cria revert automático"*. Uma tabela por fase torna isso auditável de relance, como `TRANSICOES` fez para a máquina de estados.

- [ ] **Passo 1: escrever o teste que falha**

```ts
import { describe, expect, it } from 'vitest'
import { planoDeLimpeza } from './limpeza'

describe('planoDeLimpeza', () => {
  it('antes do executor não há efeito a desfazer', () => {
    const plano = planoDeLimpeza('antes-do-executor')
    expect(plano.mataProcessos).toBe(false)
    expect(plano.preservaBranch).toBe(true)
    expect(plano.preservaPr).toBe(true)
  })

  it('durante a execução mata a árvore de processos e preserva o snapshot', () => {
    const plano = planoDeLimpeza('durante-execucao')
    expect(plano.mataProcessos).toBe(true)
    expect(plano.preservaSnapshot).toBe(true)
  })

  it('depois do push preserva branch e PR e converte o PR para rascunho', () => {
    const plano = planoDeLimpeza('depois-do-push')
    expect(plano.preservaBranch).toBe(true)
    expect(plano.preservaPr).toBe(true)
    expect(plano.convertePrParaRascunho).toBe(true)
  })

  it('depois do merge o resultado continua MERGED — nada é desfeito', () => {
    const plano = planoDeLimpeza('depois-do-merge')
    expect(plano.preservaBranch).toBe(true)
    expect(plano.preservaPr).toBe(true)
    expect(plano.convertePrParaRascunho).toBe(false)
  })

  it('nenhuma fase apaga branch, PR ou cria revert', () => {
    const fases = [
      'antes-do-executor',
      'durante-execucao',
      'depois-do-push',
      'durante-ci',
      'depois-do-merge'
    ] as const
    for (const fase of fases) {
      const plano = planoDeLimpeza(fase)
      expect(plano.preservaBranch).toBe(true)
      expect(plano.preservaPr).toBe(true)
      expect(plano.criaRevert).toBe(false)
    }
  })

  it('volume persistente nunca é removido, mesmo órfão', () => {
    const plano = planoDeLimpeza('depois-do-merge')
    expect(plano.removeVolumePersistente).toBe(false)
  })
})
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx vitest run src/shared/domain/limpeza.spec.ts`
Esperado: FAIL — o módulo não existe.

- [ ] **Passo 3: implementar o mínimo**

```ts
/**
 * O que a limpeza preserva, por fase (SPEC-Entrega-06, critério 8).
 *
 * **Tabela, não `if`** — mesma postura de `TRANSICOES` em `pipeline.ts`. A regra que importa é
 * negativa (*"nunca apaga branch ou PR, e nunca cria revert automático"*), e uma tabela permite
 * ler de relance que nenhuma fase a viola. Espalhado em condicionais, o dia em que alguém
 * escrevesse a condição errada apagaria trabalho — o oposto do que a limpeza existe para fazer.
 */
export const FASES_DE_CANCELAMENTO = [
  'antes-do-executor',
  'durante-execucao',
  'depois-do-push',
  'durante-ci',
  'depois-do-merge'
] as const

export type FaseDeCancelamento = (typeof FASES_DE_CANCELAMENTO)[number]

export interface PlanoDeLimpeza {
  readonly mataProcessos: boolean
  readonly preservaSnapshot: boolean
  readonly preservaBranch: boolean
  readonly preservaPr: boolean
  readonly convertePrParaRascunho: boolean
  readonly paraMonitoramentoDeCi: boolean
  readonly criaRevert: boolean
  readonly removeVolumePersistente: boolean
}

const PLANOS: Readonly<Record<FaseDeCancelamento, PlanoDeLimpeza>> = {
  // Nada rodou: não há efeito a desfazer.
  'antes-do-executor': {
    mataProcessos: false,
    preservaSnapshot: true,
    preservaBranch: true,
    preservaPr: true,
    convertePrParaRascunho: false,
    paraMonitoramentoDeCi: false,
    criaRevert: false,
    removeVolumePersistente: false
  },
  // O executor está escrevendo: mata a árvore de processos, guarda o que ele já produziu.
  'durante-execucao': {
    mataProcessos: true,
    preservaSnapshot: true,
    preservaBranch: true,
    preservaPr: true,
    convertePrParaRascunho: false,
    paraMonitoramentoDeCi: false,
    criaRevert: false,
    removeVolumePersistente: false
  },
  // O trabalho já está no remoto: preservar é a única opção segura.
  'depois-do-push': {
    mataProcessos: true,
    preservaSnapshot: true,
    preservaBranch: true,
    preservaPr: true,
    convertePrParaRascunho: true,
    paraMonitoramentoDeCi: false,
    criaRevert: false,
    removeVolumePersistente: false
  },
  'durante-ci': {
    mataProcessos: true,
    preservaSnapshot: true,
    preservaBranch: true,
    preservaPr: true,
    convertePrParaRascunho: true,
    paraMonitoramentoDeCi: true,
    criaRevert: false,
    removeVolumePersistente: false
  },
  // Mergeado é fato consumado: cancelar não muda o resultado.
  'depois-do-merge': {
    mataProcessos: false,
    preservaSnapshot: true,
    preservaBranch: true,
    preservaPr: true,
    convertePrParaRascunho: false,
    paraMonitoramentoDeCi: true,
    criaRevert: false,
    removeVolumePersistente: false
  }
}

export function planoDeLimpeza(fase: FaseDeCancelamento): PlanoDeLimpeza {
  return PLANOS[fase]
}

/** Os recursos que a limpeza remove. Volume persistente não está na lista, de propósito. */
export const RECURSOS_LIMPAVEIS = ['worktree', 'container', 'rede', 'sidecar', 'porta'] as const

export type RecursoLimpavel = (typeof RECURSOS_LIMPAVEIS)[number]

/** Uma remoção que não deu certo. Não desfaz o merge, mas fica reconciliável (critério 5). */
export interface PendenciaDeLimpeza {
  readonly runId: string
  readonly recurso: RecursoLimpavel
  readonly identificador: string
  readonly motivo: string
  readonly em: string
}
```

- [ ] **Passo 4: rodar e ver passar**

Run: `npx vitest run src/shared/domain/limpeza.spec.ts`
Esperado: PASS.

- [ ] **Passo 5: commit**

```bash
git add src/shared/domain/limpeza.ts src/shared/domain/limpeza.spec.ts
git commit -m "feat(entrega): plano de limpeza por fase de cancelamento

refs #106"
```

---

### Task 3: A política de retenção

**Arquivos:**
- Criar: `src/shared/domain/retencao.ts`
- Teste: `src/shared/domain/retencao.spec.ts`

**Interfaces:**
- Produz: `const RETENCAO_DIAS = 30`, `const COTA_BYTES = 5 * 1024 ** 3`, `interface ArtefatoRetido`, `function elegiveisParaExpirar(itens, agoraMs): readonly ArtefatoRetido[]`.

Este é o **critério 9**: idade, cota, fixação e proteção de run não resolvido, e nunca deixar referência versionada apontando para conteúdo que ela afirme presente. Por isso o coletor devolve **quais** itens saem e o serviço marca a referência como expirada no mesmo passo.

- [ ] **Passo 1: escrever o teste que falha**

```ts
import { describe, expect, it } from 'vitest'
import { COTA_BYTES, RETENCAO_DIAS, elegiveisParaExpirar } from './retencao'
import type { ArtefatoRetido } from './retencao'

const DIA_MS = 24 * 60 * 60 * 1000
const AGORA = Date.parse('2026-09-02T00:00:00.000Z')

function item(over: Partial<ArtefatoRetido>): ArtefatoRetido {
  return {
    id: 'a1',
    runId: 'run-1',
    hash: 'h'.repeat(64),
    bytes: 1024,
    criadoEm: new Date(AGORA - DIA_MS).toISOString(),
    fixado: false,
    estadoDoRun: 'MERGED',
    ...over
  }
}

describe('elegiveisParaExpirar', () => {
  it('expira o que passou de 30 dias', () => {
    const velho = item({ id: 'velho', criadoEm: new Date(AGORA - 31 * DIA_MS).toISOString() })
    const novo = item({ id: 'novo' })
    const saem = elegiveisParaExpirar([velho, novo], AGORA)
    expect(saem.map((i) => i.id)).toEqual(['velho'])
  })

  it('nunca expira item fixado, por mais velho que seja', () => {
    const fixado = item({
      id: 'fixado',
      fixado: true,
      criadoEm: new Date(AGORA - 900 * DIA_MS).toISOString()
    })
    expect(elegiveisParaExpirar([fixado], AGORA)).toEqual([])
  })

  it('nunca expira artefato de run ativo, bloqueado ou pendente', () => {
    const naoResolvidos = ['RUNNING', 'PR_CI', 'BLOCKED', 'AWAITING_MERGE'] as const
    for (const estado of naoResolvidos) {
      const preso = item({
        id: estado,
        estadoDoRun: estado,
        criadoEm: new Date(AGORA - 400 * DIA_MS).toISOString()
      })
      expect(elegiveisParaExpirar([preso], AGORA)).toEqual([])
    }
  })

  it('estourada a cota, remove primeiro o elegível mais antigo', () => {
    const metadeDaCota = COTA_BYTES / 2 + 1
    const antigo = item({
      id: 'antigo',
      bytes: metadeDaCota,
      criadoEm: new Date(AGORA - 3 * DIA_MS).toISOString()
    })
    const recente = item({
      id: 'recente',
      bytes: metadeDaCota,
      criadoEm: new Date(AGORA - 1 * DIA_MS).toISOString()
    })
    const saem = elegiveisParaExpirar([recente, antigo], AGORA)
    expect(saem.map((i) => i.id)).toEqual(['antigo'])
  })

  it('a cota não força expirar item protegido — protegido sai da conta, não da proteção', () => {
    const protegido = item({ id: 'p', bytes: COTA_BYTES * 2, estadoDoRun: 'RUNNING' })
    expect(elegiveisParaExpirar([protegido], AGORA)).toEqual([])
  })

  it('RETENCAO_DIAS e COTA_BYTES são os valores que a spec fixa', () => {
    expect(RETENCAO_DIAS).toBe(30)
    expect(COTA_BYTES).toBe(5 * 1024 ** 3)
  })
})
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx vitest run src/shared/domain/retencao.spec.ts`
Esperado: FAIL — o módulo não existe.

- [ ] **Passo 3: implementar o mínimo**

```ts
/**
 * Quando um anexo pesado pode sair (SPEC-Entrega-06, critério 9).
 *
 * **O que sai é o anexo, nunca a prova.** Metadados, hashes, auditoria e relatórios versionados
 * permanecem: a spec é explícita. Por isso o coletor devolve os itens elegíveis em vez de apagar
 * por conta própria — quem marca a referência como expirada no mesmo passo é o serviço, e essa
 * ordem é o que impede uma referência versionada apontar para conteúdo que ela afirme presente.
 *
 * **Proteção vence cota.** Um run não resolvido pode sozinho estourar os 5 GB; expirá-lo para
 * caber na cota apagaria a evidência de que alguém ainda precisa. A cota corta o que já acabou.
 */
import type { EstadoDoRun } from './pipeline'
import { ehTerminal } from './pipeline'

export const RETENCAO_DIAS = 30
export const COTA_BYTES = 5 * 1024 ** 3

export interface ArtefatoRetido {
  readonly id: string
  readonly runId: string
  readonly hash: string
  readonly bytes: number
  readonly criadoEm: string
  readonly fixado: boolean
  readonly estadoDoRun: EstadoDoRun
}

/**
 * `AWAITING_MERGE` é terminal na máquina de estados, mas **pendente** para a retenção: o PI
 * ainda vai olhar aquele PR, e o anexo é o que ele lê. `BLOCKED` idem — é a evidência da causa.
 */
function protegido(item: ArtefatoRetido): boolean {
  if (item.fixado) return true
  if (!ehTerminal(item.estadoDoRun)) return true
  return item.estadoDoRun === 'AWAITING_MERGE' || item.estadoDoRun === 'BLOCKED'
}

export function elegiveisParaExpirar(
  itens: readonly ArtefatoRetido[],
  agoraMs: number
): readonly ArtefatoRetido[] {
  const candidatos = itens
    .filter((i) => !protegido(i))
    .slice()
    .sort((a, b) => Date.parse(a.criadoEm) - Date.parse(b.criadoEm))

  const limiteDeIdade = agoraMs - RETENCAO_DIAS * 24 * 60 * 60 * 1000
  const porIdade = candidatos.filter((i) => Date.parse(i.criadoEm) < limiteDeIdade)
  const saem = new Set(porIdade.map((i) => i.id))

  // A cota conta tudo o que ficou — protegido incluído: ele ocupa disco de verdade.
  let ocupado = itens
    .filter((i) => !saem.has(i.id))
    .reduce((total, i) => total + i.bytes, 0)

  for (const candidato of candidatos) {
    if (ocupado <= COTA_BYTES) break
    if (saem.has(candidato.id)) continue
    saem.add(candidato.id)
    ocupado -= candidato.bytes
  }

  return candidatos.filter((i) => saem.has(i.id))
}
```

- [ ] **Passo 4: rodar e ver passar**

Run: `npx vitest run src/shared/domain/retencao.spec.ts`
Esperado: PASS.

- [ ] **Passo 5: commit**

```bash
git add src/shared/domain/retencao.ts src/shared/domain/retencao.spec.ts
git commit -m "feat(entrega): política de retenção por idade, cota, fixação e proteção

refs #106"
```

---

### Task 4: Migrations 28 e 29 + repositório do ledger

**Arquivos:**
- Modificar: `src/main/storage/migrations.ts` (acrescentar dois elementos ao array `MIGRATIONS`, ao final; `SCHEMA_VERSION` é derivado do tamanho e não precisa de edição)
- Criar: `src/main/pipeline/execution-ledger-repository.ts`
- Teste: `src/main/pipeline/execution-ledger-repository.int-spec.ts`

**Interfaces:**
- Consome: `ExecutionLedger` e `ArtefatoReferenciado` (Task 1), `ArtefatoRetido` (Task 3), `PendenciaDeLimpeza` (Task 2).
- Produz: `class ExecutionLedgerRepository` com `registrar(ledger: ExecutionLedger): void`, `buscar(userId: string, runId: string): ExecutionLedger | undefined`, `registrarArtefato(userId, item: ArtefatoRetido): void`, `listarArtefatos(userId: string): readonly ArtefatoRetido[]`, `marcarExpirado(userId: string, id: string): void`, `registrarPendencia(userId, p: PendenciaDeLimpeza): void`, `listarPendencias(userId: string): readonly PendenciaDeLimpeza[]`.

O ledger é **append-only por run**: gravar duas vezes o mesmo run é reescrever a prova. `UNIQUE(user_id, run_id)` é o que garante isso no schema, não só no código — a mesma postura da decisão 4 da Fatia 04 do MVP-001.

- [ ] **Passo 1: escrever o teste que falha**

```ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ExecutionLedger } from '@shared/domain/execution-ledger'
import { migrate } from '../storage/migrations'
import { ExecutionLedgerRepository } from './execution-ledger-repository'

let dir: string
let db: Database.Database
let repo: ExecutionLedgerRepository

const ledger: ExecutionLedger = {
  runId: 'run-1',
  userId: 'user-1',
  projectId: 'proj-1',
  estadoFinal: 'MERGED',
  duracaoMs: 1000,
  tentativas: 2,
  tokens: 300,
  creditos: 4,
  custoUsd: 1.25,
  eventos: [{ em: '2026-09-02T00:00:00.000Z', o_que: 'run-iniciado' }],
  headSha: 'a'.repeat(40),
  mergeSha: 'b'.repeat(40),
  checks: [{ nome: 'validacao', conclusao: 'success' }],
  artefatos: [{ nome: 'reports/TESTS.md', hash: 'c'.repeat(64), bytes: 2048 }],
  encerradoEm: '2026-09-02T00:10:00.000Z'
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-'))
  db = new Database(join(dir, 'app.db'))
  migrate(db)
  repo = new ExecutionLedgerRepository(db)
})

afterEach(() => {
  db.close()
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
})

describe('ExecutionLedgerRepository', () => {
  it('grava e lê o ledger inteiro, artefatos inclusive', () => {
    repo.registrar(ledger)
    const lido = repo.buscar('user-1', 'run-1')
    expect(lido).toEqual(ledger)
  })

  it('não vaza ledger de outro usuário', () => {
    repo.registrar(ledger)
    expect(repo.buscar('outro', 'run-1')).toBeUndefined()
  })

  it('recusa regravar o mesmo run: o ledger é a prova, não um rascunho', () => {
    repo.registrar(ledger)
    expect(() => repo.registrar(ledger)).toThrow()
  })

  it('marca artefato expirado sem apagar a linha — o hash continua sendo prova', () => {
    repo.registrar(ledger)
    repo.registrarArtefato('user-1', {
      id: 'art-1',
      runId: 'run-1',
      hash: 'c'.repeat(64),
      bytes: 2048,
      criadoEm: '2026-08-01T00:00:00.000Z',
      fixado: false,
      estadoDoRun: 'MERGED'
    })
    repo.marcarExpirado('user-1', 'art-1')
    const restantes = repo.listarArtefatos('user-1')
    expect(restantes).toHaveLength(0)
    const row = db
      .prepare('SELECT expirado_em FROM artefato_retido WHERE id = ?')
      .get('art-1') as { expirado_em: string | null }
    expect(row.expirado_em).not.toBeNull()
  })

  it('guarda pendência de limpeza para a reconciliação encontrar', () => {
    repo.registrarPendencia('user-1', {
      runId: 'run-1',
      recurso: 'container',
      identificador: 'jarvisos-run-1',
      motivo: 'docker indisponível',
      em: '2026-09-02T00:11:00.000Z'
    })
    expect(repo.listarPendencias('user-1')).toHaveLength(1)
  })
})
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx vitest run src/main/pipeline/execution-ledger-repository.int-spec.ts`
Esperado: FAIL — o módulo e as tabelas não existem.

- [ ] **Passo 3: acrescentar as migrations**

Ao final do array `MIGRATIONS` em `src/main/storage/migrations.ts` (depois da migration 27, `ruleset_snapshot`), acrescente:

```ts
  ,
  // 28 — ExecutionLedger (SPEC-Entrega-06). `UNIQUE(user_id, run_id)`: a prova é uma por run.
  `
  CREATE TABLE execution_ledger (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    project_id    TEXT NOT NULL,
    run_id        TEXT NOT NULL,
    estado_final  TEXT NOT NULL,
    duracao_ms    INTEGER NOT NULL,
    tentativas    INTEGER NOT NULL,
    tokens        INTEGER NOT NULL,
    creditos      REAL NOT NULL,
    custo_usd     REAL NOT NULL,
    eventos       TEXT NOT NULL,
    head_sha      TEXT,
    merge_sha     TEXT,
    checks        TEXT NOT NULL,
    artefatos     TEXT NOT NULL,
    encerrado_em  TEXT NOT NULL,
    UNIQUE(user_id, run_id)
  );
  CREATE INDEX idx_execution_ledger_run ON execution_ledger(user_id, run_id);
  `,
  // 29 — retenção e pendência de limpeza (SPEC-Entrega-06, critérios 5 e 9).
  `
  CREATE TABLE artefato_retido (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    run_id        TEXT NOT NULL,
    hash          TEXT NOT NULL,
    bytes         INTEGER NOT NULL,
    criado_em     TEXT NOT NULL,
    fixado        INTEGER NOT NULL,
    estado_do_run TEXT NOT NULL,
    expirado_em   TEXT
  );
  CREATE INDEX idx_artefato_retido_user ON artefato_retido(user_id, criado_em);

  CREATE TABLE pendencia_de_limpeza (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    run_id        TEXT NOT NULL,
    recurso       TEXT NOT NULL,
    identificador TEXT NOT NULL,
    motivo        TEXT NOT NULL,
    em            TEXT NOT NULL,
    resolvida_em  TEXT
  );
  CREATE INDEX idx_pendencia_limpeza_user ON pendencia_de_limpeza(user_id, em);
  `
```

- [ ] **Passo 4: implementar o repositório**

```ts
/**
 * Persistência da prova de um run (SPEC-Entrega-06).
 *
 * **Append-only por run, ao contrário de `external_ref`.** Aquele guarda *onde o recurso está* —
 * um fato que muda. Este guarda *o que aconteceu*, e reescrever apagaria a evidência. O
 * `UNIQUE(user_id, run_id)` faz o banco recusar a segunda gravação em vez de confiar em
 * disciplina do chamador; retomada cria run novo (`continuaDe`), não regrava o antigo.
 *
 * **Expirar não apaga a linha.** `expirado_em` marca que o anexo pesado saiu; hash, bytes e
 * data continuam, porque a prova é o hash, e a spec manda preservá-la.
 */
import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { EstadoDoRun } from '@shared/domain/pipeline'
import type {
  ArtefatoReferenciado,
  CheckDoLedger,
  EventoDoLedger,
  ExecutionLedger
} from '@shared/domain/execution-ledger'
import type { PendenciaDeLimpeza, RecursoLimpavel } from '@shared/domain/limpeza'
import type { ArtefatoRetido } from '@shared/domain/retencao'
import { log } from '../logging/logger'

interface LedgerRow {
  readonly user_id: string
  readonly project_id: string
  readonly run_id: string
  readonly estado_final: string
  readonly duracao_ms: number
  readonly tentativas: number
  readonly tokens: number
  readonly creditos: number
  readonly custo_usd: number
  readonly eventos: string
  readonly head_sha: string | null
  readonly merge_sha: string | null
  readonly checks: string
  readonly artefatos: string
  readonly encerrado_em: string
}

export class ExecutionLedgerRepository {
  constructor(private readonly db: Database) {}

  registrar(ledger: ExecutionLedger): void {
    this.db
      .prepare(
        `INSERT INTO execution_ledger
           (id, user_id, project_id, run_id, estado_final, duracao_ms, tentativas, tokens,
            creditos, custo_usd, eventos, head_sha, merge_sha, checks, artefatos, encerrado_em)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        randomUUID(),
        ledger.userId,
        ledger.projectId,
        ledger.runId,
        ledger.estadoFinal,
        ledger.duracaoMs,
        ledger.tentativas,
        ledger.tokens,
        ledger.creditos,
        ledger.custoUsd,
        JSON.stringify(ledger.eventos),
        ledger.headSha ?? null,
        ledger.mergeSha ?? null,
        JSON.stringify(ledger.checks),
        JSON.stringify(ledger.artefatos),
        ledger.encerradoEm
      )

    log.info('db', 'Ledger do run registrado', { op: 'insert', table: 'execution_ledger' })
  }

  buscar(userId: string, runId: string): ExecutionLedger | undefined {
    const row = this.db
      .prepare('SELECT * FROM execution_ledger WHERE user_id = ? AND run_id = ?')
      .get(userId, runId) as LedgerRow | undefined
    if (!row) return undefined

    return {
      runId: row.run_id,
      userId: row.user_id,
      projectId: row.project_id,
      estadoFinal: row.estado_final as EstadoDoRun,
      duracaoMs: row.duracao_ms,
      tentativas: row.tentativas,
      tokens: row.tokens,
      creditos: row.creditos,
      custoUsd: row.custo_usd,
      eventos: JSON.parse(row.eventos) as readonly EventoDoLedger[],
      ...(row.head_sha === null ? {} : { headSha: row.head_sha }),
      ...(row.merge_sha === null ? {} : { mergeSha: row.merge_sha }),
      checks: JSON.parse(row.checks) as readonly CheckDoLedger[],
      artefatos: JSON.parse(row.artefatos) as readonly ArtefatoReferenciado[],
      encerradoEm: row.encerrado_em
    }
  }

  registrarArtefato(userId: string, item: ArtefatoRetido): void {
    this.db
      .prepare(
        `INSERT INTO artefato_retido
           (id, user_id, run_id, hash, bytes, criado_em, fixado, estado_do_run, expirado_em)
         VALUES (?,?,?,?,?,?,?,?,NULL)`
      )
      .run(
        item.id,
        userId,
        item.runId,
        item.hash,
        item.bytes,
        item.criadoEm,
        item.fixado ? 1 : 0,
        item.estadoDoRun
      )
  }

  /** Só os vivos: expirado já não tem anexo, e ofertá-lo ao coletor o faria trabalhar em vão. */
  listarArtefatos(userId: string): readonly ArtefatoRetido[] {
    const rows = this.db
      .prepare(
        `SELECT id, run_id, hash, bytes, criado_em, fixado, estado_do_run
           FROM artefato_retido WHERE user_id = ? AND expirado_em IS NULL ORDER BY criado_em`
      )
      .all(userId) as readonly {
      id: string
      run_id: string
      hash: string
      bytes: number
      criado_em: string
      fixado: number
      estado_do_run: string
    }[]

    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      hash: r.hash,
      bytes: r.bytes,
      criadoEm: r.criado_em,
      fixado: r.fixado === 1,
      estadoDoRun: r.estado_do_run as EstadoDoRun
    }))
  }

  marcarExpirado(userId: string, id: string): void {
    this.db
      .prepare(
        'UPDATE artefato_retido SET expirado_em = ? WHERE user_id = ? AND id = ? AND expirado_em IS NULL'
      )
      .run(new Date().toISOString(), userId, id)
  }

  registrarPendencia(userId: string, pendencia: PendenciaDeLimpeza): void {
    this.db
      .prepare(
        `INSERT INTO pendencia_de_limpeza
           (id, user_id, run_id, recurso, identificador, motivo, em, resolvida_em)
         VALUES (?,?,?,?,?,?,?,NULL)`
      )
      .run(
        randomUUID(),
        userId,
        pendencia.runId,
        pendencia.recurso,
        pendencia.identificador,
        pendencia.motivo,
        pendencia.em
      )

    log.warn('sistema', 'Limpeza deixou pendência reconciliável', {
      recurso: pendencia.recurso,
      motivo: pendencia.motivo
    })
  }

  listarPendencias(userId: string): readonly PendenciaDeLimpeza[] {
    const rows = this.db
      .prepare(
        `SELECT run_id, recurso, identificador, motivo, em
           FROM pendencia_de_limpeza WHERE user_id = ? AND resolvida_em IS NULL ORDER BY em`
      )
      .all(userId) as readonly {
      run_id: string
      recurso: string
      identificador: string
      motivo: string
      em: string
    }[]

    return rows.map((r) => ({
      runId: r.run_id,
      recurso: r.recurso as RecursoLimpavel,
      identificador: r.identificador,
      motivo: r.motivo,
      em: r.em
    }))
  }
}
```

- [ ] **Passo 5: rodar e ver passar**

Run: `npx vitest run src/main/pipeline/execution-ledger-repository.int-spec.ts src/main/storage/storage.int-spec.ts`
Esperado: PASS nos dois. Se `storage.int-spec.ts` afirmar um `SCHEMA_VERSION` literal, atualize-o para 29 no mesmo commit.

- [ ] **Passo 6: commit**

```bash
git add src/main/storage/migrations.ts src/main/pipeline/execution-ledger-repository.ts src/main/pipeline/execution-ledger-repository.int-spec.ts src/main/storage/storage.int-spec.ts
git commit -m "feat(entrega): migrations 28/29 e repositório do ExecutionLedger

refs #106"
```

---

### Task 5: O `LimpezaService`

**Arquivos:**
- Criar: `src/main/pipeline/limpeza-service.ts`
- Teste: `src/main/pipeline/limpeza-service.int-spec.ts`

**Interfaces:**
- Consome: `planoDeLimpeza`, `PendenciaDeLimpeza`, `RecursoLimpavel` (Task 2); `ExecutionLedgerRepository` (Task 4); `DockerRunner` (`parar`, `matarProcesso`), `GitRunner`, `LeaseRepository` (`liberar`, `listar`), `RECURSO_WORKTREE`/`RECURSO_CONTAINER`/`RECURSO_PORTA` de `@shared/domain/preflight`.
- Produz: `class LimpezaService` com `limpar(pedido: PedidoDeLimpeza): Promise<ResultadoDaLimpeza>`; `interface PedidoDeLimpeza { runId, userId, projectId, sandbox: SandboxPreparado, fase: FaseDeCancelamento, estadoFinal: EstadoDoRun }`; `interface ResultadoDaLimpeza { removidos: readonly RecursoLimpavel[], pendencias: readonly PendenciaDeLimpeza[] }`.

**Ordem obrigatória, direto da spec:** confirmar terminal → verificar que o worktree pertence ao lease → remover worktree → remover container do executor → liberar leases/portas/containers temporários → preservar volumes → registrar resultado. Verificar a posse **antes** de remover é o que impede apagar o worktree de outro run vivo.

**Como remover o container sem violar a política de destrutivos:** `DockerRunner.parar` faz `docker stop`, e `docker rm` está barrado pela allowlist do MVP-004 (abriria `ApprovalRequest` e travaria a limpeza num gate humano). A saída é `docker run --rm` no preflight — o Docker remove o container sozinho quando ele para, sem nenhum comando destrutivo. Confirme em `src/main/pipeline/docker-runner.ts` se `--rm` já está nos args de `run`; se não estiver, acrescente-o ali (é uma flag de criação, não um comando novo) e registre a decisão no `DEVELOPMENT.md` da Task 9. Se `--rm` for incompatível com algo que a M9-F03 dependa (por exemplo, ler logs do container depois que ele para), **pare e pergunte ao PI** em vez de adicionar `docker rm` à allowlist.

- [ ] **Passo 1: escrever o teste que falha**

```ts
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RECURSO_CONTAINER, RECURSO_WORKTREE } from '@shared/domain/preflight'
import type { SandboxPreparado } from '@shared/domain/preflight'
import { migrate } from '../storage/migrations'
import { ExecutionLedgerRepository } from './execution-ledger-repository'
import { LeaseRepository } from './lease-repository'
import { LimpezaService } from './limpeza-service'

let dir: string
let db: Database.Database
let ledger: ExecutionLedgerRepository
let leases: LeaseRepository
let worktree: string

function sandbox(): SandboxPreparado {
  return {
    runId: 'run-1',
    containerNome: 'jarvisos-run-1',
    cwd: '/work',
    baseSha: 'a'.repeat(40),
    branch: 'feat/x',
    worktreeNoHost: worktree,
    pathsPermitidos: { origem: 'spec', paths: ['src/**'] },
    proxyUrl: 'http://sidecar:8080'
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'limpeza-'))
  worktree = join(dir, 'wt')
  mkdirSync(worktree, { recursive: true })
  db = new Database(join(dir, 'app.db'))
  migrate(db)
  ledger = new ExecutionLedgerRepository(db)
  leases = new LeaseRepository(db)
})

afterEach(() => {
  db.close()
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
})

describe('LimpezaService', () => {
  it('remove worktree e container quando o lease é do run', async () => {
    const agora = Date.now()
    leases.adquirir('user-1', `${RECURSO_WORKTREE}${worktree}`, 'run-1', agora)
    leases.adquirir('user-1', `${RECURSO_CONTAINER}jarvisos-run-1`, 'run-1', agora)

    const parar = vi.fn().mockReturnValue(true)
    const servico = new LimpezaService({
      docker: { parar, matarProcesso: vi.fn() },
      git: { removerWorktree: vi.fn().mockReturnValue(true) },
      leases,
      ledger,
      userId: () => 'user-1',
      agora: () => agora
    })

    const resultado = await servico.limpar({
      runId: 'run-1',
      userId: 'user-1',
      projectId: 'proj-1',
      sandbox: sandbox(),
      fase: 'depois-do-merge',
      estadoFinal: 'MERGED'
    })

    expect(resultado.removidos).toContain('worktree')
    expect(resultado.removidos).toContain('container')
    expect(parar).toHaveBeenCalledWith('jarvisos-run-1', expect.any(String))
    expect(resultado.pendencias).toHaveLength(0)
  })

  it('não remove worktree cujo lease é de outro run — remover apagaria trabalho vivo', async () => {
    const agora = Date.now()
    leases.adquirir('user-1', `${RECURSO_WORKTREE}${worktree}`, 'run-OUTRO', agora)

    const removerWorktree = vi.fn()
    const servico = new LimpezaService({
      docker: { parar: vi.fn().mockReturnValue(true), matarProcesso: vi.fn() },
      git: { removerWorktree },
      leases,
      ledger,
      userId: () => 'user-1',
      agora: () => agora
    })

    const resultado = await servico.limpar({
      runId: 'run-1',
      userId: 'user-1',
      projectId: 'proj-1',
      sandbox: sandbox(),
      fase: 'depois-do-merge',
      estadoFinal: 'MERGED'
    })

    expect(removerWorktree).not.toHaveBeenCalled()
    expect(resultado.removidos).not.toContain('worktree')
    expect(resultado.pendencias.map((p) => p.recurso)).toContain('worktree')
  })

  it('falha de remoção vira pendência reconciliável, não exceção', async () => {
    const agora = Date.now()
    leases.adquirir('user-1', `${RECURSO_CONTAINER}jarvisos-run-1`, 'run-1', agora)

    const servico = new LimpezaService({
      docker: { parar: vi.fn().mockReturnValue(false), matarProcesso: vi.fn() },
      git: { removerWorktree: vi.fn().mockReturnValue(true) },
      leases,
      ledger,
      userId: () => 'user-1',
      agora: () => agora
    })

    const resultado = await servico.limpar({
      runId: 'run-1',
      userId: 'user-1',
      projectId: 'proj-1',
      sandbox: sandbox(),
      fase: 'depois-do-merge',
      estadoFinal: 'MERGED'
    })

    expect(resultado.pendencias.map((p) => p.recurso)).toContain('container')
    expect(ledger.listarPendencias('user-1').length).toBeGreaterThan(0)
  })

  it('cancelar durante a execução mata processos e preserva o worktree', async () => {
    const agora = Date.now()
    leases.adquirir('user-1', `${RECURSO_WORKTREE}${worktree}`, 'run-1', agora)

    const matarProcesso = vi.fn()
    const removerWorktree = vi.fn()
    const servico = new LimpezaService({
      docker: { parar: vi.fn().mockReturnValue(true), matarProcesso },
      git: { removerWorktree },
      leases,
      ledger,
      userId: () => 'user-1',
      agora: () => agora
    })

    await servico.limpar({
      runId: 'run-1',
      userId: 'user-1',
      projectId: 'proj-1',
      sandbox: sandbox(),
      fase: 'durante-execucao',
      estadoFinal: 'CANCELLED'
    })

    expect(matarProcesso).toHaveBeenCalled()
    expect(removerWorktree).not.toHaveBeenCalled()
  })
})
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx vitest run src/main/pipeline/limpeza-service.int-spec.ts`
Esperado: FAIL — o módulo não existe.

- [ ] **Passo 3: implementar**

A ordem no corpo de `limpar` deve ser exatamente: (1) resolver `planoDeLimpeza(fase)`; (2) se `plano.mataProcessos`, chamar `docker.matarProcesso`; (3) se a fase preserva o snapshot (toda fase não-terminal de execução), sair sem tocar o worktree; (4) para worktree e container, verificar `leases.buscar(userId, recurso)?.proprietario === runId` **antes** de remover, e registrar pendência quando não for; (5) remover worktree via `git.removerWorktree`, depois parar o container; (6) liberar os leases dos recursos efetivamente removidos; (7) nunca tocar volume persistente; (8) devolver `{ removidos, pendencias }`, com toda pendência também gravada em `ledger.registrarPendencia`.

Assine as dependências como interfaces mínimas (`{ parar, matarProcesso }`, `{ removerWorktree }`) em vez de importar as classes concretas: é o que mantém o teste acima sem Docker e sem Git reais.

- [ ] **Passo 4: rodar e ver passar**

Run: `npx vitest run src/main/pipeline/limpeza-service.int-spec.ts`
Esperado: PASS.

- [ ] **Passo 5: commit**

```bash
git add src/main/pipeline/limpeza-service.ts src/main/pipeline/limpeza-service.int-spec.ts
git commit -m "feat(entrega): LimpezaService com verificação de posse e pendência reconciliável

refs #106"
```

---

### Task 6: O coletor de retenção

**Arquivos:**
- Criar: `src/main/pipeline/retencao-service.ts`
- Teste: `src/main/pipeline/retencao-service.int-spec.ts`

**Interfaces:**
- Consome: `elegiveisParaExpirar`, `ArtefatoRetido` (Task 3); `ExecutionLedgerRepository` (Task 4).
- Produz: `class RetencaoService` com `coletar(userId: string): Promise<readonly ArtefatoRetido[]>`.

O ponto do **critério 9** que o domínio sozinho não fecha: *"nunca deixar referência versionada apontando para conteúdo que ela afirme estar presente"*. Por isso o serviço apaga o anexo **e** marca `expirado_em` na mesma volta — e marca antes de apagar, porque uma marcação sem apagar é inofensiva, enquanto um apagar sem marcar produz exatamente a referência mentirosa que o critério proíbe.

- [ ] **Passo 1: escrever o teste que falha**

```ts
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../storage/migrations'
import { ExecutionLedgerRepository } from './execution-ledger-repository'
import { RetencaoService } from './retencao-service'

const DIA_MS = 24 * 60 * 60 * 1000
let dir: string
let db: Database.Database
let ledger: ExecutionLedgerRepository

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'retencao-'))
  db = new Database(join(dir, 'app.db'))
  migrate(db)
  ledger = new ExecutionLedgerRepository(db)
})

afterEach(() => {
  db.close()
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
})

describe('RetencaoService', () => {
  it('apaga o anexo do artefato vencido e marca a linha como expirada', async () => {
    const agora = Date.now()
    const anexo = join(dir, 'log.txt')
    writeFileSync(anexo, 'conteudo pesado')

    ledger.registrarArtefato('user-1', {
      id: 'art-1',
      runId: 'run-1',
      hash: 'h'.repeat(64),
      bytes: 15,
      criadoEm: new Date(agora - 31 * DIA_MS).toISOString(),
      fixado: false,
      estadoDoRun: 'MERGED'
    })

    const servico = new RetencaoService({
      ledger,
      caminhoDoAnexo: () => anexo,
      agora: () => agora
    })

    const saiu = await servico.coletar('user-1')

    expect(saiu.map((a) => a.id)).toEqual(['art-1'])
    expect(existsSync(anexo)).toBe(false)
    expect(ledger.listarArtefatos('user-1')).toHaveLength(0)
  })

  it('preserva artefato de run não resolvido, por mais velho que seja', async () => {
    const agora = Date.now()
    const anexo = join(dir, 'preso.txt')
    writeFileSync(anexo, 'x')

    ledger.registrarArtefato('user-1', {
      id: 'art-2',
      runId: 'run-2',
      hash: 'h'.repeat(64),
      bytes: 1,
      criadoEm: new Date(agora - 900 * DIA_MS).toISOString(),
      fixado: false,
      estadoDoRun: 'AWAITING_MERGE'
    })

    const servico = new RetencaoService({
      ledger,
      caminhoDoAnexo: () => anexo,
      agora: () => agora
    })

    expect(await servico.coletar('user-1')).toEqual([])
    expect(existsSync(anexo)).toBe(true)
  })

  it('anexo já ausente não impede a marcação: o objetivo é a coerência, não o arquivo', async () => {
    const agora = Date.now()
    ledger.registrarArtefato('user-1', {
      id: 'art-3',
      runId: 'run-3',
      hash: 'h'.repeat(64),
      bytes: 1,
      criadoEm: new Date(agora - 31 * DIA_MS).toISOString(),
      fixado: false,
      estadoDoRun: 'MERGED'
    })

    const servico = new RetencaoService({
      ledger,
      caminhoDoAnexo: () => join(dir, 'nao-existe.txt'),
      agora: () => agora
    })

    expect(await servico.coletar('user-1')).toHaveLength(1)
    expect(ledger.listarArtefatos('user-1')).toHaveLength(0)
  })
})
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx vitest run src/main/pipeline/retencao-service.int-spec.ts`
Esperado: FAIL — o módulo não existe.

- [ ] **Passo 3: implementar**

`coletar` lê `ledger.listarArtefatos(userId)`, aplica `elegiveisParaExpirar(itens, agora())`, e para cada elegível: `ledger.marcarExpirado` primeiro, depois `rmSync(caminhoDoAnexo(item), { force: true })` dentro de `try/catch` que só loga (`log.warn('sistema', ...)`). Devolve a lista dos que saíram. `caminhoDoAnexo` entra por injeção porque o layout do diretório de artefatos é do main, não do coletor.

- [ ] **Passo 4: rodar e ver passar**

Run: `npx vitest run src/main/pipeline/retencao-service.int-spec.ts`
Esperado: PASS.

- [ ] **Passo 5: commit**

```bash
git add src/main/pipeline/retencao-service.ts src/main/pipeline/retencao-service.int-spec.ts
git commit -m "feat(entrega): coletor de retenção marca antes de apagar

refs #106"
```

---

### Task 7: Encerramento no `EntregaService`

**Arquivos:**
- Modificar: `src/main/pipeline/entrega-service.ts` (interface `EntregaDeps` por volta da linha 117; método `entregar` por volta da linha 164)
- Teste: `src/main/pipeline/entrega-service.int-spec.ts` (acrescentar casos ao arquivo existente)

**Interfaces:**
- Consome: `ExecutionLedgerRepository` (Task 4), `LimpezaService` (Task 5), `ledgerCompleto` (Task 1).
- Produz: `EntregaDeps` ganha `ledger: ExecutionLedgerRepository`, `limpeza: LimpezaService`; `ResultadoDaEntrega` ganha `readonly ledgerId?: string`.

Fecha os **critérios 1, 4 e 5**. O `finally` que hoje só zera `runCorrente` passa a gravar o ledger e chamar a limpeza — em **todos** os desfechos, inclusive `BLOCKED`, porque recurso vazado por bloqueio vaza igual. O **critério 4** (reinício pós-merge não cria novo PR nem merge) já está coberto pela idempotência do `ensure*` da M9-F01 e pelo `UNIQUE(user_id, run_id)` do ledger; o teste abaixo o prova a partir daqui.

- [ ] **Passo 1: escrever os testes que falham**

Acrescente a `entrega-service.int-spec.ts`, reusando os dublês já montados naquele arquivo:

```ts
it('grava o ledger ao terminar, com head, merge e checks coerentes', async () => {
  const resultado = await servico.entregar(pedidoPadrao())
  expect(resultado.estadoFinal).toBe('MERGED')

  const gravado = ledgerRepo.buscar('user-1', pedidoPadrao().runId)
  expect(gravado).toBeDefined()
  expect(gravado?.mergeSha).toBe(resultado.mergeSha)
  expect(ledgerCompleto(gravado!)).toBe(true)
})

it('chama a limpeza mesmo quando termina em BLOCKED — recurso vaza igual', async () => {
  revisar.mockResolvedValue([{ severidade: 'bloqueante', titulo: 'achado' }])
  const resultado = await servico.entregar(pedidoPadrao())
  expect(resultado.estadoFinal).toBe('BLOCKED')
  expect(limparSpy).toHaveBeenCalledTimes(1)
})

it('reiniciar depois do merge não abre segundo PR nem mergeia de novo', async () => {
  await servico.entregar(pedidoPadrao())
  const chamadasDePr = criarPr.mock.calls.length
  const chamadasDeMerge = mergear.mock.calls.length

  await servico.entregar(pedidoPadrao())

  expect(criarPr.mock.calls.length).toBe(chamadasDePr)
  expect(mergear.mock.calls.length).toBe(chamadasDeMerge)
})
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx vitest run src/main/pipeline/entrega-service.int-spec.ts`
Esperado: FAIL — `ledgerRepo`/`limparSpy` não existem nas deps e o ledger não é gravado.

- [ ] **Passo 3: implementar**

Em `EntregaDeps`, acrescente `readonly ledger: ExecutionLedgerRepository` e `readonly limpeza: LimpezaService`. Em `entregar`, envolva o `try` existente de modo que o `finally` — depois de zerar `runCorrente` — grave o ledger com o resultado obtido e chame `this.deps.limpeza.limpar({...})` com a fase derivada do estado final (`MERGED` → `depois-do-merge`; `AWAITING_MERGE`/`BLOCKED` → `durante-ci`). Capture exceção da limpeza e registre pendência: falha de limpeza **não** desfaz merge nem derruba a entrega.

O ledger só grava se `ledgerCompleto` aceitar; quando não aceitar, registre `log.error('sistema', ...)` com o motivo e grave assim mesmo, porque um ledger incompleto ainda é mais evidência do que nenhum — o que não pode acontecer é o run terminar sem registro algum.

- [ ] **Passo 4: rodar e ver passar**

Run: `npx vitest run src/main/pipeline/entrega-service.int-spec.ts`
Esperado: PASS.

- [ ] **Passo 5: commit**

```bash
git add src/main/pipeline/entrega-service.ts src/main/pipeline/entrega-service.int-spec.ts
git commit -m "feat(entrega): encerramento grava ledger e dispara limpeza em todo terminal

refs #106"
```

---

### Task 8: Ponte IPC e painel

**Arquivos:**
- Modificar: `src/shared/contracts/ipc.ts` (mapa de canais por volta da linha 372; interface da ponte por volta da linha 875)
- Modificar: `src/main/ipc/handlers.ts`
- Modificar: `src/main/preload/index.ts`
- Modificar: `src/main/preload/preload.spec.ts` (a lista de métodos da ponte)
- Modificar: `tests/e2e/login.e2e.ts` (a **segunda** lista de contrato da ponte)
- Criar: `src/renderer/components/entrega/PainelDeEntrega.tsx`
- Teste: `src/renderer/components/entrega/PainelDeEntrega.test.tsx`

**Interfaces:**
- Consome: `resumoDoLedger`, `ResumoDoLedger` (Task 1); `PendenciaDeLimpeza` (Task 2); `ExecutionLedgerRepository` (Task 4).
- Produz: canais `ledgerDoRun: 'ledger:do-run'` e `limpezaPendencias: 'limpeza:pendencias'`; métodos `ledgerDoRun(runId: string): Promise<ExecutionLedger | undefined>` e `limpezaPendencias(): Promise<readonly PendenciaDeLimpeza[]>` na ponte.

**Os dois canais são só leitura** — como `fila:vista` e `sandbox:estado`. Nenhum canal encerra run, dispara limpeza ou pede aceite: a spec diz *"não mostrar commit/push/PR/merge como botões do PI e não pedir aceite final"*, e a forma de garantir isso é não oferecer o canal.

**Atenção — a ponte tem duas listas de contrato.** Método novo no preload entra em `src/main/preload/preload.spec.ts` **e** em `tests/e2e/login.e2e.ts`. Esquecer a segunda deixa a suíte local verde e quebra o CI.

- [ ] **Passo 1: escrever o teste do painel que falha**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { PainelDeEntrega } from './PainelDeEntrega'
import type { ExecutionLedger } from '@shared/domain/execution-ledger'

const ledger: ExecutionLedger = {
  runId: 'run-1',
  userId: 'user-1',
  projectId: 'proj-1',
  estadoFinal: 'AWAITING_MERGE',
  duracaoMs: 754000,
  tentativas: 2,
  tokens: 12000,
  creditos: 8,
  custoUsd: 1.42,
  eventos: [{ em: '2026-09-02T00:00:00.000Z', o_que: 'run-iniciado' }],
  headSha: 'a'.repeat(40),
  checks: [{ nome: 'validacao', conclusao: 'success' }],
  artefatos: [{ nome: 'reports/TESTS.md', hash: 'c'.repeat(64), bytes: 2048 }],
  encerradoEm: '2026-09-02T00:12:34.000Z'
}

describe('PainelDeEntrega', () => {
  it('explica o estado terminal sem exigir log técnico', () => {
    render(<PainelDeEntrega ledger={ledger} pendencias={[]} />)
    expect(screen.getByText(/aguardando merge/i)).toBeInTheDocument()
    expect(screen.getByText(/1,42/)).toBeInTheDocument()
  })

  it('não oferece botão de commit, push, PR, merge ou aceite', () => {
    render(<PainelDeEntrega ledger={ledger} pendencias={[]} />)
    for (const proibido of [/commit/i, /push/i, /abrir pr/i, /mergear/i, /aceitar/i]) {
      expect(screen.queryByRole('button', { name: proibido })).toBeNull()
    }
  })

  it('mantém Git e logs atrás de um expansor', async () => {
    render(<PainelDeEntrega ledger={ledger} pendencias={[]} />)
    expect(screen.queryByText(ledger.headSha!)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /detalhes técnicos/i }))
    expect(screen.getByText(ledger.headSha!)).toBeInTheDocument()
  })

  it('mostra artefato por hash, nunca por conteúdo', () => {
    render(<PainelDeEntrega ledger={ledger} pendencias={[]} />)
    expect(screen.getByText(/reports\/TESTS\.md/)).toBeInTheDocument()
    expect(screen.getByText(new RegExp('c'.repeat(8)))).toBeInTheDocument()
  })

  it('mostra pendência de limpeza como algo a reconciliar', () => {
    render(
      <PainelDeEntrega
        ledger={ledger}
        pendencias={[
          {
            runId: 'run-1',
            recurso: 'container',
            identificador: 'jarvisos-run-1',
            motivo: 'docker indisponível',
            em: '2026-09-02T00:13:00.000Z'
          }
        ]}
      />
    )
    expect(screen.getByText(/jarvisos-run-1/)).toBeInTheDocument()
  })
})
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `npx vitest run src/renderer/components/entrega/PainelDeEntrega.test.tsx`
Esperado: FAIL — o componente não existe.

- [ ] **Passo 3: implementar canais, handlers, ponte e painel**

Siga o padrão local de `fila:vista`: canal no mapa, tipo na interface da ponte, handler que resolve `userId` no main (nunca vem do renderer), método no preload. O painel recebe `ledger` e `pendencias` por prop — a busca fica em quem o monta, o que mantém o componente testável sem IPC.

Rótulos em pt-BR via i18n, com estado terminal traduzido (`MERGED` → "Mergeado", `AWAITING_MERGE` → "Aguardando merge", `BLOCKED` → "Bloqueado", `CANCELLED` → "Cancelado"). O expansor "Detalhes técnicos" é `<details>`/`<summary>` ou um botão com `aria-expanded` — o teste usa `role="button"`, então garanta o papel acessível.

- [ ] **Passo 4: atualizar as duas listas de contrato da ponte**

Acrescente `ledgerDoRun` e `limpezaPendencias` em `src/main/preload/preload.spec.ts` **e** em `tests/e2e/login.e2e.ts`.

- [ ] **Passo 5: rodar e ver passar**

Run: `npx vitest run src/renderer/components/entrega/PainelDeEntrega.test.tsx src/main/preload/preload.spec.ts src/main/ipc/handlers.spec.ts`
Esperado: PASS nos três.

- [ ] **Passo 6: commit**

```bash
git add src/shared/contracts/ipc.ts src/main/ipc/handlers.ts src/main/preload/index.ts src/main/preload/preload.spec.ts tests/e2e/login.e2e.ts src/renderer/components/entrega/
git commit -m "feat(entrega): canais de leitura do ledger e painel de estado terminal

refs #106"
```

---

### Task 9: Documentação, validação e entrega

**Arquivos:**
- Modificar: `docs/DEVELOPMENT.md` (seção da Fatia 06 do MVP-009, ao final do bloco MVP-009)
- Modificar: `docs/STATUS.md` (linha da M9-F06 e o cabeçalho de data)
- Modificar: `docs/ARCHITECTURE.md` (se a limpeza ou a retenção mudarem o desenho descrito)
- Gerado: `reports/TESTS.md` (pelo runner, **nunca** à mão)

- [ ] **Passo 1: rodar o piso de validação**

```bash
npm run lint && npm run typecheck && npm test
```

Esperado: os três verdes. Vermelho aqui é trabalho a fazer, não item a anotar.

- [ ] **Passo 2: escrever a seção da fatia no `DEVELOPMENT.md`**

Siga o formato das fatias anteriores: status, checklist do que entrou, e uma seção de decisões técnicas com o **porquê** de cada uma. Registre no mínimo: a escolha de `--rm` (ou a decisão do PI, se a Task 5 tiver esbarrado nela); por que `AWAITING_MERGE` e `BLOCKED` são protegidos da retenção apesar de terminais; e por que o coletor marca antes de apagar.

Declare os **limites** com a mesma honestidade das fatias anteriores: o que não foi exercitado contra infraestrutura real, e por quê.

- [ ] **Passo 3: atualizar o `STATUS.md`**

Linha da M9-F06 para "Feito" após o merge, com o link do PR. Atualize a data do cabeçalho. **Não** feche a issue nem aplique `proplan:finalizado` — é ato do PI.

- [ ] **Passo 4: commit e push**

```bash
git add docs/ reports/
git commit -m "docs(entrega): registra a M9-F06 em DEVELOPMENT e STATUS

refs #106"
git push -u origin feat/m9-f06-evidencia-limpeza-continuidade
```

- [ ] **Passo 5: abrir o PR**

Corpo com `refs #106`, **nunca `closes`**. Resumo do que entrou, decisões e limites declarados.

- [ ] **Passo 6: aguardar o CI**

```bash
gh pr checks <n> --watch
```

Nunca um laço de monitor artesanal: ele fica girando calado quando uma chamada falha, e foi assim que uma entrega pronta ficou parada até o PI olhar por conta própria.

- [ ] **Passo 7: mergear e mover o card**

Com os checks verdes, mergear na `main` e aplicar `proplan:done` na #106, com o link do PR no corpo. **Só o PI** fecha a issue e aplica `proplan:finalizado`.

---

## Auto-revisão do plano

**Cobertura dos critérios da spec:**

| Critério | Tarefa |
|---|---|
| 1. `MERGED` com head, checks e merge SHA coerentes | Task 1 (`ledgerCompleto`), Task 7 (grava e verifica) |
| 2. Relatório referencia artefatos por hash | Task 1 (`ArtefatoReferenciado`), Task 8 (painel mostra hash) |
| 3. Documento sem mudança material não recebe edição cosmética | Task 9 (disciplina de edição; sem código a escrever) |
| 4. Reinício pós-merge não cria novo PR ou merge | Task 7 (teste de reinício) |
| 5. Worktree, container e recursos temporários removidos ou com pendência | Task 5 (`LimpezaService`) |
| 6. Próxima fatia exige sua própria revisão aprovada | Já garantido pelo gate `SLICE_ENTRY` (M9-F02); Task 8 não oferece canal que o contorne |
| 7. Estado terminal compreensível sem log técnico | Task 8 (painel, expansor) |
| 8. Cancelar depois do push preserva PR/branch; depois do merge não muda | Task 2 (tabela), Task 5 (teste das duas fases) |
| 9. Coletor respeita idade, cota, fixação e proteção | Task 3 (domínio), Task 6 (serviço) |

**Nota sobre o critério 6:** ele é satisfeito por ausência — nenhum canal desta fatia inicia a fatia seguinte. Se durante a execução aparecer algum caminho que a inicie automaticamente, isso é achado para o PI, não código a escrever aqui.

**Nota sobre a jornada E2E real completa** (§ Testes e evidência da spec): ela roda em projeto e repositório exclusivos e descartáveis, **fora da suíte padrão**, e consome orçamento. Ela não está nas tarefas acima porque exige autorização e um repositório descartável do PI — mesma condição que deixou o smoke real da M9-F01 sem execução. Peça a autorização ao PI ao abrir o PR e, se não vier, declare o limite no `DEVELOPMENT.md` em vez de marcar como feito.
