/**
 * A resolução de um perfil de Squad contra o ambiente (SPEC-Squads-01, critérios 2, 4 e 5).
 *
 * A pergunta que este arquivo responde: **neste ambiente, o perfil se sustenta?** Para cada
 * capacidade e camada, diz se há implementação, se cai num fallback ou se está indisponível — e
 * sempre com o motivo. Nada é resolvido em silêncio: um fallback é um resultado com nome, e é
 * isso que o orquestrador e o validador leem antes de aceitar um plano.
 *
 * Três decisões governam o arquivo:
 *
 *  - **Pura e sem consulta.** O ambiente (skills instaladas, ferramentas, estado do Ollama,
 *    opt-in) e o modelo da fase entram por parâmetro. Quem os mede é o chamador; aqui só se
 *    decide. É o que torna o snapshot reproduzível: mesmo perfil, mesmo ambiente, mesma resolução.
 *  - **Ollama fora do ar cai no modelo da fase** — que vem resolvido pela rota que o projeto
 *    escolheu (MVP-026). Esta função nunca escolhe rota.
 *  - **API paga sem opt-in não vira fallback: vira indisponível**, e a conferência vale para o
 *    modelo efetivo da camada — pedido pelo perfil, modelo da fase ou fallback do Ollama. Não se
 *    confia em que `escolherRota` já barrou: a regra 6 é desta camada também (SPEC-Squads-02,
 *    regra 5). Entregar outra rota, mesmo barata, seria a troca silenciosa que ela proíbe.
 */

import type { ModeloEscolhido } from './modelo-da-fase'
import type { SquadPlan } from './squad-plano'
import type { CapacidadeId, DefinicaoDeCapacidade } from './squad-capacidades'
import { isCamada, type Camada, type PerfilDeSquad } from './squad-perfil'
import { calcularCustoUsd, isRotaUnmetered } from './ai'
import { REGISTRO_DE_CAPACIDADES } from './squad-capacidades'
import { CAMADAS, limitesDoPerfil } from './squad-perfil'

/** O que o chamador mediu do mundo. Entra por parâmetro: esta função não olha o disco. */
export interface AmbienteDeResolucao {
  readonly skills: readonly string[]
  readonly ferramentas: readonly string[]
  readonly ollama: { readonly disponivel: boolean; readonly modelos: readonly string[] }
  /** Opt-in do projeto à rota paga (MVP-026). Sem ele, nenhuma camada usa API paga. */
  readonly optInApiPaga: boolean
}

export type MotivoDeResolucao =
  | 'IMPLEMENTACAO_AUSENTE'
  | 'SEM_IMPLEMENTACAO_NEM_FALLBACK'
  | 'OLLAMA_FORA_DO_AR'
  | 'MODELO_LOCAL_AUSENTE'
  | 'API_PAGA_SEM_OPT_IN'

export interface CamadaResolvida {
  readonly camada: Camada
  readonly estado: 'configurado' | 'fallback' | 'indisponivel'
  /** Ausente quando indisponível: não há modelo a chamar. */
  readonly modelo?: ModeloEscolhido
  readonly motivo?: MotivoDeResolucao
}

export interface CapacidadeNaCamada {
  readonly camada: Camada
  readonly estado: 'implementacao' | 'fallback' | 'indisponivel'
  /** `skill:nome`, `ferramenta:nome`, `prompt:id@versão` ou `modelo-local:ollama`. */
  readonly via?: string
  readonly motivo?: MotivoDeResolucao
}

export interface CapacidadeResolvida {
  readonly capacidade: CapacidadeId
  readonly obrigatoria: boolean
  readonly porCamada: readonly CapacidadeNaCamada[]
}

export interface ResolucaoDoPerfil {
  readonly camadas: Readonly<Record<Camada, CamadaResolvida>>
  readonly capacidades: readonly CapacidadeResolvida[]
  /** `false` quando falta capacidade obrigatória ou o revisor/integrador não tem camada. */
  readonly elegivel: boolean
  readonly motivosDeInelegibilidade: readonly string[]
}

/**
 * O `ollama list` costuma devolver `llama3.1:latest` para quem baixou sem tag, e o produto
 * escreve `llama3.1`. São o mesmo modelo; comparar por igualdade exata reportaria "ausente" para
 * quem o tem.
 */
const semTagLatest = (tag: string): string => (tag.endsWith(':latest') ? tag.slice(0, -7) : tag)

