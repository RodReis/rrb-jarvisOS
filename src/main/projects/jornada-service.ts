/**
 * O serviço da jornada de planejamento (SPEC-Jornada-01).
 *
 * A regra pura mora em `@shared/domain/jornada`; aqui fica o que precisa de I/O: ler os fatos
 * (marcos commitados, aprovações registradas), confrontá-los com a etapa persistida e auditar
 * o que mudou.
 *
 * Duas garantias, e as duas são sobre o que **não** acontece:
 *
 *  - **Não existe "setar etapa".** A única entrada de escrita é `aplicarEvento`, e ela recusa
 *    evento desconhecido ou fora de ordem sem mover nada (critério 1). Por isso a ponte IPC
 *    não expõe nenhum método que receba uma etapa — não há o que expor.
 *  - **A coluna nunca vence os fatos.** `estado` recalcula a partir dos eventos e, quando a
 *    coluna discorda, o cálculo prevalece e o desvio é auditado (critério 2). A coluna é cache;
 *    tratá-la como verdade a tornaria uma segunda fonte sobre o que as aprovações já dizem.
 */

import type { WorkspaceId } from '@shared/domain/entities'
import type { Approval } from '@shared/domain/aprovacoes'
import { gatesInvalidados } from '@shared/domain/aprovacoes'
import type { MudancaDeArtefato } from '@shared/domain/aprovacoes'
import type {
  EstadoDaJornada,
  Etapa,
  EtapaNaTrilha,
  EventoDeJornada,
  TransicaoOutcome
} from '@shared/domain/jornada'
import {
  CTA_DA_ETAPA,
  ETAPAS,
  GATE_DA_ETAPA,
  avancar,
  etapaDerivada,
  exigeAceiteDoPi,
  montarTrilha,
  ordemDaEtapa,
  regredir
} from '@shared/domain/jornada'
import type { ResumoDoProjeto } from '@shared/domain/fase'
import { ROTULO_DA_FASE, faseDaEtapa, progressoNaFase } from '@shared/domain/fase'
import type { EstadoDasRotas, ResultadoDaRota } from '@shared/domain/rota-de-geracao'
import { PROVIDER_DA_ROTA, escolherRota } from '@shared/domain/rota-de-geracao'
import type { AiProvider } from '@shared/domain/ai'
import { ETAPAS_DE_ACEITE } from '@shared/domain/jornada'
import type { MarcoDocumental } from '@shared/domain/projects'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { ProjectRepository } from './project-repository'
import type { RoadmapRepository } from './roadmap-repository'

/**
 * O marco documental que comprova cada evento da jornada.
 *
 * **Dado, não lógica.** É a tradução entre o que o MVP-008 já commitava e o vocabulário da
 * jornada: um marco no Git é a evidência de que o evento aconteceu. Eventos sem marco
 * correspondente (o prompt, o refinamento) vêm das respostas do wizard, não daqui.
 */
const EVENTO_DO_MARCO: Readonly<Partial<Record<MarcoDocumental, EventoDeJornada>>> = {
  'contexto-aprovado': 'brief-aceito',
  'prd-aprovado': 'prd-gerado',
  'design-anexado': 'design-anexado',
  'arquitetura-aprovada': 'arquitetura-gerada',
  'roadmap-aprovado': 'roadmap-gerado'
}

export interface JornadaDeps {
  readonly repository: ProjectRepository
  readonly roadmap: RoadmapRepository
  readonly audit: AuditRepository
  readonly userId: () => string
  /**
   * O estado das rotas do projeto — injetado, como nos serviços de geração, porque depende de
   * adapters e credenciais que o domínio da jornada não conhece.
   *
   * Opcional: só o resumo do card precisa dele, e os call sites que só leem a etapa não devem
   * ser obrigados a montar o mundo dos providers para isso.
   */
  readonly estadoDasRotas?: (
    projectId: string,
    workspaceId: WorkspaceId
  ) => EstadoDasRotas | undefined
  /** O modelo ativo de um provider. Mesma fonte que a geração consulta (critério 4). */
  readonly modeloAtivo?: (workspaceId: WorkspaceId, provider: AiProvider) => string
}

