# M10-F01 — Contrato comum e runtime de executores: plano de implementação

> **Para workers agênticos:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development` (recomendada) ou `superpowers:executing-plans` para executar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** estabilizar a fronteira entre o kernel e qualquer CLI executor de código, de forma que Claude Code e Codex (F02/F03) sejam implementações de um mesmo contrato, provadas pelo mesmo contract test.

**Arquitetura:** três camadas em `src/main/executors/`. Os **tipos** (`executor.ts`) declaram o contrato — request normalizado, eventos normalizados, resultado estruturado — sem nenhum I/O. A **máquina de estados** (`attempt-state.ts`) é função pura que decide, por evento, se o estado muda ou o evento é diagnóstico: é ela que faz evento duplicado, fora de ordem e pós-terminal não corromperem nada. O **runtime** (`coding-executor-runtime.ts`) é a única porta de entrada: valida o request **antes** de tocar o adapter, abre a tentativa, consome o `AsyncIterable` do adapter alimentando a máquina, aplica redaction em tudo que sai para log/evidência, e trata cancelamento idempotente + timeout. O `ConstrutorService` da V1 **não é tocado** — ele segue paralelo até uma fatia futura migrar o call site.

**Tech Stack:** TypeScript (sem `any`), Vitest (projects `regras` e `banco`), Node `child_process` só no que for processo real. Nada de Electron nestes arquivos.

**Spec:** `docs/spec/spec-multi-executor-01-runtime.md` (status `aprovada-pi`, 2026-08-29). Issue: [#116](https://github.com/RodReis/rrb-jarvisOS/issues/116). Épico: [#115](https://github.com/RodReis/rrb-jarvisOS/issues/115).

## Restrições globais

- **Idioma:** comentários, documentação e mensagens de commit em **pt-BR**; identificadores de código em **inglês**. Nomes do contrato são os que a spec aprovada usa, literalmente: `CodingExecutorAdapter`, `CodingExecutorRuntime`, `ExecutorRequest`, `ExecutorEvent`, `ExecutorResult`.
- **Sem `any`.** Entrada não confiável entra como `unknown` e é estreitada.
- **Sem persistência nesta fatia.** A máquina de estados vive em memória. Nenhuma migração, nenhum repository, nenhuma tabela nova. (Decisão do PI nesta sessão: os critérios 1-3 falam só de comportamento em runtime; durabilidade real é da fatia que migrar o `ConstrutorService` ou do scheduler F04.)
- **Redaction reusa o que existe.** `redigirSegredos` de `src/shared/domain/segredos.ts` para **texto bruto**; `redact` de `src/shared/contracts/logging-redaction.ts` para **objeto estruturado por nome de campo**. Proibido escrever uma terceira lista de padrões de segredo — a lista que fica para trás é a que vaza.
- **`redact` devolve `unknown`.** Todo uso precisa de cast explícito no ponto de consumo.
- **Categoria de teste pelo sufixo** (`vitest.config.ts`): `*.spec.ts` → project `regras` (unidade pura, ambiente node); `*.int-spec.ts` em `src/main/**` → project `banco` (serial, `fileParallelism: false`, toca disco/processo/timer real). Lógica pura vai para `regras`; só o que usa processo real vai para `banco`.
- **Fora de escopo, explicitamente:** parser/autenticação do Codex (F02/F03); seleção entre executores e revisão cruzada (F04); Git remoto, PR, merge, decisão de escopo ou aprovação dentro do adapter. Se um passo parecer pedir qualquer um destes, ele está errado — pare e pergunte.
- **Piso de verificação:** `npm run lint`, `npm run typecheck` (roda os **dois** projetos tsconfig) e `npm test` verdes.
- **Git:** branch `feat/m10-f01-contrato-runtime-executores`. PR com `refs #116` no corpo. **Nunca `closes #116`** — fecharia a issue no merge e forjaria o aceite do PI.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/main/executors/executor.ts` | **Criar.** Só tipos e constantes do contrato. Zero lógica, zero import de Node. É o que F02/F03 importam. |
| `src/main/executors/attempt-state.ts` | **Criar.** A máquina de estados, pura: `aplicarEvento(estado, evento)` → novo estado. Nenhum I/O, nenhum timer. |
| `src/main/executors/attempt-state.spec.ts` | **Criar.** Testa a máquina isolada (project `regras`): duplicado, fora de ordem, pós-terminal, desconhecido. |
| `src/main/executors/validar-request.ts` | **Criar.** As recusas do critério 4, puras: modo de cobrança, revisão e schema incompatíveis. |
| `src/main/executors/validar-request.spec.ts` | **Criar.** Testa cada recusa e o caminho aceito (project `regras`). |
| `src/main/executors/coding-executor-runtime.ts` | **Criar.** O runtime: valida, abre tentativa, consome o adapter, redige, cancela, aplica timeout. |
| `src/main/executors/fake-coding-executor-adapter.ts` | **Criar.** Fake controlável, **exportado** (não é arquivo de teste) porque F02/F03 vão reusá-lo. |
| `src/main/executors/coding-executor-contract.ts` | **Criar.** `rodarContractDoExecutor(criarAdapter)` — a suíte que qualquer adapter real reexecuta. |
| `src/main/executors/coding-executor-runtime.int-spec.ts` | **Criar.** Roda o contract com o fake + casos de redaction e de árvore de processo (project `banco`). |

Nenhum arquivo existente é modificado por este plano, exceto a documentação na Tarefa 8.

---

## Tarefa 1: Tipos do contrato

**Arquivos:**
- Criar: `src/main/executors/executor.ts`

**Interfaces:**
- Consome: nada (é a base).
- Produz: `MODOS_DE_COBRANCA`, `ModoDeCobranca`, `ReferenciaDeAutenticacao`, `ExecutorRequest`, `ExecutorEvent`, `EVENTOS_TERMINAIS`, `EventoTerminal`, `ExecutorResult`, `StatusDoResultado`, `CodingExecutorAdapter`.

- [ ] **Passo 1: Criar o arquivo de tipos**

Crie `src/main/executors/executor.ts` com exatamente este conteúdo:

```ts
/**
 * O contrato entre o kernel e qualquer CLI executor de código (SPEC-Multi-Executor-01).
 *
 * A fronteira que este arquivo desenha: **o kernel governa, o adapter traduz**. Escopo,
 * política, orçamento, efeitos externos e Git são decisões do kernel e não aparecem aqui;
 * o adapter recebe um pedido já decidido e devolve execução, eventos, uso, sessão e
 * cancelamento. Nada mais.
 *
 * `CodingExecutorRuntime` é irmão de `AIProviderRuntime` e `ConnectorRuntime`
 * (ARCHITECTURE § Pipeline V2), e não uma variação do `AiAdapter`: aquele contrato é
 * talhado para conversa (prompt entra, texto sai), e este para trabalho em árvore de
 * arquivos — com worktree, paths, validações e sessão retomável. Forçar os dois na mesma
 * interface daria a cada consumidor a metade dos campos que não lhe servem.
 *
 * Zero import de Node neste arquivo, de propósito: é o que F02 e F03 importam para
 * implementar os adapters concretos, e um `child_process` aqui obrigaria todo teste do
 * contrato a carregar o mundo.
 */

/**
 * Como esta execução é cobrada.
 *
 * `unmetered`: rota de assinatura, sem custo por chamada (o plano já foi pago).
 * `subscription_limited`: assinatura com teto de uso — tem quota a respeitar.
 * `metered`: pago por token, com custo por chamada.
 *
 * Existe no request porque o runtime **recusa modo que o executor não suporta antes de
 * iniciar o CLI** (critério 4): descobrir no meio do stream que a rota cobra o que ninguém
 * autorizou é descobrir depois de já ter gastado.
 */
export const MODOS_DE_COBRANCA = ['unmetered', 'subscription_limited', 'metered'] as const
export type ModoDeCobranca = (typeof MODOS_DE_COBRANCA)[number]

/**
 * A autenticação, **opaca** (critério 5).
 *
 * O adapter recebe um identificador do que usar, nunca o segredo. Quem resolve a referência
 * em credencial de verdade é o kernel, que conhece usuário e workspace; um adapter que
 * lesse o Vault por conta própria precisaria conhecer esse escopo — e passaria a ser mais
 * um lugar onde o segredo é buscado, mais uma superfície de vazamento e mais um caminho
 * que o renderer poderia alcançar.
 *
 * `escopo` diz **qual sessão** usar (o `CODEX_HOME` dedicado da F02 é um caso), nunca o
 * conteúdo dela. Nenhum campo deste tipo carrega valor de credencial, e o teste do critério
 * 5 afirma justamente a ausência.
 */
export interface ReferenciaDeAutenticacao {
  /** O identificador da sessão/perfil a usar. Opaco: só o kernel sabe traduzi-lo. */
  readonly referencia: string
  /** Escopo da sessão, quando o executor tem mais de uma. */
  readonly escopo?: string
}

/**
 * O pedido normalizado de execução.
 *
 * Tudo já resolvido pelo kernel: o executor foi escolhido, o modelo foi congelado, as
 * revisões foram aprovadas, o sandbox está de pé. O adapter não decide nenhuma destas
 * coisas — ele as obedece.
 */
export interface ExecutorRequest {
  /** O run a que esta tentativa pertence. */
  readonly runId: string
  /**
   * A tentativa. **Só o kernel a abre** (regra 1), e é a identidade que faz evento atrasado
   * não reabrir estado terminal: um evento que chega com `attemptId` de tentativa já
   * encerrada é diagnóstico, nunca transição.
   */
  readonly attemptId: string
  /**
   * A chave idempotente da tentativa (regra 2).
   *
   * Separada do `attemptId` porque responde outra pergunta: o `attemptId` identifica **esta**
   * tentativa, a chave identifica **o trabalho** que ela faz. Depois de um crash, o kernel
   * retoma com chave igual e `attemptId` novo; é a chave que permite reconhecer "isto já foi
   * executado" em vez de duplicar o efeito.
   */
  readonly chaveIdempotente: string
  /** Qual executor atende (`claude-code`, `codex-exec`, o fake nos testes). */
  readonly executor: string
  /** O modelo, congelado pelo kernel — nunca resolvido aqui. */
  readonly modelo: string
  readonly modoDeCobranca: ModoDeCobranca
  /**
   * As revisões que o kernel aprovou para esta execução.
   *
   * Lista e não booleano: o runtime recusa revisão que o executor não conhece (critério 4),
   * e para isso precisa saber **quais** foram aprovadas, não apenas que houve aprovação.
   */
  readonly revisoesAprovadas: readonly string[]
  /** O manifesto de contexto que autorizou esta execução. */
  readonly contextPackId: string
  /** Onde o trabalho acontece: o worktree no host e, quando há, o container. */
  readonly worktree: string
  readonly container?: string
  /**
   * Os paths que esta execução pode tocar.
   *
   * O adapter os recebe como **informação**, não como permissão a conceder: quem autoriza
   * escrita é o kernel, que verifica o resultado depois (regra 3). Passá-los aqui serve
   * para o executor saber onde trabalhar, e não para ele se policiar.
   */
  readonly pathsPermitidos: readonly string[]
  /** Os comandos de validação a rodar, no vocabulário do projeto-alvo. */
  readonly validacoes: readonly (readonly string[])[]
  readonly limiteDeTempoMs: number
  /** O JSON Schema que a saída deve obedecer, já serializado. Ausente = saída livre. */
  readonly schemaDeSaida?: string
  readonly autenticacao: ReferenciaDeAutenticacao
  /** Retomada de sessão: a sessão anterior a continuar. Ausente = execução nova. */
  readonly sessaoAnterior?: string
  /** Aborta a execução (timeout do kernel, ou o usuário cancelando). */
  readonly signal?: AbortSignal
}

/**
 * O que o adapter emite, normalizado.
 *
 * União discriminada e não objeto com campos opcionais: o consumidor precisa saber, pelo
 * tipo, que `usage` só existe em `usage` e que `erro` só existe em `failed`. Campos
 * opcionais num objeto único deixariam todo consumidor checando presença em runtime do que
 * o compilador podia garantir.
 *
 * `desconhecido` é o caso que a regra 4 exige: evento que o adapter não reconhece é
 * **preservado como diagnóstico**, sem alterar estado por inferência. Descartá-lo perderia
 * o sinal justo quando o fornecedor muda o formato; inferir transição dele faria o estado
 * do kernel depender de um campo que ninguém contratou.
 */
