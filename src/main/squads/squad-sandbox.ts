/**
 * O sandbox real de um escritor (SPEC-Squads-03): uma **unidade de sandbox por escritor** sobre o
 * `PreflightService` que já isola o run — container próprio, rede `--internal`, sidecar de egress,
 * worktree próprio e `.git` principal somente-leitura (M9-F03).
 *
 * O Preflight chaveia container, rede, worktree e leases por `runId`. Passar a ele a **unidade**
 * `<runId>-<escritor>-t<tentativa>` no lugar do run dá a cada escritor o seu ambiente sem mudar o
 * Preflight: dois escritores do mesmo run ganham containers e worktrees distintos, e cada
 * tentativa nasce num ambiente novo — o que também evita limpar um worktree sujo com `reset
 * --hard` ou `clean`, que o gate destrutivo do terminal pede aprovação para rodar.
 *
 * A única coisa que o Preflight não separava era a **branch** (oito caracteres do run); o
 * `sufixoDaBranch` resolve.
 *
 * Depois do `preparar`, o kernel **adota** o worktree: lê o gitdir do host agora, antes de o agente
 * rodar, porque depois disso o `.git` do worktree é território do agente.
 */

import type { PedidoDePreflight } from '../pipeline/preflight-service'
import type { PreflightOutcome } from '@shared/domain/preflight'
import type { SandboxPreparado } from '@shared/domain/preflight'
import type { PedidoDeSandbox, SandboxDoEscritor } from './squad-escritor'
import type { SquadGit } from './squad-git'

export interface PreflightParaOEscritor {
  preparar(pedido: PedidoDePreflight): PreflightOutcome
}

export interface DockerParaOEscritor {
  parar(nome: string, cwd: string): boolean
}

export interface DependenciasDoSandboxDoEscritor {
  readonly preflight: PreflightParaOEscritor
  readonly git: Pick<SquadGit, 'adotarWorktree'>
  readonly docker: DockerParaOEscritor
  /** A raiz operacional validada: onde os worktrees podem nascer. Nunca o checkout ativo. */
  readonly raizOperacional: () => string
  /** A URL do proxy do host que o sidecar encaminha. */
  readonly proxyUrl: () => string
  /** O diretório de onde o `docker stop` roda (dentro da allowlist do terminal). */
  readonly cwdDoDocker: () => string
}

/** A unidade de sandbox: única por run, escritor e tentativa. */
export const unidadeDeSandbox = (
  p: Pick<PedidoDeSandbox, 'runId' | 'escritor' | 'tentativa'>
): string => `${p.runId}-${p.escritor}-t${p.tentativa}`

export class SandboxDoEscritorReal implements SandboxDoEscritor {
  /** O sandbox de cada unidade em uso, para o agente achar o container e o `encerrar` pará-lo. */
  private readonly porUnidade = new Map<string, SandboxPreparado>()
  private readonly porWorktree = new Map<string, SandboxPreparado>()

  constructor(private readonly deps: DependenciasDoSandboxDoEscritor) {}

  async preparar(pedido: PedidoDeSandbox): ReturnType<SandboxDoEscritor['preparar']> {
    const unidade = unidadeDeSandbox(pedido)
    const preflight = this.deps.preflight.preparar({
      runId: unidade,
      projectId: pedido.projectId,
      sliceId: pedido.sliceId,
      raizOperacional: this.deps.raizOperacional(),
      repositorio: pedido.repositorio,
      base: pedido.baseSha,
      pathsDaSpec: pedido.pathsPermitidos,
      proxyUrl: this.deps.proxyUrl(),
      sufixoDaBranch: `${pedido.escritor}-t${pedido.tentativa}`
    })
    const sandbox = preflight.sandbox
    if (preflight.reason !== 'liberado' || sandbox === undefined) {
      return { ok: false, motivo: `${preflight.reason}: ${preflight.mensagem}` }
    }

    const adotado = this.deps.git.adotarWorktree({
      repositorio: pedido.repositorio,
      worktree: sandbox.worktreeNoHost,
      branch: sandbox.branch,
      baseSha: sandbox.baseSha
    })
    if (!adotado.ok) {
      // O container já subiu: sem adotar o worktree o escritor não roda, e o container não fica.
      this.parar(sandbox)
      return { ok: false, motivo: `worktree-nao-adotado: ${adotado.motivo}` }
    }

    this.porUnidade.set(unidade, sandbox)
    this.porWorktree.set(sandbox.worktreeNoHost, sandbox)
    return { ok: true, worktree: adotado.valor }
  }

  /** O container que atende o worktree do escritor, ou `undefined` se ele não é de um sandbox vivo. */
  containerDe(worktree: string): { readonly container: string } | undefined {
    const sandbox = this.porWorktree.get(worktree)
    return sandbox === undefined ? undefined : { container: sandbox.containerNome }
  }

  async encerrar(pedido: PedidoDeSandbox): Promise<void> {
    const unidade = unidadeDeSandbox(pedido)
    const sandbox = this.porUnidade.get(unidade)
    if (sandbox === undefined) return
    this.porUnidade.delete(unidade)
    this.porWorktree.delete(sandbox.worktreeNoHost)
    this.parar(sandbox)
  }

  private parar(sandbox: SandboxPreparado): void {
    this.deps.docker.parar(sandbox.containerNome, this.deps.cwdDoDocker())
  }
}
