/**
 * A jornada de planejamento de um projeto (SPEC-Jornada-01).
 *
 * A pergunta que este arquivo responde: **em que ponto do planejamento este projeto está, e
 * qual é o único próximo passo?** O MVP-008 entregou as peças (wizard, pacote, anexos,
 * roadmap, aprovações) sem uma ordem visível entre elas, e a tela virava um menu de botões
 * onde o PI tinha de adivinhar o que fazer primeiro. Esta fatia dá a ordem.
 *
 * Três decisões governam o arquivo:
 *
 *  - **A etapa é derivada, não declarada.** `etapaDerivada` recalcula a partir dos eventos já
 *    ocorridos (marcos commitados, aprovações registradas). A coluna é cache: quando ela
 *    discorda do cálculo, o cálculo vence e o desvio é auditado (critério 2). Um valor que só
 *    o código escreve viraria uma segunda fonte de verdade sobre o que as aprovações já dizem.
 *  - **Transição só por evento nomeado** (critério 1). Não existe "setar etapa": existe
 *    `avancar(etapa, evento)`, e um evento que não corresponde à etapa atual é recusado. É a
 *    mesma postura fail-closed do Policy Engine — o que não é reconhecido não passa.
 *  - **Regressão é first-class** (critério 7). Invalidação de gate não é erro: é o desfecho
 *    legítimo de mudar um documento a montante, e a trilha mostra o motivo.
 *
 * Mora em `src/shared/domain` porque a trilha é desenhada no renderer e a regra precisa ser
 * verificável sem carregar o Electron — mesma razão de `projects.ts` e `aprovacoes.ts`.
 */

import type { Gate } from './aprovacoes'

/**
 * As etapas da jornada, **em ordem**. O índice no array é a posição na trilha: é o que permite
 * dizer "concluída, atual ou futura" por comparação, sem um segundo mapa de ordem que poderia
 * divergir desta lista.
 */
export const ETAPAS = [
  'prompt',
  'refinamento',
  'brief-aceito',
  'prd',
  'prd-aceito',
  'design',
  'arquitetura',
  'pacote-aceito',
  'roadmap',
  'mvp-aceito',
  'spec-aceita',
  'construcao'
] as const

export type Etapa = (typeof ETAPAS)[number]

export function isEtapa(value: unknown): value is Etapa {
  return typeof value === 'string' && (ETAPAS as readonly string[]).includes(value)
}

/** A posição da etapa na trilha. Fonte única da ordem: derivada de `ETAPAS`, não repetida. */
export function ordemDaEtapa(etapa: Etapa): number {
  return ETAPAS.indexOf(etapa)
}

/**
 * As etapas de aceite que têm gate formal no contrato de `aprovacoes.ts`. Os três gates são
 * fechados por decisão daquela spec, e um quarto seria mudança de contrato.
 */
export const GATE_DA_ETAPA: Readonly<Partial<Record<Etapa, Gate>>> = {
  'pacote-aceito': 'PROJECT_PACKAGE',
  'mvp-aceito': 'MVP_ENTRY',
  'spec-aceita': 'SLICE_ENTRY'
}

/**
 * Todas as etapas que só avançam com aceite do PI (SPEC-Planejamento-06, critério 4).
 *
 * `brief-aceito` e `prd-aceito` também são aceites do PI, mas são **documentais**: avançam por
 * evento de aceite e a evidência é a revisão commitada, sem gate próprio em `aprovacoes.ts`.
 * A distinção vive em `GATE_DA_ETAPA`; a exigência de aceite vive aqui.
 */
export const ETAPAS_DE_ACEITE: readonly Etapa[] = [
  'brief-aceito',
  'prd-aceito',
  'pacote-aceito',
  'mvp-aceito',
  'spec-aceita'
]

export function exigeAceiteDoPi(etapa: Etapa): boolean {
  return ETAPAS_DE_ACEITE.includes(etapa)
}

/**
 * Os eventos que movem a jornada. Fechado e nomeado pela mesma razão que `MarcoDocumental` é:
 * a transição é determinística por evento, e um evento novo é mudança de contrato — nunca uma
 * string que vaza de um call site para a máquina de estados.
 */
export const EVENTOS = [
  'prompt-salvo',
  'refinamento-respondido',
  'brief-aceito',
  'prd-gerado',
  'prd-aceito',
  'design-anexado',
  'arquitetura-gerada',
  'pacote-aceito',
  'roadmap-gerado',
  'mvp-aceito',
  'spec-aceita'
] as const

