/**
 * Publicação do repositório e do backlog aprovado no GitHub (SPEC-Entrega-01).
 *
 * A primeira fatia do MVP-009, e a que estabelece a divisão de trabalho que as outras cinco
 * herdam: **o efeito remoto é do app, o Git é do terminal controlado, e nenhum dos dois é do
 * agente**. Aqui isso vira código em três acoplamentos, cada um por uma razão que a spec crava:
 *
 *  - **O GitHub entra pelo `ConnectorService`, nunca pelo `GithubAdapter`.** O gate de créditos, a
 *    policy `api.external-call` e a auditoria do par antes/depois vivem dentro do `call()`.
 *    Instanciar o adapter aqui seria o segundo caminho sem gate — o mesmo erro que o `GitRunner`
 *    existe para impedir do lado do Git.
 *  - **O Git entra pelo `GitRunner`**, que é o `git` do sistema pelo terminal do MVP-004. Publicar
 *    não abre um segundo caminho de escrita (decisão cravada da spec).
 *  - **O token nunca sai daqui para o conector.** O envelope carrega a *referência* da credencial;
 *    quem resolve o cofre é o `ConnectorService`. O único lugar onde o valor do token é tocado é o
 *    push, porque o `ambienteControlado()` do MVP-004 não deixa variável de ambiente alcançar o
 *    subprocess — e mesmo ali ele é redigido antes de virar auditoria.
 *
 * **O que esta fatia não faz:** decidir *quando* publicar. Isso é a M9-F02, com o DAG e a fila.
 */

import { randomUUID } from 'node:crypto'
import type { ConnectorOutcome, ConnectorRequest } from '@shared/domain/connectors'
import { CONNECTOR_CONTRACT_VERSION } from '@shared/domain/connectors'
import type { WorkspaceId } from '@shared/domain/entities'
import { GITHUB_OPERATIONS } from '@shared/domain/github-automation'
import type { BloqueioExterno } from '@shared/domain/pacote-estrutural'
import {
  chaveDeFatia,
  chaveDeMvp,
  type AlvoDaPublicacao,
  type PublicacaoOutcome
} from '@shared/domain/publicacao'
import type { Mvp, Slice } from '@shared/domain/roadmap'
import type { ConnectorService } from '../connectors/connector-service'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import { GitRunner } from './git-runner'
import type { ProjectRepository } from './project-repository'
import type { RoadmapRepository } from './roadmap-repository'

export interface PublicacaoDeps {
  readonly projects: ProjectRepository
  readonly roadmap: RoadmapRepository
  readonly git: GitRunner
  readonly connectors: ConnectorService
  readonly audit: AuditRepository
  readonly userId: () => string
  /** Resolve o token para o **push**. O conector resolve o seu por dentro do `ConnectorService`. */
  readonly token: (userId: string, workspace: WorkspaceId) => Promise<string | undefined>
}

/** A branch que a publicação usa como base. Constante porque não há decisão do PI que a mude. */
const BRANCH_BASE = 'main'

export class PublicacaoService {
  constructor(private readonly deps: PublicacaoDeps) {}

