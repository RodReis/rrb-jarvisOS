/**
 * O refinamento por perguntas geradas (SPEC-Jornada-02, § Refinamento).
 *
 * A pergunta que este serviço responde: **o que ainda falta saber sobre o projeto, e como
 * perguntar isso uma decisão por vez?**
 *
 * **A mecânica de responder é a da M8-F03, reaproveitada inteira.** Contradição, delegação,
 * retomada e substituição já existem como funções puras em `wizard.ts`, e nenhuma delas depende
 * de o catálogo ser estático — elas recebem `Pergunta[]`. O que muda aqui é só **de onde o
 * catálogo vem**: lá é código versionado; aqui é gerado por projeto, a partir do prompt daquele
 * projeto, e persistido assim que sai do modelo.
 *
 * Três garantias, e as três são sobre o que **não** acontece:
 *
 *  - **Pergunta que fere o contrato não chega ao PI.** `validarPerguntaGerada` roda sobre cada
 *    pergunta antes de persistir; a recusada é auditada, não engolida. Com catálogo estático o
 *    CI barrava isso; com texto gerado, só o runtime pode.
 *  - **Nada é gerado sem rota autorizada.** Mesma ordem de guardas do `BriefService`: a rota
 *    vem antes do contexto, que vem antes da chamada.
 *  - **Retomar não regera.** As perguntas ficam no banco; reabrir o projeto lê as pendentes em
 *    vez de pedir outras ao modelo. Regerar só acrescenta o que falta.
 */

import { randomUUID } from 'node:crypto'
import type { WorkspaceId } from '@shared/domain/entities'
import type { AiProvider } from '@shared/domain/ai'
import type { BlocoDoBrief } from '@shared/domain/brief'
import { BLOCOS_DO_BRIEF, BLOCOS_PRE_PREENCHIDOS } from '@shared/domain/brief'
import type { DecisaoDoRefinamento, PerguntaBruta } from '@shared/domain/brief-schema'
import type { GeracaoDePerguntasOutcome } from '@shared/domain/refinamento'
import type { PerguntaGerada } from '@shared/domain/pergunta-gerada'
import { separarPerguntasValidas } from '@shared/domain/pergunta-gerada'
import type { EstadoDasRotas, ResultadoDaRota } from '@shared/domain/rota-de-geracao'
import { PROVIDER_DA_ROTA, escolherRota } from '@shared/domain/rota-de-geracao'
import type { Decision, EstadoDoWizard, Resposta, RespostaOutcome } from '@shared/domain/wizard'
import {
  decidirPorMim,
  decisoesVigentes,
  detectarContradicoes,
  estadoDoWizard
} from '@shared/domain/wizard'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { DecisionRepository } from './decision-repository'
import type { PerguntaGeradaRepository } from './pergunta-gerada-repository'
import type { ProjectRepository } from './project-repository'

export interface RefinamentoServiceDeps {
  readonly perguntas: PerguntaGeradaRepository
  readonly decisions: DecisionRepository
  readonly projects: ProjectRepository
  readonly audit: AuditRepository
  readonly userId: () => string
  /** O texto do prompt vigente, ou `undefined` quando ainda não há prompt. */
  readonly promptVigente: (projectId: string) => string | undefined
  readonly estadoDasRotas: (
    projectId: string,
    workspace: WorkspaceId
  ) => EstadoDasRotas | Promise<EstadoDasRotas>
  readonly montarContexto: (
    projectId: string,
    workspace: WorkspaceId,
    rota: AiProvider
  ) => string | undefined
  /** Gera as perguntas pelo ponto único. Recebe a rota decidida, nunca a escolhe. */
  readonly gerar: (entrada: {
    readonly projectId: string
    readonly workspace: WorkspaceId
    readonly prompt: string
    readonly blocosEmAberto: readonly string[]
    readonly rota: AiProvider
    readonly contextPackId: string
  }) => Promise<{ readonly perguntas?: readonly PerguntaBruta[] }>
}

