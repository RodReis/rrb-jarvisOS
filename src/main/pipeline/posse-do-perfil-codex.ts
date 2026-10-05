/**
 * A posse exclusiva do perfil do Codex por run (SPEC-Scheduler-05, decisão do PI de 2026-10-05).
 *
 * A pergunta que este serviço responde: **este run pode usar o `CODEX_HOME` da pipeline agora?**
 *
 * O perfil é um só e tem diretório gravável. As duas regras documentadas se puxavam — "o app não vê
 * o segredo" e "sem segundo dono do `CODEX_HOME`" (Multi-Executor-02) contra "sem diretório
 * gravável compartilhado entre runs" (Scheduler-03) — e a saída que não toca na credencial é a
 * **posse**: um lease exclusivo, e o run seguinte espera. Duplicar o perfil por run exigiria copiar
 * o `auth.json` (o app manipularia o arquivo da credencial, e o refresh rotativo de cópias
 * concorrentes pode invalidar o login de todas).
 *
 * **A concorrência do Codex é 1**, por construção — coerente com a assinatura única. O que muda de
 * mãos é o direito de usar o diretório, nunca o conteúdo dele.
 *
 * É o mesmo padrão do `MergeLease`: o lease de **outro** run — vigente ou expirado — nunca é tomado.
 * Expirado é decisão da reconciliação (que já o libera quando o run dono terminou); quem chegou
 * depois não decide. Por isso um lease expirado de outro run é uma recusa explícita
 * (`requer-reconciliacao`), e não uma espera sem fim.
 *
 * **Sem chamador de produção ainda**: o `CodexExecAdapter` (executor de run) não tem instância no
 * app. Este serviço é o ponto onde ele pede a vez quando houver. **O `CodexAdapter` de geração** (o
 * provider do ponto único, M26-F06) usa o mesmo `CODEX_HOME` **fora** desta posse: a garantia
 * "concorrência Codex = 1" vale entre runs, não contra a geração (limite declarado na SPEC).
 *
 * `signal` é opcional no pedido, mas quem pede por um run **deve** passá-lo: sem ele, um run
 * cancelado enquanto espera ainda receberia a posse depois (o encadeador a devolve no `finally`).
 */

import { RECURSO_DO_PERFIL_CODEX } from '@shared/domain/codex-profile'
import { estadoDoLease } from '@shared/domain/lease'
import { log } from '../logging/logger'
import type { LeaseRepository } from './lease-repository'

/** De quanto em quanto quem espera olha de novo: cobre a liberação feita por fora deste processo. */
export const INTERVALO_DE_ESPERA_DO_PERFIL_MS = 2_000

export type ResultadoDaPosse =
  | { readonly ok: true; readonly codexHome: string }
  | { readonly ok: false; readonly motivo: 'cancelada' | 'requer-reconciliacao' }

export interface PedidoDePosse {
  readonly runId: string
  readonly projectId?: string
  readonly signal?: AbortSignal
}

export interface PosseDoPerfilDeps {
  readonly leases: Pick<LeaseRepository, 'buscar' | 'adquirir' | 'renovar' | 'liberar'>
  readonly userId: () => string
  /** O `CODEX_HOME` da pipeline — a referência que o executor recebe. Nunca o conteúdo dele. */
  readonly codexHome: () => string
  readonly agora?: () => number
  /** Ausente = `INTERVALO_DE_ESPERA_DO_PERFIL_MS`. Existe para o teste não esperar segundos. */
  readonly intervaloDeEsperaMs?: number
}

interface Espera {
  acordar: () => void
}

type Tentativa = 'adquirido' | 'ocupado' | 'nao-gravou' | 'requer-reconciliacao'

export class PosseDoPerfilCodex {
  private readonly agora: () => number
  /** Quem espera, na ordem de chegada: só a cabeça da fila tenta, então ninguém fura a vez. */
  private fila: Espera[] = []

  constructor(private readonly deps: PosseDoPerfilDeps) {
    this.agora = deps.agora ?? ((): number => Date.now())
  }

  /** Quem detém o perfil agora (run), ou `undefined` se está livre. */
  dono(): string | undefined {
    return this.deps.leases.buscar(this.deps.userId(), RECURSO_DO_PERFIL_CODEX)?.proprietario
  }

