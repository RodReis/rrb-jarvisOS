/**
 * A máquina de estados de um run da pipeline de entrega (SPEC-Entrega-02).
 *
 * A pergunta que este arquivo responde: **em que ponto está a execução de uma fatia, e para
 * onde ela pode ir a partir daqui?**
 *
 * A resposta é uma tabela de transições permitidas, não uma sequência de `if`. A diferença
 * importa por causa do critério 5 — *"run não pula diretamente para `MERGED`"*: uma sequência
 * de condições espalhadas pelo serviço permitiria o pulo no dia em que alguém escrevesse a
 * condição errada, enquanto uma tabela o torna impossível de expressar. O estado destino ou
 * está na lista do estado atual, ou a transição é rejeitada.
 *
 * **Três estados terminais e não um** (`MERGED`, `AWAITING_MERGE`, `BLOCKED`, `CANCELLED` —
 * quatro, contando o cancelamento). `AWAITING_MERGE` entrou pela emenda 2 de 2026-08-30, e
 * existe porque a M9-F05 e a M9-F06 precisavam de um terminal que significasse *"PR verde,
 * merge autônomo desligado, aguardando o PI"*. Sem ele, o kill-switch desligado teria de
 * terminar em `BLOCKED` — e bloqueio é reservado a causa externa ou risco, não a uma escolha
 * legítima de configuração do projeto. Chamar de bloqueio o que o PI pediu ensinaria a ler
 * `BLOCKED` como ruído.
 *
 * **O que este arquivo não faz:** não consulta banco, não fala com Git nem GitHub, não decide
 * *quando* transicionar. Só diz quais transições existem e o que um bloqueio precisa carregar.
 */

import type { DependenciaAberta } from './fila'
import type { BloqueioExterno } from './pacote-estrutural'

/**
 * Os estados de um run.
 *
 * `AWAITING_PI` é o gate `SLICE_ENTRY` da M8-F06, e **só ele** (emenda 3 de 2026-08-30). Não
 * existe um segundo "go" para construir: um seria aceite duplicado, que é o que a invariante 2
 * da CONVENTION §4 proíbe.
 */
export const ESTADOS_DO_RUN = [
  'PLANNED',
  'AWAITING_PI',
  'READY',
  'RUNNING',
  'VALIDATING',
  'PR_CI',
  'MERGED',
  'AWAITING_MERGE',
  'BLOCKED',
  'CANCELLED'
] as const

export type EstadoDoRun = (typeof ESTADOS_DO_RUN)[number]

/**
 * As transições permitidas, por estado de origem.
 *
 * **Dado, não lógica** — mesma postura do `DESCRICAO_DO_GATE`. Uma tabela é auditável de
 * relance: dá para ler que `PLANNED` não alcança `MERGED` sem seguir nenhum fluxo de controle.
 *
 * `CANCELLED` é alcançável de todo estado não-terminal porque cancelar é um ato do PI, e
 * exigir que o run chegasse a um ponto específico para poder ser cancelado o prenderia.
 *
 * `BLOCKED` é alcançável a partir de todo estado que faz trabalho (`READY` em diante) e
 * também de `AWAITING_PI`: uma dependência que se revela impossível bloqueia antes de o PI
 * ser incomodado.
 */
const TRANSICOES: Readonly<Record<EstadoDoRun, readonly EstadoDoRun[]>> = {
  // A fatia existe no roadmap mas ainda não pediu aceite. Sai para o gate ou é cancelada.
  PLANNED: ['AWAITING_PI', 'BLOCKED', 'CANCELLED'],
  // Aguardando `SLICE_ENTRY`. `READY` exige a aprovação vigente — quem verifica é o serviço.
  AWAITING_PI: ['READY', 'BLOCKED', 'CANCELLED'],
  // Aprovado e desbloqueado. Só daqui se adquire o slot de WIP.
  READY: ['RUNNING', 'BLOCKED', 'CANCELLED'],
  // O executor está construindo (M9-F04).
  RUNNING: ['VALIDATING', 'BLOCKED', 'CANCELLED'],
  // Testes, lint, type, build e revisões (M9-F05). Volta a `RUNNING` na correção elegível.
  VALIDATING: ['PR_CI', 'RUNNING', 'BLOCKED', 'CANCELLED'],
  // PR aberto, checks correndo na origem. `AWAITING_MERGE` é o kill-switch desligado.
  PR_CI: ['MERGED', 'AWAITING_MERGE', 'VALIDATING', 'BLOCKED', 'CANCELLED'],
  MERGED: [],
  AWAITING_MERGE: [],
  BLOCKED: [],
  CANCELLED: []
}

/** Os estados terminais para aquele run. Derivado da tabela: terminal é quem não tem saída. */
export const ESTADOS_TERMINAIS: readonly EstadoDoRun[] = ESTADOS_DO_RUN.filter(
  (estado) => TRANSICOES[estado].length === 0
)

/** `true` quando o run acabou — em qualquer dos quatro desfechos. */
export function ehTerminal(estado: EstadoDoRun): boolean {
  return TRANSICOES[estado].length === 0
}