export class JornadaService {
  private readonly repository: ProjectRepository
  private readonly roadmap: RoadmapRepository
  private readonly audit: AuditRepository
  private readonly userId: () => string
  private readonly estadoDasRotas?: JornadaDeps['estadoDasRotas']
  private readonly modeloAtivo?: JornadaDeps['modeloAtivo']

  constructor(deps: JornadaDeps) {
    this.repository = deps.repository
    this.roadmap = deps.roadmap
    this.audit = deps.audit
    this.userId = deps.userId
    this.estadoDasRotas = deps.estadoDasRotas
    this.modeloAtivo = deps.modeloAtivo
  }

  /**
   * Os eventos que os fatos sustentam.
   *
   * Monta a lista a partir do que está gravado: o marco documental commitado e as aprovações
   * de gate registradas. Não inventa nada — um evento só entra aqui se existe evidência dele,
   * e é isso que faz o projeto do fluxo antigo cair em `prompt` sem caso especial (critério 6).
   */
  private eventosObservados(projectId: string, workspaceId: WorkspaceId): readonly string[] {
    const userId = this.userId()
    const sessao = this.repository.findSession(userId, projectId)
    const eventos: EventoDeJornada[] = []

    // O prompt e o refinamento vivem nas respostas do wizard, não em marco: são estado de
    // trabalho, e o MVP-008 deliberadamente não os commita.
    if (sessao && Object.keys(sessao.respostas).length > 0) {
      eventos.push('prompt-salvo', 'refinamento-respondido')
    }

    // Marco commitado é evidência no Git. `ultimoMarco` guarda só o último, mas os marcos são
    // ordenados e a cadeia de `etapaDerivada` para no primeiro buraco de qualquer forma — o
    // último marco implica os anteriores porque não há como commitar fora de ordem.
    if (sessao?.ultimoMarco) {
      const ateAqui = Object.entries(EVENTO_DO_MARCO)
      for (const [marco, evento] of ateAqui) {
        eventos.push(evento)
        if (marco === sessao.ultimoMarco) break
      }
    }

    // Aprovação de gate registrada é o aceite do PI. Traduz gate → evento pelo mapa da etapa.
    const aprovacoes = this.roadmap.listarAprovacoes({ userId, workspaceId, projectId })
    for (const etapa of ETAPAS) {
      const gate = GATE_DA_ETAPA[etapa]
      if (gate && aprovacoes.some((a) => a.gate === gate)) {
        eventos.push(etapa as EventoDeJornada)
      }
    }

    return eventos
  }

  /**
   * O estado da jornada, recalculado a partir dos fatos (critério 2).
   *
   * Quando a coluna discorda do cálculo, **o cálculo vence** e o desvio é auditado. Persistir
   * a correção na hora evita que a próxima leitura repita o mesmo trabalho e o mesmo evento de
   * auditoria — o desvio é registrado uma vez, não a cada abertura da tela.
   */
  estado(projectId: string, workspaceId: WorkspaceId): EstadoDaJornada | undefined {
    const userId = this.userId()
    const sessao = this.repository.findSession(userId, projectId)
    if (!sessao) return undefined

    const derivada = etapaDerivada(this.eventosObservados(projectId, workspaceId))
    const persistida = sessao.etapaDaJornada
    const recalculada = derivada !== persistida

    if (recalculada) {
      this.audit.append({
        user_id: userId,
        workspace_id: workspaceId,
        type: 'journey-stage-recalculated',
        payload: { projectId, persistida, derivada }
      })

      log.agent.warn('Etapa persistida incoerente com os fatos; recalculada', {
        projectId,
        persistida,
        derivada
      })

      this.repository.saveSession({
        ...sessao,
        etapaDaJornada: derivada,
        updated_at: new Date().toISOString()
      })
    }

    return {
      projectId,
      etapa: derivada,
      cta: CTA_DA_ETAPA[derivada],
      trilha: this.trilha(derivada),
      motivoDaRegressao: sessao.motivoDaRegressao,
      recalculada
    }
  }

