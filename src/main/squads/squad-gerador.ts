/**
 * O gerador real do planejador: chama o modelo **pelo ponto único de IA** (SPEC-Squads-02).
 *
 * A pergunta que este arquivo responde: **como a porta `GeradorDePlano` vira uma chamada de IA
 * que passa por orçamento, auditoria e ContextPack?** Pelo `AiCallService`, e por mais nada — o
 * ARCHITECTURE manda que toda chamada de modelo passe por um lugar só, e um gerador que falasse
 * com o Ollama ou com o CLI por conta própria seria o segundo caminho que o ponto único existe
 * para não permitir.
 *
 * Duas decisões governam o arquivo:
 *
 *  - **Local e fase diferem só nas opções.** O local pede ao Ollama a janela e o formato
 *    (`opcoesLocais`); a fase manda o esquema ao CLI (`jsonSchema`). O provider e o modelo vêm do
 *    snapshot — quem monta o gerador os passa, e este arquivo não escolhe nenhum.
 *  - **Nunca lança, e não diferencia falha de indisponibilidade no local.** Qualquer falha do
 *    local — servidor fora do ar, modelo não baixado, estouro de memória — significa a mesma
 *    coisa para o planejador: não há proposta, e a fase assume. Distinguir as causas daria ao
 *    chamador um `if` que ele não usa. A causa vai no `detalhe`, para a auditoria.
 */

import type { AiCallContext } from '../ai/call-provider'
import type { AiRequest, AiStreamEvent } from '@shared/domain/ai'
import type { ModeloEscolhido } from '@shared/domain/modelo-da-fase'
import type {
  GeradorDePlano,
  OrigemDoGerador,
  PedidoAoGerador,
  RespostaDoGerador
} from './squad-planejador'

/**
 * O que o gerador precisa do ponto único: só `call`. Interface mínima, como os verificadores do
 * próprio `AiCallService` — e é o que deixa o teste usar um falso sem montar banco, vault e quota.
 * O `AiCallService` a satisfaz estruturalmente.
 */
export interface ChamadorDeIa {
  call(request: AiRequest, ctx: AiCallContext): AsyncIterable<AiStreamEvent>
}

/**
 * Teto de tokens da saída do plano. Os planos da M11-F00 chegaram a 8,9 mil tokens na fase, e o
 * padrão do ponto único (4096) os cortaria no meio do JSON — que o esquema estrito recusaria
 * como `SCHEMA`, mascarando um corte de infraestrutura como erro do modelo.
 */
export const MAX_TOKENS_DO_PLANO = 16_384

export class GeradorViaPontoUnico implements GeradorDePlano {
  constructor(
    readonly origem: OrigemDoGerador,
    readonly modelo: ModeloEscolhido,
    private readonly ia: ChamadorDeIa,
    private readonly ctx: AiCallContext,
    /** O ContextPack e o run que autorizam a geração — o ponto único exige o primeiro. */
    private readonly vinculos: { readonly contextPackId: string; readonly runId: string }
  ) {}

  async propor(pedido: PedidoAoGerador): Promise<RespostaDoGerador> {
    if (this.origem === 'local' && pedido.numCtx === undefined) {
      return { ok: false, motivo: 'FALHOU', detalhe: 'pedido ao gerador local sem num_ctx' }
    }

    const request: AiRequest = {
      provider: this.modelo.provider,
      model: this.modelo.modelo,
      system: pedido.system,
      prompt: pedido.prompt,
      maxTokens: MAX_TOKENS_DO_PLANO,
      contextPackId: this.vinculos.contextPackId,
      runId: this.vinculos.runId,
      tentativa: pedido.tentativa,
      ...(this.origem === 'local'
        ? { opcoesLocais: { numCtx: pedido.numCtx as number, formato: pedido.jsonSchema } }
        : { jsonSchema: pedido.jsonSchema })
    }

    try {
      return await this.consumir(request)
    } catch (erro) {
      return this.falha(erro instanceof Error ? erro.message : 'erro desconhecido')
    }
  }

  private async consumir(request: AiRequest): Promise<RespostaDoGerador> {
    let texto = ''
    for await (const evento of this.ia.call(request, this.ctx)) {
      if (evento.tipo === 'chunk') {
        texto += evento.texto
        continue
      }
      if (evento.estado === 'falhou') return this.falha(evento.erro ?? 'a chamada falhou')
      return texto.trim() === ''
        ? this.falha('o modelo respondeu sem conteúdo')
        : { ok: true, texto }
    }
    return this.falha('o stream terminou sem desfecho')
  }

  private falha(detalhe: string): RespostaDoGerador {
    return { ok: false, motivo: this.origem === 'local' ? 'INDISPONIVEL' : 'FALHOU', detalhe }
  }
}