export type EventoDeJornada = (typeof EVENTOS)[number]

export function isEventoDeJornada(value: unknown): value is EventoDeJornada {
  return typeof value === 'string' && (EVENTOS as readonly string[]).includes(value)
}

/**
 * A transição de cada evento: de onde ele sai e para onde leva.
 *
 * **Dado, não lógica.** Um `switch` espalharia a mesma tabela por ramos onde um caso faltando
 * passaria despercebido; aqui, uma etapa sem evento de saída é visível na leitura. Mesma
 * postura do `MENSAGEM_DO_MARCO`.
 */
export const TRANSICOES: Readonly<
  Record<EventoDeJornada, { readonly de: Etapa; readonly para: Etapa }>
> = {
  'prompt-salvo': { de: 'prompt', para: 'refinamento' },
  'refinamento-respondido': { de: 'refinamento', para: 'brief-aceito' },
  'brief-aceito': { de: 'brief-aceito', para: 'prd' },
  'prd-gerado': { de: 'prd', para: 'prd-aceito' },
  'prd-aceito': { de: 'prd-aceito', para: 'design' },
  'design-anexado': { de: 'design', para: 'arquitetura' },
  'arquitetura-gerada': { de: 'arquitetura', para: 'pacote-aceito' },
  'pacote-aceito': { de: 'pacote-aceito', para: 'roadmap' },
  'roadmap-gerado': { de: 'roadmap', para: 'mvp-aceito' },
  'mvp-aceito': { de: 'mvp-aceito', para: 'spec-aceita' },
  'spec-aceita': { de: 'spec-aceita', para: 'construcao' }
}

/** Por que uma transição foi recusada, ou por que ela passou. */
export const RESULTADOS_DE_TRANSICAO = [
  'avancou',
  'evento-desconhecido',
  'evento-fora-de-ordem',
  'aceite-ausente',
  /**
   * O aceite documental não pôde ser commitado (correção #259).
   *
   * Desfecho, não exceção: Git indisponível ou repositório travado é situação que o PI resolve
   * e repete. Mover a etapa sem a evidência produziria o defeito que esta correção conserta —
   * uma coluna adiante dos fatos, desfeita na leitura seguinte.
   */
  'marco-nao-commitado'
] as const

export type ResultadoDeTransicao = (typeof RESULTADOS_DE_TRANSICAO)[number]

export interface TransicaoOutcome {
  readonly resultado: ResultadoDeTransicao
  /** A etapa depois da tentativa. Igual à de entrada quando a transição foi recusada. */
  readonly etapa: Etapa
  readonly mensagem: string
}

/**
 * Aplica um evento à etapa atual.
 *
 * Recusa em vez de estourar: um evento fora de ordem é desfecho legítimo (dois cliques, uma
 * aba velha) que a UI mostra, não uma exceção que derruba o fluxo — mesma postura de
 * `ProjectOutcome`.
 *
 * `temAceiteDoPi` é passado, não consultado aqui: o domínio não faz I/O. Quem chama já tem as
 * aprovações em mãos, e é lá que a consulta pertence.
 */
export function avancar(atual: Etapa, evento: string, temAceiteDoPi = false): TransicaoOutcome {
  if (!isEventoDeJornada(evento)) {
    return {
      resultado: 'evento-desconhecido',
      etapa: atual,
      mensagem: `O evento "${evento}" não existe na jornada.`
    }
  }

  const transicao = TRANSICOES[evento]

  if (transicao.de !== atual) {
    return {
      resultado: 'evento-fora-de-ordem',
      etapa: atual,
      mensagem: `O evento "${evento}" sai da etapa "${transicao.de}", e o projeto está em "${atual}".`
    }
  }

  // O aceite é conferido na etapa de onde se sai, não na de destino: é a etapa de aceite que
  // exige o Approval, e sair dela sem ele é justamente o que o critério proíbe.
  if (exigeAceiteDoPi(atual) && !temAceiteDoPi) {
    return {
      resultado: 'aceite-ausente',
      etapa: atual,
      mensagem: `A etapa "${atual}" só avança com aceite do PI.`
    }
  }

  return {
    resultado: 'avancou',
    etapa: transicao.para,
    mensagem: `A jornada avançou para "${transicao.para}".`
  }
}

export interface RegressaoOutcome {
  readonly etapa: Etapa
  readonly regrediu: boolean
  readonly motivo: string
}

