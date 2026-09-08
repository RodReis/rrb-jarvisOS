import { describe, expect, it } from 'vitest'
import { ConversaService, type DepsDaConversa } from './conversa-service'
import { BLOCO_FIXO_DA_PERSONA } from './persona'
import type { AiRequest, AiStreamEvent } from '@shared/domain/ai'
import type { ContextPack } from '@shared/domain/context-pack'
import type { SnapshotDoApp } from './snapshot-do-app'

/**
 * A conversa com a persona (SPEC-Voz-03, critérios 2 a 8).
 *
 * O ponto único é dublê aqui, e é o certo: o que se prova é que **este serviço passa por ele** —
 * com o pack declarado, o system montado e o tipo de tarefa certo. Que o `AiCallService` audita,
 * mede custo e recusa chamada sem pack já está provado nos testes dele, e reprovar isto aqui de
 * novo testaria o vizinho.
 *
 * O critério 1 (loop no app real com Ollama e zero requisição cloud) é do PI, com o app rodando.
 */

function snapshot(): SnapshotDoApp {
  return {
    workspace: 'jarvis',
    projetos: [{ nome: 'JarvisOS', emAndamento: 1, aguardandoAceite: 2, bloqueadas: 0 }],
    aguardandoAceite: 2,
    em: '2026-09-08T12:00:00.000Z'
  }
}

/**
 * A rota local fora, com a frase que quem a checou escolheu.
 *
 * O texto é arbitrário de propósito: qual frase cabe a cada indisponibilidade é assunto de
 * `rota-local.spec.ts`. O que este arquivo prende é que o serviço **repassa** o que recebeu, sem
 * substituir por um texto próprio.
 */
const FORA = { ok: false, proximaAcao: 'Suba o Ollama e tente de novo.' } as const

function packFalso(id = 'pack-1'): ContextPack {
  return { id, itens: [] } as unknown as ContextPack
}

/** Um ponto único que responde com o texto pedido, guardando o que recebeu. */
function deps(parcial: Partial<DepsDaConversa> = {}): {
  deps: DepsDaConversa
  pedidos: AiRequest[]
  packs: Parameters<DepsDaConversa['montarContexto']>[0][]
} {
  const pedidos: AiRequest[] = []
  const packs: Parameters<DepsDaConversa['montarContexto']>[0][] = []

  return {
    pedidos,
    packs,
    deps: {
      ai: {
        call: async function* (request: AiRequest): AsyncIterable<AiStreamEvent> {
          pedidos.push(request)
          yield { tipo: 'chunk', id: 'c-1', texto: 'Dois aguardando aceite.' }
          yield { tipo: 'fim', id: 'c-1', estado: 'concluido' }
        }
      },
      montarContexto: (entrada) => {
        packs.push(entrada)
        return packFalso()
      },
      persona: () => 'Você é o JARVIS.',
      snapshot,
      rotaDisponivel: async () => ({ ok: true }) as const,
      modeloDaConversa: () => 'qwen3:8b',
      userId: () => 'u-1',
      janelaDoHistorico: () => 10,
      ...parcial
    }
  }
}

describe('a conversa passa pelo ponto único (critério 2)', () => {
  it('declara o tipo de tarefa e o pack, nunca um provider', async () => {
    // `taskType` e não `provider`: quem escolhe quem atende é o `ProviderRoute`, e cravar o
    // provider aqui faria a rota em Settings deixar de valer para a conversa.
    const { deps: d, pedidos } = deps()
    const desfecho = await new ConversaService(d).perguntar('quantos aceites?', 'jarvis')

    expect(desfecho).toEqual({ estado: 'ok', resposta: 'Dois aguardando aceite.' })
    expect(pedidos).toHaveLength(1)
    expect(pedidos[0].taskType).toBe('conversa-de-voz')
    expect(pedidos[0].contextPackId).toBe('pack-1')
    expect(pedidos[0].provider).toBeUndefined()
  })

  it('nunca declara diagnostico — o carve-out do gate não é usado aqui', async () => {
    // `diagnostico: true` pularia a verificação do ContextPack. É o contorno que a emenda E1
    // existe para não precisar, e este teste é o que impede alguém de reintroduzi-lo.
    const { deps: d, pedidos } = deps()
    await new ConversaService(d).perguntar('oi', 'jarvis')

    expect(pedidos[0].diagnostico).toBeUndefined()
  })
})

