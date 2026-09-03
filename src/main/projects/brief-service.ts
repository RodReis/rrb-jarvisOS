/**
 * A geração do brief refinado (SPEC-Jornada-02).
 *
 * A pergunta que este serviço responde: **como transformar o prompt do PI num brief aceito, sem
 * que o modelo invente requisito e sem gastar dinheiro que ninguém autorizou?**
 *
 * Quatro garantias, e todas são sobre o que **não** acontece:
 *
 *  - **Nada é gerado sem rota autorizada** (critério 6). A escolha de rota acontece **antes** de
 *    montar o pacote e antes de qualquer chamada: bloqueio significa zero chamada e zero custo,
 *    não uma chamada que falha depois. Por isso a guarda é a primeira linha, e não um `catch`.
 *  - **Saída que não passa no validador não vira brief** (critérios 3 e 4). Uma tentativa de
 *    correção e, se ainda assim falhar, bloqueia com o problema nomeado — mesma economia de
 *    recuperação do MVP-009, que também para em vez de insistir.
 *  - **A rota escolhida entra no pacote de contexto**, porque é ela que decide se o orçamento é
 *    medido em dólar ou em uso. Montar o pacote antes de saber a rota faria o teto errado ser
 *    aplicado.
 *  - **O modelo não escolhe o próprio provider.** A rota vem da decisão, não do pedido: um
 *    `request.provider` livre aqui deixaria a geração escolher a rota paga por conta própria.
 */

import { createHash, randomUUID } from 'node:crypto'
import type { WorkspaceId } from '@shared/domain/entities'
import type { AiProvider } from '@shared/domain/ai'
import type {
  Afirmacao,
  Brief,
  BriefRegistrado,
  GeracaoOutcome,
  Pendencia,
  PromptDoProjeto
} from '@shared/domain/brief'
import { cortarProposto, validarBrief } from '@shared/domain/brief'
import type { PerguntaGerada } from '@shared/domain/pergunta-gerada'
import { separarPerguntasValidas } from '@shared/domain/pergunta-gerada'
import type { EstadoDasRotas, ResultadoDaRota } from '@shared/domain/rota-de-geracao'
import { escolherRota } from '@shared/domain/rota-de-geracao'
import { log } from '../logging/logger'
import type { AuditRepository } from '../storage/audit-repository'
import type { BriefRepository } from './brief-repository'

/**
 * Quantas vezes o serviço pede correção ao modelo antes de desistir.
 *
 * **Uma.** Cada tentativa é uma chamada paga (ou uma fatia da assinatura), e um laço de
 * "tenta até passar" transforma uma saída sistematicamente ruim numa conta aberta. Um modelo que
 * erra o schema duas vezes seguidas não erra por acaso — insistir não conserta, só gasta.
 *
 * É a mesma economia do MVP-009: até duas recuperações, depois `BLOCKED` explicável.
 */
export const TENTATIVAS_DE_CORRECAO = 1

/** A rota concreta de cada decisão. `claude-code` é a rota de assinatura do produto. */
const PROVIDER_DA_ROTA: Readonly<Record<'assinatura' | 'paga', AiProvider>> = {
  assinatura: 'claude-code',
  paga: 'anthropic'
}

/** O que o modelo devolve. Estruturado, nunca prosa — é o que torna a origem verificável. */
export interface SaidaDoModelo {
  readonly afirmacoes: readonly Afirmacao[]
  readonly pendencias: readonly Pendencia[]
}

