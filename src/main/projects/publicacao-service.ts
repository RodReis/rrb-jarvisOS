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
  chaveDeProjeto,
  type AlvoDaPublicacao,
  type PublicacaoOutcome
} from '@shared/domain/publicacao'
import type { Mvp, Slice } from '@shared/domain/roadmap'
import type { ConnectorService } from '../connectors/connector-service'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import { GitRunner } from './git-runner'
import type { ProjectRepository } from './project-repository'
import type { ExternalRefRepository } from './external-ref-repository'
import type { RoadmapRepository } from './roadmap-repository'

export interface PublicacaoDeps {
  readonly projects: ProjectRepository
  readonly roadmap: RoadmapRepository
  /** Onde as referências publicadas ficam (emenda 6): a M9-F02 e a M9-F05 leem daqui. */
  readonly refs: ExternalRefRepository
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

  private get refs(): ExternalRefRepository {
    return this.deps.refs
  }

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

    // As SPECs com `SLICE_ENTRY` aprovado (emenda 3). O artefato do gate é o `specSlug` — é assim
    // que `revisoesDoGate` o registra —, então o conjunto de slugs aprovados responde diretamente
    // "esta fatia pode virar issue?".
    const aprovadas = new Set(
      this.deps.roadmap
        .listarAprovacoes(escopo)
        .filter((a) => a.gate === 'SLICE_ENTRY')
        .flatMap((a) => a.revisoes.map((r) => r.artefato))
    )

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

    this.refs.upsert(escopo, {
      alvo: 'repositorio',
      chaveExterna: chaveDeProjeto(projectId),
      refId: `${alvo.owner}/${alvo.repo}`,
      ...(this.urlDa(repo) === undefined ? {} : { url: this.urlDa(repo) as string })
    })

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

    // **Proteção recusada não bloqueia a publicação** (emenda 2 de 2026-08-30). Repositório
    // privado em conta sem plano responde 403, e barrar aqui deixaria o projeto sem repositório e
    // sem board por uma configuração que é da conta, não da entrega. A recusa vira **limitação
    // explícita** no `ExternalRef` — o critério 4 pede exatamente "confirmadas ou registradas
    // como limitação explícita" —, e a M9-F05 lê da origem quais checks são obrigatórios.
    contar(protecao)
    // Guardada agora, e o SHA entra no passo 6 — quando a origem confirma o que recebeu. Gravar
    // aqui o SHA local diria "publiquei isto" antes de saber se chegou, que é o engano que o
    // critério 2 existe para impedir.
    const limitacaoDaBranch = protecao.ok ? undefined : this.limitacaoDe(protecao)
    if (limitacaoDaBranch !== undefined) {
      log.agent.warn('Proteção de branch recusada pela origem — registrada como limitação', {
        projectId,
        limitacao: limitacaoDaBranch
      })
    }

    // 4. Os rótulos da Convention do projeto-alvo (emenda 4).
    //
    // **Vêm do projeto-alvo, nunca desta base.** Os `proplan:` daqui são a Convention deste
    // repositório, e exportá-los imporia o processo do JARVIS a um projeto que não o adotou. Sem
    // Convention que os defina, nenhum rótulo é aplicado e o estado vive só no app — que é o que a
    // emenda diz, e o que evita criar rótulo que ninguém vai usar.
    for (const rotulo of alvo.rotulos ?? []) {
      const label = await this.chamar(GITHUB_OPERATIONS.ensureLabel, workspaceId, {
        owner: alvo.owner,
        repo: alvo.repo,
        nome: rotulo.nome,
        cor: rotulo.cor,
        ...(rotulo.descricao === undefined ? {} : { descricao: rotulo.descricao })
      })
      if (!label.ok) return this.bloqueado(label, `o rótulo ${rotulo.nome}`, criados)
      contar(label)
    }

    // 5. As issues do MVP e das fatias, e as dependências entre elas.
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

