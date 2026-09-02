/**
 * Diário de efeitos: intenção antes do I/O, confirmação depois (SPEC-Entrega-02, § Diário de
 * efeitos; issue #209).
 *
 * A pergunta que este arquivo responde: **o que este app disse que ia fazer a um serviço
 * externo, e o que aconteceu de fato?** É a mesma pergunta que a reconciliação faz, mas até
 * aqui ela lia o par de auditoria `fase: 'requisicao'`/`'conclusao'` do `ConnectorService` — que
 * não tem chave para detectar conflito nem lugar para o `ExternalRef` pousar antes da conclusão.
 * O diário é o registro dedicado a essa pergunta.
 *
 * **Toda chamada entra**, não só mutação (decisão do PI, 2026-09-02): leitura usa o
 * `correlationId` como chave quando não há `idempotencyKey`, e nunca colide — cada chamada tem
 * um `correlationId` novo. É a mesma uniformidade que já existe no par de auditoria hoje.
 *
 * **Chave igual com payload diferente é conflito e falha antes do I/O** (critério 3 da issue):
 * só é semanticamente possível quando a chave é uma `idempotencyKey` de verdade — repetível por
 * natureza. Uma chave derivada de `correlationId` nunca se repete, então nunca colide; ela não
 * está "isenta" da regra, ela simplesmente não encontra concorrente.
 */

/** Como uma entrada terminou. `pendente` é o estado inicial, antes de qualquer conclusão. */
export const ESTADOS_DO_EFEITO = ['pendente', 'confirmed', 'ambiguous', 'failed'] as const

export type EstadoDoEfeito = (typeof ESTADOS_DO_EFEITO)[number]

/**
 * Uma entrada do diário: a intenção registrada antes do I/O, e o que se sabe sobre ela agora.
 *
 * `fingerprint` é o que torna "chave igual, payload diferente" detectável — hash determinístico
 * de `connector` + `operation` + `input`. Duas chamadas com a mesma `chaveIdempotente` e o mesmo
 * `fingerprint` são a **mesma** intenção (repetição segura); com fingerprints diferentes, são
 * duas intenções competindo pela mesma chave — conflito.
 */
export interface EntradaDoDiario {
  readonly id: string
  readonly userId: string
  readonly workspaceId: string
  readonly chaveIdempotente: string
  readonly fingerprint: string
  /** O que foi chamado: `connector:operation`. */
  readonly alvo: string
  readonly correlationId: string
  readonly estado: EstadoDoEfeito
  /** Presente só quando `estado` é `confirmed` e a chamada devolveu uma referência. */
  readonly externalRefId?: string
  readonly criadoEm: string
  readonly atualizadoEm: string
}

/** Por que `registrarIntencao` recusou. */
export const CONFLITOS_DO_DIARIO = [
  /** A mesma chave já tem uma intenção com `fingerprint` diferente — pedidos distintos disputando a mesma chave. */
  'payload-diverge'
] as const

export type ConflitoDoDiario = (typeof CONFLITOS_DO_DIARIO)[number]

/** O que `registrarIntencao` devolve: a entrada nova, a existente (repetição segura), ou conflito. */
export type ResultadoDoRegistro =
  | { readonly tipo: 'registrada'; readonly entrada: EntradaDoDiario }
  | { readonly tipo: 'repetida'; readonly entrada: EntradaDoDiario }
  | {
      readonly tipo: 'conflito'
      readonly motivo: ConflitoDoDiario
      readonly existente: EntradaDoDiario
    }