export interface BriefServiceDeps {
  readonly repository: BriefRepository
  readonly audit: AuditRepository
  readonly userId: () => string
  /**
   * O estado das rotas, resolvido por quem conhece credenciais e quota.
   *
   * **Assíncrono porque a disponibilidade da assinatura é um healthcheck**, não uma leitura de
   * memória. O typecheck pegou isto: com a assinatura síncrona, a `Promise` do adapter entrava
   * no campo booleano e um objeto é sempre truthy — a rota pareceria disponível **sempre**,
   * inclusive com o Claude Code fora do ar, e o bloqueio do critério 6 nunca dispararia.
   */
  readonly estadoDasRotas: (
    projectId: string,
    workspace: WorkspaceId
  ) => EstadoDasRotas | Promise<EstadoDasRotas>
  /**
   * Gera pelo ponto único. Recebe a rota **decidida**, nunca a escolhe.
   *
   * Devolve a saída estruturada ou `undefined` quando a chamada falhou — a distinção entre
   * "falhou" e "veio inválida" importa: a primeira é infraestrutura, a segunda é conteúdo.
   */
  readonly gerar: (entrada: {
    readonly projectId: string
    readonly workspace: WorkspaceId
    readonly prompt: string
    readonly rota: AiProvider
    readonly correcao?: readonly string[]
  }) => Promise<{ readonly saida?: SaidaDoModelo; readonly contextPackId?: string }>
}

/** Hash canônico do conteúdo. É por ele que o brief é citado e que a reaprovação compara. */
function hashDoBrief(afirmacoes: readonly Afirmacao[], pendencias: readonly Pendencia[]): string {
  // Ordenado por id antes de serializar: a ordem em que o modelo listou as afirmações não é
  // fato sobre o brief, e sem ordenar duas gerações idênticas produziriam hashes diferentes.
  const canonico = JSON.stringify({
    afirmacoes: [...afirmacoes].sort((a, b) => a.id.localeCompare(b.id)),
    pendencias: [...pendencias].sort((a, b) => a.bloco.localeCompare(b.bloco))
  })

  return createHash('sha256').update(canonico, 'utf8').digest('hex')
}

export function hashDoPrompt(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex')
}

export class BriefService {
  private readonly repository: BriefRepository
  private readonly audit: AuditRepository
  private readonly userId: () => string
  private readonly estadoDasRotas: BriefServiceDeps['estadoDasRotas']
  private readonly gerar: BriefServiceDeps['gerar']

  constructor(deps: BriefServiceDeps) {
    this.repository = deps.repository
    this.audit = deps.audit
    this.userId = deps.userId
    this.estadoDasRotas = deps.estadoDasRotas
    this.gerar = deps.gerar
  }