/** A camada como o perfil a pede, sem olhar o opt-in — quem checa o preço é `resolverCamada`. */
function candidataDaCamada(
  camada: Camada,
  perfil: PerfilDeSquad,
  ambiente: AmbienteDeResolucao,
  modeloDaFase: ModeloEscolhido
): CamadaResolvida {
  const origem = perfil.camadas[camada]
  if (origem.origem === 'fase') return { camada, estado: 'configurado', modelo: modeloDaFase }

  const modelo: ModeloEscolhido = { provider: origem.provider, modelo: origem.modelo }
  if (origem.provider !== 'ollama') return { camada, estado: 'configurado', modelo }

  if (!ambiente.ollama.disponivel) {
    return { camada, estado: 'fallback', modelo: modeloDaFase, motivo: 'OLLAMA_FORA_DO_AR' }
  }
  const instalados = ambiente.ollama.modelos.map(semTagLatest)
  if (!instalados.includes(semTagLatest(origem.modelo))) {
    return { camada, estado: 'fallback', modelo: modeloDaFase, motivo: 'MODELO_LOCAL_AUSENTE' }
  }
  return { camada, estado: 'configurado', modelo }
}

/**
 * Resolve uma camada e **depois** confere o preço do modelo efetivo, qualquer que seja a origem:
 * o pedido do perfil, o modelo da fase ou o fallback do Ollama. Conferir só o pedido explícito
 * deixaria a rota paga entrar por onde o perfil nunca a nomeou — a regra 6 vale para a camada, não
 * para o ramo que a produziu. Sem opt-in a camada fica indisponível, e não troca de rota.
 */
function resolverCamada(
  camada: Camada,
  perfil: PerfilDeSquad,
  ambiente: AmbienteDeResolucao,
  modeloDaFase: ModeloEscolhido
): CamadaResolvida {
  const candidata = candidataDaCamada(camada, perfil, ambiente, modeloDaFase)
  const { modelo } = candidata
  if (modelo !== undefined && !isRotaUnmetered(modelo.provider) && !ambiente.optInApiPaga) {
    return { camada, estado: 'indisponivel', motivo: 'API_PAGA_SEM_OPT_IN' }
  }
  return candidata
}

function resolverImplementacao(
  def: DefinicaoDeCapacidade,
  camada: CamadaResolvida,
  ambiente: AmbienteDeResolucao
): Omit<CapacidadeNaCamada, 'camada'> {
  if (camada.estado === 'indisponivel') {
    return { estado: 'indisponivel', motivo: camada.motivo }
  }

  for (const impl of def.implementacoes) {
    const presentes = impl.tipo === 'skill' ? ambiente.skills : ambiente.ferramentas
    if (presentes.includes(impl.nome)) {
      return { estado: 'implementacao', via: `${impl.tipo}:${impl.nome}` }
    }
  }

  for (const fallback of def.fallbacks) {
    if (fallback.tipo === 'prompt') {
      return { estado: 'fallback', via: `prompt:${fallback.id}`, motivo: 'IMPLEMENTACAO_AUSENTE' }
    }
    if (ambiente.ollama.disponivel && ambiente.ollama.modelos.length > 0) {
      return { estado: 'fallback', via: 'modelo-local:ollama', motivo: 'IMPLEMENTACAO_AUSENTE' }
    }
  }

  return { estado: 'indisponivel', motivo: 'SEM_IMPLEMENTACAO_NEM_FALLBACK' }
}

/**
 * Resolve o perfil inteiro. `registro` é parâmetro só para o teste montar um registro sem
 * prompt de reserva; em produção é sempre o `REGISTRO_DE_CAPACIDADES`.
 */
export function resolverPerfil(
  perfil: PerfilDeSquad,
  ambiente: AmbienteDeResolucao,
  modeloDaFase: ModeloEscolhido,
  registro: Readonly<Record<CapacidadeId, DefinicaoDeCapacidade>> = REGISTRO_DE_CAPACIDADES
): ResolucaoDoPerfil {
  const camadas = Object.fromEntries(
    CAMADAS.map((c) => [c, resolverCamada(c, perfil, ambiente, modeloDaFase)])
  ) as Record<Camada, CamadaResolvida>

  const capacidades: CapacidadeResolvida[] = perfil.capacidades.map((cap) => ({
    capacidade: cap.id,
    obrigatoria: cap.obrigatoria,
    porCamada: cap.camadas.map((camada) => ({
      camada,
      ...resolverImplementacao(registro[cap.id], camadas[camada], ambiente)
    }))
  }))

  const motivos: string[] = []

  for (const cap of capacidades) {
    if (cap.obrigatoria && cap.porCamada.every((c) => c.estado === 'indisponivel')) {
      const por = cap.porCamada.map((c) => `${c.camada}: ${c.motivo ?? '?'}`).join('; ')
      motivos.push(`capacidade obrigatória ${cap.capacidade} indisponível (${por})`)
    }
  }

  // O orquestrador entra: é a camada que planeja, e sem ela utilizável não há plano. Sem isto, um
  // modelo da fase pago sem opt-in deixava o perfil elegível quando as demais camadas eram
  // de assinatura, e o planejador chamava a rota paga.
  const papeis: readonly (readonly [string, Camada | undefined])[] = [
    ['orquestrador', 'orquestrador'],
    ['revisor', perfil.revisor.camada],
    ['integrador', perfil.integrador?.camada]
  ]
  for (const [papel, camada] of papeis) {
    if (camada !== undefined && camadas[camada].estado === 'indisponivel') {
      motivos.push(`${papel}: camada ${camada} indisponível (${camadas[camada].motivo ?? '?'})`)
    }
  }

  return { camadas, capacidades, elegivel: motivos.length === 0, motivosDeInelegibilidade: motivos }
}

