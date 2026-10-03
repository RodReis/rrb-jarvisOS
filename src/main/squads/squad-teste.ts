/**
 * A etapa TESTE do Squad (SPEC-Squads-04, ADR-006 decisão 9): a suíte do projeto sobre o
 * **resultado integrado**, **antes** de o REVIEWER olhar.
 *
 * Três desfechos honestos e um quarto que não finge: `verde`, `vermelha` (com o passo, a classe da
 * falha e a evidência), `cancelada` e `nao-rodou` — sandbox que não subiu, comando que o projeto
 * não declara, serviço fora do ar. **`nao-rodou` nunca é `verde`** (`TESTING.md`: ausência de
 * ambiente é `not_run`, não `pass`), e suíte vermelha ou que não rodou **param** a integração: não
 * existe "aceitar mesmo assim" (regra 1).
 *
 * A suíte roda **sempre no container** (M9-F03, critério 11): o executor real sobe um sandbox
 * sobre o commit integrado e roda os comandos dentro dele. Nada roda no host.
 */

import type { ClassificacaoDeFalha } from '@shared/domain/attempt'
import { classificarFalha } from '@shared/domain/attempt'
import type { ComandosDeValidacao } from '@shared/domain/ci-workflow'
import type { WorkspaceId } from '@shared/domain/entities'
import type { PreflightOutcome, SandboxPreparado } from '@shared/domain/preflight'
import type { PedidoDePreflight } from '../pipeline/preflight-service'
import type { ExecucaoNoContainer } from '../pipeline/docker-runner'
import type { AuditRepository } from '../storage/audit-repository'

export const PASSOS_DA_SUITE = ['test', 'lint', 'typecheck', 'build'] as const
export type PassoDaSuite = (typeof PASSOS_DA_SUITE)[number]

/** O fim da saída de um passo que falhou: o erro está no fim, e o resto é ruído. */
export const MAX_EVIDENCIA = 2000

export interface PedidoDaSuite {
  readonly runId: string
  readonly projectId: string
  readonly sliceId: string
  readonly repositorio: string
  /** O commit integrado: é sobre ele que a suíte roda. */
  readonly commitSha: string
  readonly comandos: ComandosDeValidacao
  /** A tentativa do DEVELOPER que está sendo testada, a partir de 1. */
  readonly tentativa: number
  readonly signal?: AbortSignal
}

export type ResultadoDaSuite =
  | { readonly estado: 'verde'; readonly passos: readonly PassoDaSuite[] }
  | {
      readonly estado: 'vermelha'
      readonly passo: PassoDaSuite
      readonly classificacao: ClassificacaoDeFalha
      readonly evidencia: string
      readonly passos: readonly PassoDaSuite[]
    }
  | { readonly estado: 'cancelada' }
  | { readonly estado: 'nao-rodou'; readonly motivo: string }

/** A porta: roda a suíte sobre um commit. A implementação real é `SuiteNoSandbox`. */
export interface ExecutorDeSuite {
  rodar(pedido: PedidoDaSuite): Promise<ResultadoDaSuite>
}

// ─── o executor real: sandbox sobre o commit integrado ──────────────────────────────────────────

export interface PreflightParaASuite {
  preparar(pedido: PedidoDePreflight): PreflightOutcome
}

export interface DockerParaASuite {
  exec(container: string, comando: readonly string[], cwd: string): ExecucaoNoContainer
  matarProcesso(container: string, cwd: string): void
  parar(nome: string, cwd: string): boolean
}

export interface DependenciasDaSuiteNoSandbox {
  readonly preflight: PreflightParaASuite
  readonly docker: DockerParaASuite
  /** A raiz operacional validada: onde os worktrees podem nascer. Nunca o checkout ativo. */
  readonly raizOperacional: () => string
  /** A URL do proxy do host que o sidecar encaminha: o sandbox exige uma, mesmo sem agente. */
  readonly proxyUrl: () => string
  /** O diretório de onde o `docker` roda (dentro da allowlist do terminal). */
  readonly cwdDoDocker: () => string
}

/** Uma unidade de sandbox por run e tentativa: a suíte nunca reaproveita o ambiente de outra. */
export const unidadeDaSuite = (runId: string, tentativa: number): string =>
  `${runId}-teste-t${tentativa}`

const cauda = (texto: string): string =>
  texto.length > MAX_EVIDENCIA ? texto.slice(texto.length - MAX_EVIDENCIA) : texto

export class SuiteNoSandbox implements ExecutorDeSuite {
  constructor(private readonly deps: DependenciasDaSuiteNoSandbox) {}