export type ExecutorEvent =
  | { readonly tipo: 'started'; readonly sessao?: string }
  | { readonly tipo: 'progress'; readonly mensagem: string }
  | { readonly tipo: 'tool_used'; readonly nome: string; readonly argumentos?: string }
  | { readonly tipo: 'path_changed'; readonly path: string }
  | {
      readonly tipo: 'usage'
      readonly tokensEntrada: number
      readonly tokensSaida: number
      readonly duracaoMs?: number
    }
  | { readonly tipo: 'done'; readonly resumo?: string }
  | { readonly tipo: 'failed'; readonly erro: string; readonly assinatura?: string }
  | { readonly tipo: 'canceled' }
  | { readonly tipo: 'desconhecido'; readonly bruto: string }

/**
 * Os eventos que **encerram** a tentativa.
 *
 * Lista nomeada e não `switch` espalhado: a máquina de estados, o runtime e o contract test
 * todos precisam da mesma resposta para "isto é terminal?", e três lugares decidindo por
 * conta própria é onde um deles discorda.
 */
export const EVENTOS_TERMINAIS = ['done', 'failed', 'canceled'] as const
export type EventoTerminal = (typeof EVENTOS_TERMINAIS)[number]

export const STATUS_DO_RESULTADO = ['concluido', 'falhou', 'cancelado', 'recusado'] as const
export type StatusDoResultado = (typeof STATUS_DO_RESULTADO)[number]

/**
 * O resultado estruturado da execução.
 *
 * `recusado` é status de primeira classe, e não uma falha qualquer: a execução recusada pelo
 * critério 4 **não chegou ao CLI**, então não gastou nada e não tem uso a reportar. Tratá-la
 * como `falhou` diria ao PI que o executor tentou e quebrou, quando o runtime o impediu de
 * começar.
 */
export interface ExecutorResult {
  readonly status: StatusDoResultado
  readonly attemptId: string
  readonly resumo?: string
  /** Os paths que o executor **relatou** ter tocado. Observação, não autorização (regra 3). */
  readonly pathsAlterados: readonly string[]
  readonly validacoes: readonly { readonly comando: string; readonly ok: boolean }[]
  /**
   * As evidências, **já redigidas** (regra 5).
   *
   * Passam por `redigirSegredos` antes de entrar aqui porque este campo vai para log e
   * relatório: um token no meio de um argumento de ferramenta é evidência que o PI precisa
   * ver, e barrar a linha inteira esconderia a ferramenta em vez de esconder o segredo.
   */
  readonly evidencias: readonly string[]
  readonly uso?: {
    readonly tokensEntrada: number
    readonly tokensSaida: number
    readonly duracaoMs?: number
  }
  /** A sessão a retomar, quando o executor a ofereceu. */
  readonly sessaoRetomavel?: string
  /**
   * A assinatura da falha (critério 6).
   *
   * Nossa e não do fornecedor: é o que permite agrupar "a mesma falha" entre executores
   * diferentes. Depender do código de erro interno do Codex faria toda consulta de
   * auditoria quebrar quando ele mudasse a numeração.
   */
  readonly assinaturaDeFalha?: string
  /** Eventos que o adapter não reconheceu, preservados como diagnóstico (regra 4). */
  readonly diagnosticos: readonly string[]
}

/**
 * Um executor de código, reduzido ao que o kernel precisa.
 *
 * Dois métodos. `executar` é o trabalho; `disponivel` é a pergunta mais barata que prova
 * que o executor existe e responde — e é o que o health por executor da spec consome.
 * A tentação seria acrescentar `listarModelos`, `versao`, `autenticar`: tudo isso é F02/F03
 * e não tem consumidor hoje.
 */
export interface CodingExecutorAdapter {
  /** O identificador do executor — o mesmo valor de `ExecutorRequest.executor`. */
  readonly nome: string
  /**
   * Os modos de cobrança que este executor atende.
   *
   * Declarado pelo adapter e verificado pelo runtime **antes** de iniciar o CLI (critério 4):
   * é o que transforma "modo incompatível" de erro descoberto tarde em recusa barata.
   */
  readonly modosSuportados: readonly ModoDeCobranca[]
  /** As revisões que este executor conhece. Revisão fora desta lista é recusada. */
  readonly revisoesSuportadas: readonly string[]
  /** `true` quando o executor aceita impor um JSON Schema à saída. */
  readonly suportaSchemaDeSaida: boolean

  /** O executor está instalado e responde? Nunca lança — ausência é a resposta `false`. */
  disponivel(): Promise<boolean>

  /**
   * Dispara a execução e devolve os eventos conforme chegam.
   *
   * `AsyncIterable` e não callback: o runtime precisa decidir quando parar de consumir (o
   * cancelamento é isso), e um callback inverteria esse controle para dentro do adapter.
   *
   * Lança em falha de processo ou timeout; quem traduz exceção em `ExecutorResult` é o
   * runtime, um lugar só, para todo executor.
   */
  executar(request: ExecutorRequest): AsyncIterable<ExecutorEvent>
}
```

- [ ] **Passo 2: Verificar que compila**

Rode: `npx tsc --noEmit -p tsconfig.node.json`

Esperado: sem erros. Se acusar erro em arquivo **não relacionado** a `executors/`, isso é pré-existente — anote e siga; se acusar em `executor.ts`, corrija antes de continuar.

- [ ] **Passo 3: Commit**

```bash
git add src/main/executors/executor.ts
git commit -m "feat: contrato de executor de codigo (M10-F01)

Tipos do contrato entre kernel e CLI executor: request normalizado,
eventos normalizados, resultado estruturado e a interface do adapter.
Sem logica e sem import de Node — e o que F02/F03 importam.

refs #116

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarefa 2: Máquina de estados da tentativa

**Arquivos:**
- Criar: `src/main/executors/attempt-state.ts`
- Teste: `src/main/executors/attempt-state.spec.ts`

**Interfaces:**
- Consome: `ExecutorEvent`, `EVENTOS_TERMINAIS` de `./executor`.
- Produz: `FASES_DA_TENTATIVA`, `FaseDaTentativa`, `EstadoDaTentativa`, `estadoInicial(attemptId)`, `aplicarEvento(estado, evento)`, `isTerminal(fase)`.

- [ ] **Passo 1: Escrever o teste que falha**

Crie `src/main/executors/attempt-state.spec.ts`:

```ts
/**
 * A máquina de estados da tentativa (SPEC-Multi-Executor-01, critério 2 e regras 1 e 4).
 *
 * Project `regras`: é lógica pura, sem processo, sem disco, sem timer. O que estes testes
 * provam é que a **ordem de chegada dos eventos não corrompe o estado** — e isso não precisa
 * de um CLI de verdade para ser verdade.
 */

import { describe, expect, it } from 'vitest'
import { aplicarEvento, estadoInicial, isTerminal } from './attempt-state'

describe('estadoInicial', () => {
  it('abre a tentativa em aberta, sem eventos consumidos', () => {
    const estado = estadoInicial('att-1')

    expect(estado.attemptId).toBe('att-1')
    expect(estado.fase).toBe('aberta')
    expect(estado.pathsAlterados).toEqual([])
    expect(estado.diagnosticos).toEqual([])
  })
})

describe('aplicarEvento — caminho felizes', () => {
  it('started move de aberta para executando e guarda a sessao', () => {
    const depois = aplicarEvento(estadoInicial('att-1'), { tipo: 'started', sessao: 'ses-9' })

    expect(depois.fase).toBe('executando')
    expect(depois.sessao).toBe('ses-9')
  })

  it('done move para concluida e guarda o resumo', () => {
    const executando = aplicarEvento(estadoInicial('att-1'), { tipo: 'started' })
    const depois = aplicarEvento(executando, { tipo: 'done', resumo: 'fatia pronta' })

    expect(depois.fase).toBe('concluida')
    expect(depois.resumo).toBe('fatia pronta')
    expect(isTerminal(depois.fase)).toBe(true)
  })

  it('usage acumula o uso sem encerrar a tentativa', () => {
    const executando = aplicarEvento(estadoInicial('att-1'), { tipo: 'started' })
    const depois = aplicarEvento(executando, {
      tipo: 'usage',
      tokensEntrada: 10,
      tokensSaida: 20,
      duracaoMs: 300
    })

    expect(depois.fase).toBe('executando')
    expect(depois.uso).toEqual({ tokensEntrada: 10, tokensSaida: 20, duracaoMs: 300 })
  })

  it('path_changed acumula o path relatado', () => {
    const executando = aplicarEvento(estadoInicial('att-1'), { tipo: 'started' })
    const depois = aplicarEvento(executando, { tipo: 'path_changed', path: 'src/a.ts' })

    expect(depois.pathsAlterados).toEqual(['src/a.ts'])
  })
})

describe('aplicarEvento — o estado nao corrompe (criterio 2)', () => {
  it('started duplicado nao reabre nem duplica a sessao', () => {
    const uma = aplicarEvento(estadoInicial('att-1'), { tipo: 'started', sessao: 'ses-1' })
    const outra = aplicarEvento(uma, { tipo: 'started', sessao: 'ses-2' })

    expect(outra.fase).toBe('executando')
    // A primeira sessão vence: trocá-la faria o kernel retomar a sessão errada depois.
    expect(outra.sessao).toBe('ses-1')
    expect(outra.diagnosticos).toHaveLength(1)
  })

  it('path_changed repetido nao duplica o path na lista', () => {
    const executando = aplicarEvento(estadoInicial('att-1'), { tipo: 'started' })
    const uma = aplicarEvento(executando, { tipo: 'path_changed', path: 'src/a.ts' })
    const outra = aplicarEvento(uma, { tipo: 'path_changed', path: 'src/a.ts' })

    expect(outra.pathsAlterados).toEqual(['src/a.ts'])
  })

  it('evento fora de ordem (progress antes de started) nao inventa transicao', () => {
    const depois = aplicarEvento(estadoInicial('att-1'), { tipo: 'progress', mensagem: 'oi' })

    // Continua `aberta`: só `started` abre a execução. Inferir início de um `progress`
    // faria o estado do kernel depender de qual evento o fornecedor emite primeiro.
    expect(depois.fase).toBe('aberta')
    expect(depois.diagnosticos).toHaveLength(1)
  })

  it('evento apos terminal nao reabre o estado (regra 1)', () => {
    const executando = aplicarEvento(estadoInicial('att-1'), { tipo: 'started' })
    const concluida = aplicarEvento(executando, { tipo: 'done' })
    const depois = aplicarEvento(concluida, { tipo: 'progress', mensagem: 'atrasado' })

    expect(depois.fase).toBe('concluida')
    expect(depois.diagnosticos).toHaveLength(1)
  })

  it('failed apos done nao troca o desfecho', () => {
    const executando = aplicarEvento(estadoInicial('att-1'), { tipo: 'started' })
    const concluida = aplicarEvento(executando, { tipo: 'done' })
    const depois = aplicarEvento(concluida, { tipo: 'failed', erro: 'tarde' })

    expect(depois.fase).toBe('concluida')
    expect(depois.erro).toBeUndefined()
  })

  it('evento desconhecido vira diagnostico sem alterar a fase (regra 4)', () => {
    const executando = aplicarEvento(estadoInicial('att-1'), { tipo: 'started' })
    const depois = aplicarEvento(executando, { tipo: 'desconhecido', bruto: '{"x":1}' })

    expect(depois.fase).toBe('executando')
    expect(depois.diagnosticos).toEqual(['{"x":1}'])
  })

  it('nao muta o estado recebido', () => {
    const executando = aplicarEvento(estadoInicial('att-1'), { tipo: 'started' })
    aplicarEvento(executando, { tipo: 'path_changed', path: 'src/a.ts' })

    expect(executando.pathsAlterados).toEqual([])
  })
})

describe('aplicarEvento — cancelamento', () => {
  it('canceled encerra a tentativa', () => {
    const executando = aplicarEvento(estadoInicial('att-1'), { tipo: 'started' })
    const depois = aplicarEvento(executando, { tipo: 'canceled' })

    expect(depois.fase).toBe('cancelada')
    expect(isTerminal(depois.fase)).toBe(true)
  })

  it('canceled repetido mantem um unico desfecho', () => {
    const executando = aplicarEvento(estadoInicial('att-1'), { tipo: 'started' })
    const uma = aplicarEvento(executando, { tipo: 'canceled' })
    const outra = aplicarEvento(uma, { tipo: 'canceled' })

    expect(outra.fase).toBe('cancelada')
    expect(outra.diagnosticos).toHaveLength(1)
  })
})
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rode: `npx vitest run --project regras src/main/executors/attempt-state.spec.ts`

Esperado: FALHA com erro de módulo não encontrado (`Failed to resolve import "./attempt-state"`).

- [ ] **Passo 3: Implementar a máquina**

Crie `src/main/executors/attempt-state.ts`:

```ts
/**
 * A máquina de estados da tentativa (SPEC-Multi-Executor-01, critério 2 e regras 1 e 4).
 *
 * Pura de propósito: recebe estado e evento, devolve estado novo. Nenhum I/O, nenhum timer,
 * nenhum processo. São exatamente as decisões que a spec exige serem determinísticas — e
 * mantê-las aqui é o que permite provar "evento duplicado não corrompe" sem subir um CLI.
 *
 * A postura diante de evento inesperado é sempre a mesma: **registrar como diagnóstico, não
 * inferir transição** (regra 4). Um stream de CLI chega fora de ordem, repetido e atrasado
 * na vida real; uma máquina que adivinha a intenção de cada evento é uma máquina cujo estado
 * depende de qual mensagem o fornecedor decidiu emitir primeiro.
 */

