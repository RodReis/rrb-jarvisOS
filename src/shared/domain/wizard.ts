/**
 * O wizard orientado — o grafo de perguntas e as regras da decisão (SPEC-Planejamento-03).
 *
 * A pergunta que este arquivo responde: **qual é a próxima decisão que o PI precisa tomar, e o
 * que acontece com as decisões que já tomou quando ele muda de ideia?**
 *
 * Três coisas, e a separação entre elas é a decisão central da fatia:
 *
 *  - **`Pergunta`** é o contrato de UI da spec § Contrato da pergunta, em forma de dado. Título,
 *    opções mutuamente exclusivas, recomendada primeiro, impacto declarado. A tela renderiza o
 *    que está aqui; ela não inventa pergunta nem reordena opção.
 *  - **`Decision`** é o que ficou decidido — com **autoria**. É entidade do `CONVENTION.md` §4
 *    ("escolha, recomendação, justificativa e autoria") e é o que distingue *quem escolheu* de
 *    *quem aceitou*: "Decide por mim" grava o agente como autor, nunca o PI (invariante 3).
 *  - **O grafo** é o que decide a ordem. Uma pergunta só é feita quando é **relevante** — sua
 *    `relevante` diz, a partir das decisões já tomadas, se ela ainda faz sentido. Pergunta
 *    irrelevante é omitida (spec § Regras), não é feita e respondida com default.
 *
 * **Por que `Decision` não mora dentro de `PlanningSession.respostas`.** O JSON opaco da F01
 * guarda *a resposta atual*; ele sobrescreve. Mas o critério 5 ("contradição nunca é corrigida
 * silenciosamente") exige mostrar **a decisão anterior** ao propor a substituição, e o critério
 * 3 exige trilha de quem delegou. Um mapa que sobrescreve não tem nem histórico nem autor. Por
 * isso a decisão é linha própria, append-only, e `respostas` continua sendo o rascunho.
 *
 * **O que este arquivo não faz:** não persiste (isso é o repositório, no main), não chama modelo
 * (a recomendação chega pronta) e **não inventa requisito**. A invariante 9 do `CONVENTION.md` é
 * literal aqui: nenhuma pergunta deste grafo oferece LGPD, consentimento, aceite duplo ou
 * classificação por domínio — e o teste `wizard.spec.ts` prova isso varrendo o catálogo.
 *
 * Mora em `src/shared/domain` porque a tela renderiza a pergunta e mostra a contradição, e o
 * contrato precisa ser verificável sem carregar o Electron.
 */

import type { WorkspaceId } from './entities'

/**
 * Quem escolheu. Enum fechado, e não um booleano `delegado`: a auditoria precisa distinguir os
 * dois autores sem inferir, e é essa distinção que sustenta a invariante 3 do `CONVENTION.md`
 * §4 — o agente **decide**, mas decisão de agente **não aprova gate**.
 */
export const AUTORES_DA_DECISAO = [
  /** O PI escolheu explicitamente. É o único autor que pode aprovar gate. */
  'pi',
  /** O agente escolheu sob "Decide por mim". Registra escolha; nunca aprova gate. */
  'agente'
] as const

export type AutorDaDecisao = (typeof AUTORES_DA_DECISAO)[number]

/**
 * Por que a decisão entrou assim. Enum fechado pelo mesmo motivo que `ProjectReason` é: a UI
 * decide o que mostrar a partir dele, e um motivo novo é mudança de contrato.
 */
export const DECISION_REASONS = [
  /** Escolha direta numa das opções oferecidas. */
  'escolhida',
  /** Texto livre, quando a pergunta admite e nenhuma opção serve. */
  'texto-livre',
  /** Delegada ao agente por "Decide por mim"; grava a recomendação como escolha. */
  'delegada',
  /** Substituiu uma decisão anterior contraditória, com o aceite explícito do PI. */
  'substituida',
  /** Pergunta deixou de ser relevante por causa de outra decisão; não foi feita. */
  'omitida'
] as const