      // **Só fatia com `SLICE_ENTRY` aprovado vira issue** (emenda 3 de 2026-08-30). As demais
      // ficam como checklist no corpo do épico — é a regra `card = fatia` do CONVENTION, em que
      // a issue nasce *lazy*, quando a spec é aprovada, nunca antes. Publicar todas de uma vez
      // criaria board de trabalho autorizado que ninguém autorizou.
      if (!aprovadas.has(slice.specSlug)) continue

      const mvp = naFila.find((m) => m.id === slice.mvpId)
      const issue = await this.chamar(GITHUB_OPERATIONS.ensureIssue, workspaceId, {
        owner: alvo.owner,
        repo: alvo.repo,
        externalKey: chaveDeFatia(projectId, mvp?.numero ?? 0, slice.numero),
        title: this.tituloDaFatia(mvp, slice),
        body: this.corpoDaFatia(slice, pai)
      })
      if (!issue.ok) return this.bloqueado(issue, `a issue da fatia ${slice.numero}`, criados)
      contar(issue)

      const numero = this.numeroDaIssue(issue)
      this.refs.upsert(escopo, {
        alvo: 'issue',
        chaveExterna: chaveDeFatia(projectId, mvp?.numero ?? 0, slice.numero),
        refId: String(numero),
        ...(this.urlDa(issue) === undefined ? {} : { url: this.urlDa(issue) as string })
      })

      const vinculo = await this.chamar(GITHUB_OPERATIONS.ensureIssueDependency, workspaceId, {
        owner: alvo.owner,
        repo: alvo.repo,
        parentIssue: pai,
        childIssue: numero
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

    // A ref da branch nasce **aqui**, com o SHA que a origem confirmou (emenda 6). Gravá-la antes,
    // com o SHA local, diria "publiquei isto" antes de saber se chegou — o engano que o critério 2
    // existe para impedir. A limitação da proteção viaja junto: é do mesmo recurso.
    this.refs.upsert(escopo, {
      alvo: 'branch',
      chaveExterna: chaveDeProjeto(projectId),
      refId: BRANCH_BASE,
      sha: commitPublicado,
      ...(limitacaoDaBranch === undefined ? {} : { limitacao: limitacaoDaBranch })
    })

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
  private bloqueado(outcome: ConnectorOutcome, oQue: string, criados: number): PublicacaoOutcome {
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
  private bloqueioDoPush(push: {
    execucao: Parameters<typeof GitRunner.explicarFalha>[0]
  }): BloqueioExterno {
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

  /** A URL do recurso, quando o conector a devolveu no `externalRef`. */
  private urlDa(outcome: ConnectorOutcome): string | undefined {
    return (outcome as unknown as { externalRef?: { url?: string } }).externalRef?.url
  }

  /**
   * A limitação legível de um passo que a origem recusou (emenda 2).
   *
   * Guarda o código **e** a mensagem: o código é o que a M9-F05 compara, a mensagem é o que uma
   * pessoa lê para saber que a conta precisa de plano. Só um dos dois deixaria metade da pergunta
   * sem resposta.
   */
  private limitacaoDe(outcome: ConnectorOutcome): string {
    const erro = outcome as unknown as { code?: string; mensagem?: string }
    return `${erro.code ?? 'recusado'}: ${erro.mensagem ?? 'a origem recusou a configuração.'}`
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
  private corpoDaFatia(slice: Slice, epico: number): string {
    // `Bloqueada por: #N` é a forma que este repositório já usa (emenda 5), e existe porque o
    // GitHub **não tem dependência nativa** entre issues: o `ensureIssueDependency` liga a fatia ao
    // épico como sub-issue, mas não expressa "esta espera aquela". A linha no corpo é legível por
    // quem abre a issue; o fato de referência vive no `ExternalRef`, não neste texto.
    return [
      `**SPEC:** \`${slice.specSlug}\``,
      '',
      `Bloqueada por: #${epico}`,
      '',
      'Aceite: PI.'
    ].join('\n')
  }
}