import { EVENTOS_TERMINAIS, type ExecutorEvent, type EventoTerminal } from './executor'

/**
 * As fases de uma tentativa.
 *
 * `aberta` é o estado que **só o kernel cria** (regra 1): a tentativa existe porque o kernel
 * a abriu, não porque um evento chegou. `executando` começa com `started`. As três últimas
 * são terminais e não voltam atrás.
 */
export const FASES_DA_TENTATIVA = [
  'aberta',
  'executando',
  'concluida',
  'falhou',
  'cancelada'
] as const
export type FaseDaTentativa = (typeof FASES_DA_TENTATIVA)[number]

const FASES_TERMINAIS: readonly FaseDaTentativa[] = ['concluida', 'falhou', 'cancelada']

/** A fase encerra a tentativa? Evento que chega depois dela é diagnóstico, nunca transição. */
export function isTerminal(fase: FaseDaTentativa): boolean {
  return FASES_TERMINAIS.includes(fase)
}

/** O estado acumulado da tentativa. Imutável: `aplicarEvento` devolve cópia. */
export interface EstadoDaTentativa {
  readonly attemptId: string
  readonly fase: FaseDaTentativa
  readonly sessao?: string
  readonly resumo?: string
  readonly erro?: string
  readonly assinaturaDeFalha?: string
  readonly pathsAlterados: readonly string[]
  readonly uso?: {
    readonly tokensEntrada: number
    readonly tokensSaida: number
    readonly duracaoMs?: number
  }
  /**
   * Tudo que não virou transição: evento desconhecido, duplicado, fora de ordem e atrasado.
   *
   * Uma lista só para os quatro casos porque a pergunta que ela responde é uma: "o que
   * chegou e o kernel não usou?". Separá-los em quatro campos daria quatro lugares para o
   * relatório esquecer de ler.
   */
  readonly diagnosticos: readonly string[]
}

/** Abre a tentativa. **Só o kernel chama isto** (regra 1). */
export function estadoInicial(attemptId: string): EstadoDaTentativa {
  return {
    attemptId,
    fase: 'aberta',
    pathsAlterados: [],
    diagnosticos: []
  }
}

/** Acrescenta um diagnóstico, preservando o resto do estado. */
function comDiagnostico(estado: EstadoDaTentativa, motivo: string): EstadoDaTentativa {
  return { ...estado, diagnosticos: [...estado.diagnosticos, motivo] }
}

/**
 * Aplica um evento ao estado.
 *
 * A ordem das guardas importa: **terminal primeiro**. Um `failed` que chega depois de um
 * `done` não pode trocar o desfecho, e checar isso antes de qualquer outra coisa é o que
 * torna a garantia independente do tipo do evento atrasado.
 */
export function aplicarEvento(
  estado: EstadoDaTentativa,
  evento: ExecutorEvent
): EstadoDaTentativa {
  if (isTerminal(estado.fase)) {
    return comDiagnostico(estado, `evento ${evento.tipo} apos estado terminal ${estado.fase}`)
  }

  switch (evento.tipo) {
    case 'started':
      // Duplicado mantém a **primeira** sessão: o kernel retoma pelo que guardou aqui, e
      // trocar por uma sessão posterior o faria retomar a sessão errada.
      if (estado.fase === 'executando') {
        return comDiagnostico(estado, 'started duplicado')
      }
      return {
        ...estado,
        fase: 'executando',
        ...(evento.sessao === undefined ? {} : { sessao: evento.sessao })
      }

    case 'progress':
      // Progresso não move a máquina — ele é texto para quem observa. Antes de `started`
      // ele é fora de ordem, e inferir início dele seria adivinhar.
      if (estado.fase !== 'executando') {
        return comDiagnostico(estado, 'progress antes de started')
      }
      return estado

    case 'tool_used':
      if (estado.fase !== 'executando') {
        return comDiagnostico(estado, 'tool_used antes de started')
      }
      return estado

    case 'path_changed': {
      if (estado.fase !== 'executando') {
        return comDiagnostico(estado, 'path_changed antes de started')
      }
      // `Set` não serve porque a ordem importa no relatório; o `includes` num array de
      // paths de uma tentativa é barato e mantém a ordem de chegada.
      if (estado.pathsAlterados.includes(evento.path)) return estado
      return { ...estado, pathsAlterados: [...estado.pathsAlterados, evento.path] }
    }

    case 'usage':
      if (estado.fase !== 'executando') {
        return comDiagnostico(estado, 'usage antes de started')
      }
      return {
        ...estado,
        uso: {
          tokensEntrada: evento.tokensEntrada,
          tokensSaida: evento.tokensSaida,
          ...(evento.duracaoMs === undefined ? {} : { duracaoMs: evento.duracaoMs })
        }
      }

    case 'done':
      return {
        ...estado,
        fase: 'concluida',
        ...(evento.resumo === undefined ? {} : { resumo: evento.resumo })
      }

    case 'failed':
      return {
        ...estado,
        fase: 'falhou',
        erro: evento.erro,
        ...(evento.assinatura === undefined ? {} : { assinaturaDeFalha: evento.assinatura })
      }

    case 'canceled':
      return { ...estado, fase: 'cancelada' }

    case 'desconhecido':
      // O caso da regra 4: preserva o bruto e **não** altera a fase.
      return comDiagnostico(estado, evento.bruto)
  }
}

/** Reexporta para quem precisa da lista sem importar dois módulos. */
export { EVENTOS_TERMINAIS, type EventoTerminal }
```

- [ ] **Passo 4: Rodar o teste e confirmar que passa**

Rode: `npx vitest run --project regras src/main/executors/attempt-state.spec.ts`

Esperado: PASSA, 13 testes.

- [ ] **Passo 5: Provar o contrafactual da regra 1**

Este passo **mede** que o teste pega o defeito, em vez de confiar que pega. Em `attempt-state.ts`, comente temporariamente a guarda de terminal:

```ts
  // if (isTerminal(estado.fase)) {
  //   return comDiagnostico(estado, `evento ${evento.tipo} apos estado terminal ${estado.fase}`)
  // }
```

Rode: `npx vitest run --project regras src/main/executors/attempt-state.spec.ts`

Esperado: **FALHA** em `evento apos terminal nao reabre o estado` e em `failed apos done nao troca o desfecho`. Se passar, o teste não mede o que diz medir — conserte o teste antes de seguir.

Depois **restaure a guarda** e rode de novo: PASSA, 13 testes.

- [ ] **Passo 6: Commit**

```bash
git add src/main/executors/attempt-state.ts src/main/executors/attempt-state.spec.ts
git commit -m "feat: maquina de estados da tentativa de executor (M10-F01)

Evento duplicado, fora de ordem, pos-terminal e desconhecido viram
diagnostico em vez de transicao (criterio 2, regras 1 e 4). Logica pura,
sem I/O — project regras. Contrafactual medido: sem a guarda de terminal,
dois testes reprovam.

refs #116

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarefa 3: Recusa antes de iniciar o CLI

**Arquivos:**
- Criar: `src/main/executors/validar-request.ts`
- Teste: `src/main/executors/validar-request.spec.ts`

**Interfaces:**
- Consome: `ExecutorRequest`, `CodingExecutorAdapter` de `./executor`.
- Produz: `Recusa`, `validarRequest(request, adapter)` → `Recusa | undefined`.

- [ ] **Passo 1: Escrever o teste que falha**

Crie `src/main/executors/validar-request.spec.ts`:

```ts
/**
 * As recusas que acontecem **antes** de o CLI iniciar (SPEC-Multi-Executor-01, critério 4).
 *
 * Project `regras`: a decisão é pura — compara o que o request pede com o que o adapter
 * declara suportar. O ponto da fatia é que esta comparação aconteça **antes** do spawn, e
 * provar isso não exige spawn nenhum.
 */

import { describe, expect, it } from 'vitest'
import type { CodingExecutorAdapter, ExecutorRequest } from './executor'
import { validarRequest } from './validar-request'

/** Um adapter de mentira só com os campos declarativos que a validação lê. */
function adapterQueSuporta(
  parcial: Partial<
    Pick<
      CodingExecutorAdapter,
      'modosSuportados' | 'revisoesSuportadas' | 'suportaSchemaDeSaida'
    >
  > = {}
): CodingExecutorAdapter {
  return {
    nome: 'fake',
    modosSuportados: parcial.modosSuportados ?? ['unmetered'],
    revisoesSuportadas: parcial.revisoesSuportadas ?? ['revisao-padrao'],
    suportaSchemaDeSaida: parcial.suportaSchemaDeSaida ?? true,
    disponivel: async () => true,
    // eslint-disable-next-line require-yield
    executar: async function* () {
      throw new Error('a validacao devia ter recusado antes de chegar aqui')
    }
  }
}

function requestValido(sobrescrever: Partial<ExecutorRequest> = {}): ExecutorRequest {
  return {
    runId: 'run-1',
    attemptId: 'att-1',
    chaveIdempotente: 'chave-1',
    executor: 'fake',
    modelo: 'modelo-x',
    modoDeCobranca: 'unmetered',
    revisoesAprovadas: ['revisao-padrao'],
    contextPackId: 'pack-1',
    worktree: '/tmp/wt',
    pathsPermitidos: ['src'],
    validacoes: [['npm', 'test']],
    limiteDeTempoMs: 1_000,
    autenticacao: { referencia: 'sessao-1' },
    ...sobrescrever
  }
}

describe('validarRequest', () => {
  it('aceita o request compativel', () => {
    expect(validarRequest(requestValido(), adapterQueSuporta())).toBeUndefined()
  })

  it('recusa modo de cobranca que o executor nao suporta', () => {
    const recusa = validarRequest(
      requestValido({ modoDeCobranca: 'metered' }),
      adapterQueSuporta({ modosSuportados: ['unmetered'] })
    )

    expect(recusa?.motivo).toBe('modo-de-cobranca')
    // A mensagem nomeia o que recusou e o que é aceito: sem isso, o operador
    // descobre "recusado" e não descobre o que mudar.
    expect(recusa?.mensagem).toContain('metered')
    expect(recusa?.mensagem).toContain('unmetered')
  })

  it('recusa revisao que o executor nao conhece', () => {
    const recusa = validarRequest(
      requestValido({ revisoesAprovadas: ['revisao-padrao', 'revisao-exotica'] }),
      adapterQueSuporta({ revisoesSuportadas: ['revisao-padrao'] })
    )

    expect(recusa?.motivo).toBe('revisao')
    expect(recusa?.mensagem).toContain('revisao-exotica')
  })

  it('recusa schema de saida quando o executor nao o impoe', () => {
    const recusa = validarRequest(
      requestValido({ schemaDeSaida: '{"type":"object"}' }),
      adapterQueSuporta({ suportaSchemaDeSaida: false })
    )

    expect(recusa?.motivo).toBe('schema')
  })

  it('aceita ausencia de schema mesmo quando o executor nao o suporta', () => {
    const recusa = validarRequest(
      requestValido(),
      adapterQueSuporta({ suportaSchemaDeSaida: false })
    )

    expect(recusa).toBeUndefined()
  })

  it('recusa executor diferente do que o adapter atende', () => {
    const recusa = validarRequest(requestValido({ executor: 'outro' }), adapterQueSuporta())

    expect(recusa?.motivo).toBe('executor')
  })

  it('a mensagem de recusa nao carrega a referencia de autenticacao', () => {
    const recusa = validarRequest(
      requestValido({
        modoDeCobranca: 'metered',
        autenticacao: { referencia: 'sessao-secreta-1' }
      }),
      adapterQueSuporta({ modosSuportados: ['unmetered'] })
    )

    // Afirma **ausência**: mensagem de erro é caminho clássico de vazamento, e a
    // referência não tem por que aparecer para explicar um modo incompatível.
    expect(recusa?.mensagem).not.toContain('sessao-secreta-1')
  })
})
```

