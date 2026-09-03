/**
 * A geração do roadmap, do documento do MVP e da SPEC da primeira fatia por IA
 * (SPEC-Jornada-05).
 *
 * A pergunta que este serviço responde: **como transformar o PRD aceito e a arquitetura aprovada
 * num roadmap executável sem que o modelo proponha um grafo em que nada pode começar?**
 *
 * A ordem das guardas é a garantia inteira, e cada passo existe por um motivo distinto:
 *
 *   1. **Projeto existe?** A checagem que não custa nada vem primeiro.
 *   2. **Há PRD aceito e arquitetura?** Não ⇒ recusa. Sem as duas revisões a que se referir, a
 *      origem ancorada do critério 2 não teria o que citar — e gerar assim mesmo produziria um
 *      roadmap ligado a nada.
 *   3. **Rota autorizada?** Não ⇒ `bloqueado-sem-rota`, **antes de qualquer chamada** (§ Regras:
 *      *"rota de assinatura, bloqueio antes de rota paga e ledger, como na F02"*). Bloqueio é
 *      zero chamada e zero custo, e conferir depois já teria gasto.
 *   4. **Geração e validação.** O **validador de DAG da M8-F06 é a autoridade sobre o grafo** e
 *      não é substituído pela leitura do modelo (decisão cravada da spec): ciclo ou dependência
 *      ausente reprova **antes de gravar**, a IA recebe o erro nomeado e regenera até o limite
 *      de tentativas; esgotado, bloqueia com o diagnóstico.
 *   5. **Escreve, hasheia, persiste** — nas duas estruturas: `project_roadmap` guarda a revisão
 *      verificável com as origens e a SPEC, e `mvp`/`slice` guardam a projeção que o `STATUS.md`
 *      e o MVP-009 leem. Gravar só numa das duas quebraria ou a origem por item, ou o índice.
 *   6. **Commita o marco `roadmap-aprovado`** pelo `ProjectService`, o único gatilho de commit
 *      (M8-F01). Falha de commit **não** perde a revisão.
 *
 * **A geração não escolhe nem aprova nada.** Os MVPs nascem `proposto` e a SPEC nasce `rascunho`
 * com perguntas abertas. Quem escolhe qual MVP entra na fila é o PI, no `MVP_ENTRY` (critério 3);
 * quem aceita a SPEC é o PI, no `SLICE_ENTRY`, e só depois de responder as perguntas (critério 4).
 *
 * **Este serviço não registra aprovação.** Os dois gates continuam no `RoadmapService`, que é
 * dono de `Approval` desde a M8-F06 — duplicar o registro aqui criaria duas respostas para "o PI
 * aprovou?". O que este faz é dar objeto aos gates: a escolha do MVP e a SPEC gerada.
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import type { WorkspaceId } from '@shared/domain/entities'
import type { AiProvider } from '@shared/domain/ai'
import type { AfirmacaoDaArquitetura } from '@shared/domain/arquitetura-gerada'
import type { PrdRegistrado } from '@shared/domain/prd'
import type {
  ConteudoDoRoadmap,
  MvpGerado,
  RoadmapGeradoOutcome,
  RoadmapRegistrado,
  SpecGerada
} from '@shared/domain/roadmap-gerado'
import {
  comoRoadmap,
  mvpsElegiveis,
  responderPerguntaDaSpec,
  validarRoadmapGerado
} from '@shared/domain/roadmap-gerado'
import type { AfirmacaoParaOModelo } from '@shared/domain/roadmap-schema'
import {
  ARQUIVO_DO_ARQUIVO_HISTORICO,
  ARQUIVO_DO_STATUS,
  DIRETORIO_DAS_SPECS,
  arquivoDoMvp,
  primeiraFatiaDo,
  renderizarArquivoHistorico,
  renderizarDocumentoDoMvp,
  renderizarSpecGerada,
  renderizarStatus
} from '@shared/domain/roadmap-compositor'
import { proximaFatia } from '@shared/domain/roadmap'
import { slugificar } from '@shared/domain/projects'
import type { EstadoDasRotas, ResultadoDaRota } from '@shared/domain/rota-de-geracao'
import { escolherRota } from '@shared/domain/rota-de-geracao'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { ProjectRepository } from './project-repository'
import type { ProjectService } from './project-service'
import type { RoadmapGeradoRepository } from './roadmap-gerado-repository'
import type { EscopoDoRoadmap, RoadmapRepository } from './roadmap-repository'

/**
 * Quantas vezes o serviço pede correção antes de desistir.
 *
 * **Duas, e não uma como nas fatias irmãs.** A diferença tem causa: ali o validador recusa forma
 * e âncora, que o modelo acerta ou não acerta; aqui ele recusa também o **grafo**, e um ciclo é o
 * tipo de erro que um modelo desfaz quando lhe dizem exatamente quais MVPs o fecham. É o que a
 * spec chama de *"a IA recebe o erro e regenera até o limite de tentativas do orçamento"* — o
 * limite existe porque cada tentativa é uma chamada paga, e um modelo que erra três vezes
 * seguidas não erra por acaso.
 */