export type DecisionReason = (typeof DECISION_REASONS)[number]

/**
 * Uma opção da pergunta. `impacto` não é enfeite: a spec § Contrato da pergunta exige
 * "impacto/trade-off de cada opção", e o critério 2 exige que a recomendação seja
 * *distinguível mas não forçada* — o PI só escolhe informado se cada opção declara o que custa.
 */
export interface OpcaoDaPergunta {
  readonly id: string
  readonly rotulo: string
  /** O trade-off desta opção, em uma frase. Obrigatório: opção sem impacto é opção sem escolha. */
  readonly impacto: string
}

/**
 * Uma pergunta do wizard. **Uma pergunta por pop-up** é contrato, não sugestão (spec § Decisões
 * cravadas), então este tipo descreve exatamente uma decisão — nunca um formulário.
 *
 * `recomendada` é o id de uma das `opcoes` e é sempre apresentada primeiro; `justificativa`
 * explica por quê. As duas juntas são o que "Decide por mim" grava quando delega — por isso
 * `delegavel` só pode ser verdadeiro quando há recomendação.
 */
export interface Pergunta {
  readonly id: string
  readonly etapa: string
  readonly titulo: string
  readonly enunciado: string
  /** Duas ou três opções mutuamente exclusivas (spec § Contrato da pergunta). */
  readonly opcoes: readonly OpcaoDaPergunta[]
  /** Id da opção recomendada. Ela é renderizada primeiro. */
  readonly recomendada: string
  readonly justificativa: string
  /** Se o PI pode responder fora das opções. */
  readonly aceitaTextoLivre: boolean
  /** Se "Decide por mim" é oferecido. Decisão irreversível não é delegável. */
  readonly delegavel: boolean
  /**
   * Se esta pergunta ainda faz sentido dadas as decisões já tomadas. Pergunta irrelevante é
   * **omitida**, não respondida por default (spec § Regras).
   */
  readonly relevante?: (decisoes: DecisoesPorPergunta) => boolean
  /**
   * Ids de perguntas cujas respostas dependem desta. Mudar esta decisão recalcula **somente**
   * estas (critério 4), nunca o wizard inteiro.
   */
  readonly dependentes?: readonly string[]
}

/**
 * Uma decisão tomada. Append-only: revisar uma resposta **acrescenta** outra linha com
 * `substituiu` apontando para esta, e nunca edita a anterior. É o que permite ao critério 5
 * mostrar a decisão anterior ao propor a substituição.
 */
export interface Decision {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly projectId: string
  readonly perguntaId: string
  readonly etapa: string
  /** Id da opção escolhida, ou `null` quando a resposta é texto livre. */
  readonly escolha: string | null
  /** Texto livre, quando houve. */
  readonly texto: string | null
  /** O que fora recomendado no momento da decisão — preservado mesmo quando o PI recusou. */
  readonly recomendacao: string
  readonly justificativa: string
  readonly autor: AutorDaDecisao
  readonly motivo: DecisionReason
  /** Id da decisão que esta substituiu, quando houve contradição resolvida. */
  readonly substituiu: string | null
  readonly created_at: string
}

/** As decisões vigentes, indexadas pela pergunta. Só a última de cada pergunta. */
export type DecisoesPorPergunta = Readonly<Record<string, Decision>>

/**
 * O que o wizard mostra agora. União fechada porque a tela precisa distinguir os três estados
 * sem inferir de campo nulo: há pergunta, acabou, ou está bloqueado com motivo.
 */
export type EstadoDoWizard =
  | { readonly tipo: 'pergunta'; readonly pergunta: Pergunta; readonly restantes: number }
  | { readonly tipo: 'concluido'; readonly decisoes: readonly Decision[] }
  | { readonly tipo: 'bloqueado'; readonly motivo: string; readonly retomada: string }