  /**
   * Pede a posse e espera por ela. Não lança: o desfecho ruim é `ok: false`. O mesmo run pedindo de
   * novo reassume a que já tem (retry depois de um crash dentro da validade).
   */
  async adquirir(pedido: PedidoDePosse): Promise<ResultadoDaPosse> {
    // Por função: o sinal muda durante os `await`, e o TS estreitaria a leitura repetida.
    const cancelada = (): boolean => pedido.signal?.aborted === true
    if (cancelada()) return { ok: false, motivo: 'cancelada' }

    // Quem **já é o dono** reassume na hora, com ou sem fila: enfileirar o dono atrás de quem espera
    // o perfil que ele mesmo segura travaria os dois (ele só o devolve depois desta chamada).
    if (this.reassumir(pedido.runId)) return this.resultado('adquirido')

    let avisou = false
    const aoNaoGravar = (): void => {
      if (avisou) return
      avisou = true
      // `LeaseRepository.adquirir` devolve `undefined` para o `UNIQUE` **e** para qualquer erro do
      // banco: sem o aviso, `SQLITE_BUSY` seria uma espera sem fim e sem rastro.
      log.agent.warn('O lease do perfil do Codex não pôde ser gravado; o run segue esperando', {
        runId: pedido.runId
      })
    }

    // Só tenta de primeira quem não tem ninguém à frente: furar a fila quebraria a ordem de chegada.
    if (this.fila.length === 0) {
      const direto = this.tentar(pedido)
      if (direto === 'nao-gravou') aoNaoGravar()
      if (direto !== 'ocupado' && direto !== 'nao-gravou') return this.resultado(direto)
    }

    const espera: Espera = { acordar: () => {} }
    this.fila = [...this.fila, espera]

    try {
      for (;;) {
        await this.esperarAVez(espera, pedido.signal)
        if (cancelada()) return { ok: false, motivo: 'cancelada' }
        if (this.fila[0] !== espera) continue

        const r = this.tentar(pedido)
        if (r === 'nao-gravou') aoNaoGravar()
        if (r !== 'ocupado' && r !== 'nao-gravou') return this.resultado(r)
      }
    } finally {
      this.fila = this.fila.filter((e) => e !== espera)
      // Quem saiu da cabeça (adquiriu, ou desistiu) passa a vez ao próximo.
      this.fila[0]?.acordar()
    }
  }

  /** Renova a posse do próprio dono. `false` quando este run não a detém (não é erro: é a resposta). */
  renovar(runId: string): boolean {
    return this.deps.leases.renovar(
      this.deps.userId(),
      RECURSO_DO_PERFIL_CODEX,
      runId,
      this.agora()
    )
  }

  /** Devolve a posse — só o dono a devolve — e acorda quem esperava. Idempotente. */
  liberar(runId: string): boolean {
    const liberou = this.deps.leases.liberar(this.deps.userId(), RECURSO_DO_PERFIL_CODEX, runId)
    if (liberou) this.fila[0]?.acordar()
    return liberou
  }

  /**
   * Devolve a posse de um dono que **não existe mais**: o run terminou (ou sumiu) e ninguém neste
   * processo o está executando. É a rede de proteção de um `liberar` que falhou (banco ocupado no
   * `finally` do encadeador): sem ela o lease expiraria e o Codex ficaria indisponível até o próximo
   * boot, porque só a reconciliação do boot remove lease expirado. Dono vivo nunca é tocado.
   * Devolve o run liberado, se algum.
   */
  recolherOrfa(dono: {
    readonly emVoo: (runId: string) => boolean
    readonly terminou: (runId: string) => boolean
  }): string | undefined {
    const atual = this.dono()
    if (atual === undefined || dono.emVoo(atual) || !dono.terminou(atual)) return undefined
    return this.liberar(atual) ? atual : undefined
  }

  /** O run já detém a posse? Então a renova e responde `true`; senão, `false` sem tocar em nada. */
  private reassumir(runId: string): boolean {
    const userId = this.deps.userId()
    const atual = this.deps.leases.buscar(userId, RECURSO_DO_PERFIL_CODEX)
    if (atual?.proprietario !== runId) return false
    this.deps.leases.renovar(userId, RECURSO_DO_PERFIL_CODEX, runId, this.agora())
    return true
  }

  private tentar(pedido: PedidoDePosse): Tentativa {
    const userId = this.deps.userId()
    const agora = this.agora()
    const atual = this.deps.leases.buscar(userId, RECURSO_DO_PERFIL_CODEX)

    if (atual !== undefined) {
      // Expirado de outro run: a reconciliação decide se o dono morreu. Esperar aqui não resolveria.
      return estadoDoLease(atual, agora) === 'expirado' ? 'requer-reconciliacao' : 'ocupado'
    }

    const lease = this.deps.leases.adquirir(
      userId,
      {
        proprietario: pedido.runId,
        recurso: RECURSO_DO_PERFIL_CODEX,
        ...(pedido.projectId === undefined ? {} : { projectId: pedido.projectId })
      },
      agora
    )
    return lease === undefined ? 'nao-gravou' : 'adquirido'
  }

  private resultado(r: 'adquirido' | 'requer-reconciliacao'): ResultadoDaPosse {
    return r === 'adquirido'
      ? { ok: true, codexHome: this.deps.codexHome() }
      : { ok: false, motivo: 'requer-reconciliacao' }
  }

  /** Dorme até ser acordado, até o intervalo de reconferência, ou até o cancelamento. */
  private esperarAVez(espera: Espera, signal: AbortSignal | undefined): Promise<void> {
    return new Promise<void>((resolver) => {
      const fim = (): void => {
        clearTimeout(relogio)
        signal?.removeEventListener('abort', fim)
        resolver()
      }
      espera.acordar = fim
      const relogio = setTimeout(
        fim,
        this.deps.intervaloDeEsperaMs ?? INTERVALO_DE_ESPERA_DO_PERFIL_MS
      )
      signal?.addEventListener('abort', fim)
    })
  }
}