export const TENTATIVAS_DE_CORRECAO_DO_ROADMAP = 2

/** A rota concreta de cada decisão. `claude-code` é a rota de assinatura do produto. */
const PROVIDER_DA_ROTA: Readonly<Record<'assinatura' | 'paga', AiProvider>> = {
  assinatura: 'claude-code',
  paga: 'anthropic'
}

export interface RoadmapGeradoServiceDeps {
  readonly repository: RoadmapGeradoRepository
  /** O repositório da M8-F06: a projeção `mvp`/`slice` que o `STATUS.md` e os gates leem. */
  readonly projecao: RoadmapRepository
  readonly projects: ProjectRepository
  readonly projectService: ProjectService
  readonly audit: AuditRepository
  readonly userId: () => string
  /**
   * O PRD **gerado e vigente** do projeto, ou `undefined` enquanto nenhum saiu.
   *
   * Injetado, e não lido do `PrdRepository` aqui, porque quem sabe qual revisão vale é o
   * `PrdService` — duplicar essa leitura criaria uma segunda resposta para a mesma pergunta.
   */
  readonly prdVigente: (projectId: string) => PrdRegistrado | undefined
  /** A revisão do PRD que o roadmap cita, em `pacote_estrutural`. Ver `ArquiteturaServiceDeps`. */
  readonly pacoteEstruturalId: (projectId: string) => string | undefined
  /** A arquitetura vigente: as afirmações que a origem `arquitetura` pode citar. */
  readonly arquiteturaVigente: (projectId: string) =>
    | {
        readonly id: string
        readonly afirmacoes: readonly AfirmacaoDaArquitetura[]
      }
    | undefined
  /** Monta o `ContextPack`; `undefined` quando a montagem falha. Ver `PrdServiceDeps`. */
  readonly montarContexto: (
    projectId: string,
    workspace: WorkspaceId,
    rota: AiProvider
  ) => string | undefined
  readonly estadoDasRotas: (
    projectId: string,
    workspace: WorkspaceId
  ) => EstadoDasRotas | Promise<EstadoDasRotas>
  /** Gera os MVPs. Recebe a rota **decidida**, nunca a escolhe. */
  readonly gerarMvps: (entrada: {
    readonly projectId: string
    readonly workspace: WorkspaceId
    readonly rota: AiProvider
    readonly contextPackId: string
    readonly requisitos: readonly AfirmacaoParaOModelo[]
    readonly arquitetura: readonly AfirmacaoParaOModelo[]
    readonly congelados: readonly { readonly id: string; readonly titulo: string }[]
    readonly correcao?: readonly string[]
  }) => Promise<{ readonly mvps?: readonly MvpGerado[] }>
  /**
   * Gera a SPEC da primeira fatia do MVP escolhido (§ 5).
   *
   * Chamada só depois do `MVP_ENTRY`: antes dele não há MVP escolhido, e especificar a fatia de
   * um MVP que talvez não entre na fila gastaria uma chamada num documento que ninguém leria.
   */
  readonly gerarSpec: (entrada: {
    readonly projectId: string
    readonly workspace: WorkspaceId
    readonly rota: AiProvider
    readonly contextPackId: string
    readonly mvp: MvpGerado
    readonly fatiaId: string
    readonly requisitos: readonly AfirmacaoParaOModelo[]
    readonly arquitetura: readonly AfirmacaoParaOModelo[]
    readonly correcao?: readonly string[]
  }) => Promise<{ readonly spec?: SpecGerada }>
}

/**
 * O hash canônico da revisão: os MVPs **e** a SPEC.
 *
 * Ordenado por id antes de serializar: a ordem em que o modelo listou os MVPs não é fato sobre o
 * conteúdo, e sem ordenar duas gerações idênticas produziriam hashes diferentes — o `hash` UNIQUE
 * deixaria de reconhecer "nada mudou", e o PI receberia um pedido de aceite por uma regeneração
 * que não mudou nada.
 *
 * A SPEC entra porque responder uma pergunta aberta **é** mudança da revisão: o `SLICE_ENTRY`
 * aprova a SPEC com as respostas, e um hash cego a elas aprovaria um documento diferente do lido.
 */
export function hashDoRoadmapGerado(
  mvps: readonly MvpGerado[],
  spec: SpecGerada | undefined
): string {
  const canonico = JSON.stringify({
    mvps: [...mvps].sort((a, b) => a.id.localeCompare(b.id)),
    spec: spec ?? null
  })

  return createHash('sha256').update(canonico, 'utf8').digest('hex')
}