/**
 * Uma contradição detectada: a decisão nova conflita com uma já tomada. A spec proíbe corrigir
 * silenciosamente, então isto **não** é aplicado — é devolvido para o PI ver e aceitar.
 */
export interface Contradicao {
  readonly anterior: Decision
  readonly perguntaAfetada: string
  readonly impacto: string
}

/**
 * As perguntas relevantes, na ordem, dadas as decisões já tomadas.
 *
 * Filtra por `relevante` e **não** por "já respondida" — quem faz esse corte é
 * `proximaPergunta`, porque revisar uma resposta precisa poder voltar a uma pergunta já
 * decidida sem ela sumir do grafo.
 */
export function perguntasRelevantes(
  catalogo: readonly Pergunta[],
  decisoes: DecisoesPorPergunta
): readonly Pergunta[] {
  return catalogo.filter((pergunta) => pergunta.relevante?.(decisoes) ?? true)
}

/**
 * A próxima pergunta a fazer, ou `null` quando não sobrou nenhuma.
 *
 * **Uma de cada vez** (critério 1): devolve a primeira relevante ainda sem decisão vigente.
 * Sessão interrompida retoma exatamente aqui, porque o cálculo depende só das decisões
 * gravadas — não de onde a tela achava que estava (critério 6).
 */
export function proximaPergunta(
  catalogo: readonly Pergunta[],
  decisoes: DecisoesPorPergunta
): Pergunta | null {
  return perguntasRelevantes(catalogo, decisoes).find((p) => decisoes[p.id] === undefined) ?? null
}

/**
 * As perguntas que precisam ser revistas porque `perguntaId` mudou.
 *
 * Recalcula **somente dependências afetadas** (critério 4): as `dependentes` declaradas que já
 * têm decisão vigente. Uma dependente ainda não respondida não precisa de revisão — ela nem
 * chegou a ser feita. Não é transitivo de propósito: cada nível é confirmado pelo PI, e cascata
 * automática invalidaria decisões que ele nunca viu.
 */
export function dependenciasAfetadas(
  catalogo: readonly Pergunta[],
  decisoes: DecisoesPorPergunta,
  perguntaId: string
): readonly string[] {
  const pergunta = catalogo.find((p) => p.id === perguntaId)
  if (!pergunta?.dependentes) return []
  return pergunta.dependentes.filter((id) => decisoes[id] !== undefined)
}

/**
 * As contradições que a decisão nova cria — sem aplicá-las.
 *
 * O critério 5 é o motivo de esta função devolver em vez de corrigir: o PI vê a decisão
 * anterior, o impacto e a substituição proposta, e aceita. Corrigir aqui seria exatamente o
 * silêncio que a spec proíbe.
 */
export function detectarContradicoes(
  catalogo: readonly Pergunta[],
  decisoes: DecisoesPorPergunta,
  perguntaId: string
): readonly Contradicao[] {
  return dependenciasAfetadas(catalogo, decisoes, perguntaId).flatMap((afetada) => {
    const anterior = decisoes[afetada]
    if (anterior === undefined) return []
    const pergunta = catalogo.find((p) => p.id === afetada)
    return [
      {
        anterior,
        perguntaAfetada: afetada,
        impacto: pergunta?.titulo ?? afetada
      }
    ]
  })
}

/**
 * O que "Decide por mim" grava: a recomendação da própria pergunta, com o **agente** como autor.
 *
 * Devolve `null` para pergunta não delegável — a recusa é do domínio, não da tela. Se fosse a
 * UI a esconder o botão, um caminho novo (atalho de teclado, IPC direto) delegaria o que não
 * podia ser delegado.
 */
export function decidirPorMim(
  pergunta: Pergunta
): Pick<
  Decision,
  'escolha' | 'texto' | 'recomendacao' | 'justificativa' | 'autor' | 'motivo'