- [ ] **Passo 2: Rodar o teste e confirmar que falha**

Rode: `npx vitest run --project regras src/main/executors/validar-request.spec.ts`

Esperado: FALHA com `Failed to resolve import "./validar-request"`.

- [ ] **Passo 3: Implementar a validação**

Crie `src/main/executors/validar-request.ts`:

```ts
/**
 * A recusa que acontece **antes** de o CLI iniciar (SPEC-Multi-Executor-01, critério 4).
 *
 * Por que antes importa: modo de cobrança errado descoberto no meio do stream é custo já
 * gasto; revisão desconhecida descoberta lá é trabalho já feito sob regra que ninguém
 * aprovou; schema que o executor não impõe descoberto lá é saída que já nasceu fora de
 * forma. Nos três casos a informação para decidir já existe antes do spawn — o que faltava
 * era um lugar que a olhasse.
 *
 * Pura, e separada do runtime, porque é a parte do critério 4 que se prova sem processo: a
 * decisão é comparar o que o request pede com o que o adapter declara.
 */

import type { CodingExecutorAdapter, ExecutorRequest } from './executor'

/** Por que o runtime recusou. O motivo é o que a auditoria agrupa; a mensagem, o que o PI lê. */
export interface Recusa {
  readonly motivo: 'executor' | 'modo-de-cobranca' | 'revisao' | 'schema'
  readonly mensagem: string
}

/**
 * Devolve a recusa, ou `undefined` quando o request é compatível.
 *
 * Nunca lança: recusa é desfecho previsto, não exceção — o runtime a transforma em
 * `ExecutorResult` com status `recusado`, e um throw obrigaria cada chamador a lembrar de
 * traduzi-lo.
 *
 * **A mensagem nunca cita `autenticacao`.** Nem a referência é segredo, mas mensagem de erro
 * é o caminho por onde dado sensível vaza para log e tela, e nada aqui precisa dela para
 * explicar uma incompatibilidade de modo, revisão ou schema.
 */
export function validarRequest(
  request: ExecutorRequest,
  adapter: CodingExecutorAdapter
): Recusa | undefined {
  if (request.executor !== adapter.nome) {
    return {
      motivo: 'executor',
      mensagem: `O pedido é para o executor ${request.executor}, e este adapter atende ${adapter.nome}.`
    }
  }

  if (!adapter.modosSuportados.includes(request.modoDeCobranca)) {
    return {
      motivo: 'modo-de-cobranca',
      mensagem: `O executor ${adapter.nome} não atende o modo de cobrança ${request.modoDeCobranca}. Modos aceitos: ${adapter.modosSuportados.join(', ')}.`
    }
  }

  const revisoesDesconhecidas = request.revisoesAprovadas.filter(
    (revisao) => !adapter.revisoesSuportadas.includes(revisao)
  )
  if (revisoesDesconhecidas.length > 0) {
    return {
      motivo: 'revisao',
      mensagem: `O executor ${adapter.nome} não conhece a revisão ${revisoesDesconhecidas.join(', ')}. Revisões aceitas: ${adapter.revisoesSuportadas.join(', ')}.`
    }
  }

  // Só recusa quando o schema **existe** e o executor não o impõe. Ausência de schema com
  // executor que não o suporta é o caso normal — recusá-lo barraria toda execução de saída
  // livre num executor que nunca prometeu schema.
  if (request.schemaDeSaida !== undefined && !adapter.suportaSchemaDeSaida) {
    return {
      motivo: 'schema',
      mensagem: `O executor ${adapter.nome} não impõe schema de saída, e este pedido declara um.`
    }
  }

  return undefined
}
```

- [ ] **Passo 4: Rodar o teste e confirmar que passa**

Rode: `npx vitest run --project regras src/main/executors/validar-request.spec.ts`

Esperado: PASSA, 7 testes.

- [ ] **Passo 5: Commit**

```bash
git add src/main/executors/validar-request.ts src/main/executors/validar-request.spec.ts
git commit -m "feat: recusa de modo, revisao e schema antes do CLI (M10-F01)

Criterio 4: a comparacao entre o que o request pede e o que o adapter
declara acontece antes do spawn, quando ainda da para nao gastar.
Recusa e desfecho previsto, nunca excecao; a mensagem nomeia o que
mudar e nao cita a referencia de autenticacao.

refs #116

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarefa 4: Adapter fake controlável

**Arquivos:**
- Criar: `src/main/executors/fake-coding-executor-adapter.ts`

**Interfaces:**
- Consome: `CodingExecutorAdapter`, `ExecutorEvent`, `ExecutorRequest`, `ModoDeCobranca` de `./executor`.
- Produz: `FakeCodingExecutorAdapter` (classe), `RoteiroDoFake` (tipo do construtor).

- [ ] **Passo 1: Criar o fake**

Não há teste próprio nesta tarefa: o fake **é** instrumento de teste, e quem o prova é o contract test da Tarefa 5 — que só existe se o fake existir. Crie `src/main/executors/fake-coding-executor-adapter.ts`:

```ts
/**
 * O executor de mentira que percorre todos os desfechos (SPEC-Multi-Executor-01, critério 1).
 *
 * Exportado do código de produção, e não escondido num arquivo de teste, porque F02 e F03
 * vão reusá-lo: o contract test do adapter do Codex precisa comparar o comportamento real
 * com um comportamento de referência, e duas cópias do fake é onde uma delas fica para trás.
 *
 * O que ele permite controlar é exatamente o que o contrato promete tolerar: a sequência de
 * eventos (incluindo duplicado, fora de ordem e desconhecido), o atraso entre eles (para o
 * timeout ter o que interromper) e se o processo **resiste** ao cancelamento (para provar que
 * quem o encerra é o runtime, não a boa vontade do executor).
 */

import type {
  CodingExecutorAdapter,
  ExecutorEvent,
  ExecutorRequest,
  ModoDeCobranca
} from './executor'

export interface RoteiroDoFake {
  /** Os eventos a emitir, na ordem dada — inclusive uma ordem inválida de propósito. */
  readonly eventos: readonly ExecutorEvent[]
  /**
   * Espera antes de **cada** evento, em ms.
   *
   * Existe para o teste de timeout: um fake que responde instantâneo nunca dá ao relógio
   * o que interromper, e o teste passaria sem medir nada.
   */
  readonly atrasoMs?: number
  /**
   * `true` faz o fake **ignorar** o `signal` e seguir emitindo.
   *
   * É o dublê do processo que não colabora, e é o que dá sentido ao critério 3: se o fake
   * terminasse sozinho ao ver o sinal, o teste do cancelamento provaria a educação do fake
   * em vez da eficácia do runtime.
   */
  readonly ignoraCancelamento?: boolean
  /** Lança em vez de emitir, para o caminho de exceção do adapter. */
  readonly lancaAntesDeEmitir?: string
  readonly modosSuportados?: readonly ModoDeCobranca[]
  readonly revisoesSuportadas?: readonly string[]
  readonly suportaSchemaDeSaida?: boolean
  readonly estaDisponivel?: boolean
}

export class FakeCodingExecutorAdapter implements CodingExecutorAdapter {
  readonly nome = 'fake'
  readonly modosSuportados: readonly ModoDeCobranca[]
  readonly revisoesSuportadas: readonly string[]
  readonly suportaSchemaDeSaida: boolean

  /**
   * Quantas vezes `executar` foi chamado.
   *
   * O contract test o usa para provar o critério 4 pelo lado negativo: request recusado
   * deixa este contador em zero, e um contador que sobe prova que o CLI iniciou antes da
   * recusa — que é o defeito que o critério existe para fechar.
   */
  chamadasDeExecucao = 0
  /** Os requests recebidos, para o teste do critério 5 inspecionar o que **não** chegou. */
  readonly requestsRecebidos: ExecutorRequest[] = []
  /** Quantas vezes o fake observou o sinal de cancelamento disparar. */
  cancelamentosObservados = 0

  constructor(private readonly roteiro: RoteiroDoFake) {
    this.modosSuportados = roteiro.modosSuportados ?? ['unmetered']
    this.revisoesSuportadas = roteiro.revisoesSuportadas ?? ['revisao-padrao']
    this.suportaSchemaDeSaida = roteiro.suportaSchemaDeSaida ?? true
  }

  async disponivel(): Promise<boolean> {
    return this.roteiro.estaDisponivel ?? true
  }

  async *executar(request: ExecutorRequest): AsyncIterable<ExecutorEvent> {
    this.chamadasDeExecucao += 1
    this.requestsRecebidos.push(request)

    if (this.roteiro.lancaAntesDeEmitir !== undefined) {
      throw new Error(this.roteiro.lancaAntesDeEmitir)
    }

    const atraso = this.roteiro.atrasoMs ?? 0

    for (const evento of this.roteiro.eventos) {
      if (atraso > 0) {
        await new Promise((resolve) => setTimeout(resolve, atraso))
      }

      if (request.signal?.aborted === true) {
        this.cancelamentosObservados += 1
        // Sem `ignoraCancelamento`, o fake para — é o executor colaborativo. Com ele, segue
        // emitindo, e o encerramento tem de vir do runtime.
        if (this.roteiro.ignoraCancelamento !== true) return
      }

      yield evento
    }
  }
}
```

- [ ] **Passo 2: Verificar que compila**

Rode: `npx tsc --noEmit -p tsconfig.node.json`

Esperado: sem erros novos em `src/main/executors/`.

- [ ] **Passo 3: Commit**

```bash
git add src/main/executors/fake-coding-executor-adapter.ts
git commit -m "feat: adapter fake controlavel de executor (M10-F01)

Percorre sucesso, falha, timeout, cancelamento e retomada por roteiro,
inclusive evento duplicado, fora de ordem e desconhecido. Exportado do
codigo de producao porque F02/F03 reusam — duas copias e onde uma fica
para tras. ignoraCancelamento existe para o criterio 3 medir o runtime,
nao a educacao do duble.

refs #116

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarefa 5: O runtime

**Arquivos:**
- Criar: `src/main/executors/coding-executor-runtime.ts`

**Interfaces:**
- Consome: `CodingExecutorAdapter`, `ExecutorRequest`, `ExecutorResult`, `ExecutorEvent` de `./executor`; `aplicarEvento`, `estadoInicial`, `isTerminal`, `EstadoDaTentativa` de `./attempt-state`; `validarRequest`, `Recusa` de `./validar-request`; `redigirSegredos` de `@shared/domain/segredos`; `redact` de `@shared/contracts/logging-redaction`.
- Produz: `CodingExecutorRuntime` (classe) com `executar(request, adapter)`, `cancelar(attemptId)`, `saudeDoExecutor(adapter)`; `MatadorDeProcesso` (tipo da injeção).

- [ ] **Passo 1: Implementar o runtime**

O teste desta tarefa é o contract test da Tarefa 6 — ele exercita o runtime inteiro e é onde os critérios 1, 2, 3, 5 e 6 são medidos. Escrevemos o runtime aqui e o teste na tarefa seguinte, então este é o único par implementação-antes-de-teste do plano, e a razão é que o contract test **é** o teste do runtime: escrevê-lo antes exigiria inventar duas vezes a mesma assinatura.

Crie `src/main/executors/coding-executor-runtime.ts`:

```ts
/**
 * O runtime dos executores de código (SPEC-Multi-Executor-01).
 *
 * A pergunta que este serviço responde: **dado um pedido já decidido pelo kernel e um
 * adapter que sabe falar com um CLI, o que aconteceu, o que mudou e quanto custou?**
 *
 * Irmão de `AIProviderRuntime` e `ConnectorRuntime` (ARCHITECTURE § Pipeline V2), e a
 * **única** porta de entrada para executar código por CLI. Não é organização: é onde a
 * recusa do critério 4 mora, e um segundo caminho até um adapter seria um caminho sem essa
 * recusa — o modo de cobrança deixaria de ser garantia para virar convenção.
 *
 * O que ele faz, nesta ordem:
 *   1. **recusa** request incompatível, antes de tocar o adapter (critério 4);
 *   2. **abre** a tentativa — só o kernel abre (regra 1);
 *   3. **consome** os eventos do adapter alimentando a máquina de estados, que decide o que
 *      é transição e o que é diagnóstico (critério 2, regras 1 e 4);
 *   4. **redige** tudo que sai para evidência (regra 5);
 *   5. **encerra** por timeout ou cancelamento idempotente, matando a árvore do processo
 *      (critério 3);
 *   6. devolve `ExecutorResult` — **nunca lança** por falha do executor (critério 6).
 *
 * **O que este runtime não faz:** não escolhe entre executores (F04), não abre PR nem
 * mergeia, não resolve credencial (recebe referência opaca, critério 5), não decide escopo
 * e não autoriza escrita — `path_changed` é observação, e quem verifica o que foi tocado é
 * o kernel, depois (regra 3). O `ConstrutorService` da V1 segue paralelo: a migração do
 * call site é de outra fatia.
 */

import { redigirSegredos } from '@shared/domain/segredos'
import { redact } from '@shared/contracts/logging-redaction'
import { log } from '../logging/logger'
import type {
  CodingExecutorAdapter,
  ExecutorEvent,
  ExecutorRequest,
  ExecutorResult
} from './executor'
import { aplicarEvento, estadoInicial, isTerminal, type EstadoDaTentativa } from './attempt-state'
import { validarRequest, type Recusa } from './validar-request'

/**
 * Quem encerra a árvore de processos de uma tentativa (critério 3).
 *
 * Injetado, e não `process.kill` direto, por duas razões. A primeira é honestidade de
 * fronteira: o runtime não conhece container, PID nem worktree — quem sabe matar o processo
 * do Codex num container é a camada que o subiu. A segunda é o teste: o critério 3 pede que
 * cancelar duas vezes produza **um** efeito, e contar efeitos exige poder observá-los.
 *
 * Ausente = o runtime só aborta o `signal` e para de consumir. É o caso do executor que roda
 * em processo, sem árvore a matar.
 */
export type MatadorDeProcesso = (request: ExecutorRequest) => void

/** O que o runtime guarda de uma tentativa em voo. */
interface TentativaEmVoo {
  readonly controle: AbortController
  readonly request: ExecutorRequest
  /**
   * `true` depois do primeiro cancelamento.
   *
   * É o que faz o cancelamento ser **idempotente** (critério 3): o segundo clique no botão
   * "Cancelar" encontra a flag levantada e não mata nada de novo. Sem ela, `matarProcesso`
   * rodaria uma vez por clique — e no container isso é um `docker exec kill` por clique.
   */
  cancelada: boolean
}

export class CodingExecutorRuntime {
  /**
   * As tentativas em voo, para que `cancelar` alcance a certa.
   *
   * Mora no runtime e não no handler de IPC porque é aqui que o `AbortController` existe —
   * o handler só conhece o `attemptId`. Um mapa no transporte precisaria que o runtime lhe
   * entregasse o controle, o que é a mesma coisa por um caminho mais longo e com uma
   * referência a mais viva.
   */
  private readonly emVoo = new Map<string, TentativaEmVoo>()

  constructor(
    private readonly matarProcesso?: MatadorDeProcesso,
    /** Injetável só para o teste não depender do relógio real. */
    private readonly agora: () => number = () => Date.now()
  ) {}

  /**
   * O executor está instalado e responde? (health por executor, spec § Dentro.)
   *
   * Nunca lança: executor ausente é a resposta `false`, que é informação, não erro — a tela
   * de executores precisa poder dizer "não instalado" sem tratar exceção.
   */
  async saudeDoExecutor(adapter: CodingExecutorAdapter): Promise<boolean> {
    try {
      return await adapter.disponivel()
    } catch {
      return false
    }
  }

  /**
   * Cancela uma tentativa em andamento. **Idempotente** (critério 3).
   *
   * No-op quando a tentativa já terminou ou já foi cancelada: cancelar o que acabou é
   * corrida normal entre o clique do usuário e o fim do stream, não erro. Devolve `true`
   * só no cancelamento que **teve efeito**, e é isso que o teste do critério 3 conta.
   */
  cancelar(attemptId: string): boolean {
    const voo = this.emVoo.get(attemptId)
    if (voo === undefined || voo.cancelada) return false

    voo.cancelada = true
    voo.controle.abort()
    // A árvore do processo sai aqui, uma vez só. Abortar o `signal` e esperar o executor
    // terminar sozinho deixaria um filho órfão consumindo a assinatura — e um executor que
    // ignora o pedido educado é exatamente o que este caminho existe para resolver.
    this.matarProcesso?.(voo.request)
    return true
  }

  /**
   * Executa a tentativa e devolve o resultado.
   *
   * **Não lança** por falha do executor: o desfecho ruim é `ExecutorResult` com status
   * `falhou`, `cancelado` ou `recusado` (critério 6). Uma exceção aqui obrigaria cada
   * chamador a lembrar de traduzi-la em estado — e o que não é lembrado vira run travado.
   */
  async executar(
    request: ExecutorRequest,
    adapter: CodingExecutorAdapter
  ): Promise<ExecutorResult> {
    // (1) A recusa vem **antes** de qualquer contato com o adapter (critério 4). Depois do
    // spawn a informação é a mesma e o custo já foi pago.
    const recusa = validarRequest(request, adapter)
    if (recusa !== undefined) return this.recusar(request, recusa)

    // (2) Só o kernel abre a tentativa (regra 1). O estado nasce aqui, não de um evento.
    let estado = estadoInicial(request.attemptId)

    const controle = new AbortController()
    const voo: TentativaEmVoo = { controle, request, cancelada: false }
    this.emVoo.set(request.attemptId, voo)

    // O `signal` do chamador (o kernel cancelando de fora) entra pelo mesmo caminho do
    // botão: um só lugar mata a árvore, e ele é idempotente.
    const abortarDeFora = (): void => {
      this.cancelar(request.attemptId)
    }
    request.signal?.addEventListener('abort', abortarDeFora, { once: true })

    // O relógio arma antes do primeiro evento. O que ele protege não é a execução longa —
    // construir código é lento por natureza — e sim o executor **pendurado**, que sem isto
    // seguraria a tentativa, e o run, para sempre.
    const relogio = setTimeout(() => {
      this.cancelar(request.attemptId)
    }, request.limiteDeTempoMs)

    const inicio = this.agora()
    const evidencias: string[] = []
    let excecao: string | undefined

    try {
      for await (const evento of adapter.executar({ ...request, signal: controle.signal })) {
        // (3) A máquina decide: transição ou diagnóstico. O runtime não interpreta evento —
        // duplicado, fora de ordem, atrasado e desconhecido são problema dela, num lugar só.
        estado = aplicarEvento(estado, evento)

        // (4) A evidência sai redigida (regra 5). `redigirSegredos` age sobre **texto** —
        // um token no meio de um argumento de ferramenta —, e é complementar ao `redact` do
        // log, que age sobre nome de campo. Os dois, porque nenhum dos dois alcança o caso
        // do outro.
        const linha = evidenciaDoEvento(evento)
        if (linha !== undefined) evidencias.push(redigirSegredos(linha))

        // Terminal encerra o consumo. Seguir lendo depois do `done` alimentaria a máquina
        // com eventos que ela já rejeita — trabalho para chegar ao mesmo lugar, com o
        // processo vivo mais tempo do que precisa.
        if (isTerminal(estado.fase)) break
      }
    } catch (erro) {
      // Falha do processo (ENOENT, crash, stream partido). A mensagem do adapter é dado
      // dele, então passa pela redaction antes de virar evidência.
      excecao = redigirSegredos(erro instanceof Error ? erro.message : 'Falha no executor.')
    } finally {
      clearTimeout(relogio)
      request.signal?.removeEventListener('abort', abortarDeFora)
      this.emVoo.delete(request.attemptId)
    }

    const duracaoMs = this.agora() - inicio
    const resultado = this.montarResultado(estado, {
      evidencias,
      duracaoMs,
      cancelada: voo.cancelada,
      ...(excecao === undefined ? {} : { excecao })
    })

    this.registrar(request, resultado, duracaoMs)
    return resultado
  }

  /** O desfecho da recusa: status próprio, uso vazio, adapter intocado (critério 4). */
  private recusar(request: ExecutorRequest, recusa: Recusa): ExecutorResult {
    const resultado: ExecutorResult = {
      status: 'recusado',
      attemptId: request.attemptId,
      resumo: recusa.mensagem,
      pathsAlterados: [],
      validacoes: [],
      evidencias: [recusa.mensagem],
      // A assinatura da recusa é o **motivo**, não a mensagem: é o que agrupa "recusado pelo
      // mesmo problema" na auditoria, e a mensagem carrega nomes que variam por executor.
      assinaturaDeFalha: `recusa:${recusa.motivo}`,
      diagnosticos: []
    }

    this.registrar(request, resultado, 0)
    return resultado
  }

  /**
   * Traduz o estado final em `ExecutorResult`.
   *
   * `cancelada` vence o que a máquina viu, e a razão é o critério 3: um executor que ignora
   * o sinal pode nunca emitir `canceled`, e reportar `falhou` diria que o executor quebrou
   * quando fomos nós que o matamos. A exceção só vira `falhou` quando ninguém cancelou.
   */
  private montarResultado(
    estado: EstadoDaTentativa,
    contexto: {
      readonly evidencias: readonly string[]
      readonly duracaoMs: number
      readonly cancelada: boolean
      readonly excecao?: string
    }
  ): ExecutorResult {
    const status = contexto.cancelada
      ? 'cancelado'
      : estado.fase === 'concluida'
        ? 'concluido'
        : 'falhou'

    // O erro da exceção do processo entra na evidência, não se perde: sem ele, uma falha de
    // spawn chegaria ao relatório como "falhou" sem nada a investigar.
    const evidencias =
      contexto.excecao === undefined
        ? contexto.evidencias
        : [...contexto.evidencias, contexto.excecao]

    const assinatura =
      estado.assinaturaDeFalha ??
      (status === 'falhou' && contexto.excecao !== undefined ? 'processo:excecao' : undefined)

    return {
      status,
      attemptId: estado.attemptId,
      ...(estado.resumo === undefined ? {} : { resumo: estado.resumo }),
      pathsAlterados: estado.pathsAlterados,
      // Validações ficam vazias nesta fatia: quem as roda é o kernel, e o request as declara
      // para o executor saber o que será medido. Preenchê-las aqui exigiria que o runtime
      // executasse comando — que é o `ConstrutorService`, outra camada.
      validacoes: [],
      evidencias,
      ...(estado.uso === undefined ? {} : { uso: { ...estado.uso, duracaoMs: contexto.duracaoMs } }),
      ...(estado.sessao === undefined ? {} : { sessaoRetomavel: estado.sessao }),
      ...(assinatura === undefined ? {} : { assinaturaDeFalha: assinatura }),
      diagnosticos: estado.diagnosticos
    }
  }

  /**
   * O registro auditável (critério 6).
   *
   * Números, identificadores e a **nossa** assinatura de falha — nunca o formato interno do
   * fornecedor. É isso que faz a consulta "quantas tentativas falharam pelo mesmo motivo?"
   * continuar respondendo quando o Codex mudar a numeração dos erros dele.
   *
   * `redact` antes do log porque o contexto é objeto: ele apaga valor de campo sensível por
   * nome, o que `redigirSegredos` (que age sobre texto) não alcança.
   */
  private registrar(
    request: ExecutorRequest,
    resultado: ExecutorResult,
    duracaoMs: number
  ): void {
    const contexto = redact({
      correlationId: request.attemptId,
      runId: request.runId,
      chaveIdempotente: request.chaveIdempotente,
      executor: request.executor,
      modelo: request.modelo,
      modoDeCobranca: request.modoDeCobranca,
      status: resultado.status,
      pathsAlterados: resultado.pathsAlterados.length,
      tokensEntrada: resultado.uso?.tokensEntrada,
      tokensSaida: resultado.uso?.tokensSaida,
      diagnosticos: resultado.diagnosticos.length,
      assinaturaDeFalha: resultado.assinaturaDeFalha,
      duracaoMs
    }) as Record<string, unknown>

    const registrar = resultado.status === 'concluido' ? log.agent.info : log.agent.warn
    registrar(`Tentativa de executor: ${resultado.status}`, contexto)
  }
}

/**
 * A linha de evidência de um evento, ou `undefined` quando o evento não deixa evidência.
 *
 * `progress` e `usage` ficam fora: o primeiro é ruído de acompanhamento e o segundo já vai
 * estruturado no resultado — repeti-lo como texto daria duas contabilidades do mesmo número.
 */
function evidenciaDoEvento(evento: ExecutorEvent): string | undefined {
  switch (evento.tipo) {
    case 'started':
      return 'executor iniciou'
    case 'tool_used':
      return `ferramenta ${evento.nome}${evento.argumentos === undefined ? '' : ` ${evento.argumentos}`}`
    case 'path_changed':
      return `path alterado ${evento.path}`
    case 'done':
      return `executor concluiu${evento.resumo === undefined ? '' : `: ${evento.resumo}`}`
    case 'failed':
      return `executor falhou: ${evento.erro}`
    case 'canceled':
      return 'executor cancelado'
    case 'progress':
    case 'usage':
    case 'desconhecido':
      return undefined
  }
}
```

