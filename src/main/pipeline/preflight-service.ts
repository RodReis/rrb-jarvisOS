/**
 * O preflight: tudo o que precisa ser verdade **antes** de o executor começar
 * (SPEC-Entrega-03).
 *
 * A pergunta que este serviço responde: **este run pode começar, e sobre o quê exatamente?**
 * Ele roda depois de o `FilaService` prender o slot global (WIP=1) e antes de a M9-F04
 * construir qualquer coisa. Preparar worktree antes do slot faria dois runs preparar o mesmo
 * diretório; construir sem preflight é o agente sem fronteira que o MVP-004 fechou.
 *
 * ## A ordem das verificações é a regra
 *
 * Docker → base → worktree → árvore limpa → paths → recursos → container. Cada passo só faz
 * sentido depois do anterior: não adianta criar branch se o Docker não vai subir (o run
 * bloquearia com um worktree órfão no disco), e não adianta montar container antes de saber
 * que a árvore está limpa. **Falhar cedo é o que mantém o disco limpo.**
 *
 * ## Fail closed, com motivo
 *
 * Todo desfecho que não é `liberado` carrega um `PreflightReason` e, quando a causa é externa,
 * a ação que destrava (critério 10). A distinção importa: "Docker desligado" o usuário resolve
 * e retoma; "árvore suja" alguém precisa decidir o que fazer com o trabalho local. Uma string
 * livre faria as duas virarem "falhou".
 *
 * **O que este serviço não faz:** não constrói (M9-F04), não commita nem mergeia (M9-F05), não
 * remove container nem worktree (M9-F06). Ele prepara e libera — ou recusa e explica.
 */

import type { WorkspaceId } from '@shared/domain/entities'
import type { BloqueioExterno } from '@shared/domain/pacote-estrutural'
import {
  listaDePathsValida,
  nomeDaBranch,
  nomeDoContainer,
  recursoDoContainer,
  recursoDoWorktree,
  type PathsPermitidos,
  type PreflightOutcome,
  type PreflightReason,
  type SandboxPreparado
} from '@shared/domain/preflight'
import { log } from '../logging/logger'
import type { GitRunner } from '../projects/git-runner'
import type { AuditRepository } from '../storage/audit-repository'
import { RAIZ_NO_CONTAINER, type DockerRunner } from './docker-runner'
import type { LeaseRepository } from './lease-repository'

export interface PedidoDePreflight {
  readonly runId: string
  readonly projectId: string
  readonly sliceId: string
  /** A raiz operacional validada: onde o worktree pode nascer. Nunca o checkout ativo. */
  readonly raizOperacional: string
  /** O repositório do projeto-alvo, no host. */
  readonly repositorio: string
  /** A branch base de onde o run parte. */
  readonly base: string
  /** O escopo declarado pela SPEC, quando ela o traz (critério 13). */
  readonly pathsDaSpec?: PathsPermitidos
  readonly proxyUrl: string
}

export interface PreflightDeps {
  readonly git: GitRunner
  readonly docker: DockerRunner
  readonly leases: LeaseRepository
  readonly audit: AuditRepository
  readonly userId: () => string
  readonly workspaceId: () => WorkspaceId
  /**
   * O proxy do host está no ar? Sem ele o executor não alcança modelo nenhum, e o critério 11
   * exige que o preflight falhe — não que o run descubra isso na primeira chamada.
   */
  readonly proxyNoAr: () => boolean
  /**
   * A derivação do escopo quando a SPEC não traz a seção (emenda 2 de 2026-08-30).
   *
   * Injetada e não implementada aqui: a fonte é a arquitetura aprovada do projeto-alvo, que
   * mora no MVP-008. Quem a conhece passa a função; o preflight só exige que o resultado exista.
   */
  readonly derivarPaths: (projectId: string, sliceId: string) => PathsPermitidos | undefined
  /**
   * Copia `.git/worktrees/<lease>` para um lugar do worktree e aponta o `commondir` da cópia
   * para o caminho do container. Devolve o caminho da cópia, ou `undefined` se falhar.
   *
   * Injetada porque é I/O de disco, e o que este serviço decide é *quando* preparar — não como
   * escrever arquivo. Ver a nota no ponto de uso: a cópia existe para não quebrar o host.
   */
  readonly prepararGitMeta: (origem: string, worktree: string) => string | undefined
  readonly agora?: () => number
}