  /**
   * Publica o repositório e o backlog aprovado, de forma idempotente e retomável.
   *
   * A ordem do fluxo é a da spec, e ela não é arbitrária: o repositório antes dos commits (não há
   * onde empurrar), os commits antes da branch base (o GitHub recusa apontar a default para uma ref
   * que não existe), e a issue do MVP antes da issue da fatia (a dependência precisa dos dois
   * números). Cada passo que falha vira bloqueio **no ponto**, preservando o que já saiu — é o que
   * torna o critério 6 possível: a retomada reencontra pela chave em vez de repetir.
   */
  async publicar(
    projectId: string,
    workspaceId: WorkspaceId,
    alvo: AlvoDaPublicacao
  ): Promise<PublicacaoOutcome> {
    const userId = this.deps.userId()
    const projeto = this.deps.projects.findById(userId, projectId)

    // Falha fechado, antes de qualquer efeito remoto: publicar um projeto que não existe criaria
    // um repositório órfão que ninguém pediu.
    if (projeto === undefined) return { reason: 'projeto-inexistente', criados: 0 }

    const escopo = { userId, workspaceId, projectId }
    const { mvps, slices } = this.deps.roadmap.carregar(escopo)

    // Só o que o PI liberou para a fila. "Nenhuma issue futura equivale a autorização de
    // construção" (§ Regras): publicar um MVP `proposto` criaria board de trabalho não aprovado.
    const naFila = mvps.filter((m) => m.estado === 'na-fila')
    if (naFila.length === 0) return { reason: 'sem-backlog-aprovado', criados: 0 }

    let criados = 0
    const contar = (o: ConnectorOutcome): void => {
      if (this.foiCriado(o)) criados += 1
    }

    // 1. O repositório existe.
    const repo = await this.chamar(GITHUB_OPERATIONS.ensureRepository, workspaceId, {
      owner: alvo.owner,
      repo: alvo.repo,
      visibility: 'private'
    })
    if (!repo.ok) return this.bloqueado(repo, 'o repositório', criados)
    contar(repo)

    // 2. Os commits locais chegam à origem.
    //
    // A credencial só entra quando a origem é HTTPS. Um remote `file://` ou um caminho local não
    // autentica — embutir token neles falharia na montagem da URL, e exigir credencial para
    // publicar num bare local seria pedir o que aquele destino não usa. É a diferença entre "não
    // tem credencial" e "não precisa de credencial", e tratá-las igual bloquearia a segunda.
    const push = alvo.origem.startsWith('https://')
      ? await this.pushAutenticado(projeto.diretorio, alvo.origem, userId, workspaceId)
      : this.deps.git.push(alvo.origem, BRANCH_BASE, projeto.diretorio, workspaceId)

    if (push === undefined) {
      return {
        reason: 'bloqueado',
        criados,
        bloqueio: {
          causa: 'credencial-ausente',
          evidencia: 'O cofre não devolveu um token do GitHub para este usuário e espaço.',
          tentativas: 1,
          porQueNaoSeguir:
            'Sem credencial o push autenticaria como anônimo e falharia com "repository not found" — a mensagem que manda procurar o erro no lugar errado.',
          retomada: 'Conecte o GitHub em Configurações → Conectores e publique de novo.'
        }
      }
    }

    if (!push.ok) return { reason: 'bloqueado', criados, bloqueio: this.bloqueioDoPush(push) }

    // 3. A branch base e a proteção.
    const base = await this.chamar(GITHUB_OPERATIONS.setDefaultBranch, workspaceId, {
      owner: alvo.owner,
      repo: alvo.repo,
      branch: BRANCH_BASE
    })
    if (!base.ok) return this.bloqueado(base, 'a branch base', criados)

    const protecao = await this.chamar(GITHUB_OPERATIONS.ensureBranchProtection, workspaceId, {
      owner: alvo.owner,
      repo: alvo.repo,
      branch: BRANCH_BASE,
      // Zero revisores: o merge autônomo do MVP-009 é a decisão 2 do PI, e exigir revisor humano
      // aqui barraria a entrega que a proteção existe para proteger. Force-push e deleção seguem
      // proibidos, que é o que preserva os dois lados numa divergência.
      revisoesExigidas: 0
    })
    if (!protecao.ok) return this.bloqueado(protecao, 'a proteção da branch', criados)

    // 4. As issues do MVP e das fatias, e as dependências entre elas.
    const numeroDoMvp = new Map<string, number>()

    for (const mvp of naFila) {
      const issue = await this.chamar(GITHUB_OPERATIONS.ensureIssue, workspaceId, {
        owner: alvo.owner,
        repo: alvo.repo,
        externalKey: chaveDeMvp(projectId, mvp.numero),
        title: this.tituloDoMvp(mvp),
        body: this.corpoDoMvp(mvp)
      })
      if (!issue.ok) return this.bloqueado(issue, `a issue do MVP ${mvp.numero}`, criados)
      contar(issue)
      numeroDoMvp.set(mvp.id, this.numeroDaIssue(issue))
    }

    for (const slice of slices) {
      const pai = numeroDoMvp.get(slice.mvpId)
      // Fatia de MVP que não está na fila não é publicada: ela pertence a um MVP que o PI ainda
      // não liberou, e criar a issue anteciparia a autorização.
      if (pai === undefined) continue

      const mvp = naFila.find((m) => m.id === slice.mvpId)
      const issue = await this.chamar(GITHUB_OPERATIONS.ensureIssue, workspaceId, {
        owner: alvo.owner,
        repo: alvo.repo,
        externalKey: chaveDeFatia(projectId, mvp?.numero ?? 0, slice.numero),
        title: this.tituloDaFatia(mvp, slice),
        body: this.corpoDaFatia(slice)
      })
      if (!issue.ok) return this.bloqueado(issue, `a issue da fatia ${slice.numero}`, criados)
      contar(issue)

      const vinculo = await this.chamar(GITHUB_OPERATIONS.ensureIssueDependency, workspaceId, {
        owner: alvo.owner,
        repo: alvo.repo,
        parentIssue: pai,
        childIssue: this.numeroDaIssue(issue)
      })
      if (!vinculo.ok) return this.bloqueado(vinculo, `o vínculo da fatia ${slice.numero}`, criados)
    }

    // 5. Confirmar na origem o que foi publicado (critério 2).
    //
    // Ler o commit da origem é o que separa "mandei" de "chegou". Sem esta chamada, a
    // correspondência seria afirmada a partir do que enviamos, e um push parcial ou rejeitado por
    // outro caminho passaria por completo.
    const confirmacao = await this.chamar(GITHUB_OPERATIONS.getCommitSha, workspaceId, {
      owner: alvo.owner,
      repo: alvo.repo,
      ref: BRANCH_BASE
    })
    if (!confirmacao.ok) return this.bloqueado(confirmacao, 'a confirmação do commit', criados)

    const commitPublicado = this.shaConfirmado(confirmacao)

    this.deps.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'publicacao-github',
      payload: {
        projectId,
        repositorio: `${alvo.owner}/${alvo.repo}`,
        branch: BRANCH_BASE,
        commitPublicado,
        criados
      }
    })

    log.agent.info('Publicação concluída', { projectId, criados })

    return { reason: 'publicado', criados, commitPublicado }
  }

  /**
   * O push com credencial, para origem HTTPS.
   *
   * Devolve `undefined` quando o cofre não tem token — e o chamador distingue isso de um push que
   * falhou, porque os remédios são diferentes: um pede reconectar o GitHub, o outro pede olhar o
   * que o Git recusou.
   */
  private async pushAutenticado(
    diretorio: string,
    origem: string,
    userId: string,
    workspaceId: WorkspaceId
  ): Promise<ReturnType<GitRunner['push']> | undefined> {
    const token = await this.deps.token(userId, workspaceId)
    if (token === undefined) return undefined

    return this.deps.git.pushComToken(origem, token, BRANCH_BASE, diretorio, workspaceId)
  }

  /**
   * Monta o envelope e chama o conector.
   *
   * A `idempotencyKey` é exigida de toda mutação pela governança da M6-F02 — sem ela a request é
   * recusada na validação do envelope. Um UUID por chamada é o correto aqui e não uma chave
   * derivada: a idempotência do *recurso* já é garantida pelo `ensure` do lado do GitHub, e esta
   * chave governa a retentativa da *requisição*, que é outra coisa.
   */
  private async chamar(
    operation: string,
    workspaceId: WorkspaceId,
    input: Record<string, unknown>
  ): Promise<ConnectorOutcome> {
    const userId = this.deps.userId()

    const request: ConnectorRequest = {
      contractVersion: CONNECTOR_CONTRACT_VERSION,
      connector: 'github',
      operation,
      correlationId: randomUUID(),
      idempotencyKey: randomUUID(),
      timeoutMs: 30_000,
      // A **referência** da credencial, nunca o valor: quem abre o cofre é o `ConnectorService`,
      // e é isso que mantém o token fora deste serviço e de qualquer log dele.
      credential: { key: 'github', user_id: userId, workspace_id: workspaceId },
      input
    }

    return await this.deps.connectors.call(request, { userId, workspace: workspaceId })
  }

  /** O bloqueio de uma falha do conector, com a ação que destrava (critério 5). */
  private bloqueado(
    outcome: ConnectorOutcome,
    oQue: string,
    criados: number
  ): PublicacaoOutcome {
    const erro = outcome as unknown as {
      code?: string
      mensagem?: string
      acao?: string
    }

    return {
      reason: 'bloqueado',
      criados,
      bloqueio: {
        causa: erro.code ?? 'falha-no-conector',
        evidencia: `${oQue}: ${erro.mensagem ?? 'o GitHub não respondeu como esperado.'}`,
        tentativas: 1,
        porQueNaoSeguir: `Seguir publicaria o restante do backlog sobre um passo que não completou — o board mostraria trabalho que ninguém consegue alcançar.`,
        retomada: this.retomadaDe(erro.acao)
      }
    }
  }

  /**
   * A ação concreta para cada desfecho do conector.
   *
   * Literal por caso e não uma mensagem genérica: "algo deu errado com o GitHub" manda o usuário
   * procurar em todo lugar, e os remédios aqui são opostos entre si.
   */
  private retomadaDe(acao: string | undefined): string {
    switch (acao) {
      case 'reautenticar':
        return 'Reconecte o GitHub em Configurações → Conectores e publique de novo.'
      case 'repetir':
        return 'O serviço está instável no momento. Publique de novo em alguns minutos — o que já foi criado será reencontrado, não duplicado.'
      case 'corrigir-entrada':
        return 'Revise o nome do repositório e do dono, e publique de novo.'
      default:
        return 'Publique de novo; se persistir, verifique o acesso da GitHub App a esta conta.'
    }
  }

  /** O bloqueio de um push que não saiu, traduzido pelo mesmo vocabulário do terminal. */
  private bloqueioDoPush(push: { execucao: Parameters<typeof GitRunner.explicarFalha>[0] }): BloqueioExterno {
    const motivo = push.execucao.reason
    const naoPermitido = motivo === 'binario-fora-da-allowlist'

    return {
      causa: naoPermitido ? 'git-nao-permitido' : 'push-recusado',
      evidencia: GitRunner.explicarFalha(push.execucao),
      tentativas: 1,
      porQueNaoSeguir: naoPermitido
        ? 'Sem o `git`, os commits não chegam à origem, e as issues apontariam para um repositório vazio.'
        : 'O push foi recusado porque a origem tem commits que o local não conhece. Forçar apagaria o trabalho de quem publicou antes — os dois lados ficam preservados.',
      retomada: naoPermitido
        ? 'Permita o `git` em Terminal Controlado → comandos permitidos e publique de novo.'
        : 'Traga os commits da origem (`git pull --rebase`) e publique de novo.'
    }
  }

  /** `criado` vem do `ResultadoDeOperacao` e atravessa o conector dentro do `data`. */
  private foiCriado(outcome: ConnectorOutcome): boolean {
    return (outcome as unknown as { criado?: boolean }).criado === true
  }

  private numeroDaIssue(outcome: ConnectorOutcome): number {
    const data = (outcome as unknown as { data?: { numero?: number } }).data
    return data?.numero ?? 0
  }

  private shaConfirmado(outcome: ConnectorOutcome): string {
    const data = (outcome as unknown as { data?: { sha?: string } }).data
    return data?.sha ?? ''
  }

  /**
   * O título segue o padrão do `CONVENTION.md`: `[MVP<n>][F<n>] <título>`.
   *
   * O padrão existe para que o board seja legível sem abrir o card — quem olha vê a que MVP a fatia
   * pertence. O token da SPEC entra só na fatia, porque é ela que tem uma.
   */
  private tituloDoMvp(mvp: Mvp): string {
    return `[MVP${mvp.numero}] ${mvp.titulo}`
  }

  private tituloDaFatia(mvp: Mvp | undefined, slice: Slice): string {
    return `[MVP${mvp?.numero ?? 0}][F${String(slice.numero).padStart(2, '0')}] ${slice.titulo}`
  }

  private corpoDoMvp(mvp: Mvp): string {
    return [`${mvp.tese}`, '', 'Épico. As fatias entram como sub-issues deste card.'].join('\n')
  }

  /**
   * O corpo cita a SPEC — o vínculo que o critério 3 pede.
   *
   * O caminho do arquivo, não só o nome: é o que permite abrir a spec a partir da issue sem
   * adivinhar onde ela mora.
   */
  private corpoDaFatia(slice: Slice): string {
    return [`**SPEC:** \`${slice.specSlug}\``, '', 'Aceite: PI.'].join('\n')
  }
}