> | null {
  if (!pergunta.delegavel) return null
  return {
    escolha: pergunta.recomendada,
    texto: null,
    recomendacao: pergunta.recomendada,
    justificativa: pergunta.justificativa,
    autor: 'agente',
    motivo: 'delegada'
  }
}

/** O que o serviço acrescenta à decisão: identidade, escopo e instante. */
export interface EscopoDaDecisao {
  readonly id: string
  readonly user_id: string
  readonly workspace_id: WorkspaceId
  readonly projectId: string
  readonly created_at: string
}

export type DecisaoMontada =
  | { readonly decisao: Decision }
  | { readonly recusa: 'nao-delegavel' | 'escolha-invalida'; readonly mensagem: string }

/**
 * Monta a `Decision` de uma resposta — ou recusa, pelo vocabulário da pergunta.
 *
 * É a mecânica que o refinamento (M25-F02) e as contradições do PRD (emenda E1 da
 * SPEC-Jornada-03) compartilham: a delegação tem de ser permitida pelo domínio, a escolha tem
 * de ser opção real (ou texto livre onde cabe), e responder de novo **substitui** a anterior em
 * vez de editá-la. Pura de propósito: quem chama decide onde gravar e o que auditar.
 *
 * Validar a escolha aqui, e não só na tela, é o que impede o IPC de gravar decisão impossível:
 * o renderer é fronteira não confiável.
 */
export function montarDecisao(entrada: {
  readonly pergunta: Pergunta
  readonly resposta: Resposta
  readonly anterior: Decision | undefined
  readonly escopo: EscopoDaDecisao
}): DecisaoMontada {
  const { pergunta, resposta, anterior, escopo } = entrada

  const delegada = resposta.autor === 'agente'
  const decidida = delegada ? decidirPorMim(pergunta) : null
  if (delegada && decidida === null) {
    return {
      recusa: 'nao-delegavel',
      mensagem: 'Esta decisão precisa do PI e não pode ser delegada.'
    }
  }

  const escolha = decidida?.escolha ?? resposta.escolha
  const texto = decidida ? null : resposta.texto
  const valida =
    escolha !== null
      ? pergunta.opcoes.some((o) => o.id === escolha)
      : texto !== null && pergunta.aceitaTextoLivre && texto.trim().length > 0
  if (!valida) {
    return { recusa: 'escolha-invalida', mensagem: 'Escolha inválida para esta pergunta.' }
  }

  return {
    decisao: {
      ...escopo,
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
      substituiu: anterior?.id ?? null
    }
  }
}

/**
 * Se esta decisão pode aprovar um gate. **Decisão de agente nunca aprova** — invariante 3 do
 * `CONVENTION.md` §4, aqui como função para que o gate pergunte ao domínio em vez de cada
 * chamador lembrar da regra.
 */
export function podeAprovarGate(decisao: Decision): boolean {
  return decisao.autor === 'pi'
}

/**
 * A opção recomendada primeiro, o resto na ordem declarada (spec § Contrato da pergunta).
 *
 * Ordena aqui, e não na tela, porque "recomendada primeiro" é contrato do domínio: uma segunda
 * superfície que renderizasse a pergunta teria de reimplementar a regra para não contrariá-la.
 */
export function opcoesOrdenadas(pergunta: Pergunta): readonly OpcaoDaPergunta[] {
  const recomendada = pergunta.opcoes.filter((o) => o.id === pergunta.recomendada)
  const demais = pergunta.opcoes.filter((o) => o.id !== pergunta.recomendada)
  return [...recomendada, ...demais]
}

/** Só a decisão vigente de cada pergunta, a partir do histórico append-only. */
export function decisoesVigentes(historico: readonly Decision[]): DecisoesPorPergunta {
  const substituidas = new Set(
    historico.map((d) => d.substituiu).filter((id): id is string => id !== null)
  )
  const vigentes: Record<string, Decision> = {}
  for (const decisao of historico) {
    if (substituidas.has(decisao.id)) continue
    if (decisao.motivo === 'omitida') continue
    vigentes[decisao.perguntaId] = decisao
  }
  return vigentes
}