export class PreflightService {
  private readonly agora: () => number

  constructor(private readonly deps: PreflightDeps) {
    this.agora = deps.agora ?? ((): number => Date.now())
  }

  /**
   * Prepara o sandbox, ou recusa com motivo.
   *
   * Devolve sempre um `PreflightOutcome` — recusa não estoura exceção, pela mesma razão do
   * `TerminalEngine`: é desfecho legítimo que a fila precisa transformar em `BLOCKED` e a
   * evidência precisa guardar.
   */
  preparar(pedido: PedidoDePreflight): PreflightOutcome {
    const userId = this.deps.userId()

    // 1. Docker antes de tudo: sem sandbox não há execução, e nunca há fallback para o host
    //    (critério 10). Verificar depois de criar o worktree deixaria lixo no disco.
    if (!this.deps.docker.disponivel(pedido.raizOperacional)) {
      return this.recusar(
        pedido,
        'docker-indisponivel',
        'O Docker não respondeu. O executor roda no container, e não existe execução no host.',
        'Subir o Docker Desktop e retomar a fatia.'
      )
    }

    // 2. O proxy é o único caminho até o modelo (critério 11). Sem ele o run começaria e
    //    morreria na primeira chamada, com worktree e container já criados.
    if (!this.deps.proxyNoAr()) {
      return this.recusar(
        pedido,
        'proxy-indisponivel',
        'O proxy de autenticação do host não está no ar. Sem ele o executor não alcança modelo.',
        'Reiniciar o app para subir o proxy e retomar a fatia.'
      )
    }

    // 3. O cwd nunca é o checkout ativo (critério 1). É a garantia mais barata da lista, e a
    //    que evita o pior desfecho possível: o agente construindo dentro do próprio app.
    const worktree = this.caminhoDoWorktree(pedido)
    if (dentroDe(worktree, pedido.repositorio)) {
      return this.recusar(
        pedido,
        'cwd-invalido',
        'O worktree cairia dentro do checkout ativo. O executor nunca recebe o checkout ativo como cwd.',
        'Configurar uma raiz operacional fora do repositório do projeto.'
      )
    }

    // 4. A lista de paths existe **antes** da execução (critério 13). Derivada quando a SPEC
    //    não traz — mas nunca ausente, porque sem ela o critério 6 não tem o que medir.
    const paths = pedido.pathsDaSpec ?? this.deps.derivarPaths(pedido.projectId, pedido.sliceId)
    if (!listaDePathsValida(paths)) {
      return this.recusar(
        pedido,
        'sem-paths-permitidos',
        'Nenhuma lista de paths permitidos foi declarada nem pôde ser derivada da arquitetura aprovada.',
        'Declarar a seção "## Paths permitidos" na SPEC da fatia.'
      )
    }

    // 5. A base resolve? O SHA é fixado **antes** de qualquer escrita (critério 2): a branch
    //    tem de nascer de um ponto conhecido, não de "o que a base for quando eu olhar".
    const baseSha = this.resolverBase(pedido)
    if (baseSha === undefined) {
      return this.recusar(
        pedido,
        'base-nao-resolvida',
        `A base "${pedido.base}" não resolve para um commit. Sem SHA fixo não há de onde partir.`,
        'Conferir se a branch base existe e se o fetch do repositório está atualizado.'
      )
    }

    // 6. Os recursos são deste run, ou de ninguém (critério 4). O `UNIQUE(user_id, recurso)`
    //    fecha a janela entre olhar e adquirir — o mesmo raciocínio do WIP=1 da M9-F02.
    const leaseWorktree = this.deps.leases.adquirir(
      userId,
      {
        proprietario: pedido.runId,
        recurso: recursoDoWorktree(pedido.runId),
        projectId: pedido.projectId
      },
      this.agora()
    )
    if (leaseWorktree === undefined) {
      return this.recusar(
        pedido,
        'recurso-ocupado',
        'O worktree deste run já tem dono. Outro processo pode estar trabalhando nele.',
        'Aguardar o run em andamento terminar, ou reconciliar os leases no próximo boot.'
      )
    }

    const nomeContainer = nomeDoContainer(pedido.runId)
    const leaseContainer = this.deps.leases.adquirir(
      userId,
      {
        proprietario: pedido.runId,
        recurso: recursoDoContainer(pedido.runId),
        projectId: pedido.projectId
      },
      this.agora()
    )
    if (leaseContainer === undefined) {
      this.deps.leases.liberar(userId, recursoDoWorktree(pedido.runId), pedido.runId)
      return this.recusar(
        pedido,
        'recurso-ocupado',
        `O container ${nomeContainer} já tem dono.`,
        'Aguardar o run em andamento terminar, ou reconciliar os leases no próximo boot.'
      )
    }

    // 7. A branch nasce do SHA fixado (critério 2), num worktree fora do checkout ativo.
    const branch = nomeDaBranch(pedido.sliceId, pedido.runId)
    // `core.autocrlf=false` no ato do checkout, e isto **não é preferência de estilo**: no
    // Windows o padrão grava CRLF no disco, e o Git de dentro do container (Linux) lê cada
    // arquivo como modificado. O executor veria a árvore inteira suja e o critério 6 acusaria
    // fuga de escopo em todo arquivo do projeto. Medido com Docker real.
    const criou = this.deps.git.run(
      ['-c', 'core.autocrlf=false', 'worktree', 'add', '-b', branch, worktree, baseSha],
      pedido.repositorio,
      this.deps.workspaceId()
    )
    if (!criou.ok) {
      this.liberarRecursos(userId, pedido.runId)
      return this.recusar(
        pedido,
        'base-nao-resolvida',
        `Não foi possível criar o worktree em ${worktree}.`,
        'Conferir se o caminho está livre e se a raiz operacional é gravável.'
      )
    }

    // 8. A árvore é limpa? Modificação não commitada não é lixo — é trabalho de alguém, e
    //    apagá-la seria a destruição que o critério 7 proíbe. Só olhamos a **nossa** árvore.
    const sujo = this.deps.git.run(['status', '--porcelain'], worktree, this.deps.workspaceId())
    if (sujo.ok && sujo.saida !== '') {
      this.liberarRecursos(userId, pedido.runId)
      return this.recusar(
        pedido,
        'arvore-suja',
        'O worktree nasceu com modificações não commitadas. Isso não é esperado e pode ser trabalho de outro processo.',
        'Inspecionar o diretório do worktree antes de retomar.'
      )
    }

    // 9. O sandbox sobe com o worktree montado e nenhum segredo (critérios 8 e 9).
    //
    // O metadado do Git vai **copiado**: o `commondir` precisa de um caminho no host e outro no
    // container, e é um arquivo só. Reescrevê-lo no original faz o host perder o worktree
    // (`fatal: not a git repository`) — medido. A cópia dá a cada lado o caminho que serve a ele.
    const gitMeta = this.deps.prepararGitMeta(
      `${pedido.repositorio}/.git/worktrees/${nomeDoWorktree(worktree)}`,
      worktree
    )
    if (gitMeta === undefined) {
      this.liberarRecursos(userId, pedido.runId)
      return this.recusar(
        pedido,
        'base-nao-resolvida',
        'Não foi possível preparar o metadado do Git para o container.',
        'Conferir permissões de escrita na raiz operacional.'
      )
    }

    const montou = this.deps.docker.subir(
      {
        worktreeNoHost: worktree,
        gitMetaNoHost: gitMeta,
        gitCommonNoHost: `${pedido.repositorio}/.git`,
        containerNome: nomeContainer,
        proxyUrl: pedido.proxyUrl
      },
      pedido.raizOperacional
    )
    if (!montou) {
      this.liberarRecursos(userId, pedido.runId)
      return this.recusar(
        pedido,
        'docker-indisponivel',
        `O container ${nomeContainer} não subiu.`,
        'Conferir o Docker Desktop e retomar a fatia.'
      )
    }

    const sandbox: SandboxPreparado = {
      runId: pedido.runId,
      containerNome: nomeContainer,
      cwd: RAIZ_NO_CONTAINER,
      baseSha,
      branch,
      worktreeNoHost: worktree,
      pathsPermitidos: paths,
      proxyUrl: pedido.proxyUrl
    }

    this.deps.audit.append({
      user_id: userId,
      workspace_id: this.deps.workspaceId(),
      type: 'pipeline-transition',
      payload: {
        preflight: 'liberado',
        runId: pedido.runId,
        baseSha,
        branch,
        container: nomeContainer,
        // A lista registrada é a que vale no critério 6 — nunca uma inferência no commit.
        pathsPermitidos: paths.paths,
        origemDosPaths: paths.origem
      }
    })

    log.agent.info('Preflight liberado', { runId: pedido.runId, container: nomeContainer })
    return { reason: 'liberado', sandbox, mensagem: 'Sandbox pronto.' }
  }