describe('o ContextPack da conversa (critério 3)', () => {
  it('declara persona e snapshot como partes do manifesto', async () => {
    const { deps: d, packs } = deps()
    await new ConversaService(d).perguntar('quantos aceites?', 'jarvis')

    expect(packs).toHaveLength(1)
    expect(packs[0].partes.map((p) => p.nome)).toEqual(['persona', 'snapshot'])
    expect(packs[0].rota).toBe('ollama')
    // O snapshot entra como **texto**, com os números que o app leu do banco.
    expect(packs[0].partes[1].texto).toContain('2 aguardando aceite')
  })

  it('acrescenta o histórico só a partir da segunda pergunta', async () => {
    // Na primeira não há troca anterior, e uma parte vazia diria "houve histórico e ele não tem
    // nada" — diferente de "ainda não houve".
    const { deps: d, packs } = deps()
    const service = new ConversaService(d)

    await service.perguntar('primeira', 'jarvis')
    expect(packs[0].partes.map((p) => p.nome)).not.toContain('historico')

    await service.perguntar('segunda', 'jarvis')
    expect(packs[1].partes.map((p) => p.nome)).toContain('historico')
    expect(packs[1].partes.find((p) => p.nome === 'historico')?.texto).toContain('primeira')
  })

  it('não monta contexto quando a rota está fora — nada de manifesto órfão', async () => {
    // Montar o pack grava e audita. Fazê-lo para depois descobrir que a rota caiu deixaria no
    // banco o registro de um envio que nunca aconteceu.
    const { deps: d, packs } = deps({ rotaDisponivel: async () => FORA })
    await new ConversaService(d).perguntar('oi', 'jarvis')

    expect(packs).toHaveLength(0)
  })
})

describe('a chamada declara o modelo que a checagem aprovou', () => {
  it('manda o modelo da conversa, e não deixa o ponto único resolver', async () => {
    /*
     * Regressão medida no app real: sem `model` declarado, o ponto único cai no default do
     * **provider** (`llama3.1`), e a checagem da rota — que aprovou o `qwen3:8b` — passaria a
     * garantir um modelo diferente do que a chamada pede. O Ollama recusa com 404 logo depois.
     */
    const { deps: d, pedidos } = deps({ modeloDaConversa: () => 'qwen3:8b' })
    await new ConversaService(d).perguntar('oi', 'jarvis')

    expect(pedidos[0].model).toBe('qwen3:8b')
  })
})

describe('a rota local fora recusa com próxima ação (critério 4)', () => {
  it('devolve indisponivel com a frase, e não chama o modelo', async () => {
    const { deps: d, pedidos } = deps({ rotaDisponivel: async () => FORA })
    const desfecho = await new ConversaService(d).perguntar('oi', 'jarvis')

    expect(desfecho.estado).toBe('indisponivel')
    if (desfecho.estado === 'indisponivel') {
      /*
       * A frase vem de quem **sabe qual** indisponibilidade ocorreu, e o serviço a repassa
       * intacta. Ele não a escolhe: serviço fora e modelo ausente pedem ações diferentes
       * (`rota-local.spec.ts` prende as duas), e um texto fixo aqui achataria as duas numa que
       * não resolve nem uma nem outra.
       */
      expect(desfecho.proximaAcao).toBe(FORA.proximaAcao)
    }
    expect(pedidos).toHaveLength(0)
  })

  it('distingue rota fora de falha de resposta — ações diferentes', async () => {
    // `indisponivel` pede **subir o Ollama**; `falhou` pede **tentar de novo**. Fundir os dois
    // daria à primeira execução do app a ação errada.
    const { deps: d } = deps({
      ai: {
        call: async function* (): AsyncIterable<AiStreamEvent> {
          yield { tipo: 'fim', id: 'c-1', estado: 'falhou', erro: 'o modelo travou' }
        }
      }
    })

    const desfecho = await new ConversaService(d).perguntar('oi', 'jarvis')

    expect(desfecho.estado).toBe('falhou')
  })
})

describe('a persona (critério 5)', () => {
  it('manda o texto livre e o bloco fixo no system', async () => {
    const { deps: d, pedidos } = deps()
    await new ConversaService(d).perguntar('oi', 'jarvis')

    expect(pedidos[0].system).toContain('Você é o JARVIS.')
    expect(pedidos[0].system).toContain(BLOCO_FIXO_DA_PERSONA)
  })

  it('com o texto livre vazio, o bloco fixo ainda vale', async () => {
    // O critério é literal: esvaziar o campo do usuário não pode remover a garantia do produto.
    const { deps: d, pedidos } = deps({ persona: () => '   ' })
    await new ConversaService(d).perguntar('oi', 'jarvis')

    expect(pedidos[0].system).toBe(BLOCO_FIXO_DA_PERSONA)
  })

  it('lê a persona a cada pergunta — editar vale na seguinte, sem restart', async () => {
    let texto = 'Persona A.'
    const { deps: d, pedidos } = deps({ persona: () => texto })
    const service = new ConversaService(d)

    await service.perguntar('um', 'jarvis')
    texto = 'Persona B.'
    await service.perguntar('dois', 'jarvis')

    expect(pedidos[0].system).toContain('Persona A.')
    expect(pedidos[1].system).toContain('Persona B.')
  })
})

