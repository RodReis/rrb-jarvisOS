/**
 * Resolução de skills por **capacidade** (SPEC-Planejamento-02 § Skills, critério 5).
 *
 * A frase da spec que governa este arquivo: *"a ausência de `brainstorming`, Caveman, Graphify
 * ou equivalente não bloqueia: o fluxo aplica perguntas, escopo, compressão e revisão
 * diretamente"*. Traduzida em código, isso quer dizer uma coisa só, e ela é estrutural:
 *
 * **O fluxo pede a capacidade, nunca a skill.** Quem pergunta "tenho `brainstorming`?" escreve
 * um `if` em torno de uma ferramenta, e o dia em que a ferramenta some é o dia em que a
 * disciplina some junto. Quem pergunta "como faço `perguntas-de-escopo`?" recebe **sempre** uma
 * resposta: a skill quando ela existe, o procedimento direto quando não existe. O gate
 * correspondente não tem como sumir porque ele não está atrás de um `if`.
 *
 * A decisão cravada pelo Cowork na spec é o corolário disto: **nenhuma skill vira dependência
 * de build**. Elas não são importadas, não são resolvidas em tempo de compilação e não
 * aparecem no `package.json` — são nomes que um registro pode conhecer ou não.
 *
 * Mora em `src/shared/domain` porque a tela mostra qual capacidade foi aplicada por qual meio
 * (skill ou fallback), e o contrato precisa ser verificável sem Electron.
 */

/**
 * As capacidades que o fluxo de planejamento precisa — **não** as skills que as fornecem.
 *
 * Enum fechado, e fechado nas *capacidades*: acrescentar uma skill nova não muda esta lista,
 * porque skill nova é outro fornecedor da mesma capacidade. O que muda a lista é o fluxo
 * passar a precisar de uma disciplina que não precisava.
 */
export const CAPACIDADES = [
  /** Extrair escopo e requisitos por perguntas antes de gerar (o papel do `brainstorming`). */
  'perguntas-de-escopo',
  /** Comprimir contexto sem perder substância técnica (o papel do Caveman). */
  'compressao-de-contexto',
  /** Mapear estrutura do repositório sem leitura ampla (o papel do Graphify). */
  'mapa-estrutural',
  /** Revisar o que foi gerado antes de apresentar ao usuário. */
  'revisao-de-saida'
] as const

export type Capacidade = (typeof CAPACIDADES)[number]

/**
 * Como a capacidade foi atendida nesta execução.
 *
 * `direto` **não** é degradação silenciosa: é o caminho previsto da spec, e o manifesto o
 * registra igual ao caminho por skill. Um estado `indisponivel` não existe de propósito — ele
 * seria a porta pela qual o gate sumiria.
 */
export const MEIOS_DA_CAPACIDADE = ['skill', 'direto'] as const

export type MeioDaCapacidade = (typeof MEIOS_DA_CAPACIDADE)[number]

/**
 * Uma skill disponível no ambiente, com as capacidades que ela fornece.
 *
 * `capacidades` no plural porque uma skill costuma cobrir mais de uma (o Graphify mapeia *e*
 * comprime), e registrar uma linha por par obrigaria o resolvedor a deduplicar.
 */
export interface SkillDisponivel {
  readonly id: string
  readonly capacidades: readonly Capacidade[]
}

/** Como uma capacidade foi resolvida — o que entra no manifesto e na tela. */
export interface CapacidadeResolvida {
  readonly capacidade: Capacidade
  readonly meio: MeioDaCapacidade
  /** A skill que atendeu, quando `meio` é `skill`. Ausente no caminho direto. */
  readonly skillId?: string
  /** O que o fluxo faz nesta capacidade — a mesma frase nos dois meios. */
  readonly procedimento: string
}

/**
 * O que o fluxo faz em cada capacidade **independentemente de haver skill**.
 *
 * Dado e não `if`: é esta tabela que torna o critério 5 estrutural. Ela existe mesmo quando o
 * registro de skills está vazio, e é ela que o manifesto cita — de modo que "sem skill" produz
 * um pack com o mesmo gate, só com `meio: 'direto'` na linha.
 */
export const PROCEDIMENTO_DIRETO: Readonly<Record<Capacidade, string>> = {
  'perguntas-de-escopo':
    'Listar as perguntas em aberto e exigir resposta antes de gerar; nenhuma suposição entra como decisão.',
  'compressao-de-contexto':
    'Selecionar por busca estrutural e enviar trechos, nunca arquivos inteiros sem exceção registrada.',
  'mapa-estrutural':
    'Começar pelo índice e pela busca estrutural; leitura ampla só sob exceção com motivo e teto.',
  'revisao-de-saida':
    'Reler a saída contra os critérios da SPEC e apontar o que não está sustentado por evidência.'
}

/**
 * Resolve uma capacidade contra as skills disponíveis. **Nunca devolve "indisponível"**.
 *
 * A primeira skill que declara a capacidade atende. Primeira e não "melhor": ordenar por
 * qualidade exigiria um critério de qualidade que ninguém definiu, e inventar um faria a
 * escolha parecer informada quando é arbitrária. Quem controla a preferência controla a ordem
 * da lista, que é explícito.
 */
export function resolverCapacidade(
  capacidade: Capacidade,
  disponiveis: readonly SkillDisponivel[]
): CapacidadeResolvida {
  const procedimento = PROCEDIMENTO_DIRETO[capacidade]
  const skill = disponiveis.find((s) => s.capacidades.includes(capacidade))

  if (skill === undefined) {
    return { capacidade, meio: 'direto', procedimento }
  }

  return { capacidade, meio: 'skill', skillId: skill.id, procedimento }
}

/**
 * Resolve **todas** as capacidades. É esta função que o fluxo chama, e não `resolverCapacidade`
 * item a item: pedir a lista inteira impede que um chamador esqueça uma capacidade e, com ela,
 * o gate correspondente.
 */
export function resolverCapacidades(
  disponiveis: readonly SkillDisponivel[]
): readonly CapacidadeResolvida[] {
  return CAPACIDADES.map((capacidade) => resolverCapacidade(capacidade, disponiveis))
}

export function isCapacidade(value: unknown): value is Capacidade {
  return typeof value === 'string' && (CAPACIDADES as readonly string[]).includes(value)
}
