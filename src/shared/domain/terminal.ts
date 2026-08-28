/**
 * Contratos do terminal controlado (SPEC-ExecucaoReal-02).
 *
 * O modelo é **command-runner**, não PTY (decisão do PI 2026-07-24): submete um comando →
 * valida → executa → devolve saída/erro/exit code. Cada comando é isolado e gateável; não há
 * sessão de shell viva entre um e outro. Por isso o contrato é uma *execução*, com começo e
 * fim, e não um *stream* de terminal.
 *
 * Mora em `src/shared/domain` porque a UI consome o resultado, e o contrato precisa ser
 * verificável sem carregar o Electron.
 */

/**
 * Estado de uma execução de comando. Espelha os estados de `ExecutionRun` onde eles
 * significam a mesma coisa — a UI dos dois usa os mesmos padrões operacionais do DS
 * (SPEC-DS-04b), e divergir os vocabulários faria a mesma ideia ter dois nomes.
 */
export const COMMAND_STATES = ['aguardando-aprovacao', 'concluido', 'falhou', 'bloqueado'] as const

export type CommandState = (typeof COMMAND_STATES)[number]

/**
 * Por que a execução terminou assim. Enum fechado, não texto livre: a UI decide o que mostrar
 * a partir dele, e um motivo novo é mudança de contrato — nunca uma string que vaza de um
 * `catch` para a tela.
 *
 * Os quatro primeiros são recusas (nada executou); os três últimos descrevem o desfecho de um
 * comando que chegou a rodar ou foi autorizado a rodar.
 */
export const COMMAND_REASONS = [
  'binario-fora-da-allowlist',
  'cwd-fora-da-allowlist',
  'elevacao-negada',
  'bloqueado-pela-politica',
  'aguardando-aprovacao-destrutivo',
  'aprovacao-negada',
  'executado',
  'timeout-excedido',
  'falha-na-execucao'
] as const

export type CommandReason = (typeof COMMAND_REASONS)[number]

/** O que a UI submete. Binário e argumentos **separados** — nunca uma linha a tokenizar. */
export interface CommandSubmission {
  readonly binary: string
  readonly args: readonly string[]
  readonly cwd: string
}

/**
 * O resultado de uma execução, na forma que o renderer vê.
 *
 * `stdout`/`stderr` chegam **redigidos** (ADR-005): a saída de um comando pode conter token,
 * chave ou caminho sensível, e ela vira evidência permanente na auditoria. Redigir na origem
 * é o que impede a auditoria de virar o vazamento que ela existe para prevenir.
 */
export interface CommandExecution {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: string
  readonly binary: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly state: CommandState
  readonly reason: CommandReason
  /** Saída padrão, redigida e truncada. Vazia quando o comando não chegou a executar. */
  readonly stdout: string
  readonly stderr: string
  /**
   * Código de saída do processo. `null` quando não houve processo (recusado, aguardando
   * aprovação) ou quando o processo foi morto por timeout sem código próprio — os dois casos
   * que um `0` default esconderia, fazendo uma recusa parecer sucesso.
   */
  readonly exitCode: number | null
  readonly durationMs: number
  /** Descrição em pt-BR do padrão destrutivo que pediu aprovação, quando houve. */
  readonly motivoDestrutivo?: string
  /** A `ApprovalRequest` aberta, quando o comando pausou. */
  readonly approvalRequestId?: string
  /** Casa as entradas de log desta execução (ADR-005). */
  readonly correlationId: string
  readonly created_at: string
}

export function isCommandState(value: unknown): value is CommandState {
  return typeof value === 'string' && (COMMAND_STATES as readonly string[]).includes(value)
}