- [ ] **Passo 2: Verificar que compila e que o logger existe com esse namespace**

Rode: `npx tsc --noEmit -p tsconfig.node.json`

Esperado: sem erros. Se o `tsc` acusar que `log.agent` não existe, abra `src/main/logging/logger.ts`, veja quais namespaces existem e use o que corresponde a pipeline/agente — ajuste as duas chamadas em `registrar` e siga.

- [ ] **Passo 3: Commit**

```bash
git add src/main/executors/coding-executor-runtime.ts
git commit -m "feat: runtime de executores de codigo (M10-F01)

Porta unica de execucao por CLI: recusa antes do spawn, abre a tentativa,
consome os eventos pela maquina de estados, redige a evidencia, encerra
por timeout ou cancelamento idempotente e devolve ExecutorResult sem
lancar. Cancelar duas vezes mata a arvore uma vez; o matador entra por
injecao porque o runtime nao conhece container nem PID.

refs #116

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarefa 6: Contract test reutilizável

**Arquivos:**
- Criar: `src/main/executors/coding-executor-contract.ts`
- Teste: `src/main/executors/coding-executor-runtime.int-spec.ts`

**Interfaces:**
- Consome: tudo das tarefas 1-5.
- Produz: `rodarContractDoExecutor(nome, criarCenario)`, `CenarioDoContrato` (tipo), `requestDeTeste(sobrescrever)`.

- [ ] **Passo 1: Escrever o contract test**

Crie `src/main/executors/coding-executor-contract.ts`:

```ts
/**
 * O contract test reutilizável de adapters de executor (SPEC-Multi-Executor-01, critério 1).
 *
 * Uma função e não um arquivo de teste: é o que F02 e F03 chamam com os adapters reais do
 * Claude Code e do Codex, e o que garante que "sucesso, falha, timeout, cancelamento e
 * retomada" signifiquem a mesma coisa nos três. Um arquivo de teste por adapter, cada um
 * escrevendo seus próprios casos, é onde o terceiro esquece o cancelamento.
 *
 * Mora no código de produção pelo mesmo motivo do fake: quem o importa é o teste de outra
 * fatia, e um helper em `*.spec.ts` não é importável de fora sem arrastar o `describe` do
 * vizinho.
 *
 * O adapter é criado **por cenário** (`criarCenario`), não recebido pronto: cada desfecho
 * precisa de um executor configurado diferente, e um adapter único obrigaria o chamador a
 * reconfigurá-lo entre casos — estado compartilhado entre testes é o que torna suíte
 * verde-por-ordem.
 */

import { describe, expect, it } from 'vitest'
import { CodingExecutorRuntime, type MatadorDeProcesso } from './coding-executor-runtime'
import type { CodingExecutorAdapter, ExecutorRequest } from './executor'

/** Um request completo e válido, para o teste sobrescrever só o que lhe interessa. */
export function requestDeTeste(sobrescrever: Partial<ExecutorRequest> = {}): ExecutorRequest {
  return {
    runId: 'run-1',
    attemptId: 'att-1',
    chaveIdempotente: 'chave-1',
    executor: 'fake',
    modelo: 'modelo-x',
    modoDeCobranca: 'unmetered',
    revisoesAprovadas: ['revisao-padrao'],
    contextPackId: 'pack-1',
    worktree: '/tmp/wt',
    pathsPermitidos: ['src'],
    validacoes: [['npm', 'test']],
    limiteDeTempoMs: 5_000,
    autenticacao: { referencia: 'sessao-1' },
    ...sobrescrever
  }
}

/**
 * O que o chamador do contrato precisa fornecer para cada desfecho.
 *
 * O contrato descreve o desfecho em termos de **comportamento observável** (o executor
 * concluiu, falhou, pendurou, ignorou o cancelamento) e deixa o chamador decidir como
 * produzi-lo no executor dele: no fake é um roteiro de eventos, no adapter real do Codex
 * será uma fixture de JSONL.
 */
export interface CenarioDoContrato {
  /** Executor que conclui com sucesso, relatando um path e o uso. */
  sucesso(): CodingExecutorAdapter
  /** Executor que falha com erro. */
  falha(): CodingExecutorAdapter
  /** Executor que pendura — nunca emite terminal dentro do limite de tempo. */
  pendurado(): CodingExecutorAdapter
  /** Executor que **ignora** o cancelamento e segue emitindo. */
  ignoraCancelamento(): CodingExecutorAdapter
  /** Executor que conclui informando a sessão a retomar. */
  comSessao(sessao: string): CodingExecutorAdapter
  /** Executor que emite duplicado, fora de ordem e desconhecido antes de concluir. */
  eventosDesordenados(): CodingExecutorAdapter
  /** Executor que só aceita `unmetered` e a revisão `revisao-padrao`. */
  restrito(): CodingExecutorAdapter
}

/**
 * Roda o contrato contra um executor.
 *
 * `nome` entra no `describe` para o relatório dizer **qual** adapter reprovou quando dois
 * rodam na mesma suíte.
 */
export function rodarContractDoExecutor(nome: string, criarCenario: () => CenarioDoContrato): void {
  describe(`contrato de executor: ${nome}`, () => {
    it('sucesso: conclui, relata paths e uso (criterio 1)', async () => {
      const runtime = new CodingExecutorRuntime()
      const resultado = await runtime.executar(requestDeTeste(), criarCenario().sucesso())

      expect(resultado.status).toBe('concluido')
      expect(resultado.attemptId).toBe('att-1')
      expect(resultado.pathsAlterados).toContain('src/a.ts')
      expect(resultado.uso?.tokensEntrada).toBeGreaterThan(0)
      expect(resultado.uso?.duracaoMs).toBeGreaterThanOrEqual(0)
    })

    it('falha: devolve status falhou sem lancar (criterios 1 e 6)', async () => {
      const runtime = new CodingExecutorRuntime()
      const resultado = await runtime.executar(requestDeTeste(), criarCenario().falha())

      expect(resultado.status).toBe('falhou')
      // A assinatura é **nossa**: é o que agrupa a falha na auditoria sem depender do
      // formato interno do fornecedor (critério 6).
      expect(resultado.assinaturaDeFalha).toBeDefined()
    })

    it('timeout: o limite de tempo encerra o executor pendurado (criterio 1)', async () => {
      const runtime = new CodingExecutorRuntime()
      const resultado = await runtime.executar(
        requestDeTeste({ limiteDeTempoMs: 40 }),
        criarCenario().pendurado()
      )

      // `cancelado` e não `falhou`: fomos nós que o encerramos, e reportar falha diria que
      // o executor quebrou quando ele apenas demorou mais do que o teto.
      expect(resultado.status).toBe('cancelado')
    })

    it('cancelamento: duas chamadas produzem um unico efeito (criterio 3)', async () => {
      const mortes: string[] = []
      const matar: MatadorDeProcesso = (request) => mortes.push(request.attemptId)
      const runtime = new CodingExecutorRuntime(matar)
      const request = requestDeTeste({ limiteDeTempoMs: 5_000 })

      const execucao = runtime.executar(request, criarCenario().ignoraCancelamento())

      // Espera o executor entrar em voo antes de cancelar: cancelar antes do `for await`
      // testaria o mapa vazio, não o cancelamento.
      await new Promise((resolve) => setTimeout(resolve, 30))

      const primeiro = runtime.cancelar('att-1')
      const segundo = runtime.cancelar('att-1')
      const resultado = await execucao

      expect(primeiro).toBe(true)
      // O segundo não teve efeito — é o que "idempotente" significa aqui.
      expect(segundo).toBe(false)
      expect(mortes).toEqual(['att-1'])
      expect(resultado.status).toBe('cancelado')
    })

    it('cancelar tentativa desconhecida e no-op (criterio 3)', () => {
      const mortes: string[] = []
      const runtime = new CodingExecutorRuntime((request) => mortes.push(request.attemptId))

      expect(runtime.cancelar('att-inexistente')).toBe(false)
      expect(mortes).toEqual([])
    })

    it('retomada: a sessao do executor volta no resultado (criterio 1)', async () => {
      const runtime = new CodingExecutorRuntime()
      const resultado = await runtime.executar(
        requestDeTeste(),
        criarCenario().comSessao('ses-42')
      )

      expect(resultado.sessaoRetomavel).toBe('ses-42')
    })

    it('retomada: o request leva a sessao anterior ao adapter (criterio 1)', async () => {
      const runtime = new CodingExecutorRuntime()
      const adapter = criarCenario().sucesso()
      await runtime.executar(requestDeTeste({ sessaoAnterior: 'ses-7' }), adapter)

      // Sem este caminho, "retomada" seria só ler a sessão de volta — e o executor
      // recomeçaria do zero a cada tentativa sem ninguém notar.
      expect(recebidos(adapter)[0]?.sessaoAnterior).toBe('ses-7')
    })

    it('evento duplicado, fora de ordem e desconhecido nao corrompem o estado (criterio 2)', async () => {
      const runtime = new CodingExecutorRuntime()
      const resultado = await runtime.executar(
        requestDeTeste(),
        criarCenario().eventosDesordenados()
      )

      expect(resultado.status).toBe('concluido')
      // O path duplicado entra uma vez só.
      expect(resultado.pathsAlterados).toEqual(['src/a.ts'])
      // E o que não virou transição ficou registrado, em vez de desaparecer.
      expect(resultado.diagnosticos.length).toBeGreaterThan(0)
    })

    it('modo de cobranca incompativel recusa sem tocar o executor (criterio 4)', async () => {
      const runtime = new CodingExecutorRuntime()
      const adapter = criarCenario().restrito()
      const resultado = await runtime.executar(
        requestDeTeste({ modoDeCobranca: 'metered' }),
        adapter
      )

      expect(resultado.status).toBe('recusado')
      expect(resultado.assinaturaDeFalha).toBe('recusa:modo-de-cobranca')
      // O lado que importa: o CLI **não iniciou**. Um contador acima de zero aqui prova
      // que a recusa chegou depois do spawn, que é o defeito do critério 4.
      expect(execucoes(adapter)).toBe(0)
    })

    it('revisao desconhecida recusa sem tocar o executor (criterio 4)', async () => {
      const runtime = new CodingExecutorRuntime()
      const adapter = criarCenario().restrito()
      const resultado = await runtime.executar(
        requestDeTeste({ revisoesAprovadas: ['revisao-exotica'] }),
        adapter
      )

      expect(resultado.status).toBe('recusado')
      expect(resultado.assinaturaDeFalha).toBe('recusa:revisao')
      expect(execucoes(adapter)).toBe(0)
    })

    it('o adapter nao recebe credencial, so referencia opaca (criterio 5)', async () => {
      const runtime = new CodingExecutorRuntime()
      const adapter = criarCenario().sucesso()
      await runtime.executar(requestDeTeste(), adapter)

      const recebido = recebidos(adapter)[0]
      const chaves = Object.keys(recebido ?? {})

      // Afirma **ausência**: nenhum campo de credencial, token ou segredo atravessa a
      // fronteira. O que o adapter recebe é o identificador da sessão a usar.
      expect(chaves).not.toContain('apiKey')
      expect(chaves).not.toContain('token')
      expect(chaves).not.toContain('credencial')
      expect(recebido?.autenticacao.referencia).toBe('sessao-1')
      expect(JSON.stringify(recebido?.autenticacao)).not.toMatch(/sk-|ghp_|Bearer /)
    })

    it('saude do executor responde sem lancar', async () => {
      const runtime = new CodingExecutorRuntime()

      await expect(runtime.saudeDoExecutor(criarCenario().sucesso())).resolves.toBe(true)
    })
  })
}