export class RefinamentoService {
  private readonly perguntas: PerguntaGeradaRepository
  private readonly decisions: DecisionRepository
  private readonly projects: ProjectRepository
  private readonly audit: AuditRepository
  private readonly userId: () => string
  private readonly promptVigente: RefinamentoServiceDeps['promptVigente']
  private readonly estadoDasRotas: RefinamentoServiceDeps['estadoDasRotas']
  private readonly montarContexto: RefinamentoServiceDeps['montarContexto']
  private readonly gerar: RefinamentoServiceDeps['gerar']

  constructor(deps: RefinamentoServiceDeps) {
    this.perguntas = deps.perguntas
    this.decisions = deps.decisions
    this.projects = deps.projects
    this.audit = deps.audit
    this.userId = deps.userId
    this.promptVigente = deps.promptVigente
    this.estadoDasRotas = deps.estadoDasRotas
    this.montarContexto = deps.montarContexto
    this.gerar = deps.gerar
  }

  /**
   * O estado do refinamento — pergunta pendente, conclusão ou bloqueio.
   *
   * Calculado do banco a cada chamada, como o wizard da M8-F03: uma sessão fechada no meio
   * reabre na mesma pergunta porque a resposta vem das decisões gravadas, não de estado que
   * morreu com a janela (critério 8).
   */
  estado(projectId: string): EstadoDoWizard | undefined {
    const userId = this.userId()
    if (!this.projects.findById(userId, projectId)) return undefined

    const catalogo = this.perguntas.listar(userId, projectId)
    if (catalogo.length === 0) {
      return {
        tipo: 'bloqueado',
        motivo: 'O refinamento ainda não tem perguntas.',
        retomada: 'Gere as perguntas a partir do prompt do projeto.'
      }
    }

    return estadoDoWizard(catalogo, this.decisions.listar(userId, projectId))
  }

  /** O histórico completo, com as substituídas — a trilha de quem decidiu o quê (critério 7). */
  historico(projectId: string): readonly Decision[] {
    return this.decisions.listar(this.userId(), projectId)
  }

  /** As decisões do refinamento no formato que o brief cita — id, pergunta e resposta. */
  decisoesParaOBrief(projectId: string): readonly DecisaoDoRefinamento[] {
    const userId = this.userId()
    const catalogo = this.perguntas.listar(userId, projectId)
    const vigentes = decisoesVigentes(this.decisions.listar(userId, projectId))

    return Object.values(vigentes).flatMap((decisao) => {
      const pergunta = catalogo.find((p) => p.id === decisao.perguntaId)
      if (pergunta === undefined) return []

      // A resposta legível: o rótulo da opção escolhida, ou o texto livre. O modelo precisa do
      // conteúdo, não do id da opção — `fatia-vertical` não diz nada fora do catálogo.
      const rotulo =
        decisao.escolha === null
          ? decisao.texto
          : (pergunta.opcoes.find((o) => o.id === decisao.escolha)?.rotulo ?? decisao.escolha)

      return rotulo === null
        ? []
        : [{ id: decisao.id, pergunta: pergunta.enunciado, resposta: rotulo }]
    })
  }

  /**
   * Os blocos que ainda não têm pergunta nem resposta.
   *
   * Os pré-preenchidos ficam de fora por decisão do PI (2026-09-03): identidade e política saem
   * da criação do projeto e dos defaults, e perguntar o que o app já sabe é fricção sem
   * informação nova.
   */
  private blocosEmAberto(projectId: string): readonly BlocoDoBrief[] {
    const userId = this.userId()
    const jaPerguntados = new Set(this.perguntas.listar(userId, projectId).map((p) => p.bloco))

    return BLOCOS_DO_BRIEF.filter(
      (b) => !BLOCOS_PRE_PREENCHIDOS.includes(b) && !jaPerguntados.has(b)
    )
  }