/**
 * Regride para a primeira etapa não invalidada (critério 7).
 *
 * Recebe etapas, não gates: quem chama traduz gate → etapa, porque é lá que o mapa das
 * aprovações está. A regressão vai para a **menor** ordem invalidada — parar na última
 * deixaria etapas inválidas atrás dela ainda marcadas como concluídas.
 *
 * Invalidação de etapa futura não move nada: não se regride para frente.
 */
export function regredir(
  atual: Etapa,
  invalidadas: readonly Etapa[],
  motivo: string
): RegressaoOutcome {
  const destino = invalidadas
    .filter((e) => ordemDaEtapa(e) < ordemDaEtapa(atual))
    .sort((a, b) => ordemDaEtapa(a) - ordemDaEtapa(b))[0]

  if (!destino) {
    return { etapa: atual, regrediu: false, motivo }
  }

  return { etapa: destino, regrediu: true, motivo }
}

/**
 * A etapa que os fatos sustentam — o cálculo do critério 2.
 *
 * Segue a cadeia a partir do início e para no primeiro buraco. Parar no buraco é o que impede
 * um evento solto lá na frente (gravado por um fluxo antigo) de declarar concluído tudo que
 * veio antes dele.
 *
 * Projeto sem nenhum fato → `prompt`. É o que faz a migração funcionar sem caso especial: um
 * projeto do fluxo antigo não tem brief nem origem de modelo, então nenhum evento consta, e
 * ele abre na primeira etapa (critério 6).
 */
export function etapaDerivada(eventos: readonly string[]): Etapa {
  const ocorridos = new Set(eventos.filter(isEventoDeJornada))

  let etapa: Etapa = 'prompt'

  for (;;) {
    const proximo = EVENTOS.find((e) => TRANSICOES[e].de === etapa && ocorridos.has(e))
    if (!proximo) return etapa
    etapa = TRANSICOES[proximo].para
  }
}

/** Onde uma etapa está em relação à atual. É o que a trilha desenha. */
export type PosicaoNaTrilha = 'concluida' | 'atual' | 'futura'

export function posicaoNaTrilha(etapa: Etapa, atual: Etapa): PosicaoNaTrilha {
  const ordem = ordemDaEtapa(etapa)
  const ordemAtual = ordemDaEtapa(atual)

  if (ordem < ordemAtual) return 'concluida'
  if (ordem === ordemAtual) return 'atual'
  return 'futura'
}

/**
 * O rótulo do **único** CTA da etapa (critério 3). Dado, não lógica: um `switch` na tela
 * espalharia a decisão de produto pelo renderer.
 */
export const CTA_DA_ETAPA: Readonly<Record<Etapa, string>> = {
  prompt: 'Escrever o prompt',
  refinamento: 'Responder o refinamento',
  'brief-aceito': 'Aceitar o brief',
  prd: 'Gerar o PRD',
  'prd-aceito': 'Aceitar o PRD',
  design: 'Anexar design',
  arquitetura: 'Gerar a arquitetura',
  'pacote-aceito': 'Aceitar o pacote',
  roadmap: 'Gerar o roadmap',
  'mvp-aceito': 'Aceitar o MVP',
  'spec-aceita': 'Aceitar a SPEC',
  construcao: 'Acompanhar a construção'
}

/**
 * O que falta para chegar numa etapa futura (critério 4). Etapa futura não aceita ação; o que
 * falta é **dito**, e esta é a frase.
 */
export function oQueFaltaPara(etapa: Etapa, atual: Etapa): string | null {
  if (posicaoNaTrilha(etapa, atual) !== 'futura') return null
  return `Conclua "${CTA_DA_ETAPA[atual]}" para chegar aqui.`
}

/**
 * Uma etapa como a trilha a desenha (critérios 3 e 4).
 *
 * Mora aqui, e não no serviço do main, porque atravessa a ponte IPC: o contrato de
 * `contracts/ipc.ts` precisa do tipo, e ele não pode importar do processo principal.
 */
export interface EtapaNaTrilha {
  readonly etapa: Etapa
  readonly posicao: PosicaoNaTrilha
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

/**
 * A trilha inteira em relação à etapa atual. Pura: quem tem a etapa desenha a trilha sem
 * precisar do banco, e é o que permite o renderer montá-la a partir do estado recebido.
 */
export function montarTrilha(atual: Etapa): readonly EtapaNaTrilha[] {
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