/**
 * Lê os requests que o adapter recebeu, quando ele os expõe.
 *
 * O contrato não obriga o adapter a instrumentar-se — um adapter real pode não guardar
 * requests —, então a leitura é tolerante: sem instrumentação, o caso que depende dela é o
 * que o chamador decide fornecer. `unknown` estreitado, nunca `any`.
 */
function recebidos(adapter: CodingExecutorAdapter): readonly ExecutorRequest[] {
  const candidato = (adapter as { requestsRecebidos?: unknown }).requestsRecebidos
  return Array.isArray(candidato) ? (candidato as ExecutorRequest[]) : []
}

/** Quantas vezes o adapter iniciou execução, quando ele o expõe. Ver `recebidos`. */
function execucoes(adapter: CodingExecutorAdapter): number {
  const candidato = (adapter as { chamadasDeExecucao?: unknown }).chamadasDeExecucao
  return typeof candidato === 'number' ? candidato : 0
}
```

- [ ] **Passo 2: Escrever o int-spec que roda o contrato com o fake**

Crie `src/main/executors/coding-executor-runtime.int-spec.ts`:

```ts
/**
 * O runtime de executores, exercitado de ponta a ponta (SPEC-Multi-Executor-01).
 *
 * Project `banco` (`*.int-spec.ts` em `src/main`): o arquivo usa timer real e o logger, que
 * é singleton de processo — a categoria roda serial por isso. A lógica pura de estado e de
 * recusa tem teste próprio em `regras`; aqui o que se mede é o runtime **inteiro**, com o
 * contrato que F02/F03 vão reexecutar.
 */

import { describe, expect, it } from 'vitest'
import { SEGREDO_REDIGIDO } from '@shared/domain/segredos'
import {
  rodarContractDoExecutor,
  requestDeTeste,
  type CenarioDoContrato
} from './coding-executor-contract'
import { CodingExecutorRuntime, type MatadorDeProcesso } from './coding-executor-runtime'
import { FakeCodingExecutorAdapter } from './fake-coding-executor-adapter'

/** O cenário do fake: cada desfecho do contrato é um roteiro de eventos. */
const cenarioDoFake = (): CenarioDoContrato => ({
  sucesso: () =>
    new FakeCodingExecutorAdapter({
      eventos: [
        { tipo: 'started' },
        { tipo: 'path_changed', path: 'src/a.ts' },
        { tipo: 'usage', tokensEntrada: 100, tokensSaida: 50 },
        { tipo: 'done', resumo: 'fatia pronta' }
      ]
    }),
  falha: () =>
    new FakeCodingExecutorAdapter({
      eventos: [
        { tipo: 'started' },
        { tipo: 'failed', erro: 'build quebrou', assinatura: 'build:falhou' }
      ]
    }),
  pendurado: () =>
    new FakeCodingExecutorAdapter({
      // Muitos eventos com atraso: o executor nunca chega ao terminal dentro do teto.
      eventos: Array.from({ length: 50 }, () => ({ tipo: 'progress', mensagem: 'trabalhando' })),
      atrasoMs: 20
    }),
  ignoraCancelamento: () =>
    new FakeCodingExecutorAdapter({
      eventos: Array.from({ length: 50 }, () => ({ tipo: 'progress', mensagem: 'teimoso' })),
      atrasoMs: 10,
      ignoraCancelamento: true
    }),
  comSessao: (sessao) =>
    new FakeCodingExecutorAdapter({
      eventos: [{ tipo: 'started', sessao }, { tipo: 'done' }]
    }),
  eventosDesordenados: () =>
    new FakeCodingExecutorAdapter({
      eventos: [
        // Fora de ordem: chega antes do `started`.
        { tipo: 'progress', mensagem: 'adiantado' },
        { tipo: 'started' },
        // Duplicado.
        { tipo: 'started' },
        { tipo: 'path_changed', path: 'src/a.ts' },
        // Path repetido.
        { tipo: 'path_changed', path: 'src/a.ts' },
        // Desconhecido: preservado como diagnóstico (regra 4).
        { tipo: 'desconhecido', bruto: '{"formato":"novo"}' },
        { tipo: 'done' }
      ]
    }),
  restrito: () =>
    new FakeCodingExecutorAdapter({
      eventos: [{ tipo: 'started' }, { tipo: 'done' }],
      modosSuportados: ['unmetered'],
      revisoesSuportadas: ['revisao-padrao']
    })
})

// O contrato inteiro, contra o fake. É a mesma chamada que F02/F03 farão com os adapters
// reais — e é o que faz "sucesso, falha, timeout, cancelamento e retomada" significar a
// mesma coisa nos três.
rodarContractDoExecutor('fake', cenarioDoFake)

describe('CodingExecutorRuntime — redaction da evidencia (regra 5)', () => {
  it('redige segredo no argumento de ferramenta', async () => {
    const runtime = new CodingExecutorRuntime()
    const adapter = new FakeCodingExecutorAdapter({
      eventos: [
        { tipo: 'started' },
        {
          tipo: 'tool_used',
          nome: 'Bash',
          argumentos: 'curl -H "Authorization: Bearer sk-ant-api03-abcdefghijklmnopqrstuvwx"'
        },
        { tipo: 'done' }
      ]
    })

    const resultado = await runtime.executar(requestDeTeste(), adapter)
    const evidencia = resultado.evidencias.join('\n')

    // A linha **fica** — ferramenta é evidência que o PI precisa ver; o que sai é o segredo.
    expect(evidencia).toContain('ferramenta Bash')
    expect(evidencia).toContain(SEGREDO_REDIGIDO)
    expect(evidencia).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwx')
  })

  it('redige segredo na mensagem de erro do processo', async () => {
    const runtime = new CodingExecutorRuntime()
    const adapter = new FakeCodingExecutorAdapter({
      eventos: [],
      lancaAntesDeEmitir: 'falha ao autenticar com ghp_abcdefghijklmnopqrstuvwxyz0123456789'
    })

    const resultado = await runtime.executar(requestDeTeste(), adapter)

    expect(resultado.status).toBe('falhou')
    expect(resultado.evidencias.join('\n')).not.toContain(
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
    )
  })
})

describe('CodingExecutorRuntime — contrafactual da recusa (criterio 4)', () => {
  it('sem recusa, o mesmo request incompativel chegaria ao executor', async () => {
    // Mede que o teste do critério 4 tem conteúdo: com um adapter que aceita `metered`, o
    // mesmo request **passa** e o executor inicia. Se este teste falhasse, o `execucoes == 0`
    // do contrato estaria passando por outro motivo que não a recusa.
    const runtime = new CodingExecutorRuntime()
    const permissivo = new FakeCodingExecutorAdapter({
      eventos: [{ tipo: 'started' }, { tipo: 'done' }],
      modosSuportados: ['unmetered', 'metered']
    })

    const resultado = await runtime.executar(
      requestDeTeste({ modoDeCobranca: 'metered' }),
      permissivo
    )

    expect(resultado.status).toBe('concluido')
    expect(permissivo.chamadasDeExecucao).toBe(1)
  })
})