describe('o histórico da sessão (critério 7)', () => {
  it('guarda as trocas e resolve follow-up pelo contexto', async () => {
    const { deps: d, packs } = deps()
    const service = new ConversaService(d)

    await service.perguntar('quantos projetos?', 'jarvis')
    await service.perguntar('e a segunda?', 'jarvis')

    const historico = packs[1].partes.find((p) => p.nome === 'historico')?.texto
    expect(historico).toContain('quantos projetos?')
    expect(historico).toContain('Dois aguardando aceite.')
  })

  it('respeita a janela configurada, mantendo as mais recentes', async () => {
    const { deps: d, packs } = deps({ janelaDoHistorico: () => 2 })
    const service = new ConversaService(d)

    for (const p of ['um', 'dois', 'tres']) await service.perguntar(p, 'jarvis')
    await service.perguntar('quatro', 'jarvis')

    const historico = packs[3].partes.find((p) => p.nome === 'historico')?.texto ?? ''
    expect(historico).toContain('tres')
    expect(historico).toContain('dois')
    expect(historico).not.toContain('um')
  })

  it('a janela some com o serviço — nada persiste entre sessões', async () => {
    // Reiniciar o app zera. Persistência é F05/MVP-007, e guardar aqui "por enquanto" seria a
    // terceira fonte do mesmo dado.
    const { deps: d } = deps()
    const service = new ConversaService(d)
    await service.perguntar('um', 'jarvis')

    expect(service.trocas()).toHaveLength(1)
    expect(new ConversaService(deps().deps).trocas()).toEqual([])
  })

  it('pergunta vazia não entra no histórico nem chama o modelo', async () => {
    const { deps: d, pedidos } = deps()
    const service = new ConversaService(d)

    expect(await service.perguntar('   ', 'jarvis')).toEqual({ estado: 'sem-pergunta' })
    expect(pedidos).toHaveLength(0)
    expect(service.trocas()).toEqual([])
  })

  it('resposta vazia não vira troca — o histórico não guarda silêncio', async () => {
    const { deps: d } = deps({
      ai: {
        call: async function* (): AsyncIterable<AiStreamEvent> {
          yield { tipo: 'chunk', id: 'c-1', texto: '   ' }
          yield { tipo: 'fim', id: 'c-1', estado: 'concluido' }
        }
      }
    })
    const service = new ConversaService(d)

    expect((await service.perguntar('oi', 'jarvis')).estado).toBe('falhou')
    expect(service.trocas()).toEqual([])
  })
})

describe('nenhum caminho de ação (critério 8)', () => {
  it('o serviço não recebe nem expõe nada que execute', async () => {
    /*
     * A garantia é **estrutural**: as deps deste serviço são o ponto único, o contexto, a
     * persona, o snapshot e a disponibilidade. Não há filesystem, não há terminal, não há
     * conector — ele não teria como executar nada nem se o modelo pedisse.
     *
     * Este teste falha no dia em que alguém acrescentar uma dep de ação, que é exatamente quando
     * a decisão precisa voltar ao PI com spec própria.
     */
    const { deps: d } = deps()
    const chaves = Object.keys(d).sort()

    expect(chaves).toEqual([
      'ai',
      'janelaDoHistorico',
      // `modeloDaConversa` é **leitura de configuração**: devolve o nome do modelo da rota, o
      // mesmo que `rotaDisponivel` verifica. Não alcança nada nem executa nada.
      'modeloDaConversa',
      'montarContexto',
      'persona',
      'rotaDisponivel',
      'snapshot',
      'userId'
    ])
  })

  it('a resposta é texto, e nada além de texto', async () => {
    // O desfecho não carrega comando a executar, caminho a abrir nem id de ação. Se um dia
    // carregasse, a tela teria como disparar algo a partir de uma fala.
    const { deps: d } = deps()
    const desfecho = await new ConversaService(d).perguntar('oi', 'jarvis')

    expect(Object.keys(desfecho).sort()).toEqual(['estado', 'resposta'])
  })
})
