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
import type { Etapa, EventoDeJornada, TransicaoOutcome } from '@shared/domain/jornada'
import {
  CTA_DA_ETAPA,
  ETAPAS,
  GATE_DA_ETAPA,
  avancar,
  etapaDerivada,
  exigeAceiteDoPi,
  oQueFaltaPara,
  ordemDaEtapa,
  posicaoNaTrilha,
  regredir
} from '@shared/domain/jornada'
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

/** Uma etapa como a trilha a desenha (critérios 3 e 4). */
export interface EtapaNaTrilha {
  readonly etapa: Etapa
  readonly posicao: 'concluida' | 'atual' | 'futura'
  /** O rótulo do CTA. Presente sempre; só a etapa atual o oferece como ação. */
  readonly cta: string
  /** O que falta para chegar aqui — preenchido só em etapa futura. */
  readonly oQueFalta: string | null
  /** `true` só na etapa atual: nenhuma outra aceita ação (critério 4). */
  readonly acionavel: boolean
}

/** O estado completo da jornada de um projeto — o que a tela consome. */
export interface EstadoDaJornada {
  readonly projectId: string
  readonly etapa: Etapa
  /** O CTA único da etapa atual (critério 3). */
  readonly cta: string
  readonly trilha: readonly EtapaNaTrilha[]
  /** Por que a jornada regrediu, quando regrediu (critério 7). */
  readonly motivoDaRegressao: string | null
  /** `true` quando a etapa persistida discordava dos fatos e foi recalculada (critério 2). */
  readonly recalculada: boolean
}

export interface JornadaDeps {
  readonly repository: ProjectRepository
  readonly roadmap: RoadmapRepository
  readonly audit: AuditRepository
  readonly userId: () => string
}

export class JornadaService {
  private readonly repository: ProjectRepository
  private readonly roadmap: RoadmapRepository
  private readonly audit: AuditRepository
  private readonly userId: () => string

  constructor(deps: JornadaDeps) {
    this.repository = deps.repository
    this.roadmap = deps.roadmap
    this.audit = deps.audit
    this.userId = deps.userId
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
    return ETAPAS.map((etapa) => {
      const posicao = posicaoNaTrilha(etapa, atual)
      return {
        etapa,
        posicao,
        cta: CTA_DA_ETAPA[etapa],
        oQueFalta: oQueFaltaPara(etapa, atual),
        acionavel: posicao === 'atual'
      }
    })
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