  /**
   * Gera as perguntas para os blocos que ainda faltam.
   *
   * **Regenerar não duplica**: só os blocos sem pergunta entram no pedido, e um bloco já
   * perguntado não volta. É o que faz retomar o refinamento ser barato — e o que impede o PI de
   * responder a mesma coisa duas vezes com palavras diferentes.
   */
  async gerarPerguntas(
    projectId: string,
    workspaceId: WorkspaceId
  ): Promise<GeracaoDePerguntasOutcome> {
    const userId = this.userId()

    const prompt = this.promptVigente(projectId)
    if (prompt === undefined) {
      return {
        resultado: 'sem-prompt',
        mensagem: 'Escreva o prompt do projeto antes de refinar.'
      }
    }

    const emAberto = this.blocosEmAberto(projectId)
    if (emAberto.length === 0) {
      return { resultado: 'nada-a-perguntar', mensagem: 'Todos os blocos já têm pergunta.' }
    }

    const rota = escolherRota(await this.estadoDasRotas(projectId, workspaceId))
    if (rota.decisao === 'bloqueado') {
      this.audit.append({
        user_id: userId,
        workspace_id: workspaceId,
        type: 'brief-generation',
        payload: { projectId, fase: 'perguntas-bloqueadas', motivo: rota.motivo }
      })

      return {
        resultado: 'bloqueado-sem-rota',
        mensagem: 'A geração não aconteceu: nenhuma rota autorizada está disponível.',
        ...(rota.acao === undefined ? {} : { acao: rota.acao })
      }
    }

    const provider = PROVIDER_DA_ROTA[rota.decisao]
    const contextPackId = this.montarContexto(projectId, workspaceId, provider)
    if (contextPackId === undefined) {
      return {
        resultado: 'saida-invalida',
        mensagem:
          'O prompt ainda não virou revisão no Git; salve o prompt de novo antes de refinar.'
      }
    }

    const resposta = await this.gerar({
      projectId,
      workspace: workspaceId,
      prompt,
      blocosEmAberto: emAberto,
      rota: provider,
      contextPackId
    })

    if (resposta.perguntas === undefined) {
      return {
        resultado: 'saida-invalida',
        mensagem: 'A saída do modelo não pôde ser lida. Nada foi gravado.'
      }
    }

    // O id é atribuído aqui, não pelo modelo: um id vindo do modelo poderia colidir com uma
    // pergunta já gravada, e a resposta do PI passaria a apontar para a pergunta errada.
    const candidatas: PerguntaGerada[] = resposta.perguntas.map((p) => ({
      ...p,
      id: randomUUID(),
      etapa: 'refinamento'
    }))

    const { validas, recusadas } = separarPerguntasValidas(candidatas)

    if (recusadas.length > 0) {
      // Auditada, não engolida: uma recusa silenciosa faria o refinamento pular um bloco sem
      // ninguém saber por quê.
      this.audit.append({
        user_id: userId,
        workspace_id: workspaceId,
        type: 'brief-generation',
        payload: {
          projectId,
          fase: 'perguntas-recusadas',
          recusadas: recusadas.length,
          motivos: recusadas.flatMap((r) => r.problemas.map((x) => x.recusa))
        }
      })

      log.agent.warn('Perguntas de refinamento recusadas pelo validador', {
        projectId,
        recusadas: recusadas.length
      })
    }

    if (validas.length === 0) {
      return {
        resultado: 'saida-invalida',
        mensagem: 'Nenhuma pergunta gerada passou no contrato. Nada foi gravado.',
        problemas: recusadas.flatMap((r) => r.problemas.map((x) => x.mensagem))
      }
    }

    const agora = new Date().toISOString()
    for (const pergunta of validas) {
      this.perguntas.registrar({
        ...pergunta,
        user_id: userId,
        workspace_id: workspaceId,
        projectId,
        estado: 'pendente',
        created_at: agora
      })
    }

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'brief-generation',
      payload: {
        projectId,
        fase: 'perguntas-geradas',
        rota: rota.decisao,
        contextPackId,
        geradas: validas.length
      }
    })

    log.agent.info('Perguntas de refinamento geradas', { projectId, geradas: validas.length })
    return { resultado: 'geradas', perguntas: validas, mensagem: 'Perguntas geradas.' }
  }

  /**
   * Registra a resposta do PI (ou a delegação ao agente).
   *
   * A ordem das guardas é a da M8-F03, e cada uma existe pelo mesmo motivo de lá: a pergunta
   * tem de existir, a escolha tem de ser real, a delegação tem de ser permitida pelo domínio, e
   * a contradição **volta sem gravar** até o PI aceitar.
   */
  responder(projectId: string, resposta: Resposta, workspaceId: WorkspaceId): RespostaOutcome {
    const userId = this.userId()
    if (!this.projects.findById(userId, projectId)) {
      return { reason: 'projeto-inexistente', mensagem: 'Projeto não encontrado.' }
    }

    const catalogo = this.perguntas.listar(userId, projectId)
    const pergunta = catalogo.find((p) => p.id === resposta.perguntaId)
    if (pergunta === undefined) {
      return {
        reason: 'pergunta-desconhecida',
        mensagem: 'Pergunta desconhecida; nada foi gravado.'
      }
    }

    const delegada = resposta.autor === 'agente'
    // A regra de delegabilidade vem do domínio, não do fato de a tela ter mostrado o botão.
    const decidida = delegada ? decidirPorMim(pergunta) : null
    if (delegada && decidida === null) {
      return {
        reason: 'nao-delegavel',
        mensagem: 'Esta decisão precisa do PI e não pode ser delegada.'
      }
    }

    const escolha = decidida?.escolha ?? resposta.escolha
    const texto = decidida ? null : resposta.texto
    if (!this.escolhaValida(pergunta, escolha, texto)) {
      return { reason: 'escolha-invalida', mensagem: 'Escolha inválida para esta pergunta.' }
    }

    const historico = this.decisions.listar(userId, projectId)
    const vigentes = decisoesVigentes(historico)
    const contradicoes = detectarContradicoes(catalogo, vigentes, pergunta.id)

    if (contradicoes.length > 0 && resposta.aceitarSubstituicao !== true) {
      return {
        reason: 'contradicao-pendente',
        contradicoes,
        mensagem: 'Esta resposta muda decisões já tomadas. Confirme a substituição.'
      }
    }

    const anterior = vigentes[pergunta.id]
    const decisao: Decision = {
      id: randomUUID(),
      user_id: userId,
      workspace_id: workspaceId,
      projectId,
      perguntaId: pergunta.id,
      etapa: pergunta.etapa,
      escolha,
      texto,
      recomendacao: pergunta.recomendada,
      justificativa: decidida?.justificativa ?? pergunta.justificativa,
      autor: decidida?.autor ?? 'pi',
      motivo: decidida
        ? 'delegada'
        : anterior !== undefined
          ? 'substituida'
          : texto !== null
            ? 'texto-livre'
            : 'escolhida',
      substituiu: anterior?.id ?? null,
      created_at: new Date().toISOString()
    }

    this.decisions.registrar(decisao)
    this.perguntas.marcarRespondida(userId, pergunta.id)

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'planning-decision',
      payload: {
        projectId,
        perguntaId: pergunta.id,
        etapa: pergunta.etapa,
        autor: decisao.autor,
        motivo: decisao.motivo,
        escolha: decisao.escolha,
        recomendacao: decisao.recomendacao,
        substituiu: decisao.substituiu
      }
    })

    log.agent.info('Decisão de refinamento registrada', {
      projectId,
      perguntaId: pergunta.id,
      autor: decisao.autor
    })

    return {
      reason: 'registrada',
      decisao,
      estado: estadoDoWizard(catalogo, this.decisions.listar(userId, projectId)),
      mensagem: 'Decisão registrada.'
    }
  }

  /** A rota que seria usada agora — sem gerar nada. */
  async rotaAtual(projectId: string, workspaceId: WorkspaceId): Promise<ResultadoDaRota> {
    return escolherRota(await this.estadoDasRotas(projectId, workspaceId))
  }

  /**
   * A escolha precisa ser uma opção real, ou texto livre numa pergunta que o aceita.
   *
   * Validar aqui, e não só na tela, é o que impede o IPC de gravar decisão impossível: o
   * renderer é fronteira não confiável.
   */
  private escolhaValida(
    pergunta: PerguntaGerada,
    escolha: string | null,
    texto: string | null
  ): boolean {
    if (escolha !== null) return pergunta.opcoes.some((o) => o.id === escolha)
    if (texto !== null) return pergunta.aceitaTextoLivre && texto.trim().length > 0
    return false
  }
}