export class RoadmapGeradoService {
  private readonly repository: RoadmapGeradoRepository
  private readonly projecao: RoadmapRepository
  private readonly projects: ProjectRepository
  private readonly projectService: ProjectService
  private readonly audit: AuditRepository
  private readonly userId: () => string
  private readonly deps: RoadmapGeradoServiceDeps

  constructor(deps: RoadmapGeradoServiceDeps) {
    this.repository = deps.repository
    this.projecao = deps.projecao
    this.projects = deps.projects
    this.projectService = deps.projectService
    this.audit = deps.audit
    this.userId = deps.userId
    this.deps = deps
  }

  /** A revisão vigente, ou `undefined` enquanto nenhuma foi gerada. */
  carregar(projectId: string): RoadmapRegistrado | undefined {
    return this.repository.vigente(this.userId(), projectId)
  }

  /**
   * Os MVPs que o PI pode escolher no `MVP_ENTRY` (critério 3).
   *
   * Existe como consulta própria porque a tela precisa dela **antes** do gate: oferecer a lista
   * inteira e recusar depois faria o PI escolher um MVP bloqueado para descobrir que não podia.
   */
  elegiveis(projectId: string): readonly MvpGerado[] {
    const atual = this.repository.vigente(this.userId(), projectId)
    if (atual === undefined) return []

    // Nenhum MVP está concluído nesta etapa da jornada: o projeto gerado ainda não construiu
    // nada. A lista de concluídos existe no domínio para quando o MVP-009 fechar o primeiro.
    return mvpsElegiveis(atual.mvps)
  }

  /**
   * A rota que seria usada agora — sem gerar nada. Existe para a tela mostrar o bloqueio
   * **antes** do clique, mesma razão de `PrdService.rotaAtual`.
   */
  async rotaAtual(projectId: string, workspaceId: WorkspaceId): Promise<ResultadoDaRota> {
    return escolherRota(await this.deps.estadoDasRotas(projectId, workspaceId))
  }

  /**
   * Gera o roadmap a partir do PRD aceito e da arquitetura aprovada.
   *
   * A ordem das guardas é a garantia — ver o cabeçalho do arquivo.
   */
  async gerar(projectId: string, workspaceId: WorkspaceId): Promise<RoadmapGeradoOutcome> {
    const userId = this.userId()

    const projeto = this.projects.findById(userId, projectId)
    if (projeto === undefined) {
      return { resultado: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
    }

    // (2) As duas revisões que o roadmap assume. Sem elas a origem ancorada não tem o que citar.
    const base = this.base(projectId)
    if (base === undefined) {
      return {
        resultado: 'pacote-ausente',
        mensagem:
          'Gere e aceite o PRD e a arquitetura antes do roadmap: ele cita as revisões que assume.'
      }
    }

    const preparo = await this.prepararChamada(projectId, workspaceId)
    if ('recusa' in preparo) return preparo.recusa

    const { provider, contextPackId, rota } = preparo

    /*
     * O critério 6 na forma de entrada: o MVP já escolhido é **congelado**, não recasado
     * (decisão do PI de 2026-09-03). Ele entra no pedido como decidido, e a gravação o preserva
     * — identidade que não depende de o modelo repetir o mesmo título.
     */
    const congelados = this.congelados(projectId)

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'roadmap-generation',
      payload: {
        projectId,
        fase: 'inicio',
        rota: rota.decisao,
        provider,
        contextPackId,
        requisitos: base.requisitos.length,
        arquitetura: base.arquitetura.length,
        congelados: congelados.length
      }
    })

    let problemas: readonly string[] = []

    // (4) O laço de correção: o validador de DAG nomeia o ciclo, e o modelo desfaz.
    for (let tentativa = 0; tentativa <= TENTATIVAS_DE_CORRECAO_DO_ROADMAP; tentativa += 1) {
      const resposta = await this.deps.gerarMvps({
        projectId,
        workspace: workspaceId,
        rota: provider,
        contextPackId,
        requisitos: base.requisitos,
        arquitetura: base.arquitetura,
        congelados,
        ...(problemas.length > 0 ? { correcao: problemas } : {})
      })

      if (resposta.mvps === undefined) {
        problemas = ['A chamada ao modelo não devolveu saída.']
        continue
      }

      const mvps = this.preservarCongelados(resposta.mvps, projectId)
      const candidato: ConteudoDoRoadmap = { projectId, mvps }

      const validacao = validarRoadmapGerado(candidato, {
        afirmacoesDoPrd: base.requisitos.map((r) => r.id),
        afirmacoesDaArquitetura: base.arquitetura.map((a) => a.id)
      })

      if (!validacao.valido) {
        problemas = validacao.problemas.map((p) => p.mensagem)

        this.audit.append({
          user_id: userId,
          workspace_id: workspaceId,
          type: 'roadmap-generation',
          payload: { projectId, fase: 'saida-recusada', tentativa, problemas: problemas.length }
        })

        continue
      }

      return this.persistir(candidato, {
        projeto,
        pacoteEstruturalId: base.pacoteEstruturalId,
        arquiteturaId: base.arquiteturaId,
        // A escolha anterior sobrevive à regeneração: ela é o `MVP_ENTRY`, ato do PI.
        mvpEscolhido: this.repository.vigente(userId, projectId)?.mvpEscolhido ?? null,
        workspaceId,
        userId,
        contextPackId,
        rota: rota.decisao,
        commitarMarco: true
      })
    }