export interface CustoMaximo {
  /** Cota superior em USD das camadas com preço. Zero se nenhuma camada usada é medida. */
  readonly usd: number
  /** As camadas que de fato entram na conta: usáveis e com preço por token. */
  readonly camadasMedidas: readonly Camada[]
  readonly slots: number
  readonly maxTarefas: number
}

export interface CustoDoPlano {
  readonly usd: number
  readonly camadasMedidas: readonly Camada[]
}

export interface LimitesAgregadosDoPlano extends CustoDoPlano {
  readonly tarefas: number
  readonly escritores: number
  readonly workers: number
  readonly chamadas: number
  readonly tokensEntrada: number
  readonly tokensSaida: number
  readonly turnos: number
  readonly duracaoMs: number
}

/**
 * Soma os limites das tarefas validadas, usando o modelo congelado da camada de cada tarefa.
 * Esta é a cota que acompanha o run; não usa multiplicador por camada nem por tarefa hipotética.
 */
export function limitesAgregadosDoPlano(
  plano: SquadPlan,
  resolucao: ResolucaoDoPerfil
): LimitesAgregadosDoPlano {
  const camadasMedidas = new Set<Camada>()
  const escritores = new Set<string>()
  let usd = 0
  let chamadas = 0
  let tokensEntrada = 0
  let tokensSaida = 0
  let turnos = 0
  let duracaoMs = 0
  let workers = 0

  for (const tarefa of plano.tarefas) {
    const escreve = tarefa.escritor !== undefined && tarefa.escritor.length > 0
    if (escreve) escritores.add(tarefa.escritor as string)
    else workers += 1
    chamadas += 1
    tokensEntrada += tarefa.limites.maxTokensEntrada
    tokensSaida += tarefa.limites.maxTokensSaida
    turnos += tarefa.limites.maxTurnos
    duracaoMs += tarefa.limites.maxMinutos * 60_000
    if (!isCamada(tarefa.camada)) continue
    const modelo = resolucao.camadas[tarefa.camada].modelo
    if (modelo !== undefined && !isRotaUnmetered(modelo.provider)) {
      camadasMedidas.add(tarefa.camada)
      usd += calcularCustoUsd(modelo.provider, modelo.modelo, {
        tokensEntrada: tarefa.limites.maxTokensEntrada,
        tokensSaida: tarefa.limites.maxTokensSaida
      })
    }
  }

  return {
    tarefas: plano.tarefas.length,
    escritores: escritores.size,
    workers,
    chamadas,
    tokensEntrada,
    tokensSaida,
    turnos,
    duracaoMs,
    usd,
    camadasMedidas: [...camadasMedidas]
  }
}

/** Apenas o trecho monetário para telas e contratos que exibem o USD do plano. */
export const custoDoPlanoUsd = (plano: SquadPlan, resolucao: ResolucaoDoPerfil): CustoDoPlano => {
  const limites = limitesAgregadosDoPlano(plano, resolucao)
  return { usd: limites.usd, camadasMedidas: limites.camadasMedidas }
}

/**
 * O custo e os limites máximos **antes** de instanciar o Squad (critério 4).
 *
 * Pior caso, como `estimarCustoUsd`: toda tarefa, até o teto, na camada paga mais cara, com o
 * teto de tokens de entrada e saída. Subestimar é o erro que importa evitar — o gate de
 * orçamento decide em cima deste número. Camada de assinatura ou local não tem USD por chamada
 * e fica fora da conta; `camadasMedidas` diz quais entraram, para zero não ser lido como "grátis".
 */
export function custoMaximoUsd(
  perfil: PerfilDeSquad,
  resolucao: ResolucaoDoPerfil,
  criteriosDaSpec: number
): CustoMaximo {
  const { slots, maxTarefas } = limitesDoPerfil(perfil, criteriosDaSpec)
  const tokens = {
    tokensEntrada: perfil.limites.maxTokensEntradaPorTarefa,
    tokensSaida: perfil.limites.maxTokensSaidaPorTarefa
  }

  const medidas = CAMADAS.flatMap((camada) => {
    const { modelo } = resolucao.camadas[camada]
    if (modelo === undefined || isRotaUnmetered(modelo.provider)) return []
    return [{ camada, porTarefa: calcularCustoUsd(modelo.provider, modelo.modelo, tokens) }]
  })

  const maisCara = Math.max(0, ...medidas.map((m) => m.porTarefa))
  return {
    usd: maxTarefas * maisCara,
    camadasMedidas: medidas.map((m) => m.camada),
    slots,
    maxTarefas
  }
}