  /** A trilha inteira em relação à etapa atual. Etapa futura não é acionável (critério 4). */
  private trilha(atual: Etapa): readonly EtapaNaTrilha[] {
    return montarTrilha(atual)
  }

  /**
   * Aplica um evento nomeado — a **única** forma de mover a jornada (critério 1).
   *
   * Recusa devolve o desfecho em vez de estourar, e a etapa não se move. Toda transição, tendo
   * avançado ou não, gera `AuditEvent`: a tentativa barrada é o fato interessante para quem
   * inspeciona depois, e registrar só o que passou faria sumir exatamente o que se quer ver.
   */
  aplicarEvento(
    projectId: string,
    evento: string,
    workspaceId: WorkspaceId
  ): TransicaoOutcome | undefined {
    const userId = this.userId()
    const sessao = this.repository.findSession(userId, projectId)
    if (!sessao) return undefined

    const atual = sessao.etapaDaJornada
    const outcome = avancar(atual, evento, this.temAceiteDoPi(projectId, workspaceId, atual))

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'journey-transition',
      payload: { projectId, evento, de: atual, para: outcome.etapa, resultado: outcome.resultado }
    })

    if (outcome.resultado !== 'avancou') {
      log.agent.info('Transição de jornada recusada', {
        projectId,
        evento,
        resultado: outcome.resultado
      })
      return outcome
    }

    this.repository.saveSession({
      ...sessao,
      etapaDaJornada: outcome.etapa,
      // Avançar limpa o motivo da regressão anterior: ele descreve por que a jornada voltou, e
      // manter o texto velho faria a tela explicar uma volta que já foi superada.
      motivoDaRegressao: null,
      updated_at: new Date().toISOString()
    })

    log.agent.info('Jornada avançou', { projectId, evento, para: outcome.etapa })
    return outcome
  }

  /**
   * A etapa de aceite tem `Approval` do PI?
   *
   * Só as etapas com gate formal em `aprovacoes.ts` são conferíveis aqui. As etapas de aceite
   * **documental** (`brief-aceito`, `prd-aceito`) não têm gate próprio: a evidência delas é a
   * revisão commitada, e quem chama já as move pelo evento correspondente.
   */
  private temAceiteDoPi(projectId: string, workspaceId: WorkspaceId, etapa: Etapa): boolean {
    if (!exigeAceiteDoPi(etapa)) return true

    const gate = GATE_DA_ETAPA[etapa]
    if (!gate) return true

    const userId = this.userId()
    const aprovacoes: readonly Approval[] = this.roadmap.listarAprovacoes({
      userId,
      workspaceId,
      projectId
    })

    return aprovacoes.some((a) => a.gate === gate)
  }

  /**
   * Regride a jornada por invalidação de gate (critério 7).
   *
   * Traduz gate → etapa aqui, e não no domínio: é neste lado que o mapa das aprovações existe.
   * Regressão é desfecho legítimo, não erro — a tela mostra o motivo, e é por isso que ele é
   * persistido junto com a etapa.
   */
  invalidar(
    projectId: string,
    mudancas: readonly MudancaDeArtefato[],
    motivo: string,
    workspaceId: WorkspaceId
  ): EstadoDaJornada | undefined {
    const userId = this.userId()
    const sessao = this.repository.findSession(userId, projectId)
    if (!sessao) return undefined

    const aprovacoes = this.roadmap.listarAprovacoes({ userId, workspaceId, projectId })
    const gates = gatesInvalidados(aprovacoes, mudancas)

    const etapasInvalidadas = ETAPAS.filter((etapa) => {
      const gate = GATE_DA_ETAPA[etapa]
      return gate !== undefined && gates.includes(gate)
    })

    const resultado = regredir(sessao.etapaDaJornada, etapasInvalidadas, motivo)

    if (!resultado.regrediu) {
      log.agent.info('Invalidação não regrediu a jornada', { projectId, motivo })
      return this.estado(projectId, workspaceId)
    }

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'journey-stage-regressed',
      payload: { projectId, de: sessao.etapaDaJornada, para: resultado.etapa, motivo }
    })

    this.repository.saveSession({
      ...sessao,
      etapaDaJornada: resultado.etapa,
      motivoDaRegressao: motivo,
      updated_at: new Date().toISOString()
    })

    log.agent.warn('Jornada regrediu por invalidação de gate', {
      projectId,
      de: sessao.etapaDaJornada,
      para: resultado.etapa,
      motivo
    })

    return {
      projectId,
      etapa: resultado.etapa,
      cta: CTA_DA_ETAPA[resultado.etapa],
      trilha: this.trilha(resultado.etapa),
      motivoDaRegressao: motivo,
      recalculada: false
    }
  }

  /**
   * O estado da jornada de vários projetos — o que a lista de Projetos consome (critério 3).
   *
   * Um CTA por projeto, e nada mais: a lista é índice, e a trilha mora na rota do projeto
   * aberto (pergunta resolvida pelo PI em 2026-09-03).
   */
  /**
   * O resumo que o card da tela Projetos consome — **uma leitura por projeto** (critério 7).
   *
   * Compõe aqui, e não no renderer, porque os quatro blocos nascem em lugares diferentes: a
   * etapa nos eventos, os gates nas aprovações, a rota no estado dos providers, o modelo no
   * roteamento. Deixar a tela buscar cada um daria quatro viagens por card e — o defeito que
   * importa — permitiria que a rota do card discordasse da rota do selo, que é o mesmo fato
   * dito duas vezes (critério 4).
   *
   * Reusa `estado()` em vez de recalcular: é lá que a etapa derivada e a correção do cache
   * vivem, e um segundo cálculo aqui poderia divergir do que a tela do projeto aberto mostra.
   */
  resumoDoProjeto(
    projectId: string,
    workspaceId: WorkspaceId,
    rotas?: EstadoDasRotas
  ): ResumoDoProjeto | undefined {
    const estado = this.estado(projectId, workspaceId)
    if (!estado) return undefined

    const rota = this.rotaDoProjeto(projectId, workspaceId, rotas)
    const fase = faseDaEtapa(estado.etapa)

    return {
      projectId,
      etapa: estado.etapa,
      fase,
      rotuloDaFase: ROTULO_DA_FASE[fase],
      progresso: progressoNaFase(estado.etapa),
      cta: estado.cta,
      gates: this.gatesAceitos(projectId, workspaceId),
      dataDoUltimoEvento: this.dataDoUltimoEvento(projectId, workspaceId),
      rota,
      modelo: this.modeloDaRota(rota, workspaceId),
      bloqueio: this.bloqueioDaRota(rota)
    }
  }

  /**
   * O resumo de vários projetos — o que a lista consome, uma leitura por card (critério 7).
   *
   * A disponibilidade da assinatura é medida **uma vez por lote**, não por card: medi-la custa
   * um `spawn` do CLI, e doze projetos dariam doze processos para desenhar uma tela só. O estado
   * das rotas é o mesmo para todos os cards da lista — é propriedade do ambiente, não do
   * projeto — então medir por card pagaria N vezes por um fato único.
   */
  resumoDeVarios(
    projectIds: readonly string[],
    workspaceId: WorkspaceId,
    rotas?: EstadoDasRotas
  ): readonly ResumoDoProjeto[] {
    return projectIds
      .map((id) => this.resumoDoProjeto(id, workspaceId, rotas))
      .filter((r): r is ResumoDoProjeto => r !== undefined)
      .sort((a, b) => ordemDaEtapa(a.etapa) - ordemDaEtapa(b.etapa))
  }

  /**
   * Por onde a próxima geração sai.
   *
   * Devolve `null` quando a dep não foi injetada: um card sem o bloco da rota é degradação
   * legítima, e inventar `bloqueado` diria ao PI que há um problema de configuração onde só há
   * um serviço montado sem a dep opcional.
   */
  private rotaDoProjeto(
    projectId: string,
    workspaceId: WorkspaceId,
    medido?: EstadoDasRotas
  ): ResultadoDaRota | null {
    const estado = medido ?? this.estadoDasRotas?.(projectId, workspaceId)
    return estado ? escolherRota(estado) : null
  }

  /**
   * O modelo que a próxima geração usaria.
   *
   * `null` na rota bloqueada de propósito: ali nenhuma chamada sai, e anunciar um modelo
   * descreveria uma geração que não vai acontecer — a mesma razão pela qual o `SeloDaRota` não
   * renderiza nada quando a rota bloqueia.
   */
  private modeloDaRota(rota: ResultadoDaRota | null, workspaceId: WorkspaceId): string | null {
    if (!rota || rota.decisao === 'bloqueado') return null
    return this.modeloAtivo?.(workspaceId, PROVIDER_DA_ROTA[rota.decisao]) ?? null
  }

  /** O bloqueio, quando existe. Sem bloqueio não há bloco: alerta permanente deixa de ser lido. */
  private bloqueioDaRota(rota: ResultadoDaRota | null): ResumoDoProjeto['bloqueio'] {
    if (rota?.decisao !== 'bloqueado' || !rota.motivo || !rota.acao) return null
    return { motivo: rota.motivo, acao: rota.acao }
  }

  /**
   * Quantos dos cinco gates de aceite já têm aprovação registrada (critério 3).
   *
   * Conta sobre `ETAPAS_DE_ACEITE`, não sobre a lista de aprovações: as etapas de aceite
   * **documental** (`brief-aceito`, `prd-aceito`) não têm gate próprio em `aprovacoes.ts`, e
   * contar aprovações daria 3 de 5 no melhor caso. O denominador é o contrato; o numerador é o
   * quanto dele já foi cumprido.
   */
  private gatesAceitos(projectId: string, workspaceId: WorkspaceId): ResumoDoProjeto['gates'] {
    const eventos = new Set(this.eventosObservados(projectId, workspaceId))
    const aceitos = ETAPAS_DE_ACEITE.filter((etapa) => eventos.has(etapa)).length

    return { aceitos, total: ETAPAS_DE_ACEITE.length }
  }

  /**
   * Quando a jornada deste projeto se mexeu pela última vez.
   *
   * Lê da trilha de auditoria porque é lá que toda transição fica registrada — inclusive as
   * recusadas e as regressões. `null` quando nada aconteceu ainda: um projeto recém-criado não
   * tem data para mostrar, e exibir a data de criação no lugar responderia outra pergunta.
   */
  private dataDoUltimoEvento(projectId: string, workspaceId: WorkspaceId): string | null {
    const doProjeto = this.audit
      .list(this.userId(), workspaceId)
      .filter(
        (e) =>
          e.type.startsWith('journey-') &&
          (e.payload as { projectId?: string } | null)?.projectId === projectId
      )

    return doProjeto.length > 0 ? doProjeto[doProjeto.length - 1].created_at : null
  }

  estadoDeVarios(
    projectIds: readonly string[],
    workspaceId: WorkspaceId
  ): readonly EstadoDaJornada[] {
    return projectIds
      .map((id) => this.estado(id, workspaceId))
      .filter((e): e is EstadoDaJornada => e !== undefined)
      .sort((a, b) => ordemDaEtapa(a.etapa) - ordemDaEtapa(b.etapa))
  }
}