  /**
   * O que a máquina tem para o executor, sem preparar nada.
   *
   * Existe para a tela da M9-F06 e para o diagnóstico responderem *"por que o run não começa?"*
   * antes de haver run — que é justamente quando a resposta é mais útil. **Não prepara e não
   * derruba**: um canal que subisse container deixaria o renderer iniciar execução, o pulo que
   * o critério 5 da M9-F02 existe para impedir.
   */
  estado(cwd: string): {
    readonly dockerNoAr: boolean
    readonly proxyNoAr: boolean
    readonly proxyUrl?: string
  } {
    return {
      dockerNoAr: this.deps.docker.disponivel(cwd),
      proxyNoAr: this.deps.proxyNoAr()
    }
  }

  /**
   * O bloqueio externo correspondente a um preflight recusado.
   *
   * Existe para a fila transformar a recusa em `BLOCKED` sem reinterpretar o motivo: os cinco
   * campos do `BloqueioExterno` saem do desfecho, e `porQueNaoSeguir` é o que distingue um
   * bloqueio de um erro qualquer.
   */
  bloqueioDe(outcome: PreflightOutcome, tentativas: number): BloqueioExterno {
    return {
      causa: outcome.reason,
      evidencia: outcome.mensagem,
      tentativas,
      porQueNaoSeguir:
        'O executor roda no container sobre um worktree de escopo declarado. Sem o preflight completo, seguir significaria construir fora da fronteira.',
      retomada: outcome.retomada ?? 'Corrigir a causa registrada e retomar a fatia.'
    }
  }

