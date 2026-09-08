/**
 * A conversa com a persona JARVIS (SPEC-Voz-03, critérios 1 a 8).
 *
 * Fecha o loop: a transcrição da F01 vira pergunta, a persona responde pelo **ponto único de IA**
 * na rota local, e a resposta volta como texto para a F02 falar.
 *
 * ## Tudo passa pelo ponto único, sem exceção
 *
 * Este arquivo não conhece o Ollama. Ele monta `AiRequest` com `taskType: 'conversa-de-voz'` e
 * entrega ao `AiCallService`, que roteia, audita, mede custo e verifica o `ContextPack`. Chamar o
 * adapter direto seria mais curto e mataria o critério 2 — e a auditoria não saberia que a
 * conversa aconteceu.
 *
 * ## Nenhum caminho de ação (critério 8)
 *
 * A conversa **responde**; não executa. Não há aqui — nem na ponte — canal que rode comando, toque
 * arquivo ou dispare conector. Comando de voz com efeito é fatia futura com spec própria, atrás
 * de Policy Engine e aprovação; nunca subproduto de uma resposta.
 */

import type { WorkspaceId } from '@shared/domain/entities'
import type { AiRequest, AiStreamEvent } from '@shared/domain/ai'
import type { ContextPack } from '@shared/domain/context-pack'
import type { DesfechoDaConversa, TrocaDaConversa } from '@shared/domain/voz'
import { systemDaPersona } from './persona'
import { textoDoSnapshot, type SnapshotDoApp } from './snapshot-do-app'

export type { DesfechoDaConversa, TrocaDaConversa }

export interface DepsDaConversa {
  /** O ponto único. Tipado ao mínimo que este serviço usa — o resto não lhe diz respeito. */
  readonly ai: {
    readonly call: (
      request: AiRequest,
      ctx: { userId: string; workspace: WorkspaceId }
    ) => AsyncIterable<AiStreamEvent>
  }
  /** Monta o pack do app. É o `ContextService.montarDoApp` (emenda E1). */
  readonly montarContexto: (
    entrada: {
      readonly tarefa: string
      readonly etapa: string
      readonly partes: readonly { nome: string; texto: string; motivo: string }[]
      readonly rota: 'ollama'
    },
    workspace: WorkspaceId
  ) => ContextPack
  readonly persona: (workspace: WorkspaceId) => string
  readonly snapshot: (workspace: WorkspaceId) => SnapshotDoApp
  /**
   * Se a rota local pode atender **agora**, e a próxima ação quando não pode.
   *
   * Separado da chamada porque a recusa é outra ação, e devolve texto em vez de booleano porque
   * o critério 4 exige dois cenários com próximas ações diferentes: serviço fora pede subir o
   * Ollama, modelo ausente pede baixá-lo. Quem sabe qual é o main, que enxerga o adapter; este
   * serviço só precisa saber que não vai chamar e o que dizer a respeito.
   */
  readonly rotaDisponivel: () => Promise<{ ok: true } | { ok: false; proximaAcao: string }>
  readonly userId: () => string
  /** Quantas trocas do histórico entram no contexto. Configurável (critério 7). */
  readonly janelaDoHistorico: () => number
}

export class ConversaService {
  /**
   * O histórico vive **em memória**, e some com o app (critério 7).
   *
   * Persistir é F05 (transcript) e MVP-007 (memória de longo prazo). Guardar aqui "só por
   * enquanto" criaria a terceira fonte do mesmo dado, e a fala do usuário é exatamente o que a
   * fatia inteira mantém fora do disco.
   */
  private historico: TrocaDaConversa[] = []

  constructor(private readonly deps: DepsDaConversa) {}

  /** O histórico da sessão, para a tela mostrar. Cópia: ninguém edita o de dentro. */
  trocas(): readonly TrocaDaConversa[] {
    return [...this.historico]
  }

  /** Zera a janela. Existe para o teste e para quando a tela quiser recomeçar. */
  limpar(): void {
    this.historico = []
  }

  async perguntar(pergunta: string, workspace: WorkspaceId): Promise<DesfechoDaConversa> {
    const texto = pergunta.trim()
    // Transcrição vazia acontece — um clique curto, um ruído. Chamar o modelo com nada gastaria a
    // ida e voltaria com uma resposta a uma pergunta que ninguém fez.
    if (texto === '') return { estado: 'sem-pergunta' }

    /*
     * A disponibilidade é verificada **antes** de montar o contexto.
     *
     * Não é otimização: montar o pack grava uma linha e audita. Fazer isso para em seguida
     * descobrir que a rota está fora deixaria manifestos órfãos no banco, de envios que nunca
     * aconteceram — e "o que foi enviado?" passaria a ter respostas que não foram.
     */
    const rota = await this.deps.rotaDisponivel()
    if (!rota.ok) {
      return { estado: 'indisponivel', proximaAcao: rota.proximaAcao }
    }

    try {
      const pack = this.montarPack(texto, workspace)

      const request: AiRequest = {
        taskType: 'conversa-de-voz',
        prompt: texto,
        system: systemDaPersona(this.deps.persona(workspace)),
        contextPackId: pack.id
      }

      let resposta = ''
      for await (const evento of this.deps.ai.call(request, {
        userId: this.deps.userId(),
        workspace
      })) {
        if (evento.tipo === 'chunk') resposta += evento.texto
        if (evento.tipo === 'fim' && evento.estado === 'falhou') {
          return { estado: 'falhou', motivo: evento.erro ?? 'A conversa falhou.' }
        }
      }

      const limpa = resposta.trim()
      if (limpa === '') return { estado: 'falhou', motivo: 'O modelo não respondeu nada.' }

      this.historico.push({ pergunta: texto, resposta: limpa })
      return { estado: 'ok', resposta: limpa }
    } catch (erro) {
      return { estado: 'falhou', motivo: erro instanceof Error ? erro.message : String(erro) }
    }
  }

  /**
   * Monta o pack da pergunta: persona, snapshot e histórico.
   *
   * As três partes entram como itens declarados, cada uma com hash próprio — é o que o critério 3
   * pede e o que a emenda E1 tornou possível. O manifesto responde "o que o modelo viu?" com a
   * mesma precisão de uma geração documental.
   */
  private montarPack(pergunta: string, workspace: WorkspaceId): ContextPack {
    const partes = [
      {
        nome: 'persona',
        texto: systemDaPersona(this.deps.persona(workspace)),
        motivo: 'persona ativa do espaço'
      },
      {
        nome: 'snapshot',
        texto: textoDoSnapshot(this.deps.snapshot(workspace)),
        motivo: 'estado local do app no momento da pergunta'
      }
    ]

    const janela = this.historico.slice(-this.deps.janelaDoHistorico())
    if (janela.length > 0) {
      partes.push({
        nome: 'historico',
        texto: janela.map((t) => `Operador: ${t.pergunta}\nJARVIS: ${t.resposta}`).join('\n\n'),
        motivo: `últimas ${janela.length} trocas da sessão`
      })
    }

    return this.deps.montarContexto(
      {
        tarefa: `conversa-de-voz: ${pergunta.slice(0, 80)}`,
        etapa: 'conversa',
        partes,
        rota: 'ollama'
      },
      workspace
    )
  }
}