  async rodar(pedido: PedidoDaSuite): Promise<ResultadoDaSuite> {
    const faltando = PASSOS_DA_SUITE.find((p) => pedido.comandos[p].length === 0)
    // Passo sem comando não é passo que passou: a suíte que não existe não está verde.
    if (faltando !== undefined)
      return { estado: 'nao-rodou', motivo: `comando-ausente:${faltando}` }
    if (pedido.signal?.aborted === true) return { estado: 'cancelada' }

    const unidade = unidadeDaSuite(pedido.runId, pedido.tentativa)
    const preflight = this.deps.preflight.preparar({
      runId: unidade,
      projectId: pedido.projectId,
      sliceId: pedido.sliceId,
      raizOperacional: this.deps.raizOperacional(),
      repositorio: pedido.repositorio,
      base: pedido.commitSha,
      proxyUrl: this.deps.proxyUrl(),
      sufixoDaBranch: `teste-t${pedido.tentativa}`
    })
    const sandbox = preflight.sandbox
    if (preflight.reason !== 'liberado' || sandbox === undefined) {
      return { estado: 'nao-rodou', motivo: `${preflight.reason}: ${preflight.mensagem}` }
    }
    try {
      return this.passos(sandbox, pedido)
    } finally {
      this.deps.docker.parar(sandbox.containerNome, this.deps.cwdDoDocker())
    }
  }

  private passos(sandbox: SandboxPreparado, pedido: PedidoDaSuite): ResultadoDaSuite {
    const feitos: PassoDaSuite[] = []
    for (const passo of PASSOS_DA_SUITE) {
      if (pedido.signal?.aborted === true) {
        this.deps.docker.matarProcesso(sandbox.containerNome, sandbox.worktreeNoHost)
        return { estado: 'cancelada' }
      }
      // O cwd do `docker exec` é o worktree no host (dentro da allowlist do terminal); o comando
      // roda dentro do container, como no `ConstrutorService`.
      const execucao = this.deps.docker.exec(
        sandbox.containerNome,
        pedido.comandos[passo],
        sandbox.worktreeNoHost
      )
      if (!execucao.ok) {
        return {
          estado: 'vermelha',
          passo,
          classificacao: classificarFalha(execucao),
          evidencia: cauda(`${execucao.stderr}\n${execucao.stdout}`.trim()),
          passos: feitos
        }
      }
      feitos.push(passo)
    }
    return { estado: 'verde', passos: feitos }
  }
}

// ─── a etapa: audita e nunca lança ──────────────────────────────────────────────────────────────

export interface DependenciasDaEtapaDeTeste {
  readonly suite: ExecutorDeSuite
  readonly audit: AuditRepository
  readonly userId: () => string
  readonly workspaceId: () => WorkspaceId
}

export class EtapaDeTeste {
  constructor(private readonly deps: DependenciasDaEtapaDeTeste) {}

  async executar(pedido: PedidoDaSuite): Promise<ResultadoDaSuite> {
    let resultado: ResultadoDaSuite
    try {
      resultado = await this.deps.suite.rodar(pedido)
    } catch (erro) {
      // A etapa nunca lança: o que escapou é suíte que não rodou, nunca suíte verde.
      resultado = {
        estado: 'nao-rodou',
        motivo: `erro inesperado: ${erro instanceof Error ? erro.name : 'desconhecido'}`
      }
    }
    this.auditar(pedido, resultado)
    return resultado
  }

  /** Só estados, passos e classe — a evidência é saída do projeto e fica fora da auditoria. */
  private auditar(pedido: PedidoDaSuite, r: ResultadoDaSuite): void {
    this.deps.audit.append({
      user_id: this.deps.userId(),
      workspace_id: this.deps.workspaceId(),
      type: 'squad-teste',
      payload: {
        runId: pedido.runId,
        tentativa: pedido.tentativa,
        commitSha: pedido.commitSha,
        estado: r.estado,
        ...(r.estado === 'vermelha' ? { passo: r.passo, classificacao: r.classificacao } : {}),
        ...(r.estado === 'nao-rodou' ? { motivo: r.motivo.slice(0, 160) } : {})
      }
    })
  }
}

/** O texto do kernel que o revisor recebe: o que rodou e como terminou, sem texto de agente. */
export function resumoDaSuite(r: ResultadoDaSuite): string {
  switch (r.estado) {
    case 'verde':
      return `suíte verde: ${r.passos.join(', ')}`
    case 'vermelha':
      return `suíte vermelha no passo ${r.passo} (${r.classificacao}):\n${r.evidencia}`
    case 'cancelada':
      return 'suíte cancelada'
    case 'nao-rodou':
      return `suíte não rodou: ${r.motivo}`
  }
}