  private resolverBase(pedido: PedidoDePreflight): string | undefined {
    const resolvido = this.deps.git.run(
      ['rev-parse', '--verify', `${pedido.base}^{commit}`],
      pedido.repositorio,
      this.deps.workspaceId()
    )
    if (!resolvido.ok || resolvido.saida === '') return undefined
    return resolvido.saida.trim()
  }

  private caminhoDoWorktree(pedido: PedidoDePreflight): string {
    return `${pedido.raizOperacional}/${nomeDoContainer(pedido.runId)}`
  }

  /**
   * Recusa: libera nada por si só — quem tinha recurso já liberou antes de chamar.
   *
   * O `AuditEvent` é emitido **em toda** recusa, e não só nas externas: um preflight que recusa
   * por escopo ausente é informação de processo que a evidência do run precisa carregar.
   */
  private recusar(
    pedido: PedidoDePreflight,
    reason: PreflightReason,
    mensagem: string,
    retomada: string
  ): PreflightOutcome {
    this.deps.audit.append({
      user_id: this.deps.userId(),
      workspace_id: this.deps.workspaceId(),
      type: 'pipeline-transition',
      payload: { preflight: 'recusado', runId: pedido.runId, causa: reason, mensagem }
    })
    log.agent.warn('Preflight recusado', { runId: pedido.runId, causa: reason })
    return { reason, mensagem, retomada }
  }

  private liberarRecursos(userId: string, runId: string): void {
    this.deps.leases.liberar(userId, recursoDoWorktree(runId), runId)
    this.deps.leases.liberar(userId, recursoDoContainer(runId), runId)
  }
}

/** O nome do diretório do worktree — é ele que o Git usa em `.git/worktrees/<nome>`. */
function nomeDoWorktree(caminho: string): string {
  const partes = caminho.split(/[\\/]+/).filter((p) => p !== '')
  return partes[partes.length - 1] ?? ''
}

/**
 * `alvo` está dentro de `base`? Comparação por segmento, nunca por prefixo de string.
 *
 * `/repo-2` não pode contar como dentro de `/repo` — e um `startsWith` diria que sim, deixando
 * o critério 1 passar por coincidência de nome.
 */
function dentroDe(alvo: string, base: string): boolean {
  const a = alvo.split(/[\\/]+/).filter((p) => p !== '' && p !== '.')
  const b = base.split(/[\\/]+/).filter((p) => p !== '' && p !== '.')
  if (b.length === 0 || b.length > a.length) return false
  return b.every((parte, i) => parte === a[i])
}