/**
 * O estado do wizard agora: pergunta pendente, conclusão ou bloqueio.
 *
 * O critério 7 exige que o wizard termine com **resumo de decisões e lacunas zeradas ou
 * bloqueio explicável** — e o `EstadoDoWizard` não deixa terminar de outro jeito: não há estado
 * "acabou, sei lá por quê".
 */
export function estadoDoWizard(
  catalogo: readonly Pergunta[],
  historico: readonly Decision[]
): EstadoDoWizard {
  const decisoes = decisoesVigentes(historico)
  const pergunta = proximaPergunta(catalogo, decisoes)
  if (pergunta === null) {
    return { tipo: 'concluido', decisoes: historico }
  }
  const relevantes = perguntasRelevantes(catalogo, decisoes)
  const restantes = relevantes.filter((p) => decisoes[p.id] === undefined).length
  return { tipo: 'pergunta', pergunta, restantes }
}

/**
 * Por que uma tentativa de responder terminou assim. Enum fechado pelo mesmo motivo que
 * `ProjectReason` é: a tela escolhe o que mostrar a partir dele, e motivo novo é mudança de
 * contrato — nunca uma string que vaza de um `catch` para a interface.
 */
export const WIZARD_REASONS = [
  'registrada',
  'projeto-inexistente',
  'pergunta-desconhecida',
  'escolha-invalida',
  'nao-delegavel',
  /** A resposta invalida decisões já tomadas e o PI ainda não aceitou a substituição. */
  'contradicao-pendente'
] as const

export type WizardReason = (typeof WIZARD_REASONS)[number]

/**
 * O desfecho de responder. Recusa volta como *outcome*, nunca como promise rejeitada — mesma
 * postura do `ProjectOutcome`.
 *
 * Mora aqui, e não no serviço do main, porque a tela decide por ele: um tipo do `main/` seria
 * invisível ao renderer, que teria de redeclará-lo e sairia de sincronia na primeira mudança.
 */
export interface RespostaOutcome {
  readonly reason: WizardReason
  readonly decisao?: Decision
  /** Preenchido só em `contradicao-pendente`: o que o PI precisa ver antes de aceitar. */
  readonly contradicoes?: readonly Contradicao[]
  readonly estado?: EstadoDoWizard
  readonly mensagem: string
}

/**
 * O que o renderer manda ao responder. `escolha` e `texto` são mutuamente exclusivos, e a
 * validação de qual vale para cada pergunta é do serviço — a fronteira não confia na tela.
 */
export interface Resposta {
  readonly perguntaId: string
  readonly escolha: string | null
  readonly texto: string | null
  readonly autor: AutorDaDecisao
  /** Aceite explícito do PI para substituir as decisões contraditórias já mostradas. */
  readonly aceitarSubstituicao?: boolean
}

/**
 * O que a tela precisa para renderizar o wizard: o estado e o histórico.
 *
 * Vão juntos num canal só porque a tela sempre precisa dos dois — o resumo do critério 7 é o
 * histórico, e a pergunta pendente é o estado. Dois canais fariam a tela emitir duas chamadas
 * que nunca se usam separadas.
 */
export interface VistaDoWizard {
  readonly estado: EstadoDoWizard
  readonly historico: readonly Decision[]
}

/** Type guard de fronteira: o IPC recebe `unknown` e não confia no renderer. */
export function isAutorDaDecisao(valor: unknown): valor is AutorDaDecisao {
  return typeof valor === 'string' && (AUTORES_DA_DECISAO as readonly string[]).includes(valor)
}

/** Type guard de fronteira, pelo mesmo motivo. */
export function isDecisionReason(valor: unknown): valor is DecisionReason {
  return typeof valor === 'string' && (DECISION_REASONS as readonly string[]).includes(valor)
}
