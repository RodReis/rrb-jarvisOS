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

import type { WorkspaceId } from '@shared/domain/entities'
import type { PedidoDePreflight } from '../pipeline/preflight-service'
import type { PreflightOutcome } from '@shared/domain/preflight'
import type { SandboxPreparado } from '@shared/domain/preflight'
import type { PedidoDeSandbox, SandboxDoEscritor } from './squad-escritor'
import type { SquadGit } from './squad-git'

export interface PreflightParaOEscritor {
  preparar(pedido: PedidoDePreflight): PreflightOutcome
}

/** O proxy do executor, que roteia cada unidade para o run e o pack dela (critério 5). */
export interface ProxyParaOEscritor {
  registrarUnidade(contexto: {
    workspaceId: WorkspaceId
    runId: string
    tentativa: number
    contextPackId: string
  }): {
    chave: string
    caminho: string
  }
  liberarUnidade(chave: string): void
}

export interface DockerParaOEscritor {
  parar(nome: string, cwd: string): boolean
}

export interface DependenciasDoSandboxDoEscritor {
  readonly preflight: PreflightParaOEscritor
  readonly git: Pick<SquadGit, 'adotarWorktree'>
  readonly docker: DockerParaOEscritor
  readonly proxy: ProxyParaOEscritor
  /** A raiz operacional validada: onde os worktrees podem nascer. Nunca o checkout ativo. */
  readonly raizOperacional: () => string
  /** A URL do proxy do host que o sidecar encaminha. */
  readonly proxyUrl: () => string
  /** O diretório de onde o `docker stop` roda (dentro da allowlist do terminal). */
  readonly cwdDoDocker: () => string
}

/** O que distingue a unidade da vizinha no mesmo run: o escritor, a tarefa e a tentativa. */
const sufixoDoSandbox = (p: Pick<PedidoDeSandbox, 'escritor' | 'tarefaId' | 'tentativa'>): string =>
  `${p.escritor}-${p.tarefaId}-t${p.tentativa}`

/** A unidade de sandbox: única por run, escritor, tarefa e tentativa. */
export const unidadeDeSandbox = (
  p: Pick<PedidoDeSandbox, 'runId' | 'escritor' | 'tarefaId' | 'tentativa'>
): string => `${p.runId}-${sufixoDoSandbox(p)}`

export class SandboxDoEscritorReal implements SandboxDoEscritor {
  /** O sandbox e a chave de proxy de cada unidade em uso: o `encerrar` para um e libera a outra. */
  private readonly porUnidade = new Map<string, { sandbox: SandboxPreparado; chave: string }>()
  private readonly porWorktree = new Map<string, SandboxPreparado>()

  constructor(private readonly deps: DependenciasDoSandboxDoEscritor) {}

  async preparar(pedido: PedidoDeSandbox): ReturnType<SandboxDoEscritor['preparar']> {
    const unidade = unidadeDeSandbox(pedido)
    // A chave nasce antes do container: a URL que ele recebe já carrega o caminho da unidade.
    const rota = this.deps.proxy.registrarUnidade({
      workspaceId: pedido.workspaceId,
      runId: pedido.runId,
      tentativa: pedido.tentativa,
      contextPackId: pedido.contextPackId
    })
    const preflight = this.deps.preflight.preparar({
      runId: unidade,
      projectId: pedido.projectId,
      sliceId: pedido.sliceId,
      raizOperacional: this.deps.raizOperacional(),
      repositorio: pedido.repositorio,
      base: pedido.baseSha,
      pathsDaSpec: pedido.pathsPermitidos,
      proxyUrl: this.deps.proxyUrl(),
      sufixoDaBranch: sufixoDoSandbox(pedido),
      caminhoDoProxy: rota.caminho
    })
    const sandbox = preflight.sandbox
    if (preflight.reason !== 'liberado' || sandbox === undefined) {
      this.deps.proxy.liberarUnidade(rota.chave)
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
      this.deps.proxy.liberarUnidade(rota.chave)
      return { ok: false, motivo: `worktree-nao-adotado: ${adotado.motivo}` }
    }

    this.porUnidade.set(unidade, { sandbox, chave: rota.chave })
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
    const emUso = this.porUnidade.get(unidade)
    if (emUso === undefined) return
    const { sandbox, chave } = emUso
    this.porUnidade.delete(unidade)
    this.porWorktree.delete(sandbox.worktreeNoHost)
    this.deps.proxy.liberarUnidade(chave)
    this.parar(sandbox)
  }

  private parar(sandbox: SandboxPreparado): void {
    this.deps.docker.parar(sandbox.containerNome, this.deps.cwdDoDocker())
  }
}
