import {
  avaliarEstabilizacao,
  validarJanelaDeEstabilizacao,
  type JanelaDeEstabilizacao
} from '@shared/domain/release-promotion'

/**
 * Janela de estabilização da Produção (SPEC-Release-04). Observa a saúde a cada intervalo e aplica
 * `avaliarEstabilizacao` (domínio puro): falha isolada reinicia a contagem, a seguinte compensa.
 * Ao fechar a janela roda o smoke essencial uma vez; smoke que falha segue a mesma regra de falha.
 * Tempo e espera são injetados — o teste decide quando o relógio anda, sem timer real.
 */

export interface StabilizationDeps {
  readonly config: JanelaDeEstabilizacao
  readonly health: () => Promise<boolean>
  readonly smoke: () => Promise<boolean>
  /** Estende a posse da release; lança se ela foi perdida, e a janela é interrompida. */
  readonly renew: () => void
  readonly nowMs: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly onRestart?: (restarts: number) => void
}

export interface StabilizationResult {
  readonly state: 'stable' | 'compensate'
  readonly restarts: number
}

/** Sonda que falha é sonda que não provou saúde: vira `false`, nunca derruba o monitor. */
const observar = (sonda: () => Promise<boolean>): Promise<boolean> =>
  sonda().then(
    (saudavel) => saudavel,
    () => false
  )

export class StabilizationMonitor {
  constructor(private readonly deps: StabilizationDeps) {
    validarJanelaDeEstabilizacao(deps.config)
  }

  async run(): Promise<StabilizationResult> {
    const { config, nowMs } = this.deps
    let estado = { startedAtMs: nowMs(), restarts: 0 }
    for (;;) {
      this.deps.renew()
      let decisao = avaliarEstabilizacao(config, estado, nowMs(), await observar(this.deps.health))
      if (decisao.decision === 'stable' && !(await observar(this.deps.smoke)))
        decisao = avaliarEstabilizacao(config, estado, nowMs(), false)
      estado = decisao.state
      if (decisao.decision === 'stable' || decisao.decision === 'compensate')
        return {
          state: decisao.decision === 'stable' ? 'stable' : 'compensate',
          restarts: estado.restarts
        }
      if (decisao.decision === 'restart') this.deps.onRestart?.(estado.restarts)
      await this.deps.sleep(config.intervalMs)
    }
  }
}