describe('CodingExecutorRuntime — arvore de processo (criterio 3)', () => {
  it('o matador recebe o request da tentativa, para saber o que matar', async () => {
    const recebidos: string[] = []
    const matar: MatadorDeProcesso = (request) => {
      // O matador precisa do worktree e do container para alcançar a árvore — sem eles,
      // "matar a árvore" não teria como ser implementado por quem subiu o sandbox.
      recebidos.push(`${request.attemptId}:${request.worktree}:${request.container ?? '-'}`)
    }
    const runtime = new CodingExecutorRuntime(matar)
    const adapter = new FakeCodingExecutorAdapter({
      eventos: Array.from({ length: 50 }, () => ({ tipo: 'progress', mensagem: 'x' })),
      atrasoMs: 10,
      ignoraCancelamento: true
    })

    const execucao = runtime.executar(
      requestDeTeste({ container: 'cont-1', limiteDeTempoMs: 5_000 }),
      adapter
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
    runtime.cancelar('att-1')
    await execucao

    expect(recebidos).toEqual(['att-1:/tmp/wt:cont-1'])
  })

  it('timeout tambem mata a arvore, nao so aborta o sinal', async () => {
    const mortes: string[] = []
    const runtime = new CodingExecutorRuntime((request) => mortes.push(request.attemptId))
    const adapter = new FakeCodingExecutorAdapter({
      eventos: Array.from({ length: 50 }, () => ({ tipo: 'progress', mensagem: 'x' })),
      atrasoMs: 10,
      ignoraCancelamento: true
    })

    const resultado = await runtime.executar(requestDeTeste({ limiteDeTempoMs: 40 }), adapter)

    // Sem isto, um executor que ignora o sinal seguiria vivo depois do timeout — órfão
    // consumindo a assinatura, que é o caminho que o critério 3 fecha.
    expect(mortes).toEqual(['att-1'])
    expect(resultado.status).toBe('cancelado')
  })
})
```

- [ ] **Passo 3: Rodar os testes**

Rode: `npx vitest run --project banco src/main/executors/coding-executor-runtime.int-spec.ts`

Esperado: PASSA. São 13 casos do contrato + 5 próprios = 18.

Se um teste de tempo (timeout, cancelamento) falhar por corrida, **não relaxe o `expect`**: aumente o `atrasoMs` do roteiro ou o `limiteDeTempoMs` do request de modo que a janela fique folgada, mantendo a asserção intacta.

- [ ] **Passo 4: Provar o contrafactual do cancelamento idempotente**

Em `coding-executor-runtime.ts`, comente temporariamente a guarda de idempotência em `cancelar`:

```ts
    // if (voo === undefined || voo.cancelada) return false
    if (voo === undefined) return false
```

Rode: `npx vitest run --project banco src/main/executors/coding-executor-runtime.int-spec.ts`

Esperado: **FALHA** em `cancelamento: duas chamadas produzem um unico efeito` — `mortes` vem com `['att-1', 'att-1']`. Se passar, o teste não mede a idempotência.

Depois **restaure a guarda** e rode de novo: PASSA, 18 testes.

- [ ] **Passo 5: Commit**

```bash
git add src/main/executors/coding-executor-contract.ts src/main/executors/coding-executor-runtime.int-spec.ts
git commit -m "test: contract test reutilizavel de executores (M10-F01)

Uma funcao que F02/F03 chamam com os adapters reais, para sucesso, falha,
timeout, cancelamento e retomada significarem a mesma coisa nos tres.
Mais os casos proprios do runtime: redaction da evidencia, arvore de
processo no timeout e o contrafactual da recusa. Idempotencia medida:
sem a guarda, o matador roda duas vezes.

refs #116

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tarefa 7: Piso verde e evidência

**Arquivos:**
- Modificar: nenhum (é verificação).

- [ ] **Passo 1: Lint**

Rode: `npm run lint`

Esperado: sem erro **nos arquivos de `src/main/executors/`**. O comando roda `eslint .` e `prettier --check .` no repositório inteiro; se aparecer erro em `.worktrees/` ou em arquivo que você não tocou, é ruído pré-existente. Para separar o que é seu:

```bash
npx eslint src/main/executors
npx prettier --check "src/main/executors/**/*.ts"
```

Ambos precisam passar. Se o Prettier reclamar, rode `npx prettier --write "src/main/executors/**/*.ts"` e faça commit da formatação.

- [ ] **Passo 2: Typecheck dos dois projetos**

Rode: `npm run typecheck`

Esperado: sem erros. Roda `tsconfig.node.json` **e** `tsconfig.web.json` — um `npx tsc` avulso passa e o CI reprova.

- [ ] **Passo 3: Suíte inteira**

Rode: `npm test`

Esperado: os três projects verdes. Os novos arquivos somam 18 casos em `banco` e 20 em `regras`.

- [ ] **Passo 4: Relatório por SPEC**

Rode: `npm run test:report`

Depois confirme que `reports/TESTS.md` foi regenerado com a linha da SPEC desta fatia e que `npm run test:report:check` passa. Se o `--check` acusar drift, **regenere** em vez de editar o arquivo à mão — ele é gerado.

Se o relatório exigir `REPORT_SPEC`, o slug vem do arquivo da spec (`spec-multi-executor-01-runtime`), em minúsculas.

- [ ] **Passo 5: Commit do que a verificação mudou**

```bash
git add -A reports/
git commit -m "test: relatorio de evidencia da M10-F01

refs #116

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Se `reports/` não mudou, pule o commit — não crie commit vazio.

---

## Tarefa 8: Documentação e entrega

**Arquivos:**
- Modificar: `docs/ARCHITECTURE.md` (seção `Pipeline V2 aprovada (não implementada)`)
- Modificar: `docs/DEVELOPMENT.md` (status do item desta fatia)
- Modificar: `docs/STATUS.md` (a fatia passa para Feito após o merge)

- [ ] **Passo 1: Corrigir o título da seção da Pipeline V2**

Em `docs/ARCHITECTURE.md`, a seção se chama `### Pipeline V2 aprovada (não implementada)` e a primeira fatia acaba de ser implementada. Troque o título por:

```markdown
### Pipeline V2 aprovada (em implementação)
```

E, no bullet que descreve o `CodingExecutorRuntime`, registre o que passou a existir:

```markdown
- `CodingExecutorRuntime` é irmão de `AIProviderRuntime` e `ConnectorRuntime`; Claude Code e Codex implementam adapters próprios. **O contrato e o runtime existem** em `src/main/executors/` desde a M10-F01: tipos, máquina de estados da tentativa (em memória), recusa antes do spawn e contract test reutilizável. Os adapters concretos são F02/F03; a persistência do estado da tentativa e a migração do `ConstrutorService` da V1 ficam para a fatia que as pedir.
```

- [ ] **Passo 2: Atualizar DEVELOPMENT.md**

Abra `docs/DEVELOPMENT.md`, localize o item da M10-F01 e marque-o como entregue, citando o PR. Se não houver item, acrescente um na seção do MVP-010 seguindo o formato dos vizinhos — leia dois itens já preenchidos antes de escrever, para copiar o formato em vez de inventá-lo.

- [ ] **Passo 3: Commit da documentação**

```bash
git add docs/ARCHITECTURE.md docs/DEVELOPMENT.md
git commit -m "docs: registra contrato e runtime de executores (M10-F01)

A Pipeline V2 deixa de ser inteiramente nao implementada: o contrato e o
runtime existem, os adapters concretos sao F02/F03. Declara os limites —
estado em memoria, ConstrutorService da V1 ainda paralelo.

refs #116

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Passo 4: Push do branch**

```bash
git push -u origin feat/m10-f01-contrato-runtime-executores
```

- [ ] **Passo 5: Abrir a PR**

Use `refs #116`, **nunca** `closes #116`. O corpo precisa de: problema, comportamento antes/depois, evidência executada e limites conhecidos.

```bash
gh pr create --title "[MVP10][SPEC-Multi-Executor-01][F01] Contrato comum e runtime de executores" --body "$(cat <<'EOF'
## Problema

A `ARCHITECTURE.md` decidia a Pipeline V2 — `CodingExecutorRuntime` irmão de `AIProviderRuntime` e `ConnectorRuntime` — e a seção dizia, literalmente, "não implementada". Não havia contrato: o `ConstrutorService` da V1 chama o binário `claude` por `docker exec` com o nome do binário escrito na chamada, então um segundo executor (Codex) não teria onde encaixar sem copiar o laço inteiro.

## Antes / depois

**Antes:** executar código por CLI só existia dentro do `ConstrutorService`, acoplado ao Docker e ao binário `claude`. Modo de cobrança, revisão e schema incompatíveis só apareceriam no meio do stream — depois de o custo ter sido pago.

**Depois:** `src/main/executors/` tem o contrato (`CodingExecutorAdapter`), a máquina de estados da tentativa, a recusa antes do spawn e um contract test que F02/F03 reexecutam com os adapters reais. O `ConstrutorService` **não foi tocado** — segue paralelo até a fatia que migrar o call site.

## Critérios de aceite

1. **Fake percorre todos os desfechos no mesmo contract test** — `rodarContractDoExecutor` cobre sucesso, falha, timeout, cancelamento e retomada (nos dois sentidos: a sessão volta no resultado e a sessão anterior chega ao adapter).
2. **Evento duplicado, fora de ordem e pós-terminal não corrompem o estado** — a máquina de estados os registra como diagnóstico em vez de inferir transição. Contrafactual medido: sem a guarda de terminal, dois testes reprovam.
3. **Cancelar duas vezes produz um único efeito** — `cancelar` devolve `true` só no cancelamento com efeito, e o matador da árvore roda uma vez. Contrafactual medido: sem a guarda de idempotência, o matador roda duas vezes. O timeout usa o mesmo caminho, então executor que ignora o sinal também é encerrado.
4. **Recusa antes de iniciar o CLI** — modo de cobrança, revisão e schema incompatíveis viram status `recusado` com o contador de execuções do adapter em zero. Contrafactual: com um adapter que aceita o modo, o mesmo request passa e o executor inicia.
5. **Nenhuma credencial atravessa a fronteira** — o adapter recebe `ReferenciaDeAutenticacao` opaca; o teste afirma a **ausência** de campo de credencial no request recebido.
6. **Uso e falhas auditáveis sem o formato do fornecedor** — a assinatura de falha é nossa (`recusa:<motivo>`, `processo:excecao`, ou a que o adapter declarar), e o log leva números e identificadores, redigidos.

## Evidência

- `npm run lint` — verde
- `npm run typecheck` — verde (os dois projetos tsconfig)
- `npm test` — verde; 20 casos novos em `regras`, 18 em `banco`
- `npm run test:report` + `test:report:check` — verde, relatório regenerado
- Dois contrafactuais medidos (guarda de terminal e guarda de idempotência), descritos acima

## Limites declarados

1. **Estado em memória, sem persistência.** Os critérios 1-3 pedem comportamento em runtime; nada nesta spec exige sobreviver a restart do processo. Persistência é da fatia que migrar o `ConstrutorService` ou do scheduler (F04).
2. **`validacoes` volta vazio no resultado.** O request as declara para o executor saber o que será medido, mas quem roda comando é o kernel — preenchê-las aqui exigiria que o runtime executasse validação, que é outra camada.
3. **Nenhum adapter real.** Claude Code e Codex são F02/F03. O único executor que passa pelo contrato hoje é o fake.
4. **`MatadorDeProcesso` é injeção sem implementação nesta fatia.** O runtime não conhece container nem PID; quem sabe matar a árvore é quem subiu o sandbox, e essa ligação vem com o adapter real.

refs #116

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Passo 6: Esperar o CI**

Rode: `gh pr checks <numero> --watch`

Ele bloqueia até o fim e devolve código de saída. **Não** monte laço artesanal de monitoramento: um laço que espera "todos saírem de pending" fica girando calado quando uma chamada falha.

- [ ] **Passo 7: Merge e `proplan:done`**

Com os checks verdes, faça o merge na `main`. Depois do merge, aplique `proplan:done` na issue #116 e poste o link do PR no corpo dela. **Não feche a issue** — fechar e aplicar `proplan:finalizado` é ato exclusivo do PI.

Se `docs/STATUS.md` precisar da linha da fatia em Feito, ela entra **por PR** — push direto na `main` burla o gate, mesmo para uma linha de documentação.

---

## Auto-revisão do plano

**1. Cobertura da spec:**

| Item da spec | Onde |
|---|---|
| `CodingExecutorRuntime` separado de `AIProviderRuntime`/`ConnectorRuntime` | Tarefa 5, pasta própria `src/main/executors/` |
| Request normalizado (IDs, executor/modelo/modo, revisões, ContextPack, worktree/container, paths, validações, limites, schema, auth opaca) | Tarefa 1, `ExecutorRequest` — todos os campos presentes |
| Eventos normalizados `started`/`progress`/`tool_used`/`path_changed`/`usage`/terminais | Tarefa 1, `ExecutorEvent` — os seis mais `canceled` e `desconhecido` |
| Resultado estruturado (status, resumo, paths, validações, evidências, uso, sessão, assinatura) | Tarefa 1, `ExecutorResult` — todos os campos; `validacoes` com limite declarado |
| Máquina de estados durável | Tarefa 2 — em memória, limite declarado na PR e nas restrições globais |
| Cancelamento idempotente | Tarefa 5 (`cancelar`) + Tarefa 6 (contrafactual medido) |
| Timeout | Tarefa 5 (relógio) + Tarefa 6 (cenário `pendurado`) |
| Health por executor | Tarefa 1 (`disponivel`) + Tarefa 5 (`saudeDoExecutor`) |
| Contract test reutilizável | Tarefa 6, `rodarContractDoExecutor` |
| Regra 1 (só kernel abre; atrasado não reabre) | Tarefa 2, guarda de terminal primeiro + `estadoInicial` |
| Regra 2 (`attempt_id` + chave idempotente) | Tarefa 1, campos; Tarefa 5, os dois no log |
| Regra 3 (`path_changed` é observação) | Tarefa 1 e 5, comentários + `validacoes` vazias |
| Regra 4 (desconhecido preservado) | Tarefa 2, caso `desconhecido` + teste |
| Regra 5 (redaction) | Tarefa 5, `redigirSegredos` + `redact`; Tarefa 6, dois testes |
| Critérios 1-6 | Tarefa 6, um teste nomeado por critério |
| Testes: unitários da máquina e redaction, contract tests, fixtures de evento parcial/desconhecido/duplicado, relatório por SPEC | Tarefas 2, 3, 6 e 7 |

Sem lacuna.

**2. Placeholders:** nenhum "TBD"/"TODO"/"adicione tratamento apropriado". Todo passo de código traz o código. O único passo que diz "leia os vizinhos antes de escrever" é a Tarefa 8 passo 2, onde o formato é do arquivo existente e copiá-lo é mais correto que inventá-lo aqui.

**3. Consistência de tipos:** `ExecutorEvent` (8 variantes) é consumido por `aplicarEvento` (8 casos no `switch`, exaustivo) e por `evidenciaDoEvento` (8 casos). `EstadoDaTentativa.fase` usa `FaseDaTentativa` (5 valores), e `isTerminal` cobre 3. `ExecutorResult.status` usa `StatusDoResultado` (4 valores), e `montarResultado` produz 3 + `recusar` produz o quarto. `MatadorDeProcesso` recebe `ExecutorRequest` na definição (Tarefa 5) e nos dois usos de teste (Tarefa 6). `validarRequest(request, adapter)` tem a mesma ordem de argumentos na definição e nos usos. `requestDeTeste` é exportada da Tarefa 6 e usada no int-spec da mesma tarefa. `SEGREDO_REDIGIDO` é importado de `@shared/domain/segredos`, onde foi verificado existir.

**4. Riscos conhecidos, declarados para quem executa:**
- `log.agent` foi assumido pelo uso em `construtor-service.ts`. A Tarefa 5 passo 2 manda conferir e ajustar se o namespace for outro.
- O `eslint-disable-next-line require-yield` no gerador que só lança (Tarefa 3) pode não ser necessário, dependendo da config. Se o ESLint não reclamar, remova a linha.
- Testes de tempo (`atrasoMs`, `limiteDeTempoMs`) são a parte frágil. A instrução da Tarefa 6 passo 3 é folgar a janela, nunca relaxar a asserção.
