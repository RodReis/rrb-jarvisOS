/**
 * Leases: a posse durável de um recurso por um run (SPEC-Entrega-02).
 *
 * A pergunta que este arquivo responde: **quem é o dono deste recurso agora, e o que fazer
 * quando o dono some?**
 *
 * A resposta curta é a decisão cravada da spec: *"lease expirado nunca autoriza roubo
 * direto — a reconciliação decide, porque a expiração pode significar máquina lenta, não
 * processo morto"*. Por isso `estadoDoLease` distingue **três** situações e não duas: `vigente`
 * (o dono está vivo), `expirado` (o heartbeat parou — *pode* estar morto) e `livre` (não há
 * dono). Só `livre` autoriza aquisição imediata. `expirado` é uma pergunta para a
 * reconciliação, nunca uma resposta.
 *
 * Um booleano `estaExpirado` teria dado dois caminhos, e o segundo — "expirou, então tome" — é
 * exatamente o que o critério 3 proíbe. A máquina lenta que perdeu o heartbeat por dez segundos
 * ainda está com o worktree aberto e o container de pé; roubar o recurso dela criaria dois
 * executores sobre o mesmo diretório.
 *
 * **O slot global de WIP é um lease como outro qualquer** (emenda 1 de 2026-08-30), com
 * `recurso: 'wip:global'` e sem projeto. Modelá-lo à parte teria criado uma segunda regra de
 * expiração, e a que fosse esquecida seria a que trava a máquina.
 *
 * **O que este arquivo não faz:** não persiste, não mede o tempo (recebe `agora`), não decide o
 * que a reconciliação faz com um lease expirado.
 */

/**
 * O recurso do slot global de WIP.
 *
 * Constante e não parametrizada por projeto: a emenda 1 de 2026-08-30 fez o WIP **global**
 * porque dois executores na mesma máquina disputariam CPU, portas e a mesma assinatura.
 * Concorrência é escopo do MVP-012.
 */
export const RECURSO_WIP_GLOBAL = 'wip:global'

/**
 * Quanto tempo um lease sobrevive sem heartbeat.
 *
 * Trinta segundos: longo o bastante para uma pausa de GC ou um disco lento não derrubarem um
 * run vivo, curto o bastante para uma máquina que morreu não travar a fila até o próximo boot.
 * O número não decide nada sozinho — quem decide é a reconciliação (critério 3).
 */
export const VALIDADE_DO_LEASE_MS = 30_000

/** Um lease: posse de um recurso por um run, com expiração e heartbeat. */
export interface Lease {
  readonly id: string
  readonly user_id: string
  /** O dono: o id do run. O slot global também tem dono — não existe lease sem proprietário. */
  readonly proprietario: string
  /** O que está possuído: `wip:global`, um worktree, uma porta, um container. */
  readonly recurso: string
  /** O projeto, quando o recurso pertence a um. Ausente no slot global. */
  readonly projectId?: string
  /** Epoch ms do último heartbeat. A expiração se mede a partir daqui, nunca da criação. */
  readonly heartbeatEm: number
  /** Epoch ms em que o lease expira se o heartbeat não renovar. */
  readonly expiraEm: number
  readonly created_at: string
}

/**
 * A situação de um lease. Três valores, e o terceiro é o que impede o roubo.
 */
export const ESTADOS_DO_LEASE = ['livre', 'vigente', 'expirado'] as const

export type EstadoDoLease = (typeof ESTADOS_DO_LEASE)[number]

/**
 * O estado de um lease em um instante.
 *
 * `undefined` é `livre`: não há dono, e adquirir é seguro. Note que a expiração é `>=` e não
 * `>` — um lease que expira exatamente agora está expirado. O contrário faria o instante da
 * expiração ser vigente, e a fronteira ficaria dependente da resolução do relógio.
 */
export function estadoDoLease(lease: Lease | undefined, agora: number): EstadoDoLease {
  if (lease === undefined) return 'livre'
  return agora >= lease.expiraEm ? 'expirado' : 'vigente'
}

/**
 * Pode adquirir o recurso agora, sem passar pela reconciliação?
 *
 * **Só quando está livre** (critério 3). Um lease expirado devolve `false` de propósito: a
 * decisão de tomá-lo é da reconciliação, que sabe olhar o filesystem, o Git e o container antes
 * de concluir que o dono morreu.
 *
 * Um lease vigente do **próprio** run é aquisição idempotente — o mesmo dono readquirindo o que
 * já tem. Sem essa exceção, um retry depois de um crash entre "gravei o lease" e "confirmei"
 * ficaria travado no próprio lease (critério 4).
 */
export function podeAdquirir(
  lease: Lease | undefined,
  proprietario: string,
  agora: number
): boolean {
  const estado = estadoDoLease(lease, agora)
  if (estado === 'livre') return true
  if (estado === 'vigente') return lease?.proprietario === proprietario
  return false
}

/** O `expiraEm` de um lease renovado agora. Um só lugar calcula isso. */
export function proximaExpiracao(agora: number): number {
  return agora + VALIDADE_DO_LEASE_MS
}

/**
 * Por que a aquisição do lease não saiu. Enum fechado.
 */
export const LEASE_REASONS = [
  'adquirido',
  /** Outro run detém o recurso e está vivo (critério 2, quando o recurso é o slot de WIP). */
  'ocupado',
  /**
   * O lease expirou, mas tomá-lo exige a reconciliação primeiro (critério 3). Não é o mesmo
   * que `ocupado`: aqui há um caminho adiante, e ele passa por `reconcileAll`.
   */
  'expirado-requer-reconciliacao',
  /** O lease a renovar/liberar não existe, ou pertence a outro run. */
  'lease-inexistente'
] as const

export type LeaseReason = (typeof LEASE_REASONS)[number]

export interface LeaseOutcome {
  readonly reason: LeaseReason
  readonly lease?: Lease
  readonly mensagem: string
}