  /**
   * Salva o prompt do PI (critério 1).
   *
   * Prompt vazio não avança — e a recusa vem antes de qualquer escrita, então não há linha
   * parcial a limpar. Mesma postura da criação de projeto.
   */
  salvarPrompt(
    projectId: string,
    texto: string,
    workspaceId: WorkspaceId
  ): PromptDoProjeto | undefined {
    if (texto.trim().length === 0) return undefined

    const userId = this.userId()
    const prompt: PromptDoProjeto = {
      id: randomUUID(),
      user_id: userId,
      workspace_id: workspaceId,
      projectId,
      texto,
      hash: hashDoPrompt(texto),
      commitHash: null,
      created_at: new Date().toISOString()
    }

    this.repository.registrarPrompt(prompt)

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'brief-generation',
      payload: { projectId, fase: 'prompt-salvo', promptHash: prompt.hash }
    })

    log.agent.info('Prompt do projeto salvo', { projectId })
    return prompt
  }

  /**
   * A rota que seria usada agora — sem gerar nada.
   *
   * Existe para a tela poder mostrar o bloqueio **antes** de o PI clicar: descobrir que não há
   * rota depois de pedir a geração seria a mesma fricção que o critério 6 evita no custo.
   */
  async rotaAtual(projectId: string, workspaceId: WorkspaceId): Promise<ResultadoDaRota> {
    return escolherRota(await this.estadoDasRotas(projectId, workspaceId))
  }

  /**
   * Gera o brief a partir do prompt vigente.
   *
   * A ordem das guardas é a garantia: **rota antes de tudo**. Bloqueio é zero chamada e zero
   * custo (critério 6), e conferir a rota depois de montar o pacote já teria gasto o trabalho —
   * pior, um `catch` em volta da chamada faria a rota paga virar fallback de erro.
   */
  async gerarBrief(projectId: string, workspaceId: WorkspaceId): Promise<GeracaoOutcome> {
    const userId = this.userId()

    const prompt = this.repository.promptVigente(userId, projectId)
    if (prompt === undefined) {
      return {
        resultado: 'sem-prompt',
        mensagem: 'Escreva o prompt do projeto antes de gerar o brief.'
      }
    }

    const rota = escolherRota(await this.estadoDasRotas(projectId, workspaceId))

    if (rota.decisao === 'bloqueado') {
      // Auditado **antes** de qualquer chamada, e é isso que o critério 6 pede provar: o
      // bloqueio é um fato registrado, não a ausência de um.
      this.audit.append({
        user_id: userId,
        workspace_id: workspaceId,
        type: 'brief-generation',
        payload: { projectId, fase: 'bloqueado', motivo: rota.motivo }
      })

      log.agent.warn('Geração do brief bloqueada por falta de rota', {
        projectId,
        motivo: rota.motivo
      })

      return {
        resultado: 'bloqueado-sem-rota',
        mensagem: 'A geração não aconteceu: nenhuma rota autorizada está disponível.',
        ...(rota.acao === undefined ? {} : { acao: rota.acao })
      }
    }

    const provider = PROVIDER_DA_ROTA[rota.decisao]

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'brief-generation',
      payload: { projectId, fase: 'inicio', rota: rota.decisao, provider }
    })

    let problemas: readonly string[] = []

    // Uma tentativa de correção, não um laço: ver `TENTATIVAS_DE_CORRECAO`.
    for (let tentativa = 0; tentativa <= TENTATIVAS_DE_CORRECAO; tentativa += 1) {
      const resposta = await this.gerar({
        projectId,
        workspace: workspaceId,
        prompt: prompt.texto,
        rota: provider,
        // Na primeira volta não há o que corrigir; na segunda, o modelo recebe exatamente o que
        // o validador recusou — pedir "tente de novo" sem dizer o quê é jogar dado.
        ...(problemas.length > 0 ? { correcao: problemas } : {})
      })

      if (resposta.saida === undefined) {
        problemas = ['A chamada ao modelo não devolveu saída.']
        continue
      }

      const candidato: Brief = {
        projectId,
        afirmacoes: resposta.saida.afirmacoes,
        pendencias: resposta.saida.pendencias
      }

      const validacao = validarBrief(candidato)

      if (!validacao.valido) {
        problemas = validacao.problemas.map((p) => p.mensagem)

        this.audit.append({
          user_id: userId,
          workspace_id: workspaceId,
          type: 'brief-generation',
          payload: { projectId, fase: 'saida-recusada', tentativa, problemas: problemas.length }
        })

        continue
      }

      const hash = hashDoBrief(candidato.afirmacoes, candidato.pendencias)

      // Mesmo conteúdo é o mesmo brief: devolve o existente em vez de estourar no UNIQUE.
      // Regerar sem mudança não deve criar revisão nova nem pedir novo aceite (critério 5 da
      // SPEC-Planejamento-06, aplicado aqui).
      const jaExiste = this.repository.findBriefByHash(userId, hash)
      if (jaExiste !== undefined) {
        return {
          resultado: 'gerado',
          brief: jaExiste,
          mensagem: 'O brief gerado é idêntico ao anterior; a revisão foi preservada.'
        }
      }

      const registrado = this.repository.registrarBrief({
        id: randomUUID(),
        user_id: userId,
        workspace_id: workspaceId,
        projectId,
        promptId: prompt.id,
        afirmacoes: candidato.afirmacoes,
        pendencias: candidato.pendencias,
        hash,
        commitHash: null,
        contextPackId: resposta.contextPackId ?? null,
        created_at: new Date().toISOString()
      })

      this.audit.append({
        user_id: userId,
        workspace_id: workspaceId,
        type: 'brief-generation',
        payload: {
          projectId,
          fase: 'gerado',
          rota: rota.decisao,
          briefHash: hash,
          contextPackId: resposta.contextPackId ?? null,
          afirmacoes: candidato.afirmacoes.length
        }
      })

      log.agent.info('Brief gerado', {
        projectId,
        rota: rota.decisao,
        afirmacoes: candidato.afirmacoes.length
      })
      return { resultado: 'gerado', brief: registrado, mensagem: 'Brief gerado.' }
    }

    // Esgotou a tentativa de correção. Bloqueia com o problema nomeado, em vez de gravar um
    // brief que o validador recusou — gravar seria exatamente o que os critérios 3 e 4 impedem.
    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'brief-generation',
      payload: { projectId, fase: 'desistiu', problemas: problemas.length }
    })

    log.agent.error('Saída do modelo recusada depois da correção', { projectId, problemas })

    return {
      resultado: 'saida-invalida',
      mensagem:
        'A saída do modelo não passou no validador, nem depois da correção. Nada foi gravado.',
      problemas
    }
  }

  /** O prompt vigente do projeto. As revisões anteriores continuam no banco. */
  lerPrompt(projectId: string): PromptDoProjeto | undefined {
    return this.repository.promptVigente(this.userId(), projectId)
  }

  /** O brief vigente do projeto, ou `undefined` enquanto nenhum foi gerado. */
  carregar(projectId: string): BriefRegistrado | undefined {
    return this.repository.briefVigente(this.userId(), projectId)
  }

  /**
   * Corta um `proposto` no gate (critério 5) — item a item, decisão do PI de 2026-09-03.
   *
   * **Grava uma revisão nova, não edita a atual.** O brief que o PI leu continua no banco: se o
   * corte editasse a linha, o hash passaria a descrever um conteúdo diferente do que foi
   * mostrado, e o aceite por revisão exata deixaria de significar algo.
   *
   * Corte que não muda nada devolve o brief como está — sem revisão nova. É o caso do id errado
   * ou de uma afirmação que não é `proposto`: o domínio já se recusa a cortá-la, e criar
   * revisão idêntica só encheria o histórico.
   */
  cortarProposto(
    projectId: string,
    afirmacaoId: string,
    workspaceId: WorkspaceId
  ): BriefRegistrado | undefined {
    const userId = this.userId()
    const atual = this.repository.briefVigente(userId, projectId)
    if (atual === undefined) return undefined

    const cortado = cortarProposto(atual, afirmacaoId)

    if (cortado.afirmacoes.length === atual.afirmacoes.length) {
      return atual
    }

    const hash = hashDoBrief(cortado.afirmacoes, cortado.pendencias)

    const novo = this.repository.registrarBrief({
      id: randomUUID(),
      user_id: userId,
      workspace_id: workspaceId,
      projectId,
      promptId: atual.promptId,
      afirmacoes: cortado.afirmacoes,
      pendencias: cortado.pendencias,
      hash,
      commitHash: null,
      contextPackId: atual.contextPackId,
      created_at: new Date().toISOString()
    })

    this.audit.append({
      user_id: userId,
      workspace_id: workspaceId,
      type: 'brief-generation',
      payload: { projectId, fase: 'proposto-cortado', afirmacaoId, briefHash: hash }
    })

    log.agent.info('Proposto cortado pelo PI', { projectId, afirmacaoId })
    return novo
  }

  /**
   * Filtra as perguntas geradas, descartando as que ferem o contrato (critério 3).
   *
   * As recusadas são **auditadas**, não engolidas: uma recusa silenciosa faria o refinamento
   * pular um bloco sem ninguém saber por quê.
   */
  filtrarPerguntas(
    projectId: string,
    perguntas: readonly PerguntaGerada[],
    workspaceId: WorkspaceId
  ): readonly PerguntaGerada[] {
    const { validas, recusadas } = separarPerguntasValidas(perguntas)

    if (recusadas.length > 0) {
      this.audit.append({
        user_id: this.userId(),
        workspace_id: workspaceId,
        type: 'brief-generation',
        payload: {
          projectId,
          fase: 'perguntas-recusadas',
          recusadas: recusadas.length,
          motivos: recusadas.flatMap((r) => r.problemas.map((p) => p.recusa))
        }
      })

      log.agent.warn('Perguntas geradas recusadas pelo validador', {
        projectId,
        recusadas: recusadas.length
      })
    }

    return validas
  }
}