/**
 * A transição é permitida?
 *
 * **Transição para o mesmo estado é rejeitada.** Um "avanço" que não avança seria um evento
 * registrado sem fato correspondente, e a reconciliação passaria a ver progresso onde não
 * houve. Heartbeat de lease é outra coisa, e mora em `lease.ts`.
 */
export function transicaoPermitida(de: EstadoDoRun, para: EstadoDoRun): boolean {
  return TRANSICOES[de].includes(para)
}

/** Os destinos possíveis a partir de um estado. Para a tela explicar o que pode acontecer. */
export function destinosDe(estado: EstadoDoRun): readonly EstadoDoRun[] {
  return TRANSICOES[estado]
}

/**
 * Um run: a execução de uma fatia.
 *
 * `bloqueio` só existe em `BLOCKED`, e carrega os cinco campos que a CONVENTION §4 § Estados
 * de bloqueio exige (critério 6). O tipo os junta ao estado porque um bloqueio sem causa
 * verificável é inválido por definição — e separá-los deixaria escrever um sem o outro.
 */
export interface PipelineRun {
  readonly id: string
  readonly user_id: string
  readonly projectId: string
  /** A fatia que este run executa. */
  readonly sliceId: string
  readonly estado: EstadoDoRun
  /** O run anterior de que este é continuação, quando houver (retomada de bloqueio). */
  readonly continuaDe?: string
  /** Obrigatório em `BLOCKED`, ausente no resto (critério 6). */
  readonly bloqueio?: BloqueioExterno
  readonly created_at: string
  readonly updated_at: string
}

/**
 * Por que a transição não pôde acontecer. Enum fechado: a tela decide o que mostrar.
 */
export const TRANSICAO_REASONS = [
  'transicionado',
  'run-inexistente',
  /** O destino não está na lista do estado atual — inclui o pulo para `MERGED` (critério 5). */
  'transicao-invalida',
  /** O run já terminou. Retomar exige continuação vinculada, não reabrir o mesmo run. */
  'run-terminal',
  /** `BLOCKED` sem os cinco campos da CONVENTION §4 (critério 6). */
  'bloqueio-incompleto',
  /** Saída de `AWAITING_PI` sem `Approval` vigente do gate `SLICE_ENTRY` (critério 7). */
  'sem-aprovacao-vigente',
  /** Aquisição do slot de WIP recusada: outro run o detém (critério 2). */
  'wip-ocupado',
  /** Dependência do run ainda não concluída (invariante 5 da CONVENTION §4). */
  'dependencia-aberta'
] as const

export type TransicaoReason = (typeof TRANSICAO_REASONS)[number]

export interface TransicaoOutcome {
  readonly reason: TransicaoReason
  readonly run?: PipelineRun
  readonly mensagem: string
}

/** Type guard de fronteira: o IPC recebe `unknown` e não confia no renderer. */
export function isEstadoDoRun(valor: unknown): valor is EstadoDoRun {
  return typeof valor === 'string' && (ESTADOS_DO_RUN as readonly string[]).includes(valor)
}

/**
 * A política de merge autônomo de um projeto — o kill-switch (M9-F05, decisão do PI 2026-08-30).
 *
 * Mora no domínio, e não no serviço do main, porque a **tela** a consome: o contrato do IPC
 * precisa ser verificável sem carregar o Electron, e um tipo do main atravessando a ponte
 * quebraria a fronteira que `shared/` existe para manter.
 *
 * `identidade` e `updated_at` são opcionais porque a ausência de decisão é o estado inicial:
 * sem ninguém ter desligado, não há quem nem quando — e o merge está ligado, que é o default.
 */
export interface PoliticaDeMerge {
  readonly autonomo: boolean
  /** Quem decidiu. Ausente quando nunca houve decisão. */
  readonly identidade?: string
  readonly updated_at?: string
}

/** Por que a mudança de política não saiu. Enum fechado: a tela decide o que mostrar. */
export const MERGE_POLICY_REASONS = [
  'definido',
  /** Sem sessão autenticada não há quem responda pela mudança. Falha fechado. */
  'sem-identidade',
  /** A política já era essa. Regravar geraria um `AuditEvent` sobre um não-evento. */
  'sem-mudanca'
] as const

export type MergePolicyReason = (typeof MERGE_POLICY_REASONS)[number]

export interface MergePolicyOutcome {
  readonly reason: MergePolicyReason
  readonly politica?: PoliticaDeMerge
  readonly mensagem: string
}

/**
 * O que a tela mostra da fila: os runs vivos, o que já concluiu e o que está travado.
 *
 * Só leitura, e de propósito: não há contrato que peça uma transição a partir do renderer. Quem
 * move a pipeline é o main, a partir do que o PI aprovou no gate — um canal de transição
 * deixaria o renderer declarar que uma fatia chegou a `MERGED`, que é o pulo do critério 5.
 */
export interface VistaDaFila {
  /** Os runs em estado não-terminal, de todos os projetos: o WIP é da máquina. */
  readonly ativos: readonly PipelineRun[]
  /** As fatias com run `MERGED` neste projeto. */
  readonly concluidas: readonly string[]
  /** As fatias que não podem começar, e por quê. */
  readonly bloqueadas: readonly {
    readonly sliceId: string
    readonly abertas: readonly DependenciaAberta[]
  }[]
}