    // Esgotou as tentativas. Bloqueia com o diagnóstico, em vez de gravar o que o validador
    // recusou — gravar um DAG com ciclo é exatamente o que o critério 1 impede.
    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'roadmap-generation',
      payload: { projectId, fase: 'desistiu', problemas: problemas.length }
    })

    log.agent.error('Roadmap do modelo recusado depois das correções', { projectId, problemas })

    return {
      resultado: 'saida-invalida',
      mensagem:
        'O roadmap proposto não passou no validador, nem depois das correções. Nada foi gravado.',
      problemas
    }
  }

  /**
   * Registra a escolha do MVP no `MVP_ENTRY` e gera a SPEC da primeira fatia dele (§ 4 e § 5).
   *
   * **Escolher e aprovar continuam separados.** Este método grava *qual* MVP o PI escolheu e
   * produz o objeto que o gate vai aprovar; o `Approval` em si é registrado pelo
   * `RoadmapService`, que é dono dele desde a M8-F06. Um método que fizesse os dois faria a
   * escolha aprovar a si mesma.
   *
   * **Só MVP elegível é aceito** (critério 3): dependência pendente significa trabalho que não
   * pode começar, e deixá-lo entrar na fila colocaria o projeto gerado a construir na ordem
   * errada.
   */
  async escolherMvp(
    projectId: string,
    mvpId: string,
    workspaceId: WorkspaceId
  ): Promise<RoadmapGeradoOutcome> {
    const userId = this.userId()

    const projeto = this.projects.findById(userId, projectId)
    if (projeto === undefined) {
      return { resultado: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
    }

    const atual = this.repository.vigente(userId, projectId)
    if (atual === undefined) {
      return {
        resultado: 'pacote-ausente',
        mensagem: 'Gere o roadmap antes de escolher o MVP que entra na fila.'
      }
    }

    const escolhido = mvpsElegiveis(atual.mvps).find((m) => m.id === mvpId)
    if (escolhido === undefined) {
      return {
        resultado: 'mvp-inelegivel',
        mensagem:
          'Este MVP não está entre os elegíveis: ele depende de outro que ainda não foi entregue.'
      }
    }

    const fatia = primeiraFatiaDo(escolhido)
    if (fatia === undefined) {
      // O validador recusa MVP sem fatia, então isto não acontece por saída de modelo. Recusar
      // mesmo assim é o que impede uma linha antiga do banco de produzir um `SLICE_ENTRY` sem
      // objeto.
      return {
        resultado: 'saida-invalida',
        mensagem: 'O MVP escolhido não prevê nenhuma fatia; não há o que especificar.'
      }
    }

    const base = this.base(projectId)
    if (base === undefined) {
      return {
        resultado: 'pacote-ausente',
        mensagem: 'O PRD ou a arquitetura desapareceram desde a geração do roadmap.'
      }
    }

    const preparo = await this.prepararChamada(projectId, workspaceId)
    if ('recusa' in preparo) return preparo.recusa

    const { provider, contextPackId, rota } = preparo

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'roadmap-generation',
      payload: {
        projectId,
        fase: 'mvp-escolhido',
        rota: rota.decisao,
        provider,
        contextPackId,
        mvp: mvpId,
        fatia: fatia.id
      }
    })

    let problemas: readonly string[] = []

    for (let tentativa = 0; tentativa <= TENTATIVAS_DE_CORRECAO_DO_ROADMAP; tentativa += 1) {
      const resposta = await this.deps.gerarSpec({
        projectId,
        workspace: workspaceId,
        rota: provider,
        contextPackId,
        mvp: escolhido,
        fatiaId: fatia.id,
        requisitos: base.requisitos,
        arquitetura: base.arquitetura,
        ...(problemas.length > 0 ? { correcao: problemas } : {})
      })

      if (resposta.spec === undefined) {
        problemas = ['A chamada ao modelo não devolveu a especificação.']
        continue
      }

      const candidato: ConteudoDoRoadmap = {
        projectId,
        mvps: atual.mvps,
        spec: resposta.spec
      }

      const validacao = validarRoadmapGerado(candidato, {
        afirmacoesDoPrd: base.requisitos.map((r) => r.id),
        afirmacoesDaArquitetura: base.arquitetura.map((a) => a.id)
      })

      if (!validacao.valido) {
        problemas = validacao.problemas.map((p) => p.mensagem)

        this.audit.append({
          user_id: userId,
          workspace_id: workspaceId,
          type: 'roadmap-generation',
          payload: { projectId, fase: 'spec-recusada', tentativa, problemas: problemas.length }
        })

        continue
      }

      return this.persistir(candidato, {
        projeto,
        pacoteEstruturalId: atual.pacoteEstruturalId,
        arquiteturaId: atual.arquiteturaId,
        mvpEscolhido: mvpId,
        workspaceId,
        userId,
        contextPackId,
        rota: rota.decisao,
        commitarMarco: true
      })
    }

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'roadmap-generation',
      payload: { projectId, fase: 'spec-desistiu', problemas: problemas.length }
    })

    return {
      resultado: 'saida-invalida',
      mensagem: 'A especificação gerada não passou no validador, nem depois das correções.',
      problemas
    }
  }

  /**
   * Registra a resposta do PI a uma pergunta aberta da SPEC (critério 4).
   *
   * **Grava revisão nova, não edita a atual.** Mesma disciplina do corte de `proposto` no PRD e
   * na arquitetura: a revisão que o PI leu continua no banco, e o hash continua descrevendo o
   * que ele leu — sem isso, o aceite por revisão exata deixaria de significar algo.
   *
   * **Não commita marco.** Responder uma pergunta é um passo dentro da etapa, não um marco: um
   * commit por resposta encheria o histórico de revisões que o PI nem terminou de responder.
   */
  responderPergunta(
    projectId: string,
    perguntaId: string,
    resposta: string,
    workspaceId: WorkspaceId
  ): RoadmapGeradoOutcome {
    const userId = this.userId()

    const projeto = this.projects.findById(userId, projectId)
    if (projeto === undefined) {
      return { resultado: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
    }

    const atual = this.repository.vigente(userId, projectId)
    if (atual === undefined || atual.spec === undefined) {
      return {
        resultado: 'mvp-nao-escolhido',
        mensagem: 'Escolha o MVP que entra na fila: a especificação da fatia nasce com ele.'
      }
    }

    const conteudo: ConteudoDoRoadmap = {
      projectId,
      mvps: atual.mvps,
      spec: atual.spec
    }

    const mudado = responderPerguntaDaSpec(conteudo, perguntaId, resposta)

    // Pergunta desconhecida ou resposta igual à anterior: nada mudou, e gravar revisão nova
    // pediria um aceite por um clique que não mudou o documento.
    if (hashDoRoadmapGerado(mudado.mvps, mudado.spec) === atual.hash) {
      return { resultado: 'gerado', roadmap: atual, mensagem: 'Nada mudou nesta revisão.' }
    }

    return this.persistir(mudado, {
      projeto,
      pacoteEstruturalId: atual.pacoteEstruturalId,
      arquiteturaId: atual.arquiteturaId,
      mvpEscolhido: atual.mvpEscolhido,
      workspaceId,
      userId,
      contextPackId: atual.contextPackId,
      rota: 'revisao',
      commitarMarco: false
    })
  }

  /**
   * As duas revisões que o roadmap assume, já no formato do pedido ao modelo.
   *
   * Uma leitura só, usada pela geração e pela SPEC: sem ela, os dois métodos montariam a mesma
   * lista de ids por conta própria e divergiriam no dia em que uma das cópias mudasse.
   */
  private base(projectId: string):
    | {
        readonly requisitos: readonly AfirmacaoParaOModelo[]
        readonly arquitetura: readonly AfirmacaoParaOModelo[]
        readonly pacoteEstruturalId: string
        readonly arquiteturaId: string
      }
    | undefined {
    const prd = this.deps.prdVigente(projectId)
    const pacoteEstruturalId = this.deps.pacoteEstruturalId(projectId)
    const arquitetura = this.deps.arquiteturaVigente(projectId)

    if (prd === undefined || pacoteEstruturalId === undefined || arquitetura === undefined) {
      return undefined
    }

    return {
      requisitos: prd.afirmacoes.map((a) => ({ id: a.id, secao: a.secao, texto: a.texto })),
      arquitetura: arquitetura.afirmacoes.map((a) => ({
        id: a.id,
        // O documento entra na seção porque o modelo precisa saber se a afirmação veio da
        // arquitetura, das decisões, dos testes ou da revisão: quatro documentos com seções de
        // mesmo nome ficariam indistinguíveis num rótulo só.
        secao: `${a.documento} § ${a.secao}`,
        texto: a.texto
      })),
      pacoteEstruturalId,
      arquiteturaId: arquitetura.id
    }
  }

  /**
   * A rota e o contexto — as duas barreiras que toda geração desta fatia atravessa.
   *
   * Extraída porque `gerar` e `escolherMvp` as atravessam iguais: duplicá-las deixaria as duas
   * divergirem no dia em que uma das cópias mudasse, e uma delas passaria a chamar o modelo sem
   * conferir a rota — que é o que o § Regras proíbe.
   */
  private async prepararChamada(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<
    | {
        readonly provider: AiProvider
        readonly contextPackId: string
        readonly rota: ResultadoDaRota
      }
    | { readonly recusa: RoadmapGeradoOutcome }
  > {
    const userId = this.userId()
    const rota = escolherRota(await this.deps.estadoDasRotas(projectId, workspaceId))

    if (rota.decisao === 'bloqueado') {
      // Auditado **antes** de qualquer chamada: o bloqueio é um fato registrado, não a ausência
      // de um.
      this.audit.append({
        user_id: userId,
        workspace_id: workspaceId,
        type: 'roadmap-generation',
        payload: { projectId, fase: 'bloqueado', motivo: rota.motivo }
      })

      log.agent.warn('Geração do roadmap bloqueada por falta de rota', {
        projectId,
        motivo: rota.motivo
      })

      return {
        recusa: {
          resultado: 'bloqueado-sem-rota',
          mensagem: 'A geração não aconteceu: nenhuma rota autorizada está disponível.',
          ...(rota.acao === undefined ? {} : { acao: rota.acao })
        }
      }
    }

    const provider = PROVIDER_DA_ROTA[rota.decisao]
    const contextPackId = this.deps.montarContexto(projectId, workspaceId, provider)

    if (contextPackId === undefined) {
      this.audit.append({
        user_id: userId,
        workspace_id: workspaceId,
        type: 'roadmap-generation',
        payload: { projectId, fase: 'sem-contexto' }
      })

      return {
        recusa: {
          resultado: 'sem-contexto',
          mensagem: 'O contexto do projeto não pôde ser montado; salve o prompt de novo e tente.'
        }
      }
    }

    return { provider, contextPackId, rota }
  }

  /** O MVP escolhido e seu título, para o pedido apresentá-lo como decidido (critério 6). */
  private congelados(
    projectId: string
  ): readonly { readonly id: string; readonly titulo: string }[] {
    const atual = this.repository.vigente(this.userId(), projectId)
    if (atual === null || atual === undefined || atual.mvpEscolhido === null) return []

    const escolhido = atual.mvps.find((m) => m.id === atual.mvpEscolhido)
    return escolhido === undefined ? [] : [{ id: escolhido.id, titulo: escolhido.titulo }]
  }

  /**
   * Substitui o MVP congelado pela versão aceita, caso o modelo o tenha reescrito.
   *
   * **É o critério 6 na gravação, e não só no pedido.** O prompt pede que o MVP aceito seja
   * repetido, mas pedir não é garantir: um modelo que reescreve a tese do MVP já aprovado
   * mudaria o que o PI aceitou, e o gate `MVP_ENTRY` passaria a descrever outro conteúdo. Um MVP
   * congelado que sumisse da saída é reinserido — as dependências dos outros apontam para ele, e
   * removê-lo faria o DAG perder um nó que o restante ainda cita.
   */
  private preservarCongelados(
    gerados: readonly MvpGerado[],
    projectId: string
  ): readonly MvpGerado[] {
    const atual = this.repository.vigente(this.userId(), projectId)
    if (atual === undefined || atual.mvpEscolhido === null) return gerados

    const aceito = atual.mvps.find((m) => m.id === atual.mvpEscolhido)
    if (aceito === undefined) return gerados

    const substituidos = gerados.map((m) => (m.id === aceito.id ? aceito : m))

    return substituidos.some((m) => m.id === aceito.id) ? substituidos : [aceito, ...substituidos]
  }

  /**
   * (5) e (6): renderiza, escreve, persiste nas duas estruturas e commita o marco.
   *
   * **As duas estruturas gravam a mesma revisão.** `project_roadmap` guarda os MVPs com as três
   * origens e a SPEC com as perguntas — é o que a tela lê e o validador protege. `mvp`/`slice`
   * guardam a projeção que o `STATUS.md` renderiza e que o gate `SLICE_ENTRY` consulta, porque é
   * de lá que o MVP-009 lê o par Fatia ↔ SPEC (critério 7). Gravar só numa das duas quebraria ou
   * a origem por item, ou o índice.
   */
  private persistir(
    conteudo: ConteudoDoRoadmap,
    contexto: {
      readonly projeto: { readonly nome: string; readonly diretorio: string }
      readonly pacoteEstruturalId: string
      readonly arquiteturaId: string
      readonly mvpEscolhido: string | null
      readonly workspaceId: WorkspaceId
      readonly userId: string
      readonly contextPackId: string | null
      readonly rota: string
      /**
       * Commitar o marco `roadmap-aprovado`? **Não ao responder pergunta.**
       *
       * Responder uma pergunta aberta grava revisão nova e reescreve a SPEC no disco — o arquivo
       * tem de acompanhar a revisão vigente —, mas não é um marco: commitar a cada resposta
       * encheria o histórico de revisões intermediárias.
       */
      readonly commitarMarco: boolean
    }
  ): RoadmapGeradoOutcome {
    const { projeto, workspaceId, userId } = contexto

    const escopo: EscopoDoRoadmap = { userId, workspaceId, projectId: conteudo.projectId }

    // A projeção primeiro: é dela que sai a `proximaFatia` que o `STATUS.md` aponta, e montá-la
    // aqui evita que o render e a gravação discordem sobre qual fatia está detalhada.
    const projecao = this.projecao.salvarRoadmap(escopo, comoRoadmap(conteudo, DIRETORIO_DAS_SPECS))

    /*
     * A fatia que ganhou SPEC é a **detalhada**, não a `proximaFatia`.
     *
     * As duas respondem perguntas opostas: `proximaFatia` devolve a primeira ainda *não*
     * detalhada — é o que o `STATUS.md` aponta como próximo trabalho —, e a SPEC desta revisão
     * pertence justamente à que já foi detalhada. Usar `proximaFatia` para escrever a SPEC
     * gravaria o texto no caminho da fatia seguinte, e o índice apontaria para um arquivo que
     * fala de outra coisa. Foi o que o teste de integração pegou.
     */
    const detalhada =
      conteudo.spec === undefined
        ? undefined
        : projecao.slices.find((s) => s.id === conteudo.spec?.fatiaId)

    const proxima = proximaFatia(projecao)

    const escrita = this.escrever(
      projeto.diretorio,
      projeto.nome,
      conteudo,
      projecao,
      proxima,
      detalhada
    )
    if (!escrita.ok) {
      return { resultado: 'falha-de-escrita', mensagem: escrita.mensagem }
    }

    const hash = hashDoRoadmapGerado(conteudo.mvps, conteudo.spec)

    // Mesmo conteúdo é a mesma revisão: devolve a existente em vez de estourar no UNIQUE, e
    // regenerar sem mudança não pede novo aceite.
    const jaExiste = this.repository.findByHash(userId, hash)
    if (jaExiste !== undefined) {
      /*
       * A escolha do PI **não** entra no hash, e por isso a revisão reencontrada pode ser
       * anterior ao `MVP_ENTRY`: regerar depois da escolha, com o mesmo conteúdo, cairia aqui e
       * devolveria uma revisão que diz que ninguém escolheu nada — o critério 6 quebrado por um
       * caminho que parece só uma otimização.
       *
       * A escolha fica fora do hash de propósito: ela não muda o *documento*, e incluí-la faria
       * o gate `MVP_ENTRY` pedir novo aceite por um ato que é o próprio aceite. O conserto é
       * carimbar a escolha na linha existente, que é a única escrita posterior que o repositório
       * admite. Foi o que o teste de integração pegou.
       */
      if (contexto.mvpEscolhido !== null && jaExiste.mvpEscolhido === null) {
        this.repository.escolherMvp(userId, jaExiste.id, contexto.mvpEscolhido)
        this.projecao.promover(escopo, contexto.mvpEscolhido)
      }

      return {
        resultado: 'gerado',
        roadmap: this.repository.vigente(userId, conteudo.projectId) ?? jaExiste,
        mensagem: 'O roadmap gerado é idêntico ao anterior; a revisão foi preservada.'
      }
    }

    const registrada = this.repository.registrar({
      id: randomUUID(),
      user_id: userId,
      workspace_id: workspaceId,
      projectId: conteudo.projectId,
      pacoteEstruturalId: contexto.pacoteEstruturalId,
      arquiteturaId: contexto.arquiteturaId,
      mvps: conteudo.mvps,
      ...(conteudo.spec === undefined ? {} : { spec: conteudo.spec }),
      mvpEscolhido: contexto.mvpEscolhido,
      hash,
      commitHash: null,
      contextPackId: contexto.contextPackId,
      created_at: new Date().toISOString()
    })

    // A promoção na projeção acompanha a escolha: é o `MVP_ENTRY` do domínio antigo, e sem ela o
    // `STATUS.md` mostraria como `proposto` o MVP que o PI já colocou na fila.
    if (contexto.mvpEscolhido !== null) {
      this.projecao.promover(escopo, contexto.mvpEscolhido)
    }

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'roadmap-generation',
      payload: {
        projectId: conteudo.projectId,
        fase: 'gerado',
        rota: contexto.rota,
        hash,
        pacoteEstruturalId: contexto.pacoteEstruturalId,
        arquiteturaId: contexto.arquiteturaId,
        mvps: conteudo.mvps.length,
        comSpec: conteudo.spec !== undefined,
        mvpEscolhido: contexto.mvpEscolhido
      }
    })

    // (6) O marco vira commit pelo caminho único da M8-F01. Falha aqui **não** perde a revisão:
    // ela já está no banco e no disco, e a retomada é gerar de novo.
    const marco = contexto.commitarMarco
      ? this.projectService.concluirMarco(conteudo.projectId, 'roadmap-aprovado', workspaceId)
      : undefined

    if (marco?.commitado === true && marco.commitHash !== undefined) {
      this.repository.marcarCommit(userId, registrada.id, marco.commitHash)
    }

    log.agent.info('Roadmap gerado', {
      projectId: conteudo.projectId,
      mvps: conteudo.mvps.length,
      commitado: marco?.commitado === true
    })

    return {
      resultado: 'gerado',
      roadmap: { ...registrada, commitHash: marco?.commitHash ?? null },
      mensagem: mensagemDoDesfecho(contexto.commitarMarco, marco?.commitado === true)
    }
  }

  /**
   * Escreve o `STATUS.md`, o histórico, os documentos dos MVPs e a SPEC da fatia detalhada.
   *
   * Os caminhos do STATUS e do histórico são **constantes**; os dos MVPs e da SPEC são derivados
   * de `slugificar`, que já remove separadores de caminho — mas a barreira de contenção
   * permanece: derivado hoje não é constante para sempre.
   */
  private escrever(
    diretorio: string,
    nomeDoProjeto: string,
    conteudo: ConteudoDoRoadmap,
    projecao: ReturnType<RoadmapRepository['carregar']>,
    proxima: ReturnType<typeof proximaFatia>,
    /** A fatia que ganhou SPEC nesta revisão — a detalhada, não a próxima. */
    detalhada: ReturnType<typeof proximaFatia>
  ): { readonly ok: boolean; readonly mensagem: string } {
    const raiz = resolve(diretorio)
    const hoje = new Date().toISOString().slice(0, 10)

    const titulos = conteudo.mvps.map((m) => ({ id: m.id, titulo: m.titulo }))

    const arquivos: { caminho: string; conteudo: string }[] = [
      {
        caminho: ARQUIVO_DO_STATUS,
        conteudo: renderizarStatus(nomeDoProjeto, projecao, proxima, hoje)
      },
      {
        caminho: ARQUIVO_DO_ARQUIVO_HISTORICO,
        conteudo: renderizarArquivoHistorico(nomeDoProjeto, [], hoje)
      },
      ...conteudo.mvps.map((mvp) => ({
        caminho: arquivoDoMvp(mvp, slugificar(mvp.titulo)),
        conteudo: renderizarDocumentoDoMvp(mvp, nomeDoProjeto, titulos, hoje)
      }))
    ]

    if (conteudo.spec !== undefined && detalhada !== undefined) {
      arquivos.push({
        caminho: detalhada.specSlug,
        conteudo: renderizarSpecGerada(
          conteudo.spec,
          conteudo.mvps.find((m) => m.id === detalhada.mvpId),
          hoje
        )
      })
    }

    try {
      for (const arquivo of arquivos) {
        const alvo = resolve(join(raiz, arquivo.caminho))
        if (relative(raiz, alvo).startsWith('..')) {
          return { ok: false, mensagem: 'Caminho de documento fora do projeto.' }
        }
        mkdirSync(dirname(alvo), { recursive: true })
        writeFileSync(alvo, arquivo.conteudo, 'utf8')
      }

      return { ok: true, mensagem: 'Documentos escritos.' }
    } catch (causa) {
      log.agent.error('Falha ao escrever o roadmap gerado', {
        stack: causa instanceof Error ? causa.stack : undefined
      })
      return { ok: false, mensagem: 'Não foi possível escrever os documentos no projeto.' }
    }
  }
}

/**
 * A mensagem do desfecho bem-sucedido.
 *
 * Três casos, e o terceiro é a razão de a função existir: quando o marco nem foi tentado
 * (resposta a uma pergunta), dizer "o commit falhou" seria relatar uma falha que não houve — e
 * mandaria o PI procurar um problema no Git que não existe.
 */
function mensagemDoDesfecho(tentouCommitar: boolean, commitado: boolean): string {
  if (!tentouCommitar) return 'Revisão atualizada.'

  return commitado
    ? 'Roadmap gerado e commitado.'
    : 'Roadmap gerado. O commit do marco falhou e pode ser retomado.'
}
